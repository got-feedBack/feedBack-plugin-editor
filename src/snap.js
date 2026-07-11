/* Slopsmith Arrangement Editor — snap grid model.
 *
 * Pure: the snap resolutions the toolbar offers, and the arithmetic that
 * turns a chosen resolution into beat subdivisions. No DOM, no editor state.
 */

export const SNAP_OPTIONS = Object.freeze([
    { label: '1/1', value: 1, subdivisions: 1 },
    { label: '1/2', value: 1 / 2, subdivisions: 2 },
    { label: '1/3T', value: 1 / 3, subdivisions: 3 },
    { label: '1/4', value: 1 / 4, subdivisions: 4 },
    { label: '1/6T', value: 1 / 6, subdivisions: 6 },
    { label: '1/8', value: 1 / 8, subdivisions: 8 },
    { label: '1/12T', value: 1 / 12, subdivisions: 12 },
    { label: '1/16', value: 1 / 16, subdivisions: 16 },
    { label: '1/24T', value: 1 / 24, subdivisions: 24 },
    { label: '1/32', value: 1 / 32, subdivisions: 32 },
    { label: '1/48T', value: 1 / 48, subdivisions: 48 },
    { label: '1/64', value: 1 / 64, subdivisions: 64 },
    { label: '1/96T', value: 1 / 96, subdivisions: 96 },
]);
export const SNAP_VALUES = SNAP_OPTIONS.map(opt => opt.value);

export function _editorSnapOptionLabelsPure() {
    return SNAP_OPTIONS.map(opt => opt.label);
}

export function _editorSnapSubdivisionsPure(snapValue) {
    if (!snapValue) return 0;
    return Math.max(1, Math.round(1 / snapValue));
}

export function _editorEffectiveSnapValuePure(snapEnabled, snapValue) {
    return snapEnabled ? snapValue : 0;
}

// ── Swing (workspace-shell D2, charrette §1.6) ───────────────────────
// Swing is a BEAT-DOMAIN phase offset on the snap grid, fed through the
// tempo-map converter like every other musical-time quantity:
//     snap(t) = timeOf(_swingQuantizeBeatPure(beatOf(t), subs, pct))
// Never a seconds nudge — expressed as a beat coordinate, a swung note keeps
// its groove through a tempo flex exactly like a straight one (§1.3).
//
// Model: swing displaces the OFF subdivision of each consecutive pair, and a
// pair spans 2/subs beats, so pairs align to the beat for every even
// subdivision (1/8 swing at subs=2, 1/16 swing at subs=4, …). The off
// candidate sits at pct% through the pair instead of 50%. Triplet grids
// (odd subs) are already swung by construction — swing is a no-op there,
// and 50% IS the straight grid, bit-identical to the plain rounding path.
export const SWING_PRESETS = Object.freeze([
    { label: 'Straight', pct: 50 },
    { label: 'Swing 54%', pct: 54 },
    { label: 'Swing 58%', pct: 58 },
    { label: 'Swing 62%', pct: 62 },
]);

export function _swingQuantizeBeatPure(beta, subs, swingPct) {
    if (!Number.isFinite(beta) || !(subs >= 1)) return beta;
    const straight = () => Math.round(beta * subs) / subs;
    const pct = Number(swingPct);
    // Straight, out-of-band (a swing outside (50,75] is either meaningless or
    // a corrupt pref — never let it fling notes), or a non-swingable grid:
    // odd subs can't pair, and the triplet family (subs divisible by 3 —
    // 1/3T, 1/6T, 1/12T, …) is already swung by construction.
    if (!Number.isFinite(pct) || pct <= 50 || pct > 75) return straight();
    if (subs % 2 !== 0 || subs % 3 === 0) return straight();
    const pairSpan = 2 / subs;              // beats per on/off pair
    const u = beta / pairSpan;              // position in pair units
    const base = Math.floor(u);
    const s = pct / 100;                    // the off candidate, in pair units
    let bestU = base, bestD = Math.abs(u - base);
    for (const cand of [base + s, base + 1]) {
        const d = Math.abs(u - cand);
        if (d < bestD) { bestU = cand; bestD = d; }
    }
    return bestU * pairSpan;
}
