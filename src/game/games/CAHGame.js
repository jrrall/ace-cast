/**
 * Cards Against Humanity Game Engine
 * Implements CAH logic with white cards, black cards, judge rotation, and scoring
 */

class CAHGame {
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
      gameType: 'cah',
      phase: 'waiting', // waiting, playing, voting, results, ended
      judgeIndex: 0,
      currentRound: 1,
      totalRounds: 3, // Default 3 rounds
      blackCard: null,
      whiteCards: [],
      playedCards: [],
      votes: {},
      scores: {},
      players: {},
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
      hasVoted: false,
      isActive: player.isActive,
      joinedAt: player.joinedAt,
    };
  }

  // Create CAH card decks
  createBlackCardDeck() {
    return [
      '____ is a good thing.',
      '____ is even better.',
      'Why can\'t I sleep at night?',
      'What did I bring back from France?',
      'What\'s the next Happy Meal toy?',
      'What\'s the difference between hipsters and hippies?',
      'What do old people smell like?',
      'What\'s that smell?',
      'What\'s Batman\'s guilty pleasure?',
      'What\'s the name of that disease?',
      'What\'s the worst thing to smell while eating?',
      'What broke my last date?',
      'What\'s the secret to a lasting relationship?',
      'What\'s the new fad?',
      'What\'s the gift that keeps on giving?',
      '____ + ____ = ____. ',
      'What do you get when you cross a musician and an animal?',
      'What\'s the strongest force in the universe?',
      'What\'s the best thing to bring to a party?',
      'What\'s the worst thing to bring to a party?',
    ];
  }

  createWhiteCardDeck() {
    return [
      'A lifetime of sadness.',
      'A microbrew tavern crawl.',
      'A smaller, cooler prison.',
      'A mid-life crisis.',
      'A windmill, filled with corpses.',
      'Abstinence.',
      'Accents.',
      'Adam Lambert.',
      'Adderall.',
      'Aesop.',
      'African safari.',
      'Aggravating the mass of low-income people.',
      'Aides for the elderly.',
      'A kiss on the cheek.',
      'A man with a mask.',
      'A mountain of frozen vomit.',
      'A really cool hat.',
      'A river that runs through it.',
      'A sex slave.',
      'A slip of the penis.',
      'A strong, healthy child.',
      'A sea of tears.',
      'A throat packing tube.',
      'A tiny horse.',
      'A truly awesome fellow.',
      'A volcano erupting.',
      'Abnormally fat gladiators.',
      'Absolute purity.',
      'Acupuncture.',
      'Adaptive reuse.',
      'Adoption.',
      'Advanced calculus.',
      'Aesop.',
      'Affordable colorblindness.',
      'Afraid of the dark.',
      'African animals.',
      'Age appropriate sex education.',
      'Aggravating the mass of low-income people.',
      'Aides for the elderly.',
      'A kiss on the cheek.',
      'A man with a mask.',
      'A mountain of frozen vomit.',
      'A really cool hat.',
      'A river that runs through it.',
      'A sex slave.',
      'A slip of the penis.',
      'A strong, healthy child.',
      'A sea of tears.',
      'A throat packing tube.',
      'A tiny horse.',
      'A truly awesome fellow.',
      'A volcano erupting.',
      'Abnormally fat gladiators.',
      'Absolute purity.',
      'Acupuncture.',
      'Adaptive reuse.',
      'Adderall.',
      'Adam Lambert.',
      'Adoption.',
      'Advanced calculus.',
      'Aesop.',
      'Affordable colorblindness.',
      'Afraid of the dark.',
      'African animals.',
      'Age appropriate sex education.',
    ];
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
      blackCard: this.state.blackCard,
      whiteCards: this.state.whiteCards,
      playedCards: this.state.playedCards,
      votes: this.state.votes,
      scores: this.state.scores,
      judgeIndex: this.state.judgeIndex,
      currentRound: this.state.currentRound,
      totalRounds: this.state.totalRounds,
      message: this.state.message,
      lastAction: this.state.lastAction,
      availableActions: this.getAvailableActions(),
    };
  }

  getAvailableActions() {
    const actions = [];
    const phase = this.state.phase;
    const currentPlayerId = this.state.currentPlayerId;

    if (phase === 'waiting') {
      actions.push({ type: 'ready', label: 'Ready Up' });
    }

    if (phase === 'playing' || phase === 'voting') {
      if (this.state.players[currentPlayerId] && !this.state.players[currentPlayerId].hasVoted) {
        actions.push({ type: 'vote', label: 'Vote' });
      }
      actions.push({ type: 'play-card', label: 'Play Card' });
    }

    if (phase === 'results') {
      actions.push({ type: 'next-round', label: 'Next Round' });
    }

    return actions;
  }

  handlePlayerAction(playerId, actionData) {
    const { action, data } = actionData;
    console.log(`CAH game: Player ${playerId} performed action: ${action}`, data);

    switch (action) {
    case 'ready':
      return this.handleReadyAction(playerId);
    case 'vote':
      return this.handleVoteAction(playerId, data);
    case 'play-card':
      return this.handlePlayCardAction(playerId, data);
    case 'next-round':
      return this.handleNextRoundAction(playerId);
    default:
      console.log(`Unknown action: ${action}`);
      return null;
    }
  }

  handleReadyAction(playerId) {
    if (this.state.players[playerId]) {
      this.state.players[playerId].hasVoted = false;
      this.state.players[playerId].ready = true;

      // Check if all players are ready
      const allReady = Object.values(this.state.players).every((p) => p.ready);
      const activePlayers = Object.values(this.state.players).filter((p) => p.isActive);

      if (allReady && activePlayers.length >= 2) {
        this.startNewRound();
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

  handleVoteAction(playerId, data) {
    const player = this.state.players[playerId];
    if (player && !player.hasVoted) {
      // Vote for the chosen card (default is first card if no data)
      const votedFor = data.cardIndex || 0;
      this.state.votes[playerId] = votedFor;
      player.hasVoted = true;

      // Check if all players have voted
      const allVoted = Object.values(this.state.players)
        .filter((p) => p.isActive)
        .every((p) => p.hasVoted);

      if (allVoted) {
        this.showResults();
      }

      return {
        type: 'game-update',
        gameState: {
          ...this.getInitialState(),
          phase: 'voting',
          votes: this.state.votes,
          lastAction: {
            type: 'vote',
            playerId,
            playerName: player.name,
            cardIndex: votedFor,
            timestamp: Date.now(),
          },
        },
      };
    }

    return null;
  }

  handlePlayCardAction(playerId, data) {
    const player = this.state.players[playerId];
    if (player && player.hand.length > 0) {
      // Remove a card from hand and add to played cards
      const cardIndex = data.cardIndex || 0;
      const card = player.hand.splice(cardIndex, 1)[0];
      
      this.state.playedCards.push({
        cardId: `${playerId}-${Date.now()}`,
        card: card,
        playerId: playerId,
        playerName: player.name,
      });

      this.state.message = `${player.name} played "${card}"`;

      return {
        type: 'game-update',
        gameState: {
          ...this.getInitialState(),
          phase: 'playing',
          playedCards: this.state.playedCards,
          lastAction: {
            type: 'play-card',
            playerId,
            playerName: player.name,
            card: card,
            timestamp: Date.now(),
          },
        },
      };
    }

    return null;
  }

  handleNextRoundAction(playerId) {
    this.state.currentRound += 1;
    
    // Rotate judge
    const activePlayers = Object.values(this.state.players).filter((p) => p.isActive);
    this.state.judgeIndex = (this.state.judgeIndex + 1) % activePlayers.length;
    
    this.startNewRound();

    return {
      type: 'game-update',
      gameState: {
        ...this.getInitialState(),
        phase: 'playing',
        lastAction: {
          type: 'next-round',
          playerId,
          timestamp: Date.now(),
        },
      },
    };
  }

  startNewRound() {
    const activePlayers = Object.values(this.state.players).filter((p) => p.isActive);
    
    // Deal white cards to each player
    const whiteDeck = this.shuffle(this.createWhiteCardDeck());
    activePlayers.forEach((player) => {
      this.state.players[player.id].hand = whiteDeck.splice(0, 5);
      this.state.players[player.id].hasVoted = false;
    });

    // Pick black card
    const blackDeck = this.createBlackCardDeck();
    this.state.blackCard = blackDeck[Math.floor(Math.random() * blackDeck.length)];
    
    // Reset played cards and votes
    this.state.playedCards = [];
    this.state.votes = {};
    this.state.whiteCards = whiteDeck;

    this.state.phase = 'playing';
    this.state.message = `Round ${this.state.currentRound}: ${activePlayers[this.state.judgeIndex].name} is the judge!`;
    this.state.currentPlayerId = activePlayers[this.state.judgeIndex].id;
  }

  showResults() {
    const activePlayers = Object.values(this.state.players).filter((p) => p.isActive);
    const judge = activePlayers[this.state.judgeIndex];
    
    // Find the winning card
    const winnerIndex = Object.values(this.state.votes)[0] || 0;
    const winner = this.state.playedCards[winnerIndex];
    
    // Update scores
    if (winner) {
      this.state.scores[winner.playerId] = (this.state.scores[winner.playerId] || 0) + 1;
      this.state.players[winner.playerId].score = this.state.scores[winner.playerId];
    }

    this.state.phase = 'results';
    this.state.message = `${winner ? winner.playerName : 'Unknown'} wins this round with "${winner ? winner.card : 'N/A'}"!`;
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
    console.log('CAH game cleaned up');
    this.state.phase = 'ended';
    this.state.players = {};
    this.state.playedCards = [];
    this.state.votes = {};
  }
}

module.exports = CAHGame;
