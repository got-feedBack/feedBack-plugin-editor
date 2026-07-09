'use strict';
/*
 * Cross-arrangement undo hardening (PR #89, fix #1).
 *
 * Regression: undo/redo route through _historyEnsureArr, which switches the
 * active arrangement so an index-based rollback lands in the right notes array.
 * The switch went through window.editorSelectArrangement(), which calls
 * flattenChords() -> _flattenArrChords(), whose last line RE-SORTS arr.notes.
 * But MoveNoteCmd (and DeleteNotesCmd / ResizeSustainCmd) are INDEX-based and
 * deliberately do NOT re-sort — a note dragged past its neighbours leaves the
 * array temporally unsorted but index-stable. A re-sort between exec and
 * rollback therefore renumbers the notes and the rollback corrupts the WRONG
 * note.
 *
 * The fix (option B): every MANUAL arrangement switch resets the history, so an
 * index-based command can never survive across an arr.notes re-sort. The
 * undo-driven switch inside _historyEnsureArr opts out via _undoDrivenArrSwitch
 * so it doesn't discard the stack it is replaying.
 *
 * Unlike drum_undo.test.js (which eval's only the @pure blocks and so stubs
 * _historyEnsureArr out entirely), this test eval's the REAL routing:
 *   - the @pure:edit-history block (EditHistory + MAX_UNDO),
 *   - the real _undoDrivenArrSwitch flag + _historyEnsureArr,
 *   - the real MoveNoteCmd,
 *   - the real window.editorSelectArrangement,
 * so the flatten-driven re-sort actually fires. flattenChords is stubbed to
 * exactly mimic _flattenArrChords's re-sort (the corruption trigger), which is
 * what makes this test FAIL on pre-fix code (no history reset -> the corrupting
 * cross-arrangement rollback runs) and PASS on the fixed code.
 *
 * Run: node tests/cross_arr_undo.test.mjs
 */
import assert from 'node:assert';
import fs from 'node:fs';
import { MoveNoteCmd } from '../src/commands.js';
import { EditHistory } from '../src/history.js';
import { setHostHooks } from '../src/host.js';
import { seedState } from './_history_env.mjs';

const src = fs.readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');

function extractRe(re, label) {
    const m = src.match(re);
    if (!m) { console.error(`FAIL: could not extract ${label} from src/main.js`); process.exit(1); }
    return m[0];
}

// Real _undoDrivenArrSwitch flag + _historyEnsureArr. EditHistory is a real
// import now, so _historyEnsureArr reaches it as a hook — which is exactly how
// main.js wires the two together (they cannot import each other: cycle).
const ensureArr = extractRe(
    /let _undoDrivenArrSwitch = false;[\s\S]*?\nfunction _historyEnsureArr\(cmd\) \{[\s\S]*?\n\}/,
    '_historyEnsureArr');
const selectArr = extractRe(
    /window\.editorSelectArrangement = \(val\) => \{[\s\S]*?\n\};/,
    'editorSelectArrangement');

// Build the environment. flattenChords is stubbed to mimic _flattenArrChords's
// final `arr.notes.sort(...)` — the exact re-sort that renumbers index-based
// note commands. notes() returns the active arrangement's notes array.
function makeEnv() {
    const S = seedState({
        arrangements: [],
        currentArr: 0,
        toneSel: null,
        anchorSel: null,
        handshapeSel: null,
        history: null,
    });
    const win = {};
    const flattenChords = () => {
        const arr = S.arrangements[S.currentArr];
        if (arr && Array.isArray(arr.notes)) arr.notes.sort((a, b) => a.time - b.time);
    };
    const notes = () => S.arrangements[S.currentArr].notes;
    const env = new Function(
        'window', 'document', 'S', 'flattenChords', 'isKeysMode',
        'updatePianoRange', 'draw', 'updateStatus', 'setStatus', 'notes',
        '"use strict";'
        + ensureArr + '\n' + selectArr + '\n'
        + 'return { _historyEnsureArr };'
    )(
        win,
        { getElementById: () => null },
        S,
        flattenChords,
        () => false,
        () => {},
        () => {},
        () => {},
        () => {},
        notes,
    );
    setHostHooks({ ensureArr: env._historyEnsureArr, draw: () => {}, updateStatus: () => {} });
    S.history = new EditHistory();
    return { ...env, MoveNoteCmd, S, win, history: S.history, flattenChords };
}

