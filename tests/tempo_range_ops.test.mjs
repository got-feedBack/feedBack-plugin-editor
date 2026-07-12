/*
 * Range operations over the barline multi-selection (PR 8):
 *   - half-time / double-time a range (TempoGridCmd — times hold, beats re-lift);
 *   - flatten a range to a steady tempo (TempoMapCmd — times move, notes follow);
 *   - re-fit a range to the onsets (a bounded _suggestFitPure, opts.toIdx).
 *
 * Pinned: the grid transforms keep every SECOND fixed (audio positions hold);
 * flatten moves interiors to uniform spacing with both range ends and interior
 * locks pinned, and never touches the tail; half→double is identity on an even
 * range; each command round-trips exec → undo → redo; the range re-fit never
 * proposes past the range's last downbeat.
 *
 * Run: node tests/tempo_range_ops.test.mjs
 */
import assert from 'node:assert';
import { S } from '../src/state.js';
import { EditHistory } from '../src/history.js';
import {
    _tempoSelRangePure, _tempoHalveRangePure, _tempoDoubleRangePure, _tempoFlattenRangePure,
    _tempoHalveRange, _tempoDoubleRange, _tempoFlattenRange,
} from '../src/tempo.js';
import { _suggestFitPure } from '../src/tempo-suggest.js';
import { seedState, trackHooks } from './_history_env.mjs';

