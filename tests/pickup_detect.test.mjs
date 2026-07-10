/*
 * Tests for pickup/anacrusis + onset-based detect-tempo (D3).
 *
 * Pinned: the pickup promote is numbering-only (NO beat time moves — the
 * offset-vs-flex distinction stays clean by construction), the derived
 * bar-0 display shift, the pre-beat-0 extrapolation that makes a negative
 * offset already representable, and the onset detector's bpm/phase/
 * confidence behavior on clean, octave-folded, and diffuse fixtures.
 *
 * Run: node tests/pickup_detect.test.mjs
 */
import assert from 'node:assert';

globalThis.document = globalThis.document || {
    getElementById: () => null, addEventListener: () => {}, activeElement: null,
};
globalThis.localStorage = globalThis.localStorage || { getItem: () => null, setItem: () => {} };
globalThis.window = globalThis.window || globalThis;

const { _pickupBarShiftPure, _tempoSetPickupPure } = await import('../src/tempo.js');
const { _detectTempoFromOnsetsPure } = await import('../src/sync-tempo.js');
const { beatOf, timeOf } = await import('../src/beats.js');

let pass = 0, fail = 0;
function t(name, fn) {
    try { fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}

// A 4/4 grid at 120 BPM: downbeats every 4 beats, 0.5 s/beat.
function grid(bars = 4, perBar = 4) {
    const beats = [];
    for (let i = 0; i < bars * perBar; i++) {
        beats.push({ time: i * 0.5, measure: i % perBar === 0 ? i / perBar + 1 : -1, den: 4 });
    }
    return beats;
}

t('pickup promote: partial first bar, times NEVER move', () => {
    const before = grid();
    const after = _tempoSetPickupPure(before, 1);
    assert.ok(after, 'valid pickup applies');
    assert.deepStrictEqual(after.map((b) => b.time), before.map((b) => b.time),
        'numbering-only — every beat keeps its exact time');
    assert.ok(after[1].measure > 0, 'beat 1 promoted to a downbeat');
    assert.strictEqual(after[1].den, 4, 'the promoted downbeat carries the signature');
    // First bar is now 1 beat; the next full bar spans 4.
    const dbs = after.map((b, i) => b.measure > 0 ? i : -1).filter((i) => i >= 0);
    assert.strictEqual(dbs[1] - dbs[0], 1);
    assert.strictEqual(dbs[2] - dbs[1], 4);
});

t('pickup refusals: full-bar or bigger, junk counts, no grid', () => {
    assert.strictEqual(_tempoSetPickupPure(grid(), 4), null, 'a full bar is not a pickup');
    assert.strictEqual(_tempoSetPickupPure(grid(), 0), null);
    assert.strictEqual(_tempoSetPickupPure(grid(), -2), null);
    assert.strictEqual(_tempoSetPickupPure(grid(), NaN), null);
    assert.strictEqual(_tempoSetPickupPure([], 1), null);
});

t('display shift: pickup grid shifts by 1, regular grid by 0', () => {
    const withPickup = _tempoSetPickupPure(grid(), 2);
    // Renumber like the verb does: sequential from the first.
    let m = 0;
    for (const b of withPickup) if (b.measure > 0) b.measure = ++m;
    assert.strictEqual(_pickupBarShiftPure(withPickup), 1, 'partial first bar → bar-0 display');
    assert.strictEqual(_pickupBarShiftPure(grid()), 0);
    assert.strictEqual(_pickupBarShiftPure([]), 0);
    assert.strictEqual(_pickupBarShiftPure(grid(1)), 0, 'one bar — nothing to compare');
});

t('negative offset already representable: the converter extrapolates before beat 0', () => {
    const beats = grid();
    // A note half a beat BEFORE the grid (the anacrusis-into-audio case):
    // beatOf/timeOf stay exact inverses on the pre-grid tail.
    const t0 = -0.25;
    const beta = beatOf(beats, t0);
    assert.ok(beta < 0, 'pre-grid time lands at a negative beat coordinate');
    assert.ok(Math.abs(timeOf(beats, beta) - t0) < 1e-9, 'round-trips exactly');
});

t('detect: clean 120 BPM onsets → bpm, phase, high confidence', () => {
    const onsets = [];
    for (let i = 0; i < 32; i++) onsets.push({ t: 0.25 + i * 0.5, s: 0.9 });
    const r = _detectTempoFromOnsetsPure(onsets);
    assert.ok(r, 'detects');
    assert.ok(Math.abs(r.bpm - 120) < 1.5, `bpm ${r.bpm}`);
    assert.ok(r.confidence > 0.5, `confidence ${r.confidence}`);
    // Phase folds to ~0.25 s into the 0.5 s period.
    assert.ok(Math.abs(r.phase - 0.25) < 0.5 / 8, `phase ${r.phase}`);
});

t('detect: octave folding — 240 BPM onsets read as a 60–220 tempo', () => {
    const onsets = [];
    for (let i = 0; i < 48; i++) onsets.push({ t: i * 0.25, s: 0.8 });
    const r = _detectTempoFromOnsetsPure(onsets);
    assert.ok(r, 'detects');
    assert.ok(r.bpm >= 60 && r.bpm <= 220, `bpm ${r.bpm} folded into range`);
    assert.ok(Math.abs(r.bpm - 120) < 2 || Math.abs(r.bpm - 240 / 2) < 2, 'folds by octaves');
});

t('detect: too few / diffuse onsets degrade honestly', () => {
    assert.strictEqual(_detectTempoFromOnsetsPure([{ t: 1, s: 1 }, { t: 2, s: 1 }]), null, 'too few');
    assert.strictEqual(_detectTempoFromOnsetsPure(null), null);
    // Irregular (prime-ish gaps) onsets: low confidence, never a lie.
    const messy = [];
    let time = 0;
    for (let i = 0; i < 24; i++) { time += 0.31 + (i % 7) * 0.113; messy.push({ t: time, s: 0.5 }); }
    const r = _detectTempoFromOnsetsPure(messy);
    if (r) assert.ok(r.confidence < 0.5, `diffuse vote reads diffuse (${r.confidence})`);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
