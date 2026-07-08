/* eslint-disable camelcase */
/**
 * E2.2 — seed the built-in MadLad deck as the default free pack.
 *
 * Idempotent AND additive: the pack is upserted by slug, and cards are synced by
 * text — any card in `madladCards.js` not already in the pack is inserted, while
 * re-runs stay a no-op. This lets the deck grow over time: add cards to
 * `madladCards.js` and the next boot loads the new ones on both fresh and
 * already-seeded databases. `madladCards.js` remains the source of record.
 */
const { BLACK_CARDS, WHITE_CARDS } = require('../../game/data/madladCards');

const PACK = {
  slug: 'madlad-core',
  name: 'MadLad Core',
  description: 'The original MadLad party deck. Skews mature.',
  game_id: 'madlad',
  price_cents: 0,
  is_default: true,
  maturity_max: 2,
  published: true,
};

// The built-in deck's tone; matches the note in madladCards.js.
const MATURITY = 2;

exports.seed = async (knex) => {
  // Upsert the default pack by slug.
  let pack = await knex('packs').where({ slug: PACK.slug })
    .first();
  if (!pack) {
    const [id] = await knex('packs').insert(PACK);
    pack = { id };
  }

  // Sync by text: insert only the cards that aren't already in the pack. Dedupes
  // both against the DB and within this batch, so re-runs (and partial decks)
  // converge without duplicates.
  const existingRows = await knex('cards')
    .where({ pack_id: pack.id })
    .select('text');
  const seen = new Set(existingRows.map((r) => r.text));

  // Keep the column set identical across all rows: batchInsert unifies columns
  // from the batch, and a missing key inserts an explicit NULL (overriding the
  // column default), which would violate cards.blanks NOT NULL.
  const rows = [];
  const add = (kind) => (text) => {
    if (seen.has(text)) return;
    seen.add(text);
    rows.push({
      game_id: 'madlad', kind, text, blanks: 1, maturity_rating: MATURITY, pack_id: pack.id,
    });
  };
  BLACK_CARDS.forEach(add('prompt'));
  WHITE_CARDS.forEach(add('answer'));

  if (rows.length === 0) return;
  await knex.batchInsert('cards', rows, 100);
};
