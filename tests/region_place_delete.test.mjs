/*
 * Region PLACE + DELETE (PR 3 / R3b): the "Add Track from File" driver's
 * command layer — drop imported content onto the timeline as a bounded,
 * selectable, draggable block, and remove a block (content + window) as one
 * undoable edit.
 *
 * Pinned here:
 *   - PlaceRegionCmd slides content so its first onset lands on `startBeat`
 *     (a MUSICAL move — beats preserved on a varying grid), writes a BOUNDED
 *     region covering it (explicit lenBeat, never the implicit default — even
 *     at bar 1 / startBeat 0), and lands it SELECTED.
 *   - the placed region is a real draggable block: a subsequent MoveRegionCmd
 *     rides its window and shifts only its notes.
 *   - DeleteRegionCmd removes exactly the notes/hits its window owns (membership
 *     by beat) and drops the region entry, leaving neighbours untouched.
 *   - round-trips: exec → rollback restores the model EXACTLY (deep-equal notes/
 *     hits AND regions[] AND selection), and redo reproduces the post-exec state
 *     — for a notation arrangement AND for the drum tab, incl. through the real
 *     S.history.exec path.
 *   - _nextRegionIdPure never collides with the implicit default region:1.
 *
 * This suite fails on main: PlaceRegionCmd / DeleteRegionCmd / _nextRegionIdPure
 * do not exist there.
 *
 * Run: node tests/region_place_delete.test.mjs
 */
import assert from 'node:assert';

import { seedState, trackHooks } from './_history_env.mjs';
import { beatOf } from '../src/beats.js';
import { DEFAULT_REGION_ID, _nextRegionIdPure, _placeAtStartBeatPure, _regionsAreDefaultPure } from '../src/region.js';
import { DeleteRegionCmd, MoveRegionCmd, PlaceRegionCmd } from '../src/region-commands.js';
import { EditHistory } from '../src/history.js';
import { S } from '../src/state.js';
import { placeImportedPartAsRegion } from '../src/track-session.js';

let pass = 0; let fail = 0;
const tests = [];
const t = (name, fn) => tests.push([name, fn]);
const clone = (v) => JSON.parse(JSON.stringify(v));

// Constant 120 BPM (0.5 s/beat), 4 beats/bar.
function constGrid() {
    const b = [];
    for (let i = 0; i < 13; i++) b.push({ time: i * 0.5, measure: i % 4 === 0 ? i / 4 + 1 : 0 });
    return b;
}
// Varying: beats 0..4 @ 0.5 s/beat, beats 4..12 @ 1.0 s/beat.
function varyGrid() {
    const b = [];
    for (let i = 0; i <= 4; i++) b.push({ time: i * 0.5, measure: i % 4 === 0 ? i / 4 + 1 : 0 });
    for (let i = 5; i <= 12; i++) b.push({ time: 2.0 + (i - 4) * 1.0, measure: i % 4 === 0 ? i / 4 + 1 : 0 });
    return b;
}
const note = (time, sustain = 0, string = 0, fret = 0) => ({ time, sustain, string, fret, techniques: {} });

function seedNotation({ beats = constGrid(), notes, regions } = {}) {
    const arr = { name: 'Lead', notes };
    const trackSession = {
        version: 3, tracks: [
            { id: 'transcription:Lead', type: 'transcription', targetId: 'Lead', ...(regions ? { regions } : {}) },
        ], removedSourceIds: [], tempoGuideSourceId: '', tempoGuideLocked: false, tempoGuideMode: 'audio',
    };
    seedState({ arrangements: [arr], currentArr: 0, beats, drumTab: null, trackSession,
        selectedTrackId: '', selectedRegionId: '' });
    S.history = new EditHistory();
    trackHooks();
    return arr;
}

