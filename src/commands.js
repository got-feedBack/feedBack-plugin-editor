// ════════════════════════════════════════════════════════════════════
// The note command classes — every undoable edit to a fretted chart, plus the
// helpers that construct and execute them.
//
// Each is duck-typed for src/history.js: `exec()`, `rollback()`, and the three
// opt-out flags the read-only-roll lock reads (`songScope`, `pitchPreserving`,
// `suggestResolved`). The drum commands live in src/drum.js; the tone, anchor
// and handshape commands in src/annotation-lanes.js. The tempo, section and
// bookmark commands are still in main.js, interleaved with their feature code.
//
// main.js keeps `_historyEnsureArr` — it drives the arrangement <select> and
// the _undoDrivenArrSwitch guard — and constructs these from its event handlers.
//
// Everything that touches the browser stays in main.js and arrives through the
// shared `host` object in src/host.js: draw, updateStatus, _editBlipAt,
// _editorCurrentNoteIndices, _renderInspector, the ambiguous-pitch popover, and
// _resizeForLaneChange (which schedules a requestAnimationFrame). Importing them
// directly would close a cycle, and keeping them out is what lets this file be
// imported AND RUN under node with no DOM at all — asserted by
// tests/commands_dom_free.test.mjs, the one suite that must not install a
// document stub. The single indirect reach is setStatus (src/ui.js), which
// no-ops when there is no document.
//
// Browser surface: NONE. The ambiguous-pitch popover it used to build lives in
// main.js and arrives as host.rollConfirmPosition — a command module has no
// business touching the DOM, and keeping it out is what lets the suites below
// import this file under node without a document.
// ════════════════════════════════════════════════════════════════════
import { beatOf, timeOf } from './beats.js';
import { _flattenArrChords, _mergeChordFn } from './chords.js';
import { host } from './host.js';
import { PIANO_LANE_H, _rollPitchCtx, isKeysArr } from './keys.js';
import { _openMidiForArr, _soundingPitchPure, _stringCountFor } from './lanes.js';
import { _clearSuggested, _isSuggested, _markSuggested, notes, rescaleBendCurveToPeak, sanitizeBendCurve } from './notes.js';
import {
    _absolutePitch, _cyclePositionCandidatesPure, _cycleStepPure, _suggestPositionPure,
} from './position.js';
import { SNAP_VALUES, _editorEffectiveSnapValuePure, _editorSnapSubdivisionsPure } from './snap.js';
import { S } from './state.js';
import { setStatus } from './ui.js';

export class MoveNoteCmd {
    constructor(indices, dtimes, dstrings, dfrets) {
        this.indices = indices;
        this.dtimes = dtimes;
        this.dstrings = dstrings;
        this.dfrets = dfrets; // null for guitar mode, array for piano mode
        // VA.3 fretted-roll pitch-move: note indices whose {string,fret} the
        // resolver repicked, to mark suggested. Set by the commit; null otherwise.
        this.markSuggestedIdx = null;
        this._priorSuggested = null;   // prior mark state, snapshot once for undo
    }
    exec() {
        const nn = notes();
        for (let i = 0; i < this.indices.length; i++) {
            nn[this.indices[i]].time += this.dtimes[i];
            nn[this.indices[i]].string += this.dstrings[i];
            if (this.dfrets) nn[this.indices[i]].fret += this.dfrets[i];
        }
        // Mark resolver-repicked notes suggested; snapshot the prior mark state
        // once (first exec) so rollback restores it exactly. MoveNoteCmd never
        // sorts, so these indices are stable across the exec/rollback round-trip.
        if (this.markSuggestedIdx && typeof _markSuggested === 'function') {
            if (!this._priorSuggested) {
                this._priorSuggested = this.markSuggestedIdx.map(idx => ({ idx, was: _isSuggested(nn[idx]) }));
            }
            for (const idx of this.markSuggestedIdx) _markSuggested(nn[idx]);
        }
    }
    rollback() {
        const nn = notes();
        for (let i = 0; i < this.indices.length; i++) {
            nn[this.indices[i]].time -= this.dtimes[i];
            nn[this.indices[i]].string -= this.dstrings[i];
            if (this.dfrets) nn[this.indices[i]].fret -= this.dfrets[i];
        }
        if (this._priorSuggested && typeof _markSuggested === 'function') {
            for (const { idx, was } of this._priorSuggested) {
                if (was) _markSuggested(nn[idx]); else _clearSuggested(nn[idx]);
            }
        }
    }
}

// Snapshot the selected note refs, then remap `S.sel` back to fresh
// indices after the caller has mutated `notes()` (typically via a
// sort that would otherwise leave stale indices pointing at the
// wrong objects). Inspector bulk edits read through `S.sel`, so any
// command that sorts/reorders has to keep the index→ref binding
// consistent.
export function _withStableSelection(mutate) {
    if (!S.sel || S.sel.size === 0) {
        mutate();
        return;
    }
    const nn = notes();
    const selectedRefs = [...S.sel]
        .map(i => nn[i])
        .filter(Boolean);
    mutate();
    const after = notes();
    // Build a single ref→index map (O(N)) instead of calling
    // `Array.indexOf` once per selected ref (O(selected × N)). Matters
    // on long arrangements / large multi-selects.
    const refToIdx = new Map();
    for (let i = 0; i < after.length; i++) refToIdx.set(after[i], i);
    S.sel.clear();
    for (const ref of selectedRefs) {
        const i = refToIdx.get(ref);
        if (i !== undefined) S.sel.add(i);
    }
}

export class AddNoteCmd {
    constructor(note) { this.note = note; this.idx = -1; }
    exec() {
        const nn = notes();
        nn.push(this.note);
        // Sorting the notes array can shift the indices stored in
        // `S.sel` so they end up pointing at different note objects.
        // Re-bind the selection through the ref→index round-trip.
        _withStableSelection(() => {
            nn.sort((a, b) => a.time - b.time);
        });
        this.idx = nn.indexOf(this.note);
        // Suggest-position (V4): a roll-resolved add is marked SUGGESTED until
        // the user confirms; redo re-marks so the state round-trips. typeof-
        // guarded so extracted-test envs without the mark helpers are unaffected.
        if (this.markSuggested && typeof _markSuggested === 'function') _markSuggested(this.note);
    }
    rollback() {
        const nn = notes();
        // Removing via splice shifts every index past `i` down by one,
        // so the selection would silently re-bind to wrong notes after
        // undo. Wrap the removal so `S.sel` stays bound to refs across
        // the index shift.
        _withStableSelection(() => {
            const i = nn.indexOf(this.note);
            if (i >= 0) nn.splice(i, 1);
        });
        if (this.markSuggested && typeof _clearSuggested === 'function') _clearSuggested(this.note);
    }
}

