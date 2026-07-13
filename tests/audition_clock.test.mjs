/*
 * Audition speed (P2-9) — the transport clock's rate factor and its inverse.
 *
 * Pitch-preserving slow practice needs the chart clock to advance at `rate`
 * against the wall clock, and the guide/metronome scheduler to use the exact
 * inverse so events still land where they should in the slowed signal. Both
 * default to rate 1 (bit-identical to pre-audition). These pin:
 *   1. _transportChartTimePure with the rate factor (fails on main: 4th arg
 *      ignored → returns the rate-1 value).
 *   2. rate 1 is unchanged (the default path).
 *   3. the scheduler↔clock inverse round-trips at rate 0.5 (identity).
 *   4. output-latency compensation is a chart-time offset of latency·rate (the
 *      paint-only marker shift), expressed through the same pure clock.
 *
 * Run: node --test tests/audition_clock.test.mjs
 */
import assert from 'node:assert';

globalThis.document = globalThis.document || { getElementById: () => null, addEventListener: () => {}, activeElement: null };
globalThis.localStorage = globalThis.localStorage || { getItem: () => null, setItem: () => {} };
globalThis.window = globalThis.window || globalThis;

const { _transportChartTimePure } = await import('../src/transport.js');
const { _guideChartToCtxPure } = await import('../src/audio.js');

let pass = 0, fail = 0;
function t(name, fn) {
    try { fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}
const near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

// ── 1. the rate factor (fails on main) ───────────────────────────────────────
t('chart time advances at `rate` against the wall clock', () => {
    // 1s of wall time (100→101) at 0.5× = 0.5s of chart time. On main the 4th
    // arg is ignored and this returns 1.0.
    assert.ok(near(_transportChartTimePure(0, 100, 101, 0.5), 0.5));
    assert.ok(near(_transportChartTimePure(0, 100, 101, 0.75), 0.75));
    assert.ok(near(_transportChartTimePure(2, 100, 104, 0.5), 4), 'start offset + 4s wall × 0.5 = 2+2');
});

// ── 2. rate 1 default is unchanged ───────────────────────────────────────────
t('rate defaults to 1 and is bit-identical to the pre-audition formula', () => {
    assert.ok(near(_transportChartTimePure(0, 100, 101), 1), 'no 4th arg → rate 1');
    assert.ok(near(_transportChartTimePure(0, 100, 101, 1), 1));
    // a non-positive / non-finite rate is treated as 1 (never runs backward / to 0)
    assert.ok(near(_transportChartTimePure(0, 100, 101, 0), 1));
    assert.ok(near(_transportChartTimePure(0, 100, 101, -0.5), 1));
    assert.ok(near(_transportChartTimePure(0, 100, 101, NaN), 1));
});

// ── 3. scheduler ↔ clock inverse round-trips ─────────────────────────────────
t('_guideChartToCtxPure is the exact inverse of _transportChartTimePure at any rate', () => {
    for (const rate of [1, 0.75, 0.5]) {
        const start = 3, wall = 50;
        for (const ctxNow of [50, 52.3, 61]) {
            const chart = _transportChartTimePure(start, wall, ctxNow, rate);
            const backToCtx = _guideChartToCtxPure(chart, wall, start, rate);
            assert.ok(near(backToCtx, ctxNow), `round-trip @${rate} ctx=${ctxNow} → ${backToCtx}`);
        }
    }
});

t('a chart event maps to a LATER wall time when slowed (guide stays aligned)', () => {
    // At 0.5×, a chart event 1s ahead of the anchor sounds 2s of wall time later.
    assert.ok(near(_guideChartToCtxPure(1, 100, 0, 0.5), 102));
    assert.ok(near(_guideChartToCtxPure(1, 100, 0, 1), 101), 'rate 1 unchanged');
});

// ── 4. output-latency compensation is a paint-only chart-time offset ──────────
t('subtracting output latency from ctxNow shifts the drawn marker by latency·rate', () => {
    const lat = 0.02;   // 20ms output latency
    for (const rate of [1, 0.5]) {
        const raw = _transportChartTimePure(0, 100, 101, rate);
        const comp = _transportChartTimePure(0, 100, 101 - lat, rate);
        assert.ok(near(raw - comp, lat * rate),
            `marker sits ${lat * rate}s earlier in chart time @${rate}× (matches what's heard)`);
    }
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
