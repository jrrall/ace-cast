const request = require('supertest');
const { io: Client } = require('socket.io-client');
const { useTestDb, cleanupTestDb } = require('./helpers/testDb');

// End-to-end test: drives a full MadLad round through real
// Socket.IO clients against the actual server, verifying the private-broadcast
// wiring (players get hands, spectators never do) and start/submit/judge flow.

let app;
let server;
let ioServer;
let db;
let base;
const clients = [];

const connect = () => {
  const socket = Client(base, { forceNew: true, reconnection: false });
  socket.last = null;
  socket.states = [];
  socket.on('game-update', (d) => {
    socket.last = d.gameState;
    socket.states.push(d.gameState);
  });
  clients.push(socket);
  return socket;
};

// Resolve on connect, but reject fast on error or timeout so a genuine failure
// reports clearly instead of hanging until the jest timeout.
const waitConnect = (socket, timeout = 8000) => new Promise((resolve, reject) => {
  if (socket.connected) {
    resolve();
    return;
  }
  const timer = setTimeout(() => reject(new Error('socket connect timeout')), timeout);
  socket.once('connect', () => { clearTimeout(timer); resolve(); });
  socket.once('connect_error', (err) => { clearTimeout(timer); reject(err); });
});

const once = (socket, event, timeout = 8000) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error(`timed out waiting for '${event}'`)), timeout);
  socket.once(event, (data) => { clearTimeout(timer); resolve(data); });
});

const waitUntil = (predicate, timeout = 5000) => new Promise((resolve, reject) => {
  const start = Date.now();
  const timer = setInterval(() => {
    let value = false;
    try { value = predicate(); } catch (e) { value = false; }
    if (value) {
      clearInterval(timer);
      resolve(value);
    } else if (Date.now() - start > timeout) {
      clearInterval(timer);
      reject(new Error('waitUntil timed out'));
    }
  }, 15);
});

beforeAll(async () => {
  process.env.PORT = '0';
  // Keep this a pure human-flow test — no auto-fill bots. Set before the server
  // (and config) are required so rooms are created with botTarget 0.
  process.env.BOT_TARGET = '0';
  // Isolated temp DB, set before requiring the server so start() seeds it and
  // the deck is sourced from the DB (proving E2 end-to-end).
  db = useTestDb('e2e');
  // eslint-disable-next-line global-require
  const mod = require('../src/server/index');
  app = mod.app;
  server = mod.server;
  ioServer = mod.io;
  await mod.start(); // migrate + seed + listen
  base = `http://localhost:${server.address().port}`;
});

afterAll(async () => {
  clients.forEach((c) => c.close());
  ioServer.close();
  await new Promise((resolve) => server.close(resolve));
  await db.close();
  cleanupTestDb();
});

