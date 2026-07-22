/* Slopsmith Arrangement Editor — notated rhythm-value model (pure tier).
 *
 * The symbolic note VALUE (a quarter, a dotted-eighth, a triplet member) — the
 * third quantity in the editor's time model, decoupled from onset
 * (note.time / runtime note.beat) and sounding length (note.sustain). A staccato
 * quarter and a legato quarter are the SAME value, different sustain. See
 * NOTE-VALUE-MODEL-DESIGN.md for the full model.
 *
 *   note.rhythm = {
 *     base:  1|2|4|8|16|32|64|128,          // value denominator (power of two)
 *     dots:  0|1|2,                          // augmentation dots
 *     tuplet: null | [{ n, m, group }, …],   // outer→inner NESTING; "n in the time of m"
 *     grace:  null | 'acciaccatura' | 'appoggiatura',   // zero notated span
 *   }
 *
 * ABSENT rhythm ("no authored value") means "derive best-fit for the notation
 * lens" — the mirror of how string+fret are performance truth and pitch is
 * DERIVED (position.js): the machine proposes, the human pins. `note.rhythm` is a
 * runtime field like `note.beat`: it never rides the seconds-only note wire
 * (stripped in src/tempo.js `_stripBeat`); authored values persist later via the
 * feedpak §7.6 notation side-file, never the note dict.
 *
 * Pure: imports nothing, reads no `S`, touches no DOM. Every export is total and
 * returns an honest `null`/`NaN` rather than guessing — a confidently-wrong value
 * is worse than an honest gap. Works in the BEAT domain (not seconds) so the
 * seconds cache's ms-rounding can never push a value out of tolerance.
 */

// Value denominators we represent (a whole note down to a 128th). Any power of
// two; 128 is the engraving-grade floor (NOTE-VALUE-MODEL-DESIGN §10-A).
export const RHYTHM_BASES = [1, 2, 4, 8, 16, 32, 64, 128];

// Tuplets the best-fit search will PROPOSE when asked (opts.allowTuplets). An
// explicit tuplet context (opts.tuplet) is always honored regardless.
export const COMMON_TUPLETS = [
    { n: 3, m: 2 }, { n: 5, m: 4 }, { n: 6, m: 4 }, { n: 7, m: 4 }, { n: 9, m: 8 },
];

const _TOL = 1e-6;   // whole-note-fraction tolerance for an "exact" match

// ── absence / identity ──────────────────────────────────────────────

// "No authored notated value." Absence is meaningful (derive-best-fit), so it is
// preserved distinctly from an empty object everywhere (commands snapshot it, the
// chord field-mapper omits the key rather than writing rhythm:undefined).
export function rhythmIsAbsent(note) {
    return !note || note.rhythm == null;
}

// Deep clone — value is never shared between notes (the bend_values aliasing bug:
// two notes sharing one mutable structure edit each other). null passes through.
export function cloneRhythm(r) {
    if (r == null) return null;
    return {
        base: r.base,
        dots: r.dots || 0,
        tuplet: Array.isArray(r.tuplet)
            ? r.tuplet.map(t => ({ n: t.n, m: t.m, group: t.group }))
            : null,
        grace: r.grace || null,
    };
}

export function rhythmEquals(a, b) {
    if (a == null || b == null) return a == null && b == null;
    if (a.base !== b.base) return false;
    if ((a.dots || 0) !== (b.dots || 0)) return false;
    if ((a.grace || null) !== (b.grace || null)) return false;
    const ta = Array.isArray(a.tuplet) ? a.tuplet : [];
    const tb = Array.isArray(b.tuplet) ? b.tuplet : [];
    if (ta.length !== tb.length) return false;
    for (let i = 0; i < ta.length; i++) {
        if (ta[i].n !== tb[i].n || ta[i].m !== tb[i].m) return false;
    }
    return true;
}

// ── magnitude ───────────────────────────────────────────────────────

// Product of m/n over the (possibly nested) tuplet array; 1 when straight. A
// malformed member yields NaN so callers reject it rather than mis-size a note.
export function tupletFactor(r) {
    if (!r || !Array.isArray(r.tuplet) || !r.tuplet.length) return 1;
    let f = 1;
    for (const t of r.tuplet) {
        const n = Number(t.n), m = Number(t.m);
        if (!(n > 0) || !(m > 0)) return NaN;
        f *= m / n;
    }
    return f;
}

// Fraction of a WHOLE note this value occupies. Grace = 0 (zero notated span, the
// one case where notated value and sounding length must diverge).
export function valueWholeFraction(r) {
    if (!r || !(r.base > 0)) return NaN;
    if (r.grace) return 0;
    const dots = r.dots || 0;
    const dotMul = 2 - Math.pow(2, -dots);   // 1, 1.5, 1.75 for 0 / 1 / 2 dots
    return (1 / r.base) * dotMul * tupletFactor(r);
}

// Length in RULER beats, where one beat is one meter-denominator unit (`den` —
// an eighth in x/8). This is the note's rhythmic SLOT; sustain is the free ring.
export function valueToBeats(r, den) {
    const f = valueWholeFraction(r);
    return Number.isFinite(f) ? f * den : NaN;
}

// ── best-fit (derive-when-absent, quantize, import inference) ────────

