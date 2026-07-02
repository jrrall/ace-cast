const config = require('./config');

/**
 * Validation utility functions
 */

const ValidationError = class extends Error {
  constructor(message, field) {
    super(message);
    this.name = 'ValidationError';
    this.field = field;
  }
};

/**
 * Validates a room code
 * @param {string} roomCode - The room code to validate
 * @returns {boolean} - True if valid
 * @throws {ValidationError} - If invalid
 */
const validateRoomCode = (roomCode) => {
  if (!roomCode || typeof roomCode !== 'string') {
    throw new ValidationError('Room code must be a string', 'roomCode');
  }

  const trimmedCode = roomCode.trim().toUpperCase();
  
  if (!config.validation.roomCode.test(trimmedCode)) {
    throw new ValidationError(
      `Room code must be exactly ${config.room.codeLength} uppercase letters`,
      'roomCode'
    );
  }

  return true;
};

/**
 * Validates a player name
 * @param {string} playerName - The player name to validate
 * @returns {boolean} - True if valid
 * @throws {ValidationError} - If invalid
 */
const validatePlayerName = (playerName) => {
  if (!playerName || typeof playerName !== 'string') {
    throw new ValidationError('Player name must be a string', 'playerName');
  }

  const trimmedName = playerName.trim();
  
  if (!config.validation.playerName.test(trimmedName)) {
    throw new ValidationError('Player name must be 1-50 characters', 'playerName');
  }

  if (trimmedName.length === 0) {
    throw new ValidationError('Player name cannot be empty', 'playerName');
  }

  return true;
};

/**
 * Validates game type
 * @param {string} gameType - The game type to validate
 * @returns {boolean} - True if valid
 * @throws {ValidationError} - If invalid
 */
const validateGameType = (gameType) => {
  if (!gameType || typeof gameType !== 'string') {
    throw new ValidationError('Game type must be a string', 'gameType');
  }

  const validTypes = Object.values(config.game.types);
  const normalizedType = gameType.toLowerCase();

  if (!validTypes.includes(normalizedType)) {
    throw new ValidationError(
      `Game type must be one of: ${validTypes.join(', ')}`,
      'gameType'
    );
  }

  return true;
};

/**
 * Validates player count for game start
 * @param {number} playerCount - The number of players
 * @param {string} gameType - The game type
 * @returns {boolean} - True if valid
 * @throws {ValidationError} - If invalid
 */
const validatePlayerCount = (playerCount, gameType = null) => {
  if (typeof playerCount !== 'number' || playerCount < 0) {
    throw new ValidationError('Player count must be a non-negative number', 'playerCount');
  }

  if (playerCount < config.room.minPlayers) {
    throw new ValidationError(
      `At least ${config.room.minPlayers} player required to start a game`,
      'playerCount'
    );
  }

  if (playerCount > config.room.maxPlayers) {
    throw new ValidationError(
      `Maximum ${config.room.maxPlayers} players allowed`,
      'playerCount'
    );
  }

  return true;
};

/**
 * Safely validates input with error handling
 * @param {Function} validator - The validation function to run
 * @param {*} value - The value to validate
 * @returns {Object} - { valid: boolean, error?: ValidationError }
 */
const safeValidate = (validator, value) => {
  try {
    validator(value);
    return { valid: true };
  } catch (error) {
    if (error instanceof ValidationError) {
      return { valid: false, error };
    }
    return { 
      valid: false, 
      error: new ValidationError('Validation failed', 'unknown')
    };
  }
};

module.exports = {
  ValidationError,
  validateRoomCode,
  validatePlayerName,
  validateGameType,
  validatePlayerCount,
  safeValidate,
};