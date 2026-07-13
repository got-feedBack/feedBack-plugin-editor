/* Slopsmith Arrangement Editor — fretboard position math.
 *
 * Where a pitch can be played, and which of those places to prefer. Pure
 * arithmetic over an arrangement's open-string pitches, tuning and capo: no `S`,
 * no DOM. Three layers, each the inverse or the selector of the one below:
 *
 *   _absolutePitch          string+fret → pitch, WITHOUT the capo (see below)
 *   _enumerateFrettedPositionsPure  pitch → every {string, fret} that sounds it
 *   _suggestPositionPure    pick one, given the anchor, the previous note and
 *                           which strings are already ringing
 *
 * `_absolutePitch` deliberately omits the capo: it only ever compares two
 * pitches on ONE arrangement, where the capo cancels. Anything that needs the
 * real sounding pitch uses `_soundingPitchPure` (src/lanes.js), which adds the
 * capo exactly once — composing the two can therefore never double-count it.
 */


// tuning offsets.  `openMidi[s]` is the standard open-string pitch for
// string `s`; `arr.tuning[s]` is the per-string semitone offset from
// standard (e.g. −2 for Drop D on string 0, 0 for standard).
// DELIBERATELY OMITS CAPO: string-moves compare two pitches on the same
// arrangement, so the capo cancels on both sides. Anything that needs the
// real SOUNDING pitch (in-key highlight, future guide synthesis) must use
// `_soundingPitchPure` in src/lanes.js, which adds the capo exactly once —
// adding it here too would double-count it in code that composes the two.
export function _absolutePitch(openMidi, tuning, stringIdx, fret) {
    const offset = (Array.isArray(tuning) && tuning[stringIdx] !== undefined)
        ? (Number(tuning[stringIdx]) || 0)
        : 0;
    return openMidi[stringIdx] + offset + fret;
}

// Every {string, fret} on this arrangement that SOUNDS the same pitch as
// (stringIdx, fret) — the cycle set for pitch-preserving position moves
// (VA.5). The pitch comparison deliberately uses the capo-less absolute
// pitch: both sides live on the same arrangement so the capo cancels —
// the same pairing _absolutePitch/_soundingPitchPure document (#115);
// adding the capo to both sides would change nothing, adding it to one
// would be the double-count bug those comments warn about. Candidates are
// integer frets 0–24 on existing strings, ordered low string → high; the
// note's own position is always a member, so steppers walk the list order
// and wrap. Returns [] when the source position is malformed.
export function _cyclePositionCandidatesPure(openMidi, tuning, laneCount, stringIdx, fret) {
    if (!Array.isArray(openMidi) || openMidi[stringIdx] === undefined) return [];
    const f = Number(fret);
    if (!Number.isInteger(f)) return [];
    const offAt = s => (Array.isArray(tuning) && tuning[s] !== undefined)
        ? (Number(tuning[s]) || 0)
        : 0;
    const pitch = openMidi[stringIdx] + offAt(stringIdx) + f;
    const out = [];
    for (let s = 0; s < laneCount; s++) {
        if (openMidi[s] === undefined) continue;
        const tf = pitch - openMidi[s] - offAt(s);
        if (Number.isInteger(tf) && tf >= 0 && tf <= 24) out.push({ string: s, fret: tf });
    }
    return out;
}

// One cycle step through the candidate list: +1 = next-higher string
// index (wrapping), −1 = previous. Null = nothing to do — the note has a
// single valid position, or its current position isn't in the list
// (corrupt data; refusing beats guessing).
export function _cycleStepPure(candidates, curString, curFret, direction) {
    if (!Array.isArray(candidates) || candidates.length < 2) return null;
    const i = candidates.findIndex(c => c.string === curString && c.fret === curFret);
    if (i < 0) return null;
    const len = candidates.length;
    return candidates[(i + (direction > 0 ? 1 : -1) + len) % len];
}

// Suggest-position resolver (design V4 / V13.3): pick a {string, fret} for a
// SOUNDING pitch added or pitch-moved in the piano roll for a fretted part —
// the ONE writer that lets the read-only roll author fretted notes without a
// view switch. The machine ENUMERATES; it only auto-decides when the choice is
// unambiguous, and otherwise REFUSES (returns resolved:null + a reason +
// the candidate list) so the UI flips to an explicit confirm popover.
//
// Enumerate every playable {string, fret} for `pitch`, capo-aware (the exact
// inverse of _soundingPitchPure: fret = pitch − openMidi[s] − tuning[s] − capo,
// valid as an integer in [0,24]). Ordered low string → high.
export function _enumerateFrettedPositionsPure(pitch, openMidi, tuning, capo) {
    const out = [];
    if (!Array.isArray(openMidi) || !Number.isFinite(pitch)) return out;
    const off = s => (Array.isArray(tuning) && tuning[s] !== undefined) ? (Number(tuning[s]) || 0) : 0;
    const cap = Number(capo) || 0;
    for (let s = 0; s < openMidi.length; s++) {
        if (openMidi[s] === undefined) continue;
        const fret = pitch - openMidi[s] - off(s) - cap;
        if (Number.isInteger(fret) && fret >= 0 && fret <= 24) out.push({ string: s, fret });
    }
    return out;
}

