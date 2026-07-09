/* Slopsmith Arrangement Editor — DAW-style timeline note editor */

import {
    SNAP_VALUES,
    _editorEffectiveSnapValuePure,
    _editorSnapSubdivisionsPure,
} from './snap.js';
import {
    PIANO_NOTE_NAMES,
    SCALE_INTERVALS,
    SCALE_LABELS,
    _detectKeyPure,
} from './theory.js';
import { DPR, canvas, ctx, setCanvas } from './canvas.js';
import { beatOf, timeOf } from './beats.js';
import {
} from './position.js';
import { _composeSongDurationPure, _transportChartTimePure } from './transport.js';
import { _editorEscHtml, _editorPromptText, _installModalKeyboard, setStatus } from './ui.js';
import { hitNote, hitNoteEdge } from './hit-test.js';
import { EditHistory } from './history.js';
import {
    AddNoteCmd, AddStringCmd, ChangeFretCmd, ChangeFretGroupCmd,
    DeleteNotesCmd, EditChordFnCmd, MoveNoteCmd, RemoveStringCmd,
    ReplaceArrangementChartCmd, ResizeSustainGroupCmd, SetBendIntentCmd,
    SetBendShapeCmd, SetPitchedSlideTargetsCmd, SetTeachingMarkCmd, ToggleTechniqueCmd,
    _canMoveString, _execAcceptPositions, _execCyclePosition, _execMoveString,
    _ROLL_REFUSE_REASONS, _commitAddResolved, _execMoveStringSameFret, _normalizeTuningToLanes,
    _rollAddByPitch, _rollDragPitchMove, _withStableSelection,
} from './commands.js';
import {
    _uploadAudioForMode, createState, editorApplyCreateResult, editorArtSearch,
    editorAutoSyncAudioSelected, editorAutoSyncYtFetch, editorBuild,
    editorContentImportSelected, editorCreateArtSelected, editorDoCreate,
    editorEofFilesSelected, editorGPFileSelected, editorHideCreateModal, editorIdentifyAudio,
    editorMbMatch, editorRefineSync, editorSetAudioMode, editorSetCreateMode,
    editorSetGP8AudioMode, editorShowCreateModal, editorShowCreateSloppakModal,
    editorShowNewFormatPicker, editorStagedRemove, editorYtUrlInput, initCreate,
} from './create.js';
import {
    _recMidiBackend, _recState, drawGhostNotes, editorHideRecordMidiModal,
    editorRecordMidiDeviceChanged, editorShowRecordMidiModal, editorStartRecordMidi,
    editorStopRecordMidi,
} from './midi-record.js';
import { setHostHooks } from './host.js';
import {
    MIN_MEASURE, TempoGridCmd, TempoMapCmd, _editorModulateTempoAtSelection,
    _editorTapTempoAtSelection, _editorToggleSyncLock, _editorToggleTempoMapMode, _liftAllBeats,
    _r3, _refreshTempoMapButton, _refreshTempoSyncInspector, _respaceWithLocksPure,
    _restoreBeatLocks, _stripBeatsFromSaveBody, _tapTempoHandleKey,
    _tempoBeatOnDragMove, _tempoDeleteSyncPoint, _tempoFlattenToBpmPure,
    _tempoHasMultipleMeasureBpmsPure, _tempoInsertSyncPoint, _tempoMapDraw, _tempoMapOnContextMenu,
    _tempoMapOnDragEnd, _tempoMapOnDragMove, _tempoMapOnMouseDown, _tempoMeasureBeatCount,
    _tempoMeasureDenominator, _tempoMeasures, _tempoNormalizeDenominatorPure,
    _tempoPromptMeasureBpm, _tempoSetBeatsPerMeasure, _tempoSetDenominatorOnBeatsPure,
    _tempoSetMeasureBpmPure, _tempoSyncAtX,
} from './tempo.js';
import {
    AddAnchorCmd, AddHandshapeCmd, AddToneChangeCmd, EditChordTemplateCmd, RemoveAnchorCmd,
    RemoveHandshapeCmd, RemoveToneChangeCmd,
    _anchorLaneTopY, _anchorsAreDirty, _currentAnchorArr, _currentToneArr,
    _ensureTones, _handshapeLaneTopY, _readAnchorSnapshot,
    _stripToneInternals, _tonesAreDirty, _updateTonesButtonVisibility, drawAnchorLane,
    drawHandshapeLane, drawToneLane, editorApplyTonesModal, editorHideTonesModal,
    editorShowTonesModal, onAnchorLaneContextMenu, onAnchorLaneMouseDown,
    onAnchorLaneMouseMove, onAnchorLaneMouseUp, onHandshapeLaneContextMenu,
    onHandshapeLaneMouseDown, onHandshapeLaneMouseMove, onHandshapeLaneMouseUp,
    onToneLaneContextMenu, onToneLaneMouseDown, onToneLaneMouseMove, onToneLaneMouseUp,
} from './annotation-lanes.js';
import {
    DRUM_PIECE_META, DRUM_PIECE_ORDER, _drumEditorDeleteSelection, _drumEditorDraw,
    _drumEditorNudgeVelocity, _drumEditorOnDragEnd, _drumEditorOnDragMove,
    _drumEditorOnMouseDown, _drumEditorOnSelectEnd, _drumEditorOnVelocityDragEnd,
    _drumEditorOnVelocityDragMove, _drumEditorSetVelocity, _drumEditorToggleArticulation,
    _drumImportHitPure, _editorToggleDrumDensity, _refreshDrumDensityButton,
    _refreshDrumEditButton,
} from './drum.js';
import {
    _editorCommandById,
    _editorEffectiveRightClickBehaviorPure,
    _editorEofCommandForKeyPure,
    _editorFeedbackCommandForKeyPure,
    _editorIsTypingTarget,
    _editorLoadShortcutProfile,
    _editorRenderShortcutPanel,
    editorRightClickBehavior,
    editorSetRightClickBehavior,
    editorSetShortcutProfile,
    editorShortcutProfile,
} from './shortcuts.js';
import {
    _beatBarTopY,
    _loadEditorKeyIfNeeded,
    _persistEditorKey,
    drawBarSel,
    drawBeatBar,
    drawCursor,
    drawGrid,
    drawLabels,
    drawLanes,
    drawNotes,
    drawSections,
    drawSelectionRect,
    editorKeyHighlightEnabled,
} from './draw.js';
import { S, editGen } from './state.js';
import {
    LC,
    _seedExtendedStringsFromTuning,
    _stringCountFor,
    laneLabels,
    laneToStr,
    lanes,
    strToLane,
} from './lanes.js';
import {
    ANCHOR_LANE_H,
    BEAT_H,
    EDITOR_SCROLL_TAIL_SECONDS,
    HS_LANE_H,
    LABEL_W,
    LANE_H,
    TONE_LANE_H,
    WAVEFORM_H,
    _editorClampScrollXPure,
    _editorViewportDurationPure,
    setLaneMetrics,
    strToY,
    timeToX,
    xToTime,
    yToStr,
} from './geometry.js';
import {
    KEYS_PATTERN, PIANO_LANE_H, _inKeyboardGutterPure, _partViewKeyPure, _rollLockNotice,
    _rollMidiForNote, _rollPitchCtx, _rollReadOnly, _uniqueKeysName, _viewPrefs,
    _viewPrefsSave, isKeysArr, isKeysMode, midiToFreq, midiToFret, midiToNote, midiToString,
    midiToY, noteToMidi, pianoLaneCount, updatePianoRange, viewFor, yToMidi,
} from './keys.js';
import {
    BEND_INTENTS,
    FRET_FINGER_OPTIONS,
    _isSuggested,
    _resizeSustainsForDeltaPure,
    _resizeTargetIndicesPure,
    _restoreSuggestedMarks,
    _saveSuggestedMarks,
    _suggestedCount,
    _suggestedStorageKeyPure,
    bendPresetCurve,
    chords,
    nextUnusedStrumGroup,
    notes,
    rescaleBendCurveToPeak,
    sanitizeBendCurve,
} from './notes.js';
import {
    _fretKeyForL,
    _groupFn,
    _handshapesAreDirty,
    _normFingers,
    _normalizeHandshape,
    _parseGuideTones,
    _sanitizeCaged,
    _sanitizeGuideTones,
    flattenChords,
    reconstructChords,
} from './chords.js';

(function () {
'use strict';

// ════════════════════════════════════════════════════════════════════
// Constants
// ════════════════════════════════════════════════════════════════════


// ════════════════════════════════════════════════════════════════════
// State
// ════════════════════════════════════════════════════════════════════



let rafId = null;

// ════════════════════════════════════════════════════════════════════
// Coordinate mapping
// ════════════════════════════════════════════════════════════════════

function _editorViewportDuration() {
    const w = canvas ? canvas.width / DPR : 800;
    return _editorViewportDurationPure(w, LABEL_W, S.zoom);
}

function _editorClampScrollX(scrollX) {
    return _editorClampScrollXPure(scrollX, S.duration, _editorViewportDuration(), EDITOR_SCROLL_TAIL_SECONDS);
}

function _editorApplyScrollBounds() {
    S.scrollX = _editorClampScrollX(S.scrollX);
    return S.scrollX;
}
// ── Bar selection (Loop-in-3D handoff) ──────────────────────────────
/* @pure:loop-region:start */
function _barSpanForTimesPure(downbeats, duration, t0, t1) {
    if (!Array.isArray(downbeats) || !downbeats.length) return null;
    const lo = Math.min(t0, t1);
    const hi = Math.max(t0, t1);
    let start = downbeats[0];
    for (const t of downbeats) {
        if (t <= lo + 1e-6) start = t;
        else break;
    }
    let end = null;
    for (const t of downbeats) {
        if (t > hi + 1e-6) {
            end = t;
            break;
        }
    }
    if (end === null) end = Math.max(duration || hi, hi);
    return end > start ? { startTime: start, endTime: end } : null;
}

function _adjustBarSelEdgePure(region, edge, rawTime, downbeats, duration) {
    if (!region || !Array.isArray(downbeats) || !downbeats.length) return region;
    if (edge === 'start') {
        let start = downbeats[0];
        for (const t of downbeats) {
            if (t <= rawTime + 1e-6) start = t;
            else break;
        }
        start = Math.min(start, region.endTime);
        if (start >= region.endTime - 1e-6) {
            const idx = downbeats.findIndex(t => Math.abs(t - region.endTime) <= 1e-6);
            if (idx > 0) start = downbeats[idx - 1];
            else start = Math.min(start, region.startTime);
        }
        return region.endTime > start ? { startTime: start, endTime: region.endTime } : region;
    }
    if (edge === 'end') {
        let end = null;
        for (const t of downbeats) {
            if (t > rawTime + 1e-6) {
                end = t;
                break;
            }
        }
        if (end === null) end = Math.max(duration || rawTime, rawTime);
        end = Math.max(end, region.startTime);
        if (end <= region.startTime + 1e-6) {
            const idx = downbeats.findIndex(t => Math.abs(t - region.startTime) <= 1e-6);
            if (idx >= 0 && idx < downbeats.length - 1) end = downbeats[idx + 1];
            else end = Math.max(duration || rawTime, rawTime);
        }
        return end > region.startTime ? { startTime: region.startTime, endTime: end } : region;
    }
    return region;
}

function _normalizeLoopRegionPure(region, duration) {
    if (!region) return null;
    let start = Number(region.startTime);
    let end = Number(region.endTime);
    if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
    if (end < start) [start, end] = [end, start];
    const maxT = Number(duration);
    if (Number.isFinite(maxT) && maxT > 0) {
        start = Math.max(0, Math.min(start, maxT));
        end = Math.max(0, Math.min(end, maxT));
    } else {
        start = Math.max(0, start);
        end = Math.max(0, end);
    }
    return end > start + 0.001 ? { startTime: start, endTime: end } : null;
}

function _loopPlaybackRestartTimePure(cursorTime, region, enabled, duration) {
    if (!enabled) return null;
    const r = _normalizeLoopRegionPure(region, duration);
    if (!r) return null;
    const t = Number(cursorTime);
    if (!Number.isFinite(t)) return null;
    return t >= r.endTime - 0.001 ? r.startTime : null;
}

// ── Loop snap modes ──────────────────────────────────────────────────
// The loop region supports three edit modes (D16): 'bar' = whole-downbeat
// spans (the original behavior), 'grid' = edges snapped by snapFn (the
// editor's subdivision snap — which itself returns raw time when snapping
// is disabled), 'free' = unsnapped. Bar mode silently degrades to free when
// the chart has no downbeats, so an un-gridded drifting-tempo song can
// still loop. Regions carry `mode` so later grid edits relock bar/grid
// loops but never move a freely drawn one (D17).

function _loopRegionForDragPure(mode, t0, t1, downbeats, duration, snapFn) {
    let region;
    if (mode === 'bar' && Array.isArray(downbeats) && downbeats.length) {
        region = _barSpanForTimesPure(downbeats, duration, t0, t1);
    } else {
        const snap = (mode === 'grid' && typeof snapFn === 'function') ? snapFn : (t => t);
        region = _normalizeLoopRegionPure(
            { startTime: snap(Math.min(t0, t1)), endTime: snap(Math.max(t0, t1)) },
            duration);
    }
    if (region) region.mode = mode;
    return region;
}

function _loopEdgeAdjustPure(mode, region, edge, rawTime, downbeats, duration, snapFn) {
    if (!region) return region;
    let next;
    if (mode === 'bar' && Array.isArray(downbeats) && downbeats.length) {
        next = _adjustBarSelEdgePure(region, edge, rawTime, downbeats, duration);
    } else {
        const snap = (mode === 'grid' && typeof snapFn === 'function') ? snapFn : (t => t);
        const t = snap(rawTime);
        const moved = edge === 'start'
            ? { startTime: Math.min(t, region.endTime - 0.001), endTime: region.endTime }
            : { startTime: region.startTime, endTime: Math.max(t, region.startTime + 0.001) };
        next = _normalizeLoopRegionPure(moved, duration) || region;
    }
    if (next) next.mode = mode;
    return next;
}
/* @pure:loop-region:end */

// Downbeat times in ascending order, from the song-wide beat grid.
function _downbeatTimes() {
    return S.beats.filter(b => b.measure > 0).map(b => b.time).sort((a, b) => a - b);
}
// Snap a pair of raw times to a whole-bar span: start = the downbeat at or
// before the earlier time, end = the downbeat strictly after the later time
// (falling back to the song end). Returns null when the chart has no
// downbeats (so the beat bar can't define bars).
function _barSpanForTimes(t0, t1) {
    return _barSpanForTimesPure(_downbeatTimes(), S.duration || Math.max(t0, t1), t0, t1);
}

// ── Piano roll mode helpers ─────────────────────────────────────────

function _loopStripTrackBounds() {
    const track = document.getElementById('editor-loop-strip-track');
    if (!track) return null;
    const r = track.getBoundingClientRect();
    return { left: r.left, width: Math.max(1, r.width) };
}

function _loopStripTimeFromClientX(clientX) {
    const b = _loopStripTrackBounds();
    if (!b || !canvas) return 0;
    const ratio = Math.max(0, Math.min(1, (clientX - b.left) / b.width));
    const viewDur = Math.max(0, ((canvas.width / DPR) - LABEL_W) / S.zoom);
    return S.scrollX + ratio * viewDur;
}

function _fmtLoopTime(t) {
    const total = Math.max(0, t || 0);
    const m = Math.floor(total / 60);
    const s = Math.floor(total % 60);
    const ms = Math.floor((total - Math.floor(total)) * 10);
    return m + ':' + String(s).padStart(2, '0') + '.' + ms;
}

function _regionMeasureLabel(region) {
    const starts = _downbeatTimes();
    if (!region || !starts.length) return _fmtLoopTime(region && region.startTime || 0);
    let startMeasure = 1;
    let endMeasure = startMeasure;
    for (let i = 0; i < starts.length; i++) {
        if (starts[i] <= region.startTime + 1e-6) startMeasure = i + 1;
        if (starts[i] < region.endTime - 1e-6) endMeasure = i + 1;
    }
    return 'Bars ' + startMeasure + '–' + endMeasure;
}

function _renderLoopStrip() {
    const root = document.getElementById('editor-loop-strip');
    const empty = document.getElementById('editor-loop-strip-empty');
    const sel = document.getElementById('editor-loop-strip-selection');
    const clear = document.getElementById('editor-loop-strip-clear');
    const label = document.getElementById('editor-loop-strip-label');
    if (!root || !empty || !sel || !clear || !label || !canvas) return;
    const beatsReady = _downbeatTimes().length > 0;
    // Never dim or disable the strip: free-mode loops work without a bar
    // grid, so an un-gridded song can loop while its tempo map is authored.
    root.classList.remove('opacity-60');
    empty.textContent = beatsReady
        ? 'Drag to set loop region'
        : 'Drag to set loop (free — no bar grid yet)';
    _refreshLoopModeButtons();
    if (!S.barSel) {
        sel.classList.add('hidden');
        clear.classList.add('hidden');
        empty.classList.remove('hidden');
        _updateLoopRegionControls();
        return;
    }
    _updateLoopRegionControls();
    empty.classList.add('hidden');
    sel.classList.remove('hidden');
    clear.classList.remove('hidden');
    const viewDur = Math.max(0, ((canvas.width / DPR) - LABEL_W) / S.zoom);
    const left = ((S.barSel.startTime - S.scrollX) / Math.max(0.0001, viewDur)) * 100;
    const right = ((S.barSel.endTime - S.scrollX) / Math.max(0.0001, viewDur)) * 100;
    const clampedLeft = Math.max(0, Math.min(100, left));
    const clampedRight = Math.max(0, Math.min(100, right));
    sel.style.left = clampedLeft + '%';
    sel.style.width = Math.max(0, clampedRight - clampedLeft) + '%';
    // "Bars X–Y" only describes a whole-bar span honestly — grid/free
    // regions get the plain time range instead of a misleading bar label.
    const barLabelOk = (S.barSel.mode === 'bar' || S.barSel.mode === undefined)
        && _downbeatTimes().length > 0;
    label.textContent = (barLabelOk ? _regionMeasureLabel(S.barSel) + '  ' : '')
        + _fmtLoopTime(S.barSel.startTime) + '–' + _fmtLoopTime(S.barSel.endTime);
    sel.classList.toggle('ring-2', !!S.loopEnabled);
    sel.classList.toggle('ring-accent-light', !!S.loopEnabled);
    _updateLoopRegionControls();
}

function _clearBarSelection() {
    S.barSel = null;
    S.loopEnabled = false;
    _updateLoopRegionControls();
    _updateLoopIn3DBtn();
    draw();
}

// ── Loop snap-mode preference (editor pref, never the feedpak) ───────
let _loopSnapModePref = (() => {
    try {
        const m = localStorage.getItem('editorLoopSnapMode');
        return (m === 'grid' || m === 'free') ? m : 'bar';
    } catch (_) { return 'bar'; }
})();

// Effective mode for a live edit: Shift = temporary Free (the universal
// bypass-snap idiom); no downbeats = Free is the only honest mode.
function _loopLiveMode(shiftKey) {
    if (shiftKey) return 'free';
    if (!_downbeatTimes().length) return 'free';
    return _loopSnapModePref;
}

window.editorSetLoopSnapMode = (mode) => {
    if (mode !== 'bar' && mode !== 'grid' && mode !== 'free') return;
    _loopSnapModePref = mode;
    try { localStorage.setItem('editorLoopSnapMode', mode); } catch (_) {}
    _refreshLoopModeButtons();
    setStatus(mode === 'bar' ? 'Loop snaps to whole bars'
        : mode === 'grid' ? 'Loop snaps to the current grid subdivision'
        : 'Loop edges are free — no snapping (hold Shift for this in any mode)');
};

function _refreshLoopModeButtons() {
    const group = document.getElementById('editor-loop-strip-modes');
    if (!group) return;
    const gridless = !_downbeatTimes().length;
    for (const btn of group.querySelectorAll('button[data-loop-mode]')) {
        const mode = btn.dataset.loopMode;
        const active = gridless ? mode === 'free' : mode === _loopSnapModePref;
        btn.classList.toggle('bg-accent', active);
        btn.classList.toggle('text-white', active);
        btn.classList.toggle('text-gray-400', !active);
        // Bar/Grid need a beat grid; until one exists Free is forced.
        const disabled = gridless && mode !== 'free';
        btn.disabled = disabled;
        btn.classList.toggle('opacity-40', disabled);
        btn.title = disabled ? 'Needs a bar grid — set up the tempo map first' : btn.dataset.loopTitle || '';
    }
}

/* @pure:loop-nudge:start */
// Probe time for nudging one loop edge by its mode's natural step:
// bar → the adjacent downbeat (end edges probe a hair EARLY because the
// bar adjuster resolves "downbeat strictly after the probe" — feeding the
// target downbeat verbatim would overshoot by a bar), grid → one snap
// step, free → ±10 ms (±50 ms coarse). Returns null when there is no
// adjacent downbeat to move to (never wraps).
function _loopNudgeProbePure(mode, edge, cur, dir, downbeats, snapStep, coarse) {
    if (mode === 'bar' && Array.isArray(downbeats) && downbeats.length) {
        let target;
        if (dir > 0) {
            target = downbeats.find(t => t > cur + 1e-6);
        } else {
            for (let i = downbeats.length - 1; i >= 0; i--) {
                if (downbeats[i] < cur - 1e-6) { target = downbeats[i]; break; }
            }
        }
        if (target === undefined) return null;
        return edge === 'end' ? target - 0.001 : target;
    }
    if (mode === 'grid') return cur + dir * snapStep;
    return cur + dir * (coarse ? 0.05 : 0.01);
}
/* @pure:loop-nudge:end */

// Nudge one loop edge by the natural step of the region's snap mode.
// Driven by arrow keys while a loop handle button has focus.
function _loopNudgeEdge(edge, dir, coarse) {
    const r = S.barSel;
    if (!r) return false;
    // Resolve the mode LIVE, exactly like the drag path (_loopStripOnMouseMove
    // uses _loopLiveMode): Shift forces Free, the loop snap-mode pref is
    // honored, and a gridless chart degrades to Free — rather than trusting the
    // region's stored mode (which diverged from the rest of the editor and
    // ignored Shift). `coarse` IS e.shiftKey, so it also selects the 50 ms Free
    // step. Grid mode with the subdivision snap turned OFF has no meaningful
    // step (a whole-beat jump would be a jarring "nudge"), so it degrades to
    // Free too — matching the snap-off⇒Free coupling used elsewhere.
    let mode = _loopLiveMode(coarse);
    if (mode === 'grid'
        && !_editorEffectiveSnapValuePure(S.snapEnabled, SNAP_VALUES[S.snapIdx])) {
        mode = 'free';
    }
    const cur = edge === 'start' ? r.startTime : r.endTime;
    const downbeats = _downbeatTimes();
    const probe = _loopNudgeProbePure(
        mode, edge, cur, dir, downbeats, _editorSnapStepSeconds(), coarse);
    if (probe === null) return false;
    const next = _loopEdgeAdjustPure(
        mode, r, edge, probe, downbeats, S.duration || Math.max(cur, probe), snapTime);
    if (!next) return false;
    _setBarSel(next);
    _updateLoopIn3DBtn();
    _renderLoopStrip();
    draw();
    return true;
}

// Arrow-key nudging on the focused loop handle. The handles are real
// <button>s, so clicking one focuses it; Left/Right then nudge that edge
// without claiming any new global shortcut.
function _loopHandleKeydown(edge, e) {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    e.stopPropagation();
    _loopNudgeEdge(edge, e.key === 'ArrowRight' ? 1 : -1, e.shiftKey);
}

// The single writer for a NON-NULL S.barSel: assign the region and keep its
// beat-coordinate cache in sync (charrette §1.6). Bar/grid loop edges are
// anchored to beat coordinates (β) — the truth that makes a loop follow a tempo
// flex by staying on its bars — while their seconds are the derived cache; free
// loops are absolute seconds (D17) and carry no β. (Clears still assign null
// directly; a null loop has no β to maintain.)
function _setBarSel(region) {
    S.barSel = region ? _loopSyncBeats(region) : null;
    return S.barSel;
}

// Sync a loop region's beat-coordinate edges from its seconds against the
// current grid. Bar/grid edges resolve to integer / subdivided beats; a free
// loop drops its β so a later grid edit leaves it untouched.
function _loopSyncBeats(r) {
    if (!r) return r;
    if (r.mode === 'free') { delete r.startBeat; delete r.endBeat; }
    else {
        r.startBeat = beatOf(S.beats, r.startTime);
        r.endBeat = beatOf(S.beats, r.endTime);
    }
    return r;
}

// A tempo-map FLEX (grid times move, indexing preserved) keeps a bar/grid
// loop's beat coordinates and re-derives its seconds on the new grid, so it
// stays on the same bars; a free loop keeps its seconds (D17). β is unchanged,
// so this is an exact inverse — undo just reprojects back, no barSel snapshot.
function _loopReprojectFromBeats(beats) {
    const r = S.barSel;
    if (!r || r.mode === 'free') return;
    if (!Number.isFinite(r.startBeat) || !Number.isFinite(r.endBeat)) return;
    r.startTime = timeOf(beats, r.startBeat);
    r.endTime = timeOf(beats, r.endBeat);
}

// A grid RE-INDEX (insert/delete sync-point, time-sig) keeps loop SECONDS put
// but shifts what each beat coordinate means, so re-lift the loop's β from its
// unchanged seconds — exactly as notes re-lift (_liftAllBeats). Free loops keep
// no β. Seconds never move here, so exec/rollback round-trips with no snapshot.
function _loopReliftBeats(beats) {
    const r = S.barSel;
    if (!r || r.mode === 'free') return;
    r.startBeat = beatOf(beats, r.startTime);
    r.endBeat = beatOf(beats, r.endTime);
}

function _selectedLoopRegion() {
    return _normalizeLoopRegionPure(S.barSel, S.duration);
}

function _updateLoopRegionControls() {
    const region = _selectedLoopRegion();
    if (!region && S.loopEnabled) S.loopEnabled = false;
    // A/B rides the loop region — clearing the region disarms it (and
    // restores the reference gain via the guarded apply).
    if (!region && typeof _abOn !== 'undefined' && _abOn) {
        _abOn = false;
        _abPhase = 'recording';
        if (typeof _abApplyRefGain === 'function') _abApplyRefGain();
    }
    if (typeof _refreshLoopABBtn === 'function') _refreshLoopABBtn();
    const loopBtn = document.getElementById('editor-loop-region-btn');
    if (loopBtn) {
        loopBtn.disabled = !region;
        loopBtn.textContent = S.loopEnabled ? 'Loop On' : 'Loop';
        loopBtn.title = region
            ? (S.loopEnabled ? 'Disable editor loop playback for the selected region' : 'Loop editor playback inside the selected region')
            : 'Set a loop region first';
        loopBtn.classList.toggle('bg-accent', !!S.loopEnabled);
        loopBtn.classList.toggle('hover:bg-accent-light', !!S.loopEnabled);
        loopBtn.classList.toggle('bg-dark-600', !S.loopEnabled);
        loopBtn.classList.toggle('hover:bg-dark-500', !S.loopEnabled);
    }
    const clearBtn = document.getElementById('editor-loop-strip-clear');
    if (clearBtn) clearBtn.title = S.loopEnabled ? 'Clear loop region and disable looping' : 'Clear loop region';
}

function _setLoopRegionEnabled(enabled) {
    const region = _selectedLoopRegion();
    S.loopEnabled = !!(enabled && region);
    if (S.loopEnabled && (S.cursorTime < region.startTime || S.cursorTime >= region.endTime)) {
        _editorSeekToTime(region.startTime);
    }
    _updateLoopRegionControls();
    // Toggling the loop off flips _abActive() false: restore the recording to
    // its fader level so stopping the loop mid-guide-pass never leaves it
    // silently muted. Toggle-only path (never the per-frame strip render), so
    // scheduling the ~20 ms ramp here can't spam the audio param.
    if (typeof _abApplyRefGain === 'function') _abApplyRefGain();
    draw();
    setStatus(S.loopEnabled ? 'Loop region enabled' : 'Loop region disabled');
}

window.editorToggleLoopRegion = () => _setLoopRegionEnabled(!S.loopEnabled);
function _loopStripOnMouseDown(e) {
    // Note: no beat-grid gate — free-mode loops must work on a chart with
    // zero downbeats (the starting state of every drifting-tempo song).
    if (!canvas) return;
    const track = document.getElementById('editor-loop-strip-track');
    if (!track || !track.contains(e.target)) return;
    if (e.target && e.target.id === 'editor-loop-strip-clear') return;
    if (e.target && e.target.closest && e.target.closest('#editor-loop-strip-modes')) return;
    const region = S.barSel;
    const rawTime = _loopStripTimeFromClientX(e.clientX);
    if (region) {
        if (e.target && e.target.id === 'editor-loop-strip-start') {
            S.drag = { type: 'loopstrip', mode: 'start' };
            e.preventDefault();
            return;
        }
        if (e.target && e.target.id === 'editor-loop-strip-end') {
            S.drag = { type: 'loopstrip', mode: 'end' };
            e.preventDefault();
            return;
        }
    }
    S.drag = { type: 'loopstrip', mode: 'create', startTime: rawTime };
    _setBarSel(_loopRegionForDragPure(
        _loopLiveMode(e.shiftKey), rawTime, rawTime,
        _downbeatTimes(), S.duration || rawTime, snapTime));
    _updateLoopIn3DBtn();
    draw();
    e.preventDefault();
}

function _loopStripOnMouseMove(e) {
    if (!S.drag || S.drag.type !== 'loopstrip') return false;
    const rawTime = _loopStripTimeFromClientX(e.clientX);
    const downbeats = _downbeatTimes();
    // Mode is resolved live so pressing/releasing Shift mid-drag flips
    // between snapped and free without restarting the gesture.
    const mode = _loopLiveMode(e.shiftKey);
    if (S.drag.mode === 'create') {
        _setBarSel(_loopRegionForDragPure(
            mode, S.drag.startTime, rawTime, downbeats, S.duration || rawTime, snapTime));
    } else if (S.drag.mode === 'start' && S.barSel) {
        _setBarSel(_loopEdgeAdjustPure(
            mode, S.barSel, 'start', rawTime, downbeats, S.duration || rawTime, snapTime));
    } else if (S.drag.mode === 'end' && S.barSel) {
        _setBarSel(_loopEdgeAdjustPure(
            mode, S.barSel, 'end', rawTime, downbeats, S.duration || rawTime, snapTime));
    }
    _updateLoopIn3DBtn();
    draw();
    return true;
}

function _loopStripOnMouseUp() {
    if (!S.drag || S.drag.type !== 'loopstrip') return false;
    S.drag = null;
    _updateLoopIn3DBtn();
    draw();
    return true;
}
// Onset-snap tolerance (seconds): how close a note's placement must be to a
// detected transient to snap onto it instead of the grid. ~70 ms spans the
// grid-vs-attack gap on real recordings without hijacking clearly off-onset
// placements; beyond it, snapTime falls back to grid snap.
const ONSET_SNAP_TOL = 0.07;

function snapTime(t) {
    // Onset-snap mode (charrette §1.6): when snapping is on and the target is
    // 'onset', prefer the nearest detected audio transient within ONSET_SNAP_TOL
    // — the bridge between musical time and audio-attack time for transcription
    // (no warp; just snap placement to the onset time). Falls back to grid snap
    // when no onset is near, or none is computed, so placement stays sensible.
    if (S.snapEnabled && S.snapMode === 'onset') {
        const onsets = (typeof _ensureOnsets === 'function') ? _ensureOnsets() : null;
        const near = _nearestOnsetTimePure(onsets, t, ONSET_SNAP_TOL);
        if (near !== null) return near;
    }
    const sv = _editorEffectiveSnapValuePure(S.snapEnabled, SNAP_VALUES[S.snapIdx]);
    if (!sv || S.beats.length < 2) return t;
    // Snap in the beat domain, then convert back (charrette §1.1):
    // snap = timeOf(round(beatOf(t)·subs)/subs). Sharing the converter makes the
    // snap grid exactly the tempo-map grid — identical to the old inline
    // surrounding-gap subdivide (round(β·subs) keeps the whole-beat part fixed
    // and quantises the fraction), incl. the pre-first / past-last extrapolation.
    const subs = _editorSnapSubdivisionsPure(sv);
    return timeOf(S.beats, Math.round(beatOf(S.beats, t) * subs) / subs);
}

/* @pure:group-time-delta:start */
// The time delta to apply to a WHOLE dragged selection. Snapping each note's
// absolute time independently (`snapFn(origTime + dtRaw)` per note) quantises
// every note to its own nearest grid line — it destroys the selection's internal
// timing and makes a small group drag look like "only a few notes moved" (only
// the ones already near a grid line cross it). Instead: snap the PRIMARY (grabbed)
// note's target once, take that as the single group delta, and clamp it so the
// earliest note can't cross t=0 — so the whole group moves rigidly, snaps as a
// unit, and keeps its internal spacing. `snapFn` is injected (pure/testable).
function _groupTimeDeltaPure(origTimes, primaryOrig, dtRaw, snapFn) {
    const base = Number.isFinite(primaryOrig) ? primaryOrig
        : (Array.isArray(origTimes) && origTimes.length ? origTimes[0] : 0);
    let dt = snapFn(base + dtRaw) - base;
    let earliest = Infinity;
    if (Array.isArray(origTimes)) for (const t of origTimes) if (t < earliest) earliest = t;
    if (Number.isFinite(earliest) && earliest + dt < 0) dt = -earliest;
    return dt;
}
/* @pure:group-time-delta:end */

// ════════════════════════════════════════════════════════════════════
// Drawing
// ════════════════════════════════════════════════════════════════════

/* @pure:draw-coalesce:start */
// draw() is called imperatively from ~150 sites, and each call used to
// repaint the whole canvas immediately — so a single mousemove that hit
// several state updates paid several full repaints. Coalesce them: draw()
// now marks the frame dirty and schedules ONE drawNow() on the next
// animation frame; every existing call site gets batching for free. Code
// that genuinely needs the paint this instant (the once-per-frame playback
// tick, which already runs inside its own rAF) calls drawNow() directly.
let _drawQueued = false;
let _drawRafId = 0;
function draw() {
    if (_drawQueued) return;
    _drawQueued = true;
    _drawRafId = requestAnimationFrame(_drawFlush);
}
function _drawFlush() {
    _drawRafId = 0;
    _drawQueued = false;
    drawNow();
}
// Cancel a coalesced repaint that hasn't flushed yet (used by the boot
// teardown so a torn-down injection can't paint on a stale frame).
function _cancelPendingDraw() {
    if (_drawRafId) { cancelAnimationFrame(_drawRafId); _drawRafId = 0; }
    _drawQueued = false;
}
/* @pure:draw-coalesce:end */

function drawNow() {
    if (!canvas) return;
    // Keep the loop strip (DOM, independent of the canvas render) in sync for
    // EVERY mode — drum-edit and tempo-map both return early below, so rendering
    // it here rather than at the tail stops a clear/drag from leaving a stale
    // selection while one of those modes is active.
    _renderLoopStrip();
    updateBPMDisplay();
    updateTempoSigDisplay();
    const w = canvas.width / DPR;
    const h = canvas.height / DPR;
    ctx.save();
    ctx.scale(DPR, DPR);
    ctx.clearRect(0, 0, w, h);

    // Drum editor mode forks the canvas to a piece-lane grid view. The
    // guitar/keys draw chain below is skipped entirely so its lane-cache
    // logic doesn't try to walk a non-existent arrangement (`S.drumTab`
    // is not in S.arrangements[]).
    if (S.drumEditMode && S.drumTab) {
        try { _drumEditorDraw(w, h); }
        finally { ctx.restore(); }
        return;
    }

    // Tempo Map mode forks to a sync-point editor view. Like drum mode it
    // skips the guitar/keys draw chain — it only needs the waveform + the
    // song-wide beat grid, not any arrangement's notes.
    if (S.tempoMapMode) {
        try { _tempoMapDraw(w, h); }
        finally { ctx.restore(); }
        return;
    }

    // Parts view forks to the stacked all-parts overview. Checked after
    // drum/tempo so those explicit editors win if the flags ever disagree.
    if (S.partsViewMode) {
        try { _partsViewDraw(w, h); }
        finally { ctx.restore(); }
        return;
    }

    // Seed the per-frame `lanes()` cache. drawNotes calls strToLane on every
    // note (and per-note hit tests do the same), so without this every
    // frame is O(N²) over the arrangement. The labels array is cached
    // alongside since `colorForLane` reads it once per note. Enable
    // the cache BEFORE calling `laneLabels()` so that helper's internal
    // `lanes()` call hits the cache too (otherwise we'd do two full
    // O(N) scans per frame).
    LC.active = false;  // force a real compute first
    LC.value = lanes();
    LC.active = true;
    LC.labels = laneLabels();
    try {
        drawWaveform(w);
        drawToneLane(w);
        drawLanes(w);
        drawGrid(w);
        drawSections(w);
        drawBarSel(w);
        drawBeatBar(w);
        drawNotes(w);
        drawSelectionRect(w);
        drawGhostNotes();
        drawAnchorLane(w);
        drawHandshapeLane(w);
        // Draw cursor AFTER the anchor lane so the playhead line
        // appears on top of the lane instead of getting overdrawn —
        // the cursor's time-axis extent intentionally spans every
        // strip that shares the time axis (lanes, beat bar, anchor
        // lane). Tone lane sits at y=0 above the cursor's start, so
        // it doesn't need similar reordering.
        drawCursor(w, h);
        drawLabels(w);
    } finally {
        LC.active = false;
        LC.labels = null;
    }

    ctx.restore();
}

function drawWaveform(w) {
    ctx.fillStyle = '#08081a';
    ctx.fillRect(0, 0, w, WAVEFORM_H);
    // The onset strip and bookmark flags are independent of the waveform
    // toggle: waveform off + onsets on = the pure "blocky" detection view;
    // both on = an overlay; bookmarks always show over the band.
    // (typeof guards keep drawWaveform extractable by the render test.)
    const drawOnsets = () => {
        if (typeof _drawOnsetStrip === 'function') _drawOnsetStrip(w);
        if (typeof _drawBookmarks === 'function') _drawBookmarks(w);
    };
    if (typeof editorWaveformVisible !== 'undefined' && !editorWaveformVisible) {
        drawOnsets();
        return;
    }
    const pk = S.waveformPeaks;
    const dur = S.duration || 0;
    if (!pk || !pk.bins || dur <= 0) { drawOnsets(); return; }

    const N = pk.bins;
    const mid = WAVEFORM_H / 2;
    const amp = WAVEFORM_H / 2 - 4;
    // Visible pixel span of the audio (clamped to the waveform lane).
    const xLo = Math.max(LABEL_W, Math.floor(timeToX(0)));
    const xHi = Math.min(w, Math.ceil(timeToX(dur)));
    if (xHi <= xLo) return;

    // Per-column bin range for the pixel [px, px+1). Each column aggregates
    // every bin it spans, so the shape stays correct from full-song zoom-out
    // down to a single bin per pixel.
    const binRange = (px) => {
        let i0 = Math.floor(xToTime(px) / dur * N);
        let i1 = Math.floor(xToTime(px + 1) / dur * N);
        if (i0 < 0) i0 = 0;
        if (i1 >= N) i1 = N - 1;
        if (i1 < i0) i1 = i0;
        return [i0, i1];
    };

    // Faint zero line.
    ctx.strokeStyle = 'rgba(120,150,210,0.18)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(xLo, mid + 0.5);
    ctx.lineTo(xHi, mid + 0.5);
    ctx.stroke();

    // Peak (min→max) envelope — the true asymmetric outline, drawn light.
    ctx.fillStyle = 'rgba(90,150,235,0.40)';
    for (let px = xLo; px < xHi; px++) {
        const [i0, i1] = binRange(px);
        let lo = pk.min[i0], hi = pk.max[i0];
        for (let i = i0 + 1; i <= i1; i++) {
            if (pk.min[i] < lo) lo = pk.min[i];
            if (pk.max[i] > hi) hi = pk.max[i];
        }
        const yHi = mid - hi * amp;
        const yLo = mid - lo * amp;
        ctx.fillRect(px, yHi, 1, Math.max(1, yLo - yHi));
    }

    // RMS body — loudness, drawn brighter and symmetric around the zero line.
    ctx.fillStyle = 'rgba(130,185,255,0.85)';
    for (let px = xLo; px < xHi; px++) {
        const [i0, i1] = binRange(px);
        let sumSq = 0, cnt = 0;
        for (let i = i0; i <= i1; i++) { const r = pk.rms[i]; sumSq += r * r; cnt++; }
        const h = (cnt ? Math.sqrt(sumSq / cnt) : 0) * amp;
        if (h > 0.5) ctx.fillRect(px, mid - h, 1, Math.max(1, 2 * h));
    }

    drawOnsets();
}

// Detected-onset blocks over the waveform band — a visual hint of where
// transients (likely note/beat events) live in the recording. Display
// only: the strip never places notes (D22).
function _drawOnsetStrip(w) {
    if (!_onsetStripEnabled()) return;
    const onsets = _ensureOnsets();
    if (!onsets || !onsets.length) return;
    const dur = S.duration || 0;
    if (dur <= 0) return;
    const xLo = Math.max(LABEL_W, Math.floor(timeToX(0)));
    const xHi = Math.min(w, Math.ceil(timeToX(dur)));
    // onsets are time-sorted and timeToX is monotonic, so the on-screen pixel
    // is non-decreasing across the array. Binary-search the first visible
    // onset (px >= xLo) and stop at the first past xHi — no full-array scan.
    let lo = 0, hi = onsets.length;
    while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (Math.round(timeToX(onsets[mid].t)) < xLo) lo = mid + 1;
        else hi = mid;
    }
    for (let i = lo; i < onsets.length; i++) {
        const o = onsets[i];
        const px = Math.round(timeToX(o.t));
        if (px > xHi) break;
        // Stronger attacks read brighter and taller — quiet ghost hits stay
        // visible but understated.
        ctx.fillStyle = `rgba(255,190,80,${(0.30 + 0.45 * o.s).toFixed(3)})`;
        const h = Math.round((WAVEFORM_H - 6) * (0.55 + 0.45 * o.s));
        ctx.fillRect(px - 1, WAVEFORM_H - 3 - h, 3, h);
    }
}

// Numbered bookmark flags over the waveform band. Bookmarks are EDITOR
// authoring state (localStorage per song — never pack data, §6): nine
// numbered time markers, Shift+Alt+1-9 sets/clears at the cursor,
// Alt+1-9 jumps.
function _drawBookmarks(w) {
    const marks = _bookmarks();
    let drew = false;
    for (let n = 1; n <= 9; n++) {
        const t = marks[n];
        if (t === undefined) continue;
        const px = Math.round(timeToX(t));
        if (px < LABEL_W || px > w) continue;
        if (!drew) {
            ctx.save();
            ctx.font = 'bold 9px monospace';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            drew = true;
        }
        ctx.fillStyle = 'rgba(120,220,160,0.9)';
        ctx.fillRect(px, 2, 1, WAVEFORM_H - 4);
        ctx.fillRect(px, 2, 11, 11);
        ctx.fillStyle = '#0b1512';
        ctx.fillText(String(n), px + 6, 8);
    }
    if (drew) ctx.restore();
}

window.editorSetKeyTonic = (v) => {
    const tonic = parseInt(v, 10);
    if (!(tonic >= 0 && tonic <= 11)) return;
    S.editorKey = { tonic, scale: (S.editorKey && S.editorKey.scale) || 'major' };
    _persistEditorKey();
    _refreshKeyControls();
    draw();
};
window.editorSetKeyScale = (v) => {
    if (!SCALE_INTERVALS[v]) return;
    S.editorKey = { tonic: (S.editorKey ? S.editorKey.tonic : 0), scale: v };
    _persistEditorKey();
    _refreshKeyControls();
    draw();
};
function _editorToggleKeyHighlight() {
    const next = !editorKeyHighlightEnabled();
    try { localStorage.setItem('editorKeyHighlight', next ? '1' : '0'); } catch (_) {}
    if (next && !S.editorKey) S.editorKey = { tonic: 0, scale: 'major' };
    _persistEditorKey();
    _refreshKeyControls();
    draw();
    setStatus(next
        ? 'In-key highlight on — out-of-key notes dim (piano roll also shades out-of-key rows)'
        : 'In-key highlight off');
    return true;
}
window.editorToggleKeyHighlight = _editorToggleKeyHighlight;

// Detect the active arrangement's key from its pitch-class content (DAW 4.17)
// and set it as the editor key, turning the in-key highlight on so the result
// is visible. A best-guess suggestion, not authoritative — the picker stays
// editable. Duration-weighted (a held note counts more than a passing one),
// with a small floor so staccato notes still register. Fretted parts resolve
// to sounding pitch (capo/tuning-aware); keys parts use their packed pitch.
window.editorDetectKey = () => {
    if (!S.arrangements || !S.arrangements.length) { setStatus('No arrangement to analyse'); return; }
    const nn = notes();
    if (!nn.length) { setStatus('No notes yet — add some before detecting a key'); return; }
    const rctx = typeof _rollPitchCtx === 'function' ? _rollPitchCtx() : null;
    const weights = new Array(12).fill(0);
    let counted = 0;
    for (const n of nn) {
        const midi = _rollMidiForNote(n, rctx);
        if (!Number.isFinite(midi)) continue;
        const pc = ((Math.round(midi) % 12) + 12) % 12;
        weights[pc] += Math.max(Number(n.sustain) || 0, 0.1);
        counted++;
    }
    const res = counted ? _detectKeyPure(weights) : null;
    if (!res) { setStatus('Could not detect a key from this part'); return; }
    S.editorKey = { tonic: res.tonic, scale: res.scale };
    try { localStorage.setItem('editorKeyHighlight', '1'); } catch (_) { /* private mode */ }
    _persistEditorKey();
    _refreshKeyControls();
    draw();
    const label = (typeof SCALE_LABELS !== 'undefined' && SCALE_LABELS[res.scale]) || res.scale;
    setStatus(`Detected key: ${PIANO_NOTE_NAMES[res.tonic]} ${label} — adjust in the picker if it's off`);
};

// ── Per-part view switcher (String · Piano roll) ─────────────────────
let _viewSwitchState = '';
function _refreshViewSwitch() {
    const el = document.getElementById('editor-view-switch');
    if (!el) return;
    const arr = S.arrangements.length ? S.arrangements[S.currentArr] : null;
    const fretted = !!arr && !KEYS_PATTERN.test(arr.name || '');
    // Only fretted parts get a choice (keys are piano-locked), and only
    // when a focus editor is showing (not drum/tempo/parts modes).
    const visible = fretted && !S.drumEditMode && !S.tempoMapMode && !S.partsViewMode;
    const mode = arr ? viewFor(arr) : 'string';
    const sig = `${visible}|${mode}`;
    if (sig === _viewSwitchState) return;
    _viewSwitchState = sig;
    el.classList.toggle('hidden', !visible);
    el.classList.toggle('flex', visible);
    el.querySelectorAll('button[data-view]').forEach(b => {
        const active = b.dataset.view === mode;
        b.classList.toggle('bg-accent', active);
        b.classList.toggle('text-white', active);
        b.classList.toggle('text-gray-400', !active);
        b.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
    const pill = document.getElementById('editor-roll-lock-pill');
    if (pill) pill.classList.toggle('hidden', !(visible && mode === 'piano'));
}

window.editorSetViewMode = (mode) => {
    if (mode !== 'string' && mode !== 'piano') return;
    const arr = S.arrangements.length ? S.arrangements[S.currentArr] : null;
    if (!arr) return;
    if (KEYS_PATTERN.test(arr.name || '')) {
        setStatus('Keys parts always use the piano roll');
        return;
    }
    if (viewFor(arr) === mode) return;
    const prefs = _viewPrefs();
    const key = _partViewKeyPure(arr);
    if (mode === 'piano') prefs[key] = 'piano';
    else delete prefs[key];
    _viewPrefsSave();
    // V3: selection/interaction semantics are per-view — clear both, and
    // close any note UI anchored to the old geometry.
    S.sel.clear();
    S.drag = null;
    hideContextMenu();
    hideAddNote();
    if (mode === 'piano') updatePianoRange();
    _refreshViewSwitch();
    // Lane heights differ between views; recompute after the reflow the
    // same way the string-count change path does.
    if (typeof resizeCanvas === 'function') requestAnimationFrame(() => resizeCanvas());
    draw();
    updateStatus();
    setStatus(mode === 'piano'
        ? 'Piano roll — fretted notes shown at sounding pitch (read-only until suggest-position lands)'
        : 'String view');
};

function _editorCycleViewMode() {
    const arr = S.arrangements.length ? S.arrangements[S.currentArr] : null;
    if (!arr) { setStatus('Load a song first'); return true; }
    if (KEYS_PATTERN.test(arr.name || '')) {
        setStatus('Keys parts always use the piano roll');
        return true;
    }
    window.editorSetViewMode(viewFor(arr) === 'piano' ? 'string' : 'piano');
    return true;
}

let _keyControlsPopulated = false;
let _keyControlsState = '';
function _refreshKeyControls() {
    const group = document.getElementById('editor-key-group');
    if (!group) return;
    _loadEditorKeyIfNeeded();
    // Populate the selects once.
    if (!_keyControlsPopulated) {
        const tonicSel = document.getElementById('editor-key-tonic');
        const scaleSel = document.getElementById('editor-key-scale');
        if (tonicSel && scaleSel) {
            tonicSel.innerHTML = PIANO_NOTE_NAMES
                .map((n, i) => `<option value="${i}">${n}</option>`).join('');
            scaleSel.innerHTML = Object.keys(SCALE_INTERVALS)
                .map(id => `<option value="${id}">${SCALE_LABELS[id] || id}</option>`).join('');
            _keyControlsPopulated = true;
        }
    }
    // The highlight applies to any pitched arrangement view — the piano
    // roll AND the fretted lanes (notes resolve to sounding pitch via
    // tuning + capo). The drum grid and Parts overview have no per-note
    // pitch surface, so the controls hide there.
    const visible = !!(S.arrangements && S.arrangements.length)
        && !S.drumEditMode && !S.partsViewMode;
    const on = editorKeyHighlightEnabled();
    const tonic = S.editorKey ? S.editorKey.tonic : 0;
    const scale = S.editorKey ? S.editorKey.scale : 'major';
    const sig = `${visible}|${on}|${tonic}|${scale}`;
    if (sig === _keyControlsState) return;
    _keyControlsState = sig;
    group.classList.toggle('hidden', !visible);
    group.classList.toggle('flex', visible);
    const tonicSel = document.getElementById('editor-key-tonic');
    const scaleSel = document.getElementById('editor-key-scale');
    if (tonicSel) tonicSel.value = String(tonic);
    if (scaleSel) scaleSel.value = scale;
    const btn = document.getElementById('editor-key-highlight-btn');
    if (btn) {
        btn.classList.toggle('bg-accent', on);
        btn.classList.toggle('hover:bg-accent-light', on);
        btn.classList.toggle('bg-dark-600', !on);
        btn.classList.toggle('hover:bg-dark-500', !on);
        btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    }
}

// ════════════════════════════════════════════════════════════════════
// Undo / Redo
// ════════════════════════════════════════════════════════════════════


// Guard: true only while _historyEnsureArr drives an arrangement switch to
// replay an undo/redo. editorSelectArrangement reads it to distinguish a
// user/manual switch (which must reset history — see there) from this
// history-replaying switch (which must NOT, or it would drop the very stack it
// is replaying). Module-scoped so both functions share the one flag.
let _undoDrivenArrSwitch = false;

// Route undo/redo to the arrangement a command was executed against (see
// EditHistory.exec's tagging). Switches the active arrangement when needed so
// index-based rollbacks land in the right notes array; returns false — leaving
// the stacks untouched — when that arrangement no longer exists.
//
// Since every MANUAL arrangement switch now resets the history (see
// editorSelectArrangement), a command whose _arrIdx differs from S.currentArr
// can no longer be in the stack, so the branch below is a defensive fallback
// rather than a hot path — cross-arrangement undo can never actually occur.
function _historyEnsureArr(cmd) {
    const idx = (cmd && typeof cmd._arrIdx === 'number') ? cmd._arrIdx : -1;
    if (idx < 0 || idx === S.currentArr) return true;
    if (!S.arrangements || !S.arrangements[idx]) {
        setStatus('Undo target arrangement no longer exists');
        return false;
    }
    _undoDrivenArrSwitch = true;
    try {
        window.editorSelectArrangement(idx);
    } finally {
        _undoDrivenArrSwitch = false;
    }
    const el = document.getElementById('editor-arrangement');
    if (el) el.value = String(idx);
    setStatus(`Switched to "${S.arrangements[idx].name}" to apply undo/redo`);
    return true;
}

// The extracted modules cannot import these back out of main.js without closing
// a cycle, so they read them off the shared `host` object. All are hoisted
// function declarations, so this top-level call is safe wherever it sits.
//
// `draw` is REASSIGNED near the bottom of this file to a wrapper that refreshes
// the toolbar buttons before repainting. Passing the identifier would capture
// the ORIGINAL function forever; the thunk resolves the live binding at call
// time, as the in-IIFE call sites did before the split. The canvas repaints
// either way — only the button refreshes go missing — so nothing but the
// drum-density button's label makes the difference visible. See src/host.js.
// Explicit confirm popover for a refused (ambiguous) add: lists the free
// candidate positions; a pick writes a CONFIRMED note. When no string is free
// (out-of-range / fully-occupied), there is nothing to pick — say why instead.
// Extend an arrangement's string count by one. `position` is 'low' for
// adding at the lowest end (guitar low B/F#, 4→5-string bass low B) and
// 'high' for adding at the high end (5→6-string bass high C). Adding at
// the low end shifts every existing note's string index up by 1 so the
// chart visually stays put — only the new lowest lane is empty.
// Layout side-effect for any command that changes `lanes()`. Pulled
// out so AddStringCmd / RemoveStringCmd exec & rollback can drive a
// LANE_H recomputation on Ctrl-Z / Ctrl-Y too. Takes the target
// arrangement index because undo/redo may fire after the user has
// switched to a different arrangement — only resize when the
// mutation hits the visible chart, so we don't mis-size LANE_H on
// behalf of an off-screen arrangement.
//
// We defer to the next animation frame so the click-handler reflow
// completes before resizeCanvas reads `wrap.clientHeight`. Calling
// inline can hit a transient layout where the read returns 0; the
// early-return inside resizeCanvas then skips the LANE_H update,
// extra lanes overflow the canvas, and the new string isn't visible
// until the next legitimate resize event (e.g. screen-change observer).
function _resizeForLaneChange(arrIdx) {
    if (arrIdx !== undefined && arrIdx !== S.currentArr) return;
    requestAnimationFrame(() => resizeCanvas());
}

function _rollConfirmPosition(res, pitch, time, occ, cx, cy) {
    const occupied = occ instanceof Set ? occ : new Set(occ || []);
    const free = (res.candidates || []).filter(c => !occupied.has(c.string));
    const noteName = (typeof midiToNote === 'function') ? midiToNote(pitch) : String(pitch);
    const reason = _ROLL_REFUSE_REASONS[res.reason] || res.reason || '';
    if (!free.length) {
        setStatus(`Can't place ${noteName} here — ${reason}.`);
        return;
    }
    document.getElementById('editor-roll-position-picker')?.remove();

    const modal = document.createElement('div');
    modal.id = 'editor-roll-position-picker';
    modal.className = 'fixed inset-0 bg-black/70 z-50 flex items-center justify-center';

    const inner = document.createElement('div');
    inner.className = 'bg-dark-800 border border-gray-700 rounded-lg p-6 max-w-sm w-full mx-4';
    inner.setAttribute('role', 'dialog');
    inner.setAttribute('aria-modal', 'true');

    const h = document.createElement('h3');
    h.id = 'editor-roll-position-title';
    h.className = 'text-lg font-semibold mb-1';
    h.textContent = `Choose a position for ${noteName}`;
    inner.appendChild(h);
    inner.setAttribute('aria-labelledby', h.id);

    const sub = document.createElement('div');
    sub.className = 'text-xs text-gray-400 mb-3';
    sub.textContent = reason ? reason.charAt(0).toUpperCase() + reason.slice(1) + '.' : 'Pick where to play it.';
    inner.appendChild(sub);

    let settled = false;
    const done = () => { if (settled) return; settled = true; modal.remove(); };

    for (const c of free) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'w-full text-left p-2 mb-2 bg-dark-700 hover:bg-dark-600 rounded border border-gray-700 text-sm';
        b.textContent = c.fret === 0 ? `String ${c.string} · open` : `String ${c.string} · fret ${c.fret}`;
        b.onclick = () => { done(); _commitAddResolved(c, time, false); };
        inner.appendChild(b);
    }

    const row = document.createElement('div');
    row.className = 'flex justify-end gap-2 mt-1';
    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'px-3 py-1 bg-dark-700 hover:bg-dark-600 rounded text-sm';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.onclick = () => done();
    row.appendChild(cancelBtn);
    inner.appendChild(row);

    modal.appendChild(inner);
    _installModalKeyboard(modal, inner, () => done());
    document.body.appendChild(modal);
    inner.querySelector('button')?.focus();
}

setHostHooks({
    draw: (...args) => draw(...args),
    drawWaveform,
    updateStatus,
    updateArrangementSelector,
    hideContextMenu,
    snapTime,
    ensureArr: _historyEnsureArr,
    editBlipAt: _editBlipAt,
    editorCurrentNoteIndices: _editorCurrentNoteIndices,
    renderInspector: _renderInspector,
    resizeForLaneChange: _resizeForLaneChange,
    rollConfirmPosition: _rollConfirmPosition,
    getMousePos,
    isRecording: () => _recState === 'recording',
    hideAddNote,
    startPlayback,
    stopPlayback,
    updateBPMDisplay,
    updateTempoSigDisplay,
    renderLoopStrip: _renderLoopStrip,
    updateLoopIn3DBtn: _updateLoopIn3DBtn,
    loopReliftBeats: _loopReliftBeats,
    loopReprojectFromBeats: _loopReprojectFromBeats,
    refreshDrumEditButton: _refreshDrumEditButton,
    refreshTempoMapButton: _refreshTempoMapButton,
    refreshPartsViewButton: _refreshPartsViewButton,
    finalizeActiveDrag: _finalizeActiveDrag,
    loadCDLC,
    loadAudio,
    kickLibraryRescan: _kickLibraryRescan,
    resetOffsetUI: _resetOffsetUI,
    updateTimeDisplay,
    addGlobalListener: (target, ev, fn) => _globalListeners.add(target, ev, fn),
});

window.editorHideRecordMidiModal = editorHideRecordMidiModal;
window.editorRecordMidiDeviceChanged = editorRecordMidiDeviceChanged;
window.editorShowRecordMidiModal = editorShowRecordMidiModal;
window.editorStartRecordMidi = editorStartRecordMidi;
window.editorStopRecordMidi = editorStopRecordMidi;

// src/create.js owns 22 of the window.editor* handlers the HTML calls. A module
// cannot own a top-level `window.x =` (it throws when imported under node), so
// they are re-attached here.
window.editorApplyCreateResult = editorApplyCreateResult;
window.editorArtSearch = editorArtSearch;
window.editorAutoSyncAudioSelected = editorAutoSyncAudioSelected;
window.editorAutoSyncYtFetch = editorAutoSyncYtFetch;
window.editorBuild = editorBuild;
window.editorContentImportSelected = editorContentImportSelected;
window.editorCreateArtSelected = editorCreateArtSelected;
window.editorDoCreate = editorDoCreate;
window.editorEofFilesSelected = editorEofFilesSelected;
window.editorGPFileSelected = editorGPFileSelected;
window.editorHideCreateModal = editorHideCreateModal;
window.editorIdentifyAudio = editorIdentifyAudio;
window.editorMbMatch = editorMbMatch;
window.editorRefineSync = editorRefineSync;
window.editorSetAudioMode = editorSetAudioMode;
window.editorSetCreateMode = editorSetCreateMode;
window.editorSetGP8AudioMode = editorSetGP8AudioMode;
window.editorShowCreateModal = editorShowCreateModal;
window.editorShowCreateSloppakModal = editorShowCreateSloppakModal;
window.editorShowNewFormatPicker = editorShowNewFormatPicker;
window.editorStagedRemove = editorStagedRemove;
window.editorYtUrlInput = editorYtUrlInput;


// The window.* surface the modules can't own: a top-level `window.x =` throws
// when they are imported under node, which their unit tests do.
window.editorShowTonesModal = editorShowTonesModal;
window.editorHideTonesModal = editorHideTonesModal;
window.editorApplyTonesModal = editorApplyTonesModal;
window.editorToggleDrumDensity = _editorToggleDrumDensity;


// ════════════════════════════════════════════════════════════════════
// Mouse interactions
// ════════════════════════════════════════════════════════════════════

function getMousePos(e) {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
}

function onMouseDown(e) {
    const { x, y } = getMousePos(e);
    hideContextMenu();
    hideAddNote();

    // Middle button = pan
    if (e.button === 1) {
        e.preventDefault();
        S.drag = { type: 'pan', startX: x, origScroll: S.scrollX };
        return;
    }

    // Right button = context menu (handled in onContextMenu)
    if (e.button === 2) return;

    // Drum-edit mode hijacks the left click so the lane-grid editor can
    // add/remove/select hits without going through the guitar-arrangement
    // click pipeline below (which would crash on a missing
    // S.arrangements[currentArr]).
    if (S.drumEditMode && S.drumTab) {
        _drumEditorOnMouseDown(e, x, y);
        return;
    }

    // Tempo Map mode hijacks the left click for sync-point editing.
    if (S.tempoMapMode) {
        _tempoMapOnMouseDown(e, x, y);
        return;
    }

    // Parts view owns the click: waveform seeks, lanes arm a part.
    if (S.partsViewMode) {
        _partsViewOnMouseDown(e, x, y);
        return;
    }

    // Keyboard gutter (keys/piano view): a click in the left key column
    // auditions that row's pitch — no selection, no edit. Left button only so
    // right-click still opens the context menu. Ignored in String view (the
    // gutter shows string labels there, not keys).
    if (e.button === 0 && isKeysMode()) {
        const laneBottom = WAVEFORM_H + pianoLaneCount() * PIANO_LANE_H;
        if (_inKeyboardGutterPure(x, y, LABEL_W, WAVEFORM_H, laneBottom)) {
            _auditionPitch(yToMidi(y));
            return;
        }
    }

    // Tone lane sits in the top TONE_LANE_H px (an overlay on the
    // waveform's top edge). Hijack the click before the waveform-seek
    // handler so add/move/select-marker interactions work.
    if (y >= 0 && y < TONE_LANE_H && S.arrangements && S.arrangements.length) {
        if (onToneLaneMouseDown(e, x)) return;
    }
    // Anchor lane sits below the beat bar.
    if (S.arrangements && S.arrangements.length) {
        const anchorTop = _anchorLaneTopY();
        if (y >= anchorTop && y < anchorTop + ANCHOR_LANE_H) {
            if (onAnchorLaneMouseDown(e, x, y)) return;
        }
    }
    // Handshape lane sits directly below the anchor lane.
    if (S.arrangements && S.arrangements.length) {
        const hsTop = _handshapeLaneTopY();
        if (y >= hsTop && y < hsTop + HS_LANE_H) {
            if (onHandshapeLaneMouseDown(e, x, y)) return;
        }
    }
    // Beat bar (bottom measure strip) → drag-select a bar range for the
    // "Loop in 3D" handoff. Left button only; right-click still opens the
    // section menu via onContextMenu.
    if (e.button === 0 && S.beats.length) {
        const bbTop = _beatBarTopY();
        if (y >= bbTop && y < bbTop + BEAT_H) {
            const t = xToTime(x);
            S.drag = { type: 'barsel', startTime: t };
            _setBarSel(_barSpanForTimes(t, t));
            draw();
            return;
        }
    }
    // Click outside the tone lane → clear the tone selection so the
    // next Del press targets the note path instead of the previously
    // selected tone marker.
    if (S.toneSel !== null) {
        S.toneSel = null;
        // No explicit `draw()` here — the surrounding mouse-down path
        // already triggers one for the new interaction.
    }
    // Same story for anchor selection — a stale `S.anchorSel` would
    // otherwise hijack the next Del press from the note delete path.
    if (S.anchorSel !== null) {
        S.anchorSel = null;
    }
    // …and the handshape selection (the handshape-lane mousedown returns
    // early, so a click reaching here is outside that lane).
    if (S.handshapeSel !== null) {
        S.handshapeSel = null;
    }

    // Left button
    if (y < WAVEFORM_H) {
        // Block waveform seek while recording: restarting the AudioBufferSourceNode
        // would fire onended and prematurely finalize the take.
        if (_recState === 'recording') return;
        // Click on waveform = set cursor
        S.cursorTime = Math.max(0, xToTime(x));
        if (S.playing) { stopPlayback(); startPlayback(); }
        draw();
        return;
    }

    // Block note editing while recording: mid-take edits to arr.notes would be
    // silently overwritten by _recNotes when the take is finalized on Stop.
    if (_recState === 'recording') return;

    // Check for sustain edge grab first. Edge-drag sustain resize is a DURATION
    // edit — it changes only how long a note rings, never its pitch — so it
    // applies directly even in the read-only fretted roll (V4): the resize
    // commands are pitchPreserving and pass the edit lock, so grabbing an edge
    // is allowed here (unlike a pitch/position write). Resize mutates sustains
    // LIVE during the drag (before any command); the commit is pitchPreserving.
    const edgeIdx = hitNoteEdge(x, y);
    if (edgeIdx >= 0) {
        const nn = notes();
        const resizeIndices = _resizeTargetIndicesPure(nn, edgeIdx, !isKeysArr() && !e.altKey);
        const allResizeSelected = resizeIndices.every(i => S.sel.has(i));
        if (!allResizeSelected) {
            S.sel.clear();
            for (const i of resizeIndices) S.sel.add(i);
        }
        S.drag = {
            type: 'resize',
            noteIdx: edgeIdx,
            indices: resizeIndices,
            startX: x,
            origSustains: resizeIndices.map(i => nn[i].sustain || 0),
        };
        draw();
        return;
    }

    const idx = hitNote(x, y);

    if (idx >= 0) {
        // Click on note — also select all chord siblings (same time).
        // In keys DATA same-timestamp notes are independent voices (not
        // a strummed chord), so skip the sibling expansion. Keyed on the
        // data kind, not the surface: a fretted part in the roll still
        // groups its chords.
        const nn = notes();
        const clickedTime = nn[idx].time;
        const chordSiblings = [idx];
        if (!isKeysArr()) {
            for (let i = 0; i < nn.length; i++) {
                if (i !== idx && Math.abs(nn[i].time - clickedTime) < 0.001) chordSiblings.push(i);
            }
        }

        if (e.shiftKey) {
            // Multi-select toggle — toggle the whole chord group
            const allSelected = chordSiblings.every(i => S.sel.has(i));
            for (const i of chordSiblings) {
                if (allSelected) S.sel.delete(i); else S.sel.add(i);
            }
        } else if (!S.sel.has(idx)) {
            S.sel.clear();
            for (const i of chordSiblings) S.sel.add(i);
        }

        // Start the move drag. In the read-only fretted roll (VA.3) this is the
        // pitch-move: the live drag repicks {string,fret} through the resolver
        // (onMouseMove's move branch → _rollDragPitchMove) and commits as a
        // suggested-marked, lock-passing MoveNoteCmd.
        const selArr = [...S.sel];
        S.drag = {
            type: 'move',
            startX: x, startY: y,
            // The grabbed note's original time anchors the group snap so the
            // whole selection moves as a rigid unit (see _groupTimeDeltaPure).
            primaryOrigTime: nn[idx].time,
            origTimes: selArr.map(i => nn[i].time),
            origStrings: selArr.map(i => nn[i].string),
            origFrets: selArr.map(i => nn[i].fret),
            indices: selArr,
            moved: false,
        };
        draw();
    } else {
        // Click on empty space = start selection rect or deselect
        if (!e.shiftKey) S.sel.clear();
        S.drag = {
            type: 'select',
            startX: x, startY: y,
            curX: x, curY: y,
        };
        draw();
    }
}

function onMouseMove(e) {
    const { x, y } = getMousePos(e);
    // Activate the lane cache for the handler's lifetime so per-note
    // hit-test helpers (`hitNoteEdge` / `hitNote` → `strToY` →
    // `strToLane` → `lanes()`) stay O(1) per note instead of O(N).
    // A local `const L = lanes()` alone doesn't help those nested
    // calls; the global cache does. Cleared in `finally` so any
    // exception unwinding the handler doesn't leak the flag.
    const _prevActive = LC.active;
    const _prevValue = LC.value;
    LC.active = false;
    LC.value = lanes();
    const L = LC.value;
    LC.active = true;
    try {
        _onMouseMoveBody(e, x, y, L);
    } finally {
        LC.active = _prevActive;
        LC.value = _prevValue;
    }
}

function _onMouseMoveBody(e, x, y, L) {

    if (_loopStripOnMouseMove(e)) return;

    // Bar-range drag on the beat bar — re-snap the span to the cursor.
    if (S.drag && S.drag.type === 'barsel') {
        _setBarSel(_barSpanForTimes(S.drag.startTime, xToTime(x)));
        draw();
        return;
    }

    // Tone-marker drag — hijack before any of the existing
    // drag-handler branches so the marker tracks the cursor.
    if (S.drag && S.drag.type === 'tone') {
        onToneLaneMouseMove(e, x);
        return;
    }
    if (S.drag && S.drag.type === 'anchor') {
        onAnchorLaneMouseMove(e, x);
        return;
    }
    if (S.drag && S.drag.type === 'handshape') {
        onHandshapeLaneMouseMove(e, x);
        return;
    }

    // Cursor hint when not dragging
    if (!S.drag) {
        // In drum-edit mode the guitar/keys hover logic (hitNoteEdge) is
        // irrelevant and shows misleading resize cursors over the drum grid.
        if (S.drumEditMode && S.drumTab) {
            if (canvas) canvas.style.cursor = '';
            return;
        }
        // Tempo-map mode: highlight the sync-point pole under the cursor.
        if (S.tempoMapMode) {
            const hit = _tempoSyncAtX(x, y);
            if (hit !== S.tempoHover) { S.tempoHover = hit; draw(); }
            if (canvas) canvas.style.cursor = hit >= 0 ? 'ew-resize' : '';
            return;
        }
        // Beat bar (bottom measure strip) → text-ish cursor to signal it's
        // drag-to-select-bars for "Loop in 3D".
        const bbTop = _beatBarTopY();
        if (canvas && S.beats.length && y >= bbTop && y < bbTop + BEAT_H) {
            canvas.style.cursor = 'col-resize';
        } else if (canvas && y >= WAVEFORM_H && y < bbTop) {
            // The note area runs from the waveform strip down to the beat bar in
            // BOTH views — `_beatBarTopY()` already accounts for the roll's
            // pianoLaneCount * PIANO_LANE_H. The old `WAVEFORM_H + L * LANE_H`
            // bound was the fretted lane band, so the resize cursor never showed
            // in the roll even though the grab itself is allowed there (V4).
            canvas.style.cursor = hitNoteEdge(x, y) >= 0 ? 'ew-resize' : '';
        } else if (canvas) {
            canvas.style.cursor = '';
        }
        return;
    }

    if (S.drag.type === 'pan') {
        const dx = x - S.drag.startX;
        S.scrollX = _editorClampScrollX(S.drag.origScroll - dx / S.zoom);
        draw();
        return;
    }

    // Drum-edit drag: move every selected hit in time and lane in lockstep.
    if (S.drag.type === 'drum-move') {
        _drumEditorOnDragMove(x, y);
        draw();
        return;
    }

    // Drum velocity drag (Alt+drag): vertical drift edits the selection's
    // velocity live — the render brightness/height tracks it as feedback.
    if (S.drag.type === 'drum-velocity') {
        _drumEditorOnVelocityDragMove(y);
        draw();
        return;
    }

    // Drum-edit marquee: track the rubber-band rect; flip `moved` once the
    // pointer has left the click threshold so mouseup knows it's a box
    // select rather than an add-hit click.
    if (S.drag.type === 'drum-select') {
        S.drag.curX = x;
        S.drag.curY = y;
        // Euclidean threshold so a diagonal drag (e.g. dx=dy=2.5, ~3.5px)
        // counts as a marquee, not a click — a per-axis check would miss it.
        const ddx = x - S.drag.startX;
        const ddy = y - S.drag.startY;
        if (ddx * ddx + ddy * ddy > 9) S.drag.moved = true;
        draw();
        return;
    }

    // Tempo-map drag: re-space the two measures around the dragged pole.
    if (S.drag.type === 'tempo-sync') {
        _tempoMapOnDragMove(x);
        return;
    }

    // Tempo-map per-beat rubato drag: re-time one beat inside its measure.
    if (S.drag.type === 'tempo-beat') {
        _tempoBeatOnDragMove(x);
        return;
    }

    if (S.drag.type === 'select') {
        S.drag.curX = x;
        S.drag.curY = y;
        draw();
        return;
    }

    if (S.drag.type === 'resize') {
        const dt = (x - S.drag.startX) / S.zoom;
        const nn = notes();
        const nextSustains = _resizeSustainsForDeltaPure(
            nn, S.drag.indices, S.drag.origSustains, dt);
        for (let i = 0; i < S.drag.indices.length; i++) {
            nn[S.drag.indices[i]].sustain = nextSustains[i];
        }
        draw();
        return;
    }

    if (S.drag.type === 'move') {
        S.drag.moved = true;
        const nn = notes();
        const dtRaw = (x - S.drag.startX) / S.zoom;
        const dy = y - S.drag.startY;
        // One snapped time delta for the WHOLE selection (see _groupTimeDeltaPure):
        // snap the grabbed note once and move every selected note by the SAME
        // delta, so the group stays rigid and small drags move all of it — not
        // just the notes that happened to sit near a grid line.
        //
        // Grid lock/unlock, the way DAWs do it (verified: Ableton — hold Alt to
        // temporarily disable snap; Logic — Ctrl-Shift for off-grid tick steps):
        // by default the group is LOCKED to the grid; hold Alt while dragging to
        // move it FREE of the grid. Only the time grid is bypassed — vertical
        // stays semitone/string-quantized (no between-pitch notes), like every DAW.
        const snapFn = e.altKey ? (t => t) : snapTime;
        const snappedDt = _groupTimeDeltaPure(
            S.drag.origTimes, S.drag.primaryOrigTime, dtRaw, snapFn);

        if (_rollReadOnly()) {
            // Fretted part in the roll (VA.3): vertical drag = re-pitch through
            // the resolver; the commit marks moved notes suggested.
            _rollDragPitchMove(nn, snappedDt, dy);
        } else if (isKeysMode()) {
            const dMidi = -Math.round(dy / PIANO_LANE_H);
            for (let i = 0; i < S.drag.indices.length; i++) {
                const ni = S.drag.indices[i];
                nn[ni].time = S.drag.origTimes[i] + snappedDt;

                const origMidi = noteToMidi(S.drag.origStrings[i], S.drag.origFrets[i]);
                const newMidi = Math.max(0, Math.min(143, origMidi + dMidi));
                nn[ni].string = midiToString(newMidi);
                nn[ni].fret = midiToFret(newMidi);
            }
        } else {
            const dLanes = Math.round(dy / LANE_H);
            for (let i = 0; i < S.drag.indices.length; i++) {
                const ni = S.drag.indices[i];
                nn[ni].time = S.drag.origTimes[i] + snappedDt;

                const origLane = strToLane(S.drag.origStrings[i]);
                // Reuse the locally-cached `L` from onMouseMove instead of
                // calling lanes() per dragged note.
                const newLane = Math.max(0, Math.min(L - 1, origLane + dLanes));
                nn[ni].string = laneToStr(newLane);
            }
        }
        draw();
    }
}

function onMouseUp(e) {
    if (!S.drag) return;
    if (_loopStripOnMouseUp()) return;
    const { x, y } = getMousePos(e);

    // Bar-range select finalise — refresh the Loop-in-3D button state.
    if (S.drag.type === 'barsel') {
        S.drag = null;
        _updateLoopIn3DBtn();
        draw();
        return;
    }

    // Drum-edit drag finalise: routes the completed move through
    // MoveDrumHitsCmd (revert-then-exec), which owns the sort + selection
    // remap, so drum moves undo/redo like note moves.
    if (S.drag.type === 'drum-move') {
        _drumEditorOnDragEnd();
        return;
    }

    if (S.drag.type === 'drum-velocity') {
        _drumEditorOnVelocityDragEnd();
        return;
    }

    if (S.drag.type === 'drum-select') {
        _drumEditorOnSelectEnd();
        return;
    }

    if (S.drag.type === 'tempo-sync' || S.drag.type === 'tempo-beat') {
        _tempoMapOnDragEnd();
        return;
    }

    if (S.drag.type === 'tone') {
        onToneLaneMouseUp();
        return;
    }

    if (S.drag.type === 'anchor') {
        onAnchorLaneMouseUp();
        return;
    }

    if (S.drag.type === 'handshape') {
        onHandshapeLaneMouseUp();
        return;
    }

    if (S.drag.type === 'resize') {
        const nn = notes();
        const finalSustains = S.drag.indices.map(i => nn[i].sustain || 0);
        // Revert so the command can apply the grouped edit as one undo step.
        for (let i = 0; i < S.drag.indices.length; i++) {
            nn[S.drag.indices[i]].sustain = S.drag.origSustains[i];
        }
        const changed = finalSustains.some((v, i) => v !== S.drag.origSustains[i]);
        if (changed) {
            S.history.exec(new ResizeSustainGroupCmd(S.drag.indices, finalSustains));
        }
    }

    if (S.drag.type === 'move' && S.drag.moved) {
        // Commit move as undo command
        const nn = notes();
        const rollFretted = _rollReadOnly();
        const dtimes = S.drag.indices.map((ni, i) => nn[ni].time - S.drag.origTimes[i]);
        const dstrings = S.drag.indices.map((ni, i) => nn[ni].string - S.drag.origStrings[i]);
        const dfrets = isKeysMode()
            ? S.drag.indices.map((ni, i) => nn[ni].fret - S.drag.origFrets[i])
            : null;

        // Revert to original first so exec() applies the delta
        for (let i = 0; i < S.drag.indices.length; i++) {
            nn[S.drag.indices[i]].time = S.drag.origTimes[i];
            nn[S.drag.indices[i]].string = S.drag.origStrings[i];
            if (dfrets) nn[S.drag.indices[i]].fret = S.drag.origFrets[i];
        }
        const cmd = new MoveNoteCmd(S.drag.indices, dtimes, dstrings, dfrets);
        if (rollFretted) {
            // VA.3: the sanctioned suggest-position writer passes the read-only
            // lock; notes the resolver actually repicked (string/fret changed —
            // not a pure time nudge or a held/locked note) are marked suggested.
            cmd.suggestResolved = true;
            cmd.markSuggestedIdx = S.drag.indices.filter((ni, i) => dstrings[i] !== 0 || (dfrets && dfrets[i] !== 0));
        }
        S.history.exec(cmd);
        if (_mixDragChangedPitchPure(dstrings, dfrets)) _editBlipAt();
        // Refusal hint: a vertical drag that repitched nothing means every frame
        // was refused (ambiguous / outside the hand window / occupied / locked).
        if (rollFretted && (!cmd.markSuggestedIdx || !cmd.markSuggestedIdx.length)
            && Math.abs(y - S.drag.startY) >= PIANO_LANE_H) {
            setStatus('Couldn’t repitch here — hand position or a locked technique blocks it. Try String view or add an anchor.');
        }
    }

    if (S.drag.type === 'select') {
        // Select notes inside rectangle
        const x1 = Math.min(S.drag.startX, S.drag.curX);
        const y1 = Math.min(S.drag.startY, S.drag.curY);
        const x2 = Math.max(S.drag.startX, S.drag.curX);
        const y2 = Math.max(S.drag.startY, S.drag.curY);

        const nn = notes();
        const keysMode = isKeysMode();
        const rctx = keysMode ? _rollPitchCtx() : null;
        for (let i = 0; i < nn.length; i++) {
            const nx = timeToX(nn[i].time);
            let ny;
            if (keysMode) {
                const midi = _rollMidiForNote(nn[i], rctx);
                if (midi === null) continue;
                ny = midiToY(midi) + PIANO_LANE_H / 2;
            } else {
                ny = strToY(nn[i].string) + LANE_H / 2;
            }
            if (nx >= x1 && nx <= x2 && ny >= y1 && ny <= y2) {
                S.sel.add(i);
            }
        }
    }

    S.drag = null;
    draw();
    updateStatus();
}

function onDblClick(e) {
    // Parts view: double-click opens the lane's focus editor.
    if (S.partsViewMode) { _partsViewOnDblClick(e); return; }
    if (S.drumEditMode || S.tempoMapMode) return;  // those modes own canvas interaction
    if (_recState === 'recording') return;  // block note addition during active take
    const { x, y } = getMousePos(e);
    const keysMode = isKeysMode();
    const laneBottom = keysMode
        ? WAVEFORM_H + pianoLaneCount() * PIANO_LANE_H
        : WAVEFORM_H + lanes() * LANE_H;
    if (y < WAVEFORM_H || y > laneBottom) return;

    // The keyboard gutter (keys/piano view) is audition-only — see onMouseDown.
    // A double-click there must NOT open the Add Note dialog; the gutter never
    // adds or selects a note. String view has no key gutter, so this is scoped
    // to keys mode where laneBottom already equals the gutter's lower edge.
    if (keysMode && _inKeyboardGutterPure(x, y, LABEL_W, WAVEFORM_H, laneBottom)) return;

    const idx = hitNote(x, y);
    if (idx >= 0) return; // double-click on existing note = no-op

    const t = snapTime(Math.max(0, xToTime(x)));

    // Suggest-position write path (VA.3): a FRETTED part in the piano roll adds
    // by SOUNDING pitch — the resolver picks the string/fret (marked suggested),
    // or the confirm popover asks when the choice is genuinely ambiguous. No
    // silent guess, no view switch. Real keys parts keep the pitch dialog below.
    if (_rollReadOnly()) {
        _rollAddByPitch(yToMidi(y), t, e.clientX, e.clientY);
        return;
    }

    // Show add-note dialog
    if (keysMode) {
        const midi = yToMidi(y);
        showAddNote(e.clientX, e.clientY, t, midiToString(midi), midiToFret(midi));
    } else {
        const s = yToStr(y);
        showAddNote(e.clientX, e.clientY, t, s);
    }
}

function onWheel(e) {
    e.preventDefault();
    if (e.ctrlKey) {
        // Ctrl+scroll = zoom
        const { x } = getMousePos(e);
        const timeBefore = xToTime(x);
        const factor = e.deltaY < 0 ? 1.15 : 0.87;
        S.zoom = Math.max(20, Math.min(2000, S.zoom * factor));
        // Keep the time under cursor stable
        S.scrollX = timeBefore - (x - LABEL_W) / S.zoom;
        S.scrollX = _editorClampScrollX(S.scrollX);
    } else {
        // Scroll = pan
        S.scrollX = _editorClampScrollX(S.scrollX + e.deltaY / S.zoom * 2);
    }
    updateZoomDisplay();
    draw();
}

let editorWaveformVisible = true;
// ════════════════════════════════════════════════════════════════════
// Read-only Tab preview (EDITOR-VIEW-MODALITY-DESIGN VA.4, V8/V12) —
// render the CURRENT part as engraved tab by reusing the Tab View
// plugin's arrangement→GP conversion endpoint + the same pinned alphaTab
// CDN render idiom. Strictly read-only, refresh-on-open only (alphaTab
// lays out once per load — never per frame), and honest about its source:
// the endpoint reads the SAVED pack, so unsaved edits need a Save first.
// Degrades cleanly when the Tab View plugin isn't installed.
// ════════════════════════════════════════════════════════════════════

/* @pure:tab-preview:start */
// Guard: which parts can preview, with the exact user-facing reason when
// one can't. NON-FRETTED parts (keys AND drums) are excluded — their wire
// packing isn't fret/string, so a GP conversion of it would engrave
// nonsense tab. The non-fretted test mirrors the editor-wide one
// (KEYS_PATTERN /^(keys|piano|keyboard|synth)/i plus /^drums/i, e.g. the
// Strings modal's gate) but is INLINED so this @pure block stays
// self-contained and extractable — no reference to the outer KEYS_PATTERN
// global, matching the parts-view block's "regexes inlined" convention.
function _tabPreviewGuardPure(filename, arrName, hasArrangements) {
    if (!hasArrangements) return { ok: false, reason: 'Load a song first.' };
    const nm = String(arrName || '');
    if (/^(keys|piano|keyboard|synth)/i.test(nm) || /^drums/i.test(nm)) {
        return { ok: false, reason: 'Tab preview is for fretted parts — keys and drums parts have no tab.' };
    }
    if (!filename) {
        return { ok: false, reason: 'Save the song first — the preview reads the saved pack.' };
    }
    return { ok: true, reason: '' };
}
// Keyboard policy while the read-only preview modal is open. It is a modal
// proofreading lens, so NO editor shortcut may reach the chart behind it
// (mirrors the partsViewMode read-only gate, which blocks note edits from
// mutating the arrangement hidden behind an overview). Escape closes it;
// every other key is swallowed. Returns 'close' | 'swallow' | 'ignore'
// ('ignore' only when the preview isn't open, so onKeyDown proceeds).
function _tabPreviewKeyPolicyPure(previewOpen, key) {
    if (!previewOpen) return 'ignore';
    if (key === 'Escape') return 'close';
    return 'swallow';
}
// The Tab View conversion URL for one saved part. `ts` busts any
// intermediate cache so Refresh after a Save always re-converts.
function _tabPreviewUrlPure(filename, arrIdx, ts) {
    return '/api/plugins/tabview/gp5/' + encodeURIComponent(filename || '')
        + '?arrangement=' + (Number(arrIdx) || 0)
        + '&t=' + (Number(ts) || 0);
}
// Map a failed conversion response to the honest user-facing message.
function _tabPreviewHttpMessagePure(status, bodyText) {
    if (status === 404) {
        return 'Tab preview needs the Tab View plugin installed — or the song has no saved pack yet.';
    }
    if (status === 501) {
        return 'The host is too old for pack conversion — update feedBack.';
    }
    const body = String(bodyText || '').slice(0, 140);
    return 'Preview failed (' + status + ')' + (body ? ': ' + body : '');
}
/* @pure:tab-preview:end */

// Same pinned version + memoized loader idiom as the Tab View plugin —
// pinning insulates the preview from CDN latest-tag churn (V12: alphaTab
// is MPL-2.0, render-only, CDN-loaded; never vendored).
const _TAB_PREVIEW_AT_VERSION = '1.8.2';
const _TAB_PREVIEW_CDN = 'https://cdn.jsdelivr.net/npm/@coderline/alphatab@'
    + _TAB_PREVIEW_AT_VERSION + '/dist';
let _tabPreviewLoadPromise = null;
function _tabPreviewLoadScript() {
    if (window.alphaTab) return Promise.resolve();
    if (_tabPreviewLoadPromise) return _tabPreviewLoadPromise;
    _tabPreviewLoadPromise = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = _TAB_PREVIEW_CDN + '/alphaTab.min.js';
        s.onload = resolve;
        s.onerror = () => {
            _tabPreviewLoadPromise = null;   // allow retry on next open
            reject(new Error('Failed to load the tab renderer (offline?)'));
        };
        document.head.appendChild(s);
    });
    return _tabPreviewLoadPromise;
}

let _tabPreviewApi = null;
let _tabPreviewSeq = 0;   // stale-render guard across rapid refreshes

function _tabPreviewStatus(msg) {
    const el = document.getElementById('editor-tab-preview-status');
    if (el) el.textContent = msg || '';
}

function _tabPreviewDestroyApi() {
    if (_tabPreviewApi) {
        try { _tabPreviewApi.destroy(); } catch (_) { /* best-effort */ }
        _tabPreviewApi = null;
    }
    const mount = document.getElementById('editor-tab-preview-mount');
    if (mount) mount.innerHTML = '';
}

async function _tabPreviewRender() {
    const seq = ++_tabPreviewSeq;
    const mount = document.getElementById('editor-tab-preview-mount');
    if (!mount) return;
    const arr = S.arrangements.length ? S.arrangements[S.currentArr] : null;
    const guard = _tabPreviewGuardPure(
        S.filename, arr && arr.name, !!S.arrangements.length);
    if (!guard.ok) {
        _tabPreviewDestroyApi();
        _tabPreviewStatus(guard.reason);
        return;
    }
    _tabPreviewStatus('Converting…');
    try {
        await _tabPreviewLoadScript();
        const url = _tabPreviewUrlPure(S.filename, S.currentArr, Date.now());
        const resp = await fetch(url);
        if (seq !== _tabPreviewSeq) return;   // superseded by a newer refresh
        if (!resp.ok) {
            let body = '';
            try { body = await resp.text(); } catch (_) { /* keep '' */ }
            // Re-check after the body read — reading it is another await, so a
            // newer refresh may have superseded us; without this a stale error
            // would destroy the newer render and stomp its status (symmetric
            // with the arrayBuffer() checkpoint on the success path below).
            if (seq !== _tabPreviewSeq) return;
            _tabPreviewDestroyApi();
            _tabPreviewStatus(_tabPreviewHttpMessagePure(resp.status, body));
            return;
        }
        const buf = await resp.arrayBuffer();
        if (seq !== _tabPreviewSeq) return;
        _tabPreviewDestroyApi();
        _tabPreviewApi = new alphaTab.AlphaTabApi(mount, {
            core: { fontDirectory: _TAB_PREVIEW_CDN + '/font/' },
            display: { layoutMode: alphaTab.LayoutMode.Page, scale: 0.9 },
            // No alphaTab synth — the editor owns audio (same rationale as
            // the Tab View plugin: drops the soundfont download entirely).
            player: { enablePlayer: false },
        });
        if (_tabPreviewApi.renderFinished && _tabPreviewApi.renderFinished.on) {
            _tabPreviewApi.renderFinished.on(() => {
                if (seq === _tabPreviewSeq) _tabPreviewStatus('');
            });
        }
        if (_tabPreviewApi.error && _tabPreviewApi.error.on) {
            _tabPreviewApi.error.on((e) => {
                if (seq === _tabPreviewSeq) {
                    _tabPreviewStatus('Render failed: ' + ((e && e.message) || 'unknown error'));
                }
            });
        }
        _tabPreviewStatus('Engraving…');
        _tabPreviewApi.load(new Uint8Array(buf));
    } catch (e) {
        if (seq === _tabPreviewSeq) {
            _tabPreviewDestroyApi();
            _tabPreviewStatus('Preview failed: ' + (e && e.message ? e.message : e));
        }
    }
}

function _editorShowTabPreview() {
    const modal = document.getElementById('editor-tab-preview-modal');
    if (!modal) return false;
    const arr = S.arrangements.length ? S.arrangements[S.currentArr] : null;
    const title = document.getElementById('editor-tab-preview-title');
    if (title) {
        title.textContent = 'Tab preview — ' + ((arr && arr.name) || 'part') + ' (as last saved)';
    }
    modal.classList.remove('hidden');
    _tabPreviewRender();
    return true;
}
window.editorShowTabPreview = _editorShowTabPreview;

window.editorRefreshTabPreview = () => { _tabPreviewRender(); };

window.editorHideTabPreview = () => {
    const modal = document.getElementById('editor-tab-preview-modal');
    if (modal) modal.classList.add('hidden');
    // Free the engraving resources — the modal is refresh-on-open, so
    // nothing may keep laying out behind a hidden panel.
    _tabPreviewSeq++;
    _tabPreviewDestroyApi();
    _tabPreviewStatus('');
};

window.editorToggleShortcutPanel = (force) => {
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

window.editorRunShortcutCommand = (id) => {
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
function _editorCurrentNoteIndices() {
    return (!S.drumEditMode && !S.tempoMapMode && S.sel && S.sel.size) ? [...S.sel] : [];
}

function _editorToggleTechnique(key, { openFret = false } = {}) {
    const idxs = _editorCurrentNoteIndices();
    if (!idxs.length) { setStatus('Select notes first'); return false; }
    const nn = notes();
    const next = !idxs.every(i => !!(nn[i] && nn[i].techniques && nn[i].techniques[key]));
    S.history.exec(new ToggleTechniqueCmd(idxs, key, next, openFret ? 0 : null));
    draw();
    updateStatus();
    return true;
}

function _editorSetSelectedFret(fret) {
    const idxs = _editorCurrentNoteIndices();
    if (!idxs.length) { setStatus('Select notes first'); return false; }
    const next = Math.max(0, Math.min(24, Number(fret) || 0));
    S.history.exec(new ChangeFretGroupCmd(idxs, next));
    _editBlipAt();
    draw();
    updateStatus();
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
    draw();
    updateStatus();
    _renderInspector();
    setStatus(next < 0 ? 'Pick direction cleared' : (next === 0 ? 'Pick direction: down' : 'Pick direction: up'));
    return true;
}
function _editorSetPitchedSlideByStep(delta) {
    const idxs = _editorCurrentNoteIndices();
    if (!idxs.length) { setStatus('Select notes first'); return false; }
    const step = delta < 0 ? -1 : 1;
    S.history.exec(new SetPitchedSlideTargetsCmd(idxs, step));
    draw();
    updateStatus();
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
    draw();
    updateStatus();
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
    draw();
    updateStatus();
    return true;
}

function _editorToggleSnapEnabled() {
    window.editorSetSnapEnabled(!S.snapEnabled);
    return true;
}

function _editorSnapStepSeconds() {
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

function _editorSeekToTime(t) {
    S.cursorTime = Math.max(0, Math.min(S.duration || Infinity, t));
    const margin = 0.15 * (canvas ? canvas.width / S.zoom : 10);
    if (S.cursorTime < S.scrollX) S.scrollX = _editorClampScrollX(S.cursorTime - margin);
    const right = S.scrollX + ((canvas ? canvas.width : 800) - LABEL_W) / S.zoom;
    if (S.cursorTime > right) S.scrollX = _editorClampScrollX(S.cursorTime - margin);
    if (S.playing) { stopPlayback(); startPlayback(); }
    draw();
    updateTimeDisplay();
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
function _bookmarks() {
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
    draw();
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
    setStatus(`Bookmark ${n}`);
    return true;
}

function _editorJumpBeat(dir) {
    const beats = (S.beats || []).map(b => b.time).filter(t => Number.isFinite(t)).sort((a, b) => a - b);
    const cur = S.cursorTime || 0;
    const next = dir > 0 ? beats.find(t => t > cur + 0.0001) : [...beats].reverse().find(t => t < cur - 0.0001);
    if (next !== undefined) _editorSeekToTime(next);
}

function _editorJumpNote(dir) {
    const times = notes().map(n => n.time).filter(t => Number.isFinite(t)).sort((a, b) => a - b);
    const cur = S.cursorTime || 0;
    const next = dir > 0 ? times.find(t => t > cur + 0.0001) : [...times].reverse().find(t => t < cur - 0.0001);
    if (next !== undefined) _editorSeekToTime(next);
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
    draw();
    updateStatus();
    setStatus(`Duplicated ${newNotes.length} note${newNotes.length === 1 ? '' : 's'}`);
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
    draw();
    updateStatus();
    return true;
}

function _editorResnapSelection() {
    const idxs = _editorCurrentNoteIndices();
    if (!idxs.length) { setStatus('Select notes first'); return false; }
    const nn = notes();
    const oldTimes = idxs.map(i => nn[i].time);
    const newTimes = oldTimes.map(t => snapTime(t));
    for (let i = 0; i < idxs.length; i++) nn[idxs[i]].time = oldTimes[i];
    const dtimes = newTimes.map((t, i) => t - oldTimes[i]);
    const dstrings = idxs.map(() => 0);
    S.history.exec(new MoveNoteCmd(idxs, dtimes, dstrings, null));
    draw();
    updateStatus();
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
    draw();
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
    draw();
    setStatus('Section added');
    return true;
}

function _editorAddPhraseAtCursor() {
    const arr = S.arrangements[S.currentArr];
    if (!arr) return false;
    if (!Array.isArray(arr.phrases)) arr.phrases = [];
    const name = 'phrase';
    const num = arr.phrases.filter(p => p.name === name).length + 1;
    arr.phrases.push({ name, number: num, start_time: snapTime(S.cursorTime || 0), levels: [] });
    arr.phrases.sort((a, b) => (a.start_time || 0) - (b.start_time || 0));
    draw();
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
    draw();
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
    draw();
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
    const d = _tempoResolvedMeasureIdx();
    if (d >= 0) _tempoSetBeatsPerMeasure(d, beats);
}

function _editorToggleWaveform() {
    editorWaveformVisible = !editorWaveformVisible;
    draw();
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
        setStatus('Select a Tempo Map sync point first.');
        return true;
    }
    _tempoPromptMeasureBpm(S.tempoSel);
    return true;
}

function _editorInsertTempoSyncAtCursor() {
    if (!S.tempoMapMode) return false;
    _tempoInsertSyncPoint(S.cursorTime);
    return true;
}

function _editorDeleteTempoSyncSelection() {
    if (!S.tempoMapMode || S.tempoSel < 0) {
        setStatus('Select a Tempo Map sync point first.');
        return true;
    }
    _tempoDeleteSyncPoint(S.tempoSel);
    return true;
}

function _editorAdjustTempoMeasureBeats(delta) {
    if (!S.tempoMapMode || S.tempoSel < 0) {
        setStatus('Select a Tempo Map sync point first.');
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
        setStatus('Select a Tempo Map sync point first.');
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
        setStatus('Select a Tempo Map sync point first.');
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
    updateTempoSigDisplay();
    draw();
    const nextDen = _tempoMeasureDenominator(d);
    if (prevDen !== nextDen) {
        setStatus(`Measure ${S.beats[d].measure} time signature changed: ${prevNum}/${prevDen} → ${prevNum}/${nextDen}`);
    }
    return true;
}
function _editorRunEofCommand(cmd) {
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
    case 'toggleMixer': return _editorToggleMixer();
    case 'toggleLoopAB': return _editorToggleLoopAB();
    case 'toggleOnsetStrip': return _editorToggleOnsetStrip();
    case 'togglePartsView': return _editorTogglePartsView();
    case 'toggleKeyHighlight': return _editorToggleKeyHighlight();
    case 'renamePart': window.editorRenameArrangement(); return true;
    case 'toggleFollow': return _editorToggleFollow();
    case 'toggleDrumDensity': return _editorToggleDrumDensity();
    case 'showTabPreview': return _editorShowTabPreview();
    case 'cycleViewMode': return _editorCycleViewMode();
    case 'movePartEarlier': return _editorMovePart(-1);
    case 'movePartLater': return _editorMovePart(+1);
    case 'showShortcutHelp': return _editorShowShortcutDiscovery('Shortcut help');
    case 'openCommandPalette': return _editorShowShortcutDiscovery('Command palette');
    case 'importMidi': _editorOpenImportMidi(); return true;
    case 'importXml': _editorOpenImportXml(); return true;
    case 'importGp': _editorOpenImportGp(); return true;
    case 'prevBeat': _editorJumpBeat(-1); return true;
    case 'nextBeat': _editorJumpBeat(+1); return true;
    case 'prevNote': _editorJumpNote(-1); return true;
    case 'nextNote': _editorJumpNote(+1); return true;
    case 'prevGrid': _editorJumpGrid(-1); return true;
    case 'nextGrid': _editorJumpGrid(+1); return true;
    case 'prevAnchor': _editorJumpAnchor(-1); return true;
    case 'nextAnchor': _editorJumpAnchor(+1); return true;
    case 'toggleSnap': return _editorToggleSnapEnabled();
    case 'shortenSustain': return _editorAdjustSelectedSustain(-_editorSnapStepSeconds());
    case 'lengthenSustain': return _editorAdjustSelectedSustain(+_editorSnapStepSeconds());
    case 'snapDown': window.editorSetSnap(Math.max(0, S.snapIdx - 1)); return true;
    case 'snapUp': window.editorSetSnap(Math.min(SNAP_VALUES.length - 1, S.snapIdx + 1)); return true;
    case 'toggleSnapMode': return _editorToggleSnapMode();
    case 'editFret': { const idxs = _editorCurrentNoteIndices(); if (idxs.length) promptFret(idxs[0]); else setStatus('Select a note first'); return true; }
    case 'setFretTen': return _editorSetSelectedFret(10);
    case 'noteMenu': { const idxs = _editorCurrentNoteIndices(); if (idxs.length) showContextMenu(window.innerWidth / 2, window.innerHeight / 2, idxs[0]); else setStatus('Select a note first'); return true; }
    case 'bend': { const idxs = _editorCurrentNoteIndices(); if (idxs.length) promptBend(idxs[0]); else setStatus('Select a note first'); return true; }
    case 'slideEditor': { const idxs = _editorCurrentNoteIndices(); if (idxs.length) promptSlide(idxs[0]); else setStatus('Select a note first'); return true; }
    case 'unpitchedSlide': { const idxs = _editorCurrentNoteIndices(); if (idxs.length) promptSlideUnpitch(idxs[0]); else setStatus('Select a note first'); return true; }
    case 'moveStringUp': return _execMoveStringSameFret(+1);
    case 'moveStringDown': return _execMoveStringSameFret(-1);
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
    if (editorShortcutProfile !== 'feedback' || _editorIsTypingTarget(e)) return false;
    const cmd = _editorFeedbackCommandForKeyPure(e, S.tempoMapMode ? 'tempoMap' : 'note');
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
        ? WAVEFORM_H + pianoLaneCount() * PIANO_LANE_H
        : WAVEFORM_H + lanes() * LANE_H;
    if (y < WAVEFORM_H || y > laneBottom) return false;
    // Only inside the timeline grid — a right-click on the left string/piano
    // label margin (x < LABEL_W) is not a note edit; without this it would
    // clamp xToTime()<0 to 0 and add a note at the song start.
    if (x < LABEL_W) return false;

    const idx = hitNote(x, y);
    if (idx >= 0) {
        if (_rollReadOnly()) { _rollLockNotice(); return true; }
        S.history.exec(new DeleteNotesCmd([idx]));
        draw();
        updateStatus();
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
    _editBlipAt();
    S.sel.clear();
    if (cmd.idx >= 0) S.sel.add(cmd.idx);
    draw();
    updateStatus();
    setStatus('Note added');
    return true;
}
function onContextMenu(e) {
    if (S.drumEditMode) { e.preventDefault(); return; }  // drum-edit mode handles interaction
    if (S.tempoMapMode) { e.preventDefault(); _tempoMapOnContextMenu(e); return; }
    e.preventDefault();
    const { x, y } = getMousePos(e);

    // Tone-lane right-click — slot picker for the hit marker (and a
    // delete entry). Falls through to the existing menu logic when
    // there's no marker under the cursor.
    if (y >= 0 && y < TONE_LANE_H && S.arrangements && S.arrangements.length) {
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

    if (_editorRightClickNoteEdit(e, x, y)) return;

    // Right-click on beat bar or lanes with no note = section menu
    const beatBarY = isKeysMode()
        ? WAVEFORM_H + pianoLaneCount() * PIANO_LANE_H
        : WAVEFORM_H + lanes() * LANE_H;
    if (y >= beatBarY || (y >= WAVEFORM_H && hitNote(x, y) < 0)) {
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
        // updateStatus() already calls _renderInspector internally.
        updateStatus();
    }
    draw();
    showContextMenu(e.clientX, e.clientY, idx);
}

function showSectionMenu(cx, cy, time) {
    const menu = document.getElementById('editor-context-menu');
    // Section within 1 s of the click, if any (shared helper — same match
    // the commands' tests exercise).
    const nearIdx = _sectionNearestIndexPure(S.sections, time, 1.0);
    const nearSection = nearIdx >= 0 ? S.sections[nearIdx] : null;

    let html = '';
    html += `<button class="w-full text-left px-3 py-1 text-xs hover:bg-dark-500" data-action="add">Add Section Here</button>`;
    if (nearSection) {
        html += `<button class="w-full text-left px-3 py-1 text-xs hover:bg-dark-500" data-action="rename">Rename "${nearSection.name}"</button>`;
        html += `<button class="w-full text-left px-3 py-1 text-xs hover:bg-dark-500 text-red-400" data-action="delete">Delete "${nearSection.name}"</button>`;
    }
    menu.innerHTML = html;
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
                draw();
            } else if (btn.dataset.action === 'rename' && nearSection) {
                const name = await _editorPromptText({
                    title: 'Rename Section', label: 'New name', value: nearSection.name,
                });
                if (name && name !== nearSection.name) {
                    S.history.exec(new RenameSectionCmd(nearSection, name));
                    draw();
                }
            } else if (btn.dataset.action === 'delete' && nearSection) {
                S.history.exec(new RemoveSectionCmd(nearSection));
                draw();
            }
        };
    });
    menu.style.left = cx + 'px';
    menu.style.top = cy + 'px';
    menu.classList.remove('hidden');
}

function onKeyDown(e) {
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
            draw();
            return;
        }
        // Velocity quick-sets: A = accent, N = normal. In drum mode these
        // would otherwise fall through to note commands (toggleAccent /
        // noteMenu) that no-op on an empty note selection.
        if (dk === 'a' || dk === 'n') {
            e.preventDefault();
            if (dk === 'a') _drumEditorSetVelocity(115, 'Accent');
            else _drumEditorSetVelocity(100, 'Normal');
            draw();
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
        draw();
        return;
    }

    // A pending tap-tempo run owns Enter/Escape until resolved — checked
    // before the profile dispatchers so neither can steal the keys.
    if (_tapTempoHandleKey(e)) return;

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
        // Tempo-map mode: delete the selected sync point.
        if (S.tempoMapMode && S.tempoSel >= 0 &&
                !e.target.matches('input, select, textarea')) {
            e.preventDefault();
            _tempoDeleteSyncPoint(S.tempoSel);
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
                draw();
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
                draw();
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
                draw();
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
            draw();
            return;
        }
        // Guard: in drum-edit mode S.sel may still hold a prior guitar/keys
        // selection from before mode entry; deleting those notes while the
        // user thinks they're editing drums would be surprising. Only run
        // the guitar/keys delete path when drum-edit mode is inactive.
        if (!S.drumEditMode && S.sel.size && !e.target.matches('input, select, textarea')) {
            e.preventDefault();
            S.history.exec(new DeleteNotesCmd([...S.sel]));
            draw();
            updateStatus();
            return;
        }
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
    if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
        if (!e.target.matches('input, select, textarea')) {
            e.preventDefault();
            if (S.drumEditMode && S.drumTab) {
                // Select every drum hit. No filter — the user wants every
                // hit even off-screen, mirroring the guitar Ctrl+A path.
                S.drumSel = new Set();
                const hits = S.drumTab.hits || [];
                for (let i = 0; i < hits.length; i++) S.drumSel.add(i);
                draw();
                return;
            }
            // Tempo-map mode has no note selection — Ctrl+A is inert.
            if (S.tempoMapMode) return;
            const nn = notes();
            for (let i = 0; i < nn.length; i++) S.sel.add(i);
            draw();
            return;
        }
    }
    if ((e.ctrlKey || e.metaKey) && (e.key === 'd' || e.key === 'D')) {
        // Duplicate the selection to the next position. Same mode/focus
        // gate as copy/paste below; preventDefault so the browser's
        // bookmark shortcut doesn't fire.
        if (!S.drumEditMode && !S.tempoMapMode && S.sel.size
                && !e.target.matches('input, select, textarea')) {
            e.preventDefault();
            _editorDuplicateSelection();
            return;
        }
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'c') {
        // Copy/paste act on the guitar/keys arrangement's S.sel. In
        // drum-edit mode the canvas shows the drum grid, so a paste here
        // would mutate the hidden arrangement with no visual feedback —
        // skip both shortcuts while drum-edit mode is active.
        if (!S.drumEditMode && !S.tempoMapMode && S.sel.size && !e.target.matches('input, select, textarea')) {
            e.preventDefault();
            const nn = notes();
            const selNotes = [...S.sel].map(i => nn[i]);
            const baseTime = Math.min(...selNotes.map(n => n.time));
            S.clipboard = {
                notes: selNotes.map(n => ({
                    time: n.time - baseTime,
                    string: n.string,
                    fret: n.fret,
                    sustain: n.sustain || 0,
                    techniques: { ...(n.techniques || {}) },
                })),
                baseTime,
            };
            setStatus(`Copied ${selNotes.length} notes`);
            return;
        }
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'v') {
        if (!S.drumEditMode && !S.tempoMapMode && S.clipboard && S.clipboard.notes.length && !e.target.matches('input, select, textarea')) {
            e.preventDefault();
            const pasteTime = S.cursorTime;
            const newNotes = S.clipboard.notes.map(n => ({
                time: n.time + pasteTime,
                string: n.string,
                fret: n.fret,
                sustain: n.sustain,
                techniques: { ...(n.techniques || {}) },
            }));
            // Batch add via a compound command. Wrap both exec (sort
            // can reshuffle) and rollback (splice shifts indices) in
            // `_withStableSelection` so undo/redo can't leave `S.sel`
            // pointing at unrelated notes.
            const nn = notes();
            const addCmd = {
                _notes: newNotes,
                exec() {
                    _withStableSelection(() => {
                        for (const n of this._notes) nn.push(n);
                        nn.sort((a, b) => a.time - b.time);
                    });
                },
                rollback() {
                    _withStableSelection(() => {
                        for (const n of this._notes) {
                            const i = nn.indexOf(n);
                            if (i >= 0) nn.splice(i, 1);
                        }
                    });
                },
            };
            S.history.exec(addCmd);
            // Select pasted notes
            S.sel.clear();
            for (const n of newNotes) { const i = nn.indexOf(n); if (i >= 0) S.sel.add(i); }
            draw();
            updateStatus();
            setStatus(`Pasted ${newNotes.length} notes at cursor`);
            return;
        }
    }
}

// ════════════════════════════════════════════════════════════════════
// Context menu
// ════════════════════════════════════════════════════════════════════

function showContextMenu(cx, cy, idx) {
    const menu = document.getElementById('editor-context-menu');

    // Pre-compute move-string validity once for the whole menu so both
    // items share the same check without re-evaluating per render pass.
    const canUp   = _canMoveString(+1);
    const canDown = _canMoveString(-1);

    const n = notes()[idx];
    const items = [
        // Suggest-position (VA.3): confirm the machine's pick for the current
        // selection (clears the suggested mark; undo re-marks). Shown only when
        // the clicked note is still an unconfirmed suggestion.
        ...(_isSuggested(n) ? [
            { label: '✓ Accept position', action: () => { hideContextMenu(); _execAcceptPositions(); } },
            { type: 'sep' },
        ] : []),
        { label: 'Move Up 1 String',   action: () => { hideContextMenu(); _execMoveString(+1); }, disabled: !canUp },
        { label: 'Move Down 1 String', action: () => { hideContextMenu(); _execMoveString(-1); }, disabled: !canDown },
        { type: 'sep' },
        { label: 'Change Fret...', action: () => promptFret(idx) },
        { label: 'Bend...', action: () => promptBend(idx) },
        { label: 'Slide To...', action: () => promptSlide(idx) },
        { label: 'Slide Unpitched To...', action: () => promptSlideUnpitch(idx) },
        { label: 'Delete', action: () => { S.history.exec(new DeleteNotesCmd([...S.sel])); draw(); updateStatus(); } },
        { type: 'sep' },
        { label: 'Hammer-On', toggle: 'hammer_on', idx },
        { label: 'Pull-Off', toggle: 'pull_off', idx },
        { label: 'Palm Mute', toggle: 'palm_mute', idx },
        { label: 'Fret-Hand Mute', toggle: 'fret_hand_mute', idx },
        { label: 'Harmonic', toggle: 'harmonic', idx },
        { label: 'Pinch Harmonic', toggle: 'harmonic_pinch', idx },
        { label: 'Accent', toggle: 'accent', idx },
        { label: 'Tap', toggle: 'tap', idx },
        { label: 'Slap', toggle: 'slap', idx },
        { label: 'Pop (Pluck)', toggle: 'pluck', idx },
        { label: 'Tremolo', toggle: 'tremolo', idx },
        { label: 'Vibrato', toggle: 'vibrato', idx },
        { label: 'Mute', toggle: 'mute', idx },
        { label: 'Link Next', toggle: 'link_next', idx },
        { label: 'Ignore', toggle: 'ignore', idx },
    ];

    let html = '';
    for (const it of items) {
        if (it.type === 'sep') {
            html += '<div class="border-t border-gray-700 my-1"></div>';
            continue;
        }
        if (it.toggle) {
            const techs = n.techniques || {};
            const on = techs[it.toggle];
            html += `<button class="w-full text-left px-3 py-1 text-xs hover:bg-dark-500 flex items-center gap-2" onclick="editorToggleTech(${idx},'${it.toggle}')">
                <span class="w-3">${on ? '\u2713' : ''}</span>${it.label}</button>`;
        } else if (it.disabled) {
            // Greyed-out, non-interactive entry for invalid move directions.
            html += `<button class="w-full text-left px-3 py-1 text-xs opacity-40 cursor-not-allowed" disabled>${it.label}</button>`;
        } else {
            html += `<button class="w-full text-left px-3 py-1 text-xs hover:bg-dark-500" data-action="${items.indexOf(it)}">${it.label}</button>`;
        }
    }
    menu.innerHTML = html;
    // Wire up non-toggle, non-disabled actions
    menu.querySelectorAll('[data-action]').forEach(btn => {
        const actionItem = items[parseInt(btn.dataset.action)];
        btn.onclick = () => { hideContextMenu(); actionItem.action(); };
    });

    menu.style.left = cx + 'px';
    menu.style.top = cy + 'px';
    menu.classList.remove('hidden');
}
function hideContextMenu() {
    document.getElementById('editor-context-menu').classList.add('hidden');
}

async function promptFret(idx) {
    hideContextMenu();
    const current = notes()[idx].fret;
    const val = await _editorPromptText({
        title: 'Edit Fret', label: 'Fret number (0–24)', value: String(current),
    });
    if (val === null) return;
    // Strict-integer parse so `12abc` / `0x10` fall back to 0 instead
    // of silently truncating to a surprising value. `_parseFretInput`
    // returns -1 on bad input; clamp to [0, 24] for the fretboard.
    const parsed = _parseFretInput(val);
    const fret = Math.max(0, Math.min(24, parsed < 0 ? 0 : parsed));
    S.history.exec(new ChangeFretCmd(idx, fret));
    _editBlipAt();
    draw();
    _renderInspector();
}

// Bend authoring (§6.2.1): a modal with the peak amount (`bn`), an intent
// dropdown (`bt`) and an interactive drag-point curve editor (`bnv`). Applies
// to the full selection when the right-clicked note is part of it, else just
// that note. Wrapped in SetBendShapeCmd so the whole edit is one undo step.
async function promptBend(idx) {
    hideContextMenu();
    const n = notes()[idx];
    if (!n) return;
    const targets = (S.sel && S.sel.size && S.sel.has(idx)) ? [...S.sel] : [idx];
    const techs = n.techniques || {};
    const startBn = Number(techs.bend) || 0;
    const startBt = Number(techs.bend_intent) || 0;
    const startBnv = sanitizeBendCurve(techs.bend_values)
        || bendPresetCurve(startBt, startBn || 1, n.sustain);
    const result = await _editorBendModal({
        bn: startBn, bt: startBt, bnv: startBnv, sustain: n.sustain,
    });
    if (result === null) return;  // cancelled
    S.history.exec(new SetBendShapeCmd(
        targets, result.bn, result.bt, sanitizeBendCurve(result.bnv)));
    draw();
    _renderInspector();
    updateStatus();
}

// The bend-shape modal. Resolves to {bn, bt, bnv} on OK, or null on Cancel.
// The curve editor: left-click empty space adds a point, drag moves it,
// right-click deletes it; x = time across the note, y = semitones.
function _editorBendModal({ bn = 0, bt = 0, bnv = null, sustain = 0 } = {}) {
    return new Promise((resolve) => {
        document.getElementById('editor-bend-modal')?.remove();
        const Tmax = sustain > 0 ? sustain : 1.0;
        let curBn = Math.max(0, Math.min(3, Number(bn) || 0));
        let curBt = Number(bt) || 0;
        let pts = (sanitizeBendCurve(bnv) || []).map(p => ({ t: p.t, v: p.v }));

        const modal = document.createElement('div');
        modal.id = 'editor-bend-modal';
        modal.className = 'fixed inset-0 bg-black/70 z-50 flex items-center justify-center';
        const inner = document.createElement('div');
        inner.className = 'bg-dark-800 border border-gray-700 rounded-lg p-6 w-full max-w-md mx-4';
        inner.setAttribute('role', 'dialog');
        inner.setAttribute('aria-modal', 'true');
        inner.setAttribute('aria-label', 'Edit bend');

        let settled = false;
        const done = (val) => {
            if (settled) return;
            settled = true;
            modal.remove();
            resolve(val);
        };

        // Vmax: keep the peak and any authored point visible (>= 3 semis).
        const vmax = () => Math.max(3, curBn, ...pts.map(p => p.v), 1);
        const W = 380, H = 170, pad = 26;
        const toX = (t) => pad + (Tmax > 0 ? t / Tmax : 0) * (W - 2 * pad);
        const toY = (v) => H - pad - (v / vmax()) * (H - 2 * pad);
        const fromX = (px) => Math.max(0, Math.min(1, (px - pad) / (W - 2 * pad))) * Tmax;
        const fromY = (py) => Math.max(0, Math.min(1, (H - pad - py) / (H - 2 * pad))) * vmax();

        inner.innerHTML = `
            <h3 class="text-lg font-semibold mb-3">Edit bend</h3>
            <div class="flex items-center gap-3 mb-3">
                <label class="flex items-center gap-2">
                    <span class="text-xs text-gray-400">Peak (semi)</span>
                    <input id="bend-bn" type="number" min="0" max="3" step="0.5" value="${curBn}"
                        class="w-20 bg-dark-700 border border-gray-600 rounded px-1 py-0.5 text-xs">
                </label>
                <label class="flex items-center gap-2 flex-1">
                    <span class="text-xs text-gray-400">Intent</span>
                    <select id="bend-bt" class="flex-1 bg-dark-700 border border-gray-600 rounded px-1 py-0.5 text-xs">
                        ${BEND_INTENTS.map(o => `<option value="${o.v}"${o.v === curBt ? ' selected' : ''}>${o.label}</option>`).join('')}
                    </select>
                </label>
            </div>
            <canvas id="bend-canvas" width="${W}" height="${H}"
                class="w-full bg-dark-900 border border-gray-700 rounded cursor-crosshair"></canvas>
            <p class="text-[11px] text-gray-500 mt-1">Click to add a point · drag to move · right-click to remove. Preset from intent:</p>
            <div class="flex gap-2 mt-2">
                <button type="button" id="bend-preset" class="px-2 py-1 bg-dark-700 hover:bg-dark-600 rounded text-xs">Apply preset</button>
                <button type="button" id="bend-clear" class="px-2 py-1 bg-dark-700 hover:bg-dark-600 rounded text-xs">Clear curve</button>
                <div class="flex-1"></div>
                <button type="button" id="bend-cancel" class="px-3 py-1 bg-dark-700 hover:bg-dark-600 rounded text-sm">Cancel</button>
                <button type="button" id="bend-ok" class="px-3 py-1 bg-blue-700 hover:bg-blue-600 rounded text-sm">OK</button>
            </div>`;
        modal.appendChild(inner);
        document.body.appendChild(modal);

        const canvas = inner.querySelector('#bend-canvas');
        const cx = canvas.getContext('2d');
        const bnInput = inner.querySelector('#bend-bn');
        const btSelect = inner.querySelector('#bend-bt');

        const redraw = () => {
            cx.clearRect(0, 0, W, H);
            // Baseline (0 semis) + frame.
            cx.strokeStyle = '#374151';
            cx.lineWidth = 1;
            cx.strokeRect(pad, pad, W - 2 * pad, H - 2 * pad);
            cx.beginPath();
            cx.moveTo(pad, toY(0)); cx.lineTo(W - pad, toY(0));
            cx.stroke();
            // Curve through the time-sorted points.
            const sorted = pts.slice().sort((a, b) => a.t - b.t);
            if (sorted.length) {
                cx.strokeStyle = '#60a5fa';
                cx.lineWidth = 2;
                cx.beginPath();
                sorted.forEach((p, i) => {
                    const X = toX(p.t), Y = toY(p.v);
                    if (i === 0) cx.moveTo(X, Y); else cx.lineTo(X, Y);
                });
                cx.stroke();
                cx.fillStyle = '#93c5fd';
                for (const p of sorted) {
                    cx.beginPath();
                    cx.arc(toX(p.t), toY(p.v), 4, 0, Math.PI * 2);
                    cx.fill();
                }
            }
        };
        redraw();

        const evtPos = (e) => {
            const r = canvas.getBoundingClientRect();
            return {
                px: (e.clientX - r.left) * (W / r.width),
                py: (e.clientY - r.top) * (H / r.height),
            };
        };
        const nearest = (px, py) => {
            let best = -1, bestD = 12 * 12;
            pts.forEach((p, i) => {
                const dx = toX(p.t) - px, dy = toY(p.v) - py;
                const d = dx * dx + dy * dy;
                if (d < bestD) { bestD = d; best = i; }
            });
            return best;
        };
        let drag = null;  // dragged point object reference
        canvas.addEventListener('pointerdown', (e) => {
            if (e.button !== 0) return;
            const { px, py } = evtPos(e);
            const hit = nearest(px, py);
            if (hit >= 0) {
                drag = pts[hit];
            } else {
                drag = { t: fromX(px), v: fromY(py) };
                pts.push(drag);
            }
            canvas.setPointerCapture(e.pointerId);
            redraw();
        });
        canvas.addEventListener('pointermove', (e) => {
            if (!drag) return;
            const { px, py } = evtPos(e);
            drag.t = fromX(px);
            drag.v = fromY(py);
            redraw();
        });
        const endDrag = () => {
            if (!drag) return;
            drag = null;
            pts.sort((a, b) => a.t - b.t);
            redraw();
        };
        canvas.addEventListener('pointerup', endDrag);
        canvas.addEventListener('pointercancel', endDrag);
        canvas.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            const { px, py } = evtPos(e);
            const hit = nearest(px, py);
            if (hit >= 0) { pts.splice(hit, 1); redraw(); }
        });

        bnInput.addEventListener('change', () => {
            const v = Number(bnInput.value);
            curBn = Number.isFinite(v) ? Math.max(0, Math.min(3, v)) : 0;
            // Keep the curve consistent with the Peak input: rescale to the new
            // peak (preserves shape), or clear it — when Peak is 0 (= no bend),
            // or when the curve is empty/all-zero so it can't carry the peak
            // (else OK would derive bn=0 and silently discard the Peak edit).
            pts = curBn > 0 ? (rescaleBendCurveToPeak(pts, curBn) || []) : [];
            bnInput.value = String(curBn);
            redraw();
        });
        btSelect.addEventListener('change', () => { curBt = Number(btSelect.value) || 0; });
        inner.querySelector('#bend-preset').onclick = () => {
            pts = bendPresetCurve(curBt, curBn || 1, sustain).map(p => ({ t: p.t, v: p.v }));
            redraw();
        };
        inner.querySelector('#bend-clear').onclick = () => { pts = []; redraw(); };
        inner.querySelector('#bend-cancel').onclick = () => done(null);
        inner.querySelector('#bend-ok').onclick = () => {
            const cleanBnv = sanitizeBendCurve(pts);
            // `bn` is the PEAK; when a curve exists it MUST equal the curve's
            // peak (renderers/graders treat bnv as authoritative). Reconcile so
            // a saved `bn` can never contradict `bnv`.
            const finalBn = (cleanBnv && cleanBnv.length)
                ? Math.max(0, ...cleanBnv.map(p => p.v))
                : curBn;
            done({ bn: finalBn, bt: curBt, bnv: cleanBnv });
        };

        _installModalKeyboard(modal, inner, () => done(null));
        bnInput.focus();
    });
}

// Parse a `prompt()` fret input strictly: a plain decimal integer
// (optionally signed). Anything else (`0x10`, `12abc`, `--3`, `1.5`)
// falls back to `-1`, which the slide setters treat as "no slide".
// Using a regex rather than raw `parseInt` because `parseInt('12abc')`
// silently returns `12` and `parseInt('0x10', 10)` silently returns
// `0`, both of which would be surprising fret values for the user.
function _parseFretInput(val) {
    if (val === null || val === undefined) return -1;
    const m = String(val).trim().match(/^[-+]?\d+$/);
    if (!m) return -1;
    const n = Number(m[0]);
    return Number.isFinite(n) ? n : -1;
}

async function promptSlide(idx) {
    hideContextMenu();
    // Read-only roll (V4): slide authoring mutates n.techniques directly
    // (it bypasses EditHistory), so the exec lock can't catch it — guard
    // the entry point like every other note-edit path in the roll.
    if (_rollReadOnly()) { _rollLockNotice(); return; }
    const n = notes()[idx];
    const techs = n.techniques || {};
    const current = techs.slide_to >= 0 ? techs.slide_to : '';
    const val = await _editorPromptText({
        title: 'Slide', label: 'Slide to fret (-1 or empty = no slide)',
        value: String(current),
    });
    if (val === null) return;
    if (!n.techniques) n.techniques = {};
    const fret = _parseFretInput(val);
    n.techniques.slide_to = fret < 0 ? -1 : Math.min(24, fret);
    draw();
    _renderInspector();
}

async function promptSlideUnpitch(idx) {
    hideContextMenu();
    // Read-only roll (V4): direct n.techniques mutation — guard like promptSlide.
    if (_rollReadOnly()) { _rollLockNotice(); return; }
    const n = notes()[idx];
    const techs = n.techniques || {};
    const current = techs.slide_unpitch_to >= 0 ? techs.slide_unpitch_to : '';
    const val = await _editorPromptText({
        title: 'Unpitched Slide',
        label: 'Slide unpitched to fret (-1 or empty = no slide)',
        value: String(current),
    });
    if (val === null) return;
    if (!n.techniques) n.techniques = {};
    const fret = _parseFretInput(val);
    n.techniques.slide_unpitch_to = fret < 0 ? -1 : Math.min(24, fret);
    draw();
    _renderInspector();
}

// ════════════════════════════════════════════════════════════════════
// Add note dialog
// ════════════════════════════════════════════════════════════════════

let addNoteData = null;

function showAddNote(cx, cy, time, string, fret) {
    const isKeys = isKeysMode();
    addNoteData = { time, string, fret, isKeys };
    const dlg = document.getElementById('editor-add-note-dialog');
    dlg.style.left = cx + 'px';
    dlg.style.top = cy + 'px';
    dlg.classList.remove('hidden');

    document.getElementById('editor-add-fret-col').classList.toggle('hidden', isKeys);
    document.getElementById('editor-add-pitch-col').classList.toggle('hidden', !isKeys);

    if (isKeys) {
        const midi = noteToMidi(string, fret);
        document.getElementById('editor-add-pitch-label').textContent = midiToNote(midi);
        const sus = document.getElementById('editor-add-sustain');
        sus.focus();
        sus.select();
    } else {
        const inp = document.getElementById('editor-add-fret');
        inp.value = fret != null ? String(fret) : '0';
        inp.focus();
        inp.select();
    }
}

function hideAddNote() {
    document.getElementById('editor-add-note-dialog').classList.add('hidden');
    addNoteData = null;
}

window.editorConfirmAddNote = function() {
    if (!addNoteData) return;
    const fret = addNoteData.isKeys
        ? addNoteData.fret
        : Math.max(0, Math.min(24, parseInt(document.getElementById('editor-add-fret').value) || 0));
    const sustain = Math.max(0, parseFloat(document.getElementById('editor-add-sustain').value) || 0);
    const note = {
        time: addNoteData.time,
        string: addNoteData.string,
        fret,
        sustain,
        techniques: {},
    };
    S.history.exec(new AddNoteCmd(note));
    _editBlipAt();
    hideAddNote();
    draw();
    updateStatus();
};

window.editorHideAddNote = hideAddNote;

/* @pure:boot-teardown:start */
// Tracked registry for document/window-level listeners. The host can
// re-inject the editor screen; globals registered by a previous injection
// would otherwise STACK (double keystrokes, orphaned handlers, leaks)
// because they outlive the replaced DOM. Each boot tears down the previous
// injection's registrations before adding its own — safe under both host
// behaviors (no re-injection ⇒ teardown never runs).
function _makeListenerRegistry() {
    const items = [];
    return {
        add(target, type, fn, opts) {
            target.addEventListener(type, fn, opts);
            items.push({ target, type, fn, opts });
            return fn;
        },
        removeAll() {
            for (const l of items) {
                try { l.target.removeEventListener(l.type, l.fn, l.opts); } catch (_) {}
            }
            items.length = 0;
        },
        count() { return items.length; },
    };
}
/* @pure:boot-teardown:end */

// Tear down the PREVIOUS injection (if any) before this one registers its
// own globals, then publish this injection's teardown for the next one.
if (typeof window.__editorScreenTeardown === 'function') {
    try { window.__editorScreenTeardown(); } catch (_) {}
}
const _globalListeners = _makeListenerRegistry();
let _editorScreenObs = null;
// Handle for the pre-canvas boot poller (setInterval below) so the teardown
// can stop a late-firing interval from re-running a torn-down injection.
let _bootPollInterval = null;
window.__editorScreenTeardown = () => {
    _globalListeners.removeAll();
    // Stop any playback this injection owns — the audio graph outlives the
    // DOM, so a replaced screen would otherwise keep sounding.
    try { if (S.audioSource) { S.audioSource.stop(); S.audioSource = null; } } catch (_) {}
    try { if (rafId) { cancelAnimationFrame(rafId); rafId = null; } } catch (_) {}
    try { if (_editorScreenObs) { _editorScreenObs.disconnect(); _editorScreenObs = null; } } catch (_) {}
    try { if (_v3TopbarWatch) { _v3TopbarWatch.disconnect(); _v3TopbarWatch = null; } } catch (_) {}
    // The v3 layout ResizeObserver watches #v3-topbar, a shell-persistent node
    // that survives re-injection — without this disconnect it (and its fit()
    // closure) would stack one per re-inject.
    try { if (_v3LayoutObs) { _v3LayoutObs.disconnect(); _v3LayoutObs = null; } } catch (_) {}
    // Stop the pre-canvas boot poller if it's still spinning.
    try { if (_bootPollInterval) { clearInterval(_bootPollInterval); _bootPollInterval = null; } } catch (_) {}
    // Cancel #98's pending coalesced repaint if that PR is present (no-op when
    // it isn't) — mirrors the codebase's typeof-guarded optional-hook pattern.
    if (typeof _cancelPendingDraw === 'function') { try { _cancelPendingDraw(); } catch (_) {} }
};

// Handle Enter key in add-note dialog
_globalListeners.add(document, 'keydown', (e) => {
    if (e.key === 'Enter' && addNoteData) {
        e.preventDefault();
        window.editorConfirmAddNote();
    }
    if (e.key === 'Escape') {
        hideAddNote();
        hideContextMenu();
        window.editorHideLoadModal();
    }
});

// ════════════════════════════════════════════════════════════════════
// Audio / Playback
// ════════════════════════════════════════════════════════════════════

// Lazily create the shared AudioContext. Compose mode never decodes a
// recording (loadAudio is the only other creation site), yet the transport
// clock + metronome/guide voices still need a context to schedule on — make
// one on demand. Call from a user gesture (decode / play) so the browser does
// not hand back a permanently-suspended context.
function _ensureAudioCtx() {
    if (!S.audioCtx) {
        const Ctor = window.AudioContext || window.webkitAudioContext;
        if (!Ctor) return null;            // no Web Audio — leave S.audioCtx unset so callers bail
        S.audioCtx = new Ctor();
    }
    return S.audioCtx;
}

async function loadAudio(url) {
    if (!url) return;
    try {
        _ensureAudioCtx();
        const resp = await fetch(url);
        const buf = await resp.arrayBuffer();
        S.audioBuffer = await S.audioCtx.decodeAudioData(buf);
        S.duration = S.audioBuffer.duration;
        // A new recording is loaded — re-arm the hearing-safety fade so it
        // applies to this recording too, not just the session's first one.
        _mixResetFirstPlay();
        _editorApplyScrollBounds();
        computeWaveform();
    } catch (e) {
        console.error('Audio load error:', e);
    }
}

// Build a high-resolution min / max / RMS cache from one channel of PCM so
// the waveform can render its true (asymmetric) shape and stay sharp when
// zoomed in: `min`/`max` are the signed sample extremes per bin (the peak
// envelope), `rms` is the per-bin loudness (the body). Pure — channel data
// in, typed arrays out — so it's unit-testable. `bins` is the entry count.
function _buildWaveformPeaks(data, binSamples) {
    const bins = Math.max(1, Math.floor(data.length / binSamples));
    const min = new Float32Array(bins);
    const max = new Float32Array(bins);
    const rms = new Float32Array(bins);
    for (let b = 0; b < bins; b++) {
        const start = b * binSamples;
        // The last bin soaks up any remainder so no tail samples are dropped.
        const end = (b === bins - 1) ? data.length : start + binSamples;
        let lo = Infinity, hi = -Infinity, sumSq = 0, cnt = 0;
        for (let s = start; s < end; s++) {
            const v = data[s];
            if (v < lo) lo = v;
            if (v > hi) hi = v;
            sumSq += v * v;
            cnt++;
        }
        min[b] = cnt ? lo : 0;
        max[b] = cnt ? hi : 0;
        rms[b] = cnt ? Math.sqrt(sumSq / cnt) : 0;
    }
    return { min, max, rms, bins };
}

function computeWaveform() {
    if (!S.audioBuffer) return;
    const data = S.audioBuffer.getChannelData(0);
    // ~3 ms per bin: fine enough that each pixel covers ≥1 bin even at high
    // zoom, yet bounded (≈1 MB of typed arrays for a 5-minute song).
    const binSamples = Math.max(64, Math.round(S.audioBuffer.sampleRate * 0.003));
    S.waveformPeaks = _buildWaveformPeaks(data, binSamples);
    // New audio ⇒ any cached onset analysis is stale.
    _onsetCache = null;
}

/* @pure:onset-strip:start */
// Transient/onset estimation from the waveform RMS cache — a cheap
// client-side "where do events probably live" hint (no server round-trip,
// no DSP deps). An onset fires where the RMS rises sharply above the local
// baseline (the mean of the preceding window), gated by an absolute noise
// floor and a refractory gap so one attack registers once. Returns
// [{t, s}] — time in seconds and a 0..1 strength.
function _onsetTimesFromPeaksPure(rms, binSec, opts) {
    if (!rms || !rms.length || !(binSec > 0)) return [];
    const o = opts || {};
    const baselineBins = Math.max(2, o.baselineBins || 16);
    const ratio = o.ratio || 1.5;
    const floorFrac = o.floorFrac || 0.05;
    const riseFrac = o.riseFrac || 0.03;
    const minGapSec = o.minGapSec || 0.05;
    let global = 0;
    for (let i = 0; i < rms.length; i++) if (rms[i] > global) global = rms[i];
    if (!(global > 0)) return [];
    const floor = global * floorFrac;
    const refractory = Math.max(1, Math.round(minGapSec / binSec));
    const out = [];
    let sum = 0;
    for (let i = 0; i < Math.min(baselineBins, rms.length); i++) sum += rms[i];
    let lastOnset = -Infinity;
    for (let i = baselineBins; i < rms.length; i++) {
        const base = sum / baselineBins;
        const v = rms[i];
        if (v > floor && v > rms[i - 1]
                && v > base * ratio && v - base > global * riseFrac
                && i - lastOnset >= refractory) {
            out.push({
                t: i * binSec,
                s: Math.max(0, Math.min(1, (v - base) / global)),
            });
            lastOnset = i;
        }
        // Slide the baseline window.
        sum += v - rms[i - baselineBins];
    }
    return out;
}
/* @pure:onset-strip:end */

/* @pure:onset-snap:start */
// Nearest-onset snap: given time-sorted onsets [{t,...}], return the onset
// time nearest to `t` when it lies within `tol` seconds, else null (the caller
// falls back to grid snap). Binary-searches the sorted onsets so the hot drag
// path stays O(log n). Guards non-finite t, empty onsets, and tol <= 0.
function _nearestOnsetTimePure(onsets, t, tol) {
    if (!Array.isArray(onsets) || onsets.length === 0) return null;
    if (!Number.isFinite(t) || !(tol > 0)) return null;
    // First onset with .t >= t.
    let lo = 0, hi = onsets.length;
    while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (onsets[mid].t < t) lo = mid + 1; else hi = mid;
    }
    // The nearest onset is one of onsets[lo-1] (last before t) / onsets[lo].
    let best = null, bestD = Infinity;
    for (let i = lo - 1; i <= lo; i++) {
        if (i < 0 || i >= onsets.length) continue;
        const o = onsets[i];
        if (!o || !Number.isFinite(o.t)) continue;
        const d = Math.abs(o.t - t);
        if (d < bestD) { bestD = d; best = o.t; }
    }
    return bestD <= tol ? best : null;
}
/* @pure:onset-snap:end */

// ── Onset strip toggle + lazy cache ──────────────────────────────────
let _onsetCache = null;   // [{t, s}] for the CURRENT waveformPeaks
let _onsetStripOn = null; // cached enabled flag; null until first read

function _onsetStripEnabled() {
    // Cache the flag so the draw path (every frame during playback) doesn't
    // hit localStorage synchronously. Seeded once from storage, then kept in
    // sync by _editorToggleOnsetStrip.
    if (_onsetStripOn === null) {
        try { _onsetStripOn = localStorage.getItem('editorOnsetStrip') === '1'; }
        catch (_) { _onsetStripOn = false; }
    }
    return _onsetStripOn;
}

function _ensureOnsets() {
    if (_onsetCache) return _onsetCache;
    const pk = S.waveformPeaks;
    const dur = S.duration || 0;
    if (!pk || !pk.bins || !pk.rms || dur <= 0) return null;
    _onsetCache = _onsetTimesFromPeaksPure(pk.rms, dur / pk.bins);
    return _onsetCache;
}

function _refreshOnsetBtn() {
    const btn = document.getElementById('editor-onset-btn');
    if (!btn) return;
    const on = _onsetStripEnabled();
    btn.classList.toggle('bg-accent', on);
    btn.classList.toggle('hover:bg-accent-light', on);
    btn.classList.toggle('bg-dark-600', !on);
    btn.classList.toggle('hover:bg-dark-500', !on);
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
}

function _editorToggleOnsetStrip() {
    const next = !_onsetStripEnabled();
    _onsetStripOn = next;
    try { localStorage.setItem('editorOnsetStrip', next ? '1' : '0'); } catch (_) {}
    _refreshOnsetBtn();
    draw();
    setStatus(next
        ? 'Onset strip on — amber blocks mark detected attacks in the recording (display only)'
        : 'Onset strip off');
    return true;
}
window.editorToggleOnsetStrip = _editorToggleOnsetStrip;
_refreshOnsetBtn();

// ── Snap target: grid ↔ audio onset ──────────────────────────────────
function _refreshSnapModeBtn() {
    const btn = document.getElementById('editor-snapmode-btn');
    if (!btn) return;
    const onset = S.snapMode === 'onset';
    btn.textContent = onset ? 'Onset' : 'Grid';
    btn.classList.toggle('bg-accent', onset);
    btn.classList.toggle('hover:bg-accent-light', onset);
    btn.classList.toggle('bg-dark-600', !onset);
    btn.classList.toggle('hover:bg-dark-500', !onset);
    btn.setAttribute('aria-pressed', onset ? 'true' : 'false');
}

function _editorToggleSnapMode() {
    S.snapMode = S.snapMode === 'onset' ? 'grid' : 'onset';
    try { localStorage.setItem('editorSnapMode', S.snapMode); } catch (_) {}
    _refreshSnapModeBtn();
    if (S.snapMode === 'onset') {
        const onsets = _ensureOnsets();
        setStatus(onsets && onsets.length
            ? 'Snap to onset — placement snaps to the nearest detected attack (falls back to grid when none is near)'
            : 'Snap to onset — no transients detected yet (load a recording, turn on Onsets); snapping to grid until then');
    } else {
        setStatus('Snap to grid — placement snaps to the tempo-map subdivisions');
    }
    return true;
}
window.editorToggleSnapMode = _editorToggleSnapMode;

// Seed the snap target from the persisted editor pref (grid by default).
try {
    if (localStorage.getItem('editorSnapMode') === 'onset') S.snapMode = 'onset';
} catch (_) {}
_refreshSnapModeBtn();

function _startAudioSourceAtCursor() {
    S.audioSource = S.audioCtx.createBufferSource();
    S.audioSource.buffer = S.audioBuffer;
    // Reference recording stays on a transparent path to destination — its
    // mixer fader is a plain gain (unity by default): the guide-clap limiter
    // must never color the recording, even when claps are off. Only the
    // guide/click voices sum through the limiter (see _ensureMasterBus).
    const refGain = _ensureRefGain();
    if (refGain) S.audioSource.connect(refGain);
    else S.audioSource.connect(S.audioCtx.destination);
    _mixApplyFirstPlayFade();
    S.audioSource.start(0, S.cursorTime);
    _anchorTransportAtCursor();
}

// Anchor the transport clock at the current cursor: pin wall-time to the
// AudioContext clock and chart-time to cursorTime, so playbackTick can derive
// the cursor from the ctx clock. In buffered mode this rides alongside the
// BufferSource; in compose mode it IS the whole clock (there is no source).
// Every (re)start is a seek from the clap scheduler's perspective, so drop
// already-queued voices and restart the window at the new cursor — otherwise
// claps scheduled before a loop wrap / seek fire at their old positions
// ("ghost claps").
function _anchorTransportAtCursor() {
    S.playStartWall = S.audioCtx.currentTime;
    S.playStartTime = S.cursorTime;
    _guideResetSchedule();
}

// Resolve compose-mode duration from live state: the grid end via the A1
// converter (timeOf of the last beat), the last authored event on the active
// surface, and an optional user-set length (S.composeLength). Buffered mode
// never calls this — there S.duration is the recording's own length.
function _composeSongDuration() {
    const userLen = (typeof S.composeLength === 'number') ? S.composeLength : NaN;
    const gridEnd = (S.beats && S.beats.length >= 2)
        ? timeOf(S.beats, S.beats.length - 1)
        : 0;
    let contentEnd = 0;
    for (const t of _guideSourceTimes()) if (t > contentEnd) contentEnd = t;
    return _composeSongDurationPure(gridEnd, contentEnd, userLen);
}

function _restartPlaybackAt(t) {
    if (S.audioSource) {
        try { S.audioSource.stop(); } catch (_) {}
        S.audioSource = null;
    }
    S.cursorTime = Math.max(0, Math.min(S.duration || Infinity, t));
    // Compose mode re-anchors the clock without a BufferSource — the guide/
    // click scheduler is the only sound (charrette §1.7).
    if (S.audioBuffer) _startAudioSourceAtCursor();
    else _anchorTransportAtCursor();
}

function startPlayback() {
    // Compose mode (no recording) still needs a context — for the transport
    // clock and the metronome/guide voices that are its only sound. Make one
    // on the play gesture; the decode path is the only other creation site.
    _ensureAudioCtx();
    if (!S.audioCtx) return;                        // no Web Audio available at all
    const composing = !S.audioBuffer;
    if (composing) {
        // No buffer to bound the song: the grid defines its length (§1.7).
        S.duration = _composeSongDuration();
        if (!(S.duration > 0)) return;              // empty grid + no content — nothing to play
    }
    if (S.audioCtx.state === 'suspended') S.audioCtx.resume();
    const region = _selectedLoopRegion();
    if (S.loopEnabled && region && (S.cursorTime < region.startTime || S.cursorTime >= region.endTime)) {
        S.cursorTime = region.startTime;
    }
    if (composing) {
        // No reference recording ⇒ no A/B pass to arm; just anchor the clock so
        // playbackTick advances the cursor and the guide/click scheduler (the
        // only sound here) fires off the grid.
        _anchorTransportAtCursor();
    } else {
        // Every (re)start — including seeks, which route through here — begins
        // an A/B cycle on the RECORDING pass, so the user always hears the real
        // thing first from a fresh position. Reset BEFORE the first tick /
        // scheduler sync so _guideTick can never schedule a guide pass off a
        // stale phase, and so the first-play fade (in _startAudioSourceAtCursor)
        // is the last automation written to the ref gain, not clobbered by this.
        _abPhase = 'recording';
        _abApplyRefGain();
        _startAudioSourceAtCursor();
    }
    S.playing = true;
    updatePlayIcon();
    playbackTick();
    _guideTimerSync();
}
function stopPlayback() {
    if (S.audioSource) {
        try { S.audioSource.stop(); } catch (_) {}
        S.audioSource = null;
    }
    S.playing = false;
    updatePlayIcon();
    if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
    _guideTimerSync();
    _guideCancelVoices();
    // Restore the reference to its fader level (a stop mid-guide-pass must
    // never leave the recording silently muted).
    _abApplyRefGain();
}

function playbackTick() {
    if (!S.playing) return;
    S.cursorTime = _transportChartTimePure(S.playStartTime, S.playStartWall, S.audioCtx.currentTime);
    const loopRestart = _recState === 'recording'
        ? null
        : _loopPlaybackRestartTimePure(S.cursorTime, S.barSel, S.loopEnabled, S.duration);
    if (loopRestart !== null) {
        // A/B compare flips its pass BEFORE the restart so the ramped
        // reference mute/unmute lands with the wrap, not a frame late.
        _abOnLoopWrap();
        _restartPlaybackAt(loopRestart);
        updateTimeDisplay();
        // playbackTick already runs once per animation frame — paint
        // synchronously rather than queueing a second rAF via draw().
        drawNow();
        rafId = requestAnimationFrame(playbackTick);
        return;
    }
    if (S.cursorTime >= S.duration) {
        // If a live MIDI recording is active, finalize it at the song end
        // before resetting the cursor — otherwise chartTimeNow() keeps
        // advancing past S.duration and emits notes beyond the chart.
        if (_recState === 'recording') {
            window.editorStopRecordMidi();
        } else {
            stopPlayback();
        }
        S.cursorTime = 0;
        updateTimeDisplay(); // reflect the reset immediately before returning
        drawNow();
        return; // stopPlayback() already cancelled rafId; don't re-schedule.
    }

    // Auto-scroll to follow the playhead — unless follow is toggled off
    // (Shift+L), which lets an author inspect/edit one spot while the
    // song plays on.
    {
        const cx = timeToX(S.cursorTime);
        const w = canvas ? canvas.width / DPR : 800;
        const target = _followScrollTargetPure(
            S.cursorTime, cx, w, S.zoom, editorFollowEnabled());
        if (target !== null) S.scrollX = _editorClampScrollX(target);
    }

    updateTimeDisplay();
    drawNow();
    rafId = requestAnimationFrame(playbackTick);
}

/* @pure:follow-scroll:start */
// Follow-playhead scroll policy: once the cursor crosses 80% of the view,
// jump the window so the cursor sits at 30% — but only when follow is on.
// Returns the UNCLAMPED scrollX target, or null for "don't move".
function _followScrollTargetPure(cursorTime, cursorX, viewW, zoom, followOn) {
    if (!followOn) return null;
    if (!(cursorX > viewW * 0.8)) return null;
    return cursorTime - (viewW * 0.3) / zoom;
}
/* @pure:follow-scroll:end */

function editorFollowEnabled() {
    // Default ON — follow is today's behavior; the pref only records an
    // explicit opt-out.
    try { return localStorage.getItem('editorFollow') !== '0'; }
    catch (_) { return true; }
}

function _editorToggleFollow() {
    const next = !editorFollowEnabled();
    try { localStorage.setItem('editorFollow', next ? '1' : '0'); } catch (_) {}
    setStatus(next
        ? 'Follow on — the view tracks the playhead during playback (Shift+L)'
        : 'Follow off — the view stays put while the song plays (Shift+L)');
    return true;
}

function updatePlayIcon() {
    const icon = document.getElementById('editor-play-icon');
    if (!icon) return;
    if (S.playing) {
        icon.innerHTML = '<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>';
    } else {
        icon.innerHTML = '<path d="M8 5v14l11-7z"/>';
    }
}

// ════════════════════════════════════════════════════════════════════
// Guide claps — a percussive tick per charted event during playback, so
// authors can verify note placement by ear (charting-by-ear was silent:
// the editor had zero note sonification). Claps are scheduled by a
// setInterval lookahead loop — NOT the rAF draw loop — so audio timing
// stays sample-accurate even when draw() is saturated, and every voice
// sums through a limited master bus (hearing safety).
// ════════════════════════════════════════════════════════════════════

/* @pure:guide-clap:start */
// Half-open window query over a SORTED event-time array: returns the times t
// with from <= t < to, deduplicated at 1 ms resolution so a chord stack
// (several notes at one timestamp) claps once instead of N voices stacking
// into a louder transient.
function _guideClapTimesInWindowPure(times, from, to) {
    if (!Array.isArray(times) || !times.length || !(to > from)) return [];
    // Binary search for the first index with times[i] >= from.
    let lo = 0, hi = times.length;
    while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (times[mid] < from) lo = mid + 1; else hi = mid;
    }
    const out = [];
    let lastKey = null;
    for (let i = lo; i < times.length && times[i] < to; i++) {
        const key = Math.round(times[i] * 1000);
        if (key === lastKey) continue;
        lastKey = key;
        out.push(times[i]);
    }
    return out;
}
// Map chart-seconds onto the AudioContext clock via the transport anchor
// (_startAudioSourceAtCursor records wall/chart time as the audio starts).
function _guideChartToCtxPure(chartT, playStartWall, playStartTime) {
    return playStartWall + (chartT - playStartTime);
}
// Sanitize a raw event-time array before the window query, matching every
// other time-array consumer in this file (_editorJumpNote / -Beat / -Anchor):
// drop non-finite entries — a stray NaN/undefined time would reach
// osc.start(NaN) and throw inside the tick, killing clap scheduling — and
// sort ascending, which the early-terminating window scan relies on.
function _guideSanitizeTimesPure(times) {
    if (!Array.isArray(times)) return [];
    return times.filter(Number.isFinite).sort((a, b) => a - b);
}
// Clamp the lookahead window end to the loop-region end so no clap is
// scheduled past the boundary: the 120 ms lookahead can queue voices for
// events after the loop end before the rAF-detected wrap cancels them
// ("ghost claps" past the loop). No-op when looping is off.
function _guideWindowEndPure(rawTo, loopEnabled, loopEndTime) {
    if (loopEnabled && Number.isFinite(loopEndTime)) return Math.min(rawTo, loopEndTime);
    return rawTo;
}
// Metronome clicks for the beat rows in [from, to): every beat entry gets a
// click, downbeats (measure > 0) get the accent; sub-beats are measure -1.
// Same half-open window contract as the clap query so the shared scheduler
// never double-fires a beat across adjacent ticks.
function _metroClicksInWindowPure(beats, from, to) {
    if (!Array.isArray(beats) || !beats.length || !(to > from)) return [];
    let lo = 0, hi = beats.length;
    while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (beats[mid].time < from) lo = mid + 1; else hi = mid;
    }
    const out = [];
    for (let i = lo; i < beats.length && beats[i].time < to; i++) {
        out.push({ t: beats[i].time, accent: beats[i].measure > 0 });
    }
    return out;
}
/* @pure:guide-clap:end */

const GUIDE_LOOKAHEAD = 0.12;  // seconds scheduled ahead of the transport
const GUIDE_TICK_MS = 25;      // scheduler cadence
let _guideTimer = null;
let _guideScheduledUntil = 0;  // chart-seconds watermark (exclusive)
let _guideVoices = [];         // queued {osc, gain, until} for cancel-on-seek
let _guideLastFiredKey = null; // last-fired 1 ms bucket key, PERSISTED across
                               // ticks so a chord straddling a window boundary
                               // (same bucket, split by the 25 ms tick) can't
                               // double-fire — per-window dedupe alone resets.

function editorGuideClapEnabled() {
    try { return localStorage.getItem('editorGuideClap') === '1'; }
    catch (_) { return false; }
}
function editorMetronomeEnabled() {
    try { return localStorage.getItem('editorMetronome') === '1'; }
    catch (_) { return false; }
}

/* @pure:audio-mixer:start */
// Mixer math for the 3-fader popover (recording / guide / click) and the
// edit-preview blip gating. Fader percents live in editor prefs (never the
// pack) and map linearly onto bus gain, so 100% = the bus's design ceiling
// (unity) — nothing here can boost a bus past the shipped headroom.
const MIX_DEFAULT_PCT = Object.freeze({ ref: 100, guide: 35, click: 25 });
// Parse a stored fader percent: corrupted values clamp into [0, 100] and
// non-numeric ones fall back, so a bad pref can never blast a bus.
function _mixPctFromStoredPure(raw, fallbackPct) {
    const n = parseInt(raw, 10);
    if (!Number.isFinite(n)) return fallbackPct;
    return Math.max(0, Math.min(100, n));
}
function _mixGainForPctPure(pct) {
    const p = Number(pct);
    if (!Number.isFinite(p)) return 0;
    return Math.max(0, Math.min(100, p)) / 100;
}
// First play of a session starts the recording below target and ramps up
// (~0.35 s): an unexpectedly hot recording is reached, never jumped to.
// Quiet targets keep a small audible floor so the fade is never mistaken
// for a broken/silent load.
function _mixFirstPlayStartGainPure(target) {
    if (!(target > 0)) return 0;
    return Math.min(target, Math.max(0.05, target * 0.3));
}
// Rate-limit for the edit-preview blip: a group edit (set fret on N notes)
// must read as ONE cue, not a machine-gun transient.
function _mixBlipAllowedPure(nowMs, lastMs, gapMs) {
    if (!Number.isFinite(lastMs)) return true;
    return (nowMs - lastMs) >= gapMs;
}
// A committed drag only previews when it changed PITCH — any string delta
// (a note moved to another string sounds a different pitch) or any fret
// delta (a moved keys/piano-roll pitch, or a fret-changing drag). Time-only
// moves and marquee selects carry no string/fret delta, so they stay silent.
function _mixDragChangedPitchPure(dstrings, dfrets) {
    const ds = Array.isArray(dstrings) && dstrings.some(d => d !== 0);
    const df = Array.isArray(dfrets) && dfrets.some(d => d !== 0);
    return ds || df;
}
/* @pure:audio-mixer:end */

/* @pure:audio-bus:start */
// Guide-voice bus ONLY: the claps sum through their own gain into a limiter
// so many simultaneous voices can never spike, then to the destination. The
// reference recording deliberately does NOT pass through here — it stays on a
// transparent path straight to destination (see _startAudioSourceAtCursor) so
// the limiter never colors loud / brickwalled reference recordings, whether
// or not guide claps are ever used.
let _masterBus = null;
function _ensureMasterBus() {
    if (_masterBus || !S.audioCtx) return _masterBus;
    const ctx = S.audioCtx;
    const guideGain = ctx.createGain();
    guideGain.gain.value = _mixGainForPctPure(_mixLoadPct().guide);
    // Click sits well under the reference/guide by default (≈ -12 dB) — the
    // metronome should be felt, not fought with. Both levels come from the
    // mixer prefs; the defaults preserve the shipped balance.
    const clickGain = ctx.createGain();
    clickGain.gain.value = _mixGainForPctPure(_mixLoadPct().click);
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -1;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.25;
    guideGain.connect(limiter);
    clickGain.connect(limiter);
    limiter.connect(ctx.destination);
    _masterBus = { guideGain, clickGain, limiter };
    return _masterBus;
}

// Fader percents, cached so audio paths never read localStorage
// synchronously mid-schedule; seeded once, kept in sync by _mixSetBusGain.
let _mixPctCache = null;
function _mixLoadPct() {
    if (_mixPctCache) return _mixPctCache;
    let ref = null, guide = null, click = null;
    try {
        ref = localStorage.getItem('editorMixRef');
        guide = localStorage.getItem('editorMixGuide');
        click = localStorage.getItem('editorMixClick');
    } catch (_) {}
    _mixPctCache = {
        ref: _mixPctFromStoredPure(ref, MIX_DEFAULT_PCT.ref),
        guide: _mixPctFromStoredPure(guide, MIX_DEFAULT_PCT.guide),
        click: _mixPctFromStoredPure(click, MIX_DEFAULT_PCT.click),
    };
    return _mixPctCache;
}

// Recording volume node: a TRANSPARENT gain straight to destination — the
// reference still never sums through the guide limiter (see the bus comment
// above). This only adds user volume control; unity by default.
let _refGain = null;
function _ensureRefGain() {
    if (_refGain || !S.audioCtx) return _refGain;
    _refGain = S.audioCtx.createGain();
    _refGain.gain.value = _mixGainForPctPure(_mixLoadPct().ref);
    _refGain.connect(S.audioCtx.destination);
    return _refGain;
}

// First-play fade (hearing safety): once per loaded recording, the
// reference ramps from a reduced level up to its fader target as playback
// starts. Re-armed by _mixResetFirstPlay() on every new/replaced recording
// (see loadAudio()) — the ramp guards against an unexpectedly hot recording,
// so it must not go stale after the very first song of a session.
let _mixFirstPlayDone = false;
function _mixApplyFirstPlayFade() {
    if (_mixFirstPlayDone || !_refGain || !S.audioCtx) return;
    _mixFirstPlayDone = true;
    const target = _mixGainForPctPure(_mixLoadPct().ref);
    const now = S.audioCtx.currentTime;
    _refGain.gain.setValueAtTime(_mixFirstPlayStartGainPure(target), now);
    _refGain.gain.linearRampToValueAtTime(target, now + 0.35);
}

// Re-arm the first-play fade: called whenever a new reference recording is
// decoded (loadCDLC, create/import, and replace-audio all funnel through
// loadAudio()) so each new recording gets the hearing-safety ramp, not just
// the first one of the screen's lifetime.
function _mixResetFirstPlay() {
    _mixFirstPlayDone = false;
}

// Apply a fader move: persist the pref and ramp the live node (~20 ms
// smoothing) — a gain change is never a stepped jump mid-audio.
function _mixSetBusGain(bus, pct) {
    const key = bus === 'ref' ? 'editorMixRef'
        : bus === 'guide' ? 'editorMixGuide' : 'editorMixClick';
    const p = _mixPctFromStoredPure(String(pct), MIX_DEFAULT_PCT[bus]);
    _mixLoadPct()[bus] = p;
    try { localStorage.setItem(key, String(p)); } catch (_) {}
    const node = bus === 'ref' ? _refGain
        : bus === 'guide' ? (_masterBus && _masterBus.guideGain)
        : (_masterBus && _masterBus.clickGain);
    if (node && S.audioCtx) {
        // The recording fader must never un-mute an active A/B guide pass:
        // route ref moves through the A/B-aware target so a nudge ramps to
        // the fresh level on a recording pass but stays muted on a guide
        // pass. Guarded — the @pure:audio-bus test sandbox has no
        // _abApplyRefGain, where this falls back to the plain fader ramp.
        if (bus === 'ref' && typeof _abApplyRefGain === 'function') {
            _abApplyRefGain();
        } else {
            node.gain.setTargetAtTime(_mixGainForPctPure(p), S.audioCtx.currentTime, 0.02);
        }
    }
    return p;
}

function editorEditBlipEnabled() {
    try { return localStorage.getItem('editorEditBlip') !== '0'; }
    catch (_) { return true; }
}

// Edit-preview blip: a soft confirmation tick on note ADD and PITCH change
// only (never marquee/time-only moves). It sums straight into the shared
// limiter — NOT through the guide fader — so muting guide claps never also
// silences the edit cue, while the limiter still tames it. It skips when the
// context isn't running — an edit must never resume audio — and is pitched
// apart from the 1750 Hz guide clap so the two read as different cues.
let _mixLastBlipMs = null;
function _editBlipAt() {
    if (!editorEditBlipEnabled()) return;
    if (!S.audioCtx || S.audioCtx.state !== 'running') return;
    const bus = _ensureMasterBus();
    if (!bus) return;
    const nowMs = Date.now();
    if (!_mixBlipAllowedPure(nowMs, _mixLastBlipMs, 60)) return;
    _mixLastBlipMs = nowMs;
    const ctx = S.audioCtx;
    const when = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = 1320;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(0.5, when + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, when + 0.04);
    osc.connect(g);
    g.connect(bus.limiter);
    osc.start(when);
    osc.stop(when + 0.05);
    _guideVoices.push({ osc, gain: g, until: when + 0.05 });
    // Same bounded-bookkeeping rule as the scheduler tick.
    if (_guideVoices.length > 64) {
        const nowCtx = ctx.currentTime;
        _guideVoices = _guideVoices.filter(v => v.until > nowCtx);
    }
}

// Audition one pitch for the keyboard gutter (click a piano key → hear it).
// A gentle, hearing-safe voice through the master limiter (soft attack, ~0.28
// peak, ~320 ms decay) — the same envelope shape as the edit blip but pitched
// and a touch longer, so it reads as a note rather than a tick. No-op when the
// context isn't running (autoplay-gated) or the pitch is out of audible range.
function _auditionPitch(midi) {
    if (!S.audioCtx || S.audioCtx.state !== 'running') return;
    const freq = midiToFreq(midi);
    if (!(freq > 0) || freq > 20000) return;
    const bus = _ensureMasterBus();
    if (!bus) return;
    const ctx = S.audioCtx;
    const when = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(0.28, when + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, when + 0.32);
    osc.connect(g);
    g.connect(bus.limiter);
    osc.start(when);
    osc.stop(when + 0.34);
    _guideVoices.push({ osc, gain: g, until: when + 0.34 });
    if (_guideVoices.length > 64) {
        const nowCtx = ctx.currentTime;
        _guideVoices = _guideVoices.filter(v => v.until > nowCtx);
    }
}
/* @pure:audio-bus:end */

// Event times for the active editing surface: the drum grid claps drum hits,
// every other view claps the current arrangement's (time-sorted) notes.
function _guideSourceTimes() {
    if (S.drumEditMode) {
        const hits = (S.drumTab && Array.isArray(S.drumTab.hits)) ? S.drumTab.hits : [];
        return _guideSanitizeTimesPure(hits.map(h => h.t));
    }
    if (!S.arrangements.length) return [];
    return _guideSanitizeTimesPure(notes().map(n => n.time));
}

function _guideClapVoiceAt(when) {
    const bus = _ensureMasterBus();
    if (!bus) return;
    const ctx = S.audioCtx;
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = 1750;
    const g = ctx.createGain();
    // Soft tick: 3 ms ramp in (never a 0 ms transient) and ~45 ms exponential
    // decay — a locatable placement cue without startle.
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(0.8, when + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, when + 0.048);
    osc.connect(g);
    g.connect(bus.guideGain);
    osc.start(when);
    osc.stop(when + 0.06);
    _guideVoices.push({ osc, gain: g, until: when + 0.06 });
}

// Metronome click: a band-limited soft pip. The accent (downbeat) is
// differentiated mainly by PITCH (~1000 vs ~800 Hz) with only a small level
// delta — the hearing-safe way to accent, rather than a louder transient.
function _metroClickVoiceAt(when, accent) {
    const bus = _ensureMasterBus();
    if (!bus) return;
    const ctx = S.audioCtx;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = accent ? 1000 : 800;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(accent ? 0.9 : 0.68, when + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, when + 0.04);
    osc.connect(g);
    g.connect(bus.clickGain);
    osc.start(when);
    osc.stop(when + 0.05);
    _guideVoices.push({ osc, gain: g, until: when + 0.05 });
}

// Cancel every queued-but-unfinished clap — stale voices would otherwise
// fire at their pre-seek positions after a loop wrap or scrub.
function _guideCancelVoices() {
    for (const v of _guideVoices) {
        try { v.osc.stop(); } catch (_) {}
        try { v.gain.disconnect(); } catch (_) {}
    }
    _guideVoices = [];
}

function _guideResetSchedule() {
    _guideCancelVoices();
    _guideScheduledUntil = S.cursorTime || 0;
    _guideLastFiredKey = null;  // a seek/wrap breaks cross-tick dedupe continuity
}

function _guideTick() {
    // A/B overrides the claps pref while active: guide passes clap even
    // with the pref off; recording passes stay clean even with it on.
    const claps = _abClapsEnabledPure(_abActive(), _abPhase, editorGuideClapEnabled());
    const metro = editorMetronomeEnabled();
    if (!S.playing || !S.audioCtx || (!claps && !metro)) return;
    const nowChart = _transportChartTimePure(S.playStartTime, S.playStartWall, S.audioCtx.currentTime);
    // Clamp the lookahead end to the loop-region end while looping, so no clap
    // is scheduled past the boundary before the rAF wrap cancels the window.
    const loopRegion = S.loopEnabled ? _normalizeLoopRegionPure(S.barSel, S.duration) : null;
    const to = _guideWindowEndPure(
        nowChart + GUIDE_LOOKAHEAD, !!loopRegion, loopRegion ? loopRegion.endTime : NaN);
    // If the timer stalled (hidden tab), skip events that are already in the
    // past rather than machine-gunning them late; 5 ms of grace keeps an
    // event exactly at the cursor audible.
    const from = Math.max(_guideScheduledUntil, nowChart - 0.005);
    if (to <= from) return;
    if (claps) {
        const times = _guideClapTimesInWindowPure(_guideSourceTimes(), from, to);
        for (const t of times) {
            // Cross-tick dedupe: skip an event in the same 1 ms bucket as the last
            // clap already fired in a previous window (chord split by the boundary).
            const key = Math.round(t * 1000);
            if (key === _guideLastFiredKey) continue;
            _guideLastFiredKey = key;
            _guideClapVoiceAt(_guideChartToCtxPure(t, S.playStartWall, S.playStartTime));
        }
    }
    if (metro) {
        const clicks = _metroClicksInWindowPure(S.beats || [], from, to);
        for (const c of clicks) {
            _metroClickVoiceAt(
                _guideChartToCtxPure(c.t, S.playStartWall, S.playStartTime), c.accent);
        }
    }
    _guideScheduledUntil = to;
    // Drop bookkeeping for voices that already finished (bounded memory).
    if (_guideVoices.length > 64) {
        const nowCtx = S.audioCtx.currentTime;
        _guideVoices = _guideVoices.filter(v => v.until > nowCtx);
    }
}

// ── Loop A/B compare — the ear-training loop ─────────────────────────
// While looping, alternate each pass between the RECORDING (reference
// audible, claps off) and the GUIDE (reference muted via the mixer's
// transparent ref gain, claps on) so a charter can hear what they charted
// against what the artist played, one pass apart. Session-only state —
// deliberately not persisted: silently muting the recording on a later
// session would read as a playback bug.

/* @pure:loop-ab:start */
// Do claps schedule this tick? A/B overrides the claps pref while active:
// guide passes clap even with the pref off, recording passes stay clean
// even with it on.
function _abClapsEnabledPure(abActive, phase, clapsPref) {
    return abActive ? phase === 'guide' : clapsPref;
}
function _abNextPhasePure(phase) {
    return phase === 'guide' ? 'recording' : 'guide';
}
// The reference gain target: muted only during an ACTIVE A/B guide pass
// while playing; every other state restores the mixer fader's value.
function _abRefTargetPure(abActive, playing, phase, faderGain) {
    return (abActive && playing && phase === 'guide') ? 0 : faderGain;
}
/* @pure:loop-ab:end */

let _abOn = false;
let _abPhase = 'recording';   // every play starts by hearing the real thing

// A/B compares the recording against the guide — meaningless with no reference
// buffer (compose mode), where it would only gate half of each loop's claps to
// silence. Require a buffer so compose loops keep every clap.
function _abActive() { return _abOn && !!S.loopEnabled && !!S.audioBuffer; }

function _abApplyRefGain() {
    const rg = _ensureRefGain();
    if (!rg || !S.audioCtx) return;
    const target = _abRefTargetPure(
        _abActive(), !!S.playing, _abPhase,
        _mixGainForPctPure(_mixLoadPct().ref));
    // Same ~20 ms ramp as every mixer move — a phase flip is never a pop.
    rg.gain.setTargetAtTime(target, S.audioCtx.currentTime, 0.02);
}

function _abOnLoopWrap() {
    if (!_abActive()) return;
    _abPhase = _abNextPhasePure(_abPhase);
    _abApplyRefGain();
    setStatus(_abPhase === 'guide'
        ? 'A/B: guide pass (recording muted)'
        : 'A/B: recording pass');
}

function _refreshLoopABBtn() {
    const btn = document.getElementById('editor-loop-ab-btn');
    if (!btn) return;
    const region = _selectedLoopRegion();
    btn.disabled = !region;
    btn.classList.toggle('bg-accent', _abOn);
    btn.classList.toggle('hover:bg-accent-light', _abOn);
    btn.classList.toggle('bg-dark-600', !_abOn);
    btn.classList.toggle('hover:bg-dark-500', !_abOn);
    btn.setAttribute('aria-pressed', _abOn ? 'true' : 'false');
    btn.title = region
        ? 'A/B compare: each loop pass alternates — recording, then guide claps only (Alt+B)'
        : 'Set a loop region first — A/B alternates recording and guide per pass';
}

function _editorToggleLoopAB() {
    if (!_abOn && !_selectedLoopRegion()) {
        setStatus('Set a loop region first — A/B alternates recording and guide per pass');
        return true;
    }
    _abOn = !_abOn;
    _abPhase = 'recording';
    if (_abOn && !S.loopEnabled && _selectedLoopRegion()) {
        // A/B is meaningless without looping — arm the loop exactly like the
        // Loop button, including the seek into the region when the cursor
        // sits outside it, so A/B never rides a pre-loop stretch of audio.
        _setLoopRegionEnabled(true);
    }
    _abApplyRefGain();
    _refreshLoopABBtn();
    _guideTimerSync();   // guide passes need the scheduler even with claps off
    setStatus(_abOn
        ? 'Loop A/B on — first pass plays the recording, the next plays only the guide claps'
        : 'Loop A/B off');
    return true;
}
window.editorToggleLoopAB = _editorToggleLoopAB;

// Start/stop the scheduler to match "playing AND enabled". Called from
// startPlayback/stopPlayback and from the toggle (mid-play enable works).
function _guideTimerSync() {
    const want = S.playing
        && (editorGuideClapEnabled() || editorMetronomeEnabled() || _abActive());
    if (want && !_guideTimer) {
        _guideScheduledUntil = _transportChartTimePure(
            S.playStartTime, S.playStartWall, S.audioCtx.currentTime);
        _guideTimer = setInterval(_guideTick, GUIDE_TICK_MS);
        _guideTick(); // fill the first window now, not one tick late
    } else if (!want && _guideTimer) {
        clearInterval(_guideTimer);
        _guideTimer = null;
    }
}

function _refreshGuideBtn() {
    const btn = document.getElementById('editor-guide-btn');
    if (!btn) return;
    const on = editorGuideClapEnabled();
    btn.classList.toggle('bg-accent', on);
    btn.classList.toggle('hover:bg-accent-light', on);
    btn.classList.toggle('bg-dark-600', !on);
    btn.classList.toggle('hover:bg-dark-500', !on);
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
}

function _editorToggleGuideClap() {
    const next = !editorGuideClapEnabled();
    try { localStorage.setItem('editorGuideClap', next ? '1' : '0'); } catch (_) {}
    _refreshGuideBtn();
    _guideTimerSync();
    setStatus(next
        ? 'Guide claps on — charted notes tick during playback (C toggles)'
        : 'Guide claps off');
    return true;
}
window.editorToggleGuideClap = _editorToggleGuideClap;
_refreshGuideBtn();

function _refreshMetronomeBtn() {
    const btn = document.getElementById('editor-metronome-btn');
    if (!btn) return;
    const on = editorMetronomeEnabled();
    btn.classList.toggle('bg-accent', on);
    btn.classList.toggle('hover:bg-accent-light', on);
    btn.classList.toggle('bg-dark-600', !on);
    btn.classList.toggle('hover:bg-dark-500', !on);
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
}

function _editorToggleMetronome() {
    const next = !editorMetronomeEnabled();
    try { localStorage.setItem('editorMetronome', next ? '1' : '0'); } catch (_) {}
    _refreshMetronomeBtn();
    _guideTimerSync();
    setStatus(next
        ? 'Metronome on — clicks follow the beat grid, accented on downbeats'
        : 'Metronome off');
    return true;
}
window.editorToggleMetronome = _editorToggleMetronome;
_refreshMetronomeBtn();

// ── Audio mixer popover ──────────────────────────────────────────────
function _refreshMixerBtn() {
    const btn = document.getElementById('editor-mixer-btn');
    if (!btn) return;
    const panel = document.getElementById('editor-audio-mixer');
    const open = !!(panel && !panel.classList.contains('hidden'));
    btn.classList.toggle('bg-accent', open);
    btn.classList.toggle('hover:bg-accent-light', open);
    btn.classList.toggle('bg-dark-600', !open);
    btn.classList.toggle('hover:bg-dark-500', !open);
    btn.setAttribute('aria-pressed', open ? 'true' : 'false');
}

function _refreshMixerUI() {
    const pcts = _mixLoadPct();
    for (const [bus, id] of [['ref', 'editor-mix-ref'], ['guide', 'editor-mix-guide'], ['click', 'editor-mix-click']]) {
        const slider = document.getElementById(id);
        const label = document.getElementById(id + '-val');
        if (slider) slider.value = String(pcts[bus]);
        if (label) label.textContent = pcts[bus] + '%';
    }
    const blip = document.getElementById('editor-mix-blip');
    if (blip) blip.checked = editorEditBlipEnabled();
}

function _editorToggleMixer(force) {
    const panel = document.getElementById('editor-audio-mixer');
    if (!panel) return false;
    const show = force === undefined ? panel.classList.contains('hidden') : !!force;
    panel.classList.toggle('hidden', !show);
    if (show) _refreshMixerUI();
    _refreshMixerBtn();
    return true;
}
window.editorToggleMixer = _editorToggleMixer;

window.editorSetMixLevel = (bus, val) => {
    if (bus !== 'ref' && bus !== 'guide' && bus !== 'click') return;
    const p = _mixSetBusGain(bus, val);
    const label = document.getElementById(
        (bus === 'ref' ? 'editor-mix-ref' : bus === 'guide' ? 'editor-mix-guide' : 'editor-mix-click') + '-val');
    if (label) label.textContent = p + '%';
};

window.editorSetEditBlip = (on) => {
    try { localStorage.setItem('editorEditBlip', on ? '1' : '0'); } catch (_) {}
    setStatus(on
        ? 'Edit blip on — a soft tick confirms note adds and pitch changes'
        : 'Edit blip off');
};
_refreshMixerBtn();

function updateMeasureDisplay() {
    const el = document.getElementById('editor-measure-display');
    if (!el) return;
    const selectedIdx = S.tempoMapMode ? S.tempoSel : -1;
    const r = _editorMeasureSignatureReadoutPure(S.beats || [], S.cursorTime || 0, selectedIdx);
    el.textContent = r.label;
    el.title = r.measure === null
        ? 'No measure grid available'
        : `Measure ${r.measure}, time signature ${r.numerator}/${r.denominator}`;
}

// Read-only chord readout at the playhead (DAW 4.17): the pitch classes of the
// notes sounding at S.cursorTime, identified into a chord name when they form a
// recognised one. Fretted parts resolve to sounding pitch (capo/tuning-aware),
// keys parts use their packed pitch. Blank when nothing sounds; "—" when notes
// sound but form no named chord. Never edits anything.
// Cross-frame memo. updateTimeDisplay() (hence this) runs on every playback
// requestAnimationFrame, but the chord only changes when the playhead crosses a
// note boundary — never between them. Recomputing the O(N) sounding-set scan
// per frame is the same per-frame O(N) trap the section-coverage strip avoids,
// so cache the readout plus the [lo,hi) interval it holds over (from
// _soundingIntervalPure) and skip the scan while the cursor stays inside it and
// nothing relevant changed (see _chordCacheHitPure). Edits bump
// the shared edit generation `editGen` (via EditHistory._afterEdit);
// a song load/replace installs a fresh notes array WITHOUT a gen bump (caught by
// the notes-array identity check); and a live note drag (move OR sustain
// resize) mutates notes in place without a gen bump, so any active drag rescans.
let _chordCache = { gen: -1, arr: -1, notesRef: null, lo: NaN, hi: NaN, text: '', title: '' };
function updateChordDisplay() {
    const el = document.getElementById('editor-chord-display');
    if (!el) return;
    const eligible = !!(S.arrangements && S.arrangements.length
        && !S.drumEditMode && !S.tempoMapMode);
    const t = S.cursorTime || 0;
    const gen = typeof editGen === 'number' ? editGen : 0;
    const ns = eligible ? notes() : null;
    // Any in-place note-mutating drag (move retimes, resize re-sustains) skips
    // the cache — neither bumps the edit generation until mouseUp commits.
    const dragging = !!S.drag;
    let text = '';
    let title = 'Chord at the playhead';
    if (eligible) {
        if (_chordCacheHitPure(_chordCache, { gen, arr: S.currentArr, notesRef: ns, t, dragging })) {
            text = _chordCache.text;
            title = _chordCache.title;
        } else {
            const rctx = typeof _rollPitchCtx === 'function' ? _rollPitchCtx() : null;
            const sounding = _notesSoundingAtPure(ns, t, 0.05, 0.03);
            const midis = [];
            for (const n of sounding) {
                const m = _rollMidiForNote(n, rctx);
                if (Number.isFinite(m)) midis.push(m);
            }
            if (midis.length) {
                const pcs = _pcSetFromMidisPure(midis);
                const bassPc = ((Math.round(Math.min(...midis)) % 12) + 12) % 12;
                const chord = _identifyChordPure(pcs, bassPc, PIANO_NOTE_NAMES);
                if (chord) {
                    text = chord.name;
                    title = `${midis.length} note${midis.length === 1 ? '' : 's'} sounding → ${chord.name}`;
                } else {
                    text = '—';
                    title = `${midis.length} notes sounding (no named chord)`;
                }
            }
            // Cache the readout and the interval it holds over. A live drag's
            // in-place note edits aren't reflected in `gen`, so don't cache them
            // — the next frame must rescan while the drag continues.
            if (!dragging) {
                const iv = _soundingIntervalPure(ns, t, 0.05, 0.03);
                _chordCache = { gen, arr: S.currentArr, notesRef: ns, lo: iv.lo, hi: iv.hi, text, title };
            }
        }
    }
    // Skip the DOM write when unchanged — avoids per-frame layout/title churn.
    if (el.textContent !== text) el.textContent = text;
    if (el.title !== title) el.title = title;
}
function updateTimeDisplay() {
    const el = document.getElementById('editor-time-display');
    if (!el) return;
    const fmt = (t) => {
        const m = Math.floor(t / 60);
        const s = Math.floor(t % 60);
        return m + ':' + String(s).padStart(2, '0');
    };
    el.textContent = fmt(S.cursorTime) + ' / ' + fmt(S.duration);
    updateMeasureDisplay();
    updateChordDisplay();
}

// ════════════════════════════════════════════════════════════════════
// File operations
// ════════════════════════════════════════════════════════════════════

// How many loads are in flight. The entry landing is armed by a timer on screen
// entry and asks "is anything loaded?" only when it fires, so a load that is
// still fetching loses that race — and nothing else takes the landing down
// again. Because `mousedown` is bound to the canvas while `mousemove` is bound
// to `document`, the leftover `fixed inset-0` overlay then swallows every click
// while the cursor still updates: the edge-drag arms but never grabs.
//
// A counter, not a flag: two loads can overlap (editSong twice, or a load that
// fails fast while a slower one is still fetching), and the first to settle
// would otherwise clear a flag the second still needs held.
let _editorLoadsInFlight = 0;

async function loadCDLC(filename) {
    _editorLoadsInFlight++;
    // A load can also start while the landing is already up (editorLoadFile is
    // callable from outside the editor, e.g. the library's Edit button).
    document.getElementById('editor-start-landing')?.remove();
    setStatus('Loading ' + filename + '...');
    try {
        const resp = await fetch('/api/plugins/editor/load', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ filename }),
        });
        const data = await resp.json();
        if (data.error) { setStatus('Error: ' + data.error); return; }

        S.title = data.title || '';
        S.artist = data.artist || '';
        S.filename = filename;
        S.sessionId = data.session_id;
        S.format = data.format || 'archive';
        S.arrangements = data.arrangements || [];
        // Sloppak sources don't pad tuning to 6 slots like RS XML does,
        // so a bass arrangement arriving with tuning.length === 6 from
        // a sloppak is a genuine 6-string bass (not padded 4-string).
        // Seed `_extendedStrings` so `_stringCountFor` doesn't fall
        // back to the baseline-and-ignore-length-6 heuristic for these.
        // Sloppak sources have authoritative tuning lengths (no RS
        // padding). archive sources still get the `tuningLen > 6` path so
        // a previously-extended-saved archive is detected on reload.
        _seedExtendedStringsFromTuning(S.arrangements, S.format !== 'archive');
        // E2: normalize loaded handshapes into robust editable dicts (wire
        // field names) so span-lane authoring + the save round-trip operate
        // on them. The server emits them per-arrangement (_song_to_dict); the
        // editor kept them verbatim before but never normalized them.
        for (const a of S.arrangements) {
            if (!a) continue;
            a.handshapes = (a.handshapes || []).map(_normalizeHandshape)
                // Drop degenerate zero-/negative-length spans: they convey no
                // region and would render/hit-test as a 2px sliver. Authoring
                // enforces HS_MIN_SPAN; a loaded payload may not.
                .filter(hs => hs.end_time > hs.start_time)
                .sort((x, y) => x.start_time - y.start_time);
        }
        S.beats = data.beats || [];
        S.sections = data.sections || [];
        S.duration = data.duration || 0;
        S.offset = data.offset || 0;
        // Drum tab is loaded server-side when the manifest carries a
        // `drum_tab:` key and the file passes schema validation. Treat
        // a missing/falsey value as "no drums" so the +Drums modal can
        // tell whether the user is adding-or-replacing.
        S.drumTab = data.drum_tab ?? null;
        // Normalize hits: sort by t so drum-editor hit-testing and dragging
        // work correctly even if drum_tab.json was saved out of order.
        if (S.drumTab && Array.isArray(S.drumTab.hits)) {
            S.drumTab.hits.sort((a, b) => (a.t || 0) - (b.t || 0));
        }
        // Freshly loaded from disk — not dirty until the user edits it.
        S.drumTabDirty = false;
        // Exit drum-edit mode on song change so we don't carry a stale
        // selection into a sloppak whose hits[] is different.
        S.drumEditMode = false;
        S.drumSel = new Set();
        // Exit tempo-map mode too — its selection indexes into the old
        // song's beats[].
        S.tempoMapMode = false;
        S.tempoSel = -1;
        S.tempoHover = -1;
        // Drop loop A/B — session-only state; carrying a muted-reference
        // phase into another song would read as a playback bug. Refresh the
        // audio + UI too: clearing the flags alone would leave a guide-pass
        // mute on the ref gain and stale A/B button styling until the next
        // incidental control refresh.
        _abOn = false;
        _abPhase = 'recording';
        _abApplyRefGain();
        _guideTimerSync();
        _updateLoopRegionControls();
        // Abandon any in-progress drag — the global mouse handlers act on
        // S.drag regardless of mode, so a stale drag would otherwise keep
        // mutating the newly-loaded song's data.
        S.drag = null;
        S.currentArr = 0;
        S.sel.clear();
        S.toneSel = null;
        S.anchorSel = null;
        S.handshapeSel = null;
        S.scrollX = 0;
        S.cursorTime = 0;
        // Drop any bar-range selection from the previously-loaded song; a
        // pending view (highway handoff / return trip) re-sets it below.
        S.barSel = null;
        S.returnToHighway = false;
        S.history = new EditHistory();

        // Reset offset UI so _effectiveAudioOffset() doesn't carry over a
        // delta from a previous session's sync nudge into this one.
        _resetOffsetUI();

        // Flatten chord notes into main notes array for unified editing
        flattenChords();
        // Beat-primary (§1.3): lift note.beat from the loaded seconds against
        // the loaded grid, so beat is the truth from load onward.
        _liftAllBeats(S.beats);
        // Beat-lock (§1.8): re-attach persisted sync-point locks (editor-pref).
        _restoreBeatLocks();
        // Re-attach persisted suggested marks onto the rebuilt note objects so
        // the machine's unreviewed guesses stay honest across a reload.
        _restoreSuggestedMarks();
        if (isKeysMode()) updatePianoRange();

        // Update UI
        document.getElementById('editor-song-title').textContent =
            `${S.artist} — ${S.title}`;
        S.createMode = false;
        document.getElementById('editor-save-btn').disabled = false;
        document.getElementById('editor-save-btn').classList.remove('hidden');
        document.getElementById('editor-build-btn').classList.add('hidden');
        document.getElementById('editor-play-btn').disabled = !data.audio_url;
        document.getElementById('editor-sync-btn').classList.toggle('hidden', !data.audio_url);
        document.getElementById('editor-replace-audio-btn').classList.remove('hidden');
        _updateTonesButtonVisibility();
        updateArrangementSelector();
        updateStatus();
        updateTimeDisplay();
        updateBPMDisplay();

        // Load audio
        if (data.audio_url) {
            await loadAudio(data.audio_url);
        }

        draw();
        setStatus('Loaded: ' + S.artist + ' — ' + S.title);
        // Apply a pending view (highway "Edit region" handoff or our own
        // return trip) now that the song is fully loaded, then refresh the
        // Loop-in-3D button's enabled state.
        _applyEditorPendingView(filename);
        _updateLoopIn3DBtn();
    } catch (e) {
        setStatus('Load failed: ' + e.message);
    } finally {
        _editorLoadsInFlight--;
    }
}

function updateArrangementSelector() {
    const sel = document.getElementById('editor-arrangement');
    sel.innerHTML = '';
    S.arrangements.forEach((arr, i) => {
        const opt = document.createElement('option');
        opt.value = i;
        opt.textContent = arr.name;
        sel.appendChild(opt);
    });
    sel.style.display = S.arrangements.length > 1 ? '' : 'none';
    // Re-apply the active arrangement after the rebuild so callers that
    // changed S.currentArr (e.g. + Keys / + Drums append, remove-arr)
    // don't end up with a `<select>` snapped back to option 0 while the
    // canvas edits the appended arrangement. Clamp to the valid range
    // so an out-of-bounds S.currentArr doesn't render as a blank value.
    if (S.arrangements.length > 0) {
        const idx = Math.max(0, Math.min(S.currentArr || 0, S.arrangements.length - 1));
        S.currentArr = idx;
        sel.value = String(idx);
    }

    // "+ Drums" button: shown on any active session — the modal lets the
    // user add OR replace a drum tab. The old gate ("hide when a drums
    // ARRANGEMENT exists") is obsolete now that drums live in their own
    // `drum_tab.json` payload rather than the arrangements list. Legacy
    // sloppaks that still carry a guitar-encoded "drums" arrangement also
    // keep the button visible so the user can upgrade them to the new
    // format.
    const drumsBtn = document.getElementById('editor-add-drums-btn');
    if (drumsBtn) {
        // Gate to sloppak sessions only — drum_tab.json is a sloppak-spec
        // artefact and _save_archive silently ignores the drum_tab payload,
        // so showing the button on archive would mislead users into thinking
        // drums will persist after save. Mirrors the +Keys button pattern.
        drumsBtn.classList.toggle('hidden', !S.sessionId || S.format !== 'sloppak');
        if (S.drumTab) {
            const hitCount = (S.drumTab.hits || []).length;
            const kitCount = (S.drumTab.kit || []).length;
            drumsBtn.textContent = `⟳ Drums (${hitCount})`;
            drumsBtn.title = `Drum tab present: ${hitCount} hits across ${kitCount} pieces — click to replace`;
            drumsBtn.classList.remove('bg-red-900', 'hover:bg-red-800');
            drumsBtn.classList.add('bg-green-900', 'hover:bg-green-800');
        } else {
            drumsBtn.textContent = '+ Drums';
            drumsBtn.title = 'Import a drum tab from a Guitar Pro or MIDI file';
            drumsBtn.classList.add('bg-red-900', 'hover:bg-red-800');
            drumsBtn.classList.remove('bg-green-900', 'hover:bg-green-800');
        }
    }

    // Show "+ Keys" button on sloppak sessions; multiple Keys arrangements are allowed.
    const keysBtn = document.getElementById('editor-add-keys-btn');
    if (keysBtn) {
        keysBtn.classList.toggle('hidden', !S.sessionId || S.format !== 'sloppak');
    }

    // Show "+ Guitar/Bass" (GP guitar/bass import → add or replace) on sloppak
    // sessions only — same gate as +Keys (add-arrangement / chart swap persist
    // only through the sloppak save path).
    const importGuitarBtn = document.getElementById('editor-import-guitar-btn');
    if (importGuitarBtn) {
        importGuitarBtn.classList.toggle('hidden', !S.sessionId || S.format !== 'sloppak');
    }

    // Show "⋮ Strings" tuning editor whenever a guitar/bass arrangement is
    // active (not Keys-mode — piano-roll arrangements have no string concept).
    // Available on both archive and sloppak; the save-time prompt handles the
    // format constraint if archive can't carry the result.
    const stringsBtn = document.getElementById('editor-strings-btn');
    if (stringsBtn) {
        const active = S.arrangements[S.currentArr];
        const stringsMode = !!active
            && !KEYS_PATTERN.test(active.name || '')
            && !/^drums/i.test(active.name || '');
        stringsBtn.classList.toggle('hidden', !S.sessionId || !stringsMode);
    }

    // Show "● Record" (live MIDI) button on sloppak sessions only — archive's
    // add-arrangement path requires an xml_path we can't synthesize, and
    // archive build silently drops extra arrangements anyway. Mirror the
    // "+ Keys" gate exactly so users only see Record where it persists.
    const recBtn = document.getElementById('editor-record-midi-btn');
    if (recBtn) {
        recBtn.classList.toggle('hidden', !S.sessionId || S.format !== 'sloppak');
        if (_recMidiBackend() === 'none') {
            recBtn.disabled = true;
            recBtn.title = 'MIDI not available — needs the host MIDI input capability or Web MIDI (Chrome/Edge).';
        } else {
            recBtn.disabled = false;
            recBtn.title = 'Record a Keys arrangement live from a MIDI keyboard';
        }
    }

    // Show remove button when there are multiple arrangements
    const removeBtn = document.getElementById('editor-remove-arr-btn');
    if (removeBtn) {
        removeBtn.classList.toggle('hidden', S.arrangements.length <= 1);
    }

    // Rename is available whenever an arrangement is active on a live
    // session (rename persists through save; no session = nothing to save).
    const renameBtn = document.getElementById('editor-rename-arr-btn');
    if (renameBtn) {
        renameBtn.classList.toggle('hidden', !S.arrangements.length || !S.sessionId);
    }

    // Reorder buttons: only meaningful with 2+ parts, and only where the
    // new order actually persists. The order rides to disk on the FULL
    // arrangement snapshot, which `_buildSaveBody` ships only for sloppak
    // saves — an archive save writes just the active arrangement keyed by
    // `arrangement_index`, so a reorder there is silently lost (worse, the
    // stale index re-targets the wrong part). Gate to sloppak sessions,
    // exactly like +Keys / Record, so the affordance never lies.
    const upBtn = document.getElementById('editor-move-arr-earlier-btn');
    const downBtn = document.getElementById('editor-move-arr-later-btn');
    const canReorder = S.arrangements.length > 1 && !!S.sessionId && S.format === 'sloppak';
    if (upBtn) {
        upBtn.classList.toggle('hidden', !canReorder);
        upBtn.disabled = !canReorder || S.currentArr <= 0;
    }
    if (downBtn) {
        downBtn.classList.toggle('hidden', !canReorder);
        downBtn.disabled = !canReorder || S.currentArr >= S.arrangements.length - 1;
    }
}

// ════════════════════════════════════════════════════════════════════
// Load modal
// ════════════════════════════════════════════════════════════════════

async function showLoadModal() {
    const modal = document.getElementById('editor-load-modal');
    modal.classList.remove('hidden');
    const search = document.getElementById('editor-load-search');
    if (search) search.value = '';

    // Preload the flat list ONCE for recursive search (best-effort). The default
    // view is the folder browser below; typing in the search box searches across
    // every folder using this list.
    if (!S.songsList) {
        try {
            S.songsList = await fetch('/api/plugins/editor/songs').then(r => r.json());
        } catch {
            S.songsList = [];
        }
    }
    // Open as a file browser rooted at the DLC / song-library folder.
    await _editorBrowse('');
    if (search) search.focus();
}

// Fetch + render one directory level of the library. `path` is a DLC-relative
// POSIX subpath ("" = the library root).
async function _editorBrowse(path) {
    S.loadCwd = path || '';
    const list = document.getElementById('editor-load-list');
    let data;
    try {
        data = await fetch('/api/plugins/editor/browse', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: S.loadCwd }),
        }).then(r => r.json());
    } catch {
        data = { error: 'Could not read the library folder' };
    }
    if (!data || data.error) {
        if (list) list.innerHTML = '<div class="text-xs text-gray-500 p-2">'
            + _editorEscHtml((data && data.error) || 'Error') + '</div>';
        return;
    }
    S.loadCwd = data.cwd || '';
    S.loadParent = data.parent;
    _editorSetLoadPath(data.root, data.cwd);
    renderBrowse(data);
}

// Show the absolute folder path (root + current subpath), using whichever
// separator the OS root hints at so it reads like a real path on Windows/*nix.
function _editorSetLoadPath(root, cwd) {
    const el = document.getElementById('editor-load-path');
    if (!el) return;
    const sep = String(root).includes('\\') ? '\\' : '/';
    const full = cwd
        ? String(root).replace(/[\\/]+$/, '') + sep + String(cwd).replace(/\//g, sep)
        : String(root);
    el.textContent = full;
    el.title = full;
}

// Render an up-row (when not at root) + subfolders + loadable feedpaks.
function renderBrowse(data) {
    const list = document.getElementById('editor-load-list');
    if (!list) return;
    list.replaceChildren();
    const row = (icon, text, onClick, badge) => {
        const b = document.createElement('button');
        b.className = 'w-full text-left px-3 py-1.5 text-xs text-gray-300 hover:bg-dark-500 rounded flex items-center gap-2';
        const ic = document.createElement('span'); ic.className = 'shrink-0'; ic.textContent = icon;
        const lb = document.createElement('span'); lb.className = 'flex-1 truncate'; lb.textContent = text;
        b.appendChild(ic); b.appendChild(lb);
        if (badge) {
            const bd = document.createElement('span');
            bd.className = 'px-1.5 py-0.5 rounded text-[10px] uppercase tracking-wide bg-green-900/40 text-green-300';
            bd.textContent = badge;
            b.appendChild(bd);
        }
        b.addEventListener('click', onClick);
        list.appendChild(b);
    };
    if (data.cwd) row('⬆', '.. (up one folder)', () => _editorBrowse(data.parent || ''));
    for (const d of (data.dirs || [])) row('📁', d.name, () => _editorBrowse(d.path));
    for (const f of (data.files || [])) row('🎵', f.name, () => window.editorLoadFile(f.filename), f.format);
    if (!(data.dirs || []).length && !(data.files || []).length) {
        const empty = document.createElement('div');
        empty.className = 'text-xs text-gray-500 p-2';
        empty.textContent = data.cwd
            ? 'This folder is empty.'
            : 'No feedpaks in your library folder yet — use New… to create one.';
        list.appendChild(empty);
    }
}

// Empty/initial state for the load list: prompt to search rather than
// rendering every custom song up front.
function renderSongPrompt() {
    const list = document.getElementById('editor-load-list');
    if (list) {
        list.innerHTML = '<div class="text-xs text-gray-500 p-3 text-center">Start typing to search by song, artist, or filename…</div>';
    }
}

// Reset the offset input and its applied-delta dataset, called when loading
// any session so _effectiveAudioOffset() doesn't carry over a previous nudge.
function _resetOffsetUI() {
    const el = document.getElementById('editor-offset');
    if (el) { el.value = '0'; el.dataset.applied = '0'; }
}

function _normalizeSongList(raw) {
    // Backend now returns [{filename, format}] objects. Older deployments
    // may still return plain string filenames — normalize either shape and
    // default missing fields so callers can rely on a consistent shape.
    return (raw || []).map(item => {
        if (typeof item === 'string') {
            return {
                filename: item,
                format: /\.(feedpak|sloppak)$/.test(item.toLowerCase()) ? 'sloppak' : 'archive',
                title: '', artist: '',
            };
        }
        const filename = String(item?.filename ?? '');
        const format = String(item?.format
            ?? (/\.(feedpak|sloppak)$/.test(filename.toLowerCase()) ? 'sloppak' : 'archive'));
        // title/artist are best-effort enrichment from the library cache;
        // absent for unscanned songs, in which case we show the filename only.
        return { filename, format, title: String(item?.title ?? ''), artist: String(item?.artist ?? '') };
    });
}

function renderSongList(files) {
    const list = document.getElementById('editor-load-list');
    files = _normalizeSongList(files);
    list.innerHTML = '';
    if (!files.length) {
        list.innerHTML = '<div class="text-xs text-gray-500 p-2">No custom song files found</div>';
        return;
    }
    // Cap the rendered rows so a broad query (e.g. a single letter) can't
    // inject thousands of nodes; the search box narrows from here.
    const CAP = 200;
    const shown = files.slice(0, CAP);
    // Build the DOM imperatively so filenames never reach innerHTML.
    for (const f of shown) {
        const btn = document.createElement('button');
        btn.className = 'w-full text-left px-3 py-1.5 text-xs text-gray-300 hover:bg-dark-500 rounded flex items-center gap-2';
        btn.addEventListener('click', () => window.editorLoadFile(f.filename));

        // Prefer the real song name (title — artist) when the library cache
        // had it; fall back to the raw filename otherwise. The filename is
        // always shown as a dim subtitle so it stays identifiable/pickable.
        const songName = f.title
            ? (f.artist ? `${f.title} — ${f.artist}` : f.title)
            : '';
        const col = document.createElement('span');
        col.className = 'flex-1 min-w-0';
        const primary = document.createElement('span');
        primary.className = 'block truncate';
        primary.textContent = songName || f.filename;
        col.appendChild(primary);
        if (songName) {
            const sub = document.createElement('span');
            sub.className = 'block truncate text-[10px] text-gray-500';
            sub.textContent = f.filename;
            col.appendChild(sub);
        }
        btn.appendChild(col);

        const badge = document.createElement('span');
        const badgeColor = f.format === 'sloppak'
            ? 'bg-green-900/40 text-green-300'
            : 'bg-blue-900/40 text-blue-300';
        badge.className = `px-1.5 py-0.5 rounded text-[10px] uppercase tracking-wide ${badgeColor}`;
        badge.textContent = f.format;
        btn.appendChild(badge);

        list.appendChild(btn);
    }
    if (files.length > CAP) {
        const more = document.createElement('div');
        more.className = 'text-xs text-gray-500 p-2 text-center';
        more.textContent = `Showing first ${CAP} of ${files.length} — refine your search`;
        list.appendChild(more);
    }
}

function filterSongs(q) {
    const query = (q || '').trim().toLowerCase();
    // Empty query → back to the folder browser (rooted where the user last was).
    if (!query) { _editorBrowse(S.loadCwd || ''); return; }
    if (!S.songsList) return;
    const list = _normalizeSongList(S.songsList);
    // Match song name, artist, OR raw filename so users can search either way.
    const filtered = list.filter(f =>
        f.filename.toLowerCase().includes(query)
        || (f.title && f.title.toLowerCase().includes(query))
        || (f.artist && f.artist.toLowerCase().includes(query)));
    renderSongList(filtered);
}

// ════════════════════════════════════════════════════════════════════
// Save
// ════════════════════════════════════════════════════════════════════

// True if the *active* arrangement has more strings than stock-RS
// archive can carry (>6 guitar, >4 bass). archive saves are
// per-arrangement (the /save endpoint only writes `arrangement_index`),
// so checking other arrangements would surface the format prompt
// even when the save would only touch a standard one — annoying for
// users who, say, edited bass while leaving an extended lead alone.
// Uses `_stringCountFor` which composes the explicit
// `_extendedStrings` counter with chord-template width and max-note-
// index signals (so a 5-string bass with no notes on the new lane
// still trips the prompt, and a 6-string bass after a high-C add
// does too because `_extendedStrings` is set).
function _activeArrangementExceedsArchiveLimit() {
    const a = S.arrangements[S.currentArr];
    if (!a) return false;
    const isBass = /bass/i.test(a.name || '');
    const roleLimit = isBass ? 4 : 6;
    return _stringCountFor(a) > roleLimit;
}

// Prep work common to all save paths: normalise chord state across
// arrangements, then return the request body for the chosen endpoint.
// `forceFullSnapshot` is true for save_as_sloppak so the new sloppak
// gets every arrangement (not just S.currentArr).
function _buildSaveBody(forceFullSnapshot) {
    if (_recState === 'recording') window.editorStopRecordMidi();

    // Persist suggested marks BEFORE reconstructChords mints fresh note objects
    // and drops them from the WeakSet, so a reload restores the honest-gap marks.
    // Capture PER ARRANGEMENT (keyed by S.currentArr). Two subtleties:
    //   - The full-snapshot loop leaves INACTIVE arrangements RECONSTRUCTED (their
    //     chord members live in arr.chords as fresh, unmarked objects), so a later
    //     save must flatten first, then re-attach that arr's marks FROM THE STORE
    //     before capturing — otherwise the capture sees zero chord-member marks
    //     and would wipe the key. The ACTIVE arr is already flattened with LIVE
    //     WeakSet marks (which may lead the store after an unsaved Accept), so it
    //     is NOT restored — its live marks win.
    const savedArr = S.currentArr;
    if (S.format === 'sloppak' || forceFullSnapshot) {
        for (let i = 0; i < S.arrangements.length; i++) {
            S.currentArr = i;
            flattenChords();
            if (i !== savedArr) _restoreSuggestedMarks();
            _saveSuggestedMarks();
            reconstructChords();
        }
        S.currentArr = savedArr;
    } else {
        _saveSuggestedMarks();
        reconstructChords();
    }

    const arr = S.arrangements[S.currentArr];
    const body = {
        session_id: S.sessionId,
        arrangement_index: S.currentArr,
        notes: arr.notes,
        chords: arr.chords,
        chord_templates: arr.chord_templates,
        beats: S.beats,
        sections: S.sections,
        // Always ship title/artist so archive saves persist in-session
        // metadata edits too. Backend merges with session metadata
        // (album/year captured at load time) so all four fields
        // round-trip regardless of save path.
        metadata: {
            title: S.title,
            artist: S.artist,
        },
    };
    if (S.format === 'sloppak' || forceFullSnapshot) {
        // Strip the client-only `_editCount` field from each
        // arrangement's tones dict so the backend doesn't see it.
        // Backend reads tones from `body.arrangements[*].tones` here —
        // a top-level `body.tones` would be ignored, so don't
        // duplicate the payload.
        //
        // Skip `tones` entirely when the arrangement has no net
        // authored edits this session. Commands that mutate tones
        // (Add/Move/Remove/Rename) all run `_ensureTones` to
        // synthesize a `{}` shape; if every edit then gets undone,
        // the synthesized object stays behind. Shipping it would
        // overwrite the on-disk `tones: null` sentinel with an
        // empty `{base, slots, changes, definitions}` dict on the
        // next sloppak save.
        body.arrangements = S.arrangements.map(a => {
            if (!a) return a;
            // Strip `_anchorEditCount` / `_handshapeEditCount` from every
            // arrangement so the dirty counters never leak to the backend's
            // wire format. `rest` still carries `handshapes` (remapped by the
            // reconstructChords pass above) for the sloppak round-trip.
            const { _anchorEditCount, _handshapeEditCount, ...rest } = a;
            if (!rest.tones) return rest;
            // Distinguish loaded-but-unauthored data (ship verbatim,
            // round-trip through sloppak) from a synthesized-then-
            // fully-undone state (strip so the backend's preserve
            // branch fires).
            //   - Loaded data: `_editCount` key is *absent* (load
            //     path doesn't set it); ship as-is.
            //   - Authored this session: `_editCount > 0` → ship.
            //   - Synthesized + fully undone: `_editCount === 0`
            //     → strip the field; the empty object would
            //     otherwise overwrite a `tones: null` sentinel on
            //     disk.
            const editCount = rest.tones._editCount;
            if (editCount === 0) {
                const { tones, ...rest2 } = rest;
                return rest2;
            }
            return { ...rest, tones: _stripToneInternals(rest.tones) };
        });
    } else if (_tonesAreDirty(arr)) {
        // Single-arrangement (archive) save — the backend reads
        // `body.tones` directly. Ship it only when net authored
        // edits exist this session; a complete undo back to load
        // state returns the count to 0 → omit the field and let
        // the backend's preserve-from-disk branch fire.
        body.tones = _stripToneInternals(arr.tones);
    }
    // PR3d: ship `anchors_user` for single-arr archive saves when
    // the user has authored anchors this session. Full-snapshot
    // sloppak saves ride through `body.arrangements[i].anchors_user`
    // already (every arrangement object carries it intact).
    if (S.format !== 'sloppak' && !forceFullSnapshot
            && _anchorsAreDirty(arr) && Array.isArray(arr.anchors_user)) {
        body.anchors_user = arr.anchors_user;
    }
    // E2: ship `handshapes` for single-arr archive saves whenever any exist.
    // Unlike anchors (index-free {time,fret,width}), a handshape's `chord_id`
    // is an index into `chord_templates`, which reconstructChords() rebuilds
    // (and remaps the handshapes against) on EVERY save. So a dirty-only gate
    // is unsafe: editing notes can reindex templates while leaving handshapes
    // "clean", and the backend's absent→preserve path (`_FIELD_ABSENT`) would
    // then keep stale `chord_id`s pointing at the wrong rebuilt templates.
    // Shipping the freshly-remapped list keeps chord_ids consistent; ship an
    // empty list only when the user explicitly cleared authored handshapes.
    if (S.format !== 'sloppak' && !forceFullSnapshot && Array.isArray(arr.handshapes)
            && (arr.handshapes.length > 0 || _handshapesAreDirty(arr))) {
        body.handshapes = arr.handshapes;
    }
    // Drum-tab payload — separate from arrangements (see sloppak-spec §5.3).
    // S.drumTab is null while the sloppak has none; after +Drums it holds the
    // parsed JSON dict. Only ship `drum_tab` when the user actually
    // imported / edited it this session (`S.drumTabDirty`) — a tab merely
    // loaded from disk is left out so the backend's no-op path preserves
    // the manifest entry unchanged instead of re-serialising the whole
    // hit list on every unrelated save.
    if (S.drumTabDirty && S.drumTab !== undefined && S.drumTab !== null) {
        body.drum_tab = S.drumTab;
    }
    // Beat-primary: strip the runtime beat cache so the wire stays seconds-only.
    return _stripBeatsFromSaveBody(body);
}

async function saveCDLC() {
    if (!S.sessionId) return;
    // archive can't carry >6-string guitar / >4-string bass. If the user
    // pushed past those limits while editing, ask them whether to spill
    // into a new .sloppak or accept the truncation before we touch disk.
    if (S.format === 'archive' && _activeArrangementExceedsArchiveLimit()) {
        document.getElementById('editor-save-format-modal').classList.remove('hidden');
        return;
    }
    setStatus('Saving...');
    const body = _buildSaveBody(false);
    try {
        const resp = await fetch('/api/plugins/editor/save', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        const data = await resp.json();
        if (data.error) { setStatus('Save error: ' + data.error); return; }
        setStatus('Saved successfully');
    } catch (e) {
        setStatus('Save failed: ' + e.message);
    } finally {
        flattenChords();
        _restoreSuggestedMarks();   // reattach marks onto the reflattened objects
        // (Undo history was invalidated inside _buildSaveBody's reconstructChords
        // rebuild — see #18 there; nothing to reset here.)
        draw();
    }
}

window.editorHideSaveFormatModal = () => {
    document.getElementById('editor-save-format-modal').classList.add('hidden');
};

// "Save as Sloppak" — POST the full arrangement snapshot to the new
// /save_as_sloppak route. The backend writes a .sloppak next to the
// source .archive, then flips the session into sloppak mode so the next
// regular Save uses the native sloppak path.
window.editorSaveAsSloppakConfirm = async () => {
    document.getElementById('editor-save-format-modal').classList.add('hidden');
    if (!S.sessionId) return;
    setStatus('Saving as Sloppak...');
    const oldFilename = S.filename;
    const body = _buildSaveBody(true);   // persists suggested marks under oldFilename
    try {
        const resp = await fetch('/api/plugins/editor/save_as_sloppak', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        const data = await resp.json();
        if (data.error) { setStatus('Save error: ' + data.error); return; }
        // Flip session into sloppak mode so subsequent edits route to
        // _save_sloppak. The original archive stays on disk untouched.
        if (data.filename) {
            // Migrate the suggested-mark keys to the new filename so the machine's
            // unresolved guesses stay honest in the new .sloppak (the finally
            // restore below reads the NEW key). Old file's keys are left intact.
            if (data.filename !== oldFilename) {
                try {
                    for (let i = 0; i < S.arrangements.length; i++) {
                        const v = localStorage.getItem(_suggestedStorageKeyPure(oldFilename, i));
                        if (v !== null) localStorage.setItem(_suggestedStorageKeyPure(data.filename, i), v);
                    }
                } catch (_) { /* localStorage unavailable */ }
            }
            S.filename = data.filename;
        }
        S.format = 'sloppak';
        // Normalize in-memory tuning to the real string count so a
        // subsequent /save (which now goes through the native sloppak
        // path) doesn't serialize the RS-XML length-6 padding back into
        // the sloppak manifest — a later reload would otherwise seed
        // `_extendedStrings` from the padded length and mis-detect a
        // 4-string bass as 6-string.
        for (const arr of S.arrangements) {
            _normalizeTuningToLanes(arr, _stringCountFor(arr));
        }
        // `updateArrangementSelector` is what owns the + Keys / Strings /
        // Record toolbar gates and the remove-arrangement button. Refresh
        // it immediately so the user sees sloppak-only controls light up
        // the moment the conversion lands.
        updateArrangementSelector();
        // Prefer the relative filename over `data.path` so we don't
        // leak absolute server filesystem paths into the status UI.
        const displayName = data.filename || (data.path ? data.path.split('/').pop() : '');
        _kickLibraryRescan();   // new file → surface it in the library automatically
        setStatus('Saved as Sloppak: ' + displayName);
    } catch (e) {
        setStatus('Save failed: ' + e.message);
    } finally {
        flattenChords();
        _restoreSuggestedMarks();   // reattach marks onto the reflattened objects
        // (Undo history already invalidated by reconstructChords in _buildSaveBody — #18.)
        draw();
    }
};

// ════════════════════════════════════════════════════════════════════
// UI Helpers
// ════════════════════════════════════════════════════════════════════
// Kick an incremental library rescan so a song the editor just wrote shows up
// without the user manually rescanning from Settings — then refresh the library
// view so it appears without a page reload too. Uses the mtime-based
// /api/rescan, then (on the v3 UI) drops the cached library scroll snapshot so
// the next visit re-fetches, and polls /api/scan-status to reload the grid the
// moment the scan finishes (mirrors the v3 upload flow). No-ops gracefully on
// other UIs — the server still indexes the file regardless.
function _kickLibraryRescan(doneMsg) {
    fetch('/api/rescan', { method: 'POST' }).catch(() => {});
    // Signal plugins (e.g. Song Preview) that the library changed so they can
    // refresh immediately — their own audits read the files on disk and don't
    // need to wait for the core scan to finish.
    try { window.slopsmith?.emit?.('library:changed'); } catch (_) {}
    const songs = window.v3Songs;
    // v3: drop the cached library scroll snapshot so the next Songs visit
    // re-fetches instead of restoring the stale (pre-build) view.
    if (songs) { try { songs._scrollHelpers?.clearSnapshot?.(); } catch (_) {} }
    let sawRunning = false, ticks = 0;
    const timer = setInterval(async () => {
        ticks++;
        let sd = null;
        try { const r = await fetch('/api/scan-status'); if (r.ok) sd = await r.json(); } catch (_) {}
        if (sd && sd.running) sawRunning = true;
        // "Finished" = a scan we watched has stopped, OR we never caught one
        // running within a few ticks (it was quick). Hard bail at ~90s.
        const finished = (sawRunning && sd && !sd.running) || (!sawRunning && ticks >= 4);
        if (finished || ticks >= 90) {
            clearInterval(timer);
            if (finished) {
                if (songs && typeof songs.reload === 'function') {
                    try { songs.reload(); } catch (_) {}   // refresh grid + count
                }
                if (doneMsg) setStatus(doneMsg);            // truthful confirmation
            }
        }
    }, 1000);
}

function updateStatus() {
    const nn = notes();
    const cc = chords();
    // Suggest-position (VA.3): nudge that N roll-resolved positions are still
    // machine-picked (suggested), so the charter knows what's left to confirm.
    const unresolved = _suggestedCount();
    document.getElementById('editor-note-count').textContent =
        `${nn.length} notes, ${cc.length} chords`
        + (S.sel.size ? ` | ${S.sel.size} selected` : '')
        + (unresolved ? ` | positions unresolved: ${unresolved}` : '');
    _renderInspector();
    // Selection drives the Loop-in-3D fallback region, so keep the button's
    // enabled state in sync whenever the status (selection count) refreshes.
    _updateLoopIn3DBtn();
    setStatus('Ready');
}

// ════════════════════════════════════════════════════════════════════
// Inspector panel — right-side note attribute editor (PR3b of the
// tones+notation UI follow-up). Reflects S.sel; mutations apply to
// every selected note so multi-select bulk edits work without a new
// command class.
// ════════════════════════════════════════════════════════════════════

// All boolean technique flags the inspector exposes. The label is what
// the UI shows; the key matches the `techniques` dict on a note.
const _INSPECTOR_FLAGS = [
    { key: 'hammer_on',      label: 'Hammer-On' },
    { key: 'pull_off',       label: 'Pull-Off' },
    { key: 'palm_mute',      label: 'Palm Mute' },
    { key: 'fret_hand_mute', label: 'Fret-Hand Mute' },
    { key: 'mute',           label: 'String Mute' },
    { key: 'harmonic',       label: 'Harmonic' },
    { key: 'harmonic_pinch', label: 'Pinch Harmonic' },
    { key: 'accent',         label: 'Accent' },
    { key: 'vibrato',        label: 'Vibrato' },
    { key: 'tremolo',        label: 'Tremolo' },
    { key: 'tap',            label: 'Tap' },
    { key: 'slap',           label: 'Slap' },
    { key: 'pluck',          label: 'Pop (Pluck)' },
    { key: 'link_next',      label: 'Link Next' },
    { key: 'ignore',         label: 'Ignore' },
];

function _selectedNotes() {
    if (!S.sel || S.sel.size === 0) return [];
    const nn = notes();
    return [...S.sel].map(i => nn[i]).filter(Boolean);
}

// Reduce a getter across the selection: returns the shared value, or
// `null` when the selection is mixed. Used to render either a concrete
// value or the "(mixed)" placeholder.
function _selSharedValue(sel, getter, eq) {
    eq = eq || ((a, b) => a === b);
    if (sel.length === 0) return null;
    const first = getter(sel[0]);
    for (let i = 1; i < sel.length; i++) {
        if (!eq(getter(sel[i]), first)) return null;
    }
    return first;
}

function _renderInspector() {
    const el = document.getElementById('editor-inspector');
    if (!el) return;
    const sel = _selectedNotes();
    const wasVisible = !el.classList.contains('hidden');
    if (sel.length === 0) {
        if (wasVisible) {
            el.classList.add('hidden');
            el.innerHTML = '';
            // Hiding the panel grows the canvas wrap back to full
            // width — without a resize the canvas backing buffer keeps
            // the old narrower width and we render into a stale region.
            _scheduleCanvasResize();
        }
        return;
    }
    if (!wasVisible) {
        el.classList.remove('hidden');
        // Showing the panel shrinks the canvas wrap; refresh the canvas
        // backing dimensions so notes stay inside the visible region
        // instead of being clipped past the panel's left edge.
        _scheduleCanvasResize();
    }

    // Header: condensed summary of the selection.
    const sharedString = _selSharedValue(sel, n => n.string);
    const sharedFret = _selSharedValue(sel, n => n.fret);
    const sharedTime = _selSharedValue(sel, n => n.time);
    const sharedSustain = _selSharedValue(sel, n => n.sustain || 0);
    const headerCount = sel.length === 1
        ? '1 note selected'
        : `${sel.length} notes selected`;
    const mixed = '<span class="text-amber-400">(mixed)</span>';
    const fmtStr = v => v === null ? mixed : v;
    const fmtTime = v => v === null ? mixed : v.toFixed(3);
    const fmtSus = v => v === null ? mixed : (v || 0).toFixed(3);

    // Numeric inputs — when the selection has a shared value, prefill
    // it; when mixed, leave blank and let the user supply a new value
    // that applies to all.
    const sharedBend = _selSharedValue(sel, n => (n.techniques && n.techniques.bend) || 0);
    const sharedBt = _selSharedValue(sel, n => (n.techniques && n.techniques.bend_intent) || 0);
    const sharedSlide = _selSharedValue(sel, n => {
        const v = n.techniques && n.techniques.slide_to;
        return v === undefined ? -1 : v;
    });
    const sharedSlideU = _selSharedValue(sel, n => {
        const v = n.techniques && n.techniques.slide_unpitch_to;
        return v === undefined ? -1 : v;
    });
    // Teaching marks (§6.2.2): fret-hand finger, scale-degree override, strum
    // group. Default to -1 (unset) so a note that never authored them reads as
    // unset rather than "mixed" against an authored sibling.
    const sharedFinger = _selSharedValue(sel, n => {
        const v = n.techniques && n.techniques.fret_finger;
        return Number.isInteger(v) ? v : -1;
    });
    const sharedScaleDeg = _selSharedValue(sel, n => {
        const v = n.techniques && n.techniques.scale_degree;
        return Number.isInteger(v) ? v : -1;
    });
    const sharedStrum = _selSharedValue(sel, n => {
        const v = n.techniques && n.techniques.strum_group;
        return Number.isInteger(v) ? v : -1;
    });
    const inputVal = v => v === null ? '' : String(v);

    // Chord inspector (E1): when the selection is a chord (>=2 notes sharing a
    // time), author the shared chord template — name / displayName / per-string
    // fingering / arp. Edits land on the matching `arr.chord_templates` entry
    // (created if this chord hasn't been saved yet), which reconstructChords()
    // carries through save via relinkChordTemplate.
    const chordHtml = _chordInspectorHtml(_selectedChordContext(sel));

    let html = `
        <div class="space-y-1">
            <div class="font-semibold text-gray-100">${headerCount}</div>
            <div class="text-gray-400">string: ${fmtStr(sharedString)}</div>
            <div class="text-gray-400">fret: ${fmtStr(sharedFret)}</div>
            <div class="text-gray-400">time: ${fmtTime(sharedTime)}</div>
            <div class="text-gray-400">sustain: ${fmtSus(sharedSustain)}</div>
        </div>
        ${chordHtml}
        <div class="space-y-2 border-t border-gray-700 pt-3">
            <label class="flex items-center gap-2">
                <span class="w-24 text-gray-400">Time (s)</span>
                <input type="number" min="0" step="0.01" value="${inputVal(sharedTime)}"
                    placeholder="${sharedTime === null ? 'mixed' : ''}"
                    onchange="editorInspectorSetField('time', this.value)"
                    class="flex-1 bg-dark-700 border border-gray-700 rounded px-1 py-0.5 text-xs"
                    title="Set the note's start time in seconds (for aligning to the recording)">
            </label>
            <label class="flex items-center gap-2">
                <span class="w-24 text-gray-400">Sustain</span>
                <input type="number" min="0" step="0.05" value="${inputVal(sharedSustain)}"
                    placeholder="${sharedSustain === null ? 'mixed' : ''}"
                    onchange="editorInspectorSetField('sustain', this.value)"
                    class="flex-1 bg-dark-700 border border-gray-700 rounded px-1 py-0.5 text-xs">
            </label>
            <label class="flex items-center gap-2">
                <span class="w-24 text-gray-400">Bend (semi)</span>
                <input type="number" min="0" max="3" step="0.5" value="${inputVal(sharedBend)}"
                    placeholder="${sharedBend === null ? 'mixed' : ''}"
                    onchange="editorInspectorSetTech('bend', this.value)"
                    class="flex-1 bg-dark-700 border border-gray-700 rounded px-1 py-0.5 text-xs">
            </label>
            <label class="flex items-center gap-2">
                <span class="w-24 text-gray-400">Bend intent</span>
                <select onchange="editorInspectorSetBendIntent(this.value)"
                    class="flex-1 bg-dark-700 border border-gray-700 rounded px-1 py-0.5 text-xs">
                    ${BEND_INTENTS.map(o => `<option value="${o.v}"${o.v === (sharedBt ?? 0) ? ' selected' : ''}>${o.label}</option>`).join('')}
                </select>
            </label>
            <div class="flex items-center gap-2">
                <span class="w-24 text-gray-400">Bend curve</span>
                <button type="button" onclick="editorOpenBendCurve()"
                    class="flex-1 bg-dark-700 hover:bg-dark-600 border border-gray-700 rounded px-1 py-0.5 text-xs">Edit curve…</button>
            </div>
            <label class="flex items-center gap-2">
                <span class="w-24 text-gray-400">Slide to</span>
                <input type="number" min="-1" max="24" step="1" value="${inputVal(sharedSlide)}"
                    placeholder="${sharedSlide === null ? 'mixed' : ''}"
                    onchange="editorInspectorSetTech('slide_to', this.value)"
                    class="flex-1 bg-dark-700 border border-gray-700 rounded px-1 py-0.5 text-xs">
            </label>
            <label class="flex items-center gap-2">
                <span class="w-24 text-gray-400">Slide unp.</span>
                <input type="number" min="-1" max="24" step="1" value="${inputVal(sharedSlideU)}"
                    placeholder="${sharedSlideU === null ? 'mixed' : ''}"
                    onchange="editorInspectorSetTech('slide_unpitch_to', this.value)"
                    class="flex-1 bg-dark-700 border border-gray-700 rounded px-1 py-0.5 text-xs">
            </label>
        </div>
        <div class="space-y-2 border-t border-gray-700 pt-3">
            <div class="text-gray-500 text-[10px] uppercase tracking-wide">Teaching marks</div>
            <label class="flex items-center gap-2">
                <span class="w-24 text-gray-400">Finger</span>
                <select onchange="editorInspectorSetFretFinger(this.value)"
                    class="flex-1 bg-dark-700 border border-gray-700 rounded px-1 py-0.5 text-xs">
                    ${FRET_FINGER_OPTIONS.map(o => `<option value="${o.v}"${o.v === (sharedFinger ?? -1) ? ' selected' : ''}>${o.label}</option>`).join('')}
                </select>
            </label>
            <label class="flex items-center gap-2">
                <span class="w-24 text-gray-400">Scale deg.</span>
                <input type="number" min="-1" max="11" step="1" value="${inputVal(sharedScaleDeg)}"
                    placeholder="${sharedScaleDeg === null ? 'mixed' : 'auto'}"
                    title="0–11 semitones above the key tonic; -1 / blank = auto-derive"
                    onchange="editorInspectorSetScaleDegree(this.value)"
                    class="flex-1 bg-dark-700 border border-gray-700 rounded px-1 py-0.5 text-xs">
            </label>
            <div class="flex items-center gap-2">
                <span class="w-24 text-gray-400">Strum grp ${sharedStrum === null ? '(mixed)' : (sharedStrum >= 0 ? '#' + sharedStrum : '—')}</span>
                <button type="button" onclick="editorGroupAsStrum()"
                    class="flex-1 bg-dark-700 hover:bg-dark-600 border border-gray-700 rounded px-1 py-0.5 text-xs">Group</button>
                <button type="button" onclick="editorUngroupStrum()"
                    class="flex-1 bg-dark-700 hover:bg-dark-600 border border-gray-700 rounded px-1 py-0.5 text-xs">Ungroup</button>
            </div>
        </div>
        <div class="space-y-1 border-t border-gray-700 pt-3">`;

    for (const f of _INSPECTOR_FLAGS) {
        const sharedFlag = _selSharedValue(sel, n => !!(n.techniques && n.techniques[f.key]));
        // Three states: true / false / null (mixed). HTML's `indeterminate`
        // is only set via property, not attribute — handle it after
        // injecting via the post-mount pass below.
        const checked = sharedFlag === true;
        const indeterminate = sharedFlag === null;
        html += `
            <label class="flex items-center gap-2">
                <input type="checkbox" data-flag="${f.key}" ${checked ? 'checked' : ''}
                    ${indeterminate ? 'data-indeterminate="1"' : ''}
                    onchange="editorInspectorSetFlag('${f.key}', this.checked)"
                    class="rounded border-gray-600 bg-dark-700">
                <span>${f.label}</span>
            </label>`;
    }
    html += `</div>`;
    el.innerHTML = html;

    // Apply indeterminate state to the inputs that need it — the
    // attribute alone doesn't work; the JS property does.
    for (const cb of el.querySelectorAll('input[type=checkbox][data-indeterminate="1"]')) {
        cb.indeterminate = true;
    }
}

// Inspector mutators. All operate on the full S.sel so a multi-select
// edit applies bulk-style. Edits skip the undo history for now — PR3b
// keeps the scope tight; a TechBulkCmd lands when the inspector grows
// to need richer per-edit undo (PR3c handles tone/anchor lanes, where
// undo IS load-bearing).

// Bounds for the inspector's numeric inputs. Mirrors the limits the
// prompt-based editors (`promptFret`, `promptSlide`, `promptBend`)
// enforce — `type="number" min/max` on the inputs is only a UI hint;
// users can paste / type out-of-range values, so we clamp here too.
const _INSPECTOR_BOUNDS = {
    // Time (start position, seconds): non-negative, no upper clamp (a note
    // can't sit before the song start; the duration bound is soft). Lets an
    // author type a precise onset to align a note to the recording.
    time: { min: 0, max: Infinity, integer: false },
    // Sustain has no hard upper bound elsewhere (drag-resize / add-note
    // dialog leave it unconstrained), so the inspector matches — only
    // the lower clamp matters for input sanity.
    sustain: { min: 0, max: Infinity, integer: false },
    bend:    { min: 0, max: 3,  integer: false }, // half-steps, 3 = +3 semitones
    // `emptyAs: -1` matches the prompt semantic ("-1 or empty = no
    // slide") so the inspector and `promptSlide` / `promptSlideUnpitch`
    // accept the same set of inputs. Without it, deleting the input
    // value would be treated as a parse error and silently bounce back.
    slide_to:         { min: -1, max: 24, integer: true, emptyAs: -1 },
    slide_unpitch_to: { min: -1, max: 24, integer: true, emptyAs: -1 },
};

function _coerceInspectorNumber(rawValue, bounds) {
    if (rawValue === null || rawValue === undefined) return null;
    const s = String(rawValue).trim();
    if (s === '') {
        // Some fields (slide_to, slide_unpitch_to) interpret an empty
        // input as a "clear" affordance — match the prompt-based path.
        return bounds.emptyAs !== undefined ? bounds.emptyAs : null;
    }
    let v;
    if (bounds.integer) {
        // Strict plain-decimal integer regex — matches the
        // prompt-based path's `_parseFretInput`. Rejects `1e1`, `1.9`,
        // `12abc` so the inspector and the right-click prompt produce
        // the same accept/reject decision on identical input.
        if (!/^[-+]?\d+$/.test(s)) return null;
        v = Number(s);
    } else {
        // `Number('1e1abc')` is NaN; `parseFloat('1e1abc')` would
        // partial-parse to 10. Use `Number(...)` so junk-tail input
        // rejects instead of coercing.
        v = Number(s);
    }
    if (!Number.isFinite(v)) return null;
    if (v < bounds.min) v = bounds.min;
    if (v > bounds.max) v = bounds.max;
    return v;
}

window.editorInspectorSetField = (field, raw) => {
    const idxs = _editorCurrentNoteIndices();
    if (!idxs.length) return;
    const bounds = _INSPECTOR_BOUNDS[field];
    if (!bounds) return;
    const v = _coerceInspectorNumber(raw, bounds);
    if (v === null) {
        // Reject silently — but re-render so the input snaps back to
        // the current shared value instead of leaving the user looking
        // at an unapplied edit.
        _renderInspector();
        return;
    }
    // Route through the undo history: the sustain edit used to mutate
    // notes in place with no undo, and Time is new. Both apply to every
    // selected note (matching the field's "set all" semantics) as one
    // command, so a numeric edit is a single Ctrl+Z.
    const nn = notes();
    if (field === 'sustain') {
        S.history.exec(new ResizeSustainGroupCmd(idxs, idxs.map(() => v)));
    } else if (field === 'time') {
        // MoveNoteCmd applies per-note deltas; convert the absolute target
        // time to a delta per note (no re-sort — same as _editorResnapSelection,
        // and hitNote is a linear scan, so order isn't load-bearing).
        const dtimes = idxs.map(i => v - (nn[i] ? nn[i].time : 0));
        S.history.exec(new MoveNoteCmd(idxs, dtimes, idxs.map(() => 0), null));
    } else {
        return;
    }
    draw();
    updateStatus();
};

window.editorInspectorSetTech = (key, raw) => {
    const sel = _selectedNotes();
    if (sel.length === 0) return;
    // Read-only roll (V4): scalar technique edits mutate n.techniques in
    // place (no EditHistory command), so the exec lock never sees them.
    // Refuse and bounce the input back to the model value.
    if (_rollReadOnly()) { _rollLockNotice(); _renderInspector(); return; }
    const bounds = _INSPECTOR_BOUNDS[key];
    if (!bounds) return;
    const v = _coerceInspectorNumber(raw, bounds);
    if (v === null) {
        // Same as `editorInspectorSetField` — bounce the input back
        // to the current shared value on rejection so the panel can't
        // drift visually from the underlying model.
        _renderInspector();
        return;
    }
    for (const n of sel) {
        if (!n.techniques) n.techniques = {};
        n.techniques[key] = v;
        // Editing the scalar peak must keep any authored curve consistent
        // (renderers/graders read bnv as authoritative): rescale the curve to
        // the new peak, or drop it when the peak is 0 / the curve is unscalable.
        if (key === 'bend' && sanitizeBendCurve(n.techniques.bend_values)) {
            const scaled = v > 0
                ? rescaleBendCurveToPeak(n.techniques.bend_values, v)
                : null;
            n.techniques.bend_values = scaled;
            // bnv rounds points to 0.1, so a non-0.1 `v` (e.g. 0.25) would leave
            // bn disagreeing with the curve's real peak. Snap bn to the curve.
            if (scaled) n.techniques.bend = scaled.reduce((m, p) => Math.max(m, p.v), 0);
        }
    }
    draw();
    updateStatus();
};

window.editorInspectorSetBendIntent = (raw) => {
    const idxs = [...(S.sel || [])];
    if (!idxs.length) return;
    const bt = Number(raw) || 0;
    S.history.exec(new SetBendIntentCmd(idxs, bt));
    draw();
    updateStatus();
    _renderInspector();
};

window.editorOpenBendCurve = () => {
    const idxs = [...(S.sel || [])];
    if (!idxs.length) return;
    // promptBend re-derives the target set from S.sel; pass any selected index.
    promptBend(idxs[0]);
};

window.editorInspectorSetFlag = (key, on) => {
    const sel = _selectedNotes();
    if (sel.length === 0) return;
    // Read-only roll (V4): flag toggles mutate n.techniques directly — same
    // bypass as editorInspectorSetTech. Refuse and re-render to reset the box.
    if (_rollReadOnly()) { _rollLockNotice(); _renderInspector(); return; }
    for (const n of sel) {
        if (!n.techniques) n.techniques = {};
        n.techniques[key] = !!on;
    }
    draw();
    updateStatus();
};

// ─── Teaching marks (§6.2.2) ────────────────────────────────────────
// Author fg (fret-hand finger), sd (scale-degree override) and ch (strum
// group) on the current selection. Each is one undoable batch edit
// (SetTeachingMarkCmd). Display only — these never affect grading.
function _applyTeachingMark(key, value) {
    const idxs = [...(S.sel || [])];
    if (!idxs.length) return;
    S.history.exec(new SetTeachingMarkCmd(idxs, key, value));
    draw();
    updateStatus();
    _renderInspector();
}

window.editorInspectorSetFretFinger = (raw) => {
    const v = Math.trunc(Number(raw));
    if (!Number.isFinite(v)) return;
    _applyTeachingMark('fret_finger', Math.max(-1, Math.min(4, v)));
};

window.editorInspectorSetScaleDegree = (raw) => {
    const s = String(raw).trim();
    // Empty input clears the override back to -1 (auto/unset).
    const v = s === '' ? -1 : Math.trunc(Number(s));
    if (!Number.isFinite(v)) { _renderInspector(); return; }
    _applyTeachingMark('scale_degree', Math.max(-1, Math.min(11, v)));
};

// "Group as strum": assign every selected note a shared, unused ch key so the
// highway renders them as one strum/rake gesture (pkd gives direction).
window.editorGroupAsStrum = () => {
    if (!(S.sel && S.sel.size)) return;
    _applyTeachingMark('strum_group', nextUnusedStrumGroup(notes()));
};

// "Ungroup": clear the strum-group key on the selection (-1 = not grouped).
window.editorUngroupStrum = () => {
    if (!(S.sel && S.sel.size)) return;
    _applyTeachingMark('strum_group', -1);
};

// ─── Chord inspector (E1) ───────────────────────────────────────────
// Resolve the current selection to a chord and its width-L fret pattern +
// matching chord template, or null when the selection isn't a chord.
//
// The fret pattern is built from the FULL save-time group — every note sharing
// the selection's `time.toFixed(4)` key — not just the selected subset, and
// using the same key reconstructChords() groups by. That way a partial
// selection (e.g. rectangle-selecting 2 of a 3-note chord) still authors the
// triad's fret key, so the metadata survives the save-time rebuild instead of
// being dropped onto a dyad key reconstructChords() never produces.
function _selectedChordContext(sel) {
    sel = sel || _selectedNotes();
    if (sel.length < 2) return null;
    if (!S.arrangements.length) return null;
    const arr = S.arrangements[S.currentArr];
    if (!arr) return null;
    // The selection must fall within a single save-time group; reconstructChords
    // keys groups on `time.toFixed(4)`, so match that exactly.
    const key = sel[0].time.toFixed(4);
    for (const n of sel) { if (n.time.toFixed(4) !== key) return null; }
    const L = lanes();
    const frets = new Array(L).fill(-1);
    const group = [];
    for (const n of notes()) {
        if (n.time.toFixed(4) !== key) continue;
        group.push(n);
        if (n.string >= 0 && n.string < L) frets[n.string] = n.fret;
    }
    if (group.length < 2) return null; // single note at this time isn't a chord
    const fretKey = _fretKeyForL(frets, L);
    let tmpl = null;
    for (const ct of (arr.chord_templates || [])) {
        if (ct && Array.isArray(ct.frets) && _fretKeyForL(ct.frets, L) === fretKey) { tmpl = ct; break; }
    }
    // Harmony function rides the instance — carried on the chord's notes (_fn).
    const fn = _groupFn(group);
    return { arr, L, frets, fretKey, tmpl, key, fn, group };
}

function _chordAttrEsc(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/"/g, '&quot;')
        .replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Build the chord-section HTML, or '' when the selection isn't a chord. Finger
// pickers are shown only for sounding strings (fret >= 0); unused strings carry
// no finger.
function _chordInspectorHtml(ctx) {
    if (!ctx) return '';
    const t = ctx.tmpl;
    const name = t && typeof t.name === 'string' ? t.name : '';
    const displayName = t && typeof t.displayName === 'string' ? t.displayName : '';
    const arp = !!(t && t.arp);
    const voicing = t && typeof t.voicing === 'string' ? t.voicing : '';
    // Harmony function (§6.3.1) rides the chord instance, not the template.
    const fn = ctx.fn || {};
    const fnRn = typeof fn.rn === 'string' ? fn.rn : '';
    const fnQ = typeof fn.q === 'string' ? fn.q : '';
    const fnDeg = Number.isInteger(fn.deg) ? String(fn.deg) : '';
    const VOICINGS = ['', 'open', 'triad', 'shell', 'drop2', 'drop3', 'barre'];
    const voicingOpts = VOICINGS.map(v =>
        `<option value="${_chordAttrEsc(v)}"${v === voicing ? ' selected' : ''}>${v || '—'}</option>`).join('');
    // §6.6 CAGED shape + guide tones (template fields, display only).
    const caged = _sanitizeCaged(t && t.caged);
    const CAGED_SHAPES = ['', 'C', 'A', 'G', 'E', 'D'];
    const cagedOpts = CAGED_SHAPES.map(v =>
        `<option value="${_chordAttrEsc(v)}"${v === caged ? ' selected' : ''}>${v || '—'}</option>`).join('');
    const guideTonesStr = _sanitizeGuideTones(t && t.guideTones).join(', ');

    let fingersHtml = '';
    for (let i = 0; i < ctx.L; i++) {
        const fr = ctx.frets[i];
        if (fr < 0) continue;
        const cur = (t && Array.isArray(t.fingers) && Number.isFinite(t.fingers[i])) ? t.fingers[i] : -1;
        const opt = (v, label) => `<option value="${v}" ${cur === v ? 'selected' : ''}>${label}</option>`;
        fingersHtml += `
            <label class="flex items-center gap-2">
                <span class="w-24 text-gray-400">S${i + 1} (fret ${fr})</span>
                <select onchange="editorChordSetFinger(${i}, this.value)"
                    class="flex-1 bg-dark-700 border border-gray-700 rounded px-1 py-0.5 text-xs">
                    ${opt(-1, '—')}${opt(0, 'open')}${opt(1, '1')}${opt(2, '2')}${opt(3, '3')}${opt(4, '4')}
                </select>
            </label>`;
    }

    return `
        <div class="space-y-2 border-t border-gray-700 pt-3">
            <div class="font-semibold text-gray-100">Chord</div>
            <label class="flex items-center gap-2">
                <span class="w-24 text-gray-400">Name</span>
                <input type="text" value="${_chordAttrEsc(name)}" placeholder="e.g. Em7"
                    onchange="editorChordSetName(this.value)"
                    class="flex-1 bg-dark-700 border border-gray-700 rounded px-1 py-0.5 text-xs">
            </label>
            <label class="flex items-center gap-2">
                <span class="w-24 text-gray-400">Display</span>
                <input type="text" value="${_chordAttrEsc(displayName)}"
                    placeholder="${_chordAttrEsc(name) || 'same as name'}"
                    onchange="editorChordSetDisplayName(this.value)"
                    class="flex-1 bg-dark-700 border border-gray-700 rounded px-1 py-0.5 text-xs">
            </label>
            ${fingersHtml}
            <label class="flex items-center gap-2">
                <input type="checkbox" ${arp ? 'checked' : ''}
                    onchange="editorChordToggleArp(this.checked)"
                    class="rounded border-gray-600 bg-dark-700">
                <span>Arpeggio</span>
            </label>
            <label class="flex items-center gap-2">
                <span class="w-24 text-gray-400">Voicing</span>
                <select onchange="editorChordSetVoicing(this.value)"
                    title="§6.6 key-independent voicing type (display only)"
                    class="flex-1 bg-dark-700 border border-gray-700 rounded px-1 py-0.5 text-xs">
                    ${voicingOpts}
                </select>
            </label>
            <label class="flex items-center gap-2">
                <span class="w-24 text-gray-400">CAGED</span>
                <select onchange="editorChordSetCaged(this.value)"
                    title="§6.6 CAGED shape the fingering derives from (display only)"
                    class="flex-1 bg-dark-700 border border-gray-700 rounded px-1 py-0.5 text-xs">
                    ${cagedOpts}
                </select>
            </label>
            <label class="flex items-center gap-2">
                <span class="w-24 text-gray-400">Guide tones</span>
                <input type="text" value="${_chordAttrEsc(guideTonesStr)}" placeholder="e.g. 4, 10"
                    onchange="editorChordSetGuideTones(this.value)"
                    title="§6.6 semitone offsets 0-11 above the root (display only)"
                    class="flex-1 bg-dark-700 border border-gray-700 rounded px-1 py-0.5 text-xs">
            </label>
            <div class="space-y-2 border-t border-gray-700 pt-3">
                <div class="text-gray-500 text-[10px] uppercase tracking-wide"
                    title="§6.3.1 harmonic function — display only; all three needed to persist">Function</div>
                <label class="flex items-center gap-2">
                    <span class="w-24 text-gray-400">Numeral</span>
                    <input type="text" value="${_chordAttrEsc(fnRn)}" placeholder="e.g. ii7"
                        onchange="editorChordSetFnRn(this.value)"
                        class="flex-1 bg-dark-700 border border-gray-700 rounded px-1 py-0.5 text-xs">
                </label>
                <label class="flex items-center gap-2">
                    <span class="w-24 text-gray-400">Quality</span>
                    <input type="text" value="${_chordAttrEsc(fnQ)}" placeholder="e.g. m7"
                        onchange="editorChordSetFnQuality(this.value)"
                        class="flex-1 bg-dark-700 border border-gray-700 rounded px-1 py-0.5 text-xs">
                </label>
                <label class="flex items-center gap-2">
                    <span class="w-24 text-gray-400">Root deg.</span>
                    <input type="number" min="0" max="11" step="1" value="${_chordAttrEsc(fnDeg)}"
                        placeholder="0–11"
                        title="0–11 semitones of the chord root above the key tonic"
                        onchange="editorChordSetFnDeg(this.value)"
                        class="flex-1 bg-dark-700 border border-gray-700 rounded px-1 py-0.5 text-xs">
                </label>
            </div>
        </div>`;
}

// Apply a patch (subset of {name, displayName, fingers, arp}) to the selected
// chord's template via the undo history.
function _editorChordPatch(patch) {
    const ctx = _selectedChordContext();
    if (!ctx) return;
    S.history.exec(new EditChordTemplateCmd(S.currentArr, ctx.L, ctx.frets, patch));
    draw();
    _renderInspector();
}

window.editorChordSetName = (raw) => _editorChordPatch({ name: String(raw == null ? '' : raw).trim() });
window.editorChordSetDisplayName = (raw) => _editorChordPatch({ displayName: String(raw == null ? '' : raw).trim() });
window.editorChordToggleArp = (on) => _editorChordPatch({ arp: !!on });
window.editorChordSetVoicing = (raw) => _editorChordPatch({ voicing: String(raw == null ? '' : raw).trim() });
// §6.6 CAGED shape + guide tones — enum/range-guarded, routed as one undoable
// template patch like voicing (sanitizers live in the @pure:chord-relink block).
window.editorChordSetCaged = (raw) => _editorChordPatch({ caged: _sanitizeCaged(raw) });
window.editorChordSetGuideTones = (raw) => _editorChordPatch({ guideTones: _parseGuideTones(raw) });

// Apply a partial harmony-function patch ({rn?|q?|deg?}) to the selected
// chord's instance (the notes at its time), merged onto the current fn, via the
// undo history. fn rides the instance, so it is NOT a template patch.
function _editorChordFnPatch(patch) {
    const ctx = _selectedChordContext();
    if (!ctx) return;
    S.history.exec(new EditChordFnCmd(S.currentArr, ctx.key, ctx.fn, patch));
    draw();
    _renderInspector();
}

window.editorChordSetFnRn = (raw) => _editorChordFnPatch({ rn: String(raw == null ? '' : raw).trim() });
window.editorChordSetFnQuality = (raw) => _editorChordFnPatch({ q: String(raw == null ? '' : raw).trim() });
window.editorChordSetFnDeg = (raw) => {
    const s = String(raw == null ? '' : raw).trim();
    // Blank clears deg; otherwise parse and clamp-validate to 0..11 (else clear).
    const d = s === '' ? null : parseInt(s, 10);
    _editorChordFnPatch({ deg: (Number.isInteger(d) && d >= 0 && d <= 11) ? d : null });
};
window.editorChordSetFinger = (stringIdx, raw) => {
    const ctx = _selectedChordContext();
    if (!ctx) return;
    const i = Number(stringIdx);
    if (!Number.isInteger(i) || i < 0 || i >= ctx.L) return;
    const v = parseInt(raw, 10);
    if (![-1, 0, 1, 2, 3, 4].includes(v)) { _renderInspector(); return; }
    // Fingers persist as one width-L array — start from the current template
    // (or a blank width-L array) and change just this string.
    const base = _normFingers(ctx.tmpl && ctx.tmpl.fingers, ctx.L);
    base[i] = v;
    _editorChordPatch({ fingers: base });
};

function updateZoomDisplay() {
    const el = document.getElementById('editor-zoom-display');
    if (el) el.textContent = Math.round(S.zoom);
}

function _tempoResolvedMeasureIdx() {
    if (!S.tempoMapMode) return -1;
    if (S.tempoSel >= 0) return S.tempoSel;
    const measures = _tempoMeasures();
    if (!measures.length) return -1;
    const t = Math.max(0, S.cursorTime || 0);
    for (let k = measures.length - 1; k >= 0; k--) {
        if (measures[k].time <= t + 1e-6) return measures[k].i;
    }
    return measures[0].i;
}


/* @pure:measure-readout:start */
function _editorMeasureSignatureReadoutPure(beats, time, selectedIdx) {
    if (!Array.isArray(beats) || !beats.length) return { label: 'M-- --', measure: null, numerator: null, denominator: null };
    let idx = Number.isInteger(selectedIdx) && selectedIdx >= 0 && selectedIdx < beats.length && beats[selectedIdx] && beats[selectedIdx].measure > 0
        ? selectedIdx
        : -1;
    const t = Number.isFinite(Number(time)) ? Number(time) : 0;
    if (idx < 0) {
        for (let i = 0; i < beats.length; i++) {
            const b = beats[i];
            if (!b || b.measure <= 0) continue;
            if ((Number(b.time) || 0) <= t + 1e-6) idx = i;
            else break;
        }
    }
    if (idx < 0) idx = beats.findIndex(b => b && b.measure > 0);
    if (idx < 0) return { label: 'M-- --', measure: null, numerator: null, denominator: null };
    const downbeat = beats[idx];
    let nextIdx = beats.length;
    for (let i = idx + 1; i < beats.length; i++) {
        if (beats[i] && beats[i].measure > 0) { nextIdx = i; break; }
    }
    let numerator = Math.max(1, nextIdx - idx);
    if (nextIdx === beats.length) {
        let prevIdx = -1;
        for (let i = idx - 1; i >= 0; i--) {
            if (beats[i] && beats[i].measure > 0) { prevIdx = i; break; }
        }
        if (prevIdx >= 0) numerator = Math.max(1, idx - prevIdx);
    }
    const den = _tempoNormalizeDenominatorPure(downbeat.den);
    const measure = downbeat.measure;
    return { label: `M${measure} ${numerator}/${den}`, measure, numerator, denominator: den };
}
/* @pure:measure-readout:end */

/* @pure:chord-id:start */
// Chord vocabulary as root-relative pitch-class sets (semitones above the
// root). Grouped by size; within a size, order breaks nothing (an exact set
// match at a given size is unambiguous except for the m7/6 and symmetric
// aug/dim7 cases, which the bass note disambiguates below). Display/teaching
// only — never grades.
const CHORD_FORMULAS = [
    { suffix: 'maj7',  pcs: [0, 4, 7, 11] },
    { suffix: '7',     pcs: [0, 4, 7, 10] },
    { suffix: 'm7',    pcs: [0, 3, 7, 10] },
    { suffix: 'mMaj7', pcs: [0, 3, 7, 11] },
    { suffix: 'm7b5',  pcs: [0, 3, 6, 10] },
    { suffix: 'dim7',  pcs: [0, 3, 6, 9] },
    { suffix: '6',     pcs: [0, 4, 7, 9] },
    { suffix: 'm6',    pcs: [0, 3, 7, 9] },
    { suffix: '',      pcs: [0, 4, 7] },      // major triad
    { suffix: 'm',     pcs: [0, 3, 7] },      // minor triad
    { suffix: 'dim',   pcs: [0, 3, 6] },
    { suffix: 'aug',   pcs: [0, 4, 8] },
    { suffix: 'sus4',  pcs: [0, 5, 7] },
    { suffix: 'sus2',  pcs: [0, 2, 7] },
    { suffix: '5',     pcs: [0, 7] },         // power chord (dyad)
];

// Unique, sorted pitch-class set (0–11) from a list of MIDI numbers.
function _pcSetFromMidisPure(midis) {
    const set = new Set();
    for (const m of midis || []) {
        const v = Number(m);
        if (Number.isFinite(v)) set.add(((Math.round(v) % 12) + 12) % 12);
    }
    return [...set].sort((a, b) => a - b);
}

// Identify a chord from a pitch-class set. Requires an EXACT match (the pcs
// equal some root's chord set) — no partial guessing, so the readout only
// appears when it's certain. `bassPc` (the lowest sounding pitch class, or -1)
// breaks the genuine ties: m7-vs-6 (Cm7 and Eb6 are the same four pcs) and the
// symmetric aug / dim7 (which spell at several roots). A single pc returns the
// note name; an empty set returns null. Root names come from `noteNames`.
function _identifyChordPure(pcs, bassPc, noteNames) {
    const names = noteNames || PIANO_NOTE_NAMES;
    const set = Array.isArray(pcs) ? [...new Set(pcs)].sort((a, b) => a - b) : [];
    if (set.length === 0) return null;
    if (set.length === 1) return { root: set[0], suffix: '', name: names[set[0]] };
    const present = new Set(set);
    const matches = [];
    for (const f of CHORD_FORMULAS) {
        if (f.pcs.length !== set.length) continue;
        for (let root = 0; root < 12; root++) {
            let ok = true;
            for (const iv of f.pcs) {
                if (!present.has((root + iv) % 12)) { ok = false; break; }
            }
            if (ok) matches.push({ root, suffix: f.suffix });
        }
    }
    if (!matches.length) return null;
    const best = matches.find(m => m.root === bassPc) || matches[0];
    return { root: best.root, suffix: best.suffix, name: names[best.root] + best.suffix };
}

// Notes sounding at time `t`: onset at/before t (within eps) and still ringing
// (onset + max(sustain, minDur) ≥ t − eps). Pure over the note list, so a
// zero-sustain note still registers briefly at its onset.
function _notesSoundingAtPure(notesArr, t, minDur, eps) {
    const out = [];
    if (!Array.isArray(notesArr)) return out;
    const e = Number.isFinite(eps) ? eps : 0.03;
    const md = Number.isFinite(minDur) ? minDur : 0.05;
    for (const n of notesArr) {
        const on = Number(n.time);
        if (!Number.isFinite(on)) continue;
        const off = on + Math.max(Number(n.sustain) || 0, md);
        if (on <= t + e && off >= t - e) out.push(n);
    }
    return out;
}

// The open time interval around `t` on which _notesSoundingAtPure returns the
// SAME membership — used to memoize the playhead chord readout so it recomputes
// only when the cursor crosses a note boundary, not on every playback frame.
// Each note contributes exactly two membership boundaries (`on - eps` and
// `off + eps`); between consecutive boundaries the sounding set is invariant.
// Returns { lo, hi } with lo/hi the nearest boundaries strictly below/above t
// (±Infinity when unbounded). When t sits exactly on a boundary the set can
// change on either side, so a degenerate { lo: t, hi: t } is returned to force
// a recompute at that instant — correctness over the micro-optimisation.
function _soundingIntervalPure(notesArr, t, minDur, eps) {
    let lo = -Infinity, hi = Infinity, onBoundary = false;
    if (!Array.isArray(notesArr)) return { lo, hi };
    const e = Number.isFinite(eps) ? eps : 0.03;
    const md = Number.isFinite(minDur) ? minDur : 0.05;
    for (const n of notesArr) {
        const on = Number(n.time);
        if (!Number.isFinite(on)) continue;
        const off = on + Math.max(Number(n.sustain) || 0, md);
        const bounds = [on - e, off + e];
        for (const b of bounds) {
            if (b === t) onBoundary = true;
            else if (b > t) { if (b < hi) hi = b; }
            else if (b > lo) lo = b;
        }
    }
    return onBoundary ? { lo: t, hi: t } : { lo, hi };
}

// Whether the chord readout memo (_chordCache) is still valid for the current
// frame. A hit requires: no active drag (a live move/resize mutates note
// time/sustain in place WITHOUT an edit-generation bump, so any drag must
// rescan); the same edit generation and arrangement index; the SAME notes-array
// identity (a song load/replace installs a fresh array without bumping the gen —
// the identity check catches it, mirroring the section-coverage memo); and a
// cursor time strictly inside the cached stable interval (lo, hi).
function _chordCacheHitPure(cache, key) {
    if (!cache || !key || key.dragging) return false;
    return key.gen === cache.gen
        && key.arr === cache.arr
        && key.notesRef === cache.notesRef
        && key.t > cache.lo && key.t < cache.hi;
}
/* @pure:chord-id:end */

function updateBPMDisplay() {
    const el = document.getElementById('editor-bpm');
    if (!el || S.beats.length < 2) return;
    if (document.activeElement === el) return;
    if (S.tempoMapMode) {
        const d = S.tempoSel;
        const m = _tempoMeasures().find(mm => mm.i === d) || null;
        if (m && !m.isLast && m.bpm > 0) {
            el.value = m.bpm.toFixed(2);
            return;
        }
        el.value = '';
        return;
    }
    el.value = getTabBPM().toFixed(1);
}

function updateTempoSigDisplay() {
    const numEl = document.getElementById('editor-tempo-sig');
    const denEl = document.getElementById('editor-tempo-sig-den');
    if ((!numEl && !denEl) || document.activeElement === numEl || document.activeElement === denEl) return;
    const d = S.tempoMapMode ? S.tempoSel : _tempoResolvedMeasureIdx();
    if (d < 0) {
        if (numEl) numEl.value = '';
        if (denEl) denEl.value = '4';
        _refreshTempoSyncInspector();
        return;
    }
    if (numEl) numEl.value = String(_tempoMeasureBeatCount(d));
    if (denEl) denEl.value = String(_tempoMeasureDenominator(d));
    updateMeasureDisplay();
    _refreshTempoSyncInspector();
}

// Defer a `resizeCanvas` until layout has settled — used when a
// sibling panel (inspector) just toggled visibility. Without the
// rAF the panel's `display:none → flex` transition hasn't applied
// when `clientWidth` is read, so the canvas would resize to the
// pre-toggle width.
function _scheduleCanvasResize() {
    // `resizeCanvas` already calls `draw()` once it has the new
    // dimensions; no extra render needed here.
    requestAnimationFrame(() => {
        resizeCanvas();
    });
}

function resizeCanvas() {
    if (!canvas) return;
    const wrap = document.getElementById('editor-canvas-wrap');
    const w = wrap.clientWidth;
    const h = wrap.clientHeight;
    if (w <= 0 || h <= 0) return;

    // Dynamically size lanes to fill available height. The metrics live in
    // geometry.js as live `export let` bindings — everything reads them, only
    // setLaneMetrics writes them.
    setLaneMetrics(h);

    canvas.width = w * DPR;
    canvas.height = h * DPR;
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    // The max scroll depends on the (now-changed) canvas width — re-clamp so a
    // widen doesn't leave the timeline scrolled past the new max with blank tail.
    _editorApplyScrollBounds();
    draw();
}

// ════════════════════════════════════════════════════════════════════
// Global API (called from HTML)
// ════════════════════════════════════════════════════════════════════

// Shortcut profile + right-click behaviour live in src/shortcuts.js; main.js
// keeps the `window.*` surface the inline handlers in screen.html call (§V).
window.editorSetShortcutProfile = editorSetShortcutProfile;
window.editorSetRightClickBehavior = editorSetRightClickBehavior;
window.editorShowLoadModal = showLoadModal;
window.editorHideLoadModal = () => document.getElementById('editor-load-modal').classList.add('hidden');
window.editorFilterSongs = filterSongs;
window.editorLoadFile = (f) => { window.editorHideLoadModal(); loadCDLC(f); };
window.editorSave = saveCDLC;
window.editorUndo = () => S.history && S.history.doUndo();
window.editorRedo = () => S.history && S.history.doRedo();
window.editorTogglePlay = () => {
    // Route stops through the recorder while a take is active so the
    // spacebar (or any other transport caller) finalizes the recording
    // cleanly instead of leaving _recState stuck in 'recording'.
    if (_recState === 'recording') {
        window.editorStopRecordMidi();
        return;
    }
    if (S.playing) stopPlayback(); else startPlayback();
};
window.editorZoom = (dir) => {
    const factor = dir > 0 ? 1.3 : 0.77;
    S.zoom = Math.max(20, Math.min(2000, S.zoom * factor));
    _editorApplyScrollBounds();
    updateZoomDisplay();
    draw();
};
window.editorSetSnap = (idx) => {
    const n = parseInt(idx, 10);
    S.snapIdx = Math.max(0, Math.min(SNAP_VALUES.length - 1, Number.isFinite(n) ? n : S.snapIdx));
    const el = document.getElementById('editor-snap');
    if (el) el.selectedIndex = S.snapIdx;
};
window.editorSetSnapEnabled = (enabled) => {
    S.snapEnabled = !!enabled;
    const el = document.getElementById('editor-snap-enabled');
    if (el) el.checked = S.snapEnabled;
    setStatus(S.snapEnabled ? 'Snap enabled' : 'Snap disabled');
};
window.editorSetBPM = (val) => {
    const newBPM = parseFloat(val);
    if (!newBPM || newBPM <= 0 || S.beats.length < 2) return;
    if (!S.tempoMapMode && _tempoHasMultipleMeasureBpmsPure(S.beats, 0.01)) {
        // The song has a variable tempo map (multiple per-measure tempos). The
        // per-measure editor can only fix ONE measure at a time, so offer to
        // FLATTEN the whole map to this constant BPM — the escape hatch from a
        // bad import's tempos (tester report: "can't remove all the BPM sync
        // points without deleting measures"). Confirm because it discards the
        // tempo variation; notes keep their times, and undo restores the map.
        const ok = (typeof window !== 'undefined' && typeof window.confirm === 'function')
            ? window.confirm(
                `This song has a variable tempo map (multiple tempo events).\n\n` +
                `Flatten the WHOLE map to a constant ${newBPM} BPM?\n\n` +
                `Only the beat grid is rebuilt — notes keep their times. Undo restores the tempo map.`)
            : true;
        if (!ok) { updateBPMDisplay(); draw(); return; }
        // Exact spacing (no rounding) so the flattened map reads as PERFECTLY
        // constant — _r3's ±0.5ms would drift per-measure BPM past the 0.01
        // variable-tempo detector and the grid would still look variable.
        const flat = _tempoFlattenToBpmPure(S.beats, newBPM);
        if (!flat) { updateBPMDisplay(); return; }
        S.history.exec(new TempoGridCmd(S.beats.map(b => ({ ...b })), flat, 'flatten'));
        updateBPMDisplay();
        draw();
        setStatus(`Tempo map flattened to a constant ${newBPM.toFixed(2)} BPM`);
        return;
    }
    if (S.tempoMapMode) {
        const d = S.tempoSel;
        if (d < 0) return;
        const measures = _tempoMeasures();
        const m = measures.find(mm => mm.i === d) || null;
        if (!m || m.isLast || !(m.bpm > 0)) {
            setStatus('Select a non-final measure to edit its BPM.');
            updateBPMDisplay();
            return;
        }
        const newBeats = _tempoSetMeasureBpmPure(S.beats, d, newBPM, MIN_MEASURE, _r3);
        if (!newBeats) {
            updateBPMDisplay();
            return;
        }
        S.history.exec(new TempoMapCmd(S.beats.map(b => ({ ...b })),
            _respaceWithLocksPure(S.beats, newBeats), 'bpm'));
        updateBPMDisplay();
        draw();
        setStatus(`Measure ${m.measure} tempo changed: ${m.bpm.toFixed(2)} → ${newBPM.toFixed(2)} BPM`);
        return;
    }
    const oldBPM = getTabBPM();
    const factor = oldBPM / newBPM;
    if (Math.abs(factor - 1) < 0.001) return;

    // Scale all times
    const nn = notes();
    for (const n of nn) {
        n.time *= factor;
        if (n.sustain) n.sustain *= factor;
    }
    for (const b of S.beats) b.time *= factor;
    for (const s of S.sections) s.start_time *= factor;

    updateBPMDisplay();
    draw();
    setStatus(`Tempo changed: ${oldBPM.toFixed(1)} → ${newBPM.toFixed(1)} BPM`);
};
window.editorSetTempoSignature = (val) => {
    if (!S.tempoMapMode || S.beats.length < 2) return;
    const d = S.tempoSel;
    if (d < 0) return;
    const n = parseInt(val, 10);
    if (!Number.isFinite(n)) { updateTempoSigDisplay(); return; }
    const m = _tempoMeasures().find(mm => mm.i === d) || null;
    const prevNum = _tempoMeasureBeatCount(d);
    const prevDen = _tempoMeasureDenominator(d);
    _tempoSetBeatsPerMeasure(d, n);
    updateTempoSigDisplay();
    const nextNum = _tempoMeasureBeatCount(d);
    if (m && prevNum !== nextNum) {
        setStatus(`Measure ${m.measure} time signature changed: ${prevNum}/${prevDen} → ${nextNum}/${prevDen}`);
    }
};
window.editorSetTempoSignatureDenominator = (val) => {
    if (!S.tempoMapMode || S.beats.length < 2) return;
    const d = S.tempoSel;
    if (d < 0) return;
    const m = _tempoMeasures().find(mm => mm.i === d) || null;
    const prevNum = _tempoMeasureBeatCount(d);
    const prevDen = _tempoMeasureDenominator(d);
    const newBeats = _tempoSetDenominatorOnBeatsPure(S.beats, d, val);
    if (!newBeats) { updateTempoSigDisplay(); return; }
    S.history.exec(new TempoGridCmd(S.beats.map(b => ({ ...b })), newBeats, 'timesig-den'));
    updateTempoSigDisplay();
    draw();
    const nextDen = _tempoMeasureDenominator(d);
    if (m && prevDen !== nextDen) {
        setStatus(`Measure ${m.measure} time signature changed: ${prevNum}/${prevDen} → ${prevNum}/${nextDen}`);
    }
};
// Rigidly shift all of ONE arrangement's time-bearing fields by `delta` seconds:
// notes, chords (+ their notes), source + authored anchors, handshape spans, and
// phrase windows. Sustains are durations, so they do NOT move. Field set mirrors
// the beat-primary walk (_eachTimed / _reprojectAll). Pure — node-tested.
function _shiftArrangementTimes(arr, delta) {
    if (!arr) return;
    for (const n of (arr.notes || [])) {
        if (typeof n.time === 'number') n.time += delta;
    }
    for (const ch of (arr.chords || [])) {
        if (typeof ch.time === 'number') ch.time += delta;
        for (const cn of (ch.notes || [])) {
            if (typeof cn.time === 'number') cn.time += delta;
        }
    }
    for (const a of (arr.anchors || [])) {
        if (typeof a.time === 'number') a.time += delta;
    }
    for (const a of (arr.anchors_user || [])) {
        if (typeof a.time === 'number') a.time += delta;
    }
    for (const hs of (arr.handshapes || [])) {
        if (typeof hs.start_time === 'number') hs.start_time += delta;
        if (typeof hs.end_time === 'number') hs.end_time += delta;
    }
    for (const ph of (arr.phrases || [])) {
        if (typeof ph.time === 'number') ph.time += delta;
    }
}

window.editorApplyOffset = (val) => {
    const offset = parseFloat(val) || 0;
    const currentOffset = parseFloat(document.getElementById('editor-offset').dataset.applied || '0');
    const delta = offset - currentOffset;
    if (Math.abs(delta) < 0.0001) return;
    // Shift EVERY arrangement, not just the current one. Beats / sections / drums
    // (below) are global, so shifting only the current arrangement's notes left
    // the OTHER arrangements (and every arrangement's chords / anchors /
    // handshapes / phrases) out of phase. The user then re-nudged each one to
    // realign it — poisoning `dataset.applied`, so each later +Keys / +Drums
    // import landed progressively further off (#2). One apply now moves
    // everything together and `dataset.applied` stays the single source of truth.
    for (const arr of S.arrangements) _shiftArrangementTimes(arr, delta);
    for (const b of S.beats) b.time += delta;
    for (const s of S.sections) s.start_time += delta;
    // Drum-tab hits live outside S.arrangements, so the loops above miss
    // them — shift them by the same delta or an offset nudge leaves the
    // drum chart out of sync with the guitar/beats it just realigned.
    // Clamp at 0 and round to 3 dp: the save path rejects hits with a
    // negative `t` as malformed (silent loss), and 3 dp matches the
    // server-side and drum-editor rounding conventions.
    if (S.drumTab && Array.isArray(S.drumTab.hits)) {
        for (const h of S.drumTab.hits) {
            if (typeof h.t === 'number') {
                h.t = Math.max(0, Math.round((h.t + delta) * 1000) / 1000);
            }
        }
        S.drumTabDirty = true;
    }
    document.getElementById('editor-offset').dataset.applied = String(offset);
    draw();
    setStatus(`Offset: ${offset >= 0 ? '+' : ''}${(offset * 1000).toFixed(0)}ms`);
};

// Effective audio offset to send when importing a new arrangement: the
// song's loaded offset plus any UI-applied shift the user already made
// via editorApplyOffset (which moves notes/beats but never updates
// S.offset). Without this, a +Keys/+Drums import after a sync nudge
// lands out of phase with the chart the user just realigned.
function _effectiveAudioOffset() {
    const base = Number(S.offset) || 0;
    const el = document.getElementById('editor-offset');
    const applied = el ? parseFloat(el.dataset.applied || '0') || 0 : 0;
    return base + applied;
}
window.editorNudgeOffset = (delta) => {
    const el = document.getElementById('editor-offset');
    const current = parseFloat(el.value) || 0;
    el.value = (current + delta).toFixed(3);
    window.editorApplyOffset(el.value);
};
window.editorSelectArrangement = (val) => {
    // Flush the OUTGOING arrangement's live suggested marks to its keyed store
    // before switching, so localStorage tracks the WeakSet (an Accept/position
    // move that cleared a mark since the last save isn't resurrected when we
    // restore this arrangement later). Guarded for extracted-test envs.
    if (typeof _saveSuggestedMarks === 'function') _saveSuggestedMarks();
    S.currentArr = parseInt(val) || 0;
    S.sel.clear();
    // Tone + anchor selections are per-arrangement — clear them so
    // Del after the switch doesn't remove a same-ref marker in the
    // new arrangement.
    S.toneSel = null;
    S.anchorSel = null;
    S.handshapeSel = null;
    flattenChords();
    // Re-attach this arrangement's persisted suggested marks (the key carries the
    // arr index) so switching parts restores the right marks, not arr 0's.
    // typeof-guarded like the mark helpers (absent in extracted-test envs).
    if (typeof _restoreSuggestedMarks === 'function') _restoreSuggestedMarks();
    // Undo hardening: flattenChords() re-sorts arr.notes (see _flattenArrChords),
    // which renumbers the index-based note commands (MoveNoteCmd, DeleteNotesCmd,
    // ResizeSustainCmd) recorded against this or another arrangement. A later
    // rollback would then land on the WRONG note and silently corrupt it. So drop
    // the history on every USER-initiated switch — this makes cross-arrangement
    // undo impossible, guaranteeing an index-based rollback never spans a re-sort.
    // The undo-driven switch (_historyEnsureArr) opts out via _undoDrivenArrSwitch
    // so it doesn't discard the stack it is replaying. Mirrors the save/build
    // reset() (another arr.notes renumbering event).
    if (!_undoDrivenArrSwitch && S.history) S.history.reset();
    if (isKeysMode()) updatePianoRange();
    draw();
    updateStatus();
};
window.editorToggleTech = (idx, tech) => {
    // Read-only roll (V4): the context-menu technique toggle mutates
    // n.techniques directly (no EditHistory), so it escapes the exec lock.
    // The note context menu still opens in the roll (right-click selection is
    // allowed), so guard the toggle itself.
    if (_rollReadOnly()) { hideContextMenu(); _rollLockNotice(); return; }
    const n = notes()[idx];
    if (!n.techniques) n.techniques = {};
    n.techniques[tech] = !n.techniques[tech];
    hideContextMenu();
    draw();
    // Refresh the inspector — when the right-click toggle fires on a
    // selected note, the panel's checkbox state needs to follow the
    // mutation or it stays stale until the next selection change.
    _renderInspector();
};

// ════════════════════════════════════════════════════════════════════
// Loop in 3D — hand the selected bar range to the 3D highway, then come
// back to the exact edit position. Pairs with app.js's song:ready loop
// applier (consumes window._pendingHighwayLoop) and the highway's
// "Edit region" button (sets window._editorPendingView). See
// docs / CLAUDE.md "Editor ⇄ 3D Highway region round-trip".
// ════════════════════════════════════════════════════════════════════

// The region to preview, in seconds. Prefer an explicit bar-bar drag
// (S.barSel); otherwise fall back to the span of the current note selection,
// snapped to whole bars — so the user can just select notes (which they
// already know how to do) and hit the button. Returns null when neither
// exists.
function _effectiveLoopRegion() {
    if (S.barSel) return { startTime: S.barSel.startTime, endTime: S.barSel.endTime, mode: S.barSel.mode };
    const sel = _selectedNotes();
    if (sel.length) {
        let lo = Infinity, hi = -Infinity;
        for (const n of sel) {
            lo = Math.min(lo, n.time);
            hi = Math.max(hi, n.time + (n.sustain || 0));
        }
        if (Number.isFinite(lo) && Number.isFinite(hi)) {
            // A note-selection fallback is a whole-bar span, so tag it 'bar'.
            const span = _barSpanForTimes(lo, hi);
            if (span) span.mode = 'bar';
            return span;
        }
    }
    return null;
}

/* @pure:pending-view:start */
function _resolvePendingViewStatePure(pv, fallbackZoom, viewWidthPx, labelW) {
    const nextZoom = (typeof pv.zoom === 'number' && pv.zoom > 0) ? pv.zoom : fallbackZoom;
    const out = {
        returnToHighway: !!pv.returnToHighway,
        barSel: pv.barSel ? { startTime: pv.barSel.startTime, endTime: pv.barSel.endTime, mode: pv.barSel.mode } : null,
        zoom: nextZoom,
        cursorTime: typeof pv.cursorTime === 'number'
            ? pv.cursorTime
            : (pv.barSel ? pv.barSel.startTime : null),
        scrollX: null,
    };
    if (typeof pv.scrollX === 'number') {
        out.scrollX = Math.max(0, pv.scrollX);
    } else if (pv.barSel) {
        const margin = (Math.max(0, viewWidthPx - labelW) * 0.25) / Math.max(0.0001, nextZoom);
        out.scrollX = Math.max(0, pv.barSel.startTime - margin);
    }
    return out;
}
/* @pure:pending-view:end */

// Enable the toolbar button when there's a region to preview (a bar drag OR a
// note selection) on a loaded, playable song. Create-mode sessions have
// nothing on disk for the highway to stream, so they stay disabled.
function _updateLoopIn3DBtn() {
    const btn = document.getElementById('editor-loop3d-btn');
    if (!btn) return;
    const region = _effectiveLoopRegion();
    const ok = !!(region && S.filename && !S.createMode);
    btn.disabled = !ok;
    btn.textContent = S.returnToHighway ? '↩ Back to 3D' : '▶ Loop in 3D';
    btn.title = S.createMode
        ? 'Build the song first to preview it on the 3D highway'
        : (region
            ? (S.returnToHighway
                ? 'Save and preview this region back on the 3D highway'
                : 'Loop this region on the 3D highway')
            : 'Select some notes or set a loop region to pick what the 3D highway should preview');
}
window._editorUpdateLoopIn3DBtn = _updateLoopIn3DBtn;

window.editorLoopIn3D = async () => {
    const region = _effectiveLoopRegion();
    if (!region || !S.filename || S.createMode) return;
    // If saving would defer to the archive-overflow format modal (the
    // arrangement no longer fits the archive's string limit), let the user
    // resolve that first — don't pop the modal AND navigate to the highway on
    // top of it (which would also stream the un-saved chart). saveCDLC() shows
    // the modal; bail out of the handoff so the user can retry after choosing.
    if (S.format === 'archive' && _activeArrangementExceedsArchiveLimit()) {
        await saveCDLC();
        return;
    }
    // Pin the resolved region as the bar selection so it's highlighted and
    // carried in the return context.
    _setBarSel({ startTime: region.startTime, endTime: region.endTime, mode: region.mode });
    const sel = { startTime: region.startTime, endTime: region.endTime, mode: region.mode };
    // Persist edits in place so the highway streams the latest chart. Uses
    // the same save path as the Save button (in-place sloppak write, not the
    // heavy create-mode build).
    if (S.sessionId) {
        try { await saveCDLC(); } catch (e) { /* surfaced via setStatus */ }
    }
    // Capture where we are so the return trip lands on the same spot.
    const returnCtx = {
        filename: S.filename,
        arrangement: S.currentArr,
        scrollX: S.scrollX,
        zoom: S.zoom,
        cursorTime: S.cursorTime,
        barSel: sel,
    };
    window._pendingHighwayLoop = { a: sel.startTime, b: sel.endTime, returnCtx };
    if (typeof window.playSong === 'function') {
        await window.playSong(S.filename, S.currentArr, {});
    }
};

// Consume a pending view handed over by the highway's "Edit region" button
// (or by our own return trip). Called at the tail of loadCDLC once the song
// is loaded, so scroll/arrangement/selection land on the intended region.
function _applyEditorPendingView(filename) {
    const pv = window._editorPendingView;
    if (!pv || pv.filename !== filename) return;
    window._editorPendingView = null;
    if (typeof pv.arrangement === 'number' &&
        pv.arrangement >= 0 && pv.arrangement < S.arrangements.length &&
        pv.arrangement !== S.currentArr) {
        // Reuse the arrangement switch (re-flattens chords, redraws).
        window.editorSelectArrangement(pv.arrangement);
    }
    const viewW = canvas ? (canvas.width / DPR) : 800;
    const next = _resolvePendingViewStatePure(pv, S.zoom, viewW, LABEL_W);
    S.returnToHighway = next.returnToHighway;
    if (next.barSel) _setBarSel(next.barSel);
    if (typeof next.zoom === 'number' && next.zoom > 0) { S.zoom = next.zoom; updateZoomDisplay(); }
    if (typeof next.cursorTime === 'number') S.cursorTime = next.cursorTime;
    if (typeof next.scrollX === 'number') S.scrollX = _editorClampScrollX(next.scrollX);
    else _editorApplyScrollBounds();
    updateStatus();
    _updateLoopIn3DBtn();
    draw();
}

// Allow loading from other plugins/screens
window.editSong = (filename) => {
    showScreen('plugin-editor');
    loadCDLC(filename);
};

// Register an "Open in editor" action on the v3 song-card three-dot menu, so a
// song can be loaded straight into the editor (sibling to core's "Edit
// metadata"). Routed through the shared ui.library-card-injection registry, so
// it only appears when this plugin is loaded — and only in v3, where the
// registry exists (guarded for v2, which has no such menu). register() rejects
// duplicate ids, so re-running the script is a no-op.
(function _registerEditorCardAction() {
    const sm = window.slopsmith;
    if (!sm || !sm.libraryCardActions) return;
    sm.libraryCardActions.register({
        id: 'editor.open-in-editor',
        pluginId: 'editor',
        label: 'Open in editor',
        placement: 'menu',
        order: 15, // just under core's "Edit metadata" (10)
        applies: (song) => !!(song && song.filename),
        run: (song) => window.editSong(song.filename),
    });
})();

// ════════════════════════════════════════════════════════════════════
// Sync Tempo — detect audio BPM and scale notes to match
// ════════════════════════════════════════════════════════════════════

let syncState = { tabBPM: 0, audioBPM: 0 };

function detectAudioBPM() {
    if (!S.audioBuffer) return 0;
    const data = S.audioBuffer.getChannelData(0);
    const sr = S.audioBuffer.sampleRate;

    // Bandpass-approximate: use short + long energy windows for spectral flux
    const winSize = 1024;
    const hopSize = 512;
    const numFrames = Math.floor((data.length - winSize) / hopSize);
    const energy = new Float32Array(numFrames);
    for (let i = 0; i < numFrames; i++) {
        let sum = 0;
        const off = i * hopSize;
        for (let j = 0; j < winSize; j++) {
            sum += data[off + j] * data[off + j];
        }
        energy[i] = Math.sqrt(sum / winSize);
    }

    // Onset: spectral flux with adaptive threshold
    const onset = new Float32Array(numFrames);
    const avgWin = 16;
    for (let i = avgWin; i < numFrames; i++) {
        const diff = Math.max(0, energy[i] - energy[i - 1]);
        // Subtract local average to suppress sustained notes
        let localAvg = 0;
        for (let j = i - avgWin; j < i; j++) localAvg += Math.max(0, energy[j] - energy[j - 1]);
        localAvg /= avgWin;
        onset[i] = Math.max(0, diff - localAvg * 1.2);
    }

    // Autocorrelation for BPM range 60-220
    const frameDur = hopSize / sr;
    const minLag = Math.floor(60 / (220 * frameDur));
    const maxLag = Math.floor(60 / (60 * frameDur));
    const useLen = Math.min(onset.length, Math.floor(30 / frameDur));

    // Collect all peaks, not just the best
    const corrs = new Float32Array(maxLag + 1);
    for (let lag = minLag; lag <= Math.min(maxLag, useLen / 2); lag++) {
        let corr = 0;
        const n = useLen - lag;
        for (let i = 0; i < n; i++) corr += onset[i] * onset[i + lag];
        corrs[lag] = corr;
    }

    // Find top peaks in autocorrelation
    const peaks = [];
    for (let lag = minLag + 1; lag < maxLag; lag++) {
        if (corrs[lag] > corrs[lag - 1] && corrs[lag] > corrs[lag + 1] && corrs[lag] > 0) {
            peaks.push({ lag, corr: corrs[lag], bpm: 60 / (lag * frameDur) });
        }
    }
    peaks.sort((a, b) => b.corr - a.corr);

    if (!peaks.length) return 120;

    // Score each candidate: prefer strong correlation + BPM in 80-180 sweet spot
    // Also check if 2x or 0.5x of a candidate has strong correlation (harmonic check)
    let bestScore = -Infinity;
    let bestBPM = peaks[0].bpm;

    for (const p of peaks.slice(0, 10)) {
        let score = p.corr;

        // Boost BPMs in the 90-180 range (most common for music)
        if (p.bpm >= 90 && p.bpm <= 180) score *= 1.5;
        else if (p.bpm >= 70 && p.bpm <= 200) score *= 1.1;

        // Check if half-tempo has strong support (penalize sub-harmonics)
        const halfLag = Math.round(p.lag / 2);
        if (halfLag >= minLag && halfLag <= maxLag && corrs[halfLag] > p.corr * 0.6) {
            // Half-lag is also strong — this candidate might be a sub-harmonic
            score *= 0.7;
        }

        // Check if double-tempo also has support (confirms this is the real beat)
        const dblLag = p.lag * 2;
        if (dblLag <= maxLag && corrs[dblLag] > p.corr * 0.3) {
            score *= 1.3;
        }

        if (score > bestScore) {
            bestScore = score;
            bestBPM = p.bpm;
        }
    }

    return bestBPM;
}

function getTabBPM() {
    if (S.beats.length < 2) return 120;
    // Find average BPM from downbeats (measure > 0)
    const downbeats = S.beats.filter(b => b.measure > 0);
    if (downbeats.length < 2) {
        // Fallback: use all consecutive beats
        let total = 0;
        for (let i = 1; i < Math.min(S.beats.length, 50); i++) {
            total += S.beats[i].time - S.beats[i - 1].time;
        }
        const avgInterval = total / (Math.min(S.beats.length, 50) - 1);
        return 60 / avgInterval;
    }
    // Measure intervals between consecutive downbeats, divide by beats per measure
    let intervals = [];
    for (let i = 1; i < downbeats.length; i++) {
        const dt = downbeats[i].time - downbeats[i - 1].time;
        // Count beats between these downbeats
        const beatsInMeasure = S.beats.filter(
            b => b.time >= downbeats[i - 1].time && b.time < downbeats[i].time
        ).length;
        if (beatsInMeasure > 0) intervals.push(dt / beatsInMeasure);
    }
    if (!intervals.length) return 120;
    const avg = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    return 60 / avg;
}

window.editorSyncTempo = () => {
    if (!S.audioBuffer || S.beats.length < 2) {
        setStatus('Need audio and beats loaded for sync');
        return;
    }

    setStatus('Detecting audio BPM...');
    syncState.tabBPM = getTabBPM();
    syncState.audioBPM = detectAudioBPM();

    document.getElementById('sync-tab-bpm').textContent = syncState.tabBPM.toFixed(1);
    document.getElementById('sync-audio-bpm').textContent = syncState.audioBPM.toFixed(1);
    document.getElementById('sync-manual-bpm').value = '';
    document.getElementById('sync-offset').value = '0';
    window.editorSyncUpdateFactor();

    const dlg = document.getElementById('editor-sync-dialog');
    const btn = document.getElementById('editor-sync-btn');
    const rect = btn.getBoundingClientRect();
    dlg.style.left = rect.left + 'px';
    dlg.style.top = (rect.bottom + 4) + 'px';
    dlg.classList.remove('hidden');
    setStatus('Ready');
};

window.editorSyncUpdateFactor = () => {
    const manual = parseFloat(document.getElementById('sync-manual-bpm').value);
    const audioBPM = manual > 0 ? manual : syncState.audioBPM;
    const factor = audioBPM / syncState.tabBPM;
    document.getElementById('sync-factor').textContent = factor.toFixed(4);
    if (manual > 0) {
        document.getElementById('sync-audio-bpm').textContent = manual.toFixed(1) + ' (manual)';
    } else {
        document.getElementById('sync-audio-bpm').textContent = syncState.audioBPM.toFixed(1);
    }
};

window.editorHideSyncDialog = () => {
    document.getElementById('editor-sync-dialog').classList.add('hidden');
};

window.editorApplySync = () => {
    const manual = parseFloat(document.getElementById('sync-manual-bpm').value);
    const audioBPM = manual > 0 ? manual : syncState.audioBPM;
    const factor = audioBPM / syncState.tabBPM;
    const offset = parseFloat(document.getElementById('sync-offset').value) || 0;

    if (factor <= 0 || !isFinite(factor)) return;

    // Build the new grid first: unlocked beats scale, but a locked sync point
    // holds its time through the re-fit and the runs re-space around the locks.
    const oldBeats = S.beats.map(b => ({ ...b }));
    const scaledBeats = S.beats.map(b => ({ ...b, time: b.time / factor + offset }));
    const respaced = _respaceWithLocksPure(oldBeats, scaledBeats);

    // With a lock present the grid warps, so reproject note times from the OLD
    // grid onto the new one (beat is truth), exactly as the TempoMapCmd tempo
    // paths do — a note stays on the grid even right next to a lock. Without a
    // lock _respaceWithLocksPure hands back `scaledBeats` unchanged; keep the
    // plain linear scale there — it is identical to the reproject for a real
    // grid (timeOf∘beatOf round-trips through an affine map) and, unlike the
    // reproject, still scales notes on a degenerate <2-beat grid (where
    // beatOf/timeOf are identity).
    const locked = respaced !== scaledBeats;
    const nn = notes();
    for (const n of nn) {
        if (locked) {
            const t = timeOf(respaced, beatOf(oldBeats, n.time));
            if (n.sustain) {
                const endT = timeOf(respaced, beatOf(oldBeats, n.time + n.sustain));
                n.sustain = Math.max(0, endT - t);
            }
            n.time = t;
        } else {
            n.time = n.time / factor + offset;
            if (n.sustain) n.sustain = n.sustain / factor;
        }
    }

    for (let i = 0; i < S.beats.length; i++) S.beats[i].time = respaced[i].time;

    // Scale section times — like notes, reproject onto the warped grid under a
    // lock (beat is truth) and keep the plain linear scale when unlocked.
    for (const s of S.sections) {
        s.start_time = locked
            ? timeOf(respaced, beatOf(oldBeats, s.start_time))
            : s.start_time / factor + offset;
    }

    window.editorHideSyncDialog();
    draw();
    setStatus(`Tempo synced: scaled ${factor.toFixed(4)}x` + (offset ? `, offset ${offset}s` : ''));
};
// Entry landing — shown when you open the Song Editor with nothing loaded:
// Load an existing feedpak, or Create New. (The toolbar Load / New… buttons
// remain for use once you're already inside.)
// ════════════════════════════════════════════════════════════════════
window.editorShowStartLanding = () => {
    document.getElementById('editor-start-landing')?.remove();
    const modal = document.createElement('div');
    modal.id = 'editor-start-landing';
    modal.className = 'fixed inset-0 bg-black/70 z-50 flex items-center justify-center';
    const inner = document.createElement('div');
    inner.className = 'bg-dark-800 border border-gray-700 rounded-xl p-6 max-w-md w-full mx-4';
    const h = document.createElement('h3');
    h.className = 'text-lg font-semibold mb-1';
    h.textContent = 'Song Editor';
    const sub = document.createElement('p');
    sub.className = 'text-xs text-gray-400 mb-4';
    sub.textContent = 'Open an existing feedpak to edit, or start a new arrangement.';
    inner.appendChild(h); inner.appendChild(sub);
    const mk = (label, blurb, onClick) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'w-full text-left p-3 mb-2 bg-dark-700 hover:bg-dark-600 rounded border border-gray-700';
        const t = document.createElement('div'); t.className = 'font-medium text-sm'; t.textContent = label;
        const p = document.createElement('div'); p.className = 'text-xs text-gray-400 mt-1'; p.textContent = blurb;
        b.appendChild(t); b.appendChild(p);
        b.onclick = () => { modal.remove(); onClick(); };
        return b;
    };
    inner.appendChild(mk('📂  Load…',
        'Browse your song library and open a feedpak to edit.',
        () => window.editorShowLoadModal()));
    inner.appendChild(mk('✨  Create New',
        'Pick what you’re arranging, import a chart or audio, add details.',
        () => window.editorShowCreateModal()));
    const cancel = document.createElement('div'); cancel.className = 'flex justify-end mt-2';
    const cb = document.createElement('button');
    cb.type = 'button';
    cb.className = 'px-3 py-1 bg-dark-700 hover:bg-dark-600 rounded text-xs text-gray-400';
    cb.textContent = 'Not now';
    cb.onclick = () => modal.remove();
    cancel.appendChild(cb); inner.appendChild(cancel);
    modal.appendChild(inner);
    _installModalKeyboard(modal, inner, () => modal.remove());
    document.body.appendChild(modal);
    inner.querySelector('button')?.focus();
};

// Show the landing only on a genuinely empty editor — nothing loaded, no load
// in flight, no create session, and no create/load modal already open.
function _editorMaybeShowStartLanding() {
    if (_editorLoadsInFlight > 0) return;
    const loaded = !!(typeof S !== 'undefined' && S && (S.filename || S.sessionId
        || (Array.isArray(S.arrangements) && S.arrangements.length)));
    if (loaded) return;
    if (document.getElementById('editor-start-landing')) return;
    const createHidden = document.getElementById('editor-create-modal')?.classList.contains('hidden');
    const loadHidden = document.getElementById('editor-load-modal')?.classList.contains('hidden');
    if (createHidden === false || loadHidden === false) return;   // a modal is open
    window.editorShowStartLanding();
}

// ════════════════════════════════════════════════════════════════════
// Replace audio
// ════════════════════════════════════════════════════════════════════

let replaceAudioState = { audioMode: 'file' };

window.editorShowReplaceAudioModal = () => {
    if (!S.sessionId) return;
    replaceAudioState = { audioMode: 'file' };
    document.getElementById('editor-replace-audio').value = '';
    document.getElementById('editor-replace-yt-url').value = '';
    document.getElementById('editor-replace-audio-status').textContent = '';
    document.getElementById('editor-replace-audio-apply').disabled = false;
    document.getElementById('editor-replace-audio-modal').classList.remove('hidden');
    window.editorSetReplaceAudioMode('file');
};

window.editorHideReplaceAudioModal = () => {
    document.getElementById('editor-replace-audio-modal').classList.add('hidden');
};

window.editorSetReplaceAudioMode = (mode) => {
    replaceAudioState.audioMode = mode;
    document.getElementById('editor-replace-audio-file-input').classList.toggle('hidden', mode !== 'file');
    document.getElementById('editor-replace-audio-yt-input').classList.toggle('hidden', mode !== 'youtube');
    document.getElementById('editor-replace-mode-file').classList.toggle('is-active', mode === 'file');
    document.getElementById('editor-replace-mode-yt').classList.toggle('is-active', mode === 'youtube');
};

async function _uploadReplaceAudio() {
    const statusEl = document.getElementById('editor-replace-audio-status');
    // Pre-check missing input so we surface a hint here (the shared helper
    // returns null silently on missing input so the create-modal flow's
    // optional-audio path keeps its existing no-status behavior).
    if (replaceAudioState.audioMode === 'youtube') {
        if (!document.getElementById('editor-replace-yt-url').value.trim()) {
            statusEl.textContent = 'Enter a YouTube URL';
            return null;
        }
    } else if (!document.getElementById('editor-replace-audio').files.length) {
        statusEl.textContent = 'Choose a file';
        return null;
    }
    return _uploadAudioForMode({
        mode: replaceAudioState.audioMode,
        ytInputId: 'editor-replace-yt-url',
        fileInputId: 'editor-replace-audio',
        statusEl,
    });
}

window.editorApplyReplaceAudio = async () => {
    if (!S.sessionId) return;
    const status = document.getElementById('editor-replace-audio-status');
    const apply = document.getElementById('editor-replace-audio-apply');
    apply.disabled = true;
    try {
        const audioUrl = await _uploadReplaceAudio();
        if (!audioUrl) { apply.disabled = false; return; }

        const resp = await fetch('/api/plugins/editor/replace-audio', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ session_id: S.sessionId, audio_url: audioUrl }),
        });
        const data = await resp.json();
        if (data.error) {
            status.textContent = 'Error: ' + data.error;
            apply.disabled = false;
            return;
        }

        // Keep create-mode build in sync — Build Song reads createState.audioUrl.
        if (S.createMode) createState.audioUrl = audioUrl;

        // Stop active playback before swapping the buffer; otherwise the old
        // BufferSource keeps playing under the new S.audioBuffer/duration and
        // playbackTick desyncs against the new track length.
        if (S.playing) stopPlayback();
        // loadAudio() swallows fetch/decode errors and only logs to console,
        // so detect failure by checking that the buffer reference actually
        // changed. Without this we would close the modal and announce
        // "Audio replaced" even on an unsupported / corrupt upload.
        const prevBuffer = S.audioBuffer;
        await loadAudio(audioUrl);
        if (!S.audioBuffer || S.audioBuffer === prevBuffer) {
            status.textContent = 'Failed to decode audio (unsupported format?)';
            apply.disabled = false;
            return;
        }
        if (S.cursorTime > S.duration) S.cursorTime = 0;
        _editorApplyScrollBounds();
        document.getElementById('editor-play-btn').disabled = false;
        document.getElementById('editor-sync-btn').classList.remove('hidden');
        updateTimeDisplay();
        draw();

        const HINTS = {
            none:    'Audio replaced',
            save:    'Audio replaced (Save to persist to .sloppak)',
            build:   'Audio replaced (will persist on next Build feedpak)',
            rebuild: "Audio replaced (playback only — archive won't be repacked)",
        };
        window.editorHideReplaceAudioModal();
        setStatus(HINTS[data.next_step] || (data.persisted ? HINTS.none : HINTS.rebuild));
    } catch (e) {
        status.textContent = 'Failed: ' + e.message;
        apply.disabled = false;
    }
};

// ════════════════════════════════════════════════════════════════════
// Init
// ════════════════════════════════════════════════════════════════════

// In the fee[dB]ack v0.3.0 "v3" shell the editor renders inside #v3-main — a
// scrolling region whose first child is the (tall, ~170px) #v3-topbar, with the
// screens stacked below it. The legacy root uses `h-screen pt-16`, which makes
// the editor a full 100vh tall (so it overflows past the topbar) and pads the
// top for the now-hidden legacy navbar. In v3 we instead size the root to the
// space left under the topbar — height: calc(100vh - <topbar height>) — and
// keep it in normal flow, so the DAW gets a proper full height WITHOUT covering
// the topbar's search/nav (a ResizeObserver tracks topbar height changes). The
// classic UI is untouched.
let _v3LayoutObs = null;
let _v3TopbarWatch = null;
function _applyV3Layout() {
    if (!(window.slopsmith && window.slopsmith.uiVersion === 'v3')) return;
    const screen = document.getElementById('plugin-editor');
    const root = screen && screen.firstElementChild;
    if (!screen || !root || screen.dataset.v3Layout === '1') return;
    root.classList.remove('h-screen', 'pt-16');
    // Mark the screen container (not just the root) so the shipped v3 theme
    // sheet — scoped under [data-v3-layout="1"] — also reaches the editor's
    // modals/dialogs, which are siblings of the root inside #plugin-editor.
    screen.dataset.v3Layout = '1';
    // Re-query the topbar each call so a topbar that mounts AFTER us is still
    // accounted for (height falls back to full-viewport only while it's absent).
    const fit = () => {
        const tb = document.getElementById('v3-topbar');
        const h = tb ? Math.round(tb.getBoundingClientRect().height) : 0;
        root.style.height = 'calc(100vh - ' + h + 'px)';
        // The wrapper height changed — recompute the canvas backing size and
        // lane geometry (the window-resize path does this too).
        if (typeof resizeCanvas === 'function') resizeCanvas();
    };
    // The editor plugin can initialise before the v3 shell mounts #v3-topbar.
    // Keep fitting until the topbar exists, then attach a ResizeObserver to it
    // (responsive wrap / async-filled content). Bounded so it can't spin forever.
    let tries = 0;
    const ensure = () => {
        fit();
        const tb = document.getElementById('v3-topbar');
        if (tb) {
            if (_v3TopbarWatch) { _v3TopbarWatch.disconnect(); _v3TopbarWatch = null; }
            if (typeof ResizeObserver === 'function' && !_v3LayoutObs) {
                _v3LayoutObs = new ResizeObserver(fit);
                _v3LayoutObs.observe(tb);
            }
        } else if (tries++ < 120) {
            requestAnimationFrame(ensure);
        } else if (!_v3TopbarWatch && typeof MutationObserver === 'function' && document.body) {
            // Topbar still absent after the rAF window — watch the DOM so an
            // unusually late mount can't leave the editor stuck at
            // calc(100vh - 0px). Disconnected as soon as the topbar appears.
            _v3TopbarWatch = new MutationObserver(() => {
                if (document.getElementById('v3-topbar')) ensure();
            });
            _v3TopbarWatch.observe(document.body, { childList: true, subtree: true });
            // Never let the body observer linger: drop it after 10s even if the
            // topbar never mounts, so it can't sit subtree-watching forever.
            setTimeout(() => {
                if (_v3TopbarWatch) { _v3TopbarWatch.disconnect(); _v3TopbarWatch = null; }
            }, 10000);
        }
    };
    ensure();
}

let _editorInited = false;
function init() {
    // setCanvas is the only writer of `canvas`/`ctx` (src/canvas.js); everything
    // else imports them as live, read-only bindings.
    if (!setCanvas(document.getElementById('editor-canvas'))) return;
    // Idempotency guard: within a single injection init() must run exactly
    // once. A re-injection re-executes this whole IIFE fresh (flag resets), so
    // this only blocks a stray double-invocation (e.g. a late boot-poll tick).
    if (_editorInited) return;
    _editorInited = true;
    _applyV3Layout();
    S.history = new EditHistory();

    _editorLoadShortcutProfile();

    // Canvas-level listeners die with the canvas node on re-injection;
    // only document/window-level ones must go through the tracked registry.
    canvas.addEventListener('mousedown', onMouseDown);
    _globalListeners.add(document, 'mousemove', onMouseMove);
    _globalListeners.add(document, 'mouseup', onMouseUp);
    canvas.addEventListener('dblclick', onDblClick);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('contextmenu', onContextMenu);
    _globalListeners.add(document, 'keydown', onKeyDown);
    document.getElementById('editor-loop-strip-track')?.addEventListener('mousedown', _loopStripOnMouseDown);
    document.getElementById('editor-loop-strip-start')?.addEventListener('keydown', (e) => _loopHandleKeydown('start', e));
    document.getElementById('editor-loop-strip-end')?.addEventListener('keydown', (e) => _loopHandleKeydown('end', e));
    document.getElementById('editor-loop-strip-clear')?.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); _clearBarSelection(); });

    // Prevent middle-click paste
    canvas.addEventListener('auxclick', (e) => { if (e.button === 1) e.preventDefault(); });

    resizeCanvas();
    _globalListeners.add(window, 'resize', resizeCanvas);
    // src/create.js's global 'input' listener. It used to be a top-level
    // statement in this file; a module must not have import-time side effects.
    initCreate();

    // Observe screen visibility for resize + the entry landing. Held in
    // _editorScreenObs so the teardown can disconnect it on re-injection.
    const obs = new MutationObserver(() => {
        const screen = document.getElementById('plugin-editor');
        if (screen && screen.classList.contains('active')) {
            setTimeout(resizeCanvas, 50);
            // Entering the Song Editor with nothing loaded → offer Load / Create.
            setTimeout(_editorMaybeShowStartLanding, 80);
        }
    });
    const screen = document.getElementById('plugin-editor');
    if (screen) obs.observe(screen, { attributes: true, attributeFilter: ['class'] });
    _editorScreenObs = obs;
    // Also cover the case where the editor screen is already active at init().
    if (screen && screen.classList.contains('active')) {
        setTimeout(_editorMaybeShowStartLanding, 120);
    }

    draw();
}

// ════════════════════════════════════════════════════════════════════
// Reorder parts (DAW-workspace 2.2b) — move the current part one slot
// earlier/later. Order persists: sloppak saves ship the CLIENT
// S.arrangements array as the full snapshot, and the manifest merge
// keys entries by id, so the new order lands on disk at the next save.
// ════════════════════════════════════════════════════════════════════

/* @pure:reorder-part:start */
// Target index for a one-slot move, or -1 when it can't move (ends,
// bad input). dir < 0 = earlier (toward index 0), dir > 0 = later.
function _movePartTargetPure(from, dir, count) {
    const f = Number(from), n = Number(count);
    if (!Number.isInteger(f) || !Number.isInteger(n) || n < 2) return -1;
    if (f < 0 || f >= n) return -1;
    const to = f + (dir < 0 ? -1 : 1);
    return (to < 0 || to >= n) ? -1 : to;
}
/* @pure:reorder-part:end */

function _editorMovePart(dir) {
    if (_recState !== 'idle') {
        setStatus('Cannot reorder while recording. Stop the take first.');
        return true;
    }
    // The reorder persists only through the full-snapshot sloppak save
    // (see updateArrangementSelector's button gate). On an archive save
    // `_buildSaveBody` ships just the active arrangement keyed by index,
    // so a client-side reorder would be lost — or re-target the wrong
    // part via the now-stale `arrangement_index`. Refuse here too so the
    // command palette / keyboard paths can't bypass the hidden buttons.
    if (S.format !== 'sloppak') {
        setStatus('Reordering parts is only available for Sloppak songs.');
        return true;
    }
    const from = S.currentArr;
    const to = _movePartTargetPure(from, dir, S.arrangements.length);
    if (to < 0) return true;   // at an end / nothing to do
    const [moved] = S.arrangements.splice(from, 1);
    S.arrangements.splice(to, 0, moved);
    // The move renumbers arrangement indices, so history commands tagged
    // with the old indices would undo into the wrong part — same rationale
    // as remove-arrangement: drop the stack when the model shifts under it.
    // (Which is also why the move itself is not undoable — move it back.)
    if (S.history) S.history.reset();
    S.currentArr = to;
    S.sel.clear();
    updateArrangementSelector();
    draw();
    updateStatus();
    setStatus(`Moved “${moved.name || 'part'}” ${dir < 0 ? 'earlier' : 'later'} — the order persists on save`);
    return true;
}
window.editorMovePart = _editorMovePart;

// ════════════════════════════════════════════════════════════════════
// Remove arrangement
// ════════════════════════════════════════════════════════════════════

// ── Part rename (EDITOR-VIEW-MODALITY / DAW-workspace 2.2b) ──────────
// Unblocked by the manifest `type` stamping + merge-not-rebuild save
// (#101): a rename no longer strips the entry's `type`/unknown keys, and
// sloppak sessions carry a stable `id` the view prefs key off. One hard
// limit stays, enforced honestly: the NAME still drives kind inference
// (keys → piano roll + notation sidecar, /bass/i → 4-lane layout,
// /^drums/i → drum routing), so a rename that would CHANGE the inferred
// kind is refused — silently re-laning a 6-string chart as a 4-string
// bass would strand notes on invisible strings.

/* @pure:rename-arr:start */
// A part name feeds TWO independent interpreters, and a rename must not shift
// the chart under EITHER of them:
//   • the runtime lane/roll router — prefix-anchored KEYS_PATTERN
//     (/^(keys|piano|keyboard|synth)/i), then /^drums/i, then /bass/i. This
//     is what the LIVE editor draws (piano roll vs 4/6 lanes vs drums).
//   • the SAVE side (routes.py) — word-boundary \b(keys|piano|keyboard|
//     synth)\b stamps manifest `type: piano` + a keys notation sidecar, and
//     /bass/i stamps `type: bass`. This is what a reload re-lanes from.
// The two KEYS rules disagree on real names: "Electric Piano" is save-keys
// but runtime-guitar; "Synthwave" is runtime-keys but save-guitar. Collapsing
// them into one "kind" hides exactly those disagreements — the ones that flip
// a chart's layout on save (runtime-guitar → save-keys) or on the very next
// draw (runtime-keys → save-guitar). So the guard compares BOTH facets and
// refuses when either moves; a rename is safe only when every interpreter
// still reads the same instrument.
const _KEYS_NAME_WB = /\b(keys|piano|keyboard|synth)\b/i;
// Runtime lane/roll kind — what the live editor shows (mirrors isKeysMode /
// isBassArr / the /^drums/ routing, all name-driven and prefix-anchored).
function _arrKindPure(name) {
    const n = String(name || '');
    if (KEYS_PATTERN.test(n)) return 'keys';
    if (/^drums/i.test(n)) return 'drums';
    if (/bass/i.test(n)) return 'bass';
    return 'guitar';
}
// Persisted kind — the manifest `type` / notation-sidecar decision on save
// (routes.py `_KEYS_NAME_RE` word-boundary keys, then `_TYPE_BASS_RE` /bass/).
function _arrSaveKindPure(name) {
    const n = String(name || '');
    if (_KEYS_NAME_WB.test(n)) return 'keys';
    if (/bass/i.test(n)) return 'bass';
    return 'other';
}
// Display label for the refusal message: the instrument a human reads off the
// name, keys-first so either rule surfaces it.
function _arrKindLabelPure(name) {
    const n = String(name || '');
    if (KEYS_PATTERN.test(n) || _KEYS_NAME_WB.test(n)) return 'keys';
    if (/^drums/i.test(n)) return 'drums';
    if (/bass/i.test(n)) return 'bass';
    return 'guitar';
}
// Validate a rename: trimmed non-empty, bounded, unique among the OTHER
// parts (case-insensitive — the save-side name discipline), and never a
// kind change under EITHER interpreter. Returns {ok, reason, name} with the
// trimmed name.
function _renameGuardPure(oldName, rawNewName, otherNames) {
    const name = String(rawNewName || '').trim();
    if (!name) return { ok: false, reason: 'Name can’t be empty.', name };
    if (name.length > 60) return { ok: false, reason: 'Name too long (max 60 characters).', name };
    if (name === String(oldName || '')) return { ok: false, reason: '', name };  // silent no-op
    const taken = new Set((otherNames || []).map(n => String(n || '').trim().toLowerCase()));
    if (taken.has(name.toLowerCase())) {
        return { ok: false, reason: `Another part is already named “${name}”.`, name };
    }
    const runtimeMoved = _arrKindPure(oldName) !== _arrKindPure(name);
    const saveMoved = _arrSaveKindPure(oldName) !== _arrSaveKindPure(name);
    if (runtimeMoved || saveMoved) {
        const oldLabel = _arrKindLabelPure(oldName);
        const newLabel = _arrKindLabelPure(name);
        const reason = (oldLabel !== newLabel)
            // A clean instrument change (e.g. guitar → bass, guitar → keys).
            ? `That name would change the part’s instrument (${oldLabel} → ${newLabel}) — `
                + 'lane layout and notation still key off the name. Add a new part instead.'
            // Same label, but the two interpreters disagree on this exact name
            // (e.g. "Piano" → "Electric Piano": the editor keys off the first
            // word and would drop to guitar lanes, while the save still writes
            // keys). Re-laning either way strands notes, so refuse.
            : 'That name is read differently by the editor and the saved file, so it would '
                + 'change the part’s layout. The editor keys off the FIRST word, the save off '
                + 'any keys word — pick a name both agree on.';
        return { ok: false, reason, name };
    }
    return { ok: true, reason: '', name };
}
/* @pure:rename-arr:end */

// Undoable rename. Holds the arrangement INDEX (undo can fire after a
// switch; EditHistory's per-arrangement tagging routes back) plus both
// names; exec/rollback refresh the selector so the dropdown text follows.
class RenameArrangementCmd {
    constructor(arrIdx, newName) {
        this.arrIdx = arrIdx;
        this.newName = newName;
        const arr = S.arrangements[arrIdx];
        this.oldName = arr ? (arr.name || '') : '';
    }
    _set(name) {
        const arr = S.arrangements[this.arrIdx];
        if (!arr) return;
        arr.name = name;
        if (typeof updateArrangementSelector === 'function') updateArrangementSelector();
    }
    exec() { this._set(this.newName); }
    rollback() { this._set(this.oldName); }
}

window.editorRenameArrangement = async () => {
    if (_recState !== 'idle') {
        setStatus('Cannot rename while recording. Stop the take first.');
        return;
    }
    const arr = S.arrangements[S.currentArr];
    if (!arr) return;
    const val = await _editorPromptText({
        title: 'Rename Part',
        label: 'Part name (display label — the instrument kind can’t change here)',
        value: String(arr.name || ''),
    });
    if (val === null) return;
    const others = S.arrangements
        .filter((_, i) => i !== S.currentArr)
        .map(a => a && a.name);
    const guard = _renameGuardPure(arr.name, val, others);
    if (!guard.ok) {
        if (guard.reason) setStatus(guard.reason);
        return;
    }
    S.history.exec(new RenameArrangementCmd(S.currentArr, guard.name));
    draw();
    updateStatus();
    setStatus(`Renamed to “${guard.name}”`);
};

window.editorRemoveArrangement = async () => {
    if (_recState !== 'idle') {
        setStatus('Cannot remove an arrangement while recording. Stop the take first.');
        return;
    }
    if (S.arrangements.length <= 1) return;
    const removeIdx = S.currentArr;
    const arr = S.arrangements[removeIdx];
    if (!confirm(`Remove "${arr.name}" arrangement?`)) return;

    // Remove from backend first
    if (S.sessionId) {
        try {
            const resp = await fetch('/api/plugins/editor/remove-arrangement', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    session_id: S.sessionId,
                    arrangement_index: removeIdx,
                }),
            });
            const result = await resp.json();
            if (result.error) {
                setStatus('Remove failed: ' + result.error);
                return;
            }
        } catch (e) {
            setStatus('Remove failed: ' + e.message);
            return;
        }
    }

    // Then update frontend state
    S.arrangements.splice(removeIdx, 1);
    // The splice renumbers every arrangement after removeIdx, so history
    // commands tagged with the old indices (and the note indices inside them)
    // would undo into the wrong arrangement. Same rationale as the
    // reconstructChords() reset (#18): drop the stack when the model shifts
    // under it.
    if (S.history) S.history.reset();
    S.currentArr = Math.min(removeIdx, S.arrangements.length - 1);
    S.sel.clear();
    flattenChords();
    updateArrangementSelector();
    document.getElementById('editor-arrangement').value = S.currentArr;
    updateStatus();
    draw();
    setStatus(`Removed "${arr.name}" arrangement`);
};

// ════════════════════════════════════════════════════════════════════
// Add Drums — drum_tab.json import from a GP or MIDI file.
// Persists via _buildSaveBody's `drum_tab` field on the next save_song.
// ════════════════════════════════════════════════════════════════════

// Buffered state from the upload phase: a successful parse stores the
// server-side temp path + file kind here, then editorDoAddDrums commits.
// Cleared on every modal-open and on every fresh file selection.
let _addDrumsFile = null;  // { kind: 'gp' | 'midi', path: string }

window.editorShowAddDrumsModal = () => {
    _addDrumsFile = null;
    document.getElementById('editor-add-drums-modal').classList.remove('hidden');
    document.getElementById('editor-add-drums-tracks').classList.add('hidden');
    document.getElementById('editor-add-drums-go').disabled = true;
    document.getElementById('editor-add-drums-status').textContent = '';
    const fileInput = document.getElementById('editor-add-drums-gp');
    if (fileInput) fileInput.value = '';
    // Show the "will replace" notice only when a drum_tab already lives on
    // the sloppak so the user knows what's about to happen.
    const existingEl = document.getElementById('editor-add-drums-existing');
    if (existingEl) {
        existingEl.classList.toggle('hidden', !S.drumTab);
    }
};

window.editorHideAddDrumsModal = () => {
    document.getElementById('editor-add-drums-modal').classList.add('hidden');
};

// File-kind dispatcher — GP path lists tracks via /import-gp, MIDI path
// via /import-drums-midi-list. Both eventually populate the same picker.
window.editorDrumsFileSelected = async (input) => {
    const file = input.files[0];
    if (!file) return;

    const statusEl = document.getElementById('editor-add-drums-status');
    const goBtn = document.getElementById('editor-add-drums-go');

    // Drop any prior successful parse so a later failure can't commit via
    // the older file's path.
    _addDrumsFile = null;
    goBtn.disabled = true;
    document.getElementById('editor-add-drums-tracks').classList.add('hidden');

    // Detect "no extension" explicitly — `split('.').pop()` on a dotless
    // filename returns the whole name, which would otherwise surface a
    // misleading "Unsupported file type: drums" message.
    const dotIdx = file.name.lastIndexOf('.');
    const ext = dotIdx >= 0 ? file.name.slice(dotIdx + 1).toLowerCase() : '';
    const isMidi = (ext === 'mid' || ext === 'midi');
    const isGp = ['gp', 'gp3', 'gp4', 'gp5', 'gpx'].includes(ext);
    if (!isMidi && !isGp) {
        statusEl.textContent = 'Unsupported file type (expected .gp* or .mid/.midi)';
        return;
    }

    statusEl.textContent = isMidi ? 'Parsing MIDI file...' : 'Parsing GP file...';
    const formData = new FormData();
    formData.append('file', file);

    try {
        const url = isMidi
            ? '/api/plugins/editor/import-drums-midi-list'
            : '/api/plugins/editor/import-gp';
        const resp = await fetch(url, { method: 'POST', body: formData });
        const data = await resp.json();
        if (data.error) {
            statusEl.textContent = 'Error: ' + data.error;
            return;
        }

        // Both endpoints return `{tracks: [...]}` shaped the same way.
        // GP returns every track and we filter to drum/percussion; MIDI
        // returns channel-9 only so the filter is a no-op there.
        const tracks = data.tracks || [];
        const drumTracks = isMidi
            ? tracks
            : tracks.filter(t => (t.is_drums || t.is_percussion) && t.notes > 0);
        if (drumTracks.length === 0) {
            statusEl.textContent = isMidi
                ? 'No drum (channel-10) tracks found in this MIDI file.'
                : 'No drum/percussion tracks found in this GP file.';
            return;
        }

        const path = isMidi ? data.midi_path : data.gp_path;
        _addDrumsFile = { kind: isMidi ? 'midi' : 'gp', path };

        const listEl = document.getElementById('editor-add-drums-track-list');
        listEl.innerHTML = drumTracks.map((t, i) => {
            const safeName = _editorEscHtml(t.name);
            const checked = i === 0 ? 'checked' : '';
            return `<label class="flex items-center gap-2 text-xs text-gray-300 py-0.5">
                <input type="radio" name="drums-track" value="${Number.isFinite(Number(t.index)) ? Number(t.index) : 0}" ${checked} class="accent-accent">
                <span class="text-gray-300 flex-1">${safeName}</span>
                <span class="px-1.5 py-0.5 rounded text-[10px] font-medium shrink-0" style="background:rgba(245,158,11,0.16);color:#fcd34d">Drums</span>
                <span class="text-gray-600 shrink-0">${Number(t.notes) || 0} notes</span>
            </label>`;
        }).join('');
        document.getElementById('editor-add-drums-tracks').classList.remove('hidden');
        goBtn.disabled = false;
        statusEl.textContent = `Found ${drumTracks.length} drum track(s).`;
    } catch (e) {
        statusEl.textContent = 'Failed: ' + e.message;
    }
};

// Back-compat alias — the modal HTML used to call this; some test
// scaffolds might still wire it up. Forwards to the new dispatcher.
window.editorDrumsGPSelected = (input) => window.editorDrumsFileSelected(input);

window.editorDoAddDrums = async () => {
    if (!_addDrumsFile || !S.sessionId) return;

    const statusEl = document.getElementById('editor-add-drums-status');
    const goBtn = document.getElementById('editor-add-drums-go');
    goBtn.disabled = true;
    statusEl.textContent = 'Importing drum track...';

    const radio = document.querySelector('input[name="drums-track"]:checked');
    const trackIndex = radio ? parseInt(radio.value) : 0;

    try {
        const url = _addDrumsFile.kind === 'midi'
            ? '/api/plugins/editor/import-drums-midi'
            : '/api/plugins/editor/import-drums-tab';
        const bodyKey = _addDrumsFile.kind === 'midi' ? 'midi_path' : 'gp_path';
        const resp = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                [bodyKey]: _addDrumsFile.path,
                track_index: trackIndex,
                audio_offset: _effectiveAudioOffset(),
            }),
        });
        const data = await resp.json();
        if (data.error || !data.drum_tab) {
            statusEl.textContent = 'Error: ' + (data.error || 'no drum_tab in response');
            goBtn.disabled = false;
            return;
        }

        // Stash on session state; the next save_song ships it as
        // `drum_tab` and the backend writes drum_tab.json + manifest key.
        // Normalize hits: ensure sorted by t so drum-editor hit-testing and
        // dragging work correctly, and clear any stale selection so indices
        // from the old tab don't point into the new hits array.
        S.drumTab = data.drum_tab;
        if (S.drumTab && Array.isArray(S.drumTab.hits)) {
            S.drumTab.hits.sort((a, b) => (a.t || 0) - (b.t || 0));
        }
        S.drumTabDirty = true;  // user-imported — persist on next save
        S.drumSel = new Set();

        window.editorHideAddDrumsModal();
        const hitCount = Array.isArray(data.drum_tab.hits)
            ? data.drum_tab.hits.length : 0;
        const unmapped = Array.isArray(data.unmapped) ? data.unmapped : [];
        const droppedCount = unmapped.reduce((s, u) => s + Math.max(0, Number(u.count) || 0), 0);
        if (droppedCount > 0) {
            setStatus(`Drum tab imported (${hitCount} hits, ${droppedCount} unmapped — see dialog) — save to persist`);
        } else {
            setStatus(`Drum tab imported (${hitCount} hits) — save to persist`);
        }
        // Refresh the toolbar drum button (text/colour) and canvas so the
        // user immediately sees the "⟳ Drums (N)" state without waiting for
        // an unrelated redraw.
        updateArrangementSelector();
        draw();
        // Offer the MIDI's own tempo/time-signature grid first (DAW 3.2;
        // no-op for GP imports or a gridless MIDI), then chain the unmapped-
        // notes triage so the two dialogs never stack. Surface the manual-
        // mapping UI only when there are actual notes to triage — gate on
        // droppedCount, not unmapped.length, so an empty row can't open a
        // hollow dialog.
        _maybeOfferMidiTempoMap(data.tempo_map, () => {
            if (droppedCount > 0) {
                _showDrumImportUnmappedModal(unmapped);
            }
        });
    } catch (e) {
        statusEl.textContent = 'Failed: ' + e.message;
        goBtn.disabled = false;
    }
};

// ════════════════════════════════════════════════════════════════════
// Strings (tuning) editor — add/remove strings on the active arrangement
// ════════════════════════════════════════════════════════════════════

/* @pure:string-tuning:start */
// Range per role. Bass 4–6 (add low B, then high C). Guitar 6–8 (add low
// B, then low F#). These floors/ceilings are NOT free policy: the pitch
// and label model (`_openMidiForArr` / `laneLabels`) can only represent a
// FIXED set of extended shapes — guitar strings are prepended at the low
// end, bass adds low B at the 5th then high C at the 6th. A guitar below
// 6 or a string added at the "wrong" end has no consistent open-pitch or
// label, so `_stringCountFor` would re-snap the count and silently
// re-interpret every note index. The modal therefore offers each add/
// remove only at the end the model supports (see `_addPositionPure` /
// `_removePositionPure`); direct per-string tuning entry below covers the
// exotic tunings (drop/open/re-entrant) that changing the COUNT cannot.
function _stringsRangePure(isBass) {
    return isBass ? { min: 4, max: 6 } : { min: 6, max: 8 };
}

// The only END an add may touch for a given role + current count, or null
// when the arrangement is at its ceiling. Mirrors the fixed extension
// order baked into `_openMidiForArr`/`laneLabels`: bass grows low (4→5)
// then high (5→6); guitar grows low (6→7→8). Adding at any other end
// yields a count/label/pitch shape the renderer can't represent, so the
// modal never offers it. Pure — role + count in, position out.
function _addPositionPure(isBass, cur) {
    if (isBass) {
        if (cur === 4) return 'low';   // 4→5 adds low B
        if (cur === 5) return 'high';  // 5→6 adds high C
        return null;                   // 6-string bass is the ceiling
    }
    if (cur === 6 || cur === 7) return 'low';  // 6→7 low B, 7→8 low F#
    return null;                               // 8-string guitar is the ceiling
}

// The only END a remove may touch — the inverse of `_addPositionPure`, so
// removing always peels the string the last add appended and the count
// collapses back to a shape the model can represent. null at the floor.
function _removePositionPure(isBass, cur) {
    if (isBass) {
        if (cur === 6) return 'high';  // 6→5 peels high C
        if (cur === 5) return 'low';   // 5→4 peels low B
        return null;                   // 4-string bass is the floor
    }
    if (cur === 7 || cur === 8) return 'low';  // 8→7, 7→6 peel the low ext
    return null;                               // 6-string guitar is the floor
}

// Clamp a per-string tuning offset (semitones from that lane's standard
// pitch). ±36 covers everything real — a re-entrant banjo drone sits far
// above its lane position, an octave-down 8-string far below — while a
// junk value can never author NaN into the wire tuning array.
function _stringTuningClampPure(v) {
    const n = Math.round(Number(v));
    if (!Number.isFinite(n)) return 0;
    return Math.max(-36, Math.min(36, n));
}

// Undoable per-string tuning edit — the modal's direct-entry rows. Holds
// the target arrangement INDEX (undo can fire after an arrangement
// switch) plus the exact old offset; lane count never changes, so no
// resize is involved.
class SetStringTuningCmd {
    constructor(arrIdx, stringIdx, newOffset) {
        this.arrIdx = arrIdx;
        this.stringIdx = stringIdx;
        this.newOffset = _stringTuningClampPure(newOffset);
        const arr = S.arrangements[arrIdx];
        const t = (arr && arr.tuning) || [];
        this.oldOffset = Number.isFinite(Number(t[stringIdx])) ? Number(t[stringIdx]) : 0;
    }
    _arr() { return S.arrangements[this.arrIdx]; }
    _set(v) {
        const arr = this._arr();
        if (!arr) return;
        if (!Array.isArray(arr.tuning)) arr.tuning = [];
        while (arr.tuning.length <= this.stringIdx) arr.tuning.push(0);
        arr.tuning[this.stringIdx] = v;
    }
    exec() { this._set(this.newOffset); }
    rollback() { this._set(this.oldOffset); }
}
/* @pure:string-tuning:end */

function _stringsRangeForActive() {
    const arr = S.arrangements[S.currentArr];
    const isBass = arr && /bass/i.test(arr.name || '');
    return _stringsRangePure(!!isBass);
}

function _notesOnString(arr, idx) {
    let count = 0;
    for (const n of arr.notes || []) if (n.string === idx) count += 1;
    for (const ch of arr.chords || []) {
        for (const cn of ch.notes || []) if (cn.string === idx) count += 1;
    }
    return count;
}

function _renderStringsModal() {
    const arr = S.arrangements[S.currentArr];
    if (!arr) return;
    const labels = laneLabels();           // low → high, length === lanes()
    // Normalize the display tuning to the real string count so we don't
    // surface RS-XML padding zeros as if they were real strings.
    const tuning = (arr.tuning || []).slice(0, labels.length);
    while (tuning.length < labels.length) tuning.push(0);
    const { min, max } = _stringsRangeForActive();
    const isBass = /bass/i.test(arr.name || '');

    const summary = document.getElementById('editor-strings-summary');
    if (summary) {
        summary.textContent = `${arr.name || 'Arrangement'} — ${labels.length} string${labels.length === 1 ? '' : 's'} (${isBass ? 'bass' : 'guitar'}; range ${min}–${max})`;
    }

    const list = document.getElementById('editor-strings-list');
    if (list) {
        // Build rows with createElement / textContent rather than
        // innerHTML — `tuning[i]` arrives from imported/edited JSON
        // and could be non-numeric, so interpolating it raw would
        // open a DOM-injection vector. Coercing to Number defends
        // both against bad input AND against future code that may
        // surface `lbl` values that aren't already HTML-safe.
        // Display low → high so it reads naturally; `tuning` is also
        // low → high in RS XML order, so iterating tuning matches.
        // Each row carries a DIRECT-ENTRY offset input (semitones from
        // that lane's standard pitch), so any tuning — drop, open,
        // banjo's re-entrant drone — is typable, not just reachable
        // through presets. Edits go through SetStringTuningCmd (undoable).
        list.textContent = '';
        for (let i = 0; i < labels.length; i++) {
            const lbl = labels[i];
            const rawOff = tuning[i];
            const off = Number.isFinite(Number(rawOff)) ? Number(rawOff) : 0;
            const row = document.createElement('div');
            row.className = 'flex items-center justify-between bg-dark-800 rounded px-2 py-1';
            const left = document.createElement('span');
            left.textContent = `String ${i} (${lbl})`;
            const right = document.createElement('label');
            right.className = 'flex items-center gap-1 text-gray-500';
            const input = document.createElement('input');
            input.type = 'number';
            input.min = '-36';
            input.max = '36';
            input.step = '1';
            // The wrapping <label>'s only text is the "st" unit, so without
            // this a screen reader announces the field as just "st spinbutton"
            // with no indication of which string it retunes.
            input.setAttribute('aria-label', `String ${i} (${lbl}) tuning offset in semitones`);
            input.value = String(off);
            input.className = 'w-14 bg-dark-700 border border-gray-700 rounded px-1 py-0.5 text-xs text-gray-300 outline-none text-center';
            input.title = 'Semitones from this lane’s standard pitch (e.g. -2 = whole-step down; a re-entrant drone can sit far above)';
            input.onchange = () => window.editorSetStringTuning(i, input.value);
            const unit = document.createElement('span');
            unit.textContent = 'st';
            right.appendChild(input);
            right.appendChild(unit);
            row.appendChild(left);
            row.appendChild(right);
            list.appendChild(row);
        }
    }

    const curCount = labels.length;  // === lanes()
    const warn = document.getElementById('editor-strings-warning');
    // Enable each end ONLY where the pitch/label model can represent the
    // resulting shape (see `_addPositionPure`/`_removePositionPure`). A
    // guitar has no valid high string and a 4/5-string guitar has no valid
    // low removal, so offering those ends would silently corrupt note
    // indices — hence a hard per-end gate, not a blanket ceiling/floor.
    const addPos = _addPositionPure(!!isBass, curCount);
    const removePos = _removePositionPure(!!isBass, curCount);
    const addLow = document.getElementById('editor-strings-add-low');
    const addHigh = document.getElementById('editor-strings-add-high');
    if (addLow) addLow.disabled = addPos !== 'low';
    if (addHigh) addHigh.disabled = addPos !== 'high';
    // The removable end still refuses to drop a string that carries notes,
    // so removal can never silently discard chart content.
    const removableIdx = removePos === 'low' ? 0 : (removePos === 'high' ? curCount - 1 : -1);
    const blockers = removableIdx >= 0 ? _notesOnString(arr, removableIdx) : 0;
    const removeLow = document.getElementById('editor-strings-remove-low');
    const removeHigh = document.getElementById('editor-strings-remove-high');
    if (removeLow) removeLow.disabled = removePos !== 'low' || blockers > 0;
    if (removeHigh) removeHigh.disabled = removePos !== 'high' || blockers > 0;
    if (warn) {
        if (!removePos) {
            warn.textContent = `Already at the minimum ${min} strings.`;
        } else if (blockers > 0) {
            warn.textContent = `${blockers} note${blockers === 1 ? '' : 's'} on the ${removePos} string — delete or move them before removing.`;
        } else {
            warn.textContent = '';
        }
    }
}

window.editorShowStringsModal = () => {
    const arr = S.arrangements[S.currentArr];
    if (!arr) return;
    if (KEYS_PATTERN.test(arr.name || '') || /^drums/i.test(arr.name || '')) return;
    document.getElementById('editor-strings-modal').classList.remove('hidden');
    _renderStringsModal();
};

window.editorHideStringsModal = () => {
    document.getElementById('editor-strings-modal').classList.add('hidden');
};

window.editorAddString = (pos) => {
    const arr = S.arrangements[S.currentArr];
    if (!arr) return;
    const isBass = /bass/i.test(arr.name || '');
    // Compute the count directly from the active arrangement rather
    // than going through `lanes()` — the latter consults a per-draw
    // cache and our intent here is explicitly "what is this
    // arrangement's current string count?", independent of draw state.
    const cur = _stringCountFor(arr);
    // Only ever add at the END the pitch/label model supports for this
    // role + count. A mismatched request (guitar high, bass low at 5, …)
    // is rejected outright rather than silently coerced, because adding
    // at the unsupported end re-snaps the count and re-labels every note.
    const valid = _addPositionPure(isBass, cur);
    if (!valid || pos !== valid) return;
    // The command's exec() calls _resizeForLaneChange() itself, which
    // covers undo/redo too — no need to duplicate the resize here.
    S.history.exec(new AddStringCmd(S.currentArr, valid));
    _renderStringsModal();
    draw();
    updateStatus();
};

window.editorRemoveString = (pos) => {
    const arr = S.arrangements[S.currentArr];
    if (!arr) return;
    const isBass = /bass/i.test(arr.name || '');
    // Same reasoning as editorAddString — anchor on `arr` directly
    // rather than the cached `lanes()`.
    const cur = _stringCountFor(arr);
    // Only remove the END the model can collapse back to a representable
    // shape (the inverse of the add order). Any other end would leave the
    // count at a value the labels/pitches no longer match.
    const valid = _removePositionPure(isBass, cur);
    if (!valid || pos !== valid) return;
    const targetIdx = valid === 'low' ? 0 : cur - 1;
    if (_notesOnString(arr, targetIdx) > 0) return;  // UI button is disabled too
    // The command's exec() handles the resize internally (covers
    // undo/redo too); see editorAddString.
    S.history.exec(new RemoveStringCmd(S.currentArr, valid));
    _renderStringsModal();
    draw();
    updateStatus();
};

window.editorSetStringTuning = (stringIdx, value) => {
    const arr = S.arrangements[S.currentArr];
    if (!arr) return;
    const i = Number(stringIdx);
    if (!Number.isInteger(i) || i < 0 || i >= _stringCountFor(arr)) return;
    const cmd = new SetStringTuningCmd(S.currentArr, i, value);
    // Skip no-op edits (blur without change re-fires onchange in some
    // browsers) so the undo stack doesn't collect empty steps.
    if (cmd.newOffset === cmd.oldOffset) { _renderStringsModal(); return; }
    S.history.exec(cmd);
    _renderStringsModal();
    draw();
    updateStatus();
};

// ════════════════════════════════════════════════════════════════════
// Add Keys arrangement (sloppak — GP or MIDI source)
// ════════════════════════════════════════════════════════════════════

let _addKeysSourcePath = null;       // server-side path to the uploaded file
let _addKeysSourceFormat = null;     // 'gp' or 'midi'
// Cached after a successful list-tracks call; the keys-track radio value
// is an index into this array, not the track's MIDI/GP index, because
// format-0 channel splits can yield multiple picker entries sharing the
// same MIDI `index`.
let _addKeysSortedTracks = [];
// Bumped on every file-select so a slow async parse (e.g. the MusicXML
// delegation round-trip) from a superseded file can't append a stale result.
let _addKeysReqSeq = 0;

window.editorShowAddKeysModal = () => {
    if (S.format !== 'sloppak') return;
    document.getElementById('editor-add-keys-modal').classList.remove('hidden');
    document.getElementById('editor-add-keys-tracks').classList.add('hidden');
    document.getElementById('editor-add-keys-go').disabled = true;
    document.getElementById('editor-add-keys-status').textContent = '';
    const fi = document.getElementById('editor-add-keys-file');
    if (fi) fi.value = '';
    _addKeysSourcePath = null;
    _addKeysSourceFormat = null;
};

window.editorHideAddKeysModal = () => {
    document.getElementById('editor-add-keys-modal').classList.add('hidden');
    // Invalidate any in-flight MusicXML parse so closing the modal cancels the
    // import instead of silently appending once the request resolves.
    _addKeysReqSeq++;
};

window.editorKeysFileSelected = async (input) => {
    const file = input.files && input.files[0];
    if (!file) return;
    const statusEl = document.getElementById('editor-add-keys-status');
    statusEl.textContent = 'Parsing ' + file.name + '...';

    // Drop any state from a previous successful parse so a later parse
    // failure (or empty-tracks result) can't be silently committed via
    // editorDoAddKeys using the older file's path.
    _addKeysSourcePath = null;
    _addKeysSortedTracks = [];
    const reqSeq = ++_addKeysReqSeq;  // invalidates any in-flight parse for an earlier file
    document.getElementById('editor-add-keys-go').disabled = true;
    document.getElementById('editor-add-keys-tracks').classList.add('hidden');

    const lower = file.name.toLowerCase();

    // MusicXML is delegated to the musicxml_import plugin's parse-arrangement
    // endpoint, which returns a ready editor arrangement (with authored
    // notation stashed) — no per-track pick, so append it straight away.
    if (lower.endsWith('.xml') || lower.endsWith('.musicxml')) {
        _addKeysSourceFormat = 'musicxml';
        try {
            const b64 = await _editorFileToBase64(file);
            const resp = await fetch('/api/plugins/musicxml_import/parse-arrangement', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ filename: file.name, data: b64 }),
            });
            if (resp.status === 404) {
                statusEl.textContent = 'MusicXML import needs the "Import MusicXML" plugin installed.';
                return;
            }
            const data = await resp.json().catch(() => ({}));
            // A newer file was selected while this parse was in flight — drop it.
            if (reqSeq !== _addKeysReqSeq) return;
            if (!resp.ok || data.error) {
                statusEl.textContent = 'Error: ' + (data.error || resp.status);
                return;
            }
            const arr = data.arrangement;
            if (!arr || !(arr.notes || []).length) {
                statusEl.textContent = 'No notes found in this MusicXML file.';
                return;
            }
            // Align to the session's audio offset, matching the GP/MIDI import
            // paths (which pass audio_offset server-side). MusicXML times come
            // back at score-time (offset 0), so shift them client-side.
            const offset = _effectiveAudioOffset();
            if (offset) {
                for (const n of arr.notes) n.time = (Number(n.time) || 0) + offset;
                // The endpoint currently returns no chords, but shift them too
                // (and their nested tones) so flattenChords() stays aligned if
                // it ever does.
                for (const ch of (arr.chords || [])) {
                    if (ch.time != null) ch.time = (Number(ch.time) || 0) + offset;
                    for (const cn of (ch.notes || [])) {
                        if (cn.time != null) cn.time = (Number(cn.time) || 0) + offset;
                    }
                }
            }
            // v1 saves keys notation via the editor's heuristic (PR #52), so drop
            // the authored notation stash here — keeping un-shifted notation
            // alongside offset-shifted notes would be inconsistent. (Preserving
            // authored notation through edits is a tracked follow-up.)
            delete arr.notation;
            await _editorAppendKeysArrangement(arr, statusEl, {
                isStale: () => reqSeq !== _addKeysReqSeq,
            });
        } catch (e) {
            statusEl.textContent = 'Failed: ' + e.message;
        }
        return;
    }

    const isMidi = lower.endsWith('.mid') || lower.endsWith('.midi');
    _addKeysSourceFormat = isMidi ? 'midi' : 'gp';

    const fd = new FormData();
    fd.append('file', file);

    try {
        const url = isMidi
            ? '/api/plugins/editor/import-midi'
            : '/api/plugins/editor/import-gp';
        const resp = await fetch(url, { method: 'POST', body: fd });
        const data = await resp.json();
        // A newer file was selected (incl. a MusicXML one) while this GP/MIDI
        // parse was in flight — don't repopulate the picker for a stale file.
        if (reqSeq !== _addKeysReqSeq) return;
        if (data.error) {
            statusEl.textContent = 'Error: ' + data.error;
            return;
        }
        const tracks = data.tracks || [];
        // Surface piano-flagged tracks first; include all so the user can override.
        const sorted = tracks.slice().sort((a, b) => {
            const ap = (a.is_piano ? 0 : 1);
            const bp = (b.is_piano ? 0 : 1);
            if (ap !== bp) return ap - bp;
            return (b.notes || 0) - (a.notes || 0);
        });

        if (sorted.length === 0) {
            statusEl.textContent = 'No tracks found in this file.';
            // Leave the cleared state from above in place — no usable
            // tracks means editorDoAddKeys must remain disabled.
            return;
        }

        // Only commit the new state once we know there's a usable track set.
        _addKeysSourcePath = isMidi ? data.midi_path : data.gp_path;
        // Stash so editorDoAddKeys can resolve the radio value back to the
        // full track entry (it carries both `index` and `channel_filter`,
        // which can collide if a format-0 file produced multiple entries
        // sharing the same `index`).
        _addKeysSortedTracks = sorted;

        const listEl = document.getElementById('editor-add-keys-track-list');
        const defaultChecked = _keysDefaultSelection(sorted);
        // Checkbox value is the position in `sorted` (not t.index) because
        // format-0 channel splits produce multiple entries that share the same
        // MIDI track_index — we need a unique key. Multi-select: a detected
        // RH/LH piano pair is pre-checked so both hands import and merge.
        listEl.innerHTML = sorted.map((t, pos) => {
            const checked = defaultChecked.has(pos) ? 'checked' : '';
            const isDrums = !!(t.is_drums || t.is_percussion);
            const flag = t.is_piano ? '<span class="text-indigo-300">[keys]</span>' : '';
            const drumsTag = isDrums ? '<span class="text-red-400">[drums]</span>' : '';
            const safeName = _editorEscHtml(t.name || '') || _editorEscHtml('Track ' + t.index);
            return `<label class="flex items-center gap-2 text-xs text-gray-300 py-0.5">
                <input type="checkbox" name="keys-track" value="${pos}" ${checked} class="accent-indigo-500">
                <span class="text-gray-200">${safeName}</span>
                ${flag} ${drumsTag}
                <span class="text-gray-600 ml-auto">${Number(t.notes) || 0} notes</span>
            </label>`;
        }).join('');
        document.getElementById('editor-add-keys-tracks').classList.remove('hidden');
        document.getElementById('editor-add-keys-go').disabled = false;
        const found = sorted.filter(t => t.is_piano).length;
        const pairHint = defaultChecked.size > 1
            ? ' An RH/LH pair is pre-selected — both hands merge into one piano.'
            : '';
        statusEl.textContent = found > 0
            ? `Found ${found} keyboard track(s). Select one or more.${pairHint}`
            : `No tracks auto-flagged as keyboard — select one or more manually.`;
    } catch (e) {
        statusEl.textContent = 'Failed: ' + e.message;
    }
};

// Mirror gp2rs_gpx._find_piano_pairs: a keys track named "<stem> RH" pairs with
// "<stem> LH" (word-boundary, case-insensitive). Pre-select detected pairs so
// both hands import and merge into one piano by default; if none pair, select
// the first keyboard track. Returns a Set of positions in `tracks`.
function _keysDefaultSelection(tracks) {
    const checked = new Set();
    const keys = tracks
        .map((t, pos) => ({ pos, name: String(t.name || '').trim().toLowerCase(), is: !!t.is_piano }))
        .filter(t => t.is);
    const consumed = new Set();
    for (const a of keys) {
        if (consumed.has(a.pos) || !/\brh\b/.test(a.name)) continue;
        const stem = a.name.replace(/\s*\brh\b\s*$/, '').trim();
        for (const b of keys) {
            if (b.pos === a.pos || consumed.has(b.pos) || !/\blh\b/.test(b.name)) continue;
            if (b.name.replace(/\s*\blh\b\s*$/, '').trim() === stem) {
                checked.add(a.pos); checked.add(b.pos);
                consumed.add(a.pos); consumed.add(b.pos);
                break;
            }
        }
    }
    if (checked.size === 0) {
        const firstPiano = tracks.findIndex(t => t.is_piano);
        checked.add(firstPiano >= 0 ? firstPiano : 0);
    }
    return checked;
}

window.editorDoAddKeys = async () => {
    if (!_addKeysSourcePath || !S.sessionId) return;
    const statusEl = document.getElementById('editor-add-keys-status');
    const goBtn = document.getElementById('editor-add-keys-go');
    goBtn.disabled = true;
    statusEl.textContent = 'Importing keys track...';

    // Checkbox values are positions in _addKeysSortedTracks; resolve them back
    // to full entries (each carries `index` and `channel_filter`). Multiple
    // keys tracks can be imported at once — an RH/LH piano pair is merged into
    // one arrangement server-side (convert_file._find_piano_pairs).
    const checkedEls = Array.from(
        document.querySelectorAll('input[name="keys-track"]:checked'));
    const positions = checkedEls.length ? checkedEls.map(el => parseInt(el.value)) : [0];
    const pickedList = positions.map(p => _addKeysSortedTracks[p]).filter(Boolean);
    if (!pickedList.length) { statusEl.textContent = 'No track selected.'; goBtn.disabled = false; return; }
    const trackIndices = pickedList.map(p => Number(p.index) || 0);
    // MIDI keys import is single-track; use the first selected track + channel.
    const picked = pickedList[0];
    const trackIndex = Number(picked.index) || 0;
    const channelFilter = (picked.channel_filter == null) ? null : Number(picked.channel_filter);

    try {
        const url = _addKeysSourceFormat === 'midi'
            ? '/api/plugins/editor/import-keys-midi'
            : '/api/plugins/editor/import-keys';
        const audioOffset = _effectiveAudioOffset();
        const body = _addKeysSourceFormat === 'midi'
            ? { midi_path: _addKeysSourcePath, track_index: trackIndex, audio_offset: audioOffset,
                channel_filter: channelFilter }
            : { gp_path: _addKeysSourcePath, track_indices: trackIndices, audio_offset: audioOffset };
        const resp = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        const data = await resp.json();
        if (data.error) {
            statusEl.textContent = 'Error: ' + data.error;
            goBtn.disabled = false;
            return;
        }

        // The GP path may return several arrangements (one per non-merged keys
        // track); the MIDI path returns one. Append each in order.
        const arrangements = Array.isArray(data.arrangements)
            ? data.arrangements
            : (data.arrangement ? [data.arrangement] : []);
        const xmlPaths = Array.isArray(data.xml_paths) ? data.xml_paths : [];
        let allOk = arrangements.length > 0;
        for (let i = 0; i < arrangements.length; i++) {
            const ok = await _editorAppendKeysArrangement(arrangements[i], statusEl, {
                xml_path: xmlPaths[i] || data.xml_path || '',
            });
            if (!ok) { allOk = false; break; }
        }
        if (!allOk) {
            goBtn.disabled = false;
        } else {
            // Offer the MIDI's own tempo/time-signature grid (DAW 3.2). No-op
            // for the GP path (no tempo_map) or a gridless MIDI.
            _maybeOfferMidiTempoMap(data.tempo_map);
        }
    } catch (e) {
        statusEl.textContent = 'Failed: ' + e.message;
        goBtn.disabled = false;
    }
};

// Read a File as base64 (no data: prefix) for endpoints that take inline bytes.
function _editorFileToBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            const res = String(reader.result || '');
            const comma = res.indexOf(',');
            resolve(comma >= 0 ? res.slice(comma + 1) : res);
        };
        reader.onerror = () => reject(reader.error || new Error('read failed'));
        reader.readAsDataURL(file);
    });
}

// Register an imported Keys arrangement with the session, append it in-memory,
// switch to it, and refresh the view. Shared by the GP/MIDI track import and the
// MusicXML delegation path. Returns true on success.
async function _editorAppendKeysArrangement(arrangement, statusEl, opts = {}) {
    if (!arrangement || !S.sessionId) {
        if (statusEl) statusEl.textContent = 'No arrangement to add.';
        return false;
    }
    // Normalize optional arrays so flattenChords()/the piano-roll don't choke on
    // a notes-only arrangement (e.g. a MusicXML response without `chords`).
    arrangement.chords = arrangement.chords || [];
    arrangement.chord_templates = arrangement.chord_templates || [];
    try {
        // Register with the server-side session (no-op for sloppak).
        const addResp = await fetch('/api/plugins/editor/add-arrangement', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                session_id: S.sessionId,
                arrangement,
                xml_path: opts.xml_path || '',
            }),
        });
        const addData = await addResp.json().catch(() => ({}));
        if (!addResp.ok || addData.error) {
            if (statusEl) statusEl.textContent = 'Error registering arrangement: ' + (addData.error || addResp.status);
            return false;
        }
        // The import may have been canceled/superseded while registration was in
        // flight (modal closed or another file picked) — don't mutate state then.
        if (typeof opts.isStale === 'function' && opts.isStale()) return false;

        S.arrangements.push(arrangement);
        S.currentArr = S.arrangements.length - 1;
        const sel = document.getElementById('editor-arrangement');
        if (sel) sel.value = S.currentArr;

        flattenChords();
        if (typeof updatePianoRange === 'function') updatePianoRange();
        updateArrangementSelector();
        updateStatus();
        draw();

        // Shared with the guitar/bass import — hide whichever modal opened this
        // (default: the Add-Keys modal) and label the toast accordingly.
        (opts.hideModal || window.editorHideAddKeysModal)();
        const label = opts.label || 'Keys';
        setStatus('Added ' + label + ' arrangement (' + (arrangement.notes || []).length + ' notes). Save to commit.');
        return true;
    } catch (e) {
        if (statusEl) statusEl.textContent = 'Failed: ' + e.message;
        return false;
    }
}

let _addingEmptyKeys = false;

window.editorAddEmptyKeys = async () => {
    if (S.format !== 'sloppak' || !S.sessionId) return;
    if (_addingEmptyKeys) return;
    _addingEmptyKeys = true;
    const statusEl = document.getElementById('editor-add-keys-status');
    const arrangement = {
        name: _uniqueKeysName(),
        tuning: [0, 0, 0, 0, 0, 0],
        capo: 0,
        notes: [],
        chords: [],
        chord_templates: [],
    };
    try {
        const resp = await fetch('/api/plugins/editor/add-arrangement', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ session_id: S.sessionId, arrangement }),
        });
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok || data.error) {
            statusEl.textContent = 'Error registering arrangement: ' + (data.error || resp.status);
            return;
        }

        S.arrangements.push(arrangement);
        S.currentArr = S.arrangements.length - 1;
        const sel = document.getElementById('editor-arrangement');
        if (sel) sel.value = S.currentArr;

        flattenChords();
        if (typeof updatePianoRange === 'function') updatePianoRange();
        updateArrangementSelector();
        updateStatus();
        draw();

        window.editorHideAddKeysModal();
        setStatus('Added empty Keys arrangement. Double-click the chart to add notes; save to commit.');
    } catch (e) {
        statusEl.textContent = 'Failed: ' + e.message;
    } finally {
        _addingEmptyKeys = false;
    }
};

// ════════════════════════════════════════════════════════════════════
// Import a GUITAR / BASS track from a GP file (add or replace)
// ════════════════════════════════════════════════════════════════════

let _importGuitarPath = null;      // server-side path to the uploaded GP file
let _importGuitarTracks = [];      // guitar/bass tracks from the last parse
let _importGuitarReqSeq = 0;       // invalidates in-flight parses when superseded

/* @pure:guitar-import:start */
// Keep only guitar/bass tracks — drop piano/drums/percussion/vocal. Mirrors the
// backend guard in import-guitar-track so the picker and the server agree.
function _isGuitarBassTrack(t) {
    return !!t && !t.is_piano && !t.is_drums && !t.is_percussion && !t.is_vocal;
}

// Derive an arrangement name for an imported guitar/bass track, de-duped
// against `existingNames`. A BASS track's name MUST contain "bass" so
// _stringCountFor / isBassArr lay out 4 lanes (E/A/D/G) instead of 6 — the same
// invariant the "don't mis-read a 4-string bass as 6-string" fix relies on. A
// guitar track whose name would start with keys/drums/… is renamed to a neutral
// guitar role so convert_file routes it through the guitar converter (it
// dispatches by name), not the piano/drum one.
function _guitarImportName(track, existingNames) {
    const taken = new Set((existingNames || [])
        .map(n => String(n || '').trim().toLowerCase()));
    const dedupe = (base) => {
        if (!taken.has(base.toLowerCase())) return base;
        // A free slot is guaranteed within taken.size + 1 tries; +2 is margin.
        for (let i = 2; i <= taken.size + 2; i++) {
            const cand = `${base} ${i}`;
            if (!taken.has(cand.toLowerCase())) return cand;
        }
        return `${base} ${Date.now()}`;
    };
    if (track && track.is_bass) return dedupe('Bass');
    let base = String((track && track.name) || '').trim();
    if (!base || /^(keys|piano|keyboard|synth|drums|percussion)/i.test(base)) {
        base = 'Lead';
    }
    return dedupe(base);
}
/* @pure:guitar-import:end */

window.editorShowImportGuitarModal = () => {
    if (S.format !== 'sloppak' || !S.sessionId) return;
    document.getElementById('editor-import-guitar-modal').classList.remove('hidden');
    document.getElementById('editor-import-guitar-tracks').classList.add('hidden');
    document.getElementById('editor-import-guitar-dest').classList.add('hidden');
    document.getElementById('editor-import-guitar-go').disabled = true;
    document.getElementById('editor-import-guitar-status').textContent = '';
    const fi = document.getElementById('editor-import-guitar-file');
    if (fi) fi.value = '';
    _importGuitarPath = null;
    _importGuitarTracks = [];
};

window.editorHideImportGuitarModal = () => {
    document.getElementById('editor-import-guitar-modal').classList.add('hidden');
    // Invalidate any in-flight upload so closing the modal cancels the import.
    _importGuitarReqSeq++;
};

window.editorImportGuitarDestChanged = () => {
    const dest = (document.querySelector('input[name="guitar-dest"]:checked') || {}).value;
    const sel = document.getElementById('editor-import-guitar-replace-target');
    if (sel) sel.classList.toggle('hidden', dest !== 'replace');
};

// The guitar/bass track currently selected in the picker (or null).
function _importGuitarSelectedTrack() {
    const checked = document.querySelector('input[name="guitar-track"]:checked');
    return checked ? _importGuitarTracks[parseInt(checked.value)] : null;
}

// Rebuild the Replace-target dropdown for the currently-selected track. Only
// SAME-FAMILY guitar/bass arrangements are offered (Keys/Drums always excluded):
// the swap keeps the TARGET's name, so dropping a bass chart onto a guitar
// arrangement — or vice-versa — would render/save it with the wrong lane count
// (bass lanes are name-driven, /bass/i). Option value is the REAL arrangement
// index so the family filter can't misroute the swap. With no eligible target,
// Replace is disabled and the destination falls back to Add.
window.editorImportGuitarRefreshReplaceTargets = () => {
    const picked = _importGuitarSelectedTrack();
    const wantBass = !!(picked && picked.is_bass);
    const replaceSel = document.getElementById('editor-import-guitar-replace-target');
    const replaceRadio = document.querySelector('input[name="guitar-dest"][value="replace"]');
    const eligible = S.arrangements
        .map((a, i) => ({ a, i }))
        .filter(({ a }) => {
            const nm = a.name || '';
            if (KEYS_PATTERN.test(nm) || /^drums/i.test(nm)) return false;
            return /bass/i.test(nm) === wantBass;
        });
    if (replaceSel) {
        replaceSel.innerHTML = eligible.map(({ a, i }) =>
            `<option value="${i}">${_editorEscHtml(a.name || ('Arrangement ' + (i + 1)))}</option>`
        ).join('');
    }
    if (replaceRadio) {
        replaceRadio.disabled = eligible.length === 0;
        replaceRadio.title = eligible.length === 0
            ? `No ${wantBass ? 'bass' : 'guitar'} arrangement to replace.`
            : '';
        if (eligible.length === 0 && replaceRadio.checked) {
            const addRadio = document.querySelector('input[name="guitar-dest"][value="add"]');
            if (addRadio) addRadio.checked = true;
        }
    }
    window.editorImportGuitarDestChanged();
};

window.editorImportGuitarFileSelected = async (input) => {
    const file = input.files && input.files[0];
    if (!file) return;
    const statusEl = document.getElementById('editor-import-guitar-status');
    statusEl.textContent = 'Parsing ' + file.name + '...';

    // Drop any prior parse so a later failure can't be committed with the old
    // file's path, and invalidate any in-flight upload for an earlier file.
    _importGuitarPath = null;
    _importGuitarTracks = [];
    const reqSeq = ++_importGuitarReqSeq;
    document.getElementById('editor-import-guitar-go').disabled = true;
    document.getElementById('editor-import-guitar-tracks').classList.add('hidden');
    document.getElementById('editor-import-guitar-dest').classList.add('hidden');

    const fd = new FormData();
    fd.append('file', file);
    try {
        const resp = await fetch('/api/plugins/editor/import-gp', { method: 'POST', body: fd });
        const data = await resp.json();
        // A newer file was selected while this parse was in flight — drop it.
        if (reqSeq !== _importGuitarReqSeq) return;
        if (data.error) { statusEl.textContent = 'Error: ' + data.error; return; }

        // Guitar/bass only; surface the most-played tracks first.
        const tracks = (data.tracks || [])
            .filter(_isGuitarBassTrack)
            .sort((a, b) => (b.notes || 0) - (a.notes || 0));
        if (tracks.length === 0) {
            statusEl.textContent = 'No guitar or bass tracks found in this file.';
            return;
        }

        _importGuitarPath = data.gp_path;
        _importGuitarTracks = tracks;

        const listEl = document.getElementById('editor-import-guitar-track-list');
        listEl.innerHTML = tracks.map((t, pos) => {
            const checked = pos === 0 ? 'checked' : '';
            const bassTag = t.is_bass ? '<span class="text-blue-300">[bass]</span>' : '';
            const safeName = _editorEscHtml(t.name || '') || _editorEscHtml('Track ' + t.index);
            return `<label class="flex items-center gap-2 text-xs text-gray-300 py-0.5">
                <input type="radio" name="guitar-track" value="${pos}" ${checked} onchange="editorImportGuitarRefreshReplaceTargets()" class="accent-blue-500">
                <span class="text-gray-200">${safeName}</span>
                ${bassTag}
                <span class="text-gray-600 ml-auto">${Number(t.notes) || 0} notes</span>
            </label>`;
        }).join('');

        // Reset the destination to Add each time a file is (re)picked, then
        // populate the Replace target dropdown for the default-selected track.
        const addRadio = document.querySelector('input[name="guitar-dest"][value="add"]');
        if (addRadio) addRadio.checked = true;
        window.editorImportGuitarRefreshReplaceTargets();

        document.getElementById('editor-import-guitar-tracks').classList.remove('hidden');
        document.getElementById('editor-import-guitar-dest').classList.remove('hidden');
        document.getElementById('editor-import-guitar-go').disabled = false;
        const bassCount = tracks.filter(t => t.is_bass).length;
        statusEl.textContent =
            `Found ${tracks.length} guitar/bass track(s)` +
            (bassCount ? ` (${bassCount} bass)` : '') + '. Pick one and a destination.';
    } catch (e) {
        statusEl.textContent = 'Failed: ' + e.message;
    }
};

window.editorDoImportGuitar = async () => {
    if (!_importGuitarPath || !S.sessionId) return;
    const statusEl = document.getElementById('editor-import-guitar-status');
    const goBtn = document.getElementById('editor-import-guitar-go');
    goBtn.disabled = true;

    const checked = document.querySelector('input[name="guitar-track"]:checked');
    const picked = checked ? _importGuitarTracks[parseInt(checked.value)] : null;
    if (!picked) { statusEl.textContent = 'No track selected.'; goBtn.disabled = false; return; }
    const trackIndex = Number(picked.index) || 0;

    const dest = (document.querySelector('input[name="guitar-dest"]:checked') || {}).value || 'add';
    let targetIdx = -1;
    if (dest === 'replace') {
        const sel = document.getElementById('editor-import-guitar-replace-target');
        targetIdx = sel ? parseInt(sel.value) : -1;
        if (!(targetIdx >= 0 && targetIdx < S.arrangements.length)) {
            statusEl.textContent = 'Pick an arrangement to replace.'; goBtn.disabled = false; return;
        }
    }

    // Convert under a guitar/bass-safe name so the guitar converter runs (and a
    // bass gets a /bass/i name → 4 lanes). On Replace the target's name may be
    // "Keys"/"Drums" or anything, so derive a fresh conversion name from the
    // TRACK; the chart adopts the target's display name in the replace command.
    const reqSeq = _importGuitarReqSeq;
    const existingNames = S.arrangements.map(a => a.name || '');
    const name = dest === 'replace'
        ? _guitarImportName(picked, [])
        : _guitarImportName(picked, existingNames);

    statusEl.textContent = dest === 'replace' ? 'Importing (replace)...' : 'Importing track...';
    try {
        const resp = await fetch('/api/plugins/editor/import-guitar-track', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                gp_path: _importGuitarPath,
                track_index: trackIndex,
                audio_offset: _effectiveAudioOffset(),
                name,
            }),
        });
        const data = await resp.json();
        if (data.error) { statusEl.textContent = 'Error: ' + data.error; goBtn.disabled = false; return; }
        // The modal was closed / a new file picked while this was in flight.
        if (reqSeq !== _importGuitarReqSeq) return;
        const arrangement = data.arrangement;
        if (!arrangement) { statusEl.textContent = 'No arrangement returned.'; goBtn.disabled = false; return; }

        if (dest === 'replace') {
            // Keep the target's existing name (it already reflects the
            // instrument) — swap only the chart. One undo step.
            const cmd = new ReplaceArrangementChartCmd(targetIdx, arrangement);
            // exec() swaps the chart AND flattens it (see the command).
            S.history.exec(cmd);
            S.currentArr = targetIdx;
            // Drop selections/marker refs — they pointed at the OLD chart, so a
            // stale index/ref could now hit an unintended imported note or
            // marker on the next edit. Mirrors editorSelectArrangement.
            S.sel.clear();
            S.toneSel = null;
            S.anchorSel = null;
            S.handshapeSel = null;
            const arrSel = document.getElementById('editor-arrangement');
            if (arrSel) arrSel.value = String(targetIdx);
            // Recompute LANE_H for the now-visible replaced chart (exec's own
            // resize ran before this currentArr switch, so it no-op'd then).
            _resizeForLaneChange(targetIdx);
            if (typeof updatePianoRange === 'function') updatePianoRange();
            updateArrangementSelector();
            updateStatus();
            draw();
            window.editorHideImportGuitarModal();
            const nm = S.arrangements[targetIdx] && S.arrangements[targetIdx].name;
            setStatus('Replaced "' + nm + '" chart (' + (arrangement.notes || []).length +
                ' notes). Undo (Ctrl+Z) reverts it. Save to commit.');
        } else {
            const ok = await _editorAppendKeysArrangement(arrangement, statusEl, {
                xml_path: data.xml_path || '',
                label: 'Guitar/Bass',
                hideModal: window.editorHideImportGuitarModal,
                isStale: () => reqSeq !== _importGuitarReqSeq,
            });
            if (!ok) goBtn.disabled = false;
        }
    } catch (e) {
        statusEl.textContent = 'Failed: ' + e.message;
        goBtn.disabled = false;
    }
};

// GM Percussion (channel 10) names for the unmapped-notes import dialog
// — gives users a hint of what was dropped instead of just a number.
const _GM_PERC_NAMES = {
    27: 'High Q',           28: 'Slap',             29: 'Scratch Push',
    30: 'Scratch Pull',     31: 'Sticks',           32: 'Square Click',
    33: 'Metronome Click',  34: 'Metronome Bell',   35: 'Acoustic Bass Drum',
    36: 'Bass Drum 1',      37: 'Side Stick',       38: 'Acoustic Snare',
    39: 'Hand Clap',        40: 'Electric Snare',   41: 'Low Floor Tom',
    42: 'Closed Hi-Hat',    43: 'High Floor Tom',   44: 'Pedal Hi-Hat',
    45: 'Low Tom',          46: 'Open Hi-Hat',      47: 'Low-Mid Tom',
    48: 'Hi-Mid Tom',       49: 'Crash Cymbal 1',   50: 'High Tom',
    51: 'Ride Cymbal 1',    52: 'Chinese Cymbal',   53: 'Ride Bell',
    54: 'Tambourine',       55: 'Splash Cymbal',    56: 'Cowbell',
    57: 'Crash Cymbal 2',   58: 'Vibraslap',        59: 'Ride Cymbal 2',
    60: 'Hi Bongo',         61: 'Low Bongo',        62: 'Mute Hi Conga',
    63: 'Open Hi Conga',    64: 'Low Conga',        65: 'High Timbale',
    66: 'Low Timbale',      67: 'High Agogo',       68: 'Low Agogo',
    69: 'Cabasa',           70: 'Maracas',          71: 'Short Whistle',
    72: 'Long Whistle',     73: 'Short Guiro',      74: 'Long Guiro',
    75: 'Claves',           76: 'Hi Wood Block',    77: 'Low Wood Block',
    78: 'Mute Cuica',       79: 'Open Cuica',       80: 'Mute Triangle',
    81: 'Open Triangle',    82: 'Shaker',           83: 'Jingle Bell',
    84: 'Belltree',         85: 'Castanets',        86: 'Mute Surdo',
    87: 'Open Surdo',
};

// Post-import warning: the server returns any percussion notes it couldn't
// auto-map to one of the 18 drum pieces. Show them with a per-row dropdown
// so the user can drop them or hand-map each one. Synthesizes hits client-
// side from the times the server captured — no second server round-trip.
/* @pure:midi-tempo-choice:start */
// A "project grid" is present once the timeline has at least two numbered
// downbeats (measure > 0) — i.e. the song already has bars, whether authored
// or audio-aligned. Below that the timeline is effectively empty (a lone
// implied bar), so an imported MIDI's own grid is strictly more information.
function _hasProjectGridPure(beats) {
    if (!Array.isArray(beats)) return false;
    let downbeats = 0;
    for (const b of beats) {
        if (b && (Number(b.measure) || -1) > 0 && ++downbeats >= 2) return true;
    }
    return false;
}

// Sanitize a core `tempo_map.beats` (feedback #796 shape) into editor beat
// rows: keep only finite-time rows carrying {time, measure[, den]} — `den`
// only on real downbeats that have one — and drop anything malformed. Rows
// stay in source order (core emits ascending time). Returns [] for a missing
// or gridless map.
function _midiTempoToBeatsPure(tempoMap) {
    const raw = tempoMap && Array.isArray(tempoMap.beats) ? tempoMap.beats : [];
    const out = [];
    for (const b of raw) {
        if (!b || !Number.isFinite(Number(b.time))) continue;
        const measure = Number.isFinite(Number(b.measure)) ? Number(b.measure) : -1;
        const row = { time: Number(b.time), measure };
        if (measure > 0 && Number.isFinite(Number(b.den))) row.den = Number(b.den);
        out.push(row);
    }
    return out;
}

// Does an imported MIDI carry a grid worth offering? Matches the backend
// gate (routes.py `_sanitize_midi_tempo_map` / `test_single_downbeat_still_
// offered`): at least ONE numbered downbeat. Deliberately looser than
// `_hasProjectGridPure` (which needs 2 to call an EXISTING project timeline
// "a grid") — a single-bar MIDI (a common drum/loop export) still carries a
// real tempo + time signature worth adopting onto an empty project, and the
// backend already ships it. Reusing the 2-downbeat project threshold here
// silently dropped those maps despite the server offering them.
function _midiOffersGridPure(tempoMap) {
    return _midiTempoToBeatsPure(tempoMap).some(b => b.measure > 0);
}

// The default Use-vs-Keep choice, or null when there is nothing to offer.
// Nothing to offer = the MIDI carries no usable grid (no numbered downbeat
// after sanitizing). Otherwise KEEP when the project already has a grid (never
// silently stomp an audio-aligned timeline), USE the MIDI when it doesn't.
function _midiTempoDefaultChoicePure(projectBeats, tempoMap) {
    if (!_midiOffersGridPure(tempoMap)) return null;
    return _hasProjectGridPure(projectBeats) ? 'keep' : 'midi';
}

// Short human summary of a MIDI grid for the dialog: bar count + the first
// time signature + the first tempo (with an ellipsis when either changes).
// Defensive against partial maps.
function _midiTempoSummaryPure(tempoMap) {
    const beats = _midiTempoToBeatsPure(tempoMap);
    const bars = beats.filter(b => b.measure > 0).length;
    const sigs = tempoMap && Array.isArray(tempoMap.time_signatures) ? tempoMap.time_signatures : [];
    const tempos = tempoMap && Array.isArray(tempoMap.tempos) ? tempoMap.tempos : [];
    const parts = [`${bars} bar${bars === 1 ? '' : 's'}`];
    const ts = sigs.length && Array.isArray(sigs[0].ts) ? sigs[0].ts : null;
    if (ts && Number.isFinite(Number(ts[0])) && Number.isFinite(Number(ts[1]))) {
        parts.push(`${ts[0]}/${ts[1]}${sigs.length > 1 ? '…' : ''}`);
    }
    if (tempos.length && Number.isFinite(Number(tempos[0].bpm))) {
        parts.push(`${Math.round(Number(tempos[0].bpm))} BPM${tempos.length > 1 ? '…' : ''}`);
    }
    return parts.join(' · ');
}
/* @pure:midi-tempo-choice:end */

// After a MIDI keys/drums import, offer to adopt the file's own tempo / time-
// signature / beat grid as the project timeline (DAW roadmap 3.2). Calls
// `onDone` immediately (no dialog) when the MIDI carried no usable grid, so
// callers can chain the unmapped-notes triage after it unconditionally. The
// radio defaults per `_midiTempoDefaultChoicePure` — Keep when a project grid
// already exists, Use when it doesn't — and never overwrites silently either
// way. Applying runs through the existing `TempoGridCmd`, so it is one
// undoable step that re-locks the loop onto the new grid.
function _maybeOfferMidiTempoMap(tempoMap, onDone) {
    const done = typeof onDone === 'function' ? onDone : () => {};
    const dflt = _midiTempoDefaultChoicePure(S.beats, tempoMap);
    if (!dflt) { done(); return; }
    const midiBeats = _midiTempoToBeatsPure(tempoMap);

    document.getElementById('editor-midi-tempo-modal')?.remove();
    const modal = document.createElement('div');
    modal.id = 'editor-midi-tempo-modal';
    modal.className = 'fixed inset-0 bg-black/70 z-50 flex items-center justify-center';
    const inner = document.createElement('div');
    inner.className = 'bg-dark-800 border border-gray-700 rounded-lg p-6 max-w-lg w-full mx-4';

    const title = document.createElement('h3');
    title.className = 'text-lg font-semibold mb-2';
    title.textContent = 'Use this MIDI’s timing?';
    inner.appendChild(title);

    const intro = document.createElement('p');
    intro.className = 'text-sm text-gray-400 mb-4';
    intro.textContent = `This MIDI carries its own tempo map (${_midiTempoSummaryPure(tempoMap)}). `
        + (dflt === 'keep'
            ? 'Your project already has a timeline — keep it, or replace it with the MIDI’s. Imported notes stay accurate either way.'
            : 'Your project has no bars yet — use the MIDI’s grid, or keep the current (empty) timing. Imported notes stay accurate either way.');
    inner.appendChild(intro);

    const mk = (val, label, desc) => {
        const lab = document.createElement('label');
        lab.className = 'flex items-start gap-2 text-sm text-gray-200 py-1 cursor-pointer';
        const rb = document.createElement('input');
        rb.type = 'radio'; rb.name = 'midi-tempo-choice'; rb.value = val;
        rb.className = 'accent-blue-500 mt-0.5';
        if (val === dflt) rb.checked = true;
        const span = document.createElement('span');
        span.innerHTML = `<span class="text-gray-100">${label}</span>`
            + `<span class="block text-xs text-gray-500">${desc}</span>`;
        lab.appendChild(rb); lab.appendChild(span);
        return lab;
    };
    const group = document.createElement('div');
    group.className = 'mb-4';
    group.appendChild(mk('midi', 'Use MIDI tempo map', 'Replace the project timeline with the bars and tempos from this file.'));
    group.appendChild(mk('keep', 'Keep project timing', 'Leave the current timeline untouched; only add the imported part.'));
    inner.appendChild(group);

    const buttons = document.createElement('div');
    buttons.className = 'flex justify-end gap-2';
    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'px-3 py-1 bg-dark-700 hover:bg-dark-600 rounded';
    cancelBtn.textContent = 'Skip';
    const applyBtn = document.createElement('button');
    applyBtn.className = 'px-3 py-1 bg-blue-600 hover:bg-blue-500 rounded';
    applyBtn.textContent = 'Apply';

    const close = () => { modal.remove(); done(); };
    cancelBtn.onclick = close;   // Skip = keep project timing, whatever the radio shows
    applyBtn.onclick = () => {
        const sel = modal.querySelector('input[name="midi-tempo-choice"]:checked');
        if (sel && sel.value === 'midi' && midiBeats.length) {
            S.history.exec(new TempoGridCmd(S.beats, midiBeats, 'MIDI tempo map'));
            draw();
            setStatus(`Applied the MIDI tempo map (${_midiTempoSummaryPure(tempoMap)}) — save to persist`);
        }
        close();
    };
    buttons.appendChild(cancelBtn);
    buttons.appendChild(applyBtn);
    inner.appendChild(buttons);

    // Keep Space/Delete/etc. from leaking to the global editor handler while
    // the modal is up (mirrors the unmapped-notes modal).
    modal.addEventListener('keydown', (e) => e.stopPropagation());
    modal.appendChild(inner);
    document.body.appendChild(modal);
}

function _showDrumImportUnmappedModal(unmapped) {
    document.getElementById('editor-drum-unmapped-modal')?.remove();

    const modal = document.createElement('div');
    modal.id = 'editor-drum-unmapped-modal';
    modal.className = 'fixed inset-0 bg-black/70 z-50 flex items-center justify-center';

    const inner = document.createElement('div');
    inner.className = 'bg-dark-800 border border-gray-700 rounded-lg p-6 max-w-2xl w-full max-h-[80vh] flex flex-col mx-4';

    const title = document.createElement('h3');
    title.className = 'text-lg font-semibold mb-2';
    title.textContent = 'Unmapped percussion notes';
    inner.appendChild(title);

    const total = unmapped.reduce((s, u) => s + Math.max(0, Number(u.count) || 0), 0);
    const intro = document.createElement('p');
    intro.className = 'text-sm text-gray-400 mb-4';
    intro.textContent = `${total} note${total === 1 ? '' : 's'} (across `
        + `${unmapped.length} MIDI value${unmapped.length === 1 ? '' : 's'}) `
        + `don't map to one of the ${DRUM_PIECE_ORDER.length} slopsmith drum `
        + `pieces. Drop them, or pick a drum piece per row and add them to `
        + `your tab.`;
    inner.appendChild(intro);

    const listWrap = document.createElement('div');
    listWrap.className = 'flex-1 overflow-y-auto border border-gray-700 rounded mb-4';
    const table = document.createElement('table');
    table.className = 'w-full text-sm';
    const thead = document.createElement('thead');
    thead.innerHTML = '<tr class="bg-dark-700 text-gray-400">'
        + '<th class="text-left p-2">MIDI</th>'
        + '<th class="text-left p-2">GM name</th>'
        + '<th class="text-left p-2">Count</th>'
        + '<th class="text-left p-2">Map to</th></tr>';
    table.appendChild(thead);

    // Keep the times/velocities arrays in a JS Map keyed by the row element
    // rather than round-tripping through JSON.stringify/JSON.parse on a
    // dataset attribute — avoids extra CPU + DOM payload for large sets.
    const rowTimes = new Map();
    const tbody = document.createElement('tbody');
    for (const u of unmapped) {
        const tr = document.createElement('tr');
        tr.className = 'border-t border-gray-800';
        tr.dataset.midi = String(u.midi);
        rowTimes.set(tr, {
            times: Array.isArray(u.times) ? u.times : [],
            // Optional, index-aligned with times when the server captured
            // them — the source notes' REAL velocities.
            vels: Array.isArray(u.velocities) ? u.velocities : null,
        });
        const tdMidi = document.createElement('td');
        tdMidi.className = 'p-2 font-mono';
        tdMidi.textContent = u.midi;
        const tdName = document.createElement('td');
        tdName.className = 'p-2 text-gray-500';
        tdName.textContent = _GM_PERC_NAMES[u.midi] || '—';
        const tdCount = document.createElement('td');
        tdCount.className = 'p-2';
        // Coerce to a number so a malformed response (missing / null /
        // non-numeric count) doesn't render "undefined" in the cell.
        tdCount.textContent = Number(u.count) || 0;
        const tdMap = document.createElement('td');
        tdMap.className = 'p-2';
        const sel = document.createElement('select');
        sel.className = 'bg-dark-700 border border-gray-700 rounded px-1 py-0.5';
        const optDrop = document.createElement('option');
        optDrop.value = '';
        optDrop.textContent = '(drop)';
        sel.appendChild(optDrop);
        for (const pid of DRUM_PIECE_ORDER) {
            const opt = document.createElement('option');
            opt.value = pid;
            opt.textContent = (DRUM_PIECE_META[pid] && DRUM_PIECE_META[pid].label) || pid;
            sel.appendChild(opt);
        }
        tdMap.appendChild(sel);
        tr.appendChild(tdMidi);
        tr.appendChild(tdName);
        tr.appendChild(tdCount);
        tr.appendChild(tdMap);
        tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    listWrap.appendChild(table);
    inner.appendChild(listWrap);

    const buttons = document.createElement('div');
    buttons.className = 'flex justify-end gap-2';
    const dropBtn = document.createElement('button');
    dropBtn.className = 'px-3 py-1 bg-dark-700 hover:bg-dark-600 rounded';
    // The notes are already dropped server-side; closing the dialog
    // discards them permanently (no way to reopen). Label matches that
    // intent so it's clearly the inverse of "Add mapped".
    dropBtn.textContent = 'Discard unmapped';
    dropBtn.onclick = () => modal.remove();
    const addBtn = document.createElement('button');
    addBtn.className = 'px-3 py-1 bg-blue-600 hover:bg-blue-500 rounded';
    addBtn.textContent = 'Add mapped';
    addBtn.onclick = () => {
        if (!S.drumTab || !Array.isArray(S.drumTab.hits)) {
            modal.remove();
            return;
        }
        // Build a key-set of existing hits so we don't duplicate against
        // the imported drum_tab if two unmapped notes resolve to the
        // same (rounded-time, piece) — keeps the editor's in-memory
        // hits consistent with what the server would dedupe on save.
        const seen = new Set(S.drumTab.hits.map(
            h => `${Math.round((h.t || 0) * 1000)}|${h.p}`));
        let added = 0, skipped = 0;
        for (const tr of tbody.querySelectorAll('tr')) {
            const sel = tr.querySelector('select');
            if (!sel || !sel.value) continue;
            const pid = sel.value;
            const row = rowTimes.get(tr) || { times: [], vels: null };
            for (let ti = 0; ti < row.times.length; ti++) {
                const t = row.times[ti];
                // Guard against malformed payload: skip NaN / Infinity /
                // negative times rather than push invalid hit objects
                // that break sort/draw and would be dropped by the
                // backend on save anyway.
                if (!Number.isFinite(t) || t < 0) continue;
                const tRounded = Math.round(t * 1000) / 1000;
                const key = `${Math.round(t * 1000)}|${pid}`;
                if (seen.has(key)) { skipped++; continue; }
                seen.add(key);
                // Carry the source note's REAL velocity through when the
                // server captured it (index-aligned with times) — hand-
                // mapping a note must not flatten its dynamics to v:100 —
                // and derive the ghost flag from that velocity exactly like
                // the MIDI importer does, so a hand-mapped quiet note renders
                // and round-trips as a ghost identically to the same note
                // imported through the normal path.
                const rawV = row.vels ? row.vels[ti] : undefined;
                S.drumTab.hits.push(_drumImportHitPure(tRounded, pid, rawV));
                added++;
            }
        }
        if (added > 0) {
            S.drumTab.hits.sort((a, b) => (a.t || 0) - (b.t || 0));
            S.drumTabDirty = true;
            updateArrangementSelector();
            draw();
        }
        if (added > 0 || skipped > 0) {
            const skipMsg = skipped > 0 ? ` (${skipped} duplicate${skipped === 1 ? '' : 's'} skipped)` : '';
            setStatus(`Added ${added} hit${added === 1 ? '' : 's'} from mapped notes${skipMsg} — save to persist`);
        }
        modal.remove();
    };
    buttons.appendChild(dropBtn);
    buttons.appendChild(addBtn);
    inner.appendChild(buttons);

    // Stop key events at the modal boundary so the global onKeyDown
    // doesn't intercept Space (→ play/pause) or Delete while a button
    // is focused. The browser still gets the event to activate the
    // focused button on Space/Enter natively.
    modal.addEventListener('keydown', (e) => e.stopPropagation());

    modal.appendChild(inner);
    document.body.appendChild(modal);
}


// Finalize whatever canvas drag is in progress before a mode switch:
// a moved sync-point / drum drag commits to history via its own
// drag-end handler; any other drag (pan / select / resize) is simply
// cleared. Leaves S.drag null either way.
function _finalizeActiveDrag() {
    if (!S.drag) return;
    if (S.drag.type === 'tempo-sync' || S.drag.type === 'tempo-beat') _tempoMapOnDragEnd();
    else if (S.drag.type === 'drum-move') _drumEditorOnDragEnd();
    else if (S.drag.type === 'drum-velocity') _drumEditorOnVelocityDragEnd();
    // Commit an in-flight handshape create/move/resize through its own mouseup
    // so the edit lands as a history command (instead of being silently
    // dropped when a mode toggle interrupts the drag).
    else if (S.drag.type === 'handshape') onHandshapeLaneMouseUp();
    else S.drag = null;
}
// ════════════════════════════════════════════════════════════════════
// Parts view — stacked all-parts overview (workspace design §3a, 2.2a).
// Every part (each arrangement + the drum tab) renders as a compact
// silhouette lane over one shared timeline with the playhead sweeping
// all lanes. NAVIGATIONAL by design: click arms a part, double-click
// opens its focus editor — technique editing stays in the focus editors.
// ════════════════════════════════════════════════════════════════════

/* @pure:parts-view:start */
// One entry per part: every arrangement, plus the drum tab as its own lane
// (drums are a song-level sidecar, not an arrangement).
function _partsListPure(arrangements, drumTab) {
    const parts = [];
    (arrangements || []).forEach((arr, i) => {
        parts.push({
            kind: 'arr',
            idx: i,
            name: (arr && arr.name) || 'Part ' + (i + 1),
            count: ((arr && Array.isArray(arr.notes)) ? arr.notes.length : 0)
                 + ((arr && Array.isArray(arr.chords)) ? arr.chords.length : 0),
        });
    });
    if (drumTab && Array.isArray(drumTab.hits) && drumTab.hits.length) {
        parts.push({ kind: 'drums', idx: -1, name: 'Drums', count: drumTab.hits.length });
    }
    return parts;
}
// Even lane heights clamped to a readable range.
function _partsLaneLayoutPure(availH, count) {
    if (!count || availH <= 0) return { laneH: 0 };
    return { laneH: Math.max(24, Math.min(88, Math.floor(availH / count))) };
}
// Vertical band for a drum piece category: cymbals ride high, kick sits
// low, everything else in the middle — the 3-row collapsed drum lane.
function _partsDrumBandPure(cat) {
    return cat === 'cymbal' ? 0 : cat === 'kick' ? 2 : 1;
}
// Lane index under a canvas y, or -1.
function _partsLaneAtYPure(y, waveformH, laneH, count) {
    if (y < waveformH || !laneH) return -1;
    const i = Math.floor((y - waveformH) / laneH);
    return i >= 0 && i < count ? i : -1;
}
// Instrument tag for a fretted/keyed arrangement, inferred from its NAME
// alone so every Parts-view lane reflects its OWN part rather than the armed
// arrangement. Self-contained (regexes inlined) so it stays unit-testable
// inside this @pure block. Mirrors KEYS_PATTERN (/^(keys|piano|keyboard|
// synth)/i) and isBassArr's /bass/i test, keys taking precedence.
function _partsArrKindPure(name) {
    const s = String(name || '');
    if (/^(keys|piano|keyboard|synth)/i.test(s)) return 'Keys';
    if (/bass/i.test(s)) return 'Bass';
    return 'Guitar';
}
/* @pure:parts-view:end */

const PARTS_GUTTER = 140;   // header column (name + tag) — wider than LABEL_W

function _partsKindTag(part) {
    if (part.kind === 'drums') return 'Drums';
    const arr = S.arrangements[part.idx];
    if (!arr) return '';
    // Detect this lane's OWN arrangement — the param-less isBassArr() always
    // tests the armed part, which would mistag every non-armed lane.
    return _partsArrKindPure(arr.name);
}

function _partsFitText(s, maxPx) {
    let out = String(s || '');
    if (ctx.measureText(out).width <= maxPx) return out;
    while (out.length > 1 && ctx.measureText(out + '…').width > maxPx) {
        out = out.slice(0, -1);
    }
    return out + '…';
}

function _partsDrawSilhouette(part, y0, laneH, w) {
    const pad = 3;
    const innerH = laneH - pad * 2;
    if (part.kind === 'drums') {
        const bandH = innerH / 3;
        for (const hit of S.drumTab.hits) {
            const x = timeToX(hit.t);
            if (x < PARTS_GUTTER || x > w) continue;
            const meta = DRUM_PIECE_META[hit.p];
            const band = _partsDrumBandPure(meta && meta.cat);
            ctx.fillStyle = (meta && meta.color) || '#999';
            ctx.fillRect(x, y0 + pad + band * bandH + bandH * 0.25, 2, Math.max(2, bandH * 0.5));
        }
        return;
    }
    const arr = S.arrangements[part.idx];
    if (!arr) return;
    // Loose notes + chord notes: only the ACTIVE arrangement is
    // chord-flattened, so other lanes must walk their chords explicitly.
    const events = [];
    if (Array.isArray(arr.notes)) for (const n of arr.notes) events.push(n);
    if (Array.isArray(arr.chords)) {
        for (const c of arr.chords) {
            if (Array.isArray(c.notes)) for (const n of c.notes) events.push(n);
        }
    }
    if (!events.length) return;
    if (KEYS_PATTERN.test(arr.name || '')) {
        // Keys: pitch-mapped mini roll, range auto-fit to the part.
        let lo = Infinity, hi = -Infinity;
        for (const n of events) {
            const m = (n.string || 0) * 24 + (n.fret || 0);
            if (m < lo) lo = m;
            if (m > hi) hi = m;
        }
        const span = Math.max(1, hi - lo);
        ctx.fillStyle = 'rgba(140,190,255,0.75)';
        for (const n of events) {
            const x = timeToX(n.time);
            if (x < PARTS_GUTTER || x > w) continue;
            const m = (n.string || 0) * 24 + (n.fret || 0);
            ctx.fillRect(x, y0 + pad + (1 - (m - lo) / span) * (innerH - 2), 2, 2);
        }
        return;
    }
    // Fretted: string-ribbon rows, low strings at the bottom to match the
    // focus editor's orientation.
    const strings = Math.max(1, _stringCountFor(arr));
    // Per-lane bass detection: isBassArr(arr) ignores its arg and tests the
    // armed part, which would paint every lane the armed part's colour.
    ctx.fillStyle = _partsArrKindPure(arr.name) === 'Bass' ? 'rgba(255,170,90,0.8)' : 'rgba(150,220,150,0.8)';
    for (const n of events) {
        const x = timeToX(n.time);
        if (x < PARTS_GUTTER || x > w) continue;
        const s = Math.max(0, Math.min(strings - 1, n.string || 0));
        const frac = strings <= 1 ? 0.5 : s / (strings - 1);
        ctx.fillRect(x, y0 + pad + (1 - frac) * (innerH - 2), 2, 2);
    }
}

function _partsViewDraw(w, h) {
    drawWaveform(w);
    const parts = _partsListPure(S.arrangements, S.drumTab);
    const { laneH } = _partsLaneLayoutPure(h - WAVEFORM_H, parts.length);
    if (!laneH) return;
    const downbeats = _downbeatTimes();
    for (let p = 0; p < parts.length; p++) {
        const part = parts[p];
        const y0 = WAVEFORM_H + p * laneH;
        const armed = part.kind === 'arr' && part.idx === S.currentArr;
        ctx.fillStyle = armed ? '#141432' : (p % 2 === 0 ? '#0c0c1c' : '#0f0f24');
        ctx.fillRect(0, y0, w, laneH);
        ctx.strokeStyle = '#1a1a35';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, y0 + laneH + 0.5);
        ctx.lineTo(w, y0 + laneH + 0.5);
        ctx.stroke();
        ctx.strokeStyle = 'rgba(255,255,255,0.05)';
        for (const t of downbeats) {
            const x = timeToX(t);
            if (x < PARTS_GUTTER || x > w) continue;
            ctx.beginPath();
            ctx.moveTo(x, y0);
            ctx.lineTo(x, y0 + laneH);
            ctx.stroke();
        }
        _partsDrawSilhouette(part, y0, laneH, w);
        // Header column painted last so silhouettes never bleed into it.
        ctx.fillStyle = armed ? '#191945' : '#101024';
        ctx.fillRect(0, y0, PARTS_GUTTER, laneH);
        ctx.strokeStyle = '#22224a';
        ctx.beginPath();
        ctx.moveTo(PARTS_GUTTER + 0.5, y0);
        ctx.lineTo(PARTS_GUTTER + 0.5, y0 + laneH);
        ctx.stroke();
        ctx.fillStyle = armed ? '#ffffff' : '#c9c9e2';
        ctx.font = '600 12px sans-serif';
        ctx.fillText(_partsFitText(part.name, PARTS_GUTTER - 16), 8, y0 + 16);
        if (laneH >= 34) {
            ctx.fillStyle = '#8383a8';
            ctx.font = '10px sans-serif';
            ctx.fillText(`${_partsKindTag(part)} · ${part.count}`, 8, y0 + 30);
        }
    }
    // Playhead across every lane (the waveform band draws its own).
    const cx = timeToX(S.cursorTime || 0);
    if (cx >= PARTS_GUTTER && cx <= w) {
        ctx.strokeStyle = '#f43f5e';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(cx, 0);
        ctx.lineTo(cx, WAVEFORM_H + parts.length * laneH);
        ctx.stroke();
    }
}

function _partsViewOnMouseDown(e, x, y) {
    if (y < WAVEFORM_H) {
        // Waveform-area click seeks, mirroring the other modes (and the
        // same mid-recording guard).
        if (_recState === 'recording') return;
        S.cursorTime = Math.max(0, xToTime(x));
        if (S.playing) { stopPlayback(); startPlayback(); }
        draw();
        return;
    }
    const parts = _partsListPure(S.arrangements, S.drumTab);
    const { laneH } = _partsLaneLayoutPure((canvas.height / DPR) - WAVEFORM_H, parts.length);
    const i = _partsLaneAtYPure(y, WAVEFORM_H, laneH, parts.length);
    if (i < 0) return;
    const part = parts[i];
    if (part.kind === 'arr' && part.idx !== S.currentArr) {
        window.editorSelectArrangement(part.idx);
        const sel = document.getElementById('editor-arrangement');
        if (sel) sel.value = String(part.idx);
        setStatus(`Armed "${part.name}" — double-click to open it`);
    } else if (part.kind === 'drums') {
        setStatus('Drums — double-click to open the drum editor');
    }
    draw();
}

function _partsViewOnDblClick(e) {
    const { x, y } = getMousePos(e);
    const parts = _partsListPure(S.arrangements, S.drumTab);
    const { laneH } = _partsLaneLayoutPure((canvas.height / DPR) - WAVEFORM_H, parts.length);
    const i = _partsLaneAtYPure(y, WAVEFORM_H, laneH, parts.length);
    if (i < 0) return;
    const part = parts[i];
    S.partsViewMode = false;
    if (part.kind === 'arr') {
        if (part.idx !== S.currentArr) {
            window.editorSelectArrangement(part.idx);
            const sel = document.getElementById('editor-arrangement');
            if (sel) sel.value = String(part.idx);
        }
        setStatus(`Editing "${part.name}"`);
    } else if (S.format === 'sloppak') {
        // Open the drum grid — the same entry steps AND format gate as the
        // Edit Drums button (_refreshDrumEditButton hides itself when
        // format !== 'sloppak'). Without this gate a non-sloppak session
        // carrying a drum_tab could enter drum mode with no visible exit.
        S.drumEditMode = true;
        S.drumSel = new Set();
        hideContextMenu();
        hideAddNote();
        S.sel.clear();
        S.tempoMapMode = false;
        S.tempoSel = -1;
        setStatus('Editing drums');
    } else {
        setStatus('Drum editing needs a sloppak session');
    }
    _refreshPartsViewButton();
    _refreshDrumEditButton();
    _refreshTempoMapButton();
    draw();
    updateStatus();
}

function _editorTogglePartsView() {
    const partCount = (S.arrangements ? S.arrangements.length : 0)
        + ((S.drumTab && Array.isArray(S.drumTab.hits) && S.drumTab.hits.length) ? 1 : 0);
    if (!partCount) { setStatus('Load a song first'); return true; }
    // Commit any in-flight drag before the mode switch (mirrors the drum
    // and tempo toggles).
    _finalizeActiveDrag();
    S.partsViewMode = !S.partsViewMode;
    if (S.partsViewMode) {
        S.tempoMapMode = false;
        S.tempoSel = -1;
        S.drumEditMode = false;
        S.drumSel = new Set();
        hideContextMenu();
        hideAddNote();
        S.sel.clear();
    }
    _refreshPartsViewButton();
    _refreshDrumEditButton();
    _refreshTempoMapButton();
    draw();
    updateStatus();
    setStatus(S.partsViewMode
        ? `Parts view — ${partCount} part${partCount === 1 ? '' : 's'}. Click a lane to arm it, double-click to open.`
        : 'Note edit mode');
    return true;
}
window.editorTogglePartsView = _editorTogglePartsView;

let _partsViewBtnState = '';
function _ensurePartsViewButton() {
    let btn = document.getElementById('editor-parts-view-btn');
    if (!btn) {
        const anchor = document.getElementById('editor-save-btn');
        if (!anchor || !anchor.parentNode) return null;
        btn = document.createElement('button');
        btn.id = 'editor-parts-view-btn';
        btn.type = 'button';
        btn.textContent = '☰ Parts';
        btn.className = 'px-3 py-1 bg-dark-600 hover:bg-dark-500 rounded text-xs font-medium hidden';
        btn.title = 'Stacked overview of every part (Shift+A). Click a lane to arm it, double-click to open it.';
        btn.onclick = () => _editorTogglePartsView();
        anchor.parentNode.insertBefore(btn, anchor.nextSibling);
    }
    return btn;
}
function _refreshPartsViewButton() {
    const btn = _ensurePartsViewButton();
    if (!btn) return;
    const partCount = (S.arrangements ? S.arrangements.length : 0)
        + ((S.drumTab && Array.isArray(S.drumTab.hits) && S.drumTab.hits.length) ? 1 : 0);
    const sig = `${partCount}|${!!S.partsViewMode}|${!!S.sessionId}`;
    if (sig === _partsViewBtnState) return;
    _partsViewBtnState = sig;
    btn.classList.toggle('hidden', !S.sessionId || partCount < 1);
    btn.classList.toggle('bg-accent', !!S.partsViewMode);
    btn.classList.toggle('hover:bg-accent-light', !!S.partsViewMode);
    btn.classList.toggle('bg-dark-600', !S.partsViewMode);
    btn.classList.toggle('hover:bg-dark-500', !S.partsViewMode);
}

// Hook into the existing updateArrangementSelector toolbar pass so the
// button shows/hides alongside +Drums whenever the editor re-renders
// its controls.
const _checkBtnInterval = setInterval(() => {
    if (document.getElementById('editor-add-drums-btn')) {
        _refreshDrumEditButton();
        clearInterval(_checkBtnInterval);
    }
}, 200);
// Run on every draw via a lightweight side-channel — draw is called on
// every state change. Memoization in _refreshDrumEditButton prevents
// DOM mutations on every requestAnimationFrame tick.
const _origDraw = draw;
draw = function () {
    _refreshDrumEditButton();
    _refreshDrumDensityButton();
    _refreshTempoMapButton();
    _refreshTempoSyncInspector();
    _refreshPartsViewButton();
    _refreshKeyControls();
    _refreshViewSwitch();
    return _origDraw.apply(this, arguments);
};

// Run init after DOM is ready
if (document.getElementById('editor-canvas')) {
    init();
} else {
    // Wait for plugin screen to be injected. Held in _bootPollInterval so the
    // teardown can clear it — otherwise a late tick could re-run init() against
    // a torn-down injection and re-register orphaned listeners.
    _bootPollInterval = setInterval(() => {
        if (document.getElementById('editor-canvas')) {
            clearInterval(_bootPollInterval);
            _bootPollInterval = null;
            init();
        }
    }, 100);
}

})();
