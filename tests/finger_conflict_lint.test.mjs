/*
 * Finger-conflict playability rule (gap-audit #10). Once auto-fingering (#237)
 * and the chord-grip resolve (#245) assign fret-hand fingers, a grip can still
 * ask ONE finger to hold two different frets at once — physically impossible.
 * This rule NAMES that (advisory, like the rest of the lint): within a
 * simultaneous cluster, the same fret_finger (1–4) on two DIFFERENT frets is a
 * conflict; the same finger on the SAME fret across strings is a BARRE, allowed.
 *
 * Run: node --test tests/finger_conflict_lint.test.mjs
 */
import assert from 'node:assert';

globalThis.document = globalThis.document || { getElementById: () => null, addEventListener: () => {}, activeElement: null };
globalThis.localStorage = globalThis.localStorage || { getItem: () => null, setItem: () => {} };
globalThis.window = globalThis.window || globalThis;

const { _lintFingerConflictPure, _playabilityLintPure } = await import('../src/playability-lint.js');

// note at (time, string, fret) with an assigned fret-hand finger.
const N = (time, string, fret, finger) => ({ time, string, fret, sustain: 0, techniques: { fret_finger: finger } });

let pass = 0, fail = 0;
function t(name, fn) {
    try { fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}

t('same finger, different frets, same instant → conflict', () => {
    const nn = [N(1, 2, 3, 1), N(1, 3, 6, 1)];   // finger 1 at frets 3 AND 6
    const iss = _lintFingerConflictPure(nn);
    assert.strictEqual(iss.length, 1);
    assert.strictEqual(iss[0].rule, 'finger-conflict');
    assert.deepStrictEqual(iss[0].indices.sort(), [0, 1]);
    assert.match(iss[0].detail, /finger 1 on frets 3 & 6/);
});

t('same finger, SAME fret across strings → a barre, no flag', () => {
    const nn = [N(1, 1, 5, 1), N(1, 2, 5, 1), N(1, 3, 5, 1)];   // barre at fret 5
    assert.deepStrictEqual(_lintFingerConflictPure(nn), []);
});

t('different fingers on different frets → no conflict', () => {
    const nn = [N(1, 2, 3, 1), N(1, 3, 5, 3)];   // finger 1 @3, finger 3 @5
    assert.deepStrictEqual(_lintFingerConflictPure(nn), []);
});

t('same finger, different frets but NOT simultaneous → no conflict', () => {
    const nn = [N(1, 2, 3, 1), N(2, 3, 6, 1)];   // a full second apart
    assert.deepStrictEqual(_lintFingerConflictPure(nn), []);
});

t('open strings and the unset sentinel carry no finger → ignored', () => {
    const nn = [N(1, 2, 0, -1), N(1, 3, 6, -1), N(1, 4, 8, 0)];   // -1 unset, 0 not a finger
    assert.deepStrictEqual(_lintFingerConflictPure(nn), []);
    // fret 0 (open) with a bogus finger value is still not a fretting conflict
    assert.deepStrictEqual(_lintFingerConflictPure([N(1, 2, 0, 1), N(1, 3, 5, 1)]), [],
        'the open note has no fretting finger, so finger 1 is used only once');
});

t('fingers outside 1–4 are ignored (thumb/garbage never conflict here)', () => {
    const nn = [N(1, 2, 3, 5), N(1, 3, 6, 5)];   // "finger 5" — not a real fret-hand finger
    assert.deepStrictEqual(_lintFingerConflictPure(nn), []);
});

t('barre plus a stray: same finger on {3,3,5} flags the whole finger group', () => {
    const nn = [N(1, 1, 3, 1), N(1, 2, 3, 1), N(1, 3, 5, 1)];   // barre @3 + one @5 = conflict
    const iss = _lintFingerConflictPure(nn);
    assert.strictEqual(iss.length, 1);
    assert.deepStrictEqual(iss[0].indices.sort(), [0, 1, 2]);
    assert.match(iss[0].detail, /frets 3 & 5/);
});

t('two independent finger conflicts in one cluster are both named', () => {
    const nn = [N(1, 0, 3, 1), N(1, 1, 6, 1), N(1, 2, 4, 2), N(1, 3, 8, 2)];
    const iss = _lintFingerConflictPure(nn);
    assert.strictEqual(iss.length, 2, 'finger 1 and finger 2 each conflict');
    assert.deepStrictEqual(iss.map(x => x.detail.match(/finger (\d)/)[1]).sort(), ['1', '2']);
});

t('the full pass includes finger-conflict issues, time-sorted', () => {
    const nn = [N(2, 2, 3, 1), N(2, 3, 6, 1)];
    const all = _playabilityLintPure(nn, []);
    assert.ok(all.some(i => i.rule === 'finger-conflict'), 'aggregated into the pass');
});

t('empty / junk input degrades to no issues', () => {
    assert.deepStrictEqual(_lintFingerConflictPure([]), []);
    assert.deepStrictEqual(_lintFingerConflictPure(null), []);
    assert.deepStrictEqual(_lintFingerConflictPure([{ time: NaN, fret: 3, techniques: { fret_finger: 1 } }]), []);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
