// E2.2 — the madlad-core seed loads the built-in deck and is idempotent.
const { BLACK_CARDS, WHITE_CARDS } = require('../src/game/data/madladCards');
const { useTestDb, cleanupTestDb } = require('./helpers/testDb');

describe('E2.2 madlad-core seed', () => {
  let db;
  let knex;

  beforeAll(async () => {
    db = useTestDb('seed');
    await db.migrateToLatest();
    knex = db.db();
  });

  afterAll(async () => {
    await db.close();
    cleanupTestDb();
  });

  const countCards = async (packId, kind) => {
    const row = await knex('cards').where({ pack_id: packId, kind }).count({ c: '*' }).first();
    return Number(row.c);
  };

  test('seeds the default pack with all cards', async () => {
    await db.seedRun();
    const pack = await knex('packs').where({ slug: 'madlad-core' }).first();
    expect(pack).toBeTruthy();
    expect(Boolean(pack.is_default)).toBe(true);
    expect(pack.price_cents).toBe(0);
    expect(pack.game_id).toBe('madlad');
    expect(await countCards(pack.id, 'prompt')).toBe(BLACK_CARDS.length);
    expect(await countCards(pack.id, 'answer')).toBe(WHITE_CARDS.length);
  });

  test('is idempotent — re-running does not duplicate', async () => {
    await db.seedRun();
    const packs = await knex('packs').where({ slug: 'madlad-core' });
    expect(packs).toHaveLength(1);
    const total = await knex('cards').where({ pack_id: packs[0].id }).count({ c: '*' }).first();
    expect(Number(total.c)).toBe(BLACK_CARDS.length + WHITE_CARDS.length);
  });

  test('is additive — a re-run backfills cards missing from the pack', async () => {
    await db.seedRun();
    const pack = await knex('packs').where({ slug: 'madlad-core' }).first();
    const total = async () => Number(
      (await knex('cards').where({ pack_id: pack.id }).count({ c: '*' }).first()).c,
    );
    const before = await total();

    // Simulate an older deployed deck that predates some cards.
    const victims = await knex('cards').where({ pack_id: pack.id })
      .orderBy('id', 'desc').limit(5).pluck('id');
    await knex('cards').whereIn('id', victims).del();
    expect(await total()).toBe(before - 5);

    await db.seedRun(); // syncs by text — the 5 missing cards come back
    expect(await total()).toBe(before);
  });

  test('every seeded prompt has a blank and blanks=1', async () => {
    const prompts = await knex('cards').where({ kind: 'prompt' }).select('text', 'blanks');
    expect(prompts.every((p) => /_{2,}/.test(p.text))).toBe(true);
    expect(prompts.every((p) => p.blanks === 1)).toBe(true);
  });
});