function seedDrums({ beats = constGrid(), hits } = {}) {
    const drumTab = { version: 1, name: 'Drums', kit: [], hits };
    seedState({ arrangements: [], currentArr: 0, beats, drumTab,
        trackSession: { version: 3, tracks: [{ id: 'transcription:drums', type: 'transcription', targetId: 'drums' }],
            removedSourceIds: [], tempoGuideSourceId: '', tempoGuideLocked: false, tempoGuideMode: 'audio' },
        selectedTrackId: '', selectedRegionId: '' });
    S.history = new EditHistory();
    trackHooks();
    S.drumTabDirty = false;
    return drumTab;
}

// ── _nextRegionIdPure ─────────────────────────────────────────────────
t('_nextRegionIdPure: fresh track → region:2; never collides with the default', () => {
    assert.strictEqual(_nextRegionIdPure(undefined), 'region:2', 'no regions → region:2 (past the implicit region:1)');
    assert.strictEqual(_nextRegionIdPure([]), 'region:2');
    assert.strictEqual(_nextRegionIdPure([{ id: 'region:1', startBeat: 0, lenBeat: null }]), 'region:2', 'default counted');
    assert.strictEqual(_nextRegionIdPure([{ id: 'region:2', startBeat: 4, lenBeat: 4 }]), 'region:3');
    assert.strictEqual(_nextRegionIdPure([{ id: 'region:5', startBeat: 8, lenBeat: 4 }]), 'region:6', 'one past the max');
    assert.strictEqual(_nextRegionIdPure([{ id: 'weird', startBeat: 0, lenBeat: 2 }]), 'region:2', 'non-numeric ignored');
});

// ── PlaceRegionCmd: notation ──────────────────────────────────────────
t('place: slides content to startBeat, writes a bounded region, lands selected; round-trips', () => {
    // Notes at beats 1, 2, 3 (last sustains 1 beat → content ends at beat 4).
    const arr = seedNotation({ notes: [note(0.5), note(1.0), note(1.5, 0.5)] });
    const track = S.trackSession.tracks[0];
    const before = clone(arr.notes);
    const cmd = new PlaceRegionCmd({ kind: 'notation', arrIdx: 0, trackId: 'transcription:Lead', startBeat: 4 });
    cmd.exec();
    // minBeat 1 → startBeat 4 is dBeat +3 = +1.5 s @120.
    assert.deepStrictEqual(arr.notes.map(n => n.time), [2.0, 2.5, 3.0], 'onsets rode +3 beats to bar 2');
    assert.strictEqual(arr.notes[2].sustain, 0.5, 'constant-tempo shift keeps the sustain');
    assert.deepStrictEqual(track.regions, [{ id: 'region:2', startBeat: 4, lenBeat: 3 }], 'bounded region covers the block');
    assert.strictEqual(S.selectedTrackId, 'transcription:Lead', 'track selected');
    assert.strictEqual(S.selectedRegionId, 'region:2', 'placed region selected');
    const after = clone(arr.notes);
    cmd.rollback();
    assert.deepStrictEqual(arr.notes, before, 'rollback restores notes EXACTLY');
    assert.ok(!('regions' in track), 'rollback removes the regions key that was never there');
    assert.strictEqual(S.selectedRegionId, '', 'prior (empty) selection restored');
    cmd.exec();
    assert.deepStrictEqual(arr.notes, after, 'redo reproduces the placed notes');
    assert.deepStrictEqual(track.regions, [{ id: 'region:2', startBeat: 4, lenBeat: 3 }], 'redo reproduces the region');
});

t('place at bar 1 (startBeat 0) is still BOUNDED, never the implicit default', () => {
    const arr = seedNotation({ notes: [note(1.0), note(1.5)] });   // beats 2, 3
    const track = S.trackSession.tracks[0];
    new PlaceRegionCmd({ kind: 'notation', arrIdx: 0, trackId: 'transcription:Lead', startBeat: 0 }).exec();
    assert.deepStrictEqual(arr.notes.map(n => n.time), [0.0, 0.5], 'content pulled to beat 0');
    assert.strictEqual(track.regions.length, 1, 'one region');
    assert.ok(track.regions[0].lenBeat > 0, 'explicit length → a real bounded block');
    assert.strictEqual(_regionsAreDefaultPure(track.regions), false, 'NOT the implicit default region');
});

