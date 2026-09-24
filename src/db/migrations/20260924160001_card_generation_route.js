exports.config = { transaction: false };
exports.up = async (knex) => knex.schema.alterTable('cards', (t) => {
  t.string('generation_route', 32).nullable();
  t.string('source_url', 2048).nullable();
});
exports.down = async (knex) => knex.schema.alterTable('cards', (t) => {
  t.dropColumn('generation_route');
  t.dropColumn('source_url');
});
