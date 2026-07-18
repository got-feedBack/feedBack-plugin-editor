// Input layer: keyboard shortcut dispatch + all the _editorX command
// implementations (fret/sustain/snap/seek/bookmarks/duplicate/section-cmds/tone/
// handshape/import/tempo), the shortcut panel, and the canvas context menu.
// main.js wires onKeyDown / onContextMenu onto the canvas in init(); everything
// the commands refresh in the composition root goes through host.

import { AddAnchorCmd, AddHandshapeCmd, AddToneChangeCmd, RemoveAnchorCmd, RemoveHandshapeCmd, RemoveToneChangeCmd, _anchorLaneTopY, _currentAnchorArr, _currentToneArr, _ensureTones, _handshapeLaneTopY, _readAnchorSnapshot, onAnchorLaneContextMenu, onHandshapeLaneContextMenu, onToneLaneContextMenu } from './annotation-lanes.js';
import { _editBlipAt, _editorToggleFollow, _editorToggleGuideClap, _editorToggleLoopAB, _editorToggleMetronome, _editorToggleOnsetStrip, _editorToggleSnapMode, _ensureOnsetsShifted, editorTogglePlayAllTracks, ensureGuideOnsetsShifted, startPlayback, stopPlayback } from './audio.js';
import { editorSuggestFingers } from './anchor-resolve.js';
import { _suggestActive, _suggestCompute, _suggestDismiss, _suggestProposals } from './tempo-suggest.js';
import { _clickSourcePure, _trackSessionSourcesPure } from './track-session.js';
import { _zonesDismiss } from './tempo-zones.js';
import { editorToggleMixerPanel } from './mixer-panel.js';
import { canvas } from './canvas.js';
import { AddNoteCmd, ChangeFretCmd, ChangeFretGroupCmd, DeleteNotesCmd, MoveNoteCmd, ResizeSustainGroupCmd, SetPitchedSlideTargetsCmd, SetTeachingMarkCmd, SplitNotesCmd, ToggleTechniqueCmd, _execCyclePosition, _execMoveString, _execMoveStringSameFret, _rollAddByPitch, _splitViablePure, _withStableSelection } from './commands.js';
import { hideContextMenu, promptBend, promptFret, promptSlide, promptSlideUnpitch, showContextMenu } from './context-menu.js';
import { _drumEditorDeleteSelection, _drumEditorNudgeVelocity, _drumEditorSetVelocity, _drumEditorToggleArticulation, _editorToggleDrumDensity } from './drum.js';
import { ANCHOR_LANE_H, HS_LANE_H, LABEL_W, LANE_H, TIMELINE_TOP, TONE_LANE_H, WAVEFORM_H, xToTime, yToStr } from './geometry.js';
import { hitNote } from './hit-test.js';
import { _renderInspector, _selectedChordContext } from './inspector.js';
import { PIANO_LANE_H, _rollLockNotice, _rollReadOnly, isKeysArr, isKeysMode, midiToFret, midiToString, pianoLaneCount, yToMidi } from './keys.js';
import { lanes, _stringCountFor } from './lanes.js';
import {
    _editorClampScrollX, _loopNudgeEdge, editorToggleLoopRegion, snapGuidelineAfter, snapTime,
} from './loop.js';
import { _mapHealthStepProblem } from './ruler.js';
import { _editorSongFit } from './song-fit.js';
import { _recState } from './midi-record.js';
import { editorSoloMyStem, editorToggleStemTracks } from './stem-tracks.js';
import { _editorToolClick, getMousePos } from './mouse.js';
import { _editorEffectiveRightAssignPure, _editorPaletteKeyActionPure, _editorPaletteOpenKeyPure, editorCloseToolPalette, editorLeftTool, editorOpenToolPalette, editorToolPaletteOpen, setEditorLeftTool } from './tools.js';
import { _resizeSustainsForDeltaPure, notes } from './notes.js';
import { EDITOR_PROFILE_OVERRIDES, _editorCommandById, _editorEffectiveRightClickBehaviorPure, _editorEofCommandForKeyPure, _editorFeedbackCommandForKeyPure, _editorIsTypingTarget, _editorRenderShortcutPanel, _editorTableCommandForKeyPure, editorRightClickBehavior, editorShortcutProfile } from './shortcuts.js';
import { SNAP_VALUES, _editorEffectiveSnapValuePure, _editorSnapSubdivisionsPure } from './snap.js';
import { S } from './state.js';
import { _editorShowTabPreview, _tabPreviewKeyPolicyPure } from './tab-preview.js';
import { editorOpenCommandPalette } from './command-palette.js';
import { editorToggleTabView } from './tab-view-live.js';
import { editorExportGp5 } from './gp5-export.js';
import { TempoGridCmd, _editorModulateTempoAtSelection, _editorTapTempoAtSelection, _editorToggleSyncLock, _editorToggleTempoMapMode, _tapTempoHandleKey, _tempoDeleteSelection, _tempoInsertSyncPoint, _tempoMapOnContextMenu, _tempoMeasureBeatCount, _tempoMeasureDenominator, _tempoPromptMeasureBpm, _tempoSetBeatsPerMeasure, _tempoSetDenominatorOnBeatsPure, _tempoPromptPickup, _tempoSelRangePure, editorAcceptWholeTempoFit } from './tempo.js';
import { _tourNoteAction } from './tour.js';
import { _signpostNote } from './signposts.js';
import { _editorPromptText, setStatus } from './ui.js';
import { host } from './host.js';

export let editorWaveformVisible = true;
// ════════════════════════════════════════════════════════════════════
// Read-only Tab preview (EDITOR-VIEW-MODALITY-DESIGN VA.4, V8/V12) —
// render the CURRENT part as engraved tab by reusing the Tab View
// plugin's arrangement→GP conversion endpoint + the same pinned alphaTab
// CDN render idiom. Strictly read-only, refresh-on-open only (alphaTab
// lays out once per load — never per frame), and honest about its source:
// the endpoint reads the SAVED pack, so unsaved edits need a Save first.
// Degrades cleanly when the Tab View plugin isn't installed.
// ════════════════════════════════════════════════════════════════════


export const editorToggleShortcutPanel = (force) => {
    const panel = document.getElementById('editor-shortcut-panel');
    if (!panel) return;
    const show = force === undefined ? panel.classList.contains('hidden') : !!force;
    panel.classList.toggle('hidden', !show);
    if (show) _editorRenderShortcutPanel();
};

/* @pure:shortcut-panel-hint:start */
// Digit-RANGE commands (fret 0-9, bookmark 1-9) are keyboard-only: a single
// panel-button click can't pick which digit, so _editorRunEofCommand only
// knows the per-digit forms (setFretDigit:<n>, gotoBookmark:<n>, …). Clicking
// the bare range row would otherwise be silently inert — return an
// instructional hint for those ids so the click tells the user which keys to
// press; null for every ordinary command (which the panel runs directly).
function _editorShortcutPanelHintPure(id) {
    switch (id) {
    case 'gotoBookmarkDigit': return 'Press Alt+1 to Alt+9 to jump to a numbered bookmark';
    case 'setBookmarkDigit': return 'Press Shift+Alt+1 to Shift+Alt+9 to set or clear a bookmark at the cursor';
    case 'setFretDigit': return 'Press 0-9 to set the selected note fret';
    default: return null;
    }
}
/* @pure:shortcut-panel-hint:end */

export const editorRunShortcutCommand = (id) => {
    const def = _editorCommandById(id);
    if (!def) return false;
    if (def.status !== 'ready') {
        setStatus(`${def.label} is planned but not wired yet.`);
        return true;
    }
    const hint = _editorShortcutPanelHintPure(id);
    if (hint) {
        setStatus(hint);
        return true;
    }
    const handled = _editorRunEofCommand(id);
    _editorRenderShortcutPanel();
    return handled;
};
export function _editorCurrentNoteIndices() {
    return (!S.drumEditMode && !S.tempoMapMode && S.sel && S.sel.size) ? [...S.sel] : [];
}

function _editorToggleTechnique(key, { openFret = false } = {}) {
    const idxs = _editorCurrentNoteIndices();
    if (!idxs.length) { setStatus('Select notes first'); return false; }
    const nn = notes();
    const next = !idxs.every(i => !!(nn[i] && nn[i].techniques && nn[i].techniques[key]));
    S.history.exec(new ToggleTechniqueCmd(idxs, key, next, openFret ? 0 : null));
    host.draw();
    host.updateStatus();
    return true;
}

// Keyboard note entry: with nothing selected, a fret digit places a note on the
// caret string at the (snapped) playhead — the no-mouse add path (String view /
// fretted parts only; keys enter by pitch). Reuses the mouse-add AddNoteCmd path.
function _editorPlaceAtCaret(fret) {
    if (isKeysMode()) { setStatus('Select notes first'); return false; }
    const arr = S.arrangements && S.arrangements[S.currentArr];
    const nStr = arr ? _stringCountFor(arr) : 0;
    if (!nStr) { setStatus('Select notes first'); return false; }
    const string = Math.max(0, Math.min(nStr - 1, Number(S.caretString) || 0));
    const time = snapTime(S.cursorTime || 0);
    // Length = the note value (the snap step), so a typed note fills the preview
    // cell and consecutive notes tile the grid instead of stacking zero-length.
    const step = _editorSnapStepSeconds();
    const f = Math.max(0, Math.min(24, Number(fret) || 0));
    const note = { time, string, fret: f, sustain: step, techniques: {} };
    const cmd = new AddNoteCmd(note);
    S.history.exec(cmd);
    S.caretFret = f;                       // remember for the preview's fret ghost
    _tourNoteAction('placeNote');
    _editBlipAt();
    // Entry flow: leave NO selection (so the next digit places again) and advance
    // the caret one snap step for rapid sequential entry.
    S.sel.clear();
    // Advance from the note's SNAPPED time, not the raw cursor: after a free
    // (Alt) scrub the cursor sits off-grid, and stepping from it would leave the
    // next note a fraction of a step away from this one instead of flush against it.
    _editorSeekToTime(time + step);   // same step the note is long → notes tile
    host.draw();
    host.updateStatus();
    setStatus(`Placed fret ${note.fret} on string ${string + 1} — type to keep placing, or click a note to edit`);
    return true;
}

// Move the entry caret up/down a string (String view, nothing selected). Mirrors
// the moveStringUp/Down sign so ↑/↓ feel identical whether or not a note is held.
function _editorMoveCaretString(dir) {
    const arr = S.arrangements && S.arrangements[S.currentArr];
    const nStr = arr ? _stringCountFor(arr) : 0;
    if (!nStr) return false;
    // Mirror _getMoveStringSameFretResult (n.string + direction) so ↑/↓ move the
    // caret the SAME way they move a selected note's string.
    S.caretString = Math.max(0, Math.min(nStr - 1, (Number(S.caretString) || 0) + dir));
    host.draw();
    setStatus(`Entry caret on string ${S.caretString + 1} — type 0-9 to place a note`);
    return true;
}

// Note-entry preview toggle (default ON): the dashed caret cell that previews a
// typed note's string, length, and fret. A view pref — off if the box distracts
// (e.g. a mouse-only charter). Cached like the other view flags.
let _entryPreviewOn = null;
export function _editorEntryPreviewEnabled() {
    if (_entryPreviewOn === null) {
        try { _entryPreviewOn = localStorage.getItem('editorEntryPreview') !== '0'; }
        catch (_) { _entryPreviewOn = true; }
    }
    return _entryPreviewOn;
}
export function editorToggleEntryPreview(force) {
    const next = typeof force === 'boolean' ? force : !_editorEntryPreviewEnabled();
    _entryPreviewOn = next;
    try { localStorage.setItem('editorEntryPreview', next ? '1' : '0'); } catch (_) { /* private mode */ }
    if (host && typeof host.draw === 'function') host.draw();
    setStatus(next
        ? 'Note-entry preview on — the dashed cell shows where a typed note lands (string · length · fret)'
        : 'Note-entry preview off');
    return next;
}