export class DeleteNotesCmd {
    constructor(indices) {
        this.indices = [...indices].sort((a, b) => b - a);
        this.removed = [];
    }
    exec() {
        const nn = notes();
        this.removed = [];
        for (const i of this.indices) {
            this.removed.push({ idx: i, note: nn[i] });
            nn.splice(i, 1);
        }
        S.sel.clear();
    }
    rollback() {
        const nn = notes();
        for (const r of [...this.removed].reverse()) {
            nn.splice(r.idx, 0, r.note);
        }
    }
}

/* @pure:split-notes:start */
// Technique distribution for a note split at time t (Scissors tool / Split at
// playhead): onset-anchored verbs — the bend family, whose curve/magnitude is
// onset-relative — stay with the FIRST half only; end-of-note verbs — the
// slide targets and link_next, which describe what happens as the note ENDS —
// move to the SECOND half only. Everything else (palm mute, accent, the keys
// `hand`, …) describes the whole held note and copies to both.
export function _splitTechniquesPure(tech) {
    const src = tech || {};
    const first = { ...src };
    const second = { ...src };
    delete second.bend;
    delete second.bend_intent;
    delete second.bend_values;
    delete first.slide_to;
    delete first.slide_unpitch_to;
    delete first.link_next;
    return { first, second };
}

// Minimum length either half must keep, in seconds — a split that would
// leave a degenerate sliver is skipped for that note.
export const _SPLIT_MIN_SEGMENT = 0.02;

// A cut at `t` splits a note (onset `start`, length `sus`) only when BOTH
// halves clear _SPLIT_MIN_SEGMENT. The single source of truth for the rule:
// exec() applies it per note, and the callers (Split-at-playhead, Scissors)
// pre-filter with it so a viable-less attempt never reaches the undo stack.
export function _splitViablePure(start, sus, t) {
    return t - start >= _SPLIT_MIN_SEGMENT && (start + sus) - t >= _SPLIT_MIN_SEGMENT;
}
/* @pure:split-notes:end */

export class SplitNotesCmd {
    constructor(indices, t) {
        this.t = Number(t) || 0;
        this.indices = new Set(indices);
        this.before = null;    // ref-snapshot of the array, taken on exec
        this.splitCount = 0;
        // A split never changes what a note sounds like at its onset — only how
        // its duration is carved up — so it passes the read-only-roll lock like
        // the sustain resizes do.
        this.pitchPreserving = true;
    }
    exec() {
        const nn = notes();
        // Ref-snapshot for rollback: splitting replaces target notes with two
        // fresh halves and can perturb same-time ordering via the re-sort, so
        // index bookkeeping is fragile — restoring the exact original content
        // (same refs, same order) is bulletproof and cheap (refs only).
        this.before = nn.slice();
        this.splitCount = 0;
        const out = [];
        nn.forEach((n, i) => {
            const start = Number(n.time) || 0;
            const sus = Number(n.sustain) || 0;
            // Only a targeted note genuinely spanning t splits, with both
            // halves at least _SPLIT_MIN_SEGMENT long.
            if (!this.indices.has(i) || !_splitViablePure(start, sus, this.t)) {
                out.push(n);
                return;
            }
            const { first: ft, second: st } = _splitTechniquesPure(n.techniques);
            out.push({ ...n, sustain: this.t - start, techniques: ft });
            out.push({
                ...n, time: this.t, sustain: (start + sus) - this.t,
                techniques: st,
            });
            this.splitCount++;
        });
        // Keep the sorted-by-time invariant (a note can START between a split
        // target's onset and t). Array.prototype.sort is stable, so same-time
        // groups (chord members) keep their relative order.
        out.sort((a, b) => a.time - b.time);
        nn.length = 0;
        nn.push(...out);
        if (this.splitCount) S.sel.clear();
    }
    rollback() {
        const nn = notes();
        nn.length = 0;
        nn.push(...this.before);
    }
}

export class ResizeSustainCmd {
    constructor(index, newSustain) {
        this.index = index;
        this.newSustain = newSustain;
        this.oldSustain = notes()[index].sustain || 0;
        // A sustain (duration) edit never changes what a note SOUNDS like — only
        // how long it rings — so it preserves pitch and passes the read-only-roll
        // lock (V4: duration edits, the roll's native strength, apply directly).
        this.pitchPreserving = true;
    }
    exec() { notes()[this.index].sustain = this.newSustain; }
    rollback() { notes()[this.index].sustain = this.oldSustain; }
}

export class ResizeSustainGroupCmd {
    constructor(indices, newSustains) {
        this.indices = indices.slice();
        this.newSustains = newSustains.slice();
        const nn = notes();
        this.oldSustains = this.indices.map(i => nn[i] ? (nn[i].sustain || 0) : 0);
        this.pitchPreserving = true;   // duration edit — passes the read-only-roll lock (see ResizeSustainCmd)
    }
    exec() {
        const nn = notes();
        for (let i = 0; i < this.indices.length; i++) {
            if (nn[this.indices[i]]) nn[this.indices[i]].sustain = this.newSustains[i];
        }
    }
    rollback() {
        const nn = notes();
        for (let i = 0; i < this.indices.length; i++) {
            if (nn[this.indices[i]]) nn[this.indices[i]].sustain = this.oldSustains[i];
        }
    }
}

export class ChangeFretCmd {
    constructor(index, newFret) {
        this.index = index;
        this.newFret = newFret;
        this.oldFret = notes()[index].fret;
    }
    exec() { notes()[this.index].fret = this.newFret; }
    rollback() { notes()[this.index].fret = this.oldFret; }
}

export class ChangeFretGroupCmd {
    constructor(indices, newFret) {
        this.indices = indices.slice();
        this.newFret = newFret;
        const nn = notes();
        this.oldFrets = this.indices.map(i => nn[i] ? nn[i].fret : 0);
    }
    exec() {
        const nn = notes();
        for (const i of this.indices) {
            if (nn[i]) nn[i].fret = this.newFret;
        }
    }
    rollback() {
        const nn = notes();
        for (let i = 0; i < this.indices.length; i++) {
            if (nn[this.indices[i]]) nn[this.indices[i]].fret = this.oldFrets[i];
        }
    }
}
export class ToggleTechniqueCmd {
    constructor(indices, key, value, fretValue = null) {
        this.indices = indices.slice();
        this.key = key;
        this.value = !!value;
        this.fretValue = fretValue;
        const nn = notes();
        this.old = this.indices.map(i => ({
            tech: !!(nn[i] && nn[i].techniques && nn[i].techniques[key]),
            fret: nn[i] ? nn[i].fret : 0,
        }));
    }
    exec() {
        const nn = notes();
        for (const i of this.indices) {
            const n = nn[i];
            if (!n) continue;
            if (!n.techniques) n.techniques = {};
            n.techniques[this.key] = this.value;
            if (this.fretValue !== null) n.fret = this.fretValue;
        }
    }
    rollback() {
        const nn = notes();
        this.indices.forEach((i, k) => {
            const n = nn[i];
            if (!n) return;
            if (!n.techniques) n.techniques = {};
            n.techniques[this.key] = this.old[k].tech;
            n.fret = this.old[k].fret;
        });
    }
}

