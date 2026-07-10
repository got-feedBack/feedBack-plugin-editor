// ════════════════════════════════════════════════════════════════════
// The loop region, bar selection, and scroll viewport.
//
// The A/B loop strip and its drag/nudge/keyboard handling, bar-range selection,
// the scroll-bounds math, and `snapTime` — the one place a raw time becomes a
// snapped one (grid, or the nearest audio onset). Every module that places
// something on the timeline snaps through host.snapTime, which resolves here.
//
// main.js keeps the canvas events that route to the loop-strip handlers, and
// four of its symbols travel back through the shared `host` object: draw, the
// seek, the snap step, and the Loop-in-3D button refresh. The loop-region and
// scroll functions are themselves host hooks (audio.js reads them), now
// resolving to the exports here.
//
// The transport clock and loop-region pures come from src/transport.js; the
// onset cache from src/audio.js (snapTime's onset branch), which does not import
// this module — so no cycle.
//
// Browser surface: the loop strip and its controls.
// ════════════════════════════════════════════════════════════════════
import {
    _abApplyRefGain, _abDisarm, _abOn, _ensureOnsets, _nearestOnsetTimePure, _refreshLoopABBtn,
} from './audio.js';
import { beatOf, timeOf } from './beats.js';
import { DPR, canvas } from './canvas.js';
import {
    EDITOR_SCROLL_TAIL_SECONDS, LABEL_W, _editorClampScrollXPure, _editorViewportDurationPure,
} from './geometry.js';
import { host } from './host.js';
import { SNAP_VALUES, _editorEffectiveSnapValuePure, _editorSnapSubdivisionsPure } from './snap.js';
import { S } from './state.js';
import { _normalizeLoopRegionPure } from './transport.js';
import { setStatus } from './ui.js';

export function _editorViewportDuration() {
    const w = canvas ? canvas.width / DPR : 800;
    return _editorViewportDurationPure(w, LABEL_W, S.zoom);
}

export function _editorClampScrollX(scrollX) {
    return _editorClampScrollXPure(scrollX, S.duration, _editorViewportDuration(), EDITOR_SCROLL_TAIL_SECONDS);
}