function _editorSetSelectedFret(fret) {
    const idxs = _editorCurrentNoteIndices();
    if (!idxs.length) return _editorPlaceAtCaret(fret);   // no selection → keyboard entry
    const next = Math.max(0, Math.min(24, Number(fret) || 0));
    S.history.exec(new ChangeFretGroupCmd(idxs, next));
    _editBlipAt();
    host.draw();
    host.updateStatus();
    setStatus(`Selected fret set to ${next}`);
    return true;
}
function _editorCyclePickDirection() {
    const idxs = _editorCurrentNoteIndices();
    if (!idxs.length) { setStatus('Select notes first'); return false; }
    const nn = notes();
    const vals = idxs.map(i => {
        const v = nn[i] && nn[i].techniques ? nn[i].techniques.pick_direction : -1;
        return Number.isInteger(v) ? v : -1;
    });
    const same = vals.every(v => v === vals[0]);
    const current = same ? vals[0] : -1;
    const next = current < 0 ? 0 : (current === 0 ? 1 : -1);
    S.history.exec(new SetTeachingMarkCmd(idxs, 'pick_direction', next));
    host.draw();
    host.updateStatus();
    _renderInspector();
    setStatus(next < 0 ? 'Pick direction cleared' : (next === 0 ? 'Pick direction: down' : 'Pick direction: up'));
    return true;
}
function _editorSetPitchedSlideByStep(delta) {
    const idxs = _editorCurrentNoteIndices();
    if (!idxs.length) { setStatus('Select notes first'); return false; }
    const step = delta < 0 ? -1 : 1;
    S.history.exec(new SetPitchedSlideTargetsCmd(idxs, step));
    host.draw();
    host.updateStatus();
    _renderInspector();
    setStatus(step > 0 ? 'Pitched slide up one fret' : 'Pitched slide down one fret');
    return true;
}
function _editorAdjustSelectedFret(delta) {
    const idxs = _editorCurrentNoteIndices();
    if (!idxs.length) { setStatus('Select notes first'); return false; }
    const nn = notes();
    for (const i of idxs) {
        if (!nn[i]) continue;
        const next = Math.max(0, Math.min(24, (parseInt(nn[i].fret) || 0) + delta));
        S.history.exec(new ChangeFretCmd(i, next));
    }
    _editBlipAt();
    host.draw();
    host.updateStatus();
    return true;
}

function _editorAdjustSelectedSustain(delta) {
    const idxs = _editorCurrentNoteIndices();
    if (!idxs.length) { setStatus('Select notes first'); return false; }
    const nn = notes();
    const orig = idxs.map(i => nn[i] ? (nn[i].sustain || 0) : 0);
    const next = idxs.map((i, k) => {
        const vals = _resizeSustainsForDeltaPure(nn, [i], orig[k], delta);
        return vals[0] || 0;
    });
    if (!next.some((v, i) => v !== orig[i])) return true;
    S.history.exec(new ResizeSustainGroupCmd(idxs, next));
    host.draw();
    host.updateStatus();
    return true;
}

function _editorToggleSnapEnabled() {
    window.editorSetSnapEnabled(!S.snapEnabled);
    return true;
}

export function _editorSnapStepSeconds() {
    if (!S.beats || S.beats.length < 2) return 0.25;
    const t = S.cursorTime || 0;
    let bi = 0;
    for (let i = 0; i < S.beats.length - 1; i++) {
        if (S.beats[i].time <= t) bi = i; else break;
    }
    const bt = S.beats[bi].time;
    const nt = bi < S.beats.length - 1 ? S.beats[bi + 1].time : bt + 0.5;
    const sv = _editorEffectiveSnapValuePure(S.snapEnabled, SNAP_VALUES[S.snapIdx]);
    const subs = _editorSnapSubdivisionsPure(sv);
    if (!subs) return Math.max(0.001, nt - bt);
    return Math.max(0.001, (nt - bt) / subs);
}

export function _editorSeekToTime(t) {
    S.cursorTime = Math.max(0, Math.min(S.duration || Infinity, t));
    const margin = 0.15 * (canvas ? canvas.width / S.zoom : 10);
    if (S.cursorTime < S.scrollX) S.scrollX = _editorClampScrollX(S.cursorTime - margin);
    const right = S.scrollX + ((canvas ? canvas.width : 800) - LABEL_W) / S.zoom;
    if (S.cursorTime > right) S.scrollX = _editorClampScrollX(S.cursorTime - margin);
    if (S.playing) { stopPlayback(); startPlayback(); }
    host.draw();
    host.updateTimeDisplay();
}

/* @pure:bookmarks:start */
// Numbered bookmarks: up to nine time markers per song, EDITOR-side
// authoring state (one localStorage entry keyed by filename — never pack
// data, §6). Slots are 1-9; times are seconds, 3 dp.
function _bookmarkStorageKeyPure(filename) {
    return 'editorBookmarks:' + (filename || '');
}
// Parse a stored map defensively: junk JSON, arrays, out-of-range slots,
// and non-finite/negative times all drop out rather than poisoning the
// draw/jump paths.
function _bookmarksParsePure(raw) {
    let obj = null;
    try { obj = JSON.parse(raw); } catch (_) { return {}; }
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return {};
    const out = {};
    for (let n = 1; n <= 9; n++) {
        const v = Number(obj[n]);
        if (Number.isFinite(v) && v >= 0) out[n] = v;
    }
    return out;
}
// Toggle-set semantics on a slot: setting it at (about) its existing time
// clears it, anywhere else (re)places it. Returns a NEW map, or the same
// object for invalid input (callers use identity to skip persisting).
function _bookmarkTogglePure(map, n, t) {
    if (!(n >= 1 && n <= 9) || !Number.isFinite(t) || t < 0) return map;
    const out = { ...map };
    if (out[n] !== undefined && Math.abs(out[n] - t) < 0.01) delete out[n];
    else out[n] = Math.round(t * 1000) / 1000;
    return out;
}
/* @pure:bookmarks:end */

// Per-song cache so the draw path never parses localStorage per frame;
// keyed by filename, so a song switch invalidates it naturally.
let _bookmarksCache = null;
let _bookmarksCacheKey = null;
export function _bookmarks() {
    const key = _bookmarkStorageKeyPure(S.filename);
    if (_bookmarksCacheKey === key && _bookmarksCache) return _bookmarksCache;
    let raw = null;
    try { raw = localStorage.getItem(key); } catch (_) {}
    _bookmarksCache = _bookmarksParsePure(raw);
    _bookmarksCacheKey = key;
    return _bookmarksCache;
}
function _bookmarksSave(map) {
    const key = _bookmarkStorageKeyPure(S.filename);
    _bookmarksCache = map;
    _bookmarksCacheKey = key;
    try {
        if (Object.keys(map).length) localStorage.setItem(key, JSON.stringify(map));
        else localStorage.removeItem(key);
    } catch (_) {}
}

function _editorSetBookmark(n) {
    if (!S.filename) { setStatus('Load a song first'); return true; }
    const before = _bookmarks();
    const after = _bookmarkTogglePure(before, n, S.cursorTime || 0);
    if (after === before) return true;
    const removed = after[n] === undefined;
    _bookmarksSave(after);
    host.draw();
    setStatus(removed
        ? `Bookmark ${n} cleared`
        : `Bookmark ${n} set at ${(S.cursorTime || 0).toFixed(2)} s — Alt+${n} jumps here`);
    return true;
}

function _editorGotoBookmark(n) {
    const t = _bookmarks()[n];
    if (t === undefined) {
        setStatus(`Bookmark ${n} isn't set — Shift+Alt+${n} sets it at the cursor`);
        return true;
    }
    _editorSeekToTime(t);
    _signpostNote('navJump');
    setStatus(`Bookmark ${n}`);
    return true;
}

function _editorJumpBeat(dir) {
    const beats = (S.beats || []).map(b => b.time).filter(t => Number.isFinite(t)).sort((a, b) => a - b);
    const cur = S.cursorTime || 0;
    const next = dir > 0 ? beats.find(t => t > cur + 0.0001) : [...beats].reverse().find(t => t < cur - 0.0001);
    if (next !== undefined) { _editorSeekToTime(next); _signpostNote('navJump'); }
}

function _editorJumpNote(dir) {
    const times = notes().map(n => n.time).filter(t => Number.isFinite(t)).sort((a, b) => a - b);
    const cur = S.cursorTime || 0;
    const next = dir > 0 ? times.find(t => t > cur + 0.0001) : [...times].reverse().find(t => t < cur - 0.0001);
    if (next !== undefined) { _editorSeekToTime(next); _signpostNote('navJump'); }
}

function _editorJumpGrid(dir) {
    _editorSeekToTime((S.cursorTime || 0) + dir * _editorSnapStepSeconds());
}

function _editorJumpAnchor(dir) {
    const arr = S.arrangements[S.currentArr] || {};
    const anchors = _readAnchorSnapshot(arr).list.map(a => a.time).filter(t => Number.isFinite(t)).sort((a, b) => a - b);
    const cur = S.cursorTime || 0;
    const next = dir > 0 ? anchors.find(t => t > cur + 0.0001) : [...anchors].reverse().find(t => t < cur - 0.0001);
    if (next !== undefined) _editorSeekToTime(next);
}

/* @pure:duplicate:start */
// Time shift for a duplicate: place the copy immediately after the
// selection so a repeated Ctrl+D tiles a phrase. Multi-time selections
// shift by their span PLUS one grid step, so the copy's first onset lands
// one step past the original's last onset — the copies ABUT the source
// instead of stacking a doubled note on the seam. A single note or a chord
// (all one time) shifts by one grid step. Returns 0 for an empty / all-
// non-finite selection so the caller no-ops. Interior timing is preserved
// (the whole selection shifts by one offset — never re-quantized), so a
// swung or syncopated phrase duplicates with its feel intact.
function _duplicateShiftPure(times, snapStep) {
    if (!Array.isArray(times) || !times.length) return 0;
    let lo = Infinity, hi = -Infinity;
    for (const t of times) {
        const v = Number(t);
        if (!Number.isFinite(v)) continue;
        if (v < lo) lo = v;
        if (v > hi) hi = v;
    }
    if (!Number.isFinite(lo)) return 0;
    const span = hi - lo;
    const step = (Number.isFinite(snapStep) && snapStep > 0) ? snapStep : 0.25;
    return span > 1e-9 ? span + step : step;
}

// Batch-add `newNotes` to the note array `list`, keeping it time-sorted;
// rollback removes exactly those refs (indexOf, not stored indices — the
// sort reshuffles). `onChange(fn)` wraps the mutation so a caller can keep
// its selection bound across the sort/splice; it defaults to just running
// `fn`, which is what the tests use to drive the command in isolation.
class AddNotesCmd {
    constructor(list, newNotes, onChange) {
        this.list = list;
        this.newNotes = newNotes;
        this.onChange = (typeof onChange === 'function') ? onChange : ((fn) => fn());
    }
    exec() {
        this.onChange(() => {
            for (const n of this.newNotes) this.list.push(n);
            this.list.sort((a, b) => a.time - b.time);
        });
    }
    rollback() {
        this.onChange(() => {
            for (const n of this.newNotes) {
                const i = this.list.indexOf(n);
                if (i >= 0) this.list.splice(i, 1);
            }
        });
    }
}
/* @pure:duplicate:end */

// Ctrl+D — copy the selection to the next position (one selection-length
// later) as one undoable command, leaving the copies selected so a repeat
// tiles the phrase. Mirrors the paste command's stable-selection handling.
function _editorDuplicateSelection() {
    if (S.drumEditMode || S.tempoMapMode || !S.sel.size) return false;
    const nn = notes();
    const selNotes = [...S.sel].map(i => nn[i]).filter(Boolean);
    if (!selNotes.length) return false;
    const shift = _duplicateShiftPure(
        selNotes.map(n => n.time), _editorSnapStepSeconds());
    if (shift <= 0) return false;
    const newNotes = selNotes.map(n => ({
        time: n.time + shift,
        string: n.string,
        fret: n.fret,
        sustain: n.sustain || 0,
        techniques: { ...(n.techniques || {}) },
    }));
    S.history.exec(new AddNotesCmd(nn, newNotes, _withStableSelection));
    // Reselect the copies so a repeated Ctrl+D keeps tiling forward.
    S.sel.clear();
    const added = new Set(newNotes);
    for (let i = 0; i < nn.length; i++) if (added.has(nn[i])) S.sel.add(i);
    host.draw();
    host.updateStatus();
    setStatus(`Duplicated ${newNotes.length} note${newNotes.length === 1 ? '' : 's'}`);
    return true;
}

