exports.up = async (knex) => knex.schema.alterTable('cards', (t) => {
  t.integer('rewrite_of').nullable()
    .unique()
    .references('id')
    .inTable('cards')
    .onDelete('SET NULL');
});
exports.down = async (knex) => knex.schema.alterTable('cards', (t) => {
  t.dropColumn('rewrite_of');
});
