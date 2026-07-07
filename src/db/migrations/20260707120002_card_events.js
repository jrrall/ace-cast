/**
 * F2 — per-play event log (append-only).
 *
 * `card_stats` (F1) is a rolled-up counter; `card_events` is the history behind
 * it: one row per card played in a resolved round. Keeping the raw events lets
 * us slice play/win rates by humor over time (join → `card_humor_tags`), by
 * room, or by anonymous device (`visitor_id`, the player's cookie clientId) —
 * none of which a counter can answer.
 *
 * `visitor_id` is intentionally an opaque anonymous id (no accounts, no PII).
 * `card_id` cascades on card delete; cards are retired via a flag rather than a
 * hard delete (F4), so history is preserved in practice.
 */

exports.up = async (knex) => {
  await knex.schema.createTable('card_events', (t) => {
    t.increments('id').primary();
    t.integer('card_id').notNullable()
      .references('id')
      .inTable('cards')
      .onDelete('CASCADE');
    t.string('game_id').notNullable();
    t.string('room_code').nullable();
    // Anonymous per-device id (cookie clientId). Nullable: older clients or
    // spectator-driven rounds may not carry one.
    t.string('visitor_id').nullable();
    // The prompt this answer was played against (nullable — same retire caveat).
    t.integer('black_card_id').nullable();
    t.boolean('won').notNullable()
      .defaultTo(false);
    t.timestamp('played_at').notNullable()
      .defaultTo(knex.fn.now());

    // Hot query paths: per-card rollups, per-visitor history, time windows.
    t.index(['card_id'], 'idx_card_events_card');
    t.index(['visitor_id'], 'idx_card_events_visitor');
    t.index(['played_at'], 'idx_card_events_played_at');
  });
};

exports.down = async (knex) => {
  await knex.schema.dropTableIfExists('card_events');
};
