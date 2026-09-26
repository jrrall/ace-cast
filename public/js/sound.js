/**
 * Layered SuperCollider WAVs + haptics for game actions and milestones.
 * Audio is preloaded and decoded once, then played through Web Audio.
 * Haptics use `navigator.vibrate`, which only exists on
 * (some) mobile browsers; every call is feature-detected and never throws.
 *
 * Autoplay policy: browsers keep a fresh AudioContext suspended until a user
 * gesture. `armUnlockListeners()` resumes it on the very first tap/click/key
 * anywhere on the page, so later programmatic play() calls triggered by
 * socket events (not direct clicks) still make sound.
 *
 * OS silent switch: on iOS, whether Web Audio output is silenced by the
 * hardware mute switch is inconsistent across Safari versions and is not
 * something a web page can detect or query. We can't reliably "respect" it
 * beyond that inherent (undetectable) platform behavior — the in-app mute
 * toggle below is the reliable control we can offer.
 */
(function (global) {
    'use strict';

    const STORAGE_KEY = 'acecast_muted';
    const TOGGLE_SELECTOR = '#sound-toggle';

    let audioCtx = null;
    let muted = loadMuted();
    const ASSETS = {
        card: 'card-pop',
        swap: 'card-swap',
        flip: 'answer-reveal',
        round: 'new-round',
        win: 'round-win',
        gameWin: 'game-win',
    };
    const loads = new Map();
    const activeSources = new Set();
    let muteRevision = 0;

    function loadMuted() {
        try {
            return global.localStorage.getItem(STORAGE_KEY) === '1';
        } catch (e) {
            // Storage blocked (private mode) — just default to sound on.
            return false;
        }
    }

    function saveMuted(value) {
        try {
            global.localStorage.setItem(STORAGE_KEY, value ? '1' : '0');
        } catch (e) {
            // Storage blocked — mute choice just won't persist across reloads.
        }
    }

    function getContext() {
        if (audioCtx) return audioCtx;
        const AudioCtx = global.AudioContext || global.webkitAudioContext;
        if (!AudioCtx) return null;
        try {
            audioCtx = new AudioCtx();
        } catch (e) {
            audioCtx = null;
        }
        return audioCtx;
    }

    function unlock() {
        const ctx = getContext();
        if (!ctx) return;
        // Keep gesture listeners so interrupted/previously denied contexts can retry.
        if (ctx.state !== 'running') ctx.resume().catch(() => {});
        preload();
    }

    function armUnlockListeners() {
        ['pointerdown', 'touchstart', 'keydown'].forEach((evt) => {
            document.addEventListener(evt, unlock, { passive: true });
        });
    }

    // ---- Sample playback ---------------------------------------------------

    function loadSound(name) {
        if (loads.has(name)) return loads.get(name);
        const ctx = getContext();
        if (!ctx) return Promise.resolve(null);
        const pending = (async () => {
            try {
                const response = await global.fetch(`/audio/layered/${ASSETS[name]}.wav`);
                if (!response.ok) throw new Error('Sound unavailable');
                return await ctx.decodeAudioData(await response.arrayBuffer());
            } catch (e) {
                // Retry on a later gesture; unavailable audio never blocks the game.
                loads.delete(name);
                return null;
            }
        })();
        loads.set(name, pending);
        return pending;
    }

    function preload() {
        Object.keys(ASSETS).forEach(loadSound);
    }

    async function playSample(name, haptic) {
        if (muted) return;
        vibrate(haptic);
        const ctx = getContext();
        if (!ctx) return;
        const revision = muteRevision;
        const requestedAt = Date.now();
        try {
            const [buffer] = await Promise.all([
                loadSound(name),
                ctx.state === 'running' ? Promise.resolve() : ctx.resume(),
            ]);
            // Do not replay stale events after a download, mute, or autoplay delay.
            if (!buffer || muted || revision !== muteRevision
                || ctx.state !== 'running' || Date.now() - requestedAt > 250) return;
            const source = ctx.createBufferSource();
            source.buffer = buffer;
            source.connect(ctx.destination);
            source.onended = () => {
                activeSources.delete(source);
                source.disconnect();
            };
            source.start();
            activeSources.add(source);
        } catch (e) {
            // Browser policy, network, or decoding failures must not break gameplay.
        }
    }

    function playCard() { return playSample('card', 15); }
    function playSwap() { return playSample('swap', 10); }
    function playFlip() { return playSample('flip', 10); }
    function playNewRound() { return playSample('round', 10); }
    function playWin() { return playSample('win', [30, 40, 30, 40, 70]); }
    function playGameWin() { return playSample('gameWin', [40, 40, 60, 40, 90]); }

    // ---- Haptics --------------------------------------------------------

    function vibrate(pattern) {
        if (muted) return;
        if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return;
        try {
            navigator.vibrate(pattern);
        } catch (e) {
            // Some browsers throw if called outside a user gesture; ignore.
        }
    }

    // ---- Mute toggle --------------------------------------------------------

    function setMuted(value) {
        muted = !!value;
        muteRevision += 1;
        if (muted) {
            activeSources.forEach((source) => {
                try { source.stop(); } catch (e) { /* Already ended. */ }
            });
            activeSources.clear();
            try {
                if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate(0);
            } catch (e) { /* Haptics are optional. */ }
        }
        saveMuted(muted);
        syncToggleButtons();
    }

    function toggleMuted() {
        setMuted(!muted);
        return muted;
    }

    function syncToggleButtons() {
        document.querySelectorAll(TOGGLE_SELECTOR).forEach((btn) => {
            btn.textContent = muted ? '🔇' : '🔊';
            btn.setAttribute('aria-pressed', String(muted));
            btn.setAttribute('aria-label', muted ? 'Unmute sound' : 'Mute sound');
            btn.classList.toggle('is-muted', muted);
        });
    }

    function wireToggleButtons() {
        document.querySelectorAll(TOGGLE_SELECTOR).forEach((btn) => {
            if (btn.dataset.soundWired) return;
            btn.dataset.soundWired = '1';
            btn.type = 'button';
            btn.addEventListener('click', () => {
                unlock();
                toggleMuted();
            });
        });
        syncToggleButtons();
    }

    function init() {
        armUnlockListeners();
        wireToggleButtons();
        preload();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    global.SoundFX = {
        playCard,
        playSwap,
        playFlip,
        playNewRound,
        playWin,
        playGameWin,
        vibrate,
        isMuted() { return muted; },
        setMuted,
        toggleMuted,
    };
}(window));
