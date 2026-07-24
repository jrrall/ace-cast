/* eslint-disable camelcase */
/**
 * F2 (Card Forge) — write/review access to generated `cards` candidates.
 *
 * The content API (src/server/index.js) is the ONLY contract the standalone LLM
 * agent touches; this repository is its DB layer. Kept separate from the
 * read-only `CardRepository` because these are the mutating, review-lifecycle
 * operations (insert-as-pending, approve/deny, hard-delete a pending row) that
 * only the content surface uses.
 *
 * Fail-closed discipline: `insertPending` sets `status='pending'` EXPLICITLY on
 * every row (never relying on the column default), and `existingTextsForPack`
 * dedupes against ALL statuses — including `denied` — so a previously-rejected
 * card can't be re-queued to re-consume review budget.
 */
const { db } = require('../db');

/**
 * Normalize a card's text for dedupe: lowercase + collapse/trim whitespace. The
 * agent's Curator applies the same normalization, so the exact-match server
 * guard and the agent's fuzzy pre-flight trim agree on what counts as a dup.
 * @param {string} text
 * @returns {string}
 */
function normalizeText(text) {
  return String(text == null ? '' : text)
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

/**
 * Insert candidate rows as `pending` generated cards. Status is forced to
 * `pending` and source to `generated` regardless of what the caller supplies —
 * this is the fail-closed guarantee: unreviewed content can never be inserted
 * already-approved.
 * @param {Array<{game_id:string, kind:string, text:string, blanks:number,
 *   maturity_rating:number, pack_id:number}>} rows
 * @returns {Promise<number[]>} the inserted row ids (in input order)
 */
async function insertPending(rows) {
  if (!rows || rows.length === 0) return [];
  const ids = [];
  // Insert one-by-one so we can collect ids portably across dialects and keep
  // input order. Volume is bounded by the API's maxBatch cap.
  // eslint-disable-next-line no-restricted-syntax
  for (const row of rows) {
    const insertRow = {
      game_id: row.game_id,
      kind: row.kind,
      text: row.text,
      blanks: row.blanks,
      maturity_rating: row.maturity_rating,
      pack_id: row.pack_id,
      // Forced, not taken from `row`: fail-closed. Even if a caller passes
      // status/source, generated candidates always land pending + generated.
      status: 'pending',
      source: 'generated',
    };
    // eslint-disable-next-line no-await-in-loop
    const [id] = await db()('cards').insert(insertRow);
    ids.push(id);
  }
  return ids;
}

/**
 * List candidate cards for the agent's dedupe corpus / the review UI.
 * @param {{ status?: string, kind?: string, limit?: number }} [options]
 * @returns {Promise<Array<object>>}
 */
function list({ status, kind, limit = 100 } = {}) {
  const query = db()('cards')
    .select(
      'id',
      'game_id',
      'kind',
      'text',
      'blanks',
      'maturity_rating',
      'pack_id',
      'status',
      'source',
      'reviewed_at',
      'reviewed_by',
      'denied_reason',
      'created_at',
    )
    .orderBy('id', 'desc');
  if (status) query.where({ status });
  if (kind) query.where({ kind });
  query.limit(limit);
  return query;
}

/**
 * Approve or deny a candidate: set its status and stamp the review metadata.
 * @param {number} id
 * @param {{ status:string, reviewed_by?:string, denied_reason?:string }} fields
 * @returns {Promise<number>} rows updated (0 if the id doesn't exist)
 */
function setStatus(id, { status, reviewed_by = null, denied_reason = null }) {
  return db()('cards').where({ id })
    .update({
      status,
      reviewed_at: db().fn.now(),
      reviewed_by,
      // Only carry a reason for a denial; approving clears any stale reason.
      denied_reason: status === 'denied' ? denied_reason : null,
    });
}

/**
 * Hard-delete a candidate, but ONLY while it is still `pending`. An
 * approved/denied card carries history (it may have played, or its denial
 * anchors dedupe), so this refuses to remove it.
 * @param {number} id
 * @returns {Promise<number>} rows deleted (0 if not found OR not pending)
 */
function deletePending(id) {
  return db()('cards').where({ id, status: 'pending' })
    .del();
}

/**
 * All existing card texts in a pack, across EVERY status (incl. `denied`),
 * normalized for dedupe. The denied inclusion is load-bearing: it stops the
 * agent re-submitting a previously-rejected card to re-flood the review queue.
 * @param {number} packId
 * @returns {Promise<Set<string>>} normalized texts
 */
async function existingTextsForPack(packId) {
  const rows = await db()('cards').where({ pack_id: packId })
    .select('text');
  return new Set(rows.map((r) => normalizeText(r.text)));
}

/**
 * Count cards in a given status, optionally restricted to those reviewed at or
 * after `since`. Backs the F3 admin dashboard's daily pending/approved/denied
 * counts (`since` = start-of-day for the approved/denied counts; omitted for
 * the plain pending count).
 * @param {string} status
 * @param {{ since?: Date|string }} [options]
 * @returns {Promise<number>}
 */
async function countByStatus(status, { since } = {}) {
  const query = db()('cards').where({ status })
    .count({ count: '*' });
  if (since) query.andWhere('reviewed_at', '>=', since);
  const row = await query.first();
  return Number(row && row.count) || 0;
}

module.exports = {
  normalizeText,
  insertPending,
  list,
  setStatus,
  deletePending,
  existingTextsForPack,
  countByStatus,
};
