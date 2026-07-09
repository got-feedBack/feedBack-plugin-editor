'use strict';
/*
 * Tests for the per-beat rubato drag (@pure:tempo-beat-drag block +
 * _tempoApplyDrag): grabbing an individual sub-beat tick in Tempo Map mode
 * re-times that beat inside its measure — the intra-bar counterpart of the
 * per-measure pole drag, for hand-syncing accel/rit in rubato recordings.
 *
 * Pinned here:
 *   - drag bounds stay inside the bounding downbeats with a per-gap
 *     minimum, so the proportional re-space can squeeze but never collapse
 *     or reorder a gap;
 *   - ends without a bounding downbeat clamp against the immediate
 *     neighbor (pickup / trailing sub-beats);
 *   - _tempoApplyDrag (extracted from source) keeps downbeats fixed and
 *     re-spaces only the dragged beat's neighbours, monotonically.
 *
 * Run: node tests/tempo_beat_drag.test.js
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');

const m = src.match(/\/\* @pure:tempo-beat-drag:start \*\/[\s\S]*?\/\* @pure:tempo-beat-drag:end \*\//);
if (!m) {
    console.error('FAIL: @pure:tempo-beat-drag block not found in screen.js');
    process.exit(1);
}
const { _tempoBeatDragBoundsPure } = new Function(
    '"use strict";' + m[0] + '\nreturn { _tempoBeatDragBoundsPure };'
)();

// Extract _tempoApplyDrag by name (brace matching — the waveform_render
// harness pattern); it only touches its arguments.
function extractFn(name) {
    const start = src.indexOf('function ' + name);
    assert.ok(start >= 0, `function ${name} must exist`);
    const open = src.indexOf('{', start);
    let depth = 0;
    for (let i = open; i < src.length; i++) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}' && --depth === 0) return src.slice(start, i + 1);
    }
    throw new Error(`unbalanced braces extracting ${name}`);
}
const _tempoApplyDrag = new Function(
    '"use strict";' + extractFn('_tempoApplyDrag') + '\nreturn _tempoApplyDrag;'
)();

let pass = 0, fail = 0;
function t(name, fn) {
    try { fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}

// One 4/4 bar 0..2 s, next bar 2..4 s (120 BPM).
const GRID = () => [
    { time: 0.0, measure: 1 },
    { time: 0.5, measure: -1 },
    { time: 1.0, measure: -1 },
    { time: 1.5, measure: -1 },
    { time: 2.0, measure: 2 },
    { time: 2.5, measure: -1 },
    { time: 3.0, measure: -1 },
    { time: 3.5, measure: -1 },
    { time: 4.0, measure: 3 },
];

// ── bounds ───────────────────────────────────────────────────────────────────
t('bounds: interior sub-beat clamps inside its measure with per-gap minimums', () => {
    const b = _tempoBeatDragBoundsPure(GRID(), 2, 0.005, 4);
    // Beat index 2 sits 2 gaps after downbeat 0 and 2 gaps before downbeat 4.
    assert.ok(Math.abs(b.lo - 0.01) < 1e-9, 'lo = downbeat + 2 gaps of 5 ms');
    assert.ok(Math.abs(b.hi - 1.99) < 1e-9, 'hi = next downbeat - 2 gaps of 5 ms');
});

t('bounds: trailing sub-beat with no next downbeat clamps to its neighbor/duration', () => {
    const beats = GRID().slice(0, 8);   // ends on a sub-beat at 3.5
    const b = _tempoBeatDragBoundsPure(beats, 7, 0.005, 6);
    assert.ok(Math.abs(b.lo - (2.0 + 0.005 * 3)) < 1e-9, 'lo from its downbeat');
    assert.strictEqual(b.hi, 6, 'hi = song duration when nothing bounds it');
});

t('bounds: degenerate indices return null', () => {
    assert.strictEqual(_tempoBeatDragBoundsPure(GRID(), -1, 0.005, 4), null);
    assert.strictEqual(_tempoBeatDragBoundsPure(GRID(), 99, 0.005, 4), null);
    assert.strictEqual(_tempoBeatDragBoundsPure(null, 0, 0.005, 4), null);
});

// ── the drag itself (via the real _tempoApplyDrag) ───────────────────────────
t('dragging a sub-beat keeps both bounding downbeats fixed', () => {
    const beats = GRID();
    _tempoApplyDrag(beats, 2, 1.3);   // drag beat 2 from 1.0 → 1.3
    assert.strictEqual(beats[0].time, 0.0, 'own downbeat fixed');
    assert.strictEqual(beats[4].time, 2.0, 'next downbeat fixed');
    assert.strictEqual(beats[2].time, 1.3, 'dragged beat lands where dropped');
});

t('neighbours re-space proportionally on both sides (accel/rit shape)', () => {
    const beats = GRID();
    _tempoApplyDrag(beats, 2, 1.3);
    // Before: beat 1 at 50% of [0, dragged]; after: 0.65.
    assert.ok(Math.abs(beats[1].time - 0.65) < 1e-9, 'earlier side stretches');
    // Beat 3 at 50% of [dragged, 2.0]; after: 1.3 + 0.35 = 1.65.
    assert.ok(Math.abs(beats[3].time - 1.65) < 1e-9, 'later side compresses');
});

t('order stays monotonic across the whole grid after an extreme drag', () => {
    const beats = GRID();
    const bounds = _tempoBeatDragBoundsPure(beats, 2, 0.005, 4);
    _tempoApplyDrag(beats, 2, bounds.hi);   // slam to the clamp edge
    for (let i = 1; i < beats.length; i++) {
        assert.ok(beats[i].time > beats[i - 1].time,
            `beats[${i}] ${beats[i].time} > beats[${i - 1}] ${beats[i - 1].time}`);
    }
});

t('order stays monotonic after slamming to the low clamp edge', () => {
    const beats = GRID();
    const bounds = _tempoBeatDragBoundsPure(beats, 2, 0.005, 4);
    _tempoApplyDrag(beats, 2, bounds.lo);   // slam to the opposite clamp edge
    for (let i = 1; i < beats.length; i++) {
        assert.ok(beats[i].time > beats[i - 1].time,
            `beats[${i}] ${beats[i].time} > beats[${i - 1}] ${beats[i - 1].time}`);
    }
});

t('the second measure is untouched by a drag in the first', () => {
    const beats = GRID();
    _tempoApplyDrag(beats, 2, 1.3);
    assert.strictEqual(beats[5].time, 2.5);
    assert.strictEqual(beats[6].time, 3.0);
    assert.strictEqual(beats[8].time, 4.0);
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
