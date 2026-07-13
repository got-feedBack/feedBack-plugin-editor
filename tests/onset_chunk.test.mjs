/*
 * Chunked onset analysis (#248 follow-up). The banded spectral-flux STFT is now
 * split into a resumable plan/step so the (few-hundred-ms) compute can run across
 * rAF ticks instead of freezing a frame; _ensureOnsets returns the cheap RMS
 * onsets immediately and upgrades in the background. The correctness contract is
 * that chunking changes NOTHING about the result: stepping a plan in any budget
 * split is bit-identical to the one-shot _spectralFluxFramesPure, so the sharper
 * onsets a user eventually sees are exactly what the synchronous path produced.
 *
 * Run: node --test tests/onset_chunk.test.mjs
 */
import assert from 'node:assert';
import {
    _spectralFluxPlan, _spectralFluxStep, _spectralFluxFramesPure, _pickOnsetsPure,
} from '../src/onsets.js';

let pass = 0, fail = 0;
function t(name, fn) {
    try { fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}

// A click train at 22050 (factor-1 so plan == frames directly, no downsample).
function clickTrain(sr = 22050, dur = 0.6, times = [0.1, 0.25, 0.4]) {
    const n = Math.floor(sr * dur);
    const x = new Float32Array(n);
    for (const ct of times) {
        const s = Math.round(ct * sr);
        for (let i = 0; i < 150; i++) x[s + i] = Math.sin((2 * Math.PI * 1200 * i) / sr) * (1 - i / 150);
    }
    return x;
}
const sameArr = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

t('stepping a plan in tiny budgets is bit-identical to the one-shot frames', () => {
    const x = clickTrain();
    const oneShot = _spectralFluxFramesPure(x, 22050, { fftSize: 512, hop: 512 });
    for (const budget of [1, 3, 7, 50, 100000]) {
        const plan = _spectralFluxPlan(x, 22050, { fftSize: 512, hop: 512 });
        let guard = 0;
        while (!_spectralFluxStep(plan, budget)) { if (++guard > 1e6) throw new Error('did not terminate'); }
        assert.ok(sameArr(plan.res.total, oneShot.total), `total identical @budget ${budget}`);
        assert.ok(sameArr(plan.res.lo, oneShot.lo) && sameArr(plan.res.mid, oneShot.mid) && sameArr(plan.res.hi, oneShot.hi),
            `bands identical @budget ${budget}`);
        assert.strictEqual(plan.res.frames, oneShot.frames);
    }
});

t('step returns true exactly when the last frame is done, false before', () => {
    const x = clickTrain();
    const plan = _spectralFluxPlan(x, 22050, { fftSize: 512, hop: 512 });
    const half = plan.frames >> 1;
    assert.strictEqual(_spectralFluxStep(plan, half), false, 'not done at the halfway point');
    assert.strictEqual(plan.next, half);
    assert.strictEqual(_spectralFluxStep(plan, plan.frames), true, 'done once the rest is consumed');
    assert.strictEqual(plan.next, plan.frames);
    // stepping past the end stays done and touches nothing more
    assert.strictEqual(_spectralFluxStep(plan, 100), true);
});

t('chunked onsets equal one-shot onsets (same peaks, same times)', () => {
    const x = clickTrain();
    const oneShot = _pickOnsetsPure(_spectralFluxFramesPure(x, 22050, { fftSize: 512, hop: 512 }), {});
    const plan = _spectralFluxPlan(x, 22050, { fftSize: 512, hop: 512 });
    while (!_spectralFluxStep(plan, 4)) { /* chunk by 4 */ }
    const chunked = _pickOnsetsPure(plan.res, {});
    assert.deepStrictEqual(chunked, oneShot, 'identical onset events');
});

t('a zero-frame plan is done immediately with empty output', () => {
    const plan = _spectralFluxPlan(new Float32Array(10), 22050, { fftSize: 512, hop: 512 });
    assert.strictEqual(plan.frames, 0);
    assert.strictEqual(_spectralFluxStep(plan, 100), true);
    assert.strictEqual(plan.res.total.length, 0);
    assert.deepStrictEqual(_pickOnsetsPure(plan.res, {}), []);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
