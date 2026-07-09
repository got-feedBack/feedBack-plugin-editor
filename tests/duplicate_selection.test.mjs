'use strict';
/*
 * Tests for duplicate-selection (@pure:duplicate block):
 *   - _duplicateShiftPure — the time offset a duplicate lands at, and
 *   - AddNotesCmd — the undoable batch-add the duplicate uses,
 * driven through the REAL @pure:edit-history EditHistory (no stub of the
 * subject). Ctrl+D copies the selection one selection-length-plus-a-grid-step
 * later (a chord or single note goes one grid step later) so a repeat tiles a
 * phrase whose copies ABUT the source instead of double-stacking on the seam.
 *
 * Every command path is round-tripped: exec → rollback restores the note
 * array EXACTLY (deep-equality), exec → rollback → redo reproduces. The
 * offset helper is fed the adversarial inputs (empty, chord/same-time,
 * NaN, invalid snap step) and proven to use BOTH its arguments. These
 * assertions fail on main (neither symbol exists there).
 *
 * Run: node tests/duplicate_selection.test.mjs
 */
import assert from 'node:assert';
import fs from 'node:fs';
import { EditHistory } from '../src/history.js';
import { seedState, trackHooks } from './_history_env.mjs';

const src = fs.readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
function extract(name) {
    const re = new RegExp(
        '/\\* @pure:' + name + ':start \\*/[\\s\\S]*?/\\* @pure:' + name + ':end \\*/');
    const m = src.match(re);
    if (!m) { console.error(`FAIL: @pure:${name} block missing`); process.exit(1); }
    return m[0];
}

// EditHistory is a real import now; it closes over the real `S` and calls back
// into main.js through hooks. Seed one and install counting no-ops.
seedState();
trackHooks();
const api = new Function(
    '"use strict";'
    + extract('duplicate') + '\n'
    + 'return { AddNotesCmd, _duplicateShiftPure };'
)();
const { AddNotesCmd, _duplicateShiftPure } = api;

const clone = (x) => JSON.parse(JSON.stringify(x));

