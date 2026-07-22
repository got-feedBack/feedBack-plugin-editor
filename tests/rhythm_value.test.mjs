/*
 * Notated rhythm-value model — the pure tier (src/rhythm-value.js), the
 * foundation of the note-value model (NOTE-VALUE-MODEL-DESIGN §12 slice 1).
 *
 * Pinned: whole-note magnitude (base × dots × nested tuplet + grace = 0), the
 * beat conversion, best-fit (single value, dotted, explicit tuplet context,
 * proposed tuplet, greedy tie-decomposition, and the HONEST NULL past tolerance),
 * the tick interchange projection incl. the lossy flag, bar summing, and the
 * clone/equals/absent helpers that the command layer's absent-vs-present
 * discipline rides on.
 *
 * Run: node tests/rhythm_value.test.mjs
 */
import assert from 'node:assert';

const {
    RHYTHM_BASES, COMMON_TUPLETS,
    rhythmIsAbsent, cloneRhythm, rhythmEquals,
    tupletFactor, valueWholeFraction, valueToBeats,
    beatsToValue, valueToTicks, ticksToValue, barValueSum,
} = await import('../src/rhythm-value.js');

let pass = 0, fail = 0;
function t(name, fn) {
    try { fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}
const close = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${a} ≈ ${b}`);
const R = (base, dots = 0, tuplet = null, grace = null) => ({ base, dots, tuplet, grace });

// ── magnitude ───────────────────────────────────────────────────────

t('valueWholeFraction: plain, dotted, double-dotted', () => {
    close(valueWholeFraction(R(4)), 1 / 4);
    close(valueWholeFraction(R(8)), 1 / 8);
    close(valueWholeFraction(R(1)), 1);
    close(valueWholeFraction(R(4, 1)), 3 / 8);    // dotted quarter
    close(valueWholeFraction(R(4, 2)), 7 / 16);   // double-dotted quarter
});

t('valueWholeFraction: grace = 0, malformed = NaN', () => {
    close(valueWholeFraction(R(8, 0, null, 'acciaccatura')), 0);
    assert.ok(Number.isNaN(valueWholeFraction(R(0))));
    assert.ok(Number.isNaN(valueWholeFraction(null)));
});

t('tupletFactor: straight, triplet, nested, malformed', () => {
    close(tupletFactor(R(4)), 1);
    close(tupletFactor({ tuplet: [{ n: 3, m: 2 }] }), 2 / 3);
    close(tupletFactor({ tuplet: [{ n: 3, m: 2 }, { n: 3, m: 2 }] }), 4 / 9);
    assert.ok(Number.isNaN(tupletFactor({ tuplet: [{ n: 0, m: 2 }] })));
});

t('valueWholeFraction: tuplets (triplet-eighth, nested)', () => {
    close(valueWholeFraction(R(8, 0, [{ n: 3, m: 2 }])), 1 / 12);
    close(valueWholeFraction(R(16, 0, [{ n: 3, m: 2 }, { n: 3, m: 2 }])), 1 / 36);
});

t('valueToBeats: meter-relative (a beat = one denominator unit)', () => {
    close(valueToBeats(R(4), 4), 1);      // quarter in x/4 = 1 beat
    close(valueToBeats(R(8), 4), 0.5);
    close(valueToBeats(R(4), 8), 2);      // quarter in x/8 = 2 eighth-beats
    close(valueToBeats(R(8, 0, [{ n: 3, m: 2 }]), 4), 1 / 3);   // triplet-eighth
});

// ── best-fit ────────────────────────────────────────────────────────

t('beatsToValue: single straight/dotted values, no ties', () => {
    let r = beatsToValue(1, 4);
    assert.deepStrictEqual(r.rhythm, R(4)); assert.deepStrictEqual(r.ties, []);
    assert.deepStrictEqual(beatsToValue(0.5, 4).rhythm, R(8));
    assert.deepStrictEqual(beatsToValue(1.5, 4).rhythm, R(4, 1));    // dotted quarter
    assert.deepStrictEqual(beatsToValue(1.75, 4).rhythm, R(4, 2));   // double-dotted quarter
    assert.strictEqual(beatsToValue(1.5, 4).rhythm.dots, 1);         // prefers the dot over a tie
});

t('beatsToValue: greedy tie-decomposition for an un-single span', () => {
    // 1.25 beats @ x/4 = 5/16 whole = quarter TIED sixteenth.
    const r = beatsToValue(1.25, 4);
    assert.deepStrictEqual(r.rhythm, R(4));
    assert.deepStrictEqual(r.ties, [R(16)]);
    // the pieces sum back to the span
    close(valueToBeats(r.rhythm, 4) + r.ties.reduce((s, p) => s + valueToBeats(p, 4), 0), 1.25);
});

t('beatsToValue: explicit tuplet context fits base/dots inside it', () => {
    const r = beatsToValue(1 / 3, 4, { tuplet: [{ n: 3, m: 2, group: 7 }] });
    assert.strictEqual(r.rhythm.base, 8);
    assert.deepStrictEqual(r.rhythm.tuplet, [{ n: 3, m: 2, group: 7 }]);
});

t('beatsToValue: proposes a common tuplet only when asked', () => {
    const off = beatsToValue(1 / 3, 4);                          // no allowTuplets
    const on = beatsToValue(1 / 3, 4, { allowTuplets: true });
    assert.strictEqual(off, null);                              // a 1/12-whole span isn't a straight value
    assert.ok(on && on.rhythm.base === 8 && on.rhythm.tuplet[0].n === 3 && on.rhythm.tuplet[0].m === 2);
});

t('beatsToValue: HONEST NULL past tolerance and on bad input', () => {
    assert.strictEqual(beatsToValue(0.1, 4), null);   // not representable within tol
    assert.strictEqual(beatsToValue(0, 4), null);
    assert.strictEqual(beatsToValue(-1, 4), null);
    assert.strictEqual(beatsToValue(1, 0), null);
});

// ── interchange ─────────────────────────────────────────────────────

t('valueToTicks: exact for power-of-two & clean tuplets, lossy for septuplets', () => {
    assert.deepStrictEqual(valueToTicks(R(4)), { ticks: 960, lossy: false });
    assert.deepStrictEqual(valueToTicks(R(4, 1)), { ticks: 1440, lossy: false });     // dotted quarter
    assert.deepStrictEqual(valueToTicks(R(8, 0, [{ n: 3, m: 2 }])), { ticks: 320, lossy: false }); // triplet-8th
    const sept = valueToTicks(R(4, 0, [{ n: 7, m: 4 }]));   // 960/7 → not integer
    assert.strictEqual(sept.lossy, true);
});

t('ticksToValue: inverse for single values, null when it needs a tie', () => {
    assert.deepStrictEqual(ticksToValue(960), R(4));
    assert.deepStrictEqual(ticksToValue(1440), R(4, 1));
    const trip = ticksToValue(320);
    assert.ok(trip.base === 8 && trip.tuplet[0].n === 3);
    assert.strictEqual(ticksToValue(500), null);   // not a single clean value
    assert.strictEqual(ticksToValue(0), null);
});

// ── bar accounting ──────────────────────────────────────────────────

t('barValueSum: sums beats, flags completeness against capacity', () => {
    const full = barValueSum([R(4), R(4), R(4), R(4)], 4, 4);
    close(full.sumBeats, 4); assert.strictEqual(full.complete, true);
    const short = barValueSum([R(4), R(4), R(4)], 4, 4);
    close(short.sumBeats, 3); assert.strictEqual(short.complete, false);
    assert.strictEqual(barValueSum([R(4)], 4).complete, undefined);   // no capacity → no verdict
});

// ── helpers the command layer depends on ────────────────────────────

t('rhythmIsAbsent: null/undefined/no-note all count as absent', () => {
    assert.strictEqual(rhythmIsAbsent(null), true);
    assert.strictEqual(rhythmIsAbsent({}), true);
    assert.strictEqual(rhythmIsAbsent({ rhythm: null }), true);
    assert.strictEqual(rhythmIsAbsent({ rhythm: R(4) }), false);
});

t('cloneRhythm: deep, independent tuplet array; null passes through', () => {
    assert.strictEqual(cloneRhythm(null), null);
    const src = R(8, 1, [{ n: 3, m: 2, group: 5 }], null);
    const cp = cloneRhythm(src);
    assert.notStrictEqual(cp, src);
    assert.notStrictEqual(cp.tuplet, src.tuplet);
    assert.notStrictEqual(cp.tuplet[0], src.tuplet[0]);
    cp.tuplet[0].n = 99;
    assert.strictEqual(src.tuplet[0].n, 3);   // mutation did not leak back
});

t('rhythmEquals: base/dots/grace/tuplet sensitivity + null pair', () => {
    assert.strictEqual(rhythmEquals(null, null), true);
    assert.strictEqual(rhythmEquals(null, R(4)), false);
    assert.strictEqual(rhythmEquals(R(4), R(4)), true);
    assert.strictEqual(rhythmEquals(R(4), R(8)), false);
    assert.strictEqual(rhythmEquals(R(4), R(4, 1)), false);
    assert.strictEqual(rhythmEquals(R(4, 0, null, 'acciaccatura'), R(4)), false);
    assert.strictEqual(rhythmEquals(R(8, 0, [{ n: 3, m: 2 }]), R(8, 0, [{ n: 3, m: 2 }])), true);
    assert.strictEqual(rhythmEquals(R(8, 0, [{ n: 3, m: 2 }]), R(8, 0, [{ n: 5, m: 4 }])), false);
});

t('exports present', () => {
    assert.ok(Array.isArray(RHYTHM_BASES) && RHYTHM_BASES.includes(128));
    assert.ok(Array.isArray(COMMON_TUPLETS) && COMMON_TUPLETS[0].n === 3);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
