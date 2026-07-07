/* eslint-disable camelcase */
/**
 * Read access to `cards`.
 */
const { db } = require('../db');

/**
 * Load cards for building a deck: a game's cards within the selected packs,
 * filtered to a maturity ceiling.
 * @param {{ gameId: string, packIds: number[], maturityMax?: number }} params
 * @returns {Promise<Array<{id:number, kind:string, text:string, blanks:number}>>}
 */
function listForDeck({ gameId, packIds = [], maturityMax = 3 }) {
  return db()('cards')
    .where({ game_id: gameId })
    .whereIn('pack_id', packIds)
    .andWhere('maturity_rating', '<=', maturityMax)
    .select('id', 'kind', 'text', 'blanks');
}

module.exports = { listForDeck };
