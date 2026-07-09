const BaseGame = require('./BaseGame');

const HAND_SIZE = 8;
const DEFAULT_TARGET_SCORE = 5;
const MIN_PLAYERS = 3;
// A player may swap one card for a fresh draw per round, for free.
const MAX_DISCARDS_PER_ROUND = 1;

/**
 * MadLad game engine.
 *
 * Flow per round:
 *   answering -> every non-judge submits one white card
 *   judging   -> the Card Czar (judge) picks the funniest submission
 *   results   -> winner shown, +1 point, anyone can advance to the next round
 *   gameover  -> a player reached the target score
 *
 * Each player receives a private view (their hand) via getStateForPlayer().
 * Spectators (TV / host) receive getPublicState(), which never leaks hands
 * and keeps submissions anonymous until judging.
 *
 * The deck is *injected* via `options.deck` ({ prompts:[{id,text,blanks}],
 * answers:[{id,text}] }) — the engine never touches the DB. Cards are carried
 * as objects internally (id + text) so ids survive play (E3 sprites, snapshots),
 * but the wire format (getPublicState/getStateForPlayer) still emits plain text
 * for backward compatibility with the current client.
 */
class MadLadGame extends BaseGame {
  static get MIN_PLAYERS() {
    return MIN_PLAYERS;
  }

  constructor(room, options = {}) {
    super(room, options);
    this.gameType = 'madlad';

    const deck = options.deck || { prompts: [], answers: [] };
    // Keep the full prompt list so the black pile can reshuffle when exhausted.
    this.allPrompts = deck.prompts.slice();
    this.drawPile = this.shuffle(deck.answers.slice());
    this.discardPile = [];
    this.blackPile = this.shuffle(deck.prompts.slice());

    this.state = {
      phase: 'answering',
      round: 1,
      targetScore: options.targetScore || DEFAULT_TARGET_SCORE,
      handSize: HAND_SIZE,
      blackCard: null,
      judgeId: null,
      judgePointer: 0,
      players: {},
      submissions: [], // [{ id, text, playerId, card }]
      lastWinner: null, // { playerId, playerName, text }
      winnerId: null,
      message: '',
    };

    // Seat players in a stable order for judge rotation.
    this.seatOrder = [];
    room.getAllPlayers().forEach((player) => {
      this.state.players[player.id] = this.createPlayerState(player);
      this.seatOrder.push(player.id);
    });

    this.startRound(true);
  }

  createPlayerState(player) {
    return {
      id: player.id,
      name: player.name,
      // Bots answer but never judge — a human is always the Card Czar.
      isBot: Boolean(player.isBot),
      hand: [],
      score: 0,
      isActive: player.isActive !== false,
      submittedCardId: null,
      // Per-round free swaps used (reset in startRound); caps at MAX_DISCARDS_PER_ROUND.
      discardsThisRound: 0,
    };
  }

  // ---- Deck helpers ------------------------------------------------------

