/*
 * Windowed audio-region waveform (track-regions PR4, step 5): _regionWaveWindowPure
 * maps a region to the chart-time span + media window [srcIn,srcOut) its waveform
 * thumbnail draws — so a trimmed/moved audio region shows only its own slice.
 *
 * Pinned here:
 *   - the default full-span region resolves to the WHOLE buffer at `shift`,
 *     independent of the grid origin (placement is measured from beat 0), so the
 *     pre-region single-pass draw is reproduced byte-for-byte;
 *   - a trimmed + moved region maps to [srcIn,srcOut) starting at its placed time;
 *   - an absent srcOut opens to the buffer end; a srcOut past the buffer clamps.
 *
 * Fails on main: _regionWaveWindowPure does not exist there.
 *
 * Run: node tests/region_waveform.test.mjs
 */
import assert from 'node:assert';

const { _regionWaveWindowPure } = await import('../src/parts-view.js');

let pass = 0; let fail = 0;
const tests = [];
const t = (name, fn) => tests.push([name, fn]);
const near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;
const winNear = (win, exp) => {
    for (const k of ['startTime', 'endTime', 'srcIn', 'srcOut']) {
        assert.ok(near(win[k], exp[k]), `${k}: ${win[k]} vs ${exp[k]}`);
    }
};

t('default region → whole buffer at the shift, independent of the grid origin', () => {
    // beatToTime with a NONZERO value at beat 0 (origin offset 7): the default
    // region must still sit at exactly `shift` because placement is beat-0-relative.
    const b2t = (b) => b * 0.5 + 7;
    winNear(_regionWaveWindowPure({ id: 'region:1', startBeat: 0, lenBeat: null }, 4, 30, b2t),
        { startTime: 4, endTime: 34, srcIn: 0, srcOut: 30 });
});
t('a trimmed + moved region maps to its [srcIn,srcOut) slice at its placed start', () => {
    const b2t = (b) => b * 0.5;
    winNear(_regionWaveWindowPure({ id: 'r2', startBeat: 8, srcIn: 2, srcOut: 6 }, 1, 30, b2t),
        { startTime: 5, endTime: 9, srcIn: 2, srcOut: 6 });   // 1 + (4-0) = 5; a 4s window
});
t('srcOut absent → buffer end; srcOut past the buffer → clamped', () => {
    const b2t = (b) => b * 0.5;
    winNear(_regionWaveWindowPure({ id: 'r3', startBeat: 0, srcIn: 3 }, 0, 30, b2t),
        { startTime: 0, endTime: 27, srcIn: 3, srcOut: 30 });   // open → dur
    winNear(_regionWaveWindowPure({ id: 'r4', startBeat: 0, srcIn: 1, srcOut: 999 }, 0, 30, b2t),
        { startTime: 0, endTime: 29, srcIn: 1, srcOut: 30 });   // clamp to dur
});

for (const [name, fn] of tests) {
    try { await fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
