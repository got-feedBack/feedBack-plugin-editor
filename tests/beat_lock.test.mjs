/*
 * Beat-lock — Phase A5 (charrette §1.8 / D-T5).
 *
 * A hand-verified sync point can be LOCKED so its time is immune to later global
 * tempo re-fits (detect / metric-modulation / measure re-space) — the guard that
 * makes beat-primary safe for by-ear transcription. Locks are editor-pref, keyed
 * by filename, never in the pack (D15).
 *
 * This suite proves:
 *   1. _respaceWithLocksPure — the re-space that holds locked anchors and
 *      affine-interpolates the runs around them: no locks ⇒ identity; a locked
 *      anchor's time is unchanged while its neighbours move; the song ends still
 *      carry the re-fit (a global tempo change still lengthens the song); no beat
 *      is pushed before the song start even under a big stretch; monotonic;
 *      length-mismatch is a no-op; the `locked` flag rides onto the output.
 *   2. persistence pures — _beatLockStorageKeyPure / _beatLockParsePure (defensive)
 *      / _applyBeatLocksPure (re-attach locks by time match, clearing the rest).
 *
 * These reference A5 helpers that do not exist on the base, so the whole suite
 * fails there — a would-fail-on-main test.
 *
 * Run: node tests/beat_lock.test.mjs
 */
import assert from 'node:assert';
import fs from 'node:fs';
import { beatOf as _beatOf, timeOf as _timeOf } from '../src/beats.js';
import {
    _applyBeatLocksPure, _beatLockParsePure, _beatLockStorageKeyPure, _respaceWithLocksPure,
} from '../src/tempo.js';

// The beat-lock pures are real imports. One case still slices: editorApplySync's
// "Scale section times" loop is inline in src/sync-tempo.js, and running the ACTUAL
// loop is what makes that case fail on pre-fix code.
const src = fs.readFileSync(new URL('../src/sync-tempo.js', import.meta.url), 'utf8');

// beatOf / timeOf (the beat-primary converter) — used to prove the sync path now
// reprojects notes onto the warped grid instead of drifting them off it.

// A uniform old grid at 1s beats; a re-fit is a new same-length grid.
const grid = (times, locks = []) => times.map((t, i) => ({ time: t, measure: i === 0 ? 1 : -1, locked: locks.includes(i) }));
const times = bs => bs.map(b => b.time);
const near = (a, b) => Math.abs(a - b) < 1e-9;
const monotonic = bs => bs.every((b, i) => i === 0 || b.time > bs[i - 1].time);

