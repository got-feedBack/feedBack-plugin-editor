/*
 * Playhead-follow-during-playback: the gutter-aware "catch" math, the
 * continuous "Scroll in Play" mode, and the loop-wrap recentre.
 *
 * THE BUG this fixes: the follow math measured its 80% trigger and 30% landing
 * against the FULL canvas width but read the cursor x from timeToX (which adds
 * the 52px LABEL_W gutter). So the timeline's usable width (viewW − 52) was
 * never what it computed against, and the effective landing fraction drifted
 * with canvas width — 52px is a bigger slice of an 800px canvas than a 1920px
 * one. That read as "follow doesn't respect the edge at different resolutions."
 * The DPR axis was already fine (both operands are CSS px) — deliberately no
 * DPR term here.
 *
 * Reference: Logic's Catch (page-jump, default) vs Scroll in Play (continuous,
 * centred) — Logic Pro user guide p.48 / glossary p.1299. Ableton and Pro
 * Tools offer the same two-way choice and nothing more, so this is the whole
 * customization worth having.
 *
 * Supersedes tests/follow_toggle.test.js and tests/loop_wrap_follow.test.js —
 * both slice the same @pure blocks; the policy fns are now exported and
 * imported for real.
 *
 * Run: node --test tests/follow_scroll.test.mjs
 */
import assert from 'node:assert';
import fs from 'node:fs';
import test from 'node:test';

import {
    FOLLOW_CENTER_FRAC, FOLLOW_LAND_FRAC, FOLLOW_TRIGGER_FRAC,
    _followPinXPure, _followScrollTargetPure, _followUsableWPure,
    _loopWrapScrollTargetPure, _scrollInPlayTargetPure,
} from '../src/audio.js';

const LABEL_W = 52;
const ZOOM = 100;

// timeToX in the real module: LABEL_W + (t - scrollX) * zoom. The tests drive
// the policy with a cursorX derived this way so they exercise the exact gutter
// interaction the bug was about.
const cursorXAt = (t, scrollX, zoom = ZOOM) => LABEL_W + (t - scrollX) * zoom;

// ── The bug: width-invariance of the landing fraction ────────────────

test('the landing fraction is measured against the USABLE width, not the full width', () => {
    // This is the must-fail-on-main assertion. After a page-jump the cursor
    // must land at LABEL_W + usableW*0.3 REGARDLESS of canvas width. On main it
    // lands at LABEL_W + viewW*0.3, which drifts with width.
    for (const viewW of [480, 800, 1280, 1920]) {
        for (const zoom of [50, 400, 2000]) {
            const cursorTime = 100;
            // Put the cursor just past the trigger so a jump fires.
            const scrollX = cursorTime - (viewW * 0.9) / zoom;
            const cx = cursorXAt(cursorTime, scrollX, zoom);
            const target = _followScrollTargetPure(cursorTime, cx, viewW, zoom, true);
            assert.ok(target !== null, `should jump at viewW=${viewW} zoom=${zoom}`);
            // After scrolling to `target`, where does the cursor sit on screen?
            const landedX = LABEL_W + (cursorTime - target) * zoom;
            const usableW = viewW - LABEL_W;
            assert.ok(Math.abs(landedX - (LABEL_W + usableW * FOLLOW_LAND_FRAC)) < 1e-6,
                `viewW=${viewW} zoom=${zoom}: landed at ${landedX}, want ${LABEL_W + usableW * FOLLOW_LAND_FRAC}`);
        }
    }
});

test('the trigger fires against the usable width too', () => {
    const viewW = 800, usableW = viewW - LABEL_W;
    const cursorTime = 100;
    // Cursor exactly AT the trigger fraction of the usable width → no jump yet.
    const atTriggerX = LABEL_W + usableW * FOLLOW_TRIGGER_FRAC;
    const scrollAt = cursorTime - (atTriggerX - LABEL_W) / ZOOM;
    assert.strictEqual(
        _followScrollTargetPure(cursorTime, cursorXAt(cursorTime, scrollAt), viewW, ZOOM, true),
        null, 'exactly at the trigger does not jump');
    // A pixel past → jump.
    const pastX = atTriggerX + 1;
    const scrollPast = cursorTime - (pastX - LABEL_W) / ZOOM;
    assert.ok(_followScrollTargetPure(cursorTime, cursorXAt(cursorTime, scrollPast), viewW, ZOOM, true) !== null,
        'a pixel past the trigger jumps');
});

// ── Follow off, and guards ───────────────────────────────────────────

test('follow off never scrolls, even past the trigger', () => {
    assert.strictEqual(_followScrollTargetPure(100, 9999, 800, ZOOM, false), null);
    assert.strictEqual(_scrollInPlayTargetPure(100, 800, ZOOM, false), null);
    assert.strictEqual(_loopWrapScrollTargetPure(30, -500, 800, ZOOM, false), null);
});

test('degenerate viewport / zoom never produces a target', () => {
    assert.strictEqual(_followUsableWPure(40), 0, 'a canvas narrower than the gutter has no usable width');
    assert.strictEqual(_followScrollTargetPure(100, 9999, 40, ZOOM, true), null);
    assert.strictEqual(_scrollInPlayTargetPure(100, 800, 0, true), null, 'zoom 0');
    assert.strictEqual(_scrollInPlayTargetPure(100, 800, -5, true), null, 'negative zoom');
});