  shuffle(cards) {
    const shuffled = cards.slice();
    for (let i = shuffled.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  }

  drawWhite() {
    if (this.drawPile.length === 0) {
      this.drawPile = this.shuffle(this.discardPile);
      this.discardPile = [];
    }
    return this.drawPile.pop() || { id: null, text: '(blank card)' };
  }

  drawBlack() {
    if (this.blackPile.length === 0) {
      this.blackPile = this.shuffle(this.allPrompts.slice());
    }
    return this.blackPile.pop();
  }

  // ---- Player set helpers ------------------------------------------------

  getActiveIds() {
    return this.seatOrder.filter((id) => {
      const p = this.state.players[id];
      return p && p.isActive;
    });
  }

  getActiveNonJudgeIds() {
    return this.getActiveIds().filter((id) => id !== this.state.judgeId);
  }

  refillHand(player) {
    while (player.hand.length < HAND_SIZE) {
      player.hand.push(this.drawWhite());
    }
  }

  // ---- Round lifecycle ---------------------------------------------------

  startRound(isFirst = false) {
    const activeIds = this.getActiveIds();

    if (activeIds.length < MIN_PLAYERS) {
      this.state.phase = 'waiting';
      this.state.message = `Waiting for players (need at least ${MIN_PLAYERS})...`;
      return;
    }

    if (!isFirst) {
      this.state.judgePointer = (this.state.judgePointer + 1) % activeIds.length;
      this.state.round += 1;
    } else {
      this.state.judgePointer %= activeIds.length;
    }

    this.state.judgeId = this.chooseJudge(activeIds);

    // Deal / refill everyone up to a full hand.
    activeIds.forEach((id) => {
      const player = this.state.players[id];
      player.submittedCardId = null;
      // Refresh the free-swap budget so each round gets exactly one.
      player.discardsThisRound = 0;
      this.refillHand(player);
    });

    this.state.blackCard = this.drawBlack();
    this.state.submissions = [];
    this.state.phase = 'answering';

    const judge = this.state.players[this.state.judgeId];
    this.state.message = `Round ${this.state.round} — ${judge.name} is the Card Czar. Everyone else, play a card!`;
  }

  /**
   * Pick the Card Czar for the round, skipping bots so a human always judges.
   * Scans the active ring starting at the current judgePointer and lands on the
   * first non-bot, updating the pointer to match. If the table is somehow all
   * bots (every human has left — the room is being torn down), falls back to the
   * pointer as-is so nothing crashes.
   */
  chooseJudge(activeIds) {
    const n = activeIds.length;
    for (let i = 0; i < n; i += 1) {
      const idx = (this.state.judgePointer + i) % n;
      if (!this.state.players[activeIds[idx]].isBot) {
        this.state.judgePointer = idx;
        return activeIds[idx];
      }
    }
    return activeIds[this.state.judgePointer % n];
  }

  maybeAdvanceToJudging() {
    const expected = this.getActiveNonJudgeIds();
    const allIn = expected.length > 0 && expected.every(
      (id) => this.state.players[id].submittedCardId,
    );
    if (allIn) {
      this.state.submissions = this.shuffle(this.state.submissions);
      this.state.phase = 'judging';
      const judge = this.state.players[this.state.judgeId];
      this.state.message = `${judge.name} is choosing the funniest answer...`;
    }
  }

  // ---- Public engine API (used by GameRoom / server) ---------------------

  getInitialState() {
    return this.getPublicState();
  }

  handlePlayerAction(playerId, actionData = {}) {
    const { action, data = {} } = actionData;
    switch (action) {
    case 'submit-card':
      return this.handleSubmitCard(playerId, data);
    case 'unsubmit-card':
      return this.handleUnsubmit(playerId);
    case 'discard-card':
      return this.handleDiscardCard(playerId, data);
    case 'pick-winner':
      return this.handlePickWinner(playerId, data);
    case 'next-round':
      return this.handleNextRound(playerId);
    default:
      return null;
    }
  }

  handleSubmitCard(playerId, data) {
    if (this.state.phase !== 'answering') return null;
    if (playerId === this.state.judgeId) return null;

    const player = this.state.players[playerId];
    if (!player || !player.isActive || player.submittedCardId) return null;

    const cardIndex = Number(data.cardIndex);
    if (!Number.isInteger(cardIndex) || cardIndex < 0 || cardIndex >= player.hand.length) {
      return null;
    }

    const [card] = player.hand.splice(cardIndex, 1);
    const submissionId = `${playerId}:${this.state.round}`;
    this.state.submissions.push({
      id: submissionId, text: card.text, playerId, card,
    });
    player.submittedCardId = submissionId;

    this.maybeAdvanceToJudging();
    return { ok: true };
  }

  handleUnsubmit(playerId) {
    // Take your card back — only while the round is still collecting cards
    // (phase 'answering', before it advances to judging). The card returns to
    // your hand and your submission is withdrawn.
    if (this.state.phase !== 'answering') return null;
    const player = this.state.players[playerId];
    if (!player || !player.submittedCardId) return null;

    const idx = this.state.submissions.findIndex((s) => s.playerId === playerId);
    if (idx === -1) return null;

    const [sub] = this.state.submissions.splice(idx, 1);
    player.hand.push(sub.card);
    player.submittedCardId = null;
    return { ok: true };
  }

  /**
   * Swap a single card for a fresh draw — free, but capped at one per round.
   * Only while still collecting cards ('answering'), only before this player has
   * submitted, and only if the per-round budget hasn't been spent. The discarded
   * card goes to the discard pile and refillHand tops the hand back to HAND_SIZE.
   */
  handleDiscardCard(playerId, data) {
    if (this.state.phase !== 'answering') return null;
    if (playerId === this.state.judgeId) return null;

    const player = this.state.players[playerId];
    if (!player || !player.isActive || player.submittedCardId) return null;
    if ((player.discardsThisRound || 0) >= MAX_DISCARDS_PER_ROUND) return null;

    const cardIndex = Number(data.cardIndex);
    if (!Number.isInteger(cardIndex) || cardIndex < 0 || cardIndex >= player.hand.length) {
      return null;
    }

    const [card] = player.hand.splice(cardIndex, 1);
    this.discardPile.push(card);
    this.refillHand(player); // draws exactly one replacement back up to HAND_SIZE
    player.discardsThisRound = (player.discardsThisRound || 0) + 1;
    return { ok: true };
  }

  handlePickWinner(playerId, data) {
    if (this.state.phase !== 'judging') return null;
    if (playerId !== this.state.judgeId) return null;

    const submission = this.state.submissions.find((s) => s.id === data.submissionId);
    if (!submission) return null;

    const winner = this.state.players[submission.playerId];
    if (winner) winner.score += 1;

    this.state.lastWinner = {
      playerId: submission.playerId,
      playerName: winner ? winner.name : 'Someone',
      text: submission.text,
    };

    // Retire the submitted cards back to the discard pile.
    this.discardPile.push(...this.state.submissions.map((s) => s.card));

    if (winner && winner.score >= this.state.targetScore) {
      this.state.phase = 'gameover';
      this.state.winnerId = winner.id;
      this.state.message = `${winner.name} wins the game with ${winner.score} points! 🎉`;
    } else {
      this.state.phase = 'results';
      this.state.message = `"${submission.text}" — ${this.state.lastWinner.playerName} takes the round!`;
    }
    return { ok: true };
  }

  handleNextRound(playerId) {
    if (this.state.phase !== 'results') return null;
    // Only active players may advance (prevents spectator spoofing).
    const player = this.state.players[playerId];
    if (!player || !player.isActive) return null;
    this.startRound(false);
    return { ok: true };
  }

  // ---- Membership changes ------------------------------------------------

  addLatePlayer(playerId, playerName) {
    if (this.state.players[playerId]) {
      this.state.players[playerId].isActive = true;
    } else {
      this.state.players[playerId] = this.createPlayerState({
        id: playerId,
        name: playerName,
        isActive: true,
      });
      this.seatOrder.push(playerId);
    }
    this.refillHand(this.state.players[playerId]);

    // A late joiner might complete an answering round they can't join,
    // or let a stalled round proceed.
    if (this.state.phase === 'answering') {
      this.maybeAdvanceToJudging();
    } else if (this.state.phase === 'waiting') {
      this.startRound(true);
    }
  }

  handlePlayerLeave(playerId) {
    const player = this.state.players[playerId];
    if (!player) return;
    player.isActive = false;

    // Permanent departure: return any un-submitted hand to the discard pile.
    this.discardPile.push(...player.hand);
    player.hand = [];

    this.reflowAfterDeparture(playerId);
  }

  /**
   * Temporary disconnect: pause the player (so a round can't stall waiting on a
   * dead socket) but KEEP their hand, score, and submission so a reconnect
   * within the grace window restores them exactly. Mirrors handlePlayerLeave's
   * round bookkeeping, minus discarding the hand.
   */
  handlePlayerDisconnect(playerId) {
    const player = this.state.players[playerId];
    if (!player) return;
    player.isActive = false;
    this.reflowAfterDeparture(playerId);
  }

  /**
   * A held seat comes back online: resume participation, top the hand up in case
   * rounds advanced while away, and clear a stale "submitted" flag left over
   * from a round that ended during the absence.
   */
  handlePlayerReconnect(playerId) {
    const player = this.state.players[playerId];
    if (!player) return;
    player.isActive = true;
    this.refillHand(player);

    // If nothing in the current round's submissions is theirs, they have not
    // submitted THIS round — drop any leftover flag so they can play again.
    const hasLiveSubmission = this.state.submissions.some((s) => s.playerId === playerId);
    if (!hasLiveSubmission) player.submittedCardId = null;

    if (this.state.phase === 'waiting') {
      const activeIds = this.getActiveIds();
      if (activeIds.length >= MIN_PLAYERS) this.startRound(true);
    } else if (this.state.phase === 'answering') {
      // Their return re-opens a slot; re-evaluate whether the round can proceed.
      this.maybeAdvanceToJudging();
    }
  }

  /**
   * Shared round bookkeeping after a player stops participating (left OR
   * disconnected): fall back to waiting if too few remain, otherwise keep the
   * round moving — reassigning the judge if the departed player held that seat.
   */
  reflowAfterDeparture(playerId) {
    const activeIds = this.getActiveIds();
    if (activeIds.length < MIN_PLAYERS) {
      this.state.phase = 'waiting';
      this.state.message = `Waiting for players (need at least ${MIN_PLAYERS})...`;
      return;
    }

    if (this.state.phase === 'answering') {
      if (playerId === this.state.judgeId) {
        // Judge bailed mid-round; restart the round with a new judge.
        this.state.judgePointer %= activeIds.length;
        this.startRound(true);
      } else {
        this.maybeAdvanceToJudging();
      }
    } else if (this.state.phase === 'judging' && playerId === this.state.judgeId) {
      // Judge left while judging; restart the round so a new judge decides.
      this.state.judgePointer %= activeIds.length;
      this.startRound(true);
    }
  }

  getWinnerId() {
    return this.state.winnerId;
  }

  /**
   * Pure snapshot of the just-resolved round for telemetry (F1). Derived from
   * the current submissions and lastWinner — NO side effects, no DB. Returns
   * null until a winner has been picked (phase results/gameover). Submissions
   * whose card has no id (the '(blank card)' fallback) are omitted.
   * @returns {{ blackCardId: number|null,
   *   submissions: Array<{cardId:number, playerId:string, won:boolean}> } | null}
   */
  getLastRoundOutcome() {
    const { submissions, lastWinner, blackCard } = this.state;
    if (!lastWinner || !submissions || submissions.length === 0) return null;

    const scored = submissions
      .filter((s) => s.card && s.card.id != null)
      .map((s) => ({
        cardId: s.card.id,
        playerId: s.playerId,
        won: s.playerId === lastWinner.playerId,
      }));

    if (scored.length === 0) return null;

    return {
      blackCardId: blackCard && blackCard.id != null ? blackCard.id : null,
      submissions: scored,
    };
  }

  // ---- Persistence (opt-in serialize / restore) --------------------------

  /** Plain-JSON snapshot of everything needed to rebuild this game. */
  serialize() {
    return {
      version: 1,
      gameType: 'madlad',
      state: this.state,
      seatOrder: this.seatOrder,
      drawPile: this.drawPile,
      discardPile: this.discardPile,
      blackPile: this.blackPile,
      allPrompts: this.allPrompts,
    };
  }

  /**
   * Rebuild an engine from a snapshot. Bypasses the constructor so we do NOT
   * re-deal a fresh round — restore is a pure state assignment. The snapshot
   * already contains the drawn/remaining cards, so no deck/DB fetch is needed.
   */
  static restore(room, snapshot, options = {}) {
    const game = Object.create(MadLadGame.prototype);
    // Assign the base fields directly (an ES6 class constructor can't be .call()ed).
    game.room = room;
    game.options = options;
    game.gameType = 'madlad';
    game.allPrompts = snapshot.allPrompts || [];
    game.drawPile = snapshot.drawPile || [];
    game.discardPile = snapshot.discardPile || [];
    game.blackPile = snapshot.blackPile || [];
    game.seatOrder = snapshot.seatOrder || [];
    game.state = snapshot.state;
    return game;
  }

  // ---- State projections -------------------------------------------------

  getScores() {
    return this.getActiveIds()
      .map((id) => {
        const p = this.state.players[id];
        return { id: p.id, name: p.name, score: p.score };
      })
      .sort((a, b) => b.score - a.score);
  }

  getPublicState() {
    const { phase } = this.state;
    const revealAuthors = phase === 'results' || phase === 'gameover';
    const showSubmissions = phase === 'judging' || revealAuthors;

    const submissions = showSubmissions
      ? this.state.submissions.map((s) => ({
        id: s.id,
        text: s.text,
        // Card DB id, exposed so the client can flag it (F2). Carries no
        // authorship, so it's safe during anonymous judging. Null for blanks.
        cardId: s.card && s.card.id != null ? s.card.id : null,
        playerName: revealAuthors ? this.state.players[s.playerId]?.name : undefined,
        isWinner: revealAuthors && this.state.lastWinner
          ? s.playerId === this.state.lastWinner.playerId
          : false,
      }))
      : [];

    const judge = this.state.players[this.state.judgeId];

    return {
      gameType: 'madlad',
      phase,
      round: this.state.round,
      targetScore: this.state.targetScore,
      // Wire format stays plain text (client reads a string); the id lives on
      // the internal card object for E3/snapshots.
      blackCard: this.state.blackCard ? this.state.blackCard.text : null,
      judgeId: this.state.judgeId,
      judgeName: judge ? judge.name : null,
      message: this.state.message,
      submittedCount: this.getActiveNonJudgeIds().filter(
        (id) => this.state.players[id].submittedCardId,
      ).length,
      expectedCount: this.getActiveNonJudgeIds().length,
      submissions,
      scores: this.getScores(),
      lastWinner: revealAuthors ? this.state.lastWinner : null,
      winnerName: this.state.winnerId ? this.state.players[this.state.winnerId]?.name : null,
    };
  }

  getStateForPlayer(playerId) {
    const pub = this.getPublicState();
    const player = this.state.players[playerId];

    if (!player) {
      return {
        ...pub, you: null, hand: [], availableActions: [],
      };
    }

    const isJudge = playerId === this.state.judgeId;
    // A player can swap a card while answering, before submitting, with budget left.
    const canDiscard = this.state.phase === 'answering'
      && !isJudge
      && !player.submittedCardId
      && (player.discardsThisRound || 0) < MAX_DISCARDS_PER_ROUND;
    const availableActions = [];
    if (this.state.phase === 'results') {
      availableActions.push({ type: 'next-round', label: 'Next Round' });
    }
    // While the round is still collecting cards, let a player take theirs back.
    if (this.state.phase === 'answering' && !isJudge && player.submittedCardId) {
      availableActions.push({ type: 'unsubmit-card', label: '↩ Take my card back' });
    }

    return {
      ...pub,
      you: {
        id: player.id,
        name: player.name,
        isJudge,
        hasSubmitted: Boolean(player.submittedCardId),
        canDiscard,
        score: player.score,
      },
      hand: player.hand.map((card, index) => ({ index, text: card.text, cardId: card.id })),
      availableActions,
    };
  }

  cleanup() {
    this.state = null;
  }
}

module.exports = MadLadGame;
