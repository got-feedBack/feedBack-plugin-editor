/*
 * Loop-undo symmetry + mode round-trip tests (src/tempo.js + src/main.js).
 *
 * Since Phase A4 a bar/grid loop's edges are anchored to BEAT COORDINATES (β);
 * their seconds are a cache. So TempoMapCmd's exec/rollback symmetry no longer
 * relies on a barSel snapshot — the loop keeps its β and its seconds are simply
 * re-derived on whichever grid is in effect (timeOf), which is an exact inverse.
 * This suite proves:
 *   1. TempoMapCmd.exec reprojects a bar loop onto the flexed grid (it stays on
 *      the SAME bars — its β is unchanged) and rollback restores the exact
 *      pre-edit seconds, with NO beforeBarSel snapshot field on the command.
 *   2. a FREE loop is absolute seconds (D17) — a flex never moves it.
 *   3. a null loop round-trips as null.
 *   4. the editor<->3D-highway handoff carries region.mode so a freely drawn
 *      loop survives the round-trip (isn't demoted to 'bar').
 *
 * The TempoMapCmd class + the loop reproject/sync helpers are pulled verbatim
 * from src/main.js, with TempoMapCmd imported from src/tempo.js and run against
 * the real beat converter, so this validates the
 * shipping code path.
 *
 * Run: node tests/loop_undo_mode.test.mjs
 */
import assert from 'node:assert';
import fs from 'node:fs';
import { beatOf, timeOf } from '../src/beats.js';
import { setHostHooks } from '../src/host.js';
import { S as realS } from '../src/state.js';
import { TempoMapCmd } from '../src/tempo.js';

// The loop helpers moved to src/loop.js; the @pure:pending-view block stayed in
// src/main.js. Slice each from its own source.
const src = fs.readFileSync(new URL('../src/loop.js', import.meta.url), 'utf8');
const mainSrc = fs.readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');

function extractFn(name) {
    const start = src.indexOf('function ' + name + '(');
    assert.ok(start >= 0, `function ${name} must exist`);
    const open = src.indexOf('{', start);
    let d = 0;
    for (let i = open; i < src.length; i++) {
        if (src[i] === '{') d++;
        else if (src[i] === '}' && --d === 0) return src.slice(start, i + 1);
    }
    throw new Error(`unbalanced braces extracting ${name}`);
}

