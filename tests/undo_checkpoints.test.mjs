/*
 * Undo checkpoints (charrette arch 7): EditHistory.checkpoint(label) +
 * undoToCheckpoint(). A checkpoint is a coarse rewind point — stamped on the
 * top-of-undo command at a milestone (Tempo Map entry, Suggest-fit accept,
 * barline lock) — and Ctrl+Alt+Z rewinds through it in one step.
 *
 * Real EditHistory over the real S (tests/_history_env.mjs), with trivial
 * songScope commands that log their exec/rollback so the sequence is visible.
 *
 * Run: node tests/undo_checkpoints.test.mjs
 */
import assert from 'node:assert';
import { S } from '../src/state.js';
import { EditHistory } from '../src/history.js';
import { seedState, trackHooks } from './_history_env.mjs';

let pass = 0, fail = 0;
function t(name, fn) {
    try { fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}

// A minimal undoable command that records its exec/rollback into `log`.
// songScope so the read-only-roll lock never refuses it and undo tags it -1.
function mkCmd(tag, log) {
    return { songScope: true, exec() { log.push('+' + tag); }, rollback() { log.push('-' + tag); } };
}
function fresh() {
    seedState({ arrangements: [{ name: 'Guitar', notes: [] }], currentArr: 0 });
    trackHooks();
    S.history = new EditHistory();
    return S.history;
}

t('undoToCheckpoint rewinds through (and including) the stamped command', () => {
    const log = [];
    const h = fresh();
    h.exec(mkCmd('a', log));
    h.exec(mkCmd('b', log));
    h.checkpoint('cp');            // stamps 'b' (current top)
    h.exec(mkCmd('c', log));
    h.exec(mkCmd('d', log));
    const r = h.undoToCheckpoint();
    assert.strictEqual(r.undone, 3, 'undoes d, c, and the stamped b');
    assert.strictEqual(r.label, 'cp');
    assert.strictEqual(r.foundCheckpoint, true);
    assert.deepStrictEqual(log.slice(-3), ['-d', '-c', '-b']);
    assert.strictEqual(h.undo.length, 1, 'only the pre-checkpoint command remains');
});

t('with no checkpoint anywhere, it degrades to a single plain undo', () => {
    const log = [];
    const h = fresh();
    h.exec(mkCmd('a', log));
    h.exec(mkCmd('b', log));
    const r = h.undoToCheckpoint();
    assert.strictEqual(r.undone, 1);
    assert.strictEqual(r.foundCheckpoint, false);
    assert.strictEqual(r.label, null);
    assert.strictEqual(h.undo.length, 1, 'did NOT rewind the whole stack');
    assert.deepStrictEqual(log.slice(-1), ['-b']);
});

t('the checkpoint stamp survives an undo/redo round-trip', () => {
    const log = [];
    const h = fresh();
    h.exec(mkCmd('a', log));
    h.checkpoint('cp');            // stamps 'a'
    h.exec(mkCmd('b', log));
    h.undoToCheckpoint();          // undoes b, then a (stamped) -> stack empty
    assert.strictEqual(h.undo.length, 0);
    h.doRedo();                    // re-exec a
    h.doRedo();                    // re-exec b
    assert.strictEqual(h.undo.length, 2);
    const r = h.undoToCheckpoint();
    assert.strictEqual(r.label, 'cp', 'stamp still on the redone command');
    assert.strictEqual(r.foundCheckpoint, true);
});

t('the no-progress guard stops when doUndo refuses (never spins)', () => {
    const log = [];
    const h = fresh();
    h.exec(mkCmd('a', log));
    h.checkpoint('cp');
    h.exec(mkCmd('b', log));
    trackHooks({ ensureArr: () => false });   // every doUndo is refused
    const r = h.undoToCheckpoint();
    assert.strictEqual(r.undone, 0, 'nothing could be undone');
    assert.strictEqual(h.undo.length, 2, 'stack untouched — no infinite loop');
});

t('checkpoint() is a no-op on an empty stack', () => {
    const log = [];
    const h = fresh();
    h.checkpoint('x');            // nothing to stamp
    h.exec(mkCmd('a', log));
    // 'a' was never stamped, so undoToCheckpoint takes the single-undo path.
    const r = h.undoToCheckpoint();
    assert.strictEqual(r.foundCheckpoint, false);
    assert.strictEqual(r.undone, 1);
});

t('undoToCheckpoint on an empty stack reports zero, no throw', () => {
    const h = fresh();
    const r = h.undoToCheckpoint();
    assert.deepStrictEqual(r, { undone: 0, label: null, foundCheckpoint: false });
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
