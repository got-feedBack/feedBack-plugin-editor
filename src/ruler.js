/* Slopsmith Arrangement Editor — the consolidated ruler + overview minimap
 * (workspace-shell B3, charrette §2.5 / D-C5).
 *
 * The three old time-surfaces — the HTML loop strip overlay, the waveform
 * band's seek role, and the bottom beat bar — consolidate into two canvas
 * bands across the top (the charrette's layout: transport+LCD → ruler →
 * waveform → lanes):
 *
 *   MINIMAP  [0, MINIMAP_H)             whole-song overview: sections, loop,
 *                                       viewport window, playhead. Click/drag
 *                                       pans the viewport. Its x-space is the
 *                                       WHOLE SONG, not the chart's zoom.
 *   RULER    [MINIMAP_H, TIMELINE_TOP)  the one authoritative strip owning
 *                                       bars + beats + sections + loop +
 *                                       playhead. Upper half: drag paints a
 *                                       loop (mode-aware — bar/grid/free per
 *                                       the loop snap pref, Shift = Free);
 *                                       loop edges drag to resize. Lower
 *                                       half: scrub (click/drag the playhead).
 *
 * Everything the ruler paints is a pure function of `S.beats` through
 * timeToX — the D-T1 invariant made chrome. Loop state stays `S.barSel`
 * (same object, same commands, same Loop-in-3D handoff); only the surface
 * moved. The minimap concept is adopted from Virtuoso's overview canvas
 * (with Christian's blessing); the implementation is the editor's own, on
 * the audio-anchored timeline.
 *
 * Interaction wiring: mouse.js routes any mousedown with y < TIMELINE_TOP
 * here and the drag continues through rulerOnMouseMove/Up via S.drag types
 * 'minimap' | 'scrub' | 'loopedge' (loop-create reuses the long-standing
 * 'barsel' drag). No DOM, no listeners of its own — nothing to tear down.
 */

import { _ensureOnsets, _ensureOnsetsShifted, startPlayback, stopPlayback } from './audio.js';
import { ctx } from './canvas.js';
import { _mapHealthProblemsPure, _mapHealthPure, _mapHealthStepProblemPure, MAP_HEALTH_COLORS } from './map-health.js';
import {
    LABEL_W, MINIMAP_H, RULER_H, TIMELINE_TOP, timeToX, xToTime,
} from './geometry.js';
import { host } from './host.js';
import {
    _downbeatTimes, _editorClampScrollX, _editorViewportDuration,
    _fmtLoopTime, _loopEdgeAdjustPure, _loopLiveMode, _loopRegionForDragPure,
    _regionMeasureLabel, _setBarSel, snapTime,
} from './loop.js';
import { S, editGen } from './state.js';
import { _editorCommandById, editorShortcutProfile } from './shortcuts.js';
import { _editorToggleTempoMapMode, _tempoMarkers } from './tempo.js';
import { _feelRangesLive, _groupingAccentsLive } from './tempo-marks.js';
import { setStatus } from './ui.js';

// ── Map Health lens (P2-4): per-bar grid-vs-onset drift, three-state ──────────
// Off by default; a view flag (no history). The metric is pure (src/map-health.js);
// this memoizes it on the edit generation + the onset-cache identity so the draw
// path never recomputes per frame, and paints a thin wash under the ruler ticks.
let _mapHealthOn = null;                 // cached toggle, null until first read
let _mhMemo = { gen: -1, onsetsRef: undefined, shift: NaN, beatsRef: undefined, result: null };

export function _mapHealthEnabled() {
    if (_mapHealthOn === null) {
        try { _mapHealthOn = localStorage.getItem('editorMapHealth') === '1'; }
        catch (_) { _mapHealthOn = false; }
    }
    return _mapHealthOn;
}

