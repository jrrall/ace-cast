exports.up = async (knex) => {
  await knex.schema.alterTable('packs', (t) => {
    t.integer('generated_from_pack_id').nullable()
      .references('id')
      .inTable('packs');
  });
};

exports.down = async (knex) => {
  await knex.schema.alterTable('packs', (t) => t.dropColumn('generated_from_pack_id'));
};