/* @pure:clipboard:start */
// The note clipboard (Ctrl+C/X/V). Session-scoped and internal — notes are
// structured editor state, not text, and a stray Ctrl+C on the canvas must
// never clobber whatever the user has on the OS clipboard (and vice versa) —
// the same choice every DAW makes for its piano-roll clipboard.
//
// Pack: deep-copy the selection with times RELATIVE to its earliest note, so
// a paste lands the phrase's first note exactly at the playhead and the
// internal timing rides along. structuredClone, not spread: a bend curve
// (`techniques.bend_values`) is an array — a shallow copy would leave every
// paste sharing one curve, and editing any of them would edit all.
export function _clipboardPackPure(selNotes, arrIndex, keys) {
    const rows = (selNotes || []).filter(n => n && Number.isFinite(n.time))
        .slice().sort((a, b) => a.time - b.time);
    if (!rows.length) return null;
    const anchor = rows[0].time;
    return {
        arrIndex,
        keys: !!keys,
        notes: rows.map(n => ({
            dt: n.time - anchor,
            string: n.string,
            fret: n.fret,
            sustain: Number(n.sustain) || 0,
            techniques: structuredClone(n.techniques || {}),
        })),
    };
}

// Plan a paste at `atTime`: retime every clipboard note relative to the
// anchor (clamped at t=0), deep-copying again so repeated pastes never share
// state, and SKIP notes whose string doesn't exist on this track (pasting a
// 6-string riff onto a 4-string bass keeps what fits and says what didn't).
export function _clipboardPastePlanPure(clip, atTime, laneCount) {
    if (!clip || !Array.isArray(clip.notes) || !clip.notes.length) return null;
    const at = Number.isFinite(atTime) ? atTime : 0;
    const out = [];
    let laneSkipped = 0;
    for (const c of clip.notes) {
        if (Number.isFinite(laneCount) && laneCount > 0 && c.string >= laneCount) { laneSkipped++; continue; }
        out.push({
            time: Math.max(0, at + c.dt),
            string: c.string,
            fret: c.fret,
            sustain: c.sustain,
            techniques: structuredClone(c.techniques || {}),
        });
    }
    return { notes: out, laneSkipped };
}
/* @pure:clipboard:end */

let _noteClipboard = null;

// The registry made Cut/Paste menu- and palette-invokable, which BYPASSES
// onKeyDown's mode gates — so every clipboard WRITE re-checks them here:
// no mutation while MIDI-recording, in the Tracks overview, or in the
// read-only fretted roll (delete and add are pitch-writes there, same as
// the right-click delete guard). Plain Copy is a read and stays free.
function _clipboardWriteBlocked() {
    if (_recState === 'recording') { setStatus('Stop recording first.'); return true; }
    if (S.partsViewMode) { setStatus('Leave the Tracks overview to edit notes.'); return true; }
    if (_rollReadOnly()) { _rollLockNotice(); return true; }
    return false;
}

// Ctrl+C / Ctrl+X. Cut is copy + the existing undoable delete — the clipboard
// itself is deliberately NOT part of history (undoing a cut restores the
// notes but keeps the clipboard, exactly like every text editor).
export function _editorCopySelection(cutting = false) {
    if (S.drumEditMode || S.tempoMapMode) return false;
    if (cutting && _clipboardWriteBlocked()) return true;
    const idxs = _editorCurrentNoteIndices();
    if (!idxs.length) { setStatus(`Select notes to ${cutting ? 'cut' : 'copy'} first.`); return true; }
    const nn = notes();
    _noteClipboard = _clipboardPackPure(idxs.map(i => nn[i]), S.currentArr, isKeysArr());
    if (!_noteClipboard) return true;
    if (cutting) {
        S.history.exec(new DeleteNotesCmd(idxs));
        host.draw();
        host.updateStatus();
    }
    const n = _noteClipboard.notes.length;
    setStatus(`${cutting ? 'Cut' : 'Copied'} ${n} note${n === 1 ? '' : 's'} — paste lands at the playhead.`);
    return true;
}

// Ctrl+V — paste at the (snap-honouring) playhead as ONE undoable step,
// leaving the pasted notes selected so a nudge or repeat-paste follows
// naturally. Cross-track pasting is allowed between like tracks (with a
// string-count clamp); keys ↔ fretted is refused (string/fret mean different
// things there), and pasting NEW pitches into the read-only fretted roll is
// refused like every other pitch write.
// Split every selected note spanning the playhead at the playhead — or, with
// no selection, every current-arrangement note spanning it (the DAW "split at
// playhead" verb Christian asked for; the Scissors tool is its click form).
export function _editorSplitAtPlayhead() {
    if (S.drumEditMode || S.tempoMapMode) return false;
    if (_recState === 'recording') return true;
    if (!S.arrangements.length) return false;
    const t = Math.max(0, S.cursorTime || 0);
    const nn = notes();
    // A note is a split target only when the cut leaves two viable halves —
    // the same rule exec() enforces, applied up front so a slivers-only attempt
    // never records a no-op undo step or dirties the session.
    const spans = (i) => {
        const n = nn[i];
        if (!n) return false;
        return _splitViablePure(Number(n.time) || 0, Number(n.sustain) || 0, t);
    };
    let targets = [...S.sel].filter(spans);
    // The all-notes fallback is the "no selection" verb. With a non-empty
    // selection that just doesn't span the playhead, split nothing — never
    // reach past the selection into unrelated notes.
    if (!S.sel.size) {
        targets = nn.map((_, i) => i).filter(spans);
    }
    if (!targets.length) {
        setStatus('Nothing to split — no sustained note spans the playhead.');
        return true;
    }
    const cmd = new SplitNotesCmd(targets, t);
    S.history.exec(cmd);
    if (cmd.splitCount) {
        _editBlipAt();
        setStatus(`Split ${cmd.splitCount} note${cmd.splitCount === 1 ? '' : 's'} at the playhead`);
    }
    host.draw();
    host.updateStatus();
    return true;
}

export function _editorPasteAtPlayhead() {
    if (S.drumEditMode || S.tempoMapMode) return false;
    if (_clipboardWriteBlocked()) return true;
    if (!_noteClipboard) { setStatus('Nothing to paste — copy or cut notes first.'); return true; }
    if (_noteClipboard.keys !== isKeysArr()) {
        setStatus('Can\'t paste between keys and fretted tracks — the note shapes don\'t translate.');
        return true;
    }
    const arr = S.arrangements[S.currentArr];
    if (!arr) return false;
    const nn = notes();
    const at = snapTime(Math.max(0, S.cursorTime || 0));
    const plan = _clipboardPastePlanPure(_noteClipboard, at, _stringCountFor(arr));
    if (!plan || !plan.notes.length) {
        setStatus(plan && plan.laneSkipped
            ? 'Nothing fits — this track has fewer strings than the copied notes use.'
            : 'Nothing to paste.');
        return true;
    }
    S.history.exec(new AddNotesCmd(nn, plan.notes, _withStableSelection));
    S.sel.clear();
    const added = new Set(plan.notes);
    for (let i = 0; i < nn.length; i++) if (added.has(nn[i])) S.sel.add(i);
    host.draw();
    host.updateStatus();
    const skippedNote = plan.laneSkipped
        ? ` (${plan.laneSkipped} skipped — no such string on this track)` : '';
    setStatus(`Pasted ${plan.notes.length} note${plan.notes.length === 1 ? '' : 's'} at the playhead${skippedNote}.`);
    return true;
}

function _editorSelectLike() {
    const idxs = _editorCurrentNoteIndices();
    if (!idxs.length) { setStatus('Select a note first'); return false; }
    const n0 = notes()[idxs[0]];
    if (!n0) return false;
    S.sel.clear();
    notes().forEach((n, i) => {
        if (n.string === n0.string && n.fret === n0.fret) S.sel.add(i);
    });
    host.draw();
    host.updateStatus();
    return true;
}

// Keyboard time-nudge (←/→): move the selected notes earlier/later by one snap
// step in time, as one grouped MoveNoteCmd (mirrors _editorResnapSelection's
// pattern). With NOTHING selected, ←/→ seek the playhead by a step instead — and
// since the keyboard-entry caret sits at the playhead, that doubles as caret-time
// navigation. Clamped so the earliest note can't cross 0.
function _editorNudgeSelectionTime(dir) {
    const idxs = _editorCurrentNoteIndices();
    if (!idxs.length) {
        _editorSeekToTime((S.cursorTime || 0) + dir * _editorSnapStepSeconds());
        return true;
    }
    const nn = notes();
    let delta = dir * _editorSnapStepSeconds();
    const minT = Math.min(...idxs.map(i => nn[i].time));
    if (minT + delta < 0) delta = -minT;                 // don't push before 0
    if (Math.abs(delta) < 1e-9) return false;
    const dtimes = idxs.map(() => delta);
    const dstrings = idxs.map(() => 0);
    S.history.exec(new MoveNoteCmd(idxs, dtimes, dstrings, null));
    _editBlipAt();
    host.draw();
    host.updateStatus();
    setStatus(`Nudged ${idxs.length} note${idxs.length === 1 ? '' : 's'} ${dir > 0 ? 'later' : 'earlier'} by one step`);
    return true;
}

/* @pure:resnap-edges:start */
// Both EDGES of every note snap to the current-subdivision guidelines — the
// Logic piano-roll model: the start edge quantises to its nearest guideline,
// and a SUSTAINED note's end edge does too, except it never collapses onto
// the start (it keeps at least one subdivision — `afterFn` supplies the first
// guideline strictly after the new start). A zero-sustain chip stays a chip:
// length is authored intent, never inflated by a quantize.
export function _resnapEdgesPure(oldTimes, oldSustains, snapFn, afterFn) {
    const newTimes = oldTimes.map(t => snapFn(t));
    const newSustains = oldSustains.map((sus, i) => {
        if (!(sus > 0)) return sus || 0;
        const end = snapFn(oldTimes[i] + sus);
        const bounded = end > newTimes[i] + 1e-9 ? end : afterFn(newTimes[i]);
        // afterFn is the identity when there is no usable grid (fewer than two
        // beats, or the snap value is off) — and in ONSET mode snapFn still
        // snaps, so a short note's two edges can land on the same onset with no
        // guideline to push the end past it. A quantize must never eat a
        // sustained note: with no positive bound to offer, keep the length.
        return bounded > newTimes[i] + 1e-9 ? bounded - newTimes[i] : sus;
    });
    return { newTimes, newSustains };
}
/* @pure:resnap-edges:end */

// One undoable step for the two halves of an edge resnap — starts move,
// sustained ends re-length. Exec in order, rollback in reverse; gating
// follows the MoveNoteCmd half (same as the verb always had).
class ResnapEdgesCmd {
    constructor(move, resize) { this.move = move; this.resize = resize; }
    exec() { this.move.exec(); if (this.resize) this.resize.exec(); }
    rollback() { if (this.resize) this.resize.rollback(); this.move.rollback(); }
}