export function _mapHealthResults() {
    const beats = Array.isArray(S.beats) ? S.beats : null;
    // The metric compares onsets to BEAT TIMES, so it needs onsets in CHART time
    // (audio.js) — the raw cache is buffer-time and reads as whole-map drift the
    // moment the recording is slid. Memo on the RAW cache identity + the live
    // shift, though: _ensureOnsetsShifted() reallocates on every call when the
    // shift is non-zero, so keying on IT would miss every frame and put the
    // O(bars × beats) scan straight back on the draw path.
    const raw = (typeof _ensureOnsets === 'function') ? _ensureOnsets() : null;
    const shift = Number(S.audioShift) || 0;
    const gen = typeof editGen === 'number' ? editGen : 0;
    if (_mhMemo.gen === gen && _mhMemo.onsetsRef === raw && _mhMemo.shift === shift
            && _mhMemo.beatsRef === beats && _mhMemo.result) {
        return _mhMemo.result;
    }
    const onsets = (typeof _ensureOnsetsShifted === 'function') ? _ensureOnsetsShifted() : null;
    const result = _mapHealthPure(beats, onsets, { feelRanges: _feelRangesLive() });
    _mhMemo = { gen, onsetsRef: raw, shift, beatsRef: beats, result };
    return result;
}

export function editorToggleMapHealth(force) {
    const next = typeof force === 'boolean' ? force : !_mapHealthEnabled();
    _mapHealthOn = next;
    try { localStorage.setItem('editorMapHealth', next ? '1' : '0'); } catch (_) { /* private mode */ }
    if (host && typeof host.draw === 'function') host.draw();
    if (host && typeof host.updateStatus === 'function') host.updateStatus();
    // An all-grey strip is the honest render of "no transients to judge against",
    // but silently. Say so — otherwise the lens looks broken rather than blank.
    if (next) {
        const cov = _mapHealthResults().overall.coverage;
        setStatus(cov > 0
            ? 'Map Health on — per-bar grid-vs-recording drift under the ruler (green agrees, red disagrees, grey = nothing to judge; review only)'
            : 'Map Health on — no transients detected in the recording yet, so every bar reads grey (nothing to judge)');
    } else {
        setStatus('Map Health off');
    }
    return next;
}

// Paint the three-state health wash: a ~5px strip along the bottom of the ruler,
// one span per measure. Grey/amber read soft; red is the only alarm. Sits below
// the beat ticks + playhead by drawing early in drawRuler.
// The wash strip's height. ONE constant: the paint and the click target are the
// same rectangle, or the click-through sends you to a bar you never pointed at.
const MAP_HEALTH_BAND_H = 5;

function _drawMapHealthBand(w, top) {
    // Same gate as the `audioOnly` menu row: the flag persists, so an audio-less
    // chart would otherwise inherit it and paint an all-grey strip nobody can
    // switch off (the menu item that toggles it is hidden without a recording).
    if (!_mapHealthEnabled() || !S.audioBuffer) return;
    const res = _mapHealthResults();
    if (!res || !res.measures.length) return;
    const y = top + RULER_H - MAP_HEALTH_BAND_H;
    for (const m of res.measures) {
        const x0 = Math.max(LABEL_W, timeToX(m.startTime));
        const x1 = Math.min(w, timeToX(m.endTime));
        if (x1 <= x0) continue;
        // Grey (no evidence) is barely-there so it never reads as an alarm; the
        // measured states carry more opacity, red the most.
        const alpha = m.band === 'red' ? 0.85 : m.band === 'amber' ? 0.6 : m.band === 'green' ? 0.45 : 0.22;
        ctx.fillStyle = MAP_HEALTH_COLORS[m.band] || MAP_HEALTH_COLORS.grey;
        ctx.globalAlpha = alpha;
        ctx.fillRect(x0, y, x1 - x0, MAP_HEALTH_BAND_H);
    }
    ctx.globalAlpha = 1;
}

/* @pure:ruler:start */
// Which interactive zone a canvas y lands in. The loop lane is the ruler's
// upper half (the Logic cycle-strip idiom); the lower half scrubs.
export function _rulerZonePure(y, minimapH, timelineTop) {
    if (!Number.isFinite(y) || y < 0) return null;
    if (y < minimapH) return 'minimap';
    if (y < timelineTop) {
        return y < minimapH + (timelineTop - minimapH) / 2 ? 'loop' : 'scrub';
    }
    return null;
}

// Whole-song ⇄ x for the minimap band (linear over [0, dur] in the strip
// right of the label gutter). Both ends clamp; a degenerate duration maps
// everything to the left edge / time 0.
export function _minimapXPure(t, dur, labelW, w) {
    const span = Math.max(1, w - labelW);
    if (!(dur > 0) || !Number.isFinite(t)) return labelW;
    return labelW + Math.max(0, Math.min(1, t / dur)) * span;
}
export function _minimapTimePure(x, dur, labelW, w) {
    const span = Math.max(1, w - labelW);
    if (!(dur > 0) || !Number.isFinite(x)) return 0;
    return Math.max(0, Math.min(1, (x - labelW) / span)) * dur;
}

