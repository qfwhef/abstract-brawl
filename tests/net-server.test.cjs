/* net-server integration test: two simulated clients play a full turn battle through real WebSocket connections.
 * Verifies: create/join/lock/start, authoritative action validation (including NOT_YOUR_TURN),
 * determinism between the two clients' local engines, action_log replay, result broadcast, rematch reset.
 * Run: node tests/net-server.test.mjs  (requires `ws` in node_modules: npm i --no-save ws)
 */
const net = require('node:net');
const { spawn } = require('node:child_process');
const path = require('node:path');
const WebSocket = require('ws');

const root = path.resolve(__dirname, '..');
const PORT = 4591;

let passed = 0, failed = 0;
function check(name, cond, extra) {
  if (cond) { passed++; console.log(`  ok  ${name}`); }
  else { failed++; console.log(`  FAIL ${name}${extra ? ' — ' + JSON.stringify(extra) : ''}`); }
}

function freePort(port) {
  return new Promise(resolve => {
    const srv = net.createServer();
    srv.once('error', () => resolve(false));
    srv.listen(port, '127.0.0.1', () => srv.close(() => resolve(true)));
  });
}

class FakeClient {
  constructor(url) {
    this.ws = null; this.url = url;
    this.inbox = [];
    this.waiters = [];
    this.open = false;
  }
  connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.url);
      this.ws.on('open', () => { this.open = true; resolve(); });
      this.ws.on('message', data => {
        let msg; try { msg = JSON.parse(data.toString('utf8')); } catch { return; }
        const w = this.waiters.shift();
        if (w) w(msg); else this.inbox.push(msg);
      });
      this.ws.on('error', err => { if (!this.open) reject(err); });
    });
  }
  send(obj) { this.ws.send(JSON.stringify(obj)); }
  next(timeout = 4000) {
    if (this.inbox.length) return Promise.resolve(this.inbox.shift());
    return new Promise(resolve => {
      const timer = setTimeout(() => { const i = this.waiters.indexOf(w); if (i >= 0) this.waiters.splice(i, 1); resolve(null); }, timeout);
      const w = msg => { clearTimeout(timer); resolve(msg); };
      this.waiters.push(w);
    });
  }
  async expect(type, timeout = 4000) {
    for (;;) {
      const msg = await this.next(timeout);
      if (!msg) return null;
      if (msg.type === type) return msg;
    }
  }
  close() { try { this.ws.close(1000); } catch {} }
}

// Deterministic local Battle reimplementation on the client side, mirroring the page's roster load.
const vm = require('node:vm');
function loadPageEngine() {
  const c = { console }; c.window = c; vm.createContext(c);
  for (const f of ['assets', 'roster', 'turn-engine', 'turn-cast', 'turn-data']) {
    vm.runInContext(require('node:fs').readFileSync(path.join(root, f + '.js'), 'utf8'), c);
  }
  return { roster: c.TURN_ROSTER, Battle: c.AbstractTactics.Battle };
}

function hashOf(battle) {
  return JSON.stringify([battle.round, battle.turn, battle.winner, battle.active, battle.units.map(u => [u.uid, Math.round(u.hp * 100), u.energy, u.guard, u.cell])]);
}

function randomTeam(roster, rng) {
  const ids = roster.map(c => c.id);
  for (let i = ids.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [ids[i], ids[j]] = [ids[j], ids[i]]; }
  return ids.slice(0, 4).map((id, i) => ({ id, cell: i }));
}

