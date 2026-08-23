// F2 (Card Forge) — service/client tokens for the content API. Real-server
// supertest, mirroring content_api.test.js. Covers the credential lifecycle
// (mint → use → revoke), scope enforcement, attribution, and the 404/401/403
// distinction that keeps the API hidden when it is off.
const request = require('supertest');
const { useTestDb, cleanupTestDb } = require('./helpers/testDb');

describe('Service tokens (content API machine auth)', () => {
  let db;
  let app;
  let server;
  let ioServer;
  let ServiceTokenRepository;

  beforeAll(async () => {
    process.env.PORT = '0';
    // NOTE: no CONTENT_API_TOKEN — these tests exercise the service-token path
    // on its own, including "feature off" before any token is minted.
    delete process.env.CONTENT_API_TOKEN;
    process.env.ADMIN_TOKEN = 'admin-secret';
    db = useTestDb('service-tokens');
    // eslint-disable-next-line global-require
    const mod = require('../src/server/index');
    app = mod.app;
    server = mod.server;
    ioServer = mod.io;
    // eslint-disable-next-line global-require
    ServiceTokenRepository = require('../src/content/ServiceTokenRepository');
    await mod.start();
  });

  afterAll(async () => {
    ioServer.close();
    await new Promise((resolve) => server.close(resolve));
    await db.close();
    cleanupTestDb();
    delete process.env.ADMIN_TOKEN;
  });

  describe('feature-off semantics', () => {
    test('no shared secret and no minted token → 404, not 401', async () => {
      // The API must not advertise its own existence to an unauthenticated
      // prober. 401 would confirm the route is real.
      const res = await request(app)
        .get('/api/content/cards')
        .set('Authorization', 'Bearer ct_live_nope');
      expect(res.status).toBe(404);
    });
  });

  describe('minting and using a token', () => {
    let token;

    beforeAll(async () => {
      const created = await ServiceTokenRepository.create({
        clientId: 'card-forge-test',
        name: 'Card Forge (test)',
      });
      token = created.token;
    });

    test('the minted token is prefixed and high-entropy', () => {
      expect(token.startsWith('ct_live_')).toBe(true);
      // 32 random bytes in base64url — comfortably above any guessing budget.
      expect(token.length).toBeGreaterThan(40);
    });

    test('plaintext is never stored — only its sha256', async () => {
      const rows = await ServiceTokenRepository.list();
      const serialized = JSON.stringify(rows);
      expect(serialized).not.toContain(token);
    });

    test('a valid token authenticates a read', async () => {
      const res = await request(app)
        .get('/api/content/cards')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
    });

    test('a wrong token is 401 now that the feature is on', async () => {
      const res = await request(app)
        .get('/api/content/cards')
        .set('Authorization', 'Bearer ct_live_wrong');
      expect(res.status).toBe(401);
    });

    test('using a token records last_used_at', async () => {
      await request(app)
        .get('/api/content/cards')
        .set('Authorization', `Bearer ${token}`);
      // touch() is intentionally not awaited by the middleware; give the
      // best-effort write a turn of the event loop to land.
      await new Promise((resolve) => { setTimeout(resolve, 50); });
      const rows = await ServiceTokenRepository.list();
      const row = rows.find((r) => r.client_id === 'card-forge-test');
      expect(row.last_used_at).toBeTruthy();
    });
  });

  describe('scopes', () => {
    test('a read-only token cannot write', async () => {
      const { token } = await ServiceTokenRepository.create({
        clientId: 'reader-only',
        scopes: 'content:read',
      });
      const read = await request(app)
        .get('/api/content/cards')
        .set('Authorization', `Bearer ${token}`);
      expect(read.status).toBe(200);

      const write = await request(app)
        .post('/api/content/cards')
        .set('Authorization', `Bearer ${token}`)
        .send({ cards: [] });
      // 403, not 401: the credential is valid, the grant is not.
      expect(write.status).toBe(403);
      expect(write.body.error).toMatch(/scope/i);
    });

    test('a write-only token cannot read the dedupe corpus', async () => {
      const { token } = await ServiceTokenRepository.create({
        clientId: 'writer-only',
        scopes: 'content:write',
      });
      const res = await request(app)
        .get('/api/content/cards')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(403);
    });
  });

  describe('revocation', () => {
    test('a revoked token stops working immediately', async () => {
      const { token } = await ServiceTokenRepository.create({ clientId: 'doomed' });
      const before = await request(app)
        .get('/api/content/cards')
        .set('Authorization', `Bearer ${token}`);
      expect(before.status).toBe(200);

      expect(await ServiceTokenRepository.revoke('doomed')).toBe(true);

      const after = await request(app)
        .get('/api/content/cards')
        .set('Authorization', `Bearer ${token}`);
      expect(after.status).toBe(401);
    });

    test('revoking one client does not affect another', async () => {
      const a = await ServiceTokenRepository.create({ clientId: 'agent-a' });
      const b = await ServiceTokenRepository.create({ clientId: 'agent-b' });
      await ServiceTokenRepository.revoke('agent-a');

      const resA = await request(app)
        .get('/api/content/cards')
        .set('Authorization', `Bearer ${a.token}`);
      const resB = await request(app)
        .get('/api/content/cards')
        .set('Authorization', `Bearer ${b.token}`);
      expect(resA.status).toBe(401);
      expect(resB.status).toBe(200); // the whole point of per-client tokens
    });

    test('a revoked row is retained so past submissions stay attributable', async () => {
      const rows = await ServiceTokenRepository.list();
      const doomed = rows.find((r) => r.client_id === 'doomed');
      expect(doomed).toBeDefined();
      expect(doomed.revoked_at).toBeTruthy();
    });

    test('revoking an unknown client reports no-op rather than throwing', async () => {
      expect(await ServiceTokenRepository.revoke('never-existed')).toBe(false);
    });
  });

  describe('client_id uniqueness', () => {
    test('re-minting for a LIVE client_id is rejected', async () => {
      await ServiceTokenRepository.create({ clientId: 'unique-client' });
      await expect(ServiceTokenRepository.create({ clientId: 'unique-client' }))
        .rejects.toThrow();
    });

    test('rotation works: revoke then re-mint the SAME client_id', async () => {
      // Retaining revoked rows for attribution must not block rotation --
      // a plain UNIQUE(client_id) would, and rotation is the whole point of
      // having revocable credentials.
      const first = await ServiceTokenRepository.create({ clientId: 'rotating-client' });
      await ServiceTokenRepository.revoke('rotating-client');

      const second = await ServiceTokenRepository.create({ clientId: 'rotating-client' });
      expect(second.token).not.toBe(first.token);

      // The new credential works, the old one is dead, and both rows survive.
      const live = await request(app)
        .get('/api/content/cards')
        .set('Authorization', `Bearer ${second.token}`);
      expect(live.status).toBe(200);

      const dead = await request(app)
        .get('/api/content/cards')
        .set('Authorization', `Bearer ${first.token}`);
      expect(dead.status).toBe(401);

      const rows = (await ServiceTokenRepository.list())
        .filter((r) => r.client_id === 'rotating-client');
      expect(rows).toHaveLength(2);
      expect(rows.filter((r) => !r.revoked_at)).toHaveLength(1);
    });
  });
});
