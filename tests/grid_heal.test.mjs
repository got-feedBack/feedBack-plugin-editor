/*
 * Heal uneven beat spacing (the degenerate-bar repair). Motivated by a field
 * project whose grid carried interior sub-beats piled 5 ms apart next to a 2 s
 * hole inside single measures — hand re-syncs and old imports both leave this
 * shape, and it garbles the click, snapping, and every per-beat view.
 *
 * Pinned: the scan flags a measure when any interior gap falls under 30% or
 * over 300% of its even spacing; the heal re-spaces ONLY sick measures'
 * interiors evenly between their downbeats; downbeats never move; non-time
 * fields survive; equal-length, strictly-increasing output (the TempoGridCmd
 * contract — notes keep their seconds and re-lift from the healed grid).
 *
 * Every case fails on pre-fix main (the pures don't exist).
 * Run: node tests/grid_heal.test.mjs
 */
import assert from 'node:assert';

globalThis.document = globalThis.document || {
    getElementById: () => null, addEventListener: () => {}, activeElement: null,
};
globalThis.localStorage = globalThis.localStorage || { getItem: () => null, setItem: () => {} };
globalThis.window = globalThis.window || globalThis;

const { _gridHealScanPure, _gridHealPure } = await import('../src/tempo.js');

let pass = 0, fail = 0;
function t(name, fn) {
    try { fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}

const D = (time, measure) => ({ time, measure, den: 4 });
const I = (time) => ({ time, measure: -1 });

// The field shape: measure 49's interiors pile at 5 ms right before the next
// downbeat, leaving a 2 s hole after the downbeat (real numbers from the
// reporting project). Measures 48 and 50 are healthy 4/4 at ~117 BPM.
function fieldGrid() {
    return [
        D(96.0, 48), I(96.51), I(97.02), I(97.53),
        D(98.04, 49), I(98.364), I(98.369), I(98.374),   // pile-up: 5 ms gaps
        D(100.467, 50), I(100.98), I(101.49), I(102.0),
        D(102.51, 51),
    ];
}

t('the scan flags the pile-up measure and only it', () => {
    assert.deepStrictEqual(_gridHealScanPure(fieldGrid()), [49]);
});

t('a healthy grid scans clean and heals to null', () => {
    const g = [D(0, 1), I(0.5), I(1.0), I(1.5), D(2.0, 2), I(2.5), I(3.0), I(3.5), D(4.0, 3)];
    assert.deepStrictEqual(_gridHealScanPure(g), []);
    assert.strictEqual(_gridHealPure(g), null);
});

t('healing re-spaces ONLY the sick measure, evenly, downbeats untouched', () => {
    const g = fieldGrid();
    const healed = _gridHealPure(g);
    assert.strictEqual(healed.length, g.length, 'equal count — the command contract');
    // Downbeats exactly where they were.
    for (let i = 0; i < g.length; i++) {
        if (g[i].measure > 0) assert.strictEqual(healed[i].time, g[i].time, `downbeat m${g[i].measure} unmoved`);
    }
    // The sick measure's interiors now sit at even quarters of its span.
    const span = 100.467 - 98.04;
    assert.strictEqual(healed[5].time, Math.round((98.04 + span / 4) * 1000) / 1000);
    assert.strictEqual(healed[6].time, Math.round((98.04 + span / 2) * 1000) / 1000);
    assert.strictEqual(healed[7].time, Math.round((98.04 + (3 * span) / 4) * 1000) / 1000);
    // Healthy neighbours untouched.
    assert.strictEqual(healed[1].time, 96.51);
    assert.strictEqual(healed[9].time, 100.98);
    // Strictly increasing throughout.
    for (let i = 1; i < healed.length; i++) assert.ok(healed[i].time > healed[i - 1].time);
});

t('a lone oversized hole flags too, even with no tiny gap beside it', () => {
    // Interiors bunched early: gaps of 0.32 (above the 30% floor, so they do
    // not trip the minimum) then a 3.04 s hole — 3.04× the even 1.0 spacing,
    // over the 300% ceiling. The HOLE alone flags the measure.
    const g = [D(0, 1), I(0.32), I(0.64), I(0.96), D(4.0, 2), I(5.0), I(6.0), I(7.0), D(8.0, 3)];
    assert.deepStrictEqual(_gridHealScanPure(g), [1]);
});

t('non-time fields ride through the heal untouched', () => {
    const g = fieldGrid();
    g[5].locked = true;             // even a (nonsensical) interior flag survives
    const healed = _gridHealPure(g);
    assert.strictEqual(healed[5].locked, true);
    assert.strictEqual(healed[4].den, 4);
    assert.strictEqual(healed[4].measure, 49);
    assert.deepStrictEqual(g[5], { time: 98.364, measure: -1, locked: true }, 'input not mutated');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
