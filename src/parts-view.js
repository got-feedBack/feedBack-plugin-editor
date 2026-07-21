// Parts overview ("Parts view"): a stacked read-only silhouette of every part
// (arrangements + drum tab), armed by lane click / opened by double-click. The
// toggle + its per-part draw / hit handlers are called back from main.js
// (drawNow, the canvas hooks); everything they refresh routes through host.

import { startPlayback, stopPlayback } from './audio.js';
import { CP } from './canvas-appearance.js';
import { ctx } from './canvas.js';
import { hideContextMenu } from './context-menu.js';
import { DRUM_PIECE_META, _refreshDrumEditButton } from './drum.js';
import { beatOf, timeOf } from './beats.js';
import { LABEL_W, TIMELINE_TOP, timeToX, xToTime } from './geometry.js';
import { _regionBlockRectPure, _regionHitPure, _regionSnapStartPure, _regionTimeSpanPure, _trackRegionsResolvePure } from './region.js';
import { MoveRegionCmd } from './region-commands.js';
import { isDrumArrangement } from './drum-arrangement.js';
import { arrKind } from './instrument.js';
import { _stringCountFor } from './lanes.js';
import { _downbeatTimes } from './loop.js';
import { _recState } from './midi-record.js';
import { getMousePos } from './mouse.js';
import { S } from './state.js';
import { _refreshTempoMapButton } from './tempo.js';
import {
    _liveSources, _trackSessionFittedHeightsPure, _trackSessionLaneLayoutPure, _trackSessionRowsPure,
    _trackSessionTargetsPure, refreshTrackSessionSelection,
} from './track-session.js';
import { setStatus } from './ui.js';
import { host } from './host.js';

/* @pure:parts-view:start */
// One entry per part: every arrangement — each drum part (a song can hold
// several) gets its own drum lane drawn from its OWN tab. The idx -1 lane is
// the legacy unmaterialized tab (create-mode compose).
export function _partsListPure(arrangements, drumTab) {
    const parts = [];
    let anyDrumArr = false;
    (arrangements || []).forEach((arr, i) => {
        if (arr && arr.type === 'drums') {
            anyDrumArr = true;
            const hits = (arr.drumTab && Array.isArray(arr.drumTab.hits)) ? arr.drumTab.hits : [];
            parts.push({ kind: 'drums', idx: i, name: arr.name || 'Drums', count: hits.length });
            return;
        }
        parts.push({
            kind: 'arr',
            idx: i,
            name: (arr && arr.name) || 'Track ' + (i + 1),
            count: ((arr && Array.isArray(arr.notes)) ? arr.notes.length : 0)
                 + ((arr && Array.isArray(arr.chords)) ? arr.chords.length : 0),
        });
    });
    if (!anyDrumArr && drumTab && Array.isArray(drumTab.hits) && drumTab.hits.length) {
        parts.push({ kind: 'drums', idx: -1, name: 'Drums', count: drumTab.hits.length });
    }
    return parts;
}
// Even lane heights clamped to a readable range.
export function _partsLaneLayoutPure(availH, count) {
    if (!count || availH <= 0) return { laneH: 0 };
    return { laneH: Math.max(24, Math.min(88, Math.floor(availH / count))) };
}
// Vertical band for a drum piece category: cymbals ride high, kick sits
// low, everything else in the middle — the 3-row collapsed drum lane.
function _partsDrumBandPure(cat) {
    return cat === 'cymbal' ? 0 : cat === 'kick' ? 2 : 1;
}
// Lane index under a canvas y, or -1.
export function _partsLaneAtYPure(y, waveformH, laneH, count) {
    if (y < waveformH || !laneH) return -1;
    const i = Math.floor((y - waveformH) / laneH);
    return i >= 0 && i < count ? i : -1;
}
// Instrument tag for a fretted/keyed arrangement lane, from its RESOLVED
// instrument kind (the caller passes arrKind — an authored `type` wins over
// the name), so every Parts-view lane reflects its OWN part's identity rather
// than the armed arrangement OR a misleading name. Self-contained (a plain
// kind→tag map) so it stays unit-testable inside this @pure block.
export function _partsArrKindPure(kind) {
    if (kind === 'keys') return 'Keys';
    if (kind === 'bass') return 'Bass';
    return 'Guitar';
}
// Unified-row hit test over the EXACT layout the header column shares —
// so a click on a canvas lane lands on the same row its header cell shows.
function _partsTrackRowAtYPure(layout, y) {
    const lane = (layout || []).find(item => y >= item.y && y < item.y + item.h);
    return lane ? lane.row : null;
}
/* @pure:parts-view:end */

