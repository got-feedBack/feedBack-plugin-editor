/*
 * Audition speed (P2-9) — the transport clock's rate factor and its inverse.
 *
 * Pitch-preserving slow practice needs the chart clock to advance at `rate`
 * against the wall clock, and the guide/metronome scheduler to use the exact
 * inverse so events still land where they should in the slowed signal. Both
 * default to rate 1 (bit-identical to pre-audition). These pin:
 *   1. _transportChartTimePure with the rate factor (fails on main: 4th arg
 *      ignored → returns the rate-1 value).
 *   2. rate 1 is unchanged (the default path).
 *   3. the scheduler↔clock inverse round-trips at rate 0.5 (identity).
 *   4. output-latency compensation is a chart-time offset of latency·rate (the
 *      paint-only marker shift), expressed through the same pure clock.
 *
 * Run: node --test tests/audition_clock.test.mjs
 */
import assert from 'node:assert';
import fs from 'node:fs';

globalThis.document = globalThis.document || { getElementById: () => null, addEventListener: () => {}, activeElement: null };
globalThis.localStorage = globalThis.localStorage || { getItem: () => null, setItem: () => {} };
globalThis.window = globalThis.window || globalThis;

const { _cursorDrawTimePure, _transportChartTimePure } = await import('../src/transport.js');
const { _guideChartToCtxPure } = await import('../src/audio.js');

