const registry = require('../src/game/registry');
const MadLadGame = require('../src/game/games/MadLadGame');

describe('game registry', () => {
  test('resolves madlad by id and by legacy cah alias', () => {
    expect(registry.resolveId('madlad')).toBe('madlad');
    expect(registry.resolveId('cah')).toBe('madlad');
    expect(registry.resolveId('cards-against-humanity')).toBe('madlad');
    expect(registry.resolveId('MADLAD')).toBe('madlad');
  });

  test('returns null for unknown game types', () => {
    expect(registry.resolveId('poker')).toBeNull();
    expect(registry.getGame('nope')).toBeNull();
    expect(registry.resolveId('')).toBeNull();
  });

  test('getGame returns the MadLad entry with its engine', () => {
    const game = registry.getGame('madlad');
    expect(game.name).toBe('MadLad');
    expect(game.minPlayers).toBe(MadLadGame.MIN_PLAYERS);
    expect(game.engine).toBe(MadLadGame);
  });

  test('listGames hides dev games and omits the engine class', () => {
    const publicGames = registry.listGames();
    expect(publicGames.some((g) => g.id === 'madlad')).toBe(true);
    expect(publicGames.some((g) => g.id === 'test')).toBe(false);
    publicGames.forEach((g) => expect(g.engine).toBeUndefined());
  });

  test('listGames can include dev games when asked', () => {
    const all = registry.listGames({ includeDev: true });
    expect(all.some((g) => g.id === 'test')).toBe(true);
  });
});