// Label every Nth measure so numbers never collide: N=1 while a bar gets
// ≥ 34px, then the next power-of-two-ish step that clears the width.
// P2-6: at bar widths where per-beat ticks are dropped (pxPerBeat < 6) but
// the bar still has room (pxPerBar >= 28), SPEND the few sub-bar ticks on the
// authored grouping's accents — `2+2+3` shows its two interior resets instead
// of nothing. Position 0 is the barline itself (already drawn).
export function _rulerGroupTickPure(posInBar, accentMap, pxPerBeat, pxPerBar) {
    return !!(accentMap && posInBar > 0 && accentMap[posInBar] === 1
        && pxPerBeat < 6 && pxPerBar >= 28);
}

export function _rulerBarLabelSkipPure(pxPerBar) {
    if (!Number.isFinite(pxPerBar) || pxPerBar <= 0) return 8;
    if (pxPerBar >= 34) return 1;
    let skip = 2;
    while (skip * pxPerBar < 34 && skip < 64) skip *= 2;
    return skip;
}

// Loop-edge grab test in x (the whole ruler height grabs, so the grips are
// an easy target): 'start' | 'end' | null, nearest edge wins ties.
export function _rulerMappedEndPure(beats) {
    if (!Array.isArray(beats)) return null;
    for (let i = beats.length - 1; i >= 0; i--) {
        const b = beats[i];
        if (b && b.measure > 0 && Number.isFinite(b.time)) return b.time;
    }
    return null;
}

export function _rulerLoopEdgeHitPure(x, x0, x1, tol = 5) {
    if (!Number.isFinite(x) || !Number.isFinite(x0) || !Number.isFinite(x1)) return null;
    const dStart = Math.abs(x - x0), dEnd = Math.abs(x - x1);
    if (dStart > tol && dEnd > tol) return null;
    return dStart <= dEnd ? 'start' : 'end';
}
/* @pure:ruler:end */

// The whole-song extent the minimap maps over: the audio (or A3's
// compose-mode grid length), stretched to cover any charted tail.
function songDur() {
    let dur = S.duration > 0 ? S.duration : 0;
    const beats = S.beats;
    if (Array.isArray(beats) && beats.length) {
        const last = beats[beats.length - 1];
        if (last && Number.isFinite(last.time)) dur = Math.max(dur, last.time);
    }
    return dur;
}

// ── Painters ─────────────────────────────────────────────────────────

export function drawMinimap(w) {
    ctx.fillStyle = '#05050f';
    ctx.fillRect(0, 0, w, MINIMAP_H);
    const dur = songDur();
    if (dur <= 0) return;

    // Sections as alternating tint blocks (whole-song space).
    const secs = Array.isArray(S.sections) ? S.sections : [];
    for (let i = 0; i < secs.length; i++) {
        const s = secs[i];
        if (!s || !Number.isFinite(s.start_time)) continue;
        const x0 = _minimapXPure(s.start_time, dur, LABEL_W, w);
        const next = secs[i + 1];
        const x1 = _minimapXPure(next && Number.isFinite(next.start_time) ? next.start_time : dur, dur, LABEL_W, w);
        ctx.fillStyle = i % 2 ? 'rgba(232,192,64,0.10)' : 'rgba(232,192,64,0.18)';
        ctx.fillRect(x0, 2, Math.max(1, x1 - x0), MINIMAP_H - 4);
    }

    // Loop region.
    if (S.barSel) {
        const x0 = _minimapXPure(S.barSel.startTime, dur, LABEL_W, w);
        const x1 = _minimapXPure(S.barSel.endTime, dur, LABEL_W, w);
        ctx.fillStyle = S.loopEnabled ? 'rgba(80,160,255,0.55)' : 'rgba(80,160,255,0.30)';
        ctx.fillRect(x0, 1, Math.max(2, x1 - x0), MINIMAP_H - 2);
    }

    // Viewport window — the slice of song the chart currently shows.
    const viewDur = _editorViewportDuration();
    if (viewDur > 0) {
        const x0 = _minimapXPure(S.scrollX, dur, LABEL_W, w);
        const x1 = _minimapXPure(S.scrollX + viewDur, dur, LABEL_W, w);
        ctx.strokeStyle = 'rgba(220,230,255,0.75)';
        ctx.lineWidth = 1;
        ctx.strokeRect(x0 + 0.5, 0.5, Math.max(2, x1 - x0) - 1, MINIMAP_H - 1);
    }

    // Playhead tick.
    const px = _minimapXPure(S.cursorTime || 0, dur, LABEL_W, w);
    ctx.fillStyle = '#ff4444';
    ctx.fillRect(px - 0.5, 0, 1.5, MINIMAP_H);
}