test('plays a full MadLad round through real sockets', async () => {
  const res = await request(app).post('/api/create-room');
  const { roomCode } = res.body;
  expect(roomCode).toMatch(/^[A-Z]{4}$/);

  // Spectators (host + tv) and three players connect and join.
  const host = connect();
  const tv = connect();
  await Promise.all([waitConnect(host), waitConnect(tv)]);
  host.emit('join-room', { roomCode, deviceType: 'host' });
  tv.emit('join-room', { roomCode, deviceType: 'tv' });

  const players = [connect(), connect(), connect()];
  await Promise.all(players.map((p) => waitConnect(p)));
  await Promise.all(players.map((p, i) => {
    const joined = once(p, 'room-state');
    p.emit('join-room', { roomCode, playerName: `P${i + 1}`, deviceType: 'player' });
    return joined;
  }));

  // Host starts the game with a target score of 1 (one round decides it).
  host.emit('start-game', { gameType: 'madlad', options: { targetScore: 1 } });

  // Every player receives a private view with a full hand.
  await waitUntil(() => players.every((p) => p.last && p.last.you && p.last.hand.length === 8));

  const judge = players.find((p) => p.last.you.isJudge);
  const answerers = players.filter((p) => !p.last.you.isJudge);
  expect(judge).toBeDefined();
  expect(answerers).toHaveLength(2);

  // Spectators must never receive private data.
  expect(tv.last.you).toBeUndefined();
  expect(tv.last.hand).toBeUndefined();
  expect(host.last.you).toBeUndefined();

  // Non-judges submit their first card.
  answerers.forEach((p) => p.emit('player-action', { action: 'submit-card', data: { cardIndex: 0 } }));

  // Judge gets both (anonymous) submissions once everyone has played.
  await waitUntil(() => judge.last.phase === 'judging' && judge.last.submissions.length === 2);
  judge.last.submissions.forEach((s) => expect(s.playerName).toBeUndefined());

  // Spectator saw an anonymous judging snapshot too.
  const tvJudging = tv.states.find((s) => s.phase === 'judging');
  expect(tvJudging).toBeDefined();
  expect(tvJudging.submissions.every((s) => !s.playerName)).toBe(true);

  // Judge crowns a winner; target score of 1 ends the game.
  judge.emit('player-action', { action: 'pick-winner', data: { submissionId: judge.last.submissions[0].id } });
  await waitUntil(() => players.every((p) => p.last.phase === 'gameover'));

  // Exactly one player reached the winning score, and it's revealed publicly.
  const topScore = Math.max(...tv.last.scores.map((s) => s.score));
  expect(topScore).toBe(1);
  expect(tv.last.winnerName).toBeTruthy();
  expect(tv.last.lastWinner.playerName).toBeTruthy();
}, 30000);

test('bot controls change visible seats without accumulating hidden clicks', async () => {
  const { body: { roomCode } } = await request(app).post('/api/create-room');
  const host = connect();
  await waitConnect(host);
  const roster = new Map();
  host.on('player-joined', (p) => roster.set(p.playerId, p));
  host.on('player-left', (p) => roster.delete(p.playerId));
  const joined = once(host, 'room-state');
  host.emit('join-room', { roomCode, deviceType: 'host' });
  await joined;
  const held = once(host, 'autostart-state');
  host.emit('set-autostart', { on: false });
  await held;
  const click = async (event) => {
    const updated = once(host, 'bot-controls');
    host.emit(event);
    return updated;
  };
  for (let i = 0; i < 12; i += 1) {
    expect(await click('add-bot')).toMatchObject({ botCount: 0, canAdd: false });
  }
  for (let i = 0; i < 2; i += 1) {
    const player = connect();
    await waitConnect(player);
    const ready = once(player, 'room-state');
    const updated = once(host, 'bot-controls');
    player.emit('join-room', { roomCode, playerName: `BotTester${i}`, deviceType: 'player' });
    await ready;
    expect(await updated).toMatchObject({ botCount: 0, humanCount: i + 1 });
  }
  expect(roster.size).toBe(2);
  expect(await click('remove-bot')).toMatchObject({ botCount: 0, canRemove: false });
  expect(await click('add-bot')).toMatchObject({ botCount: 1, canRemove: true });
  expect(roster.size).toBe(3);
  expect([...roster.values()].filter((p) => p.isBot)).toHaveLength(1);
  expect(await click('remove-bot')).toMatchObject({ botCount: 0, canRemove: false });
  expect(roster.size).toBe(2);
  let state;
  do {
    const before = roster.size;
    state = await click('add-bot');
    expect(roster.size).toBe(before + 1);
    expect(state.botCount).toBe(roster.size - 2);
  } while (state.canAdd);
  const fullSize = roster.size;
  expect(await click('add-bot')).toEqual(state);
  expect(roster.size).toBe(fullSize);
  const refreshed = once(host, 'room-state');
  host.emit('join-room', { roomCode, deviceType: 'host' });
  expect((await refreshed).players).toHaveLength(fullSize);
}, 30000);
