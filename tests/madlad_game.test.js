const MadLadGame = require('../src/game/games/MadLadGame');

// Minimal room stub: MadLadGame only calls room.getAllPlayers().
const makeRoom = (players) => ({
  getAllPlayers: () => players,
});

const makePlayers = (n) => Array.from({ length: n }, (_, i) => ({
  id: `p${i + 1}`,
  name: `Player ${i + 1}`,
  isActive: true,
}));

// Fixture deck (card objects, as DeckService.buildDeck returns). Generous size
// so multi-round tests never exhaust it.
const makeDeck = () => ({
  prompts: Array.from({ length: 20 }, (_, i) => ({ id: i + 1, text: `Prompt ${i + 1} ____.`, blanks: 1 })),
  answers: Array.from({ length: 80 }, (_, i) => ({ id: 100 + i, text: `Answer ${i + 1}.` })),
});

const makeGame = (n, opts = {}) => new MadLadGame(
  makeRoom(makePlayers(n)),
  { deck: makeDeck(), ...opts },
);

// Every non-judge submits their first card; returns the game.
const everyoneSubmits = (game) => {
  const { judgeId } = game.state;
  game.getActiveIds()
    .filter((id) => id !== judgeId)
    .forEach((id) => game.handlePlayerAction(id, { action: 'submit-card', data: { cardIndex: 0 } }));
  return game;
};

