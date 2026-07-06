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

const src = fs.readFileSync(path.join(__dirname, '..', 'screen.js'), 'utf8');

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

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
