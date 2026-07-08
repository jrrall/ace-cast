/* eslint-disable camelcase */
/**
 * Registry of known device identities (S0). `ensure` is idempotent so it can be
 * called on every connection without duplicating rows.
 */
const { db } = require('../db');

/** @returns {Promise<object|undefined>} the identity row, if any. */
function get(id) {
  return db()('identities').where({ id })
    .first();
}

/** Insert the identity if it does not already exist. */
async function ensure(id) {
  await db()('identities').insert({ id })
    .onConflict('id')
    .ignore();
  return id;
}

module.exports = { get, ensure };
