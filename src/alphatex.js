/* Slopsmith Arrangement Editor — live alphaTex generation (the Tab view).
 *
 * Converts the CURRENT in-memory fretted arrangement into alphaTab's text
 * format so the engraved tab redraws with every edit — no save, no backend
 * conversion, no other plugin. This is the inverse-ish of the read-only
 * tab PREVIEW (tab-preview.js), which engraves the last-SAVED pack via a
 * GP5 round-trip; the live view trades engraving fidelity for immediacy.
 *
 * v1 quantization contract (documented limits, all deliberate):
 *   - Onsets quantize to a 16th grid inside each bar (beat-domain, via the
 *     injected converter, so a variable tempo map quantizes correctly).
 *   - A beat's engraved duration is the GAP to the next event (or bar end),
 *     greedily decomposed down the plain ladder (1/2/4/8/16) with rests
 *     filling remainders — bars always sum exactly, so the engraving never
 *     drifts out of alignment. Sustains, ties, triplets and swung placement
 *     are not engraved yet (the timeline views remain the editing truth).
 *   - Pickup notes before bar 1 and notes past the last barline are skipped
 *     and COUNTED, never silently dropped.
 */

/* @pure:alphatex:start */
// [durTicks, alphaTex duration], largest first — greedy decomposition.
const ATEX_LADDER = [[16, 1], [8, 2], [4, 4], [2, 8], [1, 16]];
const TICKS_PER_WHOLE = 16;   // one ladder tick = one sixteenth

// alphaTex durations are absolute (a :8 token is an eighth in ANY meter),
// so bar tick capacity must scale with the meter's denominator: a ruler
// beat in x/8 is an eighth (2 ticks), in x/4 a quarter (4). Absent or
// non-dividing denominators fall back to quarter-note beats.
function _ticksPerBeat(den) {
    const d = Number(den);
    return (d > 0 && TICKS_PER_WHOLE % d === 0) ? TICKS_PER_WHOLE / d : 4;
}

// alphaTab's own octave convention: high E (MIDI 64) is "e5" — one octave
// number HIGHER than the editor's midiToNote ("E4", the C4=60 flavour). The
// names are inlined so this block stays self-contained (the sliced-test
// convention) and so nobody "fixes" it to the editor's converter and breaks
// every tuning by an octave.
const ATEX_NOTE_NAMES = ['c', 'c#', 'd', 'd#', 'e', 'f', 'f#', 'g', 'g#', 'a', 'a#', 'b'];
export function _alphaTexNoteNamePure(midi) {
    return ATEX_NOTE_NAMES[((midi % 12) + 12) % 12] + Math.floor(midi / 12);
}

// alphaTex lists tuning from the HIGHEST string down; our string 0 is the
// LOWEST lane.
export function _alphaTexTuningPure(openMidi, tuning) {
    const names = [];
    for (let s = (openMidi || []).length - 1; s >= 0; s--) {
        const off = (Array.isArray(tuning) && Number.isFinite(Number(tuning[s]))) ? Number(tuning[s]) : 0;
        names.push(_alphaTexNoteNamePure(openMidi[s] + off));
    }
    return names.join(' ');
}

// Greedy rest fill covering `ticks` exactly (largest denominations first).
function _restTokens(ticks) {
    const out = [];
    let left = ticks;
    for (const [t, dur] of ATEX_LADDER) {
        while (left >= t) { out.push(`r.${dur}`); left -= t; }
    }
    return out;
}

// The generator. Inputs are plain data + the beat converter, so the whole
// thing is testable without S or a browser:
//   notes      the arrangement's notes (fretted: {time, string, fret})
//   beats      S.beats ({time, measure, den?})
//   beatOfFn   t → continuous position in the beats-array index domain
//   laneCount  strings on this track (alphaTex string 1 = our top lane)
//   openMidi/tuning/capo/title  header material (midiToName injected)
// Returns { tex, beatMap, bars, skipped } — beatMap[barIdx][beatIdx] is the
// array of source-note refs behind each EMITTED beat (null for rests), the
// coordinates alphaTab's click events report, so the view can map a click
// straight back to editor notes.
export function _alphaTexFromNotesPure(opts) {
    const { notes, beats, beatOfFn, laneCount, openMidi, tuning, capo, title } = opts || {};
    const header = [];
    if (title) header.push(`\\title "${String(title).replace(/"/g, "'")}"`);
    header.push(`\\tuning ${_alphaTexTuningPure(openMidi, tuning)}`);
    if (Number(capo) > 0) header.push(`\\capo ${Number(capo)}`);
    header.push('.');
    return _alphaTexAssemblePure({
        items: notes, timeOf: n => n.time, beats, beatOfFn, header,
        groupParts: group => group
            .slice().sort((a, c) => a.string - c.string)
            .map(n => `${n.fret}.${laneCount - n.string}`),
    });
}

// Percussion articulation id per drum piece. alphaTab's articulation
// table (PercussionMapper) uses the GM percussion numbers for the whole
// standard kit, so these read as GM — but they are ARTICULATION ids, fed
// to a `\instrument "percussion"` staff, not a pitch. `stack` has no
// articulation — its hits are skipped and counted, never silently
// dropped (the engraving must stay honest about what it omits).
export const DRUM_TEX_ARTICULATIONS = {
    kick: 36, snare: 38, snare_xstick: 37,
    hh_closed: 42, hh_open: 46, hh_pedal: 44,
    tom_hi: 50, tom_mid: 48, tom_low: 45, tom_floor: 43,
    crash_l: 49, crash_r: 57, splash: 55, china: 52,
    ride: 51, ride_bell: 53, bell: 56, stack: null,
};

