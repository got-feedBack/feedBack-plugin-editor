'use strict';
/*
 * Buffer-less (compose-mode) transport — Phase A3 (charrette §1.7).
 *
 * Before A3, startPlayback() early-returned without S.audioBuffer, so a no-audio
 * compose session had no clock, no metronome, no guide. A3 gives compose mode a
 * transport that advances cursorTime off the AudioContext clock with no
 * BufferSource, the grid (not a buffer) bounding the song, and the already
 * ctx-time-based guide/click scheduler as the only sound.
 *
 * This suite proves:
 *   1. _transportChartTimePure — the ONE clock-advance formula (now shared by
 *      playbackTick, the guide scheduler, and the record clock).
 *   2. _composeSongDurationPure — grid-defined length: user length wins, else
 *      max(grid end, content end), guarded on junk input.
 *   3. _composeSongDuration (live) — resolves duration from the grid via the A1
 *      converter with NO audio buffer, extends past the grid for late content,
 *      and honours an explicit S.composeLength.
 *   4. _anchorTransportAtCursor + the clock advance the cursor with audioBuffer
 *      = null (the core A3 claim: playback advances with no buffer present).
 *   5. the guide/metronome scheduler is buffer-independent — _guideResetSchedule
 *      seeds the watermark from cursorTime alone, and _guideTick gates on
 *      S.audioCtx, never S.audioBuffer (so it fires off the grid with no audio).
 *
 * Everything here references A3 symbols (@pure:transport, _anchorTransportAtCursor,
 * _composeSongDuration) that do not exist on origin/main, so the whole suite
 * fails on main — a would-fail-on-main test.
 *
 * Run: node tests/compose_transport.test.js
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const src = fs.readFileSync(path.join(__dirname, '..', 'screen.js'), 'utf8');

function extractBlock(name) {
    const m = src.match(new RegExp('/\\* @pure:' + name + ':start \\*/[\\s\\S]*?/\\* @pure:' + name + ':end \\*/'));
    if (!m) { console.error('FAIL: @pure:' + name + ' block not found'); process.exit(1); }
    return m[0];
}
function extractFn(name) {
    const start = src.indexOf('function ' + name + '(');
    assert.ok(start >= 0, `function ${name} must exist (absent on main ⇒ A3 not applied)`);
    const open = src.indexOf('{', start);
    let d = 0;
    for (let i = open; i < src.length; i++) {
        if (src[i] === '{') d++;
        else if (src[i] === '}' && --d === 0) return src.slice(start, i + 1);
    }
    throw new Error(`unbalanced braces extracting ${name}`);
}

// The A3 pures + the A1 converter (timeOf) in one sandbox.
const pures = new Function('"use strict";'
    + extractBlock('transport') + '\n' + extractBlock('beat-converter')
    + '\nreturn { _transportChartTimePure, _composeSongDurationPure, timeOf, beatOf };')();
const { _transportChartTimePure, _composeSongDurationPure, timeOf } = pures;

// Live _composeSongDuration with real timeOf + a stubbed guide source (so we
// exercise the actual grid→seconds resolution, not a copy).
function makeComposeDuration(S, guideTimes) {
    return new Function('S', 'timeOf', '_guideSourceTimes', '_composeSongDurationPure',
        extractFn('_composeSongDuration') + '\nreturn _composeSongDuration;'
    )(S, timeOf, () => (guideTimes || []).slice(), _composeSongDurationPure);
}

// _anchorTransportAtCursor with an injected _guideResetSchedule spy.
function makeAnchor(S, onReset) {
    return new Function('S', '_guideResetSchedule',
        extractFn('_anchorTransportAtCursor') + '\nreturn _anchorTransportAtCursor;'
    )(S, onReset);
}

// _guideResetSchedule run against a stub, returning the module lets it sets.
function runGuideReset(cursorTime) {
    return new Function('S', '_guideCancelVoices',
        'let _guideScheduledUntil = -999; let _guideLastFiredKey = "stale";'
        + extractFn('_guideResetSchedule')
        + '\n_guideResetSchedule(); return { _guideScheduledUntil, _guideLastFiredKey };'
    )({ cursorTime }, () => {});
}

// A drifting grid (rubato / fitted map): index i IS beat i, each gap different.
const grid = [
    { time: 0.00 }, { time: 0.50 }, { time: 1.10 }, { time: 1.55 }, { time: 2.30 },
];
const gridEnd = grid[grid.length - 1].time; // 2.30 = timeOf(lastBeat)

