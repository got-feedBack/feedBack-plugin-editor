/* Slopsmith Arrangement Editor — the tempo grid converter.
 *
 * The one musical-beat ⇄ seconds mapping (charrette §1.1). Pure: it takes the
 * grid as an argument and touches nothing else — no `S`, no DOM. Everything that
 * rides the grid goes through these two, so they must agree exactly: `timeOf` is
 * the inverse of `beatOf` on the grid's own domain, and both extrapolate past the
 * ends using the terminal gap's tempo.
 */

// The one tempo-map converter (charrette §1.1): musical beat-coordinate ⇄
// seconds over a time-sorted grid `beats` ([{time,…},…] where the array index i
// IS the integer beat coordinate — consecutive entries are consecutive beats).
// This is the interior math the flex remapper (_makeTimeRemap) and snapTime
// already computed inline; extracted + named so there is ONE implementation
// that every musical-time quantity (ruler, snap, loop, playhead, notes) reads.
//
//   beatOf(beats, t): seconds → fractional beat. Within a gap it is the exact
//                     inverse of timeOf; before the first / after the last beat
//                     it extrapolates along that gap's local tempo, so the two
//                     stay inverses outside the grid too.
//   timeOf(beats, β): fractional beat → seconds, the mirror.
//
// A degenerate grid (< 2 beats) has no tempo map, so both are the identity and
// notes stay seconds-primary (charrette §1.3.4). Non-finite input and zero-width
// gaps are guarded (pass the input through / collapse to the gap's left edge).
export function beatOf(beats, t) {
    if (!Array.isArray(beats) || beats.length < 2 || !Number.isFinite(t)) return t;
    const n = beats.length;
    if (t <= beats[0].time) {
        const g = beats[1].time - beats[0].time;              // first gap's tempo
        return g > 1e-9 ? (t - beats[0].time) / g : 0;
    }
    if (t >= beats[n - 1].time) {
        const g = beats[n - 1].time - beats[n - 2].time;      // last gap's tempo
        return g > 1e-9 ? (n - 1) + (t - beats[n - 1].time) / g : n - 1;
    }
    let lo = 0, hi = n - 1;                                    // interior: bisect to the gap
    while (lo < hi) {
        const m = (lo + hi + 1) >> 1;
        if (beats[m].time <= t) lo = m; else hi = m - 1;
    }
    const span = beats[lo + 1].time - beats[lo].time;
    return span > 1e-9 ? lo + (t - beats[lo].time) / span : lo;
}

export function timeOf(beats, beat) {
    if (!Array.isArray(beats) || beats.length < 2 || !Number.isFinite(beat)) return beat;
    const n = beats.length;
    if (beat <= 0) {
        const g = beats[1].time - beats[0].time;              // extrapolate before beat 0
        return beats[0].time + beat * g;
    }
    if (beat >= n - 1) {
        const g = beats[n - 1].time - beats[n - 2].time;      // extrapolate past the last beat
        return beats[n - 1].time + (beat - (n - 1)) * g;
    }
    const i = Math.floor(beat);
    const f = beat - i;
    return beats[i].time + f * (beats[i + 1].time - beats[i].time);
}
