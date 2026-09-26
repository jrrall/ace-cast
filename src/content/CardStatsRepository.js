/* eslint-disable camelcase, no-continue */
/**
 * Write access to `card_stats` (F1 telemetry). One counter row per card:
 * `plays` bumps for every card played in a round, `wins` bumps for the card the
 * judge picked. Outcome writes are an atomic upsert-increment via `onConflict`, so
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
  const played = [...new Set(playedCardIds.filter((id) => id != null))].sort((a, b) => a - b);
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

// The ledger insert and counters MUST share a transaction (optionally the
// session snapshot's transaction). Only newly inserted event IDs increment.
async function recordExposureEvents(events = [], transaction = null) {
  if (!events.length) return;
  if (!transaction) {
    await db().transaction((trx) => recordExposureEvents(events, trx));
    return;
  }
  const trx = transaction;
  const valid = events.filter((event) => event.cardId != null
    && ['answer_dealt', 'prompt_exposed'].includes(event.kind));
  // Cards can have been deleted since a persisted deck was loaded.
  const cards = await trx('cards').whereIn('id', valid.map((event) => event.cardId))
    .select('id');
  const ids = new Set(cards.map((card) => card.id));
  valid.sort((a, b) => a.cardId - b.cardId || a.eventId.localeCompare(b.eventId));
  // Stable lock order also avoids deadlocks across concurrent Postgres writers.
  // eslint-disable-next-line no-restricted-syntax
  for (const event of valid) {
    if (!ids.has(event.cardId)) continue;
    // eslint-disable-next-line no-await-in-loop
    const inserted = await trx('card_exposure_events').insert({
      event_id: event.eventId, card_id: event.cardId, kind: event.kind,
    })
      .onConflict('event_id')
      .ignore()
      .returning('event_id');
    if (!inserted.length) continue;
    const column = event.kind === 'answer_dealt' ? 'deals' : 'prompt_exposures';
    // eslint-disable-next-line no-await-in-loop
    await trx('card_stats').insert({ card_id: event.cardId, [column]: 1 })
      .onConflict('card_id')
      .merge({ [column]: trx.raw('?? + 1', [`card_stats.${column}`]), updated_at: trx.fn.now() });
  }
}

async function exposureTracking() {
  const row = await db()('card_telemetry_tracking').where({ name: 'exposures' })
    .first();
  return { started_at: row.started_at, historical_counts_known: false };
}

module.exports = { recordRoundOutcome, recordExposureEvents, exposureTracking };
