// ════════════════════════════════════════════════════════════════════
// Assisted tempo mapping — suggest a barline fit from the onset strip
// (docs/TEMPO-MAPPING-DESIGN.md, "Assisted Mapping" / delivery slice 3).
//
// The seed-suggest-correct loop over EXISTING downbeats: from a confirmed
// anchor (the selected barline), predict each following downbeat from the
// current grid's own spacing (the grid is the hypothesis — meter changes and
// pickups carry automatically), snap the prediction to the strongest nearby
// onset, carry a confidence, track drift with an EMA stretch, and STOP at
// silence or when the onsets stop corroborating — per the design, low
// confidence requests another human anchor instead of guessing onward.
//
// Everything here is proposal-only: suggestions are module state rendered as
// ghost poles by src/tempo.js and are NEVER committed silently. Accepting
// through a ghost is tempo.js's job (it owns TempoMapCmd); dismissal is Esc,
// mode exit, or any edit (proposals key on `editGen` — a stale generation
// reads as inactive, so no edit can ever race a ghost click).
//
// Cycle discipline: this module imports only state/geometry/ui. The onset
// list is PASSED IN by the caller (input.js already imports audio.js) and
// stored for forward regeneration after an accept — audio never changes
// between an accept and the regenerate, so the stored list stays valid.
// ════════════════════════════════════════════════════════════════════
import { timeToX } from './geometry.js';
import { S, editGen } from './state.js';

/* @pure:tempo-suggest:start */
// Downbeat indices at or after `fromIdx` (fromIdx itself first).
export function _suggestDownbeatsFromPure(beats, fromIdx) {
    const out = [];
    for (let i = fromIdx; i < (beats ? beats.length : 0); i++) {
        if (beats[i] && beats[i].measure > 0) out.push(i);
    }
    return out;
}

// Strongest onset inside [t-win, t+win], scored by strength discounted with
// distance from the prediction — a weak hit dead-on beats a loud one at the
// window edge only if the loud one is much stronger. Null when the window is
// empty. `onsets` must be time-sorted ({t, s}), which the strip guarantees.
export function _suggestOnsetNearPure(onsets, t, win) {
    if (!Array.isArray(onsets) || !onsets.length || !(win > 0)) return null;
    // Binary search to the window start, then scan the (short) window.
    let lo = 0, hi = onsets.length;
    while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (onsets[mid].t < t - win) lo = mid + 1; else hi = mid;
    }
    let best = null, bestScore = 0;
    for (let i = lo; i < onsets.length && onsets[i].t <= t + win; i++) {
        const o = onsets[i];
        if (!Number.isFinite(o.t)) continue;
        const s = Math.max(0, Math.min(1, Number(o.s) || 0));
        const score = s * (1 - 0.6 * (Math.abs(o.t - t) / win));
        if (score > bestScore) { bestScore = score; best = { t: o.t, conf: score }; }
    }
    return best;
}

// (Hardening c1) Snap window as a fraction of the BEAT, not the bar: the old
// `gridInt * winFrac` was ±12% of a whole bar (±0.48 beat in 4/4 — the adjacent
// eighth is in-window), so a syncopation could be snapped as the downbeat.
// Beat-relative keeps the window under half a beat and scales correctly across
// meters. The 25 ms floor survives for very fast bars.
export function _suggestBeatWinPure(gridInt, beatsInBar, winFrac, minWin) {
    const nb = beatsInBar > 0 ? beatsInBar : 1;
    return Math.max(minWin > 0 ? minWin : 0.025, (gridInt / nb) * (winFrac > 0 ? winFrac : 0.45));
}

// True if any onset falls in (lo, hi] — used to tell a SILENT bar (stop) from a
// SUSTAINED one whose onsets simply miss the downbeat (keep marching).
export function _suggestAnyOnsetInPure(onsets, lo, hi) {
    if (!Array.isArray(onsets) || !(hi > lo)) return false;
    for (const o of onsets) {
        if (Number.isFinite(o.t) && o.t > lo && o.t <= hi) return true;
    }
    return false;
}

