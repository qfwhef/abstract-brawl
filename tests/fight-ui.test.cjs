const assert = require('node:assert/strict');
const vm = require('node:vm');
const { makeHarness, flush } = require('./ui-fixture.cjs');

// Exercise the actual page handlers with two clients. Each reselect request is
// queued as a broadcast to both clients, as the room server does.
const clients = [], requests = [], broadcasts = [];
class RoomClient {
  constructor() { this.handlers = new Map(); clients.push(this); }
  on(type, fn) { this.handlers.set(type, fn); return this; }
  emit(type, msg = {}) { this.handlers.get(type)?.(msg); }
  connect() { return Promise.resolve(this); }
  getRooms() {}
  sendFightSelect() {}
  sendFightReselect() {
    requests.push(this);
    broadcasts.push('fight_reselect');
  }
}

function enterBattle(h) {
  vm.runInContext(`
    onlineState.locked=[true,true];
    currentGame={destroy(){window.destroyedGames++;}};
  `, h.ctx);
  h.$('selection').hidden = true;
  h.$('battle').hidden = false;
  h.$('end').hidden = false;
  h.ctx.document.body.classList.add('in-battle');
}

function assertSelection(h) {
  assert.equal(h.$('selection').hidden, false);
  assert.equal(h.$('battle').hidden, true);
  assert.equal(h.$('end').hidden, true);
  assert.equal(h.ctx.document.body.classList.contains('in-battle'), false);
  assert.equal(vm.runInContext('currentGame', h.ctx), null);
  assert.equal(vm.runInContext('onlineState.locked.some(Boolean)', h.ctx), false);
}

function drainBroadcasts() {
  let count = 0;
  while (broadcasts.length) {
    assert.ok(++count <= 2, 'reselect broadcasts must stop without an echo loop');
    const type = broadcasts.shift();
    for (const client of clients) client.emit(type);
  }
}

(async () => {
  const pages = [makeHarness(new Map(), { page: 'fight.html' }), makeHarness(new Map(), { page: 'fight.html' })];
  for (let side = 0; side < pages.length; side++) {
    const h = pages[side];
    h.ctx.AbstractNet.NetClient = RoomClient;
    h.ctx.destroyedGames = 0;
    h.ctx.changeMode('online');
    clients[side].emit(side === 0 ? 'created' : 'joined', { code: '123456', title: 'Test room' });
  }
  await flush();

  // Both the in-game back button and the result-screen reselect button send
  // one request; neither the sender nor the opponent echoes the broadcast.
  for (const [side, button] of [[0, 'back'], [1, 'reselect']]) {
    pages.forEach(enterBattle);
    const before = requests.length;
    pages[side].$(button).onclick({ type: 'click' });
    assert.equal(requests.length, before + 1);
    drainBroadcasts();
    assert.equal(requests.length, before + 1);
    pages.forEach(assertSelection);
  }
  assert.deepEqual(pages.map(h => h.ctx.destroyedGames), [2, 2]);

  // Server-driven rematch also returns both clients without reselect traffic.
  pages.forEach(enterBattle);
  const before = requests.length;
  clients.forEach(client => client.emit('rematch'));
  pages.forEach(assertSelection);
  assert.equal(requests.length, before);

  enterBattle(pages[0]);
  clients[0].emit('opponent_left');
  for (const [id, fn] of [...pages[0].timers]) { pages[0].timers.delete(id); fn(); }
  assertSelection(pages[0]);
  assert.equal(requests.length, before);

  enterBattle(pages[1]);
  clients[1].emit('room_closed');
  assertSelection(pages[1]);
  pages[1].$('back').onclick({ type: 'click' });
  assert.equal(requests.length, before, 'leaving a closed room sends no reselect');

  vm.runInContext("mode='cpu';onlineState.inRoom=true;", pages[0].ctx);
  enterBattle(pages[0]);
  pages[0].$('reselect').onclick({ type: 'click' });
  assert.equal(pages[0].$('selection').hidden, false);
  assert.equal(requests.length, before, 'local play sends no network request');
  await flush();
  console.log('Fight UI reselect, rematch, opponent leave, room close and local navigation passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
