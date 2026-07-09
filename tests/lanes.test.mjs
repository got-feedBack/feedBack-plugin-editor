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
    LC, MAX_LANES, colorForLane, laneLabels, laneToStr, lanes, strToLane,
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

t('colorForLane uses LC.labels only while the cache is hot', () => {
    setArr(guitar(6));
    LC.active = true;
    LC.value = 6;
    LC.labels = ['E', 'E', 'E', 'E', 'E', 'E'];   // every lane forced red
    assert.strictEqual(colorForLane(0), '#FC3A51');
    LC.active = false;
    LC.labels = null;
    assert.strictEqual(colorForLane(0), '#C473FF', 'cold cache recomputes labels');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
