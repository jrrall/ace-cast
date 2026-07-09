const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const path = require('path');
const QRCode = require('qrcode');
const os = require('os');
const crypto = require('crypto');

const config = require('../utils/config');
const identityToken = require('../utils/identity');
// App version for /healthz — semantic-release keeps package.json's version
// current post-release, so this reflects the deployed build.
const { version } = require('../../package.json');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: config.getCorsOrigin(),
    methods: ['GET', 'POST'],
  },
});

// Import game management modules
const gameManager = require('../game/GameManager');
const registry = require('../game/registry');
const dbmod = require('../db');
const DeckService = require('../content/DeckService');
const CardStatsRepository = require('../content/CardStatsRepository');
const CardEventsRepository = require('../content/CardEventsRepository');
const bots = require('./bots');
const CardFlagRepository = require('../content/CardFlagRepository');
const CardRepository = require('../content/CardRepository');
const FeedbackRepository = require('../content/FeedbackRepository');
const IdentityRepository = require('../content/IdentityRepository');
const SessionRepository = require('../content/SessionRepository');
const { isResumable } = require('../game/contract');
const auth = require('../auth');

const PORT = config.server.port;

// Trust the cloud proxy so req.protocol / req.hostname reflect the public URL.
if (config.server.trustProxy) {
  app.set('trust proxy', true);
}

// Function to get local network IP
function getNetworkIP() {
  const interfaces = os.networkInterfaces();
  const networkInterfaces = Object.keys(interfaces).reduce(
    (acc, name) => acc.concat(interfaces[name]),
    [],
  );

  const externalInterface = networkInterfaces.find(
    (networkInterface) => networkInterface.family === 'IPv4' && !networkInterface.internal,
  );

  return externalInterface ? externalInterface.address : 'localhost';
}

const NETWORK_IP = getNetworkIP();

// Resolve the public base URL for join/TV links. Prefer an explicit PUBLIC_URL,
// otherwise derive it from the (proxy-forwarded) request so links point at the
// real host in the cloud instead of a LAN IP.
function getBaseUrl(req) {
  if (config.server.publicUrl) return config.server.publicUrl;
  // Behind a proxy, the Host header stays local; the public host/proto arrive
  // via X-Forwarded-* (may be comma-separated through multiple hops).
  const first = (value) => (value || '').split(',')[0].trim();
  const proto = first(req.headers['x-forwarded-proto']) || req.protocol;
  const host = first(req.headers['x-forwarded-host']) || req.get('host');
  return `${proto}://${host}`;
}

// Middleware
app.use(cors({ origin: config.getCorsOrigin() }));
app.use(express.json());
// Form posts (the dev-login form) arrive url-encoded.
app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, '../../public')));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '../../views'));

// Device identity (S0): ensure every visitor carries a signed identity cookie so
// their card flags can be attributed (and, later, linked to an account). Issued
// on page loads; the socket reads it from the handshake.
app.use((req, res, next) => {
  const cookies = identityToken.parseCookies(req.headers.cookie);
  let id = identityToken.verifyToken(cookies[config.identity.cookieName]);
  if (!id) {
    id = crypto.randomUUID();
    res.cookie(config.identity.cookieName, identityToken.makeToken(id), {
      httpOnly: true,
      sameSite: 'lax',
      maxAge: config.identity.cookieMaxAgeMs,
      secure: config.server.trustProxy,
    });
    IdentityRepository.ensure(id).catch(() => {});
  }
  req.identityId = id;
  next();
});

// Accounts (E4). The selected provider (dev locally, forward-auth in prod) gates
// ONLY /account + its API — every gameplay path stays public. Mounted after the
// identity middleware so req.identityId is available for the guest→account merge.
const authProvider = auth.createProvider();
auth.mountAuthRoutes(app, authProvider);

// Health check for cloud platforms / uptime monitors. Probes the DB so a
// broken connection surfaces as 503 (degraded) instead of a silent 200.
app.get('/healthz', async (req, res) => {
  let dbOk = false;
  try {
    dbOk = await dbmod.health();
  } catch {
    dbOk = false;
  }
  res.status(dbOk ? 200 : 503).json({
    status: dbOk ? 'ok' : 'degraded',
    version,
    db: dbOk,
    rooms: gameManager.getRoomCount(),
    uptime: process.uptime(),
  });
});

// Routes
app.get('/', (req, res) => {
  res.render('host/index', { title: 'unholy.cards — Host', games: registry.listGames() });
});

// Public list of playable games (for the host UI / future clients).
app.get('/api/games', (req, res) => {
  res.json({ games: registry.listGames() });
});

app.get('/player/:roomCode', (req, res) => {
  const { roomCode } = req.params;
  res.render('player/index', {
    title: 'unholy.cards — Play',
    roomCode: roomCode || '',
  });
});

