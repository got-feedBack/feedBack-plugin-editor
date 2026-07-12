/*
 * Undo checkpoints (charrette arch 7): EditHistory.checkpoint(label) +
 * undoToCheckpoint(). A checkpoint marks "the state as of this call" — stamped
 * on the top-of-undo command at a milestone (Tempo Map entry, Suggest-fit
 * accept, barline lock) — and Ctrl+Alt+Z rewinds everything ABOVE the stamp in
 * one step, leaving the stamped command itself applied.
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

t('undoToCheckpoint rewinds to the stamp, keeping the stamped command applied', () => {
    const log = [];
    const h = fresh();
    h.exec(mkCmd('a', log));
    h.exec(mkCmd('b', log));
    h.checkpoint('cp');            // "the state as of now" — right after 'b'
    h.exec(mkCmd('c', log));
    h.exec(mkCmd('d', log));
    const r = h.undoToCheckpoint();
    assert.strictEqual(r.undone, 2, 'undoes d and c — NOT the stamped b');
    assert.strictEqual(r.label, 'cp');
    assert.strictEqual(r.foundCheckpoint, true);
    assert.deepStrictEqual(log.slice(-2), ['-d', '-c']);
    assert.strictEqual(h.undo.length, 2, 'a and the stamped b both remain applied');
});

// Regression (checkpoint overshoot): a Tempo-Map-entry / barline-lock
// checkpoint stamps the last edit made BEFORE the milestone. Rolling that edit
// back too would silently lose one pre-session edit while the status line
// claims a clean return "back to checkpoint".
t('a pre-milestone edit under the stamp survives the rewind', () => {
    const log = [];
    const h = fresh();
    h.exec(mkCmd('note', log));       // user's last edit before entering Tempo Map
    h.checkpoint('Tempo Map session');
    h.exec(mkCmd('drag1', log));
    h.exec(mkCmd('drag2', log));
    h.undoToCheckpoint();
    assert.ok(!log.includes('-note'), 'the pre-session edit was NOT rolled back');
    assert.strictEqual(h.undo.length, 1, 'the pre-session edit is still applied');
});

t('repeated presses walk back checkpoint by checkpoint, then degrade', () => {
    const log = [];
    const h = fresh();
    h.exec(mkCmd('a', log));
    h.checkpoint('A');
    h.exec(mkCmd('b', log));
    h.exec(mkCmd('c', log));
    h.checkpoint('B');
    h.exec(mkCmd('d', log));
    const r1 = h.undoToCheckpoint();
    assert.strictEqual(r1.label, 'B');
    assert.strictEqual(r1.undone, 1, 'first press: back to B (undoes d only)');
    const r2 = h.undoToCheckpoint();
    assert.strictEqual(r2.label, 'A', 'second press at B targets the previous checkpoint');
    assert.strictEqual(r2.undone, 2, 'undoes c and b');
    assert.strictEqual(h.undo.length, 1);
    const r3 = h.undoToCheckpoint();
    assert.strictEqual(r3.foundCheckpoint, false, 'at A with nothing earlier: degrade to one undo');
    assert.strictEqual(r3.undone, 1, 'single plain undo, not inert');
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
    h.doUndo();                    // roll a's stamp through the redo stack:
    h.doUndo();                    // undo b, then the stamped a
    assert.strictEqual(h.undo.length, 0);
    h.doRedo();                    // re-exec a
    h.doRedo();                    // re-exec b
    assert.strictEqual(h.undo.length, 2);
    const r = h.undoToCheckpoint();
    assert.strictEqual(r.label, 'cp', 'stamp still on the redone command');
    assert.strictEqual(r.foundCheckpoint, true);
    assert.strictEqual(r.undone, 1, 'undoes b, lands on the redone stamped a');
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
