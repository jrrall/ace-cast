// E2.3a — DeckService builds a deck from the seeded madlad-core pack.
const { BLACK_CARDS, WHITE_CARDS } = require('../src/game/data/madladCards');
const { useTestDb, cleanupTestDb } = require('./helpers/testDb');

describe('DeckService', () => {
  let db;
  let DeckService;
  let PackRepository;

  beforeAll(async () => {
    db = useTestDb('deck');
    await db.migrateToLatest();
    await db.seedRun();
    DeckService = require('../src/content/DeckService');
    PackRepository = require('../src/content/PackRepository');
  });

  afterAll(async () => {
    await db.close();
    cleanupTestDb();
  });

  test('falls back to the default pack when no packIds given', async () => {
    const deck = await DeckService.buildDeck({ gameId: 'madlad' });
    expect(deck.prompts).toHaveLength(BLACK_CARDS.length);
    expect(deck.answers).toHaveLength(WHITE_CARDS.length);
  });

  test('returns card objects with ids (not bare strings)', async () => {
    const deck = await DeckService.buildDeck({ gameId: 'madlad' });
    expect(typeof deck.prompts[0]).toBe('object');
    expect(deck.prompts[0]).toHaveProperty('id');
    expect(deck.prompts[0]).toHaveProperty('text');
    expect(deck.prompts[0]).toHaveProperty('blanks', 1);
    expect(deck.answers[0]).toHaveProperty('id');
    expect(deck.answers[0]).toHaveProperty('text');
  });

  test('honors an explicit packIds selection', async () => {
    const pack = await PackRepository.getDefault('madlad');
    const deck = await DeckService.buildDeck({ gameId: 'madlad', packIds: [pack.id] });
    expect(deck.prompts).toHaveLength(BLACK_CARDS.length);
  });

  test('maturity ceiling filters cards; empty deck throws', async () => {
    // Seeded cards are maturity 2, so a ceiling of 1 yields nothing.
    await expect(
      DeckService.buildDeck({ gameId: 'madlad', maturityMax: 1 }),
    ).rejects.toThrow(/empty/);
  });

  test('throws when a game has no default pack', async () => {
    await expect(
      DeckService.buildDeck({ gameId: 'nonexistent-game' }),
    ).rejects.toThrow(/no default pack/i);
  });
});
