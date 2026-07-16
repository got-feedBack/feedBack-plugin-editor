/*
 * Regression: the drum editor's beat/measure grid must route through the
 * Canvas-appearance palette (View ▸ Canvas appearance…), not hard-coded
 * rgba(255,255,255,…) constants. The whole feature exists to make faint beat
 * lines visible; before the fix the drum editor kept its own invisible grid,
 * so the "Grid lines" slider did nothing in drum edit mode.
 *
 * Drives the real _drumEditorDraw against a spy 2D context (adopted via
 * setCanvas, so no source extraction) and inspects the stroke colors emitted.
 *
 * Run: node --test tests/drum_grid_appearance.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert';
import { setCanvas } from '../src/canvas.js';
import { S } from '../src/state.js';
import { _drumEditorDraw } from '../src/drum.js';
import { CP, setCanvasAppearance, resetCanvasAppearance } from '../src/canvas-appearance.js';

function drive() {
    const strokes = [];
    const store = {};
    const spy = new Proxy({}, {
        get: (_, p) => (p in store ? store[p] : () => {}),
        set: (_, p, v) => { store[p] = v; if (p === 'strokeStyle') strokes.push(v); return true; },
    });
    setCanvas({ getContext: () => spy });
    Object.assign(S, {
        drumTab: { hits: [] },
        drumSel: new Set(),
        scrollX: 0, zoom: 100,
        // One beat line and one measure line, both inside the viewport.
        beats: [{ time: 0.5, measure: 0 }, { time: 1, measure: 1 }],
    });
    _drumEditorDraw(800, 400);
    return strokes;
}

test('drum beat/measure grid uses the appearance palette at defaults', () => {
    resetCanvasAppearance();
    const strokes = drive();
    assert.ok(strokes.includes(CP('gridBeat')),
        `beat grid should stroke CP('gridBeat')=${CP('gridBeat')}, got ${JSON.stringify(strokes)}`);
    assert.ok(strokes.includes(CP('gridMeasure')),
        `measure grid should stroke CP('gridMeasure')=${CP('gridMeasure')}`);
    // The old invisible constants must be gone.
    assert.ok(!strokes.some((s) => typeof s === 'string' && s.startsWith('rgba(255,255,255,0.0')),
        'drum grid must not use the old faint-white constants');
});

test('the Grid-lines slider reaches the drum beat grid', () => {
    resetCanvasAppearance();
    const beatDefault = CP('gridBeat');
    setCanvasAppearance('grid', 400);
    const beatBright = CP('gridBeat');
    assert.notStrictEqual(beatBright, beatDefault); // sanity: slider changed the color
    const strokes = drive();
    assert.ok(strokes.includes(beatBright),
        `raising Grid lines must brighten the drum beat grid to ${beatBright}, got ${JSON.stringify(strokes)}`);
    resetCanvasAppearance();
});
