/* eslint-disable camelcase */
// F2 (Card Forge) — ContentCardRepository unit tests. Exercises the fail-closed
// insert (always `pending`), all-status dedupe (incl. denied), review stamping,
// and the pending-only delete guard directly against a seeded test DB.
const { useTestDb, cleanupTestDb } = require('./helpers/testDb');

describe('ContentCardRepository', () => {
  let db;
  let ContentCardRepository;
  let PackRepository;
  let genPackId;

  beforeAll(async () => {
    db = useTestDb('content-repo');
    await db.migrateToLatest();
    await db.seedRun();
    // Required here (before setup.js's afterEach resetModules) so the db module
    // isn't re-evaluated into a second, never-closed connection.
    ContentCardRepository = require('../src/content/ContentCardRepository');
    PackRepository = require('../src/content/PackRepository');
    const pack = await PackRepository.getBySlug('madlad-generated');
    genPackId = pack.id;
  });

  afterAll(async () => {
    await db.close();
    cleanupTestDb();
  });

  // Keep the generated pack empty between tests so counts are deterministic.
  afterEach(async () => {
    await db.db()('cards').where({ pack_id: genPackId }).del();
  });

  const baseRow = (overrides = {}) => ({
    game_id: 'madlad',
    kind: 'answer',
    text: 'A generated answer',
    blanks: 0,
    maturity_rating: 2,
    pack_id: genPackId,
    ...overrides,
  });

  test('insertPending forces status=pending / source=generated even when overridden', async () => {
    const [id] = await ContentCardRepository.insertPending([
      // Caller tries to sneak an approved/manual row past the guard.
      baseRow({ status: 'approved', source: 'manual' }),
    ]);
    const row = await db.db()('cards').where({ id })
      .first();
    expect(row.status).toBe('pending');
    expect(row.source).toBe('generated');
  });

  test('insertPending returns ids in input order and inserts every row', async () => {
    const ids = await ContentCardRepository.insertPending([
      baseRow({ text: 'first' }),
      baseRow({ text: 'second' }),
      baseRow({ text: 'third' }),
    ]);
    expect(ids).toHaveLength(3);
    const texts = await Promise.all(
      ids.map(async (id) => (await db.db()('cards').where({ id }).first()).text),
    );
    expect(texts).toEqual(['first', 'second', 'third']);
  });

  test('existingTextsForPack returns normalized texts of ALL statuses incl. denied', async () => {
    await db.db()('cards').insert([
      baseRow({ text: '  Approved TEXT  ', status: 'approved' }),
      baseRow({ text: 'Denied Text', status: 'denied' }),
      baseRow({ text: 'Pending Text', status: 'pending' }),
    ]);
    const texts = await ContentCardRepository.existingTextsForPack(genPackId);
    // Normalized: trimmed, collapsed whitespace, lowercased.
    expect(texts.has('approved text')).toBe(true);
    expect(texts.has('denied text')).toBe(true);
    expect(texts.has('pending text')).toBe(true);
  });

  test('setStatus writes reviewed_at + reviewed_by and a denial reason', async () => {
    const [id] = await ContentCardRepository.insertPending([baseRow()]);
    const updated = await ContentCardRepository.setStatus(id, {
      status: 'denied',
      reviewed_by: 'admin',
      denied_reason: 'off theme',
    });
    expect(updated).toBe(1);
    const row = await db.db()('cards').where({ id })
      .first();
    expect(row.status).toBe('denied');
    expect(row.reviewed_by).toBe('admin');
    expect(row.reviewed_at).toBeTruthy();
    expect(row.denied_reason).toBe('off theme');
  });

  test('setStatus approve clears any stale denied_reason', async () => {
    const [id] = await ContentCardRepository.insertPending([baseRow()]);
    await ContentCardRepository.setStatus(id, { status: 'denied', denied_reason: 'nope' });
    await ContentCardRepository.setStatus(id, { status: 'approved', reviewed_by: 'admin' });
    const row = await db.db()('cards').where({ id })
      .first();
    expect(row.status).toBe('approved');
    expect(row.denied_reason).toBeNull();
  });

  test('deletePending removes a pending row', async () => {
    const [id] = await ContentCardRepository.insertPending([baseRow()]);
    const deleted = await ContentCardRepository.deletePending(id);
    expect(deleted).toBe(1);
    const row = await db.db()('cards').where({ id })
      .first();
    expect(row).toBeUndefined();
  });

  test('deletePending refuses a non-pending row (0 rows deleted)', async () => {
    const [id] = await ContentCardRepository.insertPending([baseRow()]);
    await ContentCardRepository.setStatus(id, { status: 'approved', reviewed_by: 'admin' });
    const deleted = await ContentCardRepository.deletePending(id);
    expect(deleted).toBe(0);
    const row = await db.db()('cards').where({ id })
      .first();
    expect(row).toBeDefined();
  });

  test('list filters by status and kind and caps at limit', async () => {
    await ContentCardRepository.insertPending([
      baseRow({ kind: 'answer', text: 'ans one' }),
      baseRow({ kind: 'prompt', text: 'A prompt ____', blanks: 1 }),
    ]);
    const pendingAnswers = await ContentCardRepository.list({ status: 'pending', kind: 'answer' });
    expect(pendingAnswers.every((c) => c.status === 'pending' && c.kind === 'answer')).toBe(true);
    expect(pendingAnswers.some((c) => c.text === 'ans one')).toBe(true);
    expect(pendingAnswers.some((c) => c.kind === 'prompt')).toBe(false);

    const capped = await ContentCardRepository.list({ limit: 1 });
    expect(capped).toHaveLength(1);
  });

  test('countByStatus counts by status, optionally since a timestamp', async () => {
    // Only the generated pack is reset between tests (afterEach above), so an
    // unfiltered count would also pick up the seeded core deck's ~500 rows
    // (backfilled to `approved` by the F1 migration). The `since` filter is
    // what the F3 dashboard actually uses for approved/denied-today, and those
    // seeded rows carry no `reviewed_at` (the backfill isn't a "review"), so
    // scoping every assertion to `since` keeps this test independent of seed
    // volume — exactly like the real dashboard query.
    const [, toApproveId, toDenyId] = await ContentCardRepository.insertPending([
      baseRow({ text: 'still pending' }),
      baseRow({ text: 'will be approved' }),
      baseRow({ text: 'will be denied' }),
    ]);
    expect(await ContentCardRepository.countByStatus('pending')).toBe(3);

    const future = new Date(Date.now() + 60 * 60 * 1000);
    expect(await ContentCardRepository.countByStatus('approved', { since: future })).toBe(0);

    await ContentCardRepository.setStatus(toApproveId, { status: 'approved', reviewed_by: 'admin' });
    await ContentCardRepository.setStatus(toDenyId, { status: 'denied', reviewed_by: 'admin' });

    expect(await ContentCardRepository.countByStatus('pending')).toBe(1);

    const past = new Date(Date.now() - 60 * 60 * 1000);
    expect(await ContentCardRepository.countByStatus('approved', { since: past })).toBe(1);
    expect(await ContentCardRepository.countByStatus('denied', { since: past })).toBe(1);
  });
});
