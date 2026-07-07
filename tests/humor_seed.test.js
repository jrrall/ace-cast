// F2 — the madlad_humor seed loads the humor vocabulary and tags the deck.
const { useTestDb, cleanupTestDb } = require('./helpers/testDb');

describe('madlad_humor seed', () => {
  let db;
  let knex;

  beforeAll(async () => {
    db = useTestDb('humor-seed');
    await db.migrateToLatest();
    await db.seedRun(); // runs madlad_core (cards) then madlad_humor (tags)
    knex = db.db();
  });

  afterAll(async () => {
    await db.close();
    cleanupTestDb();
  });

  test('seeds the humor vocabulary', async () => {
    const slugs = (await knex('humor_tags').select('slug')).map((t) => t.slug);
    expect(slugs).toEqual(expect.arrayContaining(
      ['absurdist', 'dark', 'raunchy', 'wholesome', 'cringe', 'topical', 'burnout'],
    ));
  });

  test('every madlad card gets at least one humor tag', async () => {
    const cards = await knex('cards').where({ game_id: 'madlad' }).select('id');
    const tagged = new Set((await knex('card_humor_tags').select('card_id')).map((l) => l.card_id));
    expect(cards.length).toBeGreaterThan(0);
    expect(cards.every((c) => tagged.has(c.id))).toBe(true);
  });

  test('is idempotent — re-running does not duplicate links', async () => {
    const before = Number((await knex('card_humor_tags').count({ c: '*' }).first()).c);
    await db.seedRun();
    const after = Number((await knex('card_humor_tags').count({ c: '*' }).first()).c);
    expect(after).toBe(before);
  });
});
