'use strict';
/*
 * Tests for the guide-clap scheduler's pure core (@pure:guide-clap block):
 * the half-open window query that picks which charted events to schedule
 * each lookahead tick, and the chart-seconds → AudioContext-time mapping.
 *
 * The editor previously had zero note sonification — you could not verify
 * note placement by ear. Claps are scheduled by a setInterval lookahead loop
 * off the transport anchor (S.playStartWall / S.playStartTime); these tests
 * pin the window semantics that loop relies on:
 *   - half-open [from, to): an event exactly at the cursor claps, an event
 *     exactly at the window end waits for the next tick (never double-fires);
 *   - chord stacks (several notes at one timestamp) dedupe to ONE clap so
 *     simultaneous voices can't sum into a louder transient;
 *   - binary-search correctness so dense charts don't degrade the tick.
 *
 * screen.js is a single browser IIFE, so this extracts the marked
 * `@pure:guide-clap` block (browser-free) and eval's it in isolation —
 * real source, no drift.
 *
 * Run: node tests/guide_clap.test.js
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const src = fs.readFileSync(path.join(__dirname, '..', 'screen.js'), 'utf8');
const m = src.match(/\/\* @pure:guide-clap:start \*\/[\s\S]*?\/\* @pure:guide-clap:end \*\//);
if (!m) {
    console.error('FAIL: @pure:guide-clap block not found in screen.js');
    process.exit(1);
}

const {
    _guideClapTimesInWindowPure,
    _guideChartToCtxPure,
    _guideSanitizeTimesPure,
    _guideWindowEndPure,
} = new Function(
    '"use strict";' + m[0]
    + '\nreturn { _guideClapTimesInWindowPure, _guideChartToCtxPure,'
    + ' _guideSanitizeTimesPure, _guideWindowEndPure };'
)();

let pass = 0, fail = 0;
function t(name, fn) {
    try { fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}

// ── window semantics ─────────────────────────────────────────────────────────
t('returns only events inside [from, to)', () => {
    const times = [0.5, 1.0, 1.5, 2.0, 2.5];
    assert.deepStrictEqual(_guideClapTimesInWindowPure(times, 1.0, 2.0), [1.0, 1.5]);
});

t('half-open: event at `from` claps, event at `to` waits for the next window', () => {
    const times = [1.0, 2.0];
    assert.deepStrictEqual(_guideClapTimesInWindowPure(times, 1.0, 2.0), [1.0]);
    // The next tick's window starts where this one ended — 2.0 fires exactly once.
    assert.deepStrictEqual(_guideClapTimesInWindowPure(times, 2.0, 3.0), [2.0]);
});

t('adjacent windows never double-fire an event', () => {
    const times = [0.0, 0.06, 0.12, 0.18, 0.24];
    const a = _guideClapTimesInWindowPure(times, 0.0, 0.12);
    const b = _guideClapTimesInWindowPure(times, 0.12, 0.24);
    const c = _guideClapTimesInWindowPure(times, 0.24, 0.36);
    assert.deepStrictEqual([...a, ...b, ...c], times, 'each event exactly once');
});

// ── chord-stack dedupe ───────────────────────────────────────────────────────
t('chord stack (same timestamp) claps once', () => {
    const times = [1.0, 1.0, 1.0, 2.0];  // 3-note chord + a single
    assert.deepStrictEqual(_guideClapTimesInWindowPure(times, 0.0, 3.0), [1.0, 2.0]);
});

t('sub-millisecond spread still dedupes; >1 ms apart stays separate', () => {
    const chord = [1.0, 1.0004];        // same 1 ms bucket
    assert.strictEqual(_guideClapTimesInWindowPure(chord, 0.0, 2.0).length, 1);
    const flam = [1.0, 1.03];           // a drum flam must keep both hits
    assert.strictEqual(_guideClapTimesInWindowPure(flam, 0.0, 2.0).length, 2);
});

// ── degenerate inputs ────────────────────────────────────────────────────────
t('empty / non-array / inverted windows return []', () => {
    assert.deepStrictEqual(_guideClapTimesInWindowPure([], 0, 1), []);
    assert.deepStrictEqual(_guideClapTimesInWindowPure(null, 0, 1), []);
    assert.deepStrictEqual(_guideClapTimesInWindowPure([1.0], 2, 1), []);
    assert.deepStrictEqual(_guideClapTimesInWindowPure([1.0], 1, 1), []);
});

t('binary search stays correct on a dense chart', () => {
    const times = [];
    for (let i = 0; i < 10000; i++) times.push(i * 0.05);   // 500 s of 16ths
    // Compare against the source values (i*0.05 carries float error, e.g.
    // 5002*0.05 = 250.10000000000002 — the window math must not "fix" that).
    const out = _guideClapTimesInWindowPure(times, times[5000], times[5000] + 0.12);
    assert.deepStrictEqual(out, [times[5000], times[5001], times[5002]]);
});

// ── input sanitizing (unsorted / NaN times) ──────────────────────────────────
// _guideSourceTimes feeds raw note/hit times through _guideSanitizeTimesPure
// before the window query. A stray NaN would reach osc.start(NaN) and throw
// inside the tick (killing clap scheduling); an unsorted array would make the
// early-terminating window scan drop claps.
t('sanitize drops non-finite times and sorts ascending', () => {
    const raw = [2.0, NaN, 0.5, undefined, 1.5, Infinity, null, 1.0];
    assert.deepStrictEqual(_guideSanitizeTimesPure(raw), [0.5, 1.0, 1.5, 2.0]);
});

t('non-array input sanitizes to []', () => {
    assert.deepStrictEqual(_guideSanitizeTimesPure(null), []);
    assert.deepStrictEqual(_guideSanitizeTimesPure(undefined), []);
});

t('sanitized unsorted+NaN chart still yields the right window claps', () => {
    // Simulates a chart whose note times arrive unsorted with a NaN mixed in.
    const raw = [2.5, NaN, 1.0, 0.5, 2.0, 1.5];
    const clean = _guideSanitizeTimesPure(raw);
    // Without the sort, the binary-search window scan below would terminate
    // early and miss events; without the NaN drop, the tick would throw.
    assert.deepStrictEqual(_guideClapTimesInWindowPure(clean, 1.0, 2.0), [1.0, 1.5]);
});

// ── loop-end window clamp (ghost-clap guard) ─────────────────────────────────
t('window end is clamped to the loop end while looping', () => {
    // 120 ms lookahead would reach past the loop end at 2.0 — clamp it.
    assert.strictEqual(_guideWindowEndPure(1.9 + 0.12, true, 2.0), 2.0);
    // Lookahead entirely inside the loop is left untouched.
    assert.strictEqual(_guideWindowEndPure(1.5, true, 2.0), 1.5);
});

t('window end is untouched when not looping or loop end is unknown', () => {
    assert.strictEqual(_guideWindowEndPure(2.02, false, 2.0), 2.02);
    assert.strictEqual(_guideWindowEndPure(2.02, true, NaN), 2.02);
});

t('clamped window schedules no clap past the loop boundary', () => {
    const times = [1.8, 1.95, 2.05, 2.2];   // last two are past the loop end
    const rawTo = 1.9 + 0.12;                // 2.02 — would include 2.05
    const to = _guideWindowEndPure(rawTo, true, 2.0);
    assert.deepStrictEqual(_guideClapTimesInWindowPure(times, 1.9, to), [1.95]);
});

// ── transport mapping ────────────────────────────────────────────────────────
t('chart time maps onto the AudioContext clock via the transport anchor', () => {
    // Audio started at ctx-time 10.0 with the cursor at chart-time 30.0:
    // a note at chart 31.5 must fire at ctx 11.5.
    assert.strictEqual(_guideChartToCtxPure(31.5, 10.0, 30.0), 11.5);
    // Playback from the song start: chart == ctx offset by the start wall.
    assert.strictEqual(_guideChartToCtxPure(0.0, 3.25, 0.0), 3.25);
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
