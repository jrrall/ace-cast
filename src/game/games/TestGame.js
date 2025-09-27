class TestGame {
  constructor(room, options = {}) {
    this.room = room;
    this.options = options;
    this.state = {
      phase: 'waiting',
      currentPlayer: null,
      players: {},
      testCounter: 0,
      lastAction: null,
    };

    // Initialize players in game state
    room.getAllPlayers().forEach((player) => {
      this.state.players[player.id] = {
        id: player.id,
        name: player.name,
        score: 0,
        ready: false,
      };
    });
  }

  getInitialState() {
    return {
      gameType: 'test',
      phase: this.state.phase,
      players: this.state.players,
      testCounter: this.state.testCounter,
      message: 'Welcome to the test game! Click the button to increment the counter.',
      availableActions: this.getAvailableActions(),
    };
  }

  getAvailableActions() {
    const actions = [];

    if (this.state.phase === 'waiting') {
      actions.push({ type: 'ready', label: 'Ready Up' });
    }

    if (this.state.phase === 'playing') {
      actions.push({ type: 'increment', label: 'Increment Counter' });
      actions.push({ type: 'reset', label: 'Reset Counter' });
    }

    return actions;
  }

  handlePlayerAction(playerId, actionData) {
    const { action, data } = actionData;

    console.log(`Test game: Player ${playerId} performed action: ${action}`, data);

    switch (action) {
    case 'ready':
      return this.handleReadyAction(playerId);
    case 'increment':
      return this.handleIncrementAction(playerId);
    case 'reset':
      return this.handleResetAction(playerId);
    default:
      console.log(`Unknown action: ${action}`);
      return null;
    }
  }

  handleReadyAction(playerId) {
    if (this.state.players[playerId]) {
      this.state.players[playerId].ready = true;

      // Check if all players are ready
      const allReady = Object.values(this.state.players).every((p) => p.ready);

      if (allReady && Object.keys(this.state.players).length > 0) {
        this.state.phase = 'playing';
        this.state.currentPlayer = Object.keys(this.state.players)[0];
      }

      return {
        type: 'game-update',
        gameState: {
          ...this.getInitialState(),
          phase: this.state.phase,
          currentPlayer: this.state.currentPlayer,
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

  handleIncrementAction(playerId) {
    this.state.testCounter += 1;
    this.state.players[playerId].score += 1;
    this.state.lastAction = {
      type: 'increment',
      playerId,
      playerName: this.state.players[playerId].name,
      newCounter: this.state.testCounter,
      timestamp: Date.now(),
    };

    return {
      type: 'game-update',
      gameState: {
        ...this.getInitialState(),
        phase: this.state.phase,
        testCounter: this.state.testCounter,
        players: this.state.players,
        lastAction: this.state.lastAction,
        message: `${this.state.players[playerId].name} incremented the counter to ${this.state.testCounter}!`,
      },
    };
  }

  handleResetAction(playerId) {
    this.state.testCounter = 0;
    this.state.lastAction = {
      type: 'reset',
      playerId,
      playerName: this.state.players[playerId].name,
      timestamp: Date.now(),
    };

    return {
      type: 'game-update',
      gameState: {
        ...this.getInitialState(),
        phase: this.state.phase,
        testCounter: this.state.testCounter,
        players: this.state.players,
        lastAction: this.state.lastAction,
        message: `${this.state.players[playerId].name} reset the counter!`,
      },
    };
  }

  handlePlayerLeave(playerId) {
    if (this.state.players[playerId]) {
      delete this.state.players[playerId];

      // If no players left, end the game
      if (Object.keys(this.state.players).length === 0) {
        this.cleanup();
      }
    }
  }

  cleanup() {
    console.log('Test game cleaned up');
  }
}

module.exports = TestGame;
