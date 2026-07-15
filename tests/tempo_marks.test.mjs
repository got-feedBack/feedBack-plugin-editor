/*
 * Authored tempo/meter marks (P2-5): the sparse intent layer over the beat
 * grid — hold/fermata bars, meter groupings, provenance.
 *
 * Pinned here (the P2-5 contract):
 *   - a HELD bar is EXCLUDED from BPM stats (its giant interval is not a
 *     tempo — without the flag it poisons medians and flatten choices);
 *   - a hold suppresses the derived tempo-drop chip AND the re-entry chip
 *     (the run tempo deliberately doesn't update across the hold);
 *   - an authored meter grouping emits ONE `7/8 (2+2+3)` chip;
 *   - marks validate hard (sum(grouping)===num, kinds/provenance enums) and
 *     sanitize at the load boundary;
 *   - measure-keyed marks REMAP across a renumber (a deleted bar's marks
 *     drop — never a stale key);
 *   - a marker edit round-trips exec → rollback → redo with deep equality.
 *
 * Fails on main (the module doesn't exist there).
 * Run: node tests/tempo_marks.test.mjs
 */
import assert from 'node:assert';

globalThis.document = globalThis.document || {
    getElementById: () => null, addEventListener: () => {}, activeElement: null,
};
globalThis.localStorage = globalThis.localStorage || { getItem: () => null, setItem: () => {} };
globalThis.window = globalThis.window || globalThis;

const {
    TempoMarkCmd, _groupingParsePure, _holdMeasuresPure, _markNormPure,
    _marksRemapPure, _marksSanitizePure, _marksUpsertPure, editorToggleHoldBar,
} = await import('../src/tempo-marks.js');
const {
    _tempoMeasureBpmsPure, _tempoMarkersPure, _tempoInsertSyncPoint, _tempoDeleteSyncPoint,
} = await import('../src/tempo.js');
const { _suggestFitPure } = await import('../src/tempo-suggest.js');
const { S } = await import('../src/state.js');
const { EditHistory } = await import('../src/history.js');

