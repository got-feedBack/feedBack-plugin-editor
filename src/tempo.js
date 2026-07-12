// ════════════════════════════════════════════════════════════════════
// Tempo Map editor — EOF-style sync-point editing of the song-wide beat grid
// (S.beats). Tempo is implicit: BPM is derived from the spacing between measure
// downbeats, so there is no tempo field to edit — you move downbeats.
//
// Carries its own two undo commands (TempoGridCmd, TempoMapCmd), the measure
// model, the draw pass, the mouse handlers, the sync inspector, tap-tempo and
// the beat-lock respacing.
//
// main.js keeps `_finalizeActiveDrag`: it dispatches whatever canvas drag is in
// flight (tempo, drum, handshape, pan) before a mode switch, so it belongs to
// none of them; it reaches back here as host.finalizeActiveDrag().
//
// The transport, the A/B loop strip and the toolbar readouts stay in main.js and
// would close a cycle, so they arrive through the shared `host` object in
// src/host.js. `_recState` is a reassigned scalar rather than a function, so it
// cannot cross as a value at all — it crosses as the predicate
// `host.isRecording()`.
//
// Browser surface: `ctx` (the shared 2D context) plus the sync-inspector and
// time-signature controls it builds into the toolbar.
// ════════════════════════════════════════════════════════════════════
import { beatOf, timeOf } from './beats.js';
import { DPR, canvas, ctx } from './canvas.js';
import { _drumLaneIdxForPiece, _drumPieceCount } from './drum.js';
import { LABEL_W, TIMELINE_TOP, WAVEFORM_H, timeToX, xToTime } from './geometry.js';
import { host } from './host.js';
import { lanes } from './lanes.js';
import { S } from './state.js';
import {
    _suggestActive, _suggestApplyPure, _suggestAvgConf, _suggestDismiss,
    _suggestHitAt, _suggestHudTextPure, _suggestProposals, _suggestRegenerateFrom,
    _suggestStopReason,
} from './tempo-suggest.js';
import { _editorPromptText, setStatus } from './ui.js';

// ════════════════════════════════════════════════════════════════════
// Tempo Map editor — EOF-style sync-point editing of the song-wide
// beat grid (S.beats). Tempo is implicit: BPM is derived from the
// spacing between measure downbeats.
// ════════════════════════════════════════════════════════════════════

const TEMPO_HUD_H = 26;        // bottom strip height in tempo-map mode
const TEMPO_POLE_HALF = 6;     // sync-point pole grab half-width (px)
const SUGGEST_HANDLE_TOP = 16; // ghost handle band offset (below pole handles)
const SUGGEST_HANDLE_H = 11;   // ghost handle band height

// Dimmed, non-interactive reference layer for tempo-map mode: the
// current arrangement's notes (spread by string) and the drum_tab
// hits (spread by piece), plotted at their absolute times.
function _tempoDrawReferenceNotes(w, gridBottom, visStart, visEnd) {
    const bandTop = (TIMELINE_TOP + WAVEFORM_H) + 46;
    const bandBot = gridBottom - 8;
    if (bandBot <= bandTop) return;
    const bandMid = (bandTop + bandBot) / 2;
    const REF_R = 4;  // reference-dot radius

    const dot = (x, y) => {
        ctx.beginPath();
        ctx.arc(x, y, REF_R, 0, Math.PI * 2);
        ctx.fill();
    };

    const arr = S.arrangements[S.currentArr];
    if (arr) {
        const L = Math.max(1, lanes());
        ctx.fillStyle = 'rgba(130,170,255,0.55)';
        const plot = (t, str) => {
            if (typeof t !== 'number' || t < visStart || t > visEnd) return;
            const x = timeToX(t);
            if (x < LABEL_W || x > w) return;
            const frac = L > 1 ? ((str || 0) % L) / (L - 1) : 0.5;
            dot(x, bandTop + REF_R + frac * (bandMid - bandTop - 2 * REF_R - 4));
        };
        for (const n of (arr.notes || [])) plot(n.time, n.string);
        for (const ch of (arr.chords || [])) {
            for (const cn of (ch.notes || [])) plot(cn.time != null ? cn.time : ch.time, cn.string);
        }
    }

    if (S.drumTab && Array.isArray(S.drumTab.hits)) {
        const pc = Math.max(1, _drumPieceCount());
        ctx.fillStyle = 'rgba(251,191,36,0.60)';
        for (const hit of S.drumTab.hits) {
            if (typeof hit.t !== 'number' || hit.t < visStart || hit.t > visEnd) continue;
            const x = timeToX(hit.t);
            if (x < LABEL_W || x > w) continue;
            const pi = _drumLaneIdxForPiece(hit.p);
            const frac = (pi >= 0 && pc > 1) ? pi / (pc - 1) : 0.5;
            dot(x, bandMid + REF_R + 4 + frac * (bandBot - bandMid - 2 * REF_R - 4));
        }
    }
}

// Derive per-measure metrics from S.beats. A measure spans from one
// downbeat (`measure > 0`) to the next; the beats between them (the
// downbeat itself + its sub-beats) give the implicit time signature,
// and BPM = beats / measureDuration * 60.
// Returns [{k, i, time, measure, nextI, nextTime, beats, bpm, isLast}],
// where `i` is the S.beats index of the downbeat.
export function _tempoMeasures() {
    const beats = S.beats || [];
    const dbIdx = [];
    for (let i = 0; i < beats.length; i++) {
        if (beats[i].measure > 0) dbIdx.push(i);
    }
    const out = [];
    for (let k = 0; k < dbIdx.length; k++) {
        const i = dbIdx[k];
        const nextI = (k + 1 < dbIdx.length) ? dbIdx[k + 1] : null;
        const time = beats[i].time;
        let beatCount, bpm, nextTime;
        if (nextI !== null) {
            nextTime = beats[nextI].time;
            beatCount = nextI - i;
            const dur = nextTime - time;
            bpm = dur > 1e-6 ? (beatCount / dur) * 60 : 0;
        } else {
            // Last measure has no closing downbeat — reuse the previous
            // measure's metrics so the display value is stable.
            nextTime = null;
            const prev = out[out.length - 1];
            // No previous measure (single-downbeat grid): count the
            // downbeat plus its trailing sub-beats — beats.length - i,
            // matching _tempoMeasureBeatCount().
            beatCount = prev ? prev.beats : Math.max(1, beats.length - i);
            bpm = prev ? prev.bpm : 0;
        }
        out.push({
            k, i, time, measure: beats[i].measure,
            nextI, nextTime, beats: beatCount, denominator: _tempoMeasureDenominator(i), bpm, isLast: nextI === null,
        });
    }
    return out;
}

export function _tempoMapDraw(w, h) {
    const visibleStart = S.scrollX - 0.5;
    const visibleEnd = S.scrollX + (w - LABEL_W) / S.zoom + 0.5;
    const gridBottom = h - TEMPO_HUD_H;

    host.drawTimelineHeader(w);
    host.drawWaveform(w);

    // Grid region background.
    ctx.fillStyle = '#0c0c1c';
    ctx.fillRect(LABEL_W, (TIMELINE_TOP + WAVEFORM_H), w - LABEL_W, gridBottom - (TIMELINE_TOP + WAVEFORM_H));

    if (!S.beats || S.beats.length < 2) {
        ctx.fillStyle = '#64748b';
        ctx.font = '12px sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText('No beat grid on this song — nothing to tempo-map.',
            LABEL_W + 12, (TIMELINE_TOP + WAVEFORM_H) + 30);
        return;
    }

    // Beat grid lines (downbeats brighter than sub-beats).
    for (const b of S.beats) {
        if (b.time < visibleStart || b.time > visibleEnd) continue;
        const x = timeToX(b.time);
        if (x < LABEL_W || x > w) continue;
        const meas = b.measure > 0;
        ctx.strokeStyle = meas ? 'rgba(255,255,255,0.10)' : 'rgba(255,255,255,0.04)';
        ctx.lineWidth = meas ? 1 : 0.5;
        ctx.beginPath();
        ctx.moveTo(x, (TIMELINE_TOP + WAVEFORM_H));
        ctx.lineTo(x, gridBottom);
        ctx.stroke();
    }

    // Dimmed reference layer — the current arrangement's notes + drum
    // hits, fixed at their absolute times so the user can drag the grid
    // to line up with them (and the waveform).
    _tempoDrawReferenceNotes(w, gridBottom, visibleStart, visibleEnd);

    // Measures: per-measure labels + draggable sync-point poles.
    const measures = _tempoMeasures();
    // Pickup display shift (D3): with a partial first bar, the first FULL
    // bar reads as bar 1 and the pickup as bar 0. Hoisted out of the loop.
    const _pickupShift = _pickupBarShiftPure(S.beats);
    for (const m of measures) {
        const x = timeToX(m.time);

        // Per-measure label, centred in the span (only if wide enough).
        if (m.nextTime !== null) {
            const xa = timeToX(m.time), xb = timeToX(m.nextTime);
            const xMid = (xa + xb) / 2;
            if (xb - xa > 46 && xMid > LABEL_W && xMid < w) {
                ctx.textAlign = 'center';
                ctx.textBaseline = 'top';
                ctx.fillStyle = '#cbd5e1';
                ctx.font = 'bold 10px monospace';
                ctx.fillText(`M${m.measure - _pickupShift}`, xMid, (TIMELINE_TOP + WAVEFORM_H) + 4);
                ctx.fillStyle = m.isLast ? '#64748b' : '#fbbf24';
                ctx.font = '10px monospace';
                ctx.fillText(`${m.bpm.toFixed(2)} BPM`, xMid, (TIMELINE_TOP + WAVEFORM_H) + 17);
                ctx.fillStyle = '#64748b';
                ctx.font = '9px monospace';
                ctx.fillText(`${m.beats}/${_tempoMeasureDenominator(m.i)}`, xMid, (TIMELINE_TOP + WAVEFORM_H) + 30);
            }
        }

        // Sync-point pole + grab handle.
        if (x >= LABEL_W && x <= w) {
            const sel = (m.i === S.tempoSel);
            const hov = (m.i === S.tempoHover);
            // Beat-lock: a locked sync point renders EMERALD — its time is held
            // by global tempo re-fits (detect / modulate / re-space). The
            // selection halo still shows through, so lock ≠ selection.
            const locked = !!(S.beats[m.i] && S.beats[m.i].locked);
            if (sel) {
                ctx.strokeStyle = 'rgba(251,191,36,0.25)';
                ctx.lineWidth = 7;
                ctx.beginPath();
                ctx.moveTo(x, (TIMELINE_TOP + WAVEFORM_H));
                ctx.lineTo(x, gridBottom);
                ctx.stroke();
            }
            ctx.strokeStyle = locked ? '#34d399' : sel ? '#fbbf24' : hov ? '#93c5fd' : '#64748b';
            ctx.lineWidth = sel ? 3 : 2;
            ctx.beginPath();
            ctx.moveTo(x, (TIMELINE_TOP + WAVEFORM_H));
            ctx.lineTo(x, gridBottom);
            ctx.stroke();
            ctx.fillStyle = locked ? '#34d399' : sel ? '#fbbf24' : hov ? '#93c5fd' : '#94a3b8';
            ctx.fillRect(x - TEMPO_POLE_HALF, (TIMELINE_TOP + WAVEFORM_H), TEMPO_POLE_HALF * 2, 13);
            ctx.fillStyle = '#0c0c1c';
            ctx.font = 'bold 9px monospace';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'top';
            ctx.fillText('↔', x, (TIMELINE_TOP + WAVEFORM_H) + 2);
        }
    }

    // Suggested-fit ghosts (assisted mapping) — dashed amber, confidence in
    // the alpha, hollow handles OFFSET BELOW the real pole handles so the two
    // grab bands never overlap. Proposals whose ghost sits where the pole
    // already is (locked / already-right bars) draw handle-only, dimmed.
    if (_suggestActive()) {
        for (const p of _suggestProposals()) {
            const gx = timeToX(p.time);
            if (gx < LABEL_W || gx > w) continue;
            const a = 0.25 + 0.55 * Math.max(0, Math.min(1, p.conf));
            const moved = Math.abs(gx - timeToX(S.beats[p.i].time)) >= 1;
            if (moved) {
                ctx.setLineDash([4, 3]);
                ctx.strokeStyle = `rgba(251,191,36,${a.toFixed(3)})`;
                ctx.lineWidth = 1.5;
                ctx.beginPath();
                ctx.moveTo(gx, (TIMELINE_TOP + WAVEFORM_H) + SUGGEST_HANDLE_TOP);
                ctx.lineTo(gx, gridBottom);
                ctx.stroke();
                ctx.setLineDash([]);
            }
            ctx.strokeStyle = `rgba(251,191,36,${(moved ? a : a * 0.5).toFixed(3)})`;
            ctx.lineWidth = 1.5;
            ctx.strokeRect(gx - TEMPO_POLE_HALF + 1, (TIMELINE_TOP + WAVEFORM_H) + SUGGEST_HANDLE_TOP,
                TEMPO_POLE_HALF * 2 - 2, SUGGEST_HANDLE_H);
        }
    }

    // Playback cursor.
    if (S.cursorTime >= visibleStart && S.cursorTime <= visibleEnd) {
        const cx = timeToX(S.cursorTime);
        ctx.strokeStyle = 'rgba(255,255,255,0.5)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(cx, (TIMELINE_TOP + WAVEFORM_H));
        ctx.lineTo(cx, gridBottom);
        ctx.stroke();
    }

    // HUD strip.
    ctx.fillStyle = '#08081a';
    ctx.fillRect(0, gridBottom, w, TEMPO_HUD_H);
    const hudY = gridBottom + TEMPO_HUD_H / 2;
    ctx.fillStyle = '#94a3b8';
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(_suggestActive()
        ? _suggestHudTextPure(_suggestProposals().length, _suggestAvgConf(), _suggestStopReason())
        : _tempoMapHudTextPure(measures.length, w), LABEL_W + 6, hudY);
}

