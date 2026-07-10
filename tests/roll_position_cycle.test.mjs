/*
 * Tests for same-pitch position cycling in the piano roll (VA.5):
 * the position-cycle pures in src/position.js (candidate enumeration + step), the
 * _execCyclePosition driver, the pitchPreserving carve-out in the
 * EditHistory read-only-roll lock, and the Shift+↑/↓ dispatch routing.
 *
 * Every test here fails on main: the pures don't exist, the lock has no
 * carve-out (undo/redo of ANY note-scope command is refused in the locked
 * roll), and transposeStringUp always runs the String-view move.
 *
 * Run: node tests/roll_position_cycle.test.mjs
 */
import assert from 'node:assert';
import fs from 'node:fs';
import { MoveToStringCmd, _execCyclePosition } from '../src/commands.js';
import { EditHistory } from '../src/history.js';
import { setHostHooks } from '../src/host.js';
import { _rollReadOnly } from '../src/keys.js';
import { seedState, statusMessages, trackHooks } from './_history_env.mjs';
import { _soundingPitchPure } from '../src/lanes.js';
import {
    _cyclePositionCandidatesPure, _cycleStepPure,
} from '../src/position.js';

const src = fs.readFileSync(new URL('../src/input.js', import.meta.url), 'utf8');

function extractFn(name) {
    const start = src.indexOf('function ' + name);
    assert.ok(start >= 0, `function ${name} must exist`);
    const open = src.indexOf('{', start);
    let depth = 0;
    for (let i = open; i < src.length; i++) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}' && --depth === 0) return src.slice(start, i + 1);
    }
    throw new Error(`unbalanced braces extracting ${name}`);
}

let passed = 0, failed = 0;
function t(name, fn) {
    try { fn(); passed++; console.log('  ok ' + name); }
    catch (e) { failed++; console.error('  FAIL ' + name + '\n    ' + (e && e.message)); }
}

// ── Candidate enumeration ────────────────────────────────────────────

// The cycle pures moved to src/position.js; _execCyclePosition (below) is still
// sliced out of src/input.js.
const P = { _cyclePositionCandidatesPure, _cycleStepPure, _soundingPitchPure };

const STD = [40, 45, 50, 55, 59, 64];       // EADGBe standard
const FLAT = [0, 0, 0, 0, 0, 0];
const DROP_D = [-2, 0, 0, 0, 0, 0];

t('standard tuning: open A (s1 f0) has exactly {s0 f5, s1 f0}', () => {
    const c = P._cyclePositionCandidatesPure(STD, FLAT, 6, 1, 0);
    assert.deepStrictEqual(c, [{ string: 0, fret: 5 }, { string: 1, fret: 0 }]);
});

t('standard tuning: pitch 55 enumerates all four positions, low string first', () => {
    const c = P._cyclePositionCandidatesPure(STD, FLAT, 6, 3, 0);   // open G
    assert.deepStrictEqual(c, [
        { string: 0, fret: 15 },
        { string: 1, fret: 10 },
        { string: 2, fret: 5 },
        { string: 3, fret: 0 },
    ]);
});

t('Drop-D shifts string 0 candidates by the tuning offset', () => {
    // Open A on string 1 (pitch 45): dropped string 0 sounds 38 open,
    // so the same pitch now needs fret 7 there.
    const c = P._cyclePositionCandidatesPure(STD, DROP_D, 6, 1, 0);
    assert.deepStrictEqual(c, [{ string: 0, fret: 7 }, { string: 1, fret: 0 }]);
});

t('capo cancels: every candidate SOUNDS identical under any capo (#115 pair)', () => {
    // The enumeration deliberately takes no capo — chart frets are
    // capo-relative on both sides of the comparison. Verify against the
    // #115 resolver: all candidates share one sounding pitch per capo.
    const c = P._cyclePositionCandidatesPure(STD, FLAT, 6, 2, 2);   // s2 f2 = 52
    assert.ok(c.length >= 2, 'needs at least two candidates to be meaningful');
    for (const capo of [0, 3]) {
        const sounds = c.map(p =>
            P._soundingPitchPure(STD, FLAT, capo, p.string, p.fret));
        assert.ok(sounds.every(s => s === sounds[0]),
            `capo ${capo}: candidates diverge: ${sounds}`);
    }
});

