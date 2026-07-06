class PlayerController {
    constructor() {
        this.socket = null;
        this.roomCode = null;
        this.playerName = null;
        this.playerId = null;
        this.gameState = null;
        this.connected = false;
        
        this.initializeElements();
        this.bindEvents();
        this.initializeSocket();
        
        // Auto-fill room code if provided in URL
        const urlParams = new URLSearchParams(window.location.search);
        const roomCodeFromUrl = urlParams.get('room') || this.extractRoomCodeFromPath();
        if (roomCodeFromUrl) {
            this.roomCodeInput.value = roomCodeFromUrl.toUpperCase();
        }
    }
    
    extractRoomCodeFromPath() {
        // Extract room code from URL path like /player/ABCD
        const pathParts = window.location.pathname.split('/');
        if (pathParts.length >= 3 && pathParts[1] === 'player') {
            return pathParts[2];
        }
        return '';
    }

    initializeElements() {
        // Screens
        this.joinScreen = document.getElementById('join-screen');
        this.lobbyScreen = document.getElementById('lobby-screen');
        this.gameScreen = document.getElementById('game-screen');
        this.errorScreen = document.getElementById('error-screen');
        
        // Join form elements
        this.joinForm = document.getElementById('join-form');
        this.playerNameInput = document.getElementById('player-name');
        this.roomCodeInput = document.getElementById('room-code-input');
        
        // Lobby elements
        this.currentRoomCode = document.getElementById('current-room-code');
        this.playersList = document.getElementById('players-list');
        this.playerCount = document.getElementById('player-count');
        this.playerStatus = document.getElementById('player-status');
        this.roomInfo = document.getElementById('room-info');
        
        // Game elements
        this.gameTypeDisplay = document.getElementById('game-type-display');
        this.gameStatus = document.getElementById('game-status');
        this.gameMessage = document.getElementById('game-message');
        this.playerArea = document.getElementById('player-area');
        this.gameActions = document.getElementById('game-actions');
        this.scoresList = document.getElementById('scores-list');
        
        // Error elements
        this.errorMessage = document.getElementById('error-message');
        this.retryBtn = document.getElementById('retry-btn');
        
        // Connection status
        this.connectionStatus = document.getElementById('connection-status');
        this.statusIndicator = this.connectionStatus.querySelector('.status-indicator');
        this.statusText = this.connectionStatus.querySelector('.status-text');
    }

    bindEvents() {
        this.joinForm.addEventListener('submit', (e) => {
            e.preventDefault();
            this.joinGame();
        });
        
        this.retryBtn.addEventListener('click', () => {
            this.showJoinScreen();
        });
        
        // Format room code input as uppercase
        this.roomCodeInput.addEventListener('input', (e) => {
            e.target.value = e.target.value.toUpperCase();
        });
    }

    initializeSocket() {
        this.socket = io();
        
        this.socket.on('connect', () => {
            console.log('Connected to server');
            this.connected = true;
            this.updateConnectionStatus('Connected', 'connected');
        });

        this.socket.on('disconnect', () => {
            console.log('Disconnected from server');
            this.connected = false;
            this.updateConnectionStatus('Disconnected', 'disconnected');
        });
        
        this.socket.on('connecting', () => {
            this.updateConnectionStatus('Connecting...', 'connecting');
        });

        this.socket.on('error', (data) => {
            console.error('Socket error:', data);
            this.showError(data.message || 'Connection error occurred');
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
            this.showLobbyScreen();
        });
    }

    joinGame() {
        const playerName = this.playerNameInput.value.trim();
        const roomCode = this.roomCodeInput.value.trim().toUpperCase();
        
        if (!playerName) {
            this.showError('Please enter your name');
            return;
        }
        
        if (!roomCode || roomCode.length !== 4) {
            this.showError('Please enter a valid 4-letter room code');
            return;
        }
        
        this.playerName = playerName;
        this.roomCode = roomCode;
        
        // Disable form while joining
        this.joinForm.querySelector('button').disabled = true;
        this.joinForm.querySelector('button').textContent = 'Joining...';
        
        this.socket.emit('join-room', {
            roomCode: roomCode,
            playerName: playerName,
            deviceType: 'player'
        });
    }

    handleRoomState(data) {
        if (data.roomCode) {
            this.roomCode = data.roomCode;
            this.currentRoomCode.textContent = data.roomCode;
            this.roomInfo.style.display = 'block';
            
            // Set player ID to socket ID if not already set
            if (!this.playerId) {
                this.playerId = this.socket.id;
                console.log('Player ID set to:', this.playerId);
            }
            
            // Update players list
            this.updatePlayersList(data.players || []);
            
            if (data.isGameActive) {
                this.showGameScreen();
                if (data.gameState) {
                    this.updateGameDisplay(data.gameState);
                }
            } else {
                this.showLobbyScreen();
            }
            
            // Re-enable join form
            this.joinForm.querySelector('button').disabled = false;
            this.joinForm.querySelector('button').textContent = 'Join Game';
        }
    }

    handlePlayerJoined(data) {
        this.playerStatus.textContent = `${data.playerName} joined the game!`;
        
        // Update player count if provided
        if (data.playerCount !== undefined) {
            this.playerCount.textContent = data.playerCount;
        }
    }

    handlePlayerLeft(data) {
        if (data.playerCount !== undefined) {
            this.playerCount.textContent = data.playerCount;
        }
    }

    handleGameStarted(data) {
        this.gameTypeDisplay.textContent = this.prettyGameType(data.gameType);
        this.showGameScreen();
    }

    handleGameUpdate(data) {
        this.gameState = data.gameState || data;
        this.gameTypeDisplay.textContent = this.prettyGameType(this.gameState.gameType);
        this.showGameScreen();
        this.updateGameDisplay(this.gameState);
    }

    prettyGameType(type) {
        if (type === 'madlad') return 'MadLad';
        if (type === 'test') return 'Test Game';
        return type || 'Game';
    }

    updatePlayersList(players) {
        this.playersList.innerHTML = '';
        this.playerCount.textContent = players.length;
        
        players.forEach(player => {
            const li = document.createElement('li');
            li.className = 'player-item';
            li.textContent = player.name;
            if (player.id === this.playerId) {
                li.classList.add('current-player');
                li.textContent += ' (You)';
            }
            this.playersList.appendChild(li);
        });
    }

    updateGameDisplay(gameState) {
        if (!gameState) return;

        if (gameState.gameType === 'madlad') {
            this.renderMadLad(gameState);
            return;
        }

        // Generic fallback (e.g. test game)
        this.gameStatus.textContent = '';
        this.gameMessage.textContent = gameState.message || '';
        this.playerArea.innerHTML = '';
        this.renderActionButtons(gameState.availableActions);
        this.renderScores(gameState.scores);
    }

    renderMadLad(state) {
        const you = state.you || {};
        this.gameStatus.textContent = `Round ${state.round} · First to ${state.targetScore}`;
        this.gameMessage.innerHTML = state.blackCard
            ? `<div class="madlad-black-card">${this.formatPrompt(state.blackCard)}</div>`
            : '';

        this.playerArea.innerHTML = '';

        if (state.phase === 'gameover') {
            this.playerArea.appendChild(this.banner(`🎉 ${this.esc(state.winnerName)} wins the game!`));
        } else if (you.isJudge) {
            this.renderJudgeView(state);
        } else {
            this.renderAnswererView(state, you);
        }

        this.renderActionButtons(state.availableActions);
        this.renderScores(state.scores);
    }

    renderJudgeView(state) {
        this.playerArea.appendChild(this.banner('👑 You are the Card Czar'));

        if (state.phase === 'answering') {
            this.playerArea.appendChild(this.note(
                `Waiting for players... (${state.submittedCount}/${state.expectedCount} submitted)`,
            ));
        } else if (state.phase === 'judging') {
            this.playerArea.appendChild(this.note('Tap the funniest answer to crown the winner:'));
            const grid = document.createElement('div');
            grid.className = 'madlad-hand';
            (state.submissions || []).forEach((sub) => {
                const card = this.whiteCard(sub.text);
                card.onclick = () => this.sendAction('pick-winner', { submissionId: sub.id });
                grid.appendChild(card);
            });
            this.playerArea.appendChild(grid);
        } else if (state.phase === 'results' && state.lastWinner) {
            this.playerArea.appendChild(this.note(
                `Winner: "${this.esc(state.lastWinner.text)}" by ${this.esc(state.lastWinner.playerName)}`,
            ));
        }
    }

    renderAnswererView(state, you) {
        if (state.phase === 'answering' && !you.hasSubmitted) {
            this.playerArea.appendChild(this.note('Pick a card to play:'));
            const grid = document.createElement('div');
            grid.className = 'madlad-hand';
            (state.hand || []).forEach((card) => {
                const el = this.whiteCard(card.text);
                el.onclick = () => this.sendAction('submit-card', { cardIndex: card.index });
                grid.appendChild(el);
            });
            this.playerArea.appendChild(grid);
        } else if (state.phase === 'answering' && you.hasSubmitted) {
            this.playerArea.appendChild(this.note('✅ Card submitted — waiting for the others...'));
        } else if (state.phase === 'judging') {
            this.playerArea.appendChild(this.note(`${this.esc(state.judgeName)} is choosing the winner...`));
        } else if (state.phase === 'results' && state.lastWinner) {
            const won = state.lastWinner.playerId === you.id;
            this.playerArea.appendChild(this.banner(
                won ? '🏆 You won this round!' : `${this.esc(state.lastWinner.playerName)} won this round`,
            ));
            this.playerArea.appendChild(this.note(`"${this.esc(state.lastWinner.text)}"`));
        }
    }

    renderActionButtons(availableActions) {
        this.gameActions.innerHTML = '';
        const actions = Array.isArray(availableActions) ? availableActions : [];
        actions.forEach((action) => {
            const button = document.createElement('button');
            button.className = 'action-btn';
            button.textContent = action.label || action.type;
            button.onclick = () => this.sendAction(action.type, action.data || {});
            this.gameActions.appendChild(button);
        });
    }

    renderScores(scores) {
        if (!scores || !Array.isArray(scores)) return;
        this.scoresList.innerHTML = '';
        scores.forEach((entry) => {
            const div = document.createElement('div');
            div.className = 'score-item';
            div.innerHTML = `
                <span class="player-name">${this.esc(entry.name)}</span>
                <span class="score">${entry.score}</span>
            `;
            this.scoresList.appendChild(div);
        });
    }

    // ---- Small DOM helpers ------------------------------------------------

    whiteCard(text) {
        const el = document.createElement('button');
        el.className = 'madlad-white-card';
        el.textContent = text;
        return el;
    }

    banner(text) {
        const el = document.createElement('div');
        el.className = 'madlad-banner';
        el.textContent = text;
        return el;
    }

    note(text) {
        const el = document.createElement('p');
        el.className = 'madlad-note';
        el.textContent = text;
        return el;
    }

    formatPrompt(text) {
        return this.esc(text).replace(/_{2,}/g, '<span class="madlad-blank">&nbsp;&nbsp;&nbsp;</span>');
    }

    esc(text) {
        const div = document.createElement('div');
        div.textContent = text == null ? '' : String(text);
        return div.innerHTML;
    }

    sendAction(type, data = {}) {
        if (!this.socket || !this.connected) {
            this.showError('Not connected to server');
            return;
        }
        this.socket.emit('player-action', { action: type, data });
    }

    updateConnectionStatus(text, status) {
        this.statusText.textContent = text;
        this.statusIndicator.className = `status-indicator ${status}`;
    }

    showJoinScreen() {
        this.hideAllScreens();
        this.joinScreen.classList.add('active');
        this.roomInfo.style.display = 'none';
        
        // Re-enable form
        this.joinForm.querySelector('button').disabled = false;
        this.joinForm.querySelector('button').textContent = 'Join Game';
    }

    showLobbyScreen() {
        this.hideAllScreens();
        this.lobbyScreen.classList.add('active');
    }

    showGameScreen() {
        this.hideAllScreens();
        this.gameScreen.classList.add('active');
    }

    showError(message) {
        this.errorMessage.textContent = message;
        this.hideAllScreens();
        this.errorScreen.classList.add('active');
        
        // Re-enable form
        this.joinForm.querySelector('button').disabled = false;
        this.joinForm.querySelector('button').textContent = 'Join Game';
    }

    hideAllScreens() {
        this.joinScreen.classList.remove('active');
        this.lobbyScreen.classList.remove('active');
        this.gameScreen.classList.remove('active');
        this.errorScreen.classList.remove('active');
    }
}

// Initialize the player controller when the page loads
document.addEventListener('DOMContentLoaded', () => {
    new PlayerController();
});