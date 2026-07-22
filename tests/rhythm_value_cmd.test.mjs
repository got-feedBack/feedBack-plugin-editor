/*
 * Note-value model — the STATEFUL wiring (NOTE-VALUE-MODEL-DESIGN §12 slice 1),
 * driven through the REAL EditHistory / reconstructChords / save-strip, not stubs.
 *
 * Pinned (each would fail on main):
 *   - SetRhythmValueCmd exec → rollback → redo restores the model EXACTLY,
 *     including the ABSENT-vs-present distinction (the sentinel snapshot) and the
 *     dirty flag; and the value is CLONED per note (no aliasing between notes).
 *   - `note.rhythm` SURVIVES reconstructChords on chord members (the field-mapper
 *     vanish hazard) while a rhythm-free note gains no key.
 *   - `note.rhythm` NEVER rides the seconds-only note wire: `_stripBeat` peels it
 *     off the save body while the LIVE note keeps it (Test #6, no signature poison).
 *
 * Run: node tests/rhythm_value_cmd.test.mjs
 */
import assert from 'node:assert';

globalThis.document = globalThis.document || {
    getElementById: () => null, addEventListener: () => {}, activeElement: null,
};
globalThis.localStorage = globalThis.localStorage || { getItem: () => null, setItem: () => {} };
globalThis.window = globalThis.window || globalThis;

const { EditHistory } = await import('../src/history.js');
const { S } = await import('../src/state.js');
const { notes } = await import('../src/notes.js');
const { SetRhythmValueCmd } = await import('../src/commands.js');
const { reconstructChords } = await import('../src/chords.js');
const { _stripBeat, _stripBeatsFromSaveBody } = await import('../src/tempo.js');
const { rhythmEquals } = await import('../src/rhythm-value.js');

let pass = 0, fail = 0;
function t(name, fn) {
    try { fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}
const R = (base, dots = 0, tuplet = null, grace = null) => ({ base, dots, tuplet, grace });
const N = (time, string, fret, sustain = 0) => ({ time, string, fret, sustain, techniques: {} });

function seedArr(noteList) {
    const arr = {
        name: 'Lead', tuning: [0, 0, 0, 0, 0, 0], capo: 0,
        notes: noteList, chords: [], chord_templates: [], handshapes: [],
    };
    S.arrangements = [arr];
    S.currentArr = 0;
    S.sel = new Set();
    S.drumEditMode = false; S.tempoMapMode = false; S.partsViewMode = false;
    S.dirty = false;
    S.history = new EditHistory();
    return arr;
}

t('SetRhythmValueCmd: exec sets value, rollback restores ABSENCE exactly', () => {
    seedArr([N(1, 0, 5), N(2, 1, 3)]);
    const before0 = 'rhythm' in notes()[0];
    S.history.exec(new SetRhythmValueCmd([0], R(8, 1)));   // dotted eighth on note 0
    assert.ok(rhythmEquals(notes()[0].rhythm, R(8, 1)));
    assert.strictEqual('rhythm' in notes()[1], false);      // untouched note stays absent
    S.history.doUndo();
    assert.strictEqual('rhythm' in notes()[0], before0);    // key GONE again, not left as {}/null
    assert.strictEqual(notes()[0].rhythm, undefined);
});

t('SetRhythmValueCmd: exec → rollback → redo reproduces the post-exec state', () => {
    seedArr([N(1, 0, 5)]);
    S.history.exec(new SetRhythmValueCmd([0], R(4)));
    assert.ok(rhythmEquals(notes()[0].rhythm, R(4)));
    S.history.doUndo();
    assert.strictEqual(notes()[0].rhythm, undefined);
    S.history.doRedo();
    assert.ok(rhythmEquals(notes()[0].rhythm, R(4)));
});

t('SetRhythmValueCmd: replacing a value restores the PRIOR value on undo', () => {
    seedArr([N(1, 0, 5)]);
    S.history.exec(new SetRhythmValueCmd([0], R(4)));       // quarter
    S.history.exec(new SetRhythmValueCmd([0], R(8, 0, [{ n: 3, m: 2, group: 1 }])));  // → triplet-8th
    assert.ok(rhythmEquals(notes()[0].rhythm, R(8, 0, [{ n: 3, m: 2, group: 1 }])));
    S.history.doUndo();
    assert.ok(rhythmEquals(notes()[0].rhythm, R(4)));       // back to the quarter, not absent
});

t('SetRhythmValueCmd: clear (value=null) removes the key, undo brings it back', () => {
    seedArr([N(1, 0, 5)]);
    S.history.exec(new SetRhythmValueCmd([0], R(2)));
    S.history.exec(new SetRhythmValueCmd([0], null));       // clear
    assert.strictEqual(notes()[0].rhythm, undefined);
    S.history.doUndo();
    assert.ok(rhythmEquals(notes()[0].rhythm, R(2)));
});

t('SetRhythmValueCmd: value is CLONED per note — no aliasing between notes', () => {
    seedArr([N(1, 0, 5), N(1, 1, 3)]);                     // (same time — a chord, but indices still distinct)
    S.history.exec(new SetRhythmValueCmd([0, 1], R(8, 0, [{ n: 3, m: 2, group: 1 }])));
    assert.notStrictEqual(notes()[0].rhythm, notes()[1].rhythm);
    assert.notStrictEqual(notes()[0].rhythm.tuplet, notes()[1].rhythm.tuplet);
    notes()[0].rhythm.tuplet[0].n = 99;
    assert.strictEqual(notes()[1].rhythm.tuplet[0].n, 3);  // mutating one did not touch the other
});

t('reconstructChords: rhythm SURVIVES on chord members; absent stays absent', () => {
    // two notes at the SAME time = a chord; one carries a value, one doesn't.
    const withVal = { ...N(1, 0, 5), rhythm: R(8, 1) };
    const noVal = N(1, 2, 7);
    seedArr([withVal, noVal, N(3, 1, 4)]);                 // + a lone note at t=3
    reconstructChords();
    const arr = S.arrangements[0];
    assert.strictEqual(arr.chords.length, 1);
    const members = arr.chords[0].notes;
    const m0 = members.find(m => m.string === 0);
    const m2 = members.find(m => m.string === 2);
    assert.ok(rhythmEquals(m0.rhythm, R(8, 1)), 'chord member kept its value');
    assert.strictEqual('rhythm' in m2, false, 'value-free member gained no rhythm key');
});

t('_stripBeat: rhythm is peeled off the wire clone; the live note keeps it', () => {
    const live = { ...N(1, 0, 5), beat: 2, beatEnd: 3, rhythm: R(4, 1) };
    const wire = _stripBeat(live);
    assert.strictEqual('rhythm' in wire, false);           // never on the seconds-only wire
    assert.strictEqual('beat' in wire, false);
    assert.ok(rhythmEquals(live.rhythm, R(4, 1)), 'live note untouched (clone semantics)');
});

t('_stripBeatsFromSaveBody: strips rhythm across notes and chord members', () => {
    const body = {
        notes: [{ ...N(1, 0, 5), rhythm: R(4) }],
        chords: [{ time: 2, notes: [{ ...N(2, 0, 5), rhythm: R(8) }, { ...N(2, 1, 3), rhythm: R(8) }] }],
    };
    const out = _stripBeatsFromSaveBody(body);
    assert.strictEqual('rhythm' in out.notes[0], false);
    assert.strictEqual('rhythm' in out.chords[0].notes[0], false);
    assert.strictEqual('rhythm' in out.chords[0].notes[1], false);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
