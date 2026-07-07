// Smoke test for the persistence foundation (E1.1a) against in-memory SQLite.
// Requires src/db inside beforeAll because tests/setup.js runs
// jest.resetModules() in afterEach, which would otherwise drop the singleton.
describe('db foundation', () => {
  let db;

  beforeAll(async () => {
    process.env.DATABASE_URL = 'sqlite://:memory:';
    db = require('../src/db');
    await db.migrateToLatest(); // no migrations yet — just sets up knex_migrations
  });

  afterAll(async () => {
    await db.close();
  });

  test('health() resolves true against a live connection', async () => {
    await expect(db.health()).resolves.toBe(true);
  });

  test('getKnexConfig selects sqlite for a sqlite: url', () => {
    const config = require('../src/utils/config');
    const cfg = config.getKnexConfig();
    expect(cfg.client).toBe('better-sqlite3');
    expect(cfg.connection.filename).toBe(':memory:');
  });

  test('getKnexConfig selects pg for a postgres: url', () => {
    const saved = process.env.DATABASE_URL;
    process.env.DATABASE_URL = 'postgres://user:pass@localhost:5432/acecast';
    jest.resetModules();
    const config = require('../src/utils/config');
    const cfg = config.getKnexConfig();
    expect(cfg.client).toBe('pg');
    expect(cfg.connection).toBe('postgres://user:pass@localhost:5432/acecast');
    process.env.DATABASE_URL = saved;
  });
});