/* @pure:tempo-map-guidance:start */
export function _tempoMapHudTextPure(measureCount, width) {
    const n = Number.isFinite(Number(measureCount)) ? Number(measureCount) : 0;
    if (Number(width) < 760) {
        return `Tempo Map - ${n} measures - right-click barline: BPM / signature`;
    }
    return `Tempo Map - ${n} measures - drag poles to retime, beat ticks for rubato - right-click barline: BPM / signature/delete - right-click grid: mark barline`;
}
// Status shown right after an audio-synced GP import. Names the Tempo Map tool
// so a drifting chart has an obvious, discoverable fix — the #1 confusion in the
// field is not knowing the beatmap is editable at all (auto-sync can only
// approximate a human performance between sync points, so some drift is
// expected and is meant to be fine-tuned by hand).
export function _syncAppliedMessagePure(syncApplied, syncReason) {
    const tip = ' Drifting from the recording? Open 🎵 Tempo Map to drag the beat grid onto the audio.';
    if (syncApplied === 'warp') {
        return 'Imported with per-bar audio sync.' + tip;
    }
    if (syncApplied === 'offset') {
        const base = syncReason === 'repeats'
            ? 'This file uses repeats/jumps, which per-bar sync can’t map yet — applied start offset only.'
            : 'Per-bar sync could not be applied to this import — applied start offset only.';
        return base + tip;
    }
    return '';
}
/* @pure:tempo-map-guidance:end */

/* @pure:tempo-sync-inspector:start */
export function _tempoSyncInspectorStatePure(measures, selectedIndex) {
    const rows = Array.isArray(measures) ? measures : [];
    const selected = rows.find(m => m && m.i === selectedIndex) || null;
    if (!selected) {
        return {
            label: 'No barline selected',
            bpmValue: '',
            bpmDisabled: true,
            bpmTitle: 'Select a Tempo Map barline to edit its BPM',
            numeratorValue: '',
            denominatorValue: '4',
            signatureDisabled: true,
            canInsert: rows.length > 0,
            canDelete: false,
            deleteTitle: 'Select an interior sync point to delete it',
            hint: 'Select a sync point on the Tempo Map grid.',
        };
    }
    const numerator = Math.max(1, Math.min(16, Number(selected.beats) || 4));
    const denominator = [2, 4, 8, 16].includes(Number(selected.denominator))
        ? Number(selected.denominator)
        : 4;
    const hasBpm = !selected.isLast && Number(selected.bpm) > 0;
    const selectedOrdinal = rows.indexOf(selected);
    const canDelete = selectedOrdinal > 0 && selectedOrdinal < rows.length - 1;
    return {
        label: `Measure ${selected.measure}`,
        bpmValue: hasBpm ? Number(selected.bpm).toFixed(2) : '',
        bpmDisabled: !hasBpm,
        bpmTitle: hasBpm
            ? 'Edit selected barline BPM'
            : 'Final measure has no closing downbeat for a local BPM calculation',
        numeratorValue: String(numerator),
        denominatorValue: String(denominator),
        signatureDisabled: false,
        canInsert: true,
        canDelete,
        deleteTitle: canDelete
            ? 'Delete selected barline'
            : 'First and final sync points cannot be deleted',
        hint: hasBpm
            ? `${numerator}/${denominator}`
            : `${numerator}/${denominator} - final measure BPM needs a closing downbeat.`,
    };
}
/* @pure:tempo-sync-inspector:end */

function _ensureTempoSyncInspector() {
    let el = document.getElementById('editor-tempo-sync-inspector');
    if (el) return el;
    const bpm = document.getElementById('editor-bpm');
    if (!bpm || !bpm.parentNode) return null;
    el = document.createElement('span');
    el.id = 'editor-tempo-sync-inspector';
    el.className = 'hidden items-center gap-1.5 px-2 py-0.5 rounded border border-gray-700 bg-dark-700/60 text-xs';
    el.innerHTML = '<span class="text-gray-500">Barline:</span>'
        + '<span id="editor-tempo-sync-label" class="text-gray-200 font-medium min-w-[5.5rem]">No selection</span>'
        + '<span id="editor-tempo-sync-hint" class="text-gray-500"></span>'
        + '<button type="button" id="editor-tempo-sync-insert" class="px-2 py-0.5 rounded bg-dark-600 text-gray-300 hover:bg-dark-500 disabled:opacity-50 disabled:cursor-not-allowed" title="Mark a barline at the playhead">Mark</button>'
        + '<button type="button" id="editor-tempo-sync-delete" class="px-2 py-0.5 rounded bg-dark-600 text-gray-300 hover:bg-dark-500 disabled:opacity-50 disabled:cursor-not-allowed" title="Delete selected barline">Delete</button>'
        + '<button type="button" id="editor-tempo-sync-modulate" class="px-2 py-0.5 rounded bg-dark-600 text-gray-300 hover:bg-dark-500 disabled:opacity-50 disabled:cursor-not-allowed" title="Metric modulation: new tempo = current × ratio, from this measure to the next tempo change (M)">Modulate…</button>';
    const insertBtn = el.querySelector('#editor-tempo-sync-insert');
    const deleteBtn = el.querySelector('#editor-tempo-sync-delete');
    const modulateBtn = el.querySelector('#editor-tempo-sync-modulate');
    if (insertBtn) insertBtn.onclick = () => _tempoInsertSyncPoint(S.cursorTime);
    if (deleteBtn) deleteBtn.onclick = () => { if (S.tempoSel >= 0) _tempoDeleteSyncPoint(S.tempoSel); };
    if (modulateBtn) modulateBtn.onclick = () => _editorModulateTempoAtSelection();
    bpm.parentNode.insertBefore(el, bpm.previousElementSibling || bpm);
    return el;
}

// No memo signature here, deliberately. One used to be computed and stored and
// never compared — dead code, removed. Re-adding it is not the obvious win it
// looks like: the DOM this writes is NOT a pure function of the state below,
// because the BPM field is left alone while it has focus. Skipping the writes on
// an unchanged signature would strand whatever the user had typed and then
// abandoned, since nothing else restores it.
export function _refreshTempoSyncInspector() {
    const el = _ensureTempoSyncInspector();
    const bpmEl = document.getElementById('editor-bpm');
    const numEl = document.getElementById('editor-tempo-sig');
    const denEl = document.getElementById('editor-tempo-sig-den');
    const insertBtn = document.getElementById('editor-tempo-sync-insert');
    const deleteBtn = document.getElementById('editor-tempo-sync-delete');
    if (!el) return;
    const hasGrid = !!(S.beats && S.beats.length >= 2);
    const visible = !!S.tempoMapMode && hasGrid;
    const state = _tempoSyncInspectorStatePure(visible ? _tempoMeasures() : [], visible ? S.tempoSel : -1);
    el.classList.toggle('hidden', !visible);
    el.classList.toggle('inline-flex', visible);
    const label = document.getElementById('editor-tempo-sync-label');
    const hint = document.getElementById('editor-tempo-sync-hint');
    if (label) label.textContent = state.label;
    if (hint) hint.textContent = state.hint;
    // The BPM / signature inputs are SHARED with normal (non-tempo-map) editing.
    // In tempo-map mode we gate them on the current sync-point selection; when
    // NOT in tempo-map mode we must restore them to their normal editable state,
    // otherwise leaving tempo-map mode with no selection (or the final measure
    // selected) would strand them disabled.
    if (bpmEl) {
        if (visible) {
            if (document.activeElement !== bpmEl) bpmEl.value = state.bpmValue;
            bpmEl.disabled = state.bpmDisabled;
            bpmEl.style.opacity = state.bpmDisabled ? '0.55' : '';
            bpmEl.title = state.bpmTitle;
        } else {
            bpmEl.disabled = false;
            bpmEl.style.opacity = '';
            bpmEl.title = '';
        }
    }
    if (numEl) {
        if (visible) {
            if (document.activeElement !== numEl) numEl.value = state.numeratorValue;
            numEl.disabled = state.signatureDisabled;
            numEl.style.opacity = state.signatureDisabled ? '0.55' : '';
        } else {
            numEl.disabled = false;
            numEl.style.opacity = '';
        }
    }
    if (denEl) {
        if (visible) {
            if (document.activeElement !== denEl) denEl.value = state.denominatorValue;
            denEl.disabled = state.signatureDisabled;
            denEl.style.opacity = state.signatureDisabled ? '0.55' : '';
        } else {
            denEl.disabled = false;
            denEl.style.opacity = '';
        }
    }
    if (insertBtn && visible) {
        insertBtn.disabled = !state.canInsert;
        insertBtn.title = 'Mark a barline at the playhead';
    }
    // Modulate shares the BPM edit's enable condition: a selected,
    // non-final measure with a computable tempo.
    const modulateBtn = document.getElementById('editor-tempo-sync-modulate');
    if (modulateBtn && visible) {
        modulateBtn.disabled = state.bpmDisabled;
    }
    if (deleteBtn && visible) {
        deleteBtn.disabled = !state.canDelete;
        deleteBtn.title = state.deleteTitle;
    }
}
function _ensureTempoSignatureControl() {
    let wrap = document.getElementById('editor-tempo-sig-wrap');
    if (wrap) return wrap;
    const bpm = document.getElementById('editor-bpm');
    if (!bpm || !bpm.parentNode) return null;
    wrap = document.createElement('span');
    wrap.id = 'editor-tempo-sig-wrap';
    wrap.className = 'hidden items-center gap-1';
    wrap.innerHTML = '<span class="text-xs text-gray-500">Sig:</span>'
        + '<input type="number" id="editor-tempo-sig" min="1" max="16" step="1" '
        + 'class="w-11 bg-dark-700 border border-gray-700 rounded px-1.5 py-0.5 text-xs text-gray-300 outline-none text-center" '
        + 'title="Edit selected measure beats per bar" onchange="editorSetTempoSignature(this.value)">'
        + '<span class="text-xs text-gray-500">/</span>'
        + '<select id="editor-tempo-sig-den" '
        + 'class="w-12 bg-dark-700 border border-gray-700 rounded px-1 py-0.5 text-xs text-gray-300 outline-none" '
        + 'title="Edit selected measure beat unit" onchange="editorSetTempoSignatureDenominator(this.value)">'
        + '<option value="2">2</option><option value="4">4</option><option value="8">8</option><option value="16">16</option></select>';
    const bpmNext = bpm.nextSibling;
    bpm.parentNode.insertBefore(wrap, bpmNext);
    return wrap;
}
// ── Tempo Map toolbar toggle ────────────────────────────────────────

