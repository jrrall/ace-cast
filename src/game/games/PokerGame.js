const { createLogger } = require('../../utils/errorHandler');
const { deepClone, immutableSet } = require('../../utils/functional');
const config = require('../../utils/config');
const BaseGameEngine = require('../engines/BaseGameEngine');

/**
 * Texas Hold'em Poker Game Engine extending BaseGameEngine
 */
class PokerGame extends BaseGameEngine {
  constructor(room, options = {}) {
    super(room, 'poker', options);
    this.logger.info('PokerGame initialized');
  }

  createInitialState() {
    const initialState = super.createInitialState();
    return {
      ...initialState,
      gameType: 'poker',
      communityCards: [],
      pot: 0,
      currentBet: 0,
      dealerIndex: 0,
      winner: null,
      winnerHand: null,
      message: 'Waiting for players to join...',
    };
  }

  setupActionHandlers() {
    super.setupActionHandlers();
    this.registerActionHandler('ready', this.handleReady.bind(this));
    this.registerActionHandler('fold', this.handleFold.bind(this));
    this.registerActionHandler('check', this.handleCheck.bind(this));
    this.registerActionHandler('call', this.handleCall.bind(this));
    this.registerActionHandler('raise', this.handleRaise.bind(this));
    this.registerActionHandler('all-in', this.handleAllIn.bind(this));
    this.registerActionHandler('next-game', this.handleNextGame.bind(this));
  }

  handleReady(playerId, data) {
    const player = this.state.players[playerId];
    if (player) {
      player.ready = true;
      this.state.message = `${player.name} is ready`;
      
      const allReady = Object.values(this.state.players).every(p => p.ready || p.folded);
      const activePlayers = Object.values(this.state.players).filter(p => !p.folded);
      
      if (allReady && activePlayers.length >= 2) {
        this.startNewHand();
      }
      
      return this.createActionResult('game-update', this.getGameState(), {
        event: 'player-ready',
        eventData: { playerId, playerName: player.name }
      });
    }
    return null;
  }

  handleFold(playerId, data) {
    const player = this.state.players[playerId];
    if (player) {
      player.folded = true;
      this.state.message = `${player.name} folded`;
      return this.createActionResult('game-update', this.getGameState());
    }
    return null;
  }

  handleCheck(playerId, data) {
    const player = this.state.players[playerId];
    if (player && !player.folded && !player.allIn) {
      player.lastAction = 'check';
      this.state.currentBet = 0;
      this.state.message = `${player.name} checked`;
      return this.createActionResult('game-update', this.getGameState());
    }
    return null;
  }

  handleCall(playerId, data) {
    const player = this.state.players[playerId];
    const amount = data.amount || this.state.currentBet;
    if (player && !player.folded && !player.allIn) {
      player.currentBet += amount;
      this.state.pot += amount;
      player.lastAction = 'call';
      this.state.message = `${player.name} called ${amount}`;
      return this.createActionResult('game-update', this.getGameState());
    }
    return null;
  }

  handleRaise(playerId, data) {
    const player = this.state.players[playerId];
    const raiseAmount = data.amount || this.state.currentBet * 2;
    if (player && !player.folded && !player.allIn) {
      player.currentBet += raiseAmount;
      this.state.pot += raiseAmount;
      this.state.currentBet = player.currentBet;
      player.lastAction = 'raise';
      this.state.message = `${player.name} raised to ${player.currentBet}`;
      return this.createActionResult('game-update', this.getGameState());
    }
    return null;
  }

  handleAllIn(playerId, data) {
    const player = this.state.players[playerId];
    if (player && !player.folded) {
      player.allIn = true;
      player.currentBet = this.state.currentBet;
      player.lastAction = 'all-in';
      this.state.message = `${player.name} went all-in!`;
      return this.createActionResult('game-update', this.getGameState());
    }
    return null;
  }

  handleNextGame(playerId, data) {
    this.startNewHand();
    return this.createActionResult('game-update', this.getGameState());
  }

  startNewHand() {
    const deck = this.createDeck();
    const players = Object.values(this.state.players).filter(p => !p.folded);
    
    players.forEach(player => {
      player.hand = [deck.pop(), deck.pop()];
      player.currentBet = 0;
      player.folded = false;
      player.allIn = false;
      player.lastAction = null;
    });

    this.state.communityCards = [];
    this.state.pot = 0;
    this.state.currentBet = 0;
    
    this.dealCommunityCards(deck, players);
    this.state.phase = config.game.states.PLAYING;
    this.state.message = 'Hand started! Place your bets';
  }

