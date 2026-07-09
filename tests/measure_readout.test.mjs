/*
 * Measure/signature readout helper tests for src/main.js.
 *
 * Run: node tests/measure_readout.test.mjs
 */
import assert from 'node:assert';
import fs from 'node:fs';
import { _tempoNormalizeDenominatorPure } from '../src/tempo.js';

// The time-signature pures moved to src/tempo.js and are real imports. The
// readout itself is still inline in src/main.js, so it is still sliced — with
// the one pure it depends on injected.
const src = fs.readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
const mr = src.match(/\/\* @pure:measure-readout:start \*\/[\s\S]*?\/\* @pure:measure-readout:end \*\//);
if (!mr) {
    console.error('FAIL: @pure:measure-readout block not found in src/main.js');
    process.exit(1);
}
const { _editorMeasureSignatureReadoutPure } = new Function(
    '_tempoNormalizeDenominatorPure',
    '"use strict";' + mr[0] + '\nreturn { _editorMeasureSignatureReadoutPure };'
)(_tempoNormalizeDenominatorPure);

let pass = 0;
let fail = 0;
function t(name, fn) {
    try { fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}

const beats = [
    { time: 0, measure: 1, den: 4 },
    { time: 1, measure: -1 },
    { time: 2, measure: -1 },
    { time: 3, measure: -1 },
    { time: 4, measure: 2, den: 8 },
    { time: 5, measure: -1 },
    { time: 6, measure: -1 },
    { time: 7, measure: -1 },
    { time: 8, measure: 3 },
    { time: 9, measure: -1 },
    { time: 10, measure: -1 },
    { time: 11, measure: -1 },
];

t('follows the cursor measure in note view', () => {
    assert.deepStrictEqual(_editorMeasureSignatureReadoutPure(beats, 4.25, -1), {
        label: 'M2 4/8', measure: 2, numerator: 4, denominator: 8,
    });
});

t('prefers selected tempo sync point over cursor time', () => {
    assert.strictEqual(_editorMeasureSignatureReadoutPure(beats, 1.2, 4).label, 'M2 4/8');
});

t('falls back to denominator 4 when no denominator is authored', () => {
    assert.strictEqual(_editorMeasureSignatureReadoutPure(beats, 8.1, -1).label, 'M3 4/4');
});

t('returns empty label shape when there is no downbeat grid', () => {
    assert.deepStrictEqual(_editorMeasureSignatureReadoutPure([{ time: 0, measure: -1 }], 0, -1), {
        label: 'M-- --', measure: null, numerator: null, denominator: null,
    });
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);