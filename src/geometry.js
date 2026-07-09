/* Slopsmith Arrangement Editor — canvas geometry.
 *
 * The time⇄x and string⇄y mappings every draw and hit-test path goes through,
 * the lane metrics they read, and the scroll-bound arithmetic. Reads `S` and
 * the lane model; no DOM.
 *
 * The lane metrics are `export let`, not consts: `resizeCanvas()` re-derives
 * them from the canvas height on every resize. ES import bindings are LIVE and
 * read-only, so every importer sees the current value and none of them can
 * write it — the writer is `setLaneMetrics()` here. That is why these three
 * need no container (unlike lanes.js's `LC`, whose writers must stay in
 * main.js inside draw() and onMouseMove()).
 */

import { S } from './state.js';
import { laneToStr, lanes, strToLane } from './lanes.js';

export const LABEL_W = 52;

// Note-body geometry, shared by the painters and by hit-testing.
export const MIN_NOTE_W = 18;
export const NOTE_PAD = 3;

// ─── Anchor-lane constants (PR3d) ──────────────────────────────────
// Anchor lane lives below the beat bar so its time axis stays
// aligned with notes and tones. 18px gives enough room for a fret
// label plus a width-strip visualization.
export const ANCHOR_LANE_H = 18;
export const HS_LANE_H = 20;   // E2: handshape (chord-shape / arpeggio) span lane
// Tone lane is an overlay strip across the top of the chart, not part of the
// lane stack — setLaneMetrics() below deliberately does not subtract it.
export const TONE_LANE_H = 16;

// Lane metrics, re-derived from the canvas height on resize. See the header:
// importers read these as live bindings; only setLaneMetrics() may write them.
export let WAVEFORM_H = 70;
export let LANE_H = 44;
export let BEAT_H = 24;

// Size the lanes to fill `canvasHeightPx`. The beat bar and waveform take a
// fixed fraction (with floors so a short canvas stays legible); the anchor and
// handshape strips are reserved; the note lanes divide what's left, never
// dropping below 30px.
export function setLaneMetrics(canvasHeightPx) {
    const h = canvasHeightPx;
    const minBeat = 20, minWave = 50;
    BEAT_H = Math.max(minBeat, Math.floor(h * 0.05));
    WAVEFORM_H = Math.max(minWave, Math.floor(h * 0.12));
    LANE_H = Math.max(30, Math.floor((h - WAVEFORM_H - BEAT_H - ANCHOR_LANE_H - HS_LANE_H) / lanes()));
}

// ── time ⇄ x ────────────────────────────────────────────────────────
export function timeToX(t)  { return LABEL_W + (t - S.scrollX) * S.zoom; }
export function xToTime(x)  { return (x - LABEL_W) / S.zoom + S.scrollX; }

export const EDITOR_SCROLL_TAIL_SECONDS = 2;

export function _editorViewportDurationPure(canvasWidthPx, labelWidthPx, zoomPxPerSecond) {
    const w = Number(canvasWidthPx);
    const label = Number(labelWidthPx);
    const zoom = Number(zoomPxPerSecond);
    if (!Number.isFinite(w) || !Number.isFinite(label) || !Number.isFinite(zoom) || zoom <= 0) return 0;
    return Math.max(0, (w - label) / zoom);
}

export function _editorMaxScrollXPure(durationSeconds, viewportDurationSeconds, tailSeconds) {
    const duration = Number(durationSeconds);
    const view = Number(viewportDurationSeconds);
    const tail = Number(tailSeconds);
    if (!Number.isFinite(duration) || duration <= 0) return 0;
    const v = Math.max(0, Number.isFinite(view) ? view : 0);
    // The song already fits on screen → pin to the start (no scroll, no tail).
    // The tail only extends the range once the content itself runs past the
    // viewport, so a short/zoomed-out song can't hide its beginning.
    if (duration <= v) return 0;
    return Math.max(0, duration + Math.max(0, Number.isFinite(tail) ? tail : 0) - v);
}

export function _editorClampScrollXPure(scrollX, durationSeconds, viewportDurationSeconds, tailSeconds) {
    const raw = Number(scrollX);
    const safe = Number.isFinite(raw) ? raw : 0;
    return Math.max(0, Math.min(safe, _editorMaxScrollXPure(durationSeconds, viewportDurationSeconds, tailSeconds)));
}

// ── string ⇄ lane ⇄ y ───────────────────────────────────────────────
export function laneToY(l)  { return WAVEFORM_H + l * LANE_H; }
export function yToLane(y)  { return Math.floor((y - WAVEFORM_H) / LANE_H); }
export function strToY(s)   { return laneToY(strToLane(s)); }
export function yToStr(y)   { const l = Math.max(0, Math.min(lanes() - 1, yToLane(y))); return laneToStr(l); }
