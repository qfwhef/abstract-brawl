/* Abstract Brawl online room server (Node >= 22, only dependency: `ws`).
 * Attaches to the static server's HTTP server via `attach(server)`: /ws upgrade + heartbeat.
 * Room flow: WAITING -> SELECT -> BATTLE -> FINISHED -> (rematch) SELECT; disconnect = overlay state with 90s grace.
 * Authority: each BATTLE room runs the deterministic turn-engine Battle locally (vm loaded at boot)
 * so illegal actions are rejected before broadcast, and reconnect replays the action log.
 * Message protocol (JSON): see docs/ONLINE.md.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PROTOCOL_VERSION = 1;
const GRACE_MS = 90_000;
const ROOM_IDLE_MS = 30 * 60_000;
const SWEEP_MS = 30_000;
const MAX_ROOMS = 200;
const MAX_WS_PER_IP = 4;
const JOIN_FAIL_LIMIT = 10;
const JOIN_FAIL_WINDOW_MS = 60_000;

/* --- deterministic engine (turn-engine + its ROSTER dependency chain, same load order as the page) --- */
const engine = (() => {
  const c = { console };
  c.window = c;
  vm.createContext(c);
  for (const f of ['assets', 'roster', 'meme-roster', 'roster-revision3', 'turn-engine', 'turn-cast', 'turn-data']) {
    vm.runInContext(fs.readFileSync(path.join(root, f + '.js'), 'utf8'), c);
  }
  return { roster: c.TURN_ROSTER, Battle: c.AbstractTactics.Battle };
})();

const validTeam = team => Array.isArray(team) && team.length === 4 &&
  new Set(team.map(s => s.id)).size === 4 && new Set(team.map(s => s.cell)).size === 4 &&
  team.every(s => Number.isInteger(s.id) && Number.isInteger(s.cell) && s.cell >= 0 && s.cell <= 3 &&
    engine.roster.some(c => c.id === s.id));

class Client {
  constructor(ws, ip) {
    this.ws = ws; this.ip = ip;
    this.id = crypto.randomBytes(8).toString('hex');
    this.token = crypto.randomBytes(16).toString('hex');
    this.name = '玩家'; this.room = null; this.side = null; this.alive = true;
    this.joinFails = [];
  }
  send(obj) { if (this.alive) try { this.ws.send(JSON.stringify(obj)); } catch { /* closing */ } }
  sendError(code, message) { this.send({ type: 'error', code, message }); }
}

class Room {
  constructor(id, options = {}) {
    this.id = id;
    this.game = options.game || 'turn'; // 'turn' | 'fight'
    this.isPublic = options.isPublic !== false; // boolean, default true
    this.title = (typeof options.title === 'string' && options.title.trim())
      ? options.title.trim().slice(0, 20)
      : (this.game === 'fight' ? '格斗擂台' : '回合对战');
    this.mode = options.mode || '1v1';
    this.phase = 'waiting'; // waiting | select | battle | finished
    this.clients = [null, null]; // [side0=host, side1]
    this.teams = [null, null];
    this.fightChars = [null, null]; // [charId0, charId1]
    this.fightLocked = [false, false]; // [locked0, locked1]
    this.seed = null;
    this.battle = null;
    this.actionLog = []; // executed {turn, slot, target} in order
    this.disconnectedAt = [null, null];
    this.graceTimer = [null, null];
    this.rematch = [false, false];
    this.created = Date.now();
    this.touched = Date.now();
    this.token0 = null; this.token1 = null; // remember session tokens per side for reconnect
  }
  full() { return this.clients.every(Boolean); }
  touch() { this.touched = Date.now(); }
  broadcast(obj, exceptId) {
    for (const client of this.clients) {
      if (client && client.id !== exceptId) client.send(obj);
    }
  }
}

class RoomServer {
  constructor() {
    this.rooms = new Map(); // id -> Room
    this.wsPerIp = new Map();
    this.wss = null;
    this.sweep = setInterval(() => this.sweepRooms(), SWEEP_MS);
    this.sweep.unref?.();
  }