// Set a SCALAR technique (`bend` peak, `slide_to`, `slide_unpitch_to`) to an
// absolute value across a selection as one undoable edit — the inspector's
// numeric technique inputs, which used to mutate n.techniques in place with no
// SetTechScalarCmd's per-note sibling: one undoable command that writes a
// DIFFERENT scalar value per index (values[k] onto indices[k]) — the shape a
// bulk generator needs (e.g. the keys hand split-point stamp, where notes
// below the split take 'lh' and the rest 'rh' in one Ctrl+Z step). No bend
// special-casing: never use it for `bend` (SetTechScalarCmd owns the curve
// rescale); it exists for plain scalar marks like `hand`.
export class SetTechScalarPerNoteCmd {
    constructor(indices, key, values) {
        this.indices = indices.slice();
        this.key = key;
        this.values = values.slice();
        const nn = notes();
        this.old = this.indices.map(i => {
            const t = (nn[i] && nn[i].techniques) || {};
            return t[key];
        });
    }
    exec() {
        const nn = notes();
        this.indices.forEach((i, k) => {
            const n = nn[i];
            if (!n) return;
            if (!n.techniques) n.techniques = {};
            n.techniques[this.key] = this.values[k];
        });
    }
    rollback() {
        const nn = notes();
        this.indices.forEach((i, k) => {
            const n = nn[i];
            if (!n) return;
            if (!n.techniques) n.techniques = {};
            n.techniques[this.key] = this.old[k];
        });
    }
}

// undo (the documented PR3b trap). Snapshots the prior scalar per note; for
// `bend` it also carries the authored curve (bend_values) through the same
// rescale-to-new-peak the in-place path did, and snapshots it so undo restores
// the exact prior shape. Applies to every selected note (the inspector's
// "set all" semantics) as a single Ctrl+Z.
export class SetTechScalarCmd {
    constructor(indices, key, value) {
        this.indices = indices.slice();
        this.key = key;
        this.value = value;
        this.old = this.indices.map(i => {
            const t = notes()[i].techniques || {};
            // bend_values is only touched for `bend`; snapshot it defensively so
            // undo restores the exact curve even when the rescale nulls it.
            return { v: t[key], bnv: t.bend_values };
        });
    }
    exec() {
        for (const i of this.indices) {
            const n = notes()[i];
            if (!n.techniques) n.techniques = {};
            n.techniques[this.key] = this.value;
            // Editing the scalar peak must keep any authored curve consistent
            // (renderers/graders read bnv as authoritative): rescale the curve to
            // the new peak, or drop it when the peak is 0 / the curve is unscalable.
            if (this.key === 'bend' && sanitizeBendCurve(n.techniques.bend_values)) {
                const scaled = this.value > 0
                    ? rescaleBendCurveToPeak(n.techniques.bend_values, this.value)
                    : null;
                n.techniques.bend_values = scaled;
                // bnv rounds points to 0.1, so a non-0.1 `value` (e.g. 0.25) would
                // leave bn disagreeing with the curve's real peak. Snap bn to it.
                if (scaled) n.techniques.bend = scaled.reduce((m, p) => Math.max(m, p.v), 0);
            }
        }
    }
    rollback() {
        this.indices.forEach((i, k) => {
            const n = notes()[i];
            if (!n.techniques) n.techniques = {};
            n.techniques[this.key] = this.old[k].v;
            if (this.key === 'bend') n.techniques.bend_values = this.old[k].bnv;
        });
    }
}

// Set the full bend shape (peak `bend`, intent `bend_intent`, curve
// `bend_values` — §6.2.1) on one or more notes as a single undoable edit.
// Snapshots the prior bend triple per note so undo restores it exactly.
export class SetBendShapeCmd {
    constructor(indices, bn, bt, bnv) {
        this.indices = indices.slice();
        this.bn = bn;
        this.bt = bt;
        // Store a defensive copy; null when the note has no curve.
        this.bnv = Array.isArray(bnv) && bnv.length
            ? bnv.map(p => ({ t: p.t, v: p.v }))
            : null;
        this.old = this.indices.map(i => {
            const t = notes()[i].techniques || {};
            return {
                bend: t.bend,
                bend_intent: t.bend_intent,
                bend_values: t.bend_values,
            };
        });
    }
    exec() {
        for (const i of this.indices) {
            const n = notes()[i];
            if (!n.techniques) n.techniques = {};
            n.techniques.bend = this.bn;
            n.techniques.bend_intent = this.bt;
            n.techniques.bend_values = this.bnv
                ? this.bnv.map(p => ({ t: p.t, v: p.v }))
                : null;
        }
    }
    rollback() {
        this.indices.forEach((i, k) => {
            const n = notes()[i];
            if (!n.techniques) n.techniques = {};
            const o = this.old[k];
            n.techniques.bend = o.bend;
            n.techniques.bend_intent = o.bend_intent;
            n.techniques.bend_values = o.bend_values;
        });
    }
}

// Set only the bend intent (`bt`) on a set of notes — used by the inspector
// dropdown so changing intent across a multi-selection doesn't flatten each
// note's distinct peak/curve (which the full SetBendShapeCmd would).
export class SetBendIntentCmd {
    constructor(indices, bt) {
        this.indices = indices.slice();
        this.bt = Number(bt) || 0;
        this.old = this.indices.map(i => (notes()[i].techniques || {}).bend_intent);
    }
    exec() {
        for (const i of this.indices) {
            const n = notes()[i];
            if (!n.techniques) n.techniques = {};
            n.techniques.bend_intent = this.bt;
        }
    }
    rollback() {
        this.indices.forEach((i, k) => {
            const n = notes()[i];
            if (!n.techniques) n.techniques = {};
            n.techniques.bend_intent = this.old[k];
        });
    }
}

// Teaching marks (§6.2.2) — set one integer technique field (fret_finger /
// scale_degree / strum_group) across a set of notes as one undoable edit,
// snapshotting the prior per-note value. -1 is the unset sentinel (the save
// path omits it from the wire). Display only — never feeds grading.
export class SetTeachingMarkCmd {
    constructor(indices, key, value) {
        this.indices = indices.slice();
        this.key = key;
        this.value = Number.isInteger(value) ? value : -1;
        this.old = this.indices.map(i => {
            const t = notes()[i].techniques || {};
            return t[key];
        });
    }
    exec() {
        for (const i of this.indices) {
            const n = notes()[i];
            if (!n.techniques) n.techniques = {};
            n.techniques[this.key] = this.value;
        }
    }
    rollback() {
        this.indices.forEach((i, k) => {
            const n = notes()[i];
            if (!n.techniques) n.techniques = {};
            n.techniques[this.key] = this.old[k];
        });
    }
}

