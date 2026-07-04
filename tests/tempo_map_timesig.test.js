'use strict';
/*
 * Tempo-map time-signature helper tests for screen.js.
 *
 * Run: node tests/tempo_map_timesig.test.js
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const src = fs.readFileSync(path.join(__dirname, '..', 'screen.js'), 'utf8');
const m = src.match(/\/\* @pure:tempo-map-timesig:start \*\/[\s\S]*?\/\* @pure:tempo-map-timesig:end \*\//);
if (!m) {
    console.error('FAIL: @pure:tempo-map-timesig block not found in screen.js');
    process.exit(1);
}

const api = new Function(
    '"use strict";' + m[0] + '\nreturn { _tempoSetBeatsPerMeasurePure, _tempoNormalizeDenominatorPure, _tempoSetDenominatorOnBeatsPure };'
)();

let pass = 0;
let fail = 0;
function t(name, fn) {
    try { fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}

const beats = [
    { time: 0, measure: 1 },
    { time: 1, measure: -1 },
    { time: 2, measure: -1 },
    { time: 3, measure: -1 },
    { time: 4, measure: 2 },
    { time: 5, measure: -1 },
];

t('resubdivides a measure without moving surrounding downbeats', () => {
    const out = api._tempoSetBeatsPerMeasurePure(beats, 0, 7, 6, v => Math.round(v * 1000) / 1000);
    assert.deepStrictEqual(out.map(b => b.time), [0, 0.571, 1.143, 1.714, 2.286, 2.857, 3.429, 4, 5]);
    assert.deepStrictEqual(out.map(b => b.measure), [1, -1, -1, -1, -1, -1, -1, 2, -1]);
});

t('clamps beat count to the supported 1 to 16 range', () => {
    const out = api._tempoSetBeatsPerMeasurePure(beats, 0, 99, 6, v => Math.round(v * 1000) / 1000);
    assert.strictEqual(out.filter(b => b.measure <= 0 && b.time > 0 && b.time < 4).length, 15);
});

t('can resubdivide the final measure using duration as the closing boundary', () => {
    const out = api._tempoSetBeatsPerMeasurePure(beats, 4, 3, 8, v => Math.round(v * 1000) / 1000);
    assert.deepStrictEqual(out.map(b => b.time), [0, 1, 2, 3, 4, 5.333, 6.667]);
});

t('normalizes supported beat-unit denominators', () => {
    assert.strictEqual(api._tempoNormalizeDenominatorPure(2), 2);
    assert.strictEqual(api._tempoNormalizeDenominatorPure('8'), 8);
    assert.strictEqual(api._tempoNormalizeDenominatorPure(3), 4);
    assert.strictEqual(api._tempoNormalizeDenominatorPure('bad'), 4);
});

t('sets denominator on a selected downbeat without moving beat times', () => {
    const out = api._tempoSetDenominatorOnBeatsPure(beats, 0, 8);
    assert.deepStrictEqual(out.map(b => b.time), beats.map(b => b.time));
    assert.strictEqual(out[0].den, 8);
    assert.strictEqual(beats[0].den, undefined);
});

t('rejects denominator changes on non-downbeats', () => {
    assert.strictEqual(api._tempoSetDenominatorOnBeatsPure(beats, 1, 8), null);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);