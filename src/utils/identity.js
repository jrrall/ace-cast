/**
 * Device identity token helpers (S0).
 *
 * The device holds a cookie `<id>.<hmac(id)>`. We verify the HMAC to trust the
 * id — no DB lookup needed on the hot path. `identities` just registers ids.
 */
const crypto = require('crypto');
const config = require('./config');

function sign(id) {
  return crypto.createHmac('sha256', config.identity.secret).update(String(id))
    .digest('hex');
}

/** Build a signed device token for an identity id. */
function makeToken(id) {
  return `${id}.${sign(id)}`;
}

/**
 * Verify a device token and return its id, or null if missing/tampered.
 * @param {string} token
 * @returns {string|null}
 */
function verifyToken(token) {
  if (typeof token !== 'string') return null;
  const dot = token.lastIndexOf('.');
  if (dot <= 0) return null;
  const id = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  if (!id || !sig) return null;
  const expected = sign(id);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return null;
  return crypto.timingSafeEqual(a, b) ? id : null;
}

/** Parse a Cookie header into a plain object. */
function parseCookies(header) {
  const out = {};
  if (typeof header !== 'string') return out;
  header.split(';').forEach((part) => {
    const i = part.indexOf('=');
    if (i > -1) {
      out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
    }
  });
  return out;
}

module.exports = {
  sign, makeToken, verifyToken, parseCookies,
};
