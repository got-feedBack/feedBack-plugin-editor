/*
 * MusicXML keys import — authored-notation preservation plumbing (frontend
 * half of the keys LH/RH hand arc, slice A):
 *
 *   - _shiftNotationTimes (src/import.js) — the client-side audio-offset
 *     shift for the authored notation payload. Must move measures[].t and
 *     every voice beat's t exactly like the note shift (or the payload is
 *     born stale against add-arrangement's fingerprint), leave `dur`
 *     (notational, not seconds) alone, and never throw on malformed input.
 *
 *   - reconstructChords (src/chords.js) keeps `techniques.hand` on chord
 *     member notes — the reason `hand` lives inside `techniques` at all is
 *     that the chord rebuild re-mints member notes through an explicit field
 *     list; this pins that the ride-along actually survives.
 *
 * Run: node tests/musicxml_hand_import.test.mjs
 */
import assert from 'node:assert';
import { _shiftNotationTimes } from '../src/import.js';
import { reconstructChords, flattenChords } from '../src/chords.js';
import { LC } from '../src/lanes.js';
import { S } from '../src/state.js';

let pass = 0, fail = 0;
function t(name, fn) {
    try { fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}

// ── _shiftNotationTimes ──────────────────────────────────────────────

function payload() {
    return {
        version: 1,
        instrument: 'piano',
        staves: [{ id: 'rh' }, { id: 'lh' }],
        measures: [
            {
                idx: 1, t: 0,
                staves: {
                    rh: { voices: [{ v: 1, beats: [
                        { t: 0, dur: 4, notes: [{ midi: 60 }] },
                        { t: 0.5, dur: 4, notes: [{ midi: 64 }] },
                    ] }] },
                    lh: { voices: [{ v: 1, beats: [
                        { t: 0, dur: 2, notes: [{ midi: 48 }] },
                    ] }] },
                },
            },
            { idx: 2, t: 2, staves: {} },
        ],
    };
}

t('shifts measure and beat times, leaves dur alone', () => {
    const p = payload();
    _shiftNotationTimes(p, 1.25);
    assert.strictEqual(p.measures[0].t, 1.25);
    assert.strictEqual(p.measures[1].t, 3.25);
    const rhBeats = p.measures[0].staves.rh.voices[0].beats;
    assert.strictEqual(rhBeats[0].t, 1.25);
    assert.strictEqual(rhBeats[1].t, 1.75);
    assert.strictEqual(rhBeats[0].dur, 4);           // notational, untouched
    assert.strictEqual(p.measures[0].staves.lh.voices[0].beats[0].t, 1.25);
});

t('rounds to the 1 ms grid like the backend warp', () => {
    const p = payload();
    _shiftNotationTimes(p, 0.1004);
    assert.strictEqual(p.measures[0].staves.rh.voices[0].beats[0].t, 0.1);
});

t('negative offsets shift backwards', () => {
    const p = payload();
    _shiftNotationTimes(p, -0.5);
    assert.strictEqual(p.measures[1].t, 1.5);
});

t('zero/absent offset is a no-op', () => {
    const p = payload();
    _shiftNotationTimes(p, 0);
    assert.strictEqual(p.measures[0].t, 0);
});

t('never throws on malformed payloads', () => {
    _shiftNotationTimes(null, 1);
    _shiftNotationTimes('junk', 1);
    _shiftNotationTimes({}, 1);
    _shiftNotationTimes({ measures: 'nope' }, 1);
    _shiftNotationTimes({ measures: [null, 42, { t: 'NaN', staves: null },
        { t: 0, staves: { rh: null } },
        { t: 0, staves: { rh: { voices: [null, { beats: [null, {}] }] } } }] }, 1);
    // objects where arrays are expected must not throw (for..of on a non-array)
    _shiftNotationTimes({ measures: [{ t: 0, staves: { rh: { voices: {} } } },
        { t: 0, staves: { rh: { voices: [{ beats: {} }] } } }] }, 1);
    assert.ok(true);
});

// ── techniques.hand survives the chord rebuild ───────────────────────

function seed(arr) {
    S.arrangements = [arr];
    S.currentArr = 0;
    S.history = { reset() {} };
    S.handshapeSel = null;
    LC.active = false;
}
const keysNote = (time, midi, hand) => ({
    time,
    string: Math.floor(midi / 24),
    fret: midi % 24,
    sustain: 0.5,
    techniques: hand ? { hand } : {},
});

t('hand survives reconstructChords on chord member notes', () => {
    // Two simultaneous keys notes, one per hand — the classic grand-staff
    // simultaneity that the chord rebuild re-mints as member notes.
    seed({ name: 'Piano', chord_templates: [], notes: [
        keysNote(0, 60, 'rh'), keysNote(0, 48, 'lh'),
        keysNote(1, 64, 'rh'),                        // solo keeps its ride too
    ] });
    reconstructChords();
    const arr = S.arrangements[0];
    assert.strictEqual(arr.chords.length, 1);
    const hands = arr.chords[0].notes.map(n => (n.techniques || {}).hand).sort();
    assert.deepStrictEqual(hands, ['lh', 'rh']);
    assert.strictEqual(arr.notes.length, 1);
    assert.strictEqual(arr.notes[0].techniques.hand, 'rh');
});

t('hand round-trips flatten → reconstruct unchanged', () => {
    seed({ name: 'Piano', chord_templates: [], notes: [
        keysNote(0, 60, 'rh'), keysNote(0, 48, 'lh'),
    ] });
    reconstructChords();
    flattenChords();
    const flat = S.arrangements[0].notes.map(n => (n.techniques || {}).hand).sort();
    assert.deepStrictEqual(flat, ['lh', 'rh']);
    reconstructChords();
    const hands = S.arrangements[0].chords[0].notes
        .map(n => (n.techniques || {}).hand).sort();
    assert.deepStrictEqual(hands, ['lh', 'rh']);
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