t('place: zero-sustain tail onset stays strictly inside the region window', () => {
    const arr = seedNotation({ notes: [note(0.5), note(1.0)] });   // beats 1, 2, both sustain 0
    const track = S.trackSession.tracks[0];
    new PlaceRegionCmd({ kind: 'notation', arrIdx: 0, trackId: 'transcription:Lead', startBeat: 0 }).exec();
    const r = track.regions[0];
    const lastBeat = beatOf(S.beats, arr.notes[arr.notes.length - 1].time);
    assert.ok(lastBeat < r.startBeat + r.lenBeat, 'end-exclusive window still owns its last onset');
});

t('place preserves musical position on a VARYING grid (beats, not seconds)', () => {
    const arr = seedNotation({ beats: varyGrid(), notes: [note(0.5), note(1.5, 0.5)] });   // beats 1, 3
    new PlaceRegionCmd({ kind: 'notation', arrIdx: 0, trackId: 'transcription:Lead', startBeat: 5 }).exec();
    // minBeat 1 → startBeat 5 = +4 beats. Onsets should land on beats 5 and 7.
    const beats = S.beats;
    assert.ok(Math.abs(beatOf(beats, arr.notes[0].time) - 5) < 1e-9, 'first onset rode to beat 5');
    assert.ok(Math.abs(beatOf(beats, arr.notes[1].time) - 7) < 1e-9, 'second onset rode to beat 7');
});

t('a PLACED region is a real draggable block: MoveRegionCmd rides it', () => {
    const arr = seedNotation({ notes: [note(0.5), note(1.0, 0.5)] });   // beats 1, 2
    const track = S.trackSession.tracks[0];
    S.history.exec(new PlaceRegionCmd({ kind: 'notation', arrIdx: 0, trackId: 'transcription:Lead', startBeat: 4 }));
    const placed = clone(track.regions[0]);
    const notesAfterPlace = clone(arr.notes);
    S.history.exec(new MoveRegionCmd({ kind: 'notation', arrIdx: 0, trackId: 'transcription:Lead', region: track.regions[0], dBeat: 4 }));
    assert.strictEqual(track.regions[0].startBeat, placed.startBeat + 4, 'the placed window rode the drag +4 beats');
    S.history.doUndo();      // undo the move
    assert.deepStrictEqual(arr.notes, notesAfterPlace, 'undo restores the placed notes');
    assert.deepStrictEqual(track.regions[0], placed, 'undo restores the placed window');
});

// ── PlaceRegionCmd: drums ─────────────────────────────────────────────
t('place drums: hits slide, a region lands on the drum track, tab dirtied; round-trips', () => {
    const drumTab = seedDrums({ hits: [{ t: 0.5, p: 36 }, { t: 1.0, p: 38 }, { t: 1.5, p: 42 }] });   // beats 1,2,3
    const track = S.trackSession.tracks[0];
    const before = clone(drumTab.hits);
    const cmd = new PlaceRegionCmd({ kind: 'drums', trackId: 'transcription:drums', startBeat: 4 });
    cmd.exec();
    assert.deepStrictEqual(drumTab.hits.map(h => h.t), [2.0, 2.5, 3.0], 'hits rode +3 beats');
    assert.strictEqual(S.drumTabDirty, true, 'placing dirties the tab');
    assert.strictEqual(track.regions.length, 1, 'a region landed on the drum track');
    assert.strictEqual(S.selectedRegionId, track.regions[0].id, 'placed drum region selected');
    cmd.rollback();
    assert.deepStrictEqual(drumTab.hits, before, 'rollback restores hits EXACTLY');
    assert.ok(!('regions' in track), 'and removes the region key');
});

