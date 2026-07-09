/* Slopsmith Arrangement Editor — keys / piano-roll model.
 *
 * Which view a part opens in (fretted lanes vs piano roll), the persisted
 * per-part preference behind that, and the roll's own MIDI⇄y geometry. Reads
 * `S`, the lane model and the canvas geometry. It touches the browser in two
 * places only: `localStorage`, inside `_viewPrefs`/`_viewPrefsSave`; and
 * `_rollLockNotice`, which reports through `setStatus` (src/ui.js).
 *
 * `PIANO_LANE_H` and `pianoRange` are `export let`, not consts: they are
 * re-derived per arrangement. Their sole writer, `updatePianoRange`, lives here,
 * so importers read them as live bindings and none of them can write — the same
 * shape geometry.js uses for its lane metrics, and the reason neither needs a
 * container like lanes.js's `LC`.
 */

import { WAVEFORM_H } from './geometry.js';
import { setStatus } from './ui.js';
import { _openMidiForArr, _soundingPitchPure, _stringCountFor } from './lanes.js';
import { notes } from './notes.js';
import { S } from './state.js';
import { PIANO_NOTE_NAMES } from './theory.js';

// ── Piano roll constants ────────────────────────────────────────────
export const PIANO_OCTAVE_COLORS = [
    '#ff4466', '#ff8844', '#ffcc33', '#66dd55', '#44ccaa',
    '#44aaff', '#7766ff', '#cc55ff', '#ff55aa', '#aaaaaa',
];
export let PIANO_LANE_H = 10;  // pixels per MIDI semitone
export let pianoRange = { lo: 36, hi: 96 }; // MIDI range, updated per arrangement
// Names that should open in keys (piano-roll) editor mode. Arrangements
// named "Piano", "Keyboard", or "Synth" render as piano-roll charts rather
// than 6-string guitar charts.
export const KEYS_PATTERN = /^(keys|piano|keyboard|synth)/i;

// Per-part editing-view choice (V2/V9 of EDITOR-VIEW-MODALITY-DESIGN):
// 'string' (fretted lanes) or 'piano' (the roll). Keys-DATA arrangements
// are piano-locked — their wire packing (string*24+fret) has no string
// semantics for the lane view to show. Fretted parts default to 'string'
// and may opt into the roll per part. The choice is EDITOR state
// (localStorage per song), never pack data.
export function _partViewKeyPure(arr) {
    if (!arr) return '';
    const id = arr.id;
    return (id !== undefined && id !== null && String(id) !== '')
        ? String(id)
        : (arr.name || '');
}
export function _viewForPure(arrName, storedMode) {
    if (KEYS_PATTERN.test(arrName || '')) return 'piano';
    return storedMode === 'piano' ? 'piano' : 'string';
}

// Per-song view prefs, cached so draw-path predicates never parse
// localStorage per frame. Keyed song filename → { partKey: 'piano' }.
let _viewPrefCache = null;
let _viewPrefFor = null;
export function _viewPrefs() {
    const key = 'editorViewPref:' + (S.filename || '');
    if (_viewPrefFor === key && _viewPrefCache) return _viewPrefCache;
    _viewPrefFor = key;
    _viewPrefCache = {};
    // Unsaved songs don't read a bare slot every unsaved song would share.
    if (!S.filename) return _viewPrefCache;
    try {
        const raw = localStorage.getItem(key);
        if (raw) {
            const o = JSON.parse(raw);
            if (o && typeof o === 'object' && !Array.isArray(o)) _viewPrefCache = o;
        }
    } catch (_) { /* ignore */ }
    return _viewPrefCache;
}
export function _viewPrefsSave() {
    if (!S.filename) return;
    try {
        const key = 'editorViewPref:' + S.filename;
        if (Object.keys(_viewPrefCache || {}).length) {
            localStorage.setItem(key, JSON.stringify(_viewPrefCache));
        } else {
            localStorage.removeItem(key);
        }
    } catch (_) { /* ignore */ }
}
export function viewFor(arr) {
    return _viewForPure(arr && arr.name, _viewPrefs()[_partViewKeyPure(arr)]);
}

// Keys-DATA predicate: the active arrangement's wire packing is pitch
// (string*24 + fret) — a keys/piano/synth part. DATA-SEMANTICS sites key
// off this: string-move helpers, chord-sibling grouping, anchors, MIDI
// record. Split from isKeysMode() when the view became a per-part choice.
export function isKeysArr() {
    if (!S.arrangements.length) return false;
    const arr = S.arrangements[S.currentArr];
    return !!(arr && KEYS_PATTERN.test(arr.name || ''));
}

// Piano SURFACE predicate: the piano-roll view is active for the current
// part — keys data (always), or a fretted part opted into the roll. Draw
// geometry, hit-testing, and viewport paths key off this. The name is
// historical; every legacy call site that meant "the piano surface is
// showing" keeps working unchanged.
export function isKeysMode() {
    if (!S.arrangements.length) return false;
    return viewFor(S.arrangements[S.currentArr]) === 'piano';
}

// Read-only roll: a FRETTED part shown in the piano roll (V4). Editing
// stays locked until the suggest-position write path exists — the roll
// must never write string/fret by silent guess.
export function _rollReadOnly() { return isKeysMode() && !isKeysArr(); }

