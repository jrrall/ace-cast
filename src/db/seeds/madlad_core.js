/* eslint-disable camelcase */
/**
 * E2.2 — seed the built-in MadLad deck as the default free pack.
 *
 * Idempotent: the pack is upserted by slug and cards are only inserted when the
 * pack has none, so `seed:run` (and boot-time seeding later) is safe to repeat.
 * `madladCards.js` remains the source of record; this just loads it into the DB.
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

  // Only seed cards if this pack has none — keeps re-runs a no-op.
  const existing = await knex('cards')
    .where({ pack_id: pack.id })
    .count({ count: '*' })
    .first();
  if (Number(existing.count) > 0) return;

  // Keep the column set identical across all rows: batchInsert unifies columns
  // from the batch, and a missing key inserts an explicit NULL (overriding the
  // column default), which would violate cards.blanks NOT NULL.
  const rows = [
    ...BLACK_CARDS.map((text) => ({
      game_id: 'madlad', kind: 'prompt', text, blanks: 1, maturity_rating: MATURITY, pack_id: pack.id,
    })),
    ...WHITE_CARDS.map((text) => ({
      game_id: 'madlad', kind: 'answer', text, blanks: 1, maturity_rating: MATURITY, pack_id: pack.id,
    })),
  ];
  await knex.batchInsert('cards', rows, 100);
};
