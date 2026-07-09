/**
 * Sound + haptics for card play, submission reveal, and round/game winners
 * (J6). Synthesized entirely with the Web Audio API — no binary asset files
 * to bundle or host. Haptics use `navigator.vibrate`, which only exists on
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
    let unlocked = false;

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
        if (unlocked) return;
        unlocked = true;
        const ctx = getContext();
        if (ctx && ctx.state === 'suspended') {
            ctx.resume().catch(() => {});
        }
    }

    function armUnlockListeners() {
        const events = ['pointerdown', 'touchstart', 'keydown'];
        const handler = () => {
            unlock();
            events.forEach((evt) => document.removeEventListener(evt, handler));
        };
        events.forEach((evt) => document.addEventListener(evt, handler, { passive: true }));
    }

    // ---- Tone synthesis -----------------------------------------------------

    function tone(ctx, opts) {
        const start = opts.start;
        const duration = opts.duration;
        const osc = ctx.createOscillator();
        const amp = ctx.createGain();
        osc.type = opts.type || 'sine';
        osc.frequency.setValueAtTime(opts.freq, start);
        if (opts.freqEnd) {
            osc.frequency.exponentialRampToValueAtTime(Math.max(opts.freqEnd, 1), start + duration);
        }
        amp.gain.setValueAtTime(0.0001, start);
        amp.gain.linearRampToValueAtTime(opts.gain || 0.2, start + 0.012);
        amp.gain.exponentialRampToValueAtTime(0.0001, start + duration);
        osc.connect(amp).connect(ctx.destination);
        osc.start(start);
        osc.stop(start + duration + 0.02);
    }

    function playIfAllowed(build) {
        if (muted) return;
        const ctx = getContext();
        if (!ctx) return;
        if (ctx.state === 'suspended') {
            // Best-effort resume; if the browser still blocks it (no gesture
            // seen yet) this just silently no-ops instead of throwing.
            ctx.resume().catch(() => {});
        }
        try {
            build(ctx);
        } catch (e) {
            // Never let a synthesis glitch break gameplay.
        }
    }

    function playCard() {
        playIfAllowed((ctx) => {
            const t = ctx.currentTime;
            tone(ctx, {
                freq: 320, freqEnd: 170, start: t, duration: 0.14, type: 'triangle', gain: 0.18,
            });
        });
        vibrate(15);
    }

    function playFlip() {
        playIfAllowed((ctx) => {
            const t = ctx.currentTime;
            tone(ctx, {
                freq: 480, freqEnd: 760, start: t, duration: 0.09, type: 'square', gain: 0.11,
            });
            tone(ctx, {
                freq: 360, freqEnd: 600, start: t + 0.05, duration: 0.1, type: 'square', gain: 0.1,
            });
        });
        vibrate(10);
    }

    function playWin() {
        playIfAllowed((ctx) => {
            const t = ctx.currentTime;
            [523.25, 659.25, 783.99, 1046.5].forEach((freq, i) => {
                tone(ctx, {
                    freq, start: t + i * 0.09, duration: 0.3, type: 'triangle', gain: 0.2,
                });
            });
        });
        vibrate([30, 40, 30, 40, 70]);
    }

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
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    global.SoundFX = {
        playCard,
        playFlip,
        playWin,
        vibrate,
        isMuted() { return muted; },
        setMuted,
        toggleMuted,
    };
}(window));
