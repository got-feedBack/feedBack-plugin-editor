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

// The suggestion engine. From the anchor downbeat, march the following
// downbeats: prediction = previous accepted time + the CURRENT grid's own
// interval for that bar, scaled by a drift-tracking stretch EMA; snap to the
// strongest onset within ±winFrac of the interval. A locked downbeat is
// authoritative — pinned at its own time, full confidence, and it re-anchors
// the march. A bar with no corroborating onset keeps marching on the bare
// prediction at low confidence; after `maxMiss` consecutive misses the run
// stops and the trailing guesses are DROPPED (silence / phase break / tempo
// change — ask the human for the next anchor rather than invent bars).
//
// Returns { proposals: [{ i, time, conf, locked }], stopReason } where
// `i` indexes into `beats` and times are strictly increasing. `proposals`
// excludes the anchor itself. stopReason: 'end' | 'lost'.
export function _suggestFitPure(beats, onsets, fromIdx, opts) {
    const o = opts || {};
    const winFrac = o.winFrac || 0.12;
    const minWin = o.minWin || 0.025;
    const maxMiss = o.maxMiss || 4;
    const missConf = o.missConf || 0.12;
    const alpha = o.alpha || 0.35;
    const downs = _suggestDownbeatsFromPure(beats, fromIdx);
    if (downs.length < 2 || !Array.isArray(onsets) || !onsets.length) {
        return { proposals: [], stopReason: 'end' };
    }
    const proposals = [];
    let prevOld = beats[downs[0]].time;   // grid time of the previous downbeat
    let prevNew = beats[downs[0]].time;   // accepted/proposed time of it
    let stretch = 1;
    let misses = 0;
    let stopReason = 'end';
    for (let k = 1; k < downs.length; k++) {
        const d = downs[k];
        const gridInt = beats[d].time - prevOld;
        if (!(gridInt > 0)) { stopReason = 'lost'; break; }
        if (beats[d].locked) {
            // Human-verified: never moved, resets the drift bookkeeping.
            proposals.push({ i: d, time: beats[d].time, conf: 1, locked: true });
            prevOld = beats[d].time;
            prevNew = beats[d].time;
            stretch = 1;
            misses = 0;
            continue;
        }
        const predicted = prevNew + gridInt * stretch;
        const win = Math.max(minWin, gridInt * winFrac);
        const hit = _suggestOnsetNearPure(onsets, predicted, win);
        let time, conf;
        if (hit && hit.t > prevNew + 0.01) {
            time = hit.t;
            conf = hit.conf;
            stretch = stretch * (1 - alpha) + ((time - prevNew) / gridInt) * alpha;
            misses = 0;
        } else {
            time = Math.max(predicted, prevNew + 0.01);
            conf = missConf;
            misses++;
        }
        proposals.push({ i: d, time, conf, locked: false });
        prevOld = beats[d].time;
        prevNew = time;
        if (misses >= maxMiss) { stopReason = 'lost'; break; }
    }
    // Drop the trailing uncorroborated run — those are guesses past the point
    // where the audio stopped agreeing, exactly where the design says to stop
    // and request another anchor.
    while (proposals.length && !proposals[proposals.length - 1].locked
            && proposals[proposals.length - 1].conf <= missConf) {
        proposals.pop();
        stopReason = 'lost';
    }
    return { proposals, stopReason };
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

// HUD line while suggestions are showing (the guidance pure stays untouched —
// its strings are pinned by tests).
export function _suggestHudTextPure(count, avgConf, stopReason) {
    const pct = Math.round(Math.max(0, Math.min(1, avgConf)) * 100);
    const tail = stopReason === 'lost'
        ? ' - stopped where the onsets stop agreeing (add an anchor there and press G again)'
        : '';
    return `Suggested ${count} barline${count === 1 ? '' : 's'} (~${pct}% confidence)`
        + ` - click a ghost handle to accept through it - Esc dismisses${tail}`;
}
/* @pure:tempo-suggest:end */

// ── Module state (proposal-only; keyed on editGen for staleness) ─────
let _sug = null;   // { anchorIdx, proposals, stopReason, onsets, gen }

export function _suggestActive() {
    return !!(_sug && _sug.gen === editGen && S.tempoMapMode && _sug.proposals.length);
}
export function _suggestProposals() {
    return _suggestActive() ? _sug.proposals : [];
}
export function _suggestStopReason() {
    return _sug ? _sug.stopReason : 'end';
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
export function _suggestCompute(anchorIdx, onsets) {
    const list = onsets || (_sug && _sug.onsets) || null;
    if (!list || !list.length) { _sug = null; return 0; }
    const { proposals, stopReason } = _suggestFitPure(S.beats, list, anchorIdx);
    _sug = { anchorIdx, proposals, stopReason, onsets: list, gen: editGen };
    return proposals.length;
}

// After an accept bumped editGen, re-key and regenerate forward from the
// newly authoritative downbeat with the remembered onsets.
export function _suggestRegenerateFrom(anchorIdx) {
    if (!_sug) return 0;
    return _suggestCompute(anchorIdx, _sug.onsets);
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
