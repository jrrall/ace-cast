const BaseGame = require('./games/BaseGame');

/**
 * Instance methods every engine must implement. A conforming engine provides
 * its own version of each (i.e. not the throwing stub inherited from BaseGame).
 */
const REQUIRED_METHODS = [
  'getInitialState',
  'handlePlayerAction',
  'handlePlayerLeave',
  'cleanup',
];

/**
 * Validate that an engine class satisfies the game engine contract.
 *
 * Throws a descriptive Error (naming the game id, class, and offending member)
 * when the engine is not a constructor, is missing a required method (or leaves
 * a BaseGame stub un-overridden), or lacks a valid static MIN_PLAYERS.
 *
 * Called at GameRoom.startGame (runtime guard) and by the compliance test suite
 * over every registered game. Deliberately NOT run at registry module-load time,
 * because test suites mock engine modules and load-time validation would throw
 * on those mocks.
 *
 * @param {Function} EngineClass the game engine class
 * @param {string} [id] the registry id, for error messages
 */
function validateEngine(EngineClass, id) {
  const label = id || (EngineClass && EngineClass.name) || 'unknown';

  if (typeof EngineClass !== 'function') {
    throw new Error(`Game "${label}" engine must be a class/constructor`);
  }

  const proto = EngineClass.prototype;
  REQUIRED_METHODS.forEach((method) => {
    const fn = proto ? proto[method] : undefined;
    if (typeof fn !== 'function' || fn === BaseGame.prototype[method]) {
      throw new Error(
        `Game "${label}" engine (${EngineClass.name}) must implement ${method}() `
        + '(required by the game engine contract)',
      );
    }
  });

  const min = EngineClass.MIN_PLAYERS;
  if (typeof min !== 'number' || !Number.isFinite(min) || min < 1) {
    throw new Error(
      `Game "${label}" engine (${EngineClass.name}) must define a static MIN_PLAYERS `
      + `number >= 1 (got ${min})`,
    );
  }
}

module.exports = { BaseGame, REQUIRED_METHODS, validateEngine };
