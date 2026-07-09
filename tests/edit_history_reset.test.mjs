/*
 * Tests for EditHistory.reset() (feedback-plugin-editor#18).
 *
 * Bug: undo commands snapshot note-ARRAY indices at construction. On save/build,
 * _buildSaveBody()/editorBuild() run flattenChords()+reconstructChords(), which
 * does `arr.notes = newNotes` and moves same-time groups into arr.chords —
 * renumbering the array. The undo history was reset only on song load, so undoing
 * a pre-save command indexed into the wrong note (or undefined). Fix: reset the
 * undo/redo stacks in the save/build `finally` blocks (runs even if the POST
 * fails, since the model is rebuilt regardless). This unit-tests the
 * EditHistory.reset() that those call sites use.
 *
 * Manual repro verified (full headless save round-trip not driven in CI):
 *   1. Select a 2+ note same-time group, "Group as strum".
 *   2. Save (chart or sloppak) -> reconstructChords() moves them into a chord.
 *   3. Undo -> previously mutated the wrong note / threw; now a no-op because the
 *      stack was reset by the save's `finally`.
 *
 * Run: node tests/edit_history_reset.test.mjs
 */
import assert from 'node:assert';
import { EditHistory } from '../src/history.js';
import { redoBtn, undoBtn } from './_history_env.mjs';

let pass = 0, fail = 0;
function t(name, fn) {
    try { fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}

function makeHistory() {
    const history = new EditHistory();
    undoBtn().disabled = false;
    redoBtn().disabled = false;
    return history;
}

// ── reset() empties both stacks ──────────────────────────────────────────────
t('reset() empties undo and redo stacks', () => {
    const history = makeHistory();
    // Simulate post-edit state: index-based commands captured before a save.
    history.undo.push({ index: 0 }, { index: 1 });
    history.redo.push({ index: 2 });
    history.reset();
    assert.strictEqual(history.undo.length, 0);
    assert.strictEqual(history.redo.length, 0);
});

// ── reset() refreshes the undo/redo button enabled-state via _ui() ───────────
t('reset() disables both undo and redo buttons (proves _ui ran)', () => {
    const history = makeHistory();
    history.undo.push({ index: 0 });
    history.redo.push({ index: 1 });
    history._ui();
    assert.strictEqual(undoBtn().disabled, false, 'precondition: undo enabled');
    assert.strictEqual(redoBtn().disabled, false, 'precondition: redo enabled');
    history.reset();
    assert.strictEqual(undoBtn().disabled, true);
    assert.strictEqual(redoBtn().disabled, true);
});

// ── reset() is safe / idempotent on an already-empty history ─────────────────
t('reset() is a safe no-op on an empty history', () => {
    const history = makeHistory();
    history.reset();
    history.reset();
    assert.strictEqual(history.undo.length, 0);
    assert.strictEqual(history.redo.length, 0);
    assert.strictEqual(undoBtn().disabled, true);
    assert.strictEqual(redoBtn().disabled, true);
});

// ── reset() tolerates missing DOM buttons (jsdom-free / pre-mount) ───────────
t('reset() tolerates absent undo/redo buttons', () => {
    const real = globalThis.document;
    globalThis.document = { getElementById: () => null };
    try {
        const h = new EditHistory();
        h.undo.push({ index: 0 });
        assert.doesNotThrow(() => h.reset());
        assert.strictEqual(h.undo.length, 0);
    } finally {
        globalThis.document = real;
    }
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
