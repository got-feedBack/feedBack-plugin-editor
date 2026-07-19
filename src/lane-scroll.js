/* Slopsmith Arrangement Editor — vertical lane scrolling.
 *
 * The horizontal story has always been complete: `S.scrollX` pans the
 * timeline and every writer funnels through `_editorClampScrollX`. The
 * VERTICAL story had a hole. Two canvas views stack fixed-height lanes and
 * simply ran off the bottom of a short canvas with no way to reach what
 * fell off:
 *
 *   Drum grid   `DRUM_LANE_H` is a fixed 22px and `_drumLaneIdxToY` had no
 *               scroll term. 18 full-kit lanes need 396px, so on a canvas
 *               shorter than ~496px the bottom lanes were unreachable — and
 *               `DRUM_PIECE_ORDER` ends `snare, snare_xstick, kick`, so the
 *               two most-used pieces on the kit were the first to vanish.
 *               That is the bug this module exists for.
 *   Piano roll  dodged the overflow by SQUASHING instead: `PIANO_LANE_H`
 *               packs the whole range into ~350px and floors at 4px per
 *               semitone. Reachable, but unusable at any real range.
 *
 * The model mirrors the horizontal one exactly: one scroll offset in
 * `S.laneScrollY` (PIXELS, unlike `S.scrollX`'s seconds — lanes have no
 * natural unit), one clamp every writer passes through, and one funnel per
 * view so no call site can forget the term. `midiToY`/`yToMidi` and
 * `_drumLaneIdxToY`/`_drumYToLaneIdx` are those funnels: 29 call sites
 * across 7 modules go through them, so adding the offset there reaches
 * every painter and hit-test at once.
 *
 * Reference: Logic exposes a vertical scroll bar on the right edge of the
 * Tracks area, and only when the content exceeds the view (Logic Pro user
 * guide, p.297) — the auto-hide is deliberate, not an accident. Live puts
 * the same job on the wheel. Both are followed here.
 *
 * The bar is PAINTED on the canvas rather than added as a DOM rail. A
 * layout-participating rail would change `#editor-canvas-wrap`'s client
 * size, which feeds `setLaneMetrics()` — so the lane heights would change
 * the moment the bar appeared, moving the very content it measures. On the
 * canvas it costs nothing and reuses the drag-state pattern the minimap
 * scrollbar already established.
 */

import { S } from './state.js';
import { DRUM_LANE_H, _drumPieceCount } from './drum.js';
import { TIMELINE_TOP, WAVEFORM_H, laneScrollY } from './geometry.js';
import { ctx } from './canvas.js';

// Rail geometry. 10px reads as chrome rather than furniture at the edge of
// a dense grid; the thumb floors at 24px so a long piano range still leaves
// something to grab.
export const LANE_BAR_W = 10;
export const LANE_THUMB_MIN_H = 24;

/* @pure:lane-scroll:start */
// How far the lanes may scroll. Zero when everything already fits — the
// content is then pinned to the top, never floating.
export function _laneScrollMaxPure(contentH, viewH) {
    const c = Number(contentH), v = Number(viewH);
    if (!Number.isFinite(c) || !Number.isFinite(v) || c <= 0 || v <= 0) return 0;
    return Math.max(0, c - v);
}

export function _clampLaneScrollPure(y, contentH, viewH) {
    const raw = Number(y);
    const safe = Number.isFinite(raw) ? raw : 0;
    return Math.max(0, Math.min(safe, _laneScrollMaxPure(contentH, viewH)));
}

// The thumb's y-extent inside the rail, or null when there is nothing to
// scroll (which is also the signal not to paint the bar at all — Logic
// p.297 shows the vertical bar only when the content exceeds the view).
export function _laneThumbPure(scrollY, contentH, viewH, trackTop, trackH) {
    const max = _laneScrollMaxPure(contentH, viewH);
    if (max <= 0) return null;
    const th = Number(trackH);
    if (!Number.isFinite(th) || th <= 0) return null;
    const top = Number(trackTop) || 0;
    const minH = Math.min(LANE_THUMB_MIN_H, th);
    const h = Math.max(minH, th * (Number(viewH) / Number(contentH)));
    // Position by scroll PROGRESS over the travel the thumb actually has,
    // so the thumb reaches the bottom exactly when the content does. Using
    // the raw ratio would strand it short whenever the min-height kicked in.
    const progress = _clampLaneScrollPure(scrollY, contentH, viewH) / max;
    return { y0: top + progress * (th - h), y1: top + progress * (th - h) + h };
}

