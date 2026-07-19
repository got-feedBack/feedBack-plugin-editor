/*
 * The minimap is the timeline's horizontal scrollbar: its painted viewport
 * window is a THUMB you grab to scroll, whose edges you drag to zoom, and
 * whose strip you double-click to fit the whole song.
 *
 * Model: Ableton Live 12's Arrangement Overview (manual p.151 — "click and
 * drag horizontally to scroll left or right, or click and drag vertically to
 * zoom in or out. To zoom out to the full Arrangement, double-click anywhere
 * within") and its Clip View Selector (p.210 — a resizable outline that both
 * scrolls and zooms). Logic Pro splits the same job across a horizontal
 * scroll bar and a Horizontal Zoom slider (p.297).
 *
 * Before this, the strip painted a hairline rect that was not grabbable at
 * all and mousedown always JUMPED the view to centre on the click — so a
 * precise drag was impossible and the affordance read as dead chrome.
 *
 * Run: node --test tests/minimap_scrollbar.test.mjs
 */
import assert from 'node:assert';
import test from 'node:test';
import {
    MINIMAP_GRIP_W, MINIMAP_THUMB_MIN_W,
    _minimapFitZoomPure, _minimapHitPure, _minimapResizeZoomPure, _minimapThumbPure,
    _minimapTimePure,
} from '../src/ruler.js';
import { ZOOM_MAX, ZOOM_MIN } from '../src/geometry.js';

const LABEL_W = 52;
const W = 1052;            // 1000px of strip right of the gutter
const SPAN = W - LABEL_W;

test('the thumb spans exactly the visible slice of the song', () => {
    // 100s song, viewing 20s starting at 30s → thumb covers 30%..50%.
    const { x0, x1 } = _minimapThumbPure(30, 20, 100, LABEL_W, W);
    assert.strictEqual(x0, LABEL_W + 0.30 * SPAN);
    assert.strictEqual(x1, LABEL_W + 0.50 * SPAN);
});

test('a hair-thin thumb floors to a grabbable width', () => {
    // Viewing 0.1s of a 1000s song would be a 0.1px thumb — unclickable.
    const { x0, x1 } = _minimapThumbPure(0, 0.1, 1000, LABEL_W, W);
    assert.strictEqual(x1 - x0, MINIMAP_THUMB_MIN_W);
});

test('a floored thumb at the song end slides inside the strip, never overhangs', () => {
    const { x0, x1 } = _minimapThumbPure(999.9, 0.1, 1000, LABEL_W, W);
    assert.strictEqual(x1, W, 'right edge pins to the strip end');
    assert.strictEqual(x1 - x0, MINIMAP_THUMB_MIN_W);
    assert.ok(x0 >= LABEL_W, 'left edge stays inside the gutter');
});

test('hit test: grips beat the body, body beats the track', () => {
    const x0 = 200, x1 = 400;
    assert.strictEqual(_minimapHitPure(x0, x0, x1, MINIMAP_GRIP_W), 'grip-start');
    assert.strictEqual(_minimapHitPure(x1, x0, x1, MINIMAP_GRIP_W), 'grip-end');
    assert.strictEqual(_minimapHitPure(300, x0, x1, MINIMAP_GRIP_W), 'thumb');
    assert.strictEqual(_minimapHitPure(100, x0, x1, MINIMAP_GRIP_W), 'track');
    assert.strictEqual(_minimapHitPure(900, x0, x1, MINIMAP_GRIP_W), 'track');
});

test('a floored thumb keeps a draggable body between its two grips', () => {
    // With a 12px thumb and a 4px grip half-width, naive grips would cover
    // [x0-4,x0+4] and [x0+8,x0+16] — the whole body. The cap at a third of
    // the thumb keeps a body you can actually grab to scroll.
    const x0 = 200, x1 = 200 + MINIMAP_THUMB_MIN_W;
    const mid = (x0 + x1) / 2;
    assert.strictEqual(_minimapHitPure(mid, x0, x1, MINIMAP_GRIP_W), 'thumb');
});

test('a floored thumb grip stays aligned with the true viewport edge', () => {
    // At maximum zoom the real half-second viewport paints as a 12px thumb.
    // Its painted left grip therefore maps to an earlier song time than the
    // true left edge. The grab offset must preserve the true edge on the first
    // move instead of causing a dramatic zoom-out jump.
    const scrollX = 999.5, viewDur = 0.5, songDur = 1000;
    const { x0 } = _minimapThumbPure(scrollX, viewDur, songDur, LABEL_W, W);
    const pointerTime = _minimapTimePure(x0, songDur, LABEL_W, W);
    const grabDT = scrollX - pointerTime;
    const r = _minimapResizeZoomPure(
        'grip-start', pointerTime, scrollX, viewDur, SPAN,
        ZOOM_MIN, ZOOM_MAX, grabDT);
    assert.strictEqual(r.zoom, ZOOM_MAX, 'the first move keeps the current zoom');
    assert.ok(Math.abs(r.scrollX - scrollX) < 1e-9,
        'the painted grip still represents the true viewport edge');
});