app.get('/player', (req, res) => {
  res.render('player/index', {
    title: 'unholy.cards — Play',
    roomCode: '',
  });
});

app.get('/tv/:roomCode', async (req, res) => {
  const { roomCode } = req.params;
  const room = gameManager.getRoom(roomCode);

  if (!room) {
    return res.status(404).render('error', {
      message: 'Room not found',
    });
  }

  // Render a join QR right on the TV so players can scan it from the couch.
  const baseUrl = getBaseUrl(req);
  const joinUrl = `${baseUrl}/player/${roomCode}`;
  let qrCode = null;
  try {
    qrCode = await QRCode.toDataURL(joinUrl, { margin: 1, width: 360 });
  } catch (error) {
    console.error('Failed to build TV join QR:', error);
  }

  return res.render('tv/index', {
    title: 'unholy.cards — TV',
    roomCode,
    joinUrl,
    qrCode,
  });
});

// F3/F4 — admin gate. No accounts yet (E4), so admin routes are gated behind a
// single shared-secret token instead: `?token=`, `X-Admin-Token`, or HTTP
// Basic (password = token, username ignored). If ADMIN_TOKEN is unset the
// whole feature is off — every admin route 404s, same as an unrecognized
// token, so an unauthenticated caller can't even tell the routes exist.
function suppliedAdminToken(req) {
  if (req.query.token) return req.query.token;
  const header = req.get('X-Admin-Token');
  if (header) return header;
  const authHeader = req.get('Authorization') || '';
  const match = /^Basic\s+(.+)$/i.exec(authHeader);
  if (!match) return null;
  const decoded = Buffer.from(match[1], 'base64').toString('utf8');
  const sep = decoded.indexOf(':');
  return sep === -1 ? decoded : decoded.slice(sep + 1);
}

function denyAdmin(req, res) {
  if (req.path.startsWith('/api/')) {
    res.status(404).json({ error: 'Not found' });
  } else {
    res.status(404).render('error', { message: 'Not found' });
  }
}

function requireAdmin(req, res, next) {
  const { token } = config.admin;
  if (!token || suppliedAdminToken(req) !== token) {
    denyAdmin(req, res);
    return;
  }
  next();
}

// F3 — feedback dashboard: per-card plays/wins/win-rate + flag counts, plus
// rollups (top winners, dead weight, most-flagged) and F4 suggested
// retirements. Same read model serves the HTML view and the JSON API.
app.get('/admin/feedback', requireAdmin, async (req, res) => {
  try {
    const dashboard = await FeedbackRepository.buildDashboard({
      minPlays: config.feedback.minPlays,
      thresholds: config.feedback,
    });
    res.render('admin/feedback', {
      title: 'unholy.cards — Feedback',
      adminToken: typeof req.query.token === 'string' ? req.query.token : '',
      ...dashboard,
    });
  } catch (error) {
    console.error('Failed to build feedback dashboard:', error);
    res.status(500).render('error', { message: 'Failed to load feedback dashboard' });
  }
});

app.get('/api/admin/feedback', requireAdmin, async (req, res) => {
  try {
    const dashboard = await FeedbackRepository.buildDashboard({
      minPlays: config.feedback.minPlays,
      thresholds: config.feedback,
    });
    res.json(dashboard);
  } catch (error) {
    console.error('Failed to build feedback dashboard:', error);
    res.status(500).json({ error: 'Failed to load feedback dashboard' });
  }
});

// F4 — explicit, reversible retirement. Not a cron: an admin acts on a
// suggestion (or their own judgment) from the dashboard.
app.post('/api/admin/cards/:id/retire', requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ error: 'Invalid card id' });
  }
  try {
    await CardRepository.retire(id);
    return res.json({ id, retired: true });
  } catch (error) {
    console.error('Failed to retire card:', error);
    return res.status(500).json({ error: 'Failed to retire card' });
  }
});

app.post('/api/admin/cards/:id/unretire', requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ error: 'Invalid card id' });
  }
  try {
    await CardRepository.unretire(id);
    return res.json({ id, retired: false });
  } catch (error) {
    console.error('Failed to unretire card:', error);
    return res.status(500).json({ error: 'Failed to unretire card' });
  }
});

// Simple in-memory, per-IP rate limiter for room creation.
const createHits = new Map(); // ip -> [timestamps]
function allowRoomCreate(ip) {
  const now = Date.now();
  const windowStart = now - config.rateLimit.createWindowMs;
  const hits = (createHits.get(ip) || []).filter((t) => t > windowStart);
  if (hits.length >= config.rateLimit.createMaxPerWindow) {
    createHits.set(ip, hits);
    return false;
  }
  hits.push(now);
  createHits.set(ip, hits);
  return true;
}

