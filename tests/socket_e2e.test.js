const request = require('supertest');
const { io: Client } = require('socket.io-client');

// End-to-end test: drives a full MadLad round through real
// Socket.IO clients against the actual server, verifying the private-broadcast
// wiring (players get hands, spectators never do) and start/submit/judge flow.

let app;
let server;
let ioServer;
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

beforeAll((done) => {
  process.env.PORT = '0';
  // eslint-disable-next-line global-require
  const mod = require('../src/server/index');
  app = mod.app;
  server = mod.server;
  ioServer = mod.io;
  const ready = () => {
    base = `http://localhost:${server.address().port}`;
    done();
  };
  if (server.listening) ready();
  else server.once('listening', ready);
});

afterAll((done) => {
  clients.forEach((c) => c.close());
  ioServer.close();
  server.close(done);
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
  await waitUntil(() => players.every((p) => p.last && p.last.you && p.last.hand.length === 7));

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
