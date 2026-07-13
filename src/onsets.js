/* Slopsmith Arrangement Editor — onset detection (banded spectral flux).
 *
 * The pass-1 detector was broadband RMS-rise on the waveform envelope
 * (src/audio.js `_onsetTimesFromPeaksPure`), which goes blind on the events that
 * matter most to charting: a note inside a sustained/pedaled chord (no total-
 * energy rise), a low B0/A0 bass attack (a clean transient but no pitch), and it
 * can't tell a kick from a hat from a snare (no frequency discrimination).
 *
 * This is a pure-JS, zero-dependency **spectral-flux** detector: STFT → half-
 * wave-rectified spectral flux → adaptive-median threshold → local-max peak-pick
 * with parabolic (sub-hop) interpolation. Flux is computed in THREE bands
 * (low ≲150 Hz = kick / bass-attack, mid = snare / broadband, high = hats /
 * subdivision) so kick + snare + melody each register even when one dominates —
 * the single primitive that answers bass, piano, and drums at once.
 *
 * Contract with the rest of the editor: the emitted shape is the pass-1
 * `[{t, s}]` (time-sorted, `s ∈ 0..1`) EXTENDED to `[{t, s, bands:{lo,mid,hi}}]`,
 * so every consumer that reads through `_ensureOnsets()` is unchanged; the extra
 * per-band strengths let downstream (segment phase-seeding, Map Health pulse
 * scoring, feel detection) weight by band. The FFT / STFT front-end is factored
 * separably so a future audio-to-MIDI lane can reuse it.
 *
 * Everything here is pure arithmetic over a Float32 sample buffer — no `S`, no
 * DOM, no audio nodes — so it is exhaustively testable against synthetic signals
 * with known-correct answers.
 */

/* @pure:onset-fft:start */
// In-place iterative radix-2 Cooley-Tukey FFT. `re`/`im` are same-length arrays
// whose length MUST be a power of two; on return they hold the transform. This
// is the shared spectral front-end (STFT below, and a future pitch/MIDI lane).
export function _fftRadix2(re, im) {
    const n = re.length;
    if (n <= 1 || (n & (n - 1)) !== 0) return;   // require power-of-two
    // Bit-reversal permutation.
    for (let i = 1, j = 0; i < n; i++) {
        let bit = n >> 1;
        for (; j & bit; bit >>= 1) j ^= bit;
        j ^= bit;
        if (i < j) {
            const tr = re[i]; re[i] = re[j]; re[j] = tr;
            const ti = im[i]; im[i] = im[j]; im[j] = ti;
        }
    }
    // Butterflies.
    for (let len = 2; len <= n; len <<= 1) {
        const half = len >> 1;
        const ang = -2 * Math.PI / len;
        const wr = Math.cos(ang), wi = Math.sin(ang);
        for (let i = 0; i < n; i += len) {
            let cr = 1, ci = 0;
            for (let k = 0; k < half; k++) {
                const a = i + k, b = a + half;
                const tr = cr * re[b] - ci * im[b];
                const ti = cr * im[b] + ci * re[b];
                re[b] = re[a] - tr; im[b] = im[a] - ti;
                re[a] += tr; im[a] += ti;
                const ncr = cr * wr - ci * wi;
                ci = cr * wi + ci * wr; cr = ncr;
            }
        }
    }
}

// A Hann window of `size` points (0 at the edges, 1 at the centre) — tapers each
// STFT frame so bin leakage doesn't smear the flux.
export function _hannWindowPure(size) {
    const w = new Float32Array(size);
    if (size <= 1) { if (size === 1) w[0] = 1; return w; }
    const f = (2 * Math.PI) / (size - 1);
    for (let i = 0; i < size; i++) w[i] = 0.5 * (1 - Math.cos(f * i));
    return w;
}

