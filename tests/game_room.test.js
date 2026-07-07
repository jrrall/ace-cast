// Mock TestGame before importing GameRoom
const mockTestGameInstance = {
  getInitialState: jest.fn(() => ({
    gameType: 'test',
    message: 'Test game started',
    phase: 'waiting',
    players: {},
  })),
  handlePlayerAction: jest.fn(() => ({ success: true })),
  handlePlayerLeave: jest.fn(),
  cleanup: jest.fn(),
};

jest.mock('../src/game/games/TestGame', () => {
  return jest.fn().mockImplementation(() => mockTestGameInstance);
});

const GameRoom = require('../src/game/GameRoom');
const TestGame = require('../src/game/games/TestGame');

describe('GameRoom', () => {
  let gameRoom;
  let mockSocket;

  beforeEach(() => {
    // The timing tests below use advanceTimersByTime; fake timers also mock
    // Date.now so lastActivity updates are observable deterministically.
    jest.useFakeTimers();
    gameRoom = new GameRoom('TEST');
    mockSocket = createMockSocket();
    TestGame.mockClear();
    // Reset all mock functions
    Object.values(mockTestGameInstance).forEach(mock => {
      if (jest.isMockFunction(mock)) {
        mock.mockClear();
      }
    });
  });

  describe('constructor', () => {
    test('should initialize with correct default values', () => {
      const room = new GameRoom('ABCD');

      expect(room.code).toBe('ABCD');
      expect(room.players.size).toBe(0);
      expect(room.isGameActive).toBe(false);
      expect(room.gameType).toBeNull();
      expect(room.gameState).toEqual({});
      expect(room.gameEngine).toBeNull();
      expect(room.createdAt).toBeLessThanOrEqual(Date.now());
      expect(room.lastActivity).toBeLessThanOrEqual(Date.now());
    });
  });

  describe('addPlayer', () => {
    test('should add player with correct properties', () => {
      const playerId = 'player1';
      const playerName = 'Test Player';

      const player = gameRoom.addPlayer(playerId, playerName, mockSocket);

      expect(player).toEqual({
        id: playerId,
        name: playerName,
        socket: mockSocket,
        joinedAt: expect.any(Number),
        isActive: true,
        connected: true,
        disconnectTimer: null,
        hand: [],
        stats: {
          gamesPlayed: 0,
          gamesWon: 0,
        },
      });

      expect(gameRoom.players.has(playerId)).toBe(true);
      expect(gameRoom.players.get(playerId)).toBe(player);
    });

    test('should update lastActivity when player is added', () => {
      const initialActivity = gameRoom.lastActivity;
      
      // Small delay to ensure different timestamp
      jest.advanceTimersByTime(1);
      gameRoom.lastActivity = Date.now() - 100;
      
      gameRoom.addPlayer('player1', 'Test Player', mockSocket);
      
      expect(gameRoom.lastActivity).toBeGreaterThan(initialActivity);
    });

    test('should handle multiple players', () => {
      const player1 = gameRoom.addPlayer('p1', 'Player 1', mockSocket);
      const player2 = gameRoom.addPlayer('p2', 'Player 2', createMockSocket());

      expect(gameRoom.players.size).toBe(2);
      expect(gameRoom.players.get('p1')).toBe(player1);
      expect(gameRoom.players.get('p2')).toBe(player2);
    });
  });

  describe('removePlayer', () => {
    test('should remove existing player', () => {
      const playerId = 'player1';
      const player = gameRoom.addPlayer(playerId, 'Test Player', mockSocket);

      const removedPlayer = gameRoom.removePlayer(playerId);

      expect(removedPlayer).toBe(player);
      expect(gameRoom.players.has(playerId)).toBe(false);
    });

    test('should return null for non-existing player', () => {
      const result = gameRoom.removePlayer('nonexistent');
      
      expect(result).toBeNull();
    });

    test('should update lastActivity when player is removed', () => {
      const playerId = 'player1';
      gameRoom.addPlayer(playerId, 'Test Player', mockSocket);
      const initialActivity = gameRoom.lastActivity;

      jest.advanceTimersByTime(1);
      gameRoom.removePlayer(playerId);
      
      expect(gameRoom.lastActivity).toBeGreaterThan(initialActivity);
    });

    test.skip('should call game engine handlePlayerLeave if game is active', () => {
      const playerId = 'player1';
      gameRoom.addPlayer(playerId, 'Test Player', mockSocket);
      gameRoom.startGame('test');
      
      const mockGameEngine = gameRoom.gameEngine;

      gameRoom.removePlayer(playerId);

      expect(mockGameEngine.handlePlayerLeave).toHaveBeenCalledWith(playerId);
    });
  });

  describe('getPlayer', () => {
    test('should return player if exists', () => {
      const playerId = 'player1';
      const player = gameRoom.addPlayer(playerId, 'Test Player', mockSocket);

      expect(gameRoom.getPlayer(playerId)).toBe(player);
    });

    test('should return undefined if player does not exist', () => {
      expect(gameRoom.getPlayer('nonexistent')).toBeUndefined();
    });
  });

  describe('getAllPlayers', () => {
    test('should return array of all players', () => {
      const player1 = gameRoom.addPlayer('p1', 'Player 1', mockSocket);
      const player2 = gameRoom.addPlayer('p2', 'Player 2', createMockSocket());

      const allPlayers = gameRoom.getAllPlayers();

      expect(allPlayers).toHaveLength(2);
      expect(allPlayers).toContain(player1);
      expect(allPlayers).toContain(player2);
    });

    test('should return empty array when no players', () => {
      const allPlayers = gameRoom.getAllPlayers();
      
      expect(allPlayers).toHaveLength(0);
      expect(Array.isArray(allPlayers)).toBe(true);
    });
  });

  describe('getActivePlayerCount', () => {
    test('should return correct count of active players', () => {
      gameRoom.addPlayer('p1', 'Player 1', mockSocket);
      const player2 = gameRoom.addPlayer('p2', 'Player 2', createMockSocket());

      expect(gameRoom.getActivePlayerCount()).toBe(2);

      // Make one player inactive
      player2.isActive = false;
      expect(gameRoom.getActivePlayerCount()).toBe(1);
    });

    test('should return 0 when no players', () => {
      expect(gameRoom.getActivePlayerCount()).toBe(0);
    });
  });

  describe.skip('startGame', () => {
    beforeEach(() => {
      // Add a player to meet minimum requirement
      gameRoom.addPlayer('player1', 'Test Player', mockSocket);
    });

    test('should start test game successfully', () => {
      const gameState = gameRoom.startGame('test');

      expect(gameRoom.isGameActive).toBe(true);
      expect(gameRoom.gameType).toBe('test');
      expect(gameRoom.gameEngine).toBeTruthy();
      expect(TestGame).toHaveBeenCalledWith(gameRoom, {});
      expect(gameState).toEqual({
        gameType: 'test',
        message: 'Test game started',
        phase: 'waiting',
        players: {},
      });
    });

    test('should pass options to game engine', () => {
      const options = { maxPlayers: 4, difficulty: 'hard' };
      
      gameRoom.startGame('test', options);

      expect(TestGame).toHaveBeenCalledWith(gameRoom, options);
    });

    test('should throw error if game already active', () => {
      gameRoom.startGame('test');

      expect(() => {
        gameRoom.startGame('test');
      }).toThrow('Game is already active in this room');
    });

    test('should throw error if not enough players', () => {
      gameRoom.removePlayer('player1');

      expect(() => {
        gameRoom.startGame('test');
      }).toThrow('Not enough players to start game');
    });

    test('should update lastActivity when game starts', () => {
      const initialActivity = gameRoom.lastActivity;

      jest.advanceTimersByTime(1);
      gameRoom.startGame('test');
      
      expect(gameRoom.lastActivity).toBeGreaterThan(initialActivity);
    });
  });

  describe.skip('endGame', () => {
    beforeEach(() => {
      gameRoom.addPlayer('player1', 'Test Player', mockSocket);
      gameRoom.startGame('test');
    });

    test('should end active game', () => {
      const mockGameEngine = gameRoom.gameEngine;
      const result = gameRoom.endGame();

      expect(result).toBe(true);
      expect(gameRoom.isGameActive).toBe(false);
      expect(gameRoom.gameType).toBeNull();
      expect(gameRoom.gameEngine).toBeNull();
      expect(gameRoom.gameState).toEqual({});
      expect(mockGameEngine.cleanup).toHaveBeenCalledTimes(1);
    });

    test('should return false if no game is active', () => {
      gameRoom.endGame();
      const result = gameRoom.endGame();

      expect(result).toBe(false);
    });

    test('should reset player hands when game ends', () => {
      const player = gameRoom.getPlayer('player1');
      player.hand = ['card1', 'card2'];

      gameRoom.endGame();

      expect(player.hand).toEqual([]);
    });

    test('should update lastActivity when game ends', () => {
      const initialActivity = gameRoom.lastActivity;

      jest.advanceTimersByTime(1);
      gameRoom.endGame();
      
      expect(gameRoom.lastActivity).toBeGreaterThan(initialActivity);
    });
  });

  describe.skip('handlePlayerAction', () => {
    beforeEach(() => {
      gameRoom.addPlayer('player1', 'Test Player', mockSocket);
      gameRoom.startGame('test');
    });

    test('should delegate to game engine when game is active', () => {
      const mockGameEngine = gameRoom.gameEngine;
      const actionData = { type: 'test-action', data: {} };
      const expectedResult = { success: true };
      
      mockGameEngine.handlePlayerAction.mockReturnValue(expectedResult);

      const result = gameRoom.handlePlayerAction('player1', actionData);

      expect(mockGameEngine.handlePlayerAction).toHaveBeenCalledWith('player1', actionData);
      expect(result).toBe(expectedResult);
    });

    test('should return null when game is not active', () => {
      gameRoom.endGame();
      
      const result = gameRoom.handlePlayerAction('player1', { type: 'test' });

      expect(result).toBeNull();
    });

    test('should return null when player does not exist', () => {
      const result = gameRoom.handlePlayerAction('nonexistent', { type: 'test' });

      expect(result).toBeNull();
    });

    test('should return null when player is not active', () => {
      const player = gameRoom.getPlayer('player1');
      player.isActive = false;
      
      const result = gameRoom.handlePlayerAction('player1', { type: 'test' });

      expect(result).toBeNull();
    });

    test('should update lastActivity when handling player action', () => {
      const initialActivity = gameRoom.lastActivity;

      jest.advanceTimersByTime(1);
      gameRoom.handlePlayerAction('player1', { type: 'test' });
      
      expect(gameRoom.lastActivity).toBeGreaterThan(initialActivity);
    });
  });

  describe('broadcastToPlayers', () => {
    test('should emit to all active players', () => {
      const socket1 = createMockSocket();
      const socket2 = createMockSocket();
      const socket3 = createMockSocket();
      
      gameRoom.addPlayer('p1', 'Player 1', socket1);
      const player2 = gameRoom.addPlayer('p2', 'Player 2', socket2);
      gameRoom.addPlayer('p3', 'Player 3', socket3);
      
      // Make one player inactive
      player2.isActive = false;

      gameRoom.broadcastToPlayers('test-event', { data: 'test' });

      expect(socket1.emit).toHaveBeenCalledWith('test-event', { data: 'test' });
      expect(socket2.emit).not.toHaveBeenCalled();
      expect(socket3.emit).toHaveBeenCalledWith('test-event', { data: 'test' });
    });
  });

  describe('sendToPlayer', () => {
    test('should emit to specific active player', () => {
      const socket1 = createMockSocket();
      const socket2 = createMockSocket();
      
      gameRoom.addPlayer('p1', 'Player 1', socket1);
      gameRoom.addPlayer('p2', 'Player 2', socket2);

      gameRoom.sendToPlayer('p1', 'test-event', { data: 'test' });

      expect(socket1.emit).toHaveBeenCalledWith('test-event', { data: 'test' });
      expect(socket2.emit).not.toHaveBeenCalled();
    });

    test('should not emit to inactive player', () => {
      const socket1 = createMockSocket();
      const player1 = gameRoom.addPlayer('p1', 'Player 1', socket1);
      player1.isActive = false;

      gameRoom.sendToPlayer('p1', 'test-event', { data: 'test' });

      expect(socket1.emit).not.toHaveBeenCalled();
    });

    test('should not emit to non-existent player', () => {
      gameRoom.sendToPlayer('nonexistent', 'test-event', { data: 'test' });
      
      // Should not throw error
    });
  });

  describe('getRoomState', () => {
    test('should return correct room state', () => {
      gameRoom.addPlayer('player1', 'Test Player', mockSocket);
      
      const roomState = gameRoom.getRoomState();

      expect(roomState).toEqual({
        code: 'TEST',
        playerCount: 1,
        activePlayerCount: 1,
        isGameActive: false,
        gameType: null,
        gameState: {},
        players: [{
          id: 'player1',
          name: 'Test Player',
          isActive: true,
          stats: {
            gamesPlayed: 0,
            gamesWon: 0,
          },
        }],
      });
    });

    test.skip('should reflect game state when game is active', () => {
      gameRoom.addPlayer('player1', 'Test Player', mockSocket);
      gameRoom.startGame('test');

      const roomState = gameRoom.getRoomState();

      expect(roomState.isGameActive).toBe(true);
      expect(roomState.gameType).toBe('test');
      expect(roomState.gameState).toEqual({
        gameType: 'test',
        message: 'Test game started',
        phase: 'waiting',
        players: {},
      });
    });
  });

  describe('cleanup', () => {
    test.skip('should disconnect all players and end game', () => {
      const socket1 = createMockSocket();
      const socket2 = createMockSocket();
      
      gameRoom.addPlayer('p1', 'Player 1', socket1);
      gameRoom.addPlayer('p2', 'Player 2', socket2);
      gameRoom.startGame('test');

      gameRoom.cleanup();

      expect(socket1.disconnect).toHaveBeenCalledTimes(1);
      expect(socket2.disconnect).toHaveBeenCalledTimes(1);
      expect(gameRoom.isGameActive).toBe(false);
      expect(gameRoom.players.size).toBe(0);
    });

    test('should handle cleanup when no players exist', () => {
      expect(() => {
        gameRoom.cleanup();
      }).not.toThrow();
    });

    test('should handle cleanup when no game is active', () => {
      const socket1 = createMockSocket();
      gameRoom.addPlayer('p1', 'Player 1', socket1);

      gameRoom.cleanup();

      expect(socket1.disconnect).toHaveBeenCalledTimes(1);
      expect(gameRoom.players.size).toBe(0);
    });
  });
});