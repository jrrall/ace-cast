/* eslint-disable camelcase */
// F3/F4 — FeedbackRepository: win-rate + min-plays floor + rollups + retirement
// suggestions, seeded on a temp-file SQLite DB (mirrors card_flags.test.js).
const { useTestDb, cleanupTestDb } = require('./helpers/testDb');

describe('FeedbackRepository', () => {
  let db;
  let knex;
  let FeedbackRepository;
  let CardRepository;
  let packId;
  // ids: 1 = plenty of plays + high win-rate (top winner)
  //      2 = plenty of plays + low win-rate + flagged a lot (dead weight + most-flagged + suggested)
  //      3 = below the min-plays floor (insufficient data)
  //      4 = never played, never flagged
  let ids;

  beforeAll(async () => {
    db = useTestDb('feedback');
    await db.migrateToLatest();
    knex = db.db();
    FeedbackRepository = require('../src/content/FeedbackRepository');
    CardRepository = require('../src/content/CardRepository');

    [packId] = await knex('packs').insert({ slug: 'test-pack', name: 'Test Pack', game_id: 'madlad' });

    const cardIds = await knex('cards').insert(
      [
        { game_id: 'madlad', kind: 'answer', text: 'Winner', pack_id: packId },
        { game_id: 'madlad', kind: 'answer', text: 'Loser', pack_id: packId },
        { game_id: 'madlad', kind: 'answer', text: 'Too few plays', pack_id: packId },
        { game_id: 'madlad', kind: 'answer', text: 'Untouched', pack_id: packId },
      ],
      'id',
    );
    // better-sqlite3 returns [{id}] for RETURNING-style insert with column list;
    // normalize to bare ids either way.
    ids = cardIds.map((r) => (typeof r === 'object' ? r.id : r));

    await knex('card_stats').insert([
      { card_id: ids[0], plays: 20, wins: 15 }, // 75% win-rate
      { card_id: ids[1], plays: 20, wins: 2 }, // 10% win-rate
      { card_id: ids[2], plays: 3, wins: 3 }, // 100% but below the min-plays floor
      // ids[3]: no card_stats row at all — zero plays.
    ]);

    await knex('card_flags').insert([
      { card_id: ids[1], reason: 'not_funny', flagger_id: 'u1' },
      { card_id: ids[1], reason: 'not_funny', flagger_id: 'u2' },
      { card_id: ids[1], reason: 'broken', flagger_id: 'u1' },
    ]);
  });

  afterAll(async () => {
    await db.close();
    cleanupTestDb();
  });

  test('cardStats computes win-rate and applies the min-plays floor', async () => {
    const stats = await FeedbackRepository.cardStats({ minPlays: 10 });
    expect(stats).toHaveLength(4);

    const byId = Object.fromEntries(stats.map((c) => [c.id, c]));
    expect(byId[ids[0]]).toMatchObject({ plays: 20, wins: 15, winRate: 0.75, insufficientData: false });
    expect(byId[ids[1]]).toMatchObject({ plays: 20, wins: 2, winRate: 0.1, insufficientData: false });
    // Below the floor: not ranked, flagged as insufficient data instead.
    expect(byId[ids[2]]).toMatchObject({ plays: 3, wins: 3, winRate: null, insufficientData: true });
    // Never played: zero counts, also below the floor.
    expect(byId[ids[3]]).toMatchObject({ plays: 0, wins: 0, winRate: null, insufficientData: true });
  });

  test('cardStats joins flag counts by reason', async () => {
    const stats = await FeedbackRepository.cardStats({ minPlays: 10 });
    const loser = stats.find((c) => c.id === ids[1]);
    expect(loser.flags).toEqual({ not_funny: 2, broken: 1 });
    expect(loser.totalFlags).toBe(3);

    const winner = stats.find((c) => c.id === ids[0]);
    expect(winner.flags).toEqual({ not_funny: 0, broken: 0 });
  });

  test('topWinners ranks by win-rate, excluding insufficient-data cards', async () => {
    const stats = await FeedbackRepository.cardStats({ minPlays: 10 });
    const winners = FeedbackRepository.topWinners(stats);
    expect(winners[0].id).toBe(ids[0]);
    expect(winners.some((c) => c.id === ids[2])).toBe(false); // insufficient data
  });

  test('deadWeight ranks by lowest win-rate among cards with enough plays', async () => {
    const stats = await FeedbackRepository.cardStats({ minPlays: 10 });
    const dead = FeedbackRepository.deadWeight(stats);
    expect(dead[0].id).toBe(ids[1]);
  });

  test('mostFlagged ranks by total flags, ignoring plays', async () => {
    const stats = await FeedbackRepository.cardStats({ minPlays: 10 });
    const flagged = FeedbackRepository.mostFlagged(stats);
    expect(flagged).toHaveLength(1);
    expect(flagged[0].id).toBe(ids[1]);
  });

  test('suggestedRetirements flags cards below win-rate or above flag-rate, excludes already-retired', async () => {
    const stats = await FeedbackRepository.cardStats({ minPlays: 10 });
    const suggested = FeedbackRepository.suggestedRetirements(stats, {
      minPlays: 10, lowWinRate: 0.15, highFlagRate: 0.1,
    });
    expect(suggested.map((c) => c.id)).toEqual([ids[1]]); // 10% win-rate < 15%, also 15% flag-rate > 10%

    await CardRepository.retire(ids[1]);
    const statsAfterRetire = await FeedbackRepository.cardStats({ minPlays: 10 });
    const suggestedAfterRetire = FeedbackRepository.suggestedRetirements(statsAfterRetire, {
      minPlays: 10, lowWinRate: 0.15, highFlagRate: 0.1,
    });
    expect(suggestedAfterRetire).toHaveLength(0);

    await CardRepository.unretire(ids[1]);
  });

  test('buildDashboard composes cardStats + rollups + suggestions from thresholds', async () => {
    const dashboard = await FeedbackRepository.buildDashboard({
      minPlays: 10,
      thresholds: { minPlays: 10, lowWinRateThreshold: 0.15, highFlagRateThreshold: 0.1 },
    });
    expect(dashboard.cards).toHaveLength(4);
    expect(dashboard.topWinners[0].id).toBe(ids[0]);
    expect(dashboard.deadWeight[0].id).toBe(ids[1]);
    expect(dashboard.mostFlagged[0].id).toBe(ids[1]);
    expect(dashboard.suggestedRetirements.map((c) => c.id)).toEqual([ids[1]]);
  });
});
