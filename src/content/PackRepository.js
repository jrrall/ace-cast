/* eslint-disable camelcase */
/**
 * Read access to `packs`. Thin wrappers over knex so callers (DeckService, the
 * future store) don't hand-write queries.
 */
const { db } = require('../db');

/** @returns {Promise<object|undefined>} the pack with this slug, if any. */
function getBySlug(slug) {
  return db()('packs').where({ slug })
    .first();
}

/** @returns {Promise<object|undefined>} the default pack for a game, if any. */
function getDefault(gameId) {
  return db()('packs').where({ game_id: gameId, is_default: true })
    .first();
}

/**
 * List packs for a game.
 * @param {string} gameId
 * @param {{ publishedOnly?: boolean }} [options]
 * @returns {Promise<object[]>}
 */
function listByGame(gameId, { publishedOnly = true } = {}) {
  const query = db()('packs').where({ game_id: gameId });
  if (publishedOnly) query.andWhere({ published: true });
  return query.orderBy('id');
}

async function ensureRunPack(slug, base) {
  await db()('packs').insert({
    slug,
    name: slug,
    game_id: base.game_id,
    maturity_max: 3,
    published: true,
    is_default: false,
    generated_from_pack_id: base.id,
  })
    .onConflict('slug')
    .ignore();
  const pack = await getBySlug(slug);
  return pack && pack.generated_from_pack_id === base.id ? pack : null;
}

function listRunPacks(baseId) {
  return db()('packs').where({ generated_from_pack_id: baseId, published: true });
}

module.exports = {
  getBySlug, getDefault, listByGame, ensureRunPack, listRunPacks,
};
