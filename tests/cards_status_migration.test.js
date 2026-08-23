/* eslint-disable camelcase */
/**
 * F1 (Card Forge) — the cards `status` migration (S1 mitigation).
 *
 * Two guarantees:
 *   1. The `up` backfill flips pre-existing rows to `approved` (so the new
 *      `status='approved'` deck filter doesn't empty every deck on deploy).
 *   2. `down`→`up` is reversible on SQLite: dropping/re-adding the columns
 *      rebuilds the `cards` table, and all four FK children of `cards`
 *      (`card_stats`, `card_flags`, `card_humor_tags`, `card_events`) retain
 *      their rows across the rebuild.
 *
 * We drive knex's migrator directly to isolate the single `cards_status`
 * migration. The migration is addressed BY NAME rather than as "the newest one"
 * — a bare `migrate.down()` targets whatever happens to be last, so the moment
 * any later migration lands this file would silently start testing that one
 * instead and the backfill assertion would fail for the wrong reason.
 */
const CARDS_STATUS = '20260724120001_cards_status.js';
const { useTestDb, cleanupTestDb } = require('./helpers/testDb');

describe('cards status migration', () => {
  let db;
  let knex;

  beforeAll(async () => {
    db = useTestDb('cards-status-migration');
    await db.migrateToLatest();
    knex = db.db();
  });

  afterAll(async () => {
    await db.close();
    cleanupTestDb();
  });

  // Seed a pack, a card, and one row in every FK child of `cards`, with the
  // status columns rolled back first so the card is a genuine "pre-existing" row
  // (inserted with no status). Returns the child-row counts to compare later.
  async function seedPreMigrationData() {
    await knex.migrate.down({ name: CARDS_STATUS }); // columns gone

    const [packId] = await knex('packs')
      .insert({ slug: 'pre-pack', name: 'Pre Pack', game_id: 'madlad' });
    const [cardId] = await knex('cards').insert({
      game_id: 'madlad', kind: 'answer', text: 'Pre-existing card', pack_id: packId,
    });
    const [humorTagId] = await knex('humor_tags').insert({ slug: 'pre-tag', label: 'Pre Tag' });

    await knex('card_stats').insert({ card_id: cardId, plays: 5, wins: 2 });
    await knex('card_flags').insert({ card_id: cardId, reason: 'broken', flagger_id: 'u1' });
    await knex('card_humor_tags').insert({ card_id: cardId, humor_tag_id: humorTagId });
    await knex('card_events').insert({ card_id: cardId, game_id: 'madlad', won: true });

    return { cardId };
  }

  async function childCounts() {
    const tables = ['card_stats', 'card_flags', 'card_humor_tags', 'card_events'];
    const entries = await Promise.all(tables.map(async (t) => {
      const row = await knex(t).count({ n: '*' }).first();
      return [t, Number(row.n)];
    }));
    return Object.fromEntries(entries);
  }

  test('up backfills pre-existing rows to status=approved, source=manual', async () => {
    const { cardId } = await seedPreMigrationData();

    await knex.migrate.up({ name: CARDS_STATUS }); // re-add columns + backfill

    const card = await knex('cards').where({ id: cardId }).first();
    expect(card.status).toBe('approved');
    expect(card.source).toBe('manual');

    // No row is left in the fail-closed default state.
    const stuck = await knex('cards').whereNot('status', 'approved').count({ n: '*' })
      .first();
    expect(Number(stuck.n)).toBe(0);
  });

  test('down→up round-trip preserves all four FK-child tables', async () => {
    const before = await childCounts();
    expect(before).toEqual({
      card_stats: 1, card_flags: 1, card_humor_tags: 1, card_events: 1,
    });

    await knex.migrate.down({ name: CARDS_STATUS }); // drop columns (table rebuild)
    const afterDown = await childCounts();
    expect(afterDown).toEqual(before);

    await knex.migrate.up({ name: CARDS_STATUS }); // re-add (rebuild + backfill)
    const afterUp = await childCounts();
    expect(afterUp).toEqual(before);
  });
});
