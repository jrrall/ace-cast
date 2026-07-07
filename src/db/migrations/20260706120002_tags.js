/**
 * E2.1 — tags + pack_tags.
 *
 * Packs are the browsable/filterable unit (store), so tags attach to packs via a
 * normalized join table (dialect-portable). Per-card tags are deferred (YAGNI) —
 * no story consumes them yet.
 */

exports.up = async (knex) => {
  await knex.schema.createTable('tags', (t) => {
    t.increments('id').primary();
    t.string('slug').notNullable()
      .unique();
    t.string('label').notNullable();
  });

  await knex.schema.createTable('pack_tags', (t) => {
    t.integer('pack_id').notNullable()
      .references('id')
      .inTable('packs')
      .onDelete('CASCADE');
    t.integer('tag_id').notNullable()
      .references('id')
      .inTable('tags')
      .onDelete('CASCADE');
    t.primary(['pack_id', 'tag_id']);
  });
};

exports.down = async (knex) => {
  await knex.schema.dropTableIfExists('pack_tags');
  await knex.schema.dropTableIfExists('tags');
};