// Bin indices splitting the magnitude spectrum into low ≲150 Hz, mid ≲2 kHz, and
// high. `loHi` is the last bin of the low band, `midHi` the last of the mid band;
// the high band runs midHi+1 .. fftSize/2. Bin b centres on b·sampleRate/fftSize.
export function _bandBinsPure(sampleRate, fftSize) {
    const perBin = sampleRate / fftSize;
    const nyq = fftSize >> 1;
    const clamp = (b) => Math.max(1, Math.min(nyq, b));
    const loHi = clamp(Math.round(150 / perBin));
    const midHi = clamp(Math.max(loHi + 1, Math.round(2000 / perBin)));
    return { loHi, midHi, nyq };
}
/* @pure:onset-fft:end */

/* @pure:onset-flux:start */
// Decimate `samples` by an integer `factor` (box-average, so it's a crude
// anti-alias too), returning the downsampled buffer. factor ≤ 1 returns the
// input untouched. Halving the rate quarters the STFT cost while keeping enough
// bandwidth for hats (~11 kHz Nyquist at 22 kHz).
export function _downsamplePure(samples, factor) {
    const f = Math.max(1, Math.floor(factor));
    if (f === 1) return samples;
    const outLen = Math.floor(samples.length / f);
    const out = new Float32Array(outLen);
    for (let i = 0; i < outLen; i++) {
        let s = 0;
        const base = i * f;
        for (let k = 0; k < f; k++) s += samples[base + k];
        out[i] = s / f;
    }
    return out;
}

// STFT → per-frame half-wave-rectified spectral flux, total and per band.
// Returns { total, lo, mid, hi } (Float32Array per frame) plus hopSec/frames.
// Flux[f] = Σ max(0, |X_f[k]| − |X_{f-1}[k]|): energy that AROSE this frame, so a
// new voice entering a sustained texture registers even with no total-energy rise.
export function _spectralFluxFramesPure(samples, sampleRate, opts) {
    const o = opts || {};
    const fftSize = o.fftSize || 512;
    const hop = o.hop || (fftSize >> 1);   // 50% overlap: adjacent frames share half
    const n = samples ? samples.length : 0;   // their samples, so the flux curve is smooth
    const frames = n >= fftSize ? 1 + Math.floor((n - fftSize) / hop) : 0;
    const res = {
        total: new Float32Array(Math.max(0, frames)),
        lo: new Float32Array(Math.max(0, frames)),
        mid: new Float32Array(Math.max(0, frames)),
        hi: new Float32Array(Math.max(0, frames)),
        hopSec: hop / sampleRate,
        // Frame f spans samples [f·hop, f·hop+fftSize) — it is not zero-padded, so
        // the energy it reports is centred half a window in. Timestamps must carry
        // that offset or every onset lands systematically EARLY by fftSize/2.
        centreSec: (fftSize / 2) / sampleRate,
        frames,
    };
    if (frames <= 0) return res;
    const { loHi, midHi, nyq } = _bandBinsPure(sampleRate, fftSize);
    const win = _hannWindowPure(fftSize);
    const re = new Float64Array(fftSize);
    const im = new Float64Array(fftSize);
    let prevMag = new Float64Array(nyq + 1);
    let curMag = new Float64Array(nyq + 1);
    for (let f = 0; f < frames; f++) {
        const start = f * hop;
        for (let i = 0; i < fftSize; i++) { re[i] = samples[start + i] * win[i]; im[i] = 0; }
        _fftRadix2(re, im);
        // sqrt(re²+im²), not Math.hypot — hypot's overflow-safe scaling is ~5x
        // slower and this is the inner loop of the whole detector (millions of calls).
        for (let b = 0; b <= nyq; b++) curMag[b] = Math.sqrt(re[b] * re[b] + im[b] * im[b]);
        if (f > 0) {
            let tot = 0, lo = 0, mid = 0, hi = 0;
            for (let b = 1; b <= nyq; b++) {
                const d = curMag[b] - prevMag[b];
                if (d > 0) {
                    tot += d;
                    if (b <= loHi) lo += d; else if (b <= midHi) mid += d; else hi += d;
                }
            }
            res.total[f] = tot; res.lo[f] = lo; res.mid[f] = mid; res.hi[f] = hi;
        }
        const t = prevMag; prevMag = curMag; curMag = t;   // swap scratch
    }
    return res;
}