let pass = 0, fail = 0;
function t(name, fn) {
    try { fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}

// ── _duplicateShiftPure ──────────────────────────────────────────────────────
t('shift = selection span PLUS one grid step for a multi-time selection', () => {
    // span + step so the copy ABUTS the source (no doubled onset on the seam).
    assert.strictEqual(_duplicateShiftPure([0, 1.8], 0.25), 1.8 + 0.25);
    assert.strictEqual(_duplicateShiftPure([2, 3, 5], 0.25), 3 + 0.25);
});

t('shift = one grid step for a single note or a chord (all one time)', () => {
    assert.strictEqual(_duplicateShiftPure([4], 0.25), 0.25);
    assert.strictEqual(_duplicateShiftPure([4, 4, 4], 0.5), 0.5, 'chord: span 0 → snap step');
});

t('uses BOTH arguments (times AND snapStep)', () => {
    // Different times → different shift (reads `times`).
    assert.notStrictEqual(_duplicateShiftPure([0, 2], 0.25), _duplicateShiftPure([0, 5], 0.25));
    // Single-time selection reads `snapStep`.
    assert.strictEqual(_duplicateShiftPure([1], 0.1), 0.1);
    assert.notStrictEqual(_duplicateShiftPure([1], 0.1), _duplicateShiftPure([1], 0.5));
});

t('degenerate / adversarial inputs never throw and no-op to 0', () => {
    assert.strictEqual(_duplicateShiftPure([], 0.25), 0);
    assert.strictEqual(_duplicateShiftPure(null, 0.25), 0);
    assert.strictEqual(_duplicateShiftPure([NaN, undefined], 0.25), 0, 'all non-finite → 0');
});

t('mixed finite/NaN times use only the finite ones for the span', () => {
    assert.strictEqual(_duplicateShiftPure([NaN, 2, 5], 0.25), 3 + 0.25);
});

t('invalid snap step falls back to a sane default for zero-span selections', () => {
    assert.strictEqual(_duplicateShiftPure([3], 0), 0.25);
    assert.strictEqual(_duplicateShiftPure([3], -1), 0.25);
    assert.strictEqual(_duplicateShiftPure([3], NaN), 0.25);
});

// ── AddNotesCmd through the REAL EditHistory ─────────────────────────────────
function n(time, fret) { return { time, string: 2, fret, sustain: 0, techniques: {} }; }

t('exec adds sorted; rollback restores the array exactly; redo reproduces', () => {
    const list = [n(0, 1), n(4, 3)];
    const before = clone(list);
    const history = new EditHistory();
    const dupes = [n(1.8, 1), n(5.8, 3)];   // a phrase duplicated one span later
    history.exec(new AddNotesCmd(list, dupes));
    assert.deepStrictEqual(list.map(x => x.time), [0, 1.8, 4, 5.8], 'inserted sorted');
    history.doUndo();
    assert.deepStrictEqual(list, before, 'undo restores the exact array');
    history.doRedo();
    assert.deepStrictEqual(list.map(x => x.time), [0, 1.8, 4, 5.8]);
});

t('rollback removes only the added refs, leaving originals untouched', () => {
    const keep1 = n(0, 1), keep2 = n(4, 3);
    const list = [keep1, keep2];
    const history = new EditHistory();
    history.exec(new AddNotesCmd(list, [n(4, 5)]));   // same time as keep2
    assert.strictEqual(list.length, 3);
    history.doUndo();
    assert.strictEqual(list.length, 2);
    assert.strictEqual(list[0], keep1, 'original refs preserved');
    assert.strictEqual(list[1], keep2);
});

t('duplicating a gridded selection tiles forward WITHOUT a seam overlap', () => {
    const list = [n(0, 1), n(1, 2)];        // 1 s phrase on a 1 s grid
    const history = new EditHistory();
    const step = 1;                         // grid step
    // Drive the shift through the real helper so this pins the integration:
    // span (1) + step (1) = 2 → the copy's first onset lands one step past
    // the original's last onset, never ON it.
    let shift = _duplicateShiftPure([0, 1], step);
    assert.strictEqual(shift, 2, 'span 1 + grid step 1 = 2 (abut, do not overlap)');
    history.exec(new AddNotesCmd(list, [n(0 + shift, 1), n(1 + shift, 2)]));   // 2,3
    // Second duplicate of the copies (now at 2,3).
    shift = _duplicateShiftPure([2, 3], step);
    history.exec(new AddNotesCmd(list, [n(2 + shift, 1), n(3 + shift, 2)]));   // 4,5
    const times = list.map(x => x.time);
    assert.deepStrictEqual(times, [0, 1, 2, 3, 4, 5], 'no doubled onset at any seam');
    // Regression guard: every onset is unique — the seam collision is gone.
    assert.strictEqual(new Set(times).size, times.length, 'no double-stacked note on a boundary');
    history.doUndo();
    assert.deepStrictEqual(list.map(x => x.time), [0, 1, 2, 3]);
    history.doUndo();
    assert.deepStrictEqual(list.map(x => x.time), [0, 1]);
});

t('empty newNotes is a clean no-op that still round-trips', () => {
    const list = [n(0, 1)];
    const before = clone(list);
    const history = new EditHistory();
    history.exec(new AddNotesCmd(list, []));
    assert.deepStrictEqual(list, before);
    history.doUndo();
    assert.deepStrictEqual(list, before);
});

t('onChange wraps both exec and rollback (selection-rebind hook fires)', () => {
    let wraps = 0;
    const list = [n(0, 1)];
    const history = new EditHistory();
    const onChange = (fn) => { wraps++; fn(); };
    history.exec(new AddNotesCmd(list, [n(2, 2)], onChange));
    history.doUndo();
    assert.strictEqual(wraps, 2, 'wrapped exec and rollback');
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
