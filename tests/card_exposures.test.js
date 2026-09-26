const { useTestDb, cleanupTestDb } = require('./helpers/testDb');
const MadLadGame = require('../src/game/games/MadLadGame');

const players = ['a', 'b', 'c'].map((id) => ({ id, name: id, isActive: true }));
const room = { getAllPlayers: () => players };
const deck = {
  prompts: [{ id: 1, text: '____?' }],
  answers: Array.from({ length: 24 }, (_, i) => ({ id: i + 2, text: `Answer ${i}` })),
};
const makeGame = () => new MadLadGame(room, { deck });
const events = (game, kind) => game.exposureEvents.filter((e) => e.kind === kind);

describe('delivery events in the engine', () => {
  test('initial hands, exhausted-deck swap redeal, refill and prompt reactivation', () => {
    const game = makeGame();
    expect(events(game, 'answer_dealt')).toHaveLength(24);
    expect(events(game, 'prompt_exposed')).toHaveLength(1);
    const swapped = game.state.players.b.hand[0].id;
    game.handleDiscardCard('b', { cardIndex: 0 });
    expect(events(game, 'answer_dealt')).toHaveLength(25);
    expect(events(game, 'answer_dealt').at(-1).cardId).toBe(swapped);
    expect(new Set(game.exposureEvents.map((e) => e.eventId)).size).toBe(26);
    game.handleSubmitCard('b', { cardIndex: 0 });
    game.handleSubmitCard('c', { cardIndex: 0 });
    game.handlePickWinner('a', { submissionId: game.state.submissions[0].id });
    game.handleNextRound('a');
    expect(events(game, 'answer_dealt')).toHaveLength(27);
    expect(events(game, 'prompt_exposed')).toHaveLength(2);
    expect(events(game, 'prompt_exposed')[0].eventId)
      .not.toBe(events(game, 'prompt_exposed')[1].eventId);
  });

  test('draws, projections, reconnect, unsubmit and restore do not manufacture events', () => {
    const game = makeGame();
    const original = JSON.parse(JSON.stringify(game.exposureEvents));
    game.getStateForPlayer('b');
    game.getPublicState();
    game.handlePlayerReconnect('b');
    game.handleSubmitCard('b', { cardIndex: 0 });
    game.handleUnsubmit('b');
    game.drawBlack();
    game.drawWhite(); // null fallback
    expect(game.exposureEvents).toEqual(original);
    const restored = MadLadGame.restore(room, JSON.parse(JSON.stringify(game.serialize())));
    expect(restored.exposureEvents).toEqual(original);
    restored.acknowledgeExposures(original);
    restored.refillHand(restored.state.players.b);
    expect(restored.exposureEvents).toEqual([]);
    const legacy = game.serialize();
    delete legacy.exposureEvents;
    expect(MadLadGame.restore(room, legacy).exposureEvents).toEqual([]);
  });

  test('a restored table can resume when the old judge never returns', () => {
    const game = makeGame();
    const restored = MadLadGame.restore(room, JSON.parse(JSON.stringify(game.serialize())));
    Object.values(restored.state.players).forEach((p) => { p.isActive = false; });
    restored.acknowledgeExposures(restored.exposureEvents);
    restored.handlePlayerReconnect('b');
    restored.handlePlayerReconnect('c');
    expect(restored.exposureEvents).toEqual([]);
    restored.addLatePlayer('d', 'd');
    expect(restored.state.judgeId).toBe('b');
    expect(events(restored, 'prompt_exposed')).toHaveLength(1);
  });

  test('deck loading/waiting and null fallback cards do not count', () => {
    expect(new MadLadGame({ getAllPlayers: () => [] }, { deck }).exposureEvents).toEqual([]);
    const game = new MadLadGame(room);
    expect(game.exposureEvents).toEqual([]);
    game.handleDiscardCard('b', { cardIndex: 0 });
    expect(game.exposureEvents).toEqual([]);
  });

  test('late joins count new hands; acknowledging a batch retains later events', () => {
    const game = makeGame();
    const opening = game.exposureEvents.slice();
    game.discardPile.push(...deck.answers.slice(0, 8));
    game.addLatePlayer('d', 'd');
    game.acknowledgeExposures(opening);
    expect(events(game, 'answer_dealt')).toHaveLength(8);
  });
});

