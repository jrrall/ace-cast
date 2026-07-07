const config = require('../utils/config');
const MadLadGame = require('./games/MadLadGame');
const TestGame = require('./games/TestGame');

/**
 * Central registry of playable games. Adding a new game is a one-stop change:
 * add its entry here (plus its engine and client rendering). GameRoom and the
 * host UI both read from this list instead of hardcoding game types, so the
 * platform scales to many games cleanly.
 *
 * Entry shape:
 *   id          canonical game type sent over the wire
 *   name        display name
 *   description short blurb for the host UI
 *   minPlayers  minimum active players required to start
 *   maxPlayers  soft cap for display (hard cap enforced by config.room.maxPlayers)
 *   engine      the game engine class (constructed as `new engine(room, options)`)
 *   dev         when true, hidden from the public game list (developer-only)
 *   cardBacked  when true, the server builds a deck (via DeckService) and injects
 *               it as options.deck before starting the game
 */
const GAMES = [
  {
    id: 'madlad',
    name: 'MadLad',
    description: 'A fill-in-the-blank party game. Each round one judge picks the funniest answer.',
    minPlayers: MadLadGame.MIN_PLAYERS,
    maxPlayers: config.room.maxPlayers,
    engine: MadLadGame,
    dev: false,
    cardBacked: true,
  },
  {
    id: 'test',
    name: 'Test Game',
    description: 'Developer sanity-check game.',
    minPlayers: TestGame.MIN_PLAYERS,
    maxPlayers: config.room.maxPlayers,
    engine: TestGame,
    dev: true,
  },
];

const byId = new Map(GAMES.map((game) => [game.id, game]));

// Friendly / legacy aliases -> canonical id.
const ALIASES = {
  cah: 'madlad',
  'cards-against-humanity': 'madlad',
};

/**
 * Resolve any game-type string (canonical id or alias) to a canonical id.
 * @returns {string|null}
 */
function resolveId(gameType) {
  if (!gameType) return null;
  const key = String(gameType).toLowerCase();
  if (byId.has(key)) return key;
  return ALIASES[key] || null;
}

/**
 * Look up a game entry by id or alias.
 * @returns {object|null}
 */
function getGame(gameType) {
  const id = resolveId(gameType);
  return id ? byId.get(id) : null;
}

/**
 * List games as plain metadata (no engine class), for the host UI / API.
 * @param {{ includeDev?: boolean }} options
 * @returns {Array<object>}
 */
function listGames({ includeDev = false } = {}) {
  return GAMES
    .filter((game) => includeDev || !game.dev)
    .map(({ engine: _engine, ...meta }) => meta);
}

module.exports = {
  GAMES, getGame, resolveId, listGames,
};
