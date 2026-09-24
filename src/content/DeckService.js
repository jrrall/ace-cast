/**
 * DeckService — turns pack selection into a playable deck.
 *
 * Returns card *objects* (not bare strings) so the engine can carry ids through
 * play (needed by E3 sprites and by serialize/restore). The engine stays pure:
 * it receives the deck via options and never touches the DB itself.
 */
const PackRepository = require('./PackRepository');
const CardRepository = require('./CardRepository');

/**
 * Build a deck for a game.
 * @param {{ gameId: string, packIds?: number[], maturityMax?: number }} params
 *   Empty/omitted packIds falls back to the game's default pack, unioned with
 *   the game's generated pack (`<gameId>-generated`) when it exists — so that
 *   human-approved Card Forge content (F1) actually reaches the live deck. Only
 *   `approved` cards flow through either pack (CardRepository.listForDeck).
 * @returns {Promise<{ prompts: Array<{id,text,blanks}>, answers: Array<{id,text}> }>}
 */
async function buildDeck({ gameId, packIds = [], maturityMax = 3 }) {
  let ids = Array.isArray(packIds) ? packIds.filter((n) => Number.isInteger(n)) : [];

  if (ids.length === 0) {
    const fallback = await PackRepository.getDefault(gameId);
    if (!fallback) {
      throw new Error(`No default pack configured for game "${gameId}"`);
    }
    ids = [fallback.id];
    // Union the generated pack (if seeded) so approved AI cards publish. Its
    // pending/denied cards are still filtered out at the query boundary.
    const generated = await PackRepository.getBySlug(`${gameId}-generated`);
    if (generated && generated.id !== fallback.id) {
      ids.push(generated.id);
    }
  }

  const cards = await CardRepository.listForDeck({ gameId, packIds: ids, maturityMax });

  const prompts = cards
    .filter((c) => c.kind === 'prompt')
    .map((c) => ({ id: c.id, text: c.text, blanks: c.blanks }));
  const answers = cards
    .filter((c) => c.kind === 'answer')
    .map((c) => ({ id: c.id, text: c.text }));

  if (prompts.length === 0 || answers.length === 0) {
    throw new Error(
      `Deck for game "${gameId}" is empty (prompts: ${prompts.length}, answers: ${answers.length}). `
      + 'Check pack selection and maturity ceiling.',
    );
  }

  return { prompts, answers };
}

module.exports = { buildDeck };
