/*
 * Grouping-aware consumers (P2-6): the three places an authored meter
 * grouping (`7/8 as 2+2+3`) actually TEACHES the feel —
 *   1. the metronome accents the grouping-cell starts,
 *   2. the ruler spends its sparse sub-bar ticks on the accents,
 *   3. the suggest comb corroborates on the FELT pulse (a grouped-7 phase
 *      out-scores an even-7 phase).
 *
 * Also pinned: no grouping = bit-identical to the old behavior everywhere.
 *
 * Fails on main (the accent-map pures don't exist there).
 * Run: node tests/grouping_aware.test.mjs
 */
import assert from 'node:assert';

globalThis.document = globalThis.document || {
    getElementById: () => null, addEventListener: () => {}, activeElement: null,
};
globalThis.localStorage = globalThis.localStorage || { getItem: () => null, setItem: () => {} };
globalThis.window = globalThis.window || globalThis;

const { _groupingAccentMapPure, _groupingAccentsByMeasurePure } =
    await import('../src/tempo-marks.js');
const { _suggestCombPure } = await import('../src/tempo-suggest.js');
const { _rulerGroupTickPure } = await import('../src/ruler.js');

let pass = 0, fail = 0;
function t(name, fn) {
    try { fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}

t('accent map: 2+2+3 → [1,0,1,0,1,0,0]; ungrouped → downbeat only', () => {
    assert.deepStrictEqual(_groupingAccentMapPure([2, 2, 3], 7), [1, 0, 1, 0, 1, 0, 0]);
    assert.deepStrictEqual(_groupingAccentMapPure([3, 2, 2], 7), [1, 0, 0, 1, 0, 1, 0]);
    assert.deepStrictEqual(_groupingAccentMapPure(null, 4), [1, 0, 0, 0]);
    assert.deepStrictEqual(_groupingAccentMapPure([2, 2], 7), [1, 0, 0, 0, 0, 0, 0],
        'a grouping that does not sum to the bar degrades to downbeat-only');
});

t('the by-measure lookup covers only grouped meter marks', () => {
    const map = _groupingAccentsByMeasurePure([
        { measure: 3, kind: 'meter', num: 7, den: 8, grouping: [2, 2, 3] },
        { measure: 5, kind: 'meter', num: 4, den: 4 },          // no grouping
        { measure: 9, kind: 'hold', factor: 2 },
    ]);
    assert.deepStrictEqual([...map.keys()], [3]);
    assert.deepStrictEqual(map.get(3), [1, 0, 1, 0, 1, 0, 0]);
});

t('metronome: grouping-cell starts get the accent; ungrouped bars unchanged', async () => {
    const { S } = await import('../src/state.js');
    // Reach the pure through the real caller path: the sliced-source pure
    // lives in audio.js's guide-clap fence — import audio.js and drive the
    // exported test seam if present, else slice by hand.
    const fs = await import('node:fs');
    const src = fs.readFileSync(new URL('../src/audio.js', import.meta.url), 'utf8')
        .replace(/\r\n/g, '\n');
    const at = src.indexOf('function _metroClicksInWindowPure');
    const body = src.slice(at, src.indexOf('\n}', at) + 2);
    const fn = new Function(`return (${body.replace('function _metroClicksInWindowPure', 'function')})`)();
    // A 7-beat bar (measure 2 at t=1.0, sub-beats each 0.1 s apart).
    const beats = [{ time: 0.9, measure: 1 }];
    for (let b = 0; b < 7; b++) beats.push({ time: 1.0 + 0.1 * b, measure: b === 0 ? 2 : -1 });
    const acc = new Map([[2, [1, 0, 1, 0, 1, 0, 0]]]);
    const clicks = fn(beats, 1.0, 1.7, acc);
    assert.deepStrictEqual(clicks.map(c => c.accent),
        [true, false, true, false, true, false, false], 'strong at 1, 3, 5');
    const plain = fn(beats, 1.0, 1.7, null);
    assert.deepStrictEqual(plain.map(c => c.accent),
        [true, false, false, false, false, false, false], 'no map = downbeat only');
    // Window starting mid-bar still knows its in-bar position (back-scan).
    const midWin = fn(beats, 1.15, 1.7, acc);
    assert.deepStrictEqual(midWin.map(c => c.accent), [true, false, true, false, false],
        'positions 2..6 of the grouped bar, accents at 2 and 4');
    assert.ok(S, 'state imports clean');
});

t('comb: onsets on the FELT pulse — the grouped phase out-scores even scoring', () => {
    // One 7-beat bar from t=0 to t=7; onsets ONLY at the 2+2+3 accents
    // (t=2, t=4 interior + t=7 the closing downbeat), strength 1.
    const onsets = [{ t: 2, s: 1 }, { t: 4, s: 1 }, { t: 7, s: 1 }];
    const even = _suggestCombPure(onsets, 0, 7, 7, 0.05);
    const grouped = _suggestCombPure(onsets, 0, 7, 7, 0.05, [1, 0, 1, 0, 1, 0, 0]);
    assert.ok(grouped > even, `grouped ${grouped} must beat even ${even}`);
    // And a WRONG grouping (3+2+2: accents at 3, 5) scores lower than the
    // right one — the comb genuinely prefers the phase that matches the feel.
    const wrong = _suggestCombPure(onsets, 0, 7, 7, 0.05, [1, 0, 0, 1, 0, 1, 0]);
    assert.ok(grouped > wrong, `right grouping ${grouped} must beat wrong ${wrong}`);
    // No accent map = the exact old mean (backwards compatibility).
    assert.ok(Math.abs(even - 3 / 7) < 1e-9, 'uniform mean of 3 hits over 7 slots');
});

t('ruler: sparse-zoom ticks land on interior accents only, gated by bar width', () => {
    const map = [1, 0, 1, 0, 1, 0, 0];
    assert.strictEqual(_rulerGroupTickPure(2, map, 4, 40), true, 'interior accent at sparse zoom');
    assert.strictEqual(_rulerGroupTickPure(1, map, 4, 40), false, 'non-accent position');
    assert.strictEqual(_rulerGroupTickPure(0, map, 4, 40), false, 'the barline itself is not a group tick');
    assert.strictEqual(_rulerGroupTickPure(2, map, 8, 40), false, 'full tick density → normal ticks');
    assert.strictEqual(_rulerGroupTickPure(2, map, 4, 20), false, 'bar too narrow to spend ticks');
    assert.strictEqual(_rulerGroupTickPure(2, null, 4, 40), false, 'ungrouped bar');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