// Per-identity rate limit for card flagging.
const flagHits = new Map(); // flaggerId -> [timestamps]
function allowFlag(flaggerId) {
  const now = Date.now();
  const windowStart = now - config.rateLimit.flagWindowMs;
  const hits = (flagHits.get(flaggerId) || []).filter((t) => t > windowStart);
  if (hits.length >= config.rateLimit.flagMaxPerWindow) {
    flagHits.set(flaggerId, hits);
    return false;
  }
  hits.push(now);
  flagHits.set(flaggerId, hits);
  return true;
}

// API Routes
app.post('/api/create-room', async (req, res) => {
  try {
    if (!allowRoomCreate(req.ip)) {
      return res.status(429).json({ error: 'Too many rooms created, slow down a moment' });
    }

    if (gameManager.getRoomCount() >= config.room.maxRooms) {
      return res.status(503).json({ error: 'Server is at capacity, please try again later' });
    }

    const roomCode = gameManager.generateRoomCode();
    gameManager.createRoom(roomCode);

    // Build join/TV links from the public origin so they work when hosted.
    const baseUrl = getBaseUrl(req);
    const joinUrl = `${baseUrl}/player/${roomCode}`;
    const qrCodeDataUrl = await QRCode.toDataURL(joinUrl);

    return res.json({
      roomCode,
      joinUrl,
      qrCode: qrCodeDataUrl,
      tvUrl: `${baseUrl}/tv/${roomCode}`,
    });
  } catch (error) {
    console.error('Error creating room:', error);
    return res.status(500).json({ error: 'Failed to create room' });
  }
});

app.get('/api/room/:roomCode/status', (req, res) => {
  const room = gameManager.getRoom(req.params.roomCode);
  if (!room) {
    return res.status(404).json({ error: 'Room not found' });
  }

  return res.json({
    roomCode: room.code,
    playerCount: room.players.size,
    gameState: room.gameState,
    isGameActive: room.isGameActive,
  });
});

// Spectators (TV + host) share a sub-room so they can receive public game
// state without also receiving players' private per-socket updates.
const spectatorRoom = (roomCode) => `${roomCode}::spectators`;

// Push game state out: public state to spectators, private state to each player.
function broadcastGameState(room) {
  if (!room || !room.gameEngine) return;

  const publicState = room.gameEngine.getPublicState
    ? room.gameEngine.getPublicState()
    : room.gameEngine.getInitialState();
  io.to(spectatorRoom(room.code)).emit('game-update', { gameState: publicState });

  room.getAllPlayers().forEach((player) => {
    if (player.socket && player.isActive) {
      const view = room.gameEngine.getStateForPlayer
        ? room.gameEngine.getStateForPlayer(player.id)
        : publicState;
      player.socket.emit('game-update', { gameState: view });
    }
  });
}

// Persist per-card play/win counts (F1) after a round is resolved. Best-effort
// and fully out-of-band: any failure just logs and never blocks the broadcast.
// Recording only on 'pick-winner' means each round is counted exactly once (the
// engine still holds that round's submissions until the next round starts).
async function recordCardOutcome(room, actionData) {
  try {
    if (!actionData || actionData.action !== 'pick-winner') return;
    const engine = room.gameEngine;
    if (!engine || typeof engine.getLastRoundOutcome !== 'function') return;
    const game = registry.getGame(room.gameType);
    if (!game || !game.cardBacked) return;

    const outcome = engine.getLastRoundOutcome();
    if (!outcome) return;

    const winning = outcome.submissions.find((s) => s.won);
    // F1 rollup counters (per-card play/win totals).
    await CardStatsRepository.recordRoundOutcome({
      playedCardIds: outcome.submissions.map((s) => s.cardId),
      winningCardId: winning ? winning.cardId : null,
    });
    // F2 per-play event log (sliceable by humor / room / anonymous visitor).
    // outcome.submissions[].playerId is the player's stable clientId (cookie).
    await CardEventsRepository.recordRoundEvents({
      gameId: game.id,
      roomCode: room.code,
      blackCardId: outcome.blackCardId,
      submissions: outcome.submissions,
    });
  } catch (error) {
    console.error('Failed to record card telemetry:', error);
  }
}

// --- S1 persistent & resumable sessions -----------------------------------
// All DB access lives here in the server layer (never in the engine). Every
// path is best-effort and fully out-of-band: like recordCardOutcome it swallows
// + logs errors so a failed write can never block or crash the round loop.
// Gated behind config.session.persist (OFF under test, ON in dev/prod).

// Debounce per room so a burst of moves coalesces into a single write.
const snapshotTimers = new Map(); // roomCode -> timeout
const SNAPSHOT_DEBOUNCE_MS = 200;

