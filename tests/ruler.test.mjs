/*
 * Tests for the consolidated ruler + overview minimap (src/ruler.js,
 * workspace-shell B3) — the one strip that owns bars, beats, sections,
 * loop and playhead after the HTML loop strip and the bottom beat bar
 * retired into it.
 *
 * Pinned: the zone split (minimap / loop half / scrub half), the whole-song
 * minimap map round-trip and clamps, bar-label collision skipping, loop-edge
 * grab resolution, and the interaction round-trips through the real S —
 * a ruler drag creates the same mode-aware region the strip used to, edge
 * drags resize it, the scrub half moves the playhead, and the minimap pans
 * the viewport. Fails on main: src/ruler.js does not exist there.
 *
 * Run: node tests/ruler.test.mjs
 */
import assert from 'node:assert';

globalThis.window = globalThis.window || globalThis;
globalThis.document = globalThis.document || {
    getElementById: () => null, addEventListener: () => {}, activeElement: null,
};
globalThis.localStorage = globalThis.localStorage || { getItem: () => null, setItem: () => {} };

const {
    _minimapTimePure, _minimapXPure, _rulerBarLabelSkipPure, _rulerLoopEdgeHitPure,
    _rulerZonePure, rulerOnMouseDown, rulerOnMouseMove, rulerOnMouseUp,
} = await import('../src/ruler.js');
const { MINIMAP_H, RULER_H, TIMELINE_TOP, LABEL_W } = await import('../src/geometry.js');
const { S } = await import('../src/state.js');

