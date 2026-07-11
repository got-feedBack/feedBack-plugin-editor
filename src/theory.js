/* Slopsmith Arrangement Editor — pitch theory.
 *
 * Pure: scale membership, Krumhansl–Schmuckler key detection, and
 * scale-degree labels/colours. Display/teaching only — never grades.
 * No DOM, no editor state.
 */

// ── Pitch-class names ───────────────────────────────────────────────
export const PIANO_NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export const PIANO_NOTE_NAMES_FLAT = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

// ── Enharmonic spelling preference ──────────────────────────────────
// A key signature spells its accidentals one way: F major writes B♭, never
// A♯. The preference is the RELATIVE MAJOR's position on the circle of
// fifths, so each mode maps to the major key whose signature it borrows
// (semitones ABOVE the mode's tonic; e.g. dorian is degree 2 → +10).
// `chromatic` has no signature and is deliberately absent → sharps.
const _RELATIVE_MAJOR_OFFSET = {
    major: 0, lydian: 7, mixolydian: 5, dorian: 10, phrygian: 8,
    minor: 3, harmonic_minor: 3, melodic_minor: 3, locrian: 1,
    major_pentatonic: 0, minor_pentatonic: 3, blues: 3,
};
// Db, Eb, F, Ab, Bb majors carry flats. F#/Gb (pc 6) stays SHARP because the
// key picker's tonic list is sharp-named — the label must match the choice.
const _FLAT_MAJOR_PCS = [1, 3, 5, 8, 10];
export function _keyPrefersFlatsPure(tonicPc, scaleName) {
    const t = Number(tonicPc);
    const off = _RELATIVE_MAJOR_OFFSET[scaleName];
    if (!Number.isFinite(t) || off === undefined) return false;
    return _FLAT_MAJOR_PCS.includes(((Math.round(t) + off) % 12 + 12) % 12);
}
// The name table an editorKey ({tonic, scale} or null) spells with. Null /
// malformed keys read as "no key" → the sharp table, today's behavior.
export function _noteNamesForKeyPure(key) {
    return key && _keyPrefersFlatsPure(key.tonic, key.scale)
        ? PIANO_NOTE_NAMES_FLAT : PIANO_NOTE_NAMES;
}

