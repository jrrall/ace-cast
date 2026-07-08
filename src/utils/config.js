/**
 * Central application configuration, driven by environment variables so the
 * same build runs locally and on cloud hosts (Fly / Render / Railway / etc).
 */

const path = require('path');

const toInt = (value, fallback) => {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
};

const config = {
  server: {
    port: toInt(process.env.PORT, 3000),
    host: '0.0.0.0',
    // Behind a cloud proxy, trust X-Forwarded-* so protocol/host are correct.
    trustProxy: process.env.TRUST_PROXY !== 'false',
    // Canonical public URL (e.g. https://acecast.fly.dev). If unset, it is
    // derived per-request from the forwarded host/proto headers.
    publicUrl: process.env.PUBLIC_URL ? process.env.PUBLIC_URL.replace(/\/+$/, '') : null,
    // Comma-separated allowlist, or '*' for any origin (default).
    allowedOrigins: process.env.ALLOWED_ORIGINS || '*',
  },

  room: {
    codeLength: 4,
    maxGenerationAttempts: 100,
    inactiveThreshold: toInt(process.env.ROOM_INACTIVE_MS, 2 * 60 * 60 * 1000),
    // How often to sweep inactive/empty rooms.
    sweepIntervalMs: toInt(process.env.ROOM_SWEEP_MS, 5 * 60 * 1000),
    maxPlayers: toInt(process.env.MAX_PLAYERS_PER_ROOM, 12),
    maxRooms: toInt(process.env.MAX_ROOMS, 500),
    minPlayers: 1,
    // How long a disconnected player's seat (hand + score) is held open for a
    // reconnect before it's given up. Covers phone-lock / wifi-blip / reload.
    reconnectGraceMs: toInt(process.env.RECONNECT_GRACE_MS, 90 * 1000),
    // Fill the table with bots up to this many seats once >= 2 humans join
    // (bots answer; a human is always the Card Czar). Set BOT_TARGET=0 to disable.
    botTargetDefault: toInt(process.env.BOT_TARGET, 4),
  },

  // Lightweight abuse protection for room creation (per client IP) and card
  // flagging (per device identity).
  rateLimit: {
    createWindowMs: toInt(process.env.CREATE_WINDOW_MS, 60 * 1000),
    createMaxPerWindow: toInt(process.env.CREATE_MAX_PER_WINDOW, 15),
    // Card flagging (per identity).
    flagWindowMs: toInt(process.env.FLAG_WINDOW_MS, 60 * 1000),
    flagMaxPerWindow: toInt(process.env.FLAG_MAX_PER_WINDOW, 30),
  },

  // Device identity (S0): a signed cookie that outlives socket.id, used to
  // attribute card flags now and to link accounts later.
  identity: {
    secret: process.env.IDENTITY_SECRET || 'dev-insecure-identity-secret-change-me',
    cookieName: 'acecast_did',
    cookieMaxAgeMs: toInt(process.env.IDENTITY_COOKIE_MAX_AGE_MS, 365 * 24 * 60 * 60 * 1000),
  },

  validation: {
    roomCode: /^[A-Z]{4}$/,
    maxPlayerNameLength: 32,
  },

  // Persistence. SQLite locally, Postgres in production — selected from the
  // DATABASE_URL scheme so the same build runs everywhere.
  db: {
    url: process.env.DATABASE_URL || 'sqlite://./data/ace-cast.db',
    // Run migrations automatically on server boot (idempotent). Set to
    // 'false' to manage migrations out-of-band.
    migrateOnBoot: process.env.DB_MIGRATE_ON_BOOT !== 'false',
    pool: {
      min: toInt(process.env.DB_POOL_MIN, 0),
      max: toInt(process.env.DB_POOL_MAX, 10),
    },
  },
};

/**
 * Parse the configured origin allowlist into a value usable by cors().
 * @returns {string|string[]} '*' or an array of exact origins.
 */
config.getCorsOrigin = () => {
  const raw = config.server.allowedOrigins.trim();
  if (raw === '*' || raw === '') return '*';
  return raw
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
};

// Shared migrations/seeds dirs so the runtime knex and the CLI (knexfile) agree.
const MIGRATIONS_DIR = path.join(__dirname, '..', 'db', 'migrations');
const SEEDS_DIR = path.join(__dirname, '..', 'db', 'seeds');
// Anchor for relative SQLite paths. The knex CLI changes cwd to the knexfile's
// directory, so a bare `./data/...` would resolve differently for CLI vs app.
// Resolving against the project root keeps the DB file location stable.
const PROJECT_ROOT = path.join(__dirname, '..', '..');

/**
 * Translate `config.db.url` into a Knex client config. The URL scheme picks the
 * dialect: `sqlite://<file>` (or `sqlite::memory:`) → better-sqlite3, anything
 * else (e.g. `postgres://…`) → pg.
 * @returns {object} a Knex configuration object
 */
config.getKnexConfig = () => {
  const { url } = config.db;
  const migrations = { directory: MIGRATIONS_DIR };
  const seeds = { directory: SEEDS_DIR };

  if (url.startsWith('sqlite:')) {
    let filename = url.replace(/^sqlite:(\/\/)?/, '') || './data/ace-cast.db';
    // Keep :memory: as-is; anchor relative file paths to the project root.
    if (filename !== ':memory:' && !path.isAbsolute(filename)) {
      filename = path.join(PROJECT_ROOT, filename);
    }
    return {
      client: 'better-sqlite3',
      connection: { filename },
      useNullAsDefault: true,
      migrations,
      seeds,
      pool: {
        min: 0,
        // better-sqlite3 is synchronous / single-connection.
        max: 1,
        // Enforce foreign keys on every SQLite connection.
        afterCreate: (conn, done) => {
          conn.pragma('foreign_keys = ON');
          done(null, conn);
        },
      },
    };
  }

  return {
    client: 'pg',
    connection: url,
    migrations,
    seeds,
    pool: config.db.pool,
  };
};

module.exports = config;
