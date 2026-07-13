/*
 * The BACKGROUND banded-onset job's lifecycle (#250), as opposed to the pure
 * chunking maths in onset_chunk.test.mjs.
 *
 * _ensureOnsets() now returns the cheap RMS onsets synchronously and kicks off a
 * chunked spectral-flux upgrade that lands later. That sync→async migration
 * carries the usual two traps, both pinned here:
 *
 *   1. The chunk driver must not be requestAnimationFrame. rAF does not exist
 *      outside a browser (every module here has to stay node-importable) and it is
 *      FROZEN in a backgrounded window, which would stall the analysis until the
 *      editor is looked at again.
 *   2. Precondition re-check after the await. Loading an audio-less song just
 *      nulls S.audioBuffer (file-ops.js loadCDLC, create.js editorApplyCreateResult)
 *      — it never reaches computeWaveform()/teardownAudio(), so the job's cancelled
 *      flag is never set. The in-flight job must notice the buffer is no longer the
 *      session's and drop its result instead of writing the OLD song's onsets into
 *      the NEW session's cache.
 *
 * Run: node --test tests/onset_job.test.mjs
 */
import assert from 'node:assert';
import { S } from '../src/state.js';
import { _ensureOnsets, _onsetDetectorLabel, computeWaveform } from '../src/audio.js';
import { seedState } from './_history_env.mjs';

// NOTE: requestAnimationFrame is deliberately NOT stubbed anywhere in this file —
// that is the point of case 1. The driver must run on plain timers.
assert.strictEqual(typeof globalThis.requestAnimationFrame, 'undefined', 'no rAF in node');

let pass = 0, fail = 0;
async function t(name, fn) {
    try { await fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}
const settle = () => new Promise(r => setTimeout(r, 30));

// A 2s click train at 8kHz — enough attacks for the flux detector to fire, small
// enough that the whole job finishes inside one settle().
function fakeBuffer(sampleRate = 8000, dur = 2) {
    const n = Math.floor(sampleRate * dur);
    const data = new Float32Array(n);
    for (let c = 0; c < 8; c++) {
        const start = Math.round((0.1 + c * 0.22) * sampleRate);
        for (let i = 0; i < 200 && start + i < n; i++) {
            data[start + i] = Math.sin((2 * Math.PI * 900 * i) / sampleRate) * (1 - i / 200);
        }
    }
    return { sampleRate, duration: dur, numberOfChannels: 1, length: n, getChannelData: () => data };
}

// Install a decoded buffer the way loadAudio() does: set it, then computeWaveform()
// (which builds S.waveformPeaks and resets the onset cache + any in-flight job).
function loadFakeAudio() {
    seedState();
    const buf = fakeBuffer();
    S.audioBuffer = buf;
    S.duration = buf.duration;
    computeWaveform();
    return buf;
}

// ── 1. the chunk driver survives a world with no requestAnimationFrame ────────
await t('_ensureOnsets does not reach for rAF (node-importable; alive when backgrounded)', async () => {
    loadFakeAudio();
    const rms = _ensureOnsets();          // pre-fix: ReferenceError: requestAnimationFrame is not defined
    assert.ok(rms && rms.length, 'RMS onsets returned synchronously');
    assert.strictEqual(_onsetDetectorLabel(), 'rms', 'RMS is what the first read sees');
});

// Positive control: with the session untouched, the job DOES land and upgrade the
// cache — otherwise case 2 below could pass for the wrong reason.
await t('the background job upgrades the cache to spectral-flux', async () => {
    loadFakeAudio();
    _ensureOnsets();
    await settle();
    assert.strictEqual(_onsetDetectorLabel(), 'spectral-flux', 'upgraded once the job landed');
    const on = _ensureOnsets();
    assert.ok(on && on.length, 'flux onsets cached');
    assert.ok(on.every(o => Number.isFinite(o.t) && o.t >= 0), 'finite, non-negative onset times');
});

// ── 2. a job whose buffer left the session must not write into its cache ──────
await t('an audio-less load drops the in-flight job instead of caching the old song onsets', async () => {
    loadFakeAudio();
    const rms = _ensureOnsets();          // starts the flux job
    const before = rms.slice();
    // Exactly what loadCDLC / editorApplyCreateResult do for a song with no audio:
    // the buffer is dropped WITHOUT computeWaveform(), so nothing cancels the job.
    S.audioBuffer = null;
    await settle();
    // pre-fix: the stale job finished and stamped the previous song's spectral-flux
    // onsets over the new session's cache.
    assert.strictEqual(_onsetDetectorLabel(), 'rms', 'no spectral-flux result from the dead buffer');
    assert.deepStrictEqual(_ensureOnsets(), before, 'cache untouched by the stale job');
});

await t('replacing the audio mid-job keeps the NEW buffer result, not the old one', async () => {
    loadFakeAudio();
    _ensureOnsets();                      // job A, in flight
    const buf = fakeBuffer(8000, 1.2);    // replace-audio: new buffer + computeWaveform
    S.audioBuffer = buf;
    S.duration = buf.duration;
    computeWaveform();                    // cancels job A, clears the cache
    _ensureOnsets();                      // job B
    await settle();
    assert.strictEqual(_onsetDetectorLabel(), 'spectral-flux');
    const on = _ensureOnsets();
    assert.ok(on.every(o => o.t <= buf.duration + 0.05), 'every onset is inside the NEW buffer');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
