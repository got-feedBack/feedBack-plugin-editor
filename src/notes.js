/* Slopsmith Arrangement Editor — note & chord data model (pure tier).
 *
 * The active arrangement's note/chord accessors, plus the pure arithmetic over
 * them: sustain resizing, bend curves, and the teaching-mark options. Reads `S`;
 * no DOM, no undo history.
 *
 * Chord-template relinking, handshape normalization and reconstructChords are
 * deliberately still in main.js — they are entangled with S.history and with
 * three sandbox tests that drive them against a fabricated `S`.
 */

import { S } from './state.js';

// ── Active-arrangement accessors ────────────────────────────────────
export function notes() { return S.arrangements.length ? S.arrangements[S.currentArr].notes : []; }
export function chords() { return S.arrangements.length ? S.arrangements[S.currentArr].chords : []; }

// ── Sustain resizing (chord-aware) ──────────────────────────────────
export function _resizeTargetIndicesPure(noteList, index, expandChord) {
    if (!Array.isArray(noteList) || index < 0 || index >= noteList.length) return [];
    if (!expandChord) return [index];
    const n = noteList[index];
    if (!n || typeof n.time !== 'number') return [index];
    const key = n.time.toFixed(4);
    const out = [];
    for (let i = 0; i < noteList.length; i++) {
        const other = noteList[i];
        if (other && typeof other.time === 'number' && other.time.toFixed(4) === key) {
            out.push(i);
        }
    }
    return out.length ? out : [index];
}

// Collision limit for a resize. With `onlyIdx` omitted this is the group-wide
// limit (min over every member) — kept for callers that want one shared cap.
// With `onlyIdx` given it's that single member's own limit (its next same-string
// onset), while the whole group is still excluded from the collision candidates
// so chord siblings never count as colliders. Per-member group resize uses the
// latter so each member clamps independently.
export function _maxSustainBeforeCollisionPure(noteList, targetIndices, onlyIdx) {
    if (!Array.isArray(noteList) || !Array.isArray(targetIndices) || !targetIndices.length) {
        return Infinity;
    }
    const targetSet = new Set(targetIndices);
    const checkIndices = (onlyIdx === undefined || onlyIdx === null) ? targetIndices : [onlyIdx];
    let limit = Infinity;
    for (const idx of checkIndices) {
        const n = noteList[idx];
        if (!n || typeof n.time !== 'number') continue;
        for (let i = 0; i < noteList.length; i++) {
            if (targetSet.has(i)) continue;
            const other = noteList[i];
            if (!other || other.string !== n.string || typeof other.time !== 'number') continue;
            if (other.time > n.time + 0.0001) {
                limit = Math.min(limit, other.time - n.time);
            }
        }
    }
    return limit;
}

// Apply the same edge-drag `delta` to EACH target's own original sustain, so a
// group resize preserves the members' relative ring-out lengths instead of
// flattening every member to one value. `origSustains` is an array aligned to
// `targetIndices` (per member); a scalar is broadcast to all (single-note path).
// Each member is clamped independently to ≥0 and to its own collision limit — a
// member that would collide stops at its limit while the others keep extending.
export function _resizeSustainsForDeltaPure(noteList, targetIndices, origSustains, delta) {
    const d = Number(delta) || 0;
    const perMember = Array.isArray(origSustains);
    return targetIndices.map((idx, k) => {
        const orig = Number(perMember ? origSustains[k] : origSustains) || 0;
        const desired = Math.max(0, orig + d);
        const limit = _maxSustainBeforeCollisionPure(noteList, targetIndices, idx);
        return Math.max(0, Math.min(desired, limit));
    });
}

// Bend-intent (`bt`) options, in spec order.
export const BEND_INTENTS = [
    { v: 0, label: 'Bend up' },
    { v: 1, label: 'Release' },
    { v: 2, label: 'Pre-bend' },
    { v: 3, label: 'Pre-bend + release' },
    { v: 4, label: 'Round-trip' },
];

// Generate a sensible bend curve ([{t, v}], t = seconds-from-onset) for a
// given intent `bt`, peak `bn` and note `sustain`. Used to seed the curve
// editor and by the preset buttons.
export function bendPresetCurve(bt, bn, sustain) {
    const T = sustain > 0 ? sustain : 1.0;
    const peak = Math.max(0, bn) || 0;
    const mid = Math.round(T * 0.5 * 1000) / 1000;
    const end = Math.round(T * 1000) / 1000;
    switch (Number(bt) || 0) {
        case 1: // release: held bend let down to pitch
            return [{ t: 0, v: peak }, { t: end, v: 0 }];
        case 2: // pre-bend: already bent, held
            return [{ t: 0, v: peak }, { t: end, v: peak }];
        case 3: // pre-bend + release
            return [{ t: 0, v: peak }, { t: mid, v: peak }, { t: end, v: 0 }];
        case 4: // round-trip: up then back down
            return [{ t: 0, v: 0 }, { t: mid, v: peak }, { t: end, v: 0 }];
        default: // 0 up
            return [{ t: 0, v: 0 }, { t: end, v: peak }];
    }
}

