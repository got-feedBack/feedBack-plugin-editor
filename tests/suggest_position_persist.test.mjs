/*
 * Suggest-position MARK PERSISTENCE — P6 review follow-up (design V4, D15).
 *
 * Suggested marks live in a module WeakSet keyed by note-object identity, so a
 * save's flatten+reconstructChords rebuild and a reload both mint fresh note
 * objects and DROP every mark — after a reload the machine's UNREVIEWED guesses
 * would render as CONFIRMED and "positions unresolved: N" would reset to 0.
 * Mirroring beat-lock persistence, marks are written to localStorage keyed by
 * filename (stable {time,string,fret} identity, NEVER the pack) and re-attached
 * onto the current note objects on load / post-save reflatten. Covered:
 *   1. serialize → keyed store; ms-rounded identities; empty clears the key.
 *   2. defensive parse: junk / non-array / bad values drop out, never throws.
 *   3. re-attach repopulates marks onto FRESHLY-REBUILT objects by identity, so
 *      _suggestedCount survives a simulated reconstruct/reload (fails pre-fix:
 *      WeakSet-only would report 0 after the rebuild).
 *   4. identity match: string+fret exact, time within tol; greedy 1:1.
 *
 * References review-fix code absent on main / pre-fix, so the suite fails there.
 *
 * Run: node tests/suggest_position_persist.test.mjs
 */
import assert from 'node:assert';
import * as marks from '../src/notes.js';
import { S } from '../src/state.js';

let pass = 0, fail = 0;
function t(name, fn) {
    try { fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + (e && e.message)); }
}

function fakeStore() {
    const m = new Map();
    return {
        getItem: k => (m.has(k) ? m.get(k) : null),
        setItem: (k, v) => m.set(k, String(v)),
        removeItem: k => m.delete(k),
        _m: m,
    };
}

// Everything under test now lives in src/notes.js, so there is no sandbox left:
// drive the REAL `S` and install the fake store on globalThis, which is where the
// module resolves `localStorage` at call time. Each env builds fresh note objects,
// so the identity-keyed WeakSet cannot leak marks between cases.
function makeEnv(seed, filename) {
    const localStorage = fakeStore();
    globalThis.localStorage = localStorage;
    S.currentArr = 0;
    S.filename = filename || 'song.archive';
    S.arrangements = [{ name: 'Lead', notes: seed.map(n => ({ ...n })) }];
    return { S, env: marks, localStorage, notes: () => S.arrangements[0].notes };
}

// Swap arr.notes for fresh objects with the SAME identities — models what a
// reconstructChords rebuild / reload does (new refs, so the WeakSet is dropped).
function rebuildNotes(S) {
    S.arrangements[0].notes = S.arrangements[0].notes.map(n => ({ ...n }));
}

// ── 1. serialize ──────────────────────────────────────────────────────────────
t('marks serialize to a per-file keyed store as ms-rounded {time,string,fret}', () => {
    const { S, env, localStorage } = makeEnv([
        { time: 0.12349, string: 3, fret: 1, sustain: 0 },
        { time: 1, string: 2, fret: 6, sustain: 0 },   // left unmarked
    ]);
    env._markSuggested(S.arrangements[0].notes[0]);
    env._saveSuggestedMarks();
    const raw = localStorage.getItem('editorSuggested:song.archive:0');
    assert.ok(raw, 'wrote under the per-file, per-arrangement key');
    const arr = JSON.parse(raw);
    assert.deepStrictEqual(arr, [{ time: 0.123, string: 3, fret: 1 }], 'only the marked note, ms-rounded');
});

t('an empty mark set CLEARS the key (no stale marks linger)', () => {
    const { env, localStorage } = makeEnv([{ time: 0, string: 3, fret: 1, sustain: 0 }]);
    localStorage.setItem('editorSuggested:song.archive:0', '[{"time":0,"string":3,"fret":1}]');
    env._saveSuggestedMarks();   // nothing marked
    assert.strictEqual(localStorage.getItem('editorSuggested:song.archive:0'), null, 'key removed');
});

t('marks are scoped per-arrangement — arr 1 marks do not bleed onto arr 0', () => {
    const { S, env, localStorage } = makeEnv([{ time: 0, string: 3, fret: 1, sustain: 0 }]);
    // Add a second arrangement carrying a note with an identical identity.
    S.arrangements.push({ name: 'Rhythm', notes: [{ time: 0, string: 3, fret: 1, sustain: 0 }] });
    S.currentArr = 1;
    env._markSuggested(S.arrangements[1].notes[0]);
    env._saveSuggestedMarks();
    assert.ok(localStorage.getItem('editorSuggested:song.archive:1'), 'persisted under arr-1 key');
    assert.strictEqual(localStorage.getItem('editorSuggested:song.archive:0'), null, 'arr-0 key untouched');
    // A reload lands on arr 0: its identical-identity note must NOT get marked.
    S.currentArr = 0;
    env._restoreSuggestedMarks();
    assert.ok(!env._isSuggested(S.arrangements[0].notes[0]), 'arr-0 note stays unmarked');
    // Switching to arr 1 restores its mark.
    S.currentArr = 1;
    env._restoreSuggestedMarks();
    assert.ok(env._isSuggested(S.arrangements[1].notes[0]), 'arr-1 note restored on switch');
});