export function _editorToggleTempoMapMode() {
    const hasGrid = !!(S.beats && S.beats.length >= 2);
    if (!hasGrid) {
        setStatus('No beat grid on this song - nothing to tempo-map.');
        return true;
    }
    // Finalize any in-progress canvas drag before switching modes.
    host.finalizeActiveDrag();
    S.tempoMapMode = !S.tempoMapMode;
    S.tempoSel = -1;
    S.tempoHover = -1;
    _tapTempo = null;   // abandon any pending tap run on mode change
    _suggestDismiss();  // proposals are mode-scoped — never survive an exit
    if (S.tempoMapMode) {
        // Tempo, drum, and parts modes are mutually exclusive.
        S.drumEditMode = false;
        S.drumSel = new Set();
        S.partsViewMode = false;
        host.hideContextMenu();
        host.hideAddNote();
        S.sel.clear();
        // A tempo-mapping session is a coarse rewind unit: stamp a checkpoint so
        // Ctrl+Alt+Z can undo the whole session at once. Entering the mode is not
        // itself a history event, so the stamp lands on the last edit before it.
        if (S.history) S.history.checkpoint('Tempo Map session');
    }
    _refreshTempoMapButton();
    host.refreshDrumEditButton();
    host.draw();
    setStatus(S.tempoMapMode ? 'Tempo Map mode' : 'Note edit mode');
    return true;
}

function _ensureTempoMapButton() {
    let btn = document.getElementById('editor-tempo-map-btn');
    if (!btn) {
        const anchor = document.getElementById('editor-save-btn');
        if (!anchor) return null;
        btn = document.createElement('button');
        btn.id = 'editor-tempo-map-btn';
        btn.type = 'button';
        btn.textContent = '🎵 Tempo Map';
        btn.className = 'px-3 py-1 bg-dark-600 hover:bg-dark-500 rounded text-xs font-medium hidden';
        btn.title = 'Open Tempo Map to fix a chart drifting from the audio — drag the beat grid, edit BPM & time signatures';
        btn.onclick = () => _editorToggleTempoMapMode();
        anchor.parentNode.insertBefore(btn, anchor.nextSibling);
    }
    return btn;
}

let _tempoMapBtnState = '';  // memoized signature; updates only on change

export function _refreshTempoMapButton() {
    const btn = _ensureTempoMapButton();
    const sigWrap = _ensureTempoSignatureControl();
    if (!btn) return;
    // The grid is song-wide and round-trips through archive + sloppak, so
    // the button is NOT format-gated — only a beat grid is required.
    const hasGrid = !!(S.beats && S.beats.length >= 2);
    const hasMultipleBpms = hasGrid && _tempoHasMultipleMeasureBpmsPure(S.beats, 0.01);
    const sig = `${!!S.sessionId}|${hasGrid}|${!!S.tempoMapMode}|${hasMultipleBpms}`;
    if (sig === _tempoMapBtnState) return;
    _tempoMapBtnState = sig;
    btn.classList.toggle('hidden', !S.sessionId || !hasGrid);
    if (sigWrap) {
        sigWrap.classList.toggle('hidden', !S.tempoMapMode || !hasGrid);
        sigWrap.classList.toggle('inline-flex', !!S.tempoMapMode && hasGrid);
    }
    if (S.tempoMapMode) {
        btn.textContent = '🎸 Back to Notes';
        btn.classList.add('bg-amber-600', 'hover:bg-amber-500');
        btn.classList.remove('bg-dark-600', 'hover:bg-dark-500');
    } else {
        btn.textContent = '🎵 Tempo Map';
        btn.classList.remove('bg-amber-600', 'hover:bg-amber-500');
        btn.classList.add('bg-dark-600', 'hover:bg-dark-500');
    }
    // Sync works on the song-wide BPM only, so keep that disabled in
    // tempo-map mode. The BPM input itself stays active there and edits the
    // selected measure (or the one under the playhead if nothing is selected).
    const bpmEl = document.getElementById('editor-bpm');
    if (bpmEl) {
        const disableGlobalBpm = !S.tempoMapMode && hasMultipleBpms;
        bpmEl.disabled = disableGlobalBpm;
        bpmEl.style.opacity = disableGlobalBpm ? '0.55' : '';
        if (bpmEl.dataset.origTitle === undefined) bpmEl.dataset.origTitle = bpmEl.title || '';
        bpmEl.title = S.tempoMapMode
            ? 'Edit the selected measure BPM in Tempo Map mode'
            : disableGlobalBpm
                ? 'Open Tempo Map to edit a song with multiple tempo events'
                : bpmEl.dataset.origTitle;
    }
    const syncEl = document.getElementById('editor-sync-btn');
    if (syncEl) {
        syncEl.disabled = !!S.tempoMapMode;
        syncEl.style.opacity = S.tempoMapMode ? '0.4' : '';
        if (S.tempoMapMode) {
            if (syncEl.dataset.origTitle === undefined) {
                syncEl.dataset.origTitle = syncEl.title || '';
            }
            syncEl.title = 'Disabled in Tempo Map mode — edit per-measure tempo on the grid';
        } else if (syncEl.dataset.origTitle !== undefined) {
            syncEl.title = syncEl.dataset.origTitle;
            delete syncEl.dataset.origTitle;
        }
    }
}

// ── Tempo Map interaction ───────────────────────────────────────────

// Return the S.beats index of the sync-point pole (a downbeat) nearest
// to canvas x within the pole grab zone, or -1. y must be inside the
// grid region.
export function _tempoSyncAtX(x, y) {
    if (!canvas) return -1;
    const gridBottom = canvas.height / DPR - TEMPO_HUD_H;
    if (y < (TIMELINE_TOP + WAVEFORM_H) || y > gridBottom) return -1;
    let best = -1, bestDist = TEMPO_POLE_HALF + 2;
    const beats = S.beats || [];
    for (let i = 0; i < beats.length; i++) {
        if (beats[i].measure <= 0) continue;
        const d = Math.abs(timeToX(beats[i].time) - x);
        if (d < bestDist) { bestDist = d; best = i; }
    }
    return best;
}

// Sub-beat hit-test — the per-beat rubato drag's target. Same vertical
// band as the poles, tighter tolerance so a pole always wins when both
// are within reach.
function _tempoSubBeatAtX(x, y) {
    if (!canvas) return -1;
    const gridBottom = canvas.height / DPR - TEMPO_HUD_H;
    if (y < (TIMELINE_TOP + WAVEFORM_H) || y > gridBottom) return -1;
    let best = -1, bestDist = 5;
    const beats = S.beats || [];
    for (let i = 0; i < beats.length; i++) {
        if (beats[i].measure > 0) continue;
        const d = Math.abs(timeToX(beats[i].time) - x);
        if (d < bestDist) { bestDist = d; best = i; }
    }
    return best;
}

/* @pure:tempo-beat-drag:start */
// Drag bounds for an individual beat (usually a sub-beat) at index d:
// clamped inside its measure's downbeat span with a per-gap minimum, so
// the proportional re-space can squeeze but never collapse or reorder a
// gap. Ends without a bounding downbeat clamp against the immediate
// neighbor (a pickup / trailing sub-beat rigid-shifts its side instead).
export function _tempoBeatDragBoundsPure(beats, d, minGap, duration) {
    if (!Array.isArray(beats) || d < 0 || d >= beats.length) return null;
    const gap = Number.isFinite(minGap) && minGap > 0 ? minGap : 0.005;
    let pdb = -1, ndb = -1;
    for (let i = d - 1; i >= 0; i--) { if (beats[i].measure > 0) { pdb = i; break; } }
    for (let i = d + 1; i < beats.length; i++) { if (beats[i].measure > 0) { ndb = i; break; } }
    const lo = pdb >= 0
        ? beats[pdb].time + gap * (d - pdb)
        : (d > 0 ? beats[d - 1].time + gap : 0);
    const hi = ndb >= 0
        ? beats[ndb].time - gap * (ndb - d)
        : (d < beats.length - 1
            ? beats[d + 1].time - gap
            : Math.max(beats[d].time, duration || beats[d].time));
    return hi > lo ? { lo, hi } : null;
}
/* @pure:tempo-beat-drag:end */

// Per-beat rubato drag — the intra-bar counterpart of the pole drag.
// Rebuilds from the original grid each move (no compounding) and lets
// _tempoApplyDrag re-space the neighbours proportionally around the
// grabbed beat.
export function _tempoBeatOnDragMove(x) {
    const dg = S.drag;
    if (!dg || dg.type !== 'tempo-beat') return;
    if (!dg.moved && Math.abs(x - dg.startX) < 3) return;
    const d = dg.beatIdx;
    const orig = dg.origBeats;
    const bounds = _tempoBeatDragBoundsPure(orig, d, 0.005, S.duration);
    if (!bounds) return;
    dg.moved = true;
    const newT = Math.max(bounds.lo, Math.min(bounds.hi, xToTime(x)));
    S.beats = orig.map(b => ({ ...b }));
    _tempoApplyDrag(S.beats, d, newT);
    host.draw();
}

export function _tempoMapOnMouseDown(e, x, y) {
    if (!canvas) return;

    // Waveform-area click sets the playback cursor.
    if (y < (TIMELINE_TOP + WAVEFORM_H)) {
        // Block the seek while a MIDI take is recording — restarting the
        // source node would prematurely finalize the take (mirrors the
        // guard on the normal-mode waveform click).
        if (host.isRecording()) return;
        S.cursorTime = Math.max(0, xToTime(x));
        if (S.playing) { host.stopPlayback(); host.startPlayback(); }
        host.draw();
        return;
    }

    // Ghost-handle band first (suggested fit): while proposals are showing,
    // a click on a ghost handle accepts THROUGH that barline — one undoable
    // TempoMapCmd (equal beat count; notes ride its reproject), locks held by
    // the engine (a locked downbeat's proposal is pinned to its own time).
    // The band sits strictly below the real pole handles, so this never
    // shadows a pole grab; everything else about the click is unchanged.
    if (_suggestActive()
            && y >= (TIMELINE_TOP + WAVEFORM_H) + SUGGEST_HANDLE_TOP
            && y <= (TIMELINE_TOP + WAVEFORM_H) + SUGGEST_HANDLE_TOP + SUGGEST_HANDLE_H) {
        const gi = _suggestHitAt(x, TEMPO_POLE_HALF + 2);
        if (gi >= 0) {
            const applied = _suggestApplyPure(S.beats, _suggestProposals(), gi);
            if (applied) {
                // Accepting a fit is a coarse rewind unit: stamp the state just
                // BEFORE the accept (undoToCheckpoint lands ON the stamped
                // command, keeping it applied), so Ctrl+Alt+Z rewinds the accept
                // — and any edits after it — in one step. On an empty stack the
                // stamp no-ops; the single-undo fallback still covers the accept.
                S.history.checkpoint('Suggest fit');
                S.history.exec(new TempoMapCmd(S.beats.map(b => ({ ...b })), applied, 'suggest-accept'));
                S.tempoSel = gi;
                // Forward regeneration: the accepted barline is now the
                // authoritative anchor — recalculate only the unconfirmed
                // future (with the remembered onsets).
                const n = _suggestRegenerateFrom(gi);
                host.updateBPMDisplay();
                host.draw();
                setStatus(n
                    ? `Accepted through this barline — ${n} suggestion${n === 1 ? '' : 's'} regenerated ahead`
                    : 'Accepted through this barline — no confident suggestions ahead (add an anchor and press G)');
            }
            return;
        }
    }

    // Click a sync-point pole to select it and start a drag.
    const hit = _tempoSyncAtX(x, y);
    if (hit !== S.tempoSel) _tapTempo = null;   // selection moved — drop stale tap run
    S.tempoSel = hit;
    if (hit >= 0) {
        S.drag = {
            type: 'tempo-sync',
            beatIdx: hit,
            startX: x,
            origBeats: S.beats.map(b => ({ ...b })),
            moved: false,
        };
        host.draw();
        return;
    }
    // No pole under the cursor — try an individual (sub-)beat tick for a
    // rubato drag: re-time one beat inside its measure without touching
    // the downbeats. Essential for hand-syncing accel/rit within a bar.
    const beatHit = _tempoSubBeatAtX(x, y);
    if (beatHit >= 0) {
        S.drag = {
            type: 'tempo-beat',
            beatIdx: beatHit,
            startX: x,
            origBeats: S.beats.map(b => ({ ...b })),
            moved: false,
        };
    }
    host.draw();
}