describe('MadLadGame', () => {
  describe('initialization', () => {
    test('deals a full hand to every player and starts in answering phase', () => {
      const game = makeGame(3);
      expect(game.state.phase).toBe('answering');
      expect(game.state.blackCard).toBeTruthy();
      expect(game.state.judgeId).toBe('p1');
      Object.values(game.state.players).forEach((p) => {
        expect(p.hand).toHaveLength(7);
      });
    });

    test('exposes a minimum player requirement of 3', () => {
      expect(MadLadGame.MIN_PLAYERS).toBe(3);
    });
  });

  describe('answering phase', () => {
    test('the judge cannot submit a card', () => {
      const game = makeGame(3);
      const result = game.handlePlayerAction('p1', { action: 'submit-card', data: { cardIndex: 0 } });
      expect(result).toBeNull();
      expect(game.state.submissions).toHaveLength(0);
    });

    test('advances to judging once all non-judges submit', () => {
      const game = makeGame(3);
      expect(game.state.phase).toBe('answering');
      everyoneSubmits(game);
      expect(game.state.phase).toBe('judging');
      expect(game.state.submissions).toHaveLength(2);
    });

    test('a player cannot submit twice', () => {
      const game = makeGame(4);
      game.handlePlayerAction('p2', { action: 'submit-card', data: { cardIndex: 0 } });
      const second = game.handlePlayerAction('p2', { action: 'submit-card', data: { cardIndex: 0 } });
      expect(second).toBeNull();
      expect(game.state.submissions).toHaveLength(1);
    });
  });

  describe('state privacy', () => {
    test('public state hides hands and keeps submissions anonymous while judging', () => {
      const game = makeGame(3);
      everyoneSubmits(game);
      const pub = game.getPublicState();
      expect(pub.hand).toBeUndefined();
      expect(pub.submissions).toHaveLength(2);
      pub.submissions.forEach((s) => {
        expect(s.text).toBeTruthy();
        expect(s.playerName).toBeUndefined(); // anonymous during judging
      });
    });

    test('per-player state includes only that player\'s hand', () => {
      const game = makeGame(3);
      const view = game.getStateForPlayer('p2');
      expect(view.you.id).toBe('p2');
      expect(view.you.isJudge).toBe(false);
      expect(view.hand).toHaveLength(7);
    });

    test('reveals authors only after a winner is picked', () => {
      const game = makeGame(3);
      everyoneSubmits(game);
      const winning = game.state.submissions[0];
      game.handlePlayerAction('p1', { action: 'pick-winner', data: { submissionId: winning.id } });
      const pub = game.getPublicState();
      expect(pub.submissions.some((s) => s.playerName)).toBe(true);
      expect(pub.submissions.some((s) => s.isWinner)).toBe(true);
    });
  });

  describe('judging and scoring', () => {
    test('only the judge can pick a winner, and the winner scores a point', () => {
      const game = makeGame(3);
      everyoneSubmits(game);
      const winning = game.state.submissions[0];

      const notJudge = game.handlePlayerAction('p2', { action: 'pick-winner', data: { submissionId: winning.id } });
      expect(notJudge).toBeNull();

      game.handlePlayerAction('p1', { action: 'pick-winner', data: { submissionId: winning.id } });
      expect(game.state.phase).toBe('results');
      expect(game.state.players[winning.playerId].score).toBe(1);
      expect(game.state.lastWinner.playerId).toBe(winning.playerId);
    });

    test('next-round rotates the judge and returns to answering', () => {
      const game = makeGame(3);
      everyoneSubmits(game);
      game.handlePlayerAction('p1', { action: 'pick-winner', data: { submissionId: game.state.submissions[0].id } });
      game.handlePlayerAction('p2', { action: 'next-round' });
      expect(game.state.phase).toBe('answering');
      expect(game.state.judgeId).toBe('p2');
      expect(game.state.round).toBe(2);
    });

    test('reaching the target score ends the game', () => {
      const game = makeGame(3, { targetScore: 1 });
      everyoneSubmits(game);
      const winning = game.state.submissions[0];
      game.handlePlayerAction('p1', { action: 'pick-winner', data: { submissionId: winning.id } });
      expect(game.state.phase).toBe('gameover');
      expect(game.getWinnerId()).toBe(winning.playerId);
    });
  });

  describe('getLastRoundOutcome (F1 telemetry)', () => {
    test('returns null before a winner is picked', () => {
      const game = makeGame(3);
      expect(game.getLastRoundOutcome()).toBeNull();
      everyoneSubmits(game);
      expect(game.getLastRoundOutcome()).toBeNull(); // judging, no winner yet
    });

    test('reports the winning card id and won flags after judging', () => {
      const game = makeGame(3);
      everyoneSubmits(game);
      const submissions = game.state.submissions.slice();
      const winning = submissions[0];
      game.handlePlayerAction('p1', { action: 'pick-winner', data: { submissionId: winning.id } });

      const outcome = game.getLastRoundOutcome();
      expect(outcome.blackCardId).toBe(game.state.blackCard.id);
      expect(outcome.submissions).toHaveLength(submissions.length);

      // Every submitted card id is present with its author.
      const byCard = new Map(outcome.submissions.map((s) => [s.cardId, s]));
      submissions.forEach((s) => {
        expect(byCard.get(s.card.id)).toMatchObject({ playerId: s.playerId });
      });

      // Exactly one winner, matching the picked submission's card.
      const winners = outcome.submissions.filter((s) => s.won);
      expect(winners).toHaveLength(1);
      expect(winners[0].cardId).toBe(winning.card.id);
      expect(winners[0].playerId).toBe(winning.playerId);
    });

    test('omits submissions whose card has no id (blank fallback)', () => {
      const game = makeGame(3);
      everyoneSubmits(game);
      // Simulate a blank-card fallback slipping into the submissions.
      game.state.submissions[0].card = { id: null, text: '(blank card)' };
      const winning = game.state.submissions[1];
      game.handlePlayerAction('p1', { action: 'pick-winner', data: { submissionId: winning.id } });

      const outcome = game.getLastRoundOutcome();
      expect(outcome.submissions).toHaveLength(1);
      expect(outcome.submissions[0].cardId).toBe(winning.card.id);
    });
  });

  describe('membership changes', () => {
    test('judge leaving mid-round restarts the round with a new judge', () => {
      const game = makeGame(4);
      expect(game.state.judgeId).toBe('p1');
      game.handlePlayerLeave('p1');
      expect(game.state.phase).toBe('answering');
      expect(game.state.judgeId).not.toBe('p1');
    });

    test('dropping below the minimum pauses the game', () => {
      const game = makeGame(3);
      game.handlePlayerLeave('p3');
      expect(game.state.phase).toBe('waiting');
    });

    test('a late joiner receives a full hand', () => {
      const game = makeGame(3);
      game.addLatePlayer('p9', 'Latecomer');
      expect(game.state.players.p9.hand).toHaveLength(7);
    });
  });

  describe('deck resilience', () => {
    test('reshuffles the discard pile when the draw pile is exhausted', () => {
      const game = makeGame(3);
      game.drawPile = [];
      game.discardPile = [{ id: 99, text: 'recycled card' }];
      expect(game.drawWhite().text).toBe('recycled card');
    });
  });

  describe('serialize / restore', () => {
    test('round-trips through JSON to an equal game (mid-judging)', () => {
      const game = makeGame(3);
      everyoneSubmits(game);
      expect(game.state.phase).toBe('judging');

      const snapshot = JSON.parse(JSON.stringify(game.serialize()));
      const restored = MadLadGame.restore(makeRoom(makePlayers(3)), snapshot);

      expect(restored.getPublicState()).toEqual(game.getPublicState());
      expect(restored.getStateForPlayer('p2')).toEqual(game.getStateForPlayer('p2'));
    });

    test('restore does not re-deal (same black card and submissions)', () => {
      const game = makeGame(3);
      everyoneSubmits(game);
      const beforeBlack = game.getPublicState().blackCard;
      const beforeSubs = game.state.submissions.length;

      const restored = MadLadGame.restore(
        makeRoom(makePlayers(3)),
        JSON.parse(JSON.stringify(game.serialize())),
      );

      expect(restored.getPublicState().blackCard).toBe(beforeBlack);
      expect(restored.state.submissions).toHaveLength(beforeSubs);
      expect(restored.state.phase).toBe('judging');
    });
  });
});