let pass = 0, fail = 0;
function t(name, fn) {
    try { fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}
const near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

// ── 1. the rate factor (fails on main) ───────────────────────────────────────
t('chart time advances at `rate` against the wall clock', () => {
    // 1s of wall time (100→101) at 0.5× = 0.5s of chart time. On main the 4th
    // arg is ignored and this returns 1.0.
    assert.ok(near(_transportChartTimePure(0, 100, 101, 0.5), 0.5));
    assert.ok(near(_transportChartTimePure(0, 100, 101, 0.75), 0.75));
    assert.ok(near(_transportChartTimePure(2, 100, 104, 0.5), 4), 'start offset + 4s wall × 0.5 = 2+2');
});

// ── 2. rate 1 default is unchanged ───────────────────────────────────────────
t('rate defaults to 1 and is bit-identical to the pre-audition formula', () => {
    assert.ok(near(_transportChartTimePure(0, 100, 101), 1), 'no 4th arg → rate 1');
    assert.ok(near(_transportChartTimePure(0, 100, 101, 1), 1));
    // a non-positive / non-finite rate is treated as 1 (never runs backward / to 0)
    assert.ok(near(_transportChartTimePure(0, 100, 101, 0), 1));
    assert.ok(near(_transportChartTimePure(0, 100, 101, -0.5), 1));
    assert.ok(near(_transportChartTimePure(0, 100, 101, NaN), 1));
});

// ── 3. scheduler ↔ clock inverse round-trips ─────────────────────────────────
t('_guideChartToCtxPure is the exact inverse of _transportChartTimePure at any rate', () => {
    for (const rate of [1, 0.75, 0.5]) {
        const start = 3, wall = 50;
        for (const ctxNow of [50, 52.3, 61]) {
            const chart = _transportChartTimePure(start, wall, ctxNow, rate);
            const backToCtx = _guideChartToCtxPure(chart, wall, start, rate);
            assert.ok(near(backToCtx, ctxNow), `round-trip @${rate} ctx=${ctxNow} → ${backToCtx}`);
        }
    }
});

t('a chart event maps to a LATER wall time when slowed (guide stays aligned)', () => {
    // At 0.5×, a chart event 1s ahead of the anchor sounds 2s of wall time later.
    assert.ok(near(_guideChartToCtxPure(1, 100, 0, 0.5), 102));
    assert.ok(near(_guideChartToCtxPure(1, 100, 0, 1), 101), 'rate 1 unchanged');
});

// ── 4. output-latency compensation is a paint-only chart-time offset ──────────
t('subtracting output latency from ctxNow shifts the drawn marker by latency·rate', () => {
    const lat = 0.02;   // 20ms output latency
    for (const rate of [1, 0.5]) {
        const raw = _transportChartTimePure(0, 100, 101, rate);
        const comp = _transportChartTimePure(0, 100, 101 - lat, rate);
        assert.ok(near(raw - comp, lat * rate),
            `marker sits ${lat * rate}s earlier in chart time @${rate}× (matches what's heard)`);
    }
});

// ── 5. the PAINT clock is clamped at the start position (review fixes) ───────
// The first cut inlined the compensated marker as Math.max(0, chartTime(ctxNow −
// latency)). A count-in pre-roll parks the anchor in the FUTURE, so that formula
// drags the drawn playhead backwards by preRoll·rate and sweeps it in while the
// count clicks play — the logical cursor is clamped at playStartTime, the drawn
// one was not. _cursorDrawTimePure clamps both the same way.
t('_cursorDrawTimePure never paints behind the start position (count-in pre-roll)', () => {
    // 2s count-in: anchor at wall 102, chart 30. One frame in, ctxNow = 100.5.
    // Un-clamped this reads 30 + (100.5 − 0.02 − 102) = 28.48 — a marker 1.5s
    // BEHIND the start, sweeping forward over silence.
    assert.ok(near(_cursorDrawTimePure(30, 102, 100.5, 0.02, 1), 30), 'pre-roll: pinned at the start');
    assert.ok(near(_cursorDrawTimePure(30, 102, 100.5, 0.02, 0.5), 30), 'pre-roll @0.5x: pinned too');
    // Same at the very first frame of a no-count-in start: latency alone must not
    // push the marker before the start (Math.max(0, …) would have let it, at t>0).
    assert.ok(near(_cursorDrawTimePure(30, 100, 100, 0.02, 1), 30));
});

t('_cursorDrawTimePure compensates by latency·rate once playing, and guards junk latency', () => {
    // 1s in at 1x with 20ms of output latency: the ear is at 0.98.
    assert.ok(near(_cursorDrawTimePure(0, 100, 101, 0.02, 1), 0.98));
    // At 0.5x the chart offset is half the wall latency.
    assert.ok(near(_cursorDrawTimePure(0, 100, 101, 0.02, 0.5), 0.49));
    // Firefox reports no outputLatency; 0 / undefined / NaN ⇒ no compensation,
    // never an NaN marker (drawCursor would hand NaN to timeToX).
    for (const junk of [0, undefined, NaN, -1, 'x']) {
        assert.ok(near(_cursorDrawTimePure(0, 100, 101, junk, 1), 1), `latency ${junk} ⇒ uncompensated`);
    }
});

// ── 6. the reference MediaElement: cancel, src memo, and the silent-audition
//       fallback. Sliced out of src/audio.js and run against fakes (the repo's
//       compose_transport pattern) — no audio graph is faked, only the seams.
const audioSrc = fs.readFileSync(new URL('../src/audio.js', import.meta.url), 'utf8');
function extractFn(name) {
    const start = audioSrc.indexOf('function ' + name + '(');
    assert.ok(start >= 0, `function ${name} must exist`);
    const open = audioSrc.indexOf('{', start);
    let d = 0;
    for (let i = open; i < audioSrc.length; i++) {
        if (audioSrc[i] === '{') d++;
        else if (audioSrc[i] === '}' && --d === 0) return audioSrc.slice(start, i + 1);
    }
    throw new Error('unbalanced braces extracting ' + name);
}

// Fake timers, so a cancelled start can be proven to never fire.
function fakeTimers() {
    const q = new Map();
    let id = 0;
    return {
        setTimeout: (fn) => { q.set(++id, fn); return id; },
        clearTimeout: (i) => { q.delete(i); },
        fire: () => { const fns = [...q.values()]; q.clear(); for (const fn of fns) fn(); },
        pending: () => q.size,
    };
}
// A media element whose `src` GETTER echoes a resolved absolute URL — exactly what
// a real HTMLMediaElement does with the relative audio_url the server hands us.
function fakeEl() {
    return {
        loads: 0, played: 0, paused: true, currentTime: 0, playbackRate: 1, _src: '',
        set src(v) { this._src = v; this.loads++; },
        get src() { return 'http://localhost:8000' + this._src; },
        play() { this.played++; this.paused = false; },
        pause() { this.paused = true; },
    };
}

t('_stopRefMedia cancels a deferred start — a stop/teardown can never resume audio', () => {
    const el = fakeEl();
    const T = fakeTimers();
    const m = new Function('_el', '_ensureRefMedia', '_auditionRate', 'setTimeout', 'clearTimeout',
        'let _refMediaEl = _el;\nlet _refMediaPlayTimer = null;\n'
        + extractFn('_stopRefMedia') + '\n' + extractFn('_startRefMediaAt')
        + '\nreturn { start: _startRefMediaAt, stop: _stopRefMedia };'
    )(el, () => el, () => 0.5, T.setTimeout, T.clearTimeout);

    // Count-in (preRoll 2s) defers the play() — ordinary usage, not an edge case.
    assert.strictEqual(m.start({ play: true, offset: 5, delay: 0 }, 2), true);
    assert.strictEqual(el.played, 0, 'deferred: nothing sounds yet');
    assert.strictEqual(T.pending(), 1);
    m.stop();                       // user hits stop during the count-in
    assert.strictEqual(T.pending(), 0, 'the queued play() is cancelled, not just paused');
    T.fire();
    assert.strictEqual(el.played, 0, 'a stopped transport stays silent');

    // A re-start must also supersede its own pending timer (no double play()).
    m.start({ play: true, offset: 5, delay: 0 }, 2);
    m.start({ play: true, offset: 9, delay: 0 }, 2);
    assert.strictEqual(T.pending(), 1, 'the second start replaces the first pending timer');
    T.fire();
    assert.strictEqual(el.played, 1);
    assert.ok(near(el.playbackRate, 0.5), 'the element carries the audition rate');
    assert.ok(near(el.currentTime, 9), 'seated at the SOURCE offset for the cursor');
});

t('_ensureRefMedia memoises the ASSIGNED src — a relative url must not reload the element', () => {
    const el = fakeEl();
    const S = { audioCtx: { createMediaElementSource: () => ({ connect() {} }) }, audioUrl: '/api/audio/x.wav' };
    const m = new Function('S', '_el', 'Audio', '_ensureRefGain',
        'let _refMediaEl = null;\nlet _refMediaNode = null;\nlet _refMediaSrc = null;\n'
        + extractFn('_ensureRefMedia') + '\nreturn _ensureRefMedia;'
    )(S, el, function () { return el; }, () => null);

    assert.strictEqual(m(), el);
    assert.strictEqual(el.loads, 1, 'src assigned once');
    m(); m(); m();
    // el.src echoes 'http://localhost:8000/api/audio/x.wav', which never equals the
    // relative S.audioUrl — comparing against the GETTER re-assigned src (and so
    // reloaded + restarted the element) on every seek and every loop wrap.
    assert.strictEqual(el.loads, 1, 'no reload while the url is unchanged');
    S.audioUrl = '/api/audio/y.wav';
    m();
    assert.strictEqual(el.loads, 2, 'a genuinely new recording does re-src');
});

t('a failed slow path DEMOTES to 100% and plays the buffer — never silence under a slow clock', () => {
    // _startRefMediaAt returns false whenever the MediaElement route is unavailable
    // (no Audio ctor, or the ctx refuses a MediaElementSource on CORS-tainted media).
    // The first cut discarded that return AFTER stopping the BufferSource: dead
    // silence, while the transport clock still crawled at 0.5x.
    const status = [];
    const S = {
        cursorTime: 5, audioShift: 0, auditionRate: 0.5, audioUrl: '/a.wav',
        audioBuffer: { duration: 60 }, audioSource: null,
        audioCtx: { currentTime: 0, createBufferSource: () => ({ connect() {}, start() {} }) },
    };
    const run = new Function('S', '_audioBufferStartPure', '_auditionActive', '_startRefMediaAt',
        '_mixApplyFirstPlayFade', '_stopRefMedia', '_auditionRefreshUi', 'setStatus',
        '_ensureRefGain', '_anchorTransportAtCursor', '_stopStemSources', '_startStemSources',
        extractFn('_startAudioSourceAtCursor') + '\nreturn _startAudioSourceAtCursor;'
    )(S,
        () => ({ play: true, offset: 5, delay: 0 }),
        () => Number(S.auditionRate) < 1,
        () => false,                       // the slow path is unavailable
        () => {}, () => {}, () => {}, (m) => status.push(m), () => null, () => {},
        () => {}, () => 0);                // stem scheduler stubs (no stems here)

    run(0);
    assert.strictEqual(S.auditionRate, 1, 'demoted to full speed so the clock matches the audio');
    assert.ok(S.audioSource, 'the BufferSource took over — the recording is audible');
    assert.ok(status.some(m => /unavailable/i.test(m)), 'and the user is told why');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
