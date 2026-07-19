/*
 * Vertical lane scrolling for the drum grid.
 *
 * THE BUG: `DRUM_LANE_H` is a fixed 22px and `_drumLaneIdxToY` had no scroll
 * term, so 18 full-kit lanes (396px) simply ran off the bottom of a short
 * canvas with no way to reach what fell off. `DRUM_PIECE_ORDER` ends
 * `snare, snare_xstick, kick` — so the two most-used pieces on the kit were
 * the first to become unreachable. Measured in a browser at 1600x660: a
 * 457px canvas against a ~496px requirement.
 *
 * Reference for the auto-hiding bar: Logic shows the Tracks area's vertical
 * scroll bar only when there are more tracks than fit (Logic Pro user guide,
 * p.297).
 *
 * Run: node --test tests/lane_scroll.test.mjs
 */
import assert from 'node:assert';
import test from 'node:test';

import {
    LANE_THUMB_MIN_H,
    _clampLaneScrollPure, _laneScrollForThumbPure, _laneScrollMaxPure, _laneThumbPure,
} from '../src/lane-scroll.js';
import { DRUM_LANE_H, DRUM_PIECE_ORDER, _drumLaneIdxToY, _drumYToLaneIdx } from '../src/drum.js';
import { TIMELINE_TOP, WAVEFORM_H } from '../src/geometry.js';
import { S } from '../src/state.js';

const LANE_TOP = TIMELINE_TOP + WAVEFORM_H;

function withScroll(y, fn) {
    const prev = S.laneScrollY;
    S.laneScrollY = y;
    try { return fn(); } finally { S.laneScrollY = prev; }
}

// ── The reachability bug itself ──────────────────────────────────────

test('the kick lane is the LAST row, so it is the first thing lost', () => {
    // If this ever stops being true the bug's blast radius changes and the
    // test below is measuring the wrong lane.
    assert.strictEqual(DRUM_PIECE_ORDER[DRUM_PIECE_ORDER.length - 1], 'kick');
    assert.ok(DRUM_PIECE_ORDER.includes('snare'));
});

test('on a short canvas the kick lane sits below the fold at scroll 0', () => {
    // The measured case: a 457px canvas (1600x660 window).
    const canvasH = 457;
    const kickIdx = DRUM_PIECE_ORDER.length - 1;
    const kickY = withScroll(0, () => _drumLaneIdxToY(kickIdx));
    assert.ok(kickY > canvasH,
        `kick lane at y=${kickY} must be off a ${canvasH}px canvas — that is the bug`);
});

test('scrolling brings the kick lane into view — the fix', () => {
    const canvasH = 457;
    const kickIdx = DRUM_PIECE_ORDER.length - 1;
    const contentH = DRUM_PIECE_ORDER.length * DRUM_LANE_H;
    const viewH = canvasH - LANE_TOP;
    const max = _laneScrollMaxPure(contentH, viewH);
    assert.ok(max > 0, 'the grid must actually overflow this canvas');
    const kickY = withScroll(max, () => _drumLaneIdxToY(kickIdx));
    assert.ok(kickY >= LANE_TOP && kickY + DRUM_LANE_H <= canvasH,
        `at max scroll the kick lane (y=${kickY}) must be fully on a ${canvasH}px canvas`);
});

test('scrolled geometry round-trips: y -> lane -> y', () => {
    // The hit-test must agree with the painter, or you click one lane and
    // edit another. This is the whole reason both go through the funnel.
    const scroll = 120;
    withScroll(scroll, () => {
        for (const idx of [0, 5, 11, DRUM_PIECE_ORDER.length - 1]) {
            const y = _drumLaneIdxToY(idx);
            assert.strictEqual(_drumYToLaneIdx(y + DRUM_LANE_H / 2), idx,
                `lane ${idx} must hit-test back to itself when scrolled`);
        }
    });
});