// Right-click in tempo-map mode: insert on open grid, or edit/delete
// the sync point under the cursor.
export function _tempoMapOnContextMenu(e) {
    const { x, y } = host.getMousePos(e);
    const menu = document.getElementById('editor-context-menu');
    if (!menu) return;
    const onPole = _tempoSyncAtX(x, y);
    const mkBtn = (action, label, cls) =>
        `<button class="w-full text-left px-3 py-1 text-xs hover:bg-dark-500 ${cls || ''}" `
        + `data-action="${action}">${label}</button>`;
    let html = '';
    if (onPole >= 0) {
        const cur = _tempoMeasureBeatCount(onPole);
        html += `<div class="px-3 py-1 text-xs text-gray-500">Measure: ${cur} beats</div>`;
        const m = _tempoMeasures().find(mm => mm.i === onPole) || null;
        if (m && !m.isLast && m.bpm > 0) html += mkBtn('bpmedit', 'Set BPM…');
        html += mkBtn('tsedit', 'Set time signature…');
        if (cur < 16) html += mkBtn('tsplus', 'Add a beat (time signature +)');
        if (cur > 1) html += mkBtn('tsminus', 'Remove a beat (time signature −)');
        // Pickup lives on the FIRST measure only (D3): a partial first bar.
        const _firstPole = _tempoMeasures()[0];
        if (_firstPole && onPole === _firstPole.i && cur > 1) html += mkBtn('pickup', 'Set pickup (partial first bar)…');
        html += '<div class="border-t border-gray-700 my-1"></div>';
        html += mkBtn('togglelock',
            (S.beats[onPole] && S.beats[onPole].locked) ? 'Unlock sync point' : 'Lock sync point');
        html += mkBtn('delete', 'Delete barline', 'text-red-400');
    } else {
        html += mkBtn('insert', 'Mark barline here');
    }
    menu.innerHTML = html;
    menu.querySelectorAll('[data-action]').forEach(btn => {
        btn.onclick = () => {
            host.hideContextMenu();
            const a = btn.dataset.action;
            if (a === 'pickup') { _tempoPromptPickup(); return; }
            if (a === 'delete') _tempoDeleteSyncPoint(onPole);
            else if (a === 'togglelock') { S.tempoSel = onPole; _editorToggleSyncLock(); }
            else if (a === 'insert') _tempoInsertSyncPoint(xToTime(x));
            else if (a === 'bpmedit') _tempoPromptMeasureBpm(onPole);
            else if (a === 'tsedit') _tempoPromptTimeSignature(onPole);
            else if (a === 'tsplus') _tempoSetBeatsPerMeasure(onPole, _tempoMeasureBeatCount(onPole) + 1);
            else if (a === 'tsminus') _tempoSetBeatsPerMeasure(onPole, _tempoMeasureBeatCount(onPole) - 1);
        };
    });
    menu.style.left = e.clientX + 'px';
    menu.style.top = e.clientY + 'px';
    menu.classList.remove('hidden');
}

// ── Insert / delete sync points ─────────────────────────────────────
//
// Marking inside the mapped range promotes the nearest interior beat. Marking
// after the mapped range closes the open measure and appends its next downbeat.
// Delete demotes a downbeat back to a sub-beat. These are topology edits:
// observed seconds stay fixed and TempoGridCmd re-lifts musical coordinates.

// Renumber every downbeat sequentially, preserving the first one's number.
function _tempoRenumberMeasures(beats) {
    let m = null;
    for (const b of beats) {
        if (b.measure > 0) {
            m = (m === null) ? b.measure : m + 1;
            b.measure = m;
        }
    }
}

/* @pure:tempo-barline-append:start */
export function _tempoAppendBarlinePure(beats, time, minGap = 0.05) {
    if (!Array.isArray(beats) || beats.length < 1 || !Number.isFinite(time)) return null;
    const downbeats = [];
    for (let i = 0; i < beats.length; i++) {
        if (beats[i] && beats[i].measure > 0) downbeats.push(i);
    }
    if (!downbeats.length) return null;
    const finalBeat = beats[beats.length - 1];
    if (!finalBeat || !Number.isFinite(finalBeat.time) || time <= finalBeat.time + minGap) return null;

    const lastDownbeat = downbeats[downbeats.length - 1];
    const out = beats.map(b => ({ ...b }));
    let denominator = 4;
    for (let k = downbeats.length - 1; k >= 0; k--) {
        const den = Number(beats[downbeats[k]].den);
        if ([2, 4, 8, 16].includes(den)) { denominator = den; break; }
    }
    if (lastDownbeat === beats.length - 1) {
        const previous = downbeats.length > 1 ? downbeats[downbeats.length - 2] : -1;
        const beatCount = previous >= 0 ? lastDownbeat - previous : 4;
        const count = Math.max(1, Math.min(16, beatCount));
        const start = Number(beats[lastDownbeat].time);
        for (let k = 1; k < count; k++) {
            const t = start + (time - start) * k / count;
            out.push({ time: Math.round(t * 1000000) / 1000000, measure: -1 });
        }
    }
    const measure = Number(beats[lastDownbeat].measure) + 1;
    out.push({ time, measure, den: denominator });
    return { beats: out, index: out.length - 1, measure,
        beatCount: out.length - 1 - lastDownbeat, denominator };
}
/* @pure:tempo-barline-append:end */

export function _tempoInsertSyncPoint(time) {
    const beats = S.beats || [];
    if (beats.length < 2) return;
    const dbIdx = [];
    for (let i = 0; i < beats.length; i++) if (beats[i].measure > 0) dbIdx.push(i);
    if (!dbIdx.length) return;

    let nearestPole = -1, nearestPoleDist = Infinity;
    for (const i of dbIdx) {
        const dist = Math.abs(beats[i].time - time);
        if (dist < nearestPoleDist) { nearestPole = i; nearestPoleDist = dist; }
    }
    if (nearestPoleDist <= MIN_MEASURE) {
        S.tempoSel = nearestPole;
        setStatus(`Barline ${beats[nearestPole].measure} selected.`);
        host.draw();
        return;
    }
    const appended = _tempoAppendBarlinePure(beats, time, MIN_MEASURE);
    if (appended) {
        S.history.exec(new TempoGridCmd(
            beats, appended.beats, 'mark barline', S.tempoSel, appended.index));
        S.tempoSel = appended.index;
        const start = beats[dbIdx[dbIdx.length - 1]].time;
        const bpm = appended.beatCount * 60 / (time - start);
        setStatus(`Barline ${appended.measure} marked — ${appended.beatCount}/${appended.denominator}, ${bpm.toFixed(2)} BPM.`);
        host.draw();
        return;
    }

    // Locate the measure [d, ndb) containing `time`.
    let d = dbIdx[0], ndb = beats.length;
    for (let k = 0; k < dbIdx.length; k++) {
        const i = dbIdx[k];
        const nextI = (k + 1 < dbIdx.length) ? dbIdx[k + 1] : beats.length;
        const endT = (nextI < beats.length) ? beats[nextI].time : Infinity;
        if (time >= beats[i].time && time < endT) { d = i; ndb = nextI; break; }
    }
    // Promote the interior sub-beat nearest to `time`.
    let bestS = -1, bestDist = Infinity;
    for (let i = d + 1; i < ndb; i++) {
        if (beats[i].measure > 0) continue;
        const dist = Math.abs(beats[i].time - time);
        if (dist < bestDist) { bestDist = dist; bestS = i; }
    }
    if (bestS < 0) {
        setStatus('The tempo map ends here. Move the playhead later to mark the next barline.');
        return;
    }
    const oldBeats = beats.map(b => ({ ...b }));
    const newBeats = beats.map(b => ({ ...b }));
    newBeats[bestS].measure = 1;  // placeholder; renumbered next
    _tempoRenumberMeasures(newBeats);
    S.history.exec(new TempoGridCmd(oldBeats, newBeats, 'insert'));
    S.tempoSel = bestS;
    host.draw();
}

export function _tempoDeleteSyncPoint(beatIdx) {
    const beats = S.beats || [];
    if (beatIdx < 0 || beatIdx >= beats.length || beats[beatIdx].measure <= 0) return;
    const dbIdx = [];
    for (let i = 0; i < beats.length; i++) if (beats[i].measure > 0) dbIdx.push(i);
    if (dbIdx[0] === beatIdx || dbIdx[dbIdx.length - 1] === beatIdx) {
        setStatus("Can't delete the first or last sync point.");
        return;
    }
    const oldBeats = beats.map(b => ({ ...b }));
    const newBeats = beats.map(b => ({ ...b }));
    newBeats[beatIdx].measure = -1;  // demote to sub-beat
    _tempoRenumberMeasures(newBeats);
    S.history.exec(new TempoGridCmd(oldBeats, newBeats, 'delete'));
    S.tempoSel = -1;
    host.draw();
}

// ── Time signature ──────────────────────────────────────────────────
//
// Re-subdivide the measure starting at downbeat `d` to `newCount`
// beats. The measure's [downbeat, next-downbeat] time span is fixed,
// so only the interior grid lines move — note times are untouched.

/* @pure:tempo-map-timesig:start */
export const TEMPO_SIGNATURE_DENOMINATORS = Object.freeze([2, 4, 8, 16]);

export function _tempoNormalizeDenominatorPure(value) {
    const n = parseInt(value, 10);
    return TEMPO_SIGNATURE_DENOMINATORS.includes(n) ? n : 4;
}

export function _tempoParseSignatureInputPure(value) {
    const raw = String(value || '').trim();
    const m = raw.match(/^(\d{1,2})\s*\/\s*(\d{1,2})$/);
    if (!m) return null;
    const numerator = Math.max(1, Math.min(16, parseInt(m[1], 10)));
    const denominator = parseInt(m[2], 10);
    if (!TEMPO_SIGNATURE_DENOMINATORS.includes(denominator)) return null;
    return { numerator, denominator };
}

export function _tempoSetDenominatorOnBeatsPure(beats, d, denominator) {
    if (!Array.isArray(beats) || d < 0 || d >= beats.length || !beats[d] || beats[d].measure <= 0) return null;
    const den = _tempoNormalizeDenominatorPure(denominator);
    const out = beats.map(b => ({ ...b }));
    out[d].den = den;
    return out;
}

export function _tempoSetBeatsPerMeasurePure(beats, d, newCount, duration, round) {
    const count = Math.max(1, Math.min(16, Math.round(newCount)));
    if (!Array.isArray(beats) || d < 0 || d >= beats.length || !beats[d] || beats[d].measure <= 0) return null;
    let ndb = -1;
    for (let i = d + 1; i < beats.length; i++) {
        if (beats[i].measure > 0) { ndb = i; break; }
    }
    const startT = beats[d].time;
    let endT, tailIdx;
    if (ndb >= 0) { endT = beats[ndb].time; tailIdx = ndb; }
    else { endT = duration || beats[beats.length - 1].time; tailIdx = beats.length; }
    if (endT <= startT) return null;
    const r = typeof round === 'function' ? round : (v => v);
    const head = beats.slice(0, d + 1).map(b => ({ ...b }));
    const tail = beats.slice(tailIdx).map(b => ({ ...b }));
    const interior = [];
    for (let k = 1; k < count; k++) {
        interior.push({ time: r(startT + (endT - startT) * k / count), measure: -1 });
    }
    return head.concat(interior, tail);
}
/* @pure:tempo-map-timesig:end */

