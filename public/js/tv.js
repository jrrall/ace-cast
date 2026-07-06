class TVController {
    constructor() {
        this.socket = null;
        this.roomCode = window.ROOM_CODE || null;
        this.players = new Map();
        this.gameState = null;
        this.connected = false;
        this.gameStartTime = null;
        this.timerInterval = null;
        
        this.initializeElements();
        this.initializeSocket();
        
        // Start in lobby screen by default
        this.showLobbyScreen();
        
        if (this.roomCode) {
            this.joinRoomAsTV();
        }
    }

    initializeElements() {
        // Screens
        this.lobbyScreen = document.getElementById('tv-lobby-screen');
        this.gameScreen = document.getElementById('tv-game-screen');
        this.errorScreen = document.getElementById('tv-error-screen');
        
        // Header elements
        this.playerCount = document.getElementById('tv-player-count');
        
        // Lobby elements
        this.playersGrid = document.getElementById('tv-players-grid');
        
        // Game elements
        this.gameType = document.getElementById('tv-game-type');
        this.gameStatus = document.getElementById('tv-game-status');
        this.gameMessage = document.getElementById('tv-game-message');
        this.gameContent = document.getElementById('tv-game-content');
        this.actionsList = document.getElementById('tv-actions-list');
        this.scoreboard = document.getElementById('tv-scoreboard');
        
        // Footer elements
        this.connectionStatus = document.getElementById('tv-connection-status');
        this.gameTimer = document.getElementById('tv-game-timer');
        
        // Error elements
        this.errorMessage = document.getElementById('tv-error-message');
    }

    initializeSocket() {
        this.socket = io();
        
        this.socket.on('connect', () => {
            console.log('TV connected to server');
            this.connected = true;
            this.updateConnectionStatus('Connected');
            
            if (this.roomCode) {
                this.joinRoomAsTV();
            }
        });

        this.socket.on('disconnect', () => {
            console.log('TV disconnected from server');
            this.connected = false;
            this.updateConnectionStatus('Disconnected');
        });

        this.socket.on('error', (data) => {
            console.error('Socket error:', data);
            // Only show error if we haven't successfully joined a room yet
            if (!this.connected || (this.players.size === 0 && !this.roomCode)) {
                this.showError(data.message || 'Connection error occurred');
            } else {
                console.log('Socket error ignored - already connected with room data');
            }
        });

        this.socket.on('room-state', (data) => {
            this.handleRoomState(data);
        });

        this.socket.on('player-joined', (data) => {
            this.handlePlayerJoined(data);
        });

        this.socket.on('player-left', (data) => {
            this.handlePlayerLeft(data);
        });

        this.socket.on('game-started', (data) => {
            this.handleGameStarted(data);
        });

        this.socket.on('game-update', (data) => {
            this.handleGameUpdate(data);
        });

        this.socket.on('game-ended', () => {
            this.gameState = null;
            this.addActionToFeed('Game ended', 'game-start');
            this.showLobbyScreen();
        });
    }

    joinRoomAsTV() {
        if (!this.socket || !this.connected || !this.roomCode) {
            return;
        }

        this.socket.emit('join-room', {
            roomCode: this.roomCode,
            deviceType: 'tv'
        });
    }

    handleRoomState(data) {
        console.log('Room state received:', data);
        
        // Clear any previous error state when we receive valid room data
        if (data.roomCode) {
            console.log('TV successfully joined room:', data.roomCode);
            
            // Clear any error state since we now have valid room data
            this.clearErrorState();
            
            // Update players
            if (data.players) {
                this.players.clear();
                data.players.forEach(player => {
                    this.players.set(player.id, player);
                });
                this.updatePlayersDisplay();
                console.log('Updated players display, count:', this.players.size);
            }
            
            // Show appropriate screen based on game state
            if (data.isGameActive && data.gameState) {
                console.log('Game is active, showing game screen');
                this.gameState = data.gameState;
                
                // Update game type display if provided
                if (data.gameType && this.gameType) {
                    this.gameType.textContent = data.gameType;
                }
                
                this.showGameScreen();
                this.updateGameDisplay(data.gameState);
            } else {
                console.log('Game not active, showing lobby screen');
                this.showLobbyScreen();
            }
        }
    }

    handlePlayerJoined(data) {
        console.log('Player joined:', data);
        
        // Add player to our local list
        if (data.playerId && data.playerName) {
            this.players.set(data.playerId, {
                id: data.playerId,
                name: data.playerName
            });
        }
        
        this.updatePlayersDisplay();
        this.addActionToFeed(`${data.playerName} joined the game`, 'join');
    }

    handlePlayerLeft(data) {
        console.log('Player left:', data);
        
        if (data.playerId) {
            const player = this.players.get(data.playerId);
            if (player) {
                this.players.delete(data.playerId);
                this.addActionToFeed(`${player.name} left the game`, 'leave');
            }
        }
        
        this.updatePlayersDisplay();
    }

    handleGameStarted(data) {
        console.log('Game started:', data);

        this.gameStartTime = new Date();
        this.startGameTimer();

        const label = this.prettyGameType(data.gameType);
        if (this.gameType) {
            this.gameType.textContent = label;
        }

        this.showGameScreen();
        this.addActionToFeed(`Game started: ${label}`, 'game-start');
    }

    prettyGameType(type) {
        if (type === 'cah') return 'Cards Against Humanity';
        if (type === 'test') return 'Test Game';
        return type || 'Game';
    }

    handleGameUpdate(data) {
        console.log('Game update:', data);
        
        this.gameState = data.gameState || data;
        this.updateGameDisplay(this.gameState);
        
        // Add action to feed if available
        if (data.lastAction) {
            const action = data.lastAction;
            this.addActionToFeed(
                `${action.playerName}: ${action.type}`,
                'player-action'
            );
        }
    }

    updatePlayersDisplay() {
        this.playerCount.textContent = this.players.size;
        this.playersGrid.innerHTML = '';
        
        const playerAvatars = ['👤', '👥', '🎮', '🕹️', '🎯', '🎲', '🃏', '🎪'];
        let avatarIndex = 0;
        
        for (const player of this.players.values()) {
            const playerCard = document.createElement('div');
            playerCard.className = 'tv-player-card fade-in';
            
            const avatar = playerAvatars[avatarIndex % playerAvatars.length];
            avatarIndex++;
            
            playerCard.innerHTML = `
                <div class="player-avatar">${avatar}</div>
                <div class="player-name">${player.name}</div>
            `;
            
            this.playersGrid.appendChild(playerCard);
        }
        
        // Add "Waiting for players" cards if needed
        if (this.players.size < 4) {
            for (let i = this.players.size; i < 4; i++) {
                const waitingCard = document.createElement('div');
                waitingCard.className = 'tv-player-card';
                waitingCard.style.opacity = '0.3';
                waitingCard.innerHTML = `
                    <div class="player-avatar">❓</div>
                    <div class="player-name">Waiting...</div>
                `;
                this.playersGrid.appendChild(waitingCard);
            }
        }
    }

    updateGameDisplay(gameState) {
        if (!gameState) return;

        // Keep the game-type label in sync (e.g. for spectators joining mid-game)
        if (gameState.gameType && this.gameType) {
            this.gameType.textContent = this.prettyGameType(gameState.gameType);
        }

        // Update game message
        if (gameState.message) {
            this.gameMessage.textContent = gameState.message;
            this.gameMessage.classList.add('fade-in');
        }
        
        // Update game status
        if (gameState.status) {
            this.gameStatus.textContent = gameState.status;
        }
        
        // Update game content area
        this.updateGameContent(gameState);
        
        // Update scoreboard
        this.updateScoreboard(gameState.scores);
    }

    updateGameContent(gameState) {
        if (!this.gameContent) return;

        if (gameState.gameType === 'cah') {
            this.gameContent.innerHTML = this.renderCAHContent(gameState);
            return;
        }

        // Generic fallback (e.g. test game)
        let content = '<div class="game-info">Game in progress...</div>';
        if (gameState.gameType === 'test') {
            content = `
                <div class="test-game-display">
                    <h3>Test Game</h3>
                    <div class="counter-display">
                        <h2>Counter: ${gameState.testCounter || 0}</h2>
                    </div>
                    <div class="phase-display">
                        <p>Phase: ${gameState.phase || 'waiting'}</p>
                    </div>
                </div>
            `;
        }
        this.gameContent.innerHTML = content;
    }

    renderCAHContent(state) {
        const black = state.blackCard
            ? `<div class="cah-black-card">${this.formatPrompt(state.blackCard)}</div>`
            : '';
        const czar = state.judgeName
            ? `<div class="cah-czar">👑 Card Czar: ${this.esc(state.judgeName)}</div>`
            : '';

        let body = '';
        if (state.phase === 'answering') {
            body = `<div class="cah-status">${state.submittedCount}/${state.expectedCount} players have played</div>`;
        } else if (state.phase === 'judging') {
            const cards = (state.submissions || [])
                .map((s) => `<div class="cah-white-card tv">${this.esc(s.text)}</div>`)
                .join('');
            body = `
                <div class="cah-status">${this.esc(state.judgeName)} is choosing...</div>
                <div class="cah-submissions">${cards}</div>
            `;
        } else if ((state.phase === 'results' || state.phase === 'gameover') && state.lastWinner) {
            body = `
                <div class="cah-winner-card">
                    <div class="cah-white-card tv winner">${this.esc(state.lastWinner.text)}</div>
                    <div class="cah-winner-name">🏆 ${this.esc(state.lastWinner.playerName)}</div>
                </div>
            `;
        }

        return `<div class="cah-board">${black}${czar}${body}</div>`;
    }

    formatPrompt(text) {
        return this.esc(text).replace(/_{2,}/g, '<span class="cah-blank"></span>');
    }

    esc(text) {
        const div = document.createElement('div');
        div.textContent = text == null ? '' : String(text);
        return div.innerHTML;
    }

    updateScoreboard(scores) {
        if (!this.scoreboard) return;

        this.scoreboard.innerHTML = '';

        // CAH / new engines provide a sorted array of { id, name, score }.
        if (!Array.isArray(scores)) return;

        scores.forEach((entry) => {
            const scoreItem = document.createElement('div');
            scoreItem.className = 'tv-score-item slide-up';
            scoreItem.innerHTML = `
                <div class="player-name">${this.esc(entry.name)}</div>
                <div class="score">${entry.score}</div>
            `;
            this.scoreboard.appendChild(scoreItem);
        });
    }

    addActionToFeed(message, type = 'info') {
        if (!this.actionsList) return;
        
        const actionItem = document.createElement('div');
        actionItem.className = 'action-item';
        
        const timestamp = new Date().toLocaleTimeString();
        actionItem.innerHTML = `
            <span class="action-text">${message}</span>
            <span class="action-time" style="float: right; opacity: 0.7; font-size: 0.9em;">${timestamp}</span>
        `;
        
        // Add to top of list
        this.actionsList.insertBefore(actionItem, this.actionsList.firstChild);
        
        // Remove old actions (keep only last 10)
        while (this.actionsList.children.length > 10) {
            this.actionsList.removeChild(this.actionsList.lastChild);
        }
    }

    startGameTimer() {
        this.stopGameTimer();
        
        this.timerInterval = setInterval(() => {
            if (this.gameStartTime) {
                const elapsed = new Date() - this.gameStartTime;
                const minutes = Math.floor(elapsed / 60000);
                const seconds = Math.floor((elapsed % 60000) / 1000);
                
                this.gameTimer.textContent = 
                    `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
            }
        }, 1000);
    }

    stopGameTimer() {
        if (this.timerInterval) {
            clearInterval(this.timerInterval);
            this.timerInterval = null;
        }
    }

    updateConnectionStatus(status) {
        this.connectionStatus.textContent = status;
        
        if (status === 'Connected') {
            this.connectionStatus.classList.remove('disconnected');
        } else {
            this.connectionStatus.classList.add('disconnected');
        }
    }

    showLobbyScreen() {
        console.log('Switching to lobby screen');
        this.hideAllScreens();
        this.lobbyScreen.classList.add('active');
        this.stopGameTimer();
        this.gameTimer.textContent = '';
    }

    showGameScreen() {
        console.log('Switching to game screen');
        this.hideAllScreens();
        this.gameScreen.classList.add('active');
    }

    showError(message) {
        console.log('Switching to error screen:', message);
        this.errorMessage.textContent = message;
        this.hideAllScreens();
        this.errorScreen.classList.add('active');
    }

    hideAllScreens() {
        console.log('Hiding all screens');
        if (this.lobbyScreen) this.lobbyScreen.classList.remove('active');
        if (this.gameScreen) this.gameScreen.classList.remove('active');
        if (this.errorScreen) this.errorScreen.classList.remove('active');
        
        // Debug: check which screens are still active
        setTimeout(() => {
            const activeScreens = [];
            if (this.lobbyScreen && this.lobbyScreen.classList.contains('active')) activeScreens.push('lobby');
            if (this.gameScreen && this.gameScreen.classList.contains('active')) activeScreens.push('game');
            if (this.errorScreen && this.errorScreen.classList.contains('active')) activeScreens.push('error');
            console.log('Active screens after hiding:', activeScreens);
        }, 100);
    }

    clearErrorState() {
        console.log('Clearing error state');
        // Remove error screen if it's currently active
        if (this.errorScreen.classList.contains('active')) {
            this.errorScreen.classList.remove('active');
        }
    }
}

// Initialize the TV controller when the page loads
document.addEventListener('DOMContentLoaded', () => {
    new TVController();
});