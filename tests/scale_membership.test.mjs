/*
 * Tests for the scale model behind the piano-roll in-key highlight
 * (src/theory.js): SCALE_INTERVALS + _pcInScalePure, the tonic-relative
 * pitch-class membership every highlight render path consults.
 *
 * Display feature, so the habits that bite are adversarial inputs and proving
 * the helper uses ALL its arguments (pc, tonic, AND scale change the result).
 * A bad/unknown state must return "in-key" so it never paints the whole roll
 * out-of-key. Every case drives the real function.
 *
 * Run: node tests/scale_membership.test.mjs
 */
import assert from 'node:assert';
import { SCALE_INTERVALS, _pcInScalePure } from '../src/theory.js';

// pitch classes: C0 C#1 D2 D#3 E4 F5 F#6 G7 G#8 A9 A#10 B11
const C = 0, D = 2, E = 4, F = 5, Fs = 6, G = 7, A = 9, Bb = 10, B = 11, Cs = 1;

let pass = 0, fail = 0;
function t(name, fn) {
    try { fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}

t('C major: naturals in, sharps/flats out', () => {
    for (const pc of [C, D, E, F, G, A, B]) {
        assert.strictEqual(_pcInScalePure(pc, C, 'major'), true, `pc ${pc} should be in C major`);
    }
    for (const pc of [Cs, D + 1, Fs, G + 1, Bb]) {
        assert.strictEqual(_pcInScalePure(pc, C, 'major'), false, `pc ${pc} should be out of C major`);
    }
});

t('membership uses the TONIC argument (same pc, different key)', () => {
    // F# is out of C major but in of G major (its leading tone is F#).
    assert.strictEqual(_pcInScalePure(Fs, C, 'major'), false);
    assert.strictEqual(_pcInScalePure(Fs, G, 'major'), true);
    assert.notStrictEqual(_pcInScalePure(Fs, C, 'major'), _pcInScalePure(Fs, G, 'major'));
});

t('membership uses the SCALE argument (same pc+tonic, different scale)', () => {
    // Bb is out of C major but in of C mixolydian / C minor.
    assert.strictEqual(_pcInScalePure(Bb, C, 'major'), false);
    assert.strictEqual(_pcInScalePure(Bb, C, 'mixolydian'), true);
    assert.strictEqual(_pcInScalePure(Bb, C, 'minor'), true);
});

t('octave-invariant: pc is taken mod 12', () => {
    assert.strictEqual(_pcInScalePure(E + 12, C, 'major'), true);
    assert.strictEqual(_pcInScalePure(Cs + 24, C, 'major'), false);
});

t('wrap-around tonic: A minor naturals match C major naturals', () => {
    for (const pc of [C, D, E, F, G, A, B]) {
        assert.strictEqual(_pcInScalePure(pc, A, 'minor'), true, `pc ${pc} in A minor`);
    }
    assert.strictEqual(_pcInScalePure(Cs, A, 'minor'), false);
});

t('pentatonic / blues are subsets', () => {
    assert.strictEqual(_pcInScalePure(F, C, 'major_pentatonic'), false, 'F not in C major pentatonic');
    assert.strictEqual(_pcInScalePure(E, C, 'major_pentatonic'), true);
    assert.strictEqual(_pcInScalePure(Fs, C, 'blues'), true, 'the blue note is in C blues');
});

t('chromatic scale: everything is in-key (atonal region shades nothing)', () => {
    for (let pc = 0; pc < 12; pc++) {
        assert.strictEqual(_pcInScalePure(pc, C, 'chromatic'), true, `pc ${pc}`);
    }
});

t('adversarial: unknown scale / non-finite inputs default to in-key (never paint)', () => {
    assert.strictEqual(_pcInScalePure(Cs, C, 'not_a_scale'), true, 'unknown scale → in-key');
    assert.strictEqual(_pcInScalePure(Cs, C, undefined), true);
    assert.strictEqual(_pcInScalePure(NaN, C, 'major'), true, 'NaN pc → in-key');
    assert.strictEqual(_pcInScalePure(Cs, NaN, 'major'), true, 'NaN tonic → in-key');
    assert.strictEqual(_pcInScalePure(Cs, undefined, 'major'), true);
});

t('every declared scale is a valid, in-range, deduplicated interval set', () => {
    for (const [id, ivs] of Object.entries(SCALE_INTERVALS)) {
        assert.ok(Array.isArray(ivs) && ivs.length, `${id} non-empty`);
        assert.ok(ivs.every(v => Number.isInteger(v) && v >= 0 && v <= 11), `${id} in 0..11`);
        assert.strictEqual(new Set(ivs).size, ivs.length, `${id} deduped`);
        assert.strictEqual(ivs[0], 0, `${id} rooted at the tonic`);
    }
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
