// S1 — end-to-end persistence: snapshot a live MadLad room, rehydrate it on
// access into a playable room (returning players re-attach to their seats), and
// the resumable-TTL sweep marks stale paused sessions abandoned + drops them.
//
// Persistence defaults OFF under test (config.session.persist), so this suite
// force-enables it on the shared config instance the server already holds.
const { useTestDb, cleanupTestDb } = require('./helpers/testDb');

const makeDeck = () => ({
  prompts: Array.from({ length: 20 }, (_, i) => ({ id: i + 1, text: `Prompt ${i + 1} ____.`, blanks: 1 })),
  answers: Array.from({ length: 80 }, (_, i) => ({ id: 100 + i, text: `Answer ${i + 1}.` })),
});

describe('S1 session persistence', () => {
  let db;
  let knex;
  let config;
  let gameManager;
  let SessionRepository;
  let serverMod;

  beforeAll(async () => {
    db = useTestDb('session-persist');
    await db.migrateToLatest();
    knex = db.db();

    /* eslint-disable global-require */
    config = require('../src/utils/config');
    config.session.persist = true; // force ON for this suite
    config.session.resumableTtlMs = 60 * 1000;
    gameManager = require('../src/game/GameManager');
    SessionRepository = require('../src/content/SessionRepository');
    serverMod = require('../src/server/index'); // exports rehydrateRoom/sweepSessions/writeSnapshot
    /* eslint-enable global-require */
  });

  afterAll(async () => {
    serverMod.io.close();
    await db.close();
    cleanupTestDb();
  });

  test('snapshots a live room and rehydrates it into a playable room', async () => {
    const code = 'ROOM';
    const room = gameManager.createRoom(code);
    ['p1', 'p2', 'p3'].forEach((id) => room.addPlayer(id, id.toUpperCase(), global.createMockSocket()));
    room.startGame('madlad', { deck: makeDeck(), targetScore: 5 });

    // Give p2 a distinctive score so we can prove state survives the round-trip.
    room.gameEngine.state.players.p2.score = 3;

    await serverMod.writeSnapshot(room);

    // The snapshot landed as an active session.
    const rec = await SessionRepository.getByRoomCode(code);
    expect(rec.status).toBe('active');
    expect(rec.gameType).toBe('madlad');
    expect(rec.serializedState.state.players.p2.score).toBe(3);

    // Drop the room from memory (simulates a restart / idle eviction).
    gameManager.removeRoom(code);
    expect(gameManager.getRoom(code)).toBeUndefined();

    // Rehydrate on access.
    const revived = await serverMod.rehydrateRoom(code);
    expect(revived).toBeTruthy();
    expect(revived.isGameActive).toBe(true);
    expect(revived.gameType).toBe('madlad');
    expect(revived.gameEngine).toBeTruthy();
    // Score preserved through serialize -> restore.
    expect(revived.gameEngine.state.players.p2.score).toBe(3);

    // Human seats came back as HELD seats (no socket, paused) so a returning
    // clientId re-attaches instead of joining fresh.
    const held = revived.getPlayer('p1');
    expect(held).toBeTruthy();
    expect(held.connected).toBe(false);
    expect(held.isActive).toBe(false);

    // Returning players re-attach by identity and the game resumes to play.
    ['p1', 'p2', 'p3'].forEach((id) => revived.reconnectPlayer(id, global.createMockSocket()));
    expect(revived.gameEngine.getActiveIds().sort()).toEqual(['p1', 'p2', 'p3']);
    expect(revived.gameEngine.state.phase).toBe('answering');
    // Still playable: a non-judge can submit a card.
    const nonJudge = ['p1', 'p2', 'p3'].find((id) => id !== revived.gameEngine.state.judgeId);
    const result = revived.handlePlayerAction(nonJudge, { action: 'submit-card', data: { cardIndex: 0 } });
    expect(result).toEqual({ ok: true });

    gameManager.removeRoom(code);
  });

  test('does not rehydrate a completed session', async () => {
    await SessionRepository.snapshot({
      roomCode: 'DONE', gameType: 'madlad', stateVersion: 1, serializedState: { state: { players: {} } }, status: 'active',
    });
    await SessionRepository.markStatus('DONE', 'completed');
    const revived = await serverMod.rehydrateRoom('DONE');
    expect(revived).toBeNull();
  });

  test('TTL sweep abandons + drops stale paused sessions, keeps fresh ones', async () => {
    // Stale paused session, aged well past the TTL.
    await SessionRepository.snapshot({
      roomCode: 'STAL', gameType: 'madlad', stateVersion: 1, serializedState: {}, status: 'active',
    });
    await SessionRepository.markStatus('STAL', 'paused');
    await knex('sessions').where({ room_code: 'STAL' })
      .update({ last_activity: Date.now() - (2 * config.session.resumableTtlMs) });

    // Fresh paused session, within the TTL.
    await SessionRepository.snapshot({
      roomCode: 'FRSH', gameType: 'madlad', stateVersion: 1, serializedState: {}, status: 'active',
    });
    await SessionRepository.markStatus('FRSH', 'paused');

    await serverMod.sweepSessions();

    // Stale one abandoned then pruned (dropped); fresh one still resumable.
    expect(await SessionRepository.getByRoomCode('STAL')).toBeNull();
    expect((await SessionRepository.getByRoomCode('FRSH')).status).toBe('paused');
  });
});
