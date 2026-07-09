/* eslint-disable camelcase */
/**
 * User accounts (E4). Thin knex over the `users` table. Email is the natural key
 * (accounts are provisioned by an external IdP / dev login keyed on email), so
 * `upsertByEmail` is idempotent: the same email always resolves to the same row.
 */
const crypto = require('crypto');
const { db } = require('../db');

/** Lowercase + trim an email, or return '' for anything unusable. */
function normalizeEmail(email) {
  if (typeof email !== 'string') return '';
  const e = email.trim().toLowerCase();
  // Deliberately loose: the IdP already authenticated the address. We just want
  // a stable, non-empty key that looks like an email.
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? e : '';
}

/** @returns {Promise<object|undefined>} the user row for an id, if any. */
function getById(id) {
  if (!id) return Promise.resolve(undefined);
  return db()('users').where({ id })
    .first();
}

/** @returns {Promise<object|undefined>} the user row for an email, if any. */
function getByEmail(email) {
  const e = normalizeEmail(email);
  if (!e) return Promise.resolve(undefined);
  return db()('users').where({ email: e })
    .first();
}

/**
 * Insert-or-fetch a user by email, returning the row. Idempotent: a repeat call
 * with the same email returns the existing account (never a duplicate). A
 * non-empty `displayName` refreshes the stored name; a blank one leaves it be.
 * @param {string} email
 * @param {string|null} [displayName]
 * @returns {Promise<object|undefined>}
 */
async function upsertByEmail(email, displayName = null) {
  const e = normalizeEmail(email);
  if (!e) return undefined;
  const name = typeof displayName === 'string' && displayName.trim()
    ? displayName.trim()
    : null;

  const insert = { id: crypto.randomUUID(), email: e, display_name: name };
  const query = db()('users').insert(insert)
    .onConflict('email');
  // Only overwrite display_name when we actually have one, so a nameless login
  // (e.g. a proxy header without Remote-Name) never wipes an existing name.
  if (name) {
    await query.merge({ display_name: name, updated_at: db().fn.now() });
  } else {
    await query.merge({ updated_at: db().fn.now() });
  }
  return getByEmail(e);
}

module.exports = {
  getById, getByEmail, upsertByEmail, normalizeEmail,
};