// The fret-hand anchor window active at `time`: the last anchor at/ before it
// (notes before the first anchor borrow the first anchor's window). Anchors are
// { time, fret, width } with no explicit end — each governs until the next.
export function _activeAnchorAtPure(anchorList, time) {
    if (!Array.isArray(anchorList) || !anchorList.length) return null;
    let active = null, earliest = null;
    for (const a of anchorList) {
        if (!a || !Number.isFinite(a.time)) continue;
        if (!earliest || a.time < earliest.time) earliest = a;
        if (a.time <= time + 1e-6 && (!active || a.time >= active.time)) active = a;
    }
    return active || earliest;
}

// The policy. `occupiedStrings` is the set of strings already sounding at this
// time (a note can't share a string with another at the same instant). Success
// order: (a) inside the active anchor window on a free string, (b) nearest the
// previous note's hand position (least fret travel), (c) lowest-fret then
// lowest-string. Refuse (resolved:null) when reachable only OUTSIDE the window,
// when open-vs-fretted is a real articulation choice, when the only viable
// string is occupied, or when out of range.
export function _suggestPositionPure(pitch, time, prevNote, anchorList, occupiedStrings, ctx) {
    const c = ctx || {};
    const candidates = _enumerateFrettedPositionsPure(pitch, c.openMidi, c.tuning, c.capo);
    if (!candidates.length) return { resolved: null, reason: 'out-of-range', candidates };
    const occ = occupiedStrings instanceof Set ? occupiedStrings : new Set(occupiedStrings || []);
    const free = candidates.filter(p => !occ.has(p.string));
    if (!free.length) return { resolved: null, reason: 'string-occupied', candidates };
    // Eligible = free candidates that are open (fret 0 needs no hand position)
    // or inside the active anchor window [fret, fret+width). No anchor ⇒ the
    // window is unconstrained (every free candidate is eligible).
    const anchor = _activeAnchorAtPure(anchorList, time);
    let eligible = free;
    if (anchor && Number.isFinite(anchor.fret)) {
        const lo = anchor.fret;
        const hi = anchor.fret + (Number.isFinite(anchor.width) ? anchor.width : 4);
        eligible = free.filter(p => p.fret === 0 || (p.fret >= lo && p.fret < hi));
        if (!eligible.length) return { resolved: null, reason: 'outside-anchor-window', candidates };
    }
    // Open vs fretted, both playable here → a real articulation choice; refuse.
    if (eligible.some(p => p.fret === 0) && eligible.some(p => p.fret > 0)) {
        return { resolved: null, reason: 'open-vs-fretted', candidates };
    }
    const prevFret = prevNote && Number.isFinite(prevNote.fret) ? prevNote.fret : null;
    const best = eligible.slice().sort((a, b) => {
        if (prevFret !== null) {
            const d = Math.abs(a.fret - prevFret) - Math.abs(b.fret - prevFret);
            if (d) return d;                      // (b) least fret travel
        }
        if (a.fret !== b.fret) return a.fret - b.fret;   // (c) lowest fret
        return a.string - b.string;                       //     then lowest string
    })[0];
    return { resolved: best, reason: null, candidates };
}