// ── The A4 loop helpers are still inline in main.js; TempoMapCmd is imported ──
const pm = mainSrc.match(/\/\* @pure:pending-view:start \*\/[\s\S]*?\/\* @pure:pending-view:end \*\//);
if (!pm) { console.error('FAIL: @pure:pending-view block not found'); process.exit(1); }

const { _resolvePendingViewStatePure } = new Function(
    '"use strict";' + pm[0] + '\nreturn { _resolvePendingViewStatePure };'
)();

// TempoMapCmd is a real import (src/tempo.js) closing over the REAL `S`; the two
// loop helpers are still inline in main.js and are still sliced, over the same
// object. This suite checks the LOOP, not note times — S.arrangements stays
// empty, so the command's real note-seconds snapshot/restore has nothing to walk.
function makeEnv(seed) {
    Object.assign(realS, { arrangements: [], sections: [], ...seed });
    const env = new Function(
        'S', 'beatOf', 'timeOf',
        '"use strict";'
        + extractFn('_loopReprojectFromBeats') + '\n'
        + extractFn('_loopSyncBeats') + '\n'
        + '\nreturn { _loopReprojectFromBeats, _loopSyncBeats };'
    )(realS, beatOf, timeOf);
    setHostHooks({
        renderLoopStrip: () => {},
        updateLoopIn3DBtn: () => {},
        loopReprojectFromBeats: env._loopReprojectFromBeats,
    });
    return { ...env, TempoMapCmd, beatOf, timeOf };
}

// Old grid: 5 beats, downbeats (measure > 0) at indices 0,2,4 → times 0,2,4.
const OLD = [
    { time: 0, measure: 1 }, { time: 1, measure: -1 }, { time: 2, measure: 2 },
    { time: 3, measure: -1 }, { time: 4, measure: 3 },
];
// A same-length FLEX (indexing preserved): downbeats 0,2,4 → times 0,3,6.
const NEW = [
    { time: 0, measure: 1 }, { time: 1.5, measure: -1 }, { time: 3, measure: 2 },
    { time: 4.5, measure: -1 }, { time: 6, measure: 3 },
];
const clone = g => g.map(b => ({ ...b }));
const near = (a, b) => Math.abs(a - b) < 1e-9;

let pass = 0, fail = 0;
function t(name, fn) {
    try { fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}

t('TempoMapCmd: a bar loop keeps its beats through a flex; undo restores exact seconds', () => {
    // Loop on bars: downbeat index 2 (t=2) → index 4 (t=4) on the OLD grid.
    const S = { beats: clone(OLD), barSel: { startTime: 2, endTime: 4, mode: 'bar' }, duration: 10 };
    const env = makeEnv(S);
    env._loopSyncBeats(S.barSel);                 // β from the OLD grid, as _setBarSel would
    assert.strictEqual(S.barSel.startBeat, 2, 'edge on beat 2');
    assert.strictEqual(S.barSel.endBeat, 4, 'edge on beat 4');

    const cmd = new env.TempoMapCmd(OLD, NEW, 'bpm');
    assert.ok(!('beforeBarSel' in cmd), 'no barSel snapshot field (reproject is self-inverse)');

    cmd.exec();
    assert.ok(near(S.barSel.startTime, 3) && near(S.barSel.endTime, 6),
        `exec keeps the loop on beats 2 & 4 → new times 3 & 6 (got ${S.barSel.startTime},${S.barSel.endTime})`);
    assert.strictEqual(S.barSel.startBeat, 2, 'β is unchanged by a flex');
    assert.strictEqual(S.barSel.endBeat, 4);

    cmd.rollback();
    assert.ok(near(S.barSel.startTime, 2) && near(S.barSel.endTime, 4),
        'rollback reprojects onto the old grid — exact original seconds');

    cmd.exec(); // redo
    assert.ok(near(S.barSel.startTime, 3) && near(S.barSel.endTime, 6), 'redo reprojects again');
});

t('TempoMapCmd: a FREE loop is absolute seconds — a flex never moves it (D17)', () => {
    const S = { beats: clone(OLD), barSel: { startTime: 1.28, endTime: 3.71, mode: 'free' }, duration: 10 };
    const env = makeEnv(S);
    env._loopSyncBeats(S.barSel);
    assert.ok(S.barSel.startBeat === undefined, 'a free loop carries no β');

    const cmd = new env.TempoMapCmd(OLD, NEW, 'bpm');
    cmd.exec();
    assert.ok(near(S.barSel.startTime, 1.28) && near(S.barSel.endTime, 3.71),
        'free loop seconds unchanged by a flex');
    cmd.rollback();
    assert.ok(near(S.barSel.startTime, 1.28) && near(S.barSel.endTime, 3.71));
});

t('TempoMapCmd: a null loop selection round-trips as null', () => {
    const S = { beats: clone(OLD), barSel: null, duration: 10 };
    const env = makeEnv(S);
    const cmd = new env.TempoMapCmd(OLD, NEW, 'bpm');
    cmd.exec();
    assert.strictEqual(S.barSel, null, 'exec leaves a null selection null');
    cmd.rollback();
    assert.strictEqual(S.barSel, null, 'rollback leaves it null');
});

// ── 3D-handoff: region.mode survives the resolver ────────────────────────────
t('pending-view resolver carries a free loop mode through the 3D handoff', () => {
    const pv = { barSel: { startTime: 1.28, endTime: 4.71, mode: 'free' } };
    const out = _resolvePendingViewStatePure(pv, 1, 800, 60);
    assert.strictEqual(out.barSel.mode, 'free', 'free mode must survive the round-trip');
    assert.strictEqual(out.barSel.startTime, 1.28);
    assert.strictEqual(out.barSel.endTime, 4.71);
});

t('pending-view resolver carries a grid loop mode too', () => {
    const pv = { barSel: { startTime: 2, endTime: 6, mode: 'grid' } };
    const out = _resolvePendingViewStatePure(pv, 1, 800, 60);
    assert.strictEqual(out.barSel.mode, 'grid');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