// Sanitize an authored curve for persistence: drop non-finite / non-dict
// entries, round (t to 3, v to 1) and sort by t. No magnitude clamp — mirrors
// core's `_sanitize_bend_curve` / the backend `_safe_bend_curve` (a bend can
// legitimately exceed the editor's 3-semitone authoring cap), and the curve
// canvas already bounds authored values. Returns null for empty / all-invalid
// input so an absent curve serializes as omitted, never [].
export function sanitizeBendCurve(raw) {
    if (!Array.isArray(raw)) return null;
    const out = [];
    for (const p of raw) {
        if (!p || typeof p !== 'object') continue;
        const t = Number(p.t);
        const v = Number(p.v);
        if (!Number.isFinite(t) || !Number.isFinite(v)) continue;
        out.push({
            t: Math.round(t * 1000) / 1000,
            v: Math.round(v * 10) / 10,
        });
    }
    if (!out.length) return null;
    out.sort((a, b) => a.t - b.t);
    return out;
}

// Rescale a bend curve so its peak == `peak` (preserves shape). Returns null
// when the curve is empty/invalid, `peak <= 0`, or the curve is all-zero
// (unscalable) — callers then drop the curve so the scalar `bn` and `bnv` can
// never contradict each other.
export function rescaleBendCurveToPeak(raw, peak) {
    const clean = sanitizeBendCurve(raw);
    if (!clean || !(peak > 0)) return null;
    const oldPeak = clean.reduce((m, p) => Math.max(m, p.v), 0);
    if (!(oldPeak > 0)) return null;
    const k = peak / oldPeak;
    const out = clean.map(p => ({ t: p.t, v: Math.round(p.v * k * 10) / 10 }));
    // A target peak below bnv's 0.1 precision (e.g. 0.04) rounds every point to
    // 0 — the curve can't carry the peak. Report unscalable so the caller drops
    // it and keeps the scalar bn, rather than deriving a contradictory 0.
    if (!(out.reduce((m, p) => Math.max(m, p.v), 0) > 0)) return null;
    return out;
}


// Fret-hand-finger (`fg`) picker options, in spec order (-1 unset … 4 pinky).
export const FRET_FINGER_OPTIONS = [
    { v: -1, label: 'Unset' },
    { v: 0, label: 'Thumb' },
    { v: 1, label: 'Index' },
    { v: 2, label: 'Middle' },
    { v: 3, label: 'Ring' },
    { v: 4, label: 'Pinky' },
];

// Next free strum-group key (`ch`) across a note list: max used (>= 0) + 1, or
// 0 when none is grouped yet. Used by "Group as strum" so a new gesture never
// collides with an existing one.
export function nextUnusedStrumGroup(noteList) {
    let max = -1;
    if (Array.isArray(noteList)) {
        for (const n of noteList) {
            const ch = n && n.techniques ? n.techniques.strum_group : undefined;
            if (Number.isInteger(ch) && ch > max) max = ch;
        }
    }
    return max + 1;
}

// ── Suggested-position marks ────────────────────────────────────────
// A WeakSet, not a note field: reconstructChords serializes solo notes BY
// REFERENCE (an underscore field would leak to the wire) and rebuilds chord
// members through an explicit field mapper (an extra field would vanish). A
// WeakSet is invisible to serialization by construction, and lets a
// rebuilt/replaced note object drop its mark for free.
export const _suggestedNotes = new WeakSet();
export function _markSuggested(note)  { if (note) _suggestedNotes.add(note); }
export function _clearSuggested(note) { if (note) _suggestedNotes.delete(note); }
export function _isSuggested(note)    { return !!note && _suggestedNotes.has(note); }

// Count of still-suggested (unconfirmed) notes in the current arrangement —
// drives the "positions unresolved: N" status nudge.
export function _suggestedCount() {
    if (typeof S === 'undefined' || !S.arrangements || !S.arrangements.length) return 0;
    const arr = S.arrangements[S.currentArr];
    if (!arr || !Array.isArray(arr.notes)) return 0;
    let n = 0;
    for (const note of arr.notes) if (_suggestedNotes.has(note)) n++;
    return n;
}