// ── DeleteRegionCmd: notation ─────────────────────────────────────────
t('delete: removes only the block’s notes + its entry; leaves neighbours; round-trips', () => {
    // A owns beat 1; B owns beats 4, 5.
    const regions = [{ id: 'A', startBeat: 0, lenBeat: 4 }, { id: 'B', startBeat: 4, lenBeat: 4 }];
    const arr = seedNotation({ notes: [note(0.5), note(2.0, 0.25), note(2.5)], regions });   // beats 1, 4, 5
    const track = S.trackSession.tracks[0];
    S.selectedTrackId = 'transcription:Lead';
    S.selectedRegionId = 'B';
    const notesBefore = clone(arr.notes);
    const regionsBefore = clone(track.regions);
    const cmd = new DeleteRegionCmd({ kind: 'notation', arrIdx: 0, trackId: 'transcription:Lead', region: { id: 'B', startBeat: 4, lenBeat: 4 } });
    cmd.exec();
    assert.deepStrictEqual(arr.notes.map(n => n.time), [0.5], 'only A’s note survives');
    assert.deepStrictEqual(track.regions, [{ id: 'A', startBeat: 0, lenBeat: 4 }], 'B’s entry dropped, A kept');
    assert.strictEqual(S.selectedRegionId, '', 'the deleted region is deselected');
    cmd.rollback();
    assert.deepStrictEqual(arr.notes, notesBefore, 'notes restored exactly (order + values)');
    assert.deepStrictEqual(track.regions, regionsBefore, 'regions[] restored exactly');
    assert.strictEqual(S.selectedRegionId, 'B', 'selection restored');
    cmd.exec();
    assert.deepStrictEqual(arr.notes.map(n => n.time), [0.5], 'redo re-deletes');
});

t('delete respects the end-exclusive window (a note ON the boundary is a neighbour’s)', () => {
    // Region [0,4): owns beats 0..3; the note at beat 4 belongs to the next block.
    const regions = [{ id: 'A', startBeat: 0, lenBeat: 4 }, { id: 'B', startBeat: 4, lenBeat: 4 }];
    const arr = seedNotation({ notes: [note(1.5), note(2.0)], regions });   // beats 3, 4
    new DeleteRegionCmd({ kind: 'notation', arrIdx: 0, trackId: 'transcription:Lead', region: { id: 'A', startBeat: 0, lenBeat: 4 } }).exec();
    assert.deepStrictEqual(arr.notes.map(n => n.time), [2.0], 'beat 3 deleted; beat 4 (B’s edge) kept');
});

// ── DeleteRegionCmd: drums ────────────────────────────────────────────
t('delete drums: removes the windowed hits + entry; round-trips and dirties', () => {
    const drumTab = seedDrums({ hits: [{ t: 0.5, p: 36 }, { t: 2.0, p: 38 }, { t: 2.5, p: 42 }] });   // beats 1, 4, 5
    const track = S.trackSession.tracks[0];
    track.regions = [{ id: 'B', startBeat: 4, lenBeat: 4 }];   // owns beats 4, 5
    const before = clone(drumTab.hits);
    const cmd = new DeleteRegionCmd({ kind: 'drums', trackId: 'transcription:drums', region: { id: 'B', startBeat: 4, lenBeat: 4 } });
    cmd.exec();
    assert.deepStrictEqual(drumTab.hits.map(h => h.t), [0.5], 'the two windowed hits removed');
    assert.strictEqual(S.drumTabDirty, true, 'delete dirties the tab');
    assert.deepStrictEqual(track.regions, [], 'the region entry is gone');
    cmd.rollback();
    assert.deepStrictEqual(drumTab.hits, before, 'rollback restores hits EXACTLY');
});

