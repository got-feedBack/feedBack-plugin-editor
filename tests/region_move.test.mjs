/*
 * Region MOVE (PR 3): repositioning a track's content as a block.
 *
 * Pinned here:
 *   - the time model (_regionRemapPure): a move preserves MUSICAL position
 *     (beat), not wall-clock seconds — so on a VARYING grid it gives a different
 *     result than a constant-seconds shift would, and a sustained note keeps its
 *     beat-length. The constant-tempo FAST PATH is bit-exact.
 *   - MoveRegionCmd round-trips: exec → rollback restores the model EXACTLY
 *     (deep-equal notes / hits AND the track's regions[]), and redo reproduces
 *     the post-exec state — for a notation arrangement AND for the drum tab.
 *   - a BOUNDED region rides its window startBeat with the move (and restores,
 *     including a move that re-sorts it past a neighbour in regions[]); the
 *     implicit DEFAULT full-span region leaves regions[] untouched (byte-
 *     identical), carrying the move purely in its content.
 *   - zero-delta is a true no-op; bar-snap picks the nearest downbeat.
 *
 * This suite fails on main: src/region-commands.js and the move pures in
 * src/region.js do not exist there.
 *
 * Run: node tests/region_move.test.mjs
 */
import assert from 'node:assert';

import { beatOf, timeOf } from '../src/beats.js';
import {
    _regionConstantShiftPure, _regionRemapPure, _regionSnapStartPure,
} from '../src/region.js';
import { MoveRegionCmd } from '../src/region-commands.js';
import { EditHistory } from '../src/history.js';
import { S } from '../src/state.js';
import { seedState, trackHooks } from './_history_env.mjs';

let pass = 0; let fail = 0;
const tests = [];
const t = (name, fn) => tests.push([name, fn]);
const clone = (v) => JSON.parse(JSON.stringify(v));

// ── Grids ─────────────────────────────────────────────────────────────
// Constant 120 BPM (0.5 s/beat), 8 beats over 2 bars.
function constGrid() {
    const b = [];
    for (let i = 0; i < 9; i++) b.push({ time: i * 0.5, measure: i % 4 === 0 ? i / 4 + 1 : 0 });
    return b;
}
// Varying: beats 0..4 at 0.5 s/beat, beats 4..8 at 1.0 s/beat.
function varyGrid() {
    const b = [];
    for (let i = 0; i <= 4; i++) b.push({ time: i * 0.5, measure: i % 4 === 0 ? i / 4 + 1 : 0 });
    for (let i = 5; i <= 8; i++) b.push({ time: 2.0 + (i - 4) * 1.0, measure: i % 4 === 0 ? i / 4 + 1 : 0 });
    return b;
}
const note = (time, sustain = 0, string = 0, fret = 0) => ({ time, sustain, string, fret, techniques: {} });
const DEFAULT_REGION = { id: 'region:1', startBeat: 0, lenBeat: null };

// ── The pure time model ───────────────────────────────────────────────
t('_regionConstantShiftPure: uniform grid → exact seconds shift; varying → null', () => {
    assert.strictEqual(_regionConstantShiftPure(constGrid(), 4), 2.0, '4 beats × 0.5 s');
    assert.strictEqual(_regionConstantShiftPure(varyGrid(), 4), null, 'varying → per-note remap');
    assert.strictEqual(_regionConstantShiftPure([], 3), 3, 'degenerate grid is seconds-primary');
});

t('_regionRemapPure: constant tempo is a bit-exact constant shift, durations untouched', () => {
    const beats = constGrid();
    const { times, sustains } = _regionRemapPure([0.5, 1.25], [0.25, 0], 3, beats, beatOf, timeOf);
    assert.deepStrictEqual(times, [2.0, 2.75], '+3 beats = +1.5 s exactly');
    assert.deepStrictEqual(sustains, [0.25, 0], 'a constant shift never changes duration');
});

t('_regionRemapPure: varying tempo PRESERVES the beat (musical position), not the seconds', () => {
    const beats = varyGrid();
    // A note at beat 1 (t=0.5) moved +4 beats lands at beat 5 — which on this
    // grid is t=3.0 (crossed into the 1.0 s/beat half). A constant-seconds shift
    // (what a naive move would do) would land it elsewhere; beat-preservation is
    // the contract.
    const src = 0.5;                       // beat 1
    assert.strictEqual(beatOf(beats, src), 1, 'fixture: t=0.5 is beat 1');
    const { times } = _regionRemapPure([src], [0], 4, beats, beatOf, timeOf);
    assert.ok(Math.abs(beatOf(beats, times[0]) - 5) < 1e-9, 'new beat = old beat + 4');
    assert.strictEqual(times[0], 3.0, 'beat 5 sits at t=3.0 on the varying grid');
});

