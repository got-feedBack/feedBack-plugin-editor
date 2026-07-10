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
import {
} from './position.js';

import { _editorPromptText, _installModalKeyboard, setStatus } from './ui.js';
import { hitNote, hitNoteEdge } from './hit-test.js';
import { EditHistory } from './history.js';
import {
    AddNoteCmd, AddStringCmd, ChangeFretCmd, ChangeFretGroupCmd, DeleteNotesCmd,
    MoveNoteCmd, RemoveStringCmd, ResizeSustainGroupCmd,
    SetPitchedSlideTargetsCmd, SetTeachingMarkCmd, ToggleTechniqueCmd, _ROLL_REFUSE_REASONS,
    _commitAddResolved, _execCyclePosition, _execMoveString, _execMoveStringSameFret,
    _rollAddByPitch, _rollDragPitchMove, _withStableSelection,
} from './commands.js';
import {
    editorApplyCreateResult, editorArtSearch,
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
import {
    _renderInspector, _selectedChordContext, _selectedNotes, editorChordSetCaged,
    editorChordSetDisplayName, editorChordSetFinger, editorChordSetFnDeg,
    editorChordSetFnQuality, editorChordSetFnRn, editorChordSetGuideTones, editorChordSetName,
    editorChordSetVoicing, editorChordToggleArp, editorGroupAsStrum,
    editorInspectorSetBendIntent, editorInspectorSetField, editorInspectorSetFlag,
    editorInspectorSetFretFinger, editorInspectorSetScaleDegree, editorInspectorSetTech,
    editorOpenBendCurve, editorUngroupStrum,
} from './inspector.js';
import {
    hideContextMenu, promptBend, promptFret, promptSlide, promptSlideUnpitch, showContextMenu,
} from './context-menu.js';
import {
    _auditionPitch, _editBlipAt, _editorToggleFollow, _editorToggleGuideClap,
    _editorToggleLoopAB, _editorToggleMetronome, _editorToggleMixer,
    _editorToggleOnsetStrip, _editorToggleSnapMode, _ensureOnsets, _mixDragChangedPitchPure,
    _onsetStripEnabled, editorSetEditBlip, editorSetMixLevel, initAudio, loadAudio,
    startPlayback, stopPlayback, teardownAudio,
} from './audio.js';
import {
    _barSpanForTimes, _clearBarSelection, _downbeatTimes, _editorApplyScrollBounds,
    _editorClampScrollX, _groupTimeDeltaPure, _loopHandleKeydown, _loopReliftBeats,
    _loopReprojectFromBeats, _loopStripOnMouseDown, _loopStripOnMouseMove,
    _loopStripOnMouseUp, _renderLoopStrip, _selectedLoopRegion, _setBarSel,
    _setLoopRegionEnabled, editorSetLoopSnapMode,
    editorToggleLoopRegion, snapTime,
} from './loop.js';
import {
    editorAddEmptyKeys,
    editorDoAddKeys, editorDoImportGuitar, editorHideAddKeysModal,
    editorHideImportGuitarModal, editorImportGuitarDestChanged,
    editorImportGuitarFileSelected, editorImportGuitarRefreshReplaceTargets,
    editorKeysFileSelected, editorShowAddKeysModal, editorShowImportGuitarModal,
} from './import.js';
import {
    editorDoAddDrums, editorDrumsFileSelected, editorDrumsGPSelected,
    editorHideAddDrumsModal, editorRemoveArrangement, editorRenameArrangement,
    editorShowAddDrumsModal,
} from './arrangement.js';
import {
    _activeArrangementExceedsArchiveLimit, _editorLoadsInFlight, _resetOffsetUI,
    editorHideSaveFormatModal, editorSaveAsSloppakConfirm, filterSongs, loadCDLC,
    saveCDLC, showLoadModal,
} from './file-ops.js';
import {
    editorApplyReplaceAudio, editorHideReplaceAudioModal, editorSetReplaceAudioMode,
    editorShowReplaceAudioModal,
} from './replace-audio.js';
import {
    editorApplySync, editorHideSyncDialog, editorSyncTempo, editorSyncUpdateFactor,
    getTabBPM,
} from './sync-tempo.js';
import { setHostHooks } from './host.js';
import {
    MIN_MEASURE, TempoGridCmd, TempoMapCmd, _editorModulateTempoAtSelection,
    _editorTapTempoAtSelection, _editorToggleSyncLock, _editorToggleTempoMapMode, _r3, _refreshTempoMapButton, _refreshTempoSyncInspector, _respaceWithLocksPure,
    _tapTempoHandleKey,
    _tempoBeatOnDragMove, _tempoDeleteSyncPoint, _tempoFlattenToBpmPure,
    _tempoHasMultipleMeasureBpmsPure, _tempoInsertSyncPoint, _tempoMapDraw, _tempoMapOnContextMenu,
    _tempoMapOnDragEnd, _tempoMapOnDragMove, _tempoMapOnMouseDown, _tempoMeasureBeatCount,
    _tempoMeasureDenominator, _tempoMeasures, _tempoNormalizeDenominatorPure,
    _tempoPromptMeasureBpm, _tempoSetBeatsPerMeasure, _tempoSetDenominatorOnBeatsPure,
    _tempoSetMeasureBpmPure, _tempoSyncAtX,
} from './tempo.js';
import {
    AddAnchorCmd, AddHandshapeCmd, AddToneChangeCmd, RemoveAnchorCmd, RemoveHandshapeCmd,
    RemoveToneChangeCmd, _anchorLaneTopY, _currentAnchorArr,
    _currentToneArr, _ensureTones, _handshapeLaneTopY, _readAnchorSnapshot,
    drawAnchorLane,
    drawHandshapeLane, drawToneLane, editorApplyTonesModal, editorHideTonesModal,
    editorShowTonesModal, onAnchorLaneContextMenu, onAnchorLaneMouseDown,
    onAnchorLaneMouseMove, onAnchorLaneMouseUp, onHandshapeLaneContextMenu,
    onHandshapeLaneMouseDown, onHandshapeLaneMouseMove, onHandshapeLaneMouseUp,
    onToneLaneContextMenu, onToneLaneMouseDown, onToneLaneMouseMove, onToneLaneMouseUp,
} from './annotation-lanes.js';
import {
    DRUM_PIECE_META, _drumEditorDeleteSelection, _drumEditorDraw,
    _drumEditorNudgeVelocity, _drumEditorOnDragEnd, _drumEditorOnDragMove,
    _drumEditorOnMouseDown, _drumEditorOnSelectEnd, _drumEditorOnVelocityDragEnd,
    _drumEditorOnVelocityDragMove, _drumEditorSetVelocity, _drumEditorToggleArticulation,
    _editorToggleDrumDensity, _refreshDrumDensityButton,
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
    _stringCountFor,
    laneLabels,
    laneToStr,
    lanes,
    strToLane,
} from './lanes.js';
import {
    ANCHOR_LANE_H, BEAT_H, HS_LANE_H, LABEL_W, LANE_H, TONE_LANE_H, WAVEFORM_H,
    setLaneMetrics, strToY, timeToX, xToTime, yToStr,
} from './geometry.js';
import {
    KEYS_PATTERN, PIANO_LANE_H, _inKeyboardGutterPure, _partViewKeyPure, _rollLockNotice,
    _rollMidiForNote, _rollPitchCtx, _rollReadOnly, _viewPrefs,
    _viewPrefsSave, isKeysArr, isKeysMode, midiToFret, midiToNote, midiToString, midiToY,
    noteToMidi, pianoLaneCount, updatePianoRange, viewFor, yToMidi,
} from './keys.js';
import {
    _resizeSustainsForDeltaPure, _resizeTargetIndicesPure, _restoreSuggestedMarks,
    _saveSuggestedMarks, _suggestedCount, chords, notes,
} from './notes.js';
import { flattenChords } from './chords.js';

(function () {
'use strict';

// ════════════════════════════════════════════════════════════════════
// Constants
// ════════════════════════════════════════════════════════════════════


// ════════════════════════════════════════════════════════════════════
// State
// ════════════════════════════════════════════════════════════════════




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
    promptBend,
    scheduleCanvasResize: _scheduleCanvasResize,
    loadCDLC,
    loadAudio,
    kickLibraryRescan: _kickLibraryRescan,
    resetOffsetUI: _resetOffsetUI,
    updateTimeDisplay,
    addGlobalListener: (target, ev, fn) => _globalListeners.add(target, ev, fn),
    drawNow: (...args) => drawNow(...args),
    editorClampScrollX: _editorClampScrollX,
    editorApplyScrollBounds: _editorApplyScrollBounds,
    selectedLoopRegion: _selectedLoopRegion,
    setLoopRegionEnabled: _setLoopRegionEnabled,
    editorSeekToTime: _editorSeekToTime,
    editorSnapStepSeconds: _editorSnapStepSeconds,
    effectiveAudioOffset: () => _effectiveAudioOffset(),
    applyEditorPendingView: (...a) => _applyEditorPendingView(...a),
});

// Re-attach the song-import modal handlers (import.js owns the logic; the HTML
// calls these by name so they must live on window).
window.editorShowAddKeysModal = editorShowAddKeysModal;
window.editorHideAddKeysModal = editorHideAddKeysModal;
window.editorKeysFileSelected = editorKeysFileSelected;
window.editorDoAddKeys = editorDoAddKeys;
window.editorAddEmptyKeys = editorAddEmptyKeys;
window.editorShowImportGuitarModal = editorShowImportGuitarModal;
window.editorHideImportGuitarModal = editorHideImportGuitarModal;
window.editorImportGuitarDestChanged = editorImportGuitarDestChanged;
window.editorImportGuitarRefreshReplaceTargets = editorImportGuitarRefreshReplaceTargets;
window.editorImportGuitarFileSelected = editorImportGuitarFileSelected;
window.editorDoImportGuitar = editorDoImportGuitar;

// Arrangement management (rename / remove / add-drums import) — arrangement.js.
window.editorRenameArrangement = editorRenameArrangement;
window.editorRemoveArrangement = editorRemoveArrangement;
window.editorShowAddDrumsModal = editorShowAddDrumsModal;
window.editorHideAddDrumsModal = editorHideAddDrumsModal;
window.editorDrumsFileSelected = editorDrumsFileSelected;
window.editorDrumsGPSelected = editorDrumsGPSelected;
window.editorDoAddDrums = editorDoAddDrums;

// Save-format modal (file-ops.js owns the logic; HTML calls these by name).
window.editorHideSaveFormatModal = editorHideSaveFormatModal;
window.editorSaveAsSloppakConfirm = editorSaveAsSloppakConfirm;

// Replace-audio modal (replace-audio.js owns the logic; HTML calls these by name).
window.editorShowReplaceAudioModal = editorShowReplaceAudioModal;
window.editorHideReplaceAudioModal = editorHideReplaceAudioModal;
window.editorSetReplaceAudioMode = editorSetReplaceAudioMode;
window.editorApplyReplaceAudio = editorApplyReplaceAudio;

// Sync-tempo dialog (sync-tempo.js owns the logic; HTML calls these by name).
window.editorSyncTempo = editorSyncTempo;
window.editorSyncUpdateFactor = editorSyncUpdateFactor;
window.editorHideSyncDialog = editorHideSyncDialog;
window.editorApplySync = editorApplySync;

window.editorHideRecordMidiModal = editorHideRecordMidiModal;
window.editorRecordMidiDeviceChanged = editorRecordMidiDeviceChanged;
window.editorChordSetCaged = editorChordSetCaged;
window.editorChordSetDisplayName = editorChordSetDisplayName;
window.editorChordSetFinger = editorChordSetFinger;
window.editorChordSetFnDeg = editorChordSetFnDeg;
window.editorChordSetFnQuality = editorChordSetFnQuality;
window.editorChordSetFnRn = editorChordSetFnRn;
window.editorChordSetGuideTones = editorChordSetGuideTones;
window.editorChordSetName = editorChordSetName;
window.editorChordSetVoicing = editorChordSetVoicing;
window.editorChordToggleArp = editorChordToggleArp;
window.editorGroupAsStrum = editorGroupAsStrum;
window.editorInspectorSetBendIntent = editorInspectorSetBendIntent;
window.editorInspectorSetField = editorInspectorSetField;
window.editorInspectorSetFlag = editorInspectorSetFlag;
window.editorInspectorSetFretFinger = editorInspectorSetFretFinger;
window.editorInspectorSetScaleDegree = editorInspectorSetScaleDegree;
window.editorInspectorSetTech = editorInspectorSetTech;
window.editorOpenBendCurve = editorOpenBendCurve;
window.editorUngroupStrum = editorUngroupStrum;
window.editorSetEditBlip = editorSetEditBlip;
window.editorSetMixLevel = editorSetMixLevel;
window.editorToggleGuideClap = _editorToggleGuideClap;
window.editorToggleLoopAB = _editorToggleLoopAB;
window.editorToggleMetronome = _editorToggleMetronome;
window.editorToggleMixer = _editorToggleMixer;
window.editorToggleOnsetStrip = _editorToggleOnsetStrip;
window.editorToggleSnapMode = _editorToggleSnapMode;
window.editorSetLoopSnapMode = editorSetLoopSnapMode;
window.editorToggleLoopRegion = editorToggleLoopRegion;
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
    teardownAudio();  // stops playback + cancels the rAF loop (src/audio.js owns both)
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
    initAudio();

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
