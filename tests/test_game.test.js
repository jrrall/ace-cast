const TestGame = require('../src/game/games/TestGame');

describe('TestGame', () => {
  let testGame;
  let mockRoom;
  let mockPlayers;

  beforeEach(() => {
    // Create mock players
    mockPlayers = [
      { id: 'player1', name: 'Alice' },
      { id: 'player2', name: 'Bob' },
    ];

    // Create mock room
    mockRoom = {
      getAllPlayers: jest.fn(() => mockPlayers),
    };

    testGame = new TestGame(mockRoom, {});
  });

  describe('constructor', () => {
    test('should initialize with correct default state', () => {
      expect(testGame.room).toBe(mockRoom);
      expect(testGame.options).toEqual({});
      expect(testGame.state).toEqual({
        phase: 'waiting',
        currentPlayer: null,
        players: {
          player1: {
            id: 'player1',
            name: 'Alice',
            score: 0,
            ready: false,
          },
          player2: {
            id: 'player2',
            name: 'Bob',
            score: 0,
            ready: false,
          },
        },
        testCounter: 0,
        lastAction: null,
      });
    });

    test('should handle empty player list', () => {
      mockRoom.getAllPlayers.mockReturnValue([]);
      
      const emptyGame = new TestGame(mockRoom, {});
      
      expect(emptyGame.state.players).toEqual({});
    });

    test('should store options correctly', () => {
      const options = { maxCounter: 10, timeLimit: 300 };
      const gameWithOptions = new TestGame(mockRoom, options);
      
      expect(gameWithOptions.options).toBe(options);
    });
  });

  describe('getInitialState', () => {
    test('should return correct initial state', () => {
      const initialState = testGame.getInitialState();

      expect(initialState).toEqual({
        gameType: 'test',
        phase: 'waiting',
        players: {
          player1: {
            id: 'player1',
            name: 'Alice',
            score: 0,
            ready: false,
          },
          player2: {
            id: 'player2',
            name: 'Bob',
            score: 0,
            ready: false,
          },
        },
        testCounter: 0,
        message: 'Welcome to the test game! Click the button to increment the counter.',
        availableActions: [
          { type: 'ready', label: 'Ready Up' },
        ],
      });
    });

    test('should reflect current state changes', () => {
      testGame.state.phase = 'playing';
      testGame.state.testCounter = 5;

      const initialState = testGame.getInitialState();

      expect(initialState.phase).toBe('playing');
      expect(initialState.testCounter).toBe(5);
      expect(initialState.availableActions).toContainEqual(
        { type: 'increment', label: 'Increment Counter' }
      );
    });
  });

  describe('getAvailableActions', () => {
    test('should return ready action during waiting phase', () => {
      testGame.state.phase = 'waiting';

      const actions = testGame.getAvailableActions();

      expect(actions).toEqual([
        { type: 'ready', label: 'Ready Up' },
      ]);
    });

    test('should return game actions during playing phase', () => {
      testGame.state.phase = 'playing';

      const actions = testGame.getAvailableActions();

      expect(actions).toEqual([
        { type: 'increment', label: 'Increment Counter' },
        { type: 'reset', label: 'Reset Counter' },
      ]);
    });

    test('should return empty array for unknown phase', () => {
      testGame.state.phase = 'unknown';

      const actions = testGame.getAvailableActions();

      expect(actions).toEqual([]);
    });
  });

  describe('handlePlayerAction', () => {
    test('should delegate to correct handler based on action type', () => {
      const readySpy = jest.spyOn(testGame, 'handleReadyAction');
      const incrementSpy = jest.spyOn(testGame, 'handleIncrementAction');
      const resetSpy = jest.spyOn(testGame, 'handleResetAction');

      testGame.handlePlayerAction('player1', { action: 'ready' });
      testGame.handlePlayerAction('player1', { action: 'increment' });
      testGame.handlePlayerAction('player1', { action: 'reset' });

      expect(readySpy).toHaveBeenCalledWith('player1');
      expect(incrementSpy).toHaveBeenCalledWith('player1');
      expect(resetSpy).toHaveBeenCalledWith('player1');
    });

    test('should return null for unknown action', () => {
      const result = testGame.handlePlayerAction('player1', { action: 'unknown' });

      expect(result).toBeNull();
    });

    test('should pass data parameter correctly', () => {
      const incrementSpy = jest.spyOn(testGame, 'handleIncrementAction');
      const actionData = { action: 'increment', data: { multiplier: 2 } };

      testGame.handlePlayerAction('player1', actionData);

      expect(incrementSpy).toHaveBeenCalledWith('player1');
    });
  });

  describe('handleReadyAction', () => {
    test('should mark player as ready', () => {
      const result = testGame.handleReadyAction('player1');

      expect(testGame.state.players.player1.ready).toBe(true);
      expect(result).toBeTruthy();
      expect(result.type).toBe('game-update');
    });

    test('should return null for non-existent player', () => {
      const result = testGame.handleReadyAction('nonexistent');

      expect(result).toBeNull();
    });

    test('should transition to playing when all players are ready', () => {
      testGame.handleReadyAction('player1');
      const result = testGame.handleReadyAction('player2');

      expect(testGame.state.phase).toBe('playing');
      expect(testGame.state.currentPlayer).toBe('player1');
      expect(result.gameState.phase).toBe('playing');
    });

    test('should not transition if not all players are ready', () => {
      testGame.handleReadyAction('player1');

      expect(testGame.state.phase).toBe('waiting');
      expect(testGame.state.currentPlayer).toBeNull();
    });

    test('should include last action in result', () => {
      const result = testGame.handleReadyAction('player1');

      expect(result.gameState.lastAction).toEqual({
        type: 'ready',
        playerId: 'player1',
        playerName: 'Alice',
        timestamp: expect.any(Number),
      });
    });
  });

  describe('handleIncrementAction', () => {
    test('should increment counter and player score', () => {
      const result = testGame.handleIncrementAction('player1');

      expect(testGame.state.testCounter).toBe(1);
      expect(testGame.state.players.player1.score).toBe(1);
      expect(result.type).toBe('game-update');
    });

    test('should update last action', () => {
      testGame.handleIncrementAction('player1');

      expect(testGame.state.lastAction).toEqual({
        type: 'increment',
        playerId: 'player1',
        playerName: 'Alice',
        newCounter: 1,
        timestamp: expect.any(Number),
      });
    });

    test('should return correct game state', () => {
      const result = testGame.handleIncrementAction('player1');

      expect(result.gameState.testCounter).toBe(1);
      expect(result.gameState.message).toBe('Alice incremented the counter to 1!');
      expect(result.gameState.lastAction.type).toBe('increment');
    });

    test('should handle multiple increments', () => {
      testGame.handleIncrementAction('player1');
      testGame.handleIncrementAction('player2');
      const result = testGame.handleIncrementAction('player1');

      expect(testGame.state.testCounter).toBe(3);
      expect(testGame.state.players.player1.score).toBe(2);
      expect(testGame.state.players.player2.score).toBe(1);
      expect(result.gameState.testCounter).toBe(3);
    });
  });

  describe('handleResetAction', () => {
    beforeEach(() => {
      // Set up some state to reset
      testGame.state.testCounter = 5;
      testGame.state.players.player1.score = 3;
    });

    test('should reset counter to zero', () => {
      const result = testGame.handleResetAction('player1');

      expect(testGame.state.testCounter).toBe(0);
      expect(result.type).toBe('game-update');
    });

    test('should update last action', () => {
      testGame.handleResetAction('player1');

      expect(testGame.state.lastAction).toEqual({
        type: 'reset',
        playerId: 'player1',
        playerName: 'Alice',
        timestamp: expect.any(Number),
      });
    });

    test('should return correct game state', () => {
      const result = testGame.handleResetAction('player1');

      expect(result.gameState.testCounter).toBe(0);
      expect(result.gameState.message).toBe('Alice reset the counter!');
      expect(result.gameState.lastAction.type).toBe('reset');
    });

    test('should not affect player scores', () => {
      testGame.handleResetAction('player1');

      expect(testGame.state.players.player1.score).toBe(3);
    });
  });

  describe('handlePlayerLeave', () => {
    test('should remove player from game state', () => {
      testGame.handlePlayerLeave('player1');

      expect(testGame.state.players.player1).toBeUndefined();
      expect(testGame.state.players.player2).toBeDefined();
    });

    test('should call cleanup when no players left', () => {
      const cleanupSpy = jest.spyOn(testGame, 'cleanup');

      testGame.handlePlayerLeave('player1');
      testGame.handlePlayerLeave('player2');

      expect(cleanupSpy).toHaveBeenCalledTimes(1);
    });

    test('should not call cleanup when players remain', () => {
      const cleanupSpy = jest.spyOn(testGame, 'cleanup');

      testGame.handlePlayerLeave('player1');

      expect(cleanupSpy).not.toHaveBeenCalled();
      expect(Object.keys(testGame.state.players)).toHaveLength(1);
    });

    test('should handle non-existent player gracefully', () => {
      expect(() => {
        testGame.handlePlayerLeave('nonexistent');
      }).not.toThrow();
    });
  });

  describe('cleanup', () => {
    test('should log cleanup message', () => {
      testGame.cleanup();

      expect(console.log).toHaveBeenCalledWith('Test game cleaned up');
    });
  });

  describe('integration scenarios', () => {
    test('should handle complete game flow', () => {
      // Start with waiting phase
      expect(testGame.state.phase).toBe('waiting');

      // Players get ready
      testGame.handleReadyAction('player1');
      testGame.handleReadyAction('player2');
      expect(testGame.state.phase).toBe('playing');

      // Players increment counter
      testGame.handleIncrementAction('player1');
      testGame.handleIncrementAction('player2');
      testGame.handleIncrementAction('player1');

      expect(testGame.state.testCounter).toBe(3);
      expect(testGame.state.players.player1.score).toBe(2);
      expect(testGame.state.players.player2.score).toBe(1);

      // Reset counter
      testGame.handleResetAction('player2');
      expect(testGame.state.testCounter).toBe(0);
      expect(testGame.state.players.player1.score).toBe(2); // Scores preserved
    });

    test('should handle partial ready states', () => {
      testGame.handleReadyAction('player1');
      
      expect(testGame.state.phase).toBe('waiting');
      expect(testGame.state.players.player1.ready).toBe(true);
      expect(testGame.state.players.player2.ready).toBe(false);

      // Available actions should still be ready
      const actions = testGame.getAvailableActions();
      expect(actions).toContainEqual({ type: 'ready', label: 'Ready Up' });
    });
  });
});