// Inverse: dragging the thumb to `y` means what scroll offset?
export function _laneScrollForThumbPure(y, grabDY, contentH, viewH, trackTop, trackH) {
    const max = _laneScrollMaxPure(contentH, viewH);
    if (max <= 0) return 0;
    const th = Number(trackH);
    const minH = Math.min(LANE_THUMB_MIN_H, th);
    const h = Math.max(minH, th * (Number(viewH) / Number(contentH)));
    const travel = th - h;
    if (!(travel > 0)) return 0;
    const top = (Number(trackTop) || 0) + (Number(grabDY) || 0);
    const progress = (Number(y) - top) / travel;
    return _clampLaneScrollPure(progress * max, contentH, viewH);
}
/* @pure:lane-scroll:end */

// Where the lane band starts. Both scrolling views stack from the same
// place: below the timeline header and the waveform strip.
export function laneBandTop() { return TIMELINE_TOP + WAVEFORM_H; }

// Metrics for whichever view is showing, or null when the active view does
// not scroll vertically. Today that means the drum grid only.
//
// The string/tab view is deliberately absent: its lanes AUTO-FIT via
// setLaneMetrics(), and at a 30px floor even a 9-string instrument fits
// every realistic canvas, so a bar there would be chrome that never moves.
// The tempo map has no lane stack at all.
//
// The PIANO ROLL is absent for a different reason — it is a follow-up, not
// a non-issue. Its content is at least always reachable (it squashes to a
// 4px lane rather than overflowing), and unlike the drum grid it shares the
// main draw chain with the string view and has the anchor + handshape lanes
// pinned below it via _beatBarTopY(). Scrolling it means making that stack
// scroll-aware too, which is a bigger change than this reachability fix and
// does not belong bundled with it.
export function laneScrollMetrics(canvasH) {
    const h = Number(canvasH);
    if (!Number.isFinite(h) || h <= 0) return null;
    const top = laneBandTop();
    const viewH = Math.max(0, h - top);
    if (viewH <= 0) return null;
    if (S.drumEditMode && S.drumTab) {
        return { top, viewH, contentH: _drumPieceCount() * DRUM_LANE_H };
    }
    return null;
}

// Re-clamp against the CURRENT metrics. Called after anything that changes
// the content or viewport height — a resize, a density switch, a range
// recompute — so a scrolled view can never be left staring past the end.
export function applyLaneScrollBounds(canvasH) {
    const m = laneScrollMetrics(canvasH);
    if (!m) { S.laneScrollY = 0; return 0; }
    S.laneScrollY = _clampLaneScrollPure(S.laneScrollY, m.contentH, m.viewH);
    return S.laneScrollY;
}

// Scroll by a wheel delta. Returns true when it consumed the gesture —
// false means "nothing to scroll here", and the caller should fall back to
// its existing behaviour rather than swallowing the event.
export function laneScrollBy(dy, canvasH) {
    const m = laneScrollMetrics(canvasH);
    if (!m || _laneScrollMaxPure(m.contentH, m.viewH) <= 0) return false;
    const next = _clampLaneScrollPure(laneScrollY() + dy, m.contentH, m.viewH);
    if (next === S.laneScrollY) return true;   // consumed, but already at the stop
    S.laneScrollY = next;
    return true;
}

export function setLaneScrollY(y, canvasH) {
    const m = laneScrollMetrics(canvasH);
    if (!m) return false;
    S.laneScrollY = _clampLaneScrollPure(y, m.contentH, m.viewH);
    return true;
}

// The rail's x-extent, hugging the right edge.
export function laneBarRect(canvasW, canvasH) {
    const m = laneScrollMetrics(canvasH);
    if (!m) return null;
    const thumb = _laneThumbPure(laneScrollY(), m.contentH, m.viewH, m.top, m.viewH);
    if (!thumb) return null;
    return { x: Number(canvasW) - LANE_BAR_W, w: LANE_BAR_W, ...m, thumb };
}

export function drawLaneScrollbar(canvasW, canvasH) {
    const r = laneBarRect(canvasW, canvasH);
    if (!r) return;                      // fits ⇒ no bar (Logic p.297)
    const held = !!S.drag && S.drag.type === 'lane-scroll';
    ctx.fillStyle = 'rgba(5,5,15,0.55)';
    ctx.fillRect(r.x, r.top, r.w, r.viewH);
    ctx.fillStyle = held ? 'rgba(120,220,232,0.85)' : 'rgba(220,230,255,0.30)';
    ctx.fillRect(r.x + 2, r.thumb.y0, r.w - 4, r.thumb.y1 - r.thumb.y0);
}

// Which part of the bar an (x, y) lands on: 'thumb' | 'track' | null.
export function laneBarHit(x, y, canvasW, canvasH) {
    const r = laneBarRect(canvasW, canvasH);
    if (!r) return null;
    if (x < r.x || x > r.x + r.w) return null;
    if (y < r.top || y > r.top + r.viewH) return null;
    return (y >= r.thumb.y0 && y <= r.thumb.y1) ? 'thumb' : 'track';
}
