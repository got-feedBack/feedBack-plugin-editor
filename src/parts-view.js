// Parts overview ("Parts view"): a stacked read-only silhouette of every part
// (arrangements + drum tab), armed by lane click / opened by double-click. The
// toggle + its per-part draw / hit handlers are called back from main.js
// (drawNow, the canvas hooks); everything they refresh routes through host.

import { startPlayback, stopPlayback } from './audio.js';
import { ctx } from './canvas.js';
import { hideContextMenu } from './context-menu.js';
import { DRUM_PIECE_META, _refreshDrumEditButton } from './drum.js';
import { LABEL_W, TIMELINE_TOP, timeToX, xToTime } from './geometry.js';
import { KEYS_PATTERN } from './keys.js';
import { _stringCountFor } from './lanes.js';
import { _downbeatTimes } from './loop.js';
import { _recState } from './midi-record.js';
import { getMousePos } from './mouse.js';
import { S } from './state.js';
import { _trackSessionFittedHeightsPure, _trackSessionLaneLayoutPure, _trackSessionRowsPure, refreshTrackSessionSelection } from './track-session.js';
import { _refreshTempoMapButton } from './tempo.js';
import { setStatus } from './ui.js';
import { host } from './host.js';

/* @pure:parts-view:start */
// One entry per part: every arrangement, plus the drum tab as its own lane
// (drums are a song-level sidecar, not an arrangement).
function _partsListPure(arrangements, drumTab) {
    const parts = [];
    (arrangements || []).forEach((arr, i) => {
        parts.push({
            kind: 'arr',
            idx: i,
            name: (arr && arr.name) || 'Track ' + (i + 1),
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
function _partsTrackRowAtYPure(layout, y) {
    const lane = (layout || []).find(item => y >= item.y && y < item.y + item.h);
    return lane ? lane.row : null;
}
/* @pure:parts-view:end */

export { _partsArrKindPure, _partsDrumBandPure, _partsLaneAtYPure, _partsLaneLayoutPure, _partsListPure, _partsTrackRowAtYPure };

// Track names and instrument identity live in the persistent header at left.
// Parts view keeps only the normal timeline gutter; duplicating a 140px label
// panel inside the canvas hid time and made the two track lists disagree.
const PARTS_GUTTER = LABEL_W;

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

function _arrIndexForTarget(targetId) {
    return (S.arrangements || []).findIndex((arr, i) => arr
        && ((arr.id && String(arr.id) === targetId) || (!arr.id && 'arr:' + i === targetId)));
}

function _drawTrackAudioWaveform(row, y0, laneH, w) {
    const data = host.trackWaveform(row.sourceId);
    if (!data || !data.peaks || !data.peaks.bins || !(data.duration > 0)) return;
    const pk = data.peaks;
    const source = (S.audioSources || []).find(item => item.id === row.sourceId) || {};
    const shift = (Number(S.audioShift) || 0) + (Number(source.offset) || 0);
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

function _unifiedRows() {
    return _trackSessionRowsPure(S.trackSession, S.audioSources, S.arrangements, S.drumTab).rows;
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
        ctx.fillStyle = selected ? '#12324a' : row.type === 'folder' ? '#172033' : armed ? '#141432' : (p % 2 === 0 ? '#0c0c1c' : '#0f0f24');
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
        if (row.type === 'audio') _drawTrackAudioWaveform(row, y0, laneH, w);
        else if (row.type === 'transcription' && row.targetId === 'drums') {
            _partsDrawSilhouette({ kind: 'drums', idx: -1 }, y0, laneH, w);
        } else if (row.type === 'transcription' && arrIdx >= 0) {
            _partsDrawSilhouette({ kind: 'arr', idx: arrIdx }, y0, laneH, w);
        } else if (row.type === 'folder') {
            ctx.fillStyle = 'rgba(251,191,36,.16)';
            ctx.fillRect(PARTS_GUTTER, y0 + laneH - 2, w - PARTS_GUTTER, 2);
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

export function _partsViewOnMouseDown(e, x, y) {
    if (y < TIMELINE_TOP) {
        if (_recState === 'recording') return;
        S.cursorTime = Math.max(0, xToTime(x));
        if (S.playing) { stopPlayback(); startPlayback(); }
        host.draw();
        return;
    }
    const rows = _unifiedRows();
    const fitted = _trackSessionFittedHeightsPure(rows, S.trackHeights, S.trackViewportHeight);
    const layout = _trackSessionLaneLayoutPure(rows, fitted, S.trackScrollY, TIMELINE_TOP).lanes;
    const row = _partsTrackRowAtYPure(layout, y);
    if (!row || row.type === 'folder') return;
    S.selectedTrackId = row.id;
    refreshTrackSessionSelection();
    if (row.type === 'audio') {
        S.focusedSourceId = row.sourceId;
        host.selectTrackSessionSource(row.sourceId);
        setStatus(`Audio track: ${row.name}`);
    } else if (row.targetId === 'drums') {
        setStatus('Drum transcription selected');
    } else {
        const idx = _arrIndexForTarget(row.targetId);
        if (idx >= 0 && idx !== S.currentArr) window.editorSelectArrangement(idx);
        const sel = document.getElementById('editor-arrangement');
        if (sel && idx >= 0) sel.value = String(idx);
        setStatus(`Transcription track: ${row.name}`);
    }
    host.draw();
}

export function _partsViewOnDblClick(e) {
    const { x, y } = getMousePos(e);
    _partsViewOnMouseDown(e, x, y);
    const rows = _unifiedRows();
    const fitted = _trackSessionFittedHeightsPure(rows, S.trackHeights, S.trackViewportHeight);
    const layout = _trackSessionLaneLayoutPure(rows, fitted, S.trackScrollY, TIMELINE_TOP).lanes;
    const row = _partsTrackRowAtYPure(layout, y);
    if (row && row.type === 'transcription') host.openTrackSessionTarget(row.targetId);
}

export function _editorTogglePartsView() {
    const partCount = (S.arrangements ? S.arrangements.length : 0)
        + ((S.drumTab && Array.isArray(S.drumTab.hits) && S.drumTab.hits.length) ? 1 : 0);
    if (!partCount) { setStatus('Load a song first'); return true; }
    // Commit any in-flight drag before the mode switch (mirrors the drum
    // and tempo toggles).
    host.finalizeActiveDrag();
    S.partsViewMode = true;
    S.tempoMapMode = false; S.tempoSel = -1; S.drumEditMode = false; S.drumSel = new Set();
    hideContextMenu(); host.hideAddNote(); S.sel.clear();
    _refreshPartsViewButton();
    _refreshDrumEditButton();
    _refreshTempoMapButton();
    host.draw();
    host.updateStatus();
    setStatus(`Unified Tracks area — ${partCount} transcription track${partCount === 1 ? '' : 's'} plus audio sources.`);
    return true;
}

let _partsViewBtnState = '';
function _ensurePartsViewButton() {
    const old = document.getElementById('editor-parts-view-btn');
    if (old) old.remove();
    return null;
}
export function _refreshPartsViewButton() {
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