// The in-canvas gutter shrinks to the standard label width — the DOM header
// column (src/track-session.js) owns names/controls now.
const PARTS_GUTTER = LABEL_W;

// The unified rows (audio + transcription + folders) the header column shows —
// same pure, same inputs, so geometry can never diverge between surfaces.
function _unifiedRows() {
    return _trackSessionRowsPure(S.trackSession,
        _liveSources(), S.arrangements, S.drumTab, S.stemLinks).rows;
}
// Map a transcription targetId back to its arrangement index ('drums' → -1).
function _arrIndexForTarget(targetId) {
    const target = _trackSessionTargetsPure(S.arrangements, S.drumTab)
        .find(item => item.id === targetId);
    return target && target.mixKey.startsWith('arr:') ? Number(target.mixKey.slice(4)) : -1;
}

// An audio lane's waveform, when the host has one cached for the source
// (today: the master mix via S.waveformPeaks; stems light up with the
// engine slice). host.trackWaveform's inert default returns null — the
// lane then just shows its background and downbeats.
function _drawTrackAudioWaveform(row, y0, laneH, w) {
    const data = host.trackWaveform(row.sourceId);
    if (!data || !data.peaks || !data.peaks.bins || !(data.duration > 0)) return;
    const pk = data.peaks;
    const shift = (Number(S.audioShift) || 0) + (Number(row.sourceOffset) || 0);
    const xLo = Math.max(PARTS_GUTTER, Math.floor(timeToX(shift)));
    const xHi = Math.min(w, Math.ceil(timeToX(data.duration + shift)));
    const mid = y0 + laneH / 2;
    const amp = Math.max(2, laneH / 2 - 5);
    ctx.strokeStyle = 'rgba(120,150,210,.18)';
    ctx.beginPath(); ctx.moveTo(xLo, mid + .5); ctx.lineTo(xHi, mid + .5); ctx.stroke();
    ctx.fillStyle = row.sourceKind === 'master' ? 'rgba(95,165,245,.72)' : 'rgba(74,205,220,.72)';
    for (let px = xLo; px < xHi; px++) {
        let i0 = Math.floor((xToTime(px) - shift) / data.duration * pk.bins);
        let i1 = Math.floor((xToTime(px + 1) - shift) / data.duration * pk.bins);
        i0 = Math.max(0, Math.min(pk.bins - 1, i0));
        i1 = Math.max(i0, Math.min(pk.bins - 1, i1));
        let lo = pk.min[i0]; let hi = pk.max[i0];
        for (let i = i0 + 1; i <= i1; i++) { if (pk.min[i] < lo) lo = pk.min[i]; if (pk.max[i] > hi) hi = pk.max[i]; }
        ctx.fillRect(px, mid - hi * amp, 1, Math.max(1, (hi - lo) * amp));
    }
}