function _editorResnapSelection() {
    const idxs = _editorCurrentNoteIndices();
    if (!idxs.length) { setStatus('Select notes first'); return false; }
    // The verb has always been refused on a read-only roll (its MoveNoteCmd half
    // isn't pitchPreserving, so the history gate rejects it). Say so HERE: the
    // gate's refusal is silent to us, and the success line below would otherwise
    // overwrite the lock notice and claim notes moved when none did.
    if (_rollReadOnly()) { _rollLockNotice(); return true; }
    const nn = notes();
    const oldTimes = idxs.map(i => nn[i].time);
    const oldSustains = idxs.map(i => Number(nn[i].sustain) || 0);
    // FORCED snap: this is the explicit quantize verb, so it snaps to the
    // guidelines (or onsets, in Onset mode) even while the live Snap toggle
    // is OFF — with the toggle honoured it silently moved nothing, which read
    // as "there's no way to snap notes to the grid" (a real tester report).
    const { newTimes, newSustains } = _resnapEdgesPure(
        oldTimes, oldSustains, (t) => snapTime(t, true), (t) => snapGuidelineAfter(t, true));
    const dtimes = newTimes.map((t, i) => t - oldTimes[i]);
    const touched = idxs.filter((_, i) => Math.abs(dtimes[i]) > 1e-9
        || Math.abs(newSustains[i] - oldSustains[i]) > 1e-9).length;
    if (!touched) {
        // Say so — a silent no-op is indistinguishable from a missing feature.
        setStatus(`Selection already on the grid (${idxs.length} note${idxs.length === 1 ? '' : 's'} checked).`);
        return true;
    }
    const dstrings = idxs.map(() => 0);
    const susIdx = [], susVals = [];
    for (let i = 0; i < idxs.length; i++) {
        if (Math.abs(newSustains[i] - oldSustains[i]) > 1e-9) {
            susIdx.push(idxs[i]);
            susVals.push(newSustains[i]);
        }
    }
    S.history.exec(new ResnapEdgesCmd(
        new MoveNoteCmd(idxs, dtimes, dstrings, null),
        susIdx.length ? new ResizeSustainGroupCmd(susIdx, susVals) : null));
    // Repeated resnapping is the canonical "fighting the grid" signal (charrette
    // §3.2): the notes keep landing off the beat, so the GRID may be the thing
    // that's wrong — nudge toward the Tempo tools.
    _signpostNote('gridFight');
    host.draw();
    host.updateStatus();
    setStatus(`Snapped ${touched} of ${idxs.length} note${idxs.length === 1 ? '' : 's'} to the `
        + `${S.snapMode === 'onset' ? 'detected onsets' : 'grid'} (both edges).`);
    return true;
}

function _editorSetAnchorAtCursor() {
    if (!S.arrangements.length || isKeysArr()) { setStatus('Anchors are for guitar/bass arrangements'); return false; }
    const idxs = _editorCurrentNoteIndices();
    const nn = notes();
    const atCursor = idxs.map(i => nn[i]).filter(Boolean);
    const fret = atCursor.length ? Math.max(1, Math.min(...atCursor.map(n => n.fret || 1))) : 1;
    const anchor = { time: snapTime(S.cursorTime || 0), fret, width: 4 };
    S.history.exec(new AddAnchorCmd(S.currentArr, anchor));
    S.anchorSel = anchor;
    host.draw();
    return true;
}

/* @pure:section-cmds:start */
// Sections (S.sections = [{name, number, start_time}]) are kept sorted by
// start_time; add/rename/delete used to mutate the array raw (push/splice/
// direct assignment) with no undo — a stray Delete on a section was
// unrecoverable, and Ctrl+Z after adding one rolled back the last NOTE
// edit instead. These three command classes route those mutations through
// EditHistory. They hold the section OBJECT by reference (the array is
// re-sorted, so indices go stale but refs survive), so exec↔rollback and
// redo restore S.sections exactly, sort order included. Stable sort keeps
// equal-start_time siblings in insertion order, so ref removal is
// unambiguous even when two sections share a time.

// Insert `section` and re-sort in place; returns it.
function _sectionsInsertSorted(section) {
    S.sections.push(section);
    S.sections.sort((a, b) => a.start_time - b.start_time);
    return section;
}
// Index of the first section within `tol` seconds of `time`, else -1 —
// keyed off the ARGUMENTS, never a global cursor (the section context menu
// tests a click time against each section here).
function _sectionNearestIndexPure(sections, time, tol) {
    if (!Array.isArray(sections)) return -1;
    const t = Number(time);
    const w = Number.isFinite(tol) ? tol : 1.0;
    for (let i = 0; i < sections.length; i++) {
        if (Math.abs(Number(sections[i].start_time) - t) <= w) return i;
    }
    return -1;
}

class AddSectionCmd {
    constructor(section) { this.section = section; }
    exec() { _sectionsInsertSorted(this.section); }
    rollback() {
        const i = S.sections.indexOf(this.section);
        if (i >= 0) S.sections.splice(i, 1);
    }
}

class RemoveSectionCmd {
    constructor(section) { this.section = section; this.idx = -1; }
    exec() {
        this.idx = S.sections.indexOf(this.section);
        if (this.idx >= 0) S.sections.splice(this.idx, 1);
    }
    rollback() {
        // Restore at the EXACT original index (splice, not push+sort), so a
        // section restored beside an equal-start_time sibling lands back in
        // its original order — undo LIFO guarantees the array here matches
        // the state exec left. Fall back to a sorted insert if the section
        // wasn't found at exec time.
        if (this.idx >= 0) S.sections.splice(this.idx, 0, this.section);
        else _sectionsInsertSorted(this.section);
    }
}

class RenameSectionCmd {
    // Name-only, matching the prior rename behavior (the stale `number`
    // field is left as-is, not recomputed — that's unchanged, just undoable).
    constructor(section, newName) {
        this.section = section;
        this.oldName = section.name;
        this.newName = newName;
    }
    exec() { this.section.name = this.newName; }
    rollback() { this.section.name = this.oldName; }
}
/* @pure:section-cmds:end */

function _editorAddSectionAtCursor() {
    const name = 'section';
    const num = S.sections.filter(s => s.name === name).length + 1;
    S.history.exec(new AddSectionCmd(
        { name, number: num, start_time: snapTime(S.cursorTime || 0) }));
    host.draw();
    setStatus('Section added');
    return true;
}

/* @pure:phrase-cmds:start */
// Phrases (arr.phrases = [{name, number, start_time, levels}]) are the
// per-arrangement sibling of sections and likewise kept sorted by start_time.
// Adding one used to raw push+sort with NO undo — the ONLY add-* verb that
// bypassed EditHistory, so Ctrl+Z after a phrase-add rolled back the previous
// NOTE edit instead (the exact trap the section commands above closed). This
// routes the add through the history. It holds the phrase OBJECT and its
// OWNING arr.phrases ARRAY by reference (never S.currentArr — the armed
// arrangement can change before an undo, but the array identity is stable), so
// exec↔rollback restore that arrangement's phrases exactly, sort order included.
class AddPhraseCmd {
    // songScope: a phrase is arrangement STRUCTURE (name/number/start_time/
    // levels), never a fretted NOTE write — so the read-only-roll lock, which
    // exists only to stop silent pitch writes to a fretted chart shown read-only
    // in the piano roll, must not refuse it. Without this the pre-history raw
    // push kept working in that view but routing through EditHistory would drop
    // the add on the floor while still reporting "Phrase added". Same carve-out
    // the drum-tab / tempo-grid structural commands take. The command is
    // ref-held (holds arr.phrases directly), so songScope's _arrIdx=-1 (no undo
    // arrangement-switch) is correct: rollback splices the captured array
    // whatever arrangement is armed.
    constructor(phrases, phrase) { this.phrases = phrases; this.phrase = phrase; this.songScope = true; }
    exec() {
        this.phrases.push(this.phrase);
        this.phrases.sort((a, b) => (a.start_time || 0) - (b.start_time || 0));
    }
    rollback() {
        const i = this.phrases.indexOf(this.phrase);
        if (i >= 0) this.phrases.splice(i, 1);
    }
}
/* @pure:phrase-cmds:end */

function _editorAddPhraseAtCursor() {
    const arr = S.arrangements[S.currentArr];
    if (!arr) return false;
    if (!Array.isArray(arr.phrases)) arr.phrases = [];
    const name = 'phrase';
    const num = arr.phrases.filter(p => p.name === name).length + 1;
    S.history.exec(new AddPhraseCmd(
        arr.phrases,
        { name, number: num, start_time: snapTime(S.cursorTime || 0), levels: [] }));
    host.draw();
    setStatus('Phrase added');
    return true;
}

function _editorAddToneAtCursor() {
    const arr = S.arrangements[S.currentArr];
    if (!arr) return false;
    const tones = _ensureTones(arr);
    const slots = (tones.slots || []).slice();
    const name = slots[1] || slots[0] || 'Tone A';
    const change = { t: snapTime(S.cursorTime || 0), name };
    S.history.exec(new AddToneChangeCmd(S.currentArr, change));
    S.toneSel = change;
    host.draw();
    setStatus('Tone change added');
    return true;
}

function _editorAddHandshapeFromSelection() {
    const ctx = _selectedChordContext();
    if (!ctx) { setStatus('Select one chord group first'); return false; }
    const sustains = ctx.notes.map(n => n.sustain || 0);
    const start = ctx.time;
    const end = start + Math.max(0.25, ...sustains);
    const hs = { start_time: start, end_time: end, arp: false };
    S.history.exec(new AddHandshapeCmd(S.currentArr, hs, lanes()));
    S.handshapeSel = hs;
    host.draw();
    setStatus('Handshape added');
    return true;
}

function _editorOpenImportXml() {
    window.editorShowCreateModal();
    setStatus('Choose EOF XML files in the New dialog.');
    setTimeout(() => document.getElementById('editor-create-eof')?.click(), 0);
}

function _editorOpenImportGp() {
    if (S.arrangements.length) window.editorShowImportGuitarModal();
    else window.editorShowCreateModal();
    setTimeout(() => {
        const input = document.getElementById(S.arrangements.length ? 'editor-import-guitar-file' : 'editor-create-gp');
        input?.click();
    }, 0);
}

function _editorOpenImportMidi() {
    if (S.arrangements.length) window.editorShowAddKeysModal();
    else window.editorShowCreateModal();
    setTimeout(() => {
        const input = document.getElementById(S.arrangements.length ? 'editor-add-keys-file' : 'editor-create-gp');
        input?.click();
    }, 0);
}

async function _editorPromptTempoSignatureAtCursor() {
    const val = await _editorPromptText({
        title: 'Set Time Signature', label: 'Beats per measure', value: '4', placeholder: '4',
    });
    if (val == null) return;
    const beats = Math.max(1, Math.min(16, parseInt(val, 10) || 4));
    const d = host.tempoResolvedMeasureIdx();
    if (d >= 0) _tempoSetBeatsPerMeasure(d, beats);
}

function _editorToggleWaveform() {
    editorWaveformVisible = !editorWaveformVisible;
    host.draw();
    setStatus(editorWaveformVisible ? 'Waveform shown' : 'Waveform hidden');
}

function _editorShowShortcutDiscovery(commandLabel) {
    window.editorToggleShortcutPanel(true);
    setStatus(commandLabel);
    return true;
}
function _editorUnsupportedEofCommand(label) {
    setStatus(`${label} is not available in this editor mode yet.`);
    return true;
}

function _editorPromptTempoBpmAtSelection() {
    if (!S.tempoMapMode || S.tempoSel < 0) {
        setStatus('Select a Tempo Map barline first.');
        return true;
    }
    _tempoPromptMeasureBpm(S.tempoSel);
    return true;
}

// Which audio the suggest engine should analyze: the LOCKED tempo guide when
// one is set (a stem declared to be the timing reference — often a click
// track), else the session recording. Lock is the commitment: an unlocked
// guide never reroutes analysis. Pure so tests pin the decision table.
export function _tempoGuideAnalysisPure(trackSession) {
    if (!trackSession || !trackSession.tempoGuideLocked) return null;
    const sourceId = typeof trackSession.tempoGuideSourceId === 'string'
        ? trackSession.tempoGuideSourceId : '';
    if (!sourceId) return null;
    return { sourceId, metronome: trackSession.tempoGuideMode === 'metronome' };
}

export function _tempoGuideRequestStillCurrentPure(request, trackSession, source) {
    const current = _tempoGuideAnalysisPure(trackSession);
    return !!(request && current && source
        && current.sourceId === request.sourceId
        && current.metronome === request.metronome
        && source.id === request.sourceId
        && source.url === request.url
        && (Number(source.offset) || 0) === request.offset);
}

