const request = require('supertest');
const { io: Client } = require('socket.io-client');
const { useTestDb, cleanupTestDb } = require('./helpers/testDb');

// Auto-start countdown: once >= MIN_PLAYERS humans are seated the lobby counts
// down and auto-starts the default game. The host can Hold (pause) and resume.
// Driven through real Socket.IO clients against the actual server.

let app;
let server;
let ioServer;
let db;
let base;
const clients = [];

const connect = () => {
  const socket = Client(base, { forceNew: true, reconnection: false });
  socket.events = [];
  socket.on('start-countdown', (d) => socket.events.push(['start-countdown', d]));
  socket.on('start-countdown-cancelled', () => socket.events.push(['start-countdown-cancelled']));
  socket.on('autostart-state', (d) => socket.events.push(['autostart-state', d]));
  socket.on('game-started', (d) => socket.events.push(['game-started', d]));
  clients.push(socket);
  return socket;
};

const waitConnect = (socket, timeout = 8000) => new Promise((resolve, reject) => {
  if (socket.connected) { resolve(); return; }
  const timer = setTimeout(() => reject(new Error('socket connect timeout')), timeout);
  socket.once('connect', () => { clearTimeout(timer); resolve(); });
  socket.once('connect_error', (err) => { clearTimeout(timer); reject(err); });
});

const once = (socket, event, timeout = 8000) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error(`timed out waiting for '${event}'`)), timeout);
  socket.once(event, (data) => { clearTimeout(timer); resolve(data); });
});

const saw = (socket, event) => socket.events.some(([e]) => e === event);
const delay = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

// Poll the persistent event log (events can fire before we start awaiting, e.g.
// the countdown arms synchronously inside the 3rd player's join handler).
// Resolves with the payload of the first matching event.
const waitEvent = (socket, event, timeout = 8000) => new Promise((resolve, reject) => {
  const start = Date.now();
  const tick = () => {
    const hit = socket.events.find(([e]) => e === event);
    if (hit) { resolve(hit[1]); return; }
    if (Date.now() - start > timeout) { reject(new Error(`timed out waiting for '${event}'`)); return; }
    setTimeout(tick, 15);
  };
  tick();
});

const joinThree = async (roomCode) => {
  const players = [connect(), connect(), connect()];
  await Promise.all(players.map((p) => waitConnect(p)));
  await Promise.all(players.map((p, i) => {
    const joined = once(p, 'room-state');
    p.emit('join-room', { roomCode, playerName: `P${i + 1}`, deviceType: 'player' });
    return joined;
  }));
  return players;
};

beforeAll(async () => {
  process.env.PORT = '0';
  // No auto-fill bots so the human count is deterministic.
  process.env.BOT_TARGET = '0';
  // Short countdown so the test runs fast (secondsLeft starts at 1).
  process.env.START_COUNTDOWN_MS = '1000';
  db = useTestDb('autostart');
  // eslint-disable-next-line global-require
  const mod = require('../src/server/index');
  app = mod.app;
  server = mod.server;
  ioServer = mod.io;
  await mod.start();
  base = `http://localhost:${server.address().port}`;
});

afterAll(async () => {
  clients.forEach((c) => c.close());
  ioServer.close();
  await new Promise((resolve) => server.close(resolve));
  await db.close();
  cleanupTestDb();
});

test('auto-starts the game after the countdown once enough players are seated', async () => {
  const { body: { roomCode } } = await request(app).post('/api/create-room');
  const host = connect();
  await waitConnect(host);
  host.emit('join-room', { roomCode, deviceType: 'host' });

  await joinThree(roomCode);

  // Host sees the countdown, then the game auto-starts (no explicit start-game).
  const countdown = await waitEvent(host, 'start-countdown');
  expect(countdown.secondsLeft).toBe(1);
  const started = await waitEvent(host, 'game-started');
  expect(started.gameType).toBe('madlad');
}, 20000);

test('host can Hold to suppress auto-start, then resume it', async () => {
  const { body: { roomCode } } = await request(app).post('/api/create-room');
  const host = connect();
  await waitConnect(host);
  host.emit('join-room', { roomCode, deviceType: 'host' });

  // Hold before the table fills.
  host.emit('set-autostart', { on: false });
  const held = await waitEvent(host, 'autostart-state');
  expect(held.on).toBe(false);

  await joinThree(roomCode);

  // While held, no countdown and no auto-start even past the countdown window.
  await delay(1500);
  expect(saw(host, 'start-countdown')).toBe(false);
  expect(saw(host, 'game-started')).toBe(false);

  // Resume: the countdown arms immediately and the game starts.
  host.emit('set-autostart', { on: true });
  const countdown = await waitEvent(host, 'start-countdown');
  expect(countdown.secondsLeft).toBe(1);
  const started = await waitEvent(host, 'game-started');
  expect(started.gameType).toBe('madlad');
}, 20000);
