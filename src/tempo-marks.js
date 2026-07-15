/* Slopsmith Arrangement Editor — authored tempo/meter marks (P2-5).
 *
 * A SPARSE authored-intent layer over the beat grid: things the grid cannot
 * express (a fermata's non-metric hold, a 7/8 bar's 2+2+3 accent grouping)
 * plus per-mark provenance. `S.beats` stays the single executable truth —
 * marks never move beats in this slice (holds and groupings are topology
 * METADATA; ramps, which do compile beat times, are the P2-7 follow-up).
 *
 * Load-bearing rules (CLAUDE.md invariants + the pass-1 PR 10 warning):
 *   - Marks are keyed by MEASURE NUMBER (stable across re-fits), never by
 *     beat index, and are never smuggled onto `S.beats` entries.
 *   - `S.tempoMarks` is swapped IMMUTABLY (every edit builds a new array),
 *     so commands snapshot by reference and memos can key on identity.
 *   - Storage rides the same manifest-extension retention rule as
 *     `audio_shift` (spec #51 is ON HOLD — this shape is the prototype the
 *     spec proposal will be drawn from once a second consumer exists).
 */

import { S } from './state.js';
import { host } from './host.js';

/* @pure:tempo-marks:start */
// Provenance vocabulary (P2-1 draft): who asserted a mark / a barline.
//   confirmed — a human verified it (defends re-fit like a lock)
//   detected  — machine-found and machine-trusted (e.g. clean comb hit)
//   suggested — machine-found, unconfirmed
//   imported  — carried from the source file (GP/MIDI), unchecked vs audio
//   carried   — interpolated across a silent/sustained zone
const TEMPO_MARK_PROVENANCE = ['confirmed', 'detected', 'suggested', 'imported', 'carried'];
const TEMPO_MARK_KINDS = ['meter', 'hold'];

// One mark, validated + normalized — or null if unusable. Unknown extra
// fields are DROPPED (the wire surface is exactly what this returns).
function _markNormPure(mark) {
    if (!mark || typeof mark !== 'object') return null;
    const measure = Number(mark.measure);
    if (!Number.isInteger(measure) || measure < 1) return null;
    const kind = String(mark.kind || '');
    if (!TEMPO_MARK_KINDS.includes(kind)) return null;
    const out = { measure, kind };
    if (kind === 'meter') {
        const num = Number(mark.num);
        const den = Number(mark.den);
        if (!Number.isInteger(num) || num < 1 || num > 32) return null;
        if (![2, 4, 8, 16].includes(den)) return null;
        out.num = num;
        out.den = den;
        if (Array.isArray(mark.grouping) && mark.grouping.length) {
            const g = mark.grouping.map(Number);
            if (g.some(v => !Number.isInteger(v) || v < 1)) return null;
            if (g.reduce((a, b) => a + b, 0) !== num) return null;   // sum(grouping) === num
            out.grouping = g;
        }
    } else {   // hold
        const factor = Number(mark.factor);
        // How much longer than metric the bar is held; 2 = "about twice".
        out.factor = (Number.isFinite(factor) && factor > 1 && factor <= 16) ? factor : 2;
    }
    if (TEMPO_MARK_PROVENANCE.includes(mark.provenance)) out.provenance = mark.provenance;
    return out;
}

// A whole wire list → sanitized array (invalid entries dropped, one mark per
// (measure, kind), measure-sorted). This is the LOAD boundary — a hand-edited
// or older pack must never crash the editor.
function _marksSanitizePure(list) {
    if (!Array.isArray(list)) return [];
    const byKey = new Map();
    for (const m of list.slice(0, 2000)) {
        const norm = _markNormPure(m);
        if (norm) byKey.set(`${norm.measure}|${norm.kind}`, norm);
    }
    return [...byKey.values()].sort((a, b) => (a.measure - b.measure) || (a.kind < b.kind ? -1 : 1));
}

// Upsert/remove — both IMMUTABLE (return a new array; never touch the input).
function _marksUpsertPure(marks, mark) {
    const norm = _markNormPure(mark);
    if (!norm) return Array.isArray(marks) ? marks : [];
    const rest = (marks || []).filter(m => !(m.measure === norm.measure && m.kind === norm.kind));
    rest.push(norm);
    return rest.sort((a, b) => (a.measure - b.measure) || (a.kind < b.kind ? -1 : 1));
}
function _marksRemovePure(marks, measure, kind) {
    return (marks || []).filter(m => !(m.measure === measure && m.kind === kind));
}

