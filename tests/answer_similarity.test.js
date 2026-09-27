const { answerWords, wordOverlap } = require('../src/game/answerSimilarity');
const MadLadGame = require('../src/game/games/MadLadGame');
const overlap = (a, b) => wordOverlap(answerWords(a), answerWords(b));
const card = (id, text) => ({ id, text });
const room = { getAllPlayers: () => [] };
const gameWith = (cards) => {
  const game = new MadLadGame(room);
  game.drawPile = cards;
  return game;
};

test('recognizes the haunted pattern, including a longer variant', () => {
  expect(overlap('A haunted Fitbit.', 'A haunted Roomba.')).toBe(0.5);
  expect(overlap('A haunted Fitbit.', 'A haunted karaoke machine.')).toBe(0.5);
});

test('ignores filler, case, punctuation and possessives without inflating repetitions', () => {
  expect(overlap('My boss’s HAUNTED Fitbit!', 'The haunted Fitbit.')).toBe(1);
  expect(overlap('A haunted Fitbit.', 'A raccoon union rep.')).toBe(0);
  expect(overlap('Haunted haunted haunted Fitbit.', 'Haunted toaster.')).toBe(0.5);
  expect(overlap('The union president stole my lunch.', 'My therapist joined a union yesterday.')).toBeLessThan(0.5);
  expect(overlap('MY!!!', 'my')).toBe(1);
  expect(overlap('', 'Fitbit')).toBe(0);
});

test('skips similar answers while conserving every unselected card and its order', () => {
  const distinct = card(1, 'A raccoon union rep.');
  const similar = card(2, 'A haunted karaoke machine.');
  const game = gameWith([distinct, similar]);
  expect(game.drawWhite([card(3, 'A haunted Fitbit.')])).toBe(distinct);
  expect(game.drawPile).toEqual([similar]);
  expect(game.drawWhite()).toBe(similar);
});

test('uses the least-overlapping fallback and keeps shuffled order on ties', () => {
  const least = card(1, 'Haunted toaster.');
  const tied = card(2, 'Haunted Roomba.');
  const duplicate = card(3, 'Haunted Fitbit.');
  const game = gameWith([least, tied, duplicate]);
  expect(game.drawWhite([duplicate])).toBe(tied);
  expect(game.drawPile).toEqual([least, duplicate]);
});

test('recycled piles use the same filter, and empty piles still terminate', () => {
  const game = gameWith([]);
  const distinct = card(1, 'A raccoon union rep.');
  const similar = card(2, 'A haunted Roomba.');
  game.discardPile = [distinct, similar];
  expect(game.drawWhite([card(3, 'A haunted Fitbit.')])).toBe(distinct);
  expect(game.discardPile).toEqual([]);
  expect(game.drawWhite()).toBe(similar);
  expect(game.drawWhite()).toEqual({ id: null, text: '(blank card)' });
});

test('refills compare against the entire hand and survive snapshot restore', () => {
  const game = gameWith([card(1, 'A raccoon union rep.'), card(2, 'A haunted toaster.')]);
  const player = game.createPlayerState({ id: 'p1', name: 'Player' });
  player.hand = Array.from({ length: 7 }, (_, i) => card(10 + i, 'A haunted Fitbit.'));
  game.state.players.p1 = player;
  game.seatOrder = ['p1'];
  const restored = MadLadGame.restore(room, JSON.parse(JSON.stringify(game.serialize())));
  restored.refillHand(restored.state.players.p1);
  expect(restored.state.players.p1.hand).toHaveLength(8);
  expect(restored.state.players.p1.hand[7].id).toBe(1);
  expect(restored.drawPile.map((c) => c.id)).toEqual([2]);
  expect(restored.exposureEvents.filter((e) => e.cardId === 2)).toHaveLength(0);
});

test('swaps avoid the discarded idea as well as the remaining hand', () => {
  const game = gameWith([card(1, 'A raccoon union rep.'), card(2, 'A haunted toaster.')]);
  const player = game.createPlayerState({ id: 'p1', name: 'Player' });
  player.hand = [card(10, 'A haunted Fitbit.'), ...Array.from({ length: 7 }, (_, i) => card(11 + i, 'Tax fraud.'))];
  game.state.players.p1 = player;
  game.state.phase = 'answering';
  expect(game.handleDiscardCard('p1', { cardIndex: 0 })).toEqual({ ok: true });
  expect(player.hand[7].id).toBe(1);
  expect(game.discardPile.map((c) => c.id)).toEqual([10]);
});

test('a fresh hand filters against cards dealt earlier in the same refill', () => {
  const cards = ['Tax fraud.', 'Union raccoons.', 'Microwave sushi.', 'Divorce papers.',
    'Corporate seances.', 'Expired coupons.', 'Emotional baggage.', 'A haunted Roomba.', 'A haunted Fitbit.']
    .map((text, id) => card(id + 1, text));
  const game = gameWith(cards.slice());
  const player = game.createPlayerState({ id: 'p1', name: 'Player' });
  game.refillHand(player);
  expect(player.hand).toHaveLength(8);
  expect(player.hand.filter((c) => c.text.includes('haunted'))).toHaveLength(1);
  expect([...player.hand, ...game.drawPile].map((c) => c.id).sort()).toEqual(cards.map((c) => c.id).sort());
});

test('all players share one finite deck with no card dealt to two hands', () => {
  const players = ['p1', 'p2', 'p3'].map((id) => ({ id, name: id, isActive: true }));
  const answers = Array.from({ length: 40 }, (_, i) => card(i + 1, `Haunted gadget ${i + 1}.`));
  const game = new MadLadGame({ getAllPlayers: () => players }, {
    deck: { prompts: [{ id: 100, text: 'It was ____.', blanks: 1 }], answers },
  });
  const dealt = Object.values(game.state.players).flatMap((player) => player.hand);
  expect(dealt).toHaveLength(24);
  expect(new Set(dealt.map((c) => c.id)).size).toBe(24);
  const allIds = [...dealt, ...game.drawPile].map((c) => c.id).sort((a, b) => a - b);
  expect(allIds).toEqual(answers.map((c) => c.id));
});
