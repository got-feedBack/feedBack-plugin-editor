/*
 * The transport-LCD grid-health pill (Map Health follow-up): a glanceable
 * "how much of the grid agrees with the recording" percent, coloured by the
 * worst state present, with click-to-fix jumping to the worst drifting bar.
 *
 * Pinned here: the pill percent counts only JUDGEABLE bars (grey never dilutes
 * or inflates the score — the wash's no-crying-wolf rule), the colour is the
 * worst band present, an unjudgeable song yields NO verdict (dash, never a
 * fake 100%), and the worst-bar picker ranks any red over any amber with
 * drift as the tiebreak. Fails on main (the pures don't exist there).
 *
 * Run: node tests/map_health_pill.test.mjs
 */
import assert from 'node:assert';

globalThis.document = globalThis.document || {
    getElementById: () => null, addEventListener: () => {}, activeElement: null,
};
globalThis.localStorage = globalThis.localStorage || { getItem: () => null, setItem: () => {} };
globalThis.window = globalThis.window || globalThis;

const { _mapHealthPillPure, _mapHealthWorstPure } = await import('../src/map-health.js');

let pass = 0, fail = 0;
function t(name, fn) {
    try { fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}

const M = (band, driftFrac = 0, measure = 1) => ({ band, driftFrac, measure, startTime: measure * 2 });

t('the percent counts judgeable bars only — grey neither dilutes nor inflates', () => {
    // 8 green + 2 amber + 10 grey: 80% of the JUDGEABLE bars agree.
    const measures = [
        ...Array.from({ length: 8 }, () => M('green')),
        M('amber', 0.08), M('amber', 0.06),
        ...Array.from({ length: 10 }, () => M('grey')),
    ];
    const pill = _mapHealthPillPure({ measures });
    assert.strictEqual(pill.pct, 80);
    assert.strictEqual(pill.judged, 10);
});

t('the colour is the worst state present', () => {
    assert.strictEqual(_mapHealthPillPure({ measures: [M('green'), M('green')] }).band, 'green');
    assert.strictEqual(_mapHealthPillPure({ measures: [M('green'), M('amber')] }).band, 'amber');
    assert.strictEqual(_mapHealthPillPure({ measures: [M('green'), M('amber'), M('red', 0.2)] }).band, 'red');
});

t('nothing judgeable = no verdict, never a fake 100%', () => {
    assert.strictEqual(_mapHealthPillPure({ measures: [M('grey'), M('grey')] }), null);
    assert.strictEqual(_mapHealthPillPure({ measures: [] }), null);
    assert.strictEqual(_mapHealthPillPure(null), null);
});

t('the worst bar: any red beats any amber; within a band the biggest drift wins', () => {
    const measures = [
        M('green', 0, 1), M('amber', 0.11, 2), M('amber', 0.08, 3),
        M('red', 0.13, 4), M('red', 0.30, 5), M('grey', 0, 6),
    ];
    const worst = _mapHealthWorstPure({ measures });
    assert.strictEqual(worst.measure, 5, 'the reddest red');
    const amberOnly = _mapHealthWorstPure({ measures: measures.slice(0, 3) });
    assert.strictEqual(amberOnly.measure, 2, 'no red → the worst amber');
    assert.strictEqual(_mapHealthWorstPure({ measures: [M('green'), M('grey')] }), null,
        'nothing drifting → null (the click says so instead of jumping)');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
