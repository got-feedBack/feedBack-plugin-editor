/*
 * Tests for enharmonic (flat-key) note spelling (src/theory.js spelling
 * preference + src/keys.js midiToNote/editorKeyNoteNames).
 *
 * The convention pinned: a key signature spells its accidentals one way —
 * F major writes Bb, never A#. The preference is the RELATIVE MAJOR's
 * circle-of-fifths side, so every mode borrows its signature's spelling
 * (D dorian → C major → sharps-side naturals; C minor → Eb major → flats).
 * F#/Gb stays sharp because the key picker's tonic list is sharp-named.
 * No key set → the sharp table: exactly the historical labels.
 *
 * Run: node tests/flat_key_labels.test.mjs
 */
import assert from 'node:assert';

globalThis.document = globalThis.document || {
    getElementById: () => null, addEventListener: () => {}, activeElement: null,
};
globalThis.localStorage = globalThis.localStorage || { getItem: () => null, setItem: () => {} };
globalThis.window = globalThis.window || globalThis;

const {
    PIANO_NOTE_NAMES, PIANO_NOTE_NAMES_FLAT,
    _keyPrefersFlatsPure, _noteNamesForKeyPure,
} = await import('../src/theory.js');
const { editorKeyNoteNames, midiToNote } = await import('../src/keys.js');
const { S } = await import('../src/state.js');

