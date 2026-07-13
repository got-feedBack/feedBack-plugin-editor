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
// The status line is a real (fake) element so the Map Health click-through's copy
// can be read back — everything else still resolves to null, as before.
let statusText = '';
globalThis.document = globalThis.document || {
    getElementById: (id) => (id === 'editor-status'
        ? { set textContent(v) { statusText = v; }, get textContent() { return statusText; } }
        : null),
    addEventListener: () => {}, activeElement: null,
};
globalThis.localStorage = globalThis.localStorage || { getItem: () => null, setItem: () => {} };

const {
    _mapHealthClickThrough, _minimapTimePure, _minimapXPure, _rulerBarLabelSkipPure,
    _rulerLoopEdgeHitPure, _rulerMappedEndPure,
    _rulerZonePure, editorToggleMapHealth, rulerOnMouseDown, rulerOnMouseMove, rulerOnMouseUp,
} = await import('../src/ruler.js');
const { MINIMAP_H, RULER_H, TIMELINE_TOP, LABEL_W } = await import('../src/geometry.js');
const { _editorViewportDuration } = await import('../src/loop.js');
const { _editorCommandById } = await import('../src/shortcuts.js');
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

t('mapped range ends at the final confirmed downbeat', () => {
    assert.strictEqual(_rulerMappedEndPure([
        { time: 1, measure: 1 }, { time: 1.5, measure: -1 },
        { time: 2, measure: 2 }, { time: 2.5, measure: -1 },
    ]), 2);
    assert.strictEqual(_rulerMappedEndPure([{ time: 1, measure: -1 }]), null);
    assert.strictEqual(_rulerMappedEndPure(null), null);
});


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
    assert.deepStrictEqual(
        { startTime: S.barSel.startTime, endTime: S.barSel.endTime, mode: S.barSel.mode },
        { startTime: 4, endTime: 8, mode: 'bar' },
        'the press seeds the whole bar containing 4.5');
    // The move path lives in mouse.js; ruler mouse-up deliberately leaves it
    // there to finalize the shared barsel drag.
    assert.strictEqual(rulerOnMouseUp(), false, 'barsel up belongs to mouse.js, not the ruler');
    S.drag = null;
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

t('scrubbing while playing resumes playback on release', () => {
    seedGrid();
    S.playing = true;
    assert.strictEqual(rulerOnMouseDown(evt(), xAt(6), scrubY, 800), true);
    assert.strictEqual(S.drag.resume, true, 'pre-stop playing state is retained');
    assert.strictEqual(rulerOnMouseUp(), true);
    assert.strictEqual(S.drag, null, 'release consumes the resume path and clears the drag');
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

// ── Map Health click-through (a hot bar takes you to the fix) ─────────
//
// Kept LAST: the lens is a sticky module flag, and _ensureOnsets caches the first
// peaks it sees for the process — so everything above runs with the lens off, as
// it ships.

// Drive the REAL onset detector: a flat RMS floor with a spike 0.2 s after every
// beat. 20 % of a 1 s beat is past redMin (0.12), so every measured bar reads RED.
function seedDriftingGrid() {
    seedGrid();
    const bins = 1600;                                  // 16 s / 1600 = 10 ms a bin
    const rms = new Float32Array(bins).fill(0.01);
    for (let b = 0; b < 16; b++) rms[Math.round((b + 0.2) * 100)] = 1;
    S.waveformPeaks = { bins, rms };
    Object.assign(S, { tempoMapMode: false, tempoSel: -1, tempoSelMulti: new Set() });
    statusText = '';
    editorToggleMapHealth(true);
}

t('map health: a drifting bar takes you to Tempo Map, anchored on its downbeat', () => {
    seedDriftingGrid();
    assert.ok(_mapHealthClickThrough(5.5), 'bar 2 (4–8 s) is drifting → handled');
    assert.strictEqual(S.tempoMapMode, true);
    assert.strictEqual(S.tempoSel, 4, 'Suggest is anchored on bar 2 = S.beats index 4');
    S.tempoMapMode = false;
});

t('map health: a click-through already in Tempo Map drops the stale multi-selection', () => {
    seedDriftingGrid();
    S.tempoMapMode = true;                              // already mapping…
    S.tempoSelMulti = new Set([0, 12]);                 // …with a barline RANGE live
    assert.ok(_mapHealthClickThrough(5.5));
    assert.strictEqual(S.tempoSel, 4);
    // _editorTempoSuggestFit re-anchors on a live multi-range's FIRST downbeat,
    // which outranks tempoSel — leave it set and Suggest fits from bar 1, not the
    // bar the user clicked, while the status line promises otherwise.
    assert.strictEqual(S.tempoSelMulti.size, 0, 'the range is cleared, like a plain pole click');
    S.tempoMapMode = false;
});

t('map health: the lead-in scroll keeps the clicked downbeat on screen at max zoom', () => {
    seedDriftingGrid();
    S.zoom = 2000;                                      // the zoom ceiling
    const view = _editorViewportDuration();
    assert.ok(view < 0.5, 'precondition: the viewport is shorter than a flat 0.5 s lead');
    assert.ok(_mapHealthClickThrough(8.5), 'bar 3 (8–12 s)');
    assert.ok(S.scrollX <= 8 && 8 <= S.scrollX + view,
        `bar 3's downbeat (8 s) stays inside the viewport [${S.scrollX}, ${S.scrollX + view}]`);
    S.tempoMapMode = false;
});

t('map health: the status copy resolves the Suggest key from the command registry', () => {
    seedDriftingGrid();
    const def = _editorCommandById('tempoSuggestFit');
    const saved = def.keys.feedback;
    def.keys.feedback = 'Y (Tempo Map)';                // rebind under the live profile
    try {
        assert.ok(_mapHealthClickThrough(5.5));
        assert.match(statusText, /press Y to fit/, `copy follows the registry: ${statusText}`);
    } finally {
        def.keys.feedback = saved;
        S.tempoMapMode = false;
    }
});

t('map health: the label gutter shows no wash, so a click there never claims a bar', () => {
    seedDriftingGrid();
    S.scrollX = 4.5;                                    // gutter x now maps INTO bar 2…
    // …but _drawMapHealthBand clamps every span to x >= LABEL_W, so the gutter is
    // bare. A click on unpainted pixels must scrub, not teleport into Tempo Map.
    rulerOnMouseDown(evt(), LABEL_W - 10, TIMELINE_TOP - 2, 800);
    assert.strictEqual(S.tempoMapMode, false, 'no click-through from unpainted pixels');
    assert.ok(S.drag && S.drag.type === 'scrub', 'it scrubs, like the rest of the lane');
    S.drag = null;
});

t('map health: the click target is exactly the painted wash, not a pixel taller', () => {
    seedDriftingGrid();
    const x = xAt(5.5);                                 // over drifting bar 2
    rulerOnMouseDown(evt(), x, TIMELINE_TOP - 6, 800);  // one px ABOVE the wash
    assert.strictEqual(S.tempoMapMode, false, 'above the wash is plain scrub lane');
    assert.ok(S.drag && S.drag.type === 'scrub');
    S.drag = null;
    rulerOnMouseDown(evt(), x, TIMELINE_TOP - 5, 800);  // the wash's top row
    assert.strictEqual(S.tempoMapMode, true, 'the top row of the wash clicks through');
    assert.strictEqual(S.drag, null, 'a click-through starts no scrub drag');
    S.tempoMapMode = false;
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
