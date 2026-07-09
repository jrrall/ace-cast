/**
 * DevAuthProvider (E4, local/test).
 *
 * No external IdP: a `/auth/dev-login` form establishes a session for whatever
 * email is entered, so the entire accounts flow (login → session → guest→account
 * merge → /account) is exercisable locally with nothing but the app running.
 * Enabled only when `AUTH_PROVIDER=dev` (the local/test default). It never reads
 * proxy headers, so it cannot be tricked by spoofed `Remote-*` headers.
 */
const { normalizeEmail } = require('../content/UserRepository');

class DevAuthProvider {
  get name() {
    return 'dev';
  }

  get supportsDevLogin() {
    return true;
  }

  /** Dev login is explicit (the form), never derived from request headers. */
  identify() {
    return null;
  }

  /**
   * Map a submitted dev-login form to a login identity, or null if the email is
   * unusable. The route upserts this into a `users` row and starts a session.
   * @param {{ email?: string, displayName?: string }} [body]
   * @returns {{ email: string, displayName: string|null }|null}
   */
  loginFromForm(body) {
    const email = normalizeEmail(body && body.email);
    if (!email) return null;
    const raw = body && typeof body.displayName === 'string' ? body.displayName.trim() : '';
    return { email, displayName: raw || null };
  }
}

module.exports = DevAuthProvider;
