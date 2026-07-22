/*
 * Region TRIM (track-regions PR4): TrimRegionCmd adjusts a region's WINDOW only
 * — never its content — as one undoable edit.
 *
 * Pinned here:
 *   - audio trim moves the media in/out points (srcIn/srcOut) in the file's own
 *     seconds; srcOut:null clears the out-point ("play to the buffer end").
 *   - notation trim narrows the beat window (lenBeat/startBeat) WITHOUT touching
 *     the arrangement's notes — edge notes are hidden by the window, never deleted.
 *   - round-trips through the real S.history path: exec → undo restores the raw
 *     regions[] EXACTLY (incl. deleting a `regions` key that was never there),
 *     redo reproduces the trim.
 *   - trimming the implicit default region materializes it; an unknown region id
 *     or an all-dropped patch is a true no-op that never materializes the default.
 *   - _trimPatchPure whitelists window fields (finite number | explicit null),
 *     dropping content/junk so a trim can't smuggle anything onto a region.
 *
 * Fails on main: TrimRegionCmd / _trimPatchPure do not exist there.
 *
 * Run: node tests/region_trim.test.mjs
 */
import assert from 'node:assert';

import { seedState, trackHooks } from './_history_env.mjs';
import { _regionsAreDefaultPure } from '../src/region.js';
import { TrimRegionCmd, _trimPatchPure } from '../src/region-commands.js';
import { EditHistory } from '../src/history.js';
import { S } from '../src/state.js';

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
const note = (time, sustain = 0) => ({ time, sustain, string: 0, fret: 0, techniques: {} });

function seed({ trackId = 'audio:master', type = 'audio', regions, notes } = {}) {
    const arr = notes ? { name: 'Lead', notes } : null;
    const track = { id: trackId, type, ...(regions ? { regions } : {}) };
    seedState({ arrangements: arr ? [arr] : [], currentArr: 0, beats: constGrid(), drumTab: null,
        trackSession: { version: 3, tracks: [track], removedSourceIds: [],
            tempoGuideSourceId: '', tempoGuideLocked: false, tempoGuideMode: 'audio' },
        selectedTrackId: '', selectedRegionId: '' });
    S.history = new EditHistory();
    trackHooks();
    return { track, arr };
}

// ── _trimPatchPure ────────────────────────────────────────────────────
t('_trimPatchPure keeps finite numbers + explicit null, drops everything else', () => {
    assert.deepStrictEqual(
        _trimPatchPure({ srcIn: 2, srcOut: null, startBeat: 4, lenBeat: 8 }),
        { srcIn: 2, srcOut: null, startBeat: 4, lenBeat: 8 });
    assert.deepStrictEqual(_trimPatchPure({ srcIn: NaN, srcOut: '3', foo: 1, notes: [] }), {},
        'NaN / string / non-window fields dropped');
    assert.deepStrictEqual(_trimPatchPure(null), {});
});

// ── audio trim ────────────────────────────────────────────────────────
t('audio trim: srcIn/srcOut move the media window; exec→undo→redo round-trips', () => {
    const { track } = seed({ regions: [{ id: 'region:2', startBeat: 0, lenBeat: null, srcIn: 1, srcOut: 6 }] });
    const before = clone(track.regions);
    S.history.exec(new TrimRegionCmd({ trackId: 'audio:master', regionId: 'region:2', patch: { srcIn: 2, srcOut: 5 } }));
    assert.deepStrictEqual(track.regions, [{ id: 'region:2', startBeat: 0, lenBeat: null, srcIn: 2, srcOut: 5 }],
        'window trimmed to the new in/out');
    const after = clone(track.regions);
    S.history.doUndo();
    assert.deepStrictEqual(track.regions, before, 'undo restores the pre-trim window EXACTLY');
    S.history.doRedo();
    assert.deepStrictEqual(track.regions, after, 'redo reproduces the trim');
});

t('audio trim: srcOut:null clears the out-point but keeps the in-point', () => {
    const { track } = seed({ regions: [{ id: 'region:2', startBeat: 0, lenBeat: null, srcIn: 1, srcOut: 6 }] });
    new TrimRegionCmd({ trackId: 'audio:master', regionId: 'region:2', patch: { srcOut: null } }).exec();
    assert.strictEqual(track.regions[0].srcIn, 1, 'in-point kept');
    assert.ok(track.regions[0].srcOut == null, 'out-point cleared → play to the buffer end');
});

t('trim preserves an authored region name (routes through normalize)', () => {
    const { track } = seed({ regions: [{ id: 'region:2', startBeat: 0, lenBeat: null, srcIn: 0, srcOut: 6, name: 'Chorus' }] });
    new TrimRegionCmd({ trackId: 'audio:master', regionId: 'region:2', patch: { srcIn: 1 } }).exec();
    assert.strictEqual(track.regions[0].name, 'Chorus', 'the label survives a trim');
});

// ── notation trim ─────────────────────────────────────────────────────
t('notation trim: lenBeat narrows the window but never touches the notes', () => {
    const { track, arr } = seed({ trackId: 'transcription:Lead', type: 'transcription',
        notes: [note(0.5), note(1.0), note(1.5), note(2.0)],
        regions: [{ id: 'region:2', startBeat: 0, lenBeat: 8 }] });
    const notesBefore = clone(arr.notes);
    new TrimRegionCmd({ trackId: 'transcription:Lead', regionId: 'region:2', patch: { lenBeat: 4 } }).exec();
    assert.strictEqual(track.regions[0].lenBeat, 4, 'window narrowed to 4 beats');
    assert.deepStrictEqual(arr.notes, notesBefore, 'notes are HIDDEN by the window, never deleted');
});

// ── default-region + no-op edges ──────────────────────────────────────
t('trimming the implicit default materializes it; undo deletes the key', () => {
    const { track } = seed({});   // no regions key → implicit default region:1
    assert.ok(!('regions' in track), 'starts default (no key)');
    const cmd = new TrimRegionCmd({ trackId: 'audio:master', regionId: 'region:1', patch: { srcIn: 2, srcOut: 5 } });
    cmd.exec();
    assert.ok(Array.isArray(track.regions) && track.regions[0].srcIn === 2, 'default materialized with the trim');
    assert.strictEqual(_regionsAreDefaultPure(track.regions), false, 'no longer the implicit default');
    cmd.rollback();
    assert.ok(!('regions' in track), 'undo removes the regions key that was never there');
});

t('unknown region id and all-dropped patch are both no-ops (default never materialized)', () => {
    const { track } = seed({});
    new TrimRegionCmd({ trackId: 'audio:master', regionId: 'region:999', patch: { srcIn: 2 } }).exec();
    assert.ok(!('regions' in track), 'unknown id never materializes the default');
    new TrimRegionCmd({ trackId: 'audio:master', regionId: 'region:1', patch: { foo: 1 } }).exec();
    assert.ok(!('regions' in track), 'empty (all-dropped) patch is a true no-op');
});

for (const [name, fn] of tests) {
    try { await fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
