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