test('dragging the end grip zooms with the left edge anchored', () => {
    // Viewing [30, 50] of a 100s song. Drag the right grip out to t=80 →
    // the window becomes [30, 80] = 50s across 1000px.
    const r = _minimapResizeZoomPure('grip-end', 80, 30, 20, SPAN, ZOOM_MIN, ZOOM_MAX);
    assert.strictEqual(r.scrollX, 30, 'left edge must not move');
    assert.strictEqual(r.zoom, SPAN / 50);
});

test('dragging the start grip zooms with the right edge anchored', () => {
    // Same window; drag the LEFT grip out to t=10 → window [10, 50] = 40s.
    const r = _minimapResizeZoomPure('grip-start', 10, 30, 20, SPAN, ZOOM_MIN, ZOOM_MAX);
    assert.strictEqual(r.zoom, SPAN / 40);
    assert.ok(Math.abs((r.scrollX + SPAN / r.zoom) - 50) < 1e-9, 'right edge must not move');
});

test('a clamped zoom still leaves the anchored edge where it was', () => {
    // Drag the start grip so far that the zoom hits the 2000px/s ceiling.
    // The span must be recomputed from the CLAMPED zoom, or the anchored
    // right edge silently drifts.
    const r = _minimapResizeZoomPure('grip-start', 49.999, 30, 20, SPAN, ZOOM_MIN, ZOOM_MAX);
    assert.strictEqual(r.zoom, 2000, 'zoom clamps at the ceiling');
    assert.ok(Math.abs((r.scrollX + SPAN / r.zoom) - 50) < 1e-9, 'right edge still anchored');
});

test('an inverted resize drag is refused rather than flipping the window', () => {
    // Dragging the end grip PAST the left edge would make a negative span.
    assert.strictEqual(_minimapResizeZoomPure('grip-end', 10, 30, 20, SPAN, ZOOM_MIN, ZOOM_MAX), null);
    assert.strictEqual(_minimapResizeZoomPure('grip-start', 80, 30, 20, SPAN, ZOOM_MIN, ZOOM_MAX), null);
});

test('zoom-to-fit sizes the whole song to the viewport', () => {
    assert.strictEqual(_minimapFitZoomPure(200, SPAN, ZOOM_MIN, ZOOM_MAX), SPAN / 200);
});

test('zoom-to-fit respects the zoom floor for an absurdly long song', () => {
    // A 10-hour recording would want 0.03px/s; the floor holds.
    assert.strictEqual(_minimapFitZoomPure(36000, SPAN, ZOOM_MIN, ZOOM_MAX), ZOOM_MIN);
});

test('a whole real song actually fits — the point of the zoom floor move', () => {
    // The floor used to be 20px/s, which capped the widest view at SPAN/20 =
    // 50s. Double-click-to-fit was a lie for anything longer than a jingle.
    // A 4-minute song must now genuinely fit in one screen.
    const fourMinutes = 240;
    const zoom = _minimapFitZoomPure(fourMinutes, SPAN, ZOOM_MIN, ZOOM_MAX);
    assert.ok(zoom > ZOOM_MIN, 'a 4-minute song must not be floored');
    assert.ok(Math.abs(SPAN / zoom - fourMinutes) < 1e-9, 'the whole song spans the viewport');
});

test('degenerate inputs never produce NaN geometry', () => {
    assert.strictEqual(_minimapFitZoomPure(0, SPAN, ZOOM_MIN, ZOOM_MAX), null);
    assert.strictEqual(_minimapFitZoomPure(100, 0, ZOOM_MIN, ZOOM_MAX), null);
    assert.strictEqual(_minimapResizeZoomPure('grip-end', NaN, 30, 20, SPAN, ZOOM_MIN, ZOOM_MAX), null);
    const { x0, x1 } = _minimapThumbPure(0, 0, 0, LABEL_W, W);
    assert.ok(Number.isFinite(x0) && Number.isFinite(x1));
    assert.strictEqual(_minimapHitPure(NaN, 200, 400, MINIMAP_GRIP_W), 'track');
});
