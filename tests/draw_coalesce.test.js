'use strict';
/*
 * Tests for the draw-call coalescer (@pure:draw-coalesce block).
 *
 * draw() is called imperatively from ~150 sites; each call used to repaint
 * the entire canvas immediately, so one mousemove hitting several state
 * updates paid several full repaints — and the coming multi-part arrange
 * view multiplies per-repaint cost. draw() now marks the frame dirty and
 * schedules ONE drawNow() on the next animation frame. This pins the
 * batching contract:
 *   - N draw() calls in one frame → one rAF, one paint;
 *   - a draw() issued DURING the paint queues exactly one follow-up frame;
 *   - the queue re-arms cleanly after every flush.
 *
 * Run: node tests/draw_coalesce.test.js
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const src = fs.readFileSync(path.join(__dirname, '..', 'screen.js'), 'utf8');
const m = src.match(/\/\* @pure:draw-coalesce:start \*\/[\s\S]*?\/\* @pure:draw-coalesce:end \*\//);
if (!m) {
    console.error('FAIL: @pure:draw-coalesce block not found in screen.js');
    process.exit(1);
}

// Fake frame scheduler: collect callbacks, fire them on demand.
function makeEnv(drawNowImpl) {
    const frames = [];
    const paints = { count: 0 };
    const drawNow = () => { paints.count++; if (drawNowImpl) drawNowImpl(api); };
    const api = new Function(
        'requestAnimationFrame', 'drawNow',
        '"use strict";' + m[0] + '\nreturn { draw, _drawFlush };'
    )((cb) => frames.push(cb), drawNow);
    api.frames = frames;
    api.paints = paints;
    return api;
}

let pass = 0, fail = 0;
function t(name, fn) {
    try { fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}

t('many draw() calls in one frame coalesce to one rAF and one paint', () => {
    const env = makeEnv();
    for (let i = 0; i < 25; i++) env.draw();
    assert.strictEqual(env.frames.length, 1, 'one frame scheduled');
    env.frames.shift()();
    assert.strictEqual(env.paints.count, 1, 'one paint');
});

t('queue re-arms after a flush', () => {
    const env = makeEnv();
    env.draw();
    env.frames.shift()();
    env.draw();
    env.draw();
    assert.strictEqual(env.frames.length, 1, 'a fresh frame after the flush');
    env.frames.shift()();
    assert.strictEqual(env.paints.count, 2);
});

t('a draw() issued during the paint queues exactly one follow-up frame', () => {
    let reentered = false;
    const env = makeEnv((api) => {
        if (!reentered) { reentered = true; api.draw(); api.draw(); }
    });
    env.draw();
    env.frames.shift()();                    // paint #1 re-queues once
    assert.strictEqual(env.frames.length, 1, 'one follow-up frame, not two');
    env.frames.shift()();
    assert.strictEqual(env.paints.count, 2);
    assert.strictEqual(env.frames.length, 0, 'settled');
});

t('no paint happens without a frame firing (draw is deferred, not sync)', () => {
    const env = makeEnv();
    env.draw();
    assert.strictEqual(env.paints.count, 0);
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
