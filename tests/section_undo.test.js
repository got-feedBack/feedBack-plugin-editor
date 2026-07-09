'use strict';
/*
 * Tests for undoable section editing (@pure:section-cmds block driven through
 * the REAL @pure:edit-history EditHistory — no stub of the subject).
 *
 * Sections (S.sections = [{name, number, start_time}], kept sorted by
 * start_time) were added/renamed/deleted with raw push/splice/assignment and
 * NO undo: a stray Delete on a section was unrecoverable, and Ctrl+Z after
 * adding one rolled back the last NOTE edit instead. AddSectionCmd /
 * RemoveSectionCmd / RenameSectionCmd route those mutations through the undo
 * history.
 *
 * Every real edit is round-tripped: exec → rollback restores S.sections EXACTLY
 * (deep-equality of the whole array, sort order included), and exec → rollback
 * → redo reproduces. Adversarial inputs (equal start_times, unsorted insert)
 * and the helper-uses-its-argument check are covered too, plus the
 * plain-EditHistory invariant that a fresh exec() drops the redo stack. The one
 * deliberate NON-round-trip is the delete-nonexistent case: exec is a no-op, so
 * undo takes RemoveSectionCmd's idx<0 sorted-insert fallback (it re-inserts the
 * absent section rather than restoring the pre-exec array — that branch's
 * documented behavior is exactly what the test pins). These assertions fail on
 * main (the command classes don't exist there).
 *
 * Run: node tests/section_undo.test.js
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
function extract(name) {
    const re = new RegExp(
        '/\\* @pure:' + name + ':start \\*/[\\s\\S]*?/\\* @pure:' + name + ':end \\*/');
    const m = src.match(re);
    if (!m) { console.error(`FAIL: @pure:${name} block missing`); process.exit(1); }
    return m[0];
}

// Build an isolated world: the REAL EditHistory + the REAL section commands,
// with S / draw / updateStatus injected. EditHistory._ui reads two buttons —
// stub getElementById to return fakes. draw/updateStatus are no-ops.
function makeEnv(initialSections) {
    const S = { sections: initialSections || [], history: null };
    const documentStub = { getElementById: () => ({ disabled: false }) };
    const api = new Function(
        'S', 'document', 'draw', 'updateStatus',
        '"use strict";'
        + extract('edit-history') + '\n' + extract('section-cmds') + '\n'
        + 'return { EditHistory, AddSectionCmd, RemoveSectionCmd, RenameSectionCmd,'
        + ' _sectionNearestIndexPure };'
    )(S, documentStub, () => {}, () => {});
    S.history = new api.EditHistory();
    return { ...api, S };
}

// Deep clone for before/after model comparison.
const clone = (x) => JSON.parse(JSON.stringify(x));