// ── Multi-drum seam: commands act on the part the TRACK names ─────────
// A song can hold several drum parts; S.drumTab is only the ACTIVE grid
// target. A region command must resolve the tab from arrIdx (the part whose
// track carries the region) — never assume the active tab.
function seedTwoDrumParts() {
    const primaryTab = { version: 1, name: 'Drums', kit: [], hits: [{ t: 0.5, p: 36 }, { t: 1.0, p: 38 }] };
    const extraTab = { version: 1, name: 'Drums 2', kit: [], hits: [{ t: 0.5, p: 42 }, { t: 1.5, p: 42 }] };
    const arrs = [
        { id: 'lead', name: 'Lead', notes: [{ time: 0.5, sustain: 0, string: 0, fret: 0, techniques: {} }], chords: [] },
        { id: 'drums', name: 'Drums', type: 'drums', drumTab: primaryTab, notes: [], chords: [] },
        { id: 'drums-2', name: 'Drums 2', type: 'drums', drumTab: extraTab, notes: [], chords: [] },
    ];
    seedState({ arrangements: arrs, currentArr: 0, beats: constGrid(), drumTab: primaryTab,
        trackSession: { version: 3, tracks: [
            { id: 'transcription:lead', type: 'transcription', targetId: 'lead' },
            { id: 'transcription:drums', type: 'transcription', targetId: 'drums' },
            { id: 'transcription:drums-2', type: 'transcription', targetId: 'drums-2' },
        ], removedSourceIds: [], tempoGuideSourceId: '', tempoGuideLocked: false, tempoGuideMode: 'audio' },
        selectedTrackId: '', selectedRegionId: '' });
    S.history = new EditHistory();
    trackHooks();
    S.drumTabDirty = false;
    return { primaryTab, extraTab };
}

t('move on a NON-ACTIVE drum part shifts ITS hits; the active tab is untouched', () => {
    const { primaryTab, extraTab } = seedTwoDrumParts();
    const primaryBefore = clone(primaryTab.hits);
    const extraBefore = clone(extraTab.hits);
    const cmd = new MoveRegionCmd({ kind: 'drums', arrIdx: 2, trackId: 'transcription:drums-2',
        region: { id: 'region:1', startBeat: 0, lenBeat: null }, dBeat: 2 });
    cmd.exec();
    assert.deepStrictEqual(extraTab.hits.map(h => h.t), [1.5, 2.5], 'the part’s own hits rode +2 beats');
    assert.deepStrictEqual(primaryTab.hits, primaryBefore, 'the ACTIVE tab (primary) never moved');
    cmd.rollback();
    assert.deepStrictEqual(extraTab.hits, extraBefore, 'rollback restores the part’s hits exactly');
    assert.deepStrictEqual(primaryTab.hits, primaryBefore, 'primary still untouched after rollback');
});

t('place on a NON-ACTIVE drum part slides ITS hits + regions land on ITS track', () => {
    const { primaryTab, extraTab } = seedTwoDrumParts();
    const primaryBefore = clone(primaryTab.hits);
    const track = S.trackSession.tracks[2];
    const cmd = new PlaceRegionCmd({ kind: 'drums', arrIdx: 2, trackId: 'transcription:drums-2', startBeat: 4 });
    cmd.exec();
    assert.deepStrictEqual(extraTab.hits.map(h => h.t), [2.0, 3.0], 'the part’s hits placed at bar 2');
    assert.deepStrictEqual(primaryTab.hits, primaryBefore, 'the ACTIVE tab (primary) never moved');
    assert.strictEqual(track.regions.length, 1, 'the region landed on the part’s OWN track');
    assert.ok(!('regions' in S.trackSession.tracks[1]), 'not on the primary’s track');
    cmd.rollback();
    assert.ok(!('regions' in track), 'rollback clears it');
});

t('delete on a NON-ACTIVE drum part removes ITS windowed hits only', () => {
    const { primaryTab, extraTab } = seedTwoDrumParts();
    const primaryBefore = clone(primaryTab.hits);
    S.trackSession.tracks[2].regions = [{ id: 'B', startBeat: 0, lenBeat: 2 }];   // owns beats 0..1
    new DeleteRegionCmd({ kind: 'drums', arrIdx: 2, trackId: 'transcription:drums-2',
        region: { id: 'B', startBeat: 0, lenBeat: 2 } }).exec();
    assert.deepStrictEqual(extraTab.hits.map(h => h.t), [1.5], 'only the windowed hit (beat 1) removed');
    assert.deepStrictEqual(primaryTab.hits, primaryBefore, 'the ACTIVE tab untouched');
});

