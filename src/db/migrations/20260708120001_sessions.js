/**
 * S1 — durable, resumable room sessions.
 *
 * One row per room code. Everything the server needs to rebuild a live game
 * after a restart or an idle gap: the game type, a status, a monotonically
 * bumped `state_version` (optimistic-concurrency hook for S3), and the engine's
 * plain-JSON `serialized_state` (produced by `engine.serialize()`).
 *
 * Status lifecycle:
 *   active     — a live game is running (snapshotted write-through on each move)
 *   paused     — the room left memory but is resumable within the TTL
 *   completed  — the game ended normally (game over / host end-game)
 *   abandoned  — a paused session aged past `session.resumableTtlMs`
 *
 * `room_code` is unique so `snapshot()` can upsert by it and rehydrate can find
 * the one session for a code fast.
 */

exports.up = async (knex) => {
  await knex.schema.createTable('sessions', (t) => {
    t.increments('id').primary();
    t.string('room_code').notNullable()
      .unique();
    t.string('game_type').notNullable();
    t.enu('status', ['active', 'paused', 'completed', 'abandoned'])
      .notNullable()
      .defaultTo('active');
    t.integer('state_version').notNullable()
      .defaultTo(0);
    // Serialized engine snapshot (JSON text). Nullable so a session row can
    // exist before its first snapshot lands.
    t.text('serialized_state').nullable();
    t.timestamp('created_at').notNullable()
      .defaultTo(knex.fn.now());
    t.timestamp('updated_at').notNullable()
      .defaultTo(knex.fn.now());
    // Epoch milliseconds (not a SQL timestamp) so the resumable-TTL sweep can
    // compare against `Date.now()` with identical semantics on SQLite and
    // Postgres — parsing SQLite's `CURRENT_TIMESTAMP` text in JS is timezone
    // ambiguous, which would make the TTL boundary wrong.
    t.bigInteger('last_activity').notNullable()
      .defaultTo(0);

    // Find resumable sessions (and sweep stale paused ones) fast.
    t.index(['status'], 'idx_sessions_status');
    t.index(['last_activity'], 'idx_sessions_last_activity');
  });
};

exports.down = async (knex) => {
  await knex.schema.dropTableIfExists('sessions');
};
