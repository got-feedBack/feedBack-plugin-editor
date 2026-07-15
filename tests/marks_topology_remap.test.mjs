/*
 * Topology commands × authored marks — the time-anchored remap (review #276).
 *
 * Pickup, halve/double-range, multi-delete, heal, the zones/rough-map/flatten/
 * MIDI wholesale rebuilds: all renumber measures (or replace the grid outright)
 * with no surviving-downbeat old→new map, so the key-based remap can't follow.
 * The product rule pinned here: MARKS FOLLOW THE MUSIC. Each mark rides its old
 * bar's downbeat TIME into whichever new bar contains that moment
 * (`_marksRemapByTimePure`), threaded onto the TempoGridCmd via
 * `_tempoRemapMarksByTime` so ONE undo restores beats and marks together.
 *
 * Policy pinned:
 *   - a mark whose old bar is gone from oldBeats, whose moment falls before the
 *     new grid's first bar (e.g. a new pickup bar 0) or past its final beat →
 *     DROPS (honest drop, never a stale key);
 *   - two same-kind marks landing on one new bar: authored provenance beats
 *     machine (TEMPO_MARK_PROVENANCE order); equal tiers → earlier old bar wins;
 *   - nothing changes → the SAME array reference returns and the command's
 *     marks snapshot stays null (S.tempoMarks is never touched).
 *
 * Fails on unfixed code: the pures don't exist there, and the verbs left
 * S.tempoMarks stale through the renumber.
 * Run: node tests/marks_topology_remap.test.mjs
 */
import assert from 'node:assert';

globalThis.document = globalThis.document || {
    getElementById: () => null, addEventListener: () => {}, activeElement: null,
};
globalThis.localStorage = globalThis.localStorage || { getItem: () => null, setItem: () => {} };
globalThis.window = globalThis.window || globalThis;

// Namespace imports (not destructured static imports) so the suite still RUNS
// on unfixed source — the missing exports fail each test, not the module load.
const marksMod = await import('../src/tempo-marks.js');
const tempoMod = await import('../src/tempo.js');
const { S } = await import('../src/state.js');
const { EditHistory } = await import('../src/history.js');
const _marksRemapByTimePure = marksMod._marksRemapByTimePure;
const _tempoRemapMarksByTime = tempoMod._tempoRemapMarksByTime;
const { _tempoHalveRange, _tempoDeleteSelection } = tempoMod;

