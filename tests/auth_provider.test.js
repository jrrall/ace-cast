// E4 — pluggable auth providers.
const ForwardAuthProvider = require('../src/auth/ForwardAuthProvider');
const DevAuthProvider = require('../src/auth/DevAuthProvider');

// A minimal Express-like request carrying (lowercased) headers.
const reqWith = (headers = {}) => ({ headers });

describe('DevAuthProvider', () => {
  const provider = new DevAuthProvider();

  test('supports the in-app dev login and never reads headers', () => {
    expect(provider.name).toBe('dev');
    expect(provider.supportsDevLogin).toBe(true);
    // Even with Remote-* headers present, dev never auto-logs-in from them.
    expect(provider.identify(reqWith({ 'remote-email': 'evil@example.com' }))).toBeNull();
  });

  test('maps a login form to a normalized identity', () => {
    const creds = provider.loginFromForm({ email: 'Bob@Example.com', displayName: ' Bob ' });
    expect(creds).toEqual({ email: 'bob@example.com', displayName: 'Bob' });
  });

  test('rejects an unusable login email', () => {
    expect(provider.loginFromForm({ email: 'nope' })).toBeNull();
    expect(provider.loginFromForm({})).toBeNull();
  });
});

describe('ForwardAuthProvider', () => {
  const headers = { 'remote-email': 'carol@example.com', 'remote-name': 'Carol' };

  test('reads Remote-* headers when proxied', () => {
    const provider = new ForwardAuthProvider({ trustProxy: true });
    expect(provider.name).toBe('forward');
    expect(provider.supportsDevLogin).toBe(false);
    expect(provider.identify(reqWith(headers))).toEqual({
      email: 'carol@example.com',
      displayName: 'Carol',
    });
  });

  test('IGNORES Remote-* headers when NOT proxied (spoofable)', () => {
    const provider = new ForwardAuthProvider({ trustProxy: false });
    expect(provider.identify(reqWith(headers))).toBeNull();
  });

  test('returns null when proxied but no email header is present', () => {
    const provider = new ForwardAuthProvider({ trustProxy: true });
    expect(provider.identify(reqWith({ 'remote-user': 'carol' }))).toBeNull();
  });

  test('falls back to Remote-User for the display name', () => {
    const provider = new ForwardAuthProvider({ trustProxy: true });
    const out = provider.identify(reqWith({ 'remote-email': 'dan@example.com', 'remote-user': 'dan' }));
    expect(out).toEqual({ email: 'dan@example.com', displayName: 'dan' });
  });
});
