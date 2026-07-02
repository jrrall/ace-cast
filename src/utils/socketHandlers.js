const { createLogger, safeExecute } = require('./errorHandler');
const { validateRoomCode, validatePlayerName } = require('./validation');
const { throttle, debounce } = require('./functional');

/**
 * Socket event handler utilities to reduce duplication
 */

/**
 * Creates a standardized socket event handler with error handling
 * @param {string} eventName - Name of the event
 * @param {Function} handler - Handler function
 * @param {Object} options - Handler options
 * @returns {Function} - Wrapped handler function
 */
const createEventHandler = (eventName, handler, options = {}) => {
  const { 
    validation = null,
    throttleMs = 0,
    debounceMs = 0,
    requireAuth = false,
    logLevel = 'debug'
  } = options;
  
  const logger = createLogger(`SocketHandler:${eventName}`);

  let wrappedHandler = async (socket, data, ...args) => {
    const startTime = Date.now();
    
    try {
      // Log incoming event
      if (logLevel === 'debug') {
        logger.debug(`Event received`, { 
          socketId: socket.id, 
          eventName, 
          data: typeof data === 'object' ? JSON.stringify(data) : data 
        });
      }

      // Validation
      if (validation) {
        await validation(data, socket);
      }

      // Auth check
      if (requireAuth && !socket.authenticated) {
        throw new Error('Authentication required');
      }

      // Execute handler
      const result = await handler(socket, data, ...args);
      
      const duration = Date.now() - startTime;
      if (logLevel === 'debug') {
        logger.debug(`Event completed`, { socketId: socket.id, eventName, duration });
      }
      
      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      logger.error(`Event failed`, { 
        socketId: socket.id, 
        eventName, 
        error: error.message, 
        duration 
      });
      
      // Send error to client
      socket.emit('error', {
        event: eventName,
        message: error.message,
        code: error.code || 'HANDLER_ERROR'
      });
      
      throw error;
    }
  };

  // Apply throttling/debouncing
  if (throttleMs > 0) {
    wrappedHandler = throttle(wrappedHandler, throttleMs);
  } else if (debounceMs > 0) {
    wrappedHandler = debounce(wrappedHandler, debounceMs);
  }

  return wrappedHandler;
};

/**
 * Room join validation
 * @param {Object} data - Join data
 * @param {Object} socket - Socket instance
 */
const validateJoinRoom = async (data, socket) => {
  const { roomCode, playerName, deviceType } = data;

  if (!roomCode) {
    throw new Error('Room code is required');
  }

  validateRoomCode(roomCode);

  if (deviceType === 'player' && !playerName) {
    throw new Error('Player name is required for players');
  }

  if (deviceType === 'player') {
    validatePlayerName(playerName);
  }

  const validDeviceTypes = ['player', 'host', 'tv'];
  if (!validDeviceTypes.includes(deviceType)) {
    throw new Error(`Device type must be one of: ${validDeviceTypes.join(', ')}`);
  }
};

/**
 * Player action validation
 * @param {Object} data - Action data
 * @param {Object} socket - Socket instance
 */
const validatePlayerAction = async (data, socket) => {
  if (!socket.roomCode) {
    throw new Error('Must be in a room to perform actions');
  }

  if (!socket.playerId) {
    throw new Error('Player ID required for actions');
  }

  if (!data || !data.action) {
    throw new Error('Action type is required');
  }
};

/**
 * Game start validation
 * @param {Object} data - Game start data
 * @param {Object} socket - Socket instance
 */
const validateStartGame = async (data, socket) => {
  if (socket.deviceType !== 'host') {
    throw new Error('Only hosts can start games');
  }

  if (!socket.roomCode) {
    throw new Error('Must be in a room to start a game');
  }

  const { gameType } = data;
  if (!gameType) {
    throw new Error('Game type is required');
  }
};

/**
 * Standard room event handlers
 */