export function drawRuler(w) {
    const top = MINIMAP_H;
    ctx.fillStyle = '#08081a';
    ctx.fillRect(0, top, w, RULER_H);
    // The loop/scrub halves get a faint split so the two targets read.
    ctx.fillStyle = 'rgba(255,255,255,0.03)';
    ctx.fillRect(LABEL_W, top, w - LABEL_W, RULER_H / 2);

    const st = S.scrollX - 1;
    const et = S.scrollX + (w - LABEL_W) / S.zoom + 1;

    // The final confirmed downbeat closes the mapped range. Audio after it is
    // still seekable source time, but it is not one giant final measure.
    const mappedEnd = _rulerMappedEndPure(S.beats);
    if (mappedEnd !== null && mappedEnd < et) {
        const x0 = Math.max(LABEL_W, timeToX(mappedEnd));
        if (x0 < w) {
            ctx.fillStyle = 'rgba(148,163,184,0.08)';
            ctx.fillRect(x0, top, w - x0, RULER_H);
            if (w - x0 >= 58) {
                ctx.fillStyle = '#64748b';
                ctx.font = '8px monospace';
                ctx.textAlign = 'left';
                ctx.textBaseline = 'top';
                ctx.fillText('Unmapped', x0 + 5, top + 2);
            }
        }
    }

    // Loop region band (the old HTML strip's painting, now on the ruler).
    if (S.barSel) {
        const x0 = Math.max(LABEL_W, timeToX(S.barSel.startTime));
        const x1 = Math.min(w, timeToX(S.barSel.endTime));
        if (x1 > x0) {
            ctx.fillStyle = S.loopEnabled ? 'rgba(80,160,255,0.35)' : 'rgba(80,160,255,0.20)';
            ctx.fillRect(x0, top, x1 - x0, RULER_H);
            // Edge grips.
            ctx.fillStyle = '#9cc4ff';
            ctx.fillRect(x0 - 1.5, top, 3, RULER_H);
            ctx.fillRect(x1 - 1.5, top, 3, RULER_H);
            // Label, clipped to the band.
            ctx.save();
            ctx.beginPath();
            ctx.rect(x0, top, x1 - x0, RULER_H);
            ctx.clip();
            ctx.fillStyle = '#dbeafe';
            ctx.font = '9px monospace';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            const barLabelOk = (S.barSel.mode === 'bar' || S.barSel.mode === undefined)
                && _downbeatTimes().length > 0;
            ctx.fillText(
                (barLabelOk ? _regionMeasureLabel(S.barSel) + '  ' : '')
                + _fmtLoopTime(S.barSel.startTime) + '–' + _fmtLoopTime(S.barSel.endTime),
                (x0 + x1) / 2, top + RULER_H / 4);
            ctx.restore();
        }
    }

    // Map Health wash (P2-4): under the ticks, above nothing — a thin per-bar
    // drift heat so grid-vs-recording disagreement is visible while charting.
    _drawMapHealthBand(w, top);

    // Beat ticks + measure numbers (the old beat bar, upgraded with
    // sub-beat ticks and collision-free labels).
    const downs = _downbeatTimes();
    let pxPerBar = Infinity;
    if (downs.length > 1) pxPerBar = ((downs[downs.length - 1] - downs[0]) / (downs.length - 1)) * S.zoom;
    const skip = _rulerBarLabelSkipPure(pxPerBar);
    const beats = Array.isArray(S.beats) ? S.beats : [];
    let pxPerBeat = Infinity;
    if (beats.length > 1) {
        const b0 = beats[0], bN = beats[beats.length - 1];
        pxPerBeat = ((bN.time - b0.time) / (beats.length - 1)) * S.zoom;
    }
    ctx.font = '9px monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    const groupAccents = _groupingAccentsLive();   // memoized — no per-frame build
    let barIdx = 0;
    let curMeasure = -1, posInBar = -1;
    for (const b of beats) {
        const down = b.measure > 0;
        if (down) { barIdx++; curMeasure = b.measure; posInBar = 0; } else posInBar++;
        if (b.time < st || b.time > et) continue;
        const x = timeToX(b.time);
        if (x < LABEL_W || x > w) continue;
        if (down) {
            ctx.strokeStyle = '#3a3a66';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(x + 0.5, top + RULER_H * 0.35);
            ctx.lineTo(x + 0.5, top + RULER_H);
            ctx.stroke();
            if ((barIdx - 1) % skip === 0) {
                ctx.fillStyle = '#8890b0';
                ctx.fillText(String(b.measure), x + 3, top + RULER_H * 0.42);
            }
        } else if (pxPerBeat >= 6) {
            // A grouping accent reads brighter even at full tick density —
            // the felt pulse stays visible among the even subdivisions.
            const acc = groupAccents.get(curMeasure);
            ctx.strokeStyle = (acc && acc[posInBar] === 1) ? '#3a3a66' : '#23233c';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(x + 0.5, top + RULER_H * 0.72);
            ctx.lineTo(x + 0.5, top + RULER_H);
            ctx.stroke();
        } else if (_rulerGroupTickPure(posInBar, groupAccents.get(curMeasure), pxPerBeat, pxPerBar)) {
            ctx.strokeStyle = '#3a3a66';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(x + 0.5, top + RULER_H * 0.72);
            ctx.lineTo(x + 0.5, top + RULER_H);
            ctx.stroke();
        }
    }

    // Section flags along the ruler's top edge (names moved here from the
    // lane area — the dashed boundary lines stay in the chart).
    ctx.font = 'bold 8px monospace';
    ctx.textBaseline = 'top';
    for (const s of (Array.isArray(S.sections) ? S.sections : [])) {
        if (!s || s.start_time < st || s.start_time > et) continue;
        const x = timeToX(s.start_time);
        if (x < LABEL_W || x > w) continue;
        ctx.fillStyle = '#e8c040';
        ctx.fillRect(x, top, 1.5, RULER_H * 0.5);
        ctx.fillText(s.name, x + 3, top + 1);
    }

    // Derived tempo/meter change markers (design slice 2a): sparse labeled chips.
    // ZERO storage — _tempoMarkers() is a pure function of S.beats, painted only
    // through timeToX (the D-T1 invariant). Chips at (near-)coincident downbeats
    // stack so a tempo + a meter change at the same barline both read.
    ctx.font = 'bold 8px monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    let mkLastX = -999, mkRow = 0;
    for (const mk of _tempoMarkers()) {
        if (mk.time < st || mk.time > et) continue;
        const x = timeToX(mk.time);
        if (x < LABEL_W || x > w) continue;
        const row = (Math.abs(x - mkLastX) < 44) ? Math.min(mkRow + 1, 2) : 0;
        mkLastX = x; mkRow = row;
        const isTempo = mk.kind === 'tempo' || mk.kind === 'ramp';
        const isHold = mk.kind === 'hold';
        const isFeel = mk.kind === 'feel';
        const cy = top + 1 + row * 8.5;
        const tw = ctx.measureText(mk.label).width;
        ctx.fillStyle = isHold ? 'rgba(245,158,11,0.20)'
            : isFeel ? 'rgba(52,211,153,0.18)'
            : isTempo ? 'rgba(56,189,248,0.16)' : 'rgba(167,139,250,0.16)';
        ctx.fillRect(x + 2, cy, tw + 5, 8);
        // AUTHORED chips (P2-5) read as deliberate: a solid outline derived
        // chips don't get. Confirmed provenance = solid; anything else dashed.
        if (mk.authored) {
            ctx.strokeStyle = isHold ? '#f59e0b' : isFeel ? '#34d399' : '#a78bfa';
            ctx.lineWidth = 0.75;
            if (mk.provenance && mk.provenance !== 'confirmed') ctx.setLineDash([2, 2]);
            ctx.strokeRect(x + 2, cy, tw + 5, 8);
            ctx.setLineDash([]);
        }
        ctx.fillStyle = isHold ? '#fbbf24' : isFeel ? '#6ee7b7' : isTempo ? '#7dd3fc' : '#c4b5fd';
        ctx.fillText(mk.label, x + 4, cy + 0.5);
    }

    // Baseline + playhead head (the triangle the scrub half drags).
    ctx.strokeStyle = '#1f2937';
    ctx.beginPath();
    ctx.moveTo(0, top + RULER_H - 0.5);
    ctx.lineTo(w, top + RULER_H - 0.5);
    ctx.stroke();
    const cx = timeToX(S.cursorTime || 0);
    if (cx >= LABEL_W && cx <= w) {
        ctx.fillStyle = '#ff4444';
        ctx.beginPath();
        ctx.moveTo(cx - 5, top + RULER_H - 8);
        ctx.lineTo(cx + 5, top + RULER_H - 8);
        ctx.lineTo(cx, top + RULER_H);
        ctx.closePath();
        ctx.fill();
    }
}

