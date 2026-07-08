// F2 — card flag recording + dedupe.
const { useTestDb, cleanupTestDb } = require('./helpers/testDb');

describe('CardFlagRepository', () => {
  let db;
  let knex;
  let CardFlagRepository;
  let cardId;

  beforeAll(async () => {
    db = useTestDb('flags');
    await db.migrateToLatest();
    knex = db.db();
    CardFlagRepository = require('../src/content/CardFlagRepository');
    // A pack + card to satisfy the FK.
    const [packId] = await knex('packs').insert({ slug: 'p', name: 'P', game_id: 'madlad' });
    [cardId] = await knex('cards').insert({
      game_id: 'madlad', kind: 'answer', text: 'x', pack_id: packId,
    });
  });

  afterAll(async () => {
    await db.close();
    cleanupTestDb();
  });

  const count = async () => Number((await knex('card_flags').count({ c: '*' }).first()).c);

  test('records a flag', async () => {
    await CardFlagRepository.recordFlag({ cardId, reason: 'not_funny', flaggerId: 'u1' });
    expect(await count()).toBe(1);
  });

  test('dedupes the same card + flagger + reason', async () => {
    await CardFlagRepository.recordFlag({ cardId, reason: 'not_funny', flaggerId: 'u1' });
    expect(await count()).toBe(1);
  });

  test('a different reason inserts again', async () => {
    await CardFlagRepository.recordFlag({ cardId, reason: 'broken', flaggerId: 'u1' });
    expect(await count()).toBe(2);
  });

  test('a different flagger inserts again', async () => {
    await CardFlagRepository.recordFlag({ cardId, reason: 'not_funny', flaggerId: 'u2' });
    expect(await count()).toBe(3);
  });

  test('ignores invalid input (bad id / reason / flagger)', async () => {
    await CardFlagRepository.recordFlag({ cardId: 0, reason: 'broken', flaggerId: 'u3' });
    await CardFlagRepository.recordFlag({ cardId, reason: 'bogus', flaggerId: 'u3' });
    await CardFlagRepository.recordFlag({ cardId, reason: 'broken', flaggerId: '' });
    expect(await count()).toBe(3);
  });

  test('flagCounts aggregates per (card, reason)', async () => {
    // State from prior tests: u1/not_funny, u1/broken, u2/not_funny.
    const counts = await CardFlagRepository.flagCounts();
    const byKey = Object.fromEntries(counts.map((c) => [`${c.cardId}:${c.reason}`, c.count]));
    expect(byKey[`${cardId}:not_funny`]).toBe(2); // u1 + u2
    expect(byKey[`${cardId}:broken`]).toBe(1); // u1
  });
});
