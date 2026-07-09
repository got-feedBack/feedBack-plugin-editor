'use strict';
/*
 * Tests for loop-edge nudging (@pure:loop-nudge + @pure:loop-region blocks):
 * arrow keys on a focused loop handle nudge that edge by the mode's natural
 * step — bar → adjacent downbeat, grid → one snap step, free → 10/50 ms.
 *
 * The probe subtlety under test: the bar adjuster resolves an END edge as
 * "the downbeat strictly after the probe", so bar-mode end nudges must probe
 * a hair EARLY or every nudge would overshoot by a whole bar.
 *
 * Run: node tests/loop_nudge.test.js
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
function extract(name) {
    const re = new RegExp(
        '/\\* @pure:' + name + ':start \\*/[\\s\\S]*?/\\* @pure:' + name + ':end \\*/');
    const m = src.match(re);
    if (!m) { console.error(`FAIL: @pure:${name} block missing`); process.exit(1); }
    return m[0];
}

const api = new Function(
    '"use strict";' + extract('loop-region') + '\n' + extract('loop-nudge')
    + '\nreturn { _loopNudgeProbePure, _loopEdgeAdjustPure };'
)();
const { _loopNudgeProbePure, _loopEdgeAdjustPure } = api;

let pass = 0, fail = 0;
function t(name, fn) {
    try { fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}

const DOWNBEATS = [0, 2, 4, 6, 8];
const DUR = 10;
const noSnap = (t) => t;

// Full nudge = probe → edge adjust, as the runtime composes them.
function nudge(region, edge, dir, coarse = false) {
    const mode = region.mode === 'grid' || region.mode === 'free' ? region.mode : 'bar';
    const cur = edge === 'start' ? region.startTime : region.endTime;
    const probe = _loopNudgeProbePure(mode, edge, cur, dir, DOWNBEATS, 0.5, coarse);
    if (probe === null) return null;
    return _loopEdgeAdjustPure(mode, region, edge, probe, DOWNBEATS, DUR, noSnap);
}

t('bar: end nudge moves exactly ONE bar (no overshoot)', () => {
    const r = nudge({ startTime: 2, endTime: 4, mode: 'bar' }, 'end', +1);
    assert.deepStrictEqual({ s: r.startTime, e: r.endTime }, { s: 2, e: 6 });
});

t('bar: end nudge back moves exactly one bar', () => {
    const r = nudge({ startTime: 2, endTime: 6, mode: 'bar' }, 'end', -1);
    assert.deepStrictEqual({ s: r.startTime, e: r.endTime }, { s: 2, e: 4 });
});

t('bar: start nudges land on adjacent downbeats both ways', () => {
    const fwd = nudge({ startTime: 2, endTime: 8, mode: 'bar' }, 'start', +1);
    assert.strictEqual(fwd.startTime, 4);
    const back = nudge({ startTime: 4, endTime: 8, mode: 'bar' }, 'start', -1);
    assert.strictEqual(back.startTime, 2);
});

t('bar: no adjacent downbeat → null (never wraps)', () => {
    assert.strictEqual(
        _loopNudgeProbePure('bar', 'start', 0, -1, DOWNBEATS, 0.5, false), null);
    assert.strictEqual(
        _loopNudgeProbePure('bar', 'end', 8, +1, DOWNBEATS, 0.5, false), null);
});

t('grid: nudges by one snap step', () => {
    const r = nudge({ startTime: 1.0, endTime: 3.0, mode: 'grid' }, 'end', +1);
    assert.strictEqual(r.endTime, 3.5);
});

t('free: 10 ms fine, 50 ms coarse', () => {
    const fine = nudge({ startTime: 1.0, endTime: 3.0, mode: 'free' }, 'start', +1);
    assert.ok(Math.abs(fine.startTime - 1.01) < 1e-9);
    const coarse = nudge({ startTime: 1.0, endTime: 3.0, mode: 'free' }, 'start', -1, true);
    assert.ok(Math.abs(coarse.startTime - 0.95) < 1e-9);
});

t('nudge cannot push an edge across its partner', () => {
    const r = nudge({ startTime: 2.99, endTime: 3.0, mode: 'free' }, 'start', +1);
    assert.ok(r.startTime < r.endTime);
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
