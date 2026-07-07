/**
 * Database access — a single Knex instance for the app.
 *
 * The dialect (SQLite locally, Postgres in prod) is chosen from
 * `config.db.url` via `config.getKnexConfig()`. Callers use the thin helpers
 * below; nothing else should construct its own Knex instance.
 */
const fs = require('fs');
const path = require('path');
const knexLib = require('knex');
const config = require('../utils/config');

let knex = null;

// SQLite needs the parent directory to exist before it can open a file DB.
function ensureSqliteDir(knexConfig) {
  if (knexConfig.client !== 'better-sqlite3') return;
  const file = knexConfig.connection && knexConfig.connection.filename;
  if (file && file !== ':memory:') {
    fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  }
}

/**
 * Lazily create and return the shared Knex instance.
 * @returns {import('knex').Knex}
 */
function db() {
  if (!knex) {
    const cfg = config.getKnexConfig();
    ensureSqliteDir(cfg);
    knex = knexLib(cfg);
  }
  return knex;
}

/** Run all pending migrations. */
async function migrateToLatest() {
  await db().migrate.latest();
}

/** Roll back the most recent migration batch. */
async function migrateRollback() {
  await db().migrate.rollback();
}

/** Run seed files. */
async function seedRun() {
  await db().seed.run();
}

/**
 * Liveness probe: resolves true if the DB answers a trivial query.
 * @returns {Promise<boolean>}
 */
async function health() {
  await db().raw('select 1');
  return true;
}

/** Destroy the pool and reset the singleton (for shutdown / tests). */
async function close() {
  if (knex) {
    await knex.destroy();
    knex = null;
  }
}

module.exports = {
  db, migrateToLatest, migrateRollback, seedRun, health, close,
};
