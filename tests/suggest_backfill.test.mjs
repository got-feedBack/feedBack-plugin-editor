/*
 * c5 retroactive confidence BACKFILL (the #231 scope-note follow-up): a bar
 * the suggest march crossed on bare prediction (a sustained bar — onsets
 * present, none on the downbeat) gets the floor confidence — but when a LATER
 * corroborated hit lands, the marched path is validated, so the misses
 * between two corroborations are raised to a still-discounted share (75%) of
 * the WEAKER flank. Trailing misses that never re-corroborate keep the floor
 * and are still dropped by the trailing-miss rule, and a locked pin
 * corroborates at full trust.
 *
 * Fails on main (mid-run misses keep conf === missConf there).
 * Run: node tests/suggest_backfill.test.mjs
 */
import assert from 'node:assert';

globalThis.document = globalThis.document || {
    getElementById: () => null, addEventListener: () => {}, activeElement: null,
};
globalThis.localStorage = globalThis.localStorage || { getItem: () => null, setItem: () => {} };
globalThis.window = globalThis.window || globalThis;

const { _suggestFitPure } = await import('../src/tempo-suggest.js');

let pass = 0, fail = 0;
function t(name, fn) {
    try { fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}

// A 4/4 grid at 120 (0.5s beats, 2s bars).
function grid(bars) {
    const beats = [];
    for (let m = 0; m < bars; m++) for (let b = 0; b < 4; b++) {
        beats.push({ time: (m * 4 + b) * 0.5, measure: b === 0 ? m + 1 : 0 });
    }
    return beats;
}
// Downbeats of bars [from, to) played dead on the grid (bare-downbeat
// corroboration: unambiguous phase — an all-beats stream at a steady tempo
// makes every bar phase equally comb-corroborated, which is a real engine
// property, not the thing under test here).
function played(from, to) {
    const out = [];
    for (let m = from; m < to; m++) out.push({ t: m * 2, s: 0.9 });
    return out;
}

t('a marched bar between two corroborated hits is backfilled above the floor', () => {
    // Bars 1-2 played, bar 3 sustained (noise off the downbeat only), bars 4-5 played.
    const beats = grid(6);
    const onsets = [
        ...played(0, 2),
        { t: 3.1, s: 0.5 },                          // bar 3: sustain noise, off the window
        ...played(3, 5),
    ];
    const r = _suggestFitPure(beats, onsets, 0, {});
    const byBar = Object.fromEntries(r.proposals.map(p => {
        const bar = Math.round(p.time / 2) + 1;
        return [bar, p];
    }));
    assert.ok(byBar[3], 'the sustained bar 3 was marched');
    assert.ok(byBar[3].conf > 0.12 + 1e-9,
        `backfilled above the miss floor (got ${byBar[3].conf})`);
    assert.ok(byBar[3].conf <= byBar[2].conf + 1e-9,
        'a backfilled bar never outranks the real corroborated hit before it');
});

t('trailing misses that never re-corroborate keep the floor and still drop', () => {
    // Bars 1-3 played, bars 4-5 sustained noise, nothing after → the march
    // ends on misses, which the trailing rule drops exactly as before.
    const beats = grid(6);
    const onsets = [
        ...played(0, 3),
        { t: 5.1, s: 0.5 }, { t: 7.2, s: 0.5 },     // bars 4-5 sustained, then nothing
    ];
    const r = _suggestFitPure(beats, onsets, 0, {});
    assert.ok(r.proposals.length >= 1);
    const last = r.proposals[r.proposals.length - 1];
    assert.ok(last.conf > 0.12, 'the surviving tail is a corroborated hit, not a floor miss');
    assert.strictEqual(r.stopReason, 'lost');
});

t('a locked pin corroborates the marched bars behind it at full trust', () => {
    const beats = grid(6);
    beats[16].locked = true;   // bar 5 downbeat pinned by a human
    const onsets = [
        ...played(0, 2),
        { t: 3.1, s: 0.5 },                          // bar 3 sustained
        { t: 5.1, s: 0.5 },                          // bar 4 sustained
    ];
    const r = _suggestFitPure(beats, onsets, 0, {});
    const locked = r.proposals.find(p => p.locked);
    assert.ok(locked, 'the pin is in the run');
    const marched = r.proposals.filter(p => !p.locked && p.time >= 4 && p.time < 8);
    assert.ok(marched.length >= 2, 'both sustained bars were marched');
    for (const p of marched) {
        assert.ok(p.conf > 0.12 + 1e-9, `pin-backfilled above the floor (got ${p.conf})`);
    }
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
