/**
 * F1 — card outcome telemetry.
 *
 * `card_stats` is a per-card counter row: how many times a card was played and
 * how many of those plays won the round. One row per card (`card_id` unique), so
 * writes are an upsert-increment. Deleting a card cascades its stats away.
 */

exports.up = async (knex) => {
  await knex.schema.createTable('card_stats', (t) => {
    t.integer('card_id').notNullable()
      .unique()
      .references('id')
      .inTable('cards')
      .onDelete('CASCADE');
    t.integer('plays').notNullable()
      .defaultTo(0);
    t.integer('wins').notNullable()
      .defaultTo(0);
    t.timestamp('updated_at').notNullable()
      .defaultTo(knex.fn.now());
  });
};

exports.down = async (knex) => {
  await knex.schema.dropTableIfExists('card_stats');
};