t('legacy fallback: kind drums with NO arrIdx still targets S.drumTab', () => {
    const { primaryTab } = seedTwoDrumParts();
    const cmd = new MoveRegionCmd({ kind: 'drums', trackId: 'transcription:drums',
        region: { id: 'region:1', startBeat: 0, lenBeat: null }, dBeat: 2 });
    cmd.exec();
    assert.deepStrictEqual(primaryTab.hits.map(h => h.t), [1.5, 2.0], 'no arrIdx → the active tab moved (legacy path)');
});

// ── _placeAtStartBeatPure (the import dialog's "Place at" resolution) ─
t('_placeAtStartBeatPure: keep → null; bar1 → first downbeat; playhead snaps to bar', () => {
    const beats = constGrid();   // downbeats at t=0,2,4,6 (beats 0,4,8,12)
    assert.strictEqual(_placeAtStartBeatPure('keep', beats, 2.3, beatOf), null, 'keep = no placement');
    assert.strictEqual(_placeAtStartBeatPure('nonsense', beats, 2.3, beatOf), null, 'unknown choice = keep');
    assert.strictEqual(_placeAtStartBeatPure('bar1', beats, 2.3, beatOf), 0, 'bar 1 = the first downbeat’s beat');
    assert.strictEqual(_placeAtStartBeatPure('playhead', beats, 2.3, beatOf), 4, 'cursor 2.3s snaps to the bar at t=2 → beat 4');
    assert.strictEqual(_placeAtStartBeatPure('playhead', beats, 3.2, beatOf), 8, 'cursor 3.2s snaps up to t=4 → beat 8');
    assert.strictEqual(_placeAtStartBeatPure('bar1', [], 0, (b, t) => t), 0, 'gridless chart degrades to 0');
});

// ── placeImportedPartAsRegion (the import front door's orchestrator) ──
// The real post-import flow: the fresh part has NO track row yet — the
// orchestrator must normalize the session (synthesizing the row), resolve the
// track, then place/select. Stateful wiring, driven for real.
function seedImportedDrumPart() {
    const primaryTab = { version: 1, name: 'Drums', kit: [], hits: [{ t: 0.5, p: 36 }] };
    const freshTab = { version: 1, name: 'Imported', kit: [], hits: [{ t: 0.5, p: 42 }, { t: 1.0, p: 38 }] };   // beats 1, 2
    const arrs = [
        { id: 'lead', name: 'Lead', notes: [{ time: 0.5, sustain: 0, string: 0, fret: 0, techniques: {} }], chords: [] },
        { id: 'drums', name: 'Drums', type: 'drums', drumTab: primaryTab, notes: [], chords: [] },
        { id: 'drums-2', name: 'Imported', type: 'drums', drumTab: freshTab, notes: [], chords: [] },
    ];
    seedState({ arrangements: arrs, currentArr: 0, beats: constGrid(), drumTab: freshTab,
        audioUrl: '', stems: [], stemLinks: {}, cursorTime: 0,
        trackSession: { version: 3, tracks: [], removedSourceIds: [], tempoGuideSourceId: '', tempoGuideLocked: false, tempoGuideMode: 'audio' },
        selectedTrackId: '', selectedRegionId: '' });
    S.history = new EditHistory();
    trackHooks();
    S.drumTabDirty = false;
    return { primaryTab, freshTab };
}
const _trackById = (id) => S.trackSession.tracks.find(t => t.id === id);

