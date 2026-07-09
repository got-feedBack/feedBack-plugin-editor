/* Slopsmith Arrangement Editor — string/lane model.
 *
 * How many strings the active arrangement has, what those strings are called,
 * how a string index maps to a display lane, and what colour it paints. Reads
 * `S`; no DOM. Mirrors lib/song.py:arrangement_string_count so the editor and
 * the highway agree on string counts.
 */

import { S } from './state.js';

export const MAX_LANES = 8;

// Cached per-frame alongside `lanes()` to avoid re-allocating
// `laneLabels()` per note inside drawNotes / drawLabels.
// A plain `let` cannot be shared across an ES module boundary — import bindings
// are read-only — and draw() (plus the marquee) must seed this cache from
// main.js. So the three scalars live on one exported container, the same shape
// the stems pilot used for its SH/ST lifts.
export const LC = {
    active: false,   // was _lanesCacheActive
    value: 6,        // was _lanesCacheValue
    labels: null,    // was _laneLabelsCacheValue
};

// Highway colours, keyed by pitch *label* (the same labels `laneLabels()`
// emits) so colours stay locked to a string's note regardless of the
// arrangement's string count. A 4-string bass G/D/A/E gets
// orange/blue/yellow/red just like the same pitches on a 6-string
// guitar. Extended-range strings (7/8-guitar's low B/F#, 6-bass's high C)
// reuse the dusty-pink/steel-blue accents.
const STRING_LABEL_COLORS = {
    'E':  '#FC3A51', // low E   — red
    'A':  '#FFC600', // A       — yellow
    'D':  '#3FAAFF', // D       — blue
    'G':  '#FF8A00', // G       — orange
    'B':  '#58D263', // B       — green (guitar string 4)
    'e':  '#C473FF', // high e  — purple
    'B↓': '#E07A8A', // 7-string low B          — dusty pink
    'C↑': '#E07A8A', // 6-string bass high C    — dusty pink
    'F#↓': '#8AA0B8',// 8-string low F#         — steel blue
};

export function colorForLane(l) {
    // `laneLabels()` is low → high (string-index order); strToLane
    // converts string index → lane. During draw() the cache is hot
    // (set once per frame), so per-note colorForLane reads a single
    // index rather than re-running the label computation.
    const labels = LC.active && LC.labels
        ? LC.labels
        : laneLabels();
    const lbl = labels[laneToStr(l)];
    return STRING_LABEL_COLORS[lbl] || '#888';
}

function isBassArr() {
    if (!S.arrangements.length) return false;
    const arr = S.arrangements[S.currentArr];
    return !!arr && /bass/i.test(arr.name || '');
}

// Active arrangement string count. Mirrors lib/song.py:arrangement_string_count
// so the editor agrees with the highway: combine name-based default (Bass→4,
// else→6), tuning length when ≠6 (length 6 is RS-schema padding), an
// explicit `_extendedStrings` counter that AddStringCmd / RemoveStringCmd
// bump (disambiguates the bass-with-tuning-length-6 case — could be
// either a 4-string padded or a genuine 6-string), chord-template width,
// and the max note-string index. Clamped to [4, MAX_LANES].
//
// `lanes()` is O(N) over notes+chords and is on the hot path (strToLane /
// laneToStr / yToStr are called per-note inside drawNotes and per-mousemove
// in hit-testing). To avoid the resulting O(N²) per frame on large
// arrangements, draw() seeds a per-frame cache that this function reads
// from when active. Mutations outside the draw frame still recompute.
// Seed `_extendedStrings` from each arrangement's tuning length. Two
// modes:
//   * Always seed when `tuningLen > 6` — RS-XML never pads past 6, so
//     any length above that is an unambiguous extended-range signal
//     (string6+ attrs were emitted). Applies to all sources including
//     a previously-extended archive reloaded in this session.
//   * When `authoritativeLength` is true (sloppak / GP-imported create-
//     mode), also seed when `tuningLen > baseline` even if ≤ 6 —
//     those sources don't apply RS padding, so a 6-slot bass tuning
//     genuinely means 6-string bass. Skipping this path for archive
//     loads preserves the standard bass-padded-to-6 → 4 inference.
export function _seedExtendedStringsFromTuning(arrangements, authoritativeLength) {
    for (const arr of arrangements || []) {
        if (typeof arr._extendedStrings === 'number') continue;  // already set
        const isBass = /bass/i.test(arr.name || '');
        const baseline = isBass ? 4 : 6;
        const tuningLen = Array.isArray(arr.tuning) ? arr.tuning.length : baseline;
        if (tuningLen > 6) {
            arr._extendedStrings = tuningLen - baseline;
        } else if (authoritativeLength && tuningLen > baseline
                   && !(isBass && tuningLen === 6)) {
            // A length-EXACTLY-6 bass tuning is ambiguous — RS-converted
            // sloppaks pad a 4-string bass to 6 zero-slots, identical on the
            // wire to a genuine 6-string bass. Never infer 6-string from it
            // (matches core arrangement_string_count, which ignores len==6);
            // let the actual note/chord string indices decide. Without this a
            // padded 4-string bass feedpak is read as 6-string, so every note
            // shifts up a lane and low-E renders on the low-B lane.
            arr._extendedStrings = tuningLen - baseline;
        }
    }
}

