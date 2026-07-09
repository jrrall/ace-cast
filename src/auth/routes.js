/**
 * Account routes + session middleware (E4).
 *
 * Additive and provider-gated: gameplay never routes through here. `attachUser`
 * resolves the current account (from trusted proxy headers or the signed session
 * cookie) onto `req.user`; `requireAuth` gates `/account` (and its API) only —
 * nothing in the play path. On any successful login the current S0 device
 * identity is linked to the account (guest→account merge) so future durable
 * stats attach to it.
 */
const config = require('../utils/config');
const session = require('./session');
const identityToken = require('../utils/identity');
const UserRepository = require('../content/UserRepository');
const IdentityRepository = require('../content/IdentityRepository');

/** Issue the signed app session cookie for a user id. */
function setSession(res, userId) {
  res.cookie(config.auth.session.cookieName, session.makeToken(userId), {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: config.auth.session.cookieMaxAgeMs,
    // Match the S0 cookie: secure only when we're behind TLS (proxied).
    secure: config.server.trustProxy,
  });
}

/** Clear the app session cookie (logout). */
function clearSession(res) {
  res.clearCookie(config.auth.session.cookieName);
}

/**
 * Establish/refresh `req.user`. Forward-auth trusts the proxy headers (the
 * provider itself guards on `trustProxy`); otherwise we fall back to the signed
 * session cookie. A header-established login also (re)issues the cookie and
 * links the device identity.
 */
function attachUser(provider) {
  return async (req, res, next) => {
    try {
      const external = provider.identify(req);
      if (external && external.email) {
        const user = await UserRepository.upsertByEmail(external.email, external.displayName);
        if (user) {
          setSession(res, user.id);
          await IdentityRepository.linkUser(req.identityId, user.id);
          req.user = user;
          return next();
        }
      }
      const cookies = identityToken.parseCookies(req.headers.cookie);
      const userId = session.verifyToken(cookies[config.auth.session.cookieName]);
      if (userId) {
        req.user = await UserRepository.getById(userId);
      }
      return next();
    } catch (err) {
      return next(err);
    }
  };
}

/** Gate a route on an authenticated account. 401 for API/JSON, else a page. */
function requireAuth(provider) {
  return (req, res, next) => {
    if (req.user) return next();
    const wantsJson = req.path.startsWith('/api/') || req.accepts(['html', 'json']) === 'json';
    if (wantsJson) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    return res.status(401).render('auth/unauthorized', {
      title: 'unholy.cards — Sign in',
      devLogin: provider.supportsDevLogin,
    });
  };
}

/**
 * Mount the account/auth routes. Login gates ONLY `/account` (+ its API);
 * every gameplay path stays public.
 * @param {import('express').Express} app
 * @param {object} provider the selected auth provider
 */
function mountAuthRoutes(app, provider) {
  const withUser = attachUser(provider);
  const auth = requireAuth(provider);

  if (provider.supportsDevLogin) {
    // Dev-only email login (no external IdP). Absent entirely for forward-auth.
    app.get('/login', withUser, (req, res) => {
      if (req.user) return res.redirect('/account');
      return res.render('auth/dev-login', { title: 'unholy.cards — Dev Login', error: null });
    });

    app.post('/auth/dev-login', withUser, async (req, res, next) => {
      try {
        const creds = provider.loginFromForm(req.body);
        if (!creds) {
          return res.status(400).render('auth/dev-login', {
            title: 'unholy.cards — Dev Login',
            error: 'Enter a valid email address.',
          });
        }
        const user = await UserRepository.upsertByEmail(creds.email, creds.displayName);
        setSession(res, user.id);
        // Guest→account merge: claim this device's S0 identity for the account.
        await IdentityRepository.linkUser(req.identityId, user.id);
        return res.redirect('/account');
      } catch (err) {
        return next(err);
      }
    });
  } else {
    // Forward-auth: /login just points at the protected resource; Caddy →
    // Authelia handles the actual login, then re-requests /account with headers.
    app.get('/login', (req, res) => res.redirect('/account'));
  }

  app.get('/account', withUser, auth, async (req, res) => {
    const row = await IdentityRepository.get(req.identityId);
    res.render('account', {
      title: 'unholy.cards — Account',
      user: req.user,
      deviceLinked: !!(row && row.user_id === req.user.id),
      devLogin: provider.supportsDevLogin,
    });
  });

  app.get('/api/account', withUser, auth, (req, res) => {
    res.json({
      user: { id: req.user.id, email: req.user.email, displayName: req.user.display_name },
    });
  });

  const logout = (req, res) => {
    clearSession(res);
    res.redirect('/');
  };
  app.get('/logout', logout);
  app.post('/logout', logout);
}

module.exports = {
  mountAuthRoutes, attachUser, requireAuth, setSession, clearSession,
};