describe('durable exposure ledger', () => {
  let database;
  let knex;
  let stats;
  let sessions;
  beforeAll(async () => {
    database = useTestDb('exposures');
    await database.migrateToLatest();
    knex = database.db();
    stats = require('../src/content/CardStatsRepository');
    sessions = require('../src/content/SessionRepository');
    const [{ id: packId }] = await knex('packs').insert({
      slug: 'exposures', name: 'Exposures', game_id: 'madlad',
    }).returning('id');
    await knex('cards').insert([...deck.prompts, ...deck.answers].map((card) => ({
      ...card, kind: card.id === 1 ? 'prompt' : 'answer', game_id: 'madlad', pack_id: packId,
    })));
  });
  afterAll(async () => { await database.close(); cleanupTestDb(); });
  beforeEach(async () => {
    await knex('card_exposure_events').del();
    await knex('card_stats').del();
    await knex('sessions').del();
  });

  test('concurrent duplicate deliveries count once; later redeals count again', async () => {
    const batch = makeGame().exposureEvents;
    await Promise.all([stats.recordExposureEvents(batch), stats.recordExposureEvents(batch)]);
    expect(await knex('card_exposure_events')).toHaveLength(25);
    expect(await knex('card_stats').where({ card_id: 1 }).first())
      .toMatchObject({ plays: 0, wins: 0, deals: 0, prompt_exposures: 1 });
    const next = { ...batch.find((e) => e.kind === 'answer_dealt'), eventId: 'new-deal' };
    await stats.recordExposureEvents([next, { eventId: 'null', cardId: null, kind: 'answer_dealt' }]);
    await stats.recordRoundOutcome({ playedCardIds: [next.cardId], winningCardId: next.cardId });
    expect(await knex('card_stats').where({ card_id: next.cardId }).first())
      .toMatchObject({ plays: 1, wins: 1, deals: 2, prompt_exposures: 0 });
  });

  test('snapshot and counters commit together; restore/retry does not recount', async () => {
    const snapshot = makeGame().serialize();
    const input = { roomCode: 'TEST', gameType: 'madlad', stateVersion: 2, serializedState: snapshot };
    await sessions.snapshot(input);
    const restored = MadLadGame.restore(room, (await sessions.getByRoomCode('TEST')).serializedState);
    await sessions.snapshot({ ...input, stateVersion: 3, serializedState: restored.serialize() });
    expect(await knex('card_exposure_events')).toHaveLength(25);
    const older = makeGame().serialize();
    await sessions.snapshot({ ...input, stateVersion: 1, serializedState: older });
    expect((await sessions.getByRoomCode('TEST')).stateVersion).toBe(3);
    expect(await knex('card_exposure_events')).toHaveLength(25);
  });

  test('failure rolls back both state and counts and is retryable', async () => {
    const snapshot = makeGame().serialize();
    const bad = { cardId: 2, kind: 'answer_dealt' }; // missing NOT NULL event ID
    await expect(sessions.snapshot({
      roomCode: 'FAIL', gameType: 'madlad', stateVersion: 1,
      serializedState: { ...snapshot, exposureEvents: [...snapshot.exposureEvents, bad] },
    })).rejects.toThrow();
    expect(await sessions.getByRoomCode('FAIL')).toBeNull();
    expect(await knex('card_stats')).toEqual([]);
    await sessions.snapshot({ roomCode: 'FAIL', gameType: 'madlad', stateVersion: 1, serializedState: snapshot });
    expect(await knex('card_exposure_events')).toHaveLength(25);
  });

  test('start time is durable and history is explicitly unknown', async () => {
    const tracking = await stats.exposureTracking();
    expect(tracking.started_at).toBeTruthy();
    expect(tracking.historical_counts_known).toBe(false);
    expect(await stats.exposureTracking()).toEqual(tracking);
  });
});
