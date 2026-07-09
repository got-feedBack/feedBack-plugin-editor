'use strict';
/*
 * Tests for the metronome's pure window query (@pure:guide-clap block):
 * _metroClicksInWindowPure picks which beat rows to click each scheduler
 * tick and marks downbeats (measure > 0) for the accent; sub-beats carry
 * measure -1 in the editor's beat grid.
 *
 * Same half-open [from, to) contract as the guide-clap query so the shared
 * lookahead loop never double-fires a beat across adjacent ticks.
 *
 * Run: node tests/metronome_click.test.js
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
const m = src.match(/\/\* @pure:guide-clap:start \*\/[\s\S]*?\/\* @pure:guide-clap:end \*\//);
if (!m) {
    console.error('FAIL: @pure:guide-clap block not found in screen.js');
    process.exit(1);
}

const { _metroClicksInWindowPure } = new Function(
    '"use strict";' + m[0] + '\nreturn { _metroClicksInWindowPure };'
)();

let pass = 0, fail = 0;
function t(name, fn) {
    try { fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}

// A bar of 4/4 at 120 BPM starting at 0.5 s: downbeat + three sub-beats,
// then the next bar's downbeat.
const BEATS = [
    { time: 0.5, measure: 1 },
    { time: 1.0, measure: -1 },
    { time: 1.5, measure: -1 },
    { time: 2.0, measure: -1 },
    { time: 2.5, measure: 2 },
];

t('clicks every beat row in the window, accenting downbeats only', () => {
    const out = _metroClicksInWindowPure(BEATS, 0.0, 3.0);
    assert.deepStrictEqual(out, [
        { t: 0.5, accent: true },
        { t: 1.0, accent: false },
        { t: 1.5, accent: false },
        { t: 2.0, accent: false },
        { t: 2.5, accent: true },
    ]);
});

t('half-open window: beat at `from` clicks, beat at `to` waits', () => {
    assert.deepStrictEqual(
        _metroClicksInWindowPure(BEATS, 1.0, 2.0),
        [{ t: 1.0, accent: false }, { t: 1.5, accent: false }]);
});

t('adjacent windows never double-fire a beat', () => {
    const a = _metroClicksInWindowPure(BEATS, 0.0, 1.5);
    const b = _metroClicksInWindowPure(BEATS, 1.5, 3.0);
    assert.strictEqual(a.length + b.length, BEATS.length, 'each beat exactly once');
});

t('degenerate inputs return []', () => {
    assert.deepStrictEqual(_metroClicksInWindowPure([], 0, 1), []);
    assert.deepStrictEqual(_metroClicksInWindowPure(null, 0, 1), []);
    assert.deepStrictEqual(_metroClicksInWindowPure(BEATS, 2, 1), []);
    assert.deepStrictEqual(_metroClicksInWindowPure(BEATS, 1, 1), []);
});

t('binary search lands correctly mid-array', () => {
    const beats = [];
    for (let i = 0; i < 4000; i++) beats.push({ time: i * 0.5, measure: i % 4 === 0 ? (i / 4) + 1 : -1 });
    const out = _metroClicksInWindowPure(beats, beats[2000].time, beats[2000].time + 1.0);
    assert.strictEqual(out.length, 2);
    assert.strictEqual(out[0].t, beats[2000].time);
    assert.strictEqual(out[0].accent, true, 'i=2000 is a downbeat (2000 % 4 === 0)');
    assert.strictEqual(out[1].accent, false);
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
