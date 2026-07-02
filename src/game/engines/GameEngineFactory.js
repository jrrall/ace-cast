const BaseGameEngine = require('./BaseGameEngine');
const config = require('../../utils/config');
const { createLogger, AppError } = require('../../utils/errorHandler');
const { validateGameType } = require('../../utils/validation');

/**
 * Factory for creating game engines
 */
class GameEngineFactory {
  constructor() {
    this.engines = new Map();
    this.logger = createLogger('GameEngineFactory');
    
    // Register built-in engines
    this.registerBuiltInEngines();
  }

  /**
   * Register built-in game engines
   */
  registerBuiltInEngines() {
    // Test game engine (inline for simplicity)
    this.registerEngine(config.game.types.TEST, class TestGameEngine extends BaseGameEngine {
      createInitialState() {
        return {
          ...super.createInitialState(),
          testCounter: 0,
          lastAction: null,
        };
      }

      setupActionHandlers() {
        super.setupActionHandlers();
        this.registerActionHandler('ready', this.handleReady.bind(this));
        this.registerActionHandler('increment', this.handleIncrement.bind(this));
        this.registerActionHandler('reset', this.handleReset.bind(this));
      }

      getAvailableActions(playerId = null) {
        const actions = super.getAvailableActions(playerId);
        
        if (this.state.phase === config.game.states.WAITING) {
          actions.push({ type: 'ready', label: 'Ready Up' });
        }

        if (this.state.phase === config.game.states.PLAYING) {
          actions.push(
            { type: 'increment', label: 'Increment Counter' },
            { type: 'reset', label: 'Reset Counter' }
          );
        }

        return actions;
      }

      getCurrentMessage() {
        switch (this.state.phase) {
        case config.game.states.WAITING:
          return 'Welcome to the test game! Click Ready when you\'re ready to start.';
        case config.game.states.PLAYING:
          return `Counter: ${this.state.testCounter}. Click buttons to interact!`;
        case config.game.states.ENDED:
          return 'Test game ended. Thanks for playing!';
        default:
          return super.getCurrentMessage();
        }
      }

      getCustomStateData() {
        return {
          testCounter: this.state.testCounter,
          lastAction: this.state.lastAction,
        };
      }

      handleReady(playerId, data) {
        if (this.state.players[playerId]) {
          this.state.players[playerId].ready = true;
          
          // Check if all players are ready
          const allReady = Object.values(this.state.players).every(p => p.ready || !p.isActive);
          
          if (allReady && Object.keys(this.state.players).length > 0) {
            this.startGame();
          }

          return this.createActionResult('game-update', this.getGameState(), {
            event: 'player-ready',
            eventData: { playerId, playerName: this.state.players[playerId].name }
          });
        }

        return null;
      }

      handleIncrement(playerId, data) {
        if (this.state.phase !== config.game.states.PLAYING) {
          return this.createErrorResult('Can only increment during game play');
        }

        this.state.testCounter += 1;
        this.state.players[playerId].score += 1;
        this.state.lastAction = {
          type: 'increment',
          playerId,
          playerName: this.state.players[playerId].name,
          newCounter: this.state.testCounter,
          timestamp: Date.now(),
        };

        return this.createActionResult('game-update', this.getGameState());
      }

      handleReset(playerId, data) {
        if (this.state.phase !== config.game.states.PLAYING) {
          return this.createErrorResult('Can only reset during game play');
        }

        this.state.testCounter = 0;
        this.state.lastAction = {
          type: 'reset',
          playerId,
          playerName: this.state.players[playerId].name,
          timestamp: Date.now(),
        };

        return this.createActionResult('game-update', this.getGameState());
      }

      getActionCount() {
        return Object.values(this.state.players).reduce(
          (count, player) => count + (player.score || 0),
          0
        );
      }
    });

    this.logger.info('Built-in engines registered', { 
      engines: Array.from(this.engines.keys()) 
    });
  }

  /**
   * Register a game engine
   * @param {string} gameType - Game type identifier
   * @param {Class} EngineClass - Game engine class
   */
  registerEngine(gameType, EngineClass) {
    if (!EngineClass || typeof EngineClass !== 'function') {
      throw new AppError('Engine class must be a constructor function', 400, 'INVALID_ENGINE');
    }

    // Validate that it extends BaseGameEngine
    if (!(EngineClass.prototype instanceof BaseGameEngine)) {
      throw new AppError('Engine class must extend BaseGameEngine', 400, 'INVALID_ENGINE_BASE');
    }

    this.engines.set(gameType.toLowerCase(), EngineClass);
    this.logger.info('Game engine registered', { gameType });
  }