// Simplest {base,dots} whose whole-fraction ≈ target, within tol. Prefers fewer
// dots (then the match nearest target). Returns null when nothing matches.
function _fitPlain(targetFrac, tol) {
    let best = null;
    for (const base of RHYTHM_BASES) {
        for (const dots of [0, 1, 2]) {
            const f = (1 / base) * (2 - Math.pow(2, -dots));
            if (Math.abs(f - targetFrac) <= tol && (!best || dots < best.dots)) {
                best = { base, dots, tuplet: null, grace: null };
            }
        }
    }
    return best;
}

// Best-fit a beat-span to a notated value (or a tied sequence). Returns
// `{ rhythm, ties }` (ties = the subsequent tied values; [] when one value
// suffices) or `null` when the span can't be represented within tolerance — the
// honest-gap signal, the mirror of `_suggestPositionPure` returning null.
//
// Order of preference: an explicit tuplet CONTEXT (opts.tuplet), then a single
// straight/dotted value, then a proposed common tuplet (opts.allowTuplets), then
// a greedy largest-first tie-decomposition. Broad, position-aware tuplet/beam
// splitting (which needs the onset's bar phase) lands with the live-tab and
// import-inference slices; this is the span-only magnitude fit.
export function beatsToValue(spanBeats, den, opts = {}) {
    if (!(spanBeats > 0) || !(den > 0)) return null;
    const tolBeats = opts.tolBeats != null ? opts.tolBeats : _TOL * den;
    const tolFrac = tolBeats / den;
    const targetFrac = spanBeats / den;

    // 1) explicit tuplet context: fit base/dots inside it
    if (Array.isArray(opts.tuplet) && opts.tuplet.length) {
        const tf = tupletFactor({ tuplet: opts.tuplet });
        if (Number.isFinite(tf) && tf > 0) {
            const plain = _fitPlain(targetFrac / tf, tolFrac / tf);
            if (plain) {
                return { rhythm: { ...plain, tuplet: opts.tuplet.map(t => ({ ...t })) }, ties: [] };
            }
        }
    }

    // 2) a single straight/dotted value
    const single = _fitPlain(targetFrac, tolFrac);
    if (single) return { rhythm: single, ties: [] };

    // 3) a proposed common tuplet (only when the caller opts in)
    if (opts.allowTuplets) {
        for (const tp of COMMON_TUPLETS) {
            const plain = _fitPlain((targetFrac * tp.n) / tp.m, tolFrac);
            if (plain) {
                const group = opts.group != null ? opts.group : 1;
                return { rhythm: { ...plain, tuplet: [{ n: tp.n, m: tp.m, group }] }, ties: [] };
            }
        }
    }

    // 4) greedy tie-decomposition over the straight/dotted ladder, largest-first
    const ladder = [];
    for (const base of RHYTHM_BASES) {
        for (const dots of [2, 1, 0]) {
            ladder.push({ base, dots, frac: (1 / base) * (2 - Math.pow(2, -dots)) });
        }
    }
    ladder.sort((a, b) => b.frac - a.frac);
    const pieces = [];
    let rem = targetFrac;
    let guard = 0;
    while (rem > tolFrac && guard++ < 32) {
        const step = ladder.find(l => l.frac <= rem + tolFrac);
        if (!step) break;
        pieces.push({ base: step.base, dots: step.dots, tuplet: null, grace: null });
        rem -= step.frac;
    }
    if (Math.abs(rem) <= tolFrac && pieces.length) {
        return { rhythm: pieces[0], ties: pieces.slice(1) };
    }
    return null;   // unquantizable within tolerance
}

// ── interchange projection (GP / MIDI / MusicXML) ───────────────────

// Absolute-tick length. `lossy` when the exact tick count isn't an integer (a
// septuplet over 960 ppq). A handoff artifact for export, NOT the stored form.
export function valueToTicks(r, ppq = 960) {
    const f = valueWholeFraction(r);
    if (!Number.isFinite(f)) return { ticks: NaN, lossy: true };
    const exact = f * 4 * ppq;                  // a whole note is 4 quarters
    const ticks = Math.round(exact);
    return { ticks, lossy: Math.abs(exact - ticks) > 1e-9 };
}

// Inverse: a single value whose length is `ticks`, or null (needs a tie / is
// unquantizable). ppq ticks = one quarter, so ticks/ppq is a quarter-count and
// the fit runs in quarter-denominated beats (den = 4).
export function ticksToValue(ticks, ppq = 960) {
    if (!(ticks > 0) || !(ppq > 0)) return null;
    const fit = beatsToValue(ticks / ppq, 4, { allowTuplets: true });
    return fit && !fit.ties.length ? fit.rhythm : null;
}

// ── bar accounting ──────────────────────────────────────────────────

// Sum the notated beat-lengths of a bar's rhythms; `complete` is whether they
// fill the bar's capacity (when given). The model twin of alphatex's "bars sum
// exactly" render guarantee — feeds the over/under-full-bar lint.
export function barValueSum(rhythms, den, capacityBeats) {
    let sumBeats = 0;
    for (const r of rhythms || []) {
        const b = valueToBeats(r, den);
        if (Number.isFinite(b)) sumBeats += b;
    }
    const complete = capacityBeats != null
        ? Math.abs(sumBeats - capacityBeats) <= _TOL * den
        : undefined;
    return { sumBeats, complete };
}
