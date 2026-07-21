/*
 * Region layout pures (PR 2: render a region as a block on a track lane).
 *
 * These drive the Parts-view region strip: the time span a region occupies
 * over its lane's content extent, the pixel rect clamped to the visible band,
 * and the click hit-test. The drawing itself (canvas) isn't unit-tested; these
 * pures are the part that must stay correct.
 *
 * Fails on main: src/region.js and these exports don't exist there.
 *
 * Run: node tests/region_layout.test.mjs
 */
import assert from 'node:assert';

const {
    _defaultRegionPure,
    _regionTimeSpanPure,
    _regionBlockRectPure,
    _regionHitPure,
} = await import('../src/region.js');

let pass = 0; let fail = 0;
const tests = [];
const t = (name, fn) => tests.push([name, fn]);

t('_regionTimeSpanPure: a full-span region spans its lane content extent', () => {
    assert.deepStrictEqual(_regionTimeSpanPure(_defaultRegionPure(), 2, 40), { t0: 2, t1: 40 });
    // null region is treated as full-span (the resolver never yields null, but
    // the pure must not throw on it).
    assert.deepStrictEqual(_regionTimeSpanPure(null, 0, 12), { t0: 0, t1: 12 });
    // a missing/!finite content end collapses to the start, never NaN.
    assert.deepStrictEqual(_regionTimeSpanPure(_defaultRegionPure(), 5, undefined), { t0: 5, t1: 5 });
});

t('_regionTimeSpanPure: a bounded region derives its span from beats (future move/trim)', () => {
    const beatToTime = (beat) => beat * 0.5;   // 120 BPM stub
    // startBeat only -> [b2t(start), contentEnd]
    assert.deepStrictEqual(_regionTimeSpanPure({ id: 'r', startBeat: 16 }, 0, 40, beatToTime), { t0: 8, t1: 40 });
    // startBeat + lenBeat -> a closed window
    assert.deepStrictEqual(_regionTimeSpanPure({ id: 'r', startBeat: 16, lenBeat: 8 }, 0, 40, beatToTime), { t0: 8, t1: 12 });
    // an inverted result never returns t1 < t0
    assert.deepStrictEqual(_regionTimeSpanPure({ id: 'r', startBeat: 100, lenBeat: 1 }, 0, 5, (b) => -b), { t0: -100, t1: -100 });
});

t('_regionBlockRectPure clamps the pixel span to the visible band', () => {
    assert.deepStrictEqual(_regionBlockRectPure(100, 300, 52, 800), { x: 100, w: 200, visible: true });
    assert.deepStrictEqual(_regionBlockRectPure(10, 300, 52, 800), { x: 52, w: 248, visible: true }, 'left clamps to the gutter');
    assert.deepStrictEqual(_regionBlockRectPure(100, 900, 52, 800), { x: 100, w: 700, visible: true }, 'right clamps to the width');
    assert.strictEqual(_regionBlockRectPure(900, 1000, 52, 800).visible, false, 'fully right of the fold → not visible');
    assert.strictEqual(_regionBlockRectPure(-100, -10, 52, 800).visible, false, 'fully left of the gutter → not visible');
    // hit-test mode passes Infinity width to leave the right edge unclamped.
    assert.deepStrictEqual(_regionBlockRectPure(100, 5000, 52, Infinity), { x: 100, w: 4900, visible: true });
});

t('_regionHitPure: x inside a visible block hits; outside / invisible / NaN miss', () => {
    const rect = { x: 100, w: 200, visible: true };
    assert.strictEqual(_regionHitPure(rect, 100), true, 'left edge inclusive');
    assert.strictEqual(_regionHitPure(rect, 300), true, 'right edge inclusive');
    assert.strictEqual(_regionHitPure(rect, 301), false);
    assert.strictEqual(_regionHitPure(rect, 99), false);
    assert.strictEqual(_regionHitPure({ x: 100, w: 200, visible: false }, 150), false, 'invisible rect never hits');
    assert.strictEqual(_regionHitPure(rect, NaN), false);
    assert.strictEqual(_regionHitPure(null, 150), false);
});

for (const [name, fn] of tests) {
    try { await fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
