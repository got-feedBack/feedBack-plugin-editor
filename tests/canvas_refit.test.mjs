/*
 * The canvas has to re-fit whenever the chrome ABOVE it changes height — not
 * only when the window resizes.
 *
 * THE BUG: resizeCanvas() derives the canvas pixel size (and, through
 * setLaneMetrics(), every lane height) from #editor-canvas-wrap's client box.
 * It only ran on window resize. Entering Drum edit mode adds a toolbar row,
 * which shrinks the wrap WITHOUT resizing the window — so the canvas kept its
 * old size, overhung the status bar, and its bottom rows stopped being
 * clickable.
 *
 * Measured at a 1600x660 viewport, before the fix:
 *     fresh editor   wrap 456.6   canvas 457   bottom 635.4   ok
 *     song loaded    wrap 448.6   canvas 449   bottom 635.4   ok
 *     drum edit      wrap 418.6   canvas 449   bottom 665.4   PAST the 660px viewport
 *
 * After: drum edit reads wrap 418.6 / canvas 419 / bottom 635.4.
 *
 * main.js is the entry orchestrator and exports nothing, so the observer is
 * brace-extracted and driven with a fake ResizeObserver — the same sliced-env
 * convention as tests/boot_teardown.test.js.
 *
 * Run: node --test tests/canvas_refit.test.mjs
 */
import assert from 'node:assert';
import fs from 'node:fs';
import test from 'node:test';

const src = fs.readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');

function extractFn(name) {
    const start = src.indexOf('function ' + name);
    assert.ok(start >= 0, `function ${name} must exist in src/main.js`);
    const open = src.indexOf('{', start);
    let depth = 0;
    for (let i = open; i < src.length; i++) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}' && --depth === 0) return src.slice(start, i + 1);
    }
    throw new Error('unbalanced braces extracting ' + name);
}

// A wrap whose size we can change, plus a fake ResizeObserver that hands us
// the callback so a "layout changed" can be fired on demand.
function harness({ hasResizeObserver = true } = {}) {
    const calls = { resize: 0, observed: [], disconnects: 0 };
    const wrap = { clientWidth: 1206, clientHeight: 456 };
    let fire = null;
    const deps = {
        document: { getElementById: (id) => (id === 'editor-canvas-wrap' ? wrap : null) },
        ResizeObserver: hasResizeObserver
            ? function (cb) {
                fire = cb;
                return {
                    observe: (el) => calls.observed.push(el),
                    disconnect: () => { calls.disconnects++; },
                };
            }
            : undefined,
        resizeCanvas: () => { calls.resize++; },
        _canvasWrapObs: null,
    };
    const names = Object.keys(deps);
    const body = extractFn('_observeCanvasWrap');
    const fn = new Function(
        ...names,
        `"use strict";${body}\nreturn _observeCanvasWrap;`,
    )(...names.map((n) => deps[n]));
    return { fn, calls, wrap, fire: () => fire && fire() };
}

test('observing the wrap starts watching it', () => {
    const h = harness();
    h.fn();
    assert.strictEqual(h.calls.observed.length, 1, 'the wrap must be observed');
    assert.strictEqual(h.calls.observed[0], h.wrap);
});

test('a wrap that changed size re-fits the canvas — the bug', () => {
    // Drum edit mode: the wrap shrinks by 30px with no window resize.
    const h = harness();
    h.fn();
    h.wrap.clientHeight = 418;
    h.fire();
    assert.strictEqual(h.calls.resize, 1, 'a shrunken wrap must re-fit the canvas');
});

test('a fire with no actual size change does not re-fit', () => {
    // resizeCanvas writes canvas.style.height, and the canvas is a CHILD of
    // the observed wrap. Without this guard a stray notification could bounce
    // resize -> observe -> resize.
    const h = harness();
    h.fn();
    h.wrap.clientHeight = 418;
    h.fire();
    h.fire();
    h.fire();
    assert.strictEqual(h.calls.resize, 1, 'only a real size change may re-fit');
});

test('successive real changes each re-fit', () => {
    const h = harness();
    h.fn();
    for (const height of [418, 449, 500]) {
        h.wrap.clientHeight = height;
        h.fire();
    }
    assert.strictEqual(h.calls.resize, 3);
});

test('a width-only change still re-fits', () => {
    // The tracks-pane splitter and the inspector change width, not height.
    const h = harness();
    h.fn();
    h.wrap.clientWidth = 900;
    h.fire();
    assert.strictEqual(h.calls.resize, 1);
});

test('re-observing disconnects the previous observer', () => {
    // Re-injection calls init() again; without the disconnect these stack,
    // each holding a resizeCanvas closure over a replaced DOM.
    const h = harness();
    h.fn();
    h.fn();
    assert.ok(h.calls.disconnects >= 1, 'the previous observer must be disconnected');
});

test('a host without ResizeObserver degrades quietly', () => {
    // host.js's rule: modules degrade rather than crash when a browser API is
    // absent, which is also how these suites run under node.
    const h = harness({ hasResizeObserver: false });
    assert.doesNotThrow(() => h.fn());
    assert.strictEqual(h.calls.observed.length, 0);
});

test('a missing wrap degrades quietly', () => {
    const calls = { resize: 0 };
    const body = extractFn('_observeCanvasWrap');
    const fn = new Function(
        'document', 'ResizeObserver', 'resizeCanvas', '_canvasWrapObs',
        `"use strict";${body}\nreturn _observeCanvasWrap;`,
    )({ getElementById: () => null }, function () {}, () => { calls.resize++; }, null);
    assert.doesNotThrow(() => fn());
    assert.strictEqual(calls.resize, 0);
});

test('the observer is wired into init and torn down', () => {
    // The guard that names the bug: without the call site nothing observes,
    // and without the teardown the observers stack across re-injection.
    assert.ok(/_observeCanvasWrap\(\);/.test(src),
        'init() must call _observeCanvasWrap()');
    assert.ok(/_canvasWrapObs\.disconnect\(\);\s*_canvasWrapObs = null;/.test(src),
        'the teardown must disconnect the canvas-wrap observer');
});
