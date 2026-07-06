const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const path = require('path');
const QRCode = require('qrcode');
const os = require('os');

const config = require('../utils/config');

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

// Health check for cloud platforms / uptime monitors.
app.get('/healthz', (req, res) => {
  res.json({ status: 'ok', rooms: gameManager.getRoomCount(), uptime: process.uptime() });
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

app.get('/tv/:roomCode', (req, res) => {
  const { roomCode } = req.params;
  const room = gameManager.getRoom(roomCode);

  if (!room) {
    return res.status(404).render('error', {
      message: 'Room not found',
    });
  }

  return res.render('tv/index', {
    title: 'Ace Cast - TV Display',
    roomCode,
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

// Socket.IO connection handling
io.on('connection', (socket) => {
  console.log(`Client connected: ${socket.id}`);

  // Handle room joining
  socket.on('join-room', ({ roomCode, playerName, deviceType }) => {
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
      if (!name) {
        socket.emit('error', { message: 'Please enter a name' });
        return;
      }
      if (room.players.size >= config.room.maxPlayers) {
        socket.emit('error', { message: 'This room is full' });
        return;
      }

      const playerId = socket.id;
      room.addPlayer(playerId, name, socket);
      socket.playerId = playerId;

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
    }
  });

  // Handle game control from host
  socket.on('start-game', ({ gameType, options }) => {
    if (socket.deviceType !== 'host') return;

    const room = gameManager.getRoom(socket.roomCode);
    if (!room) return;

    try {
      room.startGame(gameType, options);
    } catch (error) {
      socket.emit('error', { message: error.message });
      return;
    }

    io.to(socket.roomCode).emit('game-started', { gameType });
    broadcastGameState(room);

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

    if (socket.roomCode && socket.playerId) {
      const room = gameManager.getRoom(socket.roomCode);
      if (room) {
        room.removePlayer(socket.playerId);

        // Notify remaining players
        io.to(socket.roomCode).emit('player-left', {
          playerId: socket.playerId,
          playerCount: room.players.size,
        });

        // Refresh remaining clients' game state (judge/turn may have changed).
        if (room.isGameActive) {
          broadcastGameState(room);
        }

        // Clean up empty rooms
        if (room.players.size === 0) {
          gameManager.removeRoom(socket.roomCode);
          console.log(`Room ${socket.roomCode} cleaned up (empty)`);
        }
      }
    }
  });
});

// Periodically sweep inactive/empty rooms so long-running instances don't leak.
const sweepTimer = setInterval(() => {
  gameManager.cleanupInactiveRooms();
}, config.room.sweepIntervalMs);
if (sweepTimer.unref) sweepTimer.unref();

// Start server
server.listen(PORT, config.server.host, () => {
  console.log(`🎮 Ace Cast Server running on port ${PORT}`);
  if (config.server.publicUrl) {
    console.log(`🌍 Public URL: ${config.server.publicUrl}`);
  }
  console.log(`🌐 Local Host interface: http://localhost:${PORT}`);
  console.log('');
  console.log('📲 Network URLs (for phones/tablets on the same WiFi):');
  console.log('🌐 Network Host interface:', `http://${NETWORK_IP}:${PORT}`);
  console.log(`📱 Network Player join: http://${NETWORK_IP}:${PORT}/player`);
  console.log(`📺 Network TV display: http://${NETWORK_IP}:${PORT}/tv/[ROOM_CODE]`);
});

// Graceful shutdown so cloud platforms can restart/stop the instance cleanly.
function shutdown(signal) {
  console.log(`Received ${signal}, shutting down...`);
  clearInterval(sweepTimer);
  io.close();
  server.close(() => process.exit(0));
  // Force-exit if connections don't drain in time.
  setTimeout(() => process.exit(0), 10000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

module.exports = { app, server, io };