// (Hardening c2) One-bar comb corroboration: score a candidate downbeat by the
// onset support of ALL the bar's implied beats (the interior subdivisions plus
// the closing downbeat), not the single downbeat onset — so a bar whose whole
// pulse is played reads as far more certain than a bare, possibly-spurious
// downbeat hit. Even subdivision (no grouping field exists yet). Mean support
// in [0,1]; `startT` is the previous (already-accepted) downbeat, excluded.
export function _suggestCombPure(onsets, startT, endT, beatsInBar, win) {
    const nb = beatsInBar > 0 ? beatsInBar : 1;
    if (!(endT > startT)) return 0;
    let sum = 0;
    for (let j = 1; j <= nb; j++) {
        const tj = startT + (endT - startT) * (j / nb);
        const hit = _suggestOnsetNearPure(onsets, tj, win);
        sum += hit ? hit.conf : 0;
    }
    return sum / nb;
}

// Look around the local snap for a better bar-level comb. This does NOT widen
// the single-hit snap rule by itself: a better candidate outside jumpTol still
// stops the march below. It prevents a dense interior beat from masquerading as
// the downbeat when the real barline is just outside the beat-relative window.
function _suggestBestCombCandidatePure(onsets, startT, gridInt, beatsInBar, win, stretch, jumpTol) {
    if (!Array.isArray(onsets) || !(gridInt > 0)) return null;
    const rawPad = win / gridInt;
    const lo = startT + gridInt * Math.max(0.01, stretch - jumpTol - rawPad);
    const hi = startT + gridInt * (stretch + jumpTol + rawPad);
    let best = null;
    for (const o of onsets) {
        if (!Number.isFinite(o.t) || o.t <= lo || o.t > hi) continue;
        const rawStretch = (o.t - startT) / gridInt;
        if (!(rawStretch > 0)) continue;
        const comb = _suggestCombPure(onsets, startT, o.t, beatsInBar, win);
        if (!best || comb > best.comb || (comb === best.comb && Math.abs(o.t - (startT + gridInt * stretch)) < Math.abs(best.time - (startT + gridInt * stretch)))) {
            best = { time: o.t, rawStretch, comb };
        }
    }
    return best;
}

