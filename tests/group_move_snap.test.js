'use strict';
/*
 * Group-move time snapping — tester bug: "mass moving notes seem to have a
 * limit, only a few of selected notes get moved."
 *
 * Root cause: the live move loop snapped each note's ABSOLUTE time independently
 * (snapTime(origTime + dt) per note). With snap on (the default) a small group
 * drag quantised every note to its own nearest grid line, so only notes already
 * near a line crossed it — the rest snapped back and appeared not to move, and
 * the selection's internal timing was silently destroyed.
 *
 * Fix: _groupTimeDeltaPure snaps the PRIMARY (grabbed) note's target ONCE, takes
 * that as the single group delta, applied uniformly to every selected note, and
 * clamps it so the earliest note can't cross t=0. The whole group moves rigidly,
 * snaps as a unit, and keeps its internal spacing.
 *
 * References _groupTimeDeltaPure (absent on main), so the suite fails on main.
 *
 * Run: node tests/group_move_snap.test.js
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
const m = src.match(/\/\* @pure:group-time-delta:start[\s\S]*?@pure:group-time-delta:end \*\//);
if (!m) { console.error('FAIL: @pure:group-time-delta block not found'); process.exit(1); }
const { _groupTimeDeltaPure } = new Function('"use strict";' + m[0] + '\nreturn { _groupTimeDeltaPure };')();

// A 1/2-unit snap grid, and "snap off" (identity).
const snapHalf = t => Math.round(t * 2) / 2;
const snapOff = t => t;

let pass = 0, fail = 0;
function t(name, fn) {
    try { fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + (e && e.message)); }
}
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg || ''} (${a} ≉ ${b})`);

t('single note snaps its target to the grid (unchanged single-note behaviour)', () => {
    // 1.1 + 0.3 = 1.4 → snaps to 1.5 → delta 0.4.
    near(_groupTimeDeltaPure([1.1], 1.1, 0.3, snapHalf), 0.4, 'single-note snap');
});

t('a group moves by ONE delta (snapped via the grabbed note) — rigid, spacing kept', () => {
    const orig = [1.0, 1.25, 1.5];         // internal spacing 0.25
    const dt = _groupTimeDeltaPure(orig, 1.0, 0.3, snapHalf);   // 1.3 → 1.5 ⇒ +0.5
    assert.strictEqual(dt, 0.5);
    const moved = orig.map(x => x + dt);
    assert.deepStrictEqual(moved, [1.5, 1.75, 2.0], 'every note moved by the same delta');
    // spacing preserved (the bug destroyed this)
    assert.strictEqual(moved[1] - moved[0], 0.25);
    assert.strictEqual(moved[2] - moved[1], 0.25);
});

t('the delta is anchored on the GRABBED note, not note[0]', () => {
    // Grab the middle note (1.25): 1.25 + 0.1 = 1.35 → snaps to 1.5 ⇒ +0.25.
    const dt = _groupTimeDeltaPure([1.0, 1.25, 1.5], 1.25, 0.1, snapHalf);
    assert.strictEqual(dt, 0.25);
});

t('the delta is clamped so the earliest note cannot cross t=0', () => {
    // Big leftward drag; without clamp the earliest (0.2) would go negative.
    const orig = [0.2, 1.0, 2.0];
    const dt = _groupTimeDeltaPure(orig, 1.0, -2.0, snapHalf);
    assert.strictEqual(dt, -0.2, 'earliest lands exactly on 0');
    assert.strictEqual(Math.min(...orig.map(x => x + dt)), 0, 'nothing negative');
});

t('snap OFF ⇒ the group moves by the raw delta (still rigid)', () => {
    near(_groupTimeDeltaPure([1.0, 2.0], 1.0, 0.37, snapOff), 0.37, 'snap-off raw delta');
});

t('adversarial: non-finite primary falls back to the first note; empty/NaN never throw', () => {
    assert.strictEqual(_groupTimeDeltaPure([1.0, 2.0], NaN, 0.5, snapOff), 0.5, 'falls back to origTimes[0]');
    assert.doesNotThrow(() => _groupTimeDeltaPure([], undefined, 0.5, snapOff));
    assert.doesNotThrow(() => _groupTimeDeltaPure([1.0], 1.0, NaN, snapOff));
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
