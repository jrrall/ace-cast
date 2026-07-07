/* eslint-disable camelcase */
// F2 — CardEventsRepository appends one row per play and aggregates by humor.
const { useTestDb, cleanupTestDb } = require('./helpers/testDb');

describe('CardEventsRepository', () => {
  let db;
  let CardEventsRepository;

  beforeAll(async () => {
    db = useTestDb('card-events');
    await db.migrateToLatest();
    CardEventsRepository = require('../src/content/CardEventsRepository');

    // card_events.card_id is a FK into cards, so seed the cards it references.
    const [packId] = await db.db()('packs').insert({
      slug: 'test-pack', name: 'Test Pack', game_id: 'madlad',
    });
    await db.db()('cards').insert(
      [10, 20, 30].map((id) => ({
        id, game_id: 'madlad', kind: 'answer', text: `Card ${id}`, pack_id: packId,
      })),
    );

    // Humor: card10 → dark, card20 → dark + wholesome, card30 → wholesome.
    const [darkId] = await db.db()('humor_tags').insert({ slug: 'dark', label: 'Dark' });
    const [wholesomeId] = await db.db()('humor_tags').insert({ slug: 'wholesome', label: 'Wholesome' });
    await db.db()('card_humor_tags').insert([
      { card_id: 10, humor_tag_id: darkId },
      { card_id: 20, humor_tag_id: darkId },
      { card_id: 20, humor_tag_id: wholesomeId },
      { card_id: 30, humor_tag_id: wholesomeId },
    ]);
  });

  afterAll(async () => {
    await db.close();
    cleanupTestDb();
  });

  test('appends one event per played card with the winner flagged', async () => {
    await CardEventsRepository.recordRoundEvents({
      gameId: 'madlad',
      roomCode: 'ABCD',
      blackCardId: null,
      submissions: [
        { cardId: 10, playerId: 'v1', won: false },
        { cardId: 20, playerId: 'v2', won: true },
      ],
    });

    const rows = await db.db()('card_events').orderBy('card_id');
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.card_id === 20)).toMatchObject({
      room_code: 'ABCD', visitor_id: 'v2', game_id: 'madlad',
    });
    expect(Boolean(rows.find((r) => r.card_id === 20).won)).toBe(true);
    expect(Boolean(rows.find((r) => r.card_id === 10).won)).toBe(false);
  });

  test('skips submissions with no card id', async () => {
    await CardEventsRepository.recordRoundEvents({
      gameId: 'madlad',
      submissions: [{ cardId: null, playerId: 'v1' }, { cardId: 30, playerId: 'v3', won: false }],
    });

    const total = await db.db()('card_events').count({ n: '*' }).first();
    expect(Number(total.n)).toBe(3); // 2 from before + card 30 (null skipped)
  });

  test('does nothing when there are no valid submissions', async () => {
    await expect(
      CardEventsRepository.recordRoundEvents({ gameId: 'madlad', submissions: [] }),
    ).resolves.toBeUndefined();
  });

  test('humorBreakdown aggregates plays and wins per humor tag', async () => {
    // Events so far: card10 (dark, loss), card20 (dark+wholesome, win), card30 (wholesome, loss).
    const breakdown = await CardEventsRepository.humorBreakdown();
    const bySlug = Object.fromEntries(breakdown.map((r) => [r.slug, r]));

    // A card with two humors counts toward each.
    expect(bySlug.dark).toMatchObject({ label: 'Dark', plays: 2, wins: 1 });
    expect(bySlug.wholesome).toMatchObject({ label: 'Wholesome', plays: 2, wins: 1 });
  });
});
