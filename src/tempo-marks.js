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
    _markNormPure, _marksAtPure, _marksRemapPure, _marksRemovePure, _marksSanitizePure,
    _marksUpsertPure,
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
