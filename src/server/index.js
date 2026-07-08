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
const IdentityRepository = require('../content/IdentityRepository');

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
    db: dbOk,
    rooms: gameManager.getRoomCount(),
    uptime: process.uptime(),
  });
});

// Routes
app.get('/', (req, res) => {
  res.render('host/index', { title: 'Ace Cast - Host', games: registry.listGames() });
});

// Public list of playable games (for the host UI / future clients).
app.get('/api/games', (req, res) => {
  res.json({ games: registry.listGames() });
});

app.get('/player/:roomCode', (req, res) => {
  const { roomCode } = req.params;
  res.render('player/index', {
    title: 'Ace Cast - Player',
    roomCode: roomCode || '',
  });
});

app.get('/player', (req, res) => {
  res.render('player/index', {
    title: 'Ace Cast - Player',
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
    title: 'Ace Cast - TV Display',
    roomCode,
    joinUrl,
    qrCode,
  });
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

// Broadcast + record telemetry after a bot acts (mirrors the human action path).
function afterBotAction(room, actionData) {
  broadcastGameState(room);
  recordCardOutcome(room, actionData);
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
  socket.on('join-room', ({
    roomCode, playerName, deviceType, clientId,
  }) => {
    const code = typeof roomCode === 'string' ? roomCode.toUpperCase() : '';
    if (!config.validation.roomCode.test(code)) {
      socket.emit('error', { message: 'Invalid room code' });
      return;
    }

    const room = gameManager.getRoom(code);
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
      // A human move may open a bot's turn (answer, or advance to the next round).
      bots.scheduleBotActions(room, afterBotAction);
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

  // Handle game control from host
  socket.on('start-game', async ({ gameType, options }) => {
    if (socket.deviceType !== 'host') return;

    const room = gameManager.getRoom(socket.roomCode);
    if (!room) return;

    try {
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
    } catch (error) {
      socket.emit('error', { message: error.message });
      return;
    }

    io.to(socket.roomCode).emit('game-started', { gameType });
    broadcastGameState(room);
    // Bots answer their first round.
    bots.scheduleBotActions(room, afterBotAction);

    console.log(`Game started in room ${socket.roomCode}: ${gameType}`);
  });

  // Handle ending a game from the host
  socket.on('end-game', () => {
    if (socket.deviceType !== 'host') return;

    const room = gameManager.getRoom(socket.roomCode);
    if (!room) return;

    room.endGame();

    const roomState = room.getRoomState();
    io.to(socket.roomCode).emit('game-ended', {});
    io.to(socket.roomCode).emit('room-state', {
      roomCode: roomState.code,
      players: roomState.players,
      isGameActive: roomState.isGameActive,
      gameType: roomState.gameType,
    });

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

// Periodically sweep inactive/empty rooms so long-running instances don't leak.
const sweepTimer = setInterval(() => {
  gameManager.cleanupInactiveRooms();
}, config.room.sweepIntervalMs);
if (sweepTimer.unref) sweepTimer.unref();

function logStartupBanner() {
  const port = server.address() ? server.address().port : PORT;
  console.log(`🎮 Ace Cast Server running on port ${port}`);
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
  app, server, io, start,
};
