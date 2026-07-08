'use strict';
/*
 * Tests for the MIDI tempo-map import (DAW 3.2) frontend:
 * the @pure:midi-tempo-choice block (project-grid detection, beat-row
 * sanitizing, the Use-vs-Keep default policy, the summary string), plus the
 * TempoGridCmd `songScope` flag that lets an imported grid apply while a
 * fretted part sits read-only in the piano roll.
 *
 * All fail on main: the pure block doesn't exist there, and TempoGridCmd was
 * not song-scoped (so the grid apply would be blocked by the #119 lock).
 *
 * Run: node tests/midi_tempo_import.test.js
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const src = fs.readFileSync(path.join(__dirname, '..', 'screen.js'), 'utf8');

function extractBlock(name) {
    const re = new RegExp(
        '/\\* @pure:' + name + ':start \\*/[\\s\\S]*?/\\* @pure:' + name + ':end \\*/');
    const m = src.match(re);
    if (!m) { console.error(`FAIL: @pure:${name} block not found`); process.exit(1); }
    return m[0];
}
function extractClass(name) {
    const start = src.indexOf('class ' + name);
    assert.ok(start >= 0, `class ${name} must exist`);
    const open = src.indexOf('{', start);
    let depth = 0;
    for (let i = open; i < src.length; i++) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}' && --depth === 0) return src.slice(start, i + 1);
    }
    throw new Error('unbalanced braces extracting ' + name);
}

let passed = 0, failed = 0;
function t(name, fn) {
    try { fn(); passed++; console.log('  ok ' + name); }
    catch (e) { failed++; console.error('  FAIL ' + name + '\n    ' + (e && e.message)); }
}

const P = new Function(
    '"use strict";' + extractBlock('midi-tempo-choice')
    + '\nreturn { _hasProjectGridPure, _midiTempoToBeatsPure, _midiOffersGridPure, '
    + '_midiTempoDefaultChoicePure, _midiTempoSummaryPure };'
)();

// A valid n-bar map in the core #796 shape.
function grid(n) {
    const beats = [];
    for (let m = 1; m <= n; m++) {
        beats.push({ time: m - 1, measure: m, den: 4 });
        beats.push({ time: m - 0.5, measure: -1 });
    }
    return {
        tempos: [{ time: 0, bpm: 120 }],
        time_signatures: [{ time: 0, ts: [4, 4] }],
        beats,
    };
}

// ── project-grid detection ───────────────────────────────────────────

t('_hasProjectGridPure: needs 2+ numbered downbeats', () => {
    assert.strictEqual(P._hasProjectGridPure([]), false);
    assert.strictEqual(P._hasProjectGridPure(null), false);
    assert.strictEqual(P._hasProjectGridPure([{ measure: 1 }]), false, 'one bar is not a grid');
    assert.strictEqual(P._hasProjectGridPure([{ measure: -1 }, { measure: -1 }]), false, 'no downbeats');
    assert.strictEqual(P._hasProjectGridPure([{ measure: 1 }, { measure: -1 }, { measure: 2 }]), true);
});

// ── beat-row sanitizing ──────────────────────────────────────────────

t('_midiTempoToBeatsPure: keeps {time,measure,den}, drops junk, den only on downbeats', () => {
    const rows = P._midiTempoToBeatsPure({
        beats: [
            { time: 0, measure: 1, den: 4 },
            { time: 0.5, measure: -1, den: 8 },   // interior: den dropped
            { time: 'x', measure: 2 },            // bad time: dropped
            { time: 1, measure: 2 },              // downbeat, no den: fine
        ],
    });
    assert.deepStrictEqual(rows, [
        { time: 0, measure: 1, den: 4 },
        { time: 0.5, measure: -1 },
        { time: 1, measure: 2 },
    ]);
});

t('_midiTempoToBeatsPure: empty/missing map → []', () => {
    assert.deepStrictEqual(P._midiTempoToBeatsPure(null), []);
    assert.deepStrictEqual(P._midiTempoToBeatsPure({}), []);
    assert.deepStrictEqual(P._midiTempoToBeatsPure({ beats: 'x' }), []);
});

// ── the Use-vs-Keep default policy ───────────────────────────────────

t('default is USE when the project has no grid', () => {
    assert.strictEqual(P._midiTempoDefaultChoicePure([], grid(3)), 'midi');
    assert.strictEqual(P._midiTempoDefaultChoicePure([{ measure: 1 }], grid(3)), 'midi',
        'a lone implied bar is not a grid → still offer USE');
});

t('default is KEEP when the project already has a grid', () => {
    const projectGrid = grid(4).beats;
    assert.strictEqual(P._midiTempoDefaultChoicePure(projectGrid, grid(3)), 'keep');
});

