/*
 * Tests for the canvas −/+ string-count buttons (src/strings.js) and the
 * confirmed remove-with-notes path (RemoveStringWithNotesCmd,
 * src/commands.js).
 *
 * The command test drives the REAL EditHistory + REAL S (the
 * _history_env pattern): the compound must delete the target string's
 * notes and peel the string as ONE undo step, and a single undo must
 * restore the exact pre-remove state (notes back on their string,
 * tuning + extension counter + templates intact). Would fail on main:
 * the command doesn't exist there, and the only remove path hard-blocks
 * when the string carries notes.
 *
 * Run: node tests/canvas_string_buttons.test.mjs
 */
import assert from 'node:assert';
import { seedState, trackHooks } from './_history_env.mjs';
import { EditHistory } from '../src/history.js';
import { AddStringCmd, RemoveStringWithNotesCmd } from '../src/commands.js';
import { _stringCountFor } from '../src/lanes.js';
import {
    _stringAddLabelPure, _stringButtonsVisiblePure, _stringRemoveLabelPure,
} from '../src/strings.js';

let pass = 0, fail = 0;
function t(name, fn) {
    try { fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}

const N = (time, string, fret) => ({ time, string, fret, sustain: 0, techniques: {} });
const snap = (arr) => JSON.parse(JSON.stringify({
    tuning: arr.tuning, notes: arr.notes, chords: arr.chords,
    chord_templates: arr.chord_templates, _extendedStrings: arr._extendedStrings || 0,
}));

function seedBass5() {
    // A 5-string bass (low B added) with two notes ON the low B and two
    // above it — the tester scenario after moving a chart down a string.
    const arr = {
        name: 'Bass',
        tuning: [0, 0, 0, 0, 0],
        _extendedStrings: 1,
        notes: [N(1, 0, 3), N(2, 0, 5), N(1.5, 2, 2), N(3, 4, 7)],
        chords: [],
        chord_templates: [{ frets: [1, -1, -1, -1, -1], fingers: [1, -1, -1, -1, -1] }],
    };
    const S = seedState({ arrangements: [arr], currentArr: 0 });
    S.history = new EditHistory();
    trackHooks();
    return { S, arr };
}

t('remove-with-notes: one exec deletes the low-B notes and peels the string', () => {
    const { S, arr } = seedBass5();
    assert.strictEqual(_stringCountFor(arr), 5);
    S.history.exec(new RemoveStringWithNotesCmd(0, 'low', [0, 1]));
    assert.strictEqual(_stringCountFor(arr), 4);
    assert.strictEqual(arr.tuning.length, 4);
    assert.strictEqual(arr._extendedStrings, 0);
    // Only the two surviving notes remain, shifted down one string.
    assert.deepStrictEqual(arr.notes.map((n) => [n.string, n.fret]), [[1, 2], [3, 7]]);
    // Template columns peeled at the low end too.
    assert.deepStrictEqual(arr.chord_templates[0].frets, [-1, -1, -1, -1]);
});

t('remove-with-notes: ONE undo restores the exact pre-remove state', () => {
    const { S, arr } = seedBass5();
    const before = snap(arr);
    S.history.exec(new RemoveStringWithNotesCmd(0, 'low', [0, 1]));
    const after = snap(arr);
    assert.strictEqual(S.history.undo.length, 1, 'one undo step, not two');
    S.history.doUndo();
    assert.deepStrictEqual(snap(arr), before, 'undo restores notes + tuning + counter');
    S.history.doRedo();
    assert.deepStrictEqual(snap(arr), after, 'redo re-applies identically');
    S.history.doUndo();
    assert.deepStrictEqual(snap(arr), before, 'round-trips repeatedly');
});

t('remove-with-notes composes with a prior AddStringCmd round trip', () => {
    // 4-string bass → add low B → author a note on it → confirmed remove.
    const arr = {
        name: 'Bass', tuning: [0, 0, 0, 0], notes: [N(1, 1, 2)],
        chords: [], chord_templates: [],
    };
    const S = seedState({ arrangements: [arr], currentArr: 0 });
    S.history = new EditHistory();
    trackHooks();
    S.history.exec(new AddStringCmd(0, 'low'));
    assert.strictEqual(_stringCountFor(arr), 5);
    arr.notes.push(N(2, 0, 3));   // a note on the new low B
    const withNote = snap(arr);
    S.history.exec(new RemoveStringWithNotesCmd(0, 'low', [1]));
    assert.strictEqual(_stringCountFor(arr), 4);
    // The original note rode the add (1→2) and rides the remove back (2→1).
    assert.deepStrictEqual(arr.notes.map((n) => [n.string, n.fret]), [[1, 2]]);
    S.history.doUndo();
    assert.deepStrictEqual(snap(arr), withNote);
});

t('remove-with-notes undo and redo stay bound to their original arrangement', () => {
    const { S, arr } = seedBass5();
    const other = {
        name: 'Lead', tuning: [0, 0, 0, 0, 0, 0],
        notes: [N(9, 0, 9)], chords: [], chord_templates: [],
    };
    S.arrangements.push(other);
    const before = snap(arr);
    const otherBefore = snap(other);
    S.history.exec(new RemoveStringWithNotesCmd(0, 'low', [0, 1]));
    const after = snap(arr);

    S.currentArr = 1;
    S.sel = new Set([0]);
    S.history.doUndo();
    assert.strictEqual(S.currentArr, 1, 'undo restores the user-selected arrangement');
    assert.deepStrictEqual([...S.sel], [0], 'undo preserves its selection');
    assert.deepStrictEqual(snap(arr), before, 'undo restores notes to the original arrangement');
    assert.deepStrictEqual(snap(other), otherBefore, 'undo leaves the selected arrangement untouched');

    S.history.doRedo();
    assert.strictEqual(S.currentArr, 1, 'redo restores the user-selected arrangement');
    assert.deepStrictEqual([...S.sel], [0], 'redo preserves its selection');
    assert.deepStrictEqual(snap(arr), after, 'redo edits the original arrangement');
    assert.deepStrictEqual(snap(other), otherBefore, 'redo leaves the selected arrangement untouched');
});

t('visibility: fretted parts only (now takes the resolved kind, not a name)', () => {
    const none = {};
    assert.strictEqual(_stringButtonsVisiblePure('guitar', none), true);
    assert.strictEqual(_stringButtonsVisiblePure('bass', none), true);
    assert.strictEqual(_stringButtonsVisiblePure('keys', none), false);
    assert.strictEqual(_stringButtonsVisiblePure('drums', none), false);
    for (const flag of ['keysMode', 'drumEdit', 'tempoMap', 'partsView', 'tabView']) {
        assert.strictEqual(_stringButtonsVisiblePure('guitar', { [flag]: true }), false, flag);
    }
});

t('tooltips name the string that appears/goes at every count', () => {
    assert.match(_stringAddLabelPure(true, 4), /5th string \(low B\)/);
    assert.match(_stringAddLabelPure(true, 5), /6th string \(high C\)/);
    assert.match(_stringAddLabelPure(true, 6), /up to 6/);
    assert.match(_stringAddLabelPure(false, 6), /7th string \(low B\)/);
    assert.match(_stringAddLabelPure(false, 7), /8th string \(low F#\)/);
    assert.match(_stringAddLabelPure(false, 8), /up to 8/);
    assert.match(_stringRemoveLabelPure(true, 6), /high C/);
    assert.match(_stringRemoveLabelPure(true, 5), /low B/);
    assert.match(_stringRemoveLabelPure(true, 4), /at least 4/);
    assert.match(_stringRemoveLabelPure(false, 7), /low B/);
    assert.match(_stringRemoveLabelPure(false, 6), /at least 6/);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