let pass = 0, fail = 0;
function t(name, fn) {
    try { fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}

// A steady 120 BPM 4/4 grid, except bar 3 is HELD (a 8 s fermata bar).
function gridWithHold() {
    const beats = [];
    let t0 = 0;
    for (let m = 1; m <= 5; m++) {
        const span = (m === 3) ? 8 : 2;          // 4 beats × 0.5 s, or held
        for (let b = 0; b < 4; b++) {
            beats.push({ time: t0 + (span / 4) * b, measure: b === 0 ? m : -1 });
        }
        t0 += span;
    }
    beats.push({ time: t0, measure: 6 });        // closing downbeat
    return beats;
}

t('a held bar is EXCLUDED from BPM stats — the fermata is not a tempo', () => {
    const beats = gridWithHold();
    const all = _tempoMeasureBpmsPure(beats, v => Math.round(v));
    assert.ok(all.includes(30), 'without the flag the 8s bar reads as a bogus 30 BPM');
    const skipped = _tempoMeasureBpmsPure(beats, v => Math.round(v), new Set([3]));
    assert.deepStrictEqual([...new Set(skipped)], [120], 'held bar out → the map reads steady 120');
});

t('a hold suppresses the derived tempo chips (the drop AND the re-entry)', () => {
    const beats = gridWithHold();
    const derived = _tempoMarkersPure(beats, 0.01);
    assert.ok(derived.filter(mk => mk.kind === 'tempo').length >= 3,
        'unmarked: baseline + drop + re-entry chips');
    const marks = [{ measure: 3, kind: 'hold', factor: 2, provenance: 'confirmed' }];
    const marked = _tempoMarkersPure(beats, 0.01, marks);
    const tempoChips = marked.filter(mk => mk.kind === 'tempo');
    assert.strictEqual(tempoChips.length, 1, 'only the bar-1 baseline remains');
    const holdChips = marked.filter(mk => mk.kind === 'hold');
    assert.strictEqual(holdChips.length, 1);
    assert.strictEqual(holdChips[0].measure, 3);
    assert.strictEqual(holdChips[0].authored, true);
});

t('an authored grouping emits ONE labeled meter chip', () => {
    // A 7/8-ish grid: bars of 7 beats.
    const beats = [];
    let t0 = 0;
    for (let m = 1; m <= 3; m++) {
        for (let b = 0; b < 7; b++) beats.push({ time: t0 + 0.25 * b, measure: b === 0 ? m : -1, den: 8 });
        t0 += 1.75;
    }
    beats.push({ time: t0, measure: 4, den: 8 });
    const marks = [{ measure: 1, kind: 'meter', num: 7, den: 8, grouping: [2, 2, 3] }];
    const chips = _tempoMarkersPure(beats, 0.01, marks).filter(mk => mk.kind === 'meter');
    const authored = chips.filter(c => c.authored);
    assert.strictEqual(authored.length, 1);
    assert.strictEqual(authored[0].label, '7/8 (2+2+3)');
    assert.strictEqual(chips.length, 1, 'the derived bare 7/8 chip is superseded, not duplicated');
});

t('validation: grouping must sum to the numerator; enums enforced; junk drops', () => {
    assert.strictEqual(_markNormPure({ measure: 2, kind: 'meter', num: 7, den: 8, grouping: [2, 2, 2] }), null);
    assert.ok(_markNormPure({ measure: 2, kind: 'meter', num: 7, den: 8, grouping: [2, 2, 3] }));
    assert.strictEqual(_markNormPure({ measure: 0, kind: 'hold' }), null, 'measure ≥ 1');
    assert.strictEqual(_markNormPure({ measure: 1, kind: 'ramp' }), null, 'ramp is P2-7');
    const h = _markNormPure({ measure: 1, kind: 'hold', factor: 999, provenance: 'nonsense' });
    assert.strictEqual(h.factor, 2, 'silly factor degrades to the default');
    assert.strictEqual(h.provenance, undefined, 'unknown provenance drops');
    const dirty = _marksSanitizePure([null, 'x', { measure: 1, kind: 'hold' },
        { measure: 1, kind: 'hold', factor: 3 }, { measure: 2, kind: 'meter', num: 4, den: 4 }]);
    assert.strictEqual(dirty.length, 2, 'dedup by (measure, kind), junk dropped');
});

t('grouping text parses hard: sums enforced, empty clears, garbage rejects', () => {
    assert.deepStrictEqual(_groupingParsePure('2+2+3', 7), [2, 2, 3]);
    assert.deepStrictEqual(_groupingParsePure(' 3 + 2 + 2 ', 7), [3, 2, 2]);
    assert.deepStrictEqual(_groupingParsePure('', 7), [], 'empty = clear');
    assert.strictEqual(_groupingParsePure('2+2+2', 7), null);
    assert.strictEqual(_groupingParsePure('lol', 7), null);
    assert.strictEqual(_groupingParsePure('0+7', 7), null);
});

t('marks remap across a renumber; a deleted bar drops its marks', () => {
    const marks = [
        { measure: 2, kind: 'hold', factor: 2 },
        { measure: 5, kind: 'meter', num: 4, den: 4 },
        { measure: 9, kind: 'hold', factor: 2 },
    ];
    // Bar 5 was deleted: 2→2, 9→8; no mapping for 5.
    const remap = new Map([[1, 1], [2, 2], [3, 3], [4, 4], [6, 5], [7, 6], [8, 7], [9, 8]]);
    const out = _marksRemapPure(marks, remap);
    assert.deepStrictEqual(out.map(m => [m.measure, m.kind]),
        [[2, 'hold'], [8, 'hold']], 'bar 5 mark dropped, bar 9 followed to 8');
});

t('a marker edit round-trips exec → rollback → redo with deep equality', () => {
    Object.assign(S, { tempoMarks: [], history: new EditHistory() });
    const before = S.tempoMarks;
    editorToggleHoldBar(4);
    const afterExec = S.tempoMarks;
    assert.strictEqual(afterExec.length, 1);
    assert.strictEqual(afterExec[0].provenance, 'confirmed', 'a hand-set mark is human-confirmed');
    S.history.doUndo();
    assert.strictEqual(S.tempoMarks, before, 'rollback restores the SAME array (immutable swap)');
    S.history.doRedo();
    assert.deepStrictEqual(S.tempoMarks, afterExec, 'redo reproduces exactly');
    // Toggling again REMOVES (still one command each way).
    editorToggleHoldBar(4);
    assert.strictEqual(S.tempoMarks.length, 0);
});

t('_holdMeasuresPure builds the shared exclusion set', () => {
    const set = _holdMeasuresPure([
        { measure: 3, kind: 'hold' }, { measure: 7, kind: 'hold' }, { measure: 5, kind: 'meter' },
    ]);
    assert.deepStrictEqual([...set].sort(), [3, 7]);
    assert.strictEqual(_holdMeasuresPure([]).size, 0);
});

t('upsert is immutable and replaces per (measure, kind)', () => {
    const a = [{ measure: 3, kind: 'hold', factor: 2 }];
    const b = _marksUpsertPure(a, { measure: 3, kind: 'hold', factor: 4 });
    assert.notStrictEqual(a, b, 'new array, input untouched');
    assert.strictEqual(a[0].factor, 2);
    assert.strictEqual(b.length, 1);
    assert.strictEqual(b[0].factor, 4);
});

// The undoable TempoMarkCmd is what the verbs go through — one more direct
// pin that a raw command carries the exact arrays it was built with.
t('the suggest march CARRIES a held bar - grid position kept, no onset snap', () => {
    const beats = gridWithHold();
    const onsets = [];
    for (const b of beats) if (b.measure > 0) onsets.push({ t: b.time + 0.02, s: 1 });
    const withHold = _suggestFitPure(beats, onsets, 0, { holdMeasures: new Set([3]) });
    const holdEnd = beats.findIndex(b => b.measure === 4);
    const carried = withHold.proposals.find(pp => pp.i === holdEnd);
    assert.ok(carried, 'the downbeat ending the hold gets a proposal');
    assert.strictEqual(carried.carried, true);
    assert.strictEqual(carried.time, beats[holdEnd].time, 'kept at the GRID position, not snapped');
    assert.ok(withHold.proposals.length >= 3, 'the march continues past the hold');
});

// Insert/delete a sync point renumbers measures — the marks REMAP, and a
// grouping whose bar was split/merged out from under it must reconcile (drop)
// in the SAME command, or it renders "2/4 (2+2)" and feeds a stale accent map
// (the review-#276-item-3 lie, reached by the topology path instead of the
// time-sig path).
function fourFourGrid() {
    const beats = []; let t0 = 0;
    for (let m = 1; m <= 4; m++) {
        for (let b = 0; b < 4; b++) beats.push({ time: t0 + 0.5 * b, measure: b === 0 ? m : -1, den: 4 });
        t0 += 2;
    }
    beats.push({ time: t0, measure: 5, den: 4 });
    return beats;
}
function seedGrid(marks) {
    Object.assign(S, {
        beats: fourFourGrid(), duration: 10, tempoMarks: marks, history: new EditHistory(),
        arrangements: [], currentArr: 0, tempoSel: -1, tempoSelMulti: null, sel: new Set(),
    });
}

t('inserting a sync point that splits a grouped bar drops the stale grouping (same undo)', () => {
    seedGrid([
        { measure: 2, kind: 'meter', num: 4, den: 4, grouping: [2, 2], provenance: 'confirmed' },
        { measure: 4, kind: 'hold', factor: 2 },
    ]);
    const before = S.tempoMarks;
    _tempoInsertSyncPoint(3.0);   // splits bar 2 (t=2..4) into two 2-beat bars
    assert.ok(!S.tempoMarks.some(m => m.kind === 'meter'),
        'a 2+2 grouping cannot describe the now-2-beat bar — it drops with the edit');
    assert.ok(S.tempoMarks.some(m => m.kind === 'hold'), 'the unrelated hold survives (remapped)');
    // One undo restores grid AND marks together, by reference.
    S.history.doUndo();
    assert.strictEqual(S.tempoMarks, before, 'undo restores the exact pre-edit marks array');
    assert.ok(S.tempoMarks.some(m => m.kind === 'meter'), 'the grouping is back after undo');
});

t('deleting a sync point that merges into a grouped bar drops the stale grouping', () => {
    // Grouping [2,2] on bar 1 (4 beats). Delete bar 2's downbeat → bar 1 grows
    // to 8 beats; [2,2] no longer sums.
    seedGrid([{ measure: 1, kind: 'meter', num: 4, den: 4, grouping: [2, 2] }]);
    const bar2 = S.beats.findIndex(b => b.measure === 2);
    _tempoDeleteSyncPoint(bar2);
    assert.ok(!S.tempoMarks.some(m => m.kind === 'meter'),
        'bar 1 grew past 4 beats — the [2,2] grouping drops rather than lie');
});

t('an insert that leaves a grouping still honest keeps it (no spurious drop)', () => {
    // Grouping on bar 3; splitting bar 1 renumbers bar 3 → 4 but never touches
    // its beat count, so the grouping stays valid and only its measure moves.
    seedGrid([{ measure: 3, kind: 'meter', num: 4, den: 4, grouping: [2, 2] }]);
    _tempoInsertSyncPoint(1.0);   // splits bar 1
    const mk = S.tempoMarks.find(m => m.kind === 'meter');
    assert.ok(mk, 'the still-honest grouping survives the renumber');
    assert.strictEqual(mk.measure, 4, 'it followed its bar (3 → 4)');
    assert.deepStrictEqual(mk.grouping, [2, 2]);
});

t('TempoMarkCmd swaps the exact before/after arrays', () => {
    Object.assign(S, { tempoMarks: [], history: new EditHistory() });
    const before = S.tempoMarks;
    const after = [{ measure: 1, kind: 'hold', factor: 2 }];
    S.history.exec(new TempoMarkCmd(before, after, 'test'));
    assert.strictEqual(S.tempoMarks, after);
    S.history.doUndo();
    assert.strictEqual(S.tempoMarks, before);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
