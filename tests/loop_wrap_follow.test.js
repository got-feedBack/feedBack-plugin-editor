'use strict';
/*
 * Tests for the A/B loop-wrap scroll (@pure:loop-wrap-scroll block) and its
 * wiring into playbackTick.
 *
 * Two separate gaps put the view out of sync with a wrapping loop, and both
 * fail on main:
 *   1. Policy — the forward-only @pure:follow-scroll rule fires on
 *      cursorX > 80% and returns null for anything to the LEFT, so it can
 *      never express the backward jump a wrap makes.
 *   2. Wiring — both wrap paths in playbackTick `return` before the follow
 *      block at the end of the tick, so on a wrap frame no scroll code runs
 *      at all. The structural test at the bottom is the one that pins this;
 *      a policy that nothing calls would still leave the view stranded.
 *
 * Run: node tests/loop_wrap_follow.test.js
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'audio.js'), 'utf8');
const LABEL_W = 52;

let pass = 0, fail = 0;
function t(name, fn) {
    try { fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}

// Deliberately NOT a hard process.exit on a missing block: on main the slice is
// absent AND the wiring is absent, and the wiring guard below is the one that
// names the actual defect. Bailing here would report "block not found" and hide
// which of the two gaps a future regression reopened.
const _m0 = src.match(/\/\* @pure:loop-wrap-scroll:start \*\/[\s\S]*?\/\* @pure:loop-wrap-scroll:end \*\//);
// LABEL_W is a geometry.js import in the real module; inject it as the slice's
// only free name, the same way the sibling follow-scroll suite injects stubs.
const _loopWrapScrollTargetPure = _m0 && new Function(
    'LABEL_W',
    '"use strict";' + _m0[0].replace(/^export\s+/gm, '') + '\nreturn { _loopWrapScrollTargetPure };'
)(LABEL_W)._loopWrapScrollTargetPure;

t('the @pure:loop-wrap-scroll policy exists', () => {
    assert.ok(_m0, '@pure:loop-wrap-scroll block not found in src/audio.js');
});

function policy(...args) {
    assert.ok(_loopWrapScrollTargetPure, 'no wrap policy to exercise');
    return _loopWrapScrollTargetPure(...args);
}

// 800px view at zoom 100 px/s; the 30% landing is 240px = 2.4s from the left.
const VIEW_W = 800, ZOOM = 100, LANDING = (VIEW_W * 0.3) / ZOOM;

t('loop start off the LEFT edge pulls the view back', () => {
    // The pass that just played scrolled downstream; the restart is now drawn
    // at x=-500, well left of the gutter. This is the case the forward-only
    // follow policy structurally cannot return a target for.
    const target = policy(30, -500, VIEW_W, ZOOM, true);
    assert.ok(Math.abs(target - (30 - LANDING)) < 1e-9, 'loop start lands at 30% of the view');
});

t('loop start downstream of the view pulls the view forward', () => {
    const target = policy(30, 780, VIEW_W, ZOOM, true);
    assert.ok(Math.abs(target - (30 - LANDING)) < 1e-9);
});

t('a loop already on screen never twitches', () => {
    assert.strictEqual(policy(10, 300, VIEW_W, ZOOM, true), null);
    assert.strictEqual(policy(10, LABEL_W, VIEW_W, ZOOM, true), null,
        'exactly at the gutter counts as visible');
    assert.strictEqual(policy(10, VIEW_W * 0.8, VIEW_W, ZOOM, true), null,
        'exactly at 80% counts as visible');
});

t('just inside the gutter is off-screen and recenters', () => {
    assert.notStrictEqual(policy(10, LABEL_W - 1, VIEW_W, ZOOM, true), null);
});

t('follow OFF: a wrap never moves the view (Shift+L still wins)', () => {
    assert.strictEqual(policy(30, -500, VIEW_W, ZOOM, false), null);
    assert.strictEqual(policy(30, 99999, VIEW_W, ZOOM, false), null);
});

// The wiring guard. This is what actually fails on main: the policy could be
// perfect and the view would still strand, because no wrap path reaches it.
t('playbackTick applies the wrap scroll before every wrap return', () => {
    const blockStart = src.indexOf('if (loopRestart !== null) {');
    assert.ok(blockStart > 0, 'loop-wrap block not found in playbackTick');
    const callAt = src.indexOf('_loopWrapScrollTargetPure(', blockStart);
    assert.ok(callAt > 0, 'the wrap block never calls _loopWrapScrollTargetPure');
    const firstReturn = src.indexOf('return;', blockStart);
    assert.ok(firstReturn > 0, 'expected a return inside the wrap block');
    assert.ok(callAt < firstReturn,
        'the wrap scroll must run before the first return, or the count-in path skips it');
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
