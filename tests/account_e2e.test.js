const request = require('supertest');
const { useTestDb, cleanupTestDb } = require('./helpers/testDb');

// E4 — the accounts flow end-to-end against the real Express app with the dev
// provider (AUTH_PROVIDER defaults to 'dev'): /account is gated, a dev login
// establishes a session, and logging in merges the guest device identity into
// the account (identities.user_id).

let app;
let server;
let ioServer;
let db;
let knex;

beforeAll(async () => {
  process.env.PORT = '0';
  // Dev, un-proxied box: cookies aren't `secure`, so supertest's agent (plain
  // HTTP) round-trips them. Set before config/server are required.
  process.env.TRUST_PROXY = 'false';
  db = useTestDb('account');
  knex = db.db();
  // eslint-disable-next-line global-require
  const mod = require('../src/server/index');
  app = mod.app;
  server = mod.server;
  ioServer = mod.io;
  await mod.start(); // migrate + seed + listen
});

afterAll(async () => {
  ioServer.close();
  await new Promise((resolve) => server.close(resolve));
  await db.close();
  cleanupTestDb();
});

test('GET /account is unauthorized without a session', async () => {
  const res = await request(app).get('/account').set('Accept', 'application/json');
  expect(res.status).toBe(401);
});

test('GET /api/account is 401 without a session', async () => {
  const res = await request(app).get('/api/account');
  expect(res.status).toBe(401);
});

test('dev login establishes a session, reveals the account, and merges the device identity', async () => {
  const agent = request.agent(app);

  // Log in — issues the device (S0) cookie AND the app session cookie.
  const login = await agent
    .post('/auth/dev-login')
    .type('form')
    .send({ email: 'player@example.com', displayName: 'Player One' });
  expect(login.status).toBe(302);
  expect(login.headers.location).toBe('/account');

  // The gated page now renders the account.
  const account = await agent.get('/account');
  expect(account.status).toBe(200);
  expect(account.text).toContain('player@example.com');

  // The JSON API returns the same user.
  const api = await agent.get('/api/account');
  expect(api.status).toBe(200);
  expect(api.body.user.email).toBe('player@example.com');
  expect(api.body.user.displayName).toBe('Player One');

  // Guest→account merge: the device identity is now linked to the user.
  const user = await knex('users').where({ email: 'player@example.com' }).first();
  expect(user).toBeTruthy();
  const linked = await knex('identities').where({ user_id: user.id });
  expect(linked.length).toBe(1);
});