// Peak-pick an onset-detection function into onset events. A frame is an onset
// when its flux is a strict local maximum, exceeds an ADAPTIVE threshold (local
// median × mult + delta·globalMax — median so one loud hit doesn't raise the bar
// for its neighbours), and clears a refractory gap. Time is refined to sub-hop
// accuracy by PARABOLIC interpolation of the three flux samples around the peak
// (measured: within ~5 ms of a synthetic click train, and unbiased — see the test).
// `frames.centreSec` is added because a frame reports the energy of a window that
// STARTS at f·hop; omit it and every onset lands half a window early. Strengths are normalised
// 0..1 against the global max (total) / per-band max (bands).
export function _pickOnsetsPure(frames, opts) {
    const o = opts || {};
    const { total, lo, mid, hi, hopSec } = frames;
    const centreSec = frames.centreSec || 0;   // see _spectralFluxFramesPure
    const out = [];
    const nF = total ? total.length : 0;
    if (nF < 3 || !(hopSec > 0)) return out;
    const medWin = Math.max(1, Math.round((o.medianWinSec || 0.1) / hopSec));
    const mult = o.mult || 1.6;
    const delta = o.delta || 0.02;
    const minGap = Math.max(1, Math.round((o.minGapSec || 0.03) / hopSec));
    let gMax = 0, loMax = 0, midMax = 0, hiMax = 0;
    for (let i = 0; i < nF; i++) {
        if (total[i] > gMax) gMax = total[i];
        if (lo[i] > loMax) loMax = lo[i];
        if (mid[i] > midMax) midMax = mid[i];
        if (hi[i] > hiMax) hiMax = hi[i];
    }
    if (!(gMax > 0)) return out;
    const thrDelta = delta * gMax;
    const scratch = [];
    const localMedian = (c) => {
        scratch.length = 0;
        const a = Math.max(0, c - medWin), b = Math.min(nF - 1, c + medWin);
        for (let i = a; i <= b; i++) scratch.push(total[i]);
        scratch.sort((x, y) => x - y);
        return scratch[scratch.length >> 1];
    };
    let last = -Infinity;
    for (let f = 1; f < nF - 1; f++) {
        const v = total[f];
        if (!(v > total[f - 1]) || !(v >= total[f + 1])) continue;   // strict local max
        if (v < localMedian(f) * mult + thrDelta) continue;
        if (f - last < minGap) continue;
        // Parabolic sub-hop refinement around the peak.
        const a = total[f - 1], b = v, c = total[f + 1];
        const denom = a - 2 * b + c;
        let dlt = denom !== 0 ? 0.5 * (a - c) / denom : 0;
        if (!(dlt > -1 && dlt < 1)) dlt = 0;                          // guard degenerate
        out.push({
            t: (f + dlt) * hopSec + centreSec,
            s: Math.max(0, Math.min(1, v / gMax)),
            bands: {
                lo: loMax > 0 ? Math.min(1, lo[f] / loMax) : 0,
                mid: midMax > 0 ? Math.min(1, mid[f] / midMax) : 0,
                hi: hiMax > 0 ? Math.min(1, hi[f] / hiMax) : 0,
            },
        });
        last = f;
    }
    return out;
}

// The full pipeline: (optional) downsample → STFT flux frames → peak-pick.
// Returns [{t, s, bands:{lo,mid,hi}}] sorted by time. `opts.downsampleTo` caps
// the working sample rate (default 22050 — quarters the STFT cost vs 44.1 kHz
// while keeping hats). All timing is reported in ORIGINAL-signal seconds.
export function _spectralFluxOnsetsPure(samples, sampleRate, opts) {
    if (!samples || !samples.length || !(sampleRate > 0)) return [];
    const o = opts || {};
    const target = o.downsampleTo || 22050;
    const factor = target > 0 ? Math.max(1, Math.floor(sampleRate / target)) : 1;
    const sig = _downsamplePure(samples, factor);
    const sr = sampleRate / factor;
    const fftSize = o.fftSize || 512;
    const frames = _spectralFluxFramesPure(sig, sr, { fftSize, hop: o.hop || (fftSize >> 1) });
    return _pickOnsetsPure(frames, o);
}
/* @pure:onset-flux:end */
