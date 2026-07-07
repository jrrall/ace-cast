/* eslint-disable camelcase */
// F1 — CardStatsRepository records per-card play/win counters (upsert-increment).
const { useTestDb, cleanupTestDb } = require('./helpers/testDb');

describe('CardStatsRepository', () => {
  let db;
  let CardStatsRepository;

  beforeAll(async () => {
    db = useTestDb('card-stats');
    await db.migrateToLatest();
    CardStatsRepository = require('../src/content/CardStatsRepository');

    // card_stats.card_id is a FK into cards, so seed the cards it references.
    const [packId] = await db.db()('packs').insert({
      slug: 'test-pack', name: 'Test Pack', game_id: 'madlad',
    });
    await db.db()('cards').insert(
      [10, 20, 30, 40].map((id) => ({
        id, game_id: 'madlad', kind: 'answer', text: `Card ${id}`, pack_id: packId,
      })),
    );
  });

  afterAll(async () => {
    await db.close();
    cleanupTestDb();
  });

  const rows = () => db.db()('card_stats').orderBy('card_id');

  test('records plays for every card and a win for the winner', async () => {
    await CardStatsRepository.recordRoundOutcome({
      playedCardIds: [10, 20, 30],
      winningCardId: 20,
    });

    const stats = await rows();
    expect(stats).toHaveLength(3);
    expect(stats.find((r) => r.card_id === 10)).toMatchObject({ plays: 1, wins: 0 });
    expect(stats.find((r) => r.card_id === 20)).toMatchObject({ plays: 1, wins: 1 });
    expect(stats.find((r) => r.card_id === 30)).toMatchObject({ plays: 1, wins: 0 });
  });

  test('re-recording increments existing counters (idempotent upsert)', async () => {
    await CardStatsRepository.recordRoundOutcome({
      playedCardIds: [10, 20, 30],
      winningCardId: 10,
    });

    const stats = await rows();
    expect(stats).toHaveLength(3);
    expect(stats.find((r) => r.card_id === 10)).toMatchObject({ plays: 2, wins: 1 });
    expect(stats.find((r) => r.card_id === 20)).toMatchObject({ plays: 2, wins: 1 });
    expect(stats.find((r) => r.card_id === 30)).toMatchObject({ plays: 2, wins: 0 });
  });

  test('ignores null/undefined card ids', async () => {
    await CardStatsRepository.recordRoundOutcome({
      playedCardIds: [null, undefined, 40],
      winningCardId: 40,
    });

    const row40 = await db.db()('card_stats').where({ card_id: 40 })
      .first();
    expect(row40).toMatchObject({ plays: 1, wins: 1 });

    const total = await db.db()('card_stats').count({ n: '*' })
      .first();
    expect(Number(total.n)).toBe(4); // 10, 20, 30, 40 — no null row created
  });

  test('does nothing when there are no valid card ids', async () => {
    await expect(
      CardStatsRepository.recordRoundOutcome({ playedCardIds: [null], winningCardId: null }),
    ).resolves.toBeUndefined();
  });
});