// ── Interaction (routed from mouse.js; drags ride S.drag) ───────────

function scrubTo(x) {
    // Logic-style: clicking the ruler snaps the playhead to the grid (beat /
    // subdivision) when snap is on, so the caret lands on a real note position.
    // Hold Alt (S.drag.bypassSnap) for a free, un-snapped scrub.
    const raw = Math.max(0, xToTime(x));
    S.cursorTime = (S.drag && S.drag.bypassSnap) ? raw : snapTime(raw);
    host.draw();
}

function minimapPan(x, w) {
    const dur = songDur();
    if (dur <= 0) return;
    const t = _minimapTimePure(x, dur, LABEL_W, w);
    const viewDur = _editorViewportDuration();
    S.scrollX = _editorClampScrollX(t - viewDur / 2);
    host.draw();
}

// Returns true when the event was consumed (every y < TIMELINE_TOP is —
// the header is chrome, never a note-surface fall-through).
// The Map Health measure under time `t`, or null. Pure lookup over the memoized
// results — used by both the click-through and any hover affordance.
export function _mapHealthBarAt(t) {
    if (!_mapHealthEnabled() || !Number.isFinite(t)) return null;
    const res = _mapHealthResults();
    if (!res || !res.measures) return null;
    return res.measures.find(m => t >= m.startTime - 1e-6 && t < m.endTime - 1e-6) || null;
}

