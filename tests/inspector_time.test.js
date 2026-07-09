'use strict';
/*
 * Tests for the inspector's numeric edits becoming undoable + the new Time
 * field. The inspector's sustain edit used to mutate notes in place with NO
 * undo (n.sustain = v); Time (start position) was read-only. Both now route
 * through the editor's undo history — sustain via ResizeSustainGroupCmd, time
 * via MoveNoteCmd (absolute target → per-note deltas).
 *
 * Held to the testing habits: the REAL command classes are driven through the
 * REAL EditHistory (no stub of the subject); exec → rollback restores the note
 * array EXACTLY (deep-equality), exec → rollback → redo reproduces; the real
 * _INSPECTOR_BOUNDS.time config is fed through the real _coerceInspectorNumber
 * with adversarial inputs. The time-bounds assertions fail on main (no `time`
 * key exists there).
 *
 * Run: node tests/inspector_time.test.js
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');

// Brace-match extraction of a named class/function/const (the waveform_render
// harness pattern) — drives the real source, no re-implementation.
function extractNamed(decl) {
    const start = src.indexOf(decl);
    assert.ok(start >= 0, `not found: ${decl}`);
    const open = src.indexOf('{', start);
    let depth = 0;
    for (let i = open; i < src.length; i++) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}' && --depth === 0) return src.slice(start, i + 1);
    }
    throw new Error(`unbalanced braces for ${decl}`);
}
function extractPure(name) {
    const re = new RegExp(
        '/\\* @pure:' + name + ':start \\*/[\\s\\S]*?/\\* @pure:' + name + ':end \\*/');
    const m = src.match(re);
    if (!m) { console.error(`FAIL: @pure:${name} missing`); process.exit(1); }
    return m[0];
}

// Injected `notes()` reads a mutable outer array so each test controls it.
let CURRENT = [];
const api = new Function(
    'notes', 'document', 'draw', 'updateStatus',
    '"use strict";'
    + extractPure('edit-history') + '\n'
    + extractNamed('class MoveNoteCmd') + '\n'
    + extractNamed('class ResizeSustainGroupCmd') + '\n'
    + extractNamed('const _INSPECTOR_BOUNDS =') + '\n'
    + extractNamed('function _coerceInspectorNumber') + '\n'
    + 'return { EditHistory, MoveNoteCmd, ResizeSustainGroupCmd,'
    + ' _INSPECTOR_BOUNDS, _coerceInspectorNumber };'
)(() => CURRENT, { getElementById: () => ({ disabled: false }) }, () => {}, () => {});
const { EditHistory, MoveNoteCmd, ResizeSustainGroupCmd,
    _INSPECTOR_BOUNDS, _coerceInspectorNumber } = api;

const clone = (x) => JSON.parse(JSON.stringify(x));
const n = (time, sustain) => ({ time, string: 2, fret: 5, sustain, techniques: {} });

