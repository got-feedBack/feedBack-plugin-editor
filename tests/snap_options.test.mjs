/*
 * Snap option model tests for src/snap.js.
 *
 * Run: node tests/snap_options.test.mjs
 */
import assert from 'node:assert';
import {
    SNAP_OPTIONS,
    SNAP_VALUES,
    _editorSnapOptionLabelsPure,
    _editorSnapSubdivisionsPure,
    _editorEffectiveSnapValuePure,
} from '../src/snap.js';

let pass = 0;
let fail = 0;
function t(name, fn) {
    try { fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}

t('keeps 1/4 as the default snap index', () => {
    // 1/4 shifts to index 3 once 1/3T is inserted ahead of it; the S.snapIdx
    // default in src/main.js must track this (default 1/4).
    assert.strictEqual(SNAP_OPTIONS[3].label, '1/4');
    assert.strictEqual(SNAP_VALUES[3], 0.25);
});

t('includes dense and triplet-friendly snap divisions', () => {
    // Triplet-family divisions (3, 6, 12, 24, 48, 96) carry a `T` suffix so the
    // grid is legible; 1/3T + 1/6T are the coarse triplets ported from #62.
    assert.deepStrictEqual(_editorSnapOptionLabelsPure(), [
        '1/1', '1/2', '1/3T', '1/4', '1/6T', '1/8', '1/12T', '1/16',
        '1/24T', '1/32', '1/48T', '1/64', '1/96T',
    ]);
});

t('maps snap values to beat subdivisions', () => {
    assert.strictEqual(_editorSnapSubdivisionsPure(1 / 3), 3);
    assert.strictEqual(_editorSnapSubdivisionsPure(1 / 6), 6);
    assert.strictEqual(_editorSnapSubdivisionsPure(1 / 24), 24);
    assert.strictEqual(_editorSnapSubdivisionsPure(1 / 32), 32);
    assert.strictEqual(_editorSnapSubdivisionsPure(1 / 96), 96);
    assert.strictEqual(_editorSnapSubdivisionsPure(0), 0);
});


t('separates snap enabled state from selected resolution', () => {
    assert.strictEqual(_editorEffectiveSnapValuePure(true, 1 / 32), 1 / 32);
    assert.strictEqual(_editorEffectiveSnapValuePure(false, 1 / 32), 0);
});
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