// Per-note teaching-mark assignment (auto-fingering): each note gets its OWN
// value in one undoable step — SetTeachingMarkCmd sets a single value across
// notes; this sets a distinct value per note. `assignments`: [{ idx, value }].
export class SetTeachingMarksCmd {
    constructor(key, assignments) {
        this.key = key;
        this.items = (assignments || []).map(a => ({
            idx: a.idx,
            value: Number.isInteger(a.value) ? a.value : -1,
            old: (notes()[a.idx] && notes()[a.idx].techniques || {})[key],
        }));
    }
    exec() {
        for (const it of this.items) {
            const n = notes()[it.idx];
            if (!n) continue;
            if (!n.techniques) n.techniques = {};
            n.techniques[this.key] = it.value;
        }
    }
    rollback() {
        for (const it of this.items) {
            const n = notes()[it.idx];
            if (!n) continue;
            if (!n.techniques) n.techniques = {};
            n.techniques[this.key] = it.old;
        }
    }
}

export class SetPitchedSlideTargetsCmd {
    constructor(indices, delta) {
        this.indices = indices.slice();
        this.delta = Number(delta) || 0;
        this.old = this.indices.map(i => {
            const t = notes()[i].techniques || {};
            return t.slide_to;
        });
    }
    exec() {
        for (const i of this.indices) {
            const n = notes()[i];
            if (!n.techniques) n.techniques = {};
            const fret = Math.max(0, Math.min(24, (Number(n.fret) || 0) + this.delta));
            n.techniques.slide_to = fret;
        }
    }
    rollback() {
        this.indices.forEach((i, k) => {
            const n = notes()[i];
            if (!n.techniques) n.techniques = {};
            n.techniques.slide_to = this.old[k];
        });
    }
}

// Edit a chord-instance harmony function (§6.3.1). fn rides the instance: it is
// carried as `_fn` on EVERY note at the chord's time, so it travels with the
// notes through any time-mutating edit and reconstructChords adopts it by
// majority. One undo unit; snapshots each note's prior `_fn` by object ref.
export class EditChordFnCmd {
    constructor(arrIdx, timeKey, baseFn, patch) {
        this.arrIdx = arrIdx;
        this.timeKey = timeKey;
        this.next = _mergeChordFn(baseFn, patch) || null;
        this._targets = null;   // [{ note, prev }] filled at exec()
    }
    _groupNotes() {
        const arr = S.arrangements[this.arrIdx];
        if (!arr || !Array.isArray(arr.notes)) return [];
        return arr.notes.filter(n => n.time.toFixed(4) === this.timeKey);
    }
    exec() {
        const grp = this._groupNotes();
        // Snapshot by object ref (not index) so undo is robust to reordering;
        // `prev === undefined` marks a note that had no `_fn`.
        this._targets = grp.map(n => ({ note: n, prev: ('_fn' in n) ? n._fn : undefined }));
        for (const n of grp) n._fn = this.next;
    }
    rollback() {
        if (!this._targets) return;
        for (const t of this._targets) {
            if (t.prev === undefined) delete t.note._fn;
            else t.note._fn = t.prev;
        }
    }
}

// ── Move-to-string helpers ──────────────────────────────────────────
// Compute the absolute pitch (MIDI) of a note given the arrangement's
// absolute pitch.  `direction` is +1 (higher string index) or -1 (lower).
// Returns { targetString, targetFret } when valid, or null when the
// resulting fret would be out of range [0, 24] or the target string
// doesn't exist.
export function _getMoveStringResult(noteIdx, direction) {
    if (isKeysArr()) return null;           // keys DATA: no string concept
    const arr = S.arrangements[S.currentArr];
    if (!arr) return null;
    const n = notes()[noteIdx];
    if (!n) return null;

    const laneCount = _stringCountFor(arr);
    const targetString = n.string + direction;
    if (targetString < 0 || targetString >= laneCount) return null;

    // Normalise tuning length to laneCount (mirrors _normalizeTuningToLanes
    // but non-destructively — we only need the values, not to mutate arr).
    const rawTuning = Array.isArray(arr.tuning) ? arr.tuning : [];
    const tuning = rawTuning.slice(0, laneCount);
    while (tuning.length < laneCount) tuning.push(0);

    const openMidi = _openMidiForArr(arr, laneCount);
    const pitch    = _absolutePitch(openMidi, tuning, n.string, n.fret);
    const targetOffset = (Number(tuning[targetString]) || 0);
    const targetFret   = pitch - openMidi[targetString] - targetOffset;

    if (!Number.isInteger(targetFret) || targetFret < 0 || targetFret > 24) return null;
    return { targetString, targetFret };
}

// Return true when every note in the current selection can move one
// string in `direction` without leaving the fret range [0, 24].
export function _canMoveString(direction) {
    if (!S.sel || S.sel.size === 0) return false;
    if (isKeysArr()) return false;
    for (const idx of S.sel) {
        if (_getMoveStringResult(idx, direction) === null) return false;
    }
    return true;
}
// ────────────────────────────────────────────────────────────────────
// Suggest-position WRITE path (V4/VA.3) — the wiring around the pure
// resolver above. Adds in the piano roll for a FRETTED part resolve their
// SOUNDING pitch to a {string, fret} through _suggestPositionPure; an
// unambiguous pick is written and marked SUGGESTED (not confirmed), an
// ambiguous one opens an explicit confirm popover. The machine enumerates,
// it never silently decides — "a confidently-wrong tab is worse than an
// honest gap."
// ────────────────────────────────────────────────────────────────────
// Human-readable reasons for a resolver refusal (resolved:null), shown in the
// confirm popover's subtitle or a status line when no free string exists.
export const _ROLL_REFUSE_REASONS = {
    'out-of-range':          'that pitch is out of range for this tuning',
    'string-occupied':       'every playable string is already in use here',
    'outside-anchor-window': 'it is only reachable outside the current hand position',
    'open-vs-fretted':       'it can play as an open string or a fretted note — your call',
};

// The effective fret-hand anchor list for an arrangement: the authored set
// (anchors_user) when present, else the computed fallback (anchors). Matches
// how the anchor lane treats a non-empty anchors_user as the complete set.
export function _rollAnchorList(arr) {
    if (!arr) return [];
    if (Array.isArray(arr.anchors_user) && arr.anchors_user.length) return arr.anchors_user;
    return Array.isArray(arr.anchors) ? arr.anchors : [];
}

// Strings sounding across `time` — a string can't play two notes at the same
// instant. A note occupies its string from n.time to n.time+sustain (a
// zero-sustain note occupies only its onset). `except` skips notes being edited
// from their own occupancy check: a single index, a Set of indices, or -1/null
// for none (so a multi-note drag can exclude its whole moving set).
export function _occupiedStringsAt(arr, time, except) {
    const skip = except instanceof Set ? except
        : (typeof except === 'number' && except >= 0 ? new Set([except]) : null);
    const occ = new Set();
    const nn = (arr && Array.isArray(arr.notes)) ? arr.notes : [];
    for (let i = 0; i < nn.length; i++) {
        if (skip && skip.has(i)) continue;
        const n = nn[i];
        if (!n || typeof n.time !== 'number') continue;
        const end = n.time + (n.sustain || 0);
        if (time >= n.time - 1e-6 && time <= end + 1e-6) occ.add(n.string);
    }
    return occ;
}