let pass = 0, fail = 0;
function t(name, fn) {
    try { fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}

// Two arrangements; arr0 notes are index-stable but will go temporally unsorted
// after a drag-past-neighbour move. Chords already folded in (empty), so the
// stubbed flattenChords re-sort is the whole side effect — exactly the real one.
function twoArrs() {
    return [
        { name: 'Lead', notes: [{ time: 1, string: 0, fret: 3 },
                                { time: 2, string: 0, fret: 5 },
                                { time: 3, string: 0, fret: 7 }], chords: [] },
        { name: 'Rhythm', notes: [{ time: 1, string: 1, fret: 0 },
                                  { time: 2, string: 1, fret: 2 }], chords: [] },
    ];
}

// ── Sanity: within-arrangement undo routes through the REAL _historyEnsureArr
//    (idx === currentArr -> true) and restores exactly, even when the move left
//    the array unsorted. Guards against a regression that would break the
//    normal (non-switch) undo path.
t('within-arr: unsorted move undoes to the exact original, real routing', () => {
    const { S, history, MoveNoteCmd } = makeEnv();
    S.arrangements = twoArrs();
    S.currentArr = 0;
    const A = S.arrangements[0].notes[0];  // time 1 at index 0
    // Drag A past its neighbours: +5 -> time 6. Array now [6,2,3] (unsorted),
    // indices unchanged.
    history.exec(new MoveNoteCmd([0], [5], [0], null));
    assert.strictEqual(A.time, 6, 'move applied');
    assert.deepStrictEqual(S.arrangements[0].notes.map(n => n.time), [6, 2, 3],
        'array left unsorted, index-stable');
    history.doUndo();  // no arrangement switch: _historyEnsureArr returns true
    assert.deepStrictEqual(S.arrangements[0].notes.map(n => n.time), [1, 2, 3],
        'the moved note (and only it) is restored');
});

// ── The fix: a MANUAL switch resets history, so the fragile cross-arrangement
//    rollback can never run. On PRE-FIX code editorSelectArrangement did NOT
//    reset, so the stack survived the switch; doUndo then drove
//    _historyEnsureArr -> editorSelectArrangement -> re-sort of arr0 -> a
//    rollback against the WRONG index -> corruption. Both assertions below hold
//    on the fixed code and fail on the original.
t('cross-arr: manual switch resets history; no corrupting rollback survives it', () => {
    const { S, history, win, MoveNoteCmd } = makeEnv();
    S.arrangements = twoArrs();
    S.currentArr = 0;
    const [A, B, C] = S.arrangements[0].notes;

    // Drag A past its neighbours in arr0 (unsorted, index-stable), record cmd.
    history.exec(new MoveNoteCmd([0], [5], [0], null));
    assert.deepStrictEqual(S.arrangements[0].notes.map(n => n.time), [6, 2, 3]);
    assert.strictEqual(history.undo.length, 1, 'command recorded against arr0');

    // Manual (user) switch to arr1. FIX: this resets the history.
    win.editorSelectArrangement(1);
    assert.strictEqual(S.currentArr, 1, 'switched to arr1');
    assert.strictEqual(history.undo.length, 0,
        'manual switch reset the history (fails on pre-fix: stack survives)');

    // Attempt undo. With the stack empty this is a no-op; on pre-fix code it
    // would route to arr0, re-sort it, and roll back the wrong note.
    history.doUndo();

    // arr0 must be exactly as the last edit left it — no note corrupted, none
    // pushed negative by a mis-indexed rollback. (On pre-fix code B would have
    // been decremented to -3 and A left at 6.)
    assert.strictEqual(A.time, 6, 'moved note untouched by the (disabled) cross-arr undo');
    assert.strictEqual(B.time, 2, 'neighbour B not corrupted');
    assert.strictEqual(C.time, 3, 'neighbour C not corrupted');
    assert.ok(S.arrangements[0].notes.every(n => n.time > 0),
        'no note driven negative by a mis-indexed rollback');
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
