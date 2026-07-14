/*
 * Explicit resnap works with the Snap toggle OFF (tester report: "I miss a
 * way to snap the selected notes to the grid" — the command existed, but
 * snapTime honoured the live-placement toggle, so with Snap off the explicit
 * quantize verb silently moved nothing and read as a missing feature).
 *
 * Pinned: snapTime's new `force` arg bypasses the ON/OFF toggle while the
 * snap VALUE still applies; the default (no force) keeps honouring the
 * toggle bit-exactly, so every interactive caller is unchanged.
 *
 * The force cases fail on main (the arg is ignored there → identity).
 * Run: node tests/resnap_explicit.test.mjs
 */
import assert from 'node:assert';

globalThis.document = globalThis.document || {
    getElementById: () => null, addEventListener: () => {}, activeElement: null,
};
globalThis.localStorage = globalThis.localStorage || { getItem: () => null, setItem: () => {} };
globalThis.window = globalThis.window || globalThis;

const { snapGuidelineAfter, snapTime } = await import('../src/loop.js');
const { _resnapEdgesPure } = await import('../src/input.js');
const { S } = await import('../src/state.js');

let pass = 0, fail = 0;
function t(name, fn) {
    try { fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}

// A steady 120 BPM 4/4 grid: beats every 0.5s, downbeats every 2s.
const beats = [];
for (let m = 0; m < 4; m++) for (let b = 0; b < 4; b++) {
    beats.push({ time: (m * 4 + b) * 0.5, measure: b === 0 ? m + 1 : 0 });
}
Object.assign(S, { beats, snapIdx: 0, snapMode: 'grid', swingPct: 50 });

t('snap OFF: interactive snapTime stays an identity (toggle honoured, unchanged)', () => {
    S.snapEnabled = false;
    assert.strictEqual(snapTime(1.13), 1.13);
});

t('snap OFF + force: the explicit quantize still lands on the grid', () => {
    S.snapEnabled = false;
    assert.strictEqual(snapTime(1.13, true), 1.0, 'quantised to the nearest guideline');
    assert.strictEqual(snapTime(1.38, true), 1.5);
});

t('snap ON: force and no-force agree (force only widens, never changes)', () => {
    S.snapEnabled = true;
    assert.strictEqual(snapTime(1.13), snapTime(1.13, true));
    assert.strictEqual(snapTime(1.13), 1.0);
});

t('force in onset mode with no audio falls back to the grid, not identity', () => {
    S.snapEnabled = false;
    S.snapMode = 'onset';
    assert.strictEqual(snapTime(1.13, true), 1.0, 'no onsets under node → grid fallback');
    S.snapMode = 'grid';
});

// ── the guideline-after helper (the end-edge minimum) ────────────────

t('snapGuidelineAfter returns the first guideline strictly after t', () => {
    S.snapEnabled = false;
    assert.strictEqual(snapGuidelineAfter(1.0, true), 1.5, 'ON a line → the next one');
    assert.strictEqual(snapGuidelineAfter(1.13, true), 1.5, 'between lines → the next one');
    assert.strictEqual(snapGuidelineAfter(1.0), 1.0, 'unforced with snap off → identity, like snapTime');
});

// ── both edges (the Logic piano-roll model) ──────────────────────────

t('both edges land on guidelines: start quantises, the end edge follows', () => {
    // start 1.13 → 1.0; end 1.63 → 1.5 → sustain 0.5 (both edges on lines).
    const r = _resnapEdgesPure([1.13], [0.5], (x) => snapTime(x, true), (x) => snapGuidelineAfter(x, true));
    assert.strictEqual(r.newTimes[0], 1.0);
    assert.strictEqual(r.newSustains[0], 0.5);
});

t('a short sustained note never collapses — it keeps one subdivision', () => {
    // start 1.13 → 1.0; end 1.23 quantises to 1.0 = the start line → the
    // guard takes the NEXT guideline instead: end 1.5, sustain 0.5.
    const r = _resnapEdgesPure([1.13], [0.1], (x) => snapTime(x, true), (x) => snapGuidelineAfter(x, true));
    assert.strictEqual(r.newTimes[0], 1.0);
    assert.strictEqual(r.newSustains[0], 0.5, 'one subdivision, never zero');
});

t('a zero-sustain chip stays a chip — length is authored intent', () => {
    const r = _resnapEdgesPure([1.13], [0], (x) => snapTime(x, true), (x) => snapGuidelineAfter(x, true));
    assert.strictEqual(r.newTimes[0], 1.0);
    assert.strictEqual(r.newSustains[0], 0, 'never inflated by a quantize');
});

t('no usable grid: a sustained note keeps its length, never collapses to a chip', () => {
    // The hole the end-edge guard has to plug: in ONSET mode snapFn still snaps
    // even with no beat grid, so both edges of a short note can land on the same
    // onset — and afterFn (grid-based) has no guideline to offer, so it returns
    // the identity. A quantize must not silently eat the sustain.
    const bothToSameOnset = () => 1.0;      // snapFn: every edge → the one onset
    const noGuideline = (x) => x;           // afterFn: identity (no grid)
    const r = _resnapEdgesPure([1.13], [0.1], bothToSameOnset, noGuideline);
    assert.strictEqual(r.newTimes[0], 1.0);
    assert.strictEqual(r.newSustains[0], 0.1, 'original length kept, not zeroed');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