// Write a snapshot of a live, resumable engine (status 'active'). No-op when
// persistence is off, the room isn't running, or the engine can't serialize.
async function writeSnapshot(room) {
  try {
    if (!config.session.persist) return;
    if (!room || !room.isGameActive || !room.gameEngine) return;
    const engine = room.gameEngine;
    if (!isResumable(engine.constructor) || typeof engine.serialize !== 'function') return;
    room.stateVersion = (room.stateVersion || 0) + 1;
    await SessionRepository.snapshot({
      roomCode: room.code,
      gameType: room.gameType,
      stateVersion: room.stateVersion,
      serializedState: engine.serialize(),
      status: 'active',
    });
  } catch (error) {
    console.error('Failed to snapshot session:', error);
  }
}

// Debounced snapshot for the hot action path.
function scheduleSnapshot(room) {
  if (!config.session.persist || !room || snapshotTimers.has(room.code)) return;
  const { code } = room;
  const timer = setTimeout(() => {
    snapshotTimers.delete(code);
    writeSnapshot(room);
  }, SNAPSHOT_DEBOUNCE_MS);
  if (timer.unref) timer.unref();
  snapshotTimers.set(code, timer);
}

// Best-effort status transition (completed / paused / abandoned / active).
async function markSession(roomCode, status) {
  try {
    if (!config.session.persist) return;
    await SessionRepository.markStatus(roomCode, status);
  } catch (error) {
    console.error(`Failed to mark session ${roomCode} as ${status}:`, error);
  }
}

// Capture the latest state and mark the session 'paused' so it can be resumed
// within the TTL. Call BEFORE removeRoom (which nulls the engine) — serialize()
// runs synchronously here, before the room is torn down.
async function pauseSession(room) {
  if (!config.session.persist || !room || !room.isGameActive || !room.gameEngine) return;
  if (!isResumable(room.gameEngine.constructor)) return;
  try {
    await writeSnapshot(room);
    await SessionRepository.markStatus(room.code, 'paused');
  } catch (error) {
    console.error(`Failed to pause session ${room.code}:`, error);
  }
}

/**
 * Lazily rebuild a room from a resumable ('active'|'paused') snapshot when it is
 * absent from memory. Returns the rebuilt room, or null if nothing resumable
 * exists. Who may resume: anyone presenting the room code (this rehydrate path);
 * seat re-attach is still gated by device identity (the clientId reconnect path
 * below), matching the live reconnect behavior.
 */
async function rehydrateRoom(code) {
  if (!config.session.persist) return null;
  try {
    const rec = await SessionRepository.getByRoomCode(code);
    if (!rec || !SessionRepository.RESUMABLE.includes(rec.status) || !rec.serializedState) {
      return null;
    }
    const game = registry.getGame(rec.gameType);
    if (!game || !isResumable(game.engine)) return null;

    const room = gameManager.createRoom(code);
    const snapshot = rec.serializedState;
    const engine = game.engine.restore(room, snapshot, {});
    room.gameEngine = engine;
    room.gameType = game.id;
    room.isGameActive = true;
    room.stateVersion = rec.stateVersion || 0;

    // Recreate seats from the snapshot. Humans come back as HELD (disconnected)
    // seats — so a returning clientId hits the reconnect path and re-attaches to
    // its exact seat — and the engine seat is paused to match. Stale bots are
    // dropped; fresh bots are re-added by reconcileBots once humans return.
    const seats = (snapshot.state && snapshot.state.players) || {};
    Object.values(seats).forEach((p) => {
      if (!p || !p.id) return;
      if (p.isBot) {
        if (typeof engine.handlePlayerLeave === 'function') engine.handlePlayerLeave(p.id);
        return;
      }
      const held = room.addPlayer(p.id, p.name, null, false);
      held.connected = false;
      held.isActive = false;
      if (typeof engine.handlePlayerDisconnect === 'function') {
        engine.handlePlayerDisconnect(p.id);
      }
    });

    room.gameState = typeof engine.getPublicState === 'function'
      ? engine.getPublicState()
      : {};

    // Revive the session row (paused -> active); subsequent moves refresh it.
    await markSession(code, 'active');
    console.log(`Room ${code} rehydrated from snapshot (v${room.stateVersion})`);
    return room;
  } catch (error) {
    console.error(`Failed to rehydrate room ${code}:`, error);
    return null;
  }
}

/**
 * Resumable-TTL sweep: mark paused sessions older than config.session
 * .resumableTtlMs as 'abandoned', then prune long-dead abandoned rows. Runs
 * alongside the in-memory room sweep.
 */
async function sweepSessions() {
  if (!config.session.persist) return;
  try {
    const ttl = config.session.resumableTtlMs;
    const cutoff = Date.now() - ttl;
    const resumable = await SessionRepository.listResumable();
    await Promise.all(resumable
      .filter((s) => s.status === 'paused' && s.lastActivity < cutoff)
      .map((s) => SessionRepository.markStatus(s.roomCode, 'abandoned')));
    await SessionRepository.pruneAbandoned(ttl);
  } catch (error) {
    console.error('Failed to sweep sessions:', error);
  }
}