/* @pure:chord-grip:start */
// Resolve a SIMULTANEOUS cluster of notes to a coherent fret-hand GRIP, instead
// of resolving each note greedily (per-note _suggestPositionPure spreads a chord
// across the neck until the playability lint scolds the stretch). Given each
// note's sounding `pitch`, enumerate its playable positions, then choose ONE
// {string, fret} per note — all on DISTINCT strings — that MINIMISES the fretted
// span (open strings, fret 0, are free and don't count), pulled toward the hand
// (prevFret, else the anchor). Only a grip whose fretted span fits `cfg.maxSpan`
// (the lint's window + tolerance) is returned; otherwise null, so the caller
// leaves the cluster to the per-note path (still lint-flagged) rather than
// writing a different unplayable spread.
//
//   cluster      [{ idx, pitch }]  the simultaneous notes (idx = caller's key)
//   ctx          { openMidi, tuning, capo }
//   cfg          { anchorFret|null, window, maxSpan }
//   prevFret     the previous note's fret (hand reference) or null
//   occByOthers  strings already sounding from NON-cluster notes at this instant
//
// Returns { assignments: [{ idx, string, fret }], span } (assignments in the
// input cluster order) or null. Deterministic: the search order and every
// tie-break are pinned, so the same cluster always resolves to the same grip.
export function _resolveChordGripPure(cluster, ctx, cfg, prevFret, occByOthers) {
    const items = (Array.isArray(cluster) ? cluster : []).filter(c => c && Number.isFinite(c.pitch));
    if (!items.length) return null;
    const c = ctx || {};
    const cf = cfg || {};
    const occ = occByOthers instanceof Set ? occByOthers : new Set(occByOthers || []);
    const anchorFret = Number.isFinite(cf.anchorFret) ? cf.anchorFret : null;
    const window = Number.isFinite(cf.window) && cf.window > 0 ? cf.window : 4;
    const maxSpan = Number.isFinite(cf.maxSpan) && cf.maxSpan >= 0 ? cf.maxSpan : window + 1;

    // Per-note eligible candidates: a free string, inside the hand window (open
    // string fret 0 is always allowed — it needs no hand position). Bail if any
    // note has nowhere to go — the whole cluster is left to the per-note path.
    const perNote = [];
    for (const it of items) {
        const cands = _enumerateFrettedPositionsPure(it.pitch, c.openMidi, c.tuning, c.capo)
            .filter(p => !occ.has(p.string))
            .filter(p => anchorFret === null || p.fret === 0 || (p.fret >= anchorFret && p.fret < anchorFret + window));
        if (!cands.length) return null;
        perNote.push({ idx: it.idx, cands });
    }
    // Assign the fewest-choice notes first (fail fast, and pins the walk order).
    const order = perNote.map((_, k) => k).sort((a, b) => perNote[a].cands.length - perNote[b].cands.length);
    const ref = (prevFret !== null && Number.isFinite(prevFret)) ? prevFret : anchorFret;

    const frettedSpan = (picks) => {
        const frets = picks.map(p => p.fret).filter(f => f > 0);
        return frets.length ? Math.max(...frets) - Math.min(...frets) : 0;
    };
    const scoreOf = (picks) => {
        const frets = picks.map(p => p.fret).filter(f => f > 0);
        const span = frets.length ? Math.max(...frets) - Math.min(...frets) : 0;
        const travel = ref !== null ? picks.reduce((s, p) => s + (p.fret > 0 ? Math.abs(p.fret - ref) : 0), 0) : 0;
        const maxFret = frets.length ? Math.max(...frets) : 0;
        const strSum = picks.reduce((s, p) => s + p.string, 0);
        return [span, travel, maxFret, strSum];
    };
    const lt = (a, b) => {
        for (let i = 0; i < a.length; i++) { if (a[i] !== b[i]) return a[i] < b[i]; }
        return false;
    };

    let best = null;               // { picks, score } — picks parallel to `order`
    const usedStr = new Set();
    const chosen = [];
    const search = (oi) => {
        // Prune: the fretted span only grows, so a partial over the ceiling (or
        // already worse than the best full grip) can never win.
        const ps = frettedSpan(chosen);
        if (ps > maxSpan) return;
        if (best && ps > best.score[0]) return;
        if (oi === order.length) {
            const score = scoreOf(chosen);
            if (score[0] <= maxSpan && (!best || lt(score, best.score))) {
                best = { picks: chosen.slice(), score };
            }
            return;
        }
        for (const cand of perNote[order[oi]].cands) {
            if (usedStr.has(cand.string)) continue;
            usedStr.add(cand.string); chosen.push(cand);
            search(oi + 1);
            chosen.pop(); usedStr.delete(cand.string);
        }
    };
    search(0);
    if (!best) return null;
    const byIdx = new Map();
    order.forEach((k, ci) => byIdx.set(perNote[k].idx, best.picks[ci]));
    return {
        assignments: items.map(it => ({ idx: it.idx, string: byIdx.get(it.idx).string, fret: byIdx.get(it.idx).fret })),
        span: best.score[0],
    };
}
/* @pure:chord-grip:end */

/* @pure:suggest-fingers:start */
// The fret-hand finger for a note at `fret`, hand anchored at `anchorFret` with a
// `width`-fret span (default 4). Open string (fret 0) → -1 (none — no fretting
// finger). Inside the window [anchorFret, anchorFret+width) → one finger per
// fret, index (1) at the anchor fret, clamped to 1..4. Outside the reachable
// window, or with no hand position → null (refuse: a different hand position owns it).
export function _suggestFingerForFretPure(fret, anchorFret, width) {
    if (!Number.isFinite(fret)) return null;
    if (fret <= 0) return -1;                                   // open string → none
    if (!Number.isFinite(anchorFret)) return null;              // no hand position → refuse
    const span = Number.isFinite(width) && width > 0 ? width : 4;
    const off = fret - anchorFret;
    if (off < 0 || off >= span) return null;                    // outside the hand → refuse
    return Math.min(4, off + 1);                                // 1..4
}

// Map notes → suggested fret_finger. `items`: [{ idx, fret, anchorFret, width }].
// Returns [{ idx, value }] for every note the rule can finger (open strings → -1
// none, in-window frets → 1..4); notes it refuses (outside the hand span, or no
// anchor) are OMITTED so their existing marks are left untouched. Pure.
export function _suggestFingersPure(items) {
    const out = [];
    for (const it of (Array.isArray(items) ? items : [])) {
        const v = _suggestFingerForFretPure(it.fret, it.anchorFret, it.width);
        if (v !== null) out.push({ idx: it.idx, value: v });
    }
    return out;
}
/* @pure:suggest-fingers:end */
