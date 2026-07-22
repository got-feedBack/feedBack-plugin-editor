/*
 * Audio placement shift — slide the recording in time while the chart stays fixed.
 *
 * Non-destructive: the samples are never stretched; only the buffer read position
 * (playback) and the waveform/onset rendering move. This suite proves:
 *   1. _audioBufferStartPure — where/when to start the buffer given the playhead
 *      chart-time, the shift, and the buffer length (incl. the pre-audio delay and
 *      the past-the-end no-source case).
 *   2. AudioShiftCmd / editorSetAudioShift — the undoable scalar move (1ms
 *      resolution, no-op when unchanged, exec→rollback→redo).
 *
 * Run: node tests/audio_shift.test.mjs
 */
import assert from 'node:assert';
import { S } from '../src/state.js';
import { EditHistory } from '../src/history.js';
import { _audioBufferStartPure, _audioTimelineDurationPure, _regionStartPure, AudioShiftCmd, editorSetAudioShift } from '../src/audio.js';
import { seedState, trackHooks, lastStatus } from './_history_env.mjs';

let pass = 0, fail = 0;
function t(name, fn) {
    try { fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}
const near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

// ── 1. _audioBufferStartPure ─────────────────────────────────────────────────
t('no shift → play from the cursor, no delay', () => {
    assert.deepStrictEqual(_audioBufferStartPure(3, 0, 100), { play: true, offset: 3, delay: 0 });
});
t('positive shift, cursor past the shift → skip into the buffer', () => {
    // audio slid +2s later; at chart-time 5 the buffer is at 5-2 = 3.
    assert.deepStrictEqual(_audioBufferStartPure(5, 2, 100), { play: true, offset: 3, delay: 0 });
});
t('positive shift, cursor before the shift → delay the start, buffer 0', () => {
    // at chart-time 0.5 the audio (slid +2s) has not begun; it begins in 1.5s.
    const r = _audioBufferStartPure(0.5, 2, 100);
    assert.ok(r.play && near(r.offset, 0) && near(r.delay, 1.5));
});
t('negative shift → play deeper into the buffer immediately', () => {
    // audio slid 1s EARLIER; at chart-time 3 the buffer is at 3-(-1) = 4.
    assert.deepStrictEqual(_audioBufferStartPure(3, -1, 100), { play: true, offset: 4, delay: 0 });
});
t('past the (shifted) end → no source, transport still runs', () => {
    // buffer is 10s; at chart-time 12 with no shift the audio has ended.
    assert.deepStrictEqual(_audioBufferStartPure(12, 0, 10), { play: false, offset: 0, delay: 0 });
    // a +5s shift pushes the end to chart-time 15, so 12 still plays.
    assert.deepStrictEqual(_audioBufferStartPure(12, 5, 10), { play: true, offset: 7, delay: 0 });
});
t('unknown/zero buffer duration never reports past-the-end', () => {
    assert.strictEqual(_audioBufferStartPure(999, 0, 0).play, true);
});

t('_audioTimelineDurationPure extends positive shifts so delayed tails are reachable', () => {
    assert.strictEqual(_audioTimelineDurationPure(10, 2, 10), 12, 'positive shift extends the timeline');
    assert.strictEqual(_audioTimelineDurationPure(15, 2, 10), 15, 'existing longer chart still wins');
    assert.strictEqual(_audioTimelineDurationPure(10, -2, 10), 10, 'negative shift never shrinks the chart');
    assert.strictEqual(_audioTimelineDurationPure(8, 2, 0), 8, 'no buffer falls back to chart duration');
});

// ── 2. AudioShiftCmd / editorSetAudioShift ───────────────────────────────────
function seed() {
    trackHooks();
    seedState({ arrangements: [{ name: 'G', notes: [], chords: [] }], currentArr: 0,
        audioShift: 0, playing: false, history: new EditHistory() });
}
t('AudioShiftCmd sets S.audioShift and round-trips exec→undo→redo', () => {
    seed();
    S.history.exec(new AudioShiftCmd(0, 0.25));
    assert.ok(near(S.audioShift, 0.25), 'exec applied the shift');
    S.history.doUndo();
    assert.ok(near(S.audioShift, 0), 'undo restored');
    S.history.doRedo();
    assert.ok(near(S.audioShift, 0.25), 'redo re-applied');
});
t('editorSetAudioShift rounds to 1ms, execs a command, and names the move', () => {
    seed();
    editorSetAudioShift('0.2004');
    assert.ok(near(S.audioShift, 0.2), 'rounded to the millisecond');
    assert.strictEqual(S.history.undo.length, 1, 'one undoable command');
    assert.ok(/Audio shifted \+200ms/.test(lastStatus()), 'status names the shift + that the chart is unchanged');
    assert.ok(/chart unchanged/.test(lastStatus()));
});
t('editorSetAudioShift is a no-op when the value is unchanged', () => {
    seed();
    S.audioShift = 0.1;
    editorSetAudioShift('0.1');
    assert.strictEqual(S.history.undo.length, 0, 'no command pushed for a no-op');
});

// ── _regionStartPure — the per-region generalization (track-regions PR4) ──────
// The whole-stem case is a region [srcIn=0, srcOut=duration] placed at the audio
// shift. This MUST stay byte-identical to _audioBufferStartPure so PR4 doesn't
// regress today's single-source scheduling — the pinned invariant.
t('_regionStartPure(cursor, shift, 0, dur) === _audioBufferStartPure for every cursor', () => {
    const dur = 30, shift = 4;   // +4s pre-roll
    for (const cursor of [-2, 0, 3.9, 4, 4.0001, 10, 33.999, 34, 40]) {
        const legacy = _audioBufferStartPure(cursor, shift, dur);
        const region = _regionStartPure(cursor, shift, 0, dur);
        assert.strictEqual(region.play, legacy.play, `play @${cursor}`);
        assert.ok(near(region.offset, legacy.offset), `offset @${cursor}: ${region.offset} vs ${legacy.offset}`);
        assert.ok(near(region.delay, legacy.delay), `delay @${cursor}: ${region.delay} vs ${legacy.delay}`);
    }
});
t('_regionStartPure — a trimmed region plays only its [srcIn,srcOut) window', () => {
    // Region: media 2s..6s (4s of content) placed at chart-time 10.
    const at = (c) => _regionStartPure(c, 10, 2, 6);
    // Before it begins: wait, then start at the in-point, for the full window.
    assert.deepStrictEqual(at(8), { play: true, offset: 2, delay: 2, duration: 4 });
    // At the start: offset = in-point, no delay.
    assert.deepStrictEqual(at(10), { play: true, offset: 2, delay: 0, duration: 4 });
    // 2s in: read 2s past the in-point, 2s of window left.
    assert.deepStrictEqual(at(12), { play: true, offset: 4, delay: 0, duration: 2 });
    // At the trimmed tail (10 + 4): past the region — no source.
    assert.deepStrictEqual(at(14), { play: false, offset: 0, delay: 0, duration: 0 });
    // Just inside the tail: a sliver still plays.
    const sliver = at(13.99);
    assert.ok(sliver.play && near(sliver.offset, 5.99) && near(sliver.duration, 0.01), 'sliver at the tail');
});
t('_regionStartPure — no/invalid srcOut means play to the buffer end (duration null)', () => {
    // srcOut null or ≤ srcIn → untrimmed tail: duration null (scheduler omits the
    // start() 3rd arg) and no past-end cutoff.
    assert.deepStrictEqual(_regionStartPure(5, 0, 0, null), { play: true, offset: 5, delay: 0, duration: null });
    assert.deepStrictEqual(_regionStartPure(5, 0, 3, 3), { play: true, offset: 8, delay: 0, duration: null });
    // Negative srcIn is clamped to 0.
    assert.strictEqual(_regionStartPure(5, 0, -1, 20).offset, 5);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
