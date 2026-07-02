const { createLogger } = require('../../utils/errorHandler');
const { deepClone, immutableSet } = require('../../utils/functional');
const config = require('../../utils/config');

/**
 * Base game engine class providing common functionality
 */
class BaseGameEngine {
  constructor(room, gameType, options = {}) {
    if (this.constructor === BaseGameEngine) {
      throw new Error('BaseGameEngine is abstract and cannot be instantiated directly');
    }

    this.room = room;
    this.gameType = gameType;
    this.options = options;
    this.logger = createLogger(`GameEngine:${gameType}`);
    
    // Initialize base state
    this.state = this.createInitialState();
    this.actionHandlers = new Map();
    this.eventHandlers = new Map();
    
    // Bind methods to preserve context
    this.handlePlayerAction = this.handlePlayerAction.bind(this);
    this.handlePlayerLeave = this.handlePlayerLeave.bind(this);
    this.cleanup = this.cleanup.bind(this);

    this.setupActionHandlers();
    this.setupEventHandlers();
    
    this.logger.info('Game engine initialized', { 
      gameType, 
      playerCount: room.players.size,
      options 
    });
  }

  /**
   * Create the initial game state - must be implemented by subclasses
   * @returns {Object} - Initial game state
   */
  createInitialState() {
    return {
      phase: config.game.states.WAITING,
      players: this.initializePlayers(),
      startedAt: Date.now(),
      lastActionAt: Date.now(),
    };
  }

  /**
   * Initialize players from room data
   * @returns {Object} - Player state object
   */
  initializePlayers() {
    const players = {};
    this.room.getAllPlayers().forEach(player => {
      players[player.id] = this.createPlayerState(player);
    });
    return players;
  }

  /**
   * Create initial state for a player - can be overridden by subclasses
   * @param {Object} player - Player object from room
   * @returns {Object} - Player state
   */
  createPlayerState(player) {
    return {
      id: player.id,
      name: player.name,
      isActive: player.isActive,
      joinedAt: player.joinedAt,
      hand: [],
      score: 0,
      ready: false,
      lastActionAt: null,
    };
  }

  /**
   * Setup action handlers - should be implemented by subclasses
   */
  setupActionHandlers() {
    // Base handlers
    this.registerActionHandler('ping', this.handlePing.bind(this));
    this.registerActionHandler('get-state', this.handleGetState.bind(this));
  }

  /**
   * Setup event handlers for game events
   */
  setupEventHandlers() {
    this.registerEventHandler('player-ready', this.onPlayerReady.bind(this));
    this.registerEventHandler('game-start', this.onGameStart.bind(this));
    this.registerEventHandler('game-end', this.onGameEnd.bind(this));
  }

  /**
   * Register an action handler
   * @param {string} action - Action name
   * @param {Function} handler - Handler function
   */
  registerActionHandler(action, handler) {
    this.actionHandlers.set(action, handler);
    this.logger.debug('Action handler registered', { action });
  }

  /**
   * Register an event handler
   * @param {string} event - Event name
   * @param {Function} handler - Handler function
   */
  registerEventHandler(event, handler) {
    this.eventHandlers.set(event, handler);
    this.logger.debug('Event handler registered', { event });
  }

  /**
   * Get current game state for transmission to clients
   * @returns {Object} - Serializable game state
   */
  getGameState() {
    return {
      gameType: this.gameType,
      phase: this.state.phase,
      players: this.state.players,
      availableActions: this.getAvailableActions(),
      message: this.getCurrentMessage(),
      ...this.getCustomStateData(),
    };
  }

  /**
   * Get available actions for current game state - must be implemented by subclasses
   * @param {string} playerId - Optional: get actions for specific player
   * @returns {Array|Object} - Available actions
   */
  getAvailableActions(playerId = null) {
    const baseActions = [];
    
    if (this.state.phase === config.game.states.WAITING) {
      baseActions.push({ type: 'ping', label: 'Ping' });
    }
    
    return playerId ? { [playerId]: baseActions } : baseActions;
  }

  /**
   * Get current message to display - can be overridden by subclasses
   * @returns {string} - Current message
   */
  getCurrentMessage() {
    switch (this.state.phase) {
    case config.game.states.WAITING:
      return 'Waiting for players to join...';
    case config.game.states.PLAYING:
      return 'Game in progress';
    case config.game.states.ENDED:
      return 'Game ended';
    default:
      return 'Unknown game state';
    }
  }

  /**
   * Get custom state data to merge with base state - can be overridden by subclasses
   * @returns {Object} - Custom state data
   */
  getCustomStateData() {
    return {};
  }

  /**
   * Handle player action
   * @param {string} playerId - Player ID
   * @param {Object} actionData - Action data
   * @returns {Object|null} - Action result or null
   */
  handlePlayerAction(playerId, actionData) {
    const { action, data = {} } = actionData;
    
    this.logger.debug('Handling player action', { playerId, action, data });

    // Validate player exists and is active
    if (!this.state.players[playerId] || !this.state.players[playerId].isActive) {
      this.logger.warn('Action from inactive player', { playerId, action });
      return null;
    }

    // Find and execute action handler
    const handler = this.actionHandlers.get(action);
    if (!handler) {
      this.logger.warn('Unknown action', { playerId, action });
      return this.createErrorResult(`Unknown action: ${action}`);
    }

    try {
      // Update last action time
      this.state = immutableSet(
        this.state,
        `players.${playerId}.lastActionAt`,
        Date.now()
      );
      this.state.lastActionAt = Date.now();

      // Execute handler
      const result = handler(playerId, data);
      
      if (result) {
        // Emit event if handler returns an event
        if (result.event) {
          this.emitEvent(result.event, result.eventData || {});
        }

        this.logger.debug('Action handled successfully', { playerId, action, result });
      }

      return result;
    } catch (error) {
      this.logger.error('Action handler error', { playerId, action, error: error.message });
      return this.createErrorResult(error.message);
    }
  }

