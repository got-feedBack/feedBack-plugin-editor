'use strict';
/*
 * Tests for `_buildWaveformPeaks` in src/main.js — the pure min/max/RMS cache
 * builder behind the editor's waveform. It must capture the true (asymmetric)
 * signed extremes per bin plus per-bin RMS, soak the remainder into the last
 * bin, and stay sane for tiny inputs. The helper is pure; extract it by
 * brace-matching and eval in isolation.
 *
 * Run: node tests/waveform_peaks.test.js
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

function extractFn(src, name) {
    const start = src.indexOf('function ' + name);
    assert.ok(start >= 0, `function ${name} must exist`);
    const open = src.indexOf('{', start);
    let depth = 0;
    for (let i = open; i < src.length; i++) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}' && --depth === 0) return src.slice(start, i + 1);
    }
    throw new Error(`unbalanced braces extracting ${name}`);
}

const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'audio.js'), 'utf8');
const _buildWaveformPeaks = new Function(
    '"use strict";' + extractFn(src, '_buildWaveformPeaks') +
    '\nreturn _buildWaveformPeaks;')();

let pass = 0, fail = 0;
function t(name, fn) {
    try { fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}
const approx = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} ≈ ${b}`);

t('bin count = floor(len / binSamples)', () => {
    const r = _buildWaveformPeaks(new Float32Array(1000), 100);
    assert.strictEqual(r.bins, 10);
    assert.strictEqual(r.min.length, 10);
    assert.strictEqual(r.max.length, 10);
    assert.strictEqual(r.rms.length, 10);
});

t('captures signed asymmetric extremes per bin', () => {
    // Bin 0: peaks +0.8 / -0.2 ; bin 1: peaks +0.1 / -0.9
    const data = Float32Array.from([0.8, -0.2, 0.0, 0.1, 0.1, -0.9, 0.0, 0.1]);
    const r = _buildWaveformPeaks(data, 4);
    assert.strictEqual(r.bins, 2);
    approx(r.max[0], 0.8); approx(r.min[0], -0.2);
    approx(r.max[1], 0.1); approx(r.min[1], -0.9);
});

t('RMS is per-bin loudness', () => {
    // Alternating ±0.5 → RMS = 0.5; constant 0 → RMS = 0.
    const data = Float32Array.from([0.5, -0.5, 0.5, -0.5, 0, 0, 0, 0]);
    const r = _buildWaveformPeaks(data, 4);
    approx(r.rms[0], 0.5);
    approx(r.rms[1], 0);
});

t('last bin soaks up the remainder (no dropped tail)', () => {
    // 9 samples, binSamples 4 → bins = floor(9/4) = 2; last bin covers idx 4..8.
    const data = Float32Array.from([0, 0, 0, 0, 0.3, 0.3, 0.3, 0.3, 1.0]);
    const r = _buildWaveformPeaks(data, 4);
    assert.strictEqual(r.bins, 2);
    approx(r.max[1], 1.0); // the trailing 1.0 must land in the last bin
});

t('tiny input (shorter than one bin) yields a single covering bin', () => {
    const data = Float32Array.from([0.2, -0.4, 0.6]);
    const r = _buildWaveformPeaks(data, 100);
    assert.strictEqual(r.bins, 1);
    approx(r.max[0], 0.6); approx(r.min[0], -0.4);
});

t('silence yields zeroed bins (no NaN/Infinity)', () => {
    const r = _buildWaveformPeaks(new Float32Array(400), 100);
    for (let i = 0; i < r.bins; i++) {
        assert.strictEqual(r.min[i], 0);
        assert.strictEqual(r.max[i], 0);
        assert.strictEqual(r.rms[i], 0);
    }
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
