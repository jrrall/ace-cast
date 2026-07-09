const registry = require('./registry');
const { validateEngine } = require('./contract');
const config = require('../utils/config');

class GameRoom {
  constructor(code) {
    this.code = code;
    this.players = new Map(); // Map of playerId -> player object
    this.isGameActive = false;
    this.gameType = null;
    this.gameState = {};
    this.gameEngine = null;
    this.createdAt = Date.now();
    this.lastActivity = Date.now();
    // Desired total table size to fill with bots (once >= 2 humans are present).
    // The server reconciles bot seats toward this; the host can nudge it.
    this.botTarget = config.room.botTargetDefault;
    // Pending "release this room after game over" timer (set by the server).
    this.gameOverTimer = null;
    // Auto-start: once enough players are seated the server runs a short
    // countdown then starts the game. `autoStart` is the host's Hold/Auto
    // toggle; `startCountdownTimer` is the running countdown interval.
    this.autoStart = true;
    this.startCountdownTimer = null;
  }

  /** Human (non-bot) players, connected or holding a seat. */
  getHumanPlayers() {
    return Array.from(this.players.values()).filter((p) => !p.isBot);
  }

  /** Bot players currently seated. */
  getBotPlayers() {
    return Array.from(this.players.values()).filter((p) => p.isBot);
  }

  addPlayer(playerId, playerName, socket, isBot = false) {
    const player = {
      id: playerId,
      name: playerName,
      socket,
      // Bots are ordinary players with no socket; the server drives their moves.
      isBot,
      botTimer: null,
      joinedAt: Date.now(),
      isActive: true,
      // Live socket present? Distinct from isActive (engine participation):
      // a disconnected player is connected=false while their seat is held.
      connected: true,
      // Grace timer that reclaims the seat if they don't reconnect in time.
      disconnectTimer: null,
      hand: [],
      stats: {
        gamesPlayed: 0,
        gamesWon: 0,
      },
    };

    this.players.set(playerId, player);
    this.lastActivity = Date.now();

    console.log(`Player ${playerName} (${playerId}) added to room ${this.code}`);
    return player;
  }

  /**
   * Mark a player disconnected but KEEP their seat (hand + score) so they can
   * reconnect. The engine is told to pause them (drop from round math) without
   * discarding their cards. Returns the player, or null if unknown.
   */
  markDisconnected(playerId) {
    const player = this.players.get(playerId);
    if (!player) return null;

    player.connected = false;
    // Engine participation stops so rounds don't stall waiting on a dead socket;
    // the seat itself (and the hand) is preserved until the grace timer fires.
    player.isActive = false;
    player.socket = null;
    this.lastActivity = Date.now();

    if (this.isGameActive && this.gameEngine
      && typeof this.gameEngine.handlePlayerDisconnect === 'function') {
      this.gameEngine.handlePlayerDisconnect(playerId);
    }

    console.log(`Player ${player.name} (${playerId}) disconnected from room ${this.code}`);
    return player;
  }

  /**
   * Re-attach a returning player's new socket to their held seat and resume
   * engine participation. Clears any pending grace timer. Returns the player,
   * or null if the seat was already reclaimed.
   */
  reconnectPlayer(playerId, socket) {
    const player = this.players.get(playerId);
    if (!player) return null;

    if (player.disconnectTimer) {
      clearTimeout(player.disconnectTimer);
      player.disconnectTimer = null;
    }
    player.socket = socket;
    player.connected = true;
    player.isActive = true;
    this.lastActivity = Date.now();

    if (this.isGameActive && this.gameEngine
      && typeof this.gameEngine.handlePlayerReconnect === 'function') {
      this.gameEngine.handlePlayerReconnect(playerId);
    }

    console.log(`Player ${player.name} (${playerId}) reconnected to room ${this.code}`);
    return player;
  }

  removePlayer(playerId) {
    const player = this.players.get(playerId);
    if (player) {
      if (player.disconnectTimer) {
        clearTimeout(player.disconnectTimer);
        player.disconnectTimer = null;
      }
      this.players.delete(playerId);
      this.lastActivity = Date.now();

      console.log(`Player ${player.name} (${playerId}) removed from room ${this.code}`);

      // If game is active and player was participating, handle their departure
      if (this.isGameActive && this.gameEngine) {
        this.gameEngine.handlePlayerLeave(playerId);
      }

      return player;
    }
    return null;
  }

