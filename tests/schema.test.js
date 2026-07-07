// E2.1 — verify the packs/cards/tags schema migrates up cleanly and rolls back,
// against in-memory SQLite. (db required inside beforeAll per the resetModules gotcha.)
const { useTestDb, cleanupTestDb } = require('./helpers/testDb');

describe('E2.1 schema migrations', () => {
  let db;
  let knex;

  beforeAll(async () => {
    db = useTestDb('schema');
    await db.migrateToLatest();
    knex = db.db();
  });

  afterAll(async () => {
    await db.close();
    cleanupTestDb();
  });

  test('creates all four tables', async () => {
    for (const table of ['packs', 'cards', 'tags', 'pack_tags']) {
      // eslint-disable-next-line no-await-in-loop
      expect(await knex.schema.hasTable(table)).toBe(true);
    }
  });

  test('packs has the expected columns', async () => {
    for (const col of ['slug', 'name', 'game_id', 'price_cents', 'is_default',
      'maturity_max', 'published', 'cover_asset_id', 'created_at']) {
      // eslint-disable-next-line no-await-in-loop
      expect(await knex.schema.hasColumn('packs', col)).toBe(true);
    }
  });

  test('cards has the expected columns incl. nullable sprite_asset_id', async () => {
    for (const col of ['game_id', 'kind', 'text', 'blanks', 'pack_id',
      'maturity_rating', 'sprite_asset_id', 'created_at']) {
      // eslint-disable-next-line no-await-in-loop
      expect(await knex.schema.hasColumn('cards', col)).toBe(true);
    }
  });

  test('a card can be inserted against a pack and read back', async () => {
    const [packId] = await knex('packs').insert({
      slug: 'test-pack', name: 'Test Pack', game_id: 'madlad',
    });
    await knex('cards').insert({
      game_id: 'madlad', kind: 'answer', text: 'A test card.', pack_id: packId,
    });
    const rows = await knex('cards').where({ pack_id: packId });
    expect(rows).toHaveLength(1);
    expect(rows[0].text).toBe('A test card.');
    expect(rows[0].blanks).toBe(1); // default
  });

  test('rejects an invalid kind (enum check)', async () => {
    const [packId] = await knex('packs').insert({
      slug: 'enum-pack', name: 'Enum Pack', game_id: 'madlad',
    });
    await expect(
      knex('cards').insert({
        game_id: 'madlad', kind: 'wildcard', text: 'nope', pack_id: packId,
      }),
    ).rejects.toThrow();
  });

  test('down migrations drop the tables, up restores them', async () => {
    await db.migrateRollback(); // undo 0002_tags
    await db.migrateRollback(); // undo 0001_packs_cards
    expect(await knex.schema.hasTable('packs')).toBe(false);
    expect(await knex.schema.hasTable('tags')).toBe(false);
    await db.migrateToLatest();
    expect(await knex.schema.hasTable('packs')).toBe(true);
    expect(await knex.schema.hasTable('pack_tags')).toBe(true);
  });
});