// The full analysis route, bootstrap included (TEMPO-ASSIST A): a LOCKED
// guide stays supreme — the lock is the user's explicit choice, and locking
// the master as a plain-audio guide is the opt-out. With no lock, a stem
// NAMED like a click track is analyzed as a metronome automatically: a
// shipped metronome stem is virtually always the best timing source, and
// today it sat unused until the user found the ♩ lock. Nothing persists —
// the bootstrap is an analysis default, never a session edit.
export function _tempoAnalysisRoutePure(trackSession, sources) {
    const locked = _tempoGuideAnalysisPure(trackSession);
    if (locked) return { ...locked, bootstrap: false };
    const click = _clickSourcePure(sources);
    return click ? { sourceId: click.id, metronome: true, bootstrap: true } : null;
}

// Post-await revalidation for the routed (guide OR bootstrap) analysis: the
// route recomputed on current state must still name this request's source,
// engine mode, and the exact decoded audio (url + timeline placement).
export function _tempoAnalysisRequestStillCurrentPure(request, trackSession, sources) {
    const current = _tempoAnalysisRoutePure(trackSession, sources);
    const source = (Array.isArray(sources) ? sources : [])
        .find(item => item && item.id === (request && request.sourceId));
    return !!(request && current && source
        && current.sourceId === request.sourceId
        && current.metronome === request.metronome
        && source.url === request.url
        && (Number(source.offset) || 0) === request.offset);
}

export function _tempoBootstrapFallbackSourcePure(route, sources) {
    if (!(route && route.bootstrap)) return null;
    return (Array.isArray(sources) ? sources : [])
        .find(source => source && source.id === 'master' && source.url) || null;
}

// Anchor + engine opts for a G fit. The FOCUSED marker always wins — locked
// or not — so a stale multi-selection can never send analysis back toward
// the beginning; the selection is only an anchor fallback when nothing has
// focus, and it no longer caps the march (fits propose to chart end: the
// metronome branch by contract, the ordinary branch via the low-confidence
// completion tail).
export function _tempoSuggestScopePure(beats, tempoSel, tempoSelMulti, metronome) {
    const active = Number.isInteger(tempoSel) && beats && beats[tempoSel]
        && beats[tempoSel].measure > 0 ? tempoSel : -1;
    let anchor = active;
    const range = _tempoSelRangePure(beats, tempoSelMulti);
    const opts = metronome ? { metronome: true } : { complete: true };
    if (anchor < 0 && range) anchor = range.lo;
    return { anchor, opts };
}

// Assisted mapping (G): propose an onset fit for the downbeats ahead of the
// anchor — the selected barline, or the first downbeat when none is selected.
// Proposal-only; accepting is a ghost-handle click or the Accept buttons,
// all handled in tempo.js. Async: a locked guide stem may need a one-time
// fetch+decode+analysis before the fit can run.
async function _editorTempoSuggestFit() {
    if (!S.tempoMapMode) {
        setStatus('Enter Tempo Map (T) first — Suggest fits the barlines to the recording.');
        return true;
    }
    let route = _tempoAnalysisRoutePure(S.trackSession,
        _trackSessionSourcesPure(S.audioUrl, S.stems));
    let metronome = !!(route && route.metronome);
    let fromLabel = metronome ? ' from the metronome guide' : '';
    let onsets = null;
    if (route && route.sourceId !== 'master') {
        const source = _trackSessionSourcesPure(S.audioUrl, S.stems)
            .find(item => item.id === route.sourceId);
        if ((!source || !source.url) && !route.bootstrap) {
            setStatus('The tempo guide track could not be found — pick another guide in Manage Tracks.');
            return true;
        }
        if (source && source.url) {
            setStatus(route.bootstrap
                ? `Analyzing the click stem “${source.name}” (auto-detected)…`
                : `Analyzing the tempo guide “${source.name}”…`);
            const request = { sourceId: route.sourceId, metronome: route.metronome, url: source.url, offset: Number(source.offset) || 0 };
            const analyzed = await ensureGuideOnsetsShifted(source.id, source.url, request.offset);
            // Revalidate after the await: still in Tempo Map, route unchanged —
            // the user may have exited the mode, re-pointed/locked the guide,
            // or renamed the stem while its audio decoded.
            if (!S.tempoMapMode
                || !_tempoAnalysisRequestStillCurrentPure(request, S.trackSession,
                    _trackSessionSourcesPure(S.audioUrl, S.stems))) return true;
            route = _tempoAnalysisRoutePure(S.trackSession,
                _trackSessionSourcesPure(S.audioUrl, S.stems));
            if (analyzed && analyzed.length) {
                onsets = analyzed;
                fromLabel = route.bootstrap
                    ? ` from the click stem “${source.name}” (♩ on its row pins or changes the guide)`
                    : fromLabel;
            } else if (!route.bootstrap) {
                setStatus('The tempo guide’s audio could not be analyzed — check the stem, or unlock the guide.');
                return true;
            } else {
                // A click bootstrap is only a preference. If it cannot be
                // decoded, analyze the master explicitly; the active source
                // may be another stem (or the failed click itself).
                const fallbackSources = _trackSessionSourcesPure(S.audioUrl, S.stems);
                const masterSource = _tempoBootstrapFallbackSourcePure(route, fallbackSources);
                if (!masterSource) {
                    setStatus('Suggest needs the recording’s onset analysis — load audio first.');
                    return true;
                }
                const masterUrl = masterSource.url;
                const fallback = await ensureGuideOnsetsShifted(masterSource.id, masterUrl, 0);
                const currentSources = _trackSessionSourcesPure(S.audioUrl, S.stems);
                const currentMaster = _tempoBootstrapFallbackSourcePure(route, currentSources);
                if (!S.tempoMapMode
                    || !_tempoAnalysisRequestStillCurrentPure(request, S.trackSession, currentSources)
                    || !currentMaster || currentMaster.url !== masterUrl) return true;
                if (!fallback || !fallback.length) {
                    setStatus('Suggest needs the recording’s onset analysis — load audio first.');
                    return true;
                }
                onsets = fallback;
                metronome = false;
                fromLabel = '';
            }
        }
    }
    if (!onsets) {
        // The un-routed default: the session recording, plain audio analysis
        // (the mix is never a metronome).
        metronome = !!(route && !route.bootstrap && route.metronome);
        fromLabel = metronome ? ' from the metronome guide' : '';
        onsets = _ensureOnsetsShifted();
        if (!onsets || !onsets.length) {
            setStatus('Suggest needs the recording’s onset analysis — load audio first.');
            return true;
        }
    }
    const scope = _tempoSuggestScopePure(S.beats, S.tempoSel, S.tempoSelMulti, metronome);
    let anchor = scope.anchor;
    if (anchor < 0 || !(S.beats[anchor] && S.beats[anchor].measure > 0)) {
        anchor = S.beats.findIndex(b => b && b.measure > 0);
    }
    if (anchor < 0) {
        setStatus('No downbeats to fit — mark a barline first.');
        return true;
    }
    S.tempoSel = anchor;
    _zonesDismiss();   // one proposal surface at a time — G replaces the zone bands
    const n = _suggestCompute(anchor, onsets, scope.opts);
    host.updateBPMDisplay();   // surfaces the Accept Whole Fit button
    host.draw();
    const inferred = _suggestProposals().filter(p => p.inferred).length;
    const inferredTail = inferred
        ? ` (${inferred} low-confidence continuation${inferred === 1 ? '' : 's'})` : '';
    setStatus(n
        ? `Suggested ${n} barline${n === 1 ? '' : 's'}${fromLabel}${inferredTail} — click a ghost handle to accept through it, or Accept Whole Fit; Esc dismisses`
        : 'No confident suggestions from here — verify this anchor (drag it onto the downbeat) and press G again.');
    return true;
}

function _editorInsertTempoSyncAtCursor() {
    if (!S.tempoMapMode) return false;
    _tempoInsertSyncPoint(S.cursorTime);
    return true;
}

function _editorDeleteTempoSyncSelection() {
    // Bulk-delete the multi-selection when there is one (PR 5a), else the single
    // focus — _tempoDeleteSelection covers both in one undoable command.
    if (!S.tempoMapMode || (S.tempoSel < 0 && !(S.tempoSelMulti && S.tempoSelMulti.size))) {
        setStatus('Select a Tempo Map barline first.');
        return true;
    }
    _tempoDeleteSelection();
    return true;
}

function _editorAdjustTempoMeasureBeats(delta) {
    if (!S.tempoMapMode || S.tempoSel < 0) {
        setStatus('Select a Tempo Map barline first.');
        return true;
    }
    const d = S.tempoSel;
    if (S.beats[d] && S.beats[d].measure > 0) {
        _tempoSetBeatsPerMeasure(d, _tempoMeasureBeatCount(d) + delta);
    }
    return true;
}

function _editorPromptTempoBeatCountAtSelection() {
    if (!S.tempoMapMode || S.tempoSel < 0) {
        setStatus('Select a Tempo Map barline first.');
        return true;
    }
    const d = S.tempoSel;
    if (!S.beats[d] || S.beats[d].measure <= 0) {
        setStatus('Select a Tempo Map measure downbeat first.');
        return true;
    }
    const prevCount = _tempoMeasureBeatCount(d);
    const raw = window.prompt('Set beat count for selected measure (1-16)', String(prevCount));
    if (raw === null) return true;
    const nextCount = parseInt(raw, 10);
    if (!Number.isFinite(nextCount) || nextCount < 1 || nextCount > 16) {
        setStatus('Enter a beat count from 1 to 16.');
        return true;
    }
    _tempoSetBeatsPerMeasure(d, nextCount);
    return true;
}

