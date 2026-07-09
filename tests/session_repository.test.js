// S1 — SessionRepository: upsert snapshots, status transitions, resumable
// listing, and abandoned pruning.
const { useTestDb, cleanupTestDb } = require('./helpers/testDb');

describe('SessionRepository', () => {
  let db;
  let knex;
  let SessionRepository;

  beforeAll(async () => {
    db = useTestDb('sessions');
    await db.migrateToLatest();
    knex = db.db();
    SessionRepository = require('../src/content/SessionRepository');
  });

  afterAll(async () => {
    await db.close();
    cleanupTestDb();
  });

  const rowCount = async () => Number((await knex('sessions').count({ c: '*' }).first()).c);

  test('snapshot inserts a session row', async () => {
    await SessionRepository.snapshot({
      roomCode: 'AAAA',
      gameType: 'madlad',
      stateVersion: 1,
      serializedState: { version: 1, state: { phase: 'answering' } },
      status: 'active',
    });
    expect(await rowCount()).toBe(1);
    const rec = await SessionRepository.getByRoomCode('AAAA');
    expect(rec.gameType).toBe('madlad');
    expect(rec.status).toBe('active');
    expect(rec.stateVersion).toBe(1);
    // Round-trips through JSON text unchanged.
    expect(rec.serializedState).toEqual({ version: 1, state: { phase: 'answering' } });
  });

  test('snapshot upserts by room_code (no duplicate rows)', async () => {
    await SessionRepository.snapshot({
      roomCode: 'AAAA',
      gameType: 'madlad',
      stateVersion: 2,
      serializedState: { version: 1, state: { phase: 'judging' } },
      status: 'active',
    });
    expect(await rowCount()).toBe(1); // still one row
    const rec = await SessionRepository.getByRoomCode('AAAA');
    expect(rec.stateVersion).toBe(2);
    expect(rec.serializedState.state.phase).toBe('judging');
  });

  test('ignores invalid input', async () => {
    await SessionRepository.snapshot({ roomCode: '', gameType: 'madlad' });
    await SessionRepository.snapshot({ roomCode: 'BBBB', gameType: '' });
    await SessionRepository.snapshot({ roomCode: 'BBBB', gameType: 'madlad', status: 'bogus' });
    expect(await rowCount()).toBe(1);
  });

  test('markStatus transitions a session', async () => {
    await SessionRepository.markStatus('AAAA', 'completed');
    const rec = await SessionRepository.getByRoomCode('AAAA');
    expect(rec.status).toBe('completed');
  });

  test('listResumable returns only active/paused sessions', async () => {
    await SessionRepository.snapshot({
      roomCode: 'CCCC', gameType: 'madlad', stateVersion: 1, serializedState: {}, status: 'active',
    });
    await SessionRepository.snapshot({
      roomCode: 'DDDD', gameType: 'madlad', stateVersion: 1, serializedState: {}, status: 'active',
    });
    await SessionRepository.markStatus('DDDD', 'paused');
    const resumable = await SessionRepository.listResumable();
    const codes = resumable.map((r) => r.roomCode).sort();
    // AAAA is 'completed' now, so excluded.
    expect(codes).toEqual(['CCCC', 'DDDD']);
    // Light rows: no heavy serialized_state.
    expect(resumable[0].serializedState).toBeUndefined();
  });

  test('pruneAbandoned deletes only stale abandoned rows', async () => {
    // Age CCCC's last_activity well into the past and abandon it.
    await knex('sessions').where({ room_code: 'CCCC' })
      .update({ status: 'abandoned', last_activity: Date.now() - (60 * 60 * 1000) });
    const deleted = await SessionRepository.pruneAbandoned(30 * 60 * 1000);
    expect(deleted).toBe(1);
    expect(await SessionRepository.getByRoomCode('CCCC')).toBeNull();
    // DDDD (paused, recent) survives.
    expect((await SessionRepository.getByRoomCode('DDDD')).status).toBe('paused');
  });
});
