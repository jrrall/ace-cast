/** Writer provenance is unknown for historical cards; never infer it. */
// SQLite column removal rebuilds the table; disable the outer transaction so
// Knex can preserve foreign-key children during rollback.
exports.config = { transaction: false };

exports.up = async (knex) => {
  await knex.schema.alterTable('cards', (t) => {
    t.string('writer', 64).nullable();
  });
};

exports.down = async (knex) => {
  await knex.schema.alterTable('cards', (t) => {
    t.dropColumn('writer');
  });
};
