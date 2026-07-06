/**
 * Central application configuration, driven by environment variables so the
 * same build runs locally and on cloud hosts (Fly / Render / Railway / etc).
 */

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
  },

  // Lightweight abuse protection for room creation (per client IP).
  rateLimit: {
    createWindowMs: toInt(process.env.CREATE_WINDOW_MS, 60 * 1000),
    createMaxPerWindow: toInt(process.env.CREATE_MAX_PER_WINDOW, 15),
  },

  validation: {
    roomCode: /^[A-Z]{4}$/,
    maxPlayerNameLength: 32,
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

module.exports = config;
