const { BLACK_CARDS, WHITE_CARDS } = require('../data/cahCards');

const HAND_SIZE = 7;
const DEFAULT_TARGET_SCORE = 5;
const MIN_PLAYERS = 3;

/**
 * Cards Against Humanity game engine.
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
 */
class CAHGame {
  static get MIN_PLAYERS() {
    return MIN_PLAYERS;
  }

  constructor(room, options = {}) {
    this.room = room;
    this.options = options;
    this.gameType = 'cah';

    this.drawPile = this.shuffle(WHITE_CARDS.slice());
    this.discardPile = [];
    this.blackPile = this.shuffle(BLACK_CARDS.slice());

    this.state = {
      phase: 'answering',
      round: 1,
      targetScore: options.targetScore || DEFAULT_TARGET_SCORE,
      handSize: HAND_SIZE,
      blackCard: null,
      judgeId: null,
      judgePointer: 0,
      players: {},
      submissions: [], // [{ id, text, playerId }]
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
      hand: [],
      score: 0,
      isActive: player.isActive !== false,
      submittedCardId: null,
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
    return this.drawPile.pop() || '(blank card)';
  }

  drawBlack() {
    if (this.blackPile.length === 0) {
      this.blackPile = this.shuffle(BLACK_CARDS.slice());
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

    this.state.judgeId = activeIds[this.state.judgePointer % activeIds.length];

    // Deal / refill everyone up to a full hand.
    activeIds.forEach((id) => {
      const player = this.state.players[id];
      player.submittedCardId = null;
      this.refillHand(player);
    });

    this.state.blackCard = this.drawBlack();
    this.state.submissions = [];
    this.state.phase = 'answering';

    const judge = this.state.players[this.state.judgeId];
    this.state.message = `Round ${this.state.round} — ${judge.name} is the Card Czar. Everyone else, play a card!`;
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

    const [text] = player.hand.splice(cardIndex, 1);
    const submissionId = `${playerId}:${this.state.round}`;
    this.state.submissions.push({ id: submissionId, text, playerId });
    player.submittedCardId = submissionId;

    this.maybeAdvanceToJudging();
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

    // Retire the submitted cards.
    this.discardPile.push(...this.state.submissions.map((s) => s.text));

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

    // Return any un-submitted hand to the discard pile.
    this.discardPile.push(...player.hand);
    player.hand = [];

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
        playerName: revealAuthors ? this.state.players[s.playerId]?.name : undefined,
        isWinner: revealAuthors && this.state.lastWinner
          ? s.playerId === this.state.lastWinner.playerId
          : false,
      }))
      : [];

    const judge = this.state.players[this.state.judgeId];

    return {
      gameType: 'cah',
      phase,
      round: this.state.round,
      targetScore: this.state.targetScore,
      blackCard: this.state.blackCard,
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
    const availableActions = [];
    if (this.state.phase === 'results') {
      availableActions.push({ type: 'next-round', label: 'Next Round' });
    }

    return {
      ...pub,
      you: {
        id: player.id,
        name: player.name,
        isJudge,
        hasSubmitted: Boolean(player.submittedCardId),
        score: player.score,
      },
      hand: player.hand.map((text, index) => ({ index, text })),
      availableActions,
    };
  }

  cleanup() {
    this.state = null;
  }
}

module.exports = CAHGame;
