'use strict';
/*
 * Loop-region helper tests for screen.js.
 *
 * Run: node tests/loop_region.test.js
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const src = fs.readFileSync(path.join(__dirname, '..', 'screen.js'), 'utf8');
const m = src.match(/\/\* @pure:loop-region:start \*\/[\s\S]*?\/\* @pure:loop-region:end \*\//);
if (!m) {
    console.error('FAIL: @pure:loop-region block not found in screen.js');
    process.exit(1);
}

const api = new Function(
    '"use strict";' + m[0] + '\nreturn { _barSpanForTimesPure, _adjustBarSelEdgePure };'
)();

let pass = 0;
let fail = 0;
function t(name, fn) {
    try { fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}

const downbeats = [0, 2, 4, 6, 8];

t('bar span snaps outward to whole bars', () => {
    assert.deepStrictEqual(api._barSpanForTimesPure(downbeats, 10, 2.4, 5.1), { startTime: 2, endTime: 6 });
});

t('bar span uses song end when dragged past last downbeat', () => {
    assert.deepStrictEqual(api._barSpanForTimesPure(downbeats, 10, 7.2, 9.3), { startTime: 6, endTime: 10 });
});

t('start handle clamps to prior downbeat without crossing the end', () => {
    const region = { startTime: 2, endTime: 6 };
    assert.deepStrictEqual(api._adjustBarSelEdgePure(region, 'start', 0.8, downbeats, 10), { startTime: 0, endTime: 6 });
    assert.deepStrictEqual(api._adjustBarSelEdgePure(region, 'start', 5.8, downbeats, 10), { startTime: 4, endTime: 6 });
});

t('end handle snaps to the next downbeat or duration', () => {
    const region = { startTime: 2, endTime: 6 };
    assert.deepStrictEqual(api._adjustBarSelEdgePure(region, 'end', 6.1, downbeats, 10), { startTime: 2, endTime: 8 });
    assert.deepStrictEqual(api._adjustBarSelEdgePure(region, 'end', 8.2, downbeats, 10), { startTime: 2, endTime: 10 });
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
