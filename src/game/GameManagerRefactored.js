const GameRoom = require('./GameRoom');
const config = require('../utils/config');
const { validateRoomCode } = require('../utils/validation');
const { createLogger, AppError } = require('../utils/errorHandler');
const { pipe, curry, Result, retry } = require('../utils/functional');

/**
 * Functional GameManager with improved patterns
 */
class GameManager {
  constructor() {
    this.rooms = new Map();
    this.logger = createLogger('GameManager');
  }

  /**
   * Generates a unique room code using functional approach
   * @returns {string} - Unique room code
   */
  generateRoomCode() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    
    // Pure function to generate a single code
    const generateCode = () => {
      return Array.from({ length: config.room.codeLength }, () => 
        chars.charAt(Math.floor(Math.random() * chars.length))
      ).join('');
    };

    // Pure function to check if code exists
    const codeExists = (code) => this.rooms.has(code);

    // Pure function to generate unique code
    const generateUniqueCode = (attempts = 0) => {
      if (attempts >= config.room.maxGenerationAttempts) {
        throw new AppError('Unable to generate unique room code', 500, 'CODE_GENERATION_FAILED');
      }

      const code = generateCode();
      return codeExists(code) 
        ? generateUniqueCode(attempts + 1)
        : code;
    };

    const code = generateUniqueCode();
    this.logger.debug('Generated room code', { code });
    return code;
  }

  /**
   * Creates a room with validation and error handling
   * @param {string} roomCode - The room code to create
   * @returns {Result} - Result monad containing room or error
   */
  createRoom(roomCode) {
    try {
      // Validate room code
      validateRoomCode(roomCode);

      if (this.rooms.has(roomCode)) {
        return Result.Error(new AppError('Room code already exists', 400, 'ROOM_EXISTS'));
      }

      const room = new GameRoom(roomCode);
      this.rooms.set(roomCode, room);

      this.logger.info('Room created', { roomCode, totalRooms: this.rooms.size });
      return Result.Ok(room);
    } catch (error) {
      this.logger.error('Failed to create room', { roomCode, error: error.message });
      return Result.Error(error);
    }
  }

  /**
   * Gets a room using Maybe pattern for null safety
   * @param {string} roomCode - The room code to retrieve
   * @returns {Object} - Maybe monad containing room or null
   */
  getRoom(roomCode) {
    const room = this.rooms.get(roomCode);
    return {
      room,
      exists: () => room !== undefined,
      map: (fn) => room ? fn(room) : null,
      getOrElse: (defaultValue) => room || defaultValue,
    };
  }

  /**
   * Removes a room with cleanup
   * @param {string} roomCode - The room code to remove
   * @returns {boolean} - Success status
   */
  removeRoom(roomCode) {
    const roomResult = this.getRoom(roomCode);
    
    if (!roomResult.exists()) {
      this.logger.warn('Attempted to remove non-existent room', { roomCode });
      return false;
    }

    // Perform cleanup with error handling
    const cleanup = () => {
      roomResult.map(room => room.cleanup());
      this.rooms.delete(roomCode);
      this.logger.info('Room removed', { roomCode, totalRooms: this.rooms.size });
      return true;
    };

    try {
      return cleanup();
    } catch (error) {
      this.logger.error('Failed to remove room', { roomCode, error: error.message });
      return false;
    }
  }

  /**
   * Gets all rooms as an array (functional approach)
   * @returns {Array} - Array of all rooms
   */
  getAllRooms() {
    return Array.from(this.rooms.values());
  }

  /**
   * Gets room count
   * @returns {number} - Number of rooms
   */
  getRoomCount() {
    return this.rooms.size;
  }

  /**
   * Functional room statistics
   * @returns {Object} - Room statistics
   */
  getRoomStats() {
    const rooms = this.getAllRooms();
    
    const calculateStats = pipe(
      (rooms) => ({
        total: rooms.length,
        active: rooms.filter(room => room.isGameActive).length,
        playerCounts: rooms.map(room => room.players.size),
      }),
      (stats) => ({
        ...stats,
        totalPlayers: stats.playerCounts.reduce((sum, count) => sum + count, 0),
        averagePlayersPerRoom: stats.total > 0 
          ? stats.totalPlayers / stats.total 
          : 0,
      })
    );

    return calculateStats(rooms);
  }

  /**
   * Cleanup inactive rooms with functional approach
   * @returns {number} - Number of rooms cleaned up
   */
  cleanupInactiveRooms() {
    const now = Date.now();
    const { inactiveThreshold } = config.room;

    // Pure functions for filtering
    const isInactive = (room) => 
      room.players.size === 0 && (now - room.lastActivity) > inactiveThreshold;

    const getInactiveRooms = () => 
      Array.from(this.rooms.entries())
        .filter(([, room]) => isInactive(room))
        .map(([roomCode]) => roomCode);

    // Get inactive rooms and remove them
    const inactiveRooms = getInactiveRooms();
    const cleanupResults = inactiveRooms.map(roomCode => 
      this.removeRoom(roomCode) ? 1 : 0
    );

    const cleanedCount = cleanupResults.reduce((sum, result) => sum + result, 0);
    
    if (cleanedCount > 0) {
      this.logger.info('Cleaned up inactive rooms', { 
        cleanedCount, 
        inactiveRooms,
        totalRooms: this.rooms.size 
      });
    }

    return cleanedCount;
  }

  /**
   * Find rooms by criteria (functional approach)
   * @param {Function} predicate - Filter predicate function
   * @returns {Array} - Filtered rooms
   */
  findRooms(predicate) {
    return this.getAllRooms().filter(predicate);
  }

  /**
   * Batch operations on rooms
   * @param {Array} roomCodes - Room codes to operate on
   * @param {Function} operation - Operation to perform on each room
   * @returns {Array} - Results of operations
   */
  batchOperation(roomCodes, operation) {
    return roomCodes.map(roomCode => {
      const roomResult = this.getRoom(roomCode);
      return roomResult.exists() 
        ? operation(roomResult.room, roomCode)
        : Result.Error(new AppError(`Room ${roomCode} not found`, 404, 'ROOM_NOT_FOUND'));
    });
  }

  /**
   * Get room with retry mechanism for high-load scenarios
   * @param {string} roomCode - Room code to get
   * @param {number} maxAttempts - Maximum retry attempts
   * @returns {Promise<Result>} - Promise resolving to Result monad
   */
  async getRoomWithRetry(roomCode, maxAttempts = 3) {
    const getRoomOperation = () => {
      const roomResult = this.getRoom(roomCode);
      if (roomResult.exists()) {
        return Promise.resolve(Result.Ok(roomResult.room));
      }
      return Promise.reject(new AppError('Room not found', 404, 'ROOM_NOT_FOUND'));
    };

    try {
      return await retry(getRoomOperation, maxAttempts, 100);
    } catch (error) {
      this.logger.error('Failed to get room after retries', { 
        roomCode, 
        maxAttempts, 
        error: error.message 
      });
      return Result.Error(error);
    }
  }

  /**
   * Export room data for backup/migration
   * @returns {Object} - Serializable room data
   */
  exportData() {
    const rooms = this.getAllRooms();
    
    return {
      timestamp: new Date().toISOString(),
      roomCount: rooms.length,
      rooms: rooms.map(room => ({
        code: room.code,
        playerCount: room.players.size,
        isGameActive: room.isGameActive,
        gameType: room.gameType,
        createdAt: room.createdAt,
        lastActivity: room.lastActivity,
      })),
    };
  }
}

// Create and export singleton instance
const gameManagerInstance = new GameManager();

// Enhanced interface for the singleton
const createGameManager = () => {
  // Curried helper functions
  const createRoomSafe = curry((manager, roomCode) => manager.createRoom(roomCode));
  const getRoomSafe = curry((manager, roomCode) => manager.getRoom(roomCode));
  const removeRoomSafe = curry((manager, roomCode) => manager.removeRoom(roomCode));

  return {
    ...gameManagerInstance,
    
    // Curried methods for functional composition
    createRoomSafe: createRoomSafe(gameManagerInstance),
    getRoomSafe: getRoomSafe(gameManagerInstance),
    removeRoomSafe: removeRoomSafe(gameManagerInstance),
    
    // Utility methods
    isEmpty: () => gameManagerInstance.getRoomCount() === 0,
    hasRoom: (roomCode) => gameManagerInstance.getRoom(roomCode).exists(),
    getActiveRooms: () => gameManagerInstance.findRooms(room => room.isGameActive),
    getInactiveRooms: () => gameManagerInstance.findRooms(room => !room.isGameActive),
  };
};

module.exports = createGameManager();