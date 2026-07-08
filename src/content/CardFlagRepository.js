/* eslint-disable camelcase */
/**
 * Card flags (F2). Idempotent per (card, flagger, reason) so re-flagging is a
 * no-op rather than an error.
 */
const { db } = require('../db');

const REASONS = ['not_funny', 'broken'];

/**
 * Record a flag. Ignores invalid input and duplicate flags.
 * @param {{ cardId: number, reason: string, flaggerId: string }} flag
 */
async function recordFlag({ cardId, reason, flaggerId }) {
  if (!Number.isInteger(cardId) || cardId <= 0) return;
  if (!REASONS.includes(reason)) return;
  if (!flaggerId) return;
  await db()('card_flags')
    .insert({ card_id: cardId, reason, flagger_id: flaggerId })
    .onConflict(['card_id', 'flagger_id', 'reason'])
    .ignore();
}

/**
 * Aggregate flag counts per (card, reason) — the read the F3 dashboard and F4
 * retirement model consume. Cards with no flags simply don't appear.
 * @returns {Promise<Array<{ cardId: number, reason: string, count: number }>>}
 */
async function flagCounts() {
  const rows = await db()('card_flags')
    .select('card_id', 'reason')
    .count({ count: 'id' })
    .groupBy('card_id', 'reason')
    .orderBy('card_id');

  return rows.map((r) => ({
    cardId: r.card_id,
    reason: r.reason,
    count: Number(r.count) || 0,
  }));
}

module.exports = { recordFlag, flagCounts, REASONS };
