'use strict';
/*
 * Tests for EditHistory.reset() (feedback-plugin-editor#18).
 *
 * Bug: undo commands snapshot note-ARRAY indices at construction. On save/build,
 * _buildSaveBody()/editorBuild() run flattenChords()+reconstructChords(), which
 * does `arr.notes = newNotes` and moves same-time groups into arr.chords —
 * renumbering the array. The undo history was reset only on song load, so undoing
 * a pre-save command indexed into the wrong note (or undefined). Fix: reset the
 * undo/redo stacks in the save/build `finally` blocks (runs even if the POST
 * fails, since the model is rebuilt regardless). This unit-tests the new
 * EditHistory.reset() that those call sites use.
 *
 * Manual repro verified (full headless save round-trip not driven in CI):
 *   1. Select a 2+ note same-time group, "Group as strum".
 *   2. Save (chart or sloppak) -> reconstructChords() moves them into a chord.
 *   3. Undo -> previously mutated the wrong note / threw; now a no-op because the
 *      stack was reset by the save's `finally`.
 *
 * screen.js is a single browser IIFE, so this extracts the `@pure:edit-history`
 * marked block (browser-free) and eval's it in isolation — real source, no drift.
 *
 * Run: node tests/edit_history_reset.test.js
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const src = fs.readFileSync(path.join(__dirname, '..', 'screen.js'), 'utf8');
const m = src.match(/\/\* @pure:edit-history:start \*\/[\s\S]*?\/\* @pure:edit-history:end \*\//);
if (!m) {
    console.error('FAIL: @pure:edit-history block not found in screen.js');
    process.exit(1);
}

// _ui() reads document.getElementById('editor-undo'/'editor-redo'); stub it so
// the class is browser-free. Each call returns the same fake button objects so
// the test can assert their `.disabled` state after reset().
function makeHistory() {
    const buttons = {
        'editor-undo': { disabled: false },
        'editor-redo': { disabled: false },
    };
    const documentStub = { getElementById: (id) => buttons[id] || null };
    const { EditHistory } = new Function(
        'document',
        '"use strict";' + m[0] + '\nreturn { EditHistory };'
    )(documentStub);
    return { history: new EditHistory(), buttons };
}

let pass = 0, fail = 0;
function t(name, fn) {
    try { fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}

// ── reset() empties both stacks ──────────────────────────────────────────────
t('reset() empties undo and redo stacks', () => {
    const { history } = makeHistory();
    // Simulate post-edit state: index-based commands captured before a save.
    history.undo.push({ index: 0 }, { index: 1 });
    history.redo.push({ index: 2 });
    history.reset();
    assert.strictEqual(history.undo.length, 0);
    assert.strictEqual(history.redo.length, 0);
});

// ── reset() refreshes the undo/redo button enabled-state via _ui() ───────────
t('reset() disables both undo and redo buttons (proves _ui ran)', () => {
    const { history, buttons } = makeHistory();
    history.undo.push({ index: 0 });
    history.redo.push({ index: 1 });
    history._ui();
    assert.strictEqual(buttons['editor-undo'].disabled, false, 'precondition: undo enabled');
    assert.strictEqual(buttons['editor-redo'].disabled, false, 'precondition: redo enabled');
    history.reset();
    assert.strictEqual(buttons['editor-undo'].disabled, true);
    assert.strictEqual(buttons['editor-redo'].disabled, true);
});

// ── reset() is safe / idempotent on an already-empty history ─────────────────
t('reset() is a safe no-op on an empty history', () => {
    const { history, buttons } = makeHistory();
    history.reset();
    history.reset();
    assert.strictEqual(history.undo.length, 0);
    assert.strictEqual(history.redo.length, 0);
    assert.strictEqual(buttons['editor-undo'].disabled, true);
    assert.strictEqual(buttons['editor-redo'].disabled, true);
});

// ── reset() tolerates missing DOM buttons (jsdom-free / pre-mount) ───────────
t('reset() tolerates absent undo/redo buttons', () => {
    const { EditHistory } = new Function(
        'document',
        '"use strict";' + m[0] + '\nreturn { EditHistory };'
    )({ getElementById: () => null });
    const h = new EditHistory();
    h.undo.push({ index: 0 });
    assert.doesNotThrow(() => h.reset());
    assert.strictEqual(h.undo.length, 0);
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
