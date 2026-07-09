'use strict';
/*
 * Tests for the loop snap modes (@pure:loop-region block): the mode-aware
 * region resolver `_loopRegionForDragPure` and edge adjuster
 * `_loopEdgeAdjustPure` behind the Bar / Grid / Free loop control (D16/D17).
 *
 * Previously the loop region was BAR-SNAPPED ONLY and looping was disabled
 * entirely on a chart with no downbeats — the exact starting state of an
 * un-gridded drifting-tempo song. Now:
 *   - 'bar'  → whole-downbeat spans (unchanged legacy behavior), degrading
 *              to free when there are no downbeats;
 *   - 'grid' → edges run through the supplied snap fn (the editor passes
 *              snapTime, which already returns raw time when snap is off);
 *   - 'free' → raw times, normalized only.
 * Regions carry `mode` so tempo-map edits can relock bar/grid loops while
 * never moving a freely drawn one.
 *
 * Run: node tests/loop_snap_modes.test.js
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
const m = src.match(/\/\* @pure:loop-region:start \*\/[\s\S]*?\/\* @pure:loop-region:end \*\//);
if (!m) {
    console.error('FAIL: @pure:loop-region block not found in screen.js');
    process.exit(1);
}

const api = new Function(
    '"use strict";' + m[0]
    + '\nreturn { _loopRegionForDragPure, _loopEdgeAdjustPure, _normalizeLoopRegionPure };'
)();
const { _loopRegionForDragPure, _loopEdgeAdjustPure } = api;

let pass = 0, fail = 0;
function t(name, fn) {
    try { fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}

const DOWNBEATS = [0, 2, 4, 6, 8];          // 2 s bars
const DUR = 10;
const snapQuarter = (t) => Math.round(t * 2) / 2;   // fake 0.5 s grid

// ── create: bar mode (legacy behavior preserved) ─────────────────────────────
t('bar mode: drag snaps to whole-downbeat spans and stamps mode', () => {
    const r = _loopRegionForDragPure('bar', 2.3, 5.1, DOWNBEATS, DUR, snapQuarter);
    assert.deepStrictEqual(
        { s: r.startTime, e: r.endTime, m: r.mode },
        { s: 2, e: 6, m: 'bar' });
});

t('bar mode with NO downbeats degrades to free instead of failing', () => {
    const r = _loopRegionForDragPure('bar', 1.23, 4.56, [], DUR, snapQuarter);
    assert.deepStrictEqual(
        { s: r.startTime, e: r.endTime, m: r.mode },
        { s: 1.23, e: 4.56, m: 'bar' });
});

// ── create: grid + free ──────────────────────────────────────────────────────
t('grid mode: edges run through the snap fn', () => {
    const r = _loopRegionForDragPure('grid', 1.13, 3.62, DOWNBEATS, DUR, snapQuarter);
    assert.deepStrictEqual({ s: r.startTime, e: r.endTime, m: r.mode },
        { s: 1.0, e: 3.5, m: 'grid' });
});

t('free mode: raw times, order fixed by normalize', () => {
    const r = _loopRegionForDragPure('free', 4.71, 1.28, DOWNBEATS, DUR, snapQuarter);
    assert.deepStrictEqual({ s: r.startTime, e: r.endTime, m: r.mode },
        { s: 1.28, e: 4.71, m: 'free' });
});

t('zero-width drags produce no region in grid/free (drag to widen)', () => {
    assert.strictEqual(_loopRegionForDragPure('free', 3.0, 3.0, DOWNBEATS, DUR, snapQuarter), null);
    assert.strictEqual(_loopRegionForDragPure('grid', 3.1, 3.2, DOWNBEATS, DUR, () => 3.0), null);
});

t('durations clamp: free region cannot extend past the song end', () => {
    const r = _loopRegionForDragPure('free', 8.5, 42.0, DOWNBEATS, DUR, snapQuarter);
    assert.strictEqual(r.endTime, DUR);
});

// ── edge adjust ──────────────────────────────────────────────────────────────
t('bar edge adjust: delegates to the legacy whole-bar adjuster', () => {
    const region = { startTime: 2, endTime: 6, mode: 'bar' };
    const r = _loopEdgeAdjustPure('bar', region, 'start', 0.4, DOWNBEATS, DUR, snapQuarter);
    assert.deepStrictEqual({ s: r.startTime, e: r.endTime, m: r.mode },
        { s: 0, e: 6, m: 'bar' });
});

t('free edge adjust: unsnapped, and an edge cannot cross its partner', () => {
    const region = { startTime: 1.28, endTime: 4.71, mode: 'free' };
    const r1 = _loopEdgeAdjustPure('free', region, 'end', 3.333, DOWNBEATS, DUR, snapQuarter);
    assert.strictEqual(r1.endTime, 3.333);
    const r2 = _loopEdgeAdjustPure('free', r1, 'start', 9.0, DOWNBEATS, DUR, snapQuarter);
    assert.ok(r2.startTime < r2.endTime, 'start clamped below end');
});

t('grid edge adjust snaps the moved edge only', () => {
    const region = { startTime: 1.0, endTime: 3.5, mode: 'grid' };
    const r = _loopEdgeAdjustPure('grid', region, 'end', 4.86, DOWNBEATS, DUR, snapQuarter);
    assert.deepStrictEqual({ s: r.startTime, e: r.endTime }, { s: 1.0, e: 5.0 });
});

t('mid-drag mode switch restamps the region mode (Shift = temporary free)', () => {
    const region = { startTime: 2, endTime: 6, mode: 'bar' };
    const r = _loopEdgeAdjustPure('free', region, 'end', 5.123, DOWNBEATS, DUR, snapQuarter);
    assert.strictEqual(r.endTime, 5.123);
    assert.strictEqual(r.mode, 'free');
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
