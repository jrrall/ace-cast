// E4 — user accounts repository.
const { useTestDb, cleanupTestDb } = require('./helpers/testDb');

describe('UserRepository', () => {
  let db;
  let knex;
  let UserRepository;

  beforeAll(async () => {
    db = useTestDb('users');
    await db.migrateToLatest();
    knex = db.db();
    UserRepository = require('../src/content/UserRepository');
  });

  afterAll(async () => {
    await db.close();
    cleanupTestDb();
  });

  const count = async () => Number((await knex('users').count({ c: '*' }).first()).c);

  test('upsertByEmail creates a user and returns the row', async () => {
    const user = await UserRepository.upsertByEmail('Alice@Example.com', 'Alice');
    expect(user).toBeTruthy();
    expect(user.email).toBe('alice@example.com'); // normalized
    expect(user.display_name).toBe('Alice');
    expect(user.id).toBeTruthy();
    expect(await count()).toBe(1);
  });

  test('upsertByEmail is idempotent per email (same id, no duplicate)', async () => {
    const first = await UserRepository.getByEmail('alice@example.com');
    const again = await UserRepository.upsertByEmail('alice@example.com');
    expect(again.id).toBe(first.id);
    expect(await count()).toBe(1);
    // A blank display name must not wipe the stored one.
    expect(again.display_name).toBe('Alice');
  });

  test('upsertByEmail refreshes a non-empty display name', async () => {
    const updated = await UserRepository.upsertByEmail('alice@example.com', 'Alice B.');
    expect(updated.display_name).toBe('Alice B.');
    expect(await count()).toBe(1);
  });

  test('getById / getByEmail resolve the row (or undefined)', async () => {
    const byEmail = await UserRepository.getByEmail('alice@example.com');
    const byId = await UserRepository.getById(byEmail.id);
    expect(byId.email).toBe('alice@example.com');
    expect(await UserRepository.getById('nope')).toBeFalsy();
    expect(await UserRepository.getByEmail('missing@example.com')).toBeFalsy();
  });

  test('rejects an unusable email', async () => {
    expect(await UserRepository.upsertByEmail('not-an-email')).toBeUndefined();
    expect(await UserRepository.upsertByEmail('')).toBeUndefined();
    expect(await count()).toBe(1);
  });
});
