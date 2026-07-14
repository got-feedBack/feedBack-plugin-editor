// Parts overview ("Parts view"): a stacked read-only silhouette of every part
// (arrangements + drum tab), armed by lane click / opened by double-click. The
// toggle + its per-part draw / hit handlers are called back from main.js
// (drawNow, the canvas hooks); everything they refresh routes through host.

import { startPlayback, stopPlayback } from './audio.js';
import { DPR, canvas, ctx } from './canvas.js';
import { hideContextMenu } from './context-menu.js';
import { DRUM_PIECE_META, _refreshDrumEditButton } from './drum.js';
import { TIMELINE_TOP, WAVEFORM_H, timeToX, xToTime } from './geometry.js';
import { KEYS_PATTERN } from './keys.js';
import { _stringCountFor } from './lanes.js';
import { _downbeatTimes } from './loop.js';
import { _recState } from './midi-record.js';
import { getMousePos } from './mouse.js';
import { S } from './state.js';
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

export function _partsViewDraw(w, h) {
    host.drawTimelineHeader(w);
    host.drawWaveform(w);
    const parts = _partsListPure(S.arrangements, S.drumTab);
    const { laneH } = _partsLaneLayoutPure(h - (TIMELINE_TOP + WAVEFORM_H), parts.length);
    if (!laneH) return;
    const downbeats = _downbeatTimes();
    for (let p = 0; p < parts.length; p++) {
        const part = parts[p];
        const y0 = (TIMELINE_TOP + WAVEFORM_H) + p * laneH;
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
        ctx.lineTo(cx, (TIMELINE_TOP + WAVEFORM_H) + parts.length * laneH);
        ctx.stroke();
    }
}

export function _partsViewOnMouseDown(e, x, y) {
    if (y < (TIMELINE_TOP + WAVEFORM_H)) {
        // Waveform-area click seeks, mirroring the other modes (and the
        // same mid-recording guard).
        if (_recState === 'recording') return;
        S.cursorTime = Math.max(0, xToTime(x));
        if (S.playing) { stopPlayback(); startPlayback(); }
        host.draw();
        return;
    }
    const parts = _partsListPure(S.arrangements, S.drumTab);
    const { laneH } = _partsLaneLayoutPure((canvas.height / DPR) - (TIMELINE_TOP + WAVEFORM_H), parts.length);
    const i = _partsLaneAtYPure(y, (TIMELINE_TOP + WAVEFORM_H), laneH, parts.length);
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
    host.draw();
}

export function _partsViewOnDblClick(e) {
    const { y } = getMousePos(e);
    const parts = _partsListPure(S.arrangements, S.drumTab);
    const { laneH } = _partsLaneLayoutPure((canvas.height / DPR) - (TIMELINE_TOP + WAVEFORM_H), parts.length);
    const i = _partsLaneAtYPure(y, (TIMELINE_TOP + WAVEFORM_H), laneH, parts.length);
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
        host.hideAddNote();
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
    host.draw();
    host.updateStatus();
}

export function _editorTogglePartsView() {
    const partCount = (S.arrangements ? S.arrangements.length : 0)
        + ((S.drumTab && Array.isArray(S.drumTab.hits) && S.drumTab.hits.length) ? 1 : 0);
    if (!partCount) { setStatus('Load a song first'); return true; }
    // Commit any in-flight drag before the mode switch (mirrors the drum
    // and tempo toggles).
    host.finalizeActiveDrag();
    S.partsViewMode = !S.partsViewMode;
    if (S.partsViewMode) {
        S.tempoMapMode = false;
        S.tempoSel = -1;
        S.drumEditMode = false;
        S.tabViewMode = false;
        S.drumSel = new Set();
        hideContextMenu();
        host.hideAddNote();
        S.sel.clear();
    }
    _refreshPartsViewButton();
    _refreshDrumEditButton();
    _refreshTempoMapButton();
    host.draw();
    host.updateStatus();
    setStatus(S.partsViewMode
        ? `Parts view — ${partCount} part${partCount === 1 ? '' : 's'}. Click a lane to arm it, double-click to open.`
        : 'Note edit mode');
    return true;
}

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
