const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const path = require('path');
const QRCode = require('qrcode');
// const { v4: uuidv4 } = require('uuid'); // TODO: Use when needed
const os = require('os');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
});

// Import game management modules
const gameManager = require('../game/GameManager');

const PORT = process.env.PORT || 3000;

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

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../../public')));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '../../views'));

// Routes
app.get('/', (req, res) => {
  res.render('host/index', { title: 'Ace Cast - Host' });
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

// API Routes
app.post('/api/create-room', async (req, res) => {
  try {
    const roomCode = gameManager.generateRoomCode();
    gameManager.createRoom(roomCode);

    // Generate QR code for easy joining
    const baseUrl = `http://${NETWORK_IP}:${PORT}`;
    const joinUrl = `${baseUrl}/player/${roomCode}`;
    const qrCodeDataUrl = await QRCode.toDataURL(joinUrl);

    res.json({
      roomCode,
      joinUrl,
      qrCode: qrCodeDataUrl,
      tvUrl: `${baseUrl}/tv/${roomCode}`,
    });
  } catch (error) {
    console.error('Error creating room:', error);
    res.status(500).json({ error: 'Failed to create room' });
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

// Socket.IO connection handling
io.on('connection', (socket) => {
  console.log(`Client connected: ${socket.id}`);

  // Handle room joining
  socket.on('join-room', ({ roomCode, playerName, deviceType }) => {
    const room = gameManager.getRoom(roomCode);

    if (!room) {
      socket.emit('error', { message: 'Room not found' });
      return;
    }

    socket.join(roomCode);
    socket.roomCode = roomCode;
    socket.deviceType = deviceType; // 'player', 'tv', 'host'

    if (deviceType === 'player' && playerName) {
      const playerId = socket.id;
      room.addPlayer(playerId, playerName, socket);
      socket.playerId = playerId;

      // Notify all clients in room about new player
      io.to(roomCode).emit('player-joined', {
        playerId,
        playerName,
        playerCount: room.players.size,
      });

      console.log(`Player ${playerName} joined room ${roomCode}`);
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
  });

  // Handle player actions
  socket.on('player-action', (data) => {
    const room = gameManager.getRoom(socket.roomCode);
    if (!room) return;

    // Process the player action through the game engine
    const result = room.handlePlayerAction(socket.playerId, data);

    if (result) {
      // Broadcast the action result to all clients in the room
      io.to(socket.roomCode).emit('game-update', result);
    }
  });

  // Handle game control from host
  socket.on('start-game', ({ gameType, options }) => {
    if (socket.deviceType !== 'host') return;

    const room = gameManager.getRoom(socket.roomCode);
    if (!room) return;

    room.startGame(gameType, options);
    io.to(socket.roomCode).emit('game-started', {
      gameType,
      gameState: room.gameState,
    });

    console.log(`Game started in room ${socket.roomCode}: ${gameType}`);
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

        // Clean up empty rooms
        if (room.players.size === 0) {
          gameManager.removeRoom(socket.roomCode);
          console.log(`Room ${socket.roomCode} cleaned up (empty)`);
        }
      }
    }
  });
});

// Start server
server.listen(PORT, '0.0.0.0', () => {
  console.log(`🎮 Ace Cast Server running on port ${PORT}`);
  console.log(`🌐 Local Host interface: http://localhost:${PORT}`);
  console.log(`📱 Local Player join: http://localhost:${PORT}/player`);
  console.log('');
  console.log('📲 Network URLs (for phones/tablets):');
  console.log('🌐 Network Host interface:', `http://${NETWORK_IP}:${PORT}`);
  console.log(`📱 Network Player join: http://${NETWORK_IP}:${PORT}/player`);
  console.log(`📺 Network TV display: http://${NETWORK_IP}:${PORT}/tv/[ROOM_CODE]`);
});

module.exports = { app, server, io };
