/* Slopsmith Arrangement Editor — Map Health (per-bar drift review lens).
 *
 * The 2nd-pass thesis is "review an AUTOMATIC map, don't hand-enter it" — but
 * until now there was no review surface. Map Health scores, per measure, how well
 * the grid agrees with the detected onsets, and paints a three-state wash under
 * the ruler ticks so drift is visible wherever you chart.
 *
 * The metric (pure, here) is the whole point; the ruler paint + toggle are thin.
 *
 * Per beat: `resid = |beat.time − nearestOnset|`, and — critically — the drift is
 * reported as a FRACTION of the local beat interval, not raw milliseconds: 25 ms
 * at 60 bpm is inaudible, but 25 ms on 200-bpm 16ths is half a subdivision = wrong
 * rhythm. Per measure: the MEDIAN driftFrac over EVIDENCED beats (median so one
 * expressive off-beat note can't drag a bar red), plus coverage = evidenced/total.
 *
 * THREE states, and the third is non-negotiable:
 *   green  — the grid agrees with present onsets (driftFrac < greenMax).
 *   amber  — the grid is drifting from present onsets (greenMax..redMin).
 *   red    — the grid DISAGREES with present corroborating onsets (> redMin).
 *   grey   — NO onsets to judge (silence / sustained / held / pedaled): NEUTRAL,
 *            never red. Colouring an unmeasurable held bar red is crying wolf —
 *            the author learns to ignore red, which is fatal. Absence of evidence
 *            is CARRIED, not drift.
 *
 * Pure arithmetic over `beats` (each {time, measure}; measure>0 = downbeat) and
 * `onsets` ([{t,…}], time-sorted) — no S, no DOM — so it's exhaustively testable.
 */

/* @pure:map-health:start */
// Nearest onset time to `t` within `tol`, or null. Two-pointer friendly: pass the
// last onset cursor `from` (onsets sorted) and it scans forward only. Returns
// { time, cursor } so the measure walk stays O(beats + onsets).
function _nearestOnsetFrom(onsetTimes, t, tol, from) {
    let i = from;
    while (i < onsetTimes.length && onsetTimes[i] < t) i++;
    let best = null, bestD = Infinity;
    for (let k = i - 1; k <= i; k++) {
        if (k < 0 || k >= onsetTimes.length) continue;
        const d = Math.abs(onsetTimes[k] - t);
        if (d < bestD) { bestD = d; best = onsetTimes[k]; }
    }
    return { time: bestD <= tol ? best : null, cursor: Math.max(from, i - 1) };
}

