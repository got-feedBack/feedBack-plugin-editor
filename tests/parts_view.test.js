'use strict';
/*
 * Tests for the Parts view's pure core (@pure:parts-view block): the part
 * list assembly (every arrangement + the drum tab as its own lane), lane
 * layout math, the 3-band collapsed drum mapping, and lane hit-testing.
 *
 * The Parts view is the stacked all-parts overview (workspace design §3a):
 * navigational by design — click arms, double-click opens a focus editor.
 *
 * Run: node tests/parts_view.test.js
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const src = fs.readFileSync(path.join(__dirname, '..', 'screen.js'), 'utf8');
const m = src.match(/\/\* @pure:parts-view:start \*\/[\s\S]*?\/\* @pure:parts-view:end \*\//);
if (!m) {
    console.error('FAIL: @pure:parts-view block not found in screen.js');
    process.exit(1);
}
const api = new Function(
    '"use strict";' + m[0]
    + '\nreturn { _partsListPure, _partsLaneLayoutPure, _partsDrumBandPure, _partsLaneAtYPure };'
)();
const { _partsListPure, _partsLaneLayoutPure, _partsDrumBandPure, _partsLaneAtYPure } = api;

let pass = 0, fail = 0;
function t(name, fn) {
    try { fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}

// ── part list ────────────────────────────────────────────────────────────────
t('every arrangement becomes a lane; drums appends as its own lane', () => {
    const arrs = [
        { name: 'Lead', notes: [{}, {}], chords: [{ notes: [{}, {}] }] },
        { name: 'Bass', notes: [{}], chords: [] },
    ];
    const parts = _partsListPure(arrs, { hits: [{}, {}, {}] });
    assert.strictEqual(parts.length, 3);
    assert.deepStrictEqual(parts.map(p => p.kind), ['arr', 'arr', 'drums']);
    assert.strictEqual(parts[0].count, 3, 'notes + chord instances');
    assert.strictEqual(parts[2].count, 3, 'drum hits counted');
    assert.strictEqual(parts[0].idx, 0);
    assert.strictEqual(parts[2].idx, -1, 'drums is not an arrangement index');
});

t('an empty drum tab adds no lane; unnamed arrangements get a fallback', () => {
    const parts = _partsListPure([{ notes: [] }], { hits: [] });
    assert.strictEqual(parts.length, 1);
    assert.strictEqual(parts[0].name, 'Part 1');
    assert.deepStrictEqual(_partsListPure(null, null), []);
});

// ── layout ───────────────────────────────────────────────────────────────────
t('lane height divides the space and clamps to the readable range', () => {
    assert.strictEqual(_partsLaneLayoutPure(400, 4).laneH, 88, 'clamped high');
    assert.strictEqual(_partsLaneLayoutPure(300, 6).laneH, 50, 'even split');
    assert.strictEqual(_partsLaneLayoutPure(200, 12).laneH, 24, 'clamped low');
    assert.strictEqual(_partsLaneLayoutPure(300, 0).laneH, 0);
    assert.strictEqual(_partsLaneLayoutPure(0, 3).laneH, 0);
});

// ── drum bands ───────────────────────────────────────────────────────────────
t('drum categories map to the 3-row collapse: cymbals top, kick bottom', () => {
    assert.strictEqual(_partsDrumBandPure('cymbal'), 0);
    assert.strictEqual(_partsDrumBandPure('drum'), 1);
    assert.strictEqual(_partsDrumBandPure('kick'), 2);
    assert.strictEqual(_partsDrumBandPure(undefined), 1, 'unknown → middle');
});

// ── hit test ─────────────────────────────────────────────────────────────────
t('lane hit-test respects the waveform band and lane bounds', () => {
    const WF = 70, LANE = 50, N = 3;
    assert.strictEqual(_partsLaneAtYPure(30, WF, LANE, N), -1, 'waveform band');
    assert.strictEqual(_partsLaneAtYPure(WF, WF, LANE, N), 0, 'first lane top edge');
    assert.strictEqual(_partsLaneAtYPure(WF + 149, WF, LANE, N), 2, 'last lane');
    assert.strictEqual(_partsLaneAtYPure(WF + 150, WF, LANE, N), -1, 'past the stack');
    assert.strictEqual(_partsLaneAtYPure(100, WF, 0, N), -1, 'no layout → no hit');
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