// ── 2. defensive parse ─────────────────────────────────────────────────────────
t('defensive parse: junk / non-array / bad values drop out, never throws', () => {
    const { env } = makeEnv([]);
    const P = env._suggestedParsePure;
    assert.deepStrictEqual(P('not json{'), [], 'garbage → []');
    assert.deepStrictEqual(P('null'), [], 'null → []');
    assert.deepStrictEqual(P('{"time":0}'), [], 'non-array object → []');
    assert.deepStrictEqual(P('[1,2,3]'), [], 'primitive entries dropped');
    assert.deepStrictEqual(P('[{"time":-1,"string":0,"fret":0}]'), [], 'negative time dropped');
    assert.deepStrictEqual(P('[{"time":0,"string":1.5,"fret":0}]'), [], 'non-integer string dropped');
    assert.deepStrictEqual(
        P('[{"time":0.5,"string":3,"fret":1,"junk":9},{"bad":true}]'),
        [{ time: 0.5, string: 3, fret: 1 }],
        'valid entry kept (extra fields ignored), invalid dropped');
});

// ── 3. reconstruct/reload survival ─────────────────────────────────────────────
t('_suggestedCount survives a simulated reconstruct/reload via persist + re-attach', () => {
    const { S, env } = makeEnv([
        { time: 0, string: 3, fret: 1, sustain: 0 },   // solo-shaped
        { time: 1, string: 0, fret: 3, sustain: 0 },   // chord member
        { time: 1, string: 1, fret: 2, sustain: 0 },   // chord member
    ]);
    for (const n of S.arrangements[0].notes) env._markSuggested(n);
    assert.strictEqual(env._suggestedCount(), 3, 'precondition: three suggested');

    env._saveSuggestedMarks();
    rebuildNotes(S);                                    // save/reload mints fresh objects
    assert.strictEqual(env._suggestedCount(), 0, 'WeakSet-only would report 0 after rebuild (the bug)');

    env._restoreSuggestedMarks();
    assert.strictEqual(env._suggestedCount(), 3, 're-attach repopulated the marks by identity');
    for (const n of S.arrangements[0].notes) assert.ok(env._isSuggested(n), 'each rebuilt note re-marked');
});

// ── 4. identity match precision ────────────────────────────────────────────────
t('re-attach matches string+fret exact, time within tol, greedy 1:1', () => {
    const { S, env, localStorage } = makeEnv([
        { time: 1.0006, string: 2, fret: 5, sustain: 0 },   // within 2ms of stored 1.000 → mark
        { time: 1, string: 3, fret: 5, sustain: 0 },        // same fret, WRONG string → skip
        { time: 5, string: 2, fret: 5, sustain: 0 },        // right s/f, far in time → skip
    ], 'other.sloppak');
    localStorage.setItem('editorSuggested:other.sloppak:0', '[{"time":1,"string":2,"fret":5}]');
    env._restoreSuggestedMarks();
    const nn = S.arrangements[0].notes;
    assert.ok(env._isSuggested(nn[0]), 'nearest identity within tol marked');
    assert.ok(!env._isSuggested(nn[1]), 'wrong-string note not marked');
    assert.ok(!env._isSuggested(nn[2]), 'out-of-tolerance time not marked');
    assert.strictEqual(env._suggestedCount(), 1, 'exactly one mark re-attached (1:1)');
});

t('a cleared mark, once re-flushed, is NOT resurrected by a later re-attach', () => {
    // Models Accept/position-move clearing a mark then a flush (arr switch / save)
    // re-persisting the live WeakSet: stale localStorage must not resurrect it.
    const { S, env } = makeEnv([{ time: 0, string: 3, fret: 1, sustain: 0 }]);
    const ref = () => S.arrangements[0].notes[0];
    env._markSuggested(ref());
    env._saveSuggestedMarks();                 // persisted as suggested
    env._clearSuggested(ref());                // user accepts / moves ⇒ confirmed
    env._saveSuggestedMarks();                 // flush live state (empty) before any restore
    rebuildNotes(S);                           // reload / reflatten mints fresh objects
    env._restoreSuggestedMarks();
    assert.ok(!env._isSuggested(ref()), 'accepted note stays confirmed (no resurrection)');
    assert.strictEqual(env._suggestedCount(), 0);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