/* @pure:tempo-pickup:start */
// Set a pickup (anacrusis, D3): PROMOTE the beat `pickupCount` steps after
// the first downbeat into a downbeat of its own. The first bar becomes a
// partial bar of `pickupCount` beats and the promoted beat starts the first
// full bar. Times NEVER move — this is a numbering-only grid change (the
// offset-vs-flex distinction stays clean by construction), so under
// beat-primary every note keeps its seconds and its groove.
export function _tempoSetPickupPure(beats, pickupCount) {
    if (!Array.isArray(beats) || beats.length < 2) return null;
    const n = Math.round(Number(pickupCount));
    if (!Number.isInteger(n) || n < 1) return null;
    const dbs = [];
    for (let i = 0; i < beats.length; i++) if (beats[i] && beats[i].measure > 0) dbs.push(i);
    if (!dbs.length) return null;
    const d0 = dbs[0];
    const barLen = (dbs.length > 1 ? dbs[1] : beats.length) - d0;
    if (n >= barLen) return null;                 // a pickup is strictly partial
    // RE-BAR, don't split: the true downbeats sit `n` beats after the grid
    // start, so every bar boundary shifts EARLIER by (barLen − n) beats —
    // each bar keeps its own length (varying meters survive), the first bar
    // becomes the n-beat pickup, and the freed beats fall into the last bar.
    const shift = barLen - n;
    const out = beats.map(b => ({ ...b, measure: b && b.measure > 0 ? -1 : b.measure }));
    const mark = (idx, den) => {
        out[idx].measure = 1;                     // placeholder; renumber follows
        if (den !== undefined) out[idx].den = den;
    };
    mark(d0, beats[d0].den);                      // the pickup bar's downbeat
    for (const d of dbs) {
        const nd = d - shift;
        if (nd > d0 && nd < out.length) mark(nd, beats[d].den);
    }
    return out;
}

// Derived pickup display shift: when the FIRST measure is shorter than the
// second, it reads as a pickup bar and display numbering shifts down one so
// the first FULL bar is bar 1 and the pickup shows as bar 0 (the DAW
// convention). Derived from the grid — no stored flag, nothing on the wire.
// The measure readout in main.js inlines this same 5-line rule so it stays
// sliceable/dependency-free; keep the two in lockstep.
export function _pickupBarShiftPure(beats) {
    if (!Array.isArray(beats)) return 0;
    const dbs = [];
    for (let i = 0; i < beats.length && dbs.length < 3; i++) {
        if (beats[i] && beats[i].measure > 0) dbs.push(i);
    }
    if (dbs.length < 3) return 0;                 // need two complete bars to compare
    return (dbs[1] - dbs[0]) < (dbs[2] - dbs[1]) ? 1 : 0;
}
/* @pure:tempo-pickup:end */

// The verb: prompt for the pickup beat count and apply as one undoable
// grid command. Reachable from the Tempo Map context menu (first measure)
// and the command registry (the B4 menu lists it once both land).
export async function _tempoPromptPickup() {
    const beats = S.beats || [];
    let d0 = -1;
    for (let i = 0; i < beats.length; i++) if (beats[i] && beats[i].measure > 0) { d0 = i; break; }
    if (d0 < 0) { setStatus('No measure grid to set a pickup on.'); return true; }
    let ndb = beats.length;
    for (let i = d0 + 1; i < beats.length; i++) if (beats[i] && beats[i].measure > 0) { ndb = i; break; }
    const barLen = ndb - d0;
    if (barLen < 2) { setStatus('The first bar has a single beat — no room for a pickup.'); return true; }
    const raw = await _editorPromptText({
        title: 'Set pickup (anacrusis)',
        label: `Pickup length in beats (1–${barLen - 1}) — the first full bar starts after them`,
        value: '1',
    });
    if (raw === null) return true;
    const m = raw.trim().match(/^\d+$/);
    const count = m ? parseInt(m[0], 10) : NaN;
    const newBeats = _tempoSetPickupPure(beats, count);
    if (!newBeats) { setStatus(`Pickup must be 1–${barLen - 1} beats.`); return true; }
    _tempoRenumberMeasures(newBeats);
    S.history.exec(new TempoGridCmd(beats.map(b => ({ ...b })), newBeats, 'pickup'));
    host.updateTempoSigDisplay();
    host.draw();
    setStatus(`Pickup set: ${count} beat${count === 1 ? '' : 's'} — the partial bar displays as bar 0`);
    return true;
}

export function _tempoSetBeatsPerMeasure(d, newCount) {
    const beats = S.beats || [];
    const newBeats = _tempoSetBeatsPerMeasurePure(beats, d, newCount, S.duration, _r3);
    if (!newBeats) return;
    _tempoRenumberMeasures(newBeats);
    S.history.exec(new TempoGridCmd(beats.map(b => ({ ...b })), newBeats, 'timesig'));
    host.updateTempoSigDisplay();
    host.draw();
}

function _tempoSetTimeSignature(d, numerator, denominator) {
    const beats = S.beats || [];
    let newBeats = _tempoSetBeatsPerMeasurePure(beats, d, numerator, S.duration, _r3);
    if (!newBeats) return false;
    newBeats = _tempoSetDenominatorOnBeatsPure(newBeats, d, denominator);
    if (!newBeats) return false;
    _tempoRenumberMeasures(newBeats);
    S.history.exec(new TempoGridCmd(beats.map(b => ({ ...b })), newBeats, 'timesig'));
    host.updateTempoSigDisplay();
    host.draw();
    return true;
}

function _tempoPromptTimeSignature(d) {
    if (d < 0 || !S.beats[d] || S.beats[d].measure <= 0) return;
    const current = `${_tempoMeasureBeatCount(d)}/${_tempoMeasureDenominator(d)}`;
    const raw = window.prompt('Set time signature for selected measure', current);
    if (raw === null) return;
    const parsed = _tempoParseSignatureInputPure(raw);
    if (!parsed) {
        setStatus('Enter a time signature like 7/8, 4/4, or 5/16.');
        return;
    }
    if (_tempoSetTimeSignature(d, parsed.numerator, parsed.denominator)) {
        setStatus(`Measure ${S.beats[d].measure} time signature set to ${parsed.numerator}/${parsed.denominator}`);
    }
}

// Beats currently in the measure starting at downbeat index `d`.
export function _tempoMeasureBeatCount(d) {
    const beats = S.beats || [];
    for (let i = d + 1; i < beats.length; i++) {
        if (beats[i].measure > 0) return i - d;
    }
    return beats.length - d;  // last measure
}
export function _tempoMeasureDenominator(d) {
    const beats = S.beats || [];
    const b = beats[d] || null;
    return _tempoNormalizeDenominatorPure(b && b.den);
}
// Undo command for insert/delete/time-signature edits — these only
// change `measure` fields / sub-beat layout, never beat times, so no
// note re-timing is involved; it just swaps the beats array.
export class TempoGridCmd {
    constructor(oldBeats, newBeats, label, oldSelection = null, newSelection = null) {
        this.oldBeats = oldBeats.map(b => ({ ...b }));
        this.newBeats = newBeats.map(b => ({ ...b }));
        this.label = label || 'grid';
        this.oldSelection = oldSelection;
        this.newSelection = newSelection;
        // The beat grid is SONG-level state (like drum_tab), not per-
        // arrangement — so it opts out of the read-only-roll lock (a fretted
        // part shown in the piano roll must not freeze tempo editing) and undo
        // tags it -1 rather than to whatever arrangement happened to be active.
        // The EditHistory comment already lists "tempo grid" as song-scope;
        // this makes the class match that contract. Without it, applying an
        // imported MIDI's tempo map right after a drums import (active part
        // still fretted-in-roll) would be silently blocked.
        this.songScope = true;
    }
    exec() {
        S.beats = this.newBeats.map(b => ({ ...b }));
        if (Number.isInteger(this.newSelection)) S.tempoSel = this.newSelection;
        // Grid re-INDEXES (insert/delete sync-point, time-sig): note SECONDS
        // stay put, but a note's beat coordinate changed (a beat was added /
        // removed before it), so re-lift beats from the unchanged seconds
        // against the new grid. No reproject — seconds don't move here.
        _liftAllBeats(S.beats);
        // The loop rides the same rule: its seconds stay put, its β re-lifts
        // from the new indexing (a free loop carries no β). Seconds never move,
        // so exec/rollback round-trips with no barSel snapshot.
        host.loopReliftBeats(S.beats);
        host.renderLoopStrip();
        host.updateLoopIn3DBtn();
    }
    rollback() {
        S.beats = this.oldBeats.map(b => ({ ...b }));
        if (Number.isInteger(this.oldSelection)) S.tempoSel = this.oldSelection;
        // Seconds are unchanged; re-lift beats back onto the old indexing.
        _liftAllBeats(S.beats);
        host.loopReliftBeats(S.beats);
        host.renderLoopStrip();
        host.updateLoopIn3DBtn();
    }
}

// ── Drag: move a sync point, re-spacing the two adjacent measures ────

export const MIN_MEASURE = 0.05;  // s — minimum gap a dragged downbeat keeps

/* @pure:tempo-map-bpm:start */
export function _tempoMeasureBpmsPure(beats, round) {
    if (!Array.isArray(beats) || beats.length < 2) return [];
    const r = typeof round === 'function' ? round : (v => v);
    const bpms = [];
    for (let d = 0; d < beats.length; d++) {
        const b = beats[d];
        if (!b || b.measure <= 0) continue;
        let ndb = -1;
        for (let i = d + 1; i < beats.length; i++) {
            if (beats[i] && beats[i].measure > 0) { ndb = i; break; }
        }
        if (ndb < 0) continue;
        const beatCount = ndb - d;
        const span = Number(beats[ndb].time) - Number(b.time);
        if (beatCount <= 0 || !Number.isFinite(span) || span <= 0) continue;
        bpms.push(r((beatCount * 60) / span));
    }
    return bpms;
}

export function _tempoHasMultipleMeasureBpmsPure(beats, tolerance) {
    const tol = Number.isFinite(tolerance) && tolerance >= 0 ? tolerance : 0.01;
    const bpms = _tempoMeasureBpmsPure(beats, v => Math.round(v * 1000) / 1000);
    if (bpms.length < 2) return false;
    const first = bpms[0];
    return bpms.some(bpm => Math.abs(bpm - first) > tol);
}

export function _tempoParseBpmInputPure(value) {
    const bpm = parseFloat(String(value || '').trim());
    return Number.isFinite(bpm) && bpm > 0 ? bpm : null;
}

export function _tempoSetMeasureBpmPure(beats, d, newBpm, minMeasure, round) {
    if (!Array.isArray(beats) || beats.length < 2 || !Number.isFinite(newBpm) || newBpm <= 0) return null;
    if (d < 0 || d >= beats.length || !beats[d] || beats[d].measure <= 0) return null;
    let ndb = -1;
    for (let i = d + 1; i < beats.length; i++) {
        if (beats[i].measure > 0) { ndb = i; break; }
    }
    if (ndb < 0) return null;
    const beatCount = ndb - d;
    if (beatCount <= 0) return null;
    const r = typeof round === 'function' ? round : (v => v);
    const gapMin = Number.isFinite(minMeasure) && minMeasure > 0 ? minMeasure : 0.05;
    const startT = beats[d].time;
    const oldEnd = beats[ndb].time;
    const span = Math.max(gapMin, (beatCount * 60) / newBpm);
    const newEnd = r(startT + span);
    const dt = newEnd - oldEnd;
    const out = beats.map(b => ({ ...b }));
    for (let k = 1; k < beatCount; k++) {
        out[d + k].time = r(startT + (newEnd - startT) * k / beatCount);
    }
    out[ndb].time = newEnd;
    for (let i = ndb + 1; i < out.length; i++) {
        out[i].time = r(out[i].time + dt);
    }
    return out;
}

// Rebuild a beat grid as a UNIFORM constant-BPM grid: keep every beat's measure
// / time-signature metadata and the first beat's start time, and re-time each
// beat to t0 + i·(60/bpm). This is the "flatten the whole tempo map to one BPM"
// op — the escape hatch from a bad import's per-measure tempos, which the
// per-measure BPM editor can only fix one measure at a time (tester report).
// Spacing every beat by 60/bpm matches how this editor already defines a
// measure's BPM (beatCount·60/span; see _tempoMeasureBpmsPure). Notes are NOT
// touched here — the caller keeps note times so they stay aligned to the audio.
export function _tempoFlattenToBpmPure(beats, bpm, round) {
    if (!Array.isArray(beats) || beats.length < 2 || !Number.isFinite(bpm) || bpm <= 0) return null;
    const r = typeof round === 'function' ? round : (v => v);
    const span = 60 / bpm;
    const t0 = Number(beats[0] && beats[0].time) || 0;
    return beats.map((b, i) => ({ ...b, time: r(t0 + i * span) }));
}
/* @pure:tempo-map-bpm:end */

