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
