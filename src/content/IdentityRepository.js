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

/**
 * Link a device identity to a user account (E4 guest→account merge). Idempotent
 * and self-healing: ensures the identity row exists, then claims it for the
 * user. Re-running with the same pair is a no-op. Logging in on a new device
 * simply links that device too.
 * @param {string} id device identity id
 * @param {string} userId account id
 */
async function linkUser(id, userId) {
  if (!id || !userId) return;
  await db()('identities')
    .insert({ id, user_id: userId })
    .onConflict('id')
    .merge({ user_id: userId });
}

module.exports = { get, ensure, linkUser };