function _partsDrawSilhouette(part, y0, laneH, w) {
    const pad = 3;
    const innerH = laneH - pad * 2;
    if (part.kind === 'drums') {
        // Each drum part paints ITS OWN tab (idx ≥ 0 names the arrangement);
        // idx -1 is the legacy unmaterialized tab (create-mode compose).
        const arr = part.idx >= 0 ? S.arrangements[part.idx] : null;
        const tab = (arr && arr.drumTab) || S.drumTab;
        if (!tab || !Array.isArray(tab.hits)) return;
        const bandH = innerH / 3;
        for (const hit of tab.hits) {
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
    if (arrKind(arr) === 'keys') {
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
    // Per-lane bass detection via the resolved kind (keys already returned
    // above): an authored `type` wins over the name, so a bass lane paints
    // orange regardless of what part is armed or how it's named.
    ctx.fillStyle = _partsArrKindPure(arrKind(arr)) === 'Bass' ? 'rgba(255,170,90,0.8)' : 'rgba(150,220,150,0.8)';
    for (const n of events) {
        const x = timeToX(n.time);
        if (x < PARTS_GUTTER || x > w) continue;
        const s = Math.max(0, Math.min(strings - 1, n.string || 0));
        const frac = strings <= 1 ? 0.5 : s / (strings - 1);
        ctx.fillRect(x, y0 + pad + (1 - frac) * (innerH - 2), 2, 2);
    }
}

// The kind colour of a track's region spine — mirrors the silhouette/waveform
// palette so a block reads as the same instrument as its content.
function _regionSpineColor(row) {
    if (row.type === 'audio') return row.sourceKind === 'master' ? '#5fa5f5' : '#4acddc';
    if (row.targetId === 'drums') return '#c084fc';
    const kind = _partsArrKindPure(row.name);
    return kind === 'Bass' ? '#ffaa5a' : kind === 'Keys' ? '#8cbaff' : '#7bd88a';
}

// A lane's content extent in seconds [t0, t1] — an audio source's placed
// duration, or the first..last event of a transcription/drum part — so a
// full-span region block wraps exactly the content it contains. null when the
// lane has nothing to bound (an empty part, or audio with no duration yet).
function _laneContentTimeExtent(row, arrIdx) {
    if (row.type === 'audio') {
        const data = host.trackWaveform(row.sourceId);
        const shift = (Number(S.audioShift) || 0) + (Number(row.sourceOffset) || 0);
        if (data && data.duration > 0) return [shift, data.duration + shift];
        const dur = Number(S.duration) || 0;
        return dur > 0 ? [0, dur] : null;
    }
    let lo = Infinity, hi = -Infinity;
    const consider = (t) => { const n = Number(t); if (Number.isFinite(n)) { if (n < lo) lo = n; if (n > hi) hi = n; } };
    if (row.targetId === 'drums') {
        if (S.drumTab && Array.isArray(S.drumTab.hits)) for (const hit of S.drumTab.hits) consider(hit.t);
    } else if (arrIdx >= 0) {
        const arr = S.arrangements[arrIdx];
        if (arr) {
            if (Array.isArray(arr.notes)) for (const n of arr.notes) consider(n.time);
            if (Array.isArray(arr.chords)) for (const c of arr.chords) if (Array.isArray(c.notes)) for (const n of c.notes) consider(n.time);
        }
    }
    return hi >= lo ? [lo, hi] : null;
}

// Draw each of a lane's regions as a block: a kind-colour spine, a hairline
// border (accent when selected), and the name when the lane is tall enough.
// Drawn OVER the content silhouette so the border reads. Today every track has
// one full-span region wrapping its whole content; bounded blocks arrive with
// the move/trim PRs and need no change here (the span pure resolves them).
function _drawRegionBlocks(row, y0, laneH, w, extent) {
    if (!extent) return;
    const spine = _regionSpineColor(row);
    const selectedRow = row.id === S.selectedTrackId;
    const beatToTime = (beat) => timeOf(S.beats, beat);
    for (const region of _trackRegionsResolvePure(row.regions)) {
        const span = _regionTimeSpanPure(region, extent[0], extent[1], beatToTime);
        const rect = _regionBlockRectPure(timeToX(span.t0), timeToX(span.t1), PARTS_GUTTER, w);
        if (!rect.visible) continue;
        const isSel = selectedRow && region.id === S.selectedRegionId;
        const top = y0 + 1.5;
        const boxH = Math.max(2, laneH - 3);
        ctx.strokeStyle = isSel ? 'rgba(120,180,255,.95)' : 'rgba(148,163,184,.32)';
        ctx.lineWidth = isSel ? 1.5 : 1;
        ctx.strokeRect(rect.x + 0.5, top + 0.5, Math.max(1, rect.w - 1), boxH - 1);
        ctx.fillStyle = spine;
        ctx.fillRect(rect.x, top, 3, boxH);
        if (laneH >= 30 && rect.w > 44) {
            ctx.save();
            ctx.beginPath();
            ctx.rect(rect.x, top, rect.w, boxH);
            ctx.clip();
            ctx.font = '10px system-ui, sans-serif';
            ctx.textBaseline = 'top';
            ctx.fillStyle = isSel ? 'rgba(210,230,255,.95)' : 'rgba(200,210,230,.7)';
            ctx.fillText(String(region.name || row.name || 'Region'), rect.x + 7, top + 3);
            ctx.restore();
        }
    }
}

export function _partsViewDraw(w, h) {
    host.drawTimelineHeader(w);
    const rows = _unifiedRows();
    const fitted = _trackSessionFittedHeightsPure(rows, S.trackHeights, S.trackViewportHeight);
    const { lanes } = _trackSessionLaneLayoutPure(rows, fitted, S.trackScrollY, TIMELINE_TOP);
    const downbeats = _downbeatTimes();
    for (let p = 0; p < lanes.length; p++) {
        const { row, y: y0, h: laneH } = lanes[p];
        if (y0 + laneH <= TIMELINE_TOP || y0 >= h) continue;
        const arrIdx = row.type === 'transcription' ? _arrIndexForTarget(row.targetId) : -1;
        const armed = arrIdx >= 0 && arrIdx === S.currentArr;
        const selected = row.id === S.selectedTrackId;
        ctx.fillStyle = selected ? '#12324a' : row.type === 'folder' ? '#172033' : armed ? CP('partsLaneArmed') : (p % 2 === 0 ? CP('laneEven') : CP('laneOdd'));
        ctx.fillRect(0, y0, w, laneH);
        ctx.strokeStyle = CP('laneSep');
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, y0 + laneH + 0.5);
        ctx.lineTo(w, y0 + laneH + 0.5);
        ctx.stroke();
        ctx.strokeStyle = CP('partsDownbeat');
        for (const t of downbeats) {
            const x = timeToX(t);
            if (x < PARTS_GUTTER || x > w) continue;
            ctx.beginPath();
            ctx.moveTo(x, y0);
            ctx.lineTo(x, y0 + laneH);
            ctx.stroke();
        }
        if (row.type === 'audio') _drawTrackAudioWaveform(row, y0, laneH, w);
        else if (row.type === 'transcription' && arrIdx >= 0 && isDrumArrangement(S.arrangements[arrIdx])) {
            // A drum part's lane paints its OWN tab (any of several parts).
            _partsDrawSilhouette({ kind: 'drums', idx: arrIdx }, y0, laneH, w);
        } else if (row.type === 'transcription' && row.targetId === 'drums') {
            // Legacy unmaterialized tab (create-mode compose).
            if (S.drumTab && Array.isArray(S.drumTab.hits)) _partsDrawSilhouette({ kind: 'drums', idx: -1 }, y0, laneH, w);
        } else if (row.type === 'transcription' && arrIdx >= 0) {
            _partsDrawSilhouette({ kind: 'arr', idx: arrIdx }, y0, laneH, w);
        } else if (row.type === 'folder') {
            ctx.fillStyle = 'rgba(251,191,36,.16)';
            ctx.fillRect(PARTS_GUTTER, y0 + laneH - 2, w - PARTS_GUTTER, 2);
        }
        if (row.type !== 'folder') _drawRegionBlocks(row, y0, laneH, w, _laneContentTimeExtent(row, arrIdx));
        // Drag ghost: a dashed preview of where the block will land, on its own
        // row, at the bar-snapped start (see _partsViewRegionDrag).
        if (S.drag && S.drag.type === 'region-move' && S.drag.moved && row.id === S.drag.trackId) {
            const gr = _regionBlockRectPure(
                timeToX(S.drag.snappedStart), timeToX(S.drag.snappedStart + S.drag.spanW), PARTS_GUTTER, w);
            if (gr.visible) {
                const top = y0 + 1.5;
                const boxH = Math.max(2, laneH - 3);
                ctx.fillStyle = 'rgba(120,180,255,.16)';
                ctx.fillRect(gr.x, top, gr.w, boxH);
                ctx.strokeStyle = 'rgba(120,180,255,.85)';
                ctx.lineWidth = 1;
                ctx.setLineDash([4, 3]);
                ctx.strokeRect(gr.x + 0.5, top + 0.5, Math.max(1, gr.w - 1), boxH - 1);
                ctx.setLineDash([]);
            }
        }
    }
    // One playhead spans the same unified track rows as the header list.
    const cx = timeToX(S.cursorTime || 0);
    if (cx >= PARTS_GUTTER && cx <= w) {
        ctx.strokeStyle = '#f43f5e';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(cx, 0);
        ctx.lineTo(cx, h);
        ctx.stroke();
    }
}

function _laneLayoutLive() {
    const rows = _unifiedRows();
    const fitted = _trackSessionFittedHeightsPure(rows, S.trackHeights, S.trackViewportHeight);
    return _trackSessionLaneLayoutPure(rows, fitted, S.trackScrollY, TIMELINE_TOP).lanes;
}

export function _partsViewOnMouseDown(e, x, y) {
    if (y < TIMELINE_TOP) {
        // Timeline-area click seeks, mirroring the other modes (and the
        // same mid-recording guard).
        if (_recState === 'recording') return;
        S.cursorTime = Math.max(0, xToTime(x));
        if (S.playing) { stopPlayback(); startPlayback(); }
        host.draw();
        return;
    }
    const row = _partsTrackRowAtYPure(_laneLayoutLive(), y);
    if (!row || row.type === 'folder') return;
    S.selectedTrackId = row.id;
    // Select the region block under the click (one region per track today; the
    // hit rect is unclamped on the right — Infinity width — so a click past the
    // visible fold still lands on its region).
    const rArrIdx = row.type === 'transcription' ? _arrIndexForTarget(row.targetId) : -1;
    const rExtent = _laneContentTimeExtent(row, rArrIdx);
    let hitRegion = '';
    if (rExtent) {
        const beatToTime = (beat) => timeOf(S.beats, beat);
        for (const region of _trackRegionsResolvePure(row.regions)) {
            const span = _regionTimeSpanPure(region, rExtent[0], rExtent[1], beatToTime);
            const rect = _regionBlockRectPure(timeToX(span.t0), timeToX(span.t1), PARTS_GUTTER, Infinity);
            if (_regionHitPure(rect, x)) { hitRegion = region.id; break; }
        }
    }
    S.selectedRegionId = hitRegion;
    refreshTrackSessionSelection();
    if (row.type === 'audio') {
        S.focusedSourceId = row.sourceId;
        // Set the generic status BEFORE activation: activateTrackAudioSource
        // sets a specific error synchronously when the source is unavailable,
        // and that message must survive rather than be overwritten here.
        setStatus(`Audio track: ${row.name}`);
        // Match the header row: focus this source as the active reference so
        // the waveform + onset tools follow the clicked lane too.
        host.selectTrackSessionSource(row.sourceId);
    } else {
        const idx = _arrIndexForTarget(row.targetId);
        if ((idx >= 0 && isDrumArrangement(S.arrangements[idx])) || row.targetId === 'drums') {
            // A drum part (any of them) — arming is a no-op (currentArr never
            // moves onto a drums arrangement); double-click opens its grid.
            setStatus('Drum transcription selected — double-click to open the drum editor');
        } else {
            if (idx >= 0 && idx !== S.currentArr) window.editorSelectArrangement(idx);
            const sel = document.getElementById('editor-arrangement');
            if (sel && idx >= 0) sel.value = String(idx);
            setStatus(`Transcription track: ${row.name} — double-click to open it`);
        }
    }
    // Arm a region drag on a hit block — transcription rows only (a notation
    // arrangement or the drum tab). Audio regions carry a two-clock media
    // pointer and move with the audio-region PR; here they only select. The
    // move is committed on mouseUp once the pointer clears a click threshold, so
    // a plain click still just selects. (Selecting a transcription arrangement
    // above already armed it as S.currentArr, so the move targets the right part.)
    if (hitRegion && row.type === 'transcription' && rExtent) {
        const region = _trackRegionsResolvePure(row.regions).find(r => r.id === hitRegion);
        if (region) {
            const beatToTime = (beat) => timeOf(S.beats, beat);
            const span = _regionTimeSpanPure(region, rExtent[0], rExtent[1], beatToTime);
            S.drag = {
                type: 'region-move',
                trackId: row.id,
                regionId: hitRegion,
                region,
                // Any drum part's row (its own arrangement, or the legacy
                // unmaterialized 'drums' target) moves DRUM content — the
                // command resolves the part's own tab from arrIdx, so dragging
                // a non-active part never shifts the active grid's hits.
                kind: (rArrIdx >= 0 && isDrumArrangement(S.arrangements[rArrIdx])) || row.targetId === 'drums'
                    ? 'drums' : 'notation',
                arrIdx: rArrIdx,
                origStart: span.t0,
                spanW: Math.max(0, span.t1 - span.t0),
                startX: x,
                snappedStart: span.t0,
                moved: false,
            };
        }
    }
    host.draw();
}

// Region drag (Tracks area): track the pointer, snap the block's start to a bar
// line (Alt = free), and defer the actual move to the drop. A small click
// threshold keeps a plain click a selection, not a move.
export function _partsViewRegionDrag(x, free) {
    const d = S.drag;
    if (!d || d.type !== 'region-move') return;
    if (!d.moved && Math.abs(x - d.startX) <= 3) return;
    d.moved = true;
    const dtRaw = (x - d.startX) / S.zoom;
    d.snappedStart = _regionSnapStartPure(_downbeatTimes(), d.origStart + dtRaw, free);
    host.draw();
}

// Drop: commit the move as one undoable MoveRegionCmd (beat-preserving; see
// region-commands.js). A zero net move — click, or a drag snapped back to the
// same bar — commits nothing.
export function _partsViewRegionDrop() {
    const d = S.drag;
    S.drag = null;
    if (!d || d.type !== 'region-move' || !d.moved) { host.draw(); return; }
    const dBeat = beatOf(S.beats, d.snappedStart) - beatOf(S.beats, d.origStart);
    if (Math.abs(dBeat) < 1e-9) { host.draw(); return; }
    S.history.exec(new MoveRegionCmd({
        kind: d.kind, arrIdx: d.arrIdx, trackId: d.trackId, region: d.region, dBeat,
    }));
    host.draw();
    host.updateStatus();
    setStatus(`Moved “${d.region.name || d.region.id}” ${dBeat > 0 ? 'later' : 'earlier'}`);
}

export function _partsViewOnDblClick(e) {
    const { x, y } = getMousePos(e);
    _partsViewOnMouseDown(e, x, y);
    const row = _partsTrackRowAtYPure(_laneLayoutLive(), y);
    if (row && row.type === 'transcription') host.openTrackSessionTarget(row.targetId);
}

// One-way ENTER: the unified Tracks area is the workspace's landing surface
// (the DAW arrangement-view idiom) — leaving it happens by OPENING a
// transcription (host.openTrackSessionTarget), never by re-toggling.
export function _editorTogglePartsView() {
    const partCount = (S.arrangements ? S.arrangements.length : 0)
        + ((S.drumTab && Array.isArray(S.drumTab.hits) && S.drumTab.hits.length) ? 1 : 0);
    // Gate on the unified rows, not partCount: an audio-only session (audio
    // loaded before any arrangement/drum content) still has audio lanes to
    // show. partCount stays only for the status copy below.
    if (!_unifiedRows().length) { setStatus('Load a song first'); return true; }
    // Commit any in-flight drag before the mode switch (mirrors the drum
    // and tempo toggles).
    host.finalizeActiveDrag();
    S.partsViewMode = true;
    S.tempoMapMode = false;
    S.tempoSel = -1;
    S.drumEditMode = false;
    S.tabViewMode = false;
    S.drumSel = new Set();
    hideContextMenu();
    host.hideAddNote();
    S.sel.clear();
    _refreshPartsViewButton();
    _refreshDrumEditButton();
    _refreshTempoMapButton();
    host.draw();
    host.updateStatus();
    setStatus(`Tracks area — ${partCount} transcription track${partCount === 1 ? '' : 's'} plus audio sources. Double-click a track to open it.`);
    return true;
}

// The header column replaces the old toolbar toggle — remove a leftover
// button from a pre-tracks session so no dead chrome lingers.
function _ensurePartsViewButton() {
    const old = document.getElementById('editor-parts-view-btn');
    if (old) old.remove();
    return null;
}
export function _refreshPartsViewButton() {
    _ensurePartsViewButton();
}