function _marksAtPure(marks, measure) {
    return (marks || []).filter(m => m.measure === measure);
}

// The held-measure set — the exclusion key every BPM consumer shares
// (stats, chips; the suggest march and the click join in P2-6/7).
function _holdMeasuresPure(marks) {
    const out = new Set();
    for (const m of (marks || [])) if (m.kind === 'hold') out.add(m.measure);
    return out;
}

// Topology edits renumber measures: follow with the old→new map from the
// SURVIVING downbeats; a mark whose bar was deleted is dropped (its bar no
// longer exists — an honest drop, never a stale key pointing at the wrong
// bar). Same policy as S.tempoSelMulti, but remapped instead of cleared.
function _marksRemapPure(marks, oldToNew) {
    const out = [];
    for (const m of (marks || [])) {
        const nm = oldToNew instanceof Map ? oldToNew.get(m.measure) : undefined;
        if (Number.isInteger(nm) && nm >= 1) out.push({ ...m, measure: nm });
    }
    return out.sort((a, b) => (a.measure - b.measure) || (a.kind < b.kind ? -1 : 1));
}

// Topology edits with NO surviving-downbeat old→new map (pickup, halve/double
// range, multi-delete, heal, and the wholesale rebuilds — zones apply, rough
// map, flatten, MIDI tempo map) remap by TIME instead: marks follow the MUSIC.
// Each mark rides its old bar's downbeat time into whichever new bar's span
// [downbeat, nextDownbeat) contains that moment (epsilon on the lower edge —
// grid times are rounded, so a boundary moment belongs to the bar whose
// downbeat it is). Only the anchor `measure` remaps; every other field (e.g. a
// ramp's `measureEnd`, P2-7) rides the spread untouched.
//   - old bar missing from oldBeats, or the moment falls before the new
//     grid's first bar ≥ 1 (a new pickup bar 0) or past its final beat →
//     the mark DROPS (honest drop, never a stale key);
//   - two same-kind marks landing on one new bar (halve-range merging two
//     marked bars): better provenance wins (TEMPO_MARK_PROVENANCE order —
//     authored 'confirmed' beats every machine tier, unknown ranks last);
//     equal tiers → the EARLIER old bar wins, the loser drops.
// Returns the input array BY IDENTITY when nothing changes, so callers can
// skip the command snapshot (same convention as _marksMeterReconcilePure).
const _MARK_TIME_EPS = 1e-6;
function _marksRemapByTimePure(marks, oldBeats, newBeats) {
    if (!Array.isArray(marks)) return [];
    if (!marks.length || !Array.isArray(oldBeats) || !Array.isArray(newBeats)) return marks;
    const oldTimeByMeasure = new Map();
    for (const b of oldBeats) {
        if (b && b.measure > 0 && Number.isFinite(b.time) && !oldTimeByMeasure.has(b.measure)) {
            oldTimeByMeasure.set(b.measure, b.time);
        }
    }
    const downs = [];          // new downbeats, in grid (= time) order
    let end = -Infinity;       // the new grid's final beat — the last bar's span closes there
    for (const b of newBeats) {
        if (!b || !Number.isFinite(b.time)) continue;
        if (b.time > end) end = b.time;
        if (b.measure > 0) downs.push(b);
    }
    const rank = m => {
        const r = TEMPO_MARK_PROVENANCE.indexOf(m.provenance);
        return r < 0 ? TEMPO_MARK_PROVENANCE.length : r;
    };
    const byKey = new Map();   // `${measure}|${kind}` → { mark, oldMeasure }
    let changed = false;
    for (const m of marks) {
        const t = oldTimeByMeasure.get(m.measure);
        let nm = null;
        if (t !== undefined && t <= end + _MARK_TIME_EPS) {
            for (let k = downs.length - 1; k >= 0; k--) {
                if (t >= downs[k].time - _MARK_TIME_EPS) { nm = downs[k].measure; break; }
            }
        }
        if (!Number.isInteger(nm) || nm < 1) { changed = true; continue; }
        if (nm !== m.measure) changed = true;
        const key = `${nm}|${m.kind}`;
        const prev = byKey.get(key);
        if (prev) {
            changed = true;
            const wins = rank(m) < rank(prev.mark)
                || (rank(m) === rank(prev.mark) && m.measure < prev.oldMeasure);
            if (!wins) continue;
        }
        byKey.set(key, { mark: { ...m, measure: nm }, oldMeasure: m.measure });
    }
    if (!changed) return marks;
    return [...byKey.values()].map(e => e.mark)
        .sort((a, b) => (a.measure - b.measure) || (a.kind < b.kind ? -1 : 1));
}