// The drum-tab flavor: same quantization contract, hits ({t, p}) instead
// of fretted notes, engraved on a percussion staff. Returns the same
// { tex, beatMap, bars, skipped } shape (+ skipped.unmapped for pieces
// with no articulation).
export function _alphaTexFromDrumHitsPure(opts) {
    const { hits, beats, beatOfFn, title } = opts || {};
    const mapped = [];
    let unmapped = 0;
    for (const h of (hits || [])) {
        if (!h || !Number.isFinite(h.t)) continue;
        if (Number.isInteger(DRUM_TEX_ARTICULATIONS[h.p])) mapped.push(h);
        else unmapped++;
    }
    const header = [];
    if (title) header.push(`\\title "${String(title).replace(/"/g, "'")}"`);
    header.push('\\instrument "percussion"');
    header.push('.');
    const gen = _alphaTexAssemblePure({
        items: mapped, timeOf: h => h.t, beats, beatOfFn, header,
        // The percussion (neutral) clef is BAR metadata, not header — without
        // it alphaTab engraves drums under a treble clef.
        firstBarMeta: '\\clef neutral',
        // A bare `36.4` lexes as the FLOAT 36.4, not articulation-36 with a
        // quarter duration (fretted notes dodge this — `3.6.4` has two
        // dots). Parenthesizing every beat keeps the duration suffix
        // unambiguous: `(36).4`.
        wrapSingles: true,
        groupParts: group => {
            // One articulation per tick slot — two simultaneous hits on the
            // SAME piece engrave once (a flam isn't representable yet).
            const seen = new Set();
            const parts = [];
            for (const h of group) {
                const a = DRUM_TEX_ARTICULATIONS[h.p];
                if (!seen.has(a)) { seen.add(a); parts.push(String(a)); }
            }
            return parts;
        },
    });
    if (gen) gen.skipped.unmapped = unmapped;
    return gen;
}

// The shared bar walker: bucket items onto the 16th grid, emit bars that
// always sum exactly (rest-filled), and keep the emitted-beat → source
// refs map for click handling. Header lines are the caller's.
function _alphaTexAssemblePure({ items, timeOf, beats, beatOfFn, header, groupParts, wrapSingles, firstBarMeta }) {
    const dbs = [];
    for (let i = 0; i < (beats || []).length; i++) {
        if (beats[i] && beats[i].measure > 0) dbs.push(i);
    }
    if (dbs.length < 2) return null;

    // Bucket items by bar + tick, in one pass.
    const skipped = { pickup: 0, tail: 0 };
    const perBar = dbs.slice(0, -1).map(() => new Map());
    for (const n of (items || [])) {
        if (!n || !Number.isFinite(timeOf(n))) continue;
        const beta = beatOfFn(timeOf(n));
        if (beta < dbs[0]) { skipped.pickup++; continue; }
        if (beta >= dbs[dbs.length - 1]) { skipped.tail++; continue; }
        // The containing bar: last downbeat index ≤ beta.
        let lo = 0, hi = dbs.length - 2;
        while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (dbs[mid] <= beta) lo = mid; else hi = mid - 1; }
        const tpb = _ticksPerBeat(beats[dbs[lo]].den);
        const barTicks = (dbs[lo + 1] - dbs[lo]) * tpb;
        const tick = Math.max(0, Math.min(barTicks - 1, Math.round((beta - dbs[lo]) * tpb)));
        const bucket = perBar[lo];
        if (!bucket.has(tick)) bucket.set(tick, []);
        bucket.get(tick).push(n);
    }

    const bars = [];
    const beatMap = [];
    let lastSig = '';
    for (let b = 0; b < perBar.length; b++) {
        const beatsInBar = dbs[b + 1] - dbs[b];
        const den = Number(beats[dbs[b]].den) || 4;
        const barTicks = beatsInBar * _ticksPerBeat(den);
        const tokens = [];
        const map = [];
        if (b === 0 && firstBarMeta) tokens.push(firstBarMeta);
        const sig = `${beatsInBar}/${den}`;
        if (sig !== lastSig) { tokens.push(`\\ts ${beatsInBar} ${den}`); lastSig = sig; }

        const ticks = [...perBar[b].keys()].sort((x, y) => x - y);
        let cursor = 0;
        for (let k = 0; k < ticks.length; k++) {
            const T = ticks[k];
            if (T > cursor) {
                for (const r of _restTokens(T - cursor)) { tokens.push(r); map.push(null); }
                cursor = T;
            }
            const group = perBar[b].get(T);
            const gap = (k + 1 < ticks.length ? ticks[k + 1] : barTicks) - T;
            // Largest plain duration that fits the gap; the remainder rests.
            let durTicks = 1, dur = 16;
            for (const [t, d] of ATEX_LADDER) { if (t <= gap) { durTicks = t; dur = d; break; } }
            const parts = groupParts(group);
            tokens.push(parts.length === 1 && !wrapSingles
                ? `${parts[0]}.${dur}` : `(${parts.join(' ')}).${dur}`);
            map.push(group.slice());
            cursor += durTicks;
            if (cursor < T + gap) {
                for (const r of _restTokens(T + gap - cursor)) { tokens.push(r); map.push(null); }
                cursor = T + gap;
            }
        }
        if (cursor < barTicks) {
            for (const r of _restTokens(barTicks - cursor)) { tokens.push(r); map.push(null); }
        }
        bars.push(tokens.join(' '));
        beatMap.push(map);
    }

    return { tex: header.join('\n') + '\n' + bars.join(' | '), beatMap, bars: bars.length, skipped };
}
/* @pure:alphatex:end */
