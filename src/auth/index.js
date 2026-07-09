/**
 * Pluggable auth provider selection (E4).
 *
 * `AUTH_PROVIDER` picks the implementation:
 *   - `dev` (default, local/test): in-app email login form, no external IdP.
 *   - `forward` (prod): trusts `Remote-*` headers from a forward-auth proxy
 *     (Caddy → Authelia), guarded by `trustProxy`.
 *
 * Everything else in the accounts flow (signed session cookie, guest→account
 * merge, `/account` UI) is provider-agnostic — only how a login is *established*
 * differs between the two.
 */
const config = require('../utils/config');
const ForwardAuthProvider = require('./ForwardAuthProvider');
const DevAuthProvider = require('./DevAuthProvider');
const { mountAuthRoutes } = require('./routes');

/**
 * Build the auth provider selected by config.
 * @param {object} [cfg] override config (tests)
 * @returns {ForwardAuthProvider|DevAuthProvider}
 */
function createProvider(cfg = config) {
  if (cfg.auth.provider === 'forward') {
    return new ForwardAuthProvider({ trustProxy: cfg.server.trustProxy });
  }
  return new DevAuthProvider();
}

module.exports = {
  createProvider, mountAuthRoutes, ForwardAuthProvider, DevAuthProvider,
};
