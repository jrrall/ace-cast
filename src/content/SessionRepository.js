/* eslint-disable camelcase */
/**
 * S1 — durable room sessions. Thin knex access over the `sessions` table; all
 * persistence logic lives here so the game engine and manager stay pure.
 *
 * `serialized_state` is stored as JSON text (the engine's `serialize()` output)
 * and parsed back on read. Snapshots upsert by `room_code`, so a room has at
 * most one session row that is rewritten in place as the game progresses.
 */
const { db } = require('../db');

const RESUMABLE = ['active', 'paused'];
const STATUSES = ['active', 'paused', 'completed', 'abandoned'];

/**
 * Write-through snapshot: create or update the session for a room. Upserts by
 * room_code so repeated calls during a game rewrite the single row in place,
 * bumping `updated_at` / `last_activity`.
 * @param {{
 *   roomCode: string,
 *   gameType: string,
 *   stateVersion?: number,
 *   serializedState?: object|null,
 *   status?: string
 * }} params
 * @returns {Promise<void>}
 */
async function snapshot({
  roomCode, gameType, stateVersion = 0, serializedState = null, status = 'active',
} = {}) {
  if (!roomCode || !gameType) return;
  if (!STATUSES.includes(status)) return;

  const now = db().fn.now();
  const row = {
    room_code: roomCode,
    game_type: gameType,
    status,
    state_version: Number.isInteger(stateVersion) ? stateVersion : 0,
    serialized_state: serializedState == null ? null : JSON.stringify(serializedState),
    updated_at: now,
    // Epoch ms (see migration): portable TTL comparisons on SQLite + Postgres.
    last_activity: Date.now(),
  };

  await db()('sessions')
    .insert({ ...row, created_at: now })
    .onConflict('room_code')
    .merge(row);
}

/** Hydrate a row into a plain object with `serializedState` parsed back to JSON. */
function hydrate(r) {
  if (!r) return null;
  let serializedState = null;
  if (r.serialized_state != null) {
    try {
      serializedState = JSON.parse(r.serialized_state);
    } catch {
      serializedState = null;
    }
  }
  return {
    id: r.id,
    roomCode: r.room_code,
    gameType: r.game_type,
    status: r.status,
    stateVersion: Number(r.state_version) || 0,
    serializedState,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    // bigInteger comes back as a string under pg; normalize to a number.
    lastActivity: r.last_activity == null ? null : Number(r.last_activity),
  };
}

/**
 * Fetch the full session for a room code (including its parsed snapshot).
 * @param {string} roomCode
 * @returns {Promise<object|null>}
 */
async function getByRoomCode(roomCode) {
  if (!roomCode) return null;
  const r = await db()('sessions').where({ room_code: roomCode })
    .first();
  return hydrate(r);
}

/**
 * Update a session's status (and bump `updated_at`). No-op for unknown codes or
 * invalid statuses.
 * @param {string} roomCode
 * @param {string} status
 * @returns {Promise<void>}
 */
async function markStatus(roomCode, status) {
  if (!roomCode || !STATUSES.includes(status)) return;
  await db()('sessions')
    .where({ room_code: roomCode })
    .update({ status, updated_at: db().fn.now() });
}

/**
 * List sessions that could be resumed (active or paused). Light rows for
 * discovery/sweeps — the heavy `serialized_state` is fetched lazily via
 * `getByRoomCode` only when a room is actually rehydrated.
 * @returns {Promise<Array<{ roomCode: string, gameType: string, status: string,
 *   stateVersion: number, updatedAt: *, lastActivity: * }>>}
 */
async function listResumable() {
  const rows = await db()('sessions')
    .whereIn('status', RESUMABLE)
    .select('room_code', 'game_type', 'status', 'state_version', 'updated_at', 'last_activity')
    .orderBy('last_activity', 'desc');
  return rows.map((r) => ({
    roomCode: r.room_code,
    gameType: r.game_type,
    status: r.status,
    stateVersion: Number(r.state_version) || 0,
    updatedAt: r.updated_at,
    lastActivity: Number(r.last_activity) || 0,
  }));
}

/**
 * Delete abandoned sessions whose last activity is older than `olderThanMs`.
 * Keeps the table from growing without bound once a session is unrecoverable.
 * @param {number} olderThanMs
 * @returns {Promise<number>} rows deleted
 */
async function pruneAbandoned(olderThanMs) {
  const ms = Number(olderThanMs);
  if (!Number.isFinite(ms) || ms < 0) return 0;
  const cutoff = Date.now() - ms; // epoch ms, matches last_activity
  return db()('sessions')
    .where({ status: 'abandoned' })
    .andWhere('last_activity', '<', cutoff)
    .del();
}

module.exports = {
  snapshot,
  getByRoomCode,
  markStatus,
  listResumable,
  pruneAbandoned,
  RESUMABLE,
  STATUSES,
};