t('_regionRemapPure: a sustained note keeps its BEAT-length across a tempo change', () => {
    const beats = varyGrid();
    // A one-beat note at beat 3 (t=1.5, sustain to beat 4 at t=2.0 → 0.5 s) moved
    // +2 beats becomes beat 5→6, which is t=3.0→4.0 → a 1.0 s duration (tempo
    // halved), still exactly one beat long.
    const { times, sustains } = _regionRemapPure([1.5], [0.5], 2, beats, beatOf, timeOf);
    assert.strictEqual(times[0], 3.0);
    assert.ok(Math.abs(sustains[0] - 1.0) < 1e-9, 'still one beat, now 1.0 s at the slower tempo');
});

t('_regionSnapStartPure: nearest downbeat, Alt=free, clamps to 0', () => {
    const bars = [0, 2, 4, 6];
    assert.strictEqual(_regionSnapStartPure(bars, 2.3, false), 2, 'snaps down to nearest bar');
    assert.strictEqual(_regionSnapStartPure(bars, 3.4, false), 4, 'snaps up to nearest bar');
    assert.strictEqual(_regionSnapStartPure(bars, 2.3, true), 2.3, 'Alt bypasses the snap');
    assert.strictEqual(_regionSnapStartPure([], 3.4, false), 3.4, 'no bars → free');
    assert.strictEqual(_regionSnapStartPure(bars, -5, false), 0, 'never negative');
});

// ── MoveRegionCmd: notation round-trip ────────────────────────────────
function seedNotation({ beats = constGrid(), notes, regions } = {}) {
    const arr = { name: 'Lead', notes };
    const trackSession = {
        version: 3, tracks: [
            { id: 'transcription:Lead', type: 'transcription', targetId: 'Lead', ...(regions ? { regions } : {}) },
        ], removedSourceIds: [], tempoGuideSourceId: '', tempoGuideLocked: false, tempoGuideMode: 'audio',
    };
    seedState({ arrangements: [arr], currentArr: 0, beats, drumTab: null, trackSession });
    S.history = new EditHistory();
    trackHooks();
    return arr;
}

t('notation default-region move: exec → rollback deep-equals → redo reproduces', () => {
    const arr = seedNotation({ notes: [note(0.5, 0.25), note(1.0), note(1.5, 0.5)] });
    const before = clone(arr.notes);
    const cmd = new MoveRegionCmd({ kind: 'notation', arrIdx: 0, trackId: 'transcription:Lead', region: DEFAULT_REGION, dBeat: 2 });
    cmd.exec();
    const after = clone(arr.notes);
    assert.notDeepStrictEqual(after, before, 'the move changed the notes');
    assert.deepStrictEqual(arr.notes.map(n => n.time), [1.5, 2.0, 2.5], 'each onset +1.0 s (+2 beats @120)');
    cmd.rollback();
    assert.deepStrictEqual(arr.notes, before, 'rollback restores the notes EXACTLY');
    cmd.exec();
    assert.deepStrictEqual(arr.notes, after, 'redo reproduces the post-exec state');
});

t('notation default-region move leaves regions[] untouched (byte-identical)', () => {
    seedNotation({ notes: [note(0.5), note(1.0)] });
    const track = S.trackSession.tracks[0];
    const cmd = new MoveRegionCmd({ kind: 'notation', arrIdx: 0, trackId: 'transcription:Lead', region: DEFAULT_REGION, dBeat: 4 });
    cmd.exec();
    assert.ok(!('regions' in track), 'a default-region move writes no regions key');
    cmd.rollback();
    assert.ok(!('regions' in track), 'and rollback leaves none behind');
});

t('notation move preserves musical position on a VARYING grid (beat, not seconds)', () => {
    const arr = seedNotation({ beats: varyGrid(), notes: [note(0.5), note(1.5, 0.5)] });
    const beforeBeats = arr.notes.map(n => beatOf(S.beats, n.time));
    new MoveRegionCmd({ kind: 'notation', arrIdx: 0, trackId: 'transcription:Lead', region: DEFAULT_REGION, dBeat: 3 }).exec();
    const afterBeats = arr.notes.map(n => beatOf(S.beats, n.time));
    afterBeats.forEach((b, i) => assert.ok(Math.abs(b - (beforeBeats[i] + 3)) < 1e-9, `note ${i} beat rode +3`));
});

