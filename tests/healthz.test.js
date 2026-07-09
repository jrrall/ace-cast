// /healthz reports liveness + the deployed build's version (from package.json,
// which semantic-release bumps post-release). Mirrors admin_feedback.test.js's
// real-server supertest setup.
const request = require('supertest');
const { version } = require('../package.json');
const { useTestDb, cleanupTestDb } = require('./helpers/testDb');

describe('GET /healthz', () => {
  let db;
  let app;
  let server;
  let ioServer;

  beforeAll(async () => {
    process.env.PORT = '0';
    db = useTestDb('healthz');
    // eslint-disable-next-line global-require
    const mod = require('../src/server/index');
    app = mod.app;
    server = mod.server;
    ioServer = mod.io;
    await mod.start(); // migrate + seed + listen
  });

  afterAll(async () => {
    ioServer.close();
    await new Promise((resolve) => server.close(resolve));
    await db.close();
    cleanupTestDb();
  });

  test('reports ok + the package.json version when the DB is healthy', async () => {
    const res = await request(app).get('/healthz');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.db).toBe(true);
    expect(res.body.version).toBe(version);
  });
});
