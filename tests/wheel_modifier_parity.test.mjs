/*
 * Wheel modifiers mean the same thing in every canvas view (src/mouse.js).
 *
 * Reported: Ctrl+wheel zoomed on the tempo map, the transcription track view,
 * AND the multi-track canvas, but Shift+wheel panned only the first two — on
 * the multi-track canvas it did nothing.
 *
 * Cause: the parts-view lane-scroll hijack exempted ctrlKey but not shiftKey.
 * Shift+wheel arrives deltaY-dominant, which matched the guard's
 * |deltaY| >= |deltaX| axis test, so the gesture was consumed as a lane scroll
 * and never reached the pan branch. Outside parts view there is no hijack, so
 * the same event fell through and panned — hence the split.
 *
 * Browsers disagree on whether Shift+wheel is delivered as deltaX or as deltaY
 * with shiftKey set, so BOTH forms are pinned here.
 *
 * Run: node tests/wheel_modifier_parity.test.mjs
 */
import assert from 'node:assert';
import { S } from '../src/state.js';
import { host } from '../src/host.js';
import { setCanvas } from '../src/canvas.js';
import { onWheel } from '../src/mouse.js';

let laneScrolls = [];
host.scrollTrackArea = (dy) => { laneScrolls.push(dy); };

// The Ctrl branch reads the pointer position off the canvas rect; the Shift and
// plain branches never touch it.
setCanvas({
    width: 1600, height: 800,
    getBoundingClientRect: () => ({ left: 0, top: 0, right: 1600, bottom: 800, width: 1600, height: 800 }),
    getContext: () => ({}),
});

function seed({ parts }) {
    laneScrolls = [];
    Object.assign(S, {
        duration: 300, audioShift: 0, audioBuffer: null,
        zoom: 120, scrollX: 10, partsViewMode: parts,
    });
}

function wheel(over) {
    return {
        deltaX: 0, deltaY: 0, ctrlKey: false, shiftKey: false,
        clientX: 400, clientY: 300, preventDefault() {}, ...over,
    };
}

let pass = 0, fail = 0;
function t(name, fn) {
    try { fn(); pass++; console.log('ok - ' + name); }
    catch (e) { fail++; process.exitCode = 1; console.error('not ok - ' + name + ': ' + e.message); }
}

// ── The regression ────────────────────────────────────────────────────────
t('multi-track canvas: Shift+wheel (deltaY form) pans the timeline', () => {
    seed({ parts: true });
    const before = S.scrollX;
    onWheel(wheel({ shiftKey: true, deltaY: 120 }));
    assert.notStrictEqual(S.scrollX, before, 'the timeline did not pan');
    assert.deepStrictEqual(laneScrolls, [], 'Shift+wheel must not scroll the lane stack');
});

t('multi-track canvas: Shift+wheel (deltaX form) pans the timeline', () => {
    seed({ parts: true });
    const before = S.scrollX;
    onWheel(wheel({ shiftKey: true, deltaX: 120 }));
    assert.notStrictEqual(S.scrollX, before);
    assert.deepStrictEqual(laneScrolls, []);
});

t('Shift+wheel pans the same direction in and out of the multi-track view', () => {
    seed({ parts: true });
    onWheel(wheel({ shiftKey: true, deltaY: 120 }));
    const inParts = S.scrollX;
    seed({ parts: false });
    onWheel(wheel({ shiftKey: true, deltaY: 120 }));
    assert.strictEqual(S.scrollX, inParts, 'parity: the same gesture, the same pan');
});

// ── What must NOT change ──────────────────────────────────────────────────
t('multi-track canvas: a plain vertical wheel still scrolls the lane stack', () => {
    seed({ parts: true });
    const before = S.scrollX;
    onWheel(wheel({ deltaY: 120 }));
    assert.deepStrictEqual(laneScrolls, [120], 'the lane scroll is the point of this view');
    assert.strictEqual(S.scrollX, before, 'and it must not pan the timeline too');
});

t('multi-track canvas: a horizontal swipe still pans (unchanged)', () => {
    seed({ parts: true });
    const before = S.scrollX;
    onWheel(wheel({ deltaX: 120, deltaY: 10 }));
    assert.notStrictEqual(S.scrollX, before);
    assert.deepStrictEqual(laneScrolls, []);
});

t('Ctrl+wheel still zooms in every view', () => {
    for (const parts of [true, false]) {
        seed({ parts });
        const z = S.zoom;
        onWheel(wheel({ ctrlKey: true, deltaY: -120 }));
        assert.ok(S.zoom > z, `ctrl+wheel must zoom in (partsViewMode=${parts})`);
        assert.deepStrictEqual(laneScrolls, []);
    }
});

t('Ctrl beats Shift when both are held', () => {
    seed({ parts: true });
    const z = S.zoom;
    onWheel(wheel({ ctrlKey: true, shiftKey: true, deltaY: -120 }));
    assert.ok(S.zoom > z, 'ctrl+shift+wheel zooms rather than panning');
    assert.deepStrictEqual(laneScrolls, []);
});

t('outside the multi-track view nothing changed at all', () => {
    seed({ parts: false });
    const before = S.scrollX;
    onWheel(wheel({ deltaY: 120 }));
    assert.notStrictEqual(S.scrollX, before, 'a plain wheel still pans outside parts view');
    assert.deepStrictEqual(laneScrolls, []);
});

console.log(`\n${pass} passed, ${fail} failed`);
