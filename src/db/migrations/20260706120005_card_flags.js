/**
 * F2 — card flags. Players flag a card as `not_funny` or `broken` (the negative
 * quality signals; positive signal comes from win-rate). Unique per
 * (card, flagger, reason) so a flag can't be spammed.
 */

exports.up = async (knex) => {
  await knex.schema.createTable('card_flags', (t) => {
    t.increments('id').primary();
    t.integer('card_id').notNullable()
      .references('id')
      .inTable('cards')
      .onDelete('CASCADE');
    t.enu('reason', ['not_funny', 'broken']).notNullable();
    t.string('flagger_id').notNullable(); // identity id (S0)
    t.timestamp('created_at').notNullable()
      .defaultTo(knex.fn.now());
    t.unique(['card_id', 'flagger_id', 'reason']);
  });
};

exports.down = async (knex) => {
  await knex.schema.dropTableIfExists('card_flags');
};
