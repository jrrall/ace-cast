/* eslint-disable camelcase */
/**
 * Write access to `card_stats` (F1 telemetry). One counter row per card:
 * `plays` bumps for every card played in a round, `wins` bumps for the card the
 * judge picked. Writes are an idempotent upsert-increment via `onConflict`, so
 * the first play inserts the row and every later play increments it. Portable
 * across SQLite (better-sqlite3) and Postgres — both honour the `excluded`
 * pseudo-table used to carry the increment amount.
 */
const { db } = require('../db');

/**
 * Record the outcome of one resolved round.
 * @param {{ playedCardIds: Array<number|null|undefined>, winningCardId?: number|null }} params
 * @returns {Promise<void>}
 */
async function recordRoundOutcome({ playedCardIds = [], winningCardId = null } = {}) {
  const knex = db();
  // Dedupe + drop null/undefined ids (a single INSERT can't touch a row twice).
  const played = [...new Set(playedCardIds.filter((id) => id != null))];
  if (played.length === 0) return;

  const rows = played.map((cardId) => ({
    card_id: cardId,
    plays: 1,
    wins: cardId === winningCardId ? 1 : 0,
    updated_at: knex.fn.now(),
  }));

  await knex('card_stats')
    .insert(rows)
    .onConflict('card_id')
    .merge({
      plays: knex.raw('card_stats.plays + excluded.plays'),
      wins: knex.raw('card_stats.wins + excluded.wins'),
      updated_at: knex.fn.now(),
    });
}

module.exports = { recordRoundOutcome };