/* @pure:tempo-modulate:start */
// Parse a metric-modulation ratio: pivot presets 1-4, "3:2"/"3/2"
// fractions, or a plain decimal. Returns new/old tempo ratio or null.
export function _tempoModulationRatioPure(raw) {
    if (raw === null || raw === undefined) return null;
    const s = String(raw).trim();
    if (!s) return null;
    // Pivots: 1 quarter=dotted-quarter (×2/3) · 2 dotted-quarter=quarter
    // (×3/2) · 3 quarter=eighth (×1/2) · 4 eighth=quarter (×2).
    const preset = { '1': 2 / 3, '2': 3 / 2, '3': 0.5, '4': 2 }[s];
    if (preset) return preset;
    const frac = s.match(/^(\d+(?:\.\d+)?)\s*[:/]\s*(\d+(?:\.\d+)?)$/);
    if (frac) {
        const num = parseFloat(frac[1]);
        const den = parseFloat(frac[2]);
        return num > 0 && den > 0 ? num / den : null;
    }
    // Bare decimal only — reject leading-numeric garbage like "3abc"/"3:2:1"
    // that parseFloat would silently truncate to a plausible ratio.
    if (!/^\d*\.?\d+(?:e[+-]?\d+)?$/i.test(s)) return null;
    const v = parseFloat(s);
    return Number.isFinite(v) && v > 0 ? v : null;
}

// BPM of the measure whose downbeat is beats[d] (null when unbounded).
export function _tempoMeasureBpmAtPure(beats, d) {
    if (!Array.isArray(beats) || d < 0 || d >= beats.length) return null;
    if (!beats[d] || beats[d].measure <= 0) return null;
    let ndb = -1;
    for (let i = d + 1; i < beats.length; i++) {
        if (beats[i] && beats[i].measure > 0) { ndb = i; break; }
    }
    if (ndb < 0) return null;
    const span = Number(beats[ndb].time) - Number(beats[d].time);
    return span > 0 ? ((ndb - d) * 60) / span : null;
}

// Metric modulation: new tempo = old × ratio, applied from measure d
// THROUGH THE END OF ITS UNIFORM RUN — the run stops at the first measure
// whose BPM differs from measure d's by more than tolFrac, so a later
// hand-authored tempo change is a natural pole the re-space never crosses.
// Interior beats re-space PROPORTIONALLY (fractional positions preserved,
// so swung/uneven sub-beats keep their feel); everything after the run
// rigid-shifts by the accumulated delta. Beat count is unchanged, so the
// result rides TempoMapCmd (which also remaps note times per its scope).
// Returns { beats, count, newBpm } or null when invalid / too short.
export function _tempoModulateRunPure(beats, d, ratio, minMeasure, round, tolFrac) {
    if (!Array.isArray(beats) || beats.length < 2) return null;
    if (!Number.isFinite(ratio) || ratio <= 0 || ratio === 1) return null;
    const bpm0 = _tempoMeasureBpmAtPure(beats, d);
    if (bpm0 === null) return null;
    const r = typeof round === 'function' ? round : (v => v);
    const gapMin = Number.isFinite(minMeasure) && minMeasure > 0 ? minMeasure : 0.05;
    const tol = Number.isFinite(tolFrac) && tolFrac > 0 ? tolFrac : 0.005;
    // Collect the downbeat indices of the uniform run [d …).
    const runStarts = [];
    let i = d;
    while (i >= 0 && i < beats.length) {
        const bpm = _tempoMeasureBpmAtPure(beats, i);
        if (bpm === null) break;                       // final/unbounded measure
        if (Math.abs(bpm - bpm0) > bpm0 * tol) break;  // next tempo change: stop
        runStarts.push(i);
        let ndb = -1;
        for (let j = i + 1; j < beats.length; j++) {
            if (beats[j] && beats[j].measure > 0) { ndb = j; break; }
        }
        if (ndb < 0) break;
        i = ndb;
    }
    if (!runStarts.length) return null;
    const out = beats.map(b => ({ ...b }));
    let shift = 0;   // accumulated delta, applied progressively
    for (const s0 of runStarts) {
        let ndb = -1;
        for (let j = s0 + 1; j < beats.length; j++) {
            if (beats[j] && beats[j].measure > 0) { ndb = j; break; }
        }
        const oldStart = beats[s0].time;
        const oldSpan = beats[ndb].time - oldStart;
        const newSpan = oldSpan / ratio;
        if (newSpan < gapMin) return null;             // refuse absurd results
        const newStart = out[s0].time;                 // already shifted
        for (let k = s0 + 1; k < ndb; k++) {
            const frac = (beats[k].time - oldStart) / oldSpan;
            out[k].time = r(newStart + frac * newSpan);
        }
        out[ndb].time = r(newStart + newSpan);
        shift = out[ndb].time - beats[ndb].time;
    }
    // Rigid-shift everything after the run.
    const lastNdb = (() => {
        const s0 = runStarts[runStarts.length - 1];
        for (let j = s0 + 1; j < beats.length; j++) {
            if (beats[j] && beats[j].measure > 0) return j;
        }
        return beats.length - 1;
    })();
    for (let j = lastNdb + 1; j < out.length; j++) {
        out[j].time = r(beats[j].time + shift);
    }
    return { beats: out, count: runStarts.length, newBpm: bpm0 * ratio };
}
/* @pure:tempo-modulate:end */

// Move the downbeat at index `d` in `beats` to `newT`, re-spacing the
// interior sub-beats of the two adjacent measures. Downbeats other than
// `d` keep their exact time — edits stay local. Mutates `beats`.
export function _tempoApplyDrag(beats, d, newT) {
    let pdb = -1, ndb = -1;
    for (let i = d - 1; i >= 0; i--) { if (beats[i].measure > 0) { pdb = i; break; } }
    for (let i = d + 1; i < beats.length; i++) { if (beats[i].measure > 0) { ndb = i; break; } }
    const oldT = beats[d].time;
    beats[d].time = newT;
    // Previous measure — re-space its interior, or rigid-shift a pickup.
    if (pdb >= 0) {
        const span = d - pdb;
        for (let k = 1; k < span; k++) {
            beats[pdb + k].time = beats[pdb].time + (newT - beats[pdb].time) * k / span;
        }
    } else {
        const dt = newT - oldT;
        for (let i = 0; i < d; i++) beats[i].time += dt;
    }
    // Next measure — re-space its interior, or rigid-shift the tail.
    if (ndb >= 0) {
        const span = ndb - d;
        for (let k = 1; k < span; k++) {
            beats[d + k].time = newT + (beats[ndb].time - newT) * k / span;
        }
    } else {
        const dt = newT - oldT;
        for (let i = d + 1; i < beats.length; i++) beats[i].time += dt;
    }
}

// Metric modulation prompt + apply for the selected barline. New tempo
// = current × ratio, from the selected measure to the next tempo change
// (the uniform-run boundary — hand-authored downstream tempo is a natural
// pole the re-space never crosses). One undoable TempoMapCmd; notes ride
// per the current tempo-ride scope, exactly like a BPM edit.
/* @pure:beat-lock:start */
// Beat-lock (charrette §1.8/D-T5): a hand-verified sync point carries a
// `locked` flag, and its TIME is immune to later GLOBAL tempo re-fits (detect /
// metric-modulation / measure re-space) so a nailed-by-ear passage can't be
// walked off. Given the pre-edit grid `oldBeats` (the lock source of truth) and
// a candidate index-preserving re-fit `newBeats` of the SAME length, the FIXED
// points are the two array ends (which carry the re-fit, so a global tempo
// change still lengthens/shortens the song) PLUS every locked anchor (pinned to
// its OLD time). Every run between two consecutive fixed points is affine-
// remapped so it keeps the re-fit's internal proportions while landing exactly
// on both endpoints — locked anchors hold, the grid interpolates around them,
// and no beat is ever pushed before the song start. No locks ⇒ identity
// (returns newBeats untouched). A length change (a re-index) is a no-op guard —
// locks only constrain index-preserving re-fits.
export function _respaceWithLocksPure(oldBeats, newBeats) {
    const n = oldBeats.length;
    if (n < 2 || !Array.isArray(newBeats) || newBeats.length !== n) return newBeats;
    const isLocked = i => !!(oldBeats[i] && oldBeats[i].locked);
    let anyLock = false;
    for (let i = 0; i < n && !anyLock; i++) anyLock = isLocked(i);
    if (!anyLock) return newBeats;
    const out = newBeats.map(b => ({ ...b }));
    // The `locked` flag is a persistent editor-pref — it rides onto every locked
    // beat whether or not this particular re-fit can honour its held time.
    for (let i = 0; i < n; i++) if (isLocked(i)) out[i].locked = true;
    // Fixed points: the two song ends ALWAYS carry the re-fit's own time (a
    // global tempo change must be free to lengthen/shift the song — a locked end
    // can't pin the total span, or a re-fit that moves the far end past it would
    // write a backwards grid); a locked interior anchor holds its old time.
    // Nothing guarantees those held times stay INCREASING once a global re-fit
    // pushes an end (or a neighbour) past a lock — a naive mix writes a
    // non-monotonic grid that silently corrupts beatOf/timeOf's binary search. So
    // we DROP any interior lock whose held time no longer falls strictly between
    // the surrounding kept fixed points; a dropped lock stops being a fixed point
    // and simply rides the affine remap of its run (its flag stays). Lock held
    // times are increasing in index (the old grid is sorted), so a single greedy
    // pass keeps the maximal satisfiable set and the kept fixed times are strictly
    // increasing by construction — the affine runs below then stay monotonic.
    out[0].time = newBeats[0].time;
    out[n - 1].time = newBeats[n - 1].time;
    const endTime = out[n - 1].time;
    const fixed = [0];
    let lastTime = out[0].time;
    for (let i = 1; i < n - 1; i++) {
        if (!isLocked(i)) continue;
        const held = oldBeats[i].time;
        if (held > lastTime && held < endTime) {
            out[i].time = held;
            fixed.push(i);
            lastTime = held;
        }
    }
    fixed.push(n - 1);
    for (let k = 0; k + 1 < fixed.length; k++) {
        const a = fixed[k], b = fixed[k + 1];
        const na = newBeats[a].time, span = newBeats[b].time - na;
        const ta = out[a].time, tspan = out[b].time - ta;
        for (let i = a + 1; i < b; i++) {
            out[i].time = span > 1e-9
                ? ta + (newBeats[i].time - na) * tspan / span
                : ta + tspan * (i - a) / (b - a);
        }
    }
    return out;
}

// Beat-lock persistence is EDITOR-PREF, keyed by filename, NEVER in the pack
// (D15). We persist the SECONDS of every locked sync point (times survive
// save/reload — the pack rebuilds the grid to the same times); on load we
// re-attach `locked` to the beats whose time matches (±tol).
export function _beatLockStorageKeyPure(filename) {
    return 'editorBeatLocks:' + (filename || '');
}
export function _beatLockParsePure(raw) {
    let arr = null;
    try { arr = JSON.parse(raw); } catch (_) { return []; }
    if (!Array.isArray(arr)) return [];
    return arr.map(Number).filter(t => Number.isFinite(t) && t >= 0);
}
// Reset every beat's `locked` from a persisted time list, matching each locked
// time to its nearest beat within `tol` seconds. Mutates + returns `beats`.
export function _applyBeatLocksPure(beats, lockedTimes, tol) {
    for (const b of beats) if (b) b.locked = false;
    for (const lt of lockedTimes) {
        let best = -1, bestD = tol;
        for (let i = 0; i < beats.length; i++) {
            if (!beats[i]) continue;
            const d = Math.abs(beats[i].time - lt);
            if (d <= bestD) { bestD = d; best = i; }
        }
        if (best >= 0) beats[best].locked = true;
    }
    return beats;
}
/* @pure:beat-lock:end */

// Persist the current locked sync points for this song (editor-pref).
function _saveBeatLocks() {
    const times = S.beats.filter(b => b && b.locked).map(b => Math.round(b.time * 1000) / 1000);
    const key = _beatLockStorageKeyPure(S.filename);
    try {
        if (times.length) localStorage.setItem(key, JSON.stringify(times));
        else localStorage.removeItem(key);
    } catch (_) { /* localStorage unavailable */ }
}
// Re-attach persisted locks onto S.beats after a load (times match the pack).
export function _restoreBeatLocks() {
    const key = _beatLockStorageKeyPure(S.filename);
    let raw = null;
    try { raw = localStorage.getItem(key); } catch (_) {}
    _applyBeatLocksPure(S.beats, _beatLockParsePure(raw), 0.02);
}

