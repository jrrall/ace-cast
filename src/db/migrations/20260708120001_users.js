/**
 * E4 — user accounts.
 *
 * A durable account keyed by email. Guests keep playing with just a name + their
 * S0 device identity; logging in creates/looks up a `users` row and links the
 * current device (`identities.user_id`) to it so future durable stats (S2) can
 * attach to the account. `id` is a uuid string to match `identities.id` and the
 * `identities.user_id` link column reserved back in S0 (no schema change there).
 */

exports.up = async (knex) => {
  await knex.schema.createTable('users', (t) => {
    t.string('id').primary(); // uuid, referenced by identities.user_id (S0)
    t.string('email').notNullable()
      .unique();
    t.string('display_name').nullable();
    t.timestamp('created_at').notNullable()
      .defaultTo(knex.fn.now());
    t.timestamp('updated_at').notNullable()
      .defaultTo(knex.fn.now());
  });
};

exports.down = async (knex) => {
  await knex.schema.dropTableIfExists('users');
};
