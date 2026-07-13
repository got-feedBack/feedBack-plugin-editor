/*
 * Banded spectral-flux onset detection (P2-2). The pass-1 detector was broadband
 * RMS-rise; this replaces it with a pure-JS STFT → half-wave-rectified spectral
 * flux → adaptive-median peak-pick with parabolic sub-hop interpolation, in three
 * frequency bands (lo/mid/hi) so kick, snare, and a melody under wash each
 * register. Everything is pure arithmetic over a sample buffer, so it's pinned
 * against SYNTHETIC signals with known-correct answers:
 *   FFT (cosine → its bin), Hann shape, band-bin math, decimation, flux frames
 *   (silence→burst spikes; band assignment), peak-pick (threshold / refractory /
 *   parabolic sub-hop), and the full pipeline on a click train + band separation.
 *
 * Run: node --test tests/onsets_spectral_flux.test.mjs
 */
import assert from 'node:assert';
import {
    _fftRadix2, _hannWindowPure, _bandBinsPure, _downsamplePure,
    _spectralFluxFramesPure, _pickOnsetsPure, _spectralFluxOnsetsPure,
} from '../src/onsets.js';
import { S } from '../src/state.js';
import { _ensureOnsets, _onsetDetectorLabel } from '../src/audio.js';

let pass = 0, fail = 0;
function t(name, fn) {
    try { fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}
const near = (a, b, eps) => Math.abs(a - b) <= eps;

// ── FFT ──────────────────────────────────────────────────────────────────────
t('FFT of a pure cosine peaks at its bin (and the mirror), zero elsewhere', () => {
    const N = 64, k = 5;
    const re = new Float64Array(N), im = new Float64Array(N);
    for (let i = 0; i < N; i++) re[i] = Math.cos((2 * Math.PI * k * i) / N);
    _fftRadix2(re, im);
    const mag = Array.from({ length: N }, (_, i) => Math.hypot(re[i], im[i]));
    // bin k and N-k carry all the energy (≈N/2 each); the rest are ~0.
    assert.ok(near(mag[k], N / 2, 1e-6) && near(mag[N - k], N / 2, 1e-6), 'energy at ±k');
    for (let i = 0; i < N; i++) if (i !== k && i !== N - k) assert.ok(mag[i] < 1e-6, `bin ${i} quiet`);
});

t('FFT no-ops on a non-power-of-two length (guarded, never corrupts)', () => {
    const re = new Float64Array([1, 2, 3]), im = new Float64Array(3);
    _fftRadix2(re, im);
    assert.deepStrictEqual(Array.from(re), [1, 2, 3], 'left untouched');
});

// ── window + bands ───────────────────────────────────────────────────────────
t('Hann window is 0 at the edges, 1 at the centre, symmetric', () => {
    const w = _hannWindowPure(9);
    assert.ok(near(w[0], 0, 1e-9) && near(w[8], 0, 1e-9), 'edges 0');
    assert.ok(near(w[4], 1, 1e-9), 'centre 1');
    assert.ok(near(w[1], w[7], 1e-9), 'symmetric');
});

t('band bins split low ≲150Hz / mid ≲2kHz / high', () => {
    const { loHi, midHi, nyq } = _bandBinsPure(22050, 512);
    assert.strictEqual(nyq, 256);
    // perBin = 22050/512 ≈ 43.07 Hz → 150/43≈3, 2000/43≈46
    assert.strictEqual(loHi, 3);
    assert.strictEqual(midHi, 46);
});

// ── downsample ───────────────────────────────────────────────────────────────
t('downsample halves the length and box-averages; factor 1 is identity', () => {
    const x = Float32Array.from([1, 3, 5, 7, 9, 11]);
    const d = _downsamplePure(x, 2);
    assert.deepStrictEqual(Array.from(d), [2, 6, 10]);
    assert.strictEqual(_downsamplePure(x, 1), x, 'factor 1 returns the same buffer');
});

// ── flux frames ──────────────────────────────────────────────────────────────
function tone(freq, sr, n, startFrac = 0, amp = 1) {
    const x = new Float32Array(n);
    const s = Math.floor(n * startFrac);
    for (let i = s; i < n; i++) x[i] = amp * Math.sin((2 * Math.PI * freq * i) / sr);
    return x;
}

t('flux spikes at a silence→tone onset (not before it)', () => {
    const sr = 22050, n = sr * 0.3 | 0;
    const x = tone(300, sr, n, 0.5);   // silent first half, 300Hz second half
    const fr = _spectralFluxFramesPure(x, sr, { fftSize: 512, hop: 512 });
    const onsetFrame = Math.round((n * 0.5) / 512);
    // the largest flux frame sits at/just after the tone's entry, and the
    // silent region carries essentially none.
    let argmax = 0; for (let i = 1; i < fr.frames; i++) if (fr.total[i] > fr.total[argmax]) argmax = i;
    assert.ok(Math.abs(argmax - onsetFrame) <= 2, `flux peak near the onset frame (got ${argmax}, want ~${onsetFrame})`);
    for (let i = 0; i < onsetFrame - 1; i++) assert.ok(fr.total[i] < fr.total[argmax] * 0.2, 'quiet before onset');
});

t('a low tone lights the LOW band; a high tone lights the HIGH band', () => {
    const sr = 22050, n = sr * 0.3 | 0;
    const frLo = _spectralFluxFramesPure(tone(60, sr, n, 0.5), sr, { fftSize: 512, hop: 512 });
    const frHi = _spectralFluxFramesPure(tone(8000, sr, n, 0.5), sr, { fftSize: 512, hop: 512 });
    const peak = (a) => { let m = 0; for (let i = 1; i < a.frames; i++) if (a.total[i] > a.total[m]) m = i; return m; };
    const pl = peak(frLo), ph = peak(frHi);
    assert.ok(frLo.lo[pl] > frLo.mid[pl] && frLo.lo[pl] > frLo.hi[pl], '60Hz → lo band dominant');
    assert.ok(frHi.hi[ph] > frHi.lo[ph] && frHi.hi[ph] > frHi.mid[ph], '8kHz → hi band dominant');
});

// ── peak-pick ────────────────────────────────────────────────────────────────
t('peak-pick fires on local maxima above the adaptive threshold, honours refractory', () => {
    // flat noise with three clear peaks; medWin small, minGap forces spacing.
    const N = 60; const total = new Float32Array(N).fill(0.05);
    total[10] = 1.0; total[11] = 0.6;   // peak A (+ a shoulder that refractory should swallow)
    total[30] = 0.8;                    // peak B
    total[50] = 0.9;                    // peak C
    const lo = new Float32Array(N), mid = new Float32Array(N), hi = new Float32Array(N);
    const on = _pickOnsetsPure({ total, lo, mid, hi, hopSec: 0.01, frames: N },
        { medianWinSec: 0.05, mult: 1.5, delta: 0.01, minGapSec: 0.05 });
    const frames = on.map(o => Math.round(o.t / 0.01));
    assert.deepStrictEqual(frames, [10, 30, 50], 'three onsets, the shoulder is refractory-swallowed');
    assert.ok(on.every(o => o.s > 0 && o.s <= 1), 'strengths normalised 0..1');
});

t('parabolic interpolation places the onset between hops (sub-hop accuracy)', () => {
    const total = new Float32Array([0, 0.5, 1.0, 0.9, 0]);  // peak at 2, skewed toward 3
    const on = _pickOnsetsPure({ total, lo: total, mid: total, hi: total, hopSec: 1, frames: 5 },
        { medianWinSec: 1, mult: 0.1, delta: 0.001, minGapSec: 1 });
    assert.strictEqual(on.length, 1);
    assert.ok(on[0].t > 2 && on[0].t < 2.5, `refined time skews toward the taller neighbour (got ${on[0].t})`);
});

t('flat / empty flux yields no onsets (no false positives)', () => {
    assert.deepStrictEqual(_pickOnsetsPure({ total: new Float32Array(20), lo: new Float32Array(20), mid: new Float32Array(20), hi: new Float32Array(20), hopSec: 0.01, frames: 20 }, {}), []);
    assert.deepStrictEqual(_pickOnsetsPure({ total: new Float32Array(2), lo: new Float32Array(2), mid: new Float32Array(2), hi: new Float32Array(2), hopSec: 0.01, frames: 2 }, {}), []);
});

// ── full pipeline ────────────────────────────────────────────────────────────
t('pipeline on a click train returns onsets near the click times, sorted, in contract shape', () => {
    const sr = 44100, n = sr * 0.8 | 0;
    const x = new Float32Array(n);
    const clickTimes = [0.15, 0.35, 0.55];
    for (const ct of clickTimes) {   // a short broadband burst per click
        const s = Math.round(ct * sr);
        for (let i = 0; i < 200; i++) x[s + i] = Math.sin((2 * Math.PI * 1500 * i) / sr) * (1 - i / 200);
    }
    const on = _spectralFluxOnsetsPure(x, sr);   // downsamples to 22050 internally
    // every reported onset matches one of the clicks within ~25ms, and each click is found.
    for (const o of on) {
        assert.ok(o.t >= 0 && Number.isFinite(o.t), 'finite time');
        assert.ok(o.s > 0 && o.s <= 1, 'strength 0..1');
        assert.ok(o.bands && ['lo', 'mid', 'hi'].every(k => o.bands[k] >= 0 && o.bands[k] <= 1), 'bands 0..1');
    }
    for (let i = 1; i < on.length; i++) assert.ok(on[i].t >= on[i - 1].t, 'sorted by time');
    for (const ct of clickTimes) {
        assert.ok(on.some(o => Math.abs(o.t - ct) < 0.025), `found a click near ${ct}s`);
    }
});

t('pipeline degrades cleanly on junk input', () => {
    assert.deepStrictEqual(_spectralFluxOnsetsPure(null, 44100), []);
    assert.deepStrictEqual(_spectralFluxOnsetsPure(new Float32Array(0), 44100), []);
    assert.deepStrictEqual(_spectralFluxOnsetsPure(new Float32Array(1000), 0), []);
});

t('silence and NaN-filled audio yield [] — no NaN escapes into a consumer', () => {
    const sr = 22050;
    assert.deepStrictEqual(_spectralFluxOnsetsPure(new Float32Array(sr * 2), sr), [], 'silence → []');
    const nan = new Float32Array(sr); nan.fill(NaN);
    assert.deepStrictEqual(_spectralFluxOnsetsPure(nan, sr), [], 'NaN buffer → []');
    const inf = new Float32Array(sr); inf.fill(Infinity);
    for (const o of _spectralFluxOnsetsPure(inf, sr)) {
        assert.ok(Number.isFinite(o.t) && Number.isFinite(o.s), 'no non-finite t/s ever emitted');
    }
});

// REGRESSION: frame f spans samples [f·hop, f·hop+fftSize) and is NOT zero-padded,
// so a frame timestamped at f·hopSec reports the window's START — every onset came
// back systematically EARLY by ~half a window (mean bias -9.7 ms, worst -17 ms at
// fftSize 512 / 22.05 kHz). Onsets feed tempo-snap, onset-snap and Sync phase, so a
// constant -10 ms skew biases every one of them. Fixed by carrying `centreSec` and
// by hopping at 50% overlap (adjacent frames now overlap, so the parabolic sub-hop
// interpolation actually has a smooth curve to interpolate).
t('click train: onsets are unbiased, not systematically early', () => {
    const sr = 44100, n = sr * 4;
    const x = new Float32Array(n);
    const clicks = [0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 3.5];
    for (const ct of clicks) {
        const s = Math.round(ct * sr);
        for (let i = 0; i < 200; i++) x[s + i] = Math.sin((2 * Math.PI * 1500 * i) / sr) * (1 - i / 200);
    }
    const on = _spectralFluxOnsetsPure(x, sr);
    const errs = clicks.map((ct) => {
        const best = on.reduce((a, o) => (Math.abs(o.t - ct) < Math.abs(a - ct) ? o.t : a), -99);
        assert.ok(Math.abs(best - ct) < 0.010, `click at ${ct}s detected within 10ms (got ${best.toFixed(4)})`);
        return best - ct;
    });
    const bias = errs.reduce((a, b) => a + b, 0) / errs.length;
    // Pre-fix this was -0.0097 (a hard fail). Half a 512-frame at 22.05k is 11.6ms.
    assert.ok(Math.abs(bias) < 0.005, `mean timing bias under 5ms (got ${(bias * 1000).toFixed(1)}ms)`);
});

// ── _ensureOnsets cache ──────────────────────────────────────────────────────
// REGRESSION: _onsetCache was only cleared in computeWaveform(), which early-returns
// when there is no buffer — but loadCDLC (file-ops.js) and the create-mode import
// (create.js) drop S.audioBuffer/S.waveformPeaks WITHOUT going through it. So after
// loading a second song the cache still held song ONE's onsets, and the onset strip,
// onset-snap, tempo-snap and Sync phase all silently aligned to the wrong recording.
function fakeBuffer(clickTimes, sr = 44100, dur = 4) {
    const x = new Float32Array(Math.round(sr * dur));
    for (const ct of clickTimes) {
        const s = Math.round(ct * sr);
        for (let i = 0; i < 200; i++) x[s + i] = Math.sin((2 * Math.PI * 1500 * i) / sr) * (1 - i / 200);
    }
    return { getChannelData: () => x, sampleRate: sr, duration: dur, numberOfChannels: 1 };
}

// The flux upgrade is a BACKGROUND job now (it used to run synchronously inside
// _ensureOnsets), so drain the setTimeout chain before asserting on the cache.
const drainOnsetJob = async () => { for (let i = 0; i < 500; i++) await new Promise((r) => setTimeout(r, 0)); };
async function ta(name, fn) {
    try { await fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}

await ta('onset cache is keyed on the audio buffer — a new song never inherits the old onsets', async () => {
    S.audioBuffer = fakeBuffer([0.5, 1.5, 2.5]);
    S.duration = 4;
    S.waveformPeaks = null;
    _ensureOnsets();                       // seeds RMS, kicks off the flux job
    await drainOnsetJob();
    const a = _ensureOnsets();
    assert.ok(a && a.length, 'song A detected');
    assert.strictEqual(_onsetDetectorLabel(), 'spectral-flux', 'the background job upgraded the cache');
    assert.strictEqual(_ensureOnsets(), a, 'same buffer → memoised, not recomputed');

    // What loadCDLC / the create import actually do: drop the buffer, never call
    // computeWaveform(). The cache must go with it.
    S.audioBuffer = null;
    S.waveformPeaks = null;
    assert.strictEqual(_ensureOnsets(), null, 'audio cleared → no stale onsets');

    // A different song must produce its own onsets, not song A's.
    S.audioBuffer = fakeBuffer([1.0, 2.0, 3.0]);
    S.duration = 4;
    _ensureOnsets();
    await drainOnsetJob();
    const b = _ensureOnsets();
    assert.ok(b && b.length && b !== a, 'song B recomputed');
    assert.ok(Math.abs(b[0].t - 1.0) < 0.01, `song B's first onset is B's (got ${b[0].t.toFixed(3)})`);

    S.audioBuffer = null; S.waveformPeaks = null; S.duration = 0;
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
