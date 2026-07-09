'use strict';
/*
 * Tests for the onset strip's pure detector (@pure:onset-strip block):
 * _onsetTimesFromPeaksPure estimates transient positions from the waveform
 * RMS cache — the display-only "blocky" hint of where events likely live
 * in the recording (D22: never places notes).
 *
 * Detection rule under test: an onset fires where RMS rises sharply above
 * the local baseline (mean of the preceding window), gated by an absolute
 * noise floor and a refractory gap so one attack registers exactly once.
 *
 * Run: node tests/onset_strip.test.js
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
const m = src.match(/\/\* @pure:onset-strip:start \*\/[\s\S]*?\/\* @pure:onset-strip:end \*\//);
if (!m) {
    console.error('FAIL: @pure:onset-strip block not found in src/main.js');
    process.exit(1);
}
const { _onsetTimesFromPeaksPure } = new Function(
    '"use strict";' + m[0] + '\nreturn { _onsetTimesFromPeaksPure };'
)();

let pass = 0, fail = 0;
function t(name, fn) {
    try { fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}

const BIN = 0.003; // ~3 ms bins, matching computeWaveform

// Quiet floor with an attack+decay burst at each given bin index.
function signal(len, bursts, quiet = 0.02, peak = 0.9) {
    const rms = new Float32Array(len).fill(quiet);
    for (const b of bursts) {
        for (let k = 0; k < 20 && b + k < len; k++) {
            rms[b + k] = Math.max(rms[b + k], peak * Math.pow(0.82, k));
        }
    }
    return rms;
}

t('detects each isolated attack exactly once', () => {
    const rms = signal(2000, [200, 700, 1300]);
    const out = _onsetTimesFromPeaksPure(rms, BIN);
    assert.strictEqual(out.length, 3);
    const times = out.map(o => o.t);
    assert.ok(Math.abs(times[0] - 200 * BIN) < 0.01);
    assert.ok(Math.abs(times[1] - 700 * BIN) < 0.01);
    assert.ok(Math.abs(times[2] - 1300 * BIN) < 0.01);
});

t('refractory gap: bins inside one attack do not double-fire', () => {
    // A single 60 ms-wide burst — the decay bins must not re-trigger.
    const rms = signal(600, [300]);
    assert.strictEqual(_onsetTimesFromPeaksPure(rms, BIN).length, 1);
});

t('two hits past the refractory gap both fire (drum flam spacing ~60 ms)', () => {
    const rms = signal(800, [300, 322]); // 22 bins ≈ 66 ms apart
    assert.strictEqual(_onsetTimesFromPeaksPure(rms, BIN).length, 2);
});

t('silence and near-silence produce no onsets', () => {
    assert.deepStrictEqual(_onsetTimesFromPeaksPure(new Float32Array(500), BIN), []);
    const noise = new Float32Array(500).fill(0.001);
    assert.deepStrictEqual(_onsetTimesFromPeaksPure(noise, BIN), []);
});

t('a slow swell (no sharp rise) is not an onset', () => {
    const rms = new Float32Array(1000);
    for (let i = 0; i < 1000; i++) rms[i] = 0.9 * (i / 1000); // linear ramp
    assert.deepStrictEqual(_onsetTimesFromPeaksPure(rms, BIN), []);
});

t('strength scales with attack size', () => {
    const rms = signal(1200, [200], 0.02, 0.9);
    for (let k = 0; k < 20; k++) rms[800 + k] = Math.max(rms[800 + k], 0.25 * Math.pow(0.82, k));
    const out = _onsetTimesFromPeaksPure(rms, BIN);
    assert.strictEqual(out.length, 2);
    assert.ok(out[0].s > out[1].s, 'louder attack → higher strength');
    for (const o of out) assert.ok(o.s > 0 && o.s <= 1);
});

t('degenerate inputs return []', () => {
    assert.deepStrictEqual(_onsetTimesFromPeaksPure(null, BIN), []);
    assert.deepStrictEqual(_onsetTimesFromPeaksPure(new Float32Array(0), BIN), []);
    assert.deepStrictEqual(_onsetTimesFromPeaksPure(new Float32Array(100).fill(0.5), 0), []);
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
