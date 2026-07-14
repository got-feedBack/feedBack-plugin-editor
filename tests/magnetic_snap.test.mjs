/*
 * Magnetic drag snap — "magnetic, not locking" (the design call): while
 * dragging, a guideline attracts the grabbed edge inside a small SCREEN-SPACE
 * radius, and pulling past the magnet releases it so minor off-grid
 * adjustments need no modifier. The radius is in pixels → zoom-aware: zoomed
 * in, the magnet spans less time (finer control for free); zoomed out, the
 * lines sit closer than the magnet and dragging is effectively grid-stepped.
 *
 * Pinned here: stick-within/release-beyond, the zoom awareness in both
 * directions, snap-off identity, and the group-delta composition (a magnetic
 * stick yields a ZERO group delta — the selection doesn't creep; a release
 * follows the pointer exactly). Fails on main (magneticSnapTime is new).
 *
 * Run: node tests/magnetic_snap.test.mjs
 */
import assert from 'node:assert';

globalThis.document = globalThis.document || {
    getElementById: () => null, addEventListener: () => {}, activeElement: null,
};
globalThis.localStorage = globalThis.localStorage || { getItem: () => null, setItem: () => {} };
globalThis.window = globalThis.window || globalThis;

const { MAGNET_PX, _groupTimeDeltaPure, magneticSnapTime } = await import('../src/loop.js');
const { S } = await import('../src/state.js');

let pass = 0, fail = 0;
function t(name, fn) {
    try { fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}

// A steady 120 BPM 4/4 grid: beat guidelines every 0.5s (snap 1/1).
const beats = [];
for (let m = 0; m < 4; m++) for (let b = 0; b < 4; b++) {
    beats.push({ time: (m * 4 + b) * 0.5, measure: b === 0 ? m + 1 : 0 });
}
Object.assign(S, { beats, snapIdx: 0, snapMode: 'grid', swingPct: 50, snapEnabled: true });

t('the magnet radius is pinned at 8px — changing the feel is a deliberate act', () => {
    assert.strictEqual(MAGNET_PX, 8);
});

t('inside the magnet the edge sticks to the guideline', () => {
    S.zoom = 100;                                    // radius = 8/100 = 0.08s
    assert.strictEqual(magneticSnapTime(1.06), 1.0, '60ms off at 100px/s → sticks');
});

t('pulled past the magnet the edge releases and follows the pointer exactly', () => {
    S.zoom = 100;
    assert.strictEqual(magneticSnapTime(1.13), 1.13, '130ms off → free, NOT locked to 1.0');
});

t('zoom-aware: the same offset releases when zoomed in, sticks when zoomed out', () => {
    S.zoom = 400;                                    // radius 0.02s — fine control
    assert.strictEqual(magneticSnapTime(1.06), 1.06, 'zoomed in → the 60ms pull escapes');
    S.zoom = 20;                                     // px radius 0.4s — but the gap cap governs
    assert.strictEqual(magneticSnapTime(1.4), 1.5, 'zoomed out → 100ms off still sticks');
    S.zoom = 100;
});

t('a free band always survives between magnets, even when zoomed way out', () => {
    // At 20 px/s the raw pixel radius (0.4s) would cover the whole 0.5s gap —
    // every position would be inside a magnet and dragging would degrade to
    // locked stepping. The gap cap (35% of the local guideline gap = 0.175s)
    // keeps the middle ~30% of every gap free.
    S.zoom = 20;
    assert.strictEqual(magneticSnapTime(1.3), 1.3, 'mid-gap stays free — magnetic, not locking');
    S.zoom = 100;
});

t('snap off: the magnet vanishes entirely (identity, like snapTime)', () => {
    S.snapEnabled = false;
    assert.strictEqual(magneticSnapTime(1.06), 1.06);
    S.snapEnabled = true;
});

t('group delta composes: a magnetic stick means ZERO creep, a release follows the drag', () => {
    S.zoom = 100;
    // Grabbed note sits ON a guideline. A 50ms wiggle stays inside the magnet
    // → the whole selection holds still. A 130ms pull escapes → the selection
    // moves by exactly the pointer delta.
    assert.strictEqual(_groupTimeDeltaPure([1.0, 1.2], 1.0, 0.05, magneticSnapTime), 0);
    const released = _groupTimeDeltaPure([1.0, 1.2], 1.0, 0.13, magneticSnapTime);
    assert.ok(Math.abs(released - 0.13) < 1e-9, `follows the pointer exactly (got ${released})`);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