t('fret ceiling: candidates never exceed fret 24 or go negative', () => {
    // High pitch: s5 f20 = 84. s4 would need f25 (>24) — excluded.
    const c = P._cyclePositionCandidatesPure(STD, FLAT, 6, 5, 20);
    assert.deepStrictEqual(c, [{ string: 5, fret: 20 }]);
    // Low pitch: open low E has nowhere lower to go.
    const lo = P._cyclePositionCandidatesPure(STD, FLAT, 6, 0, 0);
    assert.deepStrictEqual(lo, [{ string: 0, fret: 0 }]);
});

t('adversarial inputs return [] rather than throwing', () => {
    assert.deepStrictEqual(P._cyclePositionCandidatesPure(STD, FLAT, 6, 0, NaN), []);
    assert.deepStrictEqual(P._cyclePositionCandidatesPure(STD, FLAT, 6, 0, 2.5), []);
    assert.deepStrictEqual(P._cyclePositionCandidatesPure(STD, FLAT, 6, 9, 0), []);
    assert.deepStrictEqual(P._cyclePositionCandidatesPure(null, FLAT, 6, 0, 0), []);
});

// ── Cycle stepping ───────────────────────────────────────────────────

t('cycle wraps in both directions', () => {
    const c = P._cyclePositionCandidatesPure(STD, FLAT, 6, 3, 0);   // 4 positions
    assert.deepStrictEqual(P._cycleStepPure(c, 3, 0, +1), { string: 0, fret: 15 },
        'last → wraps to first');
    assert.deepStrictEqual(P._cycleStepPure(c, 0, 15, -1), { string: 3, fret: 0 },
        'first → wraps to last');
    assert.deepStrictEqual(P._cycleStepPure(c, 1, 10, +1), { string: 2, fret: 5 });
});

t('single-position and corrupt-current are null (no-op, never a guess)', () => {
    assert.strictEqual(P._cycleStepPure([{ string: 0, fret: 0 }], 0, 0, +1), null);
    const c = P._cyclePositionCandidatesPure(STD, FLAT, 6, 1, 0);
    assert.strictEqual(P._cycleStepPure(c, 4, 4, +1), null, 'current not in list');
    assert.strictEqual(P._cycleStepPure([], 0, 0, +1), null);
});

// ── Driver + lock carve-out round-trip ───────────────────────────────

// EditHistory imports _rollReadOnly for real, so `locked` is expressed as real
// state: `rollView` puts the part in the piano roll, and a fretted part name
// there IS the read-only condition. A keys-named part in the roll is editable.
function makeCycleEnv({ arrName = 'Lead', noteSeed, sel, locked = true } = {}) {
    const S = seedState({
        arrangements: [{ id: 'a1', name: arrName, tuning: [0, 0, 0, 0, 0, 0],
                         notes: noteSeed.map(n => ({ ...n })) }],
        rollView: true,
        sel: new Set(sel),
        drumEditMode: false,
        tempoMapMode: false,
    });
    assert.strictEqual(_rollReadOnly(), locked, 'harness precondition: lock state');
    trackHooks();
    const statuses = statusMessages;   // live array of real setStatus() writes
    // Everything the sandbox used to slice is a real import now; the two input.js
    // callbacks it stubbed are host hooks.
    setHostHooks({ editorCurrentNoteIndices: () => (S.sel && S.sel.size ? [...S.sel] : []) });
    S.history = new EditHistory();
    const env = { _execCyclePosition, MoveToStringCmd };
    env.history = S.history;
    return { S, env, statuses };
}

t('exec/rollback/redo round-trip is deep-equal INSIDE the locked roll', () => {
    const { S, env } = makeCycleEnv({ noteSeed: [{ string: 1, fret: 0, time: 0 }], sel: [0] });
    const before = JSON.parse(JSON.stringify(S.arrangements[0].notes));
    env._execCyclePosition(+1);
    const after = JSON.parse(JSON.stringify(S.arrangements[0].notes));
    assert.deepStrictEqual(after, [{ string: 0, fret: 5, time: 0 }], 'cycled to s0 f5');
    assert.strictEqual(env.history.undo.length, 1, 'one undo step, locked or not');
    env.history.doUndo();
    assert.deepStrictEqual(JSON.parse(JSON.stringify(S.arrangements[0].notes)), before,
        'undo restores the exact prior state while the roll is locked');
    env.history.doRedo();
    assert.deepStrictEqual(JSON.parse(JSON.stringify(S.arrangements[0].notes)), after,
        'redo re-applies while the roll is locked');
});

