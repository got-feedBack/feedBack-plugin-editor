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

const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
const m = src.match(/\/\* @pure:tap-tempo:start \*\/[\s\S]*?\/\* @pure:tap-tempo:end \*\//);
if (!m) {
    console.error('FAIL: @pure:tap-tempo block not found in src/main.js');
    process.exit(1);
}
const { _tapTempoBpmPure, _tapTempoStatusReasonPure } = new Function(
    '"use strict";' + m[0] + '\nreturn { _tapTempoBpmPure, _tapTempoStatusReasonPure };'
)();

const ma = src.match(/\/\* @pure:tap-tempo-apply:start \*\/[\s\S]*?\/\* @pure:tap-tempo-apply:end \*\//);
if (!ma) {
    console.error('FAIL: @pure:tap-tempo-apply block not found in src/main.js');
    process.exit(1);
}
const { _tapTempoApplyDecisionPure } = new Function(
    '"use strict";' + ma[0] + '\nreturn { _tapTempoApplyDecisionPure };'
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

t('status reason distinguishes out-of-range from insufficient', () => {
    assert.strictEqual(_tapTempoStatusReasonPure(run(4, 100)), 'out-of-range', '600 BPM is out of range, not "keep tapping"');
    assert.strictEqual(_tapTempoStatusReasonPure(run(4, 4000)), 'out-of-range', '15 BPM is out of range');
    assert.strictEqual(_tapTempoStatusReasonPure([1000]), 'insufficient', 'one tap → still insufficient');
    assert.strictEqual(_tapTempoStatusReasonPure([1000, 900]), 'insufficient', 'bad clock → insufficient, no guess');
    assert.strictEqual(_tapTempoStatusReasonPure(run(5, 500)), 'ok', 'steady 120 BPM → ok');
});

// Apply-time revalidation: a run captured against sync point d must not apply
// to a different currently-selected sync point (the stale-measure bug).
t('apply refuses a run whose target ≠ current selection', () => {
    const t = { d: 3, measure: 4, taps: [0, 500, 1000], bpm: 120 };
    const now = 1000;
    assert.strictEqual(_tapTempoApplyDecisionPure(t, 3, now, 15000), 'apply', 'same selection applies');
    assert.strictEqual(_tapTempoApplyDecisionPure(t, 5, now, 15000), 'stale-selection', 'moved selection refuses');
    assert.strictEqual(_tapTempoApplyDecisionPure(t, -1, now, 15000), 'stale-selection', 'deselected refuses');
});

t('apply decision also gates on taps and staleness', () => {
    const t = { d: 2, measure: 3, taps: [0, 500, 1000], bpm: 120 };
    assert.strictEqual(_tapTempoApplyDecisionPure(null, 2, 1000, 15000), 'none');
    assert.strictEqual(_tapTempoApplyDecisionPure({ ...t, bpm: null }, 2, 1000, 15000), 'too-few');
    assert.strictEqual(_tapTempoApplyDecisionPure(t, 2, 1000 + 15001, 15000), 'expired', 'aged past window');
    assert.strictEqual(_tapTempoApplyDecisionPure(t, 2, 1000, 15000), 'apply');
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