// Toggle the lock on the selected barline: a locked anchor's time is held by
// later global tempo re-fits (see _respaceWithLocksPure). Editor-pref, persisted.
export function _editorToggleSyncLock() {
    if (!S.tempoMapMode || S.tempoSel < 0) {
        setStatus('Select a Tempo Map barline to lock.');
        return true;
    }
    const b = S.beats[S.tempoSel];
    if (!b) return true;
    b.locked = !b.locked;
    _saveBeatLocks();
    host.draw();
    // A lock toggle is not a history command, so record the moment as a
    // checkpoint on the current top-of-undo — Ctrl+Alt+Z can rewind to it.
    if (S.history) S.history.checkpoint(b.locked ? 'Lock barline' : 'Unlock barline');
    setStatus(b.locked
        ? 'Sync point locked — global tempo re-fits will hold this beat.'
        : 'Sync point unlocked.');
    return true;
}

export function _editorModulateTempoAtSelection() {
    if (!S.tempoMapMode || S.tempoSel < 0) {
        setStatus('Select a Tempo Map barline first.');
        return true;
    }
    const measures = _tempoMeasures();
    const m = measures.find(mm => mm.i === S.tempoSel) || null;
    if (!m || m.isLast || !(m.bpm > 0)) {
        setStatus('Select a non-final measure to modulate from.');
        return true;
    }
    const raw = window.prompt(
        `Metric modulation from ${m.bpm.toFixed(2)} BPM — enter a pivot or ratio:\n`
        + `  1   quarter = dotted quarter   (new = ×2/3)\n`
        + `  2   dotted quarter = quarter   (new = ×3/2)\n`
        + `  3   quarter = eighth           (new = ×1/2)\n`
        + `  4   eighth = quarter           (new = ×2)\n`
        + `  or a ratio like 3:2, 2/3, 0.75`,
        '1');
    if (raw === null) return true;
    const ratio = _tempoModulationRatioPure(raw);
    if (ratio === null || ratio < 0.2 || ratio > 5) {
        setStatus('Enter a pivot 1–4 or a ratio between 0.2 and 5.');
        return true;
    }
    if (ratio === 1) {
        setStatus('Ratio 1 is no change.');
        return true;
    }
    const res = _tempoModulateRunPure(S.beats, S.tempoSel, ratio, MIN_MEASURE, _r3, 0.005);
    if (!res) {
        setStatus('Could not modulate — the resulting measures would be too short.');
        return true;
    }
    S.history.exec(new TempoMapCmd(S.beats.map(b => ({ ...b })),
        _respaceWithLocksPure(S.beats, res.beats), 'modulate'));
    host.updateBPMDisplay();
    host.draw();
    setStatus(`Modulated ${m.bpm.toFixed(1)} → ${res.newBpm.toFixed(1)} BPM across `
        + `${res.count} measure${res.count === 1 ? '' : 's'} (up to the next tempo change)`);
    return true;
}

function _tempoSetMeasureBpm(d, newBPM) {
    const beats = S.beats || [];
    const measures = _tempoMeasures();
    const m = measures.find(mm => mm.i === d) || null;
    if (!m || m.isLast || !(m.bpm > 0)) return false;
    const newBeats = _tempoSetMeasureBpmPure(beats, d, newBPM, MIN_MEASURE, _r3);
    if (!newBeats) return false;
    S.history.exec(new TempoMapCmd(beats.map(b => ({ ...b })),
        _respaceWithLocksPure(beats, newBeats), 'bpm'));
    host.updateBPMDisplay();
    host.draw();
    return true;
}

export function _tempoPromptMeasureBpm(d) {
    const measures = _tempoMeasures();
    const m = measures.find(mm => mm.i === d) || null;
    if (!m || m.isLast || !(m.bpm > 0)) {
        setStatus('Select a non-final measure to edit its BPM.');
        return;
    }
    const raw = window.prompt('Set BPM for selected measure', m.bpm.toFixed(2));
    if (raw === null) return;
    const bpm = _tempoParseBpmInputPure(raw);
    if (bpm === null) {
        setStatus('Enter a positive BPM value.');
        return;
    }
    if (_tempoSetMeasureBpm(d, bpm)) {
        setStatus(`Measure ${m.measure} tempo changed: ${m.bpm.toFixed(2)} → ${bpm.toFixed(2)} BPM`);
    }
}

