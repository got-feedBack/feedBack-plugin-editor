/*
 * The octave rescue in Scan (stacked on the zone confirm bar): when the
 * detected tempo zones sit at ~2× or ~½ the grid's own tempo, the whole grid
 * is an octave off — the classic double-kick / half-time-backbeat charting
 * trap — and no per-bar re-fit can repair it. Scan now detects the mismatch
 * and the confirm bar offers the one-click half/double-time fix.
 *
 * Pinned here: the grid's median-BPM read, the mismatch classifier's
 * direction semantics (recording at 2× grid ⇒ DOUBLE the grid) and its
 * tolerance (ordinary drift never reads as an octave), and the null cases.
 * Fails on the base branch (the pures don't exist there).
 *
 * Run: node tests/scan_octave.test.mjs
 */
import assert from 'node:assert';

globalThis.document = globalThis.document || {
    getElementById: () => null, addEventListener: () => {}, activeElement: null,
};
globalThis.localStorage = globalThis.localStorage || { getItem: () => null, setItem: () => {} };
globalThis.window = globalThis.window || globalThis;

const { _gridMedianBpmPure, _segmentOctaveMismatchPure } = await import('../src/tempo-segment.js');
const { _gridOctaveRescuePure } = await import('../src/tempo.js');

let pass = 0, fail = 0;
function t(name, fn) {
    try { fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}

function grid(bars, bpm) {
    const beat = 60 / bpm;
    const beats = [];
    for (let m = 0; m < bars; m++) for (let b = 0; b < 4; b++) {
        beats.push({ time: (m * 4 + b) * beat, measure: b === 0 ? m + 1 : 0 });
    }
    return beats;
}

t('the grid median BPM reads a steady grid exactly and a mixed grid by its median', () => {
    assert.ok(Math.abs(_gridMedianBpmPure(grid(8, 120)) - 120) < 1e-6);
    // 6 bars at 120 + 3 bars at 90 → median measure is a 120 bar.
    const mixed = [...grid(6, 120)];
    const t0 = mixed[mixed.length - 1].time + 0.5;
    for (let m = 0; m < 3; m++) for (let b = 0; b < 4; b++) {
        mixed.push({ time: t0 + (m * 4 + b) * (60 / 90), measure: b === 0 ? 7 + m : 0 });
    }
    assert.ok(Math.abs(_gridMedianBpmPure(mixed) - 120) < 1);
    assert.strictEqual(_gridMedianBpmPure([]), null);
    assert.strictEqual(_gridMedianBpmPure([{ time: 0, measure: 1 }]), null);
});

t('recording at ~2× the grid ⇒ DOUBLE the grid; at ~½ ⇒ halve it', () => {
    assert.strictEqual(_segmentOctaveMismatchPure(236, 118), 'double', 'exact 2×');
    assert.strictEqual(_segmentOctaveMismatchPure(225, 118), 'double', '1.91× — inside the ±8%');
    assert.strictEqual(_segmentOctaveMismatchPure(59, 118), 'half', 'exact ½');
    assert.strictEqual(_segmentOctaveMismatchPure(62, 118), 'half', '0.53× — inside the band');
});

t('ordinary drift never reads as an octave error', () => {
    assert.strictEqual(_segmentOctaveMismatchPure(118, 120), null, '2% drift — the everyday case');
    assert.strictEqual(_segmentOctaveMismatchPure(150, 120), null, '1.25× is a real tempo change, not an octave');
    assert.strictEqual(_segmentOctaveMismatchPure(210, 118), null, '1.78× — outside the band');
    assert.strictEqual(_segmentOctaveMismatchPure(0, 120), null);
    assert.strictEqual(_segmentOctaveMismatchPure(120, 0), null);
});

t('the HALF rescue thins beats and merges bars — every surviving time exactly preserved', () => {
    const fast = grid(8, 236);                       // the trap: charted at 2× the music
    const fixed = _gridOctaveRescuePure(fast, 'half');
    assert.ok(Math.abs(_gridMedianBpmPure(fixed) - 118) < 0.5, 'beat rate halves');
    const oldTimes = new Set(fast.map(b => b.time));
    assert.ok(fixed.every(b => oldTimes.has(b.time)), 'no invented times — a strict subset');
    const bars = fixed.filter(b => b.measure > 0).length;
    // 8 half-length bars pair-merge into 4 — plus the range op's pinned
    // remainder rule: the final downbeat never merges into a dangling pair,
    // so the count lands at 5 with a short last bar (honest, not hidden).
    assert.strictEqual(bars, 5, 'pair-merged with the documented remainder bar');
    assert.strictEqual(fixed.filter(b => b.measure > 0)[0].time, 0, 'bar 1 pinned');
});

t('the DOUBLE rescue densifies beats and splits bars', () => {
    const slow = grid(4, 59);                        // charted at half the music
    const fixed = _gridOctaveRescuePure(slow, 'double');
    assert.ok(Math.abs(_gridMedianBpmPure(fixed) - 118) < 0.5, 'beat rate doubles');
    const newTimes = new Set(fixed.map(b => b.time));
    assert.ok(slow.every(b => newTimes.has(b.time)), 'every original beat time survives');
    assert.ok(fixed.filter(b => b.measure > 0).length > 4, 'bars split at their midpoints');
});

t('odd meters survive the half rescue — thinning is phase-locked per bar', () => {
    // 3/4 at 240: downbeats land an odd number of beats apart, so a global
    // every-2nd-index thinning would drop half the barlines. Per-bar phase
    // locking keeps every downbeat by construction.
    const waltz = [];
    for (let m = 0; m < 4; m++) for (let b = 0; b < 3; b++) {
        waltz.push({ time: (m * 3 + b) * 0.25, measure: b === 0 ? m + 1 : 0 });
    }
    const fixed = _gridOctaveRescuePure(waltz, 'half');
    const oldDownTimes = waltz.filter(b => b.measure > 0).map(b => b.time);
    const newTimes = new Set(fixed.map(b => b.time));
    assert.ok(oldDownTimes.every(t2 => newTimes.has(t2)), 'every original barline time survives');
    assert.ok(_gridMedianBpmPure(fixed) < _gridMedianBpmPure(waltz), 'beat rate drops');
    assert.strictEqual(_gridOctaveRescuePure([], 'half'), null);
    assert.strictEqual(_gridOctaveRescuePure(grid(4, 120), 'sideways'), null);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
