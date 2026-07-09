// Phase 1 reconnect — a disconnected player's seat (hand + score) is held and
// restored, distinct from a permanent leave which discards the hand.
const MadLadGame = require('../src/game/games/MadLadGame');
const GameRoom = require('../src/game/GameRoom');

function makeDeck(answers = 60) {
  return {
    prompts: Array.from({ length: 12 }, (_, i) => ({ id: 1000 + i, text: `Prompt ${i} ____.`, blanks: 1 })),
    answers: Array.from({ length: answers }, (_, i) => ({ id: i + 1, text: `Answer ${i}` })),
  };
}

function makeRoom(players) {
  return { getAllPlayers: () => players };
}

describe('MadLadGame disconnect / reconnect', () => {
  let game;
  let nonJudges;

  beforeEach(() => {
    // Four players so one disconnect still leaves the 3-player minimum active.
    const players = ['a', 'b', 'c', 'd'].map((id) => ({ id, name: id.toUpperCase(), isActive: true }));
    game = new MadLadGame(makeRoom(players), { deck: makeDeck() });
    nonJudges = ['a', 'b', 'c', 'd'].filter((id) => id !== game.state.judgeId);
  });

  test('disconnect preserves hand and score; reconnect resumes participation', () => {
    const pid = nonJudges[0];
    game.state.players[pid].score = 3;
    const handBefore = game.state.players[pid].hand.map((c) => c.text);
    expect(handBefore).toHaveLength(game.state.handSize);

    game.handlePlayerDisconnect(pid);
    expect(game.state.players[pid].isActive).toBe(false);
    // Unlike a permanent leave, the hand and score survive.
    expect(game.state.players[pid].score).toBe(3);
    expect(game.state.players[pid].hand.map((c) => c.text)).toEqual(handBefore);

    game.handlePlayerReconnect(pid);
    expect(game.state.players[pid].isActive).toBe(true);
    expect(game.state.players[pid].score).toBe(3);
    expect(game.state.players[pid].hand).toHaveLength(game.state.handSize);
  });

  test('a permanent leave discards the hand (contrast)', () => {
    const pid = nonJudges[0];
    game.handlePlayerLeave(pid);
    expect(game.state.players[pid].isActive).toBe(false);
    expect(game.state.players[pid].hand).toEqual([]);
  });

  test('a submitted card stays in the pot across a disconnect and the round resolves', () => {
    game.handlePlayerAction(nonJudges[0], { action: 'submit-card', data: { cardIndex: 0 } });
    expect(game.state.submissions.some((s) => s.playerId === nonJudges[0])).toBe(true);

    game.handlePlayerDisconnect(nonJudges[0]);
    // Their card remains submitted; they're just no longer *expected* to act.
    expect(game.state.submissions.some((s) => s.playerId === nonJudges[0])).toBe(true);
    expect(game.state.phase).toBe('answering');

    // The two remaining non-judges submit → round advances with all 3 cards.
    game.handlePlayerAction(nonJudges[1], { action: 'submit-card', data: { cardIndex: 0 } });
    game.handlePlayerAction(nonJudges[2], { action: 'submit-card', data: { cardIndex: 0 } });
    expect(game.state.phase).toBe('judging');
    expect(game.state.submissions).toHaveLength(3);
  });

  test('reconnecting during answering clears a stale submitted flag from a prior round', () => {
    // Submit, then simulate the round moving on while disconnected.
    game.handlePlayerAction(nonJudges[0], { action: 'submit-card', data: { cardIndex: 0 } });
    game.handlePlayerDisconnect(nonJudges[0]);
    // Force a fresh answering round with no live submission from this player.
    game.state.submissions = [];
    game.state.phase = 'answering';

    game.handlePlayerReconnect(nonJudges[0]);
    expect(game.state.players[nonJudges[0]].submittedCardId).toBeNull();
  });
});

describe('GameRoom reconnect grace', () => {
  const fakeSocket = () => ({ emit() {}, join() {}, disconnect() {} });

  test('markDisconnected holds the seat; reconnectPlayer restores it', () => {
    const room = new GameRoom('ROOM');
    room.addPlayer('cid', 'Alice', fakeSocket());

    room.markDisconnected('cid');
    const p = room.getPlayer('cid');
    expect(p).toBeTruthy(); // seat NOT removed
    expect(p.connected).toBe(false);
    expect(p.isActive).toBe(false);
    expect(p.socket).toBeNull();

    const s2 = fakeSocket();
    room.reconnectPlayer('cid', s2);
    expect(p.connected).toBe(true);
    expect(p.isActive).toBe(true);
    expect(p.socket).toBe(s2);
  });

  test('reconnectPlayer clears a pending grace timer', () => {
    const room = new GameRoom('ROOM');
    room.addPlayer('cid', 'Al', fakeSocket());
    const p = room.getPlayer('cid');
    p.disconnectTimer = setTimeout(() => {}, 10000);

    room.reconnectPlayer('cid', fakeSocket());
    expect(p.disconnectTimer).toBeNull();
  });
});