/* @pure:tap-tempo:start */
// Median inter-tap interval (ms) over the last 8 gaps, or null when there
// aren't two good taps or the clock ran backwards. Range-agnostic.
export function _tapTempoMedianGapPure(taps) {
    if (!Array.isArray(taps) || taps.length < 2) return null;
    const recent = taps.slice(-9);           // at most 8 intervals
    const gaps = [];
    for (let i = 1; i < recent.length; i++) {
        const g = Number(recent[i]) - Number(recent[i - 1]);
        if (!Number.isFinite(g) || g <= 0) return null;
        gaps.push(g);
    }
    const sorted = [...gaps].sort((a, b) => a - b);
    const mid = sorted.length >> 1;
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// BPM from a run of tap timestamps (ms, ascending). Uses the MEDIAN of the
// last 8 intervals so one flubbed tap doesn't skew the estimate, and rejects
// implausible results (outside 20–400 BPM) instead of offering them.
export function _tapTempoBpmPure(taps) {
    const median = _tapTempoMedianGapPure(taps);
    if (median === null) return null;
    const bpm = 60000 / median;
    return (bpm >= 20 && bpm <= 400) ? bpm : null;
}

// Why no estimate is shown: 'ok' (a valid BPM is available), 'insufficient'
// (not enough good taps yet), or 'out-of-range' (a plausible median exists
// but the implied BPM is outside 20–400). Lets the status say *why* it's
// still waiting instead of an always-"keep tapping" message.
export function _tapTempoStatusReasonPure(taps) {
    const median = _tapTempoMedianGapPure(taps);
    if (median === null) return 'insufficient';
    const bpm = 60000 / median;
    return (bpm >= 20 && bpm <= 400) ? 'ok' : 'out-of-range';
}
/* @pure:tap-tempo:end */

// ── Tap tempo (Shift+B in Tempo Map mode) ────────────────────────────
// Tap along to the recording; the median inter-tap interval becomes a
// pending BPM for the selected barline. Enter applies it as ONE
// undoable command (via _tempoSetMeasureBpm), Escape cancels. Pausing
// longer than the reset window starts a fresh run, so a flubbed take is
// recoverable by just waiting a beat and tapping again.
const TAP_TEMPO_RESET_MS = 2000;
const TAP_TEMPO_STALE_MS = 15000;
let _tapTempo = null;   // { d, measure, taps: [ms…], bpm: number|null }

export function _editorTapTempoAtSelection() {
    if (!S.tempoMapMode || S.tempoSel < 0) {
        setStatus('Select a Tempo Map barline first.');
        return true;
    }
    const measures = _tempoMeasures();
    const m = measures.find(mm => mm.i === S.tempoSel) || null;
    if (!m || m.isLast || !(m.bpm > 0)) {
        setStatus('Select a non-final measure to tap its BPM.');
        return true;
    }
    const now = performance.now();
    if (!_tapTempo || _tapTempo.d !== S.tempoSel
            || now - _tapTempo.taps[_tapTempo.taps.length - 1] > TAP_TEMPO_RESET_MS) {
        _tapTempo = { d: S.tempoSel, measure: m.measure, taps: [], bpm: null };
    }
    _tapTempo.taps.push(now);
    _tapTempo.bpm = _tapTempoBpmPure(_tapTempo.taps);
    if (_tapTempo.bpm !== null) {
        setStatus(`Tap tempo: ${_tapTempo.bpm.toFixed(1)} BPM over ${_tapTempo.taps.length} taps — Enter applies to measure ${_tapTempo.measure}, Esc cancels`);
    } else if (_tapTempoStatusReasonPure(_tapTempo.taps) === 'out-of-range') {
        setStatus(`Tap tempo: that pace is out of range (20–400 BPM) — keep tapping Shift+B… (${_tapTempo.taps.length})`);
    } else {
        setStatus(`Tap tempo: keep tapping Shift+B… (${_tapTempo.taps.length})`);
    }
    return true;
}

/* @pure:tap-tempo-apply:start */
// Decide what an Enter press should do with a pending tap run `t`, given the
// currently-selected barline `tempoSel` and the current clock `now` (ms).
// Refuses a run captured against a different sync point ('stale-selection' —
// the selection moved out from under the run) or one that has aged past
// `staleMs`. Returns 'apply' only when the run still targets `tempoSel`.
export function _tapTempoApplyDecisionPure(t, tempoSel, now, staleMs) {
    if (!t) return 'none';
    if (t.d !== tempoSel) return 'stale-selection';
    if (t.bpm === null) return 'too-few';
    if (Number(now) - Number(t.taps[t.taps.length - 1]) > staleMs) return 'expired';
    return 'apply';
}
/* @pure:tap-tempo-apply:end */

// Enter/Escape resolution for a live tap run. Called early in the keydown
// handler; consumes the key only while a run is pending in Tempo Map mode.
export function _tapTempoHandleKey(e) {
    if (!_tapTempo || !S.tempoMapMode) return false;
    if (e.target && e.target.matches && e.target.matches('input, select, textarea')) return false;
    if (e.key === 'Enter') {
        e.preventDefault();
        const t = _tapTempo;
        _tapTempo = null;
        const decision = _tapTempoApplyDecisionPure(t, S.tempoSel, performance.now(), TAP_TEMPO_STALE_MS);
        if (decision === 'stale-selection') {
            setStatus('Tap tempo cancelled — sync-point selection changed.');
        } else if (decision === 'too-few') {
            setStatus('Tap tempo cancelled — not enough taps.');
        } else if (decision === 'expired') {
            setStatus('Tap tempo expired — tap again.');
        } else if (_tempoSetMeasureBpm(t.d, t.bpm)) {
            setStatus(`Measure ${t.measure} tempo set to ${t.bpm.toFixed(1)} BPM (tapped)`);
        } else {
            setStatus('Tap tempo: could not apply BPM to that measure.');
        }
        return true;
    }
    if (e.key === 'Escape') {
        e.preventDefault();
        _tapTempo = null;
        setStatus('Tap tempo cancelled');
        return true;
    }
    return false;
}

export function _tempoMapOnDragMove(x) {
    const dg = S.drag;
    if (!dg || dg.type !== 'tempo-sync') return;
    if (!dg.moved && Math.abs(x - dg.startX) < 3) return;
    dg.moved = true;
    const d = dg.beatIdx;
    const orig = dg.origBeats;
    // Bounding downbeats from the ORIGINAL grid.
    let pdb = -1, ndb = -1;
    for (let i = d - 1; i >= 0; i--) { if (orig[i].measure > 0) { pdb = i; break; } }
    for (let i = d + 1; i < orig.length; i++) { if (orig[i].measure > 0) { ndb = i; break; } }
    const loBound = pdb >= 0 ? orig[pdb].time + MIN_MEASURE : 0;
    const hiBound = ndb >= 0
        ? orig[ndb].time - MIN_MEASURE
        : (S.duration || orig[orig.length - 1].time);
    const newT = Math.max(loBound, Math.min(hiBound, xToTime(x)));
    // Rebuild from the original grid each move so re-drags don't compound.
    S.beats = orig.map(b => ({ ...b }));
    _tempoApplyDrag(S.beats, d, newT);
    host.draw();
}

export function _tempoMapOnDragEnd() {
    const dg = S.drag;
    S.drag = null;
    // Finalizes both drag kinds — a moved pole ('tempo-sync') and a moved
    // individual beat ('tempo-beat') — identically: same revert-then-exec,
    // same equal-count invariant, one undoable TempoMapCmd.
    if (!dg || (dg.type !== 'tempo-sync' && dg.type !== 'tempo-beat')) return;
    if (!dg.moved) { host.draw(); return; }  // a click-select, not a drag
    const newBeats = S.beats.map(b => ({ ...b }));
    S.beats = dg.origBeats;  // revert — TempoMapCmd.exec re-applies it
    // A drag re-spaces beats in place; it never adds or removes one, so
    // the counts must match. Validate here, before the command reaches
    // history — bailing inside exec() would still leave an inert undo
    // entry on the stack. A mismatch means a real bug upstream.
    if (newBeats.length !== dg.origBeats.length) {
        console.error('[tempo] drag changed beat count — discarding edit '
            + '(this should be impossible).');
        host.draw();
        return;
    }
    S.history.exec(new TempoMapCmd(dg.origBeats, newBeats, 'drag'));
    host.draw();
}

// ── Notes ride the grid — piecewise-linear time remapper ────────────

// Build remap(t): maps an absolute time from the old beat grid to the new one.
// Interior times ride the grid through the shared converter — remap IS
// `t ↦ timeOf(newBeats, beatOf(oldBeats, t))` within the grid (charrette §1.1),
// so a segment whose endpoints didn't move maps identically and an edit to one
// measure leaves the rest of the song untouched. Outside the grid it keeps the
// legacy constant-shift-by-endpoint-move, so this extraction is behaviour-
// identical on the tails too (beat-primary reproject — A2 — revisits out-of-grid
// objects; this PR is a pure refactor).
export function _makeTimeRemap(oldBeats, newBeats) {
    const n = oldBeats.length;
    return function remap(t) {
        if (n === 0) return t;
        if (t <= oldBeats[0].time) return t + (newBeats[0].time - oldBeats[0].time);
        if (t >= oldBeats[n - 1].time) return t + (newBeats[n - 1].time - oldBeats[n - 1].time);
        return timeOf(newBeats, beatOf(oldBeats, t));
    };
}

export const _r3 = v => Math.round(v * 1000) / 1000;

// (The ride-scope resolver — _tempoRetimeArrangements / _tempoRideResolvePure /
// _rebaseTempoRideForRemoval / _tempoRideSet — is gone. Under beat-primary a
// grid flex reprojects EVERY part from its beat, so "which parts ride" is no
// longer a correctness choice and the per-part picker was removed.)

// ── Beat-primary note model (charrette §1.3) ────────────────────────
// note.beat (a float) is the truth; note.time (seconds) is a cache =
// timeOf(S.beats, beat). Walk EVERY timed object in the song exactly once, so
// lift / reproject / save-strip can never disagree about the set — drum hits,
// sections, and per arrangement: notes, chords + chord notes, anchors,
// anchors_user, handshapes (start+end), phrases. `visit(obj, tf, endKind)`:
//   tf      — the object's seconds field: 'time' | 'start_time' | 't'
//   endKind — 'none' (a point), 'sustain' (note: time+sustain → beatEnd),
//             or 'span' (handshape: end_time → beatEnd)
// The start-beat field is always `beat`; a duration's end-beat is `beatEnd`.
// Both are runtime-only caches — _buildSaveBody strips them off the wire.
export function _eachTimed(visit) {
    if (S.drumTab && Array.isArray(S.drumTab.hits)) {
        for (const h of S.drumTab.hits) visit(h, 't', 'none');
    }
    for (const s of (S.sections || [])) visit(s, 'start_time', 'none');
    for (const arr of (S.arrangements || [])) {
        if (!arr) continue;
        for (const n of (arr.notes || [])) visit(n, 'time', 'sustain');
        for (const ch of (arr.chords || [])) {
            visit(ch, 'time', 'none');
            for (const cn of (ch.notes || [])) visit(cn, 'time', 'sustain');
        }
        for (const a of (arr.anchors || [])) visit(a, 'time', 'none');
        for (const a of (arr.anchors_user || [])) visit(a, 'time', 'none');
        for (const hs of (arr.handshapes || [])) visit(hs, 'start_time', 'span');
        for (const ph of (arr.phrases || [])) visit(ph, 'time', 'none');
    }
}

// Lift beats from seconds against `fromBeats` (beat = beatOf(time)). Runs on
// load and at the start of every grid edit — capturing any note edits made
// since the previous one — so a stale beat can never survive into a reproject.
export function _liftAllBeats(fromBeats) {
    _eachTimed((o, tf, endKind) => {
        if (typeof o[tf] !== 'number') return;
        o.beat = beatOf(fromBeats, o[tf]);
        if (endKind === 'sustain') {
            if (typeof o.sustain === 'number' && o.sustain > 0) {
                o.beatEnd = beatOf(fromBeats, o[tf] + o.sustain);
            } else {
                delete o.beatEnd;
            }
        } else if (endKind === 'span') {
            if (typeof o.end_time === 'number') o.beatEnd = beatOf(fromBeats, o.end_time);
            else delete o.beatEnd;
        }
    });
}

// Reproject seconds from the stored beats against `toBeats` (time =
// timeOf(beat)). TOTAL by construction — every timed object, every part — which
// is what makes a grid flex structurally incapable of drifting a note off its
// beat (the old ride-scope corruption class is gone: reproject no longer
// chooses which parts move). Sustain/handshape spans reproject via beatEnd,
// reproducing the old remap's endpoint arithmetic to the millisecond. An object
// with no stored beat is skipped (defensive — lift always precedes reproject
// within a command). Marks the drum tab dirty when it re-times, as the old
// remap did.
export function _reprojectAll(toBeats) {
    let drumMoved = false;
    _eachTimed((o, tf, endKind) => {
        // ponytail: beat-less objects are skipped here — _reprojectAll MUST follow _liftAllBeats in the same command, or newly-created objects (chord/user-placed notes, mid-session imports) that carry time but no beat get stranded off-grid.
        if (typeof o.beat !== 'number') return;
        const start = timeOf(toBeats, o.beat);
        o[tf] = _r3(start);
        if (endKind === 'sustain') {
            if (typeof o.beatEnd === 'number') {
                o.sustain = Math.max(0, _r3(timeOf(toBeats, o.beatEnd) - start));
            }
        } else if (endKind === 'span') {
            if (typeof o.beatEnd === 'number') o.end_time = _r3(timeOf(toBeats, o.beatEnd));
        }
        if (tf === 't') drumMoved = true;
    });
    if (drumMoved) S.drumTabDirty = true;
}

// ── Save-strip: keep the beat cache OFF the wire ────────────────────
// beat / beatEnd are runtime-only (charrette §1.9: seconds stay the wire
// truth, beats are re-derived on load). _buildSaveBody ships live note/chord/
// section objects, so strip the cache into shallow clones just before the body
// goes out — the live objects keep their beats for continued editing.
export function _stripBeat(o) {
    if (!o || typeof o !== 'object') return o;
    const { beat, beatEnd, ...rest } = o;
    return rest;
}
export function _stripBeatsList(list) {
    return Array.isArray(list) ? list.map(_stripBeat) : list;
}
export function _stripChordBeats(ch) {
    const s = _stripBeat(ch);
    if (Array.isArray(s.notes)) s.notes = s.notes.map(_stripBeat);
    return s;
}
export function _stripArrangementBeats(a) {
    if (!a || typeof a !== 'object') return a;
    const out = { ...a };
    if (Array.isArray(out.notes)) out.notes = out.notes.map(_stripBeat);
    if (Array.isArray(out.chords)) out.chords = out.chords.map(_stripChordBeats);
    if (Array.isArray(out.anchors)) out.anchors = out.anchors.map(_stripBeat);
    if (Array.isArray(out.anchors_user)) out.anchors_user = out.anchors_user.map(_stripBeat);
    if (Array.isArray(out.handshapes)) out.handshapes = out.handshapes.map(_stripBeat);
    if (Array.isArray(out.phrases)) out.phrases = out.phrases.map(_stripBeat);
    return out;
}
export function _stripBeatsFromSaveBody(body) {
    if (Array.isArray(body.notes)) body.notes = _stripBeatsList(body.notes);
    if (Array.isArray(body.chords)) body.chords = body.chords.map(_stripChordBeats);
    if (Array.isArray(body.sections)) body.sections = _stripBeatsList(body.sections);
    if (Array.isArray(body.anchors_user)) body.anchors_user = _stripBeatsList(body.anchors_user);
    if (Array.isArray(body.handshapes)) body.handshapes = _stripBeatsList(body.handshapes);
    if (Array.isArray(body.arrangements)) body.arrangements = body.arrangements.map(_stripArrangementBeats);
    if (body.drum_tab && Array.isArray(body.drum_tab.hits)) {
        body.drum_tab = { ...body.drum_tab, hits: _stripBeatsList(body.drum_tab.hits) };
    }
    return body;
}

// (The hand-rolled _captureScopedTimes / _restoreScopedTimes RIDE-SCOPE snapshot
// machinery is gone — beat is invariant across a flex, so every part rides its
// beat and reproject is total. TempoMapCmd still keeps a small undo-exactness
// snapshot of the pre-edit seconds so rollback restores them without _r3 rounding.)

// Undo command for one tempo-map edit (times move, beat indexing fixed).
// Beat is invariant across the flex: exec lifts every object's beat from the
// OLD grid (capturing any note edits made since the last grid change), swaps
// the grid, then reprojects seconds from those beats. Reproject rounds via _r3,
// so rollback can't reproject to undo — it would quantize sub-ms note placement
// (a note imported at 1.23456 would come back 1.235, so edit→undo→save would not
// equal the original save). Instead exec snapshots the exact pre-edit seconds and
// rollback restores them verbatim — a true inverse. Reproject stays TOTAL: every
// part rides its beat, so no note is left behind on a stale second (the old
// ride-scope corruption class).
export class TempoMapCmd {
    constructor(oldBeats, newBeats, label) {
        this.oldBeats = oldBeats.map(b => ({ ...b }));
        this.newBeats = newBeats.map(b => ({ ...b }));
        this.label = label || 'tempo';
    }
    exec() {
        // Invariant: oldBeats / newBeats have equal length — TempoMapCmd only
        // carries time-shift (drag) edits. _tempoMapOnDragEnd validates this
        // before the command is created, so a length-changing edit can't reach
        // here (those use TempoGridCmd).
        _liftAllBeats(this.oldBeats);
        // Snapshot the EXACT pre-edit seconds — the fields _reprojectAll overwrites
        // (o[tf], plus sustain / end_time for a span) — so rollback restores them
        // verbatim instead of reprojecting (which _r3-rounds and drifts sub-ms
        // placement). Same _eachTimed walk as reproject, holding object refs so
        // restore is order-independent. Re-taken on every exec, so redo works too.
        this._preTimes = [];
        _eachTimed((o, tf, endKind) => {
            this._preTimes.push([o, tf, o[tf],
                endKind === 'sustain' ? o.sustain : endKind === 'span' ? o.end_time : undefined,
                endKind]);
        });
        S.beats = this.newBeats.map(b => ({ ...b }));
        _reprojectAll(S.beats);
        // A bar/grid loop keeps its beat coordinates and re-derives its seconds
        // on the new grid, so it stays on its bars; a free loop keeps its
        // seconds. β is unchanged ⇒ exact inverse, so no barSel snapshot is
        // needed — rollback just reprojects onto the old grid.
        host.loopReprojectFromBeats(S.beats);
        host.renderLoopStrip();
        host.updateLoopIn3DBtn();
    }
    rollback() {
        S.beats = this.oldBeats.map(b => ({ ...b }));
        // Restore the EXACT pre-edit seconds captured in exec rather than
        // reprojecting — reproject would _r3-round and quantize sub-ms placement.
        // Beat is left untouched: a flex preserves beat indexing, so beats are
        // already correct against oldBeats.
        for (const [o, tf, sec, endVal, endKind] of (this._preTimes || [])) {
            o[tf] = sec;
            if (endKind === 'sustain') { if (endVal !== undefined) o.sustain = endVal; }
            else if (endKind === 'span') { if (endVal !== undefined) o.end_time = endVal; }
        }
        // The loop rides its beat coordinates (Phase A4): a bar/grid loop
        // reprojects onto the restored old grid — an exact inverse, since loop
        // edges are grid-aligned (no _r3 sub-ms drift, unlike notes above) — and
        // a free loop keeps its absolute seconds. β is unchanged by a flex, so no
        // barSel snapshot is needed.
        host.loopReprojectFromBeats(S.beats);
        host.renderLoopStrip();
        host.updateLoopIn3DBtn();
    }
}

