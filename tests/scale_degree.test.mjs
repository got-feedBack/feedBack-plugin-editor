/*
 * Tests for the guitar-lane scale-degree overlay (DAW 4.16a):
 * _scaleDegreeSemisPure / _scaleDegreeLabelPure (degree relative to a tonic,
 * flats for chromatics) and _scaleDegreeColorPure (role palette). Display-only.
 *
 * Run: node tests/scale_degree.test.mjs
 */
import assert from 'node:assert';
import * as D from '../src/theory.js';

let passed = 0, failed = 0;
function t(name, fn) {
    try { fn(); passed++; console.log('  ok ' + name); }
    catch (e) { failed++; console.error('  FAIL ' + name + '\n    ' + (e && e.message)); }
}

// ── degree math ──────────────────────────────────────────────────────

t('semitones above tonic wrap correctly in both directions', () => {
    assert.strictEqual(D._scaleDegreeSemisPure(0, 0), 0, 'C over C = root');
    assert.strictEqual(D._scaleDegreeSemisPure(7, 0), 7, 'G over C = 5th');
    assert.strictEqual(D._scaleDegreeSemisPure(0, 5), 7, 'C over F = 5th (wraps up)');
    assert.strictEqual(D._scaleDegreeSemisPure(4, 9), 7, 'E over A = 5th');
});

t('the full chromatic label row (flats for the in-betweens)', () => {
    // In the key of C: every pitch class 0..11 → its degree label.
    const labels = [];
    for (let pc = 0; pc < 12; pc++) labels.push(D._scaleDegreeLabelPure(pc, 0));
    assert.deepStrictEqual(labels,
        ['1', '♭2', '2', '♭3', '3', '4', '♭5', '5', '♭6', '6', '♭7', '7']);
});

t('every chromatic degree honours the stated flat convention (no stray sharps)', () => {
    // Regression for #131: index 8 was mislabelled ♯5, contradicting the
    // documented flat/Nashville convention shared by ♭2/♭3/♭5/♭7. In the key
    // of C, pitch class 8 (Ab) is the ♭6, not the ♯5.
    assert.strictEqual(D._scaleDegreeLabelPure(8, 0), '♭6', 'pc 8 over C is ♭6, not ♯5');
    for (const label of D._SCALE_DEGREE_LABELS) {
        assert.ok(!label.includes('♯'), `chromatic label ${label} must use a flat, not a sharp`);
    }
});

t('a real key: A major → the note A is the root, E is the 5th, C# the 3rd', () => {
    assert.strictEqual(D._scaleDegreeLabelPure(9, 9), '1', 'A = root');
    assert.strictEqual(D._scaleDegreeLabelPure(4, 9), '5', 'E = 5th');
    assert.strictEqual(D._scaleDegreeLabelPure(1, 9), '3', 'C# = major 3rd');
    assert.strictEqual(D._scaleDegreeLabelPure(8, 9), '7', 'G# = major 7th');
});

t('non-finite input → -1 / empty label (never throws)', () => {
    assert.strictEqual(D._scaleDegreeSemisPure(NaN, 0), -1);
    assert.strictEqual(D._scaleDegreeSemisPure(5, undefined), -1);
    assert.strictEqual(D._scaleDegreeLabelPure(NaN, 0), '');
});

// ── the role palette ─────────────────────────────────────────────────

t('the harmonic skeleton (1/3/5/7) each get a distinct accent colour', () => {
    const root = D._scaleDegreeColorPure(0);
    const third = D._scaleDegreeColorPure(4);
    const fifth = D._scaleDegreeColorPure(7);
    const seventh = D._scaleDegreeColorPure(11);
    const other = D._scaleDegreeColorPure(2);
    const set = new Set([root, third, fifth, seventh, other]);
    assert.strictEqual(set.size, 5, 'root, 3rd, 5th, 7th, and "other" are all distinct');
    assert.strictEqual(D._scaleDegreeColorPure(3), third, 'minor and major 3rd share the 3rd colour');
    assert.strictEqual(D._scaleDegreeColorPure(10), seventh, 'b7 and maj7 share the 7th colour');
});

t('passing tones fall through to the neutral tint', () => {
    const neutral = D._scaleDegreeColorPure(2);
    for (const semi of [1, 2, 5, 6, 8, 9]) {
        assert.strictEqual(D._scaleDegreeColorPure(semi), neutral, `degree ${semi} is neutral`);
    }
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
