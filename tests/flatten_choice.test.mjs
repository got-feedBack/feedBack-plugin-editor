/*
 * Flatten-to-constant-BPM: the two named directions (charrette UX P2 / PR 3).
 *
 *   Conform notes  → TempoMapCmd: beats are truth, seconds reproject onto the
 *                    flat grid, so EVERY part rides to the new tempo.
 *   Rebuild grid   → TempoGridCmd: seconds hold, beats re-lift — notes don't move.
 *
 * Both use the same flat grid from _tempoFlattenToBpmPure; only the command
 * (direction) differs. Real commands over the real S (tests/_history_env.mjs).
 *
 * Run: node tests/flatten_choice.test.mjs
 */
import assert from 'node:assert';
import fs from 'node:fs';
import { S } from '../src/state.js';
import { EditHistory } from '../src/history.js';
import { TempoGridCmd, TempoMapCmd, _tempoFlattenToBpmPure } from '../src/tempo.js';
import { beatOf, timeOf } from '../src/beats.js';
import { seedState, trackHooks } from './_history_env.mjs';

let pass = 0, fail = 0;
function t(name, fn) {
    try { fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}
const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

// A VARIABLE tempo map: measure 1 at 60 BPM (1s beats), measure 2 at 40 BPM
// (1.5s beats). Downbeats at index 0 and 4.
function variableGrid() {
    return [
        { time: 0, measure: 1 }, { time: 1, measure: -1 }, { time: 2, measure: -1 }, { time: 3, measure: -1 },
        { time: 5, measure: 1 }, { time: 6.5, measure: -1 }, { time: 8, measure: -1 }, { time: 9.5, measure: -1 },
    ];
}
const mkArr = (name, t) => ({ name, notes: [{ string: 0, fret: 0, time: t, sustain: 0 }], chords: [], anchors: [], anchors_user: [], handshapes: [], phrases: [] });
function seed() {
    trackHooks();
    seedState({
        arrangements: [mkArr('Guitar', 5), mkArr('Bass', 6.5)],   // notes on the two downbeat-2 area beats
        currentArr: 0,
        sessionId: 's1',
        beats: variableGrid(),
        sections: [],
        duration: 12,
        history: new EditHistory(),
    });
}

t('conform (TempoMapCmd) moves notes in ALL parts onto the flat grid; undo restores', () => {
    seed();
    const before0 = S.arrangements[0].notes[0].time;   // 5
    const before1 = S.arrangements[1].notes[0].time;   // 6.5
    const oldBeats = S.beats.map(b => ({ ...b }));
    const flat = _tempoFlattenToBpmPure(S.beats, 60);   // span 1 → [0,1,2,3,4,5,6,7]
    const expect0 = timeOf(flat, beatOf(oldBeats, before0));   // beat 4 → 4
    const expect1 = timeOf(flat, beatOf(oldBeats, before1));   // beat 5 → 5
    S.history.exec(new TempoMapCmd(oldBeats, flat, 'flatten-conform'));
    assert.ok(near(S.arrangements[0].notes[0].time, expect0), 'current arrangement conformed');
    assert.ok(near(S.arrangements[1].notes[0].time, expect1), 'the OTHER arrangement conformed too (all parts move)');
    assert.ok(!near(S.arrangements[1].notes[0].time, before1), 'arr 1 actually moved');
    S.history.doUndo();
    assert.ok(near(S.arrangements[0].notes[0].time, before0, 1e-9) && near(S.arrangements[1].notes[0].time, before1, 1e-9),
        'undo restores exact seconds for every part');
});

t('rebuild-grid (TempoGridCmd) keeps every note\'s exact seconds; the grid flattens; undo restores', () => {
    seed();
    const before0 = S.arrangements[0].notes[0].time;
    const before1 = S.arrangements[1].notes[0].time;
    const oldBeats = S.beats.map(b => ({ ...b }));
    const flat = _tempoFlattenToBpmPure(S.beats, 60);
    S.history.exec(new TempoGridCmd(oldBeats, flat, 'flatten'));
    assert.strictEqual(S.arrangements[0].notes[0].time, before0, 'seconds unchanged (current arr)');
    assert.strictEqual(S.arrangements[1].notes[0].time, before1, 'seconds unchanged (other arr)');
    assert.deepStrictEqual(S.beats.map(b => b.time), flat.map(b => b.time), 'the grid is now constant');
    S.history.doUndo();
    assert.deepStrictEqual(S.beats.map(b => b.time), oldBeats.map(b => b.time), 'undo restores the variable map');
});

// Source guard (main.js isn't node-importable; same convention as
// tempo_op_commands.test.mjs): the flatten dialog AWAITS across real time —
// the overlay traps pointer/keyboard, but an already-in-flight async import
// can land meanwhile and swap the session/grid, so the choice must be
// re-validated against the live state before either command executes. PR 9
// EXTRACTED this flatten flow from editorSetBPM into the shared
// _editorFlattenSongToBpm (so Song Fit reaches it inside Tempo Map mode), and
// editorSetBPM now delegates to it — the guard follows the function.
t('_editorFlattenSongToBpm re-validates the session after the dialog await', () => {
    const src = fs.readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
    const start = src.indexOf('async function _editorFlattenSongToBpm');
    assert.ok(start >= 0, 'the shared flatten helper must exist');
    const b = src.slice(start, src.indexOf('window.editorSetBPM ='));
    const awaitAt = b.indexOf('await _editorPromptChoice');
    assert.ok(awaitAt >= 0, 'flatten prompt is awaited');
    const after = b.slice(awaitAt);
    assert.ok(/S\.sessionId !== sessionBefore/.test(after),
        'post-await: bail when the session changed under the dialog');
    const execAt = after.indexOf('S.history.exec');
    assert.ok(execAt >= 0 && after.indexOf('sessionBefore') < execAt,
        'the re-validation sits BEFORE the command executes');
    // editorSetBPM keeps the variable-map GATE (only the inline box offers
    // flatten outside Tempo Map mode) but delegates the flow to the helper.
    const setBpm = src.slice(src.indexOf('window.editorSetBPM ='), src.indexOf('window.editorSetTempoSignature ='));
    assert.ok(/await _editorFlattenSongToBpm\(newBPM\)/.test(setBpm), 'editorSetBPM delegates to the shared helper');
});

t('_tempoFlattenToBpmPure keeps the beat count and anchors at bar 1', () => {
    const beats = variableGrid();
    const flat = _tempoFlattenToBpmPure(beats, 120);   // span 0.5
    assert.strictEqual(flat.length, beats.length, 'same beat count → TempoMapCmd is valid');
    assert.strictEqual(flat[0].time, beats[0].time, 'anchored at bar 1 (beats[0].time)');
    assert.ok(near(flat[3].time - flat[2].time, 0.5), 'constant span');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