let pass = 0, fail = 0;
function t(name, fn) {
    try { fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.log('  FAIL ' + name + '\n    ' + (e && e.message)); }
}
const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} !≈ ${b}`);

// ── 1. clock advance ────────────────────────────────────────────────────────
t('_transportChartTimePure advances cursor by elapsed ctx time', () => {
    // started at chart 2.0s, wall-anchored at ctx 10.0s; now ctx 13.5s ⇒ 5.5s.
    close(_transportChartTimePure(2.0, 10.0, 13.5), 5.5);
});
t('_transportChartTimePure is stationary at the anchor instant', () => {
    close(_transportChartTimePure(4.2, 100.0, 100.0), 4.2);
});
t('_transportChartTimePure is monotonic in ctx time', () => {
    let prev = -Infinity;
    for (let now = 50; now <= 60; now += 0.25) {
        const c = _transportChartTimePure(0, 50, now);
        assert.ok(c > prev, 'cursor must advance as the ctx clock advances');
        prev = c;
    }
    close(_transportChartTimePure(0, 50, 60), 10);
});

// ── 2. compose duration (pure) ──────────────────────────────────────────────
t('_composeSongDurationPure: an explicit user length wins', () => {
    assert.strictEqual(_composeSongDurationPure(2.30, 9.9, 7.5), 7.5);
});
t('_composeSongDurationPure: no user length ⇒ max(grid end, content end)', () => {
    assert.strictEqual(_composeSongDurationPure(2.30, 1.0, NaN), 2.30);  // grid past content
    assert.strictEqual(_composeSongDurationPure(2.30, 4.0, NaN), 4.0);   // content past grid
});
t('_composeSongDurationPure: junk inputs collapse to 0 (never NaN/negative)', () => {
    assert.strictEqual(_composeSongDurationPure(NaN, NaN, NaN), 0);
    assert.strictEqual(_composeSongDurationPure(-3, -1, NaN), 0);
    assert.strictEqual(_composeSongDurationPure(Infinity, 0, NaN), 0);   // non-finite grid ignored
    assert.strictEqual(_composeSongDurationPure(0, 0, 0), 0);            // userLen 0 is not "set"
});

// ── 3. compose duration (live, no buffer) ───────────────────────────────────
t('_composeSongDuration derives length from the GRID with no audio buffer', () => {
    const S = { audioBuffer: null, beats: grid };
    const dur = makeComposeDuration(S, [0.5, 1.1])();          // content ends inside the grid
    close(dur, gridEnd);                                        // = timeOf(lastBeat)
});
t('_composeSongDuration extends past the grid for late content', () => {
    const S = { audioBuffer: null, beats: grid };
    const dur = makeComposeDuration(S, [1.0, 3.9])();           // a note past the last bar
    close(dur, 3.9);
});
t('_composeSongDuration honours an explicit S.composeLength', () => {
    const S = { audioBuffer: null, beats: grid, composeLength: 12.0 };
    const dur = makeComposeDuration(S, [1.0, 3.9])();
    close(dur, 12.0);
});
t('_composeSongDuration on a degenerate (<2-beat) grid with no content is 0', () => {
    const S = { audioBuffer: null, beats: [{ time: 0 }] };
    assert.strictEqual(makeComposeDuration(S, [])(), 0);       // nothing to play ⇒ startPlayback bails
});

// ── 4. buffer-less transport advances the cursor ────────────────────────────
t('_anchorTransportAtCursor pins the anchor from the cursor (no source needed)', () => {
    let resetCalls = 0;
    const S = { audioBuffer: null, audioSource: null,
        audioCtx: { currentTime: 100 }, cursorTime: 4, playStartWall: 0, playStartTime: 0 };
    makeAnchor(S, () => { resetCalls++; })();
    assert.strictEqual(S.playStartWall, 100, 'wall anchored to ctx.currentTime');
    assert.strictEqual(S.playStartTime, 4, 'chart anchored to cursorTime');
    assert.strictEqual(resetCalls, 1, 'guide schedule reset on (re)start');
    assert.strictEqual(S.audioSource, null, 'no BufferSource created in compose mode');
});
t('playback advances cursorTime with NO buffer present (the A3 claim)', () => {
    const S = { audioBuffer: null, audioSource: null,
        audioCtx: { currentTime: 100 }, cursorTime: 4, playStartWall: 0, playStartTime: 0 };
    makeAnchor(S, () => {})();
    // ctx clock advances 2.5s while playing…
    S.audioCtx.currentTime = 102.5;
    const cursor = _transportChartTimePure(S.playStartTime, S.playStartWall, S.audioCtx.currentTime);
    close(cursor, 6.5);                                         // 4 + (102.5 − 100)
    assert.ok(cursor > 4, 'cursor moved forward with no audioBuffer');
});

// ── 5. guide/metronome scheduler is buffer-independent ──────────────────────
t('_guideResetSchedule seeds the watermark from cursorTime alone', () => {
    const r = runGuideReset(7.25);
    close(r._guideScheduledUntil, 7.25);                       // no buffer read
    assert.strictEqual(r._guideLastFiredKey, null);            // dedupe continuity broken on (re)start
});
t('_guideResetSchedule floors a falsy cursor to 0', () => {
    assert.strictEqual(runGuideReset(0)._guideScheduledUntil, 0);
    assert.strictEqual(runGuideReset(undefined)._guideScheduledUntil, 0);
});
t('_guideTick gates on S.audioCtx and NEVER requires S.audioBuffer', () => {
    const body = extractFn('_guideTick');
    assert.ok(/S\.audioCtx/.test(body), 'guide tick must gate on the audio context');
    assert.ok(!/S\.audioBuffer/.test(body),
        'guide tick must not require an audio buffer — it is the sound source in compose mode');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