let pass = 0, fail = 0;
function t(name, fn) {
    try { fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}

// ── time bounds through the real coerce (fails on main: no `time` key) ───────
t('_INSPECTOR_BOUNDS.time exists and clamps/parses via the real coerce fn', () => {
    const b = _INSPECTOR_BOUNDS.time;
    assert.ok(b, 'time bounds present');
    assert.strictEqual(_coerceInspectorNumber('-3', b), 0, 'negative time clamps to 0');
    assert.strictEqual(_coerceInspectorNumber('1.5', b), 1.5, 'fractional seconds allowed');
    assert.strictEqual(_coerceInspectorNumber(' 2.25 ', b), 2.25, 'whitespace trimmed');
    assert.strictEqual(_coerceInspectorNumber('', b), null, 'empty rejects (no clear semantic)');
    assert.strictEqual(_coerceInspectorNumber('abc', b), null, 'junk rejects');
    assert.strictEqual(_coerceInspectorNumber('2.5x', b), null, 'junk tail rejects (not partial-parsed)');
});

// ── sustain edit is now undoable (ResizeSustainGroupCmd via real history) ─────
t('sustain: exec sets all; rollback restores exactly; redo reproduces', () => {
    CURRENT = [n(0, 0.5), n(4, 1.0)];
    const before = clone(CURRENT);
    const history = new EditHistory();
    history.exec(new ResizeSustainGroupCmd([0, 1], [2, 2]));
    assert.deepStrictEqual(CURRENT.map(x => x.sustain), [2, 2]);
    history.doUndo();
    assert.deepStrictEqual(CURRENT, before, 'undo restores the exact array (fails on main: raw mutation)');
    history.doRedo();
    assert.deepStrictEqual(CURRENT.map(x => x.sustain), [2, 2]);
});

// ── time edit: absolute target → per-note deltas via MoveNoteCmd ──────────────
t('time: multi-select moves every note to the target; round-trips exactly', () => {
    CURRENT = [n(1.0, 0), n(3.0, 0)];
    const before = clone(CURRENT);
    const target = 2.0;
    const dtimes = [0, 1].map(i => target - CURRENT[i].time);   // [1.0, -1.0]
    const history = new EditHistory();
    history.exec(new MoveNoteCmd([0, 1], dtimes, [0, 0], null));
    assert.deepStrictEqual(CURRENT.map(x => x.time), [2.0, 2.0]);
    history.doUndo();
    assert.deepStrictEqual(CURRENT, before, 'both original times restored');
    history.doRedo();
    assert.deepStrictEqual(CURRENT.map(x => x.time), [2.0, 2.0]);
});

t('time: single note (the common case) moves to the exact target and undoes', () => {
    CURRENT = [n(1.0, 0.5)];
    const history = new EditHistory();
    history.exec(new MoveNoteCmd([0], [2.5 - CURRENT[0].time], [0], null));
    assert.strictEqual(CURRENT[0].time, 2.5);
    assert.strictEqual(CURRENT[0].sustain, 0.5, 'only time changed');
    history.doUndo();
    assert.strictEqual(CURRENT[0].time, 1.0);
});

t('time: a note already at the target gets a zero delta (no-op move)', () => {
    CURRENT = [n(2.0, 0), n(2.0, 0)];   // both already at 2.0
    const before = clone(CURRENT);
    const dtimes = [0, 1].map(i => 2.0 - CURRENT[i].time);   // [0, 0]
    const history = new EditHistory();
    history.exec(new MoveNoteCmd([0, 1], dtimes, [0, 0], null));
    assert.deepStrictEqual(CURRENT, before);
    history.doUndo();
    assert.deepStrictEqual(CURRENT, before);
});

// ── Drive the REAL dispatcher window.editorInspectorSetField ─────────────────
// The cases above call the command classes directly, RECONSTRUCTING in the test
// the delta math the dispatcher performs (target - note.time). That leaves the
// function the PR actually adds — window.editorInspectorSetField — unexercised:
// its field routing (sustain→ResizeSustainGroupCmd vs time→MoveNoteCmd), the
// absolute→delta conversion `v - nn[i].time`, the `v === null` reject/re-render
// branch, the empty-selection early return, and the "exactly ONE history entry
// per commit" guarantee. A regression there (wrong delta sign, wrong routing,
// double-exec) would pass every test above. So extract and run the real
// dispatcher with a minimal stubbed S/notes/window/_renderInspector. Uses the
// same brace-match/@pure extraction — no re-implementation of the subject.
let DISPATCH_NOTES = [];
const dispatchS = { sel: new Set(), drumEditMode: false, tempoMapMode: false, history: null };
let renderCount = 0;                 // # of _renderInspector() calls (reject branch)
const win = {};                      // captures `window.editorInspectorSetField = …`
const dispatch = new Function(
    'notes', 'S', 'document', 'draw', 'updateStatus', '_renderInspector', 'window',
    '"use strict";'
    + extractPure('edit-history') + '\n'
    + extractNamed('class MoveNoteCmd') + '\n'
    + extractNamed('class ResizeSustainGroupCmd') + '\n'
    + extractNamed('const _INSPECTOR_BOUNDS =') + '\n'
    + extractNamed('function _coerceInspectorNumber') + '\n'
    + extractNamed('function _editorCurrentNoteIndices') + '\n'
    + extractNamed('window.editorInspectorSetField =') + '\n'
    + 'return { EditHistory };'
)(
    () => DISPATCH_NOTES,
    dispatchS,
    { getElementById: () => ({ disabled: false }) },
    () => {}, () => {},
    () => { renderCount++; },
    win,
);
const setField = win.editorInspectorSetField;

// Fresh notes + selection + history per case. History built with the dispatcher
// scope's own EditHistory so exec/undo share the injected notes()/draw stubs.
function resetDispatch(arr, sel) {
    DISPATCH_NOTES = arr;
    dispatchS.sel = new Set(sel);
    dispatchS.history = new dispatch.EditHistory();
    renderCount = 0;
}

t('dispatcher time: moves the note to the exact absolute value; +1 history entry', () => {
    resetDispatch([n(1.0, 0.5)], [0]);
    setField('time', '2.0');
    assert.strictEqual(DISPATCH_NOTES[0].time, 2.0, 'moved to absolute target');
    assert.strictEqual(DISPATCH_NOTES[0].sustain, 0.5, 'only time changed');
    assert.strictEqual(dispatchS.history.undo.length, 1, 'exactly one commit');
    assert.strictEqual(renderCount, 0, 'no reject re-render on a valid edit');
    dispatchS.history.doUndo();
    assert.strictEqual(DISPATCH_NOTES[0].time, 1.0, 'undo restores the onset');
    assert.strictEqual(dispatchS.history.undo.length, 0);
});

t('dispatcher time: multi-select sets every note to the same absolute value (one commit)', () => {
    resetDispatch([n(1.0, 0), n(3.0, 0)], [0, 1]);
    const before = clone(DISPATCH_NOTES);
    setField('time', '2.0');
    assert.deepStrictEqual(DISPATCH_NOTES.map(x => x.time), [2.0, 2.0], 'both moved via v - note.time deltas');
    assert.strictEqual(dispatchS.history.undo.length, 1, 'set-all is a single Ctrl+Z');
    dispatchS.history.doUndo();
    assert.deepStrictEqual(DISPATCH_NOTES, before, 'both original times restored');
});

t('dispatcher sustain: routes to ResizeSustainGroupCmd, not MoveNoteCmd (time untouched)', () => {
    resetDispatch([n(0, 0.5), n(4, 1.0)], [0, 1]);
    setField('sustain', '2');
    assert.deepStrictEqual(DISPATCH_NOTES.map(x => x.sustain), [2, 2], 'sustain set-all');
    assert.deepStrictEqual(DISPATCH_NOTES.map(x => x.time), [0, 4], 'time left alone (correct field routed)');
    assert.strictEqual(dispatchS.history.undo.length, 1);
    dispatchS.history.doUndo();
    assert.deepStrictEqual(DISPATCH_NOTES.map(x => x.sustain), [0.5, 1.0], 'undo restores sustains');
});

t('dispatcher reject: junk ("2.5x") and empty are no-op edits that re-render, no history push', () => {
    resetDispatch([n(1.0, 0.5)], [0]);
    setField('time', '2.5x');                 // Number('2.5x') → NaN → coerce null
    assert.strictEqual(DISPATCH_NOTES[0].time, 1.0, 'junk-tail rejected, note unchanged');
    assert.strictEqual(dispatchS.history.undo.length, 0, 'no commit on reject');
    assert.strictEqual(renderCount, 1, 're-render snaps the input back');
    setField('time', '');                     // no emptyAs for `time` → null
    assert.strictEqual(DISPATCH_NOTES[0].time, 1.0, 'empty rejected');
    assert.strictEqual(dispatchS.history.undo.length, 0);
    assert.strictEqual(renderCount, 2, 'second reject re-renders again');
});

t('dispatcher empty selection: early-returns before bounds/history/render', () => {
    resetDispatch([n(1.0, 0.5)], []);         // nothing selected
    setField('time', '2.0');
    assert.strictEqual(DISPATCH_NOTES[0].time, 1.0, 'no note moved');
    assert.strictEqual(dispatchS.history.undo.length, 0, 'no commit');
    assert.strictEqual(renderCount, 0, 'early return is before the reject re-render branch');
});

t('dispatcher float round-trip: move is exact, but undo carries sub-ULP drift (documents the PR claim)', () => {
    // The PR body says the undo "restores the exact array". That is exact only
    // for values where the float arithmetic is exact (e.g. 1.0/3.0 → 2.0 above
    // round-trip bit-for-bit). Here the onset 0.1 is not exactly representable:
    // moving to 2.0 lands on 2.0 exactly, but the undo (time -= (2.0 - 0.1))
    // leaves 0.10000000000000009 — a sub-ULP residue (~8.3e-17). Asserted with a
    // tolerance and documented so the "exact restore" claim isn't read as
    // holding for ALL values.
    resetDispatch([n(0.1, 0)], [0]);
    setField('time', '2.0');
    assert.strictEqual(DISPATCH_NOTES[0].time, 2.0, 'the move itself lands exactly on the target');
    dispatchS.history.doUndo();
    const restored = DISPATCH_NOTES[0].time;
    assert.notStrictEqual(restored, 0.1, 'undo does NOT bit-for-bit restore this onset (float drift)');
    assert.ok(Math.abs(restored - 0.1) < 1e-9, `undo lands within tolerance of the onset (got ${restored})`);
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
