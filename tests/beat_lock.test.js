'use strict';
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
 * Run: node tests/beat_lock.test.js
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const src = fs.readFileSync(path.join(__dirname, '..', 'screen.js'), 'utf8');
const block = src.match(/\/\* @pure:beat-lock:start \*\/[\s\S]*?\/\* @pure:beat-lock:end \*\//);
if (!block) { console.error('FAIL: @pure:beat-lock block not found (A5 not applied)'); process.exit(1); }
const {
    _respaceWithLocksPure, _beatLockStorageKeyPure, _beatLockParsePure, _applyBeatLocksPure,
} = new Function('"use strict";' + block[0]
    + '\nreturn { _respaceWithLocksPure, _beatLockStorageKeyPure, _beatLockParsePure, _applyBeatLocksPure };'
)();

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