t('zero-delta move is a true no-op (notes and regions untouched)', () => {
    const arr = seedNotation({ notes: [note(0.5, 0.25), note(1.0)] });
    const before = clone(arr.notes);
    const cmd = new MoveRegionCmd({ kind: 'notation', arrIdx: 0, trackId: 'transcription:Lead', region: DEFAULT_REGION, dBeat: 0 });
    cmd.exec();
    assert.deepStrictEqual(arr.notes, before, 'no note moved');
    cmd.rollback();
    assert.deepStrictEqual(arr.notes, before, 'rollback is a no-op too');
});

// ── MoveRegionCmd: bounded region rides its window ─────────────────────
t('bounded-region move rides startBeat, shifts only its notes, and restores both', () => {
    // Two regions on one track. Region B ([4,8)) owns the two later notes; A
    // ([0,4)) owns the first. Move B by +4 beats — it should slide its notes AND
    // its window past A in regions[] (normalize re-sorts), leaving A untouched.
    const regions = [
        { id: 'A', startBeat: 0, lenBeat: 4 },
        { id: 'B', startBeat: 4, lenBeat: 4 },
    ];
    const arr = seedNotation({
        notes: [note(0.5), note(2.0, 0.5), note(2.5)],   // beats 1, 4, 5 @120 (0.5s/beat)
        regions,
    });
    const track = S.trackSession.tracks[0];
    const notesBefore = clone(arr.notes);
    const regionsBefore = clone(track.regions);
    const cmd = new MoveRegionCmd({
        kind: 'notation', arrIdx: 0, trackId: 'transcription:Lead',
        region: { id: 'B', startBeat: 4, lenBeat: 4 }, dBeat: 4,
    });
    cmd.exec();
    // A's note (beat 1, t=0.5) is untouched; B's notes (beats 4,5) rode +4 → t=4.0, 4.5.
    assert.deepStrictEqual(arr.notes.map(n => n.time), [0.5, 4.0, 4.5], 'only B’s notes moved');
    assert.deepStrictEqual(track.regions, [
        { id: 'A', startBeat: 0, lenBeat: 4 },
        { id: 'B', startBeat: 8, lenBeat: 4 },
    ], 'B’s window rode +4 beats; regions re-sorted/normalized');
    cmd.rollback();
    assert.deepStrictEqual(arr.notes, notesBefore, 'notes restored exactly');
    assert.deepStrictEqual(track.regions, regionsBefore, 'regions[] restored exactly');
    cmd.exec();
    assert.deepStrictEqual(track.regions[1], { id: 'B', startBeat: 8, lenBeat: 4 }, 'redo reproduces the ride');
});

// ── MoveRegionCmd: drums ──────────────────────────────────────────────
t('drum-tab region move: hits round-trip and the tab is marked dirty', () => {
    const drumTab = { version: 1, name: 'Drums', kit: [], hits: [{ t: 0.5, p: 36 }, { t: 1.0, p: 38 }, { t: 1.5, p: 42 }] };
    seedState({ arrangements: [], currentArr: 0, beats: constGrid(), drumTab,
        trackSession: { version: 3, tracks: [{ id: 'transcription:drums', type: 'transcription', targetId: 'drums' }], removedSourceIds: [], tempoGuideSourceId: '', tempoGuideLocked: false, tempoGuideMode: 'audio' } });
    S.history = new EditHistory();
    trackHooks();
    const before = clone(drumTab.hits);
    S.drumTabDirty = false;
    const cmd = new MoveRegionCmd({ kind: 'drums', trackId: 'transcription:drums', region: DEFAULT_REGION, dBeat: 2 });
    cmd.exec();
    assert.deepStrictEqual(drumTab.hits.map(h => h.t), [1.5, 2.0, 2.5], 'every hit +1.0 s');
    assert.strictEqual(S.drumTabDirty, true, 'a drum move dirties the tab');
    cmd.rollback();
    assert.deepStrictEqual(drumTab.hits, before, 'rollback restores hits exactly');
});

// ── Through EditHistory (the real exec path) ──────────────────────────
t('via S.history.exec: not refused by the roll lock; undo/redo restore', () => {
    const arr = seedNotation({ notes: [note(0.5), note(1.0, 0.25)] });
    const before = clone(arr.notes);
    S.history.exec(new MoveRegionCmd({ kind: 'notation', arrIdx: 0, trackId: 'transcription:Lead', region: DEFAULT_REGION, dBeat: 2 }));
    assert.deepStrictEqual(arr.notes.map(n => n.time), [1.5, 2.0], 'the command ran (pitchPreserving passes the lock)');
    S.history.doUndo();
    assert.deepStrictEqual(arr.notes, before, 'undo restores');
    S.history.doRedo();
    assert.deepStrictEqual(arr.notes.map(n => n.time), [1.5, 2.0], 'redo re-applies');
});

for (const [name, fn] of tests) {
    try { await fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