test('an unscrolled grid is byte-identical to the old geometry', () => {
    // The fix must be a no-op for everyone whose window already fits.
    withScroll(0, () => {
        assert.strictEqual(_drumLaneIdxToY(0), LANE_TOP);
        assert.strictEqual(_drumLaneIdxToY(3), LANE_TOP + 3 * DRUM_LANE_H);
    });
});

// ── Scroll bounds ────────────────────────────────────────────────────

test('content that fits cannot scroll, and pins to the top', () => {
    assert.strictEqual(_laneScrollMaxPure(200, 400), 0);
    assert.strictEqual(_clampLaneScrollPure(999, 200, 400), 0);
});

test('scroll clamps to the last pixel of content, never past it', () => {
    assert.strictEqual(_laneScrollMaxPure(400, 300), 100);
    assert.strictEqual(_clampLaneScrollPure(999, 400, 300), 100);
    assert.strictEqual(_clampLaneScrollPure(-50, 400, 300), 0);
});

test('degenerate metrics never produce NaN scroll', () => {
    for (const [c, v] of [[0, 300], [400, 0], [NaN, 300], [400, NaN]]) {
        assert.strictEqual(_laneScrollMaxPure(c, v), 0);
        assert.ok(Number.isFinite(_clampLaneScrollPure(10, c, v)));
    }
    assert.strictEqual(_clampLaneScrollPure(NaN, 400, 300), 0);
});

// ── The bar ──────────────────────────────────────────────────────────

test('no thumb when everything fits — the bar auto-hides (Logic p.297)', () => {
    assert.strictEqual(_laneThumbPure(0, 200, 400, 40, 400), null);
});

test('thumb length tracks the visible fraction', () => {
    // Half the content visible ⇒ half-height thumb.
    const t = _laneThumbPure(0, 800, 400, 0, 400);
    assert.ok(Math.abs((t.y1 - t.y0) - 200) < 1e-9);
});

test('a tiny visible fraction still leaves a grabbable thumb', () => {
    const t = _laneThumbPure(0, 100000, 400, 0, 400);
    assert.strictEqual(t.y1 - t.y0, LANE_THUMB_MIN_H);
});

test('the thumb reaches the bottom exactly when the content does', () => {
    // Positioning by raw scroll ratio instead of progress-over-travel would
    // strand the thumb short of the end whenever the min-height kicked in.
    const contentH = 100000, viewH = 400, trackTop = 40, trackH = 400;
    const max = _laneScrollMaxPure(contentH, viewH);
    const t = _laneThumbPure(max, contentH, viewH, trackTop, trackH);
    assert.ok(Math.abs(t.y1 - (trackTop + trackH)) < 1e-9,
        'at max scroll the thumb must sit flush with the rail bottom');
});

test('thumb drag inverts back to the scroll offset it came from', () => {
    const contentH = 800, viewH = 400, top = 40, th = 400;
    for (const scroll of [0, 137, _laneScrollMaxPure(contentH, viewH)]) {
        const t = _laneThumbPure(scroll, contentH, viewH, top, th);
        const back = _laneScrollForThumbPure(t.y0, 0, contentH, viewH, top, th);
        assert.ok(Math.abs(back - scroll) < 1e-6,
            `dragging the thumb to where scroll=${scroll} put it must give ${scroll}, got ${back}`);
    }
});

test('dragging past either end clamps instead of overscrolling', () => {
    const contentH = 800, viewH = 400, top = 40, th = 400;
    const max = _laneScrollMaxPure(contentH, viewH);
    assert.strictEqual(_laneScrollForThumbPure(-9999, 0, contentH, viewH, top, th), 0);
    assert.strictEqual(_laneScrollForThumbPure(9999, 0, contentH, viewH, top, th), max);
});

test('a non-scrolling view reports no drag target', () => {
    assert.strictEqual(_laneScrollForThumbPure(100, 0, 200, 400, 40, 400), 0);
});
