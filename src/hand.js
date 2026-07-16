// Keys LH/RH hand authoring — Step B of the hand arc (see the CHANGELOG's
// hand entries and EDITOR-NEXT-WINS §2). The per-note `hand` technique
// ('lh'/'rh', absent = unassigned) arrived with the MusicXML import slice;
// this module makes it AUTHORABLE and VISIBLE:
//
//   - Hand: Left / Right / Clear on the selection (Note menu) — one undo step
//     via SetTechScalarCmd.
//   - Assign hands by split… (Track menu) — the split point is a STAMPING
//     generator, not a live layer (the piano-pedagogy call): it writes
//     per-note hands in ONE undoable command, and per-note edits win
//     afterwards. Default split = middle C, matching core split_hands.
//   - Hand shading on the piano roll (View menu, default ON): LH warm /
//     RH cool body color; unassigned notes keep their octave color.
//
// Hands feed the notation hand split (core split_hands honors per-note
// hands; a hand edit flips the notation fingerprint so a stale authored
// sidecar can't freeze old hands) and, later, hands-separate practice.

import { SetTechScalarCmd, SetTechScalarPerNoteCmd } from './commands.js';
import { host } from './host.js';
import { isKeysArr, noteToMidi } from './keys.js';
import { notes } from './notes.js';
import { S } from './state.js';
import { _editorPromptText, setStatus } from './ui.js';

// Hand body colors for the roll (unassigned keeps the octave palette).
// Warm = left, cool = right — the "low strings warm" instinct maps onto
// the keyboard's low-side hand.
export const HAND_LH_COLOR = '#e8965a';
export const HAND_RH_COLOR = '#5a9de8';

/* @pure:keys-hand:start */
const _NOTE_PC = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };

// Parse a split-point entry: a MIDI number ('60') or a note name ('C4',
// 'F#3', 'Bb2' — octave -1..9, C4 = 60). Returns the MIDI int or null.
export function _parseSplitPitchPure(raw) {
    const s = String(raw == null ? '' : raw).trim();
    if (!s) return null;
    if (/^\d{1,3}$/.test(s)) {
        const n = parseInt(s, 10);
        return n >= 0 && n <= 127 ? n : null;
    }
    const m = /^([a-gA-G])([#b]?)(-?\d)$/.exec(s);
    if (!m) return null;
    let pc = _NOTE_PC[m[1].toLowerCase()];
    if (m[2] === '#') pc += 1;
    if (m[2] === 'b') pc -= 1;
    const midi = (parseInt(m[3], 10) + 1) * 12 + pc;
    return midi >= 0 && midi <= 127 ? midi : null;
}

// The stamp: midi < split → 'lh', midi >= split → 'rh' (matching core
// split_hands' `mean >= MIDDLE_C → rh` orientation at the default split).
export function _handStampValuesPure(midis, splitMidi) {
    return midis.map(m => (m < splitMidi ? 'lh' : 'rh'));
}
/* @pure:keys-hand:end */

// ── Hand shading view pref (global, default ON) ──────────────────────
let _shadingOn = null;
export function _editorHandShadingEnabled() {
    if (_shadingOn === null) {
        try { _shadingOn = localStorage.getItem('editorHandShading') !== '0'; }
        catch (_) { _shadingOn = true; }
    }
    return _shadingOn;
}
export function editorToggleHandShading(force) {
    const next = typeof force === 'boolean' ? force : !_editorHandShadingEnabled();
    _shadingOn = next;
    try { localStorage.setItem('editorHandShading', next ? '1' : '0'); } catch (_) { /* private mode */ }
    setStatus(next
        ? 'Hand shading on — LH notes draw warm, RH cool, unassigned keep their octave color'
        : 'Hand shading off');
    host.draw();
    return next;
}

// ── Selection hand set (Note ▸ Hand) ─────────────────────────────────
function _selectedKeysIndices() {
    if (!isKeysArr()) {
        setStatus('Hands apply to keys tracks — switch to a keys arrangement first.');
        return null;
    }
    const idxs = [...S.sel];
    if (!idxs.length) {
        setStatus('Select notes first, then assign a hand.');
        return null;
    }
    return idxs;
}

function _setHand(hand) {
    const idxs = _selectedKeysIndices();
    if (!idxs) return false;
    S.history.exec(new SetTechScalarCmd(idxs, 'hand', hand));
    host.draw();
    host.updateStatus();
    const label = hand === 'lh' ? 'left hand' : hand === 'rh' ? 'right hand' : 'unassigned';
    setStatus(`${idxs.length} note${idxs.length === 1 ? '' : 's'} → ${label}`);
    return true;
}

// ── The split-point stamp (Track ▸ Assign hands by split…) ───────────
export async function editorAssignHandsBySplit() {
    if (!isKeysArr()) {
        setStatus('Assign hands applies to keys tracks — switch to a keys arrangement first.');
        return;
    }
    const nn = notes();
    // Selection scopes the stamp; empty selection = the whole part.
    const idxs = S.sel.size ? [...S.sel] : nn.map((_, i) => i);
    if (!idxs.length) { setStatus('No notes to assign.'); return; }
    const raw = await _editorPromptText({
        title: 'Assign hands by split',
        label: 'Split note — below it → left hand, at or above → right hand',
        value: 'C4',
        placeholder: 'C4, F#3, or a MIDI number',
    });
    if (raw == null) return;   // cancelled
    const split = _parseSplitPitchPure(raw);
    if (split === null) {
        setStatus(`Couldn't read “${raw}” — try a note name like C4 or a MIDI number.`);
        return;
    }
    const midis = idxs.map(i => noteToMidi(nn[i].string, nn[i].fret));
    const values = _handStampValuesPure(midis, split);
    S.history.exec(new SetTechScalarPerNoteCmd(idxs, 'hand', values));
    host.draw();
    host.updateStatus();
    const lh = values.filter(v => v === 'lh').length;
    setStatus(`Hands assigned: ${lh} left / ${values.length - lh} right (split at ${raw}). Per-note overrides win from here.`);
}

if (typeof window !== 'undefined') {
    window.editorSetHandLeft = () => _setHand('lh');
    window.editorSetHandRight = () => _setHand('rh');
    window.editorSetHandClear = () => _setHand(null);
    window.editorAssignHandsBySplit = editorAssignHandsBySplit;
    window.editorToggleHandShading = () => editorToggleHandShading();
}
