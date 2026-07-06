'use strict';
/*
 * Tests for tap tempo's pure estimator (@pure:tap-tempo block).
 *
 * Shift+B (Tempo Map mode) taps against the recording; the MEDIAN of the
 * last 8 inter-tap intervals becomes a pending BPM for the selected sync
 * point (Enter applies via _tempoSetMeasureBpm as one undoable command).
 * Median — not mean — so one flubbed tap doesn't skew the estimate; the
 * highest-value tool for hand-syncing recordings made without a click.
 *
 * Run: node tests/tap_tempo.test.js
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const src = fs.readFileSync(path.join(__dirname, '..', 'screen.js'), 'utf8');
const m = src.match(/\/\* @pure:tap-tempo:start \*\/[\s\S]*?\/\* @pure:tap-tempo:end \*\//);
if (!m) {
    console.error('FAIL: @pure:tap-tempo block not found in screen.js');
    process.exit(1);
}
const { _tapTempoBpmPure } = new Function(
    '"use strict";' + m[0] + '\nreturn { _tapTempoBpmPure };'
)();

let pass = 0, fail = 0;
function t(name, fn) {
    try { fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}

// Build taps at a fixed interval (ms).
const run = (n, ms, start = 1000) => Array.from({ length: n }, (_, i) => start + i * ms);

t('steady 120 BPM taps → 120', () => {
    assert.strictEqual(_tapTempoBpmPure(run(5, 500)), 120);
});

t('fewer than 2 taps → null', () => {
    assert.strictEqual(_tapTempoBpmPure([]), null);
    assert.strictEqual(_tapTempoBpmPure([1000]), null);
    assert.strictEqual(_tapTempoBpmPure(null), null);
});

t('median rejects one flubbed tap (mean would not)', () => {
    // 4 clean 500 ms gaps + one 900 ms stumble: median stays 500 → 120 BPM.
    const taps = [1000, 1500, 2000, 2900, 3400, 3900];
    assert.strictEqual(_tapTempoBpmPure(taps), 120);
});

t('only the last 8 intervals count (early sloppy taps age out)', () => {
    // 5 sloppy 1000 ms gaps followed by 8 clean 400 ms gaps → 150 BPM.
    const sloppy = run(6, 1000, 0);
    const clean = run(9, 400, sloppy[sloppy.length - 1] + 400);
    assert.strictEqual(_tapTempoBpmPure([...sloppy, ...clean]), 150);
});

t('implausible tempos are rejected, not offered', () => {
    assert.strictEqual(_tapTempoBpmPure(run(4, 100)), null, '600 BPM → null');
    assert.strictEqual(_tapTempoBpmPure(run(4, 4000)), null, '15 BPM → null');
    assert.strictEqual(_tapTempoBpmPure(run(3, 150)), 400, '400 BPM boundary kept');
});

t('non-monotonic or duplicate timestamps → null (bad clock, no guess)', () => {
    assert.strictEqual(_tapTempoBpmPure([1000, 900, 1400]), null);
    assert.strictEqual(_tapTempoBpmPure([1000, 1000, 1500]), null);
});

t('even interval count uses the middle pair average', () => {
    // Gaps 480 and 520 → median 500 → 120 BPM.
    assert.strictEqual(_tapTempoBpmPure([0, 480, 1000]), 120);
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
