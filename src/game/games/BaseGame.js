/**
 * BaseGame — the explicit contract every game engine must satisfy.
 *
 * GameRoom drives an engine through a small, fixed surface. Previously that
 * surface was implicit (duck-typed): a new engine could silently omit a method
 * and only blow up at runtime deep inside a room. BaseGame turns the contract
 * into something enforced:
 *
 *   - Required methods have throwing stubs here, so a subclass that forgets to
 *     override one fails loudly with a message naming the class and method.
 *   - `contract.validateEngine()` checks conformance up front (at `startGame`
 *     and in the compliance test suite) instead of mid-game.
 *
 * Required instance methods (subclasses MUST override):
 *   - getInitialState()                    -> plain object describing the game
 *   - handlePlayerAction(playerId, action) -> result object | null
 *   - handlePlayerLeave(playerId)          -> void
 *   - cleanup()                            -> void
 *
 * Optional contract points (safe defaults provided here):
 *   - getWinnerId() -> winning player id | null   (winner tracking)
 *   - serialize() / static restore()              (opt-in persistence)
 *
 * Required static:
 *   - MIN_PLAYERS: number >= 1
 *
 * Shared helpers subclasses may use:
 *   - mapPlayers(factory) -> builds the players map from the room roster
 *
 * See TestGame for a minimal reference implementation of this contract.
 */
class BaseGame {
  constructor(room, options = {}) {
    if (new.target === BaseGame) {
      throw new Error('BaseGame is abstract and cannot be instantiated directly');
    }
    this.room = room;
    this.options = options;
  }

  // ---- Required contract (throwing stubs) --------------------------------

  getInitialState() {
    throw this.notImplemented('getInitialState');
  }

  handlePlayerAction(_playerId, _actionData) {
    throw this.notImplemented('handlePlayerAction');
  }

  handlePlayerLeave(_playerId) {
    throw this.notImplemented('handlePlayerLeave');
  }

  cleanup() {
    throw this.notImplemented('cleanup');
  }

  // ---- Optional contract (safe defaults) ---------------------------------

  /**
   * Winner tracking. Engines with a win condition override this to return the
   * winning player id; engines without one (e.g. TestGame) inherit the null
   * default so GameRoom.endGame() can always call it safely.
   */
  // eslint-disable-next-line class-methods-use-this
  getWinnerId() {
    return null;
  }

  /**
   * Persistence (opt-in). Resumable engines override BOTH this and the static
   * `restore(room, snapshot, options)`; `contract.isResumable()` checks for both.
   * The default marks the engine non-resumable.
   */
  // eslint-disable-next-line class-methods-use-this
  serialize() {
    throw new Error('This game is not resumable (override serialize() and static restore()).');
  }

  // ---- Shared helpers ----------------------------------------------------

  /**
   * Build a players map keyed by player id from the room roster.
   * @param {(player: object) => object} factory per-player state builder
   * @returns {Object<string, object>}
   */
  mapPlayers(factory) {
    const players = {};
    this.room.getAllPlayers().forEach((player) => {
      players[player.id] = factory(player);
    });
    return players;
  }

  notImplemented(method) {
    return new Error(
      `${this.constructor.name} must implement ${method}() (required by the game engine contract)`,
    );
  }
}

module.exports = BaseGame;