  /**
   * Unregister a game engine
   * @param {string} gameType - Game type identifier
   * @returns {boolean} - Success status
   */
  unregisterEngine(gameType) {
    const result = this.engines.delete(gameType.toLowerCase());
    if (result) {
      this.logger.info('Game engine unregistered', { gameType });
    }
    return result;
  }

  /**
   * Create a game engine instance
   * @param {string} gameType - Game type
   * @param {Object} room - Game room instance
   * @param {Object} options - Game options
   * @returns {BaseGameEngine} - Game engine instance
   */
  createEngine(gameType, room, options = {}) {
    try {
      validateGameType(gameType);
    } catch (error) {
      throw new AppError(`Invalid game type: ${gameType}`, 400, 'INVALID_GAME_TYPE');
    }

    const normalizedType = gameType.toLowerCase();
    const EngineClass = this.engines.get(normalizedType);

    if (!EngineClass) {
      throw new AppError(
        `No engine registered for game type: ${gameType}`, 
        404, 
        'ENGINE_NOT_FOUND'
      );
    }

    try {
      const engine = new EngineClass(room, normalizedType, options);
      this.logger.info('Game engine created', { 
        gameType: normalizedType, 
        roomCode: room.code,
        playerCount: room.players.size 
      });
      return engine;
    } catch (error) {
      this.logger.error('Failed to create game engine', { 
        gameType: normalizedType, 
        error: error.message 
      });
      throw new AppError(
        `Failed to create game engine: ${error.message}`, 
        500, 
        'ENGINE_CREATION_FAILED'
      );
    }
  }

  /**
   * Get list of available game types
   * @returns {Array} - Available game types
   */
  getAvailableGameTypes() {
    return Array.from(this.engines.keys());
  }

  /**
   * Check if a game type is supported
   * @param {string} gameType - Game type to check
   * @returns {boolean} - Support status
   */
  isSupported(gameType) {
    return this.engines.has(gameType.toLowerCase());
  }

  /**
   * Get engine info for a game type
   * @param {string} gameType - Game type
   * @returns {Object|null} - Engine info or null
   */
  getEngineInfo(gameType) {
    const normalizedType = gameType.toLowerCase();
    const EngineClass = this.engines.get(normalizedType);
    
    if (!EngineClass) {
      return null;
    }

    return {
      gameType: normalizedType,
      name: EngineClass.name,
      description: EngineClass.description || 'No description available',
      minPlayers: EngineClass.minPlayers || 1,
      maxPlayers: EngineClass.maxPlayers || config.room.maxPlayers,
      supportedOptions: EngineClass.supportedOptions || [],
    };
  }

  /**
   * Get info for all registered engines
   * @returns {Array} - Array of engine info objects
   */
  getAllEngineInfo() {
    return this.getAvailableGameTypes().map(gameType => 
      this.getEngineInfo(gameType)
    ).filter(info => info !== null);
  }

  /**
   * Validate engine compatibility with room
   * @param {string} gameType - Game type
   * @param {Object} room - Game room
   * @returns {Object} - Validation result
   */
  validateCompatibility(gameType, room) {
    const info = this.getEngineInfo(gameType);
    
    if (!info) {
      return {
        compatible: false,
        reasons: [`Game type ${gameType} is not supported`],
      };
    }

    const reasons = [];
    const playerCount = room.players.size;

    if (playerCount < info.minPlayers) {
      reasons.push(`Minimum ${info.minPlayers} players required, only ${playerCount} present`);
    }

    if (playerCount > info.maxPlayers) {
      reasons.push(`Maximum ${info.maxPlayers} players allowed, ${playerCount} present`);
    }

    return {
      compatible: reasons.length === 0,
      reasons,
      info,
    };
  }

  /**
   * Create engine with validation
   * @param {string} gameType - Game type
   * @param {Object} room - Game room
   * @param {Object} options - Game options
   * @returns {BaseGameEngine} - Game engine instance
   */
  createEngineWithValidation(gameType, room, options = {}) {
    const compatibility = this.validateCompatibility(gameType, room);
    
    if (!compatibility.compatible) {
      throw new AppError(
        `Game not compatible: ${compatibility.reasons.join(', ')}`,
        400,
        'GAME_INCOMPATIBLE'
      );
    }

    return this.createEngine(gameType, room, options);
  }

  /**
   * Export factory data
   * @returns {Object} - Factory state
   */
  exportData() {
    return {
      registeredEngines: this.getAvailableGameTypes(),
      engineInfo: this.getAllEngineInfo(),
      timestamp: new Date().toISOString(),
    };
  }
}

// Create singleton instance
const gameEngineFactory = new GameEngineFactory();

module.exports = gameEngineFactory;