// After a game is won, hold on the results for a visible countdown, then release
// the room (free the session). Idempotent — at most one countdown per room.
function startGameOverCountdown(room) {
  if (!room || room.gameOverTimer || !room.gameEngine) return;
  if (typeof room.gameEngine.getPublicState !== 'function') return;
  if (room.gameEngine.getPublicState().phase !== 'gameover') return;

  const closesInSec = Math.round(config.room.gameOverCloseMs / 1000);
  io.to(room.code).emit('game-over', { closesInSec });
  room.gameOverTimer = setTimeout(() => {
    const r = gameManager.getRoom(room.code);
    if (!r) return;
    bots.clearBotTimers(r);
    r.endGame();
    // Normal game-over: the session is done, not resumable.
    markSession(r.code, 'completed');
    io.to(r.code).emit('session-closed', {});
    gameManager.removeRoom(r.code);
    console.log(`Room ${r.code} released after game over`);
  }, config.room.gameOverCloseMs);
  if (room.gameOverTimer.unref) room.gameOverTimer.unref();
}

// Broadcast + record telemetry after a bot acts (mirrors the human action path).
function afterBotAction(room, actionData) {
  broadcastGameState(room);
  recordCardOutcome(room, actionData);
  scheduleSnapshot(room);
  startGameOverCountdown(room);
}

// --- Auto-start countdown --------------------------------------------------
// Once enough players are seated the lobby counts down and auto-starts the
// (single prod) game. The host keeps Start now / Hold + the bot controls.

// The game the lobby auto-starts: the first non-dev game in the registry
// (MadLad in prod). Null when none is registered (guarded by callers).
function defaultGame() {
  const [first] = registry.listGames();
  return first ? registry.getGame(first.id) : null;
}

// Shared "start the game now" path used by both the host's explicit Start now
// (`start-game`) and the auto-start countdown. Builds + injects a deck for
// card-backed games (engine stays pure), then boots the engine and bots. May
// throw (bad options / engine); callers decide how to surface it.
async function startGameNow(room, gameType, options = {}) {
  const game = registry.getGame(gameType);
  let startOptions = options || {};

  // Card-backed games get their deck built from the DB and injected, so the
  // engine stays pure (never touches the DB). packIds is unused until E6.
  if (game && game.cardBacked) {
    const deck = await DeckService.buildDeck({
      gameId: game.id,
      packIds: (options && options.packIds) || [],
      maturityMax: options && options.maturityMax != null ? options.maturityMax : 3,
    });
    startOptions = { ...startOptions, deck };
  }

  room.startGame(gameType, startOptions);

  io.to(room.code).emit('game-started', { gameType });
  broadcastGameState(room);
  // Persist the opening snapshot so a crash right after start is still
  // resumable (S1).
  scheduleSnapshot(room);
  // Bots answer their first round.
  bots.scheduleBotActions(room, afterBotAction);

  console.log(`Game started in room ${room.code}: ${gameType}`);
}

// Stop a running start-countdown. When `notify`, tell clients so their lobby
// reverts to the normal waiting message (skip it when the countdown is being
// superseded by an actual start, or the room is going away).
function cancelStartCountdown(room, notify = true) {
  if (!room || !room.startCountdownTimer) return;
  clearInterval(room.startCountdownTimer);
  room.startCountdownTimer = null;
  if (notify) io.to(room.code).emit('start-countdown-cancelled', {});
}

// Arm the auto-start countdown when the lobby is ready. Self-guards so it is
// safe to call on any join/leave/bot change: no-op when a game is active, a
// countdown is already running, auto-start is held, there is no default game,
// or there aren't enough active players yet.
function maybeStartCountdown(room) {
  if (!room || room.isGameActive || room.startCountdownTimer || !room.autoStart) return;
  const game = defaultGame();
  if (!game) return;
  if (room.getActivePlayerCount() < game.minPlayers) return;

  let secondsLeft = Math.max(1, Math.round(config.room.startCountdownMs / 1000));
  io.to(room.code).emit('start-countdown', { secondsLeft });

  room.startCountdownTimer = setInterval(() => {
    // Re-check the guard every tick: a game may have started, the host may have
    // held, or players may have dropped below the minimum since we armed.
    if (room.isGameActive || !room.autoStart
      || room.getActivePlayerCount() < game.minPlayers) {
      cancelStartCountdown(room);
      return;
    }
    secondsLeft -= 1;
    if (secondsLeft > 0) {
      io.to(room.code).emit('start-countdown', { secondsLeft });
      return;
    }
    // Reached zero: clear the timer (no cancel event — it's a real start) and
    // boot the game. Best-effort: never throw into the interval.
    clearInterval(room.startCountdownTimer);
    room.startCountdownTimer = null;
    startGameNow(room, game.id, {}).catch(console.error);
  }, 1000);
  if (room.startCountdownTimer.unref) room.startCountdownTimer.unref();
}

