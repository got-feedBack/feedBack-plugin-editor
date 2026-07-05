'use strict';
/*
 * Tempo-map BPM helper tests for screen.js.
 *
 * Run: node tests/tempo_map_bpm.test.js
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const src = fs.readFileSync(path.join(__dirname, '..', 'screen.js'), 'utf8');
const m = src.match(/\/\* @pure:tempo-map-bpm:start \*\/[\s\S]*?\/\* @pure:tempo-map-bpm:end \*\//);
if (!m) {
    console.error('FAIL: @pure:tempo-map-bpm block not found in screen.js');
    process.exit(1);
}

const api = new Function(
    '"use strict";' + m[0] + '\nreturn { _tempoSetMeasureBpmPure, _tempoMeasureBpmsPure, _tempoHasMultipleMeasureBpmsPure };'
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
    { time: 2, measure: 2 },
    { time: 3, measure: -1 },
    { time: 4, measure: 3 },
    { time: 5, measure: -1 },
];

t('changes one measure BPM and rigid-shifts the tail', () => {
    const out = api._tempoSetMeasureBpmPure(beats, 0, 120, 0.05, v => Math.round(v * 1000) / 1000);
    assert.deepStrictEqual(out.map(b => b.time), [0, 0.5, 1, 2, 3, 4]);
    assert.deepStrictEqual(out.map(b => b.measure), beats.map(b => b.measure));
});

t('supports slowing a selected measure without changing later measure lengths', () => {
    const out = api._tempoSetMeasureBpmPure(beats, 2, 30, 0.05, v => Math.round(v * 1000) / 1000);
    assert.deepStrictEqual(out.map(b => b.time), [0, 1, 2, 4, 6, 7]);
});

t('returns null for the final measure with no closing downbeat', () => {
    assert.strictEqual(api._tempoSetMeasureBpmPure(beats, 4, 90, 0.05, v => v), null);
});

t('detects whether the grid has multiple measure tempos', () => {
    assert.strictEqual(api._tempoHasMultipleMeasureBpmsPure(beats, 0.01), false);
    const varied = [
        { time: 0, measure: 1 },
        { time: 1, measure: -1 },
        { time: 2, measure: 2 },
        { time: 2.5, measure: -1 },
        { time: 3, measure: 3 },
    ];
    assert.deepStrictEqual(api._tempoMeasureBpmsPure(varied, v => Math.round(v)), [60, 120]);
    assert.strictEqual(api._tempoHasMultipleMeasureBpmsPure(varied, 0.01), true);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
