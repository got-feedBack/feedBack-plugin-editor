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

import { startPlayback, stopPlayback } from './audio.js';
import { ctx } from './canvas.js';
import {
    LABEL_W, MINIMAP_H, RULER_H, TIMELINE_TOP, timeToX, xToTime,
} from './geometry.js';
import { host } from './host.js';
import {
    _downbeatTimes, _editorClampScrollX, _editorViewportDuration,
    _fmtLoopTime, _loopEdgeAdjustPure, _loopLiveMode, _loopRegionForDragPure,
    _regionMeasureLabel, _setBarSel, snapTime,
} from './loop.js';
import { S } from './state.js';

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
export function _rulerBarLabelSkipPure(pxPerBar) {
    if (!Number.isFinite(pxPerBar) || pxPerBar <= 0) return 8;
    if (pxPerBar >= 34) return 1;
    let skip = 2;
    while (skip * pxPerBar < 34 && skip < 64) skip *= 2;
    return skip;
}

// Loop-edge grab test in x (the whole ruler height grabs, so the grips are
// an easy target): 'start' | 'end' | null, nearest edge wins ties.
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
    let barIdx = 0;
    for (const b of beats) {
        const down = b.measure > 0;
        if (down) barIdx++;
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
            ctx.strokeStyle = '#23233c';
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
    S.cursorTime = Math.max(0, xToTime(x));
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
    // Scrub: seek immediately and keep tracking while the button is down.
    const resume = S.playing;
    if (resume) stopPlayback();
    S.drag = { type: 'scrub', resume };
    scrubTo(x);
    return true;
}

export function rulerOnMouseMove(e, x, w) {
    if (!S.drag) return false;
    if (S.drag.type === 'minimap') { minimapPan(x, w); return true; }
    if (S.drag.type === 'scrub') { scrubTo(x); return true; }
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
