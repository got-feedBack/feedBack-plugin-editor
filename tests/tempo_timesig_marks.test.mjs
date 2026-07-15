/*
 * Time-signature edits × authored meter marks (review #276 item 3).
 *
 * `_tempoSetBeatsPerMeasure` / `_tempoSetTimeSignature` change the bar's
 * meter on S.beats; an authored meter mark on that bar must move in the SAME
 * undoable TempoGridCmd, or changing 7/8 (2+2+3) to 4/4 leaves a mark whose
 * seven-slot grouping feeds every consumer (chips, accent maps, the wire).
 *
 * Pinned here (the reconcile policy):
 *   - grouping no longer sums to the new numerator → the mark DROPS with the
 *     edit (stale authored data is cleared, never guessed);
 *   - grouping still sums (e.g. a den-only 7/8 → 7/4 change) → the grouping
 *     is kept and the mark's num/den retag to the new signature;
 *   - unrelated marks (a hold, another bar's meter) are untouched;
 *   - ONE undo restores beats AND marks together, by reference (immutable
 *     swap), and redo reproduces exactly.
 *
 * Fails on unfixed code (the edit used to leave S.tempoMarks alone).
 * Run: node tests/tempo_timesig_marks.test.mjs
 */
import assert from 'node:assert';

globalThis.document = globalThis.document || {
    getElementById: () => null, addEventListener: () => {}, activeElement: null,
};
globalThis.localStorage = globalThis.localStorage || { getItem: () => null, setItem: () => {} };
globalThis.window = globalThis.window || globalThis;

const { _marksMeterReconcilePure } = await import('../src/tempo-marks.js');
const { _tempoSetBeatsPerMeasure, _tempoSetTimeSignature } = await import('../src/tempo.js');
const { S } = await import('../src/state.js');
const { EditHistory } = await import('../src/history.js');

