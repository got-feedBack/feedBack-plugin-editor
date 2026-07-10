'use strict';
/*
 * Render-geometry test for `drawWaveform` in src/waveform.js. Runs the real draw
 * routine against a stub 2D context and a synthetic min/max/RMS cache, then
 * inspects the emitted fillRect()s to prove the new visualization:
 *   - a peak envelope that follows the TRUE asymmetric shape (top extent and
 *     bottom extent differ when min ≠ -max), not a mirrored magnitude band, and
 *   - an RMS body, symmetric about the zero line and contained in the envelope.
 * drawWaveform's globals (ctx, S, geometry, time mappings) are injected as
 * parameters of the extracting Function so it runs in isolation.
 *
 * Run: node tests/waveform_render.test.js
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

const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'waveform.js'), 'utf8');

const WAVEFORM_H = 70, LABEL_W = 60;
const ZOOM = 180, SCROLLX = 0;          // px/sec, seconds
const timeToX = (t) => LABEL_W + (t - SCROLLX) * ZOOM;
const xToTime = (x) => (x - LABEL_W) / ZOOM + SCROLLX;

// One asymmetric, physically-plausible bin: peaks +0.9 / -0.3, RMS 0.25.
const S = {
    duration: 4,
    waveformPeaks: {
        bins: 1,
        max: Float32Array.from([0.9]),
        min: Float32Array.from([-0.3]),
        rms: Float32Array.from([0.25]),
    },
};

const rects = [];
const ctx = {
    fillStyle: '', strokeStyle: '', lineWidth: 1,
    fillRect: (x, y, w, h) => rects.push({ style: ctx.fillStyle, x, y, w, h }),
    beginPath() {}, moveTo() {}, lineTo() {}, stroke() {},
};

const drawWaveform = new Function(
    'ctx', 'S', 'WAVEFORM_H', 'LABEL_W', 'timeToX', 'xToTime',
    '"use strict";' + extractFn(src, 'drawWaveform') + '\nreturn drawWaveform;'
)(ctx, S, WAVEFORM_H, LABEL_W, timeToX, xToTime);

drawWaveform(800);

let pass = 0, fail = 0;
function t(name, fn) {
    try { fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}

const ENV = 'rgba(90,150,235,0.40)';
const RMS = 'rgba(130,185,255,0.85)';
const mid = WAVEFORM_H / 2, amp = WAVEFORM_H / 2 - 4;
const envRects = () => rects.filter(r => r.style === ENV);
const rmsRects = () => rects.filter(r => r.style === RMS);

t('draws both an envelope layer and an RMS body layer', () => {
    assert.ok(envRects().length > 0, 'expected peak-envelope rects');
    assert.ok(rmsRects().length > 0, 'expected RMS body rects');
});

t('envelope follows the asymmetric shape (top extent ≠ bottom extent)', () => {
    const r = envRects()[0];
    const topExtent = mid - r.y;          // above the zero line (max = +0.9)
    const botExtent = (r.y + r.h) - mid;  // below the zero line (min = -0.3)
    assert.ok(topExtent > botExtent + 1, `asymmetric: top ${topExtent} > bottom ${botExtent}`);
    // Maps to the real sample extremes, not |max| mirrored.
    assert.ok(Math.abs(topExtent - 0.9 * amp) < 1.0, 'top ≈ max·amp');
    assert.ok(Math.abs(botExtent - 0.3 * amp) < 1.0, 'bottom ≈ |min|·amp');
});

t('RMS body is symmetric about the zero line and inside the envelope', () => {
    const r = rmsRects()[0];
    const center = r.y + r.h / 2;
    assert.ok(Math.abs(center - mid) < 1.0, 'RMS body centered on zero line');
    const env = envRects()[0];
    assert.ok(r.y >= env.y - 0.01 && (r.y + r.h) <= (env.y + env.h) + 0.01,
        'RMS body contained within the peak envelope');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
