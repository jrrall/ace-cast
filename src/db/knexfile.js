/**
 * Knex CLI config. The runtime app uses `src/db/index.js`; this file just lets
 * the `knex` CLI (migrate / seed commands) share the exact same connection and
 * directories. Single source of truth is `config.getKnexConfig()`.
 *
 * Usage: knex --knexfile src/db/knexfile.js migrate:latest
 */
const fs = require('fs');
const path = require('path');
const config = require('../utils/config');

const cfg = config.getKnexConfig();

// The CLI bypasses src/db/index.js, so ensure the SQLite dir exists here too.
// (config resolves the filename to an absolute path, so dirname is stable.)
if (cfg.client === 'better-sqlite3' && cfg.connection.filename !== ':memory:') {
  fs.mkdirSync(path.dirname(cfg.connection.filename), { recursive: true });
}

module.exports = cfg;
