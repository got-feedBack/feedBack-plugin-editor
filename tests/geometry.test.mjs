/*
 * Tests for canvas geometry (src/geometry.js), driven through the real `S`
 * and the real lane model.
 *
 * The load-bearing contract here is the LIVE BINDING: `WAVEFORM_H` / `LANE_H` /
 * `BEAT_H` are exported `let`s that only `setLaneMetrics()` writes. Every
 * importer must see the updated value without a re-import, and no importer may
 * assign one. If that ever stopped holding, the ~100 read sites in main.js
 * would silently draw at the boot-time lane heights after every resize.
 *
 * Run: node tests/geometry.test.mjs
 */
import assert from 'node:assert';
import * as geo from '../src/geometry.js';
import { S } from '../src/state.js';
import { LC, lanes } from '../src/lanes.js';
import {
    EDITOR_SCROLL_TAIL_SECONDS, LABEL_W, laneToY, strToY, timeToX, xToTime,
    yToLane, yToStr,
} from '../src/geometry.js';

let pass = 0, fail = 0;
function t(name, fn) {
    try { fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}

function setArr(arr) {
    S.arrangements = arr ? [arr] : [];
    S.currentArr = 0;
    LC.active = false;
    LC.labels = null;
}
const guitar = () => ({ name: 'Lead', tuning: new Array(6).fill(0), notes: [], chords: [] });

// ── time ⇄ x ────────────────────────────────────────────────────────

t('timeToX offsets by the label gutter and scales by zoom', () => {
    S.scrollX = 0; S.zoom = 100;
    assert.strictEqual(timeToX(0), LABEL_W, 't=0 sits at the gutter edge');
    assert.strictEqual(timeToX(2), LABEL_W + 200);
});

t('xToTime inverts timeToX, including while scrolled', () => {
    for (const [scrollX, zoom] of [[0, 100], [3.5, 120], [61.25, 37]]) {
        S.scrollX = scrollX; S.zoom = zoom;
        for (const t0 of [0, 1.5, 42, 1234.75]) {
            assert.ok(Math.abs(xToTime(timeToX(t0)) - t0) < 1e-9,
                `roundtrip t=${t0} @ scroll=${scrollX} zoom=${zoom}`);
        }
    }
});

// ── string ⇄ lane ⇄ y ───────────────────────────────────────────────

t('laneToY and yToLane invert each other at lane tops', () => {
    for (let l = 0; l < 6; l++) assert.strictEqual(yToLane(laneToY(l)), l);
});

t('strToY / yToStr round-trip inside each lane band', () => {
    setArr(guitar());
    for (let s = 0; s < 6; s++) {
        assert.strictEqual(yToStr(strToY(s) + 1), s, `string ${s} mid-band`);
    }
    assert.ok(strToY(0) > strToY(5), 'low E draws below high e');
});

t('yToStr clamps out-of-range y rather than returning a phantom string', () => {
    setArr(guitar());
    assert.strictEqual(yToStr(-10_000), 5, 'above the first lane → highest string');
    assert.strictEqual(yToStr(10_000), 0, 'below the last lane → lowest string');
});

// ── lane metrics: the live-binding contract ──────────────────────────

t('setLaneMetrics is the only writer, and importers see the new values', () => {
    setArr(guitar());
    const before = geo.WAVEFORM_H;
    geo.setLaneMetrics(1000);
    assert.notStrictEqual(geo.WAVEFORM_H, before, 'the exported binding updated');
    assert.strictEqual(geo.WAVEFORM_H, 120, '12% of 1000');
    // lanes fill what's left after the timeline header (minimap + ruler),
    // waveform, anchor + handshape strips (the bottom beat bar retired into
    // the B3 ruler — no BEAT_H reserve anymore)
    const expected = Math.floor((1000 - geo.TIMELINE_TOP - 120 - geo.ANCHOR_LANE_H - geo.HS_LANE_H) / lanes());
    assert.strictEqual(geo.LANE_H, expected);
});

t('an importer cannot assign a lane metric (read-only binding)', () => {
    assert.throws(() => { geo.WAVEFORM_H = 1; }, TypeError);
});

t('geometry reads the NEW metrics after a resize (no stale capture)', () => {
    setArr(guitar());
    geo.setLaneMetrics(1000);
    const tall = laneToY(1);
    geo.setLaneMetrics(400);
    const short = laneToY(1);
    assert.notStrictEqual(tall, short, 'laneToY tracks the resized metrics');
    assert.strictEqual(short, geo.TIMELINE_TOP + geo.WAVEFORM_H + geo.LANE_H);
});

t('short canvases hit the floors instead of collapsing', () => {
    setArr(guitar());
    geo.setLaneMetrics(10);
    assert.strictEqual(geo.WAVEFORM_H, 50, 'waveform floor');
    assert.strictEqual(geo.LANE_H, 30, 'lane floor — never a negative height');
});

t('lane height divides by the CURRENT string count', () => {
    setArr(guitar());
    geo.setLaneMetrics(1000);
    const six = geo.LANE_H;
    setArr({ name: 'Bass', tuning: [0, 0, 0, 0], notes: [], chords: [] });
    geo.setLaneMetrics(1000);
    assert.ok(geo.LANE_H > six, '4 bass lanes are taller than 6 guitar lanes');
});

// ── scroll bounds ────────────────────────────────────────────────────

t('the scroll tail is exported alongside the clamp that consumes it', () => {
    assert.strictEqual(EDITOR_SCROLL_TAIL_SECONDS, 2);
    const view = geo._editorViewportDurationPure(1000, LABEL_W, 120);
    assert.strictEqual(
        geo._editorClampScrollXPure(1e9, 300, view, EDITOR_SCROLL_TAIL_SECONDS),
        geo._editorMaxScrollXPure(300, view, EDITOR_SCROLL_TAIL_SECONDS));
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
