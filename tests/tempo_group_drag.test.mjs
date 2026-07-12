/*
 * Group drag (PR 5b) — moving a multi-selection of barlines together.
 *
 * Covers the two pures (_tempoGroupDragClampPure / _tempoApplyGroupDragPure):
 * the whole-group clamp against the tightest fixed neighbour, rigid interior
 * spans between two selected poles, edge spans re-spacing against a fixed
 * outside pole, leading-pickup / trailing-tail rigid shift, locked-pole
 * exclusion (locks stay put and act as fixed neighbours), input purity, and a
 * full exec → undo → redo round-trip through TempoMapCmd (notes ride the grid).
 *
 * Run: node tests/tempo_group_drag.test.mjs
 */
import assert from 'node:assert';
import { S } from '../src/state.js';
import { EditHistory } from '../src/history.js';
import {
    TempoMapCmd, MIN_MEASURE,
    _tempoApplyGroupDragPure, _tempoGroupDragClampPure,
} from '../src/tempo.js';
import { seedState, trackHooks } from './_history_env.mjs';

let pass = 0, fail = 0;
function t(name, fn) {
    try { fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}
const near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

// Downbeats at indices 0/4/8/12 (measures 1..4), 1 s beats, 4 s bars.
function grid() {
    const b = [];
    for (let m = 0; m < 4; m++) {
        b.push({ time: m * 4, measure: m + 1 });
        for (let k = 1; k < 4; k++) b.push({ time: m * 4 + k, measure: -1 });
    }
    return b;   // length 16; downbeats at 0,4,8,12
}

// ── clamp math ───────────────────────────────────────────────────────
t('clamp: an in-range Δt passes through untouched', () => {
    assert.ok(near(_tempoGroupDragClampPure(grid(), [4, 8], 0.5, MIN_MEASURE, 16), 0.5));
    assert.ok(near(_tempoGroupDragClampPure(grid(), [4, 8], -0.5, MIN_MEASURE, 16), -0.5));
});

t('clamp: the whole group stops at the tightest fixed neighbour (both sides)', () => {
    // sel {4,8}: nearest fixed pole right of 8 is 12 (hi = 11.95); the binding
    // pole is 8, headroom 11.95 - 8 = 3.95. Left: fixed pole 0 (lo = 0.05),
    // binding pole 4, headroom 4 - 0.05 = 3.95.
    assert.ok(near(_tempoGroupDragClampPure(grid(), [4, 8], 10, MIN_MEASURE, 16), 3.95), 'right clamp');
    assert.ok(near(_tempoGroupDragClampPure(grid(), [4, 8], -10, MIN_MEASURE, 16), -3.95), 'left clamp');
});

t('clamp: the first downbeat can\'t cross the song start; the last rides to duration', () => {
    assert.ok(near(_tempoGroupDragClampPure(grid(), [0], -5, MIN_MEASURE, 16), 0), 'first pole pinned at 0 leftward');
    assert.ok(near(_tempoGroupDragClampPure(grid(), [12], 5, MIN_MEASURE, 16), 4), 'last pole rides to duration 16');
});

t('clamp: a fixed (unselected) pole between two selected ones binds both directions', () => {
    // sel {4,12}, pole 8 unselected & fixed: pole 4 can go right only to 8-.05
    // (3.95), pole 12 can go left only to 8+.05 (3.95).
    assert.ok(near(_tempoGroupDragClampPure(grid(), [4, 12], 10, MIN_MEASURE, 16), 3.95), 'pole 4 stops at 8-.05');
    assert.ok(near(_tempoGroupDragClampPure(grid(), [4, 12], -10, MIN_MEASURE, 16), -3.95), 'pole 12 left head = 12-(8+.05)');
});

// ── apply: rigid interior + edge re-space ────────────────────────────
t('apply: a span between two selected poles rigid-shifts; edge spans re-space', () => {
    const orig = grid();
    const out = _tempoApplyGroupDragPure(orig, [4, 8], 1, MIN_MEASURE, 16);
    // Selected downbeats moved by +1.
    assert.ok(near(out[4].time, 5) && near(out[8].time, 9), 'poles 4,8 → 5,9');
    // Interior of the 4→8 span (both endpoints selected): rigid +1.
    assert.ok(near(out[5].time, 6) && near(out[6].time, 7) && near(out[7].time, 8), 'interior rigid-shifts');
    // Edge span 0(fixed)→4(now 5): interior re-spaces across [0,5].
    assert.ok(near(out[1].time, 1.25) && near(out[2].time, 2.5) && near(out[3].time, 3.75), 'left edge re-spaced to fixed pole 0');
    // Edge span 8(now 9)→12(fixed): interior re-spaces across [9,12].
    assert.ok(near(out[9].time, 9.75) && near(out[10].time, 10.5) && near(out[11].time, 11.25), 'right edge re-spaced to fixed pole 12');
    // The two fixed poles never move.
    assert.ok(near(out[0].time, 0) && near(out[12].time, 12), 'fixed poles held');
});

t('apply: order stays strictly monotonic when slammed to the clamp edge', () => {
    const orig = grid();
    const out = _tempoApplyGroupDragPure(orig, [4, 8], 100, MIN_MEASURE, 16);   // clamps to +3.95
    for (let i = 1; i < out.length; i++) {
        assert.ok(out[i].time > out[i - 1].time, `beats[${i}] ${out[i].time} > ${out[i - 1].time}`);
    }
});

t('apply: leading pickup and trailing tail rigid-shift with their end downbeat', () => {
    // Pickup before bar 1, and a trailing sub-beat past the last downbeat.
    const orig = [
        { time: 0.0, measure: -1 },   // pickup
        { time: 0.5, measure: -1 },   // pickup
        { time: 1.0, measure: 1 },
        { time: 2.0, measure: -1 },
        { time: 3.0, measure: 2 },
        { time: 4.0, measure: -1 },   // trailing tail
    ];
    // Move both downbeats (the whole grid) right by +0.5.
    const out = _tempoApplyGroupDragPure(orig, [2, 4], 0.5, MIN_MEASURE, 10);
    assert.ok(near(out[0].time, 0.5) && near(out[1].time, 1.0), 'pickup rigid-shifts with bar 1');
    assert.ok(near(out[2].time, 1.5) && near(out[4].time, 3.5), 'downbeats moved');
    assert.ok(near(out[5].time, 4.5), 'trailing tail rigid-shifts with the last downbeat');
});

// ── locks: excluded from the group, act as fixed neighbours ──────────
t('apply: a locked pole in the selection stays put and pins its neighbours', () => {
    const orig = grid();
    orig[8].locked = true;
    // Pass both — the locked 8 must be dropped from the moving group.
    const out = _tempoApplyGroupDragPure(orig, [4, 8], 1, MIN_MEASURE, 16);
    assert.ok(near(out[8].time, 8), 'locked pole never moves');
    assert.strictEqual(out[8].locked, true, 'lock flag preserved');
    assert.ok(near(out[4].time, 5), 'the unlocked pole moves');
    // The 4→8 span now re-spaces against the FIXED locked pole 8 (edge behaviour).
    assert.ok(near(out[5].time, 5.75) && near(out[6].time, 6.5) && near(out[7].time, 7.25), 'interior re-spaces to the locked pole');
});

t('apply: an all-locked selection is a no-op', () => {
    const orig = grid();
    orig[4].locked = true; orig[8].locked = true;
    const out = _tempoApplyGroupDragPure(orig, [4, 8], 1, MIN_MEASURE, 16);
    assert.deepStrictEqual(out.map(b => b.time), orig.map(b => b.time), 'nothing moved');
});

// ── purity ───────────────────────────────────────────────────────────
t('apply: the input grid is never mutated', () => {
    const orig = grid();
    const snapshot = orig.map(b => b.time);
    _tempoApplyGroupDragPure(orig, [4, 8], 2, MIN_MEASURE, 16);
    assert.deepStrictEqual(orig.map(b => b.time), snapshot, 'orig untouched');
});

t('apply: empty / invalid selection returns an untouched copy (not the same ref)', () => {
    const orig = grid();
    const out = _tempoApplyGroupDragPure(orig, [], 1, MIN_MEASURE, 16);
    assert.notStrictEqual(out, orig);
    assert.deepStrictEqual(out.map(b => b.time), orig.map(b => b.time));
});

// ── round-trip through TempoMapCmd (notes ride the grid) ─────────────
const mkArr = () => ({
    name: 'G', notes: [{ string: 0, time: 6, sustain: 0 }],
    chords: [], anchors: [], anchors_user: [], handshapes: [], phrases: [],
});

t('exec → undo → redo round-trips beats and notes exactly', () => {
    trackHooks();
    seedState({ arrangements: [mkArr()], currentArr: 0, sessionId: 's1', beats: grid(), sections: [], duration: 16, history: new EditHistory() });
    const orig = S.beats.map(b => ({ ...b }));
    const before = orig.map(b => b.time);
    const noteBefore = S.arrangements[0].notes[0].time;   // 6, inside the 4→8 span

    const moved = _tempoApplyGroupDragPure(orig, [4, 8], 1, MIN_MEASURE, 16);
    S.history.exec(new TempoMapCmd(orig, moved, 'group-drag'));
    assert.ok(near(S.beats[4].time, 5) && near(S.beats[8].time, 9), 'exec moved the poles');
    // The note sat at t=6 (beat 6, mid-span); the span rigid-shifted +1, so it rides to 7.
    assert.ok(near(S.arrangements[0].notes[0].time, noteBefore + 1), 'note rode the grid (+1s)');
    assert.strictEqual(S.history.undo.length, 1, 'exactly one undo entry');

    S.history.doUndo();
    assert.deepStrictEqual(S.beats.map(b => b.time), before, 'undo restores every beat time');
    assert.ok(near(S.arrangements[0].notes[0].time, noteBefore), 'undo restores the note');

    S.history.doRedo();
    assert.deepStrictEqual(S.beats.map(b => b.time), moved.map(b => b.time), 'redo re-applies the move');
    assert.ok(near(S.arrangements[0].notes[0].time, noteBefore + 1), 'redo rides the note again');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