const createRoomHandlers = (gameManager, io) => {
  const logger = createLogger('RoomHandlers');

  const handlers = {
    /**
     * Handle room joining
     */
    'join-room': createEventHandler(
      'join-room',
      async (socket, data) => {
        const { roomCode, playerName, deviceType } = data;
        const roomResult = gameManager.getRoom(roomCode);

        if (!roomResult.exists()) {
          throw new Error('Room not found');
        }

        const room = roomResult.room;
        socket.join(roomCode);
        socket.roomCode = roomCode;
        socket.deviceType = deviceType;

        if (deviceType === 'player' && playerName) {
          const playerId = socket.id;
          room.addPlayer(playerId, playerName, socket);
          socket.playerId = playerId;

          // Notify all clients in room
          io.to(roomCode).emit('player-joined', {
            playerId,
            playerName,
            playerCount: room.players.size,
          });

          logger.info('Player joined room', { playerName, roomCode, playerId });
        }

        // Send current room state
        const roomState = room.getRoomState();
        socket.emit('room-state', {
          roomCode: roomState.code,
          players: roomState.players,
          gameState: room.gameState,
          isGameActive: roomState.isGameActive,
          gameType: roomState.gameType,
        });
      },
      { 
        validation: validateJoinRoom,
        logLevel: 'info'
      }
    ),

    /**
     * Handle player actions
     */
    'player-action': createEventHandler(
      'player-action',
      async (socket, data) => {
        const roomResult = gameManager.getRoom(socket.roomCode);
        if (!roomResult.exists()) {
          throw new Error('Room not found');
        }

        const room = roomResult.room;
        const result = room.handlePlayerAction(socket.playerId, data);

        if (result) {
          io.to(socket.roomCode).emit('game-update', result);
        }
      },
      { 
        validation: validatePlayerAction,
        throttleMs: 500 // Prevent spam
      }
    ),

    /**
     * Handle game start
     */
    'start-game': createEventHandler(
      'start-game',
      async (socket, data) => {
        const { gameType, options = {} } = data;
        const roomResult = gameManager.getRoom(socket.roomCode);
        
        if (!roomResult.exists()) {
          throw new Error('Room not found');
        }

        const room = roomResult.room;
        room.startGame(gameType, options);
        
        io.to(socket.roomCode).emit('game-started', {
          gameType,
          gameState: room.gameState,
        });

        logger.info('Game started', { roomCode: socket.roomCode, gameType });
      },
      { 
        validation: validateStartGame,
        logLevel: 'info'
      }
    ),

    /**
     * Handle disconnection
     */
    'disconnect': createEventHandler(
      'disconnect',
      async (socket) => {
        if (socket.roomCode && socket.playerId) {
          const roomResult = gameManager.getRoom(socket.roomCode);
          
          if (roomResult.exists()) {
            const room = roomResult.room;
            room.removePlayer(socket.playerId);

            // Notify remaining players
            io.to(socket.roomCode).emit('player-left', {
              playerId: socket.playerId,
              playerCount: room.players.size,
            });

            // Clean up empty rooms
            if (room.players.size === 0) {
              gameManager.removeRoom(socket.roomCode);
              logger.info('Room cleaned up (empty)', { roomCode: socket.roomCode });
            }
          }
        }

        logger.debug('Client disconnected', { socketId: socket.id });
      },
      { logLevel: 'debug' }
    ),
  };

  return handlers;
};

/**
 * Attach handlers to socket
 * @param {Object} socket - Socket instance
 * @param {Object} handlers - Event handlers
 */
const attachHandlers = (socket, handlers) => {
  Object.entries(handlers).forEach(([eventName, handler]) => {
    socket.on(eventName, (...args) => {
      safeExecute(() => handler(socket, ...args));
    });
  });
};

/**
 * Create connection handler with common setup
 * @param {Object} gameManager - Game manager instance
 * @param {Object} io - Socket.io instance
 * @returns {Function} - Connection handler
 */
const createConnectionHandler = (gameManager, io) => {
  const logger = createLogger('SocketConnection');
  const handlers = createRoomHandlers(gameManager, io);

  return (socket) => {
    logger.info('Client connected', { socketId: socket.id });

    // Attach all handlers
    attachHandlers(socket, handlers);

    // Add socket metadata
    socket.connectedAt = Date.now();
    socket.authenticated = false; // Could be used for future auth
  };
};

/**
 * Broadcast utilities
 */
const createBroadcastUtils = (io) => {
  return {
    /**
     * Broadcast to all clients in a room
     */
    toRoom: (roomCode, event, data) => {
      io.to(roomCode).emit(event, data);
    },

    /**
     * Broadcast to all clients except sender
     */
    toRoomExcept: (roomCode, socketId, event, data) => {
      io.to(roomCode).except(socketId).emit(event, data);
    },

    /**
     * Broadcast to specific device types in room
     */
    toDeviceType: (roomCode, deviceType, event, data) => {
      const room = io.sockets.adapter.rooms.get(roomCode);
      if (room) {
        room.forEach(socketId => {
          const socket = io.sockets.sockets.get(socketId);
          if (socket && socket.deviceType === deviceType) {
            socket.emit(event, data);
          }
        });
      }
    },

    /**
     * Broadcast system message to room
     */
    systemMessage: (roomCode, message, level = 'info') => {
      io.to(roomCode).emit('system-message', {
        message,
        level,
        timestamp: Date.now(),
      });
    },
  };
};

module.exports = {
  createEventHandler,
  createConnectionHandler,
  createBroadcastUtils,
  attachHandlers,
  validateJoinRoom,
  validatePlayerAction,
  validateStartGame,
};