// A note whose FRET is coupled to a technique, so a roll pitch-move can't repick
// its string/fret without corrupting the technique's meaning (V5): a slide
// targets a fret, a bend/harmonic anchors to one. Such notes REFUSE the roll
// pitch-move (edit them in the fretted views). Pitch-portable techniques
// (palm mute, vibrato, accent…) ride along and don't lock.
export function _positionLocked(n) {
    const t = (n && n.techniques) || {};
    return t.slide_to >= 0 || t.slide_unpitch_to >= 0
        || t.bend > 0 || (Array.isArray(t.bend_values) && t.bend_values.length > 0)
        || !!t.harmonic || !!t.harmonic_pinch;
}

// Live pitch-MOVE by drag in the fretted roll (VA.3): `dy` is a SOUNDING-pitch
// delta; the resolver repicks {string,fret} at the new pitch, biased to keep the
// hand where it was (prevNote = the note's original fret). `snappedDt` is the
// shared group time delta (already snapped + clamped ≥ 0 by _groupTimeDeltaPure)
// and always applies (a pitch-domain edit). A position-locked note, or a pitch
// the resolver refuses (ambiguous / out of the hand window / occupied), HOLDS at
// its last resolvable position — the note visibly sticks rather than the machine
// guessing. The drop (onMouseUp) commits the net change as a suggested MoveNoteCmd.
export function _rollDragPitchMove(nn, snappedDt, dy) {
    const arr = S.arrangements[S.currentArr];
    const ctx = _rollPitchCtx();
    if (!arr || !ctx) return;
    const dMidi = -Math.round(dy / PIANO_LANE_H);
    const moving = new Set(S.drag.indices);
    // Time always applies (a pitch-domain edit); gather the actual pitch-movers.
    const movers = [];
    for (let i = 0; i < S.drag.indices.length; i++) {
        const ni = S.drag.indices[i];
        const n = nn[ni];
        if (!n) continue;
        n.time = S.drag.origTimes[i] + snappedDt;
        if (dMidi === 0 || _positionLocked(n)) continue;   // no pitch move / technique-locked ⇒ hold
        const origPitch = _soundingPitchPure(
            ctx.openMidi, ctx.tuning, ctx.capo, S.drag.origStrings[i], S.drag.origFrets[i]);
        if (origPitch === null) continue;
        movers.push({ n, target: origPitch + dMidi, prevFret: S.drag.origFrets[i] });
    }
    // Resolve SEQUENTIALLY, in ascending target sounding-pitch (ties keep drag
    // order — Array.sort is stable). Each resolved member's chosen string joins
    // the occupancy the later members see, so two members of a vertically-dragged
    // chord can't independently pick the SAME string: at save reconstructChords
    // does frets[n.string] = n.fret, and a shared string would drop a member
    // (the chord template silently loses a note). A member the resolver refuses
    // HOLDS its old position and contributes NO occupancy (unchanged behaviour).
    movers.sort((a, b) => a.target - b.target);
    const claimed = [];   // {time, end, string} chosen by already-resolved siblings this drag
    for (const mv of movers) {
        const n = mv.n;
        const occ = _occupiedStringsAt(arr, n.time, moving);
        // Full interval overlap (not just onset containment): movers are ordered
        // by pitch, not time, so a later-resolved member can start BEFORE an
        // already-claimed one yet sustain through it — both directions collide.
        const nEnd = n.time + (n.sustain || 0);
        for (const c of claimed) {
            if (n.time <= c.end + 1e-6 && nEnd >= c.time - 1e-6) occ.add(c.string);
        }
        const res = _suggestPositionPure(
            mv.target, n.time, { fret: mv.prevFret }, _rollAnchorList(arr), occ, ctx);
        if (res.resolved) {
            n.string = res.resolved.string;
            n.fret = res.resolved.fret;
            claimed.push({ time: n.time, end: n.time + (n.sustain || 0), string: res.resolved.string });
        }
    }
}

// The note immediately before `time` (greatest onset strictly earlier) — gives
// the resolver a previous-hand-position reference for its least-travel tiebreak.
export function _prevNoteBefore(arr, time, exceptIdx) {
    const nn = (arr && Array.isArray(arr.notes)) ? arr.notes : [];
    let best = null;
    for (let i = 0; i < nn.length; i++) {
        if (i === exceptIdx) continue;
        const n = nn[i];
        if (!n || typeof n.time !== 'number') continue;
        if (n.time < time - 1e-6 && (!best || n.time > best.time)) best = n;
    }
    return best;
}

// Add a note at a SOUNDING pitch in the roll (fretted part), routed through the
// resolver. Unambiguous ⇒ write + mark suggested; ambiguous/refused ⇒ open the
// confirm popover. `cx,cy` are the click coords (reserved for popover placement).
export function _rollAddByPitch(pitch, time, cx, cy) {
    if (!S.arrangements || !S.arrangements.length) return;
    const arr = S.arrangements[S.currentArr];
    const ctx = _rollPitchCtx();
    if (!arr || !ctx) return;
    const occ = _occupiedStringsAt(arr, time, -1);
    const res = _suggestPositionPure(
        pitch, time, _prevNoteBefore(arr, time, -1), _rollAnchorList(arr), occ, ctx);
    if (res.resolved) {
        _commitAddResolved(res.resolved, time, true);
    } else {
        host.rollConfirmPosition(res, pitch, time, occ, cx, cy);
    }
}

// A sensible default LENGTH for a roll-added note (Logic-style: a new note lands
// at the grid length, then you drag its edge to resize — no typed-sustain dialog).
// One snap step at `time`, or one beat when snap is off; a small fallback with no
// tempo grid. Never zero, so the note is visible and its edge is grabbable.
export function _defaultAddSustain(time) {
    if (Array.isArray(S.beats) && S.beats.length >= 2) {
        const b = beatOf(S.beats, time);
        const sv = _editorEffectiveSnapValuePure(S.snapEnabled, SNAP_VALUES[S.snapIdx]);
        if (sv) {
            const subs = _editorSnapSubdivisionsPure(sv);
            const step = timeOf(S.beats, b + 1 / subs) - timeOf(S.beats, b);
            if (step > 0.001) return step;
        }
        const beatDur = timeOf(S.beats, b + 1) - timeOf(S.beats, b);
        if (beatDur > 0.001) return beatDur;
    }
    return 0.25;
}

// Write a resolved {string,fret} as a new note. `suggested` marks it as a
// machine pick (dimmed/dashed until confirmed); a user pick from the popover is
// born confirmed. The command carries `suggestResolved` so it passes the
// read-only-roll lock — this writer IS the sanctioned replacement for that lock.
export function _commitAddResolved(pos, time, suggested) {
    const note = { time, string: pos.string, fret: pos.fret, sustain: _defaultAddSustain(time), techniques: {} };
    const cmd = new AddNoteCmd(note);
    cmd.suggestResolved = true;
    cmd.markSuggested = !!suggested;
    S.history.exec(cmd);
    host.editBlipAt();
    S.sel.clear();
    if (cmd.idx >= 0) S.sel.add(cmd.idx);
    host.draw();
    host.updateStatus();
    const where = pos.fret === 0 ? `open string ${pos.string}` : `string ${pos.string} fret ${pos.fret}`;
    setStatus(suggested ? `Added ${where} (suggested — confirm to lock in)` : `Added ${where}`);
}

