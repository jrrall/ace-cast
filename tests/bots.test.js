// Bot fill math + name selection (pure helpers).
const bots = require('../src/server/bots');

describe('bots.desiredBotCount', () => {
  test('no bots until there are at least 2 humans', () => {
    expect(bots.desiredBotCount(0, 4)).toBe(0);
    expect(bots.desiredBotCount(1, 4)).toBe(0);
  });

  test('fills toward the target once >= 2 humans, humans preferred', () => {
    expect(bots.desiredBotCount(2, 4)).toBe(2); // 2 humans + 2 bots = 4
    expect(bots.desiredBotCount(3, 4)).toBe(1);
    expect(bots.desiredBotCount(4, 4)).toBe(0); // full of humans
    expect(bots.desiredBotCount(5, 4)).toBe(0);
  });

  test('never exceeds maxPlayers', () => {
    expect(bots.desiredBotCount(2, 8, 4)).toBe(2); // target clamped to 4
  });
});

describe('bots.nextBotName', () => {
  test('avoids names already at the table', () => {
    const first = bots.BOT_NAMES[0];
    expect(bots.nextBotName([first])).not.toBe(first);
  });

  test('still returns a name when every base name is taken', () => {
    const name = bots.nextBotName(bots.BOT_NAMES.slice());
    expect(typeof name).toBe('string');
    expect(name.length).toBeGreaterThan(0);
  });
});