function _editorPromptTempoBeatUnitAtSelection() {
    if (!S.tempoMapMode || S.tempoSel < 0) {
        setStatus('Select a Tempo Map barline first.');
        return true;
    }
    const d = S.tempoSel;
    if (!S.beats[d] || S.beats[d].measure <= 0) {
        setStatus('Select a Tempo Map measure downbeat first.');
        return true;
    }
    const prevNum = _tempoMeasureBeatCount(d);
    const prevDen = _tempoMeasureDenominator(d);
    const raw = window.prompt('Set beat unit for selected measure (2, 4, 8, or 16)', String(prevDen));
    if (raw === null) return true;
    const newBeats = _tempoSetDenominatorOnBeatsPure(S.beats, d, raw);
    if (!newBeats) {
        setStatus('Enter a beat unit of 2, 4, 8, or 16.');
        return true;
    }
    S.history.exec(new TempoGridCmd(S.beats.map(b => ({ ...b })), newBeats, 'timesig-den'));
    host.updateTempoSigDisplay();
    host.draw();
    const nextDen = _tempoMeasureDenominator(d);
    if (prevDen !== nextDen) {
        setStatus(`Measure ${S.beats[d].measure} time signature changed: ${prevNum}/${prevDen} → ${prevNum}/${nextDen}`);
    }
    return true;
}
// Exported for src/menu-bar.js: menu items dispatch through this exact switch
// (a re-presentation of the command registry, never a second implementation).
export function _editorRunEofCommand(cmd) {
    if (typeof cmd === 'string' && cmd.startsWith('setFretDigit:')) {
        return _editorSetSelectedFret(parseInt(cmd.slice('setFretDigit:'.length), 10));
    }
    if (typeof cmd === 'string' && cmd.startsWith('gotoBookmark:')) {
        return _editorGotoBookmark(parseInt(cmd.slice('gotoBookmark:'.length), 10));
    }
    if (typeof cmd === 'string' && cmd.startsWith('setBookmark:')) {
        return _editorSetBookmark(parseInt(cmd.slice('setBookmark:'.length), 10));
    }
    switch (cmd) {
    case 'save': window.editorSave(); return true;
    case 'toggleWaveform': return _editorToggleWaveform();
    case 'toggleGuideClap': return _editorToggleGuideClap();
    case 'toggleMetronome': return _editorToggleMetronome();
    case 'toggleMixer': return editorToggleMixerPanel();
    case 'togglePlayAllTracks': return editorTogglePlayAllTracks();
    case 'manageStemTracks': return editorToggleStemTracks();
    case 'soloMyStem': return editorSoloMyStem();
    case 'toggleLoopAB': return _editorToggleLoopAB();
    case 'toggleLoopRegion': return editorToggleLoopRegion();
    case 'songFit': _editorSongFit(); return true;
    case 'toggleOnsetStrip': return _editorToggleOnsetStrip();
    case 'togglePartsView': return host.editorTogglePartsView();
    case 'toggleKeyHighlight': return host.editorToggleKeyHighlight();
    case 'renamePart': window.editorRenameArrangement(); return true;
    case 'toggleFollow': return _editorToggleFollow();
    case 'toggleDrumDensity': return _editorToggleDrumDensity();
    case 'showTabPreview': return _editorShowTabPreview();
    case 'cycleViewMode': return host.editorCycleViewMode();
    case 'toggleTabView': return editorToggleTabView();
    case 'movePartEarlier': return host.editorMovePart(-1);
    case 'movePartLater': return host.editorMovePart(+1);
    case 'showShortcutHelp': return _editorShowShortcutDiscovery('Shortcut help');
    case 'openCommandPalette': return editorOpenCommandPalette();
    case 'importMidi': _editorOpenImportMidi(); return true;
    case 'importXml': _editorOpenImportXml(); return true;
    case 'importGp': _editorOpenImportGp(); return true;
    case 'exportGp5': editorExportGp5(); return true;
    case 'prevBeat': _editorJumpBeat(-1); return true;
    case 'nextBeat': _editorJumpBeat(+1); return true;
    case 'prevNote': _editorJumpNote(-1); return true;
    case 'nextNote': _editorJumpNote(+1); return true;
    case 'nudgeTimeLeft': return _editorNudgeSelectionTime(-1);
    case 'nudgeTimeRight': return _editorNudgeSelectionTime(+1);
    case 'prevGrid': _editorJumpGrid(-1); return true;
    case 'nextGrid': _editorJumpGrid(+1); return true;
    case 'prevAnchor': _editorJumpAnchor(-1); return true;
    case 'nextAnchor': _editorJumpAnchor(+1); return true;
    case 'tempoSetPickup': _tempoPromptPickup(); return true;
    case 'toggleSnap': return _editorToggleSnapEnabled();
    case 'shortenSustain': return _editorAdjustSelectedSustain(-_editorSnapStepSeconds());
    case 'lengthenSustain': return _editorAdjustSelectedSustain(+_editorSnapStepSeconds());
    case 'snapDown': window.editorSetSnap(Math.max(0, S.snapIdx - 1)); return true;
    case 'snapUp': window.editorSetSnap(Math.min(SNAP_VALUES.length - 1, S.snapIdx + 1)); return true;
    case 'toggleSnapMode': return _editorToggleSnapMode();
    case 'editFret': { const idxs = _editorCurrentNoteIndices(); if (idxs.length) promptFret(idxs[0]); else setStatus('Select a note first'); return true; }
    case 'suggestFingers': editorSuggestFingers(); return true;
    case 'setFretTen': return _editorSetSelectedFret(10);
    case 'noteMenu': { const idxs = _editorCurrentNoteIndices(); if (idxs.length) showContextMenu(window.innerWidth / 2, window.innerHeight / 2, idxs[0]); else setStatus('Select a note first'); return true; }
    case 'bend': { const idxs = _editorCurrentNoteIndices(); if (idxs.length) promptBend(idxs[0]); else setStatus('Select a note first'); return true; }
    case 'slideEditor': { const idxs = _editorCurrentNoteIndices(); if (idxs.length) promptSlide(idxs[0]); else setStatus('Select a note first'); return true; }
    case 'unpitchedSlide': { const idxs = _editorCurrentNoteIndices(); if (idxs.length) promptSlideUnpitch(idxs[0]); else setStatus('Select a note first'); return true; }
    case 'moveStringUp': return _editorCurrentNoteIndices().length ? _execMoveStringSameFret(+1) : _editorMoveCaretString(+1);
    case 'moveStringDown': return _editorCurrentNoteIndices().length ? _execMoveStringSameFret(-1) : _editorMoveCaretString(-1);
    case 'slideUp': return _editorSetPitchedSlideByStep(+1);
    case 'slideDown': return _editorSetPitchedSlideByStep(-1);
    // In the roll on a fretted part the string axis Shift+↑/↓ walks in
    // String view doesn't exist (Y is pitch), so the same keys cycle the
    // selection through valid same-pitch POSITIONS instead (VA.5).
    case 'transposeStringUp':
        if (_rollReadOnly()) return _execCyclePosition(+1);
        _execMoveString(+1); return true;
    case 'transposeStringDown':
        if (_rollReadOnly()) return _execCyclePosition(-1);
        _execMoveString(-1); return true;
    case 'toggleHammerOn': return _editorToggleTechnique('hammer_on');
    case 'togglePullOff': return _editorToggleTechnique('pull_off');
    case 'toggleTap': return _editorToggleTechnique('tap');
    case 'togglePinchHarmonic': return _editorToggleTechnique('harmonic_pinch');
    case 'toggleNaturalHarmonic': return _editorToggleTechnique('harmonic');
    case 'togglePalmMute': return _editorToggleTechnique('palm_mute');
    case 'toggleFretHandMute': return _editorToggleTechnique('fret_hand_mute');
    case 'toggleMuteOpen': return _editorToggleTechnique('mute', { openFret: true });
    case 'toggleMuteRetain': return _editorToggleTechnique('mute');
    case 'toggleVibrato': return _editorToggleTechnique('vibrato');
    case 'toggleLinkNext': return _editorToggleTechnique('link_next');
    case 'toggleAccent': return _editorToggleTechnique('accent');
    case 'toggleIgnore': return _editorToggleTechnique('ignore');
    case 'toggleTremolo': return _editorToggleTechnique('tremolo');
    case 'togglePop': return _editorToggleTechnique('pluck');
    case 'toggleSlap': return _editorToggleTechnique('slap');
    case 'cyclePickDirection': return _editorCyclePickDirection();
    case 'fretUp': return _editorAdjustSelectedFret(+1);
    case 'fretDown': return _editorAdjustSelectedFret(-1);
    case 'setAnchor': return _editorSetAnchorAtCursor();
    case 'selectLike': return _editorSelectLike();
    case 'duplicateSelection': return _editorDuplicateSelection();
    case 'copySelection': return _editorCopySelection(false);
    case 'cutSelection': return _editorCopySelection(true);
    case 'pasteAtPlayhead': return _editorPasteAtPlayhead();
    case 'splitAtPlayhead': return _editorSplitAtPlayhead();
    case 'toolPalette': return (editorOpenToolPalette(editorShortcutProfile), true);
    case 'resnapSelection': return _editorResnapSelection();
    case 'addSection': return _editorAddSectionAtCursor();
    case 'addPhrase': return _editorAddPhraseAtCursor();
    case 'addToneChange': return _editorAddToneAtCursor();
    case 'addHandshape': return _editorAddHandshapeFromSelection();
    case 'toggleTempoMap': return _editorToggleTempoMapMode();
    case 'setTimeSignature': _editorPromptTempoSignatureAtCursor(); return true;
    case 'tempoBeatCount': return _editorPromptTempoBeatCountAtSelection();
    case 'tempoBeatMinus': return _editorAdjustTempoMeasureBeats(-1);
    case 'tempoBeatPlus': return _editorAdjustTempoMeasureBeats(+1);
    case 'tempoBeatUnit': return _editorPromptTempoBeatUnitAtSelection();
    case 'tempoSetBpm': return _editorPromptTempoBpmAtSelection();
    case 'tempoSuggestFit': return _editorTempoSuggestFit();
    case 'mapHealthNextProblem': return _mapHealthStepProblem(1);
    case 'mapHealthPrevProblem': return _mapHealthStepProblem(-1);
    case 'tempoAcceptWholeFit':
        if (S.tempoMapMode) editorAcceptWholeTempoFit();
        else setStatus('Enter Tempo Map (T) first — Accept Whole Fit commits the active suggestions.');
        return true;
    case 'tempoModulate': return _editorModulateTempoAtSelection();
    case 'tempoTapBpm': return _editorTapTempoAtSelection();
    case 'tempoInsertSync': return _editorInsertTempoSyncAtCursor();
    case 'tempoDeleteSync': return _editorDeleteTempoSyncSelection();
    case 'tempoToggleSyncLock': return _editorToggleSyncLock();
    case 'tempoFullDialog': return _editorUnsupportedEofCommand('Full tempo dialog');
    case 'tempoRebuildGrid': return _editorUnsupportedEofCommand('Beat-grid rebuild');
    case 'toggleGridDisplay': return _editorUnsupportedEofCommand('Grid display toggle');
    case 'customGridSnap': return _editorUnsupportedEofCommand('Custom grid snap');
    case 'midiTones': return _editorUnsupportedEofCommand('MIDI tones');
    case 'placeMoverPhrase': return _editorUnsupportedEofCommand('Mover phrase');
    default: return false;
    }
}

function _editorDispatchFeedbackShortcut(e) {
    if (_editorIsTypingTarget(e)) return false;
    // The delta profiles (Logical / Cableton) resolve their override table
    // first and fall through to the FeedBack meaning for everything else;
    // plain FeedBack skips the table. EOF has its own dispatcher below.
    let cmd = null;
    if (editorShortcutProfile === 'feedback') {
        cmd = _editorFeedbackCommandForKeyPure(e, S.tempoMapMode ? 'tempoMap' : 'note');
    } else if (EDITOR_PROFILE_OVERRIDES[editorShortcutProfile]) {
        cmd = _editorTableCommandForKeyPure(e, S.tempoMapMode ? 'tempoMap' : 'note',
            EDITOR_PROFILE_OVERRIDES[editorShortcutProfile]);
    } else {
        return false;
    }
    if (!cmd) return false;
    const def = _editorCommandById(cmd);
    if (def && def.status !== 'ready') return false;
    e.preventDefault();
    return _editorRunEofCommand(cmd);
}
function _editorDispatchEofShortcut(e) {
    if (editorShortcutProfile !== 'eof' || _editorIsTypingTarget(e)) return false;
    const cmd = _editorEofCommandForKeyPure(e, S.tempoMapMode ? 'tempoMap' : 'note');
    if (!cmd) return false;
    e.preventDefault();
    return _editorRunEofCommand(cmd);
}

