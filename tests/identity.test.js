// S0 — device identity token helpers + identities registry.
const { useTestDb, cleanupTestDb } = require('./helpers/testDb');
const idToken = require('../src/utils/identity');

describe('identity token', () => {
  test('makeToken / verifyToken round-trips', () => {
    const token = idToken.makeToken('abc-123');
    expect(idToken.verifyToken(token)).toBe('abc-123');
  });

  test('verifyToken rejects missing / malformed / tampered tokens', () => {
    expect(idToken.verifyToken(null)).toBeNull();
    expect(idToken.verifyToken('noDotHere')).toBeNull();
    expect(idToken.verifyToken('abc.deadbeef')).toBeNull(); // wrong signature
    expect(idToken.verifyToken(`${idToken.makeToken('abc')}x`)).toBeNull(); // altered sig
  });

  test('parseCookies parses and url-decodes a Cookie header', () => {
    const cookies = idToken.parseCookies('a=1; acecast_did=xyz%2E; b=2');
    expect(cookies.a).toBe('1');
    expect(cookies.acecast_did).toBe('xyz.');
    expect(cookies.b).toBe('2');
    expect(idToken.parseCookies(undefined)).toEqual({});
  });
});

describe('IdentityRepository', () => {
  let db;
  let IdentityRepository;

  beforeAll(async () => {
    db = useTestDb('identity');
    await db.migrateToLatest();
    IdentityRepository = require('../src/content/IdentityRepository');
  });

  afterAll(async () => {
    await db.close();
    cleanupTestDb();
  });

  test('ensure is idempotent; get returns the row (or falsy)', async () => {
    await IdentityRepository.ensure('id-1');
    await IdentityRepository.ensure('id-1'); // no duplicate
    const row = await IdentityRepository.get('id-1');
    expect(row).toBeTruthy();
    expect(row.id).toBe('id-1');
    expect(await IdentityRepository.get('nope')).toBeFalsy();
  });
});