// Fill (or trim) bot seats toward room.botTarget once >= 2 humans are present.
// Humans are always preferred; bots only fill the remaining seats. Emits
// join/leave so the host + TV update. Safe to call on any join/leave (a no-op
// when the bot count already matches).
function reconcileBots(room) {
  if (!room) return;
  const humans = room.getHumanPlayers().length;
  const want = bots.desiredBotCount(humans, room.botTarget, config.room.maxPlayers);

  while (room.getBotPlayers().length < want && room.players.size < config.room.maxPlayers) {
    const name = bots.nextBotName(room.getAllPlayers().map((p) => p.name));
    const botId = `bot:${crypto.randomUUID()}`;
    room.addPlayer(botId, name, null, true);
    if (room.isGameActive && room.gameEngine && room.gameEngine.addLatePlayer) {
      room.gameEngine.addLatePlayer(botId, name);
    }
    io.to(room.code).emit('player-joined', {
      playerId: botId, playerName: name, playerCount: room.players.size, isBot: true,
    });
  }
  while (room.getBotPlayers().length > want) {
    const bot = room.getBotPlayers()[room.getBotPlayers().length - 1];
    if (bot.botTimer) { clearTimeout(bot.botTimer); bot.botTimer = null; }
    room.removePlayer(bot.id);
    io.to(room.code).emit('player-left', { playerId: bot.id, playerCount: room.players.size });
  }

  if (room.isGameActive) {
    broadcastGameState(room);
    bots.scheduleBotActions(room, afterBotAction);
  }

  // Any join/leave/bot change re-evaluates the auto-start countdown (self-guards
  // when a game is active or the table isn't ready yet).
  maybeStartCountdown(room);
}

