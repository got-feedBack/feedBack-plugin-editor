'use strict';
/*
 * Suggest-position PITCH-MOVE by drag — P6 follow-up (design V4/V5).
 *
 * The read-only fretted roll lets a charter DRAG a note vertically to re-pitch
 * it; the resolver repicks {string,fret} at the new sounding pitch. Covered:
 *   1. _positionLocked: which techniques couple the fret (slide/bend/harmonic)
 *      and so REFUSE a roll pitch-move; pitch-portable techniques don't lock.
 *   2. _rollDragPitchMove live drag: resolves + repicks, biased to keep the
 *      hand (prevNote = the note's original fret); time always applies; a
 *      position-locked note or a refused pitch HOLDS (never a silent guess).
 *   3. MoveNoteCmd.markSuggestedIdx: exec marks the repicked notes suggested,
 *      rollback restores the exact prior mark state.
 *
 * References P6-follow-up code absent on main, so the suite fails on main.
 *
 * Run: node tests/suggest_position_move.test.js
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const src = fs.readFileSync(path.join(__dirname, '..', 'screen.js'), 'utf8');
function extractBlock(name) {
    const re = new RegExp('/\\* @pure:' + name + ':start[\\s\\S]*?@pure:' + name + ':end \\*/');
    const m = src.match(re);
    if (!m) { console.error(`FAIL: @pure:${name} block not found`); process.exit(1); }
    return m[0];
}
function extractByKeyword(keyword, label) {
    const start = src.indexOf(keyword);
    assert.ok(start >= 0, `${label || keyword} must exist`);
    const open = src.indexOf('{', start);
    let depth = 0;
    for (let i = open; i < src.length; i++) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}' && --depth === 0) return src.slice(start, i + 1);
    }
    throw new Error(`unbalanced braces extracting ${label || keyword}`);
}
const extractFn = name => extractByKeyword('function ' + name + '(', 'function ' + name);
const extractClass = name => extractByKeyword('class ' + name, 'class ' + name);

let pass = 0, fail = 0;
function t(name, fn) {
    try { fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + (e && e.message)); }
}

const OPEN = [40, 45, 50, 55, 59, 64];   // EADGBe standard
const PIANO_LANE_H = 12;

function makeMoveEnv(seed) {
    const S = {
        currentArr: 0,
        arrangements: [{ name: 'Lead', tuning: [0, 0, 0, 0, 0, 0], anchors_user: [], anchors: [],
                         notes: seed.map(n => ({ ...n, techniques: { ...(n.techniques || {}) } })) }],
    };
    const body = '"use strict";'
        + extractBlock('suggest-marks')
        + extractBlock('fret-pitch')
        + extractBlock('suggest-position')
        + '\n' + extractFn('_rollAnchorList')
        + '\n' + extractFn('_occupiedStringsAt')
        + '\n' + extractFn('_positionLocked')
        + '\n' + extractFn('_rollDragPitchMove')
        + '\n' + extractClass('MoveNoteCmd')
        + '\nreturn { _rollDragPitchMove, _positionLocked, MoveNoteCmd,'
        + ' _isSuggested, _markSuggested, _clearSuggested };';
    const env = new Function('S', 'notes', '_rollPitchCtx', 'snapTime', 'PIANO_LANE_H', body)(
        S,
        () => S.arrangements[S.currentArr].notes,
        () => ({ openMidi: OPEN, tuning: [0, 0, 0, 0, 0, 0], capo: 0 }),
        tm => tm,                                  // snapTime: identity
        PIANO_LANE_H,
    );
    return { S, env, notes: () => S.arrangements[0].notes };
}
function startDrag(S, indices) {
    const nn = S.arrangements[0].notes;
    S.drag = {
        indices,
        startX: 0, startY: 0,
        origTimes: indices.map(i => nn[i].time),
        origStrings: indices.map(i => nn[i].string),
        origFrets: indices.map(i => nn[i].fret),
    };
}

// ── 1. _positionLocked ────────────────────────────────────────────────────────
t('_positionLocked: fret-coupled techniques lock; pitch-portable ones do not', () => {
    const { env } = makeMoveEnv([]);
    const L = env._positionLocked;
    assert.ok(L({ techniques: { slide_to: 5 } }), 'slide_to');
    assert.ok(L({ techniques: { slide_unpitch_to: 3 } }), 'slide_unpitch_to');
    assert.ok(L({ techniques: { bend: 1 } }), 'bend');
    assert.ok(L({ techniques: { bend_values: [{ t: 0, v: 1 }] } }), 'bend_values');
    assert.ok(L({ techniques: { harmonic: true } }), 'harmonic');
    assert.ok(L({ techniques: { harmonic_pinch: true } }), 'pinch harmonic');
    for (const k of ['palm_mute', 'vibrato', 'accent', 'hammer_on', 'pull_off', 'tap']) {
        assert.ok(!L({ techniques: { [k]: true } }), `${k} is pitch-portable, must NOT lock`);
    }
    assert.ok(!L({ techniques: { slide_to: -1 } }), 'slide_to -1 (none) does not lock');
    assert.ok(!L({}), 'no techniques ⇒ not locked');
});

