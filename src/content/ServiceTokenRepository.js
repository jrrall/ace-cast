/* eslint-disable camelcase */
/**
 * F2 (Card Forge) — named, revocable credentials for machine callers.
 *
 * Supersedes the single shared `CONTENT_API_TOKEN`. Each machine client gets
 * its own token so it can be revoked, rotated, and attributed independently.
 *
 * Storage: only `sha256(token)` is persisted. A token is 32 bytes of CSPRNG
 * output, so it already carries full entropy — a slow KDF (argon2/bcrypt)
 * buys nothing here, and the indexed equality lookup on the hash means the
 * comparison never touches the secret in variable time.
 */
const crypto = require('crypto');
const { db } = require('../db');

const TABLE = 'service_tokens';
/** Distinguishes a service token from the legacy shared secret at a glance. */
const TOKEN_PREFIX = 'ct_live_';

/**
 * SHA-256 hex of a presented token. Exported so callers (and tests) hash the
 * same way the lookup does.
 * @param {string} raw
 * @returns {string}
 */
function hashToken(raw) {
  return crypto.createHash('sha256').update(String(raw), 'utf8')
    .digest('hex');
}

/**
 * Mint a new token string. Returned ONCE, to the caller of `create` — the
 * plaintext is never stored and cannot be recovered afterwards.
 * @returns {string}
 */
function generateToken() {
  return TOKEN_PREFIX + crypto.randomBytes(32).toString('base64url');
}

/**
 * Parse the comma-separated `scopes` column into a trimmed array.
 * @param {string} scopes
 * @returns {string[]}
 */
function parseScopes(scopes) {
  return String(scopes || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Create a service token. The plaintext token is returned here and nowhere
 * else — the caller must surface it to the operator immediately.
 * @param {{clientId:string, name?:string, scopes?:string|string[], createdBy?:string}} opts
 * @returns {Promise<{token:string, row:object}>}
 */
async function create({
  clientId, name, scopes = 'content:read,content:write', createdBy = null,
}) {
  if (!clientId) throw new Error('clientId is required');
  const token = generateToken();
  const scopeStr = Array.isArray(scopes) ? scopes.join(',') : scopes;
  const [id] = await db()(TABLE).insert({
    client_id: clientId,
    name: name || clientId,
    token_hash: hashToken(token),
    scopes: scopeStr,
    created_by: createdBy,
  });
  const row = await db()(TABLE).where({ id })
    .first();
  return { token, row };
}

/**
 * Resolve a presented token to its (non-revoked) row.
 * @param {string} raw
 * @returns {Promise<object|null>}
 */
async function verify(raw) {
  if (!raw) return null;
  const row = await db()(TABLE).where({ token_hash: hashToken(raw) })
    .first();
  if (!row || row.revoked_at) return null;
  return row;
}

/**
 * Record that a token was just used. Best-effort: a failure here must never
 * fail the request the caller is actually making.
 * @param {number} id
 * @returns {Promise<void>}
 */
async function touch(id) {
  try {
    await db()(TABLE).where({ id })
      .update({ last_used_at: db().fn.now() });
  } catch (error) {
    console.error('Failed to record service token use:', error);
  }
}

/**
 * How many usable tokens exist. Drives the "feature off ⇒ 404" decision: with
 * no configured secret and no active token, the content routes must stay
 * hidden rather than advertise themselves with a 401.
 * @returns {Promise<number>}
 */
async function countActive() {
  const row = await db()(TABLE).whereNull('revoked_at')
    .count({ n: '*' })
    .first();
  return Number(row ? row.n : 0);
}

/**
 * Soft-revoke by client_id. The row is kept so past submissions stay
 * attributable.
 * @param {string} clientId
 * @returns {Promise<boolean>} whether a live token was revoked
 */
async function revoke(clientId) {
  const updated = await db()(TABLE)
    .where({ client_id: clientId })
    .whereNull('revoked_at')
    .update({ revoked_at: db().fn.now() });
  return updated > 0;
}

/**
 * List tokens for operator display. Never includes hashes.
 * @returns {Promise<object[]>}
 */
async function list() {
  const rows = await db()(TABLE).select(
    'id',
    'client_id',
    'name',
    'scopes',
    'created_at',
    'last_used_at',
    'revoked_at',
  );
  return rows.map((r) => ({ ...r, scopes: parseScopes(r.scopes) }));
}

module.exports = {
  TOKEN_PREFIX,
  hashToken,
  generateToken,
  parseScopes,
  create,
  verify,
  touch,
  countActive,
  revoke,
  list,
};