// (Hardening c3) Median of recent stretch samples — tap-tempo's trick: one bad
// snap can't drag the running tempo the way a plain EMA (α=0.35 → 35% per bad
// bar) does. Non-mutating.
export function _suggestMedianPure(vals) {
    if (!Array.isArray(vals) || !vals.length) return null;
    const s = vals.slice().sort((a, b) => a - b);
    const m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// The suggestion engine. From the anchor downbeat, march the following
// downbeats: prediction = previous accepted time + the CURRENT grid's own
// interval for that bar, scaled by a drift-tracking stretch; snap to the
// strongest onset within a BEAT-relative window (c1). A locked downbeat is
// authoritative — pinned at its own time, full confidence, and it re-anchors
// the march. Confidence is a PRODUCT (c6) of comb corroboration (c2), run
// continuity, and tempo consistency, so a bare or off-tempo bar reads as less
// certain. The march STOPS with a NAMED reason (c7) rather than inventing bars:
//   'silence'    — the bar has no onset at all (c5);
//   'phase'      — the snap implies a half/double-time feel (c4);
//   'tempo-jump' — a single correction bigger than `jumpTol` of a bar (c3);
//   'bpm-range'  — the fit implies a tempo outside [minBpm, maxBpm] (c7).
// A SUSTAINED bar (onsets present but off the downbeat) keeps marching (c5).
//
// Returns { proposals: [{ i, time, conf, locked }], stopReason, stopDetail }
// where `i` indexes into `beats` and times are strictly increasing. `proposals`
// excludes the anchor itself. stopReason: 'end' | 'lost'.
export function _suggestFitPure(beats, onsets, fromIdx, opts) {
    const o = opts || {};
    const winFrac = o.winFrac || 0.45;          // now a fraction of a BEAT (stays under the ½-beat eighth)
    const minWin = o.minWin || 0.025;
    const maxMiss = o.maxMiss || 4;
    const missConf = o.missConf || 0.12;
    const medianN = o.medianN || 5;             // stretch median window (c3)
    const jumpTol = o.jumpTol || 0.25;          // >25% single correction ⇒ stop
    const combSwitchMargin = o.combSwitchMargin || 0.15;
    const minBpm = o.minBpm || 40;
    const maxBpm = o.maxBpm || 300;
    const eps = 0.01;
    const downs = _suggestDownbeatsFromPure(beats, fromIdx);
    if (downs.length < 2 || !Array.isArray(onsets) || !onsets.length) {
        return { proposals: [], stopReason: 'end', stopDetail: 'end' };
    }
    const proposals = [];
    let prevDownIdx = downs[0];
    let prevOld = beats[downs[0]].time;   // grid time of the previous downbeat
    let prevNew = beats[downs[0]].time;   // accepted/proposed time of it
    let stretch = 1;
    const stretchHist = [];
    let misses = 0;
    // (c5 backfill) Miss-proposals awaiting retroactive confidence: a bar
    // marched on bare prediction gets the floor confidence — but when a LATER
    // corroborated hit (or a locked pin) lands, the marched path was right,
    // so the misses between two corroborations are raised to a still-
    // discounted share of the weaker flank. Trailing misses that never
    // re-corroborate keep the floor (and still get dropped at the end).
    const pendingMisses = [];
    // `prevConf` carries the INTRINSIC strength (comb × consistency — the
    // continuity penalty excluded) of the last corroboration: a closing hit's
    // published conf is already discounted FOR the misses it follows, so
    // using it here would double-count the very gap being backfilled.
    let prevConf = 1;                     // the anchor is human-placed — full trust
    const backfill = (intrinsic) => {
        const lift = Math.min(prevConf, intrinsic) * 0.75;
        for (const pi of pendingMisses) {
            proposals[pi].conf = Math.max(proposals[pi].conf, lift);
        }
        pendingMisses.length = 0;
        prevConf = intrinsic;
    };
    let stopReason = 'end', stopDetail = 'end';
    const toIdx = Number.isInteger(o.toIdx) ? o.toIdx : null;
    for (let k = 1; k < downs.length; k++) {
        const d = downs[k];
        if (toIdx != null && d > toIdx) { stopReason = 'end'; stopDetail = 'bound'; break; }
        const gridInt = beats[d].time - prevOld;
        const beatsInBar = d - prevDownIdx;   // beats in the PREVIOUS measure's span
        if (!(gridInt > 0) || beatsInBar < 1) { stopReason = 'lost'; break; }
        if (beats[d].locked) {
            // Human-verified: never moved, resets the drift bookkeeping —
            // and corroborates any marched bars behind it (c5 backfill).
            proposals.push({ i: d, time: beats[d].time, conf: 1, locked: true });
            backfill(1);
            prevDownIdx = d; prevOld = beats[d].time; prevNew = beats[d].time;
            stretch = 1; stretchHist.length = 0; misses = 0;
            continue;
        }
        const predicted = prevNew + gridInt * stretch;
        const win = _suggestBeatWinPure(gridInt, beatsInBar, winFrac, minWin);
        const missesBefore = misses;
        const hit = _suggestOnsetNearPure(onsets, predicted, win);
        if (hit && hit.t > prevNew + eps) {
            let time = hit.t;
            let rawStretch = (time - prevNew) / gridInt;
            let comb = _suggestCombPure(onsets, prevNew, time, beatsInBar, win);
            const better = _suggestBestCombCandidatePure(onsets, prevNew, gridInt, beatsInBar, win, stretch, jumpTol);
            if (better && better.time !== time && better.comb > comb + combSwitchMargin) {
                time = better.time;
                rawStretch = better.rawStretch;
                comb = better.comb;
            }
            // (c4) A snap implying ~half or ~double the bar is a metric-phase
            // ambiguity (halftime backbeat, double-time hat), not tempo drift —
            // stop and ask rather than lock the grid to the wrong pulse.
            if (Math.abs(rawStretch - 0.5) < 0.1 || Math.abs(rawStretch - 2) < 0.2) {
                stopReason = 'lost'; stopDetail = 'phase'; break;
            }
            // (c3) A single correction bigger than jumpTol of a bar is a break,
            // not drift — stop instead of snapping the whole grid onto it.
            if (Math.abs(rawStretch - stretch) > jumpTol) {
                stopReason = 'lost'; stopDetail = 'tempo-jump'; break;
            }
            // (c7) Reject a fit that implies an out-of-range tempo.
            const bpm = 60 * beatsInBar / (time - prevNew);
            if (!(bpm >= minBpm && bpm <= maxBpm)) {
                stopReason = 'lost'; stopDetail = 'bpm-range'; break;
            }
            // (c3) Median-of-recent stretch resists one bad snap.
            stretchHist.push(rawStretch);
            if (stretchHist.length > medianN) stretchHist.shift();
            stretch = _suggestMedianPure(stretchHist);
            // (c2)+(c6) Confidence = comb × continuity × consistency.
            const continuity = Math.max(0, 1 - missesBefore * 0.5);
            const consistency = Math.max(0, 1 - Math.abs(rawStretch - stretch) / jumpTol);
            const conf = Math.max(0, Math.min(1, comb * continuity * consistency));
            proposals.push({ i: d, time, conf, locked: false });
            backfill(Math.max(0, Math.min(1, comb * consistency)));   // (c5) corroborates the marched bars behind it
            prevDownIdx = d; prevOld = beats[d].time; prevNew = time;
            misses = 0;
        } else {
            // (c5) Classify the miss: a bar with NO onset anywhere is silence —
            // stop. A bar with onsets that just don't fall on the downbeat is a
            // sustained/held passage — keep marching on the prediction.
            if (!_suggestAnyOnsetInPure(onsets, prevNew + eps, predicted + win)) {
                stopReason = 'lost'; stopDetail = 'silence'; break;
            }
            const time = Math.max(predicted, prevNew + eps);
            proposals.push({ i: d, time, conf: missConf, locked: false, miss: true });
            pendingMisses.push(proposals.length - 1);
            prevDownIdx = d; prevOld = beats[d].time; prevNew = time;
            misses++;
            if (misses >= maxMiss) { stopReason = 'lost'; stopDetail = 'silence'; break; }
        }
    }
    // Drop the trailing uncorroborated run — the bare-prediction MISSES past the
    // point where the audio stopped agreeing (design: stop and request another
    // anchor). Keyed on the miss flag, NOT confidence: a real but low-comb hit
    // (a bar whose downbeat played but whose interior didn't) is corroborated
    // and must survive.
    while (proposals.length && !proposals[proposals.length - 1].locked
            && proposals[proposals.length - 1].miss) {
        proposals.pop();
        stopReason = 'lost';
        if (stopDetail === 'end') stopDetail = 'silence';
    }
    for (const p of proposals) delete p.miss;   // internal flag; keep the public shape
    return { proposals, stopReason, stopDetail };
}

// Apply proposals up to and including the one for downbeat `throughI`:
// corrected downbeats take their proposed times, and every non-downbeat beat
// between two adjacent downbeats keeps its original FRACTION of the old span
// (the same neighborhood re-space a pole drag does). Downbeats after
// `throughI` keep their old times, so the first unaccepted span re-spaces
// against a fixed far edge and everything beyond is untouched. Equal-length
// output — the TempoMapCmd invariant; notes ride via its reproject.
export function _suggestApplyPure(beats, proposals, throughI) {
    if (!Array.isArray(beats) || !Array.isArray(proposals)) return null;
    const newTime = new Map();
    let found = false;
    for (const p of proposals) {
        newTime.set(p.i, p.time);
        if (p.i === throughI) { found = true; break; }
    }
    if (!found) return null;
    const out = beats.map(b => ({ ...b }));
    for (const [i, t] of newTime) out[i].time = t;
    // Re-space interiors between consecutive downbeats where an edge moved.
    let a = -1;
    for (let i = 0; i < beats.length; i++) {
        if (!(beats[i].measure > 0)) continue;
        if (a >= 0) {
            const aOld = beats[a].time, bOld = beats[i].time;
            const aNew = out[a].time, bNew = out[i].time;
            if ((aNew !== aOld || bNew !== bOld) && bOld > aOld) {
                for (let j = a + 1; j < i; j++) {
                    const frac = (beats[j].time - aOld) / (bOld - aOld);
                    out[j].time = aNew + frac * (bNew - aNew);
                }
            }
        }
        a = i;
    }
    return out;
}

// (Hardening c7) Named stop reasons — the HUD says WHY the march stopped, so a
// halftime feel, a tempo break, and plain silence read differently instead of
// one generic "onsets stopped agreeing". Unknown / absent detail → the generic
// line (keeps the old copy for the default 'lost').
const _SUGGEST_STOP_COPY = {
    silence: ' - stopped at silence (add an anchor past the gap and press G again)',
    phase: ' - stopped: the onsets fit a half/double-time feel here (anchor the real downbeat and press G)',
    'tempo-jump': ' - stopped at a sudden tempo change (anchor the new tempo and press G again)',
    'bpm-range': ' - stopped: the fit implied an out-of-range tempo (anchor the downbeat and press G)',
    default: ' - stopped where the onsets stop agreeing (add an anchor there and press G again)',
};

// HUD line while suggestions are showing (the guidance pure stays untouched —
// its strings are pinned by tests).
export function _suggestHudTextPure(count, avgConf, stopReason, stopDetail) {
    const pct = Math.round(Math.max(0, Math.min(1, avgConf)) * 100);
    const tail = stopReason === 'lost'
        ? (_SUGGEST_STOP_COPY[stopDetail] || _SUGGEST_STOP_COPY.default)
        : '';
    return `Suggested ${count} barline${count === 1 ? '' : 's'} (~${pct}% confidence)`
        + ` - click a ghost handle to accept through it - Esc dismisses${tail}`;
}
/* @pure:tempo-suggest:end */

// ── Module state (proposal-only; keyed on editGen for staleness) ─────
let _sug = null;   // { anchorIdx, proposals, stopReason, stopDetail, onsets, gen }

export function _suggestActive() {
    return !!(_sug && _sug.gen === editGen && S.tempoMapMode && _sug.proposals.length);
}
export function _suggestProposals() {
    return _suggestActive() ? _sug.proposals : [];
}
export function _suggestStopReason() {
    return _sug ? _sug.stopReason : 'end';
}
export function _suggestStopDetail() {
    return _sug ? (_sug.stopDetail || 'end') : 'end';
}
export function _suggestAvgConf() {
    if (!_suggestActive()) return 0;
    let s = 0;
    for (const p of _sug.proposals) s += p.conf;
    return s / _sug.proposals.length;
}

export function _suggestDismiss() {
    _sug = null;
}

// Compute (or forward-regenerate) proposals from `anchorIdx`, using — and
// remembering — the caller-provided onset list. Returns the proposal count.
export function _suggestCompute(anchorIdx, onsets, opts) {
    const list = onsets || (_sug && _sug.onsets) || null;
    if (!list || !list.length) { _sug = null; return 0; }
    const useOpts = opts || (onsets ? undefined : (_sug && _sug.opts)) || undefined;
    const { proposals, stopReason, stopDetail } = _suggestFitPure(S.beats, list, anchorIdx, useOpts);
    _sug = { anchorIdx, proposals, stopReason, stopDetail, onsets: list, opts: useOpts, gen: editGen };
    return proposals.length;
}

// After an accept bumped editGen, re-key and regenerate forward from the
// newly authoritative downbeat with the remembered onsets.
export function _suggestRegenerateFrom(anchorIdx) {
    if (!_sug) return 0;
    return _suggestCompute(anchorIdx, null);
}

// Ghost-handle hit test: x within `half` px of a proposal's ghost pole.
// The caller gates y to the ghost-handle band, so suggestions never steal
// the real poles' grab zone. Returns the proposal's beat index, or -1.
export function _suggestHitAt(x, half) {
    if (!_suggestActive()) return -1;
    const h = half || 7;
    let best = -1, bestD = h + 1;
    for (const p of _sug.proposals) {
        const d = Math.abs(timeToX(p.time) - x);
        if (d < bestD) { bestD = d; best = p.i; }
    }
    return best;
}