let pass = 0, fail = 0;
function t(name, fn) {
    try { fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}

// ── AddSectionCmd ────────────────────────────────────────────────────────────
t('add: exec inserts sorted; rollback restores the model exactly; redo reproduces', () => {
    const env = makeEnv([
        { name: 'intro', number: 1, start_time: 0 },
        { name: 'chorus', number: 1, start_time: 8 },
    ]);
    const before = clone(env.S.sections);
    env.S.history.exec(new env.AddSectionCmd({ name: 'verse', number: 1, start_time: 4 }));
    assert.deepStrictEqual(env.S.sections.map(s => s.start_time), [0, 4, 8],
        'inserted in sorted position');
    env.S.history.doUndo();
    assert.deepStrictEqual(env.S.sections, before, 'rollback restores the exact model');
    env.S.history.doRedo();
    assert.deepStrictEqual(env.S.sections.map(s => s.name), ['intro', 'verse', 'chorus']);
});

t('add: an out-of-order start_time still lands sorted, and undo removes only it', () => {
    const env = makeEnv([{ name: 'a', number: 1, start_time: 10 }]);
    const before = clone(env.S.sections);
    env.S.history.exec(new env.AddSectionCmd({ name: 'b', number: 1, start_time: 2 }));
    assert.deepStrictEqual(env.S.sections.map(s => s.start_time), [2, 10]);
    env.S.history.doUndo();
    assert.deepStrictEqual(env.S.sections, before);
});

// ── RemoveSectionCmd ─────────────────────────────────────────────────────────
t('delete: exec removes the ref; rollback re-inserts sorted; model round-trips', () => {
    const s1 = { name: 'a', number: 1, start_time: 0 };
    const s2 = { name: 'b', number: 1, start_time: 5 };
    const s3 = { name: 'c', number: 1, start_time: 9 };
    const env = makeEnv([s1, s2, s3]);
    const before = clone(env.S.sections);
    env.S.history.exec(new env.RemoveSectionCmd(s2));
    assert.deepStrictEqual(env.S.sections.map(s => s.name), ['a', 'c']);
    env.S.history.doUndo();
    assert.deepStrictEqual(env.S.sections, before, 'deleted section restored in place');
    env.S.history.doRedo();
    assert.deepStrictEqual(env.S.sections.map(s => s.name), ['a', 'c']);
});

// ── RenameSectionCmd ─────────────────────────────────────────────────────────
t('rename: exec sets the new name; rollback restores the old; number untouched', () => {
    const s = { name: 'verse', number: 2, start_time: 4 };
    const env = makeEnv([s]);
    env.S.history.exec(new env.RenameSectionCmd(s, 'chorus'));
    assert.strictEqual(s.name, 'chorus');
    assert.strictEqual(s.number, 2, 'number field is left as-is (unchanged behavior)');
    env.S.history.doUndo();
    assert.strictEqual(s.name, 'verse');
    env.S.history.doRedo();
    assert.strictEqual(s.name, 'chorus');
});

// ── adversarial: equal start_times ───────────────────────────────────────────
t('two sections at the same start_time: ref-delete removes the right one, undo restores order', () => {
    const a = { name: 'a', number: 1, start_time: 4 };
    const b = { name: 'b', number: 1, start_time: 4 };
    const env = makeEnv([a, b]);       // stable sort keeps insertion order
    const before = clone(env.S.sections);
    env.S.history.exec(new env.RemoveSectionCmd(a));
    assert.deepStrictEqual(env.S.sections.map(s => s.name), ['b'], 'removed a, not b');
    env.S.history.doUndo();
    assert.deepStrictEqual(env.S.sections, before, 'both restored in original order');
});

t('interleaved edits undo in strict reverse order (LIFO), model exact at each step', () => {
    const env = makeEnv([{ name: 'intro', number: 1, start_time: 0 }]);
    const snap0 = clone(env.S.sections);
    env.S.history.exec(new env.AddSectionCmd({ name: 'v', number: 1, start_time: 4 }));
    const snap1 = clone(env.S.sections);
    const v = env.S.sections.find(s => s.name === 'v');
    env.S.history.exec(new env.RenameSectionCmd(v, 'verse'));
    env.S.history.doUndo();                       // undo rename
    assert.deepStrictEqual(env.S.sections, snap1);
    env.S.history.doUndo();                       // undo add
    assert.deepStrictEqual(env.S.sections, snap0);
});

// ── adversarial: delete a section that isn't in the array ────────────────────
t('delete-nonexistent: exec removes nothing; undo takes the idx<0 sorted-insert fallback', () => {
    const a = { name: 'a', number: 1, start_time: 0 };
    const c = { name: 'c', number: 1, start_time: 20 };
    const env = makeEnv([a, c]);
    const before = clone(env.S.sections);
    // A section object that was never inserted into S.sections: exec's indexOf
    // is -1, so nothing splices out and `idx` stays -1. `start_time` is placed
    // AFTER every existing section so the sorted-insert fallback lands it last —
    // a naive unguarded `splice(this.idx, 0, section)` with idx === -1 would
    // instead splice before the last element (['a','ghost','c']), so this
    // assertion genuinely distinguishes the fallback from that bug.
    const ghost = { name: 'ghost', number: 1, start_time: 30 };
    const cmd = new env.RemoveSectionCmd(ghost);
    env.S.history.exec(cmd);
    assert.strictEqual(cmd.idx, -1, 'exec found no matching section');
    assert.deepStrictEqual(env.S.sections, before, 'exec removed nothing');
    // rollback hits the `idx < 0` branch: a sorted insert, not splice-at-idx.
    env.S.history.doUndo();
    assert.deepStrictEqual(env.S.sections.map(s => s.name), ['a', 'c', 'ghost'],
        'fallback re-inserts in sorted position (last, by start_time)');
});

// ── a fresh exec() drops the redo stack (section commands are ordinary
//    EditHistory commands, with no bespoke redo handling) ─────────────────────
t('exec clears redo: add → undo → (new) rename leaves nothing to redo', () => {
    const env = makeEnv([{ name: 'intro', number: 1, start_time: 0 }]);
    env.S.history.exec(new env.AddSectionCmd({ name: 'verse', number: 1, start_time: 4 }));
    env.S.history.doUndo();                       // 'verse' is now redoable
    assert.strictEqual(env.S.history.redo.length, 1, 'undo populated the redo stack');
    const intro = env.S.sections.find(s => s.name === 'intro');
    env.S.history.exec(new env.RenameSectionCmd(intro, 'intro2'));   // a fresh edit
    assert.strictEqual(env.S.history.redo.length, 0, 'the new exec dropped the redo stack');
    const after = clone(env.S.sections);
    env.S.history.doRedo();                        // must be a no-op now
    assert.deepStrictEqual(env.S.sections, after, 'redo does nothing — verse is not resurrected');
    assert.ok(!env.S.sections.some(s => s.name === 'verse'),
        'the abandoned redo never comes back');
});

// ── helper uses its arguments (not a global) ─────────────────────────────────
t('_sectionNearestIndexPure keys off the time+tol it is given', () => {
    const env = makeEnv();
    const secs = [
        { name: 'a', start_time: 0 },
        { name: 'b', start_time: 10 },
        { name: 'c', start_time: 20 },
    ];
    assert.strictEqual(env._sectionNearestIndexPure(secs, 10.4, 1.0), 1, 'within tol');
    assert.strictEqual(env._sectionNearestIndexPure(secs, 10.4, 0.2), -1, 'tol argument respected');
    // Different query times yield different results — proves it reads `time`.
    assert.notStrictEqual(
        env._sectionNearestIndexPure(secs, 0, 1.0),
        env._sectionNearestIndexPure(secs, 20, 1.0));
    // Degenerate inputs.
    assert.strictEqual(env._sectionNearestIndexPure(null, 0, 1.0), -1);
    assert.strictEqual(env._sectionNearestIndexPure([], 0, 1.0), -1);
    assert.strictEqual(env._sectionNearestIndexPure(secs, NaN, 1.0), -1);
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
