/**
 * F2 — humor tags (per-card, many-to-many).
 *
 * A card can carry several humor flavors at once (e.g. `dark` + `topical`), so
 * humor attaches to cards through a join table rather than a single column.
 * `humor_tags` is the small controlled vocabulary (seeded from `madlad_humor`);
 * `card_humor_tags` links cards to it. Deleting a card cascades its links away.
 *
 * This is deliberately separate from the pack-level `tags`/`pack_tags` (which
 * classify the *store* unit); humor classifies the individual card so play
 * telemetry (`card_events`) can be sliced by humor.
 */

exports.up = async (knex) => {
  await knex.schema.createTable('humor_tags', (t) => {
    t.increments('id').primary();
    t.string('slug').notNullable()
      .unique();
    t.string('label').notNullable();
  });

  await knex.schema.createTable('card_humor_tags', (t) => {
    t.integer('card_id').notNullable()
      .references('id')
      .inTable('cards')
      .onDelete('CASCADE');
    t.integer('humor_tag_id').notNullable()
      .references('id')
      .inTable('humor_tags')
      .onDelete('CASCADE');
    t.primary(['card_id', 'humor_tag_id']);
    // Slice "which cards have humor X" quickly (the metrics join direction).
    t.index(['humor_tag_id'], 'idx_card_humor_by_tag');
  });
};

exports.down = async (knex) => {
  await knex.schema.dropTableIfExists('card_humor_tags');
  await knex.schema.dropTableIfExists('humor_tags');
};