let pass = 0, fail = 0;
function t(name, fn) {
    try { fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}

// ── 1. _respaceWithLocksPure ─────────────────────────────────────────────────
t('no locks ⇒ returns the re-fit untouched (identity)', () => {
    const oldB = grid([0, 1, 2, 3, 4]);
    const neu = grid([0, 1.5, 3, 4.5, 6]);
    assert.strictEqual(_respaceWithLocksPure(oldB, neu), neu, 'same ref back when nothing is locked');
});

t('a length mismatch (a re-index) is a no-op guard', () => {
    const oldB = grid([0, 1, 2], [1]);
    const neu = grid([0, 1, 2, 3]);
    assert.strictEqual(_respaceWithLocksPure(oldB, neu), neu);
});

t("a locked anchor holds while its neighbours move (the §1.8 acceptance)", () => {
    const oldB = grid([0, 1, 2, 3, 4], [2]);         // beat 2 locked at t=2
    const neu = grid([0, 1.5, 3, 4.5, 6]);           // a ×1.5 stretch
    const out = _respaceWithLocksPure(oldB, neu);
    assert.ok(near(out[2].time, 2), 'locked beat 2 held at its old time');
    assert.ok(!near(out[1].time, oldB[1].time) || !near(out[3].time, oldB[3].time),
        'at least one neighbour actually moved');
    assert.deepStrictEqual(times(out).map(x => Math.round(x * 1e6) / 1e6), [0, 1, 2, 4, 6]);
    assert.ok(monotonic(out), 'output stays monotonic');
});

t('the song ends still carry the re-fit (a global tempo change lengthens the song)', () => {
    const oldB = grid([0, 1, 2, 3, 4], [2]);
    const neu = grid([0, 1.5, 3, 4.5, 6]);           // stretched end = 6
    const out = _respaceWithLocksPure(oldB, neu);
    assert.ok(near(out[0].time, 0), 'start carries the re-fit start (0)');
    assert.ok(near(out[4].time, 6), 'end carries the re-fit end (6), not the old 4');
});

t('a big stretch with an EARLY lock never pushes a beat before the song start', () => {
    const oldB = grid([0, 1, 2, 3, 4], [1]);         // beat 1 locked at t=1
    const neu = grid([0, 3, 6, 9, 12]);              // a ×3 stretch
    const out = _respaceWithLocksPure(oldB, neu);
    assert.ok(near(out[1].time, 1), 'beat 1 held');
    assert.ok(out.every(b => b.time >= 0), 'no negative times');
    assert.ok(monotonic(out), 'monotonic');
    assert.ok(near(out[0].time, 0), 'beat 0 stays at the start, not shoved negative');
});

t('two locks: the interior run affine-interpolates between them', () => {
    const oldB = grid([0, 1, 2, 3, 4], [1, 3]);      // beats 1 and 3 locked
    const neu = grid([0, 2, 4, 6, 8]);               // ×2
    const out = _respaceWithLocksPure(oldB, neu);
    assert.ok(near(out[1].time, 1) && near(out[3].time, 3), 'both locks held');
    assert.ok(near(out[2].time, 2), 'the between-locks beat lands midway (1↔3)');
    assert.ok(near(out[4].time, 8), 'the trailing end still carries the re-fit');
});

t('the locked flag rides onto the output beats', () => {
    const oldB = grid([0, 1, 2, 3, 4], [2]);
    const neu = grid([0, 1.5, 3, 4.5, 6]).map(b => ({ time: b.time, measure: b.measure })); // re-fit dropped the flag
    const out = _respaceWithLocksPure(oldB, neu);
    assert.strictEqual(out[2].locked, true, 'lock re-asserted on the re-fit output');
});

// ── 1b. non-monotonic-grid regressions (review) ──────────────────────────────
// A global re-fit can push an end (or a neighbour) past a lock's held old time.
// Pre-fix the lock stayed a fixed point and the grid went BACKWARDS — corrupting
// beatOf/timeOf's binary search. Post-fix an unsatisfiable lock is dropped as a
// fixed point and rides the affine remap, so the grid stays strictly increasing.
const strictInc = bs => bs.every((b, i) => i === 0 || b.time > bs[i - 1].time);
const nonNeg = bs => bs.every(b => b.time >= 0);

t('A compress: an end re-fit past a late lock stays monotonic (was [0,1,2,3,2])', () => {
    const oldB = grid([0, 1, 2, 3, 4], [3]);         // beat 3 locked at t=3
    const neu = grid([0, 0.5, 1, 1.5, 2]);           // song compressed to span 2
    const out = _respaceWithLocksPure(oldB, neu);
    assert.ok(strictInc(out), 'strictly increasing: ' + JSON.stringify(times(out)));
    assert.ok(nonNeg(out), 'no negative times');
});

t('B offset: a positive sync offset past an early lock stays monotonic (was [3,1,3,5,7])', () => {
    const oldB = grid([0, 1, 2, 3, 4], [1]);         // beat 1 locked at t=1
    const neu = grid([3, 4, 5, 6, 7]);               // whole grid shifted +3
    const out = _respaceWithLocksPure(oldB, neu);
    assert.ok(strictInc(out), 'strictly increasing: ' + JSON.stringify(times(out)));
    assert.ok(nonNeg(out), 'no negative times');
});

t('C ends between locks: a re-fit that lands inside the locks stays monotonic (was [0,1,2,3,1.6])', () => {
    const oldB = grid([0, 1, 2, 3, 4], [1, 3]);      // beats 1 and 3 locked
    const neu = grid([0, 0.4, 0.8, 1.2, 1.6]);       // compressed inside lock 3's old time
    const out = _respaceWithLocksPure(oldB, neu);
    assert.ok(strictInc(out), 'strictly increasing: ' + JSON.stringify(times(out)));
    assert.ok(nonNeg(out), 'no negative times');
    assert.ok(near(out[1].time, 1), 'the still-satisfiable early lock holds its time');
});

t('a LOCKED endpoint still yields the re-fit end (ends carry the re-fit, stay monotonic)', () => {
    const oldB = grid([0, 1, 2, 3, 4], [4]);         // the final beat is locked
    const neu = grid([5, 6, 7, 8, 9]);               // sync offset +5
    const out = _respaceWithLocksPure(oldB, neu);
    assert.ok(strictInc(out), 'strictly increasing: ' + JSON.stringify(times(out)));
    assert.ok(near(out[4].time, 9), 'the locked end still carries the re-fit end, not its old 4');
    assert.strictEqual(out[4].locked, true, 'the lock flag still rides');
});

t('editorApplySync reprojection keeps notes on the warped grid at a lock (FIX 2)', () => {
    // sync ×2 stretch (factor 0.5), beat 2 locked at t=2 → grid warps to [0,1,2,5,8].
    const factor = 0.5, offset = 0;
    const oldB = grid([0, 1, 2, 3, 4], [2]);
    const scaled = oldB.map(b => ({ ...b, time: b.time / factor + offset }));
    const respaced = _respaceWithLocksPure(oldB, scaled);
    assert.ok(near(respaced[2].time, 2), 'lock held through the sync');
    const noteT = 1.5;                                // a note between beat 1 and the lock
    const beat = _beatOf(oldB, noteT);
    const reproj = _timeOf(respaced, beat);          // what editorApplySync now writes
    const linear = noteT / factor + offset;          // what the old linear scale wrote
    assert.ok(Math.abs(_beatOf(respaced, reproj) - beat) < 1e-9, 'reprojected note keeps its beat (on grid)');
    assert.ok(Math.abs(reproj - linear) > 1e-6, 'the old linear scale would have drifted off the grid near the lock');
});

t('editorApplySync reprojects SECTION times onto the warped grid under a lock (FIX A)', () => {
    // Extract and RUN the actual "Scale section times" loop from src/sync-tempo.js, so a
    // pre-fix linear-scale body genuinely fails here (would-fail-on-main).
    const secLoop = src.match(/\/\/ Scale section times[\s\S]*?\n    for \(const s of S\.sections\) \{[\s\S]*?\n    \}/);
    assert.ok(secLoop, 'section-scaling loop found in src/sync-tempo.js');
    const runSectionScale = new Function(
        'S', 'locked', 'respaced', 'oldBeats', 'factor', 'offset', 'timeOf', 'beatOf',
        '"use strict";' + secLoop[0]);

    const factor = 0.5, offset = 0;                    // ×2 stretch, beat 2 locked at t=2
    const oldB = grid([0, 1, 2, 3, 4], [2]);
    const scaled = oldB.map(b => ({ ...b, time: b.time / factor + offset }));
    const respaced = _respaceWithLocksPure(oldB, scaled);
    const start = 1.5;                                 // a section between beat 1 and the lock
    const S = { sections: [{ name: 'x', start_time: start }] };
    runSectionScale(S, respaced !== scaled, respaced, oldB, factor, offset, _timeOf, _beatOf);

    const onGrid = _timeOf(respaced, _beatOf(oldB, start));
    const linear = start / factor + offset;
    assert.ok(Math.abs(onGrid - linear) > 1e-6, 'the two strategies actually diverge near the lock');
    assert.ok(near(S.sections[0].start_time, onGrid),
        'section landed on the warped grid (beatOf→timeOf), not the linear drift');
});

// ── 2. persistence pures ─────────────────────────────────────────────────────
t('_beatLockStorageKeyPure keys by filename (empty ⇒ bare prefix)', () => {
    assert.strictEqual(_beatLockStorageKeyPure('song.sloppak'), 'editorBeatLocks:song.sloppak');
    assert.strictEqual(_beatLockStorageKeyPure(''), 'editorBeatLocks:');
    assert.strictEqual(_beatLockStorageKeyPure(null), 'editorBeatLocks:');
});

t('_beatLockParsePure is defensive (junk/array-shape/bad-values all drop out)', () => {
    assert.deepStrictEqual(_beatLockParsePure('[0,1.5,3]'), [0, 1.5, 3]);
    assert.deepStrictEqual(_beatLockParsePure('[1,"x",-2,3]'), [1, 3]);   // NaN + negative dropped
    assert.deepStrictEqual(_beatLockParsePure('not json'), []);
    assert.deepStrictEqual(_beatLockParsePure('{"a":1}'), []);            // non-array
    assert.deepStrictEqual(_beatLockParsePure('null'), []);
});

t('_applyBeatLocksPure re-attaches locks by time match and clears the rest', () => {
    const beats = grid([0, 1, 2, 3]).map(b => ({ time: b.time }));   // no locks yet
    _applyBeatLocksPure(beats, [1.0, 3.0], 0.02);
    assert.deepStrictEqual(beats.map(b => !!b.locked), [false, true, false, true]);
});

t('_applyBeatLocksPure matches within tolerance and the nearest beat only', () => {
    const beats = grid([0, 1, 2]).map(b => ({ time: b.time }));
    _applyBeatLocksPure(beats, [1.005], 0.02);      // within 20 ms of beat 1
    assert.deepStrictEqual(beats.map(b => !!b.locked), [false, true, false]);
    _applyBeatLocksPure(beats, [1.5], 0.02);        // 500 ms off ⇒ no match, and prior lock cleared
    assert.deepStrictEqual(beats.map(b => !!b.locked), [false, false, false]);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