  dealCommunityCards(deck, players) {
    this.state.communityCards.push(deck.pop(), deck.pop(), deck.pop());
    this.state.communityCards.push(deck.pop()); // turn
    this.state.communityCards.push(deck.pop()); // river
    this.evaluateHands(players);
  }

  evaluateHands(players) {
    const HAND_RANKS = {
      HIGH_CARD: 0, PAIR: 1, TWO_PAIR: 2, THREE_OF_A_KIND: 3,
      STRAIGHT: 4, FLUSH: 5, FULL_HOUSE: 6, FOUR_OF_A_KIND: 7,
      STRAIGHT_FLUSH: 8, ROYAL_FLUSH: 9,
    };

    const hands = players.map(player => {
      const allCards = [...player.hand, ...this.state.communityCards];
      const ranks = allCards.map(c => RANKS.indexOf(c.rank));
      const suits = allCards.map(c => c.suit);
      const flush = suits.every(s => s === suits[0]);
      const rankCounts = {};
      ranks.forEach(r => { rankCounts[r] = (rankCounts[r] || 0) + 1; });
      const counts = Object.values(rankCounts).sort((a, b) => b - a);
      const uniqueRanks = [...new Set(ranks)].sort((a, b) => a - b);
      let straight = false;
      if (uniqueRanks.length >= 5) {
        for (let i = 0; i <= uniqueRanks.length - 5; i++) {
          if (uniqueRanks[i + 4] - uniqueRanks[i] === 4) { straight = true; break; }
        }
      }
      let handRank = HAND_RANKS.HIGH_CARD;
      if (counts[0] === 2) handRank = HAND_RANKS.PAIR;
      if (counts[0] === 2 && counts[1] === 2) handRank = HAND_RANKS.TWO_PAIR;
      if (counts[0] === 3) handRank = HAND_RANKS.THREE_OF_A_KIND;
      if (straight) handRank = HAND_RANKS.STRAIGHT;
      if (flush) handRank = HAND_RANKS.FLUSH;
      if (counts[0] === 3 && counts[1] >= 2) handRank = HAND_RANKS.FULL_HOUSE;
      if (counts[0] === 4) handRank = HAND_RANKS.FOUR_OF_A_KIND;
      
      return { player, handRank, allCards };
    });

    const bestHand = hands.reduce((best, current) => current.handRank > best.handRank ? current : best);
    const winner = hands[0].player;
    const winnerHand = this.describeHand(bestHand.handRank);
    
    this.state.winner = winner;
    this.state.winnerHand = winnerHand;
    this.state.winners = hands.map(h => h.player.id);
    const potPerWinner = Math.floor(this.state.pot / hands.length);
    hands.forEach(w => { this.state.players[w.player.id].score += potPerWinner; });
    this.state.pot = this.state.pot % hands.length;
  }

  describeHand(rank) {
    const descriptions = {
      0: 'High Card', 1: 'Pair', 2: 'Two Pair', 3: 'Three of a Kind',
      4: 'Straight', 5: 'Flush', 6: 'Full House', 7: 'Four of a Kind',
      8: 'Straight Flush', 9: 'Royal Flush',
    };
    return descriptions[rank] || 'Unknown';
  }

  createDeck() {
    const SUITS = ['♠', '♥', '♦', '♣'];
    const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
    const deck = [];
    for (const suit of SUITS) {
      for (const rank of RANKS) {
        deck.push({ rank, suit });
      }
    }
    return this.shuffle(deck);
  }

  shuffle(deck) {
    const shuffled = [...deck];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  }

  getAvailableActions() {
    const actions = [];
    const phase = this.state.phase;
    
    if (phase === config.game.states.WAITING) {
      actions.push({ type: 'ready', label: 'Ready Up' });
    }
    
    if (['preflop', 'flop', 'turn', 'river'].includes(phase) || phase === config.game.states.PLAYING) {
      actions.push({ type: 'fold', label: 'Fold' });
      actions.push({ type: 'check', label: 'Check' });
      actions.push({ type: 'call', label: 'Call' });
      actions.push({ type: 'raise', label: 'Raise' });
      actions.push({ type: 'all-in', label: 'All In' });
    }
    
    if (phase === 'showdown') {
      actions.push({ type: 'next-game', label: 'Next Game' });
    }
    
    return actions;
  }

  getCustomStateData() {
    return {
      communityCards: this.state.communityCards,
      pot: this.state.pot,
      currentBet: this.state.currentBet,
      winner: this.state.winner,
      winnerHand: this.state.winnerHand,
    };
  }
}

module.exports = PokerGame;
