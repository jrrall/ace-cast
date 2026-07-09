/**
 * App session token helpers (E4).
 *
 * The app's own login session — distinct from the S0 device identity cookie.
 * Same lightweight, storeless approach as `src/utils/identity.js`: the browser
 * holds `<userId>.<hmac(userId)>` and we verify the HMAC to trust the id, so no
 * server-side session store is needed. Its own secret keeps it independent of
 * the device-identity secret.
 */
const crypto = require('crypto');
const config = require('../utils/config');

function sign(userId) {
  return crypto.createHmac('sha256', config.auth.session.secret).update(String(userId))
    .digest('hex');
}

/** Build a signed session token for a user id. */
function makeToken(userId) {
  return `${userId}.${sign(userId)}`;
}

/**
 * Verify a session token and return its user id, or null if missing/tampered.
 * @param {string} token
 * @returns {string|null}
 */
function verifyToken(token) {
  if (typeof token !== 'string') return null;
  const dot = token.lastIndexOf('.');
  if (dot <= 0) return null;
  const userId = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  if (!userId || !sig) return null;
  const expected = sign(userId);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return null;
  return crypto.timingSafeEqual(a, b) ? userId : null;
}

module.exports = { sign, makeToken, verifyToken };