function _editorRightClickNoteEdit(e, x, y) {
    const behavior = _editorEffectiveRightClickBehaviorPure(editorShortcutProfile, editorRightClickBehavior);
    if (behavior !== 'eofEdit' || !S.arrangements.length) return false;
    // Block mid-take edits like every other note-editing input — a MIDI take
    // reassigns arr.notes = _recNotes on Stop, so an add/remove here would be
    // silently overwritten and muddle undo history.
    if (_recState === 'recording') return false;
    // Read-only roll (V4/VA.3): in the fretted roll an EOF-style right-click
    // ADD routes through the suggest-position resolver (see below); DELETE
    // stays locked — this write path only adds/repitches, never deletes.
    const keysMode = isKeysMode();
    const laneBottom = keysMode
        ? (TIMELINE_TOP + WAVEFORM_H) + pianoLaneCount() * PIANO_LANE_H
        : (TIMELINE_TOP + WAVEFORM_H) + lanes() * LANE_H;
    if (y < (TIMELINE_TOP + WAVEFORM_H) || y > laneBottom) return false;
    // Only inside the timeline grid — a right-click on the left string/piano
    // label margin (x < LABEL_W) is not a note edit; without this it would
    // clamp xToTime()<0 to 0 and add a note at the song start.
    if (x < LABEL_W) return false;

    const idx = hitNote(x, y);
    if (idx >= 0) {
        if (_rollReadOnly()) { _rollLockNotice(); return true; }
        S.history.exec(new DeleteNotesCmd([idx]));
        host.draw();
        host.updateStatus();
        setStatus('Note removed');
        return true;
    }

    const time = snapTime(Math.max(0, xToTime(x)));
    // Suggest-position write path (VA.3): a fretted part in the roll resolves the
    // clicked SOUNDING pitch to a string/fret (marked suggested) or asks.
    if (_rollReadOnly()) {
        _rollAddByPitch(yToMidi(y), time, e.clientX, e.clientY);
        return true;
    }
    let note;
    if (keysMode) {
        const midi = yToMidi(y);
        note = { time, string: midiToString(midi), fret: midiToFret(midi), sustain: 0, techniques: {} };
    } else {
        note = { time, string: yToStr(y), fret: 0, sustain: 0, techniques: {} };
    }
    const cmd = new AddNoteCmd(note);
    S.history.exec(cmd);
    _tourNoteAction('placeNote');   // C3 Compose tour: step 1 task
    _editBlipAt();
    S.sel.clear();
    if (cmd.idx >= 0) S.sel.add(cmd.idx);
    host.draw();
    host.updateStatus();
    setStatus('Note added');
    return true;
}
export function onContextMenu(e) {
    if (S.drumEditMode) { e.preventDefault(); return; }  // drum-edit mode handles interaction
    if (S.tempoMapMode) { e.preventDefault(); _tempoMapOnContextMenu(e); return; }
    e.preventDefault();
    const { x, y } = getMousePos(e);

    // Tone-lane right-click — slot picker for the hit marker (and a
    // delete entry). Falls through to the existing menu logic when
    // there's no marker under the cursor.
    if (y >= TIMELINE_TOP && y < TIMELINE_TOP + TONE_LANE_H && S.arrangements && S.arrangements.length) {
        if (onToneLaneContextMenu(e, x)) return;
    }
    // Anchor-lane right-click — edit-fret/width + delete.
    if (S.arrangements && S.arrangements.length) {
        const anchorTop = _anchorLaneTopY();
        if (y >= anchorTop && y < anchorTop + ANCHOR_LANE_H) {
            if (onAnchorLaneContextMenu(e, x, y)) return;
        }
    }
    // Handshape-lane right-click — toggle arp / pick shape / delete.
    if (S.arrangements && S.arrangements.length) {
        const hsTop = _handshapeLaneTopY();
        if (y >= hsTop && y < hsTop + HS_LANE_H) {
            if (onHandshapeLaneContextMenu(e, x, y)) return;
        }
    }

    // Right-click tool assignment (feature parity with the left tools): a
    // 'tool:<id>' assignment runs the SAME executor the left button uses, so
    // a tool can never mean different things on different buttons. 'context'
    // and 'eofEdit' keep their existing paths below.
    {
        const _rightAssign = _editorEffectiveRightAssignPure(
            editorShortcutProfile, editorRightClickBehavior);
        // Modified right-clicks keep pointer/context behavior (parity with the
        // left tool path in mouse.js): a bare click runs the assigned tool, but
        // Shift/Ctrl/Meta must not — macOS Ctrl-click especially must never
        // erase or mutate a note instead of opening the context path.
        if (!e.shiftKey && !e.ctrlKey && !e.metaKey
            && _rightAssign.startsWith('tool:')
            && _editorToolClick(_rightAssign.slice(5), e, x, y)) return;
    }

    if (_editorRightClickNoteEdit(e, x, y)) return;

    // Right-click on beat bar or lanes with no note = section menu
    const beatBarY = isKeysMode()
        ? (TIMELINE_TOP + WAVEFORM_H) + pianoLaneCount() * PIANO_LANE_H
        : (TIMELINE_TOP + WAVEFORM_H) + lanes() * LANE_H;
    if (y >= beatBarY || (y >= (TIMELINE_TOP + WAVEFORM_H) && hitNote(x, y) < 0)) {
        showSectionMenu(e.clientX, e.clientY, xToTime(x));
        return;
    }

    const idx = hitNote(x, y);
    if (idx < 0) return;

    if (!S.sel.has(idx)) {
        S.sel.clear();
        S.sel.add(idx);
        // Selection changed — refresh the status bar's selection count
        // and the inspector's bulk-edit state so both reflect the
        // just-right-clicked note instead of the previous selection.
        // host.updateStatus() already calls _renderInspector internally.
        host.updateStatus();
    }
    host.draw();
    showContextMenu(e.clientX, e.clientY, idx);
}

function showSectionMenu(cx, cy, time) {
    const menu = document.getElementById('editor-context-menu');
    // Section within 1 s of the click, if any (shared helper — same match
    // the commands' tests exercise).
    const nearIdx = _sectionNearestIndexPure(S.sections, time, 1.0);
    const nearSection = nearIdx >= 0 ? S.sections[nearIdx] : null;

    // Build the buttons as DOM nodes with textContent — the section name is
    // user-authored (rename), so interpolating it into innerHTML would be a
    // stored-XSS sink when the menu opens.
    const mkBtn = (action, label, danger) => {
        const btn = document.createElement('button');
        btn.className = 'w-full text-left px-3 py-1 text-xs hover:bg-dark-500' + (danger ? ' text-red-400' : '');
        btn.dataset.action = action;
        btn.textContent = label;
        return btn;
    };
    menu.innerHTML = '';
    menu.appendChild(mkBtn('add', 'Add Section Here'));
    if (nearSection) {
        menu.appendChild(mkBtn('rename', `Rename "${nearSection.name}"`));
        menu.appendChild(mkBtn('delete', `Delete "${nearSection.name}"`, true));
    }
    menu.querySelectorAll('[data-action]').forEach(btn => {
        btn.onclick = async () => {
            hideContextMenu();
            if (btn.dataset.action === 'add') {
                const name = await _editorPromptText({
                    title: 'Add Section', label: 'Section name', value: 'verse',
                });
                if (!name) return;
                const num = S.sections.filter(s => s.name === name).length + 1;
                S.history.exec(new AddSectionCmd(
                    { name, number: num, start_time: snapTime(time) }));
                host.draw();
            } else if (btn.dataset.action === 'rename' && nearSection) {
                const name = await _editorPromptText({
                    title: 'Rename Section', label: 'New name', value: nearSection.name,
                });
                if (name && name !== nearSection.name) {
                    S.history.exec(new RenameSectionCmd(nearSection, name));
                    host.draw();
                }
            } else if (btn.dataset.action === 'delete' && nearSection) {
                S.history.exec(new RemoveSectionCmd(nearSection));
                host.draw();
            }
        };
    });
    menu.style.left = cx + 'px';
    menu.style.top = cy + 'px';
    menu.classList.remove('hidden');
}