t('edit-lock still blocks every command WITHOUT the pitchPreserving flag', () => {
    const { env, statuses } = makeCycleEnv({ noteSeed: [{ string: 1, fret: 0, time: 0 }], sel: [0] });
    let ran = 0;
    env.history.exec({ exec() { ran++; }, rollback() { ran--; } });
    assert.strictEqual(ran, 0, 'unflagged command must stay inert');
    assert.strictEqual(env.history.undo.length, 0);
    assert.ok(statuses.some(m => /read-only/.test(m)), 'the user is told why (real _rollLockNotice)');
});

t('multi-select cycles each note independently, skipping single-position notes', () => {
    const { S, env } = makeCycleEnv({
        noteSeed: [
            { string: 1, fret: 0, time: 0 },    // 2 positions
            { string: 0, fret: 0, time: 1 },    // open low E: single position
            { string: 3, fret: 0, time: 2 },    // 4 positions
        ],
        sel: [0, 1, 2],
    });
    env._execCyclePosition(+1);
    const nn = S.arrangements[0].notes;
    assert.deepStrictEqual({ string: nn[0].string, fret: nn[0].fret }, { string: 0, fret: 5 });
    assert.deepStrictEqual({ string: nn[1].string, fret: nn[1].fret }, { string: 0, fret: 0 },
        'single-position note untouched');
    assert.deepStrictEqual({ string: nn[2].string, fret: nn[2].fret }, { string: 0, fret: 15 },
        'wraps low: s3 f0 → s0 f15');
    assert.strictEqual(env.history.undo.length, 1, 'one undo step for the group');
    env.history.doUndo();
    assert.deepStrictEqual(
        nn.map(n => ({ string: n.string, fret: n.fret })),
        [{ string: 1, fret: 0 }, { string: 0, fret: 0 }, { string: 3, fret: 0 }],
        'group undo restores every note');
});

t('all-single-position selection is a status no-op, never a history entry', () => {
    const { S, env, statuses } = makeCycleEnv({
        noteSeed: [{ string: 0, fret: 0, time: 0 }], sel: [0] });
    env._execCyclePosition(+1);
    assert.strictEqual(env.history.undo.length, 0);
    assert.deepStrictEqual(
        { string: S.arrangements[0].notes[0].string, fret: S.arrangements[0].notes[0].fret },
        { string: 0, fret: 0 });
    assert.ok(statuses.some(s => /No alternate positions/.test(s)));
});

t('keys DATA and empty selection are guarded no-ops', () => {
    // A keys-DATA part in the roll is fully editable — never read-only. The old
    // harness stubbed _rollReadOnly() ⇒ true even here; the real predicate says
    // false, so state it.
    const keys = makeCycleEnv({
        arrName: 'Piano', noteSeed: [{ string: 1, fret: 0, time: 0 }], sel: [0], locked: false });
    keys.env._execCyclePosition(+1);
    assert.strictEqual(keys.env.history.undo.length, 0, 'keys packing has no positions');
    const none = makeCycleEnv({ noteSeed: [{ string: 1, fret: 0, time: 0 }], sel: [] });
    none.env._execCyclePosition(+1);
    assert.strictEqual(none.env.history.undo.length, 0);
    assert.ok(none.statuses.some(s => /Select notes first/.test(s)));
});

t('adversarial: NaN-fret note in the selection is skipped, not written', () => {
    const { S, env } = makeCycleEnv({
        noteSeed: [{ string: 1, fret: NaN, time: 0 }, { string: 1, fret: 0, time: 1 }],
        sel: [0, 1],
    });
    env._execCyclePosition(+1);
    const nn = S.arrangements[0].notes;
    assert.ok(Number.isNaN(nn[0].fret), 'corrupt note untouched');
    assert.deepStrictEqual({ string: nn[1].string, fret: nn[1].fret }, { string: 0, fret: 5 });
});

// ── Dispatch routing: Shift+↑/↓ cycles in the locked roll ───────────

t('transposeStringUp routes to the cycle in the roll, the string move otherwise', () => {
    const calls = [];
    const run = new Function(
        '_rollReadOnly', '_execCyclePosition', '_execMoveString',
        '"use strict";' + extractFn('_editorRunEofCommand')
        + '\nreturn _editorRunEofCommand;'
    )(
        () => calls.rollState,
        d => { calls.push(['cycle', d]); return true; },
        d => { calls.push(['move', d]); },
    );
    calls.rollState = true;
    run('transposeStringUp');
    run('transposeStringDown');
    calls.rollState = false;
    run('transposeStringUp');
    assert.deepStrictEqual(calls.slice(), [['cycle', 1], ['cycle', -1], ['move', 1]]);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