export function _stringCountFor(arr) {
    if (!arr) return 6;
    const isBass = /bass/i.test(arr.name || '');
    const baseline = isBass ? 4 : 6;
    // User-added strings via the Strings modal — authoritative even
    // when tuning happens to be ambiguous length 6 (the standard RS-XML
    // bass padding length).
    let n = baseline + Math.max(0, arr._extendedStrings || 0);
    const tuningLen = Array.isArray(arr.tuning) ? arr.tuning.length : 6;
    if (tuningLen !== 6) n = Math.max(n, tuningLen);
    // Chord-template signal: count the highest *used* fret slot (not
    // the raw array length). RS XML pads chord_templates to width 6
    // unconditionally, so a 4-string bass arrangement also has
    // ct.frets.length === 6 with fret[4..5] === -1. Looking at the
    // last non(-1) index instead means a 4-string bass with no notes
    // on string 4/5 reads as 4 (correct), and a real 6/7-string
    // template that played notes on those high strings still bumps
    // `n` up.
    for (const ct of arr.chord_templates || []) {
        if (Array.isArray(ct.frets)) {
            for (let i = ct.frets.length - 1; i >= 0; i--) {
                if (ct.frets[i] !== -1) {
                    if (i + 1 > n) n = i + 1;
                    break;
                }
            }
        }
    }
    for (const note of arr.notes || []) {
        if (note.string + 1 > n) n = note.string + 1;
    }
    for (const ch of arr.chords || []) {
        for (const cn of ch.notes || []) {
            if (cn.string + 1 > n) n = cn.string + 1;
        }
    }
    return Math.max(4, Math.min(MAX_LANES, n));
}
export function lanes() {
    if (LC.active) return LC.value;
    if (!S.arrangements.length) return 6;
    return _stringCountFor(S.arrangements[S.currentArr]);
}
// Build display labels in RS string-index order (low → high). Extended-range
// instruments add strings at the low end (7-string guitar adds low B below
// low E; 5-string bass adds low B below low E), and 6-string bass adds high
// C on top. The arrow notation marks those non-standard strings.
export function laneLabels() {
    const L = lanes();
    if (isBassArr()) {
        // 4-string standard: E A D G
        // 5-string: B↓ E A D G  (low B added)
        // 6-string: B↓ E A D G C (low B + high C added)
        if (L <= 4) return ['E', 'A', 'D', 'G'].slice(0, L);
        if (L === 5) return ['B↓', 'E', 'A', 'D', 'G'];
        return ['B↓', 'E', 'A', 'D', 'G', 'C↑'].slice(0, L);
    }
    // Guitar standard: E A D G B e (low → high)
    // 7-string: B↓ E A D G B e  (low B added)
    // 8-string: F#↓ B↓ E A D G B e (low F# and low B added)
    if (L <= 6) return ['E', 'A', 'D', 'G', 'B', 'e'].slice(0, L);
    if (L === 7) return ['B↓', 'E', 'A', 'D', 'G', 'B', 'e'];
    return ['F#↓', 'B↓', 'E', 'A', 'D', 'G', 'B', 'e'].slice(0, L);
}

export function strToLane(s) { return (lanes() - 1) - s; }
export function laneToStr(l) { return (lanes() - 1) - l; }
