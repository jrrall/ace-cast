/**
 * E2.1 — packs + cards.
 *
 * `packs` is the ownable/sellable unit; `cards` belong to a pack. Maturity is an
 * integer 0–3 (0 family · 1 teen · 2 mature · 3 explicit) so filtering is a plain
 * `<=` comparison. `cover_asset_id` / `sprite_asset_id` are nullable placeholders
 * for E3 (assets) — no FK constraint yet, added when that table exists.
 */

exports.up = async (knex) => {
  await knex.schema.createTable('packs', (t) => {
    t.increments('id').primary();
    t.string('slug').notNullable()
      .unique();
    t.string('name').notNullable();
    t.text('description');
    t.string('game_id').notNullable()
      .index();
    t.integer('price_cents').notNullable()
      .defaultTo(0);
    t.boolean('is_default').notNullable()
      .defaultTo(false);
    t.integer('maturity_max').notNullable()
      .defaultTo(3);
    t.boolean('published').notNullable()
      .defaultTo(true);
    t.integer('cover_asset_id').nullable(); // FK added in E3
    t.timestamp('created_at').notNullable()
      .defaultTo(knex.fn.now());
  });

  await knex.schema.createTable('cards', (t) => {
    t.increments('id').primary();
    t.string('game_id').notNullable();
    t.enu('kind', ['prompt', 'answer']).notNullable();
    t.text('text').notNullable();
    t.integer('blanks').notNullable()
      .defaultTo(1);
    t.integer('pack_id').notNullable()
      .references('id')
      .inTable('packs')
      .onDelete('CASCADE');
    t.integer('maturity_rating').notNullable()
      .defaultTo(1);
    t.integer('sprite_asset_id').nullable(); // FK added in E3
    t.timestamp('created_at').notNullable()
      .defaultTo(knex.fn.now());
    // Hot path: build a deck by game + kind within selected packs, maturity-filtered.
    t.index(['game_id', 'kind', 'pack_id'], 'idx_cards_deck');
    t.index(['pack_id'], 'idx_cards_pack');
  });
};

exports.down = async (knex) => {
  await knex.schema.dropTableIfExists('cards');
  await knex.schema.dropTableIfExists('packs');
};
