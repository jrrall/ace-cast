const request = require('supertest');
const { io: Client } = require('socket.io-client');
const { useTestDb, cleanupTestDb } = require('./helpers/testDb');

let db;
let mod;
let base;

beforeAll(async () => {
  process.env.PORT = '0';
  db = useTestDb('malformed-cookie');
  mod = require('../src/server/index');
  await mod.start();
  base = `http://localhost:${mod.server.address().port}`;
});

afterAll(async () => {
  mod.io.close();
  await new Promise((resolve) => mod.server.close(resolve));
  await db.close();
  cleanupTestDb();
});

test('HTTP requests survive malformed cookie escapes', async () => {
  const res = await request(mod.app).get('/').set('Cookie', 'broken=%E0%A4%A');
  expect(res.status).toBe(200);
});

test.each(['websocket', 'polling'])('Socket.IO %s connections survive malformed cookies', async (transport) => {
  const socket = Client(base, {
    transports: [transport], reconnection: false, forceNew: true,
    extraHeaders: { Cookie: 'acecast_did=%FF; unrelated=%' },
  });
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Socket connection timed out')), 5000);
      socket.once('connect', () => { clearTimeout(timer); resolve(); });
      socket.once('connect_error', (err) => { clearTimeout(timer); reject(err); });
    });
    expect(mod.io.sockets.sockets.get(socket.id).identityId).toBe(`ephemeral:${socket.id}`);
    expect((await request(mod.app).get('/healthz')).status).toBe(200);
  } finally {
    socket.close();
  }
});
