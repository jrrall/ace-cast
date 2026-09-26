exports.up = async (knex) => {
  await knex.schema.alterTable('card_stats', (t) => {
    t.bigInteger('deals').notNullable()
      .defaultTo(0);
    t.bigInteger('prompt_exposures').notNullable()
      .defaultTo(0);
  });
  await knex.schema.createTable('card_exposure_events', (t) => {
    t.string('event_id', 36).primary();
    t.integer('card_id').notNullable()
      .references('id')
      .inTable('cards')
      .onDelete('CASCADE');
    t.string('kind').notNullable();
  });
  await knex.schema.createTable('card_telemetry_tracking', (t) => {
    t.string('name').primary();
    t.timestamp('started_at').notNullable();
  });
  // Deployment time, not the migration's filename date. No historical backfill.
  await knex('card_telemetry_tracking').insert({ name: 'exposures', started_at: knex.fn.now() });
};

exports.down = async (knex) => {
  await knex.schema.dropTable('card_telemetry_tracking');
  await knex.schema.dropTable('card_exposure_events');
  await knex.schema.alterTable('card_stats', (t) => {
    t.dropColumn('deals');
    t.dropColumn('prompt_exposures');
  });
};
