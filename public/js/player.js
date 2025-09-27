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
        this.gameState = data.gameState;
        this.gameTypeDisplay.textContent = data.gameType || 'Unknown Game';
        this.showGameScreen();
        this.updateGameDisplay(data.gameState);
    }

    handleGameUpdate(data) {
        this.gameState = data.gameState || data;
        this.updateGameDisplay(this.gameState);
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
        
        // Update game message
        if (gameState.message) {
            this.gameMessage.textContent = gameState.message;
        }
        
        // Update game status
        if (gameState.status) {
            this.gameStatus.textContent = gameState.status;
        }
        
        // Update player-specific area
        this.updatePlayerArea(gameState);
        
        // Update available actions
        this.updateGameActions(gameState);
        
        // Update scores if available
        this.updateScores(gameState.scores);
    }

    updatePlayerArea(gameState) {
        // This will be customized based on game type
        if (gameState.playerData && gameState.playerData[this.playerId]) {
            const playerData = gameState.playerData[this.playerId];
            this.playerArea.innerHTML = `
                <div class="player-info">
                    <h4>Your Info:</h4>
                    <pre>${JSON.stringify(playerData, null, 2)}</pre>
                </div>
            `;
        }
    }

    updateGameActions(gameState) {
        this.gameActions.innerHTML = '';
        
        let actions = null;
        
        // Handle both per-player actions and flat array of actions
        if (gameState.availableActions) {
            if (Array.isArray(gameState.availableActions)) {
                // Flat array - all players can do these actions
                actions = gameState.availableActions;
            } else if (gameState.availableActions[this.playerId]) {
                // Per-player actions
                actions = gameState.availableActions[this.playerId];
            }
        }
        
        if (actions && actions.length > 0) {
            console.log('Creating action buttons:', actions);
            actions.forEach(action => {
                const button = document.createElement('button');
                button.className = 'action-btn';
                button.textContent = action.label || action.type;
                button.onclick = () => this.sendPlayerAction(action);
                this.gameActions.appendChild(button);
            });
        } else {
            console.log('No actions available for player');
        }
    }

    updateScores(scores) {
        if (!scores) return;
        
        this.scoresList.innerHTML = '';
        
        Object.entries(scores).forEach(([playerId, score]) => {
            const div = document.createElement('div');
            div.className = 'score-item';
            div.innerHTML = `
                <span class="player-name">${score.playerName || 'Player'}</span>
                <span class="score">${score.score || score}</span>
            `;
            this.scoresList.appendChild(div);
        });
    }

    sendPlayerAction(action) {
        if (!this.socket || !this.connected) {
            this.showError('Not connected to server');
            return;
        }
        
        console.log('Player sending action:', action);
        this.socket.emit('player-action', {
            action: action.type, // TestGame expects 'action' field
            data: action.data || {}
        });
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