t('null (no dialog) when the MIDI carries no usable grid', () => {
    assert.strictEqual(P._midiTempoDefaultChoicePure([], { beats: [] }), null);
    assert.strictEqual(P._midiTempoDefaultChoicePure(grid(4).beats, { beats: [{ measure: -1 }] }), null);
    assert.strictEqual(P._midiTempoDefaultChoicePure([], null), null);
});

// Regression (Codex #2): the frontend gate for "does the MIDI offer a grid"
// must match the backend (routes.py `_sanitize_midi_tempo_map` gates on ONE
// numbered downbeat — see test_single_downbeat_still_offered). Reusing the
// 2-downbeat _hasProjectGridPure threshold silently dropped single-bar MIDIs
// the server had already shipped. FAILS on pre-fix code (returned null).
t('_midiOffersGridPure: a single numbered downbeat is enough (matches backend)', () => {
    assert.strictEqual(P._midiOffersGridPure(grid(1)), true, 'one bar is offerable');
    assert.strictEqual(P._midiOffersGridPure(grid(3)), true);
    assert.strictEqual(P._midiOffersGridPure({ beats: [{ time: 0, measure: -1 }] }), false, 'no downbeat');
    assert.strictEqual(P._midiOffersGridPure({ beats: [] }), false);
    assert.strictEqual(P._midiOffersGridPure(null), false);
});

t('single-bar MIDI still offers a choice (frontend/backend gate parity)', () => {
    assert.strictEqual(P._midiTempoDefaultChoicePure([], grid(1)), 'midi',
        'a 1-downbeat MIDI passes the backend sanitize gate; the frontend must offer USE too');
    assert.strictEqual(P._midiTempoDefaultChoicePure(grid(4).beats, grid(1)), 'keep',
        'a single-bar MIDI over an existing project grid still defaults to KEEP');
});

// ── summary string ───────────────────────────────────────────────────

t('_midiTempoSummaryPure: bars + first sig + first tempo', () => {
    assert.strictEqual(P._midiTempoSummaryPure(grid(3)), '3 bars · 4/4 · 120 BPM');
    assert.strictEqual(P._midiTempoSummaryPure(grid(1)), '1 bar · 4/4 · 120 BPM');
});

t('_midiTempoSummaryPure: ellipsis when timing changes, defensive on partial maps', () => {
    const m = grid(2);
    m.time_signatures = [{ time: 0, ts: [4, 4] }, { time: 4, ts: [3, 4] }];
    m.tempos = [{ time: 0, bpm: 120 }, { time: 2, bpm: 90 }];
    assert.strictEqual(P._midiTempoSummaryPure(m), '2 bars · 4/4… · 120 BPM…');
    // Missing tempos/sigs: just the bar count.
    assert.strictEqual(P._midiTempoSummaryPure({ beats: grid(2).beats }), '2 bars');
});

// ── TempoGridCmd is song-scoped (applies through the #119 roll lock) ──

t('TempoGridCmd sets songScope so a grid can apply while a fretted part is in the roll', () => {
    const env = new Function(
        'S', 'draw', 'updateStatus', '_loopRelockAfterGridChange', '_renderLoopStrip',
        '_updateLoopIn3DBtn',
        '"use strict";' + extractClass('TempoGridCmd') + '\nreturn { TempoGridCmd };'
    )(
        { beats: [], barSel: null }, () => {}, () => {}, () => {}, () => {}, () => {},
    );
    const cmd = new env.TempoGridCmd([], grid(2).beats, 'MIDI tempo map');
    assert.strictEqual(cmd.songScope, true,
        'a song-level grid edit must opt out of the read-only-roll (note) lock');
});

t('TempoGridCmd round-trips S.beats: exec sets the new grid, rollback restores', () => {
    const S = { beats: [{ time: 0, measure: 1 }], barSel: null };
    const env = new Function(
        'S', 'draw', 'updateStatus', '_loopRelockAfterGridChange', '_renderLoopStrip',
        '_updateLoopIn3DBtn',
        '"use strict";' + extractClass('TempoGridCmd') + '\nreturn { TempoGridCmd };'
    )(S, () => {}, () => {}, () => {}, () => {}, () => {});
    const before = JSON.parse(JSON.stringify(S.beats));
    const newBeats = grid(2).beats;
    const cmd = new env.TempoGridCmd(S.beats, newBeats, 'MIDI tempo map');
    cmd.exec();
    assert.strictEqual(S.beats.length, 4, 'new grid applied');
    assert.notStrictEqual(S.beats, newBeats, 'stored as a copy, not the caller array');
    cmd.rollback();
    assert.deepStrictEqual(S.beats, before, 'rollback restores the prior grid exactly');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
