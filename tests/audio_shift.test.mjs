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
import { _audioBufferStartPure, _audioTimelineDurationPure, AudioShiftCmd, editorSetAudioShift } from '../src/audio.js';
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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
