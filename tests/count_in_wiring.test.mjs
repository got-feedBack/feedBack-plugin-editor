/*
 * Wiring test for the count-in (src/audio.js startPlayback).
 *
 * The pure planner (_countInPlanPure) is tested in count_in.test.mjs. This
 * pins the thing a pure test CAN'T see: that the scheduled count-in click
 * voices SURVIVE startPlayback. The clicks are pushed onto _guideVoices, and
 * the transport anchor runs _guideResetSchedule() → _guideCancelVoices(),
 * which osc.stop()s every voice. If the clicks are scheduled BEFORE the anchor
 * (the obvious spot), the reset cancels them and the count-in is silent. This
 * drives startPlayback with a fake AudioContext and asserts no click voice was
 * cancelled — i.e. they remain scheduled to fire during the pre-roll.
 *
 * Also pins the recorder clamp (chartTimeNow) rule via the real
 * _transportChartTimePure: during a pre-roll the anchor sits in the future, so
 * a note played over the count must clamp to playStartTime, never a pre-region
 * time; post-start notes pass through unclamped.
 *
 * Run: node tests/count_in_wiring.test.mjs
 */
import assert from 'node:assert';

// A keyed localStorage so editorCountIn / editorFollow / metronome prefs read
// deterministically (default off, count-in = 1 bar, follow off to skip scroll).
const store = new Map([['editorCountIn', '1'], ['editorFollow', '0']]);
globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
};
globalThis.document = { getElementById: () => null, addEventListener: () => {}, activeElement: null };
globalThis.window = globalThis;
globalThis.requestAnimationFrame = () => 0;
globalThis.cancelAnimationFrame = () => {};

const { startPlayback } = await import('../src/audio.js');
const { S } = await import('../src/state.js');
const { host } = await import('../src/host.js');
const { _transportChartTimePure } = await import('../src/transport.js');

let pass = 0, fail = 0;
function t(name, fn) {
    try { fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}

// Fake AudioContext: oscillators record whether stop() was a NATURAL scheduled
// end (osc.stop(t), t defined — every metro voice does this) or a CANCEL
// (osc.stop(), no arg — what _guideCancelVoices() calls). Only the cancel means
// the voice was killed before it could sound.
const CTX_NOW = 100;
function fakeCtx() {
    const oscillators = [];
    const param = () => ({ value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {}, linearRampToValueAtTime() {} });
    return {
        oscillators,
        currentTime: CTX_NOW,
        state: 'running',
        resume() {},
        destination: {},
        createOscillator() {
            const o = {
                type: '', frequency: { value: 0 }, started: null, cancelled: false, naturalStop: null,
                connect() {}, start(x) { this.started = x; },
                stop(x) { if (x === undefined) this.cancelled = true; else this.naturalStop = x; },
            };
            oscillators.push(o); return o;
        },
        createGain() { return { gain: param(), connect() {}, disconnect() {} }; },
        createDynamicsCompressor() {
            return { threshold: param(), knee: param(), ratio: param(), attack: param(), release: param(), connect() {} };
        },
    };
}

function setup() {
    Object.assign(host, {
        selectedLoopRegion: () => null, updateTimeDisplay() {}, drawNow() {},
        editorClampScrollX: (x) => x, draw() {}, updateStatus() {},
    });
    const ctx = fakeCtx();
    S.audioCtx = ctx;
    S.audioBuffer = null;               // compose mode — no BufferSource plumbing
    S.arrangements = [];
    S.drumEditMode = false;
    // 4/4 @ 120 BPM, 0.5 s/beat, two bars.
    S.beats = [];
    for (let i = 0; i < 8; i++) S.beats.push({ time: i * 0.5, measure: i % 4 === 0 ? i / 4 + 1 : -1, den: 4 });
    S.cursorTime = 0;
    S.loopEnabled = false;
    S.barSel = null;
    S.zoom = 1;
    S.scrollX = 0;
    S.playing = false;
    return ctx;
}

t('count-in clicks survive startPlayback — the anchor reset does NOT cancel them', () => {
    const ctx = setup();
    startPlayback();
    // One 4/4 bar → exactly four click oscillators, and nothing else sounds
    // (compose mode, empty chart, metro/guide off).
    assert.strictEqual(ctx.oscillators.length, 4, 'four count-in clicks scheduled');
    const cancelled = ctx.oscillators.filter((o) => o.cancelled);
    assert.strictEqual(cancelled.length, 0, 'no click voice was cancelled by the anchor reset');
    for (const o of ctx.oscillators) {
        assert.ok(o.started !== null && o.naturalStop !== null, 'each click has a real scheduled start/end');
    }
});

t('the clicks land inside the pre-roll window [wall−preRoll, wall)', () => {
    const ctx = setup();
    startPlayback();
    const preRoll = 2.0;                                    // one 4/4 bar @ 120
    assert.ok(Math.abs(S.playStartWall - (CTX_NOW + preRoll)) < 1e-9, `wall pinned into the future (${S.playStartWall})`);
    const starts = ctx.oscillators.map((o) => o.started).sort((a, b) => a - b);
    assert.deepStrictEqual(starts, [100, 100.5, 101, 101.5], 'clicks at the four count beats');
    for (const s of starts) assert.ok(s >= CTX_NOW && s < S.playStartWall, `click ${s} sits in the pre-roll`);
});

t('recorder clamp: pre-roll input clamps to playStartTime, post-start passes through', () => {
    const clamp = (wall, start, now) => Math.max(start, _transportChartTimePure(start, wall, now));
    // Recording from mid-song (cursor at 3.0 s) with a 2 s pre-roll: wall = now+2.
    const start = 3.0, wall = 100 + 2.0;
    // Mid pre-roll (now=100.5): raw chart time is < start; the clamp holds it at start.
    assert.strictEqual(clamp(wall, start, 100.5), start, 'no pre-region note time');
    assert.strictEqual(clamp(wall, start, 101.9), start, 'still clamped near the end of the count');
    // After the pre-roll (now=103): a genuine +1 s into the take, unclamped.
    assert.ok(Math.abs(clamp(wall, start, 103.0) - 4.0) < 1e-9, 'post-start note keeps its real time');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
