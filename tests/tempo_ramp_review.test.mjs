/*
 * Review #279 items 4–6 — the ramp hardening pass:
 *
 *   item 4: a topology renumber remaps BOTH ramp endpoints atomically —
 *           a stale measureEnd silently stretched/sheared the ramp, and a
 *           deleted/collapsed range must DROP (never measureEnd <= measure);
 *   item 5: editorRampRange REPLACES-from-baseline — reapplying the same
 *           ramp is bit-identical (never compounds), a BPM edit recompiles
 *           from the original baseline, and a partial overlap strips the old
 *           ramp mark (its remainder flattens to steady) instead of leaving
 *           two marks claiming the same bars;
 *   item 6: prompt BPMs validate STRICTLY before any compile or history
 *           mutation — parseFloat's trailing garbage and the missing 1000
 *           cap let the grid move while the mark upsert refused it.
 *
 * Fails on the pre-fix branch (stale measureEnd survives, overlap leaves two
 * marks, invalid BPM mutates the grid, _rampPromptParsePure doesn't exist).
 * Run: node tests/tempo_ramp_review.test.mjs
 */
import assert from 'node:assert';

globalThis.document = globalThis.document || {
    getElementById: () => null, addEventListener: () => {}, activeElement: null,
};
globalThis.localStorage = globalThis.localStorage || { getItem: () => null, setItem: () => {} };
globalThis.window = globalThis.window || globalThis;

const {
    TempoGridCmd, editorRampRange, _rampPromptParsePure,
} = await import('../src/tempo.js');
const { _marksRemapPure } = await import('../src/tempo-marks.js');
const { S } = await import('../src/state.js');
const { EditHistory } = await import('../src/history.js');