// Confirm the machine's pick for the selected suggested notes: clears their
// suggested marks (undo re-marks exactly those). Ref-based so it round-trips
// regardless of index shuffles; `suggestResolved` passes the read-only-roll lock
// (it only changes advisory marks, never note data).
export class AcceptPositionsCmd {
    constructor(noteRefs) {
        this.wereSuggested = (noteRefs || []).filter(n => _isSuggested(n));
        this.suggestResolved = true;
    }
    exec()     { for (const n of this.wereSuggested) _clearSuggested(n); }
    rollback() { for (const n of this.wereSuggested) _markSuggested(n); }
}

export function _execAcceptPositions() {
    const idxs = host.editorCurrentNoteIndices();
    const nn = notes();
    const refs = idxs.map(i => nn[i]).filter(n => n && _isSuggested(n));
    if (!refs.length) { setStatus('No suggested positions to accept.'); return; }
    S.history.exec(new AcceptPositionsCmd(refs));
    host.draw();
    host.updateStatus();
    setStatus(`Accepted ${refs.length} position${refs.length === 1 ? '' : 's'}`);
}

// Undo-able command: move a set of notes to adjacent strings, adjusting
// frets to preserve absolute pitch.  `moves` is an array of
// { index, oldString, oldFret, newString, newFret }.
export class MoveToStringCmd {
    constructor(moves) { this.moves = moves; this._reMark = []; }
    exec() {
        const nn = notes();
        // Deliberately moving a note's position (string-move / VA.5 cycle)
        // CONFIRMS it — the user has now chosen where it plays, so drop any
        // suggested mark. Snapshot the refs first so rollback re-marks exactly
        // those (undo restores the suggested state). typeof-guarded for
        // extracted-test envs without the mark helpers.
        this._reMark = [];
        const canMark = typeof _isSuggested === 'function';
        for (const m of this.moves) {
            const note = nn[m.index];
            if (canMark && _isSuggested(note)) { this._reMark.push(note); _clearSuggested(note); }
            nn[m.index].string = m.newString;
            nn[m.index].fret   = m.newFret;
        }
    }
    rollback() {
        const nn = notes();
        for (const m of this.moves) {
            nn[m.index].string = m.oldString;
            nn[m.index].fret   = m.oldFret;
        }
        if (typeof _markSuggested === 'function') for (const note of this._reMark) _markSuggested(note);
    }
}

// Build the MoveToStringCmd payload and execute it for all selected notes.
export function _getMoveStringSameFretResult(noteIdx, direction) {
    if (isKeysArr()) return null;
    const arr = S.arrangements[S.currentArr];
    if (!arr) return null;
    const n = notes()[noteIdx];
    if (!n) return null;
    const targetString = n.string + direction;
    if (targetString < 0 || targetString >= _stringCountFor(arr)) return null;
    return { targetString, targetFret: n.fret };
}

export function _execMoveStringSameFret(direction) {
    const idxs = host.editorCurrentNoteIndices();
    if (!idxs.length) { setStatus('Select notes first'); return false; }
    const nn = notes();
    const moves = [];
    for (const idx of idxs) {
        const n = nn[idx];
        const result = _getMoveStringSameFretResult(idx, direction);
        if (!n || !result) { setStatus('Selection cannot move to that string.'); return true; }
        moves.push({
            index: idx,
            oldString: n.string,
            oldFret: n.fret,
            newString: result.targetString,
            newFret: result.targetFret,
        });
    }
    if (!moves.length) return true;
    S.history.exec(new MoveToStringCmd(moves));
    host.editBlipAt();
    host.draw();
    host.renderInspector();
    return true;
}
export function _execMoveString(direction) {
    const nn = notes();
    const moves = [];
    for (const idx of S.sel) {
        const n = nn[idx];
        const result = _getMoveStringResult(idx, direction);
        if (!result) return; // guard — shouldn't happen if menu item was enabled
        moves.push({
            index:     idx,
            oldString: n.string,
            oldFret:   n.fret,
            newString: result.targetString,
            newFret:   result.targetFret,
        });
    }
    if (!moves.length) return;
    S.history.exec(new MoveToStringCmd(moves));
    host.editBlipAt();
    host.draw();
    host.renderInspector();
}

// Shift+↑/↓ in the piano roll on a FRETTED part (VA.5): cycle each
// selected note independently through its valid same-pitch positions.
// The roll's Y axis is pitch, so the string axis those keys move along in
// String view doesn't exist here — cycling is what "move up/down" honestly
// means. A confirmed-by-choice write that can never change pitch, so the
// command carries `pitchPreserving` and passes the read-only-roll lock
// (see EditHistory.exec); everything else stays locked until the
// suggest-position writer lands. Single-position notes are skipped, not
// refused — a multi-select cycles what it can.
export function _execCyclePosition(direction) {
    const idxs = host.editorCurrentNoteIndices();
    if (!idxs.length) { setStatus('Select notes first'); return true; }
    if (isKeysArr()) return true;           // keys DATA: no positions to cycle
    const arr = S.arrangements[S.currentArr];
    if (!arr) return true;
    const laneCount = _stringCountFor(arr);
    const rawTuning = Array.isArray(arr.tuning) ? arr.tuning : [];
    const tuning = rawTuning.slice(0, laneCount);
    while (tuning.length < laneCount) tuning.push(0);
    const openMidi = _openMidiForArr(arr, laneCount);
    const nn = notes();
    const moves = [];
    for (const idx of idxs) {
        const n = nn[idx];
        if (!n) continue;
        const next = _cycleStepPure(
            _cyclePositionCandidatesPure(openMidi, tuning, laneCount, n.string, n.fret),
            n.string, n.fret, direction);
        if (!next) continue;
        moves.push({
            index: idx,
            oldString: n.string,
            oldFret: n.fret,
            newString: next.string,
            newFret: next.fret,
        });
    }
    if (!moves.length) { setStatus('No alternate positions for the selection.'); return true; }
    const cmd = new MoveToStringCmd(moves);
    cmd.pitchPreserving = true;
    S.history.exec(cmd);
    host.editBlipAt();
    host.draw();
    host.renderInspector();
    return true;
}

