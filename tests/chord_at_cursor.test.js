'use strict';
/*
 * Tests for the chord-at-cursor readout (DAW 4.17):
 * _pcSetFromMidisPure, _identifyChordPure (exact-match vocabulary + bass-note
 * tie-breaking), and _notesSoundingAtPure (which notes ring at a time).
 * Read-only readout; nothing here mutates state.
 *
 * All fail on main — the block doesn't exist there.
 *
 * Run: node tests/chord_at_cursor.test.js
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const src = fs.readFileSync(path.join(__dirname, '..', 'screen.js'), 'utf8');
function extractBlock(name) {
    const re = new RegExp('/\\* @pure:' + name + ':start \\*/[\\s\\S]*?/\\* @pure:' + name + ':end \\*/');
    const m = src.match(re);
    if (!m) { console.error(`FAIL: @pure:${name} not found`); process.exit(1); }
    return m[0];
}
const NOTE_NAMES_SRC = src.match(/const PIANO_NOTE_NAMES = \[[^\]]*\];/)[0];

let passed = 0, failed = 0;
function t(name, fn) {
    try { fn(); passed++; console.log('  ok ' + name); }
    catch (e) { failed++; console.error('  FAIL ' + name + '\n    ' + (e && e.message)); }
}

const C = new Function('"use strict";' + NOTE_NAMES_SRC + extractBlock('chord-id')
    + '\nreturn { _pcSetFromMidisPure, _identifyChordPure, _notesSoundingAtPure, PIANO_NOTE_NAMES };')();
const name = (pcs, bass) => {
    const c = C._identifyChordPure(pcs, bass === undefined ? -1 : bass, C.PIANO_NOTE_NAMES);
    return c ? c.name : null;
};

// ── pc-set from MIDI (dedupe octaves, sort, round) ───────────────────

t('_pcSetFromMidisPure: dedupes octaves, sorts, tolerates junk', () => {
    // C major voiced C3 E3 G3 C4 (48 52 55 60) → {0,4,7}
    assert.deepStrictEqual(C._pcSetFromMidisPure([48, 52, 55, 60]), [0, 4, 7]);
    assert.deepStrictEqual(C._pcSetFromMidisPure([60, NaN, 'x', 64]), [0, 4]);
    assert.deepStrictEqual(C._pcSetFromMidisPure([]), []);
});

// ── triads / sevenths ────────────────────────────────────────────────

t('major and minor triads', () => {
    assert.strictEqual(name([0, 4, 7]), 'C');
    assert.strictEqual(name([2, 6, 9]), 'D');
    assert.strictEqual(name([0, 3, 7]), 'Cm');
    assert.strictEqual(name([9, 0, 4]), 'Am');   // A C E
});

t('dim / aug / sus (sus2 and sus4 are inversions — the bass disambiguates)', () => {
    assert.strictEqual(name([0, 3, 6]), 'Cdim');
    assert.strictEqual(name([0, 5, 7], 0), 'Csus4');   // C F G, C in bass
    assert.strictEqual(name([0, 2, 7], 0), 'Csus2');   // C D G, C in bass (= Gsus4 with G bass)
    assert.strictEqual(name([0, 2, 7], 7), 'Gsus4');
    // augmented is symmetric — with no bass it names from the first root found.
    assert.ok(/aug$/.test(name([0, 4, 8])), 'aug names as an augmented chord');
});

t('seventh chords', () => {
    assert.strictEqual(name([0, 4, 7, 11]), 'Cmaj7');
    assert.strictEqual(name([0, 4, 7, 10]), 'C7');
    assert.strictEqual(name([0, 3, 7, 11]), 'CmMaj7');
    assert.strictEqual(name([0, 3, 6, 10]), 'Cm7b5');
});

// ── the bass note disambiguates genuine ties ─────────────────────────

t('m7 vs 6 share one pc-set — the bass decides (sharp spelling)', () => {
    // {C, D#/Eb, G, A#/Bb} = {0,3,7,10} is BOTH Cm7 and D#6.
    const pcs = [0, 3, 7, 10];
    assert.strictEqual(name(pcs, 0), 'Cm7', 'bass C → Cm7');
    assert.strictEqual(name(pcs, 3), 'D#6', 'bass D#/Eb → D#6 (readout spells with sharps)');
});

t('bass picks the root position of a major triad inversion', () => {
    // {C,E,G} with G in the bass is still a C chord (we name by root, and the
    // bass only breaks true same-set ties — a triad has one spelling here).
    assert.strictEqual(name([0, 4, 7], 7), 'C');
});

// ── power chord + single note + no-match ─────────────────────────────

t('power-chord dyad and single note', () => {
    assert.strictEqual(name([0, 7]), 'C5');
    assert.strictEqual(name([4]), 'E', 'a lone pitch class is just the note');
});

t('an unrecognised set returns null (readout stays blank / —)', () => {
    assert.strictEqual(name([0, 1, 2]), null, 'chromatic cluster is no named chord');
    assert.strictEqual(name([0, 2, 4, 6, 8]), null, 'whole-tone stack unmatched');
    assert.strictEqual(name([]), null);
});

// ── sounding-window predicate ────────────────────────────────────────

const S = (time, sustain) => ({ time, sustain });

t('_notesSoundingAtPure: onset-inclusive, sustain-aware, zero-sustain lingers briefly', () => {
    const notes = [
        S(1.0, 0.5),   // rings 1.0–1.5
        S(1.0, 0),     // zero sustain → min-dur window at 1.0
        S(3.0, 1.0),   // rings 3.0–4.0
    ];
    assert.strictEqual(C._notesSoundingAtPure(notes, 1.2, 0.05, 0.03).length, 1, 'only the sustained note at 1.2');
    assert.strictEqual(C._notesSoundingAtPure(notes, 1.0, 0.05, 0.03).length, 2, 'both onset-at-1.0 notes');
    assert.strictEqual(C._notesSoundingAtPure(notes, 3.5, 0.05, 0.03).length, 1);
    assert.strictEqual(C._notesSoundingAtPure(notes, 2.0, 0.05, 0.03).length, 0, 'gap between notes');
});

t('_notesSoundingAtPure: NaN onset skipped, non-array safe', () => {
    assert.deepStrictEqual(C._notesSoundingAtPure(null, 1), []);
    assert.strictEqual(C._notesSoundingAtPure([S(NaN, 1), S(1, 1)], 1, 0.05, 0.03).length, 1);
});

// ── end-to-end: a voiced chart chord names correctly ─────────────────

t('a real fretted E major voicing (E B E G# B E) names as E', () => {
    const midis = [40, 47, 52, 56, 59, 64];   // E2 B2 E3 G#3 B3 E4
    const pcs = C._pcSetFromMidisPure(midis);  // {E, G#, B} = {4, 8, 11}
    const bass = ((Math.min(...midis) % 12) + 12) % 12;  // E = 4
    assert.strictEqual(C._identifyChordPure(pcs, bass, C.PIANO_NOTE_NAMES).name, 'E');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