t('orchestrator bar1: synthesizes the row, places the part, selects the region; undo restores', () => {
    const { primaryTab, freshTab } = seedImportedDrumPart();
    const before = clone(freshTab.hits);
    const ok = placeImportedPartAsRegion({ kind: 'drums', arrIdx: 2, placeAt: 'bar1' });
    assert.strictEqual(ok, true);
    assert.deepStrictEqual(freshTab.hits.map(h => h.t), [0.0, 0.5], 'the part slid to bar 1 (first onset at beat 0)');
    assert.deepStrictEqual(primaryTab.hits.map(h => h.t), [0.5], 'the other part untouched');
    const track = _trackById('transcription:drums-2');
    assert.ok(track, 'the fresh part’s row was synthesized');
    assert.strictEqual(track.regions.length, 1, 'a bounded region landed on it');
    assert.strictEqual(S.selectedTrackId, 'transcription:drums-2', 'track selected');
    assert.strictEqual(S.selectedRegionId, track.regions[0].id, 'the placed region selected');
    S.history.doUndo();
    assert.deepStrictEqual(freshTab.hits, before, 'undo restores the hits');
    assert.ok(!('regions' in _trackById('transcription:drums-2')), 'and removes the window');
});

t('orchestrator keep: no motion, no persisted window — selection only', () => {
    const { freshTab } = seedImportedDrumPart();
    const before = clone(freshTab.hits);
    const ok = placeImportedPartAsRegion({ kind: 'drums', arrIdx: 2, placeAt: 'keep' });
    assert.strictEqual(ok, true);
    assert.deepStrictEqual(freshTab.hits, before, 'keep = content stays at source timing');
    assert.ok(!('regions' in _trackById('transcription:drums-2')), 'no regions key written');
    assert.strictEqual(S.selectedTrackId, 'transcription:drums-2', 'track selected');
    assert.strictEqual(S.selectedRegionId, DEFAULT_REGION_ID, 'the implicit default region selected');
});

t('orchestrator playhead: places at the cursor’s bar', () => {
    const { freshTab } = seedImportedDrumPart();
    S.cursorTime = 2.3;   // snaps to the bar at t=2 → beat 4
    placeImportedPartAsRegion({ kind: 'drums', arrIdx: 2, placeAt: 'playhead' });
    assert.deepStrictEqual(freshTab.hits.map(h => h.t), [2.0, 2.5], 'first onset landed on bar 2 (beat 4)');
    assert.strictEqual(_trackById('transcription:drums-2').regions[0].startBeat, 4);
});

t('orchestrator refuses a bad arrIdx gracefully', () => {
    seedImportedDrumPart();
    assert.strictEqual(placeImportedPartAsRegion({ kind: 'drums', arrIdx: -1, placeAt: 'bar1' }), false);
    assert.strictEqual(placeImportedPartAsRegion({ kind: 'drums', arrIdx: 99, placeAt: 'bar1' }), false);
});

// ── Through EditHistory (the real exec path) ──────────────────────────
t('via S.history.exec: place → delete, undo/redo restore both', () => {
    const arr = seedNotation({ notes: [note(0.5), note(1.0)] });   // beats 1, 2
    const track = S.trackSession.tracks[0];
    const empty = clone(arr.notes);
    S.history.exec(new PlaceRegionCmd({ kind: 'notation', arrIdx: 0, trackId: 'transcription:Lead', startBeat: 4 }));
    const placedNotes = clone(arr.notes);
    const region = clone(track.regions[0]);
    S.history.exec(new DeleteRegionCmd({ kind: 'notation', arrIdx: 0, trackId: 'transcription:Lead', region: track.regions[0] }));
    assert.deepStrictEqual(arr.notes, [], 'the placed block was deleted');
    assert.deepStrictEqual(track.regions, [], 'its entry gone');
    S.history.doUndo();      // undo delete
    assert.deepStrictEqual(arr.notes, placedNotes, 'undo restores the placed notes');
    assert.deepStrictEqual(track.regions[0], region, 'undo restores the region');
    S.history.doUndo();      // undo place
    assert.deepStrictEqual(arr.notes, empty, 'undo the place restores the pre-place notes');
    assert.ok(!('regions' in track), 'and the regions key');
    S.history.doRedo();      // redo place
    assert.deepStrictEqual(arr.notes, placedNotes, 'redo the place');
});

for (const [name, fn] of tests) {
    try { await fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