  attach(server) {
    this.wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 });
    server.on('upgrade', (req, socket, head) => {
      const { pathname } = new URL(req.url, 'http://localhost');
      if (pathname !== '/ws') return socket.destroy();
      this.wss.handleUpgrade(req, socket, head, ws => {
        const ip = (req.headers['x-forwarded-for']?.split(',')[0].trim()) || req.socket.remoteAddress || 'unknown';
        this.onConnection(ws, ip);
      });
    });
    return this.wss;
  }

  onConnection(ws, ip) {
    const count = this.wsPerIp.get(ip) || 0;
    if (count >= MAX_WS_PER_IP) { ws.close(4001, 'too many connections'); return; }
    this.wsPerIp.set(ip, count + 1);

    const client = new Client(ws, ip);
    let authed = false;
    let pong = true;
    const heartbeat = setInterval(() => {
      if (!pong) { ws.terminate(); return; }
      pong = false; try { ws.ping(); } catch {}
    }, 25_000);
    const drop = () => {
      clearInterval(heartbeat);
      const c = this.wsPerIp.get(ip) || 1;
      if (c <= 1) this.wsPerIp.delete(ip); else this.wsPerIp.set(ip, c - 1);
      client.alive = false;
      if (client.room) this.leaveRoom(client, false);
    };
    ws.on('pong', () => { pong = true; });
    ws.on('close', drop);
    ws.on('error', drop);
    ws.on('message', data => {
      if (data.length > 16 * 1024) { ws.close(4009, 'message too large'); return; }
      let msg;
      try { msg = JSON.parse(data.toString('utf8')); } catch { return; }
      if (!msg || typeof msg.type !== 'string') return;
      try { this.onMessage(client, msg, () => { authed = true; }); } catch { client.sendError('INTERNAL', '服务器内部错误'); }
    });
    // hello is the only pre-auth message
    const helloTimer = setTimeout(() => { if (!authed) ws.close(4002, 'no hello'); }, 10_000);
    ws.on('close', () => clearTimeout(helloTimer));
  }

  onMessage(client, msg, markAuthed) {
    if (msg.type === 'hello') {
      markAuthed();
      client.name = typeof msg.name === 'string' && msg.name.trim() ? msg.name.trim().slice(0, 12) : '玩家';
      if (msg.version !== PROTOCOL_VERSION) { client.sendError('VERSION_MISMATCH', '客户端版本不一致，请刷新页面。'); return; }
      // token reconnect path
      if (typeof msg.token === 'string' && msg.token.length === 32) {
        const found = this.reconnectByToken(client, msg.token);
        if (found) return;
        // Token was not found in any active room (room ended, expired, or server restarted).
        // Gracefully issue a fresh token and welcome the client to the lobby!
        client.send({ type: 'welcome', id: client.id, token: client.token, protocol: PROTOCOL_VERSION, sessionExpired: true });
        return;
      }
      client.send({ type: 'welcome', id: client.id, token: client.token, protocol: PROTOCOL_VERSION });
      return;
    }
    // create/join/get_rooms do not require an active room; everything else requires one
    if (msg.type !== 'create' && msg.type !== 'join' && msg.type !== 'get_rooms' && !client.room) {
      client.sendError('NOT_IN_ROOM', '尚未加入房间。');
      return;
    }
    const room = client.room;
    room?.touch();
    switch (msg.type) {
      case 'get_rooms': this.handleGetRooms(client, msg); break;
      case 'create': this.handleCreate(client, msg); break;
      case 'join': this.handleJoin(client, msg); break;
      case 'lock': this.handleLock(client, msg); break;
      case 'action': this.handleAction(client, msg); break;
      case 'hash': this.handleHash(client, msg); break;
      case 'rematch':
        if (room?.game === 'fight') this.handleFightRematch(client);
        else this.handleRematch(client);
        break;
      case 'leave': this.leaveRoom(client, true); break;
      case 'fight_select': this.handleFightSelect(client, msg); break;
      case 'fight_stage': this.handleFightStage(client, msg); break;
      case 'fight_lock': this.handleFightLock(client, msg); break;
      case 'fight_start': this.handleFightStart(client, msg); break;
      case 'fight_input': this.handleFightInput(client, msg); break;
      case 'fight_sync': this.handleFightSync(client, msg); break;
      case 'fight_end': this.handleFightEnd(client, msg); break;
      case 'fight_reselect': this.handleFightReselect(client, msg); break;
      case 'fight_rematch': this.handleFightRematch(client); break;
      default: client.sendError('BAD_MESSAGE', '未知消息类型。');
    }
  }

  /* --- room lifecycle --- */

  handleGetRooms(client, msg = {}) {
    const game = msg.game || 'fight';
    const list = [];
    for (const r of this.rooms.values()) {
      if (r.game === game && r.isPublic) {
        list.push({
          code: r.id,
          title: r.title,
          host: r.clients[0]?.name || '房主',
          mode: r.mode,
          game: r.game,
          phase: r.phase,
          full: r.full(),
          count: r.clients.filter(Boolean).length,
          created: r.created
        });
      }
    }
    list.sort((a, b) => b.created - a.created);
    client.send({ type: 'room_list', game, rooms: list });
  }

  handleCreate(client, msg = {}) {
    this.leaveRoom(client, true);
    if (this.rooms.size >= MAX_ROOMS) { client.sendError('SERVER_FULL', '房间数已达上限，请稍后再试。'); return; }
    let id;
    do { id = String(crypto.randomInt(100000, 999999)); } while (this.rooms.has(id));
    const game = msg.game === 'fight' ? 'fight' : 'turn';
    const isPublic = msg.isPublic !== false;
    const title = typeof msg.title === 'string' && msg.title.trim()
      ? msg.title.trim().slice(0, 20)
      : (typeof msg.name === 'string' && msg.name.trim() ? msg.name.trim().slice(0, 20) : (game === 'fight' ? '格斗擂台' : '回合对战'));
    const mode = typeof msg.mode === 'string' ? msg.mode : '1v1';
    const room = new Room(id, { game, isPublic, title, mode });
    room.clients[0] = client; room.token0 = client.token; client.room = room; client.side = 0;
    this.rooms.set(id, room);
    client.send({
      type: 'created',
      code: id,
      side: 0,
      token: client.token,
      protocol: PROTOCOL_VERSION,
      game: room.game,
      isPublic: room.isPublic,
      title: room.title,
      mode: room.mode
    });
  }

  handleJoin(client, msg) {
    const now = Date.now();
    client.joinFails = client.joinFails.filter(t => now - t < JOIN_FAIL_WINDOW_MS);
    if (client.joinFails.length >= JOIN_FAIL_LIMIT) { client.sendError('RATE_LIMITED', '尝试过于频繁，请一分钟后再试。'); return; }
    const code = typeof msg.code === 'string' ? msg.code.trim() : String(msg.code ?? '');
    const room = this.rooms.get(code);
    if (!room || room.phase === 'battle') { client.joinFails.push(now); client.sendError('ROOM_NOT_FOUND', '房间不存在或已开战。'); return; }
    if (room.full()) { client.joinFails.push(now); client.sendError('ROOM_FULL', '房间已满。'); return; }
    if (client.room === room) { client.sendError('ALREADY_IN_ROOM', '你已在这个房间里。'); return; }
    if (client.room) this.leaveRoom(client, true);
    room.clients[1] = client; room.token1 = client.token; client.room = room; client.side = 1;
    if (room.game === 'fight' && room.phase === 'waiting') room.phase = 'select';
    // host may have gone silent (waiting phase, grace running): cancel grace
    this.clearGrace(room, 0);
    room.touch();
    client.send({
      type: 'joined',
      code: room.id,
      side: 1,
      token: client.token,
      protocol: PROTOCOL_VERSION,
      game: room.game,
      isPublic: room.isPublic,
      title: room.title,
      mode: room.mode,
      hostName: room.clients[0]?.name || '房主',
      fightChars: room.fightChars,
      fightLocked: room.fightLocked
    });
    room.clients[0]?.send({
      type: 'opponent_joined',
      name: client.name,
      side: 1,
      game: room.game
    });
  }

  handleLock(client, msg) {
    const room = client.room;
    if (room.phase !== 'select' && room.phase !== 'waiting') { client.sendError('BAD_STATE', '当前不能锁定阵容。'); return; }
    if (!validTeam(msg.team)) { client.sendError('BAD_TEAM', '阵容不合法。'); return; }
    room.teams[client.side] = msg.team.map(s => ({ id: s.id, cell: s.cell }));
    if (room.phase === 'waiting') room.phase = 'select';
    room.broadcast({ type: 'opponent_locked', side: client.side }, client.id);
    client.send({ type: 'locked' });
    if (room.teams[0] && room.teams[1]) this.startBattle(room);
  }

  startBattle(room) {
    room.phase = 'battle';
    room.seed = (crypto.randomInt(1, 0xffffffff)) >>> 0;
    room.battle = new engine.Battle(engine.roster, room.teams, { difficulty: 1, seed: room.seed });
    room.actionLog = [];
    room.rematch = [false, false];
    room.broadcast({
      type: 'start',
      teams: room.teams,
      seed: room.seed,
      stage: null,
      active: room.battle.active,
      queue: [...room.battle.queue],
      round: room.battle.round,
      turn: room.battle.turn
    });
  }

  handleAction(client, msg) {
    const room = client.room;
    const b = room.battle;
    if (room.phase !== 'battle' || !b || b.winner !== null) { client.sendError('BAD_STATE', '战斗未在进行。'); return; }
    const u = b.unit(b.active);
    if (!u || u.side !== client.side) { client.sendError('NOT_YOUR_TURN', '还没轮到你出手。'); return; }
    const slot = msg.slot; // 0..3 or 'guard'
    const target = msg.target; // uid or null
    if (slot !== 'guard' && !(Number.isInteger(slot) && slot >= 0 && slot <= 3)) { client.sendError('BAD_ACTION', '指令不合法。'); return; }
    let moved = false, fromCell = null, otherSwapped = null;
    if (Number.isInteger(msg.move)) {
      fromCell = u.cell;
      otherSwapped = b.living(u.side).find(t => t.cell === msg.move);
      if (!b.move(msg.move)) { client.sendError('BAD_ACTION', '换位不合法。'); return; }
      moved = true;
    }
    const turn = b.turn;
    const result = b.act(slot, target);
    if (!result.ok) {
      if (moved) {
        u.cell = fromCell;
        u.moved = false;
        if (otherSwapped) otherSwapped.cell = msg.move;
      }
      console.warn(`[ACTION REJECTED] room=${room.code} turn=${turn} actor=${u.uid}(${u.data.name}, side=${u.side}) slot=${slot} target=${target} move=${msg.move}: ${result.reason}`);
      client.sendError('BAD_ACTION', result.reason || '指令不合法。');
      return;
    }
    console.log(`[ACTION OK] room=${room.code} turn=${turn} actor=${u.uid}(${u.data.name}, side=${u.side}) slot=${slot} (${result.skill?.name || 'guard'}) target=${target} move=${moved ? msg.move : null}`);
    // mimic skills resolve origin through the engine RNG; relay the resolved origin so the opponent
    // replays act(slot, target, origin) — forcedOrigin consumes identical RNG rolls on every engine,
    // keeping all three (server + two clients) in deterministic lockstep.
    const entry = { turn, slot, target: result.guard ? null : target, origin: result.origin ?? null, move: moved ? msg.move : null };
    room.actionLog.push(entry);
    const syncState = { active: b.active, queue: [...b.queue], round: b.round, nextTurn: b.turn };
    client.send({ type: 'action_ack', turn, slot: entry.slot, target: entry.target, origin: entry.origin, ...syncState });
    room.broadcast({ type: 'opponent_action', ...entry, ...syncState }, client.id);
    if (b.winner !== null) {
      room.phase = 'finished';
      console.log(`[BATTLE FINISHED] room=${room.code} winner=${b.winner} round=${b.round}`);
      room.broadcast({ type: 'result', winner: b.winner, round: b.round });
    }
  }

  handleHash(client, msg) {
    const room = client.room;
    if (room.phase !== 'battle' && room.phase !== 'finished') return;
    if (typeof msg.value !== 'string' || msg.value.length > 40) return;
    room['hash' + client.side] = { turn: msg.turn, value: msg.value, at: Date.now() };
    const a = room.hash0, b = room.hash1;
    if (a && b && a.turn === b.turn && a.value !== b.value) {
      room.broadcast({ type: 'desync', turn: a.turn });
      room.hash0 = room.hash1 = null;
    }
  }

  handleRematch(client) {
    const room = client.room;
    if (room.phase !== 'finished') { client.sendError('BAD_STATE', '对局尚未结束。'); return; }
    room.rematch[client.side] = true;
    console.log(`[REMATCH] room=${room.id} side=${client.side} requested rematch`);
    room.broadcast({ type: 'rematch_ready', side: client.side }, client.id);
    if (room.rematch[0] && room.rematch[1]) {
      room.phase = 'select';
      room.teams = [null, null];
      room.battle = null;
      room.actionLog = [];
      room.seed = null;
      room.hash0 = room.hash1 = null;
      room.rematch = [false, false];
      console.log(`[REMATCH] room=${room.id} both players agreed, resetting to select phase`);
      room.broadcast({ type: 'rematch' });
    }
  }

  /* --- fight mode handlers --- */

  handleFightSelect(client, msg) {
    const room = client.room;
    if (!room || room.game !== 'fight' || (room.phase !== 'waiting' && room.phase !== 'select')) return;
    const charId = Number(msg.charId);
    if (!Number.isInteger(charId) || charId < 0) return;
    room.fightChars[client.side] = charId;
    room.broadcast({ type: 'fight_opponent_select', side: client.side, charId }, client.id);
  }

  handleFightStage(client, msg) {
    const room = client.room;
    if (!room || room.game !== 'fight' || client.side !== 0) return;
    if (typeof msg.stage === 'string') room.fightStage = msg.stage;
  }

  handleFightLock(client, msg) {
    const room = client.room;
    if (!room || room.game !== 'fight' || (room.phase !== 'waiting' && room.phase !== 'select')) return;
    const locked = !!msg.locked;
    if (client.side === 0 && typeof msg.stage === 'string') {
      room.fightStage = msg.stage;
    }
    room.fightLocked[client.side] = locked;
    room.broadcast({ type: 'fight_opponent_lock', side: client.side, locked }, client.id);
    client.send({ type: 'fight_lock_ack', locked, side: client.side });
    if (room.fightLocked[0] && room.fightLocked[1]) {
      room.broadcast({ type: 'fight_both_locked' });
      this.startFightBattle(room);
    }
  }

  startFightBattle(room, customStage, customSeed) {
    if (room.phase === 'battle') return;
    room.phase = 'battle';
    room.seed = (typeof customSeed === 'number' ? customSeed : (crypto.randomInt(1, 0xffffffff) >>> 0));
    let stage = customStage || room.fightStage || 'streamroof';
    if (stage === 'random') {
      const stagePool = ['streamroof', 'sunset-deck', 'neon-alley', 'cyber-grid', 'retro-arcade', 'temple-grounds', 'digital-dojo'];
      stage = stagePool[crypto.randomInt(0, stagePool.length)] || 'streamroof';
    }
    room.rematch = [false, false];
    room.broadcast({
      type: 'fight_start',
      seed: room.seed,
      stage,
      chars: room.fightChars
    });
  }

  handleFightStart(client, msg) {
    const room = client.room;
    if (!room || room.game !== 'fight') return;
    if (client.side !== 0) { client.sendError('NOT_HOST', '仅房主可发起开战。'); return; }
    if (!room.full()) { client.sendError('NOT_FULL', '等待挑战者加入。'); return; }
    if (!room.fightLocked[0] || !room.fightLocked[1]) {
      client.sendError('NOT_LOCKED', '双方尚未全部锁定角色。');
      return;
    }
    this.startFightBattle(room, msg.stage, msg.seed);
  }

  handleFightInput(client, msg) {
    const room = client.room;
    if (!room || room.game !== 'fight' || room.phase !== 'battle') return;
    const mask = Number(msg.mask) | 0;
    const tick = Number(msg.tick) | 0;
    const out = {
      type: 'fight_remote_input',
      side: client.side,
      mask,
      tick
    };
    if (typeof msg.x === 'number') out.x = msg.x;
    if (typeof msg.y === 'number') out.y = msg.y;
    if (typeof msg.vx === 'number') out.vx = msg.vx;
    if (typeof msg.vy === 'number') out.vy = msg.vy;
    if (typeof msg.facing === 'number') out.facing = msg.facing;
    room.broadcast(out, client.id);
  }

  handleFightSync(client, msg) {
    const room = client.room;
    if (!room || room.game !== 'fight' || room.phase !== 'battle') return;
    if (client.side !== 0) return;
    const out = {
      type: 'fight_sync',
      hp0: msg.hp0,
      hp1: msg.hp1,
      mp0: msg.mp0,
      mp1: msg.mp1,
      guard0: msg.guard0,
      guard1: msg.guard1,
      timer: msg.timer,
      round: msg.round,
      wins: msg.wins
    };
    for (const key of ['x0', 'y0', 'vx0', 'vy0', 'facing0', 'x1', 'y1', 'vx1', 'vy1', 'facing1', 'winnerTeam', 'phase']) {
      if (msg[key] !== undefined) out[key] = msg[key];
    }
    room.broadcast(out, client.id);
  }

  handleFightEnd(client, msg) {
    const room = client.room;
    if (!room || room.game !== 'fight' || room.phase !== 'battle') return;
    room.phase = 'finished';
    room.rematch = [false, false];
    console.log(`[FIGHT END] room=${room.id} side=${client.side} winner=${msg.winner}`);
    room.broadcast({ type: 'fight_result', winner: msg.winner });
  }

  handleFightReselect(client) {
    const room = client.room;
    if (!room || room.game !== 'fight') return;
    room.phase = 'select';
    room.fightLocked = [false, false];
    room.rematch = [false, false];
    room.broadcast({ type: 'fight_reselect' });
  }

  handleFightRematch(client) {
    const room = client.room;
    if (!room || room.game !== 'fight') return;
    room.rematch[client.side] = true;
    room.broadcast({ type: 'rematch_ready', side: client.side }, client.id);
    if (room.rematch[0] && room.rematch[1]) {
      room.phase = 'select';
      room.fightLocked = [false, false];
      room.rematch = [false, false];
      room.broadcast({ type: 'rematch', game: 'fight' });
    }
  }

  leaveRoom(client, explicit) {
    const room = client.room;
    if (!room) return;
    client.room = null;
    const side = client.side;
    room.clients[side] = null;
    if (room.graceTimer[side]) this.clearGrace(room, side);
    client.side = null;

    const other = room.clients[side ^ 1];
    if (!other) {
      this.destroyRoom(room);
      return;
    }

    if (!explicit && room.phase === 'battle') {
      // Unexpected drop during active battle -> allow reconnect grace
      room.disconnectedAt[side] = Date.now();
      other.send({ type: 'opponent_left', graceMs: GRACE_MS });
      this.armGrace(room, side);
      return;
    }

    // Explicit leave, or leave during waiting/select/finished
    if (side === 0) {
      // Host left -> Close room for remaining guest
      other.send({ type: 'opponent_left' });
      this.destroyRoom(room);
    } else {
      // Guest (side 1) left -> Host stays in room, reset room to waiting
      room.phase = 'waiting';
      room.fightLocked = [false, false];
      room.rematch = [false, false];
      room.teams = [null, null];
      room.fightChars[1] = null;
      room.token1 = null;
      room.battle = null;
      room.actionLog = [];
      other.send({ type: 'opponent_left' });
    }
  }

  armGrace(room, side) {
    this.clearGrace(room, side);
    room.graceTimer[side] = setTimeout(() => {
      room.graceTimer[side] = null;
      const other = room.clients[side ^ 1];
      if (room.phase === 'battle' && other) {
        room.phase = 'finished';
        other.send({ type: 'result', winner: other.side, forfeit: true });
      } else if (!other) {
        this.destroyRoom(room);
      }
    }, GRACE_MS).unref?.();
  }

  clearGrace(room, side) {
    if (room.graceTimer[side]) { clearTimeout(room.graceTimer[side]); room.graceTimer[side] = null; }
    room.disconnectedAt[side] = null;
  }

  destroyRoom(room) {
    for (let side = 0; side < 2; side++) {
      if (room.graceTimer[side]) clearTimeout(room.graceTimer[side]);
      const client = room.clients[side];
      if (client) { client.room = null; client.side = null; client.send({ type: 'room_closed' }); }
    }
    this.rooms.delete(room.id);
  }

  reconnectByToken(client, token) {
    for (const room of [...this.rooms.values()]) {
      for (let side = 0; side < 2; side++) {
        if (room['token' + side] !== token) continue;
        const occupied = room.clients[side];
        if (occupied && occupied.alive) { client.send({ type: 'welcome', id: client.id, token, alreadyLive: true }); return true; }
        if (occupied) { occupied.alive = false; room.clients[side] = null; }
        if (client.room && client.room !== room) this.leaveRoom(client, true);
        room.clients[side] = client; client.room = room; client.side = side;
        this.clearGrace(room, side);
        room.touch();
        client.send({ type: 'welcome', id: client.id, token });
        client.send(this.roomState(room, side));
        room.clients[side ^ 1]?.send({ type: 'opponent_reconnected' });
        return true;
      }
    }
    return false;
  }

  roomState(room, side) {
    const base = {
      type: 'room_state',
      phase: room.phase,
      code: room.id,
      side,
      protocol: PROTOCOL_VERSION,
      game: room.game,
      isPublic: room.isPublic,
      title: room.title,
      mode: room.mode
    };
    if (room.game === 'fight') {
      base.fightChars = room.fightChars;
      base.fightLocked = room.fightLocked;
      base.seed = room.seed;
      return base;
    }
    if (room.phase === 'select' || room.phase === 'finished') {
      base.locked = [!!room.teams[0], !!room.teams[1]];
      if (room.phase === 'finished' && room.battle) {
        base.winner = room.battle.winner; base.round = room.battle.round;
      }
    }
    if (room.phase === 'battle' || room.phase === 'finished') {
      base.teams = room.teams;
      base.seed = room.seed;
      base.actions = room.actionLog;
      if (room.battle) {
        base.turn = room.battle.turn;
        base.active = room.battle.active;
        base.queue = [...room.battle.queue];
        base.round = room.battle.round;
        if (room.battle.winner !== null) base.winner = room.battle.winner;
      }
    }
    return base;
  }

  sweepRooms() {
    const now = Date.now();
    for (const room of this.rooms.values()) {
      if (now - room.touched > ROOM_IDLE_MS && !room.clients.some(c => c?.alive)) this.destroyRoom(room);
      // Also drop never-started rooms whose host ghosted without disconnect (rare).
      if (room.phase === 'waiting' && now - room.created > ROOM_IDLE_MS) this.destroyRoom(room);
    }
  }

  /* test hooks */
  snapshotForTest() {
    return [...this.rooms.values()].map(r => ({
      id: r.id, game: r.game, phase: r.phase, isPublic: r.isPublic, title: r.title,
      sides: r.clients.map(c => !!c),
      actionCount: r.actionLog.length, winner: r.battle?.winner ?? null,
    }));
  }
}

let roomServer = null;
export function getRoomServer() {
  if (!roomServer) roomServer = new RoomServer();
  return roomServer;
}
export function attach(server) { return getRoomServer().attach(server); }
