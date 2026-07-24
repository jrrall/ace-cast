// F2 (Card Forge) — content ingestion API. Real-server supertest (mirrors
// admin_feedback.test.js). Covers the auth matrix (content token vs admin gate),
// per-item validation, dedupe across statuses, and the review lifecycle.
const request = require('supertest');
const { useTestDb, cleanupTestDb } = require('./helpers/testDb');

const CONTENT_TOKEN = 'content-secret';
const ADMIN_TOKEN = 'admin-secret';

describe('Content API (/api/content/cards)', () => {
  let db;
  let app;
  let server;
  let ioServer;
  let config;
  let PackRepository;
  let genPackId;

  // POST a batch with the content bearer token.
  const postBatch = (cards, token = CONTENT_TOKEN) => request(app)
    .post('/api/content/cards')
    .set('Authorization', `Bearer ${token}`)
    .send({ cards });

  beforeAll(async () => {
    process.env.PORT = '0';
    process.env.ADMIN_TOKEN = ADMIN_TOKEN;
    process.env.CONTENT_API_TOKEN = CONTENT_TOKEN;
    db = useTestDb('content-api');
    // eslint-disable-next-line global-require
    const mod = require('../src/server/index');
    app = mod.app;
    server = mod.server;
    ioServer = mod.io;
    // eslint-disable-next-line global-require
    config = require('../src/utils/config');
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

  const validAnswer = (text) => ({
    kind: 'answer', text, blanks: 0, maturity_rating: 2, pack: 'madlad-generated',
  });

  describe('auth', () => {
    test('missing content token → 401', async () => {
      const res = await request(app).post('/api/content/cards').send({ cards: [] });
      expect(res.status).toBe(401);
    });

    test('invalid content token → 401', async () => {
      const res = await request(app)
        .post('/api/content/cards')
        .set('Authorization', 'Bearer wrong')
        .send({ cards: [] });
      expect(res.status).toBe(401);
    });

    test('X-Api-Token header is accepted', async () => {
      const res = await request(app)
        .get('/api/content/cards')
        .set('X-Api-Token', CONTENT_TOKEN);
      expect(res.status).toBe(200);
    });

    test('token unset → 404 (feature off)', async () => {
      const saved = config.contentApi.token;
      config.contentApi.token = null;
      try {
        const res = await request(app)
          .get('/api/content/cards')
          .set('X-Api-Token', CONTENT_TOKEN);
        expect(res.status).toBe(404);
      } finally {
        config.contentApi.token = saved;
      }
    });
  });

  describe('auth separation (S2 — prevents auto-publish)', () => {
    let cardId;

    beforeAll(async () => {
      const res = await postBatch([validAnswer('separation test answer')]);
      [cardId] = res.body.created;
    });

    test('content token CANNOT approve via PATCH (hits requireAdmin → 404)', async () => {
      const res = await request(app)
        .patch(`/api/content/cards/${cardId}`)
        .set('X-Api-Token', CONTENT_TOKEN)
        .send({ status: 'approved' });
      expect(res.status).toBe(404);
    });

    test('admin token CAN approve via PATCH', async () => {
      const res = await request(app)
        .patch(`/api/content/cards/${cardId}?token=${ADMIN_TOKEN}`)
        .send({ status: 'approved' });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ id: cardId, status: 'approved' });
    });
  });

  describe('POST validation + ingestion', () => {
    test('valid batch → 201, pending rows retrievable via GET', async () => {
      const res = await postBatch([
        validAnswer('batch answer one'),
        { kind: 'prompt', text: 'A batch prompt ____', blanks: 1, maturity_rating: 2, pack: 'madlad-generated' },
      ]);
      expect(res.status).toBe(201);
      expect(res.body.created).toHaveLength(2);
      expect(res.body.skipped).toBe(0);
      expect(res.body.rejected).toEqual([]);

      const list = await request(app)
        .get('/api/content/cards?status=pending')
        .set('X-Api-Token', CONTENT_TOKEN);
      const texts = list.body.cards.map((c) => c.text);
      expect(texts).toContain('batch answer one');
      expect(texts).toContain('A batch prompt ____');
      // Persisted as generated + pending.
      const row = list.body.cards.find((c) => c.text === 'batch answer one');
      expect(row.status).toBe('pending');
      expect(row.source).toBe('generated');
    });

    test('over-maxBatch → 400', async () => {
      const saved = config.contentApi.maxBatch;
      config.contentApi.maxBatch = 2;
      try {
        const res = await postBatch([
          validAnswer('a'), validAnswer('b'), validAnswer('c'),
        ]);
        expect(res.status).toBe(400);
      } finally {
        config.contentApi.maxBatch = saved;
      }
    });

    test('non-array cards → 400', async () => {
      const res = await postBatch('nope');
      expect(res.status).toBe(400);
    });

    test('malformed items are rejected per-item with reasons', async () => {
      const res = await postBatch([
        { kind: 'prompt', text: 'no blank here', blanks: 1, maturity_rating: 2, pack: 'madlad-generated' },
        { kind: 'prompt', text: 'two blanks ____ ____', blanks: 1, maturity_rating: 2, pack: 'madlad-generated' },
        { kind: 'answer', text: 'too spicy', blanks: 0, maturity_rating: 3, pack: 'madlad-generated' },
        { kind: 'answer', text: 'orphan', blanks: 0, maturity_rating: 2, pack: 'no-such-pack' },
        { kind: 'answer', text: 'contains slur1 term', blanks: 0, maturity_rating: 2, pack: 'madlad-generated' },
        { kind: 'sideways', text: 'bad kind', blanks: 0, maturity_rating: 2, pack: 'madlad-generated' },
      ]);
      expect(res.status).toBe(201);
      expect(res.body.created).toHaveLength(0);
      const reasons = res.body.rejected.map((r) => r.reason);
      expect(res.body.rejected).toHaveLength(6);
      expect(reasons).toEqual(expect.arrayContaining([
        expect.stringMatching(/missing ____/),
        expect.stringMatching(/blanks/),
        expect.stringMatching(/maturity/),
        'unknown pack',
        'content policy',
        'invalid kind',
      ]));
    });
  });

  describe('review lifecycle + dedupe', () => {
    test('dedupe skips an existing (pack_id,text) including a denied one', async () => {
      // Insert, then deny.
      const first = await postBatch([validAnswer('recycled theme')]);
      const [id] = first.body.created;
      const patch = await request(app)
        .patch(`/api/content/cards/${id}?token=${ADMIN_TOKEN}`)
        .send({ status: 'denied', denied_reason: 'off theme' });
      expect(patch.status).toBe(200);

      // Re-POST the same text → skipped, not recreated (S5).
      const again = await postBatch([validAnswer('recycled theme')]);
      expect(again.body.created).toHaveLength(0);
      expect(again.body.skipped).toBe(1);

      // Still exactly one row with that text.
      const all = await db.db()('cards')
        .where({ pack_id: genPackId, text: 'recycled theme' });
      expect(all).toHaveLength(1);
      expect(all[0].status).toBe('denied');
    });

    test('PATCH unknown id → 404; bad status → 400', async () => {
      const missing = await request(app)
        .patch(`/api/content/cards/999999?token=${ADMIN_TOKEN}`)
        .send({ status: 'approved' });
      expect(missing.status).toBe(404);

      const bad = await request(app)
        .patch(`/api/content/cards/1?token=${ADMIN_TOKEN}`)
        .send({ status: 'banished' });
      expect(bad.status).toBe(400);
    });

    test('DELETE removes a pending card; 409 on a non-pending one', async () => {
      const created = await postBatch([validAnswer('deletable answer')]);
      const [id] = created.body.created;

      const del = await request(app)
        .delete(`/api/content/cards/${id}`)
        .set('X-Api-Token', CONTENT_TOKEN);
      expect(del.status).toBe(200);
      expect(del.body).toMatchObject({ id, deleted: true });

      // Create + approve another, then DELETE must 409.
      const created2 = await postBatch([validAnswer('approved answer keep')]);
      const [id2] = created2.body.created;
      await request(app)
        .patch(`/api/content/cards/${id2}?token=${ADMIN_TOKEN}`)
        .send({ status: 'approved' });
      const del2 = await request(app)
        .delete(`/api/content/cards/${id2}`)
        .set('X-Api-Token', CONTENT_TOKEN);
      expect(del2.status).toBe(409);
    });
  });
});