// Click-through: clicking a DRIFTING bar (amber/red) in the wash is "take me to
// the fix" — enter Tempo Map, scroll the bar into view, anchor Suggest on its
// downbeat, and tell the user which key is waiting. Green/grey bars are not
// actionable, so they fall through to the normal scrub. True if it handled it.
export function _mapHealthClickThrough(t) {
    const m = _mapHealthBarAt(t);
    if (!m || (m.band !== 'red' && m.band !== 'amber')) return false;
    _mapHealthGotoMeasure(m);
    return true;
}

// The shared "take me to the fix" motion — used by the wash click-through
// above and the transport LCD grid pill (which works even with the wash off).
export function _mapHealthGotoMeasure(m) {
    // Enter Tempo Map FIRST (it clears the selection), THEN anchor Suggest on
    // this bar's downbeat so the fit marches from exactly the bar that's drifting.
    if (!S.tempoMapMode) _editorToggleTempoMapMode();
    if (Number.isInteger(m.beatIdx)) S.tempoSel = m.beatIdx;
    // A live multi-selection OUTRANKS tempoSel in _editorTempoSuggestFit (it
    // re-anchors on the range's first downbeat), so a click-through arriving
    // while ALREADY in Tempo Map must drop it — same as a plain pole click does.
    // Without this the status line promises a fit for a bar Suggest won't touch.
    if (S.tempoSelMulti) S.tempoSelMulti.clear();
    // Lead-in, bounded by the viewport: zoom caps at 2000 px/s, so a viewport can
    // be shorter than 0.5 s — a flat 0.5 s lead would scroll the very downbeat we
    // are pointing at off the RIGHT edge.
    S.scrollX = _editorClampScrollX(m.startTime - Math.min(0.5, _editorViewportDuration() / 4));
    if (host && typeof host.editorSeekToTime === 'function') host.editorSeekToTime(m.startTime);
    host.draw();
    if (host && typeof host.updateStatus === 'function') host.updateStatus();
    const pct = m.driftFrac !== null ? Math.round(m.driftFrac * 100) : '?';
    // Never hardcode a key in UI copy — two shortcut profiles exist and the
    // registry is the only thing that knows which one is live.
    const cmd = _editorCommandById('tempoSuggestFit');
    const key = ((cmd && cmd.keys && cmd.keys[editorShortcutProfile]) || 'G').split(' (')[0];
    setStatus(`Bar ${m.measure} drifts ${pct}% from the recording — Tempo Map opened; press ${key} to fit the barlines from here.`);
}