// A bar's time signature changed under an authored meter mark (review #276
// item 3): keep the grouping only if it still honestly describes the new bar
// (sums to the new numerator — e.g. a den-only 7/8 → 7/4 change), retagging
// the mark's num/den; otherwise DROP the mark — stale authored data is
// cleared, never guessed (a 2+2+3 accent map on a 4/4 bar is a lie to every
// consumer). Returns the input array BY IDENTITY when nothing changes, so
// callers can skip the command snapshot.
function _marksMeterReconcilePure(marks, measure, num, den) {
    const list = Array.isArray(marks) ? marks : [];
    const cur = list.find(m => m.measure === measure && m.kind === 'meter');
    if (!cur || (cur.num === num && cur.den === den)) return marks;
    const g = cur.grouping;
    if (Array.isArray(g) && g.length && g.reduce((a, b) => a + b, 0) === num) {
        return _marksUpsertPure(list, { ...cur, num, den });
    }
    return _marksRemovePure(list, measure, 'meter');
}

// "2+2+3" → [2,2,3] validated against the bar's numerator; '' clears.
// null = unusable input (reject, keep the field as-is).
function _groupingParsePure(text, num) {
    const t = String(text ?? '').trim();
    if (t === '') return [];
    const parts = t.split('+').map(s => Number(s.trim()));
    if (!parts.length || parts.some(v => !Number.isInteger(v) || v < 1)) return null;
    if (parts.reduce((a, b) => a + b, 0) !== Number(num)) return null;
    return parts;
}

function _groupingLabelPure(num, den, grouping) {
    const base = `${num}/${den}`;
    return (Array.isArray(grouping) && grouping.length) ? `${base} (${grouping.join('+')})` : base;
}
/* @pure:tempo-marks:end */

export {
    TEMPO_MARK_PROVENANCE, _groupingLabelPure, _groupingParsePure, _holdMeasuresPure,
    _markNormPure, _marksAtPure, _marksMeterReconcilePure, _marksRemapByTimePure,
    _marksRemapPure, _marksRemovePure, _marksSanitizePure, _marksUpsertPure,
};

// One undoable command per marker edit. Marks don't move beats in this
// slice, so this is the TempoGridCmd DIRECTION (topology metadata): song-
// scope, exec/rollback swap the immutable array by reference.
export class TempoMarkCmd {
    constructor(before, after, label) {
        this.before = before;
        this.after = after;
        this.label = label || 'tempo marker';
        this.songScope = true;
    }
    exec() {
        S.tempoMarks = this.after;
        host.draw();
    }
    rollback() {
        S.tempoMarks = this.before;
        host.draw();
    }
}

// The verb the context menu / inspector call: toggle a hold on a measure.
export function editorToggleHoldBar(measure) {
    if (!Number.isInteger(measure) || measure < 1) return false;
    const has = (S.tempoMarks || []).some(m => m.measure === measure && m.kind === 'hold');
    const after = has
        ? _marksRemovePure(S.tempoMarks, measure, 'hold')
        : _marksUpsertPure(S.tempoMarks, { measure, kind: 'hold', provenance: 'confirmed' });
    S.history.exec(new TempoMarkCmd(S.tempoMarks || [], after, has ? 'remove hold' : 'hold bar'));
    return true;
}

// Set/clear a meter grouping on a measure (num/den read from the bar).
export function editorSetMeterGrouping(measure, num, den, grouping) {
    if (!Number.isInteger(measure) || measure < 1) return false;
    const after = (Array.isArray(grouping) && grouping.length)
        ? _marksUpsertPure(S.tempoMarks, { measure, kind: 'meter', num, den, grouping, provenance: 'confirmed' })
        : _marksRemovePure(S.tempoMarks, measure, 'meter');
    S.history.exec(new TempoMarkCmd(S.tempoMarks || [], after,
        (Array.isArray(grouping) && grouping.length) ? 'meter grouping' : 'clear grouping'));
    return true;
}
