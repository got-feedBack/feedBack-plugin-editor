/*
 * Keyboard time-nudge (←/→): move the selected notes earlier/later by one snap
 * step as one grouped, undoable MoveNoteCmd; clamp so the earliest can't cross 0.
 * With nothing selected, ←/→ seek the playhead a step instead (which is also the
 * keyboard-entry caret time). Driven through the real dispatcher.
 *
 * Run: node tests/time_nudge.test.mjs
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
const near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

// No beats → _editorSnapStepSeconds() = 0.25 (its default), so a nudge is ±0.25.
function seed({ notes, sel }) {
    trackHooks();
    seedState({
        arrangements: [{ name: 'Guitar', notes, chords: [], tuning: [] }],
        currentArr: 0, cursorTime: 1.0, duration: 30, snapEnabled: false, snapIdx: 0,
        beats: [], scrollX: 0, zoom: 100, history: new EditHistory(),
    });
    setRollView(false);
    S.sel = new Set(sel);
    return S.arrangements[0];
}
const N = (time) => ({ string: 0, fret: 3, time, sustain: 0, techniques: {} });

t('→ nudges the selection later by one step; undo restores exactly', () => {
    const arr = seed({ notes: [N(1.0), N(2.0)], sel: [0, 1] });
    _editorRunEofCommand('nudgeTimeRight');
    assert.ok(near(arr.notes[0].time, 1.25) && near(arr.notes[1].time, 2.25), 'both moved +0.25');
    S.history.doUndo();
    assert.ok(near(arr.notes[0].time, 1.0) && near(arr.notes[1].time, 2.0), 'undo restored');
});

t('← nudges earlier and clamps so the earliest note cannot cross 0', () => {
    const arr = seed({ notes: [N(0.1), N(1.0)], sel: [0, 1] });
    _editorRunEofCommand('nudgeTimeLeft');
    // earliest is 0.1; a full -0.25 would go negative, so the group shifts by -0.1.
    assert.ok(near(arr.notes[0].time, 0) && near(arr.notes[1].time, 0.9), 'clamped shift keeps relative spacing');
});

t('with NOTHING selected, ←/→ move the playhead (entry caret time) a step', () => {
    seed({ notes: [N(1.0)], sel: [] });
    const before = S.cursorTime;
    _editorRunEofCommand('nudgeTimeRight');
    assert.ok(S.cursorTime > before, 'playhead advanced');
    _editorRunEofCommand('nudgeTimeLeft');
    assert.ok(near(S.cursorTime, before), 'and back');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