let pass = 0, fail = 0;
async function t(name, fn) {
    try { await fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}

// A steady 120 BPM 4/4 grid over `bars` bars (0.5 s beats).
function grid(bars) {
    const beats = [];
    for (let m = 1; m <= bars; m++) for (let b = 0; b < 4; b++) {
        beats.push({ time: ((m - 1) * 4 + b) * 0.5, measure: b === 0 ? m : -1 });
    }
    beats.push({ time: bars * 4 * 0.5, measure: bars + 1 });
    return beats;
}

function seed(beats, marks = []) {
    Object.assign(S, {
        beats, tempoMarks: marks, history: new EditHistory(),
        arrangements: [{ name: 'Lead', notes: [] }], currentArr: 0, sel: new Set(),
        tempoSelMulti: new Set(), tempoSel: -1,
    });
}

function selectBars(mStart, mEnd) {
    const lo = S.beats.findIndex(b => b.measure === mStart);
    const hi = S.beats.findIndex(b => b.measure === mEnd);
    S.tempoSelMulti = new Set([lo, hi]);
}

const times = () => JSON.stringify(S.beats.map(b => b.time));
const rampMarks = () => (S.tempoMarks || []).filter(m => m.kind === 'ramp');

const RAMP24 = { measure: 2, kind: 'ramp', measureEnd: 4, bpmStart: 120, bpmEnd: 240, curve: 'linear' };

// ── item 4: _marksRemapPure remaps BOTH ramp endpoints ──────────────────────

await t('insert inside a ramp span stretches BOTH endpoints (measureEnd follows)', () => {
    // A bar inserted between 3 and 4: every bar ≥ 4 shifts up by one.
    const remap = new Map([[1, 1], [2, 2], [3, 3], [4, 5], [5, 6], [6, 7]]);
    const out = _marksRemapPure([{ ...RAMP24 }], remap);
    assert.strictEqual(out.length, 1);
    assert.strictEqual(out[0].measure, 2, 'start unchanged');
    assert.strictEqual(out[0].measureEnd, 5, 'END follows the renumber — not the stale pre-insert 4');
});

await t('delete inside a ramp span shrinks it consistently', () => {
    // Bar 3 deleted: 4→3, 5→4, 6→5.
    const remap = new Map([[1, 1], [2, 2], [4, 3], [5, 4], [6, 5]]);
    const out = _marksRemapPure([{ ...RAMP24 }], remap);
    assert.strictEqual(out.length, 1);
    assert.deepStrictEqual([out[0].measure, out[0].measureEnd], [2, 3], 'span 2–4 shrank to 2–3');
});

await t('deleting the ramp END bar drops the mark whole — no half-valid range', () => {
    // Bar 4 deleted: no mapping for 4.
    const remap = new Map([[1, 1], [2, 2], [3, 3], [5, 4], [6, 5]]);
    const out = _marksRemapPure([{ ...RAMP24 }], remap);
    assert.strictEqual(out.length, 0, 'the range lost its end bar — honest drop');
});

await t('a deleted range swallowing the whole ramp drops it', () => {
    const remap = new Map([[1, 1], [5, 2], [6, 3]]);   // bars 2–4 gone
    assert.strictEqual(_marksRemapPure([{ ...RAMP24 }], remap).length, 0);
});

await t('a collapsed span (measureEnd <= measure after remap) is never emitted', () => {
    const remap = new Map([[1, 1], [2, 2], [4, 2], [5, 3]]);   // degenerate map
    assert.strictEqual(_marksRemapPure([{ ...RAMP24 }], remap).length, 0);
});

await t('point marks still remap alongside a ramp (mixed list)', () => {
    const remap = new Map([[1, 1], [2, 2], [3, 3], [4, 5], [5, 6], [6, 7]]);
    const out = _marksRemapPure([
        { ...RAMP24 }, { measure: 5, kind: 'hold', factor: 2 },
    ], remap);
    assert.deepStrictEqual(
        out.map(m => [m.measure, m.kind, m.measureEnd]),
        [[2, 'ramp', 5], [6, 'hold', undefined]]);
});

await t('a TempoGridCmd insert round-trips ramp marks: exec → rollback → redo', () => {
    const oldBeats = grid(6);
    seed(oldBeats.map(b => ({ ...b })), [{ ...RAMP24, provenance: 'confirmed' }]);
    // Simulate a bar inserted between 3 and 4 (split bar 3 at its midpoint).
    const splitAt = S.beats.findIndex(b => b.measure === 3) + 2;
    const newBeats = S.beats.map(b => ({ ...b }));
    newBeats[splitAt].measure = 1;   // promote, then renumber sequentially
    let m = 0;
    const oldToNew = new Map();
    for (const b of newBeats) {
        if (b.measure > 0) {
            m++;
            if (!oldToNew.has(b.measure) && b !== newBeats[splitAt]) oldToNew.set(b.measure, m);
            b.measure = m;
        }
    }
    const before = S.tempoMarks;
    const after = _marksRemapPure(before, oldToNew);
    const cmd = new TempoGridCmd(S.beats, newBeats, 'insert barline');
    cmd.marks = { before, after };
    const beatsBefore = times();
    S.history.exec(cmd);
    assert.deepStrictEqual(
        rampMarks().map(mk => [mk.measure, mk.measureEnd]), [[2, 5]],
        'ramp stretched across the inserted bar');
    S.history.doUndo();
    assert.strictEqual(S.tempoMarks, before, 'undo restores the SAME marks array');
    assert.strictEqual(times(), beatsBefore, 'undo restores the grid exactly');
    S.history.doRedo();
    assert.deepStrictEqual(rampMarks().map(mk => [mk.measure, mk.measureEnd]), [[2, 5]],
        'redo reproduces the remapped ramp');
});

// ── item 5: replace-from-baseline ────────────────────────────────────────────

await t('reapplying the SAME ramp is idempotent — bit-identical beats, one mark', async () => {
    seed(grid(8));
    selectBars(2, 4);
    await editorRampRange({ bpmStart: 130, bpmEnd: 220, curve: 'linear' });
    const t1 = times();
    const m1 = JSON.stringify(S.tempoMarks);
    selectBars(2, 4);
    await editorRampRange({ bpmStart: 130, bpmEnd: 220, curve: 'linear' });
    assert.strictEqual(times(), t1, 'second apply is bit-identical — never compounds');
    assert.strictEqual(JSON.stringify(S.tempoMarks), m1, 'still exactly one identical mark');
    assert.strictEqual(rampMarks().length, 1);
});

await t('editing a ramp\'s BPMs recompiles from the ORIGINAL baseline', async () => {
    // Scenario A: ramp 120→240, then EDIT it to 120→180 over the same bars.
    seed(grid(8));
    selectBars(2, 4);
    await editorRampRange({ bpmStart: 120, bpmEnd: 240, curve: 'linear' });
    selectBars(2, 4);
    await editorRampRange({ bpmStart: 120, bpmEnd: 180, curve: 'linear' });
    const edited = times();
    // Scenario B: 120→180 applied directly to the untouched grid.
    seed(grid(8));
    selectBars(2, 4);
    await editorRampRange({ bpmStart: 120, bpmEnd: 180, curve: 'linear' });
    assert.strictEqual(edited, times(), 'the edit never sees the first ramp\'s output');
});

await t('a partial overlap REPLACES the old ramp: one mark, remainder steady', async () => {
    seed(grid(8));
    selectBars(2, 4);
    await editorRampRange({ bpmStart: 120, bpmEnd: 240, curve: 'linear' });
    selectBars(3, 5);
    await editorRampRange({ bpmStart: 100, bpmEnd: 200, curve: 'linear' });
    assert.deepStrictEqual(
        rampMarks().map(m => [m.measure, m.measureEnd, m.bpmStart, m.bpmEnd]),
        [[3, 5, 100, 200]],
        'the overlapped old mark is GONE — two ramps never claim the same bars');
    // The old ramp's non-overlapped remainder (bars 2–3) flattens to steady:
    // its authored shape was replaced, and leaving its warp in the grid with
    // no mark would be exactly the unmarked-mutation bug of item 6.
    const lo = S.beats.findIndex(b => b.measure === 2);
    const hi = S.beats.findIndex(b => b.measure === 3);
    const gaps = [];
    for (let i = lo; i < hi; i++) gaps.push(S.beats[i + 1].time - S.beats[i].time);
    for (let i = 1; i < gaps.length; i++) {
        // 2.5e-6 tolerance: each beat time is rounded to the grid's 1e-6
        // quantum, so adjacent gaps can differ by up to two quanta.
        assert.ok(Math.abs(gaps[i] - gaps[0]) < 2.5e-6,
            `remainder is uniform (gap ${i}: ${gaps[i]} vs ${gaps[0]})`);
    }
});

await t('overlap replace round-trips: one undo restores the previous ramp exactly', async () => {
    seed(grid(8));
    selectBars(2, 4);
    await editorRampRange({ bpmStart: 120, bpmEnd: 240, curve: 'linear' });
    const afterFirstTimes = times();
    const afterFirstMarks = JSON.stringify(S.tempoMarks);
    selectBars(3, 5);
    await editorRampRange({ bpmStart: 100, bpmEnd: 200, curve: 'linear' });
    S.history.doUndo();
    assert.strictEqual(times(), afterFirstTimes, 'undo restores the first ramp\'s grid');
    assert.strictEqual(JSON.stringify(S.tempoMarks), afterFirstMarks, 'and its mark');
    S.history.doUndo();
    assert.strictEqual(times(), JSON.stringify(grid(8).map(b => b.time)), 'second undo → original grid');
    assert.strictEqual(rampMarks().length, 0);
});

await t('ramps that merely TOUCH at an endpoint bar coexist (disjoint rows)', async () => {
    seed(grid(8));
    selectBars(2, 4);
    await editorRampRange({ bpmStart: 120, bpmEnd: 240, curve: 'linear' });
    selectBars(4, 6);   // starts exactly where the first ends
    await editorRampRange({ bpmStart: 240, bpmEnd: 120, curve: 'ease-out' });
    assert.deepStrictEqual(rampMarks().map(m => [m.measure, m.measureEnd]),
        [[2, 4], [4, 6]], 'no shared compiled rows — both marks stay');
});

// ── item 6: strict BPM validation before compile/history ────────────────────

await t('_rampPromptParsePure: exact numbers only, within _markNormPure bounds', () => {
    assert.deepStrictEqual(_rampPromptParsePure('120 → 140'), { bpmStart: 120, bpmEnd: 140 });
    assert.deepStrictEqual(_rampPromptParsePure('120->140'), { bpmStart: 120, bpmEnd: 140 });
    assert.deepStrictEqual(_rampPromptParsePure(' 96 → 104.5 '), { bpmStart: 96, bpmEnd: 104.5 });
    assert.strictEqual(_rampPromptParsePure('3000x → 140'), null, 'trailing garbage rejected');
    assert.strictEqual(_rampPromptParsePure('120 → 140x'), null);
    assert.strictEqual(_rampPromptParsePure('2000 → 3000'), null, 'past the 1000 BPM cap');
    assert.strictEqual(_rampPromptParsePure('120 → 0'), null);
    assert.strictEqual(_rampPromptParsePure('120 → -5'), null);
    assert.strictEqual(_rampPromptParsePure('120'), null, 'one tempo is not a ramp');
    assert.strictEqual(_rampPromptParsePure('120 → 130 → 140'), null);
    assert.strictEqual(_rampPromptParsePure('→ 140'), null);
    assert.strictEqual(_rampPromptParsePure(''), null);
    assert.strictEqual(_rampPromptParsePure('abc → def'), null);
    assert.deepStrictEqual(_rampPromptParsePure('1000 → 1'), { bpmStart: 1000, bpmEnd: 1 }, 'bounds inclusive');
});

await t('invalid BPMs leave beats, marks, and history REFERENCE-identical', async () => {
    seed(grid(8));
    selectBars(2, 4);
    const beatsRef = S.beats;
    const marksRef = S.tempoMarks;
    const t0 = times();
    await editorRampRange({ bpmStart: 2000, bpmEnd: 3000, curve: 'linear' });
    assert.strictEqual(S.beats, beatsRef, 'S.beats is the SAME array — no grid mutation');
    assert.strictEqual(times(), t0, 'no beat time moved');
    assert.strictEqual(S.tempoMarks, marksRef, 'S.tempoMarks untouched');
    assert.strictEqual(S.history.undo.length, 0, 'nothing entered the history');
});

await t('a BPM at the 1000 cap still applies; just past it refuses', async () => {
    seed(grid(8));
    selectBars(2, 4);
    await editorRampRange({ bpmStart: 120, bpmEnd: 1000, curve: 'linear' });
    assert.strictEqual(rampMarks().length, 1, '1000 is inside the vocabulary');
    seed(grid(8));
    selectBars(2, 4);
    await editorRampRange({ bpmStart: 120, bpmEnd: 1000.001, curve: 'linear' });
    assert.strictEqual(rampMarks().length, 0);
    assert.strictEqual(S.history.undo.length, 0);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
