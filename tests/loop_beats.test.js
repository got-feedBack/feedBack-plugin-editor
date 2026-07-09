'use strict';
/*
 * Loop edges as beat coordinates — Phase A4 (charrette §1.6).
 *
 * A bar/grid loop edge IS a beat coordinate (β); its seconds are a cache =
 * timeOf(β). Free-loop edges stay absolute seconds (D17). So a loop follows the
 * grid the same way a note does (A2): its β is the truth on a tempo FLEX
 * (seconds re-derived), and its seconds are the truth on a grid RE-INDEX (β
 * re-lifted). Both are exact inverses, so the whole lossy _loopRelockAfterGrid-
 * Change + TempoMapCmd/TempoGridCmd barSel-snapshot complication is gone.
 *
 * This suite proves the A4 helpers directly + the TempoGridCmd (re-index) path:
 *   1. _loopSyncBeats — β from seconds for bar/grid; free clears β; a degenerate
 *      (<2-beat) grid is the identity.
 *   2. _loopReprojectFromBeats — a flex keeps β and re-derives seconds (stays on
 *      the bars); a free loop and a β-less loop are left untouched.
 *   3. _loopReliftBeats — a re-index keeps seconds and re-lifts β; free untouched.
 *   4. TempoGridCmd — a bar loop's seconds stay put while β re-lifts, and
 *      exec/rollback round-trips with NO barSel snapshot field.
 *
 * These reference A4 helpers (_loopSyncBeats/_loopReprojectFromBeats/
 * _loopReliftBeats) that do not exist on origin/main, so the whole suite fails
 * on main — a would-fail-on-main test.  (TempoMapCmd's flex + undo symmetry live
 * in loop_undo_mode.test.js.)
 *
 * Run: node tests/loop_beats.test.js
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');

function extractFn(name) {
    const start = src.indexOf('function ' + name + '(');
    assert.ok(start >= 0, `function ${name} must exist (absent on main ⇒ A4 not applied)`);
    return braceSlice(start);
}
function extractClass(name) {
    const start = src.indexOf('class ' + name + ' {');
    assert.ok(start >= 0, `class ${name} must exist`);
    return braceSlice(start);
}
function braceSlice(start) {
    const open = src.indexOf('{', start);
    let d = 0;
    for (let i = open; i < src.length; i++) {
        if (src[i] === '{') d++;
        else if (src[i] === '}' && --d === 0) return src.slice(start, i + 1);
    }
    throw new Error('unbalanced braces');
}
const conv = src.match(/\/\* @pure:beat-converter:start \*\/[\s\S]*?\/\* @pure:beat-converter:end \*\//);
if (!conv) { console.error('FAIL: @pure:beat-converter block not found'); process.exit(1); }

// Sandbox exposing the three A4 loop helpers over the real converter + S.
function helperEnv(S) {
    return new Function('S',
        '"use strict";' + conv[0] + '\n'
        + extractFn('_loopSyncBeats') + '\n'
        + extractFn('_loopReprojectFromBeats') + '\n'
        + extractFn('_loopReliftBeats')
        + '\nreturn { _loopSyncBeats, _loopReprojectFromBeats, _loopReliftBeats, beatOf, timeOf };'
    )(S);
}
// Sandbox exposing the real TempoGridCmd + _loopReliftBeats over S.
function gridEnv(S) {
    return new Function('S', '_renderLoopStrip', '_updateLoopIn3DBtn', '_liftAllBeats',
        '"use strict";' + conv[0] + '\n' + extractFn('_loopReliftBeats') + '\n'
        + extractClass('TempoGridCmd')
        + '\nreturn { TempoGridCmd };'
    )(S, () => {}, () => {}, () => {});
}

const clone = g => g.map(b => ({ ...b }));
const near = (a, b) => Math.abs(a - b) < 1e-9;
// Downbeats at indices 0,2,4 → times 0,2,4.
const GRID = [
    { time: 0, measure: 1 }, { time: 1, measure: -1 }, { time: 2, measure: 2 },
    { time: 3, measure: -1 }, { time: 4, measure: 3 },
];

let pass = 0, fail = 0;
function t(name, fn) {
    try { fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}

// ── 1. _loopSyncBeats ────────────────────────────────────────────────────────
t('_loopSyncBeats: a bar loop gets integer β from its downbeat seconds', () => {
    const S = { beats: clone(GRID) };
    const env = helperEnv(S);
    const r = { startTime: 2, endTime: 4, mode: 'bar' };
    env._loopSyncBeats(r);
    assert.strictEqual(r.startBeat, 2);
    assert.strictEqual(r.endBeat, 4);
});
t('_loopSyncBeats: a grid loop gets FRACTIONAL β from a subdivided edge', () => {
    const S = { beats: clone(GRID) };
    const env = helperEnv(S);
    const r = { startTime: 1.5, endTime: 3, mode: 'grid' };   // 1.5s is halfway in gap [1,2] ⇒ β 1.5
    env._loopSyncBeats(r);
    assert.ok(near(r.startBeat, 1.5), `startBeat=${r.startBeat}`);
    assert.ok(near(r.endBeat, 3));
});
t('_loopSyncBeats: a free loop carries NO β', () => {
    const S = { beats: clone(GRID) };
    const env = helperEnv(S);
    const r = { startTime: 1.28, endTime: 3.71, mode: 'free', startBeat: 9, endBeat: 9 };
    env._loopSyncBeats(r);
    assert.strictEqual(r.startBeat, undefined, 'free loop drops any β');
    assert.strictEqual(r.endBeat, undefined);
});
t('_loopSyncBeats: a degenerate (<2-beat) grid is the identity (β = seconds)', () => {
    const S = { beats: [{ time: 0, measure: 1 }] };
    const env = helperEnv(S);
    const r = { startTime: 1.2, endTime: 3.4, mode: 'bar' };
    env._loopSyncBeats(r);
    assert.strictEqual(r.startBeat, 1.2);   // no tempo map ⇒ seconds-primary
    assert.strictEqual(r.endBeat, 3.4);
});

// ── 2. _loopReprojectFromBeats (a tempo FLEX: β fixed, seconds follow) ────────
t('_loopReprojectFromBeats: a bar loop stays on its bars across a flex', () => {
    const S = { beats: clone(GRID), barSel: { startTime: 2, endTime: 4, mode: 'bar', startBeat: 2, endBeat: 4 } };
    const env = helperEnv(S);
    const flexed = [ // downbeats 0,2,4 now at times 0,3,6
        { time: 0, measure: 1 }, { time: 1.5, measure: -1 }, { time: 3, measure: 2 },
        { time: 4.5, measure: -1 }, { time: 6, measure: 3 },
    ];
    env._loopReprojectFromBeats(flexed);
    assert.ok(near(S.barSel.startTime, 3) && near(S.barSel.endTime, 6),
        `beats 2 & 4 → times 3 & 6 (got ${S.barSel.startTime},${S.barSel.endTime})`);
    assert.strictEqual(S.barSel.startBeat, 2, 'β untouched');
});
t('_loopReprojectFromBeats: a free loop is left untouched', () => {
    const S = { beats: clone(GRID), barSel: { startTime: 1.28, endTime: 3.71, mode: 'free' } };
    const env = helperEnv(S);
    env._loopReprojectFromBeats(clone(GRID).map(b => ({ ...b, time: b.time * 2 })));
    assert.ok(near(S.barSel.startTime, 1.28) && near(S.barSel.endTime, 3.71), 'free seconds unchanged');
});
t('_loopReprojectFromBeats: a β-less bar loop is a safe no-op (seconds unchanged)', () => {
    const S = { beats: clone(GRID), barSel: { startTime: 2, endTime: 4, mode: 'bar' } };  // no β
    const env = helperEnv(S);
    env._loopReprojectFromBeats(clone(GRID).map(b => ({ ...b, time: b.time * 2 })));
    assert.ok(near(S.barSel.startTime, 2) && near(S.barSel.endTime, 4), 'no β ⇒ leave seconds put');
});

// ── 3. _loopReliftBeats (a RE-INDEX: seconds fixed, β re-lifts) ───────────────
t('_loopReliftBeats: seconds stay put, β re-lifts onto the new indexing', () => {
    const S = { beats: clone(GRID), barSel: { startTime: 1, endTime: 2, mode: 'bar', startBeat: 1, endBeat: 2 } };
    const env = helperEnv(S);
    // Insert a beat at 0.5 → time 1 is now beat 2, time 2 is now beat 3.
    const reindexed = [
        { time: 0, measure: 1 }, { time: 0.5, measure: -1 }, { time: 1, measure: 2 },
        { time: 1.5, measure: -1 }, { time: 2, measure: 3 },
    ];
    env._loopReliftBeats(reindexed);
    assert.ok(near(S.barSel.startTime, 1) && near(S.barSel.endTime, 2), 'seconds unchanged by a re-index');
    assert.strictEqual(S.barSel.startBeat, 2, 'β re-lifted: time 1 is now beat 2');
    assert.strictEqual(S.barSel.endBeat, 4, 'time 2 is now beat 4');
});
t('_loopReliftBeats: a free loop is left untouched', () => {
    const S = { beats: clone(GRID), barSel: { startTime: 1.28, endTime: 3.71, mode: 'free' } };
    const env = helperEnv(S);
    env._loopReliftBeats(clone(GRID));
    assert.strictEqual(S.barSel.startBeat, undefined);
});

// ── 4. TempoGridCmd round-trips the loop with no snapshot ─────────────────────
t('TempoGridCmd: loop seconds stay put + β re-lifts; exec/rollback round-trips, no snapshot', () => {
    const OLD = [{ time: 0, measure: 1 }, { time: 1, measure: 2 }, { time: 2, measure: 3 }];
    const NEW = [ // insert a beat at 0.5: time 1 → beat 2, time 2 → beat 3
        { time: 0, measure: 1 }, { time: 0.5, measure: -1 }, { time: 1, measure: 2 }, { time: 2, measure: 3 },
    ];
    const S = { beats: clone(OLD), barSel: { startTime: 1, endTime: 2, mode: 'bar', startBeat: 1, endBeat: 2 } };
    const env = gridEnv(S);
    const cmd = new env.TempoGridCmd(OLD, NEW, 'insert sync');
    assert.ok(!('beforeBarSel' in cmd), 'no barSel snapshot field');

    cmd.exec();
    assert.ok(near(S.barSel.startTime, 1) && near(S.barSel.endTime, 2), 'loop seconds unchanged by a re-index');
    assert.strictEqual(S.barSel.startBeat, 2, 'β re-lifted onto the new grid');
    assert.strictEqual(S.barSel.endBeat, 3);

    cmd.rollback();
    assert.ok(near(S.barSel.startTime, 1) && near(S.barSel.endTime, 2), 'seconds still unchanged after undo');
    assert.strictEqual(S.barSel.startBeat, 1, 'β re-lifted back onto the old grid');
    assert.strictEqual(S.barSel.endBeat, 2);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
