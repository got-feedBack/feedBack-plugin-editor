/* Slopsmith Arrangement Editor — segment-first tempo mapping (P2-3, engine).
 *
 * The 2nd-pass default outcome of Detect/Sync. Instead of a whole-song scale
 * (too coarse) or a per-bar march (runaway off-phase drift), we propose a SMALL
 * number of tempo-intent SEGMENTS, the human confirms at intent granularity, and
 * barlines are then refined bounded INSIDE each confirmed segment with the
 * segment BPM as a constant-tempo prior (the structural cure for the march).
 * Top-down complement to pass-1's bottom-up _suggestFitPure.
 *
 * This module is the PURE detection engine (no S, no DOM): local tempo via
 * autocorrelation of the strength-weighted onset train (with an octave guard),
 * bottom-up segmentation with Theil-Sen ramp classification, and a downbeat-PHASE
 * seed (tempo and phase are separate decisions — a detector that locks the
 * loudest onset finds the snare backbeat, giving the right tempo a beat late).
 * The confirm UI + Apply (one TempoGridCmd) build on this.
 */

/* @pure:tempo-segment:start */
const _median = (a) => {
    if (!a.length) return null;
    const s = a.slice().sort((x, y) => x - y);
    const m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

// Windowed local tempo(t). Bins the strength-weighted onset impulse train, then
// per window autocorrelates over lag ∈ [60/bpmMax, 60/bpmMin] and picks the peak.
// OCTAVE GUARD: among {L, 2L, ½L} prefer the lag whose 2× and ½× harmonics ALSO
// have support — kills the "reads 2× fast" (double-kick / ghost-note) error and
// the half-time trap. A window with a weak peak or no energy is `unmapped`
// (sustained pad / silence / ring-out). Returns [{t, bpm, conf, unmapped}].
export function _localTempoSeriesPure(onsets, opts) {
    const o = opts || {};
    const winSec = o.winSec || 2.5, hopSec = o.hopSec || 1.0;
    const bpmMin = o.bpmMin || 60, bpmMax = o.bpmMax || 200;
    const binHz = o.binHz || 100;
    const confFloor = Number.isFinite(o.confFloor) ? o.confFloor : 0.15;
    const on = (Array.isArray(onsets) ? onsets : [])
        .filter(x => x && Number.isFinite(x.t)).sort((a, b) => a.t - b.t);
    if (on.length < 4) return [];
    const tEnd = on[on.length - 1].t;
    const nBins = Math.ceil(tEnd * binHz) + 1;
    const impulse = new Float64Array(nBins);
    for (const x of on) {
        const b = Math.round(x.t * binHz);
        if (b >= 0 && b < nBins) impulse[b] += Number.isFinite(x.s) && x.s > 0 ? x.s : 1;
    }
    const lagMin = Math.max(1, Math.round((60 / bpmMax) * binHz));
    const lagMax = Math.min(nBins - 1, Math.round((60 / bpmMin) * binHz));
    const winBins = Math.round(winSec * binHz), hopBins = Math.max(1, Math.round(hopSec * binHz));
    // Log-normal tempo prior (Parncutt/Klapuri): real audio has strong ACF peaks
    // at subdivisions (eighth hats) and at half-time, so the raw peak often reads
    // 2× fast or ½× slow. Weighting the ACF toward the perceptually-dominant
    // ~priorBpm resolves the octave — the single biggest quality lever on real
    // recordings. Wide σ so it only breaks ties, never overrides a clear tempo.
    const priorBpm = o.priorBpm || 110, priorSigma = o.priorSigma || 0.7;
    const priorW = (lag) => {
        const bpm = 60 / (lag / binHz);
        const z = Math.log(bpm / priorBpm) / priorSigma;
        return Math.exp(-0.5 * z * z);
    };
    const out = [];
    for (let s = 0; s + Math.min(winBins, lagMax + 1) <= nBins; s += hopBins) {
        const wb = Math.min(winBins, nBins - s);
        let energy = 0, zero = 0;
        for (let i = 0; i < wb; i++) { energy += impulse[s + i]; zero += impulse[s + i] * impulse[s + i]; }
        if (!(energy > 0) || !(zero > 0)) { out.push({ t: s / binHz, bpm: null, conf: 0, unmapped: true }); continue; }
        const acf = new Float64Array(lagMax + 1);
        let bestLag = lagMin, bestW = -1;
        for (let lag = lagMin; lag <= lagMax; lag++) {
            let sum = 0;
            for (let i = 0; i + lag < wb; i++) sum += impulse[s + i] * impulse[s + i + lag];
            acf[lag] = sum;
            const w = sum * priorW(lag);
            if (w > bestW) { bestW = w; bestLag = lag; }
        }
        // Octave guard: score each octave candidate by itself + half its harmonics,
        // all under the tempo prior — so a subdivision (2× fast) only wins if its
        // ACF advantage overcomes the prior's pull toward the fundamental beat.
        const cands = [bestLag];
        if (bestLag * 2 <= lagMax) cands.push(bestLag * 2);
        if ((bestLag >> 1) >= lagMin) cands.push(bestLag >> 1);
        let pick = bestLag, pickScore = -1;
        for (const L of cands) {
            let sc = acf[L] || 0;
            if (L * 2 <= lagMax) sc += 0.5 * (acf[L * 2] || 0);
            if ((L >> 1) >= lagMin) sc += 0.5 * (acf[L >> 1] || 0);
            sc *= priorW(L);
            if (sc > pickScore) { pickScore = sc; pick = L; }
        }
        const conf = Math.max(0, Math.min(1, (acf[pick] || 0) / zero));
        out.push({ t: s / binHz, bpm: 60 / (pick / binHz), conf, unmapped: conf < confFloor });
    }
    return out;
}

// Theil-Sen slope (median of pairwise slopes) — anchor-immune, so one wild
// window can't fake a ramp. Returns bpm-per-second, or 0 with <2 points.
function _theilSen(ts, ys) {
    const slopes = [];
    for (let i = 0; i < ts.length; i++)
        for (let j = i + 1; j < ts.length; j++) {
            const dt = ts[j] - ts[i];
            if (Math.abs(dt) > 1e-9) slopes.push((ys[j] - ys[i]) / dt);
        }
    return slopes.length ? _median(slopes) : 0;
}

// Segment the local-tempo series into tempo-intent zones. Median-smooths, then
// grows a segment while windows stay within `tol` (3% — looser than a run merge)
// of its running median; classifies each as a `ramp` (Theil-Sen monotone slope
// over ~`rampFrac` across the span) or `constant` (at the median). Caps at
// `maxSegments` by merging the most-similar neighbours. A single-tempo song
// returns exactly ONE segment. Returns [{tStart,tEnd,kind,bpmStart,bpmEnd,conf}].
export function _segmentTempoPure(series, opts) {
    const o = opts || {};
    const tol = o.tol || 0.03, rampFrac = o.rampFrac || 0.04, maxSegments = o.maxSegments || 8;
    const pts = (Array.isArray(series) ? series : []).filter(p => p && !p.unmapped && p.bpm > 0);
    if (!pts.length) return [];
    // 5-point median smooth of the bpm series (index-local; times unchanged) —
    // real-audio local tempo is jittery, and median rejects the octave-flip and
    // dropout spikes that would otherwise fracture a steady groove into zones.
    const bpm = pts.map((p, i) => {
        const w = [];
        for (let k = -2; k <= 2; k++) w.push(pts[Math.max(0, Math.min(pts.length - 1, i + k))].bpm);
        return _median(w);
    });
    // Grow segments within tolerance of the running median.
    const segs = [];
    let start = 0, acc = [bpm[0]];
    const closeSeg = (from, to) => {
        const ts = pts.slice(from, to + 1).map(p => p.t);
        const ys = bpm.slice(from, to + 1);
        const med = _median(ys);
        const slope = _theilSen(ts, ys);
        const span = ts[ts.length - 1] - ts[0];
        const delta = slope * span;                     // total bpm change across the span
        const isRamp = Math.abs(delta) > med * rampFrac && ys.length >= 3;
        const bpmStart = isRamp ? med - delta / 2 : med;
        const bpmEnd = isRamp ? med + delta / 2 : med;
        segs.push({
            tStart: ts[0], tEnd: pts[Math.min(to + 1, pts.length - 1)].t,
            kind: isRamp ? 'ramp' : 'constant',
            bpmStart: Math.round(bpmStart * 10) / 10, bpmEnd: Math.round(bpmEnd * 10) / 10,
            conf: _median(pts.slice(from, to + 1).map(p => p.conf)),
            _from: from, _to: to,
        });
    };
    for (let i = 1; i < bpm.length; i++) {
        const med = _median(acc);
        if (Math.abs(bpm[i] - med) <= med * tol) { acc.push(bpm[i]); continue; }
        // deviation — but tolerate a single stray window (needs 2 in a row to split)
        if (i + 1 < bpm.length && Math.abs(bpm[i + 1] - med) <= med * tol) { acc.push(bpm[i]); continue; }
        closeSeg(start, i - 1);
        start = i; acc = [bpm[i]];
    }
    closeSeg(start, bpm.length - 1);

    // Ramp coalesce: a gradual tempo change splits the within-tolerance pass into
    // a RUN of many SHORT segments, all trending one way. Merge such a run (≥3
    // short segments, monotone) into a single ramp fitted by Theil-Sen; a long
    // PLATEAU segment (a real constant zone) is never short, so it stays put and
    // isn't swallowed by an adjacent ramp.
    const buildRun = (from, to) => {
        const ts = pts.slice(from, to + 1).map(p => p.t);
        const ys = bpm.slice(from, to + 1);
        const med = _median(ys);
        const slope = _theilSen(ts, ys);
        const span = ts[ts.length - 1] - ts[0];
        const delta = slope * span;
        const isRamp = Math.abs(delta) > med * rampFrac;
        return {
            tStart: ts[0], tEnd: pts[Math.min(to + 1, pts.length - 1)].t,
            kind: isRamp ? 'ramp' : 'constant',
            bpmStart: Math.round((isRamp ? med - delta / 2 : med) * 10) / 10,
            bpmEnd: Math.round((isRamp ? med + delta / 2 : med) * 10) / 10,
            conf: _median(pts.slice(from, to + 1).map(p => p.conf)), _from: from, _to: to,
        };
    };
    const short = (seg) => (seg._to - seg._from) <= 3;
    const segMed = (seg) => (seg.bpmStart + seg.bpmEnd) / 2;
    const coalesced = [];
    for (let i = 0; i < segs.length;) {
        let j = i, dir = 0;
        while (j + 1 < segs.length && short(segs[j]) && short(segs[j + 1])) {
            const d = segMed(segs[j + 1]) - segMed(segs[j]);
            const nd = d > 1e-6 ? 1 : d < -1e-6 ? -1 : 0;
            if (nd === 0 || (dir !== 0 && nd !== dir)) break;
            dir = dir || nd; j++;
        }
        if (j - i + 1 >= 3) { coalesced.push(buildRun(segs[i]._from, segs[j]._to)); i = j + 1; }
        else { coalesced.push(segs[i]); i++; }
    }
    segs.length = 0; segs.push(...coalesced);

    // Cap: merge the most-similar adjacent constant pair until within budget.
    while (segs.length > maxSegments) {
        let bi = 0, bd = Infinity;
        for (let i = 0; i + 1 < segs.length; i++) {
            const d = Math.abs(segs[i].bpmEnd - segs[i + 1].bpmStart);
            if (d < bd) { bd = d; bi = i; }
        }
        const a = segs[bi], b = segs[bi + 1];
        segs.splice(bi, 2, { tStart: a.tStart, tEnd: b.tEnd, kind: 'constant',
            bpmStart: (a.bpmStart + b.bpmEnd) / 2, bpmEnd: (a.bpmStart + b.bpmEnd) / 2,
            conf: Math.min(a.conf, b.conf), _from: a._from, _to: b._to });
    }
    // Min-duration merge: a real tempo INTENT lasts several bars — a segment
    // shorter than `minSegSec` is detection noise (a momentary octave flip or
    // fill), so fold it into the neighbour with the closer bpm. This is what
    // keeps a steady groove reading as one or two zones, not eight.
    const minSegSec = Number.isFinite(o.minSegSec) ? o.minSegSec : 6;
    const segMid = (s) => (s.bpmStart + s.bpmEnd) / 2;
    let merged = true;
    while (merged && segs.length > 1) {
        merged = false;
        for (let i = 0; i < segs.length; i++) {
            if (segs[i].tEnd - segs[i].tStart >= minSegSec) continue;
            const l = i > 0 ? i - 1 : -1, r = i + 1 < segs.length ? i + 1 : -1;
            const tgt = l < 0 ? r : r < 0 ? l
                : (Math.abs(segMid(segs[l]) - segMid(segs[i])) <= Math.abs(segMid(segs[r]) - segMid(segs[i])) ? l : r);
            const lo = Math.min(i, tgt), hi = Math.max(i, tgt);
            const keep = segs[tgt];
            segs.splice(lo, 2, { tStart: segs[lo].tStart, tEnd: segs[hi].tEnd, kind: keep.kind,
                bpmStart: keep.bpmStart, bpmEnd: keep.bpmEnd, conf: Math.min(segs[lo].conf, segs[hi].conf),
                _from: segs[lo]._from, _to: segs[hi]._to });
            merged = true; break;
        }
    }
    return segs.map(({ _from, _to, ...s }) => s);   // drop the internal indices
}

// Downbeat-PHASE seed (separate from tempo). A snare-heavy detector locks beat 2/4
// (loudest), so we pick beat 1 from the PERCUSSIVE-BASS spine: score each candidate
// bar phase φ ∈ [0, barPeriod) by the LOW-band onset strength landing on the
// implied downbeats (and the &3 kick), and take the best. `band` selects which
// onset field carries the kick weight (bands.lo when present, else strength).
// Returns { downbeatTime, phase } — the time of the first bar-1 at/after tStart.
export function _downbeatPhasePure(onsets, beatPeriod, tStart, opts) {
    const o = opts || {};
    const bpb = o.beatsPerBar || 4;
    const barPeriod = beatPeriod * bpb;
    const steps = o.steps || 48;                       // phase resolution across the bar
    const on = (Array.isArray(onsets) ? onsets : []).filter(x => x && Number.isFinite(x.t) && x.t >= tStart - 1e-6);
    if (!on.length || !(beatPeriod > 0)) return { downbeatTime: tStart, phase: 0 };
    const kick = (x) => {
        if (x.bands && Number.isFinite(x.bands.lo)) return x.bands.lo;   // low band = kick/bass
        return Number.isFinite(x.s) && x.s > 0 ? x.s : 1;
    };
    const win = beatPeriod * 0.12;                     // ±12% of a beat counts as "on the beat"
    let best = 0, bestScore = -1;
    for (let k = 0; k < steps; k++) {
        const phi = (k / steps) * barPeriod;
        let score = 0;
        for (const x of on) {
            const rel = x.t - tStart - phi;
            const inBar = ((rel % barPeriod) + barPeriod) % barPeriod;
            // distance to the nearest downbeat OR the &3 kick (beat 3 in 4/4)
            const dDown = Math.min(inBar, barPeriod - inBar);
            const dThree = Math.abs(inBar - beatPeriod * (bpb / 2));
            if (dDown <= win || dThree <= win) score += kick(x);
        }
        if (score > bestScore) { bestScore = score; best = phi; }
    }
    return { downbeatTime: tStart + best, phase: best };
}

// Seed an S.beats skeleton from confirmed segments. Constant → uniform grid at
// the segment BPM anchored at its downbeat; ramp → linearly-accelerating grid;
// default 4/4 (meter is a separate axis set afterward). unmapped gaps seed
// nothing (a held bridge is not the end of the song). Returns [{time, measure}]
// (measure>0 = downbeat), the topology Apply lifts into a TempoGridCmd.
export function _segmentSeedGridPure(segments, opts) {
    const o = opts || {};
    const bpb = o.beatsPerBar || 4;
    const beats = [];
    let measure = 1;
    for (const seg of (Array.isArray(segments) ? segments : [])) {
        if (!seg || seg.kind === 'unmapped' || !(seg.tStart < seg.tEnd)) continue;
        const p0 = 60 / (seg.bpmStart || seg.bpmEnd || 120);
        const p1 = 60 / (seg.bpmEnd || seg.bpmStart || 120);
        let t = Number.isFinite(seg.downbeatTime) ? seg.downbeatTime : seg.tStart;
        let bi = 0;
        while (t < seg.tEnd - 1e-6) {
            beats.push({ time: Math.round(t * 1e6) / 1e6, measure: bi % bpb === 0 ? measure++ : 0 });
            // interpolate the beat period across a ramp by progress through the span
            const frac = (t - seg.tStart) / (seg.tEnd - seg.tStart);
            const period = seg.kind === 'ramp' ? p0 + (p1 - p0) * Math.max(0, Math.min(1, frac)) : p0;
            t += period; bi++;
        }
    }
    return beats;
}

// End-to-end rough map: detect segments → seed each downbeat's PHASE from the
// kick onsets → build the grid in the editor's beat shape (downbeats
// {time, measure, den}; interior {time, measure: -1}). Pure over `onsets`; the
// topology sits at observed positions so a TempoGridCmd re-lifts notes' beats
// from their unchanged seconds (notes ride). Returns { beats, segments } or null.
export function _segmentRoughMapPure(onsets, opts) {
    const o = opts || {};
    const bpb = o.beatsPerBar || 4;
    const segments = _segmentTempoPure(_localTempoSeriesPure(onsets, o), o);
    if (!segments.length) return null;
    for (const seg of segments) {
        const period = 60 / (seg.bpmStart || seg.bpmEnd || 120);
        seg.downbeatTime = _downbeatPhasePure(onsets, period, seg.tStart, { beatsPerBar: bpb }).downbeatTime;
    }
    const skeleton = _segmentSeedGridPure(segments, { beatsPerBar: bpb });
    if (skeleton.length < 2) return null;
    const beats = skeleton.map(b => b.measure > 0
        ? { time: b.time, measure: b.measure, den: 4 }
        : { time: b.time, measure: -1 });
    return { beats, segments };
}
/* @pure:tempo-segment:end */