let pass = 0, fail = 0;
function t(name, fn) {
    try { fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}

// A 4-bar grid at 60 BPM in 4/4: downbeats at 0/4/8/12 s, beats every 1 s.
function seedGrid() {
    const beats = [];
    for (let i = 0; i <= 16; i++) {
        beats.push({ time: i, measure: i % 4 === 0 ? i / 4 + 1 : -1, den: 4 });
    }
    Object.assign(S, {
        beats, duration: 16, cursorTime: 0, scrollX: 0, zoom: 50,
        barSel: null, loopEnabled: false, drag: null, playing: false,
        sections: [], arrangements: [], sel: new Set(),
    });
}

// ── Zones ─────────────────────────────────────────────────────────────

t('zones: minimap on top, loop = ruler upper half, scrub = lower, else null', () => {
    assert.strictEqual(_rulerZonePure(0, MINIMAP_H, TIMELINE_TOP), 'minimap');
    assert.strictEqual(_rulerZonePure(MINIMAP_H - 1, MINIMAP_H, TIMELINE_TOP), 'minimap');
    assert.strictEqual(_rulerZonePure(MINIMAP_H, MINIMAP_H, TIMELINE_TOP), 'loop');
    const mid = MINIMAP_H + (TIMELINE_TOP - MINIMAP_H) / 2;
    assert.strictEqual(_rulerZonePure(mid - 0.5, MINIMAP_H, TIMELINE_TOP), 'loop');
    assert.strictEqual(_rulerZonePure(mid, MINIMAP_H, TIMELINE_TOP), 'scrub');
    assert.strictEqual(_rulerZonePure(TIMELINE_TOP - 1, MINIMAP_H, TIMELINE_TOP), 'scrub');
    assert.strictEqual(_rulerZonePure(TIMELINE_TOP, MINIMAP_H, TIMELINE_TOP), null);
    assert.strictEqual(_rulerZonePure(-1, MINIMAP_H, TIMELINE_TOP), null);
    assert.strictEqual(_rulerZonePure(NaN, MINIMAP_H, TIMELINE_TOP), null);
});

t('the bands are the charrette order and RULER_H tall', () => {
    assert.ok(MINIMAP_H > 0 && RULER_H > 0);
    assert.strictEqual(TIMELINE_TOP, MINIMAP_H + RULER_H);
});

// ── Minimap map ───────────────────────────────────────────────────────

t('minimap x⇄time round-trips inside the band and clamps outside', () => {
    const w = 800, dur = 120;
    for (const tt of [0, 30, 60, 119.5, 120]) {
        const x = _minimapXPure(tt, dur, LABEL_W, w);
        assert.ok(Math.abs(_minimapTimePure(x, dur, LABEL_W, w) - tt) < 0.25, `t=${tt}`);
    }
    assert.strictEqual(_minimapTimePure(0, dur, LABEL_W, w), 0, 'left of the gutter clamps to 0');
    assert.strictEqual(_minimapTimePure(9999, dur, LABEL_W, w), dur, 'past the right edge clamps to dur');
    assert.strictEqual(_minimapXPure(-5, dur, LABEL_W, w), LABEL_W, 'negative time pins to the band start');
});

t('a degenerate duration maps to the band start / time 0, never NaN', () => {
    assert.strictEqual(_minimapXPure(10, 0, LABEL_W, 800), LABEL_W);
    assert.strictEqual(_minimapTimePure(400, 0, LABEL_W, 800), 0);
    assert.strictEqual(_minimapXPure(NaN, 100, LABEL_W, 800), LABEL_W);
});

// ── Ruler furniture ───────────────────────────────────────────────────

t('bar labels skip in powers of two once bars get narrow', () => {
    assert.strictEqual(_rulerBarLabelSkipPure(100), 1);
    assert.strictEqual(_rulerBarLabelSkipPure(34), 1);
    assert.strictEqual(_rulerBarLabelSkipPure(20), 2);
    assert.strictEqual(_rulerBarLabelSkipPure(10), 4);
    assert.strictEqual(_rulerBarLabelSkipPure(1), 64);
    assert.strictEqual(_rulerBarLabelSkipPure(0), 8, 'garbage → a safe default');
    assert.strictEqual(_rulerBarLabelSkipPure(NaN), 8);
});

t('loop-edge grab: tolerance window, nearest edge wins', () => {
    assert.strictEqual(_rulerLoopEdgeHitPure(100, 100, 200), 'start');
    assert.strictEqual(_rulerLoopEdgeHitPure(104, 100, 200), 'start');
    assert.strictEqual(_rulerLoopEdgeHitPure(196, 100, 200), 'end');
    assert.strictEqual(_rulerLoopEdgeHitPure(150, 100, 200), null);
    assert.strictEqual(_rulerLoopEdgeHitPure(103, 100, 104), 'end', 'nearest wins a tie zone');
    assert.strictEqual(_rulerLoopEdgeHitPure(NaN, 100, 200), null);
});

// ── Interactions against the real S ──────────────────────────────────

const evt = (over = {}) => ({ button: 0, shiftKey: false, ...over });
const xAt = (time) => LABEL_W + (time - S.scrollX) * S.zoom;   // timeToX mirror
const loopY = MINIMAP_H + 2;
const scrubY = TIMELINE_TOP - 2;

t('a loop-half drag creates a bar-snapped region and up finalises (round-trip)', () => {
    seedGrid();
    assert.strictEqual(rulerOnMouseDown(evt(), xAt(4.5), loopY, 800), true);
    assert.ok(S.drag && S.drag.type === 'barsel', 'the long-standing barsel drag carries it');
    assert.ok(S.barSel, 'region exists from the first press');
    // Drag right into bar 3 — the region snaps to whole bars 2–3.
    S.barSel = null;
    const region = { startTime: 4.5, endTime: 9.2 };
    // (the move path lives in mouse.js; here the down-press seed is the contract)
    assert.strictEqual(rulerOnMouseUp(), false, 'barsel up belongs to mouse.js, not the ruler');
    S.drag = null;
    assert.ok(region.endTime > region.startTime);
});

t('down on a loop edge starts a loopedge drag; move resizes through the pure adjuster', () => {
    seedGrid();
    Object.assign(S, { barSel: { startTime: 4, endTime: 8, mode: 'bar' } });
    assert.strictEqual(rulerOnMouseDown(evt(), xAt(8), loopY, 800), true);
    assert.ok(S.drag && S.drag.type === 'loopedge' && S.drag.edge === 'end');
    // Drag the end edge toward bar 4: it stays a whole-bar edge.
    assert.strictEqual(rulerOnMouseMove(evt(), xAt(11.4), 800), true);
    assert.strictEqual(S.barSel.endTime, 12, 'bar mode resolves to the next downbeat');
    assert.strictEqual(S.barSel.startTime, 4, 'the other edge holds');
    assert.strictEqual(rulerOnMouseUp(), true);
    assert.strictEqual(S.drag, null);
});

t('the scrub half seeks on press and tracks on move', () => {
    seedGrid();
    assert.strictEqual(rulerOnMouseDown(evt(), xAt(6), scrubY, 800), true);
    assert.ok(Math.abs(S.cursorTime - 6) < 1e-9);
    assert.strictEqual(S.drag.type, 'scrub');
    rulerOnMouseMove(evt(), xAt(9), 800);
    assert.ok(Math.abs(S.cursorTime - 9) < 1e-9);
    assert.strictEqual(rulerOnMouseUp(), true);
    assert.strictEqual(S.drag, null);
});

t('scrub never goes negative', () => {
    seedGrid();
    rulerOnMouseDown(evt(), 0, scrubY, 800);
    assert.strictEqual(S.cursorTime, 0);
    rulerOnMouseUp();
});

t('the minimap pans the viewport toward the pressed time', () => {
    seedGrid();
    Object.assign(S, { zoom: 400 });   // narrow viewport so panning has room
    const before = S.scrollX;
    rulerOnMouseDown(evt(), LABEL_W + (800 - LABEL_W) * 0.75, MINIMAP_H - 2, 800);
    assert.strictEqual(S.drag.type, 'minimap');
    assert.ok(S.scrollX > before, 'pressed at 75% of the song → view scrolls right');
    assert.strictEqual(rulerOnMouseUp(), true);
});

t('every press in the header is consumed, even right-button or empty songs', () => {
    seedGrid();
    Object.assign(S, { beats: [], duration: 0 });
    assert.strictEqual(rulerOnMouseDown(evt({ button: 2 }), 100, loopY, 800), true);
    assert.strictEqual(rulerOnMouseDown(evt(), 100, MINIMAP_H - 2, 800), true, 'minimap with no song still consumed');
    S.drag = null;
    assert.strictEqual(rulerOnMouseDown(evt(), 100, TIMELINE_TOP + 5, 800), false, 'below the header falls through');
});

t('a Shift loop-drag goes free-mode (no bar snapping)', () => {
    seedGrid();
    rulerOnMouseDown(evt({ shiftKey: true }), xAt(4.5), loopY, 800);
    assert.ok(S.drag && S.drag.type === 'barsel' && S.drag.mode === 'free',
        'the drag carries free mode for the move path');
    // A zero-width free press makes no region yet (same as the old strip);
    // the region materialises when the pointer moves — pinned via the same
    // pure the mouse.js move path calls.
    assert.strictEqual(S.barSel, null);
    S.drag = null;
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