// Normalize `arr.tuning` so its length equals the arrangement's *real*
// string count instead of the RS-XML padded length (which is always 6
// for both 4-string bass and 6-string guitar). Without this, an
// add-string on a 4-string bass loaded from RS XML would treat the
// padded 6-slot tuning as 6 real strings and extend to 7. We slice
// excess zero-tail padding when tuning.length > realCount and pad
// when shorter. Idempotent — safe to call before every mutation.
export function _normalizeTuningToLanes(arr, realCount) {
    let t = Array.isArray(arr.tuning) ? arr.tuning.slice() : [];
    if (t.length > realCount) {
        // Drop trailing zeros first (RS-XML padding). Callers compute
        // `realCount` via `_stringCountFor(arr)` which already factors
        // in any non-zero high-index offsets, so anything left after
        // that trim is stale and the explicit slice below honours the
        // length contract.
        while (t.length > realCount && t[t.length - 1] === 0) {
            t.pop();
        }
        if (t.length > realCount) {
            t = t.slice(0, realCount);
        }
    }
    while (t.length < realCount) t.push(0);
    arr.tuning = t;
}

export class AddStringCmd {
    constructor(arrIdx, position) {
        this.arrIdx = arrIdx;
        this.position = position;
    }
    _arr() { return S.arrangements[this.arrIdx]; }
    exec() {
        const arr = this._arr();
        // Normalize against `_stringCountFor(arr)` rather than the
        // global `lanes()` which reads from `S.currentArr`. Undo/redo
        // can fire after the user has switched arrangements, so we
        // must compute the count against the command's TARGET arr.
        _normalizeTuningToLanes(arr, _stringCountFor(arr));
        const tuning = arr.tuning.slice();
        if (this.position === 'low') {
            tuning.unshift(0);
            for (const n of arr.notes || []) n.string += 1;
            for (const ch of arr.chords || []) {
                for (const cn of ch.notes || []) cn.string += 1;
            }
            for (const ct of arr.chord_templates || []) {
                if (Array.isArray(ct.frets)) ct.frets.unshift(-1);
                if (Array.isArray(ct.fingers)) ct.fingers.unshift(-1);
            }
        } else {
            tuning.push(0);
            for (const ct of arr.chord_templates || []) {
                if (Array.isArray(ct.frets)) ct.frets.push(-1);
                if (Array.isArray(ct.fingers)) ct.fingers.push(-1);
            }
        }
        arr.tuning = tuning;
        // Bump the explicit extension counter so lanes() / the save
        // detection function don't have to guess when tuning.length
        // happens to be 6 (the ambiguous bass-padded-or-real-6 case).
        arr._extendedStrings = (arr._extendedStrings || 0) + 1;
        host.resizeForLaneChange(this.arrIdx);
    }
    rollback() {
        const arr = this._arr();
        const tuning = Array.isArray(arr.tuning) ? arr.tuning.slice() : [0, 0, 0, 0, 0, 0];
        if (this.position === 'low') {
            tuning.shift();
            for (const n of arr.notes || []) n.string -= 1;
            for (const ch of arr.chords || []) {
                for (const cn of ch.notes || []) cn.string -= 1;
            }
            for (const ct of arr.chord_templates || []) {
                if (Array.isArray(ct.frets)) ct.frets.shift();
                if (Array.isArray(ct.fingers)) ct.fingers.shift();
            }
        } else {
            tuning.pop();
            for (const ct of arr.chord_templates || []) {
                if (Array.isArray(ct.frets)) ct.frets.pop();
                if (Array.isArray(ct.fingers)) ct.fingers.pop();
            }
        }
        arr.tuning = tuning;
        // AddStringCmd's rollback undoes a prior add, so decrement.
        arr._extendedStrings = Math.max(0, (arr._extendedStrings || 0) - 1);
        host.resizeForLaneChange(this.arrIdx);
    }
}

// Remove a string from the active arrangement. `position === 'low'` peels
// off the low extension (guitar 7→6 / 8→7, bass 5→4); `position === 'high'`
// peels the high C off a 6-string bass — the editor exposes both via the
// Strings modal. Callers must first verify no notes live on the targeted
// string (validation lives in the UI handler so the user gets a clear
// error message in the modal rather than a silent data drop here).
export class RemoveStringCmd {
    constructor(arrIdx, position) {
        this.arrIdx = arrIdx;
        this.position = position;
        // Snapshots filled in by exec() — keeping them off the
        // constructor means instantiation is a pure data move. If a
        // future code path ever builds a RemoveStringCmd without
        // running it (e.g. for previewing), the live arrangement
        // stays untouched.
        this.removedOffset = 0;
        this.removedTemplateCols = [];
    }
    _arr() { return S.arrangements[this.arrIdx]; }
    exec() {
        const arr = this._arr();
        // Normalize tuning to the real string count first so the
        // snapshot reflects the actual column we're dropping, not an
        // RS-XML padding zero. Snapshot happens immediately after so
        // rollback can restore the exact pre-remove state. Use
        // `_stringCountFor(arr)` (not `lanes()`) so undo/redo after
        // an arrangement switch still operates on this command's
        // TARGET arrangement.
        _normalizeTuningToLanes(arr, _stringCountFor(arr));
        const t = arr.tuning || [];
        this.removedOffset = this.position === 'low' ? t[0] : t[t.length - 1];
        this.removedTemplateCols = (arr.chord_templates || []).map(ct => {
            const fretLen = Array.isArray(ct.frets) ? ct.frets.length : 0;
            const fingerLen = Array.isArray(ct.fingers) ? ct.fingers.length : 0;
            // Empty arrays would otherwise yield colIdx == -1, store
            // `undefined`, and push that back as the rollback value —
            // corrupting the template on undo. Fall back to -1 when
            // the column doesn't exist.
            const fretCol = this.position === 'low' ? 0 : fretLen - 1;
            const fingerCol = this.position === 'low' ? 0 : fingerLen - 1;
            return {
                fret: fretLen > 0 && fretCol >= 0 ? ct.frets[fretCol] : -1,
                finger: fingerLen > 0 && fingerCol >= 0 ? ct.fingers[fingerCol] : -1,
            };
        });
        const tuning = arr.tuning.slice();
        if (this.position === 'low') {
            tuning.shift();
            for (const n of arr.notes || []) n.string -= 1;
            for (const ch of arr.chords || []) {
                for (const cn of ch.notes || []) cn.string -= 1;
            }
            for (const ct of arr.chord_templates || []) {
                if (Array.isArray(ct.frets)) ct.frets.shift();
                if (Array.isArray(ct.fingers)) ct.fingers.shift();
            }
        } else {
            tuning.pop();
            for (const ct of arr.chord_templates || []) {
                if (Array.isArray(ct.frets)) ct.frets.pop();
                if (Array.isArray(ct.fingers)) ct.fingers.pop();
            }
        }
        arr.tuning = tuning;
        arr._extendedStrings = Math.max(0, (arr._extendedStrings || 0) - 1);
        host.resizeForLaneChange(this.arrIdx);
    }
    rollback() {
        const arr = this._arr();
        const tuning = arr.tuning.slice();
        const restore = (ct, i) => {
            const cols = this.removedTemplateCols[i] || { fret: -1, finger: -1 };
            return cols;
        };
        if (this.position === 'low') {
            tuning.unshift(this.removedOffset);
            for (const n of arr.notes || []) n.string += 1;
            for (const ch of arr.chords || []) {
                for (const cn of ch.notes || []) cn.string += 1;
            }
            (arr.chord_templates || []).forEach((ct, i) => {
                const cols = restore(ct, i);
                if (Array.isArray(ct.frets)) ct.frets.unshift(cols.fret);
                if (Array.isArray(ct.fingers)) ct.fingers.unshift(cols.finger);
            });
        } else {
            tuning.push(this.removedOffset);
            (arr.chord_templates || []).forEach((ct, i) => {
                const cols = restore(ct, i);
                if (Array.isArray(ct.frets)) ct.frets.push(cols.fret);
                if (Array.isArray(ct.fingers)) ct.fingers.push(cols.finger);
            });
        }
        arr.tuning = tuning;
        // RemoveStringCmd's rollback restores the removed string, so
        // re-increment the extension counter (mirrors AddStringCmd.exec).
        arr._extendedStrings = (arr._extendedStrings || 0) + 1;
        host.resizeForLaneChange(this.arrIdx);
    }
}