// ── Continuous Scroll in Play ────────────────────────────────────────

test('continuous mode pins the cursor at centre of the usable width', () => {
    const viewW = 800, zoom = 200, cursorTime = 42;
    const target = _scrollInPlayTargetPure(cursorTime, viewW, zoom, true);
    const landedX = LABEL_W + (cursorTime - target) * zoom;
    const usableW = viewW - LABEL_W;
    assert.ok(Math.abs(landedX - (LABEL_W + usableW * FOLLOW_CENTER_FRAC)) < 1e-6,
        'the cursor sits at the usable-width centre');
});

test('continuous mode returns a target every call — no trigger', () => {
    // Unlike catch, it never returns null while following (the tick sets scrollX
    // every frame). Even with the cursor at the far left it still centres.
    assert.ok(_scrollInPlayTargetPure(0.01, 800, ZOOM, true) !== null);
    assert.ok(_scrollInPlayTargetPure(500, 800, ZOOM, true) !== null);
});

// ── The pin reads the same fraction as the scroll ────────────────────

test('the pin x equals where continuous scroll parks the cursor', () => {
    // The pin must not point where the scroll does not hold. Derive both and
    // confirm they land on the same pixel.
    const viewW = 1280, zoom = 300, cursorTime = 88;
    const pinX = _followPinXPure(viewW, FOLLOW_CENTER_FRAC);
    const target = _scrollInPlayTargetPure(cursorTime, viewW, zoom, true);
    const cursorX = LABEL_W + (cursorTime - target) * zoom;
    assert.ok(Math.abs(pinX - cursorX) < 1e-9, 'the pin sits exactly where the cursor is parked');
});

// ── Loop-wrap recentre ───────────────────────────────────────────────

test('a loop restart off the left edge pulls the view back, gutter-aware', () => {
    const viewW = 800, usableW = viewW - LABEL_W;
    const target = _loopWrapScrollTargetPure(30, -500, viewW, ZOOM, true);
    const landedX = LABEL_W + (30 - target) * ZOOM;
    assert.ok(Math.abs(landedX - (LABEL_W + usableW * FOLLOW_LAND_FRAC)) < 1e-6,
        'the restart lands at the usable 30% mark');
});

test('a loop already comfortably on screen never twitches', () => {
    const viewW = 800, usableW = viewW - LABEL_W;
    assert.strictEqual(_loopWrapScrollTargetPure(10, 300, viewW, ZOOM, true), null);
    assert.strictEqual(_loopWrapScrollTargetPure(10, LABEL_W, viewW, ZOOM, true), null,
        'exactly at the gutter counts as visible');
    assert.strictEqual(
        _loopWrapScrollTargetPure(10, LABEL_W + usableW * FOLLOW_TRIGGER_FRAC, viewW, ZOOM, true),
        null, 'exactly at the usable trigger counts as visible');
});

test('a restart just inside the gutter is off-screen and recenters', () => {
    assert.notStrictEqual(_loopWrapScrollTargetPure(10, LABEL_W - 1, 800, ZOOM, true), null);
});

// ── Wiring guards (source-text, the part a pure fn can't prove) ───────

const src = fs.readFileSync(new URL('../src/audio.js', import.meta.url), 'utf8');
const drawSrc = fs.readFileSync(new URL('../src/draw.js', import.meta.url), 'utf8');

test('the follow block branches on scroll-in-play', () => {
    // The tick must choose the continuous target when Scroll in Play is active,
    // else the catch target — for BOTH the forward follow and the loop wrap.
    assert.ok(/_scrollInPlayActive\(\)\s*\n?\s*\?\s*_scrollInPlayTargetPure/.test(src)
        || src.includes('_scrollInPlayActive()') && src.includes('_scrollInPlayTargetPure(S.cursorTime'),
        'the forward follow block must branch to _scrollInPlayTargetPure');
});

test('the Scroll in Play pin is hidden while Follow is off', () => {
    assert.ok(
        /S\.playing\s*&&\s*editorFollowEnabled\(\)\s*&&\s*_scrollInPlayActive\(\)/.test(drawSrc),
        'the visual pin must require playback, Follow, and the effective continuous manner',
    );
});

test('playbackTick applies the wrap scroll before every wrap return', () => {
    // Carried over from the old loop_wrap_follow suite: the policy could be
    // perfect and the view still strand, because the count-in wrap path returns
    // before the scroll runs.
    const blockStart = src.indexOf('if (loopRestart !== null) {');
    assert.ok(blockStart > 0, 'loop-wrap block not found in playbackTick');
    const callAt = src.indexOf('ScrollTargetPure(', blockStart);
    assert.ok(callAt > 0, 'the wrap block never computes a scroll target');
    const firstReturn = src.indexOf('return;', blockStart);
    assert.ok(callAt < firstReturn,
        'the wrap scroll must run before the first return, or the count-in path skips it');
});
