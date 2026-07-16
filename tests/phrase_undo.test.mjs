'use strict';
/*
 * Tests for the undoable phrase add (@pure:phrase-cmds block driven through the
 * REAL @pure:edit-history EditHistory — no stub of the subject).
 *
 * arr.phrases ([{name, number, start_time, levels}], kept sorted by start_time)
 * was added with a raw push+sort and NO undo — the only add-* verb that
 * bypassed EditHistory, so Ctrl+Z after a phrase-add rolled back the previous
 * edit instead. AddPhraseCmd routes the add through the history, holding the
 * phrases ARRAY + phrase OBJECT by reference so exec↔rollback restore the array
 * exactly (sort order included), and each add is its own LIFO step. These
 * assertions fail on main (AddPhraseCmd does not exist there).
 *
 * Run: node tests/phrase_undo.test.mjs
 */
import assert from 'node:assert';
import fs from 'node:fs';
import { EditHistory } from '../src/history.js';
import { _rollReadOnly } from '../src/keys.js';
import { seedState, trackHooks } from './_history_env.mjs';

const src = fs.readFileSync(new URL('../src/input.js', import.meta.url), 'utf8');
function extract(name) {
    const re = new RegExp(
        '/\\* @pure:' + name + ':start \\*/[\\s\\S]*?/\\* @pure:' + name + ':end \\*/');
    const m = src.match(re);
    if (!m) { console.error(`FAIL: @pure:${name} block missing`); process.exit(1); }
    return m[0];
}

// The REAL EditHistory + the REAL phrase command sliced from source. The
// command operates on the phrases array it is handed, so no global state is
// needed beyond a live history.
function makeEnv() {
    const S = seedState({ sections: [], history: null });
    const api = new Function(
        'S',
        '"use strict";'
        + extract('phrase-cmds') + '\n'
        + 'return { AddPhraseCmd };'
    )(S);
    trackHooks();
    S.history = new EditHistory();
    return { ...api, S, history: S.history };
}

const clone = (x) => JSON.parse(JSON.stringify(x));

let pass = 0, fail = 0;
function t(name, fn) {
    try { fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}

// ── AddPhraseCmd ─────────────────────────────────────────────────────────────
t('add: exec inserts sorted; rollback restores the model exactly; redo reproduces', () => {
    const env = makeEnv();
    const phrases = [
        { name: 'intro', number: 1, start_time: 0, levels: [] },
        { name: 'phrase', number: 1, start_time: 8, levels: [] },
    ];
    const before = clone(phrases);
    env.S.history.exec(new env.AddPhraseCmd(phrases,
        { name: 'phrase', number: 2, start_time: 4, levels: [] }));
    assert.deepStrictEqual(phrases.map(p => p.start_time), [0, 4, 8], 'inserted in sorted position');
    env.S.history.doUndo();
    assert.deepStrictEqual(phrases, before, 'rollback restores the exact model');
    env.S.history.doRedo();
    assert.deepStrictEqual(phrases.map(p => p.start_time), [0, 4, 8], 'redo reproduces');
});

t('add: an out-of-order start_time still lands sorted, and undo removes only it', () => {
    const env = makeEnv();
    const phrases = [{ name: 'a', number: 1, start_time: 10, levels: [] }];
    const before = clone(phrases);
    env.S.history.exec(new env.AddPhraseCmd(phrases,
        { name: 'b', number: 1, start_time: 2, levels: [] }));
    assert.deepStrictEqual(phrases.map(p => p.start_time), [2, 10]);
    env.S.history.doUndo();
    assert.deepStrictEqual(phrases, before);
});

// The exact trap this closes: a phrase add must be its OWN undo step, so undoing
// it leaves the earlier edit intact — it never rolls back the wrong thing.
t('interleaved: each add is its own LIFO step; undo removes only the last', () => {
    const env = makeEnv();
    const phrases = [];
    env.S.history.exec(new env.AddPhraseCmd(phrases, { name: 'p', number: 1, start_time: 0, levels: [] }));
    const snap1 = clone(phrases);
    env.S.history.exec(new env.AddPhraseCmd(phrases, { name: 'p', number: 2, start_time: 4, levels: [] }));
    env.S.history.doUndo();                       // undo the second add only
    assert.deepStrictEqual(phrases, snap1, 'only the last phrase add is undone');
    assert.strictEqual(phrases.length, 1, 'the earlier phrase survives — no wrong-edit rollback');
});

// Two phrases sharing a start_time: stable sort keeps insertion order, so the
// ref-based rollback removes exactly the one that was added.
t('equal start_times: undo removes the added ref, the pre-existing one untouched', () => {
    const env = makeEnv();
    const phrases = [{ name: 'a', number: 1, start_time: 4, levels: [] }];
    const before = clone(phrases);
    env.S.history.exec(new env.AddPhraseCmd(phrases, { name: 'b', number: 1, start_time: 4, levels: [] }));
    assert.strictEqual(phrases.length, 2);
    env.S.history.doUndo();
    assert.deepStrictEqual(phrases, before, 'the pre-existing equal-time phrase is untouched');
});

// A fresh exec drops the redo stack — AddPhraseCmd is an ordinary EditHistory
// command with no bespoke redo handling.
t('exec clears redo: add → undo → (new) add leaves nothing to redo', () => {
    const env = makeEnv();
    const phrases = [];
    env.S.history.exec(new env.AddPhraseCmd(phrases, { name: 'p', number: 1, start_time: 4, levels: [] }));
    env.S.history.doUndo();                       // the phrase is now redoable
    assert.strictEqual(env.S.history.redo.length, 1, 'undo populated the redo stack');
    env.S.history.exec(new env.AddPhraseCmd(phrases, { name: 'p', number: 1, start_time: 8, levels: [] }));
    assert.strictEqual(env.S.history.redo.length, 0, 'the new exec dropped the redo stack');
    const after = clone(phrases);
    env.S.history.doRedo();                        // must be a no-op now
    assert.deepStrictEqual(phrases, after, 'redo does nothing — the abandoned phrase is not resurrected');
});

// The read-only-roll lock (a fretted part shown in the piano roll) refuses any
// command that doesn't opt out — it guards against silent PITCH writes to the
// fretted chart. A phrase add writes no notes, so routing it through the history
// must NOT let the lock swallow it (the pre-history raw push always worked). The
// songScope carve-out makes it pass; an unflagged command still gets refused.
t('read-only roll: the structural phrase add bypasses the lock (unflagged commands do not)', () => {
    const env = makeEnv();
    // Fretted part ("Lead") shown in the piano roll = the read-only lock is live.
    seedState({ arrangements: [{ id: 'a1', name: 'Lead', notes: [], chords: [] }],
        currentArr: 0, rollView: true });
    assert.ok(_rollReadOnly(), 'harness: the roll is read-only for a fretted part');

    // Control: an unflagged command IS refused here — proves the lock is engaged.
    let ran = 0;
    env.S.history.exec({ exec() { ran++; }, rollback() { ran--; } });
    assert.strictEqual(ran, 0, 'harness bites: an unflagged command is blocked by the live lock');

    // The phrase add (songScope) goes through anyway and undoes cleanly.
    const phrases = [];
    env.S.history.exec(new env.AddPhraseCmd(phrases, { name: 'p', number: 1, start_time: 0, levels: [] }));
    assert.strictEqual(phrases.length, 1, 'the phrase was added — songScope passed the lock');
    env.S.history.doUndo();
    assert.strictEqual(phrases.length, 0, 'and it rolls back even from inside the locked roll');
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