// ── 2. _rollDragPitchMove ─────────────────────────────────────────────────────
t('a one-lane drag up re-pitches, keeping the hand (least fret travel)', () => {
    // s3/f1 sounds 56 (G#3). One lane up ⇒ dMidi +1 ⇒ 57 (A3): candidates
    // s0/17 s1/12 s2/7 s3/2, no open. prev fret 1 ⇒ nearest = s3/2.
    const { S, env, notes } = makeMoveEnv([{ time: 2, string: 3, fret: 1, sustain: 0 }]);
    startDrag(S, [0]);
    env._rollDragPitchMove(notes(), 0, -PIANO_LANE_H);
    assert.deepStrictEqual({ string: notes()[0].string, fret: notes()[0].fret }, { string: 3, fret: 2 });
    assert.strictEqual(notes()[0].time, 2, 'no horizontal drag ⇒ time unchanged');
});

t('time always applies even when pitch is unchanged (dMidi 0)', () => {
    const { S, env, notes } = makeMoveEnv([{ time: 2, string: 3, fret: 1, sustain: 0 }]);
    startDrag(S, [0]);
    env._rollDragPitchMove(notes(), 0.5, 0);       // horizontal only
    assert.strictEqual(notes()[0].time, 2.5, 'time moved');
    assert.deepStrictEqual({ string: notes()[0].string, fret: notes()[0].fret }, { string: 3, fret: 1 }, 'pitch untouched');
});

t('a position-locked note HOLDS its string/fret but still tracks time', () => {
    const { S, env, notes } = makeMoveEnv([{ time: 2, string: 3, fret: 1, sustain: 0, techniques: { slide_to: 5 } }]);
    startDrag(S, [0]);
    env._rollDragPitchMove(notes(), 0.25, -PIANO_LANE_H * 3);   // big vertical drag
    assert.deepStrictEqual({ string: notes()[0].string, fret: notes()[0].fret }, { string: 3, fret: 1 }, 'pitch held (fret-locked)');
    assert.strictEqual(notes()[0].time, 2.25, 'time still applied');
});

t('a refused pitch (open-vs-fretted) HOLDS — never a silent guess', () => {
    // s3/f1 = 56; one lane DOWN ⇒ 55 (G3) = open s3/0 AND fretted ⇒ refuse ⇒ hold.
    const { S, env, notes } = makeMoveEnv([{ time: 0, string: 3, fret: 1, sustain: 0 }]);
    startDrag(S, [0]);
    env._rollDragPitchMove(notes(), 0, PIANO_LANE_H);
    assert.deepStrictEqual({ string: notes()[0].string, fret: notes()[0].fret }, { string: 3, fret: 1 }, 'held at origin');
});

t('multi-note drag excludes the whole moving set from occupancy', () => {
    // Two notes at the same time on different strings, both dragged up one lane.
    // Each must resolve without seeing the OTHER moving note as an occupier.
    const { S, env, notes } = makeMoveEnv([
        { time: 0, string: 3, fret: 1, sustain: 0 },   // 56 → 57 ⇒ s3/2
        { time: 0, string: 2, fret: 6, sustain: 0 },   // 56 → 57 ⇒ but s3 taken by the other? both target 57
    ]);
    startDrag(S, [0, 1]);
    env._rollDragPitchMove(notes(), 0, -PIANO_LANE_H);
    // Both originally sound 56; +1 ⇒ 57. Neither should be blocked by the other's
    // ORIGINAL string (both excluded). They may land on the same resolved string
    // (a real same-pitch collision the charter can see) — the point is the move
    // isn't silently dropped by self-occupancy.
    assert.ok(notes()[0].fret === 2 || notes()[1].fret === 2, 'at least one repicked to the A3 hand position');
});

// ── 3. MoveNoteCmd mark round-trip ────────────────────────────────────────────
t('MoveNoteCmd.markSuggestedIdx marks on exec and rollback restores the prior state', () => {
    const { S, env, notes } = makeMoveEnv([{ time: 0, string: 3, fret: 1, sustain: 0 }]);
    // Simulate the commit: net delta s3/f1 → s3/f2, mark index 0 suggested.
    const cmd = new env.MoveNoteCmd([0], [0], [0], [1]);
    cmd.markSuggestedIdx = [0];
    assert.ok(!env._isSuggested(notes()[0]), 'precondition: confirmed');
    cmd.exec();
    assert.strictEqual(notes()[0].fret, 2, 'fret delta applied');
    assert.ok(env._isSuggested(notes()[0]), 'repicked note marked suggested');
    cmd.rollback();
    assert.strictEqual(notes()[0].fret, 1, 'fret restored');
    assert.ok(!env._isSuggested(notes()[0]), 'undo restored the prior (confirmed) mark state');
    cmd.exec();
    assert.ok(env._isSuggested(notes()[0]), 'redo re-marks suggested');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
