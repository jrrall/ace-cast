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

  test('manual cards require admin access and preserve manual provenance', async () => {
    const card = { kind: 'answer', text: 'Urethra Franklin', maturity_rating: 2, pack: 'madlad-generated' };
    expect((await request(app).post('/api/admin/cards').send(card)).status).toBe(404);
    expect((await request(app).post('/api/admin/cards').set('X-Api-Token', CONTENT_TOKEN).send(card)).status).toBe(404);
    const res = await request(app).post('/api/admin/cards').set('X-Admin-Token', ADMIN_TOKEN)
      .send({ ...card, source: 'generated', writer: 'writer.deadpan' });
    expect(res.status).toBe(201);
    const stored = await db.db()('cards').where({ id: res.body.id }).first();
    expect(stored).toMatchObject({ text: card.text, source: 'manual', status: 'pending', writer: null, blanks: 0 });
    expect(stored.reviewed_at).toBeNull();
    const duplicate = await request(app).post('/api/admin/cards').set('X-Admin-Token', ADMIN_TOKEN)
      .send({ ...card, text: '  URETHRA   FRANKLIN  ' });
    expect(duplicate.status).toBe(409);
    const library = await request(app).get('/admin/cards').query({ token: ADMIN_TOKEN });
    expect(library.text).toContain('id="add-card-form"');
    expect(library.text).toContain('Urethra Franklin');
  });

  test('admin can explicitly approve a manual prompt', async () => {
    const res = await request(app).post('/api/admin/cards').set('X-Admin-Token', ADMIN_TOKEN)
      .send({ kind: 'prompt', text: 'My next act is ____.', maturity_rating: 2,
        pack: 'madlad-generated', status: 'approved' });
    expect(res.status).toBe(201);
    const stored = await db.db()('cards').where({ id: res.body.id }).first();
    expect(stored).toMatchObject({ status: 'approved', source: 'manual', blanks: 1, reviewed_by: 'admin' });
    expect(stored.reviewed_at).not.toBeNull();
  });

  test.each([
    { kind: 'prompt', text: 'No blank.' },
    { kind: 'prompt', text: '____ and ____.' },
    { kind: 'prompt', text: 'Too many _____.' },
    { text: 'An answer with ____.' },
    { text: ' ' },
    { text: 'x'.repeat(1001) },
    { maturity_rating: 4 },
    { maturity_rating: null },
    { pack: 'missing-pack' },
    { status: 'denied' },
    { kind: 'invalid' },
  ])('manual card validation rejects %j', async (invalid) => {
    const res = await request(app).post('/api/admin/cards').set('X-Admin-Token', ADMIN_TOKEN)
      .send({ kind: 'answer', text: 'Valid answer', maturity_rating: 2,
        pack: 'madlad-generated', ...invalid });
    expect(res.status).toBe(400);
    expect(await db.db()('cards').where({ pack_id: genPackId })).toHaveLength(0);
  });

  test('source finds retain URL and route through storage and admin review', async () => {
    const sourceUrl = 'https://b3ta.com/questions/imagechallenge/post1';
    const res = await request(app).post('/api/content/cards').set('X-Api-Token', CONTENT_TOKEN)
      .send({ cards: [{ kind: 'answer', text: 'Found phrase fixture', maturity_rating: 2,
        pack: 'madlad-generated', generation_route: 'source_find', source_url: sourceUrl }] });
    expect(res.body.rejected).toEqual([]);
    const listed = await request(app).get('/api/content/cards').set('X-Api-Token', CONTENT_TOKEN);
    const card = listed.body.cards.find((c) => c.id === res.body.created[0]);
    expect(card.generation_route).toBe('source_find');
    expect(card.source_url).toBe(sourceUrl);
    expect(card.writer).toBeNull();
    for (const page of ['/admin/content', '/admin/cards']) {
      const view = await request(app).get(page).query({ token: ADMIN_TOKEN });
      expect(view.status).toBe(200);
      expect(view.text).toContain('Found phrase');
      expect(view.text).toContain(sourceUrl);
    }
  });

  test.each([
    { generation_route: 'made_up' },
    { source_url: 'javascript:alert(1)' },
    { source_url: 'https://user:pass@example.com/' },
    { generation_route: 'source_find' },
    { generation_route: 'source_find', source_url: 'https://b3ta.com/', writer: 'writer.deadpan' },
  ])('invalid provenance is rejected: %j', async (metadata) => {
    const res = await request(app).post('/api/content/cards').set('X-Api-Token', CONTENT_TOKEN)
      .send({ cards: [{ kind: 'answer', text: 'Bad provenance fixture', maturity_rating: 2,
        pack: 'madlad-generated', ...metadata }] });
    expect(res.body.created).toEqual([]);
    expect(res.body.rejected).toHaveLength(1);
  });

  test('writer attribution survives review and drives library filters and outcomes', async () => {
    const response = await request(app).post('/api/content/cards')
      .set('Authorization', `Bearer ${CONTENT_TOKEN}`)
      .send({ cards: [
        { kind: 'answer', text: 'Writer approved fixture', maturity_rating: 2, pack: 'madlad-generated', writer: 'writer.deadpan' },
        { kind: 'answer', text: 'Writer denied fixture', maturity_rating: 2, pack: 'madlad-generated', writer: 'writer.deadpan' },
        { kind: 'answer', text: 'Writer pending fixture', maturity_rating: 2, pack: 'madlad-generated', writer: 'writer.unhinged' },
        { kind: 'answer', text: 'Writer unknown fixture', maturity_rating: 2, pack: 'madlad-generated' },
      ] });
    expect(response.body.rejected).toEqual([]);
    const [approved, denied] = response.body.created;
    for (const [id, status] of [[approved, 'approved'], [denied, 'denied']]) {
      const review = await request(app).patch(`/api/content/cards/${id}`)
        .set('X-Admin-Token', ADMIN_TOKEN).send({ status });
      expect(review.status).toBe(200);
    }
    const listed = await request(app).get('/api/content/cards').set('X-Api-Token', CONTENT_TOKEN);
    expect(listed.body.cards.find((c) => c.id === approved).writer).toBe('writer.deadpan');
    const queue = await request(app).get('/admin/content').query({ token: ADMIN_TOKEN });
    expect(queue.text).toContain('writer.unhinged');
    const library = await request(app).get('/admin/cards').query({ token: ADMIN_TOKEN, writer: 'writer.deadpan' });
    expect(library.status).toBe(200);
    expect(library.text).toContain('Writer approved fixture');
    expect(library.text).toContain('Writer denied fixture');
    expect(library.text).not.toContain('Writer pending fixture');
    const unknown = await request(app).get('/admin/cards').query({ token: ADMIN_TOKEN, writer: 'unknown', source: 'generated' });
    expect(unknown.text).toContain('Writer unknown fixture');
    expect(unknown.text).not.toContain('Writer approved fixture');
    const overview = await request(app).get('/admin').query({ token: ADMIN_TOKEN });
    expect(overview.status).toBe(200);
    expect(overview.text).toContain('50%');
    expect(overview.text).toContain('Not reviewed');
    const repository = require('../src/content/AdminCardRepository');
    const counts = await repository.overview();
    expect(counts.writers.find((w) => w.writer === 'writer.deadpan')).toEqual({ writer: 'writer.deadpan', pending: 0, approved: 1, denied: 1 });
  });

  test.each(['<script>', 'writer.', 123, 'writer.' + 'x'.repeat(60)])('invalid writer metadata is rejected: %s', async (writer) => {
    const res = await request(app).post('/api/content/cards').set('X-Api-Token', CONTENT_TOKEN)
      .send({ cards: [{ kind: 'answer', text: 'Invalid writer fixture', maturity_rating: 2, pack: 'madlad-generated', writer }] });
    expect(res.body.created).toEqual([]);
    expect(res.body.rejected[0].reason).toBe('invalid writer');
  });

  test('404s without a token' , async () => {
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

  test('overview and library require admin auth, including against a content token', async () => {
    for (const route of ['/admin', '/admin/cards']) {
      expect((await request(app).get(route)).status).toBe(404);
      expect((await request(app).get(route).set('X-Admin-Token', CONTENT_TOKEN)).status).toBe(404);
      const authorized = await request(app).get(route).set('X-Admin-Token', ADMIN_TOKEN);
      expect(authorized.status).toBe(200);
      expect(authorized.text).toContain('Card library');
    }
  });

  test('library covers review history, escapes text, and combines filters', async () => {
    const result = await request(app).post('/api/content/cards')
      .set('Authorization', `Bearer ${CONTENT_TOKEN}`)
      .send({ cards: [
        { kind: 'answer', text: 'Library <script> 100% keeper', blanks: 0, maturity_rating: 1, pack: 'madlad-generated' },
        { kind: 'answer', text: 'Library reject', blanks: 0, maturity_rating: 1, pack: 'madlad-generated' },
      ] });
    const [pending, denied] = result.body.created;
    await request(app).patch(`/api/content/cards/${denied}`).set('X-Admin-Token', ADMIN_TOKEN)
      .send({ status: 'denied', denied_reason: 'Too repetitive' });
    const all = await request(app).get('/admin/cards').query({ token: ADMIN_TOKEN, pack: 'madlad-generated' });
    expect(all.status).toBe(200);
    expect(all.text).toContain('Library &lt;script&gt; 100% keeper');
    expect(all.text).toContain('Library reject');
    expect(all.text).toContain('Too repetitive');
    const filtered = await request(app).get('/admin/cards').query({ token: ADMIN_TOKEN, status: 'pending', q: '100%', source: 'generated' });
    expect(filtered.status).toBe(200);
    expect(filtered.text).toContain(`#${pending}`);
    expect(filtered.text).not.toContain('Library reject');
    const empty = await request(app).get('/admin/cards').query({ token: ADMIN_TOKEN, q: 'does-not-exist-uniquely' });
    expect(empty.text).toContain('No cards match');
  });

  test('library paginates without dropping filters or duplicating cards', async () => {
    for (let start = 0; start < 51; start += 20) {
      const result = await request(app).post('/api/content/cards')
        .set('Authorization', `Bearer ${CONTENT_TOKEN}`)
        .send({ cards: Array.from({ length: Math.min(20, 51 - start) }, (_, i) => ({
          kind: 'answer', text: `Pagination fixture ${start + i}`, blanks: 0, maturity_rating: 1, pack: 'madlad-generated',
        })) });
      expect(result.status).toBe(201);
    }
    const first = await request(app).get('/admin/cards').query({ token: ADMIN_TOKEN, q: 'Pagination fixture' });
    expect(first.status).toBe(200);
    expect(first.text).toContain('Page 1 of 2');
    expect(first.text).toContain('q=Pagination+fixture');
    const last = await request(app).get('/admin/cards').query({ token: ADMIN_TOKEN, q: 'Pagination fixture', page: 999 });
    expect(last.status).toBe(200);
    expect(last.text).toContain('Page 2 of 2');
    expect(last.text).toContain('Pagination fixture 0');
    expect(last.text).not.toContain('Pagination fixture 50');
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
