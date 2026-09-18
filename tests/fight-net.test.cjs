/* fight-net integration test: tests online fight room creation, lobby listing,
 * privacy toggle (public vs private), code-based joining, character selection sync,
 * input mask streaming, state sync, and rematch.
 */
const net = require('node:net');
const { spawn } = require('node:child_process');
const path = require('node:path');
const WebSocket = require('ws');

const root = path.resolve(__dirname, '..');
const PORT = 4593;

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
  close() { try { this.ws?.close(); } catch {} }
}

async function run() {
  const available = await freePort(PORT);
  if (!available) {
    console.error(`Port ${PORT} not available`);
    process.exit(1);
  }

  const serverProc = spawn(process.execPath, [path.join(root, 'server', 'static-server.mjs')], {
    env: { ...process.env, PORT: String(PORT), ROOT: root },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  const stop = () => {
    try { serverProc.kill(); } catch {}
  };
  process.on('exit', stop);

  await new Promise((resolve, reject) => {
    serverProc.stdout.on('data', d => {
      if (String(d).includes('listening')) resolve();
    });
    serverProc.stderr.on('data', d => {
      if (String(d).includes('EADDRINUSE')) reject(new Error('EADDRINUSE'));
    });
    setTimeout(() => resolve(), 2500);
  });

  const wsUrl = `ws://127.0.0.1:${PORT}/ws`;

  try {
    const cA = new FakeClient(wsUrl);
    const cB = new FakeClient(wsUrl);
    const cC = new FakeClient(wsUrl);
    await Promise.all([cA.connect(), cB.connect(), cC.connect()]);

    cA.send({ type: 'hello', name: 'Alice', version: 1 });
    cB.send({ type: 'hello', name: 'Bob', version: 1 });
    cC.send({ type: 'hello', name: 'Charlie', version: 1 });

    const [wA, wB, wC] = await Promise.all([cA.expect('welcome'), cB.expect('welcome'), cC.expect('welcome')]);
    check('Alice welcomed', wA?.type === 'welcome');
    check('Bob welcomed', wB?.type === 'welcome');
    check('Charlie welcomed', wC?.type === 'welcome');

    // 1. Check get_rooms before any room exists
    cB.send({ type: 'get_rooms', game: 'fight' });
    const emptyList = await cB.expect('room_list');
    check('empty room list returned', emptyList && Array.isArray(emptyList.rooms) && emptyList.rooms.length === 0);

    // 2. Alice creates a PUBLIC fight room
    cA.send({ type: 'create', game: 'fight', isPublic: true, title: '华山论剑', mode: '1v1' });
    const createA = await cA.expect('created');
    check('Alice created public fight room', createA?.code && createA?.game === 'fight' && createA?.isPublic === true);
    check('Alice room title matches', createA?.title === '华山论剑');

    // 3. Bob queries room list: Alice's room should appear
    cB.send({ type: 'get_rooms', game: 'fight' });
    const listWithA = await cB.expect('room_list');
    check('Alice room visible in lobby list', listWithA?.rooms?.some(r => r.code === createA.code && r.title === '华山论剑' && r.host === 'Alice'));

    // 4. Charlie creates a PRIVATE fight room
    cC.send({ type: 'create', game: 'fight', isPublic: false, title: '秘密训练', mode: '1v1' });
    const createC = await cC.expect('created');
    check('Charlie created private fight room', createC?.code && createC?.isPublic === false);

    // 5. Bob queries room list again: Charlie's private room must NOT appear
    cB.send({ type: 'get_rooms', game: 'fight' });
    const listWithoutC = await cB.expect('room_list');
    check('Private room excluded from room list', !listWithoutC?.rooms?.some(r => r.code === createC.code));
    check('Public room still in room list', listWithoutC?.rooms?.some(r => r.code === createA.code));

    // 6. Charlie leaves private room
    cC.send({ type: 'leave' });

    // 7. Bob joins Alice's public room via code
    cB.send({ type: 'join', code: createA.code });
    const joinB = await cB.expect('joined');
    check('Bob successfully joined Alice room', joinB?.code === createA.code && joinB?.side === 1);
    check('Bob received room metadata', joinB?.game === 'fight' && joinB?.title === '华山论剑');

    const oppJoinedA = await cA.expect('opponent_joined');
    check('Alice notified Bob joined', oppJoinedA?.name === 'Bob');

    // 8. Now Alice's room is full (2/2) -> Charlie checks room list, full room should appear and have full: true
    cC.send({ type: 'get_rooms', game: 'fight' });
    const listWhenFull = await cC.expect('room_list');
    const fullRoomEntry = listWhenFull?.rooms?.find(r => r.code === createA.code);
    check('Full room still shown in lobby list', !!fullRoomEntry && fullRoomEntry.full === true && fullRoomEntry.count === 2);

    // 9. Character selection & sync
    cA.send({ type: 'fight_select', charId: 5 });
    const bGotSelect = await cB.expect('fight_opponent_select');
    check('Bob received Alice character selection', bGotSelect?.side === 0 && bGotSelect?.charId === 5);

    cB.send({ type: 'fight_select', charId: 12 });
    const aGotSelect = await cA.expect('fight_opponent_select');
    check('Alice received Bob character selection', aGotSelect?.side === 1 && aGotSelect?.charId === 12);

    // 10. Locking & both locked -> Automatically starts battle!
    cA.send({ type: 'fight_lock', locked: true, stage: 'streamroof' });
    const bGotLock = await cB.expect('fight_opponent_lock');
    check('Bob notified Alice locked', bGotLock?.side === 0 && bGotLock?.locked === true);

    cB.send({ type: 'fight_lock', locked: true });
    const aGotBothLocked = await cA.expect('fight_both_locked');
    const bGotBothLocked = await cB.expect('fight_both_locked');
    check('Alice notified both locked', !!aGotBothLocked);
    check('Bob notified both locked', !!bGotBothLocked);

    // 11. Automatic fight_start broadcast without host needing to click
    const aStart = await cA.expect('fight_start');
    const bStart = await cB.expect('fight_start');
    check('Alice received automatic fight_start', aStart?.stage === 'streamroof' && typeof aStart?.seed === 'number');
    check('Bob received automatic fight_start matching seed', bStart?.seed === aStart?.seed && bStart?.stage === 'streamroof');

    // 12. Check room list while in battle -> in-progress battle still shown in list
    cC.send({ type: 'get_rooms', game: 'fight' });
    const listWhenBattle = await cC.expect('room_list');
    const battleRoomEntry = listWhenBattle?.rooms?.find(r => r.code === createA.code);
    check('In-progress battle room shown in lobby list', !!battleRoomEntry && battleRoomEntry.phase === 'battle');

    // 13. Input bitmask streaming
    cA.send({ type: 'fight_input', mask: 0x05, tick: 10 });
    const bGotInput = await cB.expect('fight_remote_input');
    check('Bob received Alice input bitmask', bGotInput?.side === 0 && bGotInput?.mask === 0x05 && bGotInput?.tick === 10);

    cB.send({ type: 'fight_input', mask: 0x18, tick: 11 });
    const aGotInput = await cA.expect('fight_remote_input');
    check('Alice received Bob input bitmask', aGotInput?.side === 1 && aGotInput?.mask === 0x18 && aGotInput?.tick === 11);

    // 14. Host sync snapshot
    cA.send({ type: 'fight_sync', hp0: 450, hp1: 380, mp0: 60, mp1: 80, timer: 45, round: 1 });
    const bGotSync = await cB.expect('fight_sync');
    check('Bob received fight_sync authoritative snapshot', bGotSync?.hp0 === 450 && bGotSync?.hp1 === 380);

    // 15. Battle finish notification
    cA.send({ type: 'fight_end', winner: 0 });
    const bGotResult = await cB.expect('fight_result');
    check('Bob received fight_result', bGotResult?.winner === 0);

    // Charlie checks lobby room list -> phase should be 'finished', NOT 'battle'
    cC.send({ type: 'get_rooms', game: 'fight' });
    const listWhenFinished = await cC.expect('room_list');
    const finishedRoom = listWhenFinished?.rooms?.find(r => r.code === createA.code);
    check('Finished room shown with phase finished (not battle)', finishedRoom?.phase === 'finished');

    // 16. Rematch requested by one player, then other player leaves
    cA.send({ type: 'fight_rematch' });
    const bGotRematchReady = await cB.expect('rematch_ready');
    check('Bob informed Alice ready for rematch', bGotRematchReady?.side === 0);

    // Bob decides to leave the room explicitly
    cB.send({ type: 'leave' });
    const aGotOppLeft = await cA.expect('opponent_left');
    check('Alice informed Bob left after match', !!aGotOppLeft);

    // Charlie checks lobby list -> Alice room is now 'waiting' (1/2), NOT 'battle'!
    cC.send({ type: 'get_rooms', game: 'fight' });
    const listAfterBobLeave = await cC.expect('room_list');
    const waitingRoom = listAfterBobLeave?.rooms?.find(r => r.code === createA.code);
    check('Room resets to waiting (1/2) after challenger leaves', waitingRoom?.phase === 'waiting' && waitingRoom?.count === 1);

    // 17. Alice also leaves the room
    cA.send({ type: 'leave' });
    cC.send({ type: 'get_rooms', game: 'fight' });
    const listAfterBothLeave = await cC.expect('room_list');
    check('Room completely destroyed and removed when both left', !listAfterBothLeave?.rooms?.some(r => r.code === createA.code));

    cA.close(); cB.close(); cC.close();
  } finally {
    stop();
  }

  console.log(`fight-net suite: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
