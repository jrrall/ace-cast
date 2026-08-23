// Regression tests for #49 — Card Czar rotation must survive players leaving
// and rejoining mid-game.
//
// The original bug: the judge was tracked as an INDEX (`judgePointer`) into the
// *active* player list, which is recomputed every round. The instant a phone
// locked, that player dropped out of the list, every later element shifted down
// one, and the retained index silently pointed at a different seat — serving one
// player twice in a row and skipping another entirely.
//
// The fix tracks the judge by stable player id and walks `seatOrder` (which is
// append-only). These tests encode the two traces from the issue.
const MadLadGame = require('../src/game/games/MadLadGame');

const makeRoom = (players) => ({ getAllPlayers: () => players });

const makePlayers = (n) => Array.from({ length: n }, (_, i) => ({
  id: `p${i + 1}`,
  name: `Player ${i + 1}`,
  isActive: true,
}));

const makeDeck = () => ({
  prompts: Array.from({ length: 60 }, (_, i) => ({ id: i + 1, text: `Prompt ${i + 1} ____.`, blanks: 1 })),
  answers: Array.from({ length: 400 }, (_, i) => ({ id: 1000 + i, text: `Answer ${i + 1}.` })),
});

const makeGame = (n, opts = {}) => new MadLadGame(
  makeRoom(makePlayers(n)),
  { deck: makeDeck(), ...opts },
);

/** Play one full round to completion, leaving the game in the next round. */
function playRound(game) {
  const { judgeId } = game.state;
  game.getActiveIds()
    .filter((id) => id !== judgeId)
    .forEach((id) => game.handlePlayerAction(id, { action: 'submit-card', data: { cardIndex: 0 } }));
  if (game.state.phase === 'judging') {
    const [first] = game.state.submissions;
    game.handlePlayerAction(judgeId, { action: 'pick-winner', data: { submissionId: first.id } });
  }
  if (game.state.phase === 'results') {
    game.handlePlayerAction(judgeId, { action: 'next-round' });
  }
}

/** Judge ids over the next `rounds` rounds, starting with the current one. */
function judgeSequence(game, rounds) {
  const seen = [];
  for (let i = 0; i < rounds; i += 1) {
    seen.push(game.state.judgeId);
    playRound(game);
  }
  return seen;
}

/** No id appears twice back-to-back. */
function hasConsecutiveRepeat(ids) {
  return ids.some((id, i) => i > 0 && id === ids[i - 1]);
}

describe('MadLad Card Czar rotation (#49)', () => {
  describe('with a stable table', () => {
    test('every player judges exactly once per cycle, in seat order', () => {
      const game = makeGame(4);
      expect(judgeSequence(game, 4)).toEqual(['p1', 'p2', 'p3', 'p4']);
    });

    test('the ring wraps cleanly into a second cycle', () => {
      const game = makeGame(4);
      expect(judgeSequence(game, 8)).toEqual(
        ['p1', 'p2', 'p3', 'p4', 'p1', 'p2', 'p3', 'p4'],
      );
    });
  });

  describe('when a player drops mid-game', () => {
    // Trace A from the issue: judge p2 drops, and p3 (not p4) must be next.
    // The index bug produced p4 here, skipping p3 for the whole cycle.
    test('the judge dropping hands the chair to the NEXT seat, not a later one', () => {
      const game = makeGame(4);
      playRound(game); // p1 judged; p2 is now judge
      expect(game.state.judgeId).toBe('p2');

      game.handlePlayerDisconnect('p2');

      expect(game.state.judgeId).toBe('p3');
    });

    test('a departure does not skip anyone still at the table', () => {
      const game = makeGame(5);
      playRound(game); // p1 judged; p2 judging
      game.handlePlayerDisconnect('p2');

      // p2 is gone; the remaining four must each judge once, in order.
      const seen = judgeSequence(game, 4);
      expect(seen).toEqual(['p3', 'p4', 'p5', 'p1']);
      expect(seen).not.toContain('p2');
    });

    test('a player dropping BEFORE the judge in seat order does not shift the ring', () => {
      const game = makeGame(4);
      playRound(game);
      playRound(game); // p3 is judge
      expect(game.state.judgeId).toBe('p3');

      game.handlePlayerDisconnect('p1'); // earlier seat — the classic index shift

      expect(judgeSequence(game, 3)).toEqual(['p3', 'p4', 'p2']);
    });

    test('a player dropping AFTER the judge is simply skipped when their turn comes', () => {
      const game = makeGame(4);
      expect(game.state.judgeId).toBe('p1');
      game.handlePlayerDisconnect('p3'); // a later seat

      expect(judgeSequence(game, 3)).toEqual(['p1', 'p2', 'p4']);
    });

    test('no player ever judges twice in a row across a departure', () => {
      const game = makeGame(5);
      playRound(game);
      game.handlePlayerDisconnect('p3');
      expect(hasConsecutiveRepeat(judgeSequence(game, 8))).toBe(false);
    });
  });

  describe('when a player drops and comes back (the reported case)', () => {
    // Trace B from the issue. A locked phone disconnects and then RECONNECTS
    // when picked up — which is what made the same player judge twice.
    test('a drop-then-reconnect never serves the same judge twice in a row', () => {
      const game = makeGame(4);
      playRound(game); // p2 is judge
      expect(game.state.judgeId).toBe('p2');

      game.handlePlayerDisconnect('p2'); // phone locks -> p3 inherits the chair
      expect(game.state.judgeId).toBe('p3');

      game.handlePlayerReconnect('p2'); // phone wakes, still inside the grace window

      const seen = judgeSequence(game, 5);
      expect(seen[0]).toBe('p3');
      expect(hasConsecutiveRepeat(seen)).toBe(false);
    });

    test('a returning player regains their place in the ring', () => {
      const game = makeGame(4);
      game.handlePlayerDisconnect('p3');
      game.handlePlayerReconnect('p3');

      // p3 is back before their turn came up, so the full cycle is intact.
      expect(judgeSequence(game, 4)).toEqual(['p1', 'p2', 'p3', 'p4']);
    });

    test('a player away for their turn is skipped, not permanently dropped', () => {
      const game = makeGame(4);
      game.handlePlayerDisconnect('p2');
      playRound(game); // p1 judged; p2 is away so p3 takes the turn
      expect(game.state.judgeId).toBe('p3');

      game.handlePlayerReconnect('p2');

      // p2 rejoins the ring and judges on the next pass, not immediately.
      expect(judgeSequence(game, 3)).toEqual(['p3', 'p4', 'p1']);
      expect(game.state.judgeId).toBe('p2');
    });
  });

  describe('bots', () => {
    test('bots answer but never take the Card Czar chair', () => {
      const room = makeRoom([
        { id: 'p1', name: 'Human 1', isActive: true },
        { id: 'b1', name: 'Bot 1', isActive: true, isBot: true },
        { id: 'p2', name: 'Human 2', isActive: true },
        { id: 'b2', name: 'Bot 2', isActive: true, isBot: true },
      ]);
      const game = new MadLadGame(room, { deck: makeDeck() });

      const seen = judgeSequence(game, 6);
      expect(seen).toEqual(['p1', 'p2', 'p1', 'p2', 'p1', 'p2']);
      expect(seen).not.toContain('b1');
      expect(seen).not.toContain('b2');
    });
  });
});