// Scale/mode membership as tonic-relative pitch-class sets (semitones above
// the tonic). Used by the piano-roll in-key highlight; the harmony charrette
// seat's table. `chromatic` includes everything (so a chromatic/atonal region
// shades nothing). Genre span: major/minor + modes cover pop→classical→prog;
// harmonic/melodic minor + pentatonic/blues cover the rest.
export const SCALE_INTERVALS = {
    major:            [0, 2, 4, 5, 7, 9, 11],
    minor:            [0, 2, 3, 5, 7, 8, 10],   // natural minor / aeolian
    dorian:           [0, 2, 3, 5, 7, 9, 10],
    phrygian:         [0, 1, 3, 5, 7, 8, 10],
    lydian:           [0, 2, 4, 6, 7, 9, 11],
    mixolydian:       [0, 2, 4, 5, 7, 9, 10],
    locrian:          [0, 1, 3, 5, 6, 8, 10],
    harmonic_minor:   [0, 2, 3, 5, 7, 8, 11],
    melodic_minor:    [0, 2, 3, 5, 7, 9, 11],
    major_pentatonic: [0, 2, 4, 7, 9],
    minor_pentatonic: [0, 3, 5, 7, 10],
    blues:            [0, 3, 5, 6, 7, 10],
    chromatic:        [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
};

// Is pitch-class `pc` (0–11) in `scaleName` rooted at `tonicPc` (0–11)?
// Unknown scale or non-finite inputs → true (treat as in-key, i.e. no
// shading) so a bad state never paints the whole roll out-of-key.
export function _pcInScalePure(pc, tonicPc, scaleName) {
    const intervals = SCALE_INTERVALS[scaleName];
    if (!intervals) return true;
    const p = Number(pc), t = Number(tonicPc);
    if (!Number.isFinite(p) || !Number.isFinite(t)) return true;
    const rel = ((Math.round(p - t) % 12) + 12) % 12;
    return intervals.includes(rel);
}

// Krumhansl–Kessler key profiles — the relative weight a tonal centre gives
// each scale degree (index 0 = tonic). Used to guess a chart's key from its
// pitch-class content. Standard, well-cited values; ranking only, so their
// absolute scale doesn't matter.
export const _KK_MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
export const _KK_MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

// Best-fit key for a 12-bin pitch-class weight histogram (bin 0 = C). This is
// the Krumhansl–Schmuckler algorithm: score all 24 major/minor keys by the
// PEARSON CORRELATION of the histogram with the tonic-rotated profile, and
// return the winner as {tonic, scale, score} (`scale` is a SCALE_INTERVALS id,
// 'major' | 'minor'). Correlation (not a raw dot product) is what makes the
// comparison fair ACROSS modes — the two profiles have different magnitudes, so
// a dot product would systematically favour one; and it makes a profile score a
// perfect 1.0 against its own key. Ties break toward major (scored first).
// Returns null for an empty or perfectly flat histogram (no tonal centre), so
// the caller shows nothing rather than a bogus C major. Pure — no note/DOM.
export function _detectKeyPure(pcWeights) {
    if (!Array.isArray(pcWeights) || pcWeights.length < 12) return null;
    const x = new Array(12);
    let sum = 0, total = 0;
    for (let i = 0; i < 12; i++) {
        const w = Number(pcWeights[i]);
        const v = (Number.isFinite(w) && w > 0) ? w : 0;
        x[i] = v; sum += v; total += v;
    }
    if (total <= 0) return null;
    const xbar = sum / 12;
    let xden = 0;
    for (let i = 0; i < 12; i++) xden += (x[i] - xbar) * (x[i] - xbar);
    xden = Math.sqrt(xden);
    if (xden <= 0) return null;   // flat histogram — no tonal centre to find
    let best = null;
    const modes = [['major', _KK_MAJOR_PROFILE], ['minor', _KK_MINOR_PROFILE]];
    for (const [scale, profile] of modes) {
        const pbar = profile.reduce((a, b) => a + b, 0) / 12;
        let pden = 0;
        for (let i = 0; i < 12; i++) pden += (profile[i] - pbar) * (profile[i] - pbar);
        pden = Math.sqrt(pden);
        for (let tonic = 0; tonic < 12; tonic++) {
            let num = 0;
            for (let pc = 0; pc < 12; pc++) {
                num += (x[pc] - xbar) * (profile[((pc - tonic) % 12 + 12) % 12] - pbar);
            }
            const score = num / (xden * pden);
            if (!best || score > best.score) best = { tonic, scale, score };
        }
    }
    return best;
}
// Scale-degree label for a pitch class relative to a tonic (semitones above
// the tonic, 0 = root). Flats for the chromatic degrees (the common Nashville/
// relative convention). Display/teaching only — never grades.
export const _SCALE_DEGREE_LABELS = ['1', '♭2', '2', '♭3', '3', '4', '♭5', '5', '♭6', '6', '♭7', '7'];
export function _scaleDegreeSemisPure(pc, tonicPc) {
    const p = Number(pc), t = Number(tonicPc);
    if (!Number.isFinite(p) || !Number.isFinite(t)) return -1;
    return (((Math.round(p) - Math.round(t)) % 12) + 12) % 12;
}
export function _scaleDegreeLabelPure(pc, tonicPc) {
    const s = _scaleDegreeSemisPure(pc, tonicPc);
    return s < 0 ? '' : _SCALE_DEGREE_LABELS[s];
}
// Degree → accent colour: root gold, thirds sky, fifth green, sevenths violet,
// every other tone a neutral tint — a chord-tone-leaning palette so the 1/3/5/7
// harmonic skeleton pops against passing tones.
export function _scaleDegreeColorPure(semis) {
    switch (semis) {
        case 0: return '#fbbf24';            // root
        case 3: case 4: return '#38bdf8';    // 3rd (min / maj)
        case 7: return '#34d399';            // 5th
        case 10: case 11: return '#a78bfa';  // 7th (min / maj)
        default: return '#cbd5e1';           // other scale / chromatic tones
    }
}

// Human labels for the scale picker (keys are the SCALE_INTERVALS ids).
export const SCALE_LABELS = {
    major: 'Major', minor: 'Minor', dorian: 'Dorian', phrygian: 'Phrygian',
    lydian: 'Lydian', mixolydian: 'Mixolydian', locrian: 'Locrian',
    harmonic_minor: 'Harmonic minor', melodic_minor: 'Melodic minor',
    major_pentatonic: 'Major pentatonic', minor_pentatonic: 'Minor pentatonic',
    blues: 'Blues', chromatic: 'Chromatic',
};
