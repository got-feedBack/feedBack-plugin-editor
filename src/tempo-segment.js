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

import { _suggestApplyPure, _suggestFitPure } from './tempo-suggest.js';

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
    if (!(tEnd > 0)) return [];                     // audio slid fully before t=0 → no bins to fill
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

    // Cap: merge the most-similar adjacent pair (closest at the join) until within
    // budget. The merged span is described by its OWN endpoints a.bpmStart→b.bpmEnd:
    // forcing 'constant' here flattened a real rit/accel into a lie, and since the
    // pair is picked for continuity at the join those endpoints are the honest read.
    while (segs.length > maxSegments) {
        let bi = 0, bd = Infinity;
        for (let i = 0; i + 1 < segs.length; i++) {
            const d = Math.abs(segs[i].bpmEnd - segs[i + 1].bpmStart);
            if (d < bd) { bd = d; bi = i; }
        }
        const a = segs[bi], b = segs[bi + 1];
        const med = (a.bpmStart + b.bpmEnd) / 2;
        const isRamp = Math.abs(b.bpmEnd - a.bpmStart) > med * rampFrac;
        segs.splice(bi, 2, { tStart: a.tStart, tEnd: b.tEnd,
            kind: isRamp ? 'ramp' : 'constant',
            bpmStart: isRamp ? a.bpmStart : med, bpmEnd: isRamp ? b.bpmEnd : med,
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
    // Window to THIS segment: scoring past tEnd lets a later zone's pulse vote on
    // this zone's phase (its own bar grid is a different period), which on a
    // multi-zone song drags bar 1 off the beat it actually lands on.
    const tEnd = Number.isFinite(o.tEnd) ? o.tEnd : Infinity;
    const on = (Array.isArray(onsets) ? onsets : []).filter(x => x && Number.isFinite(x.t) && x.t >= tStart - 1e-6 && x.t < tEnd);
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
//
// The output is CONTRACTUALLY strictly-increasing in time. beatOf()/timeOf()
// binary-search the beats array, so a non-monotonic grid silently corrupts every
// note in the song — and the segments arriving here are user-confirmable, so a
// hand-edited 0/negative bpm or an overlapping zone is a live input, not a
// theoretical one. Hence the two guards below: a non-positive/non-finite beat
// period would also spin `while (t < tEnd)` forever, hanging the editor.
export function _segmentSeedGridPure(segments, opts) {
    const o = opts || {};
    const bpb = o.beatsPerBar || 4;
    const beats = [];
    let measure = 1, last = -Infinity;
    for (const seg of (Array.isArray(segments) ? segments : [])) {
        if (!seg || seg.kind === 'unmapped' || !(seg.tStart < seg.tEnd)) continue;
        const p0 = 60 / (seg.bpmStart || seg.bpmEnd || 120);
        const p1 = 60 / (seg.bpmEnd || seg.bpmStart || 120);
        if (!(p0 > 0) || !(p1 > 0) || !Number.isFinite(p0) || !Number.isFinite(p1)) continue;
        let t = Number.isFinite(seg.downbeatTime) ? seg.downbeatTime : seg.tStart;
        let bi = 0;
        while (t < seg.tEnd - 1e-6) {
            const time = Math.round(t * 1e6) / 1e6;
            if (time > last) { beats.push({ time, measure: bi % bpb === 0 ? measure++ : 0 }); last = time; }
            // interpolate the beat period across a ramp by progress through the span
            const frac = (t - seg.tStart) / (seg.tEnd - seg.tStart);
            const period = seg.kind === 'ramp' ? p0 + (p1 - p0) * Math.max(0, Math.min(1, frac)) : p0;
            t += period; bi++;
        }
    }
    return beats;
}
// End-to-end rough map: detect segments → seed each downbeat's PHASE → build the
// grid in the editor's beat shape (downbeats {time, measure, den}; interior
// {time, measure: -1}). Pure over `onsets`; the topology sits at observed
// positions so a TempoGridCmd re-lifts notes' beats from their unchanged seconds
// (notes ride). Returns { beats, segments } or null.
//
// The phase seed is only as good as the onsets it is handed. _downbeatPhasePure
// prefers a LOW band (bands.lo = kick/bass) and falls back to overall strength —
// and the banded spectral-flux detector now carries bands through the audio shift,
// so on a decoded recording the kick really does drive the phase. The RMS fallback
// detector still emits {t, s} only; there phase seeds off broadband strength and
// CAN land on a snare backbeat, and the confirm bar (drag the boundary) is the out.
export function _segmentRoughMapPure(onsets, opts) {
    const o = opts || {};
    const segments = _segmentTempoPure(_localTempoSeriesPure(onsets, o), o);
    if (!segments.length) return null;
    const beats = _segmentSeedBeatsPure(onsets, segments, o);
    if (!beats) return null;
    return { beats, segments };
}

// Seed the editor-shaped beat grid from an EXPLICIT segment list (the confirm
// bar hands back segments the human may have dragged/split/merged/re-typed).
// Re-seeds each segment's downbeat PHASE unless it already carries a
// `downbeatTime` inside its span (an adjusted boundary drops the stale seed, so
// only surviving seeds are trusted). Returns beats or null (fewer than 2).
export function _segmentSeedBeatsPure(onsets, segments, opts) {
    const o = opts || {};
    const bpb = o.beatsPerBar || 4;
    const segs = (Array.isArray(segments) ? segments : []).map(s => ({ ...s }));
    for (const seg of segs) {
        if (seg.kind === 'unmapped') continue;
        if (Number.isFinite(seg.downbeatTime)
                && seg.downbeatTime >= seg.tStart - 1e-6 && seg.downbeatTime < seg.tEnd) continue;
        const period = 60 / (seg.bpmStart || seg.bpmEnd || 120);
        // Window the phase search to the segment: scoring to the end of the song
        // lets a later zone's pulse drag this zone's bar 1 off its own beat.
        seg.downbeatTime = _downbeatPhasePure(onsets, period, seg.tStart,
            { beatsPerBar: bpb, tEnd: seg.tEnd }).downbeatTime;
    }
    const skeleton = _segmentSeedGridPure(segs, { beatsPerBar: bpb });
    if (skeleton.length < 2) return null;
    return skeleton.map(b => b.measure > 0
        ? { time: b.time, measure: b.measure, den: 4 }
        : { time: b.time, measure: -1 });
}

// ── Confirm-bar adjust verbs (P2-3 confirm) ─────────────────────────────────
// Every verb returns a NEW segments array (input never mutated) or null when
// the edit is invalid — callers keep the previous proposal on null. Segments
// are assumed sorted by tStart (the detector emits them that way).

const _SEG_MIN_LEN = 2;        // seconds — a tempo INTENT spans at least a bar or two
const _SEG_RAMP_FRAC = 0.04;   // endpoint spread that reads as a ramp (matches detector)

// Move the boundary between segments[bIdx] and segments[bIdx+1] to `newT`,
// clamped so both neighbours keep at least `minLen` seconds. A dragged
// boundary invalidates the right segment's phase seed (its span changed).
export function _segmentBoundaryDragPure(segments, bIdx, newT, minLen = _SEG_MIN_LEN) {
    if (!Array.isArray(segments) || !Number.isInteger(bIdx)
            || bIdx < 0 || bIdx + 1 >= segments.length || !Number.isFinite(newT)) return null;
    const out = segments.map(s => ({ ...s }));
    const a = out[bIdx], b = out[bIdx + 1];
    const t = Math.max(a.tStart + minLen, Math.min(b.tEnd - minLen, newT));
    if (!(t > a.tStart && t < b.tEnd)) return null;   // segments too short to move between
    a.tEnd = t;
    b.tStart = t;
    if (Number.isFinite(a.downbeatTime) && a.downbeatTime >= t) delete a.downbeatTime;
    if (Number.isFinite(b.downbeatTime) && b.downbeatTime < t) delete b.downbeatTime;
    return out;
}

// Split segments[idx] at time `t` (both halves keep at least `minLen`). A
// constant splits into two constants at the same tempo; a ramp splits into two
// ramps meeting at the interpolated bpm; unmapped splits into two unmapped.
export function _segmentSplitPure(segments, idx, t, minLen = _SEG_MIN_LEN) {
    if (!Array.isArray(segments) || !segments[idx] || !Number.isFinite(t)) return null;
    const s = segments[idx];
    if (t < s.tStart + minLen || t > s.tEnd - minLen) return null;
    const frac = (t - s.tStart) / (s.tEnd - s.tStart);
    const bpmAt = s.kind === 'ramp'
        ? Math.round((s.bpmStart + (s.bpmEnd - s.bpmStart) * frac) * 10) / 10
        : s.bpmStart;
    const left = { ...s, tEnd: t, bpmEnd: s.kind === 'ramp' ? bpmAt : s.bpmEnd };
    const right = { ...s, tStart: t, bpmStart: s.kind === 'ramp' ? bpmAt : s.bpmStart };
    if (Number.isFinite(left.downbeatTime) && left.downbeatTime >= t) delete left.downbeatTime;
    delete right.downbeatTime;   // the new right half re-seeds its own phase
    const out = segments.map(x => ({ ...x }));
    out.splice(idx, 1, left, right);
    return out;
}

// Merge segments[idx] with segments[idx+1]. Honest endpoints (the cap-merge
// rule): the joined span is described by its OWN ends a.bpmStart→b.bpmEnd — a
// ramp when they differ beyond the ramp threshold, else a constant at their
// midpoint. Unmapped only when BOTH halves were unmapped.
export function _segmentMergePure(segments, idx) {
    if (!Array.isArray(segments) || !segments[idx] || !segments[idx + 1]) return null;
    const a = segments[idx], b = segments[idx + 1];
    const med = (a.bpmStart + b.bpmEnd) / 2 || a.bpmStart || b.bpmEnd || 120;
    const isRamp = Math.abs(b.bpmEnd - a.bpmStart) > med * _SEG_RAMP_FRAC;
    const joined = {
        tStart: a.tStart, tEnd: b.tEnd,
        kind: (a.kind === 'unmapped' && b.kind === 'unmapped') ? 'unmapped'
            : (isRamp ? 'ramp' : 'constant'),
        bpmStart: isRamp ? a.bpmStart : Math.round(med * 10) / 10,
        bpmEnd: isRamp ? b.bpmEnd : Math.round(med * 10) / 10,
        conf: Math.min(a.conf ?? 0, b.conf ?? 0),
    };
    if (Number.isFinite(a.downbeatTime)) joined.downbeatTime = a.downbeatTime;
    const out = segments.map(x => ({ ...x }));
    out.splice(idx, 2, joined);
    return out;
}

// Cycle a zone's kind: constant → ramp → unmapped → constant. Constant→ramp
// keeps both endpoints (edit BPM to spread them); ramp→unmapped keeps the
// numbers for the round trip; unmapped→constant restores a steady zone at the
// endpoint midpoint (or 120 when the zone never had a tempo).
export function _segmentCycleKindPure(segments, idx) {
    if (!Array.isArray(segments) || !segments[idx]) return null;
    const out = segments.map(x => ({ ...x }));
    const s = out[idx];
    if (s.kind === 'constant') s.kind = 'ramp';
    else if (s.kind === 'ramp') s.kind = 'unmapped';
    else {
        s.kind = 'constant';
        const med = ((s.bpmStart || 0) + (s.bpmEnd || 0)) / 2 || 120;
        s.bpmStart = s.bpmEnd = Math.round(med * 10) / 10;
    }
    return out;
}

// Set a zone's tempo. A constant takes one value (both ends); a ramp takes
// start→end. Values outside a playable [30, 400] refuse — a typo'd 0 or 1200
// would seed a degenerate grid (and a non-finite period hangs the seeder).
export function _segmentSetBpmPure(segments, idx, bpmStart, bpmEnd) {
    if (!Array.isArray(segments) || !segments[idx]) return null;
    const lo = 30, hi = 400;
    const b0 = Number(bpmStart);
    const b1 = segments[idx].kind === 'ramp' ? Number(bpmEnd ?? bpmStart) : b0;
    if (!Number.isFinite(b0) || b0 < lo || b0 > hi) return null;
    if (!Number.isFinite(b1) || b1 < lo || b1 > hi) return null;
    const out = segments.map(x => ({ ...x }));
    out[idx].bpmStart = Math.round(b0 * 10) / 10;
    out[idx].bpmEnd = Math.round(b1 * 10) / 10;
    return out;
}

// "Single tempo instead" — collapse every mapped zone into ONE constant zone
// spanning them, at the duration-weighted median of the zone tempos (the
// escape hatch when the detector over-segments a steady song).
export function _segmentSingleTempoPure(segments) {
    const mapped = (Array.isArray(segments) ? segments : [])
        .filter(s => s && s.kind !== 'unmapped' && s.tStart < s.tEnd);
    if (!mapped.length) return null;
    const weighted = [];
    for (const s of mapped) {
        weighted.push({ bpm: (s.bpmStart + s.bpmEnd) / 2, w: s.tEnd - s.tStart });
    }
    weighted.sort((a, b) => a.bpm - b.bpm);
    const total = weighted.reduce((acc, x) => acc + x.w, 0);
    let run = 0, bpm = weighted[weighted.length - 1].bpm;
    for (const x of weighted) { run += x.w; if (run >= total / 2) { bpm = x.bpm; break; } }
    const first = mapped[0];
    const out = [{
        tStart: first.tStart, tEnd: mapped[mapped.length - 1].tEnd,
        kind: 'constant',
        bpmStart: Math.round(bpm * 10) / 10, bpmEnd: Math.round(bpm * 10) / 10,
        conf: Math.min(...mapped.map(s => s.conf ?? 0)),
    }];
    if (Number.isFinite(first.downbeatTime)) out[0].downbeatTime = first.downbeatTime;
    return out;
}

// ── Bounded per-segment refine (P2-3 Apply) ─────────────────────────────────
// Given the SEEDED grid, snap each mapped segment's barlines onto the recording
// with pass-1's suggest engine, bounded INSIDE the segment (opts.toIdx) and with
// the segment's constant-tempo prior clamping the stretch tracker — the
// structural cure for the runaway off-phase march. Locked downbeats defend
// as always (the engine pins them). Returns { beats, refined } where `refined`
// counts the downbeats that took an onset-corroborated time; beats outside
// every segment (and past each bound) are untouched.
export function _segmentRefineGridPure(beats, onsets, segments, opts) {
    const o = opts || {};
    const clamp = Number.isFinite(o.stretchClamp) ? o.stretchClamp : 0.12;
    let out = (beats || []).map(b => ({ ...b }));
    let refined = 0;
    for (const seg of (Array.isArray(segments) ? segments : [])) {
        if (!seg || seg.kind === 'unmapped' || !(seg.tStart < seg.tEnd)) continue;
        let fromIdx = -1, toIdx = -1;
        for (let i = 0; i < out.length; i++) {
            if (out[i].measure <= 0) continue;
            if (out[i].time < seg.tStart - 1e-6 || out[i].time >= seg.tEnd - 1e-6) continue;
            if (fromIdx < 0) fromIdx = i;
            toIdx = i;
        }
        if (fromIdx < 0 || toIdx <= fromIdx) continue;   // <2 downbeats — nothing to refine
        const fit = _suggestFitPure(out, onsets, fromIdx, { toIdx, stretchClamp: clamp });
        if (!fit.proposals.length) continue;
        const last = fit.proposals[fit.proposals.length - 1].i;
        const applied = _suggestApplyPure(out, fit.proposals, last);
        if (applied) {
            out = applied;
            refined += fit.proposals.filter(p => !p.locked).length;
        }
    }
    return { beats: out, refined };
}
/* @pure:tempo-segment:end */

