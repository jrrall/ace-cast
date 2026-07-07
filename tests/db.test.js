// Smoke test for the persistence foundation (E1.1a). Uses an isolated temp-file
// DB so parallel jest workers never share state.
const { useTestDb, cleanupTestDb } = require('./helpers/testDb');

describe('db foundation', () => {
  let db;

  beforeAll(async () => {
    db = useTestDb('foundation');
    await db.migrateToLatest();
  });

  afterAll(async () => {
    await db.close();
    cleanupTestDb();
  });

  test('health() resolves true against a live connection', async () => {
    await expect(db.health()).resolves.toBe(true);
  });

  test('getKnexConfig selects sqlite (in-memory) for a sqlite: url', () => {
    const saved = process.env.DATABASE_URL;
    process.env.DATABASE_URL = 'sqlite://:memory:';
    jest.resetModules();
    const config = require('../src/utils/config');
    const cfg = config.getKnexConfig();
    expect(cfg.client).toBe('better-sqlite3');
    expect(cfg.connection.filename).toBe(':memory:');
    process.env.DATABASE_URL = saved;
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
