/**
 * Configuration constants and environment-based settings
 */

const config = {
  // Server configuration
  server: {
    port: process.env.PORT || 3000,
    host: '0.0.0.0',
    cors: {
      origin: '*',
      methods: ['GET', 'POST'],
    },
  },

  // Room configuration
  room: {
    codeLength: 4,
    maxGenerationAttempts: 100,
    inactiveThreshold: 2 * 60 * 60 * 1000, // 2 hours
    maxPlayers: 8,
    minPlayers: 1,
  },

  // Game configuration
  game: {
    types: {
      TEST: 'test',
      POKER: 'poker',
      TEXAS_HOLDEM: 'texas-holdem',
      CARDS_AGAINST_HUMANITY: 'cah',
    },
    states: {
      WAITING: 'waiting',
      PLAYING: 'playing',
      ENDED: 'ended',
    },
  },

  // Client configuration
  client: {
    reconnectInterval: 3000,
    maxReconnectAttempts: 5,
    updateInterval: 1000,
  },

  // Validation patterns
  validation: {
    roomCode: /^[A-Z]{4}$/,
    playerName: /^.{1,50}$/,
  },
};

module.exports = config;