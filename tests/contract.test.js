/* eslint-disable max-classes-per-file */
const registry = require('../src/game/registry');
const { validateEngine, REQUIRED_METHODS } = require('../src/game/contract');
const BaseGame = require('../src/game/games/BaseGame');

// A room stub exposing the only method engines touch at construction time.
const emptyRoom = { getAllPlayers: () => [] };

describe('game engine contract compliance', () => {
  // Every registered game (including dev-only games) must satisfy the contract.
  registry.GAMES.forEach((game) => {
    describe(`${game.id} (${game.name})`, () => {
      test('passes validateEngine', () => {
        expect(() => validateEngine(game.engine, game.id)).not.toThrow();
      });

      test('extends BaseGame', () => {
        expect(game.engine.prototype).toBeInstanceOf(BaseGame);
      });

      test('declares a static MIN_PLAYERS number >= 1', () => {
        expect(typeof game.engine.MIN_PLAYERS).toBe('number');
        expect(game.engine.MIN_PLAYERS).toBeGreaterThanOrEqual(1);
      });

      test('implements every required contract method', () => {
        REQUIRED_METHODS.forEach((method) => {
          const fn = game.engine.prototype[method];
          expect(typeof fn).toBe('function');
          // Must be its own implementation, not the throwing BaseGame stub.
          expect(fn).not.toBe(BaseGame.prototype[method]);
        });
      });

      test('getInitialState() returns a plain object', () => {
        // eslint-disable-next-line new-cap
        const engine = new game.engine(emptyRoom, {});
        const state = engine.getInitialState();
        expect(state).toBeTruthy();
        expect(typeof state).toBe('object');
      });

      test('getWinnerId() is callable and returns a defined value', () => {
        // eslint-disable-next-line new-cap
        const engine = new game.engine(emptyRoom, {});
        expect(typeof engine.getWinnerId).toBe('function');
        // null (no winner yet) is acceptable; undefined is not.
        expect(engine.getWinnerId()).not.toBeUndefined();
      });
    });
  });
});

describe('validateEngine enforcement', () => {
  test('rejects a non-constructor', () => {
    expect(() => validateEngine({}, 'bogus')).toThrow(/must be a class/);
  });

  test('rejects an engine missing a required method', () => {
    class Incomplete extends BaseGame {
      static get MIN_PLAYERS() { return 1; }

      getInitialState() { return {}; }

      handlePlayerAction() { return null; }

      // handlePlayerLeave intentionally left as the BaseGame stub

      cleanup() {}
    }
    expect(() => validateEngine(Incomplete, 'incomplete')).toThrow(/handlePlayerLeave/);
  });

  test('rejects an engine without a valid static MIN_PLAYERS', () => {
    class NoMin extends BaseGame {
      getInitialState() { return {}; }

      handlePlayerAction() { return null; }

      handlePlayerLeave() {}

      cleanup() {}
    }
    expect(() => validateEngine(NoMin, 'nomin')).toThrow(/MIN_PLAYERS/);
  });

  test('accepts a fully conforming engine', () => {
    class Good extends BaseGame {
      static get MIN_PLAYERS() { return 2; }

      getInitialState() { return { ok: true }; }

      handlePlayerAction() { return null; }

      handlePlayerLeave() {}

      cleanup() {}
    }
    expect(() => validateEngine(Good, 'good')).not.toThrow();
  });
});

describe('BaseGame', () => {
  test('cannot be instantiated directly', () => {
    expect(() => new BaseGame(emptyRoom, {})).toThrow(/abstract/);
  });

  test('required-method stubs throw a descriptive error when not overridden', () => {
    class Bare extends BaseGame {
      static get MIN_PLAYERS() { return 1; }
    }
    const bare = new Bare(emptyRoom, {});
    expect(() => bare.getInitialState()).toThrow(/Bare must implement getInitialState/);
    expect(() => bare.handlePlayerAction('p', {})).toThrow(/must implement handlePlayerAction/);
    expect(() => bare.handlePlayerLeave('p')).toThrow(/must implement handlePlayerLeave/);
    expect(() => bare.cleanup()).toThrow(/must implement cleanup/);
  });

  test('getWinnerId() defaults to null', () => {
    class NoWinner extends BaseGame {
      static get MIN_PLAYERS() { return 1; }

      getInitialState() { return {}; }

      handlePlayerAction() { return null; }

      handlePlayerLeave() {}

      cleanup() {}
    }
    expect(new NoWinner(emptyRoom, {}).getWinnerId()).toBeNull();
  });

  test('mapPlayers() builds a keyed map from the room roster', () => {
    class Roster extends BaseGame {
      static get MIN_PLAYERS() { return 1; }

      getInitialState() { return {}; }

      handlePlayerAction() { return null; }

      handlePlayerLeave() {}

      cleanup() {}
    }
    const room = {
      getAllPlayers: () => [{ id: 'a', name: 'Ann' }, { id: 'b', name: 'Bo' }],
    };
    const engine = new Roster(room, {});
    const map = engine.mapPlayers((p) => ({ id: p.id, name: p.name }));
    expect(map).toEqual({ a: { id: 'a', name: 'Ann' }, b: { id: 'b', name: 'Bo' } });
  });
});
