const TestGame = require('./games/TestGame');
const PokerGame = require('./games/PokerGame');
const CAHGame = require('./games/CAHGame');

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
  }

  addPlayer(playerId, playerName, socket) {
    const player = {
      id: playerId,
      name: playerName,
      socket,
      joinedAt: Date.now(),
      isActive: true,
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

  removePlayer(playerId) {
    const player = this.players.get(playerId);
    if (player) {
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

    if (this.players.size < 1) {
      throw new Error('Not enough players to start game');
    }

    this.gameType = gameType;
    this.isGameActive = true;
    this.lastActivity = Date.now();

    // Initialize game engine based on game type
    switch (gameType.toLowerCase()) {
    case 'poker':
    case 'texas-holdem': {
      this.gameEngine = new PokerGame(this, options);
      break;
    }
    case 'cards-against-humanity':
    case 'cah': {
      this.gameEngine = new CAHGame(this, options);
      break;
    }
    case 'test':
    default: {
      this.gameEngine = new TestGame(this, options);
      break;
    }
    }

    this.gameState = this.gameEngine.getInitialState();

    console.log(`Started ${gameType} game in room ${this.code} with ${this.players.size} players`);
    return this.gameState;
  }

  endGame() {
    if (!this.isGameActive) {
      return false;
    }

    this.isGameActive = false;
    this.gameType = null;
    this.lastActivity = Date.now();

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
      })),
    };
  }

  cleanup() {
    // Disconnect all players
    Array.from(this.players.values()).forEach((player) => {
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
