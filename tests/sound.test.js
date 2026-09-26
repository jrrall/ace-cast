const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const flush = () => new Promise((resolve) => setImmediate(resolve));
function setup({ fetch, state = 'running', resume } = {}) {
    const sources = [];
    const listeners = {};
    const ctx = {
        state,
        destination: {},
        resume: jest.fn(resume || (() => { ctx.state = 'running'; return Promise.resolve(); })),
        decodeAudioData: jest.fn(async (data) => data),
        createBufferSource: jest.fn(() => {
            const source = { connect: jest.fn(), disconnect: jest.fn(), start: jest.fn(), stop: jest.fn() };
            sources.push(source);
            return source;
        }),
    };
    const document = {
        readyState: 'complete',
        querySelectorAll: () => [],
        addEventListener: (name, fn) => { listeners[name] = fn; },
    };
    const window = {
        AudioContext: function AudioContext() { return ctx; },
        localStorage: { getItem: () => null, setItem: jest.fn() },
        fetch: fetch || jest.fn(async (url) => ({ ok: true, arrayBuffer: async () => url })),
    };
    const navigator = { vibrate: jest.fn() };
    vm.runInNewContext(fs.readFileSync(path.join(root, 'public/js/sound.js'), 'utf8'), { window, document, navigator });
    return { fx: window.SoundFX, ctx, window, navigator, sources, listeners };
}

test('each action plays its approved WAV, preloaded once', async () => {
    const app = setup();
    await flush();
    const actions = { playCard: 'card-pop', playSwap: 'card-swap', playFlip: 'answer-reveal', playNewRound: 'new-round', playWin: 'round-win', playGameWin: 'game-win' };
    for (const [method, asset] of Object.entries(actions)) {
        await app.fx[method]();
        expect(app.sources.at(-1).buffer).toBe(`/audio/layered/${asset}.wav`);
        expect(fs.existsSync(path.join(root, `public/audio/layered/${asset}.wav`))).toBe(true);
    }
    await app.fx.playCard();
    expect(app.window.fetch).toHaveBeenCalledTimes(6);
    expect(app.ctx.decodeAudioData).toHaveBeenCalledTimes(6);
});

test('mute stops active audio and blocks both sound and haptics', async () => {
    const app = setup();
    await flush();
    await app.fx.playWin();
    app.fx.setMuted(true);
    expect(app.sources[0].stop).toHaveBeenCalledTimes(1);
    app.navigator.vibrate.mockClear();
    await app.fx.playCard();
    expect(app.sources).toHaveLength(1);
    expect(app.navigator.vibrate).not.toHaveBeenCalled();
});

test('muting while a download is pending cancels that event even after unmute', async () => {
    let release;
    const pending = new Promise((resolve) => { release = resolve; });
    const app = setup({ fetch: () => pending });
    const play = app.fx.playCard();
    app.fx.setMuted(true);
    app.fx.setMuted(false);
    release({ ok: true, arrayBuffer: async () => new ArrayBuffer(1) });
    await play;
    expect(app.sources).toHaveLength(0);
});

test('failed downloads do not break play and can retry', async () => {
    const fetch = jest.fn(async () => { throw new Error('offline'); });
    const app = setup({ fetch });
    await flush();
    await expect(app.fx.playCard()).resolves.toBeUndefined();
    expect(app.sources).toHaveLength(0);
    fetch.mockImplementation(async (url) => ({ ok: true, arrayBuffer: async () => url }));
    await app.fx.playCard();
    expect(app.sources).toHaveLength(1);
});

test('a denied autoplay unlock can retry on a later gesture', async () => {
    const app = setup({ state: 'suspended', resume: () => Promise.reject(new Error('gesture required')) });
    await flush();
    await app.fx.playCard();
    expect(app.sources).toHaveLength(0);
    app.ctx.resume.mockImplementation(() => { app.ctx.state = 'running'; return Promise.resolve(); });
    app.listeners.pointerdown();
    await flush();
    await app.fx.playCard();
    expect(app.sources).toHaveLength(1);
});

test.each([['player', 'PlayerController'], ['tv', 'TVController']])('%s plays one cue per phase and distinguishes final victory', (file, name) => {
    const SoundFX = Object.fromEntries(['playNewRound', 'playFlip', 'playWin', 'playGameWin'].map((key) => [key, jest.fn()]));
    const sandbox = { window: { SoundFX }, document: { addEventListener: jest.fn() } };
    vm.runInNewContext(`${fs.readFileSync(path.join(root, `public/js/${file}.js`), 'utf8')}\nthis.Controller = ${name};`, sandbox);
    const controller = Object.create(sandbox.Controller.prototype);
    for (const phase of ['answering', 'judging', 'results', 'gameover']) {
        controller.trackSoundEvents({ round: 1, phase, lastWinner: {} });
        controller.trackSoundEvents({ round: 1, phase, lastWinner: {} });
    }
    Object.values(SoundFX).forEach((fn) => expect(fn).toHaveBeenCalledTimes(1));
    controller.trackSoundEvents({ round: 2, phase: 'answering' });
    expect(SoundFX.playNewRound).toHaveBeenCalledTimes(2);
});
