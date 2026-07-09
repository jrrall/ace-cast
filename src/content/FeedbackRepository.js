/* eslint-disable camelcase */
/**
 * F3/F4 — feedback dashboard read model + retirement suggestions.
 *
 * Joins `cards` to F1 `card_stats` (plays/wins) and F2 `card_flags`
 * (aggregated by reason) to answer "which cards are working" (win-rate, above
 * a min-plays floor) and "which cards are hurting the deck" (dead weight,
 * most-flagged, suggested retirement). Pure reads — retirement writes live in
 * CardRepository.
 */
const { db } = require('../db');
const CardFlagRepository = require('./CardFlagRepository');

/**
 * Per-card feedback row: play/win counts, win-rate (null below the min-plays
 * floor — "insufficient data" rather than a misleading ranked number), and
 * flag counts by reason. Cards never played still appear (zero counts).
 * @param {{ minPlays?: number }} [options]
 * @returns {Promise<Array<{
 *   id: number, kind: string, text: string, packSlug: string, packName: string,
 *   retiredAt: string|null, plays: number, wins: number, winRate: number|null,
 *   insufficientData: boolean, flags: {not_funny:number, broken:number},
 *   totalFlags: number, flagRate: number
 * }>>}
 */
async function cardStats({ minPlays = 10 } = {}) {
  const knex = db();
  const rows = await knex('cards as c')
    .leftJoin('card_stats as cs', 'cs.card_id', 'c.id')
    .leftJoin('packs as p', 'p.id', 'c.pack_id')
    .select(
      'c.id',
      'c.kind',
      'c.text',
      'c.retired_at',
      'p.slug as pack_slug',
      'p.name as pack_name',
      knex.raw('COALESCE(cs.plays, 0) as plays'),
      knex.raw('COALESCE(cs.wins, 0) as wins'),
    )
    .orderBy('c.id');

  const flagRows = await CardFlagRepository.flagCounts();
  const flagsByCard = new Map();
  flagRows.forEach(({ cardId, reason, count }) => {
    const entry = flagsByCard.get(cardId) || { not_funny: 0, broken: 0 };
    entry[reason] = count;
    flagsByCard.set(cardId, entry);
  });

  return rows.map((r) => {
    const plays = Number(r.plays) || 0;
    const wins = Number(r.wins) || 0;
    const flags = flagsByCard.get(r.id) || { not_funny: 0, broken: 0 };
    const totalFlags = flags.not_funny + flags.broken;
    const insufficientData = plays < minPlays;
    const rawWinRate = plays > 0 ? wins / plays : 0;

    return {
      id: r.id,
      kind: r.kind,
      text: r.text,
      packSlug: r.pack_slug || null,
      packName: r.pack_name || null,
      retiredAt: r.retired_at || null,
      plays,
      wins,
      winRate: insufficientData ? null : rawWinRate,
      insufficientData,
      flags,
      totalFlags,
      flagRate: plays > 0 ? totalFlags / plays : 0,
    };
  });
}

/**
 * Highest win-rate cards with enough plays to trust the number.
 * @param {Array<object>} stats from cardStats()
 * @param {{ limit?: number }} [options]
 */
function topWinners(stats, { limit = 10 } = {}) {
  return stats
    .filter((c) => !c.insufficientData)
    .slice()
    .sort((a, b) => b.winRate - a.winRate)
    .slice(0, limit);
}

/**
 * "Dead weight": enough plays to trust the number, but the lowest win-rates —
 * cards that keep showing up and keep losing.
 * @param {Array<object>} stats from cardStats()
 * @param {{ limit?: number }} [options]
 */
function deadWeight(stats, { limit = 10 } = {}) {
  return stats
    .filter((c) => !c.insufficientData)
    .slice()
    .sort((a, b) => a.winRate - b.winRate)
    .slice(0, limit);
}

/**
 * Most-flagged cards (any reason), regardless of play count.
 * @param {Array<object>} stats from cardStats()
 * @param {{ limit?: number }} [options]
 */
function mostFlagged(stats, { limit = 10 } = {}) {
  return stats
    .filter((c) => c.totalFlags > 0)
    .slice()
    .sort((a, b) => b.totalFlags - a.totalFlags)
    .slice(0, limit);
}

/**
 * F4 — cards that cross a retirement threshold: enough plays to trust the
 * signal, and either a low win-rate or a high flag-rate. Not-yet-retired only
 * (a suggestion for an admin to act on, not an automatic cut).
 * @param {Array<object>} stats from cardStats()
 * @param {{ minPlays: number, lowWinRate: number, highFlagRate: number }} thresholds
 */
function suggestedRetirements(stats, { minPlays, lowWinRate, highFlagRate }) {
  return stats.filter((c) => !c.retiredAt
    && c.plays >= minPlays
    && ((c.winRate != null && c.winRate < lowWinRate) || c.flagRate > highFlagRate));
}

/**
 * Build the full F3 dashboard payload (used by both the EJS view and the JSON
 * API so they never drift).
 * @param {{ minPlays?: number, thresholds?: {
 *   minPlays?: number, lowWinRateThreshold?: number, highFlagRateThreshold?: number
 * } }} [options]
 */
async function buildDashboard({ minPlays = 10, thresholds = {} } = {}) {
  const stats = await cardStats({ minPlays });
  const {
    minPlays: retireMinPlays = minPlays,
    lowWinRateThreshold = 0.15,
    highFlagRateThreshold = 0.2,
  } = thresholds;

  return {
    minPlays,
    thresholds: {
      minPlays: retireMinPlays,
      lowWinRateThreshold,
      highFlagRateThreshold,
    },
    cards: stats,
    topWinners: topWinners(stats),
    deadWeight: deadWeight(stats),
    mostFlagged: mostFlagged(stats),
    suggestedRetirements: suggestedRetirements(stats, {
      minPlays: retireMinPlays,
      lowWinRate: lowWinRateThreshold,
      highFlagRate: highFlagRateThreshold,
    }),
  };
}

module.exports = {
  cardStats, topWinners, deadWeight, mostFlagged, suggestedRetirements, buildDashboard,
};
