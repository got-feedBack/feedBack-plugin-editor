'use strict';
/*
 * Flatten a variable tempo map to a constant BPM — tester report: a GP8 import
 * produced a per-measure tempo map (wrong, varying BPM) and there was "no way to
 * remove all the BPM sync points without deleting measures." _tempoFlattenToBpmPure
 * rebuilds the beat grid as ONE uniform constant-BPM grid (anchored at the first
 * beat, metadata preserved), which the BPM field now offers when the map varies.
 *
 * References _tempoFlattenToBpmPure (absent on main), so the suite fails on main.
 *
 * Run: node tests/tempo_flatten.test.js
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const src = fs.readFileSync(path.join(__dirname, '..', 'screen.js'), 'utf8');
const m = src.match(/\/\* @pure:tempo-map-bpm:start \*\/[\s\S]*?\/\* @pure:tempo-map-bpm:end \*\//);
if (!m) { console.error('FAIL: @pure:tempo-map-bpm block not found'); process.exit(1); }
const { _tempoFlattenToBpmPure, _tempoMeasureBpmsPure, _tempoHasMultipleMeasureBpmsPure } =
    new Function('"use strict";' + m[0] +
        '\nreturn { _tempoFlattenToBpmPure, _tempoMeasureBpmsPure, _tempoHasMultipleMeasureBpmsPure };')();

let pass = 0, fail = 0;
function t(name, fn) {
    try { fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + (e && e.message)); }
}
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-6, `${msg || ''} (${a} ≉ ${b})`);

// A 3-measure 4/4 grid with a WRONG, VARYING tempo (like a bad import): measures
// span 2.0s, 2.4s, 1.9s → per-measure BPMs ~120 / 100 / ~126. 4 beats/measure.
function variableGrid() {
    const spans = [2.0, 2.4, 1.9];
    const beats = [];
    let tRun = 0;
    for (let mi = 0; mi < spans.length; mi++) {
        const beatDur = spans[mi] / 4;
        for (let bi = 0; bi < 4; bi++) {
            beats.push({ time: +(tRun + bi * beatDur).toFixed(6), measure: bi === 0 ? mi + 1 : 0, num: 4, den: 4 });
        }
        tRun += spans[mi];
    }
    // trailing downbeat so the last real measure has a span to measure against
    beats.push({ time: +tRun.toFixed(6), measure: spans.length + 1, num: 4, den: 4 });
    return beats;
}

t('precondition: the sample grid really is a VARIABLE tempo map', () => {
    assert.ok(_tempoHasMultipleMeasureBpmsPure(variableGrid(), 0.01), 'grid must vary to be worth flattening');
});

t('flatten produces a uniform 60/bpm grid, first beat anchored, metadata kept', () => {
    const grid = variableGrid();
    const flat = _tempoFlattenToBpmPure(grid, 140);
    assert.ok(Array.isArray(flat) && flat.length === grid.length, 'same beat count');
    const span = 60 / 140;
    assert.strictEqual(flat[0].time, grid[0].time, 'first beat anchored (start time preserved)');
    for (let i = 1; i < flat.length; i++) {
        near(flat[i].time - flat[i - 1].time, span, `beat ${i} spacing`);
    }
    // measure / signature metadata carried through untouched
    for (let i = 0; i < grid.length; i++) {
        assert.strictEqual(flat[i].measure, grid[i].measure, `measure[${i}] preserved`);
        assert.strictEqual(flat[i].den, grid[i].den, `den[${i}] preserved`);
    }
});

t('after flatten the map is CONSTANT at the requested BPM (round-trips through the BPM reader)', () => {
    const flat = _tempoFlattenToBpmPure(variableGrid(), 140);
    assert.ok(!_tempoHasMultipleMeasureBpmsPure(flat, 0.01), 'no longer a variable map');
    for (const bpm of _tempoMeasureBpmsPure(flat, v => Math.round(v * 100) / 100)) {
        near(bpm, 140, 'each measure now reads 140 BPM');
    }
});

t('a non-zero start offset is preserved (grid keeps its origin)', () => {
    const grid = variableGrid().map(b => ({ ...b, time: b.time + 0.5 }));
    const flat = _tempoFlattenToBpmPure(grid, 120);
    assert.strictEqual(flat[0].time, grid[0].time, 'origin (0.5s) preserved');
});

t('adversarial: too-few beats / bad bpm return null (no throw)', () => {
    assert.strictEqual(_tempoFlattenToBpmPure([{ time: 0, measure: 1 }], 140), null, '<2 beats');
    assert.strictEqual(_tempoFlattenToBpmPure(variableGrid(), 0), null, 'bpm 0');
    assert.strictEqual(_tempoFlattenToBpmPure(variableGrid(), -5), null, 'negative bpm');
    assert.strictEqual(_tempoFlattenToBpmPure(null, 140), null, 'null beats');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
