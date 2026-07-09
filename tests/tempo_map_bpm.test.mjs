/*
 * Tempo-map BPM helper tests for src/main.js.
 *
 * Run: node tests/tempo_map_bpm.test.mjs
 */
import assert from 'node:assert';
import {
    _tempoHasMultipleMeasureBpmsPure,
    _tempoMeasureBpmsPure,
    _tempoParseBpmInputPure,
    _tempoSetMeasureBpmPure,
} from '../src/tempo.js';

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
    const out = _tempoSetMeasureBpmPure(beats, 0, 120, 0.05, v => Math.round(v * 1000) / 1000);
    assert.deepStrictEqual(out.map(b => b.time), [0, 0.5, 1, 2, 3, 4]);
    assert.deepStrictEqual(out.map(b => b.measure), beats.map(b => b.measure));
});

t('supports slowing a selected measure without changing later measure lengths', () => {
    const out = _tempoSetMeasureBpmPure(beats, 2, 30, 0.05, v => Math.round(v * 1000) / 1000);
    assert.deepStrictEqual(out.map(b => b.time), [0, 1, 2, 4, 6, 7]);
});

t('returns null for the final measure with no closing downbeat', () => {
    assert.strictEqual(_tempoSetMeasureBpmPure(beats, 4, 90, 0.05, v => v), null);
});


t('parses direct BPM input', () => {
    assert.strictEqual(_tempoParseBpmInputPure('120'), 120);
    assert.strictEqual(_tempoParseBpmInputPure('87.5'), 87.5);
    assert.strictEqual(_tempoParseBpmInputPure('0'), null);
    assert.strictEqual(_tempoParseBpmInputPure('-10'), null);
    assert.strictEqual(_tempoParseBpmInputPure('bad'), null);
});

t('detects whether the grid has multiple measure tempos', () => {
    assert.strictEqual(_tempoHasMultipleMeasureBpmsPure(beats, 0.01), false);
    const varied = [
        { time: 0, measure: 1 },
        { time: 1, measure: -1 },
        { time: 2, measure: 2 },
        { time: 2.5, measure: -1 },
        { time: 3, measure: 3 },
    ];
    assert.deepStrictEqual(_tempoMeasureBpmsPure(varied, v => Math.round(v)), [60, 120]);
    assert.strictEqual(_tempoHasMultipleMeasureBpmsPure(varied, 0.01), true);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
