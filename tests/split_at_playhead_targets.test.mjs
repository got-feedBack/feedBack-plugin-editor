/*
 * _editorSplitAtPlayhead (src/input.js) target selection + no-op guard.
 *
 * Two CodeRabbit findings on PR #301:
 *   - A split attempt where no target clears _SPLIT_MIN_SEGMENT must NOT record
 *     a no-op undo step or dirty the session (it reached history.exec before).
 *   - The all-notes fallback is the "no selection" verb — a non-empty selection
 *     that doesn't span the playhead must split nothing, never reach past the
 *     selection into unrelated notes.
 *
 * Run: node tests/split_at_playhead_targets.test.mjs
 */
import assert from 'node:assert';
import { S } from '../src/state.js';
import { EditHistory } from '../src/history.js';
import { _editorSplitAtPlayhead } from '../src/input.js';
import { _SPLIT_MIN_SEGMENT } from '../src/commands.js';
import { seedState, setRollView, trackHooks } from './_history_env.mjs';

let pass = 0, fail = 0;
function t(name, fn) {
    try { fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}

const N = (time, sustain) => ({ string: 0, fret: 3, time, sustain, techniques: {} });

function seed({ notes, sel, cursorTime }) {
    trackHooks();
    seedState({
        arrangements: [{ name: 'Guitar', notes, chords: [], tuning: [] }],
        currentArr: 0, cursorTime, duration: 30, snapEnabled: false, snapIdx: 0,
        beats: [], scrollX: 0, zoom: 100, history: new EditHistory(),
    });
    setRollView(false);
    S.sel = new Set(sel);
    S.sessionId = 'sess-1';       // markSessionDirty only fires with a session
    S.sessionDirty = false;
    return S.arrangements[0];
}

t('a slivers-only split records no undo step and leaves the session clean', () => {
    // Cut just inside the onset: spans the note, but the first half is a sliver
    // (< _SPLIT_MIN_SEGMENT), so no viable split exists.
    const arr = seed({ notes: [N(1.0, 1.0)], sel: [], cursorTime: 1.0 + _SPLIT_MIN_SEGMENT / 2 });
    _editorSplitAtPlayhead();
    assert.strictEqual(arr.notes.length, 1, 'note not split');
    assert.strictEqual(S.history.undo.length, 0, 'no no-op undo step recorded');
    assert.strictEqual(S.sessionDirty, false, 'session not dirtied');
});

t('a non-empty selection that misses the playhead splits nothing (no all-notes fallback)', () => {
    // Selected note (idx 0) does NOT span the playhead; an unselected note
    // (idx 1) does. The fallback must not reach into it.
    const arr = seed({
        notes: [N(5.0, 0.5), N(1.0, 1.0)], sel: [0], cursorTime: 1.5,
    });
    _editorSplitAtPlayhead();
    assert.strictEqual(arr.notes.length, 2, 'unselected note left untouched');
    assert.strictEqual(S.history.undo.length, 0, 'nothing executed');
});

t('with no selection, the all-notes fallback still splits a spanning note', () => {
    const arr = seed({ notes: [N(1.0, 1.0)], sel: [], cursorTime: 1.5 });
    _editorSplitAtPlayhead();
    assert.strictEqual(arr.notes.length, 2, 'note split');
    assert.strictEqual(S.history.undo.length, 1, 'one undoable split recorded');
});

t('a selected spanning note splits (selection path unchanged)', () => {
    const arr = seed({ notes: [N(1.0, 1.0)], sel: [0], cursorTime: 1.5 });
    _editorSplitAtPlayhead();
    assert.strictEqual(arr.notes.length, 2, 'selected note split');
    assert.strictEqual(S.history.undo.length, 1, 'one undoable split recorded');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
