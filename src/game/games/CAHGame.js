const { createLogger } = require('../../utils/errorHandler');
const { deepClone, immutableSet } = require('../../utils/functional');
const config = require('../../utils/config');
const BaseGameEngine = require('../engines/BaseGameEngine');

/**
 * Cards Against Humanity Game Engine extending BaseGameEngine
 */
class CAHGame extends BaseGameEngine {
  constructor(room, options = {}) {
    super(room, 'cah', options);
    this.logger.info('CAHGame initialized');
  }

  createInitialState() {
    const initialState = super.createInitialState();
    return {
      ...initialState,
      gameType: 'cah',
      judgeIndex: 0,
      currentRound: 1,
      totalRounds: 3,
      blackCard: null,
      whiteCards: [],
      playedCards: [],
      votes: {},
      scores: {},
      currentPlayerId: null,
      message: 'Waiting for players to join...',
    };
  }

  setupActionHandlers() {
    super.setupActionHandlers();
    this.registerActionHandler('ready', this.handleReady.bind(this));
    this.registerActionHandler('vote', this.handleVote.bind(this));
    this.registerActionHandler('play-card', this.handlePlayCard.bind(this));
    this.registerActionHandler('next-round', this.handleNextRound.bind(this));
  }

  handleReady(playerId, data) {
    const player = this.state.players[playerId];
    if (player) {
      player.hasVoted = false;
      player.ready = true;
      
      const allReady = Object.values(this.state.players).every(p => p.ready);
      const activePlayers = Object.values(this.state.players).filter(p => p.isActive);
      
      if (allReady && activePlayers.length >= 2) {
        this.startNewRound();
      }
      
      return this.createActionResult('game-update', this.getGameState(), {
        event: 'player-ready',
        eventData: { playerId, playerName: player.name }
      });
    }
    return null;
  }

  handleVote(playerId, data) {
    const player = this.state.players[playerId];
    if (player && !player.hasVoted) {
      const votedFor = data.cardIndex || 0;
      this.state.votes[playerId] = votedFor;
      player.hasVoted = true;
      
      const allVoted = Object.values(this.state.players)
        .filter(p => p.isActive)
        .every(p => p.hasVoted);
      
      if (allVoted) {
        this.showResults();
      }
      
      return this.createActionResult('game-update', this.getGameState());
    }
    return null;
  }

  handlePlayCard(playerId, data) {
    const player = this.state.players[playerId];
    if (player && player.hand.length > 0) {
      const cardIndex = data.cardIndex || 0;
      const card = player.hand.splice(cardIndex, 1)[0];
      
      this.state.playedCards.push({
        cardId: `${playerId}-${Date.now()}`,
        card: card,
        playerId: playerId,
        playerName: player.name,
      });
      
      this.state.message = `${player.name} played "${card}"`;
      
      return this.createActionResult('game-update', this.getGameState());
    }
    return null;
  }

  handleNextRound(playerId, data) {
    this.state.currentRound += 1;
    
    const activePlayers = Object.values(this.state.players).filter(p => p.isActive);
    this.state.judgeIndex = (this.state.judgeIndex + 1) % activePlayers.length;
    
    this.startNewRound();
    
    return this.createActionResult('game-update', this.getGameState());
  }

  startNewRound() {
    const activePlayers = Object.values(this.state.players).filter(p => p.isActive);
    
    const whiteDeck = this.shuffle(this.createWhiteCardDeck());
    activePlayers.forEach(player => {
      this.state.players[player.id].hand = whiteDeck.splice(0, 5);
      this.state.players[player.id].hasVoted = false;
    });
    
    const blackDeck = this.createBlackCardDeck();
    this.state.blackCard = blackDeck[Math.floor(Math.random() * blackDeck.length)];
    
    this.state.playedCards = [];
    this.state.votes = {};
    this.state.whiteCards = whiteDeck;
    
    this.state.phase = config.game.states.PLAYING;
    this.state.message = `Round ${this.state.currentRound}: ${activePlayers[this.state.judgeIndex].name} is the judge!`;
    this.state.currentPlayerId = activePlayers[this.state.judgeIndex].id;
  }

  showResults() {
    const activePlayers = Object.values(this.state.players).filter(p => p.isActive);
    const winnerIndex = Object.values(this.state.votes)[0] || 0;
    const winner = this.state.playedCards[winnerIndex];
    
    if (winner) {
      this.state.scores[winner.playerId] = (this.state.scores[winner.playerId] || 0) + 1;
      this.state.players[winner.playerId].score = this.state.scores[winner.playerId];
    }
    
    this.state.phase = 'results';
    this.state.message = `${winner ? winner.playerName : 'Unknown'} wins this round with "${winner ? winner.card : 'N/A'}"!`;
  }

  createBlackCardDeck() {
    return [
      '____ is a good thing.',
      '____ is even better.',
      'Why can\'t I sleep at night?',
      'What did I bring back from France?',
      'What\'s the next Happy Meal toy?',
    ];
  }

  createWhiteCardDeck() {
    return [
      'A lifetime of sadness.',
      'A microbrew tavern crawl.',
      'A mid-life crisis.',
      'A windmill, filled with corpses.',
      'Abstinence.',
      'Accents.',
      'Adam Lambert.',
      'Adderall.',
      'Aesop.',
      'African safari.',
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

  getAvailableActions() {
    const actions = [];
    const phase = this.state.phase;
    const currentPlayerId = this.state.currentPlayerId;
    
    if (phase === config.game.states.WAITING) {
      actions.push({ type: 'ready', label: 'Ready Up' });
    }
    
    if (phase === config.game.states.PLAYING || phase === 'voting') {
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

  getCustomStateData() {
    return {
      judgeIndex: this.state.judgeIndex,
      currentRound: this.state.currentRound,
      totalRounds: this.state.totalRounds,
      blackCard: this.state.blackCard,
      whiteCards: this.state.whiteCards,
      playedCards: this.state.playedCards,
      votes: this.state.votes,
      scores: this.state.scores,
      currentPlayerId: this.state.currentPlayerId,
    };
  }
}

module.exports = CAHGame;