function _median(arr) {
    if (!arr.length) return null;
    const s = arr.slice().sort((a, b) => a - b);
    const m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// Classify a measure from its median driftFrac + coverage. Coverage below
// `minCoverage` means too little evidence to judge → grey (carried), NEVER red.
function _bandFor(driftFrac, coverage, greenMax, redMin, minCoverage) {
    if (!(coverage >= minCoverage) || driftFrac === null) return 'grey';
    if (driftFrac > redMin) return 'red';
    if (driftFrac >= greenMax) return 'amber';   // green is strictly UNDER greenMax
    return 'green';
}

// Per-measure map health. Returns
//   { measures: [{ i, measure, beatIdx, startTime, endTime, driftFrac, coverage, band }],
//     overall: { band, driftFrac, coverage, measures } }
// `beats` is the full beat grid (S.beats), downbeats flagged by measure>0.
export function _mapHealthPure(beats, onsets, opts) {
    const o = opts || {};
    const greenMax = Number.isFinite(o.greenMax) ? o.greenMax : 0.05;
    const redMin = Number.isFinite(o.redMin) ? o.redMin : 0.12;
    const evidenceWin = Number.isFinite(o.evidenceWin) ? o.evidenceWin : 0.4;   // ± fraction of a beat
    const minCoverage = Number.isFinite(o.minCoverage) ? o.minCoverage : 0.34;
    const empty = { measures: [], overall: { band: 'grey', driftFrac: null, coverage: 0, measures: 0 } };
    if (!Array.isArray(beats) || beats.length < 2) return empty;

    const onsetTimes = (Array.isArray(onsets) ? onsets : [])
        .filter(x => x && Number.isFinite(x.t)).map(x => x.t).sort((a, b) => a - b);

    // Downbeat indices (measure > 0) delimit measures; a measure runs to the next
    // downbeat. The LAST measure has no closing downbeat (the canonical
    // `_tempoMeasures` rule in tempo.js — every downbeat starts a measure,
    // including a terminal one), so its end is EXTRAPOLATED one beat past the last
    // beat. Ending it AT the last beat would clip the final bar's wash a beat
    // short, and collapse a grid that happens to end on a downbeat to zero width.
    const downs = [];
    for (let i = 0; i < beats.length; i++) if (beats[i] && beats[i].measure > 0) downs.push(i);
    if (!downs.length) return empty;

    const intervalAt = (j) => {
        if (j + 1 < beats.length) return beats[j + 1].time - beats[j].time;
        if (j - 1 >= 0) return beats[j].time - beats[j - 1].time;
        return 0;
    };

    const measures = [];
    let cursor = 0;
    for (let d = 0; d < downs.length; d++) {
        const start = downs[d];
        const end = d + 1 < downs.length ? downs[d + 1] : beats.length;   // exclusive
        const drifts = [];
        let total = 0;
        for (let j = start; j < end; j++) {
            if (!beats[j] || !Number.isFinite(beats[j].time)) continue;
            total++;
            const interval = intervalAt(j);
            if (!(interval > 0)) continue;
            const found = _nearestOnsetFrom(onsetTimes, beats[j].time, interval * evidenceWin, cursor);
            cursor = found.cursor;
            if (found.time !== null) drifts.push(Math.abs(found.time - beats[j].time) / interval);
        }
        const coverage = total > 0 ? drifts.length / total : 0;
        const driftFrac = _median(drifts);
        measures.push({
            i: measures.length,
            measure: beats[start].measure,
            beatIdx: start,                         // S.beats index of this bar's downbeat (Suggest anchor)
            startTime: beats[start].time,
            endTime: (end < beats.length
                ? beats[end].time
                : beats[beats.length - 1].time + Math.max(0, intervalAt(beats.length - 1))),
            driftFrac,
            coverage,
            band: _bandFor(driftFrac, coverage, greenMax, redMin, minCoverage),
        });
    }

    // Overall: median driftFrac over evidenced measures; coverage = mean; band by
    // the same thresholds (a whole-map "is this map trustworthy?" glance).
    const evid = measures.filter(m => m.driftFrac !== null && m.coverage >= minCoverage);
    const overallDrift = _median(evid.map(m => m.driftFrac));
    const overallCov = measures.length ? measures.reduce((s, m) => s + m.coverage, 0) / measures.length : 0;
    return {
        measures,
        overall: {
            band: _bandFor(overallDrift, overallCov, greenMax, redMin, minCoverage),
            driftFrac: overallDrift,
            coverage: overallCov,
            measures: measures.length,
        },
    };
}

// The three wash colours for the ruler sub-band, by band. Grey/amber read as
// "neutral / soft"; red is the only alarm. Kept here so the metric and the paint
// agree on the vocabulary.
export const MAP_HEALTH_COLORS = {
    green: '#22c55e',
    amber: '#f59e0b',
    red: '#ef4444',
    grey: '#64748b',
};

// The LCD pill verdict: what fraction of the JUDGEABLE measures agree with
// the recording, coloured by the worst state present. Grey (nothing to judge)
// measures don't count either way — a sustained bridge can't lower the score,
// same no-crying-wolf rule as the wash. Null = no verdict (no judgeable bars
// at all), so the pill shows a neutral dash instead of a fake 100%.
export function _mapHealthPillPure(result) {
    const ms = result && Array.isArray(result.measures) ? result.measures : [];
    let green = 0, amber = 0, red = 0;
    for (const m of ms) {
        if (m.band === 'green') green++;
        else if (m.band === 'amber') amber++;
        else if (m.band === 'red') red++;
    }
    const judged = green + amber + red;
    if (!judged) return null;
    return {
        pct: Math.round((100 * green) / judged),
        band: red ? 'red' : amber ? 'amber' : 'green',
        judged,
    };
}

// The measure a "take me to the worst spot" click should land on: any red
// beats any amber; within a band, the largest drift wins. Null when nothing
// is drifting (the pill click then has nothing to fix — say so, don't jump).
export function _mapHealthWorstPure(result) {
    const ms = result && Array.isArray(result.measures) ? result.measures : [];
    const rank = (b) => (b === 'red' ? 2 : b === 'amber' ? 1 : 0);
    let worst = null;
    for (const m of ms) {
        if (!rank(m.band)) continue;
        if (!worst
                || rank(m.band) > rank(worst.band)
                || (rank(m.band) === rank(worst.band) && (m.driftFrac || 0) > (worst.driftFrac || 0))) {
            worst = m;
        }
    }
    return worst;
}
/* @pure:map-health:end */
