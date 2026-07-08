/**
 * S0 — stable player identity (foundation).
 *
 * A durable device identity that outlives socket.id, used now to attribute card
 * flags (F2) and later to key rooms / link accounts. The device holds a signed
 * token cookie whose id we verify by HMAC; this table just registers known ids
 * (and reserves `user_id` for the E4 account link).
 */

exports.up = async (knex) => {
  await knex.schema.createTable('identities', (t) => {
    t.string('id').primary(); // uuid, carried in the signed device cookie
    t.string('user_id').nullable(); // linked when accounts (E4) land
    t.timestamp('created_at').notNullable()
      .defaultTo(knex.fn.now());
  });
};

exports.down = async (knex) => {
  await knex.schema.dropTableIfExists('identities');
};
