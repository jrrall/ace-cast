/* eslint-disable camelcase */
/**
 * Read access to `cards`.
 */
const { db } = require('../db');

/**
 * Load cards for building a deck: a game's cards within the selected packs,
 * filtered to a maturity ceiling. Retired cards (F4) are excluded — retirement
 * is a soft flag, not a delete, so their history stays intact elsewhere.
 * @param {{ gameId: string, packIds: number[], maturityMax?: number }} params
 * @returns {Promise<Array<{id:number, kind:string, text:string, blanks:number}>>}
 */
function listForDeck({ gameId, packIds = [], maturityMax = 3 }) {
  return db()('cards')
    .where({ game_id: gameId })
    .whereIn('pack_id', packIds)
    .andWhere('maturity_rating', '<=', maturityMax)
    .whereNull('retired_at')
    .select('id', 'kind', 'text', 'blanks');
}

/**
 * Retire a card (F4): an explicit, reversible admin action. Excludes it from
 * future decks via `listForDeck`; existing telemetry is untouched.
 * @param {number} cardId
 * @returns {Promise<number>} rows updated (0 or 1)
 */
function retire(cardId) {
  return db()('cards').where({ id: cardId })
    .update({ retired_at: db().fn.now() });
}

/**
 * Reverse a retirement.
 * @param {number} cardId
 * @returns {Promise<number>} rows updated (0 or 1)
 */
function unretire(cardId) {
  return db()('cards').where({ id: cardId })
    .update({ retired_at: null });
}

module.exports = {
  listForDeck, retire, unretire,
};