let pass = 0, fail = 0;
function t(name, fn) {
    try { fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}

// Pitch classes by sharp name, for readable fixtures.
const PC = Object.fromEntries(PIANO_NOTE_NAMES.map((n, i) => [n, i]));

t('the flat table shares naturals with the sharp table and flats the rest', () => {
    assert.strictEqual(PIANO_NOTE_NAMES_FLAT.length, 12);
    for (let i = 0; i < 12; i++) {
        if (PIANO_NOTE_NAMES[i].includes('#')) {
            assert.ok(PIANO_NOTE_NAMES_FLAT[i].endsWith('b'), PIANO_NOTE_NAMES_FLAT[i]);
        } else {
            assert.strictEqual(PIANO_NOTE_NAMES_FLAT[i], PIANO_NOTE_NAMES[i]);
        }
    }
});

t('flat majors: F, Bb, Eb, Ab, Db — sharp majors: C, G, D, A, E, B, F#', () => {
    for (const n of ['F', 'A#', 'D#', 'G#', 'C#']) {
        assert.strictEqual(_keyPrefersFlatsPure(PC[n], 'major'), true, `${n} major`);
    }
    for (const n of ['C', 'G', 'D', 'A', 'E', 'B', 'F#']) {
        assert.strictEqual(_keyPrefersFlatsPure(PC[n], 'major'), false, `${n} major`);
    }
});

t('minors borrow the relative major\'s signature (D minor flats, B minor sharps)', () => {
    for (const n of ['D', 'G', 'C', 'F']) {          // rel. F, Bb, Eb, Ab
        assert.strictEqual(_keyPrefersFlatsPure(PC[n], 'minor'), true, `${n} minor`);
    }
    for (const n of ['A', 'E', 'B', 'F#', 'C#']) {   // rel. C, G, D, A, E
        assert.strictEqual(_keyPrefersFlatsPure(PC[n], 'minor'), false, `${n} minor`);
    }
    // Harmonic/melodic minor carry the same signature as natural minor.
    assert.strictEqual(_keyPrefersFlatsPure(PC.C, 'harmonic_minor'), true);
    assert.strictEqual(_keyPrefersFlatsPure(PC.C, 'melodic_minor'), true);
});

t('modes map through their relative major (D dorian sharps, G dorian flats)', () => {
    assert.strictEqual(_keyPrefersFlatsPure(PC.D, 'dorian'), false);      // → C
    assert.strictEqual(_keyPrefersFlatsPure(PC.G, 'dorian'), true);       // → F
    assert.strictEqual(_keyPrefersFlatsPure(PC.E, 'phrygian'), false);    // → C
    assert.strictEqual(_keyPrefersFlatsPure(PC.F, 'lydian'), false);      // → C
    assert.strictEqual(_keyPrefersFlatsPure(PC['A#'], 'lydian'), true);   // Bb lydian → F
    assert.strictEqual(_keyPrefersFlatsPure(PC.G, 'mixolydian'), false);  // → C
    assert.strictEqual(_keyPrefersFlatsPure(PC.C, 'mixolydian'), true);   // → F
    assert.strictEqual(_keyPrefersFlatsPure(PC.B, 'locrian'), false);     // → C
    assert.strictEqual(_keyPrefersFlatsPure(PC.F, 'major_pentatonic'), true);
    assert.strictEqual(_keyPrefersFlatsPure(PC.D, 'minor_pentatonic'), true);
    assert.strictEqual(_keyPrefersFlatsPure(PC.A, 'blues'), false);       // → C
});

t('chromatic, unknown scales, and garbage tonics spell sharp (the default)', () => {
    assert.strictEqual(_keyPrefersFlatsPure(PC.F, 'chromatic'), false);
    assert.strictEqual(_keyPrefersFlatsPure(PC.F, 'nonsense'), false);
    assert.strictEqual(_keyPrefersFlatsPure(PC.F, undefined), false);
    for (const bad of [null, undefined, NaN, 'x']) {
        assert.strictEqual(_keyPrefersFlatsPure(bad, 'major'), false, String(bad));
    }
    // Out-of-range tonics wrap like every other pc consumer (17 ≡ 5 = F).
    assert.strictEqual(_keyPrefersFlatsPure(17, 'major'), true);
    assert.strictEqual(_keyPrefersFlatsPure(-7, 'major'), true);
});

t('_noteNamesForKeyPure: null/no-key → the sharp table (same ref), flat key → flats', () => {
    assert.strictEqual(_noteNamesForKeyPure(null), PIANO_NOTE_NAMES);
    assert.strictEqual(_noteNamesForKeyPure(undefined), PIANO_NOTE_NAMES);
    assert.strictEqual(_noteNamesForKeyPure({}), PIANO_NOTE_NAMES);
    assert.strictEqual(_noteNamesForKeyPure({ tonic: PC.F, scale: 'major' }), PIANO_NOTE_NAMES_FLAT);
    assert.strictEqual(_noteNamesForKeyPure({ tonic: PC.A, scale: 'major' }), PIANO_NOTE_NAMES);
});

t('midiToNote defaults to the historical sharp spelling (no call-site change)', () => {
    assert.strictEqual(midiToNote(60), 'C4');
    assert.strictEqual(midiToNote(61), 'C#4');
    assert.strictEqual(midiToNote(70), 'A#4');
});

t('midiToNote with the flat table respells only the accidentals', () => {
    assert.strictEqual(midiToNote(61, PIANO_NOTE_NAMES_FLAT), 'Db4');
    assert.strictEqual(midiToNote(70, PIANO_NOTE_NAMES_FLAT), 'Bb4');
    assert.strictEqual(midiToNote(60, PIANO_NOTE_NAMES_FLAT), 'C4');
    assert.strictEqual(midiToNote(64, PIANO_NOTE_NAMES_FLAT), 'E4');
});

t('editorKeyNoteNames follows S.editorKey (and sharps when unset)', () => {
    const prev = S.editorKey;
    try {
        S.editorKey = null;
        assert.strictEqual(editorKeyNoteNames(), PIANO_NOTE_NAMES);
        S.editorKey = { tonic: PC['D#'], scale: 'major' };      // Eb major
        assert.strictEqual(editorKeyNoteNames(), PIANO_NOTE_NAMES_FLAT);
        assert.strictEqual(midiToNote(70, editorKeyNoteNames()), 'Bb4');
        S.editorKey = { tonic: PC.E, scale: 'major' };
        assert.strictEqual(editorKeyNoteNames(), PIANO_NOTE_NAMES);
    } finally {
        S.editorKey = prev;
    }
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
