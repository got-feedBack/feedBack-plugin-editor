/*
 * Tests for the string/lane model (src/lanes.js), driven through the REAL
 * `S` from src/state.js — the first test to compose the two modules.
 *
 * Covers what _stringCountFor's own suite (bass_string_count) does not: the
 * display labels for extended-range instruments, the lane<->string inversion,
 * the label-keyed colour lookup, and the per-frame `LC` cache contract that
 * draw() and onMouseMove depend on.
 *
 * Run: node tests/lanes.test.mjs
 */
import assert from 'node:assert';
import { S } from '../src/state.js';
import {
    LC, MAX_LANES, _nominalLaneLabelsPure, _openMidiForArr, _soundingPitchPure,
    _tunedLaneLabelsPure, colorForLane, laneLabels, laneToStr, lanes, strToLane,
} from '../src/lanes.js';

let pass = 0, fail = 0;
function t(name, fn) {
    try { fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}

/** Point the shared S at one arrangement, with the cache cold. */
function setArr(arr) {
    S.arrangements = arr ? [arr] : [];
    S.currentArr = 0;
    LC.active = false;
    LC.labels = null;
    LC.nominalLabels = null;
}
const guitar = (n) => ({ name: 'Lead', tuning: new Array(n).fill(0), notes: [], chords: [] });
const bass = (n) => ({ name: 'Bass', tuning: new Array(n).fill(0), notes: [], chords: [] });

// ── labels, low → high in RS string-index order ──────────────────────

t('standard guitar labels low → high', () => {
    setArr(guitar(6));
    assert.deepStrictEqual(laneLabels(), ['E', 'A', 'D', 'G', 'B', 'e']);
});

t('7- and 8-string guitars add low strings, arrow-marked', () => {
    setArr(guitar(7));
    assert.deepStrictEqual(laneLabels(), ['B↓', 'E', 'A', 'D', 'G', 'B', 'e']);
    setArr(guitar(8));
    assert.deepStrictEqual(laneLabels(), ['F#↓', 'B↓', 'E', 'A', 'D', 'G', 'B', 'e']);
});

t('bass: 4 standard, 5 adds low B, 6 adds high C too', () => {
    setArr(bass(4));
    assert.deepStrictEqual(laneLabels(), ['E', 'A', 'D', 'G']);
    setArr(bass(5));
    assert.deepStrictEqual(laneLabels(), ['B↓', 'E', 'A', 'D', 'G']);
    // A len-6 bass tuning is RS padding and stays 4 strings (bass_string_count
    // pins that). A genuine 6-string bass is proven by its note indices.
    setArr({ ...bass(6), notes: [{ string: 5 }] });
    assert.strictEqual(lanes(), 6);
    assert.deepStrictEqual(laneLabels(), ['B↓', 'E', 'A', 'D', 'G', 'C↑']);
});

t('no arrangement loaded → 6 lanes, guitar labels (never throws)', () => {
    setArr(null);
    assert.strictEqual(lanes(), 6);
    assert.deepStrictEqual(laneLabels(), ['E', 'A', 'D', 'G', 'B', 'e']);
});

t('lane count is clamped to [4, MAX_LANES]', () => {
    setArr({ name: 'Lead', tuning: [], notes: [{ string: 40 }], chords: [] });
    assert.strictEqual(lanes(), MAX_LANES);
});

// ── string ⇄ lane is an involution ───────────────────────────────────

t('strToLane and laneToStr invert each other', () => {
    setArr(guitar(6));
    for (let s = 0; s < 6; s++) assert.strictEqual(laneToStr(strToLane(s)), s);
    assert.strictEqual(strToLane(0), 5, 'low E (string 0) draws on the bottom lane');
    assert.strictEqual(strToLane(5), 0, 'high e draws on the top lane');
});

// ── colour is keyed by LABEL, not by string index ────────────────────

t('colour follows the string\'s note, not its index', () => {
    setArr(guitar(6));
    const guitarLowE = colorForLane(strToLane(0));
    assert.strictEqual(guitarLowE, '#FC3A51', 'low E is red');
    assert.strictEqual(colorForLane(strToLane(5)), '#C473FF', 'high e is purple');
    // A 4-string bass G/D/A/E must reuse the same pitch→colour mapping even
    // though its string indices differ from the guitar's.
    setArr(bass(4));
    assert.strictEqual(colorForLane(strToLane(0)), guitarLowE, 'bass low E is red too');
    assert.strictEqual(colorForLane(strToLane(3)), '#FF8A00', 'bass G is orange');
});

t('an unknown label falls back to grey rather than undefined', () => {
    setArr(guitar(6));
    assert.strictEqual(colorForLane(99), '#888');
});

// ── the per-frame cache contract draw()/onMouseMove rely on ──────────

t('LC.active short-circuits lanes() to LC.value', () => {
    setArr(guitar(6));
    assert.strictEqual(lanes(), 6);
    LC.active = true;
    LC.value = 8;
    assert.strictEqual(lanes(), 8, 'a hot cache is trusted verbatim');
    LC.active = false;
    assert.strictEqual(lanes(), 6, 'a cold cache recomputes from S');
});

t('colorForLane uses LC.nominalLabels only while the cache is hot', () => {
    // Colour keys off the NOMINAL cache, not the display one: display
    // labels follow the tuning, and a retuned string must keep its colour.
    setArr(guitar(6));
    LC.active = true;
    LC.value = 6;
    LC.nominalLabels = ['E', 'E', 'E', 'E', 'E', 'E'];   // every lane forced red
    LC.labels = ['A#', 'A#', 'A#', 'A#', 'A#', 'A#'];    // display: ignored here
    assert.strictEqual(colorForLane(0), '#FC3A51');
    LC.active = false;
    LC.labels = null;
    LC.nominalLabels = null;
    assert.strictEqual(colorForLane(0), '#C473FF', 'cold cache recomputes labels');
});

// ── open-string pitch: the string model's other half ─────────────────

t('standard open-string MIDI for guitar and bass', () => {
    assert.deepStrictEqual(_openMidiForArr({ name: 'Lead' }, 6), [40, 45, 50, 55, 59, 64]);
    assert.deepStrictEqual(_openMidiForArr({ name: 'Bass' }, 4), [28, 33, 38, 43]);
});

t('extra low strings are a perfect 4th below the current lowest', () => {
    // 7-string guitar adds low B (35), 8-string adds low F# (30).
    assert.deepStrictEqual(_openMidiForArr({ name: 'Lead' }, 7)[0], 35);
    assert.deepStrictEqual(_openMidiForArr({ name: 'Lead' }, 8).slice(0, 2), [30, 35]);
    assert.deepStrictEqual(_openMidiForArr({ name: 'Bass' }, 5)[0], 23, '5-string bass low B');
});

t('a 6-string bass appends high C rather than extending downward', () => {
    const six = _openMidiForArr({ name: 'Bass' }, 6);
    assert.strictEqual(six.length, 6);
    assert.strictEqual(six[5], 48, 'high C on top');
    assert.strictEqual(six[0], 23, 'and still the 5-string low B underneath');
});

t('open-string pitch composes with the lane model (bass low E == guitar low E)', () => {
    assert.strictEqual(_openMidiForArr({ name: 'Bass' }, 4)[0] + 12,
        _openMidiForArr({ name: 'Lead' }, 6)[0], 'bass E1 is an octave below guitar E2');
});

t('_soundingPitchPure adds the capo exactly once', () => {
    const g = _openMidiForArr({ name: 'Lead' }, 6);
    const std = [0, 0, 0, 0, 0, 0];
    assert.strictEqual(_soundingPitchPure(g, std, 0, 0, 0), 40, 'open low E');
    assert.strictEqual(_soundingPitchPure(g, std, 2, 0, 0), 42, 'capo 2 → F#');
    assert.strictEqual(_soundingPitchPure(g, std, 0, 9, 0), null, 'no such string');
});



// ── Tuning-aware lane labels ─────────────────────────────────────────
// Reported by a 6-string bassist: a chart tuned a whole step down
// (A0 D1 G1 C2 F2 A#2) rendered its lanes B↓ E A D G C↑ — the NOMINAL
// layout — so every string label was a whole step sharp and the fret
// positions read as wrong notes. Labels must follow the tuning.

const tuned = (arr, offsets) => ({ ...arr, tuning: offsets });

t('standard tuning is byte-identical to the nominal labels (no churn)', () => {
    for (const n of [4, 5]) {
        setArr(bass(n));
        assert.deepStrictEqual(laneLabels(), _nominalLaneLabelsPure(lanes(), true), `bass ${n}`);
    }
    // A genuine 6-string bass needs a note up there — a len-6 bass tuning
    // alone is RS padding and stays 4 strings (see the label test above).
    setArr({ ...bass(6), notes: [{ string: 5 }] });
    assert.deepStrictEqual(laneLabels(), _nominalLaneLabelsPure(6, true), 'bass 6');
    for (const n of [6, 7, 8]) {
        setArr(guitar(n));
        assert.deepStrictEqual(laneLabels(), _nominalLaneLabelsPure(lanes(), false), `guitar ${n}`);
    }
});

t('the reported chart: 6-string bass a whole step down reads A D G C F A#', () => {
    // Genuine 6-string (a note on string 5), tuned a whole step down.
    setArr({ ...tuned(bass(6), [-2, -2, -2, -2, -2, -2]), notes: [{ string: 5 }] });
    assert.strictEqual(lanes(), 6);
    assert.deepStrictEqual(laneLabels(), ['A↓', 'D', 'G', 'C', 'F', 'A#↑']);
});

t('Drop D guitar relabels ONLY the dropped string', () => {
    setArr(tuned(guitar(6), [-2, 0, 0, 0, 0, 0]));
    assert.deepStrictEqual(laneLabels(), ['D', 'A', 'D', 'G', 'B', 'e']);
});

t('a retuned string keeps its POSITIONAL colour (Drop D low string stays red)', () => {
    setArr(tuned(guitar(6), [-2, 0, 0, 0, 0, 0]));
    // lane for string 0 (the low string) — red, not D-blue.
    assert.strictEqual(colorForLane(strToLane(0)), '#FC3A51');
    // And no lane falls through to the grey fallback on a retuned chart.
    for (let l = 0; l < lanes(); l++) {
        assert.notStrictEqual(colorForLane(l), '#888', `lane ${l} lost its colour`);
    }
});

t('every lane keeps a colour on the reported bass chart too', () => {
    setArr({ ...tuned(bass(6), [-2, -2, -2, -2, -2, -2]), notes: [{ string: 5 }] });
    for (let l = 0; l < lanes(); l++) {
        assert.notStrictEqual(colorForLane(l), '#888', `lane ${l} lost its colour`);
    }
});

t('the ↓/↑ extension markers survive retuning (which string is still legible)', () => {
    const labels = _tunedLaneLabelsPure(6, true, [23, 28, 33, 38, 43, 48], [-2, -2, -2, -2, -2, -2]);
    assert.ok(labels[0].endsWith('↓'), labels[0]);
    assert.ok(labels[5].endsWith('↑'), labels[5]);
});

t('the capo is NOT folded into the labels (it is the instrument tuning)', () => {
    const arr = tuned(guitar(6), [0, 0, 0, 0, 0, 0]);
    arr.capo = 3;
    setArr(arr);
    assert.deepStrictEqual(laneLabels(), ['E', 'A', 'D', 'G', 'B', 'e']);
});

t('degradations: junk tuning and a missing arrangement fall back to nominal', () => {
    setArr(tuned(guitar(6), null));
    assert.deepStrictEqual(laneLabels(), ['E', 'A', 'D', 'G', 'B', 'e']);
    setArr(tuned(guitar(6), ['x', undefined, null, 0, 0, 0]));
    assert.deepStrictEqual(laneLabels(), ['E', 'A', 'D', 'G', 'B', 'e']);
    setArr(null);
    assert.strictEqual(laneLabels().length, 6);
});


console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
