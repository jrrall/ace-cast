// F3 — the admin dashboard is gated behind ADMIN_TOKEN: 404 without a (valid)
// token, 200 with the correct one. Mirrors socket_e2e.test.js's real-server
// supertest setup.
const request = require('supertest');
const { useTestDb, cleanupTestDb } = require('./helpers/testDb');

describe('GET /admin/feedback (admin gate)', () => {
  let db;
  let app;
  let server;
  let ioServer;

  beforeAll(async () => {
    process.env.PORT = '0';
    process.env.ADMIN_TOKEN = 'test-secret';
    db = useTestDb('admin-feedback');
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

  test('library and feedback show zero and nonzero exposure counts with their start time', async () => {
    const [{ id: packId }] = await db.db()('packs').insert({
      slug: 'exposure-ui', name: 'Exposure UI', game_id: 'madlad',
    }).returning('id');
    const cards = await db.db()('cards').insert([
      { text: 'Exposure answer zero', kind: 'answer', game_id: 'madlad', pack_id: packId, status: 'approved' },
      { text: 'Exposure answer used', kind: 'answer', game_id: 'madlad', pack_id: packId, status: 'approved' },
      { text: 'Exposure prompt zero ____', kind: 'prompt', game_id: 'madlad', pack_id: packId, status: 'approved' },
      { text: 'Exposure prompt used ____', kind: 'prompt', game_id: 'madlad', pack_id: packId, status: 'approved' },
    ]).returning('id');
    await db.db()('card_stats').insert([
      { card_id: cards[1].id, deals: 12, prompt_exposures: 0, plays: 4, wins: 2 },
      { card_id: cards[3].id, deals: 0, prompt_exposures: 7, plays: 0, wins: 0 },
    ]);
    const library = await request(app).get('/admin/cards?token=test-secret&pack=exposure-ui');
    expect(library.status).toBe(200);
    expect(library.text).toContain('Dealt: <strong>0</strong>');
    expect(library.text).toContain('Dealt: <strong>12</strong>');
    expect(library.text).toContain('Prompt exposures: <strong>0</strong>');
    expect(library.text).toContain('Prompt exposures: <strong>7</strong>');
    expect(library.text).toContain('Plays: <strong>4</strong>');
    expect(library.text).toContain('Wins: <strong>2</strong>');
    expect(library.text).toContain('Tracking began');
    expect(library.text).toContain('Earlier exposures are unknown');
    const feedback = await request(app).get('/admin/feedback?token=test-secret');
    expect(feedback.status).toBe(200);
    expect(feedback.text).toContain('<th>Dealt</th><th>Prompt exposures</th>');
    expect(feedback.text).toMatch(/Exposure answer zero[\s\S]*?<td>0<\/td>/);
    expect(feedback.text).toMatch(/Exposure answer used[\s\S]*?<td>12<\/td>/);
    expect(feedback.text).toMatch(/Exposure prompt used[\s\S]*?<td>7<\/td>/);
    const api = await request(app).get('/api/admin/feedback?token=test-secret');
    expect(api.body.cards.find((card) => card.id === cards[0].id)).toMatchObject({ deals: 0, promptExposures: 0 });
    expect(api.body.cards.find((card) => card.id === cards[1].id)).toMatchObject({ deals: 12, plays: 4, wins: 2 });
    expect(api.body.cards.find((card) => card.id === cards[3].id)).toMatchObject({ promptExposures: 7 });
    expect(api.body.exposureTracking.started_at).toBeTruthy();
  });

  test('the JSON API is gated the same way', async () => {
    const denied = await request(app).get('/api/admin/feedback');
    expect(denied.status).toBe(404);

    const allowed = await request(app).get('/api/admin/feedback?token=test-secret');
    expect(allowed.status).toBe(200);
    expect(allowed.body).toHaveProperty('cards');
  });
});