// Socket.IO connection handling
io.on('connection', (socket) => {
  console.log(`Client connected: ${socket.id}`);

  // Resolve the device identity (S0) from the handshake cookie. A bare socket
  // client with no cookie gets an ephemeral, per-connection id so flagging still
  // works (just not durably attributed).
  const cookies = identityToken.parseCookies(socket.handshake.headers.cookie);
  const cookieId = identityToken.verifyToken(cookies[config.identity.cookieName]);
  socket.identityId = cookieId || `ephemeral:${socket.id}`;
  if (cookieId) {
    IdentityRepository.ensure(cookieId).catch(() => {});
  }

  // Handle room joining
  socket.on('join-room', async ({
    roomCode, playerName, deviceType, clientId,
  }) => {
    const code = typeof roomCode === 'string' ? roomCode.toUpperCase() : '';
    if (!config.validation.roomCode.test(code)) {
      socket.emit('error', { message: 'Invalid room code' });
      return;
    }

    let room = gameManager.getRoom(code);
    if (!room) {
      // S1: lazily rehydrate a resumable session for this code before giving up
      // (no-op when persistence is off).
      room = await rehydrateRoom(code);
    }
    if (!room) {
      socket.emit('error', { message: 'Room not found' });
      return;
    }

    socket.join(code);
    socket.roomCode = code;
    socket.deviceType = deviceType; // 'player', 'tv', 'host'

    // TV and host observe the public game state only.
    if (deviceType === 'tv' || deviceType === 'host') {
      socket.join(spectatorRoom(code));
    }

    if (deviceType === 'player') {
      const name = typeof playerName === 'string'
        ? playerName.trim().slice(0, config.validation.maxPlayerNameLength)
        : '';

      // Stable identity comes from the client's cookie clientId; fall back to
      // the (ephemeral) socket id for older clients — they still play, they
      // just can't reconnect to a held seat.
      const playerId = (typeof clientId === 'string' && clientId.trim())
        ? clientId.trim().slice(0, 64)
        : socket.id;
      socket.playerId = playerId;

      const existing = room.getPlayer(playerId);
      if (existing) {
        // Reconnect: same clientId already holds a seat — re-attach this socket
        // and resume, rather than creating a second player. No full-room check
        // (they already occupy a seat) and no name required.
        if (name) existing.name = name;
        room.reconnectPlayer(playerId, socket);
        io.to(code).emit('player-joined', {
          playerId,
          playerName: existing.name,
          playerCount: room.players.size,
        });
      } else {
        if (!name) {
          socket.emit('error', { message: 'Please enter a name' });
          return;
        }
        if (room.players.size >= config.room.maxPlayers) {
          socket.emit('error', { message: 'This room is full' });
          return;
        }

        room.addPlayer(playerId, name, socket);

        // Deal a late joiner into an in-progress game.
        if (room.isGameActive && room.gameEngine && room.gameEngine.addLatePlayer) {
          room.gameEngine.addLatePlayer(playerId, name);
        }

        // Notify all clients in room about new player
        io.to(code).emit('player-joined', {
          playerId,
          playerName: name,
          playerCount: room.players.size,
        });

        console.log(`Player ${name} joined room ${code}`);
      }
    }

    // Once >= 2 humans are in, keep the table filled with bots (they answer;
    // a human is always the Card Czar).
    reconcileBots(room);

    // Send current room state to the joining client
    const roomState = room.getRoomState();
    socket.emit('room-state', {
      roomCode: roomState.code,
      players: roomState.players,
      gameState: room.gameState,
      isGameActive: roomState.isGameActive,
      gameType: roomState.gameType,
    });

    // If a game is already running, immediately push the appropriate view.
    if (room.isGameActive) {
      broadcastGameState(room);
    }
  });

  // Handle player actions
  socket.on('player-action', (data) => {
    const room = gameManager.getRoom(socket.roomCode);
    if (!room) return;

    const result = room.handlePlayerAction(socket.playerId, data);
    if (result) {
      broadcastGameState(room);
      // Fire-and-forget: telemetry must never block or crash the round loop.
      recordCardOutcome(room, data);
      // Best-effort, debounced write-through snapshot (S1) — same out-of-band
      // discipline as telemetry above.
      scheduleSnapshot(room);
      // A human move may open a bot's turn (answer, or advance to the next round).
      bots.scheduleBotActions(room, afterBotAction);
      // If that move won the game, start the release countdown.
      startGameOverCountdown(room);
    }
  });

  // Player flags a card as not_funny / broken (F2). Persisted best-effort and
  // attributed to the device identity; rate-limited per identity.
  socket.on('flag-card', async ({ cardId, reason } = {}) => {
    const id = Number(cardId);
    if (!Number.isInteger(id) || id <= 0) return;
    if (!CardFlagRepository.REASONS.includes(reason)) return;

    const flaggerId = socket.identityId || `ephemeral:${socket.id}`;
    if (!allowFlag(flaggerId)) return;

    try {
      await CardFlagRepository.recordFlag({ cardId: id, reason, flaggerId });
      socket.emit('flag-recorded', { cardId: id, reason });
    } catch (error) {
      console.error('Failed to record card flag:', error);
    }
  });

  // Host nudges the bot fill target up/down. Bots only actually appear once
  // there are >= 2 humans (see reconcileBots / desiredBotCount).
  socket.on('add-bot', () => {
    if (socket.deviceType !== 'host') return;
    const room = gameManager.getRoom(socket.roomCode);
    if (!room) return;
    room.botTarget = Math.min(config.room.maxPlayers, room.botTarget + 1);
    reconcileBots(room);
  });

  socket.on('remove-bot', () => {
    if (socket.deviceType !== 'host') return;
    const room = gameManager.getRoom(socket.roomCode);
    if (!room) return;
    room.botTarget = Math.max(0, room.botTarget - 1);
    reconcileBots(room);
  });

  // Host toggles the auto-start behaviour: Hold (on:false) pauses any pending
  // countdown; resuming (on:true) re-arms it if the table is ready.
  socket.on('set-autostart', ({ on } = {}) => {
    if (socket.deviceType !== 'host') return;
    const room = gameManager.getRoom(socket.roomCode);
    if (!room) return;

    room.autoStart = Boolean(on);
    if (room.autoStart) {
      maybeStartCountdown(room);
    } else {
      cancelStartCountdown(room);
    }
    io.to(room.code).emit('autostart-state', { on: room.autoStart });
  });

  // Handle game control from host — "Start now" (immediate). Falls back to the
  // default game when no/invalid type is supplied, and pre-empts any countdown.
  socket.on('start-game', async ({ gameType, options } = {}) => {
    if (socket.deviceType !== 'host') return;

    const room = gameManager.getRoom(socket.roomCode);
    if (!room) return;

    // Superseding the countdown with a real start — no cancel event to clients
    // (they'll get game-started instead).
    cancelStartCountdown(room, false);

    const type = registry.getGame(gameType) ? gameType : (defaultGame() && defaultGame().id);
    if (!type) {
      socket.emit('error', { message: 'No game available to start' });
      return;
    }

    try {
      await startGameNow(room, type, options || {});
    } catch (error) {
      socket.emit('error', { message: error.message });
    }
  });

  // Handle ending a game from the host
  socket.on('end-game', () => {
    if (socket.deviceType !== 'host') return;

    const room = gameManager.getRoom(socket.roomCode);
    if (!room) return;

    if (room.gameOverTimer) {
      clearTimeout(room.gameOverTimer);
      room.gameOverTimer = null;
    }
    cancelStartCountdown(room, false);
    room.endGame();
    // Host ended the game deliberately — mark the session done (S1).
    markSession(room.code, 'completed');

    const roomState = room.getRoomState();
    io.to(socket.roomCode).emit('game-ended', {});
    io.to(socket.roomCode).emit('room-state', {
      roomCode: roomState.code,
      players: roomState.players,
      isGameActive: roomState.isGameActive,
      gameType: roomState.gameType,
    });

    // Back in the lobby: re-arm the auto-start countdown if the table is ready.
    maybeStartCountdown(room);

    console.log(`Game ended in room ${socket.roomCode}`);
  });

  socket.on('disconnect', () => {
    console.log(`Client disconnected: ${socket.id}`);

    if (!socket.roomCode || !socket.playerId) return;
    const room = gameManager.getRoom(socket.roomCode);
    if (!room) return;

    const player = room.getPlayer(socket.playerId);
    // Ignore a stale socket's disconnect after the player already reconnected on
    // a new socket (their seat now points at the newer socket, not this one).
    if (!player || player.socket !== socket) return;

    const code = socket.roomCode;
    const { playerId } = socket;

    // Hold the seat: pause the player but keep hand + score for a grace window.
    room.markDisconnected(playerId);
    io.to(code).emit('player-disconnected', {
      playerId,
      playerCount: room.players.size,
    });
    // Round math may have changed (judge reassigned / round can proceed).
    if (room.isGameActive) {
      broadcastGameState(room);
    }

    // If they don't return within the grace window, give the seat up for good.
    const timer = setTimeout(() => {
      const r = gameManager.getRoom(code);
      if (!r) return;
      const p = r.getPlayer(playerId);
      if (!p || p.connected) return; // reconnected in the meantime — keep them

      r.removePlayer(playerId);
      io.to(code).emit('player-left', { playerId, playerCount: r.players.size });

      // No humans left → tear down (don't leave bots playing to an empty room).
      if (r.getHumanPlayers().length === 0) {
        bots.clearBotTimers(r);
        // Keep the (still-active) game resumable: snapshot + pause before we
        // drop it from memory, so a returning player can rehydrate within the
        // TTL. serialize() runs before removeRoom nulls the engine.
        pauseSession(r);
        gameManager.removeRoom(code);
        console.log(`Room ${code} cleaned up (no humans left)`);
        return;
      }
      // Rebalance bots for the new human count (drops them below 2 humans) and
      // refresh the board.
      reconcileBots(r);
      if (r.isGameActive) {
        broadcastGameState(r);
      }
    }, config.room.reconnectGraceMs);
    if (timer.unref) timer.unref();
    player.disconnectTimer = timer;
  });
});

