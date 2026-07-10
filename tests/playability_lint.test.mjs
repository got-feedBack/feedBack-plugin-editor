/*
 * Tests for the fretted playability lint (src/playability-lint.js, P9/VA.8).
 *
 * One test per rule (each would fail on main — the module is new, and each
 * pins a concrete flag/no-flag boundary), plus the no-anchors and empty-part
 * degradations and the dual anchor-list precedence. The lint is advisory:
 * these tests assert what gets NAMED, never any mutation.
 *
 * Run: node tests/playability_lint.test.mjs
 */
import assert from 'node:assert';

globalThis.document = globalThis.document || {
    getElementById: () => null, addEventListener: () => {}, activeElement: null,
};
globalThis.localStorage = globalThis.localStorage || { getItem: () => null, setItem: () => {} };
globalThis.window = globalThis.window || globalThis;

const {
    LINT_DEFAULT_WINDOW, LINT_STRETCH_TOLERANCE,
    _lintAnchorsPure, _lintLegatoJumpPure, _lintOpenPure, _lintOverlapPure,
    _lintStretchPure, _playabilityLintPure,
} = await import('../src/playability-lint.js');

let pass = 0, fail = 0;
function t(name, fn) {
    try { fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}

const N = (time, string, fret, sustain = 0, techniques = null) =>
    ({ time, string, fret, sustain, techniques });

t('stretch: flags a chord wider than the window, spares one inside it', () => {
    // No anchors → default window 4 (+1 tolerance) → span 6 flags, span 5 passes.
    const wide = [N(1, 0, 3), N(1, 1, 9)];
    const ok = [N(1, 0, 3), N(1, 1, 8)];
    assert.strictEqual(_lintStretchPure(wide, []).length, 1);
    assert.deepStrictEqual(_lintStretchPure(wide, [])[0].indices.sort(), [0, 1]);
    assert.strictEqual(_lintStretchPure(ok, []).length, 0);
    // An authored anchor width participates: width 6 → span 6 now passes.
    assert.strictEqual(_lintStretchPure(wide, [{ time: 0, fret: 3, width: 6 }]).length, 0);
});

t('stretch: open strings never count toward the span', () => {
    // Open + fret 9 is an open-position idiom, not a stretch.
    assert.strictEqual(_lintStretchPure([N(1, 0, 0), N(1, 1, 9)], []).length, 0);
    // A single fretted note can never stretch.
    assert.strictEqual(_lintStretchPure([N(1, 0, 12)], []).length, 0);
});

t('overlap: sustain-aware, same-instant, and the clean case', () => {
    // Sustain runs 1.0→2.0; the next note on the same string lands at 1.5.
    const overlapping = [N(1, 2, 5, 1.0), N(1.5, 2, 7)];
    const issues = _lintOverlapPure(overlapping);
    assert.strictEqual(issues.length, 1);
    assert.deepStrictEqual(issues[0].indices, [0, 1]);
    // Two attacks at one instant on one string — impossible even with no sustain.
    assert.strictEqual(_lintOverlapPure([N(1, 2, 5), N(1.005, 2, 7)]).length, 1);
    // Different strings, or a sustain that ends first: clean.
    assert.strictEqual(_lintOverlapPure([N(1, 2, 5, 0.3), N(1.5, 2, 7)]).length, 0);
    assert.strictEqual(_lintOverlapPure([N(1, 2, 5, 1.0), N(1.5, 3, 7)]).length, 0);
});

t('open-bend + bad-fret: the physical flag and the data-bug catcher', () => {
    const bendOpen = [N(1, 0, 0, 0, { bend: 1 })];
    assert.strictEqual(_lintOpenPure(bendOpen)[0].rule, 'open-bend');
    const bendCurveOpen = [N(1, 0, 0, 0, { bend_values: [{ t: 0, v: 1 }] })];
    assert.strictEqual(_lintOpenPure(bendCurveOpen)[0].rule, 'open-bend');
    // A fretted bend and a plain open note are both fine.
    assert.strictEqual(_lintOpenPure([N(1, 0, 7, 0, { bend: 1 }), N(2, 0, 0)]).length, 0);
    assert.strictEqual(_lintOpenPure([N(1, 0, 25)])[0].rule, 'bad-fret');
    assert.strictEqual(_lintOpenPure([N(1, 0, -1)])[0].rule, 'bad-fret');
    assert.strictEqual(_lintOpenPure([N(1, 0, 2.5)])[0].rule, 'bad-fret');
});

t('legato-jump: HO/PO gap beyond the window flags; in-window legato passes', () => {
    // 3 → 9 hammer-on with default window 4 → flagged.
    const jump = [N(1, 1, 3), N(1.5, 1, 9, 0, { hammer_on: 1 })];
    const issues = _lintLegatoJumpPure(jump, []);
    assert.strictEqual(issues.length, 1);
    assert.strictEqual(issues[0].rule, 'legato-jump');
    // 3 → 6 stays inside the hand.
    assert.strictEqual(_lintLegatoJumpPure([N(1, 1, 3), N(1.5, 1, 6, 0, { hammer_on: 1 })], []).length, 0);
    // A cross-string pair is never a legato chain.
    assert.strictEqual(_lintLegatoJumpPure([N(1, 1, 3), N(1.5, 2, 9, 0, { hammer_on: 1 })], []).length, 0);
    // A wide authored window absorbs the same jump.
    assert.strictEqual(_lintLegatoJumpPure(jump, [{ time: 0, fret: 3, width: 7 }]).length, 0);
});

t('legato-jump: a pitched slide reaching past the window flags', () => {
    const slide = [N(1, 1, 3, 0.5, { slide_to: 12 })];
    assert.strictEqual(_lintLegatoJumpPure(slide, []).length, 1);
    assert.strictEqual(_lintLegatoJumpPure([N(1, 1, 3, 0.5, { slide_to: 6 })], []).length, 0);
});

t('degradations: empty part, no anchors, junk input → no issues, no throw', () => {
    assert.deepStrictEqual(_playabilityLintPure([], []), []);
    assert.deepStrictEqual(_playabilityLintPure(null, null), []);
    assert.deepStrictEqual(_playabilityLintPure([null, { time: NaN }], []), []);
    const clean = [N(0, 0, 3, 0.2), N(0.5, 1, 5, 0.2), N(1, 2, 0)];
    assert.deepStrictEqual(_playabilityLintPure(clean, []), []);
});

t('anchor list: authored wins, computed falls back, junk degrades', () => {
    assert.deepStrictEqual(
        _lintAnchorsPure({ anchors_user: [{ time: 0, fret: 5 }], anchors: [{ time: 0, fret: 1 }] }),
        [{ time: 0, fret: 5 }]);
    assert.deepStrictEqual(
        _lintAnchorsPure({ anchors_user: [], anchors: [{ time: 0, fret: 1 }] }),
        [{ time: 0, fret: 1 }]);
    assert.deepStrictEqual(_lintAnchorsPure({}), []);
    assert.deepStrictEqual(_lintAnchorsPure(null), []);
});

t('the full pass orders issues by time and unions every rule', () => {
    const nn = [
        N(3, 1, 3), N(3.4, 1, 10, 0, { hammer_on: 1 }),         // legato-jump at 3.4
        N(1, 0, 0, 0, { bend: 1 }),                              // open-bend at 1
        N(2, 2, 5, 1.0), N(2.5, 2, 7),                           // overlap at 2.5
    ];
    const issues = _playabilityLintPure(nn, []);
    assert.deepStrictEqual(issues.map((i) => i.rule), ['open-bend', 'overlap', 'legato-jump']);
    assert.strictEqual(LINT_DEFAULT_WINDOW, 4);
    assert.strictEqual(LINT_STRETCH_TOLERANCE, 1);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
