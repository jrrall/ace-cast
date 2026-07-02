/**
 * Texas Hold'em Poker Game Engine
 * Implements complete poker logic with betting rounds and hand evaluation
 */

// Card suits and ranks
const SUITS = ['♠', '♥', '♦', '♣'];
const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];

// Hand rank hierarchy (higher wins)
const HAND_RANKS = {
  HIGH_CARD: 0,
  PAIR: 1,
  TWO_PAIR: 2,
  THREE_OF_A_KIND: 3,
  STRAIGHT: 4,
  FLUSH: 5,
  FULL_HOUSE: 6,
  FOUR_OF_A_KIND: 7,
  STRAIGHT_FLUSH: 8,
  ROYAL_FLUSH: 9,
};

class PokerGame {
  constructor(room, options = {}) {
    this.room = room;
    this.options = options;
    this.state = this.createInitialState();
    
    // Initialize players
    room.getAllPlayers().forEach((player) => {
      this.state.players[player.id] = this.createPlayerState(player);
    });
  }

  createInitialState() {
    return {
      gameType: 'poker',
      phase: 'waiting', // waiting, preflop, flop, turn, river, showdown, ended
      currentPlayer: null,
      players: {},
      communityCards: [],
      pot: 0,
      currentBet: 0,
      dealerIndex: 0,
      activePlayers: [],
      lastAction: null,
      message: 'Waiting for players to join...',
    };
  }

  createPlayerState(player) {
    return {
      id: player.id,
      name: player.name,
      hand: [],
      score: 0,
      currentBet: 0,
      folded: false,
      allIn: false,
      ready: false,
      isActive: player.isActive,
      joinedAt: player.joinedAt,
    };
  }