export function _editorApplyScrollBounds() {
    S.scrollX = _editorClampScrollX(S.scrollX);
    return S.scrollX;
}
// ── Bar selection (Loop-in-3D handoff) ──────────────────────────────
/* @pure:loop-region:start */
export function _barSpanForTimesPure(downbeats, duration, t0, t1) {
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

export function _adjustBarSelEdgePure(region, edge, rawTime, downbeats, duration) {
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

// ── Loop snap modes ──────────────────────────────────────────────────
// The loop region supports three edit modes (D16): 'bar' = whole-downbeat
// spans (the original behavior), 'grid' = edges snapped by snapFn (the
// editor's subdivision snap — which itself returns raw time when snapping
// is disabled), 'free' = unsnapped. Bar mode silently degrades to free when
// the chart has no downbeats, so an un-gridded drifting-tempo song can
// still loop. Regions carry `mode` so later grid edits relock bar/grid
// loops but never move a freely drawn one (D17).

export function _loopRegionForDragPure(mode, t0, t1, downbeats, duration, snapFn) {
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

export function _loopEdgeAdjustPure(mode, region, edge, rawTime, downbeats, duration, snapFn) {
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
export function _downbeatTimes() {
    return S.beats.filter(b => b.measure > 0).map(b => b.time).sort((a, b) => a - b);
}
// Snap a pair of raw times to a whole-bar span: start = the downbeat at or
// before the earlier time, end = the downbeat strictly after the later time
// (falling back to the song end). Returns null when the chart has no
// downbeats (so the beat bar can't define bars).
export function _barSpanForTimes(t0, t1) {
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

export function _renderLoopStrip() {
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

export function _clearBarSelection() {
    S.barSel = null;
    S.loopEnabled = false;
    _updateLoopRegionControls();
    host.updateLoopIn3DBtn();
    host.draw();
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
export function _loopLiveMode(shiftKey) {
    if (shiftKey) return 'free';
    if (!_downbeatTimes().length) return 'free';
    return _loopSnapModePref;
}

export function editorSetLoopSnapMode(mode) {
    if (mode !== 'bar' && mode !== 'grid' && mode !== 'free') return;
    _loopSnapModePref = mode;
    try { localStorage.setItem('editorLoopSnapMode', mode); } catch (_) {}
    _refreshLoopModeButtons();
    setStatus(mode === 'bar' ? 'Loop snaps to whole bars'
        : mode === 'grid' ? 'Loop snaps to the current grid subdivision'
        : 'Loop edges are free — no snapping (hold Shift for this in any mode)');
}

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
export function _loopNudgeProbePure(mode, edge, cur, dir, downbeats, snapStep, coarse) {
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
export function _loopNudgeEdge(edge, dir, coarse) {
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
        mode, edge, cur, dir, downbeats, host.editorSnapStepSeconds(), coarse);
    if (probe === null) return false;
    const next = _loopEdgeAdjustPure(
        mode, r, edge, probe, downbeats, S.duration || Math.max(cur, probe), snapTime);
    if (!next) return false;
    _setBarSel(next);
    host.updateLoopIn3DBtn();
    _renderLoopStrip();
    host.draw();
    return true;
}

// Arrow-key nudging on the focused loop handle. The handles are real
// <button>s, so clicking one focuses it; Left/Right then nudge that edge
// without claiming any new global shortcut.
export function _loopHandleKeydown(edge, e) {
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
export function _setBarSel(region) {
    S.barSel = region ? _loopSyncBeats(region) : null;
    return S.barSel;
}

// Sync a loop region's beat-coordinate edges from its seconds against the
// current grid. Bar/grid edges resolve to integer / subdivided beats; a free
// loop drops its β so a later grid edit leaves it untouched.
export function _loopSyncBeats(r) {
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
export function _loopReprojectFromBeats(beats) {
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
export function _loopReliftBeats(beats) {
    const r = S.barSel;
    if (!r || r.mode === 'free') return;
    r.startBeat = beatOf(beats, r.startTime);
    r.endBeat = beatOf(beats, r.endTime);
}

export function _selectedLoopRegion() {
    return _normalizeLoopRegionPure(S.barSel, S.duration);
}

export function _updateLoopRegionControls() {
    const region = _selectedLoopRegion();
    if (!region && S.loopEnabled) S.loopEnabled = false;
    // A/B rides the loop region — clearing the region disarms it (and
    // restores the reference gain via the guarded apply).
    if (!region && _abOn) _abDisarm();
    _refreshLoopABBtn();
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

export function _setLoopRegionEnabled(enabled) {
    const region = _selectedLoopRegion();
    S.loopEnabled = !!(enabled && region);
    if (S.loopEnabled && (S.cursorTime < region.startTime || S.cursorTime >= region.endTime)) {
        host.editorSeekToTime(region.startTime);
    }
    _updateLoopRegionControls();
    // Toggling the loop off flips _abActive() false: restore the recording to
    // its fader level so stopping the loop mid-guide-pass never leaves it
    // silently muted. Toggle-only path (never the per-frame strip render), so
    // scheduling the ~20 ms ramp here can't spam the audio param.
    if (typeof _abApplyRefGain === 'function') _abApplyRefGain();
    host.draw();
    setStatus(S.loopEnabled ? 'Loop region enabled' : 'Loop region disabled');
}

export function editorToggleLoopRegion() { return _setLoopRegionEnabled(!S.loopEnabled); }
export function _loopStripOnMouseDown(e) {
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
    host.updateLoopIn3DBtn();
    host.draw();
    e.preventDefault();
}

export function _loopStripOnMouseMove(e) {
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
    host.updateLoopIn3DBtn();
    host.draw();
    return true;
}

export function _loopStripOnMouseUp() {
    if (!S.drag || S.drag.type !== 'loopstrip') return false;
    S.drag = null;
    host.updateLoopIn3DBtn();
    host.draw();
    return true;
}
// Onset-snap tolerance (seconds): how close a note's placement must be to a
// detected transient to snap onto it instead of the grid. ~70 ms spans the
// grid-vs-attack gap on real recordings without hijacking clearly off-onset
// placements; beyond it, snapTime falls back to grid snap.
export const ONSET_SNAP_TOL = 0.07;

export function snapTime(t) {
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
export function _groupTimeDeltaPure(origTimes, primaryOrig, dtRaw, snapFn) {
    const base = Number.isFinite(primaryOrig) ? primaryOrig
        : (Array.isArray(origTimes) && origTimes.length ? origTimes[0] : 0);
    let dt = snapFn(base + dtRaw) - base;
    let earliest = Infinity;
    if (Array.isArray(origTimes)) for (const t of origTimes) if (t < earliest) earliest = t;
    if (Number.isFinite(earliest) && earliest + dt < 0) dt = -earliest;
    return dt;
}
/* @pure:group-time-delta:end */
