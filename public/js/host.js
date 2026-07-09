class HostController {
    constructor() {
        this.socket = null;
        this.roomCode = null;
        this.players = new Map();
        this.gameActive = false;
        // Host's Hold/Auto toggle. Mirrors the server's room.autoStart; the
        // server is authoritative (autostart-state), this is the optimistic view.
        this.autoStart = true;

        this.initializeElements();
        this.bindEvents();
        this.initializeSocket();
    }

    initializeElements() {
        // Screens
        this.setupScreen = document.getElementById('setup-screen');
        this.roomScreen = document.getElementById('room-screen');
        
        // Buttons
        this.createRoomBtn = document.getElementById('create-room-btn');
        this.startGameBtn = document.getElementById('start-game-btn');
        this.endGameBtn = document.getElementById('end-game-btn');
        
        // Display elements
        this.roomCodeDisplay = document.getElementById('room-code');
        this.joinUrlDisplay = document.getElementById('join-url');
        this.tvUrlLink = document.getElementById('tv-url');
        this.qrContainer = document.getElementById('qr-code-container');
        this.playersList = document.getElementById('players-list');
        this.playerCount = document.getElementById('player-count');
        this.gameStatusContent = document.getElementById('game-status-content');
        this.countdownStatus = document.getElementById('countdown-status');
        this.autostartToggleBtn = document.getElementById('autostart-toggle-btn');
        this.addBotBtn = document.getElementById('add-bot-btn');
        this.removeBotBtn = document.getElementById('remove-bot-btn');
    }

    bindEvents() {
        this.createRoomBtn.addEventListener('click', () => this.createRoom());
        this.startGameBtn.addEventListener('click', () => this.startGame());
        this.endGameBtn.addEventListener('click', () => this.endGame());
        if (this.autostartToggleBtn) {
            this.autostartToggleBtn.addEventListener('click', () => this.toggleAutoStart());
        }
        if (this.addBotBtn) {
            this.addBotBtn.addEventListener('click', () => this.socket && this.socket.emit('add-bot'));
        }
        if (this.removeBotBtn) {
            this.removeBotBtn.addEventListener('click', () => this.socket && this.socket.emit('remove-bot'));
        }
    }

    // Hold pauses the auto-start countdown; Auto resumes it. The server echoes
    // the resulting state back via 'autostart-state'.
    toggleAutoStart() {
        if (!this.socket) return;
        this.socket.emit('set-autostart', { on: !this.autoStart });
    }

    updateAutostartButton() {
        if (!this.autostartToggleBtn) return;
        // Label is the action the button performs: "Hold" while auto is on,
        // "Auto" (resume) while held.
        this.autostartToggleBtn.textContent = this.autoStart ? 'Hold' : 'Auto';
        this.autostartToggleBtn.disabled = this.gameActive;
    }

    initializeSocket() {
        this.socket = io();
        
        this.socket.on('connect', () => {
            console.log('Connected to server');
        });

        this.socket.on('disconnect', () => {
            console.log('Disconnected from server');
        });

        this.socket.on('player-joined', (data) => {
            this.addPlayer(data.playerId, data.playerName, data.isBot);
            this.updatePlayerCount();
            if (!data.isBot) {
                this.updateGameStatus(`${data.playerName} joined the game`);
            }
        });

        this.socket.on('player-left', (data) => {
            this.removePlayer(data.playerId);
            this.updatePlayerCount();
        });

        this.socket.on('room-state', (data) => {
            this.handleRoomState(data);
        });

        this.socket.on('game-started', (data) => {
            this.gameActive = true;
            this.setCountdownStatus('');
            this.updateGameControls();
            this.updateGameStatus(`Game started: ${data.gameType}`);
        });

        this.socket.on('start-countdown', (data) => {
            const n = data && data.secondsLeft;
            this.setCountdownStatus(n ? `Starting in ${n}…` : '');
        });

        this.socket.on('start-countdown-cancelled', () => {
            this.setCountdownStatus('');
        });

        this.socket.on('autostart-state', (data) => {
            this.autoStart = Boolean(data && data.on);
            if (!this.autoStart) this.setCountdownStatus('Auto-start held');
            else this.setCountdownStatus('');
            this.updateAutostartButton();
        });

        this.socket.on('game-update', (data) => {
            this.handleGameUpdate(data);
        });

        this.socket.on('game-ended', () => {
            this.gameActive = false;
            this.setCountdownStatus('');
            this.updateGameControls();
            this.updateGameStatus('Game ended');
        });

        this.socket.on('error', (data) => {
            const message = (data && data.message) || 'Something went wrong';
            this.updateGameStatus(`⚠️ ${message}`);
            // Re-enable controls so the host can retry (e.g. after "need 3 players").
            if (!this.gameActive) {
                this.updateGameControls();
            }
        });
    }

    async createRoom() {
        try {
            this.createRoomBtn.disabled = true;
            this.createRoomBtn.textContent = 'Creating...';
            
            const response = await fetch('/api/create-room', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                }
            });

            const data = await response.json();
            
            if (response.ok) {
                this.roomCode = data.roomCode;
                this.displayRoomInfo(data);
                this.switchToRoomScreen();
                this.joinRoomAsHost();
            } else {
                throw new Error(data.error || 'Failed to create room');
            }
        } catch (error) {
            console.error('Error creating room:', error);
            alert('Failed to create room. Please try again.');
            this.createRoomBtn.disabled = false;
            this.createRoomBtn.textContent = 'Create Room';
        }
    }

    displayRoomInfo(data) {
        this.roomCodeDisplay.textContent = data.roomCode;
        this.joinUrlDisplay.textContent = data.joinUrl;
        this.tvUrlLink.href = data.tvUrl;
        
        // Display QR code
        const qrImg = document.createElement('img');
        qrImg.src = data.qrCode;
        qrImg.alt = 'QR Code to join game';
        qrImg.style.maxWidth = '200px';
        this.qrContainer.innerHTML = '';
        this.qrContainer.appendChild(qrImg);
    }

    switchToRoomScreen() {
        this.setupScreen.classList.remove('active');
        this.roomScreen.classList.add('active');
    }

    joinRoomAsHost() {
        this.socket.emit('join-room', {
            roomCode: this.roomCode,
            deviceType: 'host'
        });
    }

    addPlayer(playerId, playerName, isBot = false) {
        this.players.set(playerId, { id: playerId, name: playerName, isBot });
        this.updatePlayersDisplay();
    }

    removePlayer(playerId) {
        this.players.delete(playerId);
        this.updatePlayersDisplay();
    }

    updatePlayersDisplay() {
        this.playersList.innerHTML = '';

        for (const player of this.players.values()) {
            const li = document.createElement('li');
            li.className = 'player-item' + (player.isBot ? ' bot' : '');
            // textContent (not innerHTML) — player names are untrusted input.
            const name = document.createElement('strong');
            name.textContent = player.name;
            li.appendChild(name);
            if (player.isBot) {
                const tag = document.createElement('span');
                tag.className = 'bot-tag';
                tag.textContent = '🤖 bot';
                li.appendChild(tag);
            }
            this.playersList.appendChild(li);
        }
    }

    updatePlayerCount() {
        this.playerCount.textContent = this.players.size;
        
        // Enable/disable start button based on player count
        if (this.players.size > 0 && !this.gameActive) {
            this.startGameBtn.disabled = false;
        } else {
            this.startGameBtn.disabled = true;
        }
    }

    startGame() {
        // Start now: the server picks the default (only prod) game.
        this.socket.emit('start-game', {});
    }

    endGame() {
        this.socket.emit('end-game');
        this.gameActive = false;
        this.setCountdownStatus('');
        this.updateGameControls();
        this.updateGameStatus('Game ended');
    }

    setCountdownStatus(message) {
        if (this.countdownStatus) this.countdownStatus.textContent = message || '';
    }

    updateGameControls() {
        if (this.gameActive) {
            this.startGameBtn.style.display = 'none';
            this.endGameBtn.style.display = 'inline-block';
        } else {
            this.startGameBtn.style.display = 'inline-block';
            this.endGameBtn.style.display = 'none';
            this.updatePlayerCount(); // Re-check start button state
        }
        this.updateAutostartButton();
    }

    updateGameStatus(message) {
        const timestamp = new Date().toLocaleTimeString();
        this.gameStatusContent.innerHTML = `
            <div style="margin-bottom: 10px;">
                <strong>Status:</strong> ${message}
            </div>
            <div style="font-size: 0.8em; color: #666;">
                Last update: ${timestamp}
            </div>
        `;
    }

    handleRoomState(data) {
        // Update players list
        this.players.clear();
        if (data.players) {
            data.players.forEach(player => {
                this.players.set(player.id, player);
            });
        }
        this.updatePlayersDisplay();
        this.updatePlayerCount();
        
        // Update game state
        if (data.isGameActive) {
            this.gameActive = true;
            this.updateGameControls();
            this.updateGameStatus(`Game in progress: ${data.gameType || 'Unknown'}`);
        }
    }

    handleGameUpdate(data) {
        if (data.gameState) {
            let statusMessage = 'Game in progress';
            
            if (data.gameState.message) {
                statusMessage = data.gameState.message;
            }
            
            if (data.gameState.lastAction) {
                const action = data.gameState.lastAction;
                statusMessage += ` (Last action: ${action.type} by ${action.playerName})`;
            }
            
            this.updateGameStatus(statusMessage);
        }
    }
}

// Initialize the host controller when the page loads
document.addEventListener('DOMContentLoaded', () => {
    new HostController();
});