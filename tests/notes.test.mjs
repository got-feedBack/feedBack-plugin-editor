/*
 * Tests for the note/chord accessors (src/notes.js) against the real `S`.
 *
 * The pure arithmetic in this module is covered by chord_resize, bend_shape and
 * teaching_marks. What those don't touch is the accessors' empty guard: with no
 * arrangement loaded, `notes()` and `chords()` must hand back an empty array
 * rather than dereferencing `S.arrangements[S.currentArr]` — 200+ call sites in
 * main.js iterate the result directly, including on the entry screen.
 *
 * Run: node tests/notes.test.mjs
 */
import assert from 'node:assert';
import { chords, notes } from '../src/notes.js';
import { S } from '../src/state.js';

let pass = 0, fail = 0;
function t(name, fn) {
    try { fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}

t('no arrangement loaded → empty arrays, never a throw', () => {
    S.arrangements = [];
    S.currentArr = 0;
    assert.deepStrictEqual(notes(), []);
    assert.deepStrictEqual(chords(), []);
});

t('accessors read the ACTIVE arrangement, and follow currentArr', () => {
    const lead = { name: 'Lead', notes: [{ time: 0 }], chords: [{ time: 0 }] };
    const bass = { name: 'Bass', notes: [{ time: 1 }, { time: 2 }], chords: [] };
    S.arrangements = [lead, bass];

    S.currentArr = 0;
    assert.strictEqual(notes(), lead.notes, 'same array identity, not a copy');
    assert.strictEqual(chords(), lead.chords);

    S.currentArr = 1;
    assert.strictEqual(notes(), bass.notes);
    assert.deepStrictEqual(chords(), []);
});

t('the returned array is live — mutations land on the arrangement', () => {
    const lead = { name: 'Lead', notes: [], chords: [] };
    S.arrangements = [lead];
    S.currentArr = 0;
    notes().push({ time: 5 });
    assert.strictEqual(lead.notes.length, 1, 'edits go through to S, not a clone');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
