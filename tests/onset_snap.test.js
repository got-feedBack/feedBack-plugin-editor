'use strict';
/*
 * Onset-snap tests (Phase D1 — the bridge between musical time and audio time).
 *
 * Two seams under test:
 *   1. @pure:onset-snap block — _nearestOnsetTimePure(onsets, t, tol): the
 *      nearest detected transient within a tolerance window, or null so the
 *      caller falls back to grid snap. Binary search over sorted onsets.
 *   2. snapTime() routing (extracted by name, deps injected): when snap is on
 *      and S.snapMode === 'onset', placement snaps to the onset; otherwise (or
 *      when no onset is near / none computed / snap off) it snaps to the grid.
 *
 * Both would FAIL on main: the @pure block does not exist there, and main's
 * snapTime has no onset branch (onset mode would return the grid value).
 *
 * Run: node tests/onset_snap.test.js
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

// @pure:onset-snap moved to src/audio.js; snapTime moved to src/loop.js.
const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'audio.js'), 'utf8');
const mainSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'loop.js'), 'utf8');

const _m0 = src.match(/\/\* @pure:onset-snap:start \*\/[\s\S]*?\/\* @pure:onset-snap:end \*\//);
if (!_m0) {
    console.error('FAIL: @pure:onset-snap block not found in src/audio.js');
    process.exit(1);
}
const m = [_m0[0].replace(/^export\s+/gm, '')];
const { _nearestOnsetTimePure } = new Function(
    '"use strict";' + m[0] + '\nreturn { _nearestOnsetTimePure };'
)();

// Extract snapTime (moved to src/loop.js) by name (brace matching) and
// inject its free identifiers so we can drive the onset-vs-grid routing.
function extractFn(name) {
    const start = mainSrc.indexOf('function ' + name);
    assert.ok(start >= 0, `function ${name} must exist`);
    const open = mainSrc.indexOf('{', start);
    let depth = 0;
    for (let i = open; i < mainSrc.length; i++) {
        if (mainSrc[i] === '{') depth++;
        else if (mainSrc[i] === '}' && --depth === 0) return mainSrc.slice(start, i + 1).replace(/^export\s+/gm, '');
    }
    throw new Error(`unbalanced braces extracting ${name}`);
}

// A clean 0.5 s/beat grid: beatOf(t)=2t, timeOf(b)=b/2. With subs=1 that snaps
// to the nearest 0.5 s — deliberately DIFFERENT from off-grid onset times.
const S = { snapEnabled: true, snapMode: 'grid', snapIdx: 0, beats: [{ time: 0 }, { time: 0.5 }, { time: 1 }, { time: 1.5 }, { time: 2 }] };
let onsets = [];
const snapTime = new Function(
    'S', '_editorEffectiveSnapValuePure', 'SNAP_VALUES', '_editorSnapSubdivisionsPure',
    'timeOf', 'beatOf', '_ensureOnsets', '_nearestOnsetTimePure', 'ONSET_SNAP_TOL',
    '_swingQuantizeBeatPure',
    '"use strict";' + extractFn('snapTime') + '\nreturn snapTime;'
)(
    S,
    (en, sv) => (en ? sv : 0),
    [0.25],
    () => 1,
    (beats, b) => b / 2,
    (beats, t) => t * 2,
    () => onsets,
    _nearestOnsetTimePure,
    0.07,
    // Straight-path stand-in for the swing quantizer (D2): this S carries no
    // swingPct, so the real one reduces to plain rounding — swing behavior
    // has its own real-import suite (swing_snap.test.mjs).
    (beta, subs) => Math.round(beta * subs) / subs
);

let pass = 0, fail = 0;
function t(name, fn) {
    try { fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}

// ── _nearestOnsetTimePure ────────────────────────────────────────────────
t('returns the onset within tolerance', () => {
    assert.strictEqual(_nearestOnsetTimePure([{ t: 1.234 }], 1.25, 0.07), 1.234);
});

t('picks the NEAREST of several onsets', () => {
    const os = [{ t: 0.5 }, { t: 1.2 }, { t: 1.34 }, { t: 2.9 }];
    assert.strictEqual(_nearestOnsetTimePure(os, 1.29, 0.07), 1.34);
    assert.strictEqual(_nearestOnsetTimePure(os, 1.22, 0.07), 1.2);
});

t('handles t before the first and after the last onset', () => {
    const os = [{ t: 1.0 }, { t: 2.0 }, { t: 3.0 }];
    assert.strictEqual(_nearestOnsetTimePure(os, 0.97, 0.07), 1.0);   // before first
    assert.strictEqual(_nearestOnsetTimePure(os, 3.05, 0.07), 3.0);   // after last
    assert.strictEqual(_nearestOnsetTimePure(os, 3.5, 0.07), null);   // past last, out of tol
});

t('returns null just outside the tolerance window (fall back to grid)', () => {
    assert.strictEqual(_nearestOnsetTimePure([{ t: 1.0 }], 1.071, 0.07), null);
    assert.strictEqual(_nearestOnsetTimePure([{ t: 1.0 }], 1.069, 0.07), 1.0);
});

t('an off-grid transient is DIFFERENT from the nearest grid point', () => {
    // grid = nearest 0.5 s; onset = 1.234. The two placements must differ —
    // that difference is the whole point of onset-snap.
    const onset = _nearestOnsetTimePure([{ t: 1.234 }], 1.25, 0.07);
    const gridPoint = Math.round(1.25 * 2) / 2; // 1.5? no: round(2.5)=2 -> 1.0... nearest 0.5
    assert.strictEqual(onset, 1.234);
    assert.notStrictEqual(onset, gridPoint);
});

t('degrades to null when no onsets are computed', () => {
    assert.strictEqual(_nearestOnsetTimePure([], 1.0, 0.07), null);
    assert.strictEqual(_nearestOnsetTimePure(null, 1.0, 0.07), null);
    assert.strictEqual(_nearestOnsetTimePure(undefined, 1.0, 0.07), null);
});

t('adversarial: non-finite t, tol<=0, and non-finite onset times', () => {
    assert.strictEqual(_nearestOnsetTimePure([{ t: 1.0 }], NaN, 0.07), null);
    assert.strictEqual(_nearestOnsetTimePure([{ t: 1.0 }], Infinity, 0.07), null);
    assert.strictEqual(_nearestOnsetTimePure([{ t: 1.0 }], 1.0, 0), null);
    assert.strictEqual(_nearestOnsetTimePure([{ t: 1.0 }], 1.0, -1), null);
    // a garbage onset entry is skipped, a good neighbour still wins
    assert.strictEqual(_nearestOnsetTimePure([{ t: NaN }, { t: 1.0 }], 1.01, 0.07), 1.0);
});

t('exact hit returns the onset (distance 0)', () => {
    assert.strictEqual(_nearestOnsetTimePure([{ t: 2.0 }], 2.0, 0.07), 2.0);
});

// ── snapTime() routing (grid vs onset) ───────────────────────────────────
t('grid mode snaps to the grid, ignoring onsets', () => {
    S.snapMode = 'grid';
    onsets = [{ t: 1.234 }];
    assert.ok(Math.abs(snapTime(1.234) - 1.0) < 1e-9, 'grid snap → nearest 0.5 s');
});

t('onset mode snaps to a near transient (≠ the grid point)', () => {
    S.snapMode = 'onset';
    onsets = [{ t: 1.24 }];
    const r = snapTime(1.234);
    assert.strictEqual(r, 1.24, 'placed on the detected attack');
    assert.notStrictEqual(r, 1.0, 'not the grid point');
});

t('onset mode with NO nearby onset falls back to the grid', () => {
    S.snapMode = 'onset';
    onsets = [{ t: 5.0 }];
    assert.ok(Math.abs(snapTime(1.234) - 1.0) < 1e-9, 'no attack near → grid');
});

t('onset mode with NO onsets computed falls back to the grid', () => {
    S.snapMode = 'onset';
    onsets = [];
    assert.ok(Math.abs(snapTime(1.234) - 1.0) < 1e-9, 'none computed → grid');
});

t('master snap-off gates onset mode too (returns the raw time)', () => {
    S.snapMode = 'onset';
    onsets = [{ t: 1.24 }];
    S.snapEnabled = false;
    assert.strictEqual(snapTime(1.234), 1.234, 'snap off → no onset, no grid');
    S.snapEnabled = true;
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
