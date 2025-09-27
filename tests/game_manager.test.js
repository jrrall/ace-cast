// Mock GameRoom to isolate GameManager tests
jest.mock('../src/game/GameRoom', () => {
  return jest.fn().mockImplementation((code) => ({
    code,
    cleanup: jest.fn(),
    players: new Map(),
    lastActivity: Date.now(),
  }));
});

const GameRoom = require('../src/game/GameRoom');

describe('GameManager', () => {
  let GameManager;
  let gameManager;

  beforeEach(() => {
    // Fresh require to avoid singleton issues between tests
    delete require.cache[require.resolve('../src/game/GameManager')];
    GameManager = require('../src/game/GameManager');
    gameManager = GameManager;
    
    // Clear any existing rooms
    gameManager.rooms.clear();
    
    // Reset mocks
    GameRoom.mockClear();
  });

  describe('generateRoomCode', () => {
    test('should generate a 4-letter uppercase room code', () => {
      const roomCode = gameManager.generateRoomCode();
      
      expect(roomCode).toHaveLength(4);
      expect(roomCode).toMatch(/^[A-Z]{4}$/);
    });

    test('should generate unique room codes', () => {
      const codes = new Set();
      
      for (let i = 0; i < 100; i += 1) {
        codes.add(gameManager.generateRoomCode());
      }
      
      // Should generate many unique codes (allowing for some collisions due to randomness)
      expect(codes.size).toBeGreaterThan(90);
    });

    test('should avoid existing room codes', () => {
      // Create a mock room with a specific code
      const existingCode = 'AAAA';
      gameManager.rooms.set(existingCode, { code: existingCode });
      
      // Generate many codes and ensure existing code is not generated
      const codes = [];
      for (let i = 0; i < 50; i += 1) {
        codes.push(gameManager.generateRoomCode());
      }
      
      expect(codes).not.toContain(existingCode);
    });

    test('should throw error if unable to generate unique code after 100 attempts', () => {
      // Fill up all possible room codes (this is theoretical)
      // Mock Math.random to always return same value
      const originalRandom = Math.random;
      Math.random = jest.fn(() => 0); // Always return 'AAAA'
      
      // Add existing room
      gameManager.rooms.set('AAAA', { code: 'AAAA' });
      
      expect(() => {
        gameManager.generateRoomCode();
      }).toThrow('Unable to generate unique room code');
      
      // Restore Math.random
      Math.random = originalRandom;
    });
  });

  describe('createRoom', () => {
    test('should create a new room with given code', () => {
      const roomCode = 'TEST';
      
      const room = gameManager.createRoom(roomCode);

      expect(GameRoom).toHaveBeenCalledWith(roomCode);
      expect(room.code).toBe(roomCode);
      expect(gameManager.rooms.has(roomCode)).toBe(true);
      expect(gameManager.rooms.get(roomCode)).toBe(room);
    });

    test('should throw error if room code already exists', () => {
      const roomCode = 'TEST';
      gameManager.createRoom(roomCode);

      expect(() => {
        gameManager.createRoom(roomCode);
      }).toThrow('Room code already exists');
    });
  });

  describe('getRoom', () => {
    test('should return room if it exists', () => {
      const roomCode = 'TEST';
      const room = gameManager.createRoom(roomCode);

      const result = gameManager.getRoom(roomCode);

      expect(result).toBe(room);
    });

    test('should return undefined if room does not exist', () => {
      const result = gameManager.getRoom('NONEXISTENT');
      
      expect(result).toBeUndefined();
    });
  });

  describe('removeRoom', () => {
    test('should remove existing room and call cleanup', () => {
      const roomCode = 'TEST';
      const room = gameManager.createRoom(roomCode);

      const result = gameManager.removeRoom(roomCode);

      expect(result).toBe(true);
      expect(room.cleanup).toHaveBeenCalledTimes(1);
      expect(gameManager.rooms.has(roomCode)).toBe(false);
    });

    test('should return false if room does not exist', () => {
      const result = gameManager.removeRoom('NONEXISTENT');
      
      expect(result).toBe(false);
    });
  });

  describe('getAllRooms', () => {
    test('should return array of all rooms', () => {
      const room1 = gameManager.createRoom('AAA1');
      const room2 = gameManager.createRoom('BBB2');

      const allRooms = gameManager.getAllRooms();

      expect(allRooms).toHaveLength(2);
      expect(allRooms).toContain(room1);
      expect(allRooms).toContain(room2);
    });

    test('should return empty array when no rooms exist', () => {
      const allRooms = gameManager.getAllRooms();
      
      expect(allRooms).toHaveLength(0);
      expect(Array.isArray(allRooms)).toBe(true);
    });
  });

  describe('getRoomCount', () => {
    test('should return correct room count', () => {
      expect(gameManager.getRoomCount()).toBe(0);

      gameManager.createRoom('AAA1');
      expect(gameManager.getRoomCount()).toBe(1);

      gameManager.createRoom('BBB2');
      expect(gameManager.getRoomCount()).toBe(2);

      gameManager.removeRoom('AAA1');
      expect(gameManager.getRoomCount()).toBe(1);
    });
  });

  describe('cleanupInactiveRooms', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    test('should remove inactive rooms without players', () => {
      const roomCode = 'TEST';
      const room = gameManager.createRoom(roomCode);
      
      // Set lastActivity to 3 hours ago
      const threeHoursAgo = Date.now() - (3 * 60 * 60 * 1000);
      room.lastActivity = threeHoursAgo;

      gameManager.cleanupInactiveRooms();

      expect(gameManager.rooms.has(roomCode)).toBe(false);
      expect(room.cleanup).toHaveBeenCalledTimes(1);
    });

    test('should not remove rooms with players', () => {
      const roomCode = 'TEST';
      const room = gameManager.createRoom(roomCode);
      
      // Add mock players
      room.players.set('player1', { id: 'player1' });
      
      // Set lastActivity to 3 hours ago
      const threeHoursAgo = Date.now() - (3 * 60 * 60 * 1000);
      room.lastActivity = threeHoursAgo;

      gameManager.cleanupInactiveRooms();

      expect(gameManager.rooms.has(roomCode)).toBe(true);
      expect(room.cleanup).not.toHaveBeenCalled();
    });

    test('should not remove recently active rooms', () => {
      const roomCode = 'TEST';
      const room = gameManager.createRoom(roomCode);
      // lastActivity is set to current time by default

      gameManager.cleanupInactiveRooms();

      expect(gameManager.rooms.has(roomCode)).toBe(true);
      expect(room.cleanup).not.toHaveBeenCalled();
    });

    test('should handle multiple rooms correctly', () => {
      const oldRoom = gameManager.createRoom('OLD1');
      const newRoom = gameManager.createRoom('NEW1');
      const roomWithPlayers = gameManager.createRoom('PLAY');
      
      // Set some rooms as old
      const threeHoursAgo = Date.now() - (3 * 60 * 60 * 1000);
      oldRoom.lastActivity = threeHoursAgo;
      roomWithPlayers.lastActivity = threeHoursAgo;
      roomWithPlayers.players.set('player1', { id: 'player1' });

      gameManager.cleanupInactiveRooms();

      expect(gameManager.rooms.has('OLD1')).toBe(false);
      expect(gameManager.rooms.has('NEW1')).toBe(true);
      expect(gameManager.rooms.has('PLAY')).toBe(true);
      expect(oldRoom.cleanup).toHaveBeenCalledTimes(1);
      expect(newRoom.cleanup).not.toHaveBeenCalled();
      expect(roomWithPlayers.cleanup).not.toHaveBeenCalled();
    });
  });
});