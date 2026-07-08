'use strict';
/*
 * Tests for the advisory drum limb-lint (DAW 4.7):
 * _drumLimbConflictsPure flags physically-impossible simultaneities —
 * 3+ hand pieces at one instant, or a contradictory hi-hat state — and
 * _drumConflictIndexSetPure flattens them to the conflicted hit indices the
 * renderer marks. Advisory only; the lint never mutates hits.
 *
 * All fail on main — the block doesn't exist there.
 *
 * Run: node tests/drum_limb_lint.test.js
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const src = fs.readFileSync(path.join(__dirname, '..', 'screen.js'), 'utf8');
function extractBlock(name) {
    const re = new RegExp('/\\* @pure:' + name + ':start \\*/[\\s\\S]*?/\\* @pure:' + name + ':end \\*/');
    const m = src.match(re);
    if (!m) { console.error(`FAIL: @pure:${name} not found`); process.exit(1); }
    return m[0];
}
let passed = 0, failed = 0;
function t(name, fn) {
    try { fn(); passed++; console.log('  ok ' + name); }
    catch (e) { failed++; console.error('  FAIL ' + name + '\n    ' + (e && e.message)); }
}

const L = new Function('"use strict";' + extractBlock('drum-limb-lint')
    + '\nreturn { _drumLimbConflictsPure, _drumConflictIndexSetPure, DRUM_LIMB_EPSILON };')();

// hits helper — time-sorted, as the editor keeps them.
const H = (t, p) => ({ t, p });

// ── The hand-count rule ──────────────────────────────────────────────

t('two hand pieces + a kick is playable (no conflict)', () => {
    // snare + closed hat (2 hands) + kick (foot) at one instant — a backbeat.
    const c = L._drumLimbConflictsPure([H(1, 'snare'), H(1, 'hh_closed'), H(1, 'kick')]);
    assert.deepStrictEqual(c, []);
});

t('three hand pieces at one instant → hands conflict', () => {
    const c = L._drumLimbConflictsPure([H(1, 'snare'), H(1, 'hh_closed'), H(1, 'crash_l')]);
    assert.strictEqual(c.length, 1);
    assert.deepStrictEqual(c[0].reasons, ['hands']);
    assert.deepStrictEqual(c[0].indices, [0, 1, 2]);
    assert.strictEqual(c[0].time, 1);
});

t('three hand pieces + two feet still conflicts on the hands (feet do not count)', () => {
    // crash + ride + snare (3 hands) + kick + hh_pedal (2 feet).
    const c = L._drumLimbConflictsPure([
        H(2, 'crash_l'), H(2, 'ride'), H(2, 'snare'), H(2, 'kick'), H(2, 'hh_pedal'),
    ]);
    assert.strictEqual(c.length, 1);
    assert.deepStrictEqual(c[0].reasons, ['hands']);
});

t('a duplicate hand piece counts once (2 snares = one hand piece, playable)', () => {
    const c = L._drumLimbConflictsPure([H(1, 'snare'), H(1, 'snare'), H(1, 'hh_closed')]);
    assert.deepStrictEqual(c, [], 'distinct hand pieces = {snare, hh_closed} = 2');
});

// ── The hi-hat rule ──────────────────────────────────────────────────

t('open + closed hat at one instant → hihat conflict', () => {
    const c = L._drumLimbConflictsPure([H(1, 'hh_open'), H(1, 'hh_closed')]);
    assert.strictEqual(c.length, 1);
    assert.deepStrictEqual(c[0].reasons, ['hihat']);
});

t('open hat + foot pedal at one instant → hihat conflict', () => {
    const c = L._drumLimbConflictsPure([H(1, 'hh_open'), H(1, 'hh_pedal')]);
    assert.deepStrictEqual(c[0].reasons, ['hihat']);
});

t('closed hat + foot pedal is fine (foot down, stick strikes) — no conflict', () => {
    const c = L._drumLimbConflictsPure([H(1, 'hh_closed'), H(1, 'hh_pedal')]);
    assert.deepStrictEqual(c, []);
});

t('both rules can fire on one cluster', () => {
    // open hat + closed hat + snare + crash: hihat contradiction AND 3 hands
    // (hh_open, hh_closed, snare, crash_l are all hand pieces → 4 > 2).
    const c = L._drumLimbConflictsPure([
        H(1, 'hh_open'), H(1, 'hh_closed'), H(1, 'snare'), H(1, 'crash_l')]);
    assert.strictEqual(c.length, 1);
    assert.deepStrictEqual(c[0].reasons.sort(), ['hands', 'hihat']);
});

// ── Clustering / epsilon ─────────────────────────────────────────────

t('a fast roll stays separate — hits > epsilon apart never cluster', () => {
    // three snare+crash+ride pairs 40 ms apart: each pair is 2 hands (fine),
    // and they must NOT merge into one 6-hit cluster.
    const c = L._drumLimbConflictsPure([
        H(0.00, 'snare'), H(0.00, 'crash_l'),
        H(0.04, 'snare'), H(0.04, 'ride'),
        H(0.08, 'snare'), H(0.08, 'crash_r'),
    ]);
    assert.deepStrictEqual(c, [], 'no cluster exceeds 2 hand pieces');
});

t('hits within epsilon (grid-rounding jitter) do cluster', () => {
    const eps = L.DRUM_LIMB_EPSILON;
    const c = L._drumLimbConflictsPure([
        H(1.000, 'snare'), H(1.000 + eps * 0.5, 'hh_closed'), H(1.000 + eps * 0.9, 'crash_l')]);
    assert.strictEqual(c.length, 1, 'the three near-simultaneous hits are one cluster');
    assert.deepStrictEqual(c[0].reasons, ['hands']);
});

t('cluster is bounded from its start — no runaway chaining', () => {
    const eps = L.DRUM_LIMB_EPSILON;
    // Four hits each 0.7*eps after the previous: 0, .7e, 1.4e, 2.1e. Bounded
    // from the start, the first cluster is {0, .7e} only (1.4e - 0 >= eps).
    const c = L._drumLimbConflictsPure([
        H(0, 'snare'), H(0.7 * eps, 'hh_closed'), H(1.4 * eps, 'crash_l'), H(2.1 * eps, 'ride')]);
    assert.deepStrictEqual(c, [], 'no cluster ever holds 3 hand pieces');
});

// ── Adversarial / robustness ─────────────────────────────────────────

t('non-array and malformed times never throw', () => {
    assert.deepStrictEqual(L._drumLimbConflictsPure(null), []);
    assert.deepStrictEqual(L._drumLimbConflictsPure(undefined), []);
    // NaN-time hit is skipped; the two valid simultaneous hand pieces are fine.
    const c = L._drumLimbConflictsPure([H(NaN, 'crash_l'), H(1, 'snare'), H(1, 'hh_closed')]);
    assert.deepStrictEqual(c, []);
});

t('a single hit is never a conflict', () => {
    assert.deepStrictEqual(L._drumLimbConflictsPure([H(1, 'crash_l')]), []);
});

t('the lint never mutates the input hits', () => {
    const hits = [H(1, 'snare'), H(1, 'hh_closed'), H(1, 'crash_l')];
    const snap = JSON.parse(JSON.stringify(hits));
    L._drumLimbConflictsPure(hits);
    assert.deepStrictEqual(hits, snap, 'advisory lint is read-only');
});

// ── The index-set flattener ──────────────────────────────────────────

t('_drumConflictIndexSetPure flattens every conflicted index, skips clean hits', () => {
    const hits = [
        H(0, 'snare'), H(0, 'hh_closed'),                 // clean pair (idx 0,1)
        H(1, 'snare'), H(1, 'hh_closed'), H(1, 'crash_l'), // conflict (idx 2,3,4)
    ];
    const set = L._drumConflictIndexSetPure(hits);
    assert.deepStrictEqual([...set].sort((a, b) => a - b), [2, 3, 4]);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