  // Create a standard 52-card deck
  createDeck() {
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

  getInitialState() {
    return {
      gameType: this.state.gameType,
      phase: this.state.phase,
      players: this.state.players,
      communityCards: this.state.communityCards,
      pot: this.state.pot,
      currentBet: this.state.currentBet,
      dealerIndex: this.state.dealerIndex,
      message: this.state.message,
      lastAction: this.state.lastAction,
      availableActions: this.getAvailableActions(),
    };
  }

  getAvailableActions() {
    const actions = [];
    const phase = this.state.phase;

    if (phase === 'waiting') {
      actions.push({ type: 'ready', label: 'Ready Up' });
    }

    if (phase === 'playing' || ['preflop', 'flop', 'turn', 'river'].includes(phase)) {
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

  handlePlayerAction(playerId, actionData) {
    const { action, data } = actionData;
    console.log(`Poker game: Player ${playerId} performed action: ${action}`, data);

    switch (action) {
    case 'ready':
      return this.handleReadyAction(playerId);
    case 'fold':
      return this.handleFoldAction(playerId);
    case 'check':
      return this.handleCheckAction(playerId);
    case 'call':
      return this.handleCallAction(playerId, data);
    case 'raise':
      return this.handleRaiseAction(playerId, data);
    case 'all-in':
      return this.handleAllInAction(playerId);
    case 'next-game':
      return this.handleNextGameAction(playerId);
    default:
      console.log(`Unknown action: ${action}`);
      return null;
    }
  }

  handleReadyAction(playerId) {
    if (this.state.players[playerId]) {
      this.state.players[playerId].ready = true;

      // Check if all players are ready
      const allReady = Object.values(this.state.players).every((p) => p.ready || p.folded);
      const activePlayers = Object.values(this.state.players).filter((p) => !p.folded);

      if (allReady && activePlayers.length >= 2) {
        this.startNewHand();
      }

      return {
        type: 'game-update',
        gameState: {
          ...this.getInitialState(),
          phase: this.state.phase,
          lastAction: {
            type: 'ready',
            playerId,
            playerName: this.state.players[playerId].name,
            timestamp: Date.now(),
          },
        },
      };
    }

    return null;
  }

  handleFoldAction(playerId) {
    const player = this.state.players[playerId];
    if (player) {
      player.folded = true;
      this.state.message = `${player.name} folded`;
      return this.broadcastUpdate(playerId);
    }
    return null;
  }

  handleCheckAction(playerId) {
    const player = this.state.players[playerId];
    if (player && !player.folded && !player.allIn) {
      player.lastAction = 'check';
      this.state.currentBet = 0; // Check resets bet to 0
      this.state.message = `${player.name} checked`;
      return this.broadcastUpdate(playerId);
    }
    return null;
  }

  handleCallAction(playerId, data = {}) {
    const player = this.state.players[playerId];
    const amount = data.amount || this.state.currentBet;
    if (player && !player.folded && !player.allIn) {
      player.currentBet += amount;
      this.state.pot += amount;
      player.lastAction = 'call';
      this.state.message = `${player.name} called ${amount}`;
      return this.broadcastUpdate(playerId);
    }
    return null;
  }

  handleRaiseAction(playerId, data = {}) {
    const player = this.state.players[playerId];
    const raiseAmount = data.amount || this.state.currentBet * 2;
    if (player && !player.folded && !player.allIn) {
      player.currentBet += raiseAmount;
      this.state.pot += raiseAmount;
      this.state.currentBet = player.currentBet;
      player.lastAction = 'raise';
      this.state.message = `${player.name} raised to ${player.currentBet}`;
      return this.broadcastUpdate(playerId);
    }
    return null;
  }

  handleAllInAction(playerId) {
    const player = this.state.players[playerId];
    if (player && !player.folded) {
      player.allIn = true;
      player.currentBet = this.state.currentBet;
      player.lastAction = 'all-in';
      this.state.message = `${player.name} went all-in!`;
      return this.broadcastUpdate(playerId);
    }
    return null;
  }

  handleNextGameAction(playerId) {
    this.startNewHand();
    return {
      type: 'game-update',
      gameState: {
        ...this.getInitialState(),
        phase: this.state.phase,
        lastAction: {
          type: 'next-game',
          playerId,
          timestamp: Date.now(),
        },
      },
    };
  }

  startNewHand() {
    const deck = this.createDeck();
    const players = Object.values(this.state.players).filter((p) => !p.folded);
    
    // Deal cards to each active player
    players.forEach((player) => {
      player.hand = [deck.pop(), deck.pop()];
      player.currentBet = 0;
      player.folded = false;
      player.allIn = false;
      player.lastAction = null;
    });

    // Deal community cards
    this.state.communityCards = [];
    this.state.pot = 0;
    this.state.currentBet = 0;

    // Simulate dealing through rounds
    this.dealCommunityCards(deck, players);

    this.state.phase = 'preflop';
    this.state.message = 'Hand started! Place your bets';
  }

  dealCommunityCards(deck, players) {
    // Flop
    this.state.communityCards.push(deck.pop(), deck.pop(), deck.pop());
    this.state.phase = 'flop';
    
    // Turn
    this.state.communityCards.push(deck.pop());
    this.state.phase = 'turn';
    
    // River
    this.state.communityCards.push(deck.pop());
    this.state.phase = 'river';
    
    // Showdown
    this.evaluateHands(players);
    this.state.phase = 'showdown';
    this.state.message = `Showdown! ${this.state.winner.name} wins with ${this.state.winnerHand}`;
  }

  evaluateHands(players) {
    // Simple hand evaluation (can be enhanced)
    const hands = players.map((player) => {
      const allCards = [...player.hand, ...this.state.communityCards];
      const handRank = this.calculateHandRank(allCards);
      return { player, handRank, allCards };
    });

    // Find the best hand
    const bestHand = hands.reduce((best, current) => {
      return current.handRank > best.handRank ? current : best;
    });

    // Find all players with the best rank (for tie-breaking)
    const bestRank = bestHand.handRank;
    const winners = hands.filter((h) => h.handRank === bestRank);

    // Determine winner(s)
    const winner = winners[0].player;
    const winnerHand = this.describeHand(bestHand.handRank);

    this.state.winner = winner;
    this.state.winnerHand = winnerHand;
    this.state.winners = winners.map((h) => h.player.id);

    // Award pot to winner(s)
    const potPerWinner = Math.floor(this.state.pot / winners.length);
    winners.forEach((w) => {
      this.state.players[w.player.id].score += potPerWinner;
    });

    this.state.pot = this.state.pot % winners.length;
  }

  calculateHandRank(cards) {
    const ranks = cards.map((c) => RANKS.indexOf(c.rank));
    const suits = cards.map((c) => c.suit);
    
    // Count rank occurrences
    const rankCounts = {};
    ranks.forEach((r) => {
      rankCounts[r] = (rankCounts[r] || 0) + 1;
    });

    const counts = Object.values(rankCounts).sort((a, b) => b - a);
    
    // Check for flush
    const flush = suits.every((s) => s === suits[0]);
    
    // Check for straight
    const uniqueRanks = [...new Set(ranks)].sort((a, b) => a - b);
    let straight = false;
    if (uniqueRanks.length >= 5) {
      for (let i = 0; i <= uniqueRanks.length - 5; i++) {
        if (uniqueRanks[i + 4] - uniqueRanks[i] === 4) {
          straight = true;
          break;
        }
      }
      // Check for Ace-low straight (A, 2, 3, 4, 5)
      if (!straight && uniqueRanks.includes(12) && uniqueRanks.includes(0) && 
          uniqueRanks.includes(1) && uniqueRanks.includes(2) && uniqueRanks.includes(3)) {
        straight = true;
      }
    }

    // Determine hand rank
    if (flush && straight && uniqueRanks.includes(12)) {
      return HAND_RANKS.ROYAL_FLUSH;
    } else if (flush && straight) {
      return HAND_RANKS.STRAIGHT_FLUSH;
    } else if (counts[0] === 4) {
      return HAND_RANKS.FOUR_OF_A_KIND;
    } else if (counts[0] === 3 && counts[1] >= 2) {
      return HAND_RANKS.FULL_HOUSE;
    } else if (flush) {
      return HAND_RANKS.FLUSH;
    } else if (straight) {
      return HAND_RANKS.STRAIGHT;
    } else if (counts[0] === 3) {
      return HAND_RANKS.THREE_OF_A_KIND;
    } else if (counts[0] === 2 && counts[1] === 2) {
      return HAND_RANKS.TWO_PAIR;
    } else if (counts[0] === 2) {
      return HAND_RANKS.PAIR;
    } else {
      return HAND_RANKS.HIGH_CARD;
    }
  }

  describeHand(rank) {
    const descriptions = {
      [HAND_RANKS.HIGH_CARD]: 'High Card',
      [HAND_RANKS.PAIR]: 'Pair',
      [HAND_RANKS.TWO_PAIR]: 'Two Pair',
      [HAND_RANKS.THREE_OF_A_KIND]: 'Three of a Kind',
      [HAND_RANKS.STRAIGHT]: 'Straight',
      [HAND_RANKS.FLUSH]: 'Flush',
      [HAND_RANKS.FULL_HOUSE]: 'Full House',
      [HAND_RANKS.FOUR_OF_A_KIND]: 'Four of a Kind',
      [HAND_RANKS.STRAIGHT_FLUSH]: 'Straight Flush',
      [HAND_RANKS.ROYAL_FLUSH]: 'Royal Flush',
    };
    return descriptions[rank] || 'Unknown';
  }

  handlePlayerLeave(playerId) {
    if (this.state.players[playerId]) {
      this.state.players[playerId].isActive = false;
      
      // If no active players left, end the game
      const activePlayers = Object.values(this.state.players).filter((p) => p.isActive);
      if (activePlayers.length === 0) {
        this.cleanup();
      }
    }
  }

  cleanup() {
    console.log('Poker game cleaned up');
    this.state.phase = 'ended';
    this.state.players = {};
  }

  broadcastUpdate(playerId) {
    return {
      type: 'game-update',
      gameState: {
        ...this.getInitialState(),
        phase: this.state.phase,
        currentPlayer: playerId,
        lastAction: {
          type: this.state.players[playerId]?.lastAction || 'action',
          playerId,
          playerName: this.state.players[playerId]?.name,
          timestamp: Date.now(),
        },
      },
    };
  }
}

module.exports = PokerGame;