  getPlayer(playerId) {
    return this.players.get(playerId);
  }

  getAllPlayers() {
    return Array.from(this.players.values());
  }

  getActivePlayerCount() {
    return Array.from(this.players.values()).filter((p) => p.isActive).length;
  }

  startGame(gameType, options = {}) {
    if (this.isGameActive) {
      throw new Error('Game is already active in this room');
    }

    const game = registry.getGame(gameType);
    if (!game) {
      throw new Error(`Unknown game type: ${gameType}`);
    }

    // Fail loudly if the engine does not satisfy the contract, before we try
    // to instantiate and drive it.
    validateEngine(game.engine, game.id);

    if (this.getActivePlayerCount() < game.minPlayers) {
      throw new Error(`${game.name} needs at least ${game.minPlayers} players`);
    }

    this.gameType = game.id;
    this.isGameActive = true;
    this.lastActivity = Date.now();

    // eslint-disable-next-line new-cap
    this.gameEngine = new game.engine(this, options);
    this.gameState = this.gameEngine.getInitialState();

    console.log(`Started ${game.id} game in room ${this.code} with ${this.players.size} players`);
    return this.gameState;
  }

  endGame() {
    if (!this.isGameActive) {
      return false;
    }

    this.isGameActive = false;
    this.gameType = null;
    this.lastActivity = Date.now();

    // Determine the winner (if the engine tracks one) before cleanup.
    const winnerId = this.gameEngine && typeof this.gameEngine.getWinnerId === 'function'
      ? this.gameEngine.getWinnerId()
      : null;

    // Update player statistics: everyone who played gets a game, winner gets the win.
    Array.from(this.players.values()).forEach((player) => {
      if (player.isActive) {
        player.stats.gamesPlayed += 1;
        if (player.id === winnerId) {
          player.stats.gamesWon += 1;
        }
      }
    });

    if (this.gameEngine) {
      this.gameEngine.cleanup();
      this.gameEngine = null;
    }

    // Reset player hands
    Array.from(this.players.values()).forEach((player) => {
      player.hand = [];
    });

    this.gameState = {};

    console.log(`Game ended in room ${this.code}`);
    return true;
  }

  handlePlayerAction(playerId, actionData) {
    if (!this.isGameActive || !this.gameEngine) {
      return null;
    }

    const player = this.getPlayer(playerId);
    if (!player || !player.isActive) {
      return null;
    }

    this.lastActivity = Date.now();

    // Let the game engine handle the action
    return this.gameEngine.handlePlayerAction(playerId, actionData);
  }

  broadcastToPlayers(event, data) {
    Array.from(this.players.values()).forEach((player) => {
      if (player.socket && player.isActive) {
        player.socket.emit(event, data);
      }
    });
  }

  sendToPlayer(playerId, event, data) {
    const player = this.getPlayer(playerId);
    if (player && player.socket && player.isActive) {
      player.socket.emit(event, data);
    }
  }

  // Get room state for sending to clients
  getRoomState() {
    return {
      code: this.code,
      playerCount: this.players.size,
      activePlayerCount: this.getActivePlayerCount(),
      isGameActive: this.isGameActive,
      gameType: this.gameType,
      gameState: this.gameState,
      players: Array.from(this.players.values()).map((p) => ({
        id: p.id,
        name: p.name,
        isActive: p.isActive,
        isBot: Boolean(p.isBot),
        stats: p.stats,
      })),
    };
  }

  cleanup() {
    if (this.gameOverTimer) {
      clearTimeout(this.gameOverTimer);
      this.gameOverTimer = null;
    }
    if (this.startCountdownTimer) {
      clearInterval(this.startCountdownTimer);
      this.startCountdownTimer = null;
    }
    // Disconnect all players and cancel any pending reconnect grace timers.
    Array.from(this.players.values()).forEach((player) => {
      if (player.disconnectTimer) {
        clearTimeout(player.disconnectTimer);
        player.disconnectTimer = null;
      }
      if (player.socket) {
        player.socket.disconnect();
      }
    });

    // End any active game
    if (this.isGameActive) {
      this.endGame();
    }

    this.players.clear();
    console.log(`Room ${this.code} cleaned up`);
  }
}

module.exports = GameRoom;
