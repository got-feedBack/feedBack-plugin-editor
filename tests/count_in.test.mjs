/*
 * Tests for the count-in plan (src/transport.js) — the charrette's Count,
 * deferred out of B2 because the feature didn't exist.
 *
 * Pinned: the plan derives meter and tempo from the grid AT THE CURSOR
 * (drifting grids and mid-song meter changes included), accents land on
 * downbeats only, the no-grid fallback counts a sane 4/4 bar, and junk bar
 * counts refuse.
 *
 * Run: node tests/count_in.test.mjs
 */
import assert from 'node:assert';

globalThis.document = globalThis.document || {
    getElementById: () => null, addEventListener: () => {}, activeElement: null,
};
globalThis.localStorage = globalThis.localStorage || { getItem: () => null, setItem: () => {} };
globalThis.window = globalThis.window || globalThis;

const { _countInPlanPure } = await import('../src/transport.js');

let pass = 0, fail = 0;
function t(name, fn) {
    try { fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}

// 4/4 at 120 BPM for two bars, then 3/4 at 100 BPM (0.6 s beats).
function grid() {
    const beats = [];
    let time = 0;
    for (let i = 0; i < 8; i++) { beats.push({ time, measure: i % 4 === 0 ? i / 4 + 1 : -1, den: 4 }); time += 0.5; }
    for (let i = 0; i < 6; i++) { beats.push({ time, measure: i % 3 === 0 ? 3 + i / 3 : -1, den: 4 }); time += 0.6; }
    return beats;
}

t('one 4/4 bar at 120: 2 s, four clicks, one accent', () => {
    const plan = _countInPlanPure(grid(), 0, 1);
    assert.ok(Math.abs(plan.duration - 2.0) < 1e-9);
    assert.strictEqual(plan.clicks.length, 4);
    assert.deepStrictEqual(plan.clicks.map((c) => c.at), [0, 0.5, 1.0, 1.5]);
    assert.deepStrictEqual(plan.clicks.map((c) => c.accent), [true, false, false, false]);
});

t('two bars: eight clicks, accents on both downbeats', () => {
    const plan = _countInPlanPure(grid(), 0, 2);
    assert.strictEqual(plan.clicks.length, 8);
    assert.strictEqual(plan.clicks.filter((c) => c.accent).length, 2);
    assert.ok(Math.abs(plan.duration - 4.0) < 1e-9);
});

t('cursor in the 3/4 section counts 3 beats at the LOCAL tempo', () => {
    // The 3/4 / 100 BPM region starts at 4.0 s.
    const plan = _countInPlanPure(grid(), 5.0, 1);
    assert.strictEqual(plan.clicks.length, 3, 'three beats per bar there');
    assert.ok(Math.abs(plan.duration - 1.8) < 1e-9, `0.6 s beats (got ${plan.duration})`);
});

t('no grid: falls back to a 4/4 bar at 120 so play never fails', () => {
    const plan = _countInPlanPure([], 0, 1);
    assert.strictEqual(plan.clicks.length, 4);
    assert.ok(Math.abs(plan.duration - 2.0) < 1e-9);
    assert.ok(_countInPlanPure(null, 0, 2).clicks.length === 8);
});

t('junk bar counts refuse', () => {
    assert.strictEqual(_countInPlanPure(grid(), 0, 0), null);
    assert.strictEqual(_countInPlanPure(grid(), 0, -1), null);
    assert.strictEqual(_countInPlanPure(grid(), 0, NaN), null);
    assert.strictEqual(_countInPlanPure(grid(), 0, 'x'), null);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