let pass = 0, fail = 0;
function t(name, fn) {
    try { fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}

// Three 7/8 bars (7 beats × 0.25 s) plus a closing downbeat. Bar 2's
// downbeat sits at index 7.
const BAR2 = 7;
function sevenEightGrid() {
    const beats = [];
    let t0 = 0;
    for (let m = 1; m <= 3; m++) {
        for (let b = 0; b < 7; b++) {
            beats.push({ time: Math.round((t0 + 0.25 * b) * 1000) / 1000, measure: b === 0 ? m : -1, den: 8 });
        }
        t0 += 1.75;
    }
    beats.push({ time: t0, measure: 4, den: 8 });
    return beats;
}

function seed(marks) {
    Object.assign(S, {
        beats: sevenEightGrid(),
        duration: 6,
        tempoMarks: marks,
        history: new EditHistory(),
        arrangements: [],
        sections: [],
        drumTab: null,
        currentArr: 0,
        sel: new Set(),
        tempoSel: -1,
        tempoSelMulti: null,
    });
}

function bar2BeatCount() {
    let d = -1;
    for (let i = 0; i < S.beats.length; i++) if (S.beats[i].measure === 2) { d = i; break; }
    for (let i = d + 1; i < S.beats.length; i++) if (S.beats[i].measure > 0) return i - d;
    return S.beats.length - d;
}

t('7/8 (2+2+3) → 4 beats drops the stale grouping mark in the SAME undo step', () => {
    seed([
        { measure: 2, kind: 'meter', num: 7, den: 8, grouping: [2, 2, 3], provenance: 'confirmed' },
        { measure: 3, kind: 'hold', factor: 2 },
    ]);
    const beforeMarks = S.tempoMarks;
    const beforeDeep = structuredClone(S.tempoMarks);
    _tempoSetBeatsPerMeasure(BAR2, 4);
    assert.strictEqual(bar2BeatCount(), 4, 'the grid edit itself applied');
    assert.ok(!S.tempoMarks.some(m => m.measure === 2 && m.kind === 'meter'),
        'a 2+2+3 grouping cannot describe a 4-beat bar — the mark must drop with the edit');
    assert.ok(S.tempoMarks.some(m => m.measure === 3 && m.kind === 'hold'),
        'the unrelated hold survives');
    const afterMarks = S.tempoMarks;
    // ONE undo restores grid AND marks together.
    S.history.doUndo();
    assert.strictEqual(bar2BeatCount(), 7, 'one undo restores the grid');
    assert.strictEqual(S.tempoMarks, beforeMarks, 'the SAME marks array returns (immutable swap)');
    assert.deepStrictEqual(S.tempoMarks, beforeDeep, 'deep-equal to the pre-edit marks');
    S.history.doRedo();
    assert.strictEqual(bar2BeatCount(), 4);
    assert.strictEqual(S.tempoMarks, afterMarks, 'redo reproduces the exact after array');
});

t('a den-only 7/8 → 7/4 change keeps the still-honest grouping, retagged', () => {
    seed([{ measure: 2, kind: 'meter', num: 7, den: 8, grouping: [2, 2, 3], provenance: 'confirmed' }]);
    const beforeMarks = S.tempoMarks;
    _tempoSetTimeSignature(BAR2, 7, 4);
    const mark = S.tempoMarks.find(m => m.measure === 2 && m.kind === 'meter');
    assert.ok(mark, 'grouping still sums to 7 — the mark survives');
    assert.strictEqual(mark.num, 7);
    assert.strictEqual(mark.den, 4, 'the mark follows the bar to the new denominator');
    assert.deepStrictEqual(mark.grouping, [2, 2, 3]);
    assert.strictEqual(mark.provenance, 'confirmed', 'provenance rides along');
    S.history.doUndo();
    assert.strictEqual(S.tempoMarks, beforeMarks, 'undo restores the same array');
    assert.strictEqual(S.tempoMarks[0].den, 8);
});

t('7/8 → 4/4 through _tempoSetTimeSignature drops the mark too', () => {
    seed([{ measure: 2, kind: 'meter', num: 7, den: 8, grouping: [2, 2, 3] }]);
    _tempoSetTimeSignature(BAR2, 4, 4);
    assert.strictEqual(bar2BeatCount(), 4);
    assert.ok(!S.tempoMarks.some(m => m.measure === 2 && m.kind === 'meter'));
    S.history.doUndo();
    assert.deepStrictEqual(S.tempoMarks,
        [{ measure: 2, kind: 'meter', num: 7, den: 8, grouping: [2, 2, 3] }]);
});

t('a bar with no meter mark leaves S.tempoMarks untouched by identity', () => {
    seed([{ measure: 3, kind: 'hold', factor: 2 }]);
    const before = S.tempoMarks;
    _tempoSetBeatsPerMeasure(BAR2, 4);
    assert.strictEqual(S.tempoMarks, before, 'no snapshot when no mark is affected');
});

t("another bar's meter mark is untouched by the edit", () => {
    seed([{ measure: 1, kind: 'meter', num: 7, den: 8, grouping: [2, 2, 3] }]);
    const before = S.tempoMarks;
    _tempoSetBeatsPerMeasure(BAR2, 4);
    assert.strictEqual(S.tempoMarks, before, "bar 1's mark still describes bar 1");
});

t('_marksMeterReconcilePure: identity / keep-if-sums / drop-if-not, immutably', () => {
    const marks = [{ measure: 2, kind: 'meter', num: 7, den: 8, grouping: [2, 2, 3] }];
    assert.strictEqual(_marksMeterReconcilePure(marks, 2, 7, 8), marks,
        'signature unchanged → same array by identity');
    assert.strictEqual(_marksMeterReconcilePure(marks, 5, 4, 4), marks,
        'no mark on that bar → same array by identity');
    const dropped = _marksMeterReconcilePure(marks, 2, 4, 4);
    assert.deepStrictEqual(dropped, [], 'untranslatable grouping → the mark drops');
    const kept = _marksMeterReconcilePure(marks, 2, 7, 4);
    assert.deepStrictEqual(kept, [{ measure: 2, kind: 'meter', num: 7, den: 4, grouping: [2, 2, 3] }]);
    assert.strictEqual(marks[0].den, 8, 'input untouched (immutable)');
    // A bare meter mark (no grouping) is stale the moment its signature is —
    // nothing to translate, so it drops rather than describe the wrong bar.
    const bare = [{ measure: 2, kind: 'meter', num: 7, den: 8 }];
    assert.deepStrictEqual(_marksMeterReconcilePure(bare, 2, 4, 4), []);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