export function _editorSelectAllPolicyPure(e) {
    // Select All is the unshifted Ctrl/Cmd+A only. Shift+Ctrl+A is a distinct
    // chord (e.g. the EOF profile's Toggle Accent) and must fall through to the
    // shortcut dispatch, not be swallowed here. CapsLock still reports the base
    // key as 'A' without setting shiftKey, so it keeps working.
    if (!e || !(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey
            || String(e.key || '').toLowerCase() !== 'a') return null;

    const target = e.target;
    const isTextEditor = !!(target && typeof target.matches === 'function'
        && target.matches('input, select, textarea, [contenteditable]:not([contenteditable="false"])'));
    return isTextEditor ? 'text' : 'editor';
}

export function onKeyDown(e) {
    // Only handle when editor screen is visible
    const screen = document.getElementById('plugin-editor');
    if (!screen || !screen.classList.contains('active')) return;

    // Read-only Tab preview is a modal proofreading lens — while it's open
    // NO editor shortcut (fret digits, f, arrows, Delete, transport …) may
    // reach the chart hidden behind it, or the "read-only" preview would
    // silently mutate the arrangement and pollute undo/redo. Escape closes
    // it; every other key is swallowed. Mirrors the partsViewMode gate and
    // must sit before the spacebar/transport handler below.
    const _tabPreviewModal = document.getElementById('editor-tab-preview-modal');
    const _tabPreviewOpen = !!(_tabPreviewModal && !_tabPreviewModal.classList.contains('hidden'));
    const _tabPreviewAction = _tabPreviewKeyPolicyPure(_tabPreviewOpen, e.key);
    if (_tabPreviewAction === 'close') {
        e.preventDefault();
        window.editorHideTabPreview();
        return;
    }
    if (_tabPreviewAction === 'swallow') {
        e.preventDefault();
        return;
    }

    // The User Guide (Help ▸ User Guide) is the same class of read-only modal
    // lens as the Tab preview: while it's open NO editor shortcut may reach
    // the chart hidden behind it (a stray H/2/Delete would silently mutate the
    // arrangement and pollute undo/redo). Same policy — Escape closes, every
    // other key is swallowed — and it too must sit before the spacebar handler.
    const _guideModal = document.getElementById('editor-user-guide-modal');
    const _guideOpen = !!(_guideModal && !_guideModal.classList.contains('hidden'));
    const _guideAction = _tabPreviewKeyPolicyPure(_guideOpen, e.key);
    if (_guideAction === 'close') {
        e.preventDefault();
        window.editorToggleUserGuide(false);
        return;
    }
    if (_guideAction === 'swallow') {
        e.preventDefault();
        return;
    }

    // The right-click context / section menu owns Escape to dismiss itself, and
    // it is closed HERE — not by main.js's import-time Escape listener — for the
    // same reason the User Guide close lives here: this runs BEFORE the note /
    // drum deselect branch below, so Escape-to-dismiss a menu can't ALSO wipe
    // the selection the menu was opened on (right-click keeps/sets a selection,
    // then Escape would clear it if both the menu-close and the deselect fired
    // on one keypress). Only Escape is claimed; every other key still passes
    // through to the chart behind the menu, exactly as before.
    const _ctxMenu = document.getElementById('editor-context-menu');
    if (e.key === 'Escape' && _ctxMenu && !_ctxMenu.classList.contains('hidden')) {
        e.preventDefault();
        hideContextMenu();
        return;
    }
    // ── Click tools (CLICK-TOOLS-DESIGN.md) ──────────────────────────
    // While the tool palette is open it owns the keyboard: a tool key picks
    // and closes, second-T runs the per-profile call (FeedBack/Cableton →
    // Tempo Map, the old plain-T habit; Logical → Pointer, Logic-exact),
    // Escape closes, everything else is swallowed.
    if (editorToolPaletteOpen()) {
        e.preventDefault();
        const act = _editorPaletteKeyActionPure(editorShortcutProfile, e.key);
        if (act) {
            editorCloseToolPalette();
            if (act.tool) setEditorLeftTool(act.tool);
            else if (act.mode === 'tempoMap') _editorRunEofCommand('toggleTempoMap');
        }
        return;
    }
    // Plain-key tool entries, note mode only (tempo-map mode keeps its own
    // plain-T = leave-mode meaning; drum edit / parts view own their canvas).
    if (!_editorIsTypingTarget(e) && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey
        && !S.tempoMapMode && !S.drumEditMode && !S.partsViewMode
        && _recState !== 'recording') {
        const _k = (e.key || '').toLowerCase();
        // T opens the palette (every profile EXCEPT Legacy-EOF, whose key
        // map stays 1:1 EOF — plain T there remains Tap; the palette is in
        // the View menu / command palette instead).
        if (_k === _editorPaletteOpenKeyPure(editorShortcutProfile)) {
            e.preventDefault();
            editorOpenToolPalette(editorShortcutProfile);
            return;
        }
        // Cableton: plain B toggles the Pencil — Live's Draw Mode key.
        // (That profile's bend edit stays reachable via the inspector/menu.)
        if (_k === 'b' && editorShortcutProfile === 'cableton') {
            e.preventDefault();
            setEditorLeftTool(editorLeftTool() === 'pencil' ? 'pointer' : 'pencil');
            return;
        }
        // Logical: plain G = Tempo Map — Logic's G shows the global tracks,
        // where the tempo track lives. (That profile's snap toggle stays
        // reachable via the Grid toolbar/menu.)
        if (_k === 'g' && editorShortcutProfile === 'logical') {
            e.preventDefault();
            _editorRunEofCommand('toggleTempoMap');
            return;
        }
    }

    // Select All belongs to the active DAW surface, not Chromium's page-text
    // selection. Claim it before the recording and Parts-view guards below;
    // those read-only states must suppress the browser default without
    // selecting editor objects hidden behind the current surface. Actual text
    // editors retain their native Select All behavior, including inline rename.
    const selectAllPolicy = _editorSelectAllPolicyPure(e);
    if (selectAllPolicy === 'editor') {
        e.preventDefault();
        if (_recState === 'recording' || S.partsViewMode) return;
        if (S.drumEditMode && S.drumTab) {
            // Select every drum hit. No filter — the user wants every
            // hit even off-screen, mirroring the guitar Ctrl+A path.
            S.drumSel = new Set();
            const hits = S.drumTab.hits || [];
            for (let i = 0; i < hits.length; i++) S.drumSel.add(i);
            host.draw();
            return;
        }
        // Tempo-map mode: Ctrl+A selects every downbeat (PR 5a).
        if (S.tempoMapMode) {
            if (!S.tempoSelMulti) S.tempoSelMulti = new Set();
            S.tempoSelMulti.clear();
            const beats = S.beats || [];
            for (let i = 0; i < beats.length; i++) if (beats[i] && beats[i].measure > 0) S.tempoSelMulti.add(i);
            host.draw();
            setStatus(`${S.tempoSelMulti.size} barline${S.tempoSelMulti.size === 1 ? '' : 's'} selected.`);
            return;
        }
        const nn = notes();
        S.sel.clear();
        for (let i = 0; i < nn.length; i++) S.sel.add(i);
        host.draw();
        return;
    }
    if (selectAllPolicy === 'text') return;

    if (e.key === ' ' && !e.target.matches('input, select, textarea')) {
        e.preventDefault();
        window.editorTogglePlay();
        return;
    }

    // Block all mutating shortcuts while a take is active so mid-take
    // edits can't be silently overwritten when arr.notes = _recNotes on
    // Stop. This covers tempo-map structural edits (Insert / [ ] /
    // Delete) and note edits alike. Spacebar (above) is still allowed
    // because it routes to editorTogglePlay → editorStopRecordMidi,
    // which cleanly finalizes the take.
    if (_recState === 'recording') return;

    // Parts view is a read-only overview — technique editing stays in the
    // focus editors. Ignore every note-editing shortcut (fret digits, f,
    // arrows, Delete, technique toggles) so they can't mutate the armed
    // arrangement hidden behind the overview. Transport (spacebar, handled
    // above) and the Parts toggle (Shift+A) stay live; Escape is handled by
    // the global dialog listener. Mirrors the !S.drumEditMode / !S.tempoMapMode
    // gating used on the individual edit paths below.
    if (S.partsViewMode
            && _editorFeedbackCommandForKeyPure(e, 'note') !== 'togglePartsView'
            && _editorEofCommandForKeyPure(e, 'note') !== 'togglePartsView') {
        return;
    }

    // Drum-edit articulation toggles take priority over the shortcut-profile
    // dispatch: a plain 'f' in drum-edit mode must toggle flam, not resolve to
    // the FeedBack/EOF `editFret` command (which claims plain 'f'). Only fires
    // with a drum selection; otherwise falls through to the dispatch below.
    if (S.drumEditMode && S.drumSel.size && S.drumTab
        && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey
        && !e.target.matches('input, select, textarea')) {
        const dk = e.key.toLowerCase();
        if (dk === 'g' || dk === 'f' || dk === 'k') {
            e.preventDefault();
            _drumEditorToggleArticulation(dk);
            host.draw();
            return;
        }
        // Velocity quick-sets: A = accent, N = normal. In drum mode these
        // would otherwise fall through to note commands (toggleAccent /
        // noteMenu) that no-op on an empty note selection.
        if (dk === 'a' || dk === 'n') {
            e.preventDefault();
            if (dk === 'a') _drumEditorSetVelocity(115, 'Accent');
            else _drumEditorSetVelocity(100, 'Normal');
            host.draw();
            return;
        }
    }

    // Drum velocity nudge: Shift+↑/↓ = ±10 on the selection. Claimed here
    // (before the profile dispatch) because in drum mode the note-transpose
    // commands those keys map to only no-op against the empty note selection.
    if (S.drumEditMode && S.drumSel.size && S.drumTab
        && e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey
        && (e.key === 'ArrowUp' || e.key === 'ArrowDown')
        && !e.target.matches('input, select, textarea')) {
        e.preventDefault();
        _drumEditorNudgeVelocity(e.key === 'ArrowUp' ? 10 : -10);
        host.draw();
        return;
    }

    // Loop-edge nudge: Alt+←/→ moves the loop START by its mode's natural
    // step; Alt+Shift+←/→ moves the END. Adding Ctrl takes the coarse step
    // (free mode: ±50 ms instead of ±10 ms — same idiom the retired strip's
    // Shift-drag used, before Shift here got reassigned to the edge). Replaces
    // the retired loop strip's focusable-handle arrow keys (the handles left
    // with the strip — the ruler is canvas, so the keyboard path claims a
    // chord instead). Alt keeps it clear of the plain/Ctrl arrow note-ops
    // (which never carry Alt); direct handling mirrors the drum-velocity
    // nudge precedent above.
    if (S.barSel && e.altKey && !e.metaKey
        && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')
        && !e.target.matches('input, select, textarea')) {
        e.preventDefault();
        _loopNudgeEdge(e.shiftKey ? 'end' : 'start', e.key === 'ArrowRight' ? 1 : -1, e.ctrlKey);
        host.draw();
        return;
    }

    // A pending tap-tempo run owns Enter/Escape until resolved — checked
    // before the profile dispatchers so neither can steal the keys.
    if (_tapTempoHandleKey(e)) return;

    // Suggested-fit ghosts own Escape while showing (proposal-only state —
    // dismissal must never fall through to anything destructive).
    if (e.key === 'Escape' && S.tempoMapMode && _suggestActive()
            && !e.target.matches('input, select, textarea')) {
        e.preventDefault();
        _suggestDismiss();
        host.updateBPMDisplay();   // retire the Accept Whole Fit button too
        host.draw();
        setStatus('Suggestions dismissed');
        return;
    }
    // Escape clears a barline multi-selection (PR 5a) — layered UNDER the
    // suggest-dismiss above, so ghosts always own Escape first.
    if (e.key === 'Escape' && S.tempoMapMode && S.tempoSelMulti && S.tempoSelMulti.size
            && !e.target.matches('input, select, textarea')) {
        e.preventDefault();
        S.tempoSelMulti.clear();
        host.draw();
        setStatus('Selection cleared');
        return;
    }
    // Escape drops the note / drum selection — the standard DAW "clear
    // selection" gesture, absent until now (Escape only ever fired in
    // tempo-map mode). Layered UNDER every earlier Escape owner: the read-only
    // Tab-preview / User-Guide lenses (handled at the top of onKeyDown, which
    // return before reaching here) and the tempo-map suggest-dismiss /
    // barline-clear branches just above (which return in tempo mode; guarded
    // out here by !S.tempoMapMode). The transient modals (add-note, context
    // menu, load, palette) are closed by main.js's import-time keydown
    // listener, which runs first. Non-destructive: selection is not undo
    // state, so this touches no history; it no-ops (falls through) when
    // nothing is selected, keeping Escape free for anything downstream.
    if (e.key === 'Escape' && !S.tempoMapMode
            && !e.target.matches('input, select, textarea')
            && (S.sel.size || (S.drumSel && S.drumSel.size))) {
        e.preventDefault();
        S.sel.clear();
        if (S.drumSel) S.drumSel.clear();
        _renderInspector();
        host.draw();
        setStatus('Selection cleared');
        return;
    }

    if (_editorDispatchFeedbackShortcut(e)) return;
    if (_editorDispatchEofShortcut(e)) return;

    // Tempo-map mode: Insert key adds a sync point at the cursor.
    if (S.tempoMapMode && e.key === 'Insert'
            && !e.target.matches('input, select, textarea')) {
        e.preventDefault();
        _tempoInsertSyncPoint(S.cursorTime);
        return;
    }

    if (e.key === 'Delete' || e.key === 'Backspace') {
        // Tempo-map mode: delete the selected barline(s) — bulk when a
        // multi-selection exists (PR 5a), else the single focus.
        if (S.tempoMapMode && (S.tempoSel >= 0 || (S.tempoSelMulti && S.tempoSelMulti.size)) &&
                !e.target.matches('input, select, textarea')) {
            e.preventDefault();
            _tempoDeleteSelection();
            return;
        }
        // Anchor-lane: delete the selected anchor. Same focus / mode
        // gates as the tone-lane Del path.
        if (S.anchorSel && !S.drumEditMode && !S.tempoMapMode &&
                !e.target.matches('input, select, textarea')) {
            const arr = _currentAnchorArr();
            if (arr && Array.isArray(arr.anchors_user)
                    && arr.anchors_user.includes(S.anchorSel)) {
                e.preventDefault();
                S.history.exec(new RemoveAnchorCmd(S.currentArr, S.anchorSel));
                S.anchorSel = null;
                host.draw();
                return;
            }
        }
        // Handshape-lane: delete the selected handshape. Same gates.
        if (S.handshapeSel && !S.drumEditMode && !S.tempoMapMode &&
                !e.target.matches('input, select, textarea')) {
            const arr = _currentAnchorArr();
            if (arr && Array.isArray(arr.handshapes)
                    && arr.handshapes.includes(S.handshapeSel)) {
                e.preventDefault();
                S.history.exec(new RemoveHandshapeCmd(S.currentArr, S.handshapeSel));
                // Drop any in-flight drag on the just-deleted handshape so a
                // trailing mouseup can't enqueue a move/resize for a detached
                // object (and falsely bump the dirty count).
                if (S.drag && S.drag.type === 'handshape' && S.drag.hs === S.handshapeSel) {
                    S.drag = null;
                }
                S.handshapeSel = null;
                host.draw();
                return;
            }
        }
        // Tone-lane: delete the selected tone-change marker. Same
        // input-focus guard as the note-delete path below. Skip when
        // drum-edit or tempo-map mode is active — those modes own
        // Delete for their own selections, and `S.toneSel` isn't
        // cleared when entering them, so an old tone selection could
        // otherwise hijack the keypress.
        if (S.toneSel && !S.drumEditMode && !S.tempoMapMode &&
                !e.target.matches('input, select, textarea')) {
            const arr = _currentToneArr();
            if (arr && arr.tones && Array.isArray(arr.tones.changes)
                    && arr.tones.changes.includes(S.toneSel)) {
                e.preventDefault();
                S.history.exec(new RemoveToneChangeCmd(S.currentArr, S.toneSel));
                S.toneSel = null;
                host.draw();
                return;
            }
        }
        // Drum-edit mode: delete selected drum hits via DeleteDrumHitsCmd,
        // so the delete undoes/redoes like the note-delete path below.
        // Guard against focus being inside a form control (mirrors the note-
        // delete path below) so typing in a text input doesn't delete hits.
        if (S.drumEditMode && S.drumSel.size && S.drumTab &&
                !e.target.matches('input, select, textarea')) {
            e.preventDefault();
            _drumEditorDeleteSelection();
            host.draw();
            return;
        }
        // Guard: in drum-edit mode S.sel may still hold a prior guitar/keys
        // selection from before mode entry; deleting those notes while the
        // user thinks they're editing drums would be surprising. Only run
        // the guitar/keys delete path when drum-edit mode is inactive.
        if (!S.drumEditMode && !S.tempoMapMode && S.sel.size && !e.target.matches('input, select, textarea')) {
            e.preventDefault();
            S.history.exec(new DeleteNotesCmd([...S.sel]));
            host.draw();
            host.updateStatus();
            return;
        }
    }
    // Ctrl+Alt+Z — undo to the last checkpoint. Must precede the plain Ctrl+Z
    // below (which doesn't exclude Alt, so it would otherwise swallow this).
    if ((e.ctrlKey || e.metaKey) && e.altKey && !e.shiftKey && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault();
        window.editorUndoToCheckpoint();
        return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        e.preventDefault();
        window.editorUndo();
        return;
    }
    if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.shiftKey && e.key === 'Z'))) {
        e.preventDefault();
        window.editorRedo();
        return;
    }
    if ((e.ctrlKey || e.metaKey) && (e.key === 'd' || e.key === 'D')) {
        // Duplicate the selection to the next position. preventDefault so
        // the browser's bookmark shortcut doesn't fire. (Copy/cut/paste are
        // registry commands now — resolved by the shortcut profiles, listed
        // in the Edit menu and the shortcut panel.)
        if (!S.drumEditMode && !S.tempoMapMode && S.sel.size
                && !e.target.matches('input, select, textarea')) {
            e.preventDefault();
            _editorDuplicateSelection();
            return;
        }
    }
}
