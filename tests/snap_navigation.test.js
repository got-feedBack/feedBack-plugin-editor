'use strict';
/*
 * Snap + timeline navigation helper tests for screen.js.
 *
 * Run: node tests/snap_navigation.test.js
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const src = fs.readFileSync(path.join(__dirname, '..', 'screen.js'), 'utf8');
const m = src.match(/\/\* @pure:snap-nav:start \*\/[\s\S]*?\/\* @pure:snap-nav:end \*\//);
if (!m) {
    console.error('FAIL: @pure:snap-nav block not found in screen.js');
    process.exit(1);
}

const api = new Function(
    '"use strict";' + m[0] + '\nreturn { SNAP_OPTIONS, _snapTimeToGrid, _nextTimeInList, _nextBeatTime, _nextGridTime };'
)();

let pass = 0;
let fail = 0;
function t(name, fn) {
    try { fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}

const beats = [
    { time: 0.0 },
    { time: 1.0 },
    { time: 2.0 },
    { time: 3.0 },
];

t('snap includes extended straight and triplet options', () => {
    const labels = api.SNAP_OPTIONS.map((o) => o.label);
    for (const label of ['1/24', '1/32', '1/48T', '1/64', '1/96T']) {
        assert.ok(labels.includes(label), label + ' missing');
    }
});

t('snap-to-grid is disabled cleanly', () => {
    assert.strictEqual(api._snapTimeToGrid(0.37, beats, 1 / 16, false), 0.37);
});

t('snap-to-grid uses surrounding beat spacing', () => {
    assert.strictEqual(api._snapTimeToGrid(0.37, beats, 0.25, true), 0.25);
    assert.strictEqual(api._snapTimeToGrid(0.63, beats, 0.25, true), 0.75);
});

t('next beat jump moves strictly forward and backward', () => {
    assert.strictEqual(api._nextBeatTime(beats, 0.0, 1), 1.0);
    assert.strictEqual(api._nextBeatTime(beats, 1.0, -1), 0.0);
});

t('grid jump follows snap spacing instead of whole beats', () => {
    assert.strictEqual(api._nextGridTime(beats, 0.25, true, 0.10, 1), 0.25);
    assert.strictEqual(api._nextGridTime(beats, 0.25, true, 0.26, -1), 0.25);
});

t('generic list jumps ignore duplicate current hits', () => {
    const times = [0.0, 1.0, 1.0, 2.5];
    assert.strictEqual(api._nextTimeInList(times, 1.0, 1), 2.5);
    assert.strictEqual(api._nextTimeInList(times, 1.0, -1), 0.0);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
