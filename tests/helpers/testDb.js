const os = require('os');
const path = require('path');
const fs = require('fs');

/**
 * Test DB isolation. Each DB-using test file gets its own on-disk SQLite file so
 * jest's parallel workers never share `:memory:` state (which flakes under load).
 *
 * Usage:
 *   let db;
 *   beforeAll(async () => { db = useTestDb('deck'); await db.migrateToLatest(); });
 *   afterAll(async () => { await db.close(); cleanupTestDb(); });
 */
let dbFile = null;

/**
 * Point DATABASE_URL at a unique temp file and return a fresh `src/db` module.
 * Must be called before the db module is required (it reads the URL on load).
 * @param {string} label short tag for the temp filename
 * @returns {object} the src/db module
 */
function useTestDb(label) {
  const unique = `${process.pid}-${Math.random().toString(36).slice(2)}`;
  dbFile = path.join(os.tmpdir(), `acecast-test-${label}-${unique}.db`);
  process.env.DATABASE_URL = `sqlite://${dbFile}`;
  // eslint-disable-next-line global-require
  return require('../../src/db');
}

/** Delete the temp DB file created by useTestDb(). */
function cleanupTestDb() {
  if (dbFile && fs.existsSync(dbFile)) fs.unlinkSync(dbFile);
  dbFile = null;
}

module.exports = { useTestDb, cleanupTestDb };
