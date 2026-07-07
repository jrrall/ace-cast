/* eslint-disable camelcase */
/**
 * F2 — humor vocabulary + a starter backfill for the built-in MadLad deck.
 *
 * Runs after `madlad_core` (filename sorts after it) so the cards exist. Two
 * idempotent steps:
 *   1. Upsert the humor vocabulary by slug.
 *   2. If no card→humor links exist yet, tag every MadLad card with a keyword
 *      heuristic (a card can get several tags; unmatched cards fall back to the
 *      deck's dominant tone, `absurdist`).
 *
 * The heuristic is deliberately transparent and easy to refine — it is *starter*
 * data so humor metrics aren't empty on day one, not a hand-curated taxonomy.
 * Edit `HUMOR_TAGS` / `KEYWORDS` and re-run against a fresh DB to reclassify.
 */

// The controlled vocabulary. Add/rename here; slugs are the stable key.
const HUMOR_TAGS = [
  { slug: 'absurdist', label: 'Absurdist' },
  { slug: 'dark', label: 'Dark' },
  { slug: 'raunchy', label: 'Raunchy' },
  { slug: 'wholesome', label: 'Wholesome' },
  { slug: 'cringe', label: 'Cringe' },
  { slug: 'topical', label: 'Topical' },
  { slug: 'burnout', label: 'Millennial burnout' },
];

// Lowercased substring → tag. First match(es) win; a card can match several.
const KEYWORDS = {
  absurdist: [
    'raccoon', 'goose', 'goblin', 'gremlin', 'owl', 'pigeon', 'roomba', 'llama',
    'squirrel', 'demon', 'clown', 'haunted', 'cursed', 'ghost', 'zoo', 'gods',
    'volcano', 'bagpipe', 'trench coat', 'knife', 'spiders', 'lamp', 'dollhouse',
  ],
  dark: [
    'dread', 'void', 'dying', 'die', 'alone', 'death', 'eulogy', 'will ', 'grave',
    'trauma', 'cry', 'crying', 'apocalypse', 'regret', 'existential', 'sleep paralysis',
    'funeral', 'grief', 'cry for help', 'therapist', 'therapy', 'untreated',
  ],
  raunchy: [
    'safe word', 'third base', 'tinder', 'situationship', 'pregnan', 'piercing',
    'unprotected', 'honda civic', 'mood', 'hot.',
  ],
  wholesome: [
    'nap', 'avocado', 'breadstick', 'tiny shoes', 'wholesome', 'cat video', 'potluck',
    'puppy', 'perfect chicken nugget', 'pancake',
  ],
  cringe: [
    'linkedin', 'personal brand', 'ted talk', 'vision board', 'self-care', 'manifest',
    'pitch deck', 'reply-all', 'group chat', 'slack', 'hr ', 'motivational', 'small talk',
    'trust fall', 'trust exercise', 'karaoke', 'street performer',
  ],
  topical: [
    'tiktok', 'algorithm', 'wifi', 'gig economy', 'doomscroll', 'hoa', 'startup',
    'wellness', 'reality tv', 'marvel', 'app', 'podcast', 'facetime', 'terms and conditions',
  ],
  burnout: [
    'student debt', 'rent', 'credit score', 'meeting', 'quiet-quit', 'salad', 'girl-math',
    'girl-mathing', 'monetiz', 'burnout', 'copay', 'gig economy', 'debt', 'overtime',
    'unpaid', 'internship', 'landlord', 'invoice', 'brand',
  ],
};

function tagsFor(text) {
  const hay = String(text).toLowerCase();
  const matched = HUMOR_TAGS
    .map((t) => t.slug)
    .filter((slug) => (KEYWORDS[slug] || []).some((kw) => hay.includes(kw)));
  return matched.length > 0 ? matched : ['absurdist'];
}

exports.seed = async (knex) => {
  // 1. Upsert the vocabulary by slug: insert any missing tags in one batch,
  //    then read the full set back to map slug → id.
  const existingSlugs = new Set((await knex('humor_tags').select('slug')).map((t) => t.slug));
  const toInsert = HUMOR_TAGS.filter((t) => !existingSlugs.has(t.slug));
  if (toInsert.length > 0) await knex('humor_tags').insert(toInsert);

  const bySlug = new Map((await knex('humor_tags').select('slug', 'id')).map((t) => [t.slug, t.id]));

  // 2. Backfill card→humor links only when there are none (keeps re-runs a no-op).
  const linked = await knex('card_humor_tags').count({ count: '*' })
    .first();
  if (Number(linked.count) > 0) return;

  const cards = await knex('cards').where({ game_id: 'madlad' })
    .select('id', 'text');
  const rows = cards.flatMap((card) => tagsFor(card.text)
    .map((slug) => bySlug.get(slug))
    .filter((id) => id != null)
    .map((humor_tag_id) => ({ card_id: card.id, humor_tag_id })));

  if (rows.length > 0) await knex.batchInsert('card_humor_tags', rows, 200);
};