// Suggested-mark PERSISTENCE (editor-pref, keyed by filename, NEVER in the pack
// — mirrors beat-lock, §6/D15). The WeakSet above is object-keyed, so a save's
// flatten+reconstructChords rebuild and a reload both mint fresh note objects
// and DROP every mark: after a reload the machine's UNREVIEWED guesses would
// render as CONFIRMED and "positions unresolved: N" would reset to 0, losing
// the honest-gap contract. We persist each marked note's STABLE identity
// {time,string,fret} to localStorage and re-attach on load / post-save reflatten.
// Scoped PER ARRANGEMENT (matches _suggestedCount): the key carries the
// arrangement index, so marks authored on arrangement N restore onto N (a reload
// resets to arr 0, and a later switch to N re-attaches N's marks) instead of
// bleeding onto arr 0. Successive saves accumulate a key per arrangement; only
// the arrangement current AT a given save updates that save. Index (not name) is
// the discriminator — a part reorder is an accepted, cosmetic-only skew (marks
// are advisory). A Save-As to a new filename MIGRATES the keys to the new name
// (see editorSaveAsSloppakConfirm) so the guesses stay honest in the new file.
export function _suggestedStorageKeyPure(filename, arrIdx) {
    return 'editorSuggested:' + (filename || '') + ':' + (arrIdx >= 0 ? arrIdx : 0);
}
export function _suggestedParsePure(raw) {
    let arr = null;
    try { arr = JSON.parse(raw); } catch (_) { return []; }
    if (!Array.isArray(arr)) return [];
    const out = [];
    for (const e of arr) {
        if (!e || typeof e !== 'object') continue;
        const t = Number(e.time), s = Number(e.string), f = Number(e.fret);
        if (Number.isFinite(t) && t >= 0
            && Number.isInteger(s) && s >= 0 && Number.isInteger(f) && f >= 0) {
            out.push({ time: t, string: s, fret: f });
        }
    }
    return out;
}
// Re-mark the notes in `nn` matching a persisted identity (string+fret exact,
// |time−t| ≤ tol). Greedy 1:1 — each stored mark claims at most one note and
// each note is claimed once — so a degenerate duplicate identity can't over-mark.
// `addFn(note)` repopulates the mark (injected so this stays module-state-free).
export function _applySuggestedMarksPure(nn, marks, tol, addFn) {
    const used = new Set();
    for (const m of marks) {
        for (let i = 0; i < nn.length; i++) {
            if (used.has(i)) continue;
            const n = nn[i];
            if (n && n.string === m.string && n.fret === m.fret
                && Math.abs((n.time || 0) - m.time) <= tol) {
                addFn(n); used.add(i); break;
            }
        }
    }
}

// Persist the current arrangement's suggested marks. Call BEFORE a save churns
// note identity so localStorage matches exactly what lands on disk.
export function _saveSuggestedMarks() {
    // No real filename (create mode sets S.filename = '') ⇒ skip: an empty key
    // would be a shared slot every unsaved session bleeds marks into.
    if (typeof S === 'undefined' || !S.filename || !S.arrangements || !S.arrangements.length) return;
    const arr = S.arrangements[S.currentArr];
    const nn = (arr && Array.isArray(arr.notes)) ? arr.notes : [];
    const marks = [];
    for (const n of nn) {
        if (n && _suggestedNotes.has(n)) {
            marks.push({ time: Math.round((n.time || 0) * 1000) / 1000, string: n.string, fret: n.fret });
        }
    }
    const key = _suggestedStorageKeyPure(S.filename, S.currentArr);
    try {
        if (marks.length) localStorage.setItem(key, JSON.stringify(marks));
        else localStorage.removeItem(key);
    } catch (_) { /* localStorage unavailable */ }
}

// Re-attach persisted marks onto the current arrangement's (freshly rebuilt)
// note objects — after a load or a post-save reflatten. Adds straight to the
// WeakSet so it never re-persists. tol 2ms covers the ms-rounded save identity.
export function _restoreSuggestedMarks() {
    if (typeof S === 'undefined' || !S.filename || !S.arrangements || !S.arrangements.length) return;
    const arr = S.arrangements[S.currentArr];
    const nn = (arr && Array.isArray(arr.notes)) ? arr.notes : [];
    let raw = null;
    try { raw = localStorage.getItem(_suggestedStorageKeyPure(S.filename, S.currentArr)); } catch (_) {}
    _applySuggestedMarksPure(nn, _suggestedParsePure(raw), 2e-3, n => _suggestedNotes.add(n));
}