let pass = 0, fail = 0;
function t(name, fn) {
    try { fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}

const db = (time, measure, den = 4) => ({ time, measure, den });
const sub = (time) => ({ time, measure: -1 });
const hold = (measure, provenance, factor = 2) =>
    (provenance ? { measure, kind: 'hold', factor, provenance } : { measure, kind: 'hold', factor });

// 1 s per beat, a downbeat every 2 beats: times 0..2n, measures 1..n+1.
function twoBeatGrid(nBars) {
    const beats = [];
    for (let m = 1; m <= nBars; m++) beats.push(db(2 * (m - 1), m), sub(2 * m - 1));
    beats.push(db(2 * nBars, nBars + 1));
    return beats;
}

function seed(rest) {
    Object.assign(S, {
        sessionId: 'sess-topology-marks',
        duration: 20,
        history: new EditHistory(),
        arrangements: [],
        sections: [],
        drumTab: null,
        currentArr: 0,
        sel: new Set(),
        tempoSel: -1,
        tempoSelMulti: null,
        ...rest,
    });
}

// ── the pure: _marksRemapByTimePure ──────────────────────────────────

t('pickup: a prepended pickup bar shifts every number — marks ride to the new one', () => {
    // Old bars 1,2,3 at t=2,4,6; the pickup transform grows a bar at t=0 and
    // every number shifts up one.
    const oldB = [db(2, 1), sub(3), db(4, 2), sub(5), db(6, 3), sub(7)];
    const newB = [db(0, 1), sub(1), db(2, 2), sub(3), db(4, 3), sub(5), db(6, 4), sub(7)];
    const out = _marksRemapByTimePure([hold(1, 'confirmed'), hold(2, 'confirmed')], oldB, newB);
    assert.deepStrictEqual(out, [hold(2, 'confirmed'), hold(3, 'confirmed')]);
});

t('pickup: a mark whose moment lands on the new bar 0 drops', () => {
    const oldB = [db(0, 1), sub(1), db(2, 2), sub(3), db(4, 3), sub(5)];
    // The new first bar is numbered 0 (a pickup): not a real measure, so the
    // moment at t=0 has no bar ≥ 1 to land on.
    const newB = [db(0, 0), sub(1), db(2, 1), sub(3), db(4, 2), sub(5)];
    const out = _marksRemapByTimePure([hold(1, 'confirmed'), hold(2, 'confirmed')], oldB, newB);
    assert.deepStrictEqual(out, [hold(1, 'confirmed')],
        'bar-1 mark (t=0) drops on the bar-0 span; bar-2 mark (t=2) rides to new bar 1');
});

t('wholesale rebuild: a mark keeps its moment through a full grid replace', () => {
    const oldB = [db(0, 1), sub(1), db(2, 2), sub(3), db(4, 3), sub(5), db(6, 4), sub(7)];
    // A completely new grid (zones apply / rough map / flatten / MIDI): the
    // moment t=4 now falls inside the bar spanning [3, 4.5) — new bar 2.
    const newB = [db(0, 1), sub(1.5), db(3, 2), sub(3.75), db(4.5, 3), sub(5.25), db(6, 4), sub(7.5)];
    const out = _marksRemapByTimePure([hold(3, 'confirmed')], oldB, newB);
    assert.deepStrictEqual(out, [hold(2, 'confirmed')]);
});

t('drop: the moment leaves the new grid (and a bar missing from oldBeats drops)', () => {
    const oldB = [db(0, 1), sub(1), db(2, 2), sub(3), db(6, 4)];
    const newB = [db(0, 1), sub(1), db(2, 2), sub(3)];   // grid now ends at t=3
    const out = _marksRemapByTimePure(
        [hold(1, 'confirmed'), hold(3, 'confirmed'), hold(4, 'confirmed')], oldB, newB);
    assert.deepStrictEqual(out, [hold(1, 'confirmed')],
        'bar 3 never existed in oldBeats; bar 4\'s moment (t=6) is past the new grid');
});

t('collision: authored provenance beats machine; earlier old bar wins among equals', () => {
    const oldB = twoBeatGrid(4);                          // bars 1..5 at t=0,2,4,6,8
    const newB = [db(0, 1), sub(1), sub(2), sub(3), db(4, 2), sub(5), sub(6), sub(7), db(8, 3)];
    const out = _marksRemapByTimePure([
        hold(1, 'suggested'),          // machine …
        hold(2, 'confirmed'),          // … loses to the human mark on the same new bar
        hold(3, 'confirmed'),          // equal tiers: the earlier old bar …
        hold(4, 'confirmed', 3),       // … wins, this one drops
    ], oldB, newB);
    assert.deepStrictEqual(out, [hold(1, 'confirmed'), hold(2, 'confirmed')]);
});

t('collision is per kind: a hold and a meter mark share the merged bar', () => {
    const oldB = twoBeatGrid(2);                          // bars 1,2,3 at t=0,2,4
    const newB = [db(0, 1), sub(1), sub(2), sub(3), db(4, 2)];
    const meter = { measure: 1, kind: 'meter', num: 2, den: 4, provenance: 'confirmed' };
    const out = _marksRemapByTimePure([meter, hold(2, 'confirmed')], oldB, newB);
    assert.deepStrictEqual(out, [
        hold(1, 'confirmed'), { measure: 1, kind: 'meter', num: 2, den: 4, provenance: 'confirmed' },
    ], 'different kinds never collide; sorted (measure, kind)');
});

t('identity fast-path: no marks / no renumber → the SAME array reference', () => {
    const oldB = twoBeatGrid(3);
    const none = [];
    assert.strictEqual(_marksRemapByTimePure(none, oldB, twoBeatGrid(3)), none);
    const marks = [hold(1, 'confirmed'), hold(3, 'suggested')];
    // A heal-shaped edit: interior beat times move, downbeats don't.
    const healed = twoBeatGrid(3).map(b => (b.measure > 0 ? b : sub(b.time + 0.1)));
    assert.strictEqual(_marksRemapByTimePure(marks, oldB, healed), marks);
});

t('float jitter: epsilon on the containment lower edge', () => {
    const oldB = [db(0, 1), sub(1), db(2, 2), sub(3), db(4, 3)];
    const newB = [db(0, 1), sub(1), db(2.0000005, 2), sub(3), db(4, 3)];
    const out = _marksRemapByTimePure([hold(2, 'confirmed')], oldB, newB);
    assert.deepStrictEqual(out, [hold(2, 'confirmed')],
        'a downbeat 0.5 µs later still owns its own moment');
});

t('a ramp-shaped mark (measureEnd) passes through with the field untouched', () => {
    const oldB = [db(2, 1), sub(3), db(4, 2), sub(5), db(6, 3), sub(7)];
    const newB = [db(0, 1), sub(1), db(2, 2), sub(3), db(4, 3), sub(5), db(6, 4), sub(7)];
    const ramp = { measure: 2, kind: 'hold', factor: 2, measureEnd: 3, provenance: 'confirmed' };
    const out = _marksRemapByTimePure([ramp], oldB, newB);
    assert.deepStrictEqual(out,
        [{ measure: 3, kind: 'hold', factor: 2, measureEnd: 3, provenance: 'confirmed' }],
        'only the anchor measure remaps in this slice — the P2-7 descendant owns measureEnd');
    assert.strictEqual(ramp.measure, 2, 'input mark untouched (immutable)');
});

// ── the tempo.js snapshot helper ─────────────────────────────────────

t('_tempoRemapMarksByTime: null for no marks / identity; snapshot when changed', () => {
    const oldB = twoBeatGrid(3);
    seed({ beats: twoBeatGrid(3), tempoMarks: [] });
    assert.strictEqual(_tempoRemapMarksByTime(oldB, twoBeatGrid(3)), null);
    const marks = [hold(2, 'confirmed')];
    seed({ beats: twoBeatGrid(3), tempoMarks: marks });
    assert.strictEqual(_tempoRemapMarksByTime(oldB, twoBeatGrid(3)), null, 'no renumber → no snapshot');
    const newB = [db(0, 1), sub(1), sub(2), sub(3), db(4, 2), sub(5), db(6, 3)];
    const snap = _tempoRemapMarksByTime(oldB, newB);
    assert.strictEqual(snap.before, marks, 'before is the live array by reference');
    assert.deepStrictEqual(snap.after, [hold(1, 'confirmed')]);
});

t('_tempoRemapMarksByTime: a grouping stranded on a merged bar reconciles away', () => {
    const oldB = twoBeatGrid(2);                          // 2-beat bars
    const newB = [db(0, 1), sub(1), sub(2), sub(3), db(4, 2)];   // bars merged: 4 beats
    seed({
        beats: twoBeatGrid(2),
        tempoMarks: [{ measure: 1, kind: 'meter', num: 2, den: 4, grouping: [1, 1], provenance: 'confirmed' }],
    });
    const snap = _tempoRemapMarksByTime(oldB, newB);
    assert.deepStrictEqual(snap.after, [],
        'a 1+1 grouping cannot describe the merged 4-beat bar — it drops with the edit');
});

// ── the verbs, through the real history ──────────────────────────────

t('halve-range: marks ride the merge; ONE exec/undo/redo round-trips both sides', () => {
    seed({
        beats: twoBeatGrid(4),                            // bars 1..5 at t=0,2,4,6,8
        tempoMarks: [
            hold(1, 'suggested'), hold(2, 'confirmed'), hold(3, 'confirmed'),
            hold(4, 'confirmed'), hold(5, 'confirmed', 3),
        ],
        tempoSelMulti: new Set([0, 8]),
    });
    const beforeMarks = S.tempoMarks;
    const beforeDeep = structuredClone(S.tempoMarks);
    const beforeBeats = structuredClone(S.beats);
    _tempoHalveRange();
    assert.strictEqual(S.beats.filter(b => b.measure > 0).length, 3, 'the halve itself applied');
    assert.deepStrictEqual(S.tempoMarks, [
        hold(1, 'confirmed'),          // old bar 2 beat old bar 1 (authored > machine)
        hold(2, 'confirmed'),          // old bar 3 beat old bar 4 (earlier among equals)
        hold(3, 'confirmed', 3),       // old bar 5 rode 5 → 3
    ]);
    const afterMarks = S.tempoMarks;
    S.history.doUndo();
    assert.deepStrictEqual(S.beats, beforeBeats, 'one undo restores the grid');
    assert.strictEqual(S.tempoMarks, beforeMarks, 'the SAME marks array returns (immutable swap)');
    assert.deepStrictEqual(S.tempoMarks, beforeDeep);
    S.history.doRedo();
    assert.strictEqual(S.tempoMarks, afterMarks, 'redo reproduces the exact after array');
});

t('multi-delete barlines: a deleted bar\'s mark follows its music into the merged bar', () => {
    seed({
        beats: twoBeatGrid(4),
        tempoMarks: [hold(3, 'confirmed')],
        tempoSelMulti: new Set([2, 4]),                   // bars 2 and 3 — the pure multi path
    });
    _tempoDeleteSelection();
    assert.strictEqual(S.beats.filter(b => b.measure > 0).length, 3);
    assert.deepStrictEqual(S.tempoMarks, [hold(1, 'confirmed')],
        'the moment t=4 lives on inside the merged bar 1 — marks follow the music');
    S.history.doUndo();
    assert.deepStrictEqual(S.tempoMarks, [hold(3, 'confirmed')]);
});

t('multi-delete with no marked-bar renumber: S.tempoMarks untouched by reference', () => {
    seed({
        beats: twoBeatGrid(4),
        tempoMarks: [hold(1, 'confirmed')],
        tempoSelMulti: new Set([6]),                      // bar 4 — after the only mark
    });
    const before = S.tempoMarks;
    _tempoDeleteSelection();
    assert.strictEqual(S.beats.filter(b => b.measure > 0).length, 4, 'the delete itself applied');
    assert.strictEqual(S.tempoMarks, before, 'identity remap → cmd.marks stays null');
    S.history.doUndo();
    assert.strictEqual(S.tempoMarks, before, 'undo never touches marks either');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