// Remove a string AND every note living on it, as ONE undo step — the
// canvas −-button's confirmed path (the Strings modal keeps its hard
// "move them first" block). Composes the two existing commands so each
// half keeps its own tested exec/rollback: the notes are deleted FIRST
// (their indices are pre-shift, and RemoveStringCmd's blanket string-=1
// would otherwise push a low-string note to -1), then the string is
// peeled. Rollback runs in exact reverse order. The caller confirms with
// the user BEFORE exec — this command deletes without asking. Note it
// only covers `arr.notes`: the active arrangement is always chord-
// flattened (flattenChords on load/switch), and callers must route a
// non-flattened arrangement to the modal instead.
export class RemoveStringWithNotesCmd {
    constructor(arrIdx, position, noteIndices) {
        this.arrIdx = arrIdx;
        this.deleteCmd = new DeleteNotesCmd(noteIndices);
        this.removeCmd = new RemoveStringCmd(arrIdx, position);
    }
    _inArrangement(fn) {
        const previousArr = S.currentArr;
        const previousSelection = previousArr === this.arrIdx ? null : new Set(S.sel);
        S.currentArr = this.arrIdx;
        try { fn(); } finally {
            S.currentArr = previousArr;
            if (previousSelection) {
                S.sel.clear();
                for (const index of previousSelection) S.sel.add(index);
            }
        }
    }
    exec() {
        this._inArrangement(() => {
            this.deleteCmd.exec();
            this.removeCmd.exec();
        });
    }
    rollback() {
        this._inArrangement(() => {
            this.removeCmd.rollback();
            this.deleteCmd.rollback();
        });
    }
}

/* @pure:replace-chart:start */
// The chart fields ReplaceArrangementChartCmd swaps out — everything tied to
// the note content of an arrangement. Song-level timing (beats/sections/audio)
// and the arrangement's identity (name, tones) are deliberately NOT here.
export const _REPLACE_CHART_FIELDS = [
    'notes', 'chords', 'chord_templates', 'tuning', 'capo',
    '_extendedStrings', 'anchors_user', 'anchors', 'handshapes',
];

// Overwrite `arr`'s chart from a freshly imported `incoming` arrangement while
// keeping `arr`'s name (so keys/bass mode detection stays stable). Returns a
// snapshot for _restoreChartFields() to roll back exactly. Pure (no S / DOM) so
// it's unit-testable. Snapshots whole values/arrays by reference — never by
// index — so undo survives an arrangement switch.
export function _swapChartFields(arr, incoming) {
    const snap = {};
    for (const k of _REPLACE_CHART_FIELDS) snap[k] = arr[k];
    // Force the swapped-in chart to carry the target's display name (callers
    // set this too; belt-and-braces so a stray incoming.name can't rename the
    // arrangement or flip its keys/bass rendering mode).
    incoming.name = arr.name;
    // Deep-copy the incoming chart so the arrangement owns INDEPENDENT arrays.
    // The command flattens chords into `notes` in place after this, and redo
    // re-runs the swap from the SAME `incoming` object — sharing references
    // would bake the flattened chord notes back into `incoming` and duplicate
    // them on the next flatten/save. Chart data is plain and JSON-safe.
    const clone = (v) => (v == null ? v : JSON.parse(JSON.stringify(v)));
    arr.notes = clone(incoming.notes) || [];
    arr.chords = clone(incoming.chords) || [];
    arr.chord_templates = clone(incoming.chord_templates) || [];
    if (Array.isArray(incoming.tuning)) arr.tuning = clone(incoming.tuning);
    if (typeof incoming.capo === 'number') arr.capo = incoming.capo;
    // These were derived from the OLD notes: `_extendedStrings` tracked the old
    // tuning's lane count (let _stringCountFor re-derive from the new tuning);
    // `anchors_user`/`anchors` were hand positions at old fret/note positions
    // (the backend re-computes anchors from the new notes on save when there's
    // no authored `anchors_user`); handshapes referenced old chord instances.
    // `arr.phrases` is deliberately KEPT — phrases are time-anchored to the
    // song's sections (which this swap does not touch) and their per-level notes
    // repopulate from the new chart on save (_repopulate_phrase_levels).
    delete arr._extendedStrings;
    delete arr.anchors_user;
    delete arr.anchors;
    delete arr.handshapes;
    return snap;
}

// Restore a snapshot from _swapChartFields(). A field absent (undefined) in the
// pre-swap arrangement is deleted, not set to undefined, so the object shape
// round-trips exactly.
export function _restoreChartFields(arr, snap) {
    for (const k of Object.keys(snap)) {
        if (snap[k] === undefined) delete arr[k];
        else arr[k] = snap[k];
    }
}
/* @pure:replace-chart:end */

// Replace an existing arrangement's CHART (notes/chords/templates/tuning) with a
// freshly imported guitar/bass chart, keeping the arrangement's name, tones, and
// the song-level timeline. Undoable within the session (one step); the save
// round-trip resets history, so a snapshot-based rollback is all this needs.
export class ReplaceArrangementChartCmd {
    constructor(arrIdx, incoming) {
        this.arrIdx = arrIdx;
        this.incoming = incoming;
        this._snap = null;
    }
    _arr() { return S.arrangements[this.arrIdx]; }
    exec() {
        const arr = this._arr();
        this._snap = _swapChartFields(arr, this.incoming);
        // Fold the imported chords into `notes` (the editor's live model keeps
        // the active chart flattened). Doing it INSIDE exec — on the target arr,
        // from a fresh deep copy — means a redo reproduces the identical state
        // and never double-flattens.
        _flattenArrChords(arr);
        // The new chart may change the lane count (4↔5/6 bass, 6↔7/8 guitar), so
        // recompute LANE_H if the target is the visible arrangement (rAF-guarded;
        // no-op otherwise). Covers redo; the initial import also resizes from the
        // handler after it switches S.currentArr.
        host.resizeForLaneChange(this.arrIdx);
    }
    rollback() {
        _restoreChartFields(this._arr(), this._snap);
        host.resizeForLaneChange(this.arrIdx);
    }
}
