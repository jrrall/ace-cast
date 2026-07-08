/**
 * Server-side "bot" players.
 *
 * Bots are ordinary room players with no socket (see GameRoom.addPlayer's
 * `isBot`). They exist so a small group plays like a full table: once >= 2
 * humans are present the server fills the room with bots up to `room.botTarget`.
 *
 * Bots only ever ANSWER — the engine's judge rotation skips them, so a human is
 * always the Card Czar. This module just decides a bot's card (weighted-random
 * for now) and picks a winner in the safety-net case where a bot somehow judges
 * (only happens once every human has left, i.e. the room is being torn down).
 */

// Spooky filler names. Kept short so they read on the TV scoreboard.
const BOT_NAMES = [
  'Wraith', 'Gravemind', 'Mordecai', 'Baphomet', 'Nyx', 'Cinder',
  'Hex', 'Dagon', 'Morrigan', 'Azrael', 'Vesper', 'Requiem',
];

const MIN_DELAY_MS = 1500;
const MAX_DELAY_MS = 4200;

/** A human-feeling pause before a bot acts, so it doesn't answer instantly. */
function botDelay() {
  return MIN_DELAY_MS + Math.floor(Math.random() * (MAX_DELAY_MS - MIN_DELAY_MS));
}

/**
 * How many bots a room should seat: fill toward `botTarget` total, but only once
 * there are at least 2 humans, and never more than there is room for.
 * @returns {number}
 */
function desiredBotCount(humanCount, botTarget, maxPlayers = Infinity) {
  if (humanCount < 2) return 0;
  const target = Math.min(botTarget, maxPlayers);
  return Math.max(0, target - humanCount);
}

/** Pick a bot name not already used in the room. */
function nextBotName(takenNames = []) {
  const taken = new Set(takenNames);
  const free = BOT_NAMES.filter((n) => !taken.has(n));
  if (free.length) return free[Math.floor(Math.random() * free.length)];
  // Everything's taken — suffix a numeral until we find a gap.
  for (let i = 2; ; i += 1) {
    const base = BOT_NAMES[Math.floor(Math.random() * BOT_NAMES.length)];
    const name = `${base} ${i}`;
    if (!taken.has(name)) return name;
  }
}

/**
 * Schedule any pending bot moves for a room. `onAction(room, actionData)` runs
 * after each bot acts so the caller can broadcast + record telemetry. Each bot
 * carries a single `botTimer` so it's never double-scheduled; after acting we
 * re-schedule to catch the next bot's turn (or a phase change).
 */
function scheduleBotActions(room, onAction) {
  if (!room || !room.isGameActive || !room.gameEngine) return;
  const engine = room.gameEngine;
  if (typeof engine.getPublicState !== 'function' || typeof engine.getStateForPlayer !== 'function') return;

  const pub = engine.getPublicState();
  room.getAllPlayers().forEach((p) => {
    if (!p.isBot || !p.isActive || p.botTimer) return;

    const isAnswerer = pub.phase === 'answering' && p.id !== pub.judgeId;
    const isJudge = pub.phase === 'judging' && p.id === pub.judgeId; // safety net only
    if (!isAnswerer && !isJudge) return;

    p.botTimer = setTimeout(() => {
      p.botTimer = null;
      if (!room.isGameActive || !room.gameEngine) return;

      const now = engine.getPublicState();
      let actionData = null;
      if (now.phase === 'answering' && p.id !== now.judgeId) {
        const view = engine.getStateForPlayer(p.id);
        if (view.you && !view.you.hasSubmitted && view.hand && view.hand.length) {
          const card = view.hand[Math.floor(Math.random() * view.hand.length)];
          actionData = { action: 'submit-card', data: { cardIndex: card.index } };
        }
      } else if (now.phase === 'judging' && p.id === now.judgeId) {
        const subs = now.submissions || [];
        if (subs.length) {
          const win = subs[Math.floor(Math.random() * subs.length)];
          actionData = { action: 'pick-winner', data: { submissionId: win.id } };
        }
      }

      if (actionData) {
        const res = room.handlePlayerAction(p.id, actionData);
        if (res && typeof onAction === 'function') onAction(room, actionData);
      }
      // A submit may open the next bot's turn; re-scan.
      scheduleBotActions(room, onAction);
    }, botDelay());
    if (p.botTimer && p.botTimer.unref) p.botTimer.unref();
  });
}

/** Cancel any pending bot timers (game end / room cleanup). */
function clearBotTimers(room) {
  if (!room) return;
  room.getAllPlayers().forEach((p) => {
    if (p.botTimer) {
      clearTimeout(p.botTimer);
      p.botTimer = null;
    }
  });
}

module.exports = {
  BOT_NAMES, botDelay, desiredBotCount, nextBotName, scheduleBotActions, clearBotTimers,
};
