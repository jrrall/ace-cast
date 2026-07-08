/* eslint-disable camelcase */
/**
 * Write + read access to `card_events` (F2 telemetry).
 *
 * One append-only row per card played in a resolved round. Writes are a plain
 * batch insert (no upsert — every play is its own event). Portable across
 * SQLite (better-sqlite3) and Postgres.
 */
const { db } = require('../db');

/**
 * Append the play events for one resolved round.
 * @param {{
 *   gameId: string,
 *   roomCode?: string|null,
 *   blackCardId?: number|null,
 *   submissions?: Array<{ cardId: number, playerId?: string|null, won?: boolean }>
 * }} params
 * @returns {Promise<void>}
 */
async function recordRoundEvents({
  gameId, roomCode = null, blackCardId = null, submissions = [],
} = {}) {
  const rows = submissions
    .filter((s) => s && s.cardId != null)
    .map((s) => ({
      card_id: s.cardId,
      game_id: gameId,
      room_code: roomCode || null,
      // The player's cookie clientId doubles as the anonymous visitor id.
      visitor_id: s.playerId || null,
      black_card_id: blackCardId,
      won: Boolean(s.won),
      played_at: db().fn.now(),
    }));

  if (rows.length === 0) return;
  await db().batchInsert('card_events', rows, 100);
}

/**
 * Aggregate play/win counts grouped by humor tag — the headline metric this
 * whole feature exists to answer ("which humors land?"). Joins events to the
 * per-card humor tags; a card with multiple humors contributes to each.
 * @returns {Promise<Array<{ slug: string, label: string, plays: number, wins: number }>>}
 */
async function humorBreakdown() {
  const knex = db();
  const rows = await knex('card_events as ce')
    .join('card_humor_tags as cht', 'cht.card_id', 'ce.card_id')
    .join('humor_tags as ht', 'ht.id', 'cht.humor_tag_id')
    .select('ht.slug', 'ht.label')
    .count({ plays: 'ce.id' })
    .select(knex.raw('SUM(CASE WHEN ce.won THEN 1 ELSE 0 END) AS wins'))
    .groupBy('ht.slug', 'ht.label')
    .orderBy('plays', 'desc');

  return rows.map((r) => ({
    slug: r.slug,
    label: r.label,
    plays: Number(r.plays) || 0,
    wins: Number(r.wins) || 0,
  }));
}

module.exports = { recordRoundEvents, humorBreakdown };
