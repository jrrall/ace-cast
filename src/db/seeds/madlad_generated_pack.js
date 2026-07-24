/* eslint-disable camelcase */
/**
 * F1 (Card Forge) — the dedicated pack that holds LLM-generated cards.
 *
 * Idempotent upsert by slug of an empty `madlad-generated` pack. It is NOT the
 * default pack (`is_default=false`) and starts with no cards — Card Forge POSTs
 * `pending` cards into it via the content API, and a human approves them.
 * DeckService.buildDeck unions this pack's *approved* cards into the default
 * deck path so approval genuinely publishes, while keeping generated content
 * separable (the whole AI batch can be disabled or purged by pack).
 *
 * `maturity_max: 2` matches `madlad-core`'s tone ceiling.
 */

const PACK = {
  slug: 'madlad-generated',
  name: 'MadLad Generated',
  description: 'AI-generated MadLad cards, human-approved before they play.',
  game_id: 'madlad',
  price_cents: 0,
  is_default: false,
  maturity_max: 2,
  published: true,
};

exports.seed = async (knex) => {
  const existing = await knex('packs').where({ slug: PACK.slug })
    .first();
  if (!existing) {
    await knex('packs').insert(PACK);
  }
};
