// F3 (Card Forge) — the /admin/content review page. Mirrors admin_feedback.test.js
// for the admin gate, and content_api.test.js for seeding a pending candidate via
// the content token. Covers: auth gate, pending list rendering, and the
// approve-round-trip through the PATCH the page's buttons call.
const request = require('supertest');
const { useTestDb, cleanupTestDb } = require('./helpers/testDb');

const CONTENT_TOKEN = 'content-secret';
const ADMIN_TOKEN = 'admin-secret';

describe('GET /admin/content (admin gate + pending review)', () => {
  let db;
  let app;
  let server;
  let ioServer;
  let PackRepository;
  let genPackId;

  beforeAll(async () => {
    process.env.PORT = '0';
    process.env.ADMIN_TOKEN = ADMIN_TOKEN;
    process.env.CONTENT_API_TOKEN = CONTENT_TOKEN;
    db = useTestDb('admin-content');
    // eslint-disable-next-line global-require
    const mod = require('../src/server/index');
    app = mod.app;
    server = mod.server;
    ioServer = mod.io;
    // eslint-disable-next-line global-require
    PackRepository = require('../src/content/PackRepository');
    await mod.start(); // migrate + seed + listen
    const pack = await PackRepository.getBySlug('madlad-generated');
    genPackId = pack.id;
  });

  afterAll(async () => {
    ioServer.close();
    await new Promise((resolve) => server.close(resolve));
    await db.close();
    cleanupTestDb();
    delete process.env.ADMIN_TOKEN;
    delete process.env.CONTENT_API_TOKEN;
  });

  afterEach(async () => {
    await db.db()('cards').where({ pack_id: genPackId }).del();
  });

  test('404s without a token', async () => {
    const res = await request(app).get('/admin/content');
    expect(res.status).toBe(404);
  });

  test('404s with the wrong token', async () => {
    const res = await request(app).get('/admin/content?token=nope');
    expect(res.status).toBe(404);
  });

  test('200s with the correct token and lists a pending candidate', async () => {
    await request(app)
      .post('/api/content/cards')
      .set('Authorization', `Bearer ${CONTENT_TOKEN}`)
      .send({ cards: [{
        kind: 'answer', text: 'A pending answer', blanks: 0, maturity_rating: 1, pack: 'madlad-generated',
      }] });

    const res = await request(app).get(`/admin/content?token=${ADMIN_TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('A pending answer');
    expect(res.text).toContain('MadLad Generated'); // resolved pack name
  });

  test('approve via PATCH removes the card from the next pending listing', async () => {
    const submit = await request(app)
      .post('/api/content/cards')
      .set('Authorization', `Bearer ${CONTENT_TOKEN}`)
      .send({ cards: [{
        kind: 'answer', text: 'Approve me', blanks: 0, maturity_rating: 1, pack: 'madlad-generated',
      }] });
    const [id] = submit.body.created;

    const patch = await request(app)
      .patch(`/api/content/cards/${id}?token=${ADMIN_TOKEN}`)
      .send({ status: 'approved' });
    expect(patch.status).toBe(200);
    expect(patch.body).toEqual({ id, status: 'approved' });

    const res = await request(app).get(`/admin/content?token=${ADMIN_TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.text).not.toContain('Approve me');
  });
});