// Periodically sweep inactive/empty rooms so long-running instances don't leak,
// and (S1) abandon paused sessions past the resumable TTL + prune dead rows.
const sweepTimer = setInterval(() => {
  gameManager.cleanupInactiveRooms();
  sweepSessions();
}, config.room.sweepIntervalMs);
if (sweepTimer.unref) sweepTimer.unref();

function logStartupBanner() {
  const port = server.address() ? server.address().port : PORT;
  console.log(`🃏 unholy.cards server running on port ${port}`);
  if (config.server.publicUrl) {
    console.log(`🌍 Public URL: ${config.server.publicUrl}`);
  }
  console.log(`🌐 Local Host interface: http://localhost:${port}`);
  console.log('');
  console.log('📲 Network URLs (for phones/tablets on the same WiFi):');
  console.log('🌐 Network Host interface:', `http://${NETWORK_IP}:${port}`);
  console.log(`📱 Network Player join: http://${NETWORK_IP}:${port}/player`);
  console.log(`📺 Network TV display: http://${NETWORK_IP}:${port}/tv/[ROOM_CODE]`);
}

// Migrate + seed the DB, then start listening. Async so the DB is ready before
// the first game (which builds its deck from the DB) can start. Exported so
// tests can drive startup/teardown; auto-runs only when launched directly.
async function start() {
  if (config.db.migrateOnBoot) {
    await dbmod.migrateToLatest();
  }
  await dbmod.seedRun();
  await new Promise((resolve) => { server.listen(PORT, config.server.host, resolve); });
  logStartupBanner();
  return server;
}

if (require.main === module) {
  start().catch((err) => {
    console.error('Startup failed:', err);
    process.exit(1);
  });
}

// Graceful shutdown so cloud platforms can restart/stop the instance cleanly.
function shutdown(signal) {
  console.log(`Received ${signal}, shutting down...`);
  clearInterval(sweepTimer);
  io.close();
  server.close(async () => {
    try {
      await dbmod.close();
    } catch {
      // ignore — we're exiting anyway
    }
    process.exit(0);
  });
  // Force-exit if connections don't drain in time.
  setTimeout(() => process.exit(0), 10000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

module.exports = {
  app,
  server,
  io,
  start,
  // S1 persistence internals, exported for tests.
  rehydrateRoom,
  sweepSessions,
  writeSnapshot,
};
