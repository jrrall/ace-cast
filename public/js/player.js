class PlayerController {
    constructor() {
        this.socket = null;
        this.roomCode = null;
        this.playerName = null;
        this.playerId = null;
        this.gameState = null;
        this.connected = false;
        // Round+phase signature last used to fire a J6 sound/haptic cue —
        // prevents re-firing on every redundant game-update re-render.
        this._lastSoundSig = null;

        // Text of the card we most recently submitted, so the post-submit
        // "played" state can show it (the server doesn't echo submitted card
        // text back).
        this.lastPlayedCardText = null;

        // Durable anonymous identity in a first-party cookie. Survives reloads
        // and reconnects; it's both the reconnect key and the telemetry visitor id.
        this.clientId = this.getClientId();

        this.initializeElements();
        this.bindEvents();
        this.initializeSocket();

        // Auto-fill room code if provided in URL
        const urlParams = new URLSearchParams(window.location.search);
        const roomCodeFromUrl = urlParams.get('room') || this.extractRoomCodeFromPath();
        if (roomCodeFromUrl) {
            this.roomCodeInput.value = roomCodeFromUrl.toUpperCase();
        }

        // Restore a prior session (name + room) so a reload can rejoin the game
        // in progress. Prefill the form regardless; only arm auto-rejoin when the
        // saved room matches the room we're pointed at (don't hijack a new code).
        const saved = this.loadSession();
        if (saved.playerName) {
            this.playerName = saved.playerName;
            this.playerNameInput.value = saved.playerName;
        }
        if (saved.roomCode && !this.roomCodeInput.value) {
            this.roomCodeInput.value = saved.roomCode;
        }
        const targetRoom = (this.roomCodeInput.value || '').toUpperCase();
        if (saved.playerName && saved.roomCode && saved.roomCode === targetRoom) {
            this.roomCode = saved.roomCode;
        }
    }

    // ---- Identity + session persistence -----------------------------------

    getClientId() {
        let id = this.readCookie('acecast_cid');
        if (!id) {
            id = this.uuid();
            this.writeCookie('acecast_cid', id, 365);
        }
        return id;
    }

    uuid() {
        if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
        // crypto.randomUUID needs a secure context; plain-http LAN uses this path.
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
            const r = (Math.random() * 16) | 0;
            const v = c === 'x' ? r : (r & 0x3) | 0x8;
            return v.toString(16);
        });
    }

    readCookie(name) {
        const match = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
        return match ? decodeURIComponent(match[1]) : null;
    }

    writeCookie(name, value, days) {
        const maxAge = days * 24 * 60 * 60;
        document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=${maxAge}; SameSite=Lax`;
    }

    persistSession() {
        try {
            localStorage.setItem('acecast_session', JSON.stringify({
                playerName: this.playerName,
                roomCode: this.roomCode,
            }));
        } catch (e) {
            // Storage blocked (private mode) — live-session reconnect still works.
        }
    }

    loadSession() {
        try {
            return JSON.parse(localStorage.getItem('acecast_session')) || {};
        } catch (e) {
            return {};
        }
    }

    emitJoin() {
        this.socket.emit('join-room', {
            roomCode: this.roomCode,
            playerName: this.playerName,
            deviceType: 'player',
            clientId: this.clientId,
        });
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
            // (Re)join automatically: first connect with a restored session, or a
            // transport reconnect after a blip. The server restores our held seat.
            if (this.playerName && this.roomCode) {
                this.emitJoin();
            }
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
            const message = (data && data.message) || 'Connection error occurred';
            // The room we were (re)joining is gone — the game ended and the
            // session was released. Stop auto-rejoining a dead game: reset to the
            // join screen instead of looping on the error each reconnect.
            if (message === 'Room not found' && this.roomCode) {
                this.handleSessionClosed();
                return;
            }
            this.showError(message);
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

        this.socket.on('player-disconnected', (data) => {
            // A player dropped but their seat is held; just refresh the count.
            this.handlePlayerLeft(data);
        });

        this.socket.on('start-countdown', (data) => {
            const n = data && data.secondsLeft;
            if (this.playerStatus && n) {
                this.playerStatus.textContent = `Game starting in ${n}…`;
            }
        });

        this.socket.on('start-countdown-cancelled', () => {
            if (this.playerStatus) {
                this.playerStatus.textContent = "You've joined the game!";
            }
        });

        this.socket.on('game-started', (data) => {
            this.handleGameStarted(data);
        });

        this.socket.on('game-update', (data) => {
            this.handleGameUpdate(data);
        });

        this.socket.on('game-ended', () => {
            this.gameState = null;
            this.lastPlayedCardText = null;
            this.showLobbyScreen();
        });

        this.socket.on('game-over', (data) => {
            this.beginGameOverCountdown(data && data.closesInSec);
        });

        this.socket.on('session-closed', () => {
            this.handleSessionClosed();
        });
    }

    // ---- Game-over countdown + session release ----------------------------

    beginGameOverCountdown(sec) {
        this.clearGameOverCountdown();
        let remaining = Math.max(0, Number(sec) || 0);
        let el = document.getElementById('gameover-timer');
        if (!el) {
            el = document.createElement('div');
            el.id = 'gameover-timer';
            el.className = 'gameover-timer';
            document.body.appendChild(el);
        }
        const render = () => { el.textContent = remaining > 0 ? `New session in ${remaining}s…` : 'Closing…'; };
        render();
        this._goTimer = setInterval(() => {
            remaining -= 1;
            if (remaining < 0) this.clearGameOverCountdown(); else render();
        }, 1000);
    }

    clearGameOverCountdown() {
        if (this._goTimer) { clearInterval(this._goTimer); this._goTimer = null; }
        const el = document.getElementById('gameover-timer');
        if (el) el.remove();
    }

    handleSessionClosed() {
        this.clearGameOverCountdown();
        this.gameState = null;
        this.roomCode = null;
        this.lastPlayedCardText = null;
        // Don't auto-rejoin a room that no longer exists.
        try { localStorage.removeItem('acecast_session'); } catch (e) { /* ignore */ }
        this.showJoinScreen();
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
        this.playerId = this.clientId;
        // Remember for reload/reconnect auto-rejoin.
        this.persistSession();

        // Disable form while joining
        this.joinForm.querySelector('button').disabled = true;
        this.joinForm.querySelector('button').textContent = 'Joining...';

        this.emitJoin();
    }

    handleRoomState(data) {
        if (data.roomCode) {
            this.roomCode = data.roomCode;
            this.currentRoomCode.textContent = data.roomCode;
            this.roomInfo.style.display = 'block';

            // Our identity is the stable clientId (matches server-side player ids),
            // so "(You)" highlighting and win detection survive reconnects.
            this.playerId = this.clientId;
            this.persistSession();

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
        if (type === 'madlad') return 'unholy.cards';
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

    // Fire sound/haptics (J6) exactly once per round+phase transition, not on
    // every re-render (e.g. repeated 'answering' updates as others submit).
    trackSoundEvents(state) {
        if (!window.SoundFX) return;
        const sig = `${state.round}:${state.phase}`;
        if (sig === this._lastSoundSig) return;
        this._lastSoundSig = sig;
        if (state.phase === 'judging') {
            window.SoundFX.playFlip();
        } else if ((state.phase === 'results' || state.phase === 'gameover') && state.lastWinner) {
            window.SoundFX.playWin();
        }
    }

    renderMadLad(state) {
        const you = state.you || {};
        this.trackSoundEvents(state);
        this.gameStatus.textContent = `Round ${state.round} · First to ${state.targetScore}`;
        this.gameMessage.innerHTML = '';
        if (state.blackCard) {
            this.gameMessage.appendChild(
                window.CardRender.renderCard({ kind: 'prompt', text: state.blackCard }, { variant: 'phone' }),
            );
        }

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
                card.onclick = () => {
                    if (window.SoundFX) window.SoundFX.playCard();
                    this.sendAction('pick-winner', { submissionId: sub.id });
                };
                grid.appendChild(this.wrapWithFlag(card, sub.cardId));
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
            this.playerArea.appendChild(this.note('Tap a card to play it:'));
            const grid = document.createElement('div');
            grid.className = 'madlad-hand';
            (state.hand || []).forEach((card) => {
                const el = this.whiteCard(card.text);
                el.onclick = () => {
                    // Remember what we played so the post-submit state can show it
                    // (the server doesn't echo the submitted card text back).
                    this.lastPlayedCardText = card.text;
                    if (window.SoundFX) window.SoundFX.playCard();
                    this.sendAction('submit-card', { cardIndex: card.index });
                };
                let wrapped = this.wrapWithFlag(el, card.cardId);
                // One free swap per round: overlay a discard/swap control that
                // replaces the card instead of playing it.
                if (you.canDiscard) wrapped = this.withDiscardControl(wrapped, card);
                grid.appendChild(wrapped);
            });
            this.playerArea.appendChild(grid);
        } else if (state.phase === 'answering' && you.hasSubmitted) {
            this.playerArea.appendChild(this.renderPlayedState());
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

    // Clear, obvious "played" state for a card that's been submitted this
    // round. The server doesn't echo the submitted card's text back, so we
    // show the copy we captured locally at submit time when we have it.
    renderPlayedState() {
        const container = document.createElement('div');
        container.className = 'hand-played';
        container.appendChild(this.note('✅ Card submitted — waiting for the others...'));

        if (this.lastPlayedCardText != null) {
            const cardWrap = document.createElement('div');
            cardWrap.className = 'hand-played__card-wrap';
            cardWrap.appendChild(window.CardRender.renderCard(
                { kind: 'answer', text: this.lastPlayedCardText },
                { variant: 'hand', className: 'card--played' },
            ));
            const badge = document.createElement('span');
            badge.className = 'hand-played__badge';
            badge.textContent = '✓ Played';
            cardWrap.appendChild(badge);
            container.appendChild(cardWrap);
        }

        return container;
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
        return window.CardRender.renderCard({ kind: 'answer', text }, { variant: 'hand', as: 'button' });
    }

    // Wrap a card with a small flag control (F2). Cards without an id (e.g. the
    // blank fallback) are returned unwrapped. Used on hand cards (answering) and
    // on the judge's submission grid (judging) — flagging the card's DB id.
    wrapWithFlag(cardEl, cardId) {
        if (cardId == null) return cardEl;
        const wrap = document.createElement('div');
        wrap.className = 'madlad-card-wrap';
        wrap.style.position = 'relative';
        wrap.appendChild(cardEl);

        const flagBtn = document.createElement('button');
        flagBtn.type = 'button';
        flagBtn.className = 'madlad-flag';
        flagBtn.textContent = '⚑';
        flagBtn.title = 'Flag this card';
        flagBtn.setAttribute('aria-label', 'Flag this card');
        flagBtn.style.cssText = 'position:absolute;top:4px;right:4px;border:none;background:transparent;font-size:14px;line-height:1;opacity:.45;cursor:pointer;z-index:2;';
        flagBtn.onclick = (e) => {
            e.stopPropagation();
            this.showFlagMenu(wrap, cardId, flagBtn);
        };
        wrap.appendChild(flagBtn);
        return wrap;
    }

    // Overlay a discard/swap control on a hand card (one free swap per round).
    // `el` may be a bare card or an existing flag-wrap; ensure a positioned
    // container either way. Tapping it swaps the card WITHOUT playing it, so it
    // stops propagation to the card body's play handler.
    withDiscardControl(el, card) {
        let wrap = el;
        if (!el.classList || !el.classList.contains('madlad-card-wrap')) {
            wrap = document.createElement('div');
            wrap.className = 'madlad-card-wrap';
            wrap.style.position = 'relative';
            wrap.appendChild(el);
        }

        const swapBtn = document.createElement('button');
        swapBtn.type = 'button';
        swapBtn.className = 'madlad-discard';
        swapBtn.textContent = '🔄';
        swapBtn.title = 'Swap this card (once per round)';
        swapBtn.setAttribute('aria-label', 'Swap this card for a new one');
        swapBtn.onclick = (e) => {
            e.stopPropagation();
            if (window.SoundFX) window.SoundFX.playCard();
            this.sendAction('discard-card', { cardIndex: card.index });
        };
        wrap.appendChild(swapBtn);
        return wrap;
    }

    showFlagMenu(wrap, cardId, flagBtn) {
        if (wrap.querySelector('.madlad-flag-menu')) return;
        const menu = document.createElement('div');
        menu.className = 'madlad-flag-menu';
        menu.style.cssText = 'position:absolute;top:22px;right:4px;display:flex;flex-direction:column;gap:2px;background:#222;padding:4px;border-radius:6px;z-index:5;';
        [['not_funny', 'Not funny'], ['broken', 'Broken']].forEach(([reason, label]) => {
            const b = document.createElement('button');
            b.type = 'button';
            b.textContent = label;
            b.style.cssText = 'font-size:12px;padding:4px 8px;border:none;border-radius:4px;background:#444;color:#fff;cursor:pointer;';
            b.onclick = (e) => {
                e.stopPropagation();
                this.flagCard(cardId, reason);
                menu.remove();
                flagBtn.textContent = '✓';
                flagBtn.style.opacity = '1';
                flagBtn.disabled = true;
            };
            menu.appendChild(b);
        });
        wrap.appendChild(menu);
    }

    flagCard(cardId, reason) {
        if (cardId == null || !this.socket || !this.connected) return;
        this.socket.emit('flag-card', { cardId, reason });
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

    esc(text) {
        return window.CardRender.esc(text);
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