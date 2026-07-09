/**
 * ForwardAuthProvider (E4, prod).
 *
 * Reads the authenticated user from `Remote-*` headers set by a forward-auth
 * proxy (Caddy `forward_auth` → Authelia). On success Authelia/Caddy inject
 * `Remote-User`, `Remote-Email`, `Remote-Name`, `Remote-Groups`.
 *
 * SECURITY: these headers are trusted ONLY when the app is running behind the
 * proxy (`trustProxy`). If the app port is reachable directly, a client can
 * forge `Remote-Email` and impersonate anyone — so when `trustProxy` is false
 * we ignore the headers entirely and `identify()` returns null. Never read
 * `Remote-*` on an un-proxied deployment.
 */

/** Case-insensitive header read (Express lowercases header keys already). */
function header(req, name) {
  const v = req && req.headers ? req.headers[name.toLowerCase()] : undefined;
  return typeof v === 'string' ? v.trim() : '';
}

class ForwardAuthProvider {
  /** @param {{ trustProxy: boolean }} opts */
  constructor({ trustProxy } = {}) {
    this.trustProxy = !!trustProxy;
  }

  get name() {
    return 'forward';
  }

  /** Forward-auth is the login mechanism; there is no in-app dev form. */
  get supportsDevLogin() {
    return false;
  }

  /**
   * Resolve the proxy-authenticated user, or null. Returns null unless proxied
   * (the security guard) or when no email header is present.
   * @param {import('express').Request} req
   * @returns {{ email: string, displayName: string|null }|null}
   */
  identify(req) {
    if (!this.trustProxy) return null; // spoofable when not behind the proxy
    const email = header(req, 'Remote-Email');
    if (!email) return null;
    const displayName = header(req, 'Remote-Name') || header(req, 'Remote-User') || null;
    return { email, displayName };
  }

  // Forward-auth has no in-app login form.
  loginFromForm() {
    return null;
  }
}

module.exports = ForwardAuthProvider;
