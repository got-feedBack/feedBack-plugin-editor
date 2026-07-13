/*
 * Keyboard note entry — place a note without a mouse. In String view with NOTHING
 * selected, a fret digit places a note on the caret string at the playhead, and
 * ↑/↓ move the caret. (With a selection, the same keys keep their edit meaning:
 * a digit sets the selected fret, ↑/↓ move the selected note's string.)
 *
 * Driven through the real command dispatcher `_editorRunEofCommand`.
 * Run: node tests/keyboard_entry.test.mjs
 */
import assert from 'node:assert';
import { S } from '../src/state.js';
import { EditHistory } from '../src/history.js';
import { _editorRunEofCommand } from '../src/input.js';
import { seedState, setRollView, trackHooks } from './_history_env.mjs';

let pass = 0, fail = 0;
function t(name, fn) {
    try { fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}

function seed({ sel = [], caretString = 2, notes = [] } = {}) {
    trackHooks();
    seedState({
        arrangements: [{ name: 'Guitar', notes, chords: [], tuning: [] }],
        currentArr: 0,
        caretString,
        cursorTime: 1.0,
        duration: 30,
        snapEnabled: false,
        snapIdx: 0,
        beats: [{ time: 0, measure: 1 }, { time: 1, measure: -1 }, { time: 2, measure: -1 }],
        scrollX: 0, zoom: 100,
        history: new EditHistory(),
    });
    setRollView(false);                 // String view (fretted), not keys
    S.sel = new Set(sel);
    return S.arrangements[0];
}

t('a fret digit with NO selection places a note on the caret string', () => {
    const arr = seed({ caretString: 3 });
    _editorRunEofCommand('setFretDigit:5');
    assert.strictEqual(arr.notes.length, 1, 'a note was added');
    assert.strictEqual(arr.notes[0].string, 3, 'on the caret string');
    assert.strictEqual(arr.notes[0].fret, 5, 'at the typed fret');
    assert.strictEqual(S.sel.size, 0, 'entry flow leaves no selection (keep typing to place more)');
    assert.ok((S.cursorTime || 0) > 1.0, 'the caret advanced in time for the next note');
});

t('placing is undoable', () => {
    const arr = seed();
    _editorRunEofCommand('setFretDigit:7');
    assert.strictEqual(arr.notes.length, 1);
    S.history.doUndo();
    assert.strictEqual(arr.notes.length, 0, 'undo removed the placed note');
});

t('a fret digit WITH a selection still edits the selected note (not a new one)', () => {
    const arr = seed({ notes: [{ string: 0, fret: 0, time: 0, sustain: 0, techniques: {} }], sel: [0] });
    _editorRunEofCommand('setFretDigit:9');
    assert.strictEqual(arr.notes.length, 1, 'no new note placed');
    assert.strictEqual(arr.notes[0].fret, 9, 'the selected note fret was set');
});

t('↑/↓ with no selection move the caret string (clamped)', () => {
    seed({ caretString: 2 });
    _editorRunEofCommand('moveStringUp');
    const up = S.caretString;
    assert.notStrictEqual(up, 2, 'caret moved');
    assert.strictEqual(Math.abs(up - 2), 1, 'by one string');
    // Clamp at the edges (6-string guitar → 0..5).
    for (let i = 0; i < 10; i++) _editorRunEofCommand('moveStringUp');
    assert.ok(S.caretString >= 0 && S.caretString <= 5, 'stays within the string range');
    for (let i = 0; i < 10; i++) _editorRunEofCommand('moveStringDown');
    assert.ok(S.caretString >= 0 && S.caretString <= 5, 'stays within the string range');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
