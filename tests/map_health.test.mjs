/*
 * Map Health — per-bar drift review lens (P2-4). Scores how well the grid agrees
 * with the detected onsets, per measure, as a THREE-state metric. The whole
 * 2nd-pass thesis is "review an automatic map"; this is the review surface. The
 * metric is pure (beats {time,measure} + onsets [{t}]), so the non-negotiables
 * are pinned here — the same ones that fail on main (no metric exists):
 *   · beats aligned with onsets → ~0, GREEN.
 *   · beats offset 8% of a beat → ~0.08, AMBER (drift is a FRACTION of the beat,
 *     so it reads the same across tempo/meter — 8% at 120 == 8% at 240).
 *   · onsets removed → coverage 0, GREY — never red (unmeasurable ≠ wrong).
 *   · a two-hand bar whose one off onset is the expressive hand does NOT flag the
 *     timekeeper bar red (median over evidenced beats is robust to one outlier).
 *
 * Run: node --test tests/map_health.test.mjs
 */
import assert from 'node:assert';
import { _mapHealthPure, MAP_HEALTH_COLORS } from '../src/map-health.js';

let pass = 0, fail = 0;
function t(name, fn) {
    try { fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

// A beat grid: `bars` bars of `bpb` beats at `bpm`; downbeats flagged measure>0.
function grid(bpm = 120, bars = 2, bpb = 4) {
    const dt = 60 / bpm;
    const beats = [];
    let m = 1;
    for (let bar = 0; bar < bars; bar++)
        for (let b = 0; b < bpb; b++)
            beats.push({ time: (bar * bpb + b) * dt, measure: b === 0 ? m++ : 0 });
    return beats;
}
// Onsets at every beat, shifted by `frac` of the beat interval.
function onsetsAtBeats(beats, frac = 0) {
    const dt = beats.length > 1 ? beats[1].time - beats[0].time : 0.5;
    return beats.map(b => ({ t: b.time + frac * dt }));
}

t('aligned grid → ~0 drift, every measure GREEN', () => {
    const beats = grid(120, 2, 4);
    const h = _mapHealthPure(beats, onsetsAtBeats(beats, 0));
    assert.strictEqual(h.measures.length, 2);
    assert.ok(h.measures.every(m => m.band === 'green'), 'all green');
    assert.ok(h.measures.every(m => near(m.driftFrac, 0, 1e-9)), 'drift ~0');
    assert.ok(h.measures.every(m => near(m.coverage, 1, 1e-9)), 'full coverage');
    assert.strictEqual(h.overall.band, 'green');
});

t('beats offset 8% of a beat → ~0.08 AMBER (the signature fail-on-main case)', () => {
    const beats = grid(120, 2, 4);
    const h = _mapHealthPure(beats, onsetsAtBeats(beats, 0.08));
    assert.ok(h.measures.every(m => near(m.driftFrac, 0.08, 1e-6)), 'driftFrac ≈ 0.08');
    assert.ok(h.measures.every(m => m.band === 'amber'), 'amber, not green, not red');
    assert.strictEqual(h.overall.band, 'amber');
});

t('drift is a FRACTION of the beat — tempo/meter independent (8% reads the same at 240bpm)', () => {
    const slow = grid(120, 1, 4), fast = grid(240, 1, 4);
    const hs = _mapHealthPure(slow, onsetsAtBeats(slow, 0.08));
    const hf = _mapHealthPure(fast, onsetsAtBeats(fast, 0.08));
    assert.ok(near(hs.measures[0].driftFrac, hf.measures[0].driftFrac, 1e-6),
        'same fractional drift despite half the beat period');
    assert.strictEqual(hs.measures[0].band, hf.measures[0].band);
});

t('onsets removed → coverage 0, GREY — NEVER red (unmeasurable ≠ wrong)', () => {
    const beats = grid(120, 2, 4);
    const h = _mapHealthPure(beats, []);
    assert.ok(h.measures.every(m => m.coverage === 0), 'no coverage');
    assert.ok(h.measures.every(m => m.band === 'grey'), 'grey');
    assert.ok(h.measures.every(m => m.band !== 'red'), 'and definitely not red');
    assert.strictEqual(h.overall.band, 'grey');
});

t('a held/sustained bar (onsets only in bar 1) leaves bar 2 GREY, bar 1 GREEN', () => {
    const beats = grid(120, 2, 4);
    // onsets only under the first measure (beats 0..3); the second is "held".
    const on = onsetsAtBeats(beats.slice(0, 4), 0);
    const h = _mapHealthPure(beats, on);
    assert.strictEqual(h.measures[0].band, 'green', 'evidenced bar reads green');
    assert.strictEqual(h.measures[1].band, 'grey', 'held bar is neutral, not red');
});

t('median robustness: one expressive off-onset does NOT flag the timekeeper bar red', () => {
    const beats = grid(120, 1, 4);   // one bar, 4 beats at 0,0.5,1.0,1.5
    // three beats land on their onset; beat 3 has only an expressive note 30% late.
    const on = [{ t: 0 }, { t: 0.5 }, { t: 1.0 }, { t: 1.5 + 0.30 * 0.5 }];
    const h = _mapHealthPure(beats, on);
    assert.ok(h.measures[0].band === 'green', 'median of [0,0,0,0.3] is 0 → green, not red');
    assert.ok(h.measures[0].driftFrac <= 0.05, `driftFrac stays low (got ${h.measures[0].driftFrac})`);
});

t('a genuinely wrong bar (every beat >12% off present onsets) reads RED', () => {
    const beats = grid(120, 1, 4);
    const h = _mapHealthPure(beats, onsetsAtBeats(beats, 0.18));
    assert.strictEqual(h.measures[0].band, 'red', 'consistent 18% drift with corroborating onsets = error');
    assert.ok(h.measures[0].driftFrac > 0.12);
});

t('band thresholds: green <5%, amber 5–12%, red >12%', () => {
    const beats = grid(120, 1, 4);
    const band = (frac) => _mapHealthPure(beats, onsetsAtBeats(beats, frac)).measures[0].band;
    assert.strictEqual(band(0.03), 'green');
    assert.strictEqual(band(0.08), 'amber');
    assert.strictEqual(band(0.15), 'red');
});

t('degenerate input degrades to an empty grey result', () => {
    const empty = { measures: [], overall: { band: 'grey', driftFrac: null, coverage: 0, measures: 0 } };
    assert.deepStrictEqual(_mapHealthPure([], []), empty);
    assert.deepStrictEqual(_mapHealthPure(null, null), empty);
    assert.deepStrictEqual(_mapHealthPure([{ time: 0, measure: 1 }], []), empty, 'need ≥2 beats');
    // beats with no downbeat markers → nothing to measure
    assert.deepStrictEqual(_mapHealthPure([{ time: 0, measure: 0 }, { time: 1, measure: 0 }], []), empty);
});

t('the wash vocabulary exposes exactly the four bands', () => {
    assert.deepStrictEqual(Object.keys(MAP_HEALTH_COLORS).sort(), ['amber', 'green', 'grey', 'red']);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
