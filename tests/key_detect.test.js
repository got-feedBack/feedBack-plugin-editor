'use strict';
/*
 * Tests for passive key detection (DAW 4.17): _detectKeyPure scores a 12-bin
 * pitch-class histogram against the 24 major/minor Krumhansl profiles and
 * returns the best-fit {tonic, scale}. Suggestion only; nothing mutates state.
 *
 * Fails on main — the block doesn't exist there.
 *
 * Run: node tests/key_detect.test.js
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const src = fs.readFileSync(path.join(__dirname, '..', 'screen.js'), 'utf8');
const m = src.match(/\/\* @pure:key-detect:start \*\/[\s\S]*?\/\* @pure:key-detect:end \*\//);
if (!m) { console.error('FAIL: @pure:key-detect block not found'); process.exit(1); }
const K = new Function('"use strict";' + m[0]
    + '\nreturn { _detectKeyPure, _KK_MAJOR_PROFILE, _KK_MINOR_PROFILE };')();

let passed = 0, failed = 0;
function t(name, fn) {
    try { fn(); passed++; console.log('  ok ' + name); }
    catch (e) { failed++; console.error('  FAIL ' + name + '\n    ' + (e && e.message)); }
}

// Rotate a tonic-0 profile so its tonic sits at pitch class `tonic`.
function rotate(profile, tonic) {
    const out = new Array(12);
    for (let pc = 0; pc < 12; pc++) out[pc] = profile[((pc - tonic) % 12 + 12) % 12];
    return out;
}

// ── exact-profile inputs detect their own key (ranking is correct) ───

t('the C-major profile detects C major', () => {
    const r = K._detectKeyPure(K._KK_MAJOR_PROFILE.slice());
    assert.deepStrictEqual({ tonic: r.tonic, scale: r.scale }, { tonic: 0, scale: 'major' });
});

t('a profile rotated to G detects G major', () => {
    const r = K._detectKeyPure(rotate(K._KK_MAJOR_PROFILE, 7));
    assert.deepStrictEqual({ tonic: r.tonic, scale: r.scale }, { tonic: 7, scale: 'major' });
});

t('the minor profile rotated to A detects A minor', () => {
    const r = K._detectKeyPure(rotate(K._KK_MINOR_PROFILE, 9));
    assert.deepStrictEqual({ tonic: r.tonic, scale: r.scale }, { tonic: 9, scale: 'minor' });
});

// ── a hand-built, realistic distribution ─────────────────────────────

t('a textbook C-major distribution (tonic/dominant/mediant heavy, no chromatics)', () => {
    //         C   C#  D   D#  E   F   F#  G   G#  A   A#  B
    const w = [10, 0,  5,  0,  7,  4,  0,  8,  0,  5,  0,  4];
    const r = K._detectKeyPure(w);
    assert.deepStrictEqual({ tonic: r.tonic, scale: r.scale }, { tonic: 0, scale: 'major' });
});

t('a D-heavy dorian-ish set still lands on a sensible tonic (uses the weights)', () => {
    // Shift the same shape up two semitones → the detected tonic must move.
    const cMaj = [10, 0, 5, 0, 7, 4, 0, 8, 0, 5, 0, 4];
    const shifted = rotate(cMaj, 2);   // everything up a whole tone
    const r0 = K._detectKeyPure(cMaj);
    const r2 = K._detectKeyPure(shifted);
    assert.notStrictEqual(r0.tonic, r2.tonic, 'shifting the histogram shifts the detected tonic');
    assert.strictEqual((r0.tonic + 2) % 12, r2.tonic, 'by exactly the shift amount');
});

// ── degenerate inputs → null (caller shows nothing) ──────────────────

t('empty / all-zero / short / non-array → null', () => {
    assert.strictEqual(K._detectKeyPure(new Array(12).fill(0)), null);
    assert.strictEqual(K._detectKeyPure([]), null);
    assert.strictEqual(K._detectKeyPure(null), null);
    assert.strictEqual(K._detectKeyPure([1, 2, 3]), null, 'fewer than 12 bins');
});

t('a single pitch class never throws and returns a key', () => {
    const w = new Array(12).fill(0); w[0] = 5;
    const r = K._detectKeyPure(w);
    assert.ok(r && Number.isInteger(r.tonic), 'a lone C still yields a best-fit key');
});

t('NaN / negative bins are ignored, not counted', () => {
    const w = new Array(12).fill(0);
    w[0] = NaN; w[4] = -5;
    assert.strictEqual(K._detectKeyPure(w), null, 'no positive weight anywhere → null');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