export function _rollLockNotice() {
    setStatus('Piano roll is read-only for fretted parts — Shift+↑/↓ cycles same-pitch positions; switch to String view to edit (suggest-position editing is coming)');
}

// Sounding-pitch context for showing a FRETTED part in the roll — hoisted
// once per draw/hit-test pass, never per note. Null for keys parts (their
// packing IS the roll pitch).
export function _rollPitchCtx() {
    if (!S.arrangements.length) return null;
    const arr = S.arrangements[S.currentArr];
    if (!arr || KEYS_PATTERN.test(arr.name || '')) return null;
    const laneCount = _stringCountFor(arr);
    const tuning = (Array.isArray(arr.tuning) ? arr.tuning : []).slice(0, laneCount);
    while (tuning.length < laneCount) tuning.push(0);
    return {
        openMidi: _openMidiForArr(arr, laneCount),
        tuning,
        capo: Number(arr.capo) || 0,
    };
}

// Roll Y-axis MIDI for one note: keys packing, or sounding pitch (D4:
// openMidi + tuning + capo + fret) for fretted. Null = unresolvable —
// callers skip the note rather than paint it at a wrong pitch.
export function _rollMidiForNote(n, rctx) {
    if (!rctx) return noteToMidi(n.string, n.fret);
    return _soundingPitchPure(rctx.openMidi, rctx.tuning, rctx.capo, n.string, n.fret);
}

export function pianoLaneCount() { return pianoRange.hi - pianoRange.lo + 1; }

export function midiToNote(midi) { return PIANO_NOTE_NAMES[midi % 12] + (Math.floor(midi / 12) - 1); }
export function isBlackKey(midi) { const pc = midi % 12; return pc===1||pc===3||pc===6||pc===8||pc===10; }
// Equal-tempered frequency (Hz) of a MIDI note: A4 (69) = 440. Used by the
// keyboard-gutter audition (click a key → hear its pitch). Returns 0 for a
// non-finite input so a caller never schedules a NaN-frequency oscillator.
export function midiToFreq(midi) {
    const m = Number(midi);
    if (!Number.isFinite(m)) return 0;
    return 440 * Math.pow(2, (m - 69) / 12);
}

// Is (x, y) inside the piano keyboard gutter — the LABEL_W-wide column beside
// the roll's pitch lanes? Used to route a click to pitch audition instead of
// the note-edit pipeline. Half-open on every edge so it never overlaps the
// note area (x >= labelW) or the waveform/beat strips above/below.
export function _inKeyboardGutterPure(x, y, labelW, waveformTop, laneBottom) {
    return x >= 0 && x < labelW && y >= waveformTop && y < laneBottom;
}

export function noteToMidi(string, fret) { return string * 24 + fret; }
export function midiToString(midi) { return Math.floor(midi / 24); }
export function midiToFret(midi) { return midi % 24; }

// Piano roll Y: higher MIDI = higher on screen (lower Y)
export function midiToY(midi) { return WAVEFORM_H + (pianoRange.hi - midi) * PIANO_LANE_H; }
export function yToMidi(y) {
    const m = pianoRange.hi - Math.floor((y - WAVEFORM_H) / PIANO_LANE_H);
    return Math.max(pianoRange.lo, Math.min(pianoRange.hi, m));
}

// expandOnly=true preserves any wider current range (used during in-place
// edits so adding a low note doesn't collapse the viewport and lose
// previously-clickable upper lanes). Load/import/arrangement-switch call
// without it so the viewport snaps cleanly to the new arrangement.
export function updatePianoRange(expandOnly = false) {
    const nn = notes();
    // Fretted parts fit the range to SOUNDING pitch; keys keep the packing
    // (noteToMidi encodes up to string=5, fret=23 → max 143, matching the
    // drag-clamp ceiling). Unresolvable fretted notes are skipped.
    const rctx = typeof _rollPitchCtx === 'function' ? _rollPitchCtx() : null;
    let lo = 143, hi = 0;
    for (const n of nn) {
        const m = _rollMidiForNote(n, rctx);
        if (m === null) continue;
        if (m < lo) lo = m;
        if (m > hi) hi = m;
    }
    if (lo > hi) {
        // Empty arrangement: expose the full 88-key range so any starting
        // pitch is clickable. Lanes are deliberately thin (~4px) to keep the
        // viewport within ~352px — once a note is added the range snaps to
        // the actual note range and lanes return to normal height.
        pianoRange = { lo: 21, hi: 108, _fromEmpty: true };
        PIANO_LANE_H = 4;
        return;
    }
    // Expand to octave boundaries with padding; ceiling matches drag-clamp max of 143.
    let nlo = Math.max(0, Math.floor(lo / 12) * 12 - 6);
    let nhi = Math.min(143, Math.ceil((hi + 1) / 12) * 12 + 5);
    if (expandOnly && pianoRange && !pianoRange._fromEmpty) {
        nlo = Math.min(nlo, pianoRange.lo);
        nhi = Math.max(nhi, pianoRange.hi);
    }
    pianoRange = { lo: nlo, hi: nhi };
    // Adjust lane height to fill available space nicely. Allow down to 4px
    // so wide note ranges (many octaves) remain visible without overflowing
    // the canvas wrapper.
    PIANO_LANE_H = Math.max(4, Math.min(14, 350 / (nhi - nlo + 1)));
}
