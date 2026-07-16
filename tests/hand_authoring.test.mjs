/*
 * Keys hand authoring (src/hand.js + SetTechScalarPerNoteCmd) — Step B of the
 * hand arc: the split-point STAMP (one undoable command writing per-note
 * values), the split-pitch parser, and the selection hand-set path.
 *
 * Run: node tests/hand_authoring.test.mjs
 */
import assert from 'node:assert';
import { seedState, trackHooks } from './_history_env.mjs';
import { EditHistory } from '../src/history.js';
import { SetTechScalarPerNoteCmd } from '../src/commands.js';
import { _handStampValuesPure, _parseSplitPitchPure } from '../src/hand.js';
import { S } from '../src/state.js';

let pass = 0, fail = 0;
function t(name, fn) {
    try { fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}

// ── the split-pitch parser ───────────────────────────────────────────

t('parses note names, accidentals, and raw MIDI; rejects junk', () => {
    assert.strictEqual(_parseSplitPitchPure('C4'), 60);
    assert.strictEqual(_parseSplitPitchPure('c4'), 60);
    assert.strictEqual(_parseSplitPitchPure('F#3'), 54);
    assert.strictEqual(_parseSplitPitchPure('Bb2'), 46);
    assert.strictEqual(_parseSplitPitchPure('60'), 60);
    assert.strictEqual(_parseSplitPitchPure(' A0 '), 21);
    for (const junk of ['', 'H4', 'C', '4C', '999', '128', null, undefined, 'C#'])
        assert.strictEqual(_parseSplitPitchPure(junk), null, JSON.stringify(junk));
});

t('stamp values: below the split → lh, at/above → rh (core orientation)', () => {
    assert.deepStrictEqual(
        _handStampValuesPure([48, 59, 60, 72], 60),
        ['lh', 'lh', 'rh', 'rh']);
});

// ── the per-note scalar command ──────────────────────────────────────

const keysNote = (time, midi, hand) => ({
    time, string: Math.floor(midi / 24), fret: midi % 24, sustain: 0.5,
    techniques: hand ? { hand } : {},
});

function seed(notesArr) {
    trackHooks();
    seedState({
        arrangements: [{ name: 'Piano', notes: notesArr, chords: [], chord_templates: [] }],
        currentArr: 0,
    });
    S.history = new EditHistory();
    return S.arrangements[0].notes;
}

t('stamp writes different values per note in ONE undo step', () => {
    const nn = seed([keysNote(0, 48), keysNote(0, 60, 'rh'), keysNote(1, 72)]);
    S.history.exec(new SetTechScalarPerNoteCmd([0, 1, 2], 'hand', ['lh', 'lh', 'rh']));
    assert.deepStrictEqual(nn.map(n => n.techniques.hand), ['lh', 'lh', 'rh']);
    S.history.doUndo();
    // Exact prior state: unassigned stays absent-ish (undefined), the
    // pre-existing 'rh' comes back.
    assert.strictEqual(nn[0].techniques.hand, undefined);
    assert.strictEqual(nn[1].techniques.hand, 'rh');
    assert.strictEqual(nn[2].techniques.hand, undefined);
    S.history.doRedo();
    assert.deepStrictEqual(nn.map(n => n.techniques.hand), ['lh', 'lh', 'rh']);
});

t('stamp survives a note with no techniques dict', () => {
    const bare = { time: 0, string: 2, fret: 0, sustain: 0.5 };
    const nn = seed([bare]);
    S.history.exec(new SetTechScalarPerNoteCmd([0], 'hand', ['lh']));
    assert.strictEqual(nn[0].techniques.hand, 'lh');
    S.history.doUndo();
    assert.strictEqual(nn[0].techniques.hand, undefined);
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