async function main() {
  if (!(await freePort(PORT))) { console.error('port busy'); process.exit(1); }
  const child = spawn(process.execPath, [path.join(root, 'server', 'static-server.mjs')], {
    env: { ...process.env, PORT: String(PORT), ROOT: path.join(root, 'dist') },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stderr.on('data', d => process.stderr.write(d));
  let booted = new Promise(resolve => child.stdout.on('data', d => { if (String(d).includes('listening')) resolve(); }));
  await booted;
  const url = `ws://127.0.0.1:${PORT}/ws`;

  try {
    const A = new FakeClient(url), B = new FakeClient(url);
    await A.connect(); await B.connect();
    A.send({ type: 'hello', name: 'A', version: 1 });
    B.send({ type: 'hello', name: 'B', version: 1 });

    // --- create / join ---
    A.send({ type: 'create' });
    const created = await A.expect('created');
    check('created with 6-digit code + side 0', created && /^\d{6}$/.test(created.code) && created.side === 0, created);
    check('created carries token', typeof created.token === 'string' && created.token.length === 32);
    const code = created.code;

    // B joins with wrong code first
    B.send({ type: 'join', code: '000000' });
    const notFound = await B.expect('error');
    check('wrong code rejected', notFound && notFound.code === 'ROOM_NOT_FOUND', notFound);

    B.send({ type: 'join', code });
    const joined = await B.expect('joined');
    check('B joined as side 1', joined && joined.side === 1 && joined.code === code, joined);
    const hostNotified = await A.expect('opponent_joined');
    check('A notified of B joining', hostNotified && hostNotified.name === 'B', hostNotified);

    // C cannot join a full room
    const C = new FakeClient(url);
    await C.connect();
    C.send({ type: 'hello', name: 'C', version: 1 });
    await C.expect('welcome');
    C.send({ type: 'join', code });
    const roomFull = await C.expect('error');
    check('third player gets ROOM_FULL', roomFull && roomFull.code === 'ROOM_FULL', roomFull);
    C.close();

    // --- lock / start ---
    const page = loadPageEngine();
    const rng = (() => { let s = 12345; return () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x80000000; }; })();
    const teamA = randomTeam(page.roster, rng), teamB = randomTeam(page.roster, rng);
    A.send({ type: 'lock', team: teamA });
    const lockedA = await A.expect('locked');
    check('A locked', !!lockedA);
    const bSawLock = await B.expect('opponent_locked');
    check('B sees A lock', bSawLock && bSawLock.side === 0, bSawLock);
    B.send({ type: 'lock', team: teamB });
    const startA = await A.expect('start');
    const startB = await B.expect('start');
    check('start has seed + both teams', startA && Number.isInteger(startA.seed) && startA.teams.length === 2 && startA.teams[0].length === 4, startA);
    check('A and B share the same seed & teams', startB && startB.seed === startA.seed && JSON.stringify(startB.teams) === JSON.stringify(startA.teams));

    // --- battle: local engines constructed identically on both "clients" ---
    const battleA = new page.Battle(page.roster, startA.teams, { difficulty: 1, seed: startA.seed });
    const battleB = new page.Battle(page.roster, startB.teams, { difficulty: 1, seed: startB.seed });

    // B (side1) tries to act first when it's A's turn -> rejected if active.side===0
    let u = battleA.unit(battleA.active);
    if (u.side === 0) {
      // it's A's turn: A sends a legal guard, B's plan attempt comes later
      A.send({ type: 'action', slot: 'guard', target: null }); // guard is always legal
      const ack = await A.expect('action_ack');
      check('A guard acked', !!ack);
      check('action_ack carries slot', ack && ack.slot === 'guard');
      const opp = await B.expect('opponent_action');
      check('opponent_action forwarded with guard slot', opp && opp.slot === 'guard', opp);
      battleA.act('guard', null);
      battleB.act('guard', null);
    }

    // illegal turn: whoever is NOT active sends an action -> server rejects it, and the raw
    // candidate is chosen WITHOUT running local plan() so neither engine's RNG stream is touched.
    const activeSide = battleA.unit(battleA.active).side;
    const wrong = activeSide === 0 ? B : A;
    wrong.send({ type: 'action', slot: 0, target: 0 }); // any legal-shaped order; server must reject by turn
    const notYourTurn = await wrong.expect('error');
    check('NOT_YOUR_TURN enforced', notYourTurn && notYourTurn.code === 'NOT_YOUR_TURN', notYourTurn);

    // --- action with move ---
    const mover = battleA.unit(battleA.active);
    const moverSide = mover.side;
    const clientMover = moverSide === 0 ? A : B;
    const targetCell = mover.cell < 2 ? mover.cell + 2 : mover.cell - 2; // adjacent lane
    clientMover.send({ type: 'action', slot: 'guard', target: null, move: targetCell });
    const moveAck = await clientMover.expect('action_ack');
    check('action with move acked', !!moveAck);
    const moveOpp = await (moverSide === 0 ? B : A).expect('opponent_action');
    check('opponent_action carries move', moveOpp && moveOpp.move === targetCell, moveOpp);
    battleA.move(targetCell);
    battleA.act('guard', null);
    battleB.move(targetCell);
    battleB.act('guard', null);
    check('both local engines match after move', hashOf(battleA) === hashOf(battleB));

    // --- automated match to completion: acting side picks without plan() (mirrors a human online),
    // server resolves, both local engines replay with relayed origin => deterministic lockstep ---
    let actions = 0;
    let resultA = null, resultB = null;
    const deadline = Date.now() + 30_000;
    const humanPick = b => {
      const u = b.unit(b.active);
      for (let slot = 0; slot < 4; slot++) {
        if (!b.canUse(u, slot)) continue;
        const ts = b.targets(u, u.data.skills[slot]);
        if (ts.length) return { slot, target: ts[0].uid };
      }
      return { slot: 'guard', target: null };
    };
    while (battleA.winner === null && Date.now() < deadline) {
      const side = battleA.unit(battleA.active).side;
      const client = side === 0 ? A : B;
      const p = humanPick(battleA);
      client.send({ type: 'action', slot: p.slot, target: p.target });
      const ack = await client.expect('action_ack');
      if (!ack) { check('server stopped acking mid-battle', false, { side, p, actions }); break; }
      const ra = battleA.act(p.slot, p.target, ack.origin ?? undefined);
      const rb = battleB.act(p.slot, p.target, ack.origin ?? undefined);
      if (!ra.ok || !rb.ok) { check('local replay of server-acked action failed', false, { ra: ra.reason, rb: rb.reason, p, ack }); break; }
      const other = side === 0 ? B : A;
      await other.expect('opponent_action');
      actions++;
    }
    check('battle reached completion through the server', battleA.winner !== null, { actions, winner: battleA.winner });
    check('A local engine matches B local engine', hashOf(battleA) === hashOf(battleB));
    resultA = await A.expect('result');
    resultB = await B.expect('result');
    check('server result broadcast to A', resultA && resultA.winner === battleA.winner, resultA);
    check('server result broadcast to B with same winner', resultB && resultB.winner === resultA.winner, resultB);

    // --- rematch ---
    A.send({ type: 'rematch' });
    await B.expect('rematch_ready');
    B.send({ type: 'rematch' });
    const reA = await A.expect('rematch');
    const reB = await B.expect('rematch');
    check('rematch returns both to select', !!reA && !!reB);

    // --- reconnect replay: A drops mid-battle, reconnects by token, gets room_state with action log ---
    // advance a fresh battle
    A.send({ type: 'lock', team: teamA });
    await A.expect('locked');
    B.send({ type: 'lock', team: teamB });
    const start2 = await A.expect('start');
    await B.expect('start');
    const battle2 = new page.Battle(page.roster, start2.teams, { difficulty: 1, seed: start2.seed });
    // play a few actions
    for (let i = 0; i < 3 && battle2.winner === null; i++) {
      const side = battle2.unit(battle2.active).side;
      const client = side === 0 ? A : B;
      const p = battle2.plan(battle2.active, 1);
      client.send({ type: 'action', slot: p.slot, target: p.target });
      await client.expect('action_ack');
      battle2.act(p.slot, p.target);
      await (side === 0 ? B : A).expect('opponent_action');
    }
    // A's raw socket dies
    const sawLeft = B.ws.once.bind(B.ws);
    A.ws.terminate();
    const leftMsg = await B.expect('opponent_left');
    check('B told A dropped with grace', leftMsg && leftMsg.graceMs > 0, leftMsg);

    // A reconnects with token
    const A2 = new FakeClient(url);
    await A2.connect();
    A2.send({ type: 'hello', name: 'A', version: 1, token: created.token });
    const state = await A2.expect('room_state');
    check('reconnect restores battle state with action log', state && state.phase === 'battle' && Array.isArray(state.actions) && state.actions.length >= 2, state && { phase: state.phase, actions: state.actions?.length });
    check('reconnected sees B alive', await B.expect('opponent_reconnected') !== null);

    // replay the action log locally and confirm determinism
    const replay = new page.Battle(page.roster, state.teams, { difficulty: 1, seed: state.seed });
    for (const a of state.actions) {
      if (Number.isInteger(a.move)) replay.move(a.move);
      replay.act(a.slot, a.target, a.origin ?? undefined);
    }
    check('action log replay matches live engine turn', replay.turn === state.turn, { replayTurn: replay.turn, stateTurn: state.turn });

    await A2.expect('welcome'); // drain
    A2.close();
    B.close();
    A.close();

    // --- stale / expired token reconnect ---
    const staleClient = new FakeClient(url);
    await staleClient.connect();
    staleClient.send({ type: 'hello', name: 'Stale', version: 1, token: '0123456789abcdef0123456789abcdef' });
    const staleWelcome = await staleClient.expect('welcome');
    check('stale token receives welcome with sessionExpired', staleWelcome && staleWelcome.sessionExpired === true);
    staleClient.send({ type: 'create' });
    const staleCreated = await staleClient.expect('created');
    check('stale client can create room immediately', staleCreated && typeof staleCreated.code === 'string');
    staleClient.close();
  } finally {
    child.kill();
  }
  console.log(`net-server suite: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