  /**
   * Handle player leaving the game
   * @param {string} playerId - Player ID
   */
  handlePlayerLeave(playerId) {
    if (this.state.players[playerId]) {
      this.logger.info('Player leaving game', { playerId, phase: this.state.phase });

      // Mark player as inactive
      this.state = immutableSet(this.state, `players.${playerId}.isActive`, false);

      // Emit event
      this.emitEvent('player-leave', { playerId });

      // Check if game should end
      this.checkGameEndConditions();
    }
  }

  /**
   * Check if game should end due to player conditions
   */
  checkGameEndConditions() {
    const activePlayers = Object.values(this.state.players).filter(p => p.isActive);
    
    if (activePlayers.length === 0) {
      this.endGame('No active players remaining');
    }
  }

  /**
   * Start the game - can be overridden by subclasses
   */
  startGame() {
    if (this.state.phase !== config.game.states.WAITING) {
      throw new Error('Game can only be started from waiting phase');
    }

    this.state.phase = config.game.states.PLAYING;
    this.state.startedAt = Date.now();
    
    this.logger.info('Game started', { playerCount: Object.keys(this.state.players).length });
    this.emitEvent('game-start', { gameType: this.gameType });
  }

  /**
   * End the game
   * @param {string} reason - Reason for ending
   */
  endGame(reason = 'Game completed') {
    this.state.phase = config.game.states.ENDED;
    this.state.endedAt = Date.now();
    this.state.endReason = reason;

    this.logger.info('Game ended', { reason, duration: Date.now() - this.state.startedAt });
    this.emitEvent('game-end', { reason, gameState: this.getGameState() });
  }

  /**
   * Emit an event to registered handlers
   * @param {string} eventName - Event name
   * @param {Object} eventData - Event data
   */
  emitEvent(eventName, eventData = {}) {
    const handler = this.eventHandlers.get(eventName);
    if (handler) {
      try {
        handler(eventData);
      } catch (error) {
        this.logger.error('Event handler error', { eventName, error: error.message });
      }
    }
  }

  /**
   * Create standardized action result
   * @param {string} type - Result type
   * @param {Object} gameState - Game state to send
   * @param {Object} metadata - Additional metadata
   * @returns {Object} - Action result
   */
  createActionResult(type = 'game-update', gameState = null, metadata = {}) {
    return {
      type,
      gameState: gameState || this.getGameState(),
      timestamp: Date.now(),
      ...metadata,
    };
  }

  /**
   * Create error result
   * @param {string} message - Error message
   * @param {string} code - Error code
   * @returns {Object} - Error result
   */
  createErrorResult(message, code = 'GAME_ERROR') {
    return {
      type: 'error',
      error: {
        message,
        code,
        timestamp: Date.now(),
      },
    };
  }

  /**
   * Base action handlers
   */
  handlePing(playerId, data) {
    return this.createActionResult('pong', null, { 
      playerId, 
      serverTime: Date.now(),
      clientTime: data.timestamp 
    });
  }

  handleGetState(playerId) {
    return this.createActionResult('state', this.getGameState());
  }

  /**
   * Base event handlers
   */
  onPlayerReady(eventData) {
    this.logger.debug('Player ready event', eventData);
  }

  onGameStart(eventData) {
    this.logger.debug('Game start event', eventData);
  }

  onGameEnd(eventData) {
    this.logger.debug('Game end event', eventData);
  }

  /**
   * Get game statistics
   * @returns {Object} - Game statistics
   */
  getStats() {
    const activePlayers = Object.values(this.state.players).filter(p => p.isActive);
    const duration = this.state.endedAt ? 
      this.state.endedAt - this.state.startedAt :
      Date.now() - this.state.startedAt;

    return {
      gameType: this.gameType,
      phase: this.state.phase,
      playerCount: Object.keys(this.state.players).length,
      activePlayerCount: activePlayers.length,
      duration,
      startedAt: this.state.startedAt,
      endedAt: this.state.endedAt,
      actionCount: this.getActionCount(),
    };
  }

  /**
   * Get total action count - can be overridden by subclasses
   * @returns {number} - Action count
   */
  getActionCount() {
    return Object.values(this.state.players).reduce(
      (count, player) => count + (player.actionCount || 0),
      0
    );
  }

  /**
   * Cleanup resources
   */
  cleanup() {
    this.logger.info('Cleaning up game engine', { gameType: this.gameType });
    
    // Clear handlers
    this.actionHandlers.clear();
    this.eventHandlers.clear();
    
    // Clear state
    this.state = null;
    
    this.logger.debug('Game engine cleanup completed');
  }

  /**
   * Export game data for persistence
   * @returns {Object} - Exportable game data
   */
  exportData() {
    return {
      gameType: this.gameType,
      options: this.options,
      state: deepClone(this.state),
      stats: this.getStats(),
      exportedAt: new Date().toISOString(),
    };
  }
}

module.exports = BaseGameEngine;