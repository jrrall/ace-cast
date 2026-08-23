// E2.3a — DeckService builds a deck from the seeded madlad-core pack.
const { BLACK_CARDS, WHITE_CARDS } = require('../src/game/data/madladCards');
const { useTestDb, cleanupTestDb } = require('./helpers/testDb');

describe('DeckService', () => {
  let db;
  let DeckService;
  let PackRepository;
  let CardRepository;

  beforeAll(async () => {
    db = useTestDb('deck');
    await db.migrateToLatest();
    await db.seedRun();
    DeckService = require('../src/content/DeckService');
    PackRepository = require('../src/content/PackRepository');
    // Required here (not inside a test) so it's captured before setup.js's
    // global afterEach calls jest.resetModules() — requiring it later would
    // re-evaluate src/db too, opening a second, never-closed connection.
    CardRepository = require('../src/content/CardRepository');
  });

  afterAll(async () => {
    await db.close();
    cleanupTestDb();
  });

  test('falls back to the default pack when no packIds given', async () => {
    const deck = await DeckService.buildDeck({ gameId: 'madlad' });
    expect(deck.prompts).toHaveLength(BLACK_CARDS.length);
    expect(deck.answers).toHaveLength(WHITE_CARDS.length);
  });

  test('returns card objects with ids (not bare strings)', async () => {
    const deck = await DeckService.buildDeck({ gameId: 'madlad' });
    expect(typeof deck.prompts[0]).toBe('object');
    expect(deck.prompts[0]).toHaveProperty('id');
    expect(deck.prompts[0]).toHaveProperty('text');
    expect(deck.prompts[0]).toHaveProperty('blanks', 1);
    expect(deck.answers[0]).toHaveProperty('id');
    expect(deck.answers[0]).toHaveProperty('text');
  });

  test('honors an explicit packIds selection', async () => {
    const pack = await PackRepository.getDefault('madlad');
    const deck = await DeckService.buildDeck({ gameId: 'madlad', packIds: [pack.id] });
    expect(deck.prompts).toHaveLength(BLACK_CARDS.length);
  });

  test('maturity ceiling filters cards; empty deck throws', async () => {
    // Seeded cards are maturity 2, so a ceiling of 1 yields nothing.
    await expect(
      DeckService.buildDeck({ gameId: 'madlad', maturityMax: 1 }),
    ).rejects.toThrow(/empty/);
  });

  test('throws when a game has no default pack', async () => {
    await expect(
      DeckService.buildDeck({ gameId: 'nonexistent-game' }),
    ).rejects.toThrow(/no default pack/i);
  });

  // F1 (Card Forge, S4) — generated cards live in the `madlad-generated` pack,
  // which the DEFAULT deck path unions in. Only `approved` cards may play: a
  // pending/denied generated card must be absent from the default-path deck, and
  // approving it must make it appear (this is the test that fails on the v1
  // non-default-pack design where approved cards silently never play).
  test('default path unions approved generated cards, excludes pending/denied', async () => {
    // eslint-disable-next-line camelcase
    const genPack = await PackRepository.getBySlug('madlad-generated');
    expect(genPack).toBeDefined();
    expect(genPack.is_default).toBeFalsy();

    const baseline = await DeckService.buildDeck({ gameId: 'madlad' });

    // eslint-disable-next-line camelcase
    const [pendingId] = await db.db()('cards').insert({
      game_id: 'madlad',
      kind: 'answer',
      text: 'A pending generated answer',
      blanks: 1,
      maturity_rating: 2,
      pack_id: genPack.id,
      status: 'pending',
      source: 'generated',
    });
    await db.db()('cards').insert({
      game_id: 'madlad',
      kind: 'answer',
      text: 'A denied generated answer',
      blanks: 1,
      maturity_rating: 2,
      pack_id: genPack.id,
      status: 'denied',
      source: 'generated',
    });

    // Default path (empty packIds) — neither pending nor denied leaks in, and the
    // full seeded core deck is intact.
    const quarantined = await DeckService.buildDeck({ gameId: 'madlad' });
    expect(quarantined.answers).toHaveLength(baseline.answers.length);
    expect(quarantined.prompts).toHaveLength(BLACK_CARDS.length);
    expect(quarantined.answers.some((c) => c.id === pendingId)).toBe(false);

    // Approve the pending card → it publishes via the default path.
    await db.db()('cards').where({ id: pendingId })
      .update({ status: 'approved', reviewed_at: db.db().fn.now(), reviewed_by: 'admin' });

    const published = await DeckService.buildDeck({ gameId: 'madlad' });
    expect(published.answers).toHaveLength(baseline.answers.length + 1);
    expect(published.answers.some((c) => c.id === pendingId)).toBe(true);

    // Clean up so later tests see the untouched seeded deck.
    await db.db()('cards').where({ pack_id: genPack.id }).del();
  });

  // F4 — retired cards are excluded from the deck, and unretiring restores them.
  test('excludes retired cards from the deck', async () => {
    const before = await DeckService.buildDeck({ gameId: 'madlad' });
    const answerId = before.answers[0].id;

    await CardRepository.retire(answerId);
    const afterRetire = await DeckService.buildDeck({ gameId: 'madlad' });
    expect(afterRetire.answers).toHaveLength(before.answers.length - 1);
    expect(afterRetire.answers.some((c) => c.id === answerId)).toBe(false);

    await CardRepository.unretire(answerId);
    const afterUnretire = await DeckService.buildDeck({ gameId: 'madlad' });
    expect(afterUnretire.answers).toHaveLength(before.answers.length);
  });
});