// The worklist walk (map-health triage loop): jump to the next/previous
// DRIFTING bar from the playhead, wrapping — the same take-me-to-the-fix
// motion as the LCD pill and the wash click-through, so each landing arrives
// with Tempo Map open and Suggest anchored. Fix a bar, press the key again,
// land on the next: refinement stops being a full-song scrub. Works with the
// wash toggled off, like the pill does.
export function _mapHealthStepProblem(dir) {
    if (!S.audioBuffer) {
        setStatus('Grid health needs a recording to judge against.');
        return true;
    }
    const problems = _mapHealthProblemsPure(_mapHealthResults());
    if (!problems.length) {
        setStatus('Grid health: no drifting bars — nothing to fix.');
        return true;
    }
    const m = _mapHealthStepProblemPure(problems, S.cursorTime, dir);
    if (m) _mapHealthGotoMeasure(m);
    return true;
}

export function rulerOnMouseDown(e, x, y, w) {
    const zone = _rulerZonePure(y, MINIMAP_H, TIMELINE_TOP);
    if (!zone) return false;
    if (e.button !== 0) return true;
    if (zone === 'minimap') {
        S.drag = { type: 'minimap' };
        minimapPan(x, w);
        return true;
    }
    // Loop-edge grips win over both halves — resizing is the more precise
    // intent when the pointer is on a grip.
    if (S.barSel) {
        const hit = _rulerLoopEdgeHitPure(x, timeToX(S.barSel.startTime), timeToX(S.barSel.endTime));
        if (hit) {
            S.drag = { type: 'loopedge', edge: hit, mode: _loopLiveMode(e.shiftKey) };
            return true;
        }
    }
    if (zone === 'loop') {
        const t = xToTime(x);
        const mode = _loopLiveMode(e.shiftKey);
        S.drag = { type: 'barsel', startTime: t, mode };
        _setBarSel(_loopRegionForDragPure(mode, t, t, _downbeatTimes(), S.duration || t, snapTime));
        host.draw();
        return true;
    }
    // Map Health click-through: a click ON the painted health wash — the bottom
    // MAP_HEALTH_BAND_H px of the ruler, right of the label gutter, which is
    // exactly the rect _drawMapHealthBand fills — over a drifting (amber/red) bar
    // jumps to its fix instead of scrubbing. The gutter (x < LABEL_W) shows no
    // wash, so a click there must never claim a bar. Green/grey bars, and the rest
    // of the scrub half, fall through to scrub.
    if (zone === 'scrub' && x >= LABEL_W && y >= TIMELINE_TOP - MAP_HEALTH_BAND_H && _mapHealthEnabled()) {
        if (_mapHealthClickThrough(xToTime(x))) return true;
    }
    // Scrub: seek immediately and keep tracking while the button is down.
    const resume = S.playing;
    if (resume) stopPlayback();
    S.drag = { type: 'scrub', resume, bypassSnap: e.altKey };
    scrubTo(x);
    return true;
}

export function rulerOnMouseMove(e, x, w) {
    if (!S.drag) return false;
    if (S.drag.type === 'minimap') { minimapPan(x, w); return true; }
    // Alt is live per move (like Shift on the loop drags): press/release it
    // mid-scrub and snapping follows, instead of freezing at the mouse-down state.
    if (S.drag.type === 'scrub') { S.drag.bypassSnap = e.altKey; scrubTo(x); return true; }
    if (S.drag.type === 'loopedge') {
        if (!S.barSel) return true;
        const mode = _loopLiveMode(e.shiftKey);
        _setBarSel(_loopEdgeAdjustPure(
            mode, S.barSel, S.drag.edge, xToTime(x),
            _downbeatTimes(), S.duration || S.barSel.endTime, snapTime));
        host.draw();
        return true;
    }
    return false;
}

export function rulerOnMouseUp() {
    if (!S.drag) return false;
    const type = S.drag.type;
    if (type !== 'minimap' && type !== 'scrub' && type !== 'loopedge') return false;
    const resume = type === 'scrub' && S.drag.resume;
    S.drag = null;
    if (type === 'loopedge') host.updateLoopIn3DBtn();
    if (resume) startPlayback();
    host.draw();
    return true;
}
