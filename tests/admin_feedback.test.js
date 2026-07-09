// F3 — the admin dashboard is gated behind ADMIN_TOKEN: 404 without a (valid)
// token, 200 with the correct one. Mirrors socket_e2e.test.js's real-server
// supertest setup.
const request = require('supertest');
const { useTestDb, cleanupTestDb } = require('./helpers/testDb');

describe('GET /admin/feedback (admin gate)', () => {
  let db;
  let app;
  let server;

  beforeAll(async () => {
    process.env.PORT = '0';
    process.env.ADMIN_TOKEN = 'test-secret';
    db = useTestDb('admin-feedback');
    // eslint-disable-next-line global-require
    const mod = require('../src/server/index');
    app = mod.app;
    server = mod.server;
    await mod.start(); // migrate + seed + listen
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
    await db.close();
    cleanupTestDb();
    delete process.env.ADMIN_TOKEN;
  });

  test('404s without a token', async () => {
    const res = await request(app).get('/admin/feedback');
    expect(res.status).toBe(404);
  });

  test('404s with the wrong token', async () => {
    const res = await request(app).get('/admin/feedback?token=nope');
    expect(res.status).toBe(404);
  });

  test('200s with the correct token', async () => {
    const res = await request(app).get('/admin/feedback?token=test-secret');
    expect(res.status).toBe(200);
  });

  test('the JSON API is gated the same way', async () => {
    const denied = await request(app).get('/api/admin/feedback');
    expect(denied.status).toBe(404);

    const allowed = await request(app).get('/api/admin/feedback?token=test-secret');
    expect(allowed.status).toBe(200);
    expect(allowed.body).toHaveProperty('cards');
  });
});