let pass = 0, fail = 0;
function t(name, fn) {
    try { fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}
const near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;
const dbTimes = (beats) => beats.filter(b => b.measure > 0).map(b => b.time);

// `nDown` downbeats, 4 s apart, each with three 1 s interior beats.
function grid(nDown) {
    const b = [];
    for (let m = 0; m < nDown; m++) {
        b.push({ time: m * 4, measure: m + 1 });
        if (m < nDown - 1) for (let k = 1; k < 4; k++) b.push({ time: m * 4 + k, measure: -1 });
    }
    return b;   // downbeats at idx 0,4,8,...,(nDown-1)*4
}

// ── _tempoSelRangePure ───────────────────────────────────────────────
t('the range is the min/max selected downbeats; <2 downbeats → null', () => {
    const g = grid(5);
    assert.deepStrictEqual(_tempoSelRangePure(g, new Set([12, 4, 8])), { lo: 4, hi: 12 });
    assert.strictEqual(_tempoSelRangePure(g, new Set([4])), null, 'one downbeat is not a range');
    assert.strictEqual(_tempoSelRangePure(g, new Set([1, 2])), null, 'sub-beats are not downbeats');
});

// ── half-time (TempoGridCmd: times hold) ─────────────────────────────
t('half-time demotes every second downbeat; times never move', () => {
    const g = grid(5);                                   // downbeats 0,4,8,12,16 (4 bars)
    const res = _tempoHalveRangePure(g, 0, 16);
    assert.deepStrictEqual(dbTimes(res.beats), [0, 8, 16], 'alternate barlines merged');
    assert.strictEqual(res.merged, 2);
    assert.strictEqual(res.remainder, false, 'even bar count pairs cleanly');
    assert.deepStrictEqual(res.beats.map(b => b.time), g.map(b => b.time), 'every SECOND is unchanged');
});

t('half-time on an odd bar count leaves the last bar unpaired (reported)', () => {
    const g = grid(4);                                   // downbeats 0,4,8,12 (3 bars)
    const res = _tempoHalveRangePure(g, 0, 12);
    assert.strictEqual(res.merged, 1);
    assert.strictEqual(res.remainder, true);
    assert.deepStrictEqual(dbTimes(res.beats), [0, 8, 12]);
});

// ── double-time (TempoGridCmd: times hold) ───────────────────────────
t('double-time promotes each bar\'s midpoint beat; times never move', () => {
    const g = grid(3);                                   // downbeats 0,4,8 (2 bars)
    const res = _tempoDoubleRangePure(g, 0, 8);
    assert.deepStrictEqual(dbTimes(res.beats), [0, 2, 4, 6, 8], 'each bar split at its midpoint');
    assert.strictEqual(res.split, 2);
    assert.strictEqual(res.skipped, 0);
    assert.deepStrictEqual(res.beats.map(b => b.time), g.map(b => b.time), 'every SECOND is unchanged');
});

t('double-time skips a 1-beat bar (no interior beat to promote)', () => {
    const dense = [{ time: 0, measure: 1 }, { time: 1, measure: 2 }, { time: 2, measure: 3 }];
    assert.strictEqual(_tempoDoubleRangePure(dense, 0, 2), null, 'nothing to split → null');
});

t('half→double is identity on an even range (downbeat set restored)', () => {
    const g = grid(5);                                   // 0,4,8,12,16
    const halved = _tempoHalveRangePure(g, 0, 16).beats; // 0,8,16
    const back = _tempoDoubleRangePure(halved, 0, 16).beats;
    assert.deepStrictEqual(dbTimes(back), [0, 4, 8, 12, 16], 'the original barlines are back');
});

// ── flatten (TempoMapCmd: times move) ────────────────────────────────
t('flatten re-times interiors to uniform spacing; ends pinned, tail untouched', () => {
    const beats = [
        { time: 0, measure: 1 }, { time: 0.3, measure: -1 }, { time: 0.6, measure: -1 }, { time: 0.9, measure: -1 },
        { time: 3.0, measure: 2 }, { time: 3.2, measure: -1 }, { time: 3.5, measure: -1 }, { time: 3.9, measure: -1 },
        { time: 4.0, measure: 3 }, { time: 5.0, measure: -1 },   // idx 9 is past the range
    ];
    const out = _tempoFlattenRangePure(beats, 0, 8);     // step = 4.0/8 = 0.5
    assert.ok(near(out[0].time, 0) && near(out[8].time, 4.0), 'range ends pinned');
    assert.ok(near(out[1].time, 0.5) && near(out[4].time, 2.0) && near(out[7].time, 3.5), 'interiors evenly spaced');
    assert.ok(near(out[9].time, 5.0), 'the tail past the range is untouched');
});

t('flatten pins an interior lock and re-spaces around it', () => {
    const beats = [
        { time: 0, measure: 1 }, { time: 0.3, measure: -1 }, { time: 0.6, measure: -1 }, { time: 0.9, measure: -1 },
        { time: 3.0, measure: 2, locked: true }, { time: 3.2, measure: -1 }, { time: 3.5, measure: -1 }, { time: 3.9, measure: -1 },
        { time: 4.0, measure: 3 },
    ];
    const out = _tempoFlattenRangePure(beats, 0, 8);
    assert.ok(near(out[4].time, 3.0), 'the locked downbeat held its time');
    assert.ok(near(out[0].time, 0) && near(out[8].time, 4.0), 'ends still pinned');
    for (let i = 1; i < out.length; i++) assert.ok(out[i].time > out[i - 1].time, 'grid stays monotonic');
});

// ── round-trips through the real commands ────────────────────────────
const mkArr = () => ({ name: 'G', notes: [{ string: 0, time: 6, sustain: 0 }], chords: [], anchors: [], anchors_user: [], handshapes: [], phrases: [] });
function seed(beats) {
    trackHooks();
    seedState({ arrangements: [mkArr()], currentArr: 0, sessionId: 's1', beats, sections: [], duration: 20, history: new EditHistory() });
    S.tempoSel = -1;
    S.tempoSelMulti = new Set();
}

t('half-time round-trips exec → undo → redo (times/measures exact)', () => {
    seed(grid(5));
    S.tempoSelMulti = new Set([0, 4, 8, 12, 16]);
    const before = S.beats.map(b => ({ m: b.measure, t: b.time }));
    _tempoHalveRange();
    assert.deepStrictEqual(dbTimes(S.beats), [0, 8, 16], 'halved');
    assert.strictEqual(S.history.undo.length, 1, 'one undoable command');
    S.history.doUndo();
    assert.deepStrictEqual(S.beats.map(b => ({ m: b.measure, t: b.time })), before, 'undo restores every measure + time');
    S.history.doRedo();
    assert.deepStrictEqual(dbTimes(S.beats), [0, 8, 16], 'redo re-applies');
});

t('double-time round-trips exec → undo → redo', () => {
    seed(grid(3));                                       // downbeats 0,4,8
    S.tempoSelMulti = new Set([0, 4, 8]);
    _tempoDoubleRange();
    assert.deepStrictEqual(dbTimes(S.beats), [0, 2, 4, 6, 8], 'split at midpoints');
    assert.strictEqual(S.history.undo.length, 1);
    S.history.doUndo();
    assert.deepStrictEqual(dbTimes(S.beats), [0, 4, 8], 'undo restores the barlines');
});

t('flatten round-trips and the note rides the retimed grid', () => {
    const beats = [
        { time: 0, measure: 1 }, { time: 0.3, measure: -1 }, { time: 0.6, measure: -1 }, { time: 0.9, measure: -1 },
        { time: 3.0, measure: 2 }, { time: 3.2, measure: -1 }, { time: 3.5, measure: -1 }, { time: 3.9, measure: -1 },
        { time: 4.0, measure: 3 },
    ];
    seed(beats);
    S.arrangements[0].notes[0].time = 3.0;               // sits on the interior downbeat (idx 4)
    S.tempoSelMulti = new Set([0, 4, 8]);
    _tempoFlattenRange();
    assert.ok(near(S.beats[4].time, 2.0), 'idx4 flattened to 2.0');
    assert.ok(near(S.arrangements[0].notes[0].time, 2.0), 'the note rode from 3.0 → 2.0');
    assert.strictEqual(S.history.undo.length, 1);
    S.history.doUndo();
    assert.ok(near(S.beats[4].time, 3.0) && near(S.arrangements[0].notes[0].time, 3.0), 'undo restores grid + note');
});

// ── range re-fit bound (opts.toIdx) ──────────────────────────────────
t('a bounded re-fit never proposes past the range\'s last downbeat', () => {
    const g = grid(6);                                   // downbeats 0,4,8,12,16,20
    // Onsets on every downbeat of the same tempo, so an unbounded fit would run
    // the whole song; the bound must stop it at idx 12.
    const onsets = [0, 4, 8, 12, 16, 20].map(tm => ({ t: tm, s: 0.9 }));
    const bounded = _suggestFitPure(g, onsets, 0, { toIdx: 12 });
    assert.ok(bounded.proposals.every(p => p.i <= 12), 'no proposal past the bound');
    assert.strictEqual(bounded.stopDetail, 'bound');
    const free = _suggestFitPure(g, onsets, 0);
    assert.ok(free.proposals.some(p => p.i > 12), 'the unbounded fit does run past idx 12');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
