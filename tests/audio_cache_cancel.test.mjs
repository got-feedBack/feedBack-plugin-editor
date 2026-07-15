/*
 * Cached source installs must invalidate pending loads (src/audio.js).
 *
 * activateTrackAudioSource() and loadAudio() both have a cache-hit fast path
 * that installs a decoded buffer and returns. If a slower stem decode is still
 * in flight, it would finish afterward and silently replace the just-installed
 * cached source. Both fast paths must call cancelAudioLoad() (advance the load
 * generation) so the stale decode's generation check bails.
 *
 * Run: node tests/audio_cache_cancel.test.mjs
 */
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, '..', 'src', 'audio.js'), 'utf8');
const start = source.indexOf('function _installDecodedAudio(');
const end = source.indexOf('function _buildWaveformPeaks(');
if (start < 0 || end < 0) throw new Error('audio.js cache/cancel block missing');
const block = source.slice(start, end).replace(/^export\s+/gm, '');

function makeEnv() {
    const S = {
        audioSources: [], audioBuffer: null, duration: 0, audioUrl: null,
        activeAudioSourceId: 'master', audioCtx: { decodeAudioData: async () => ({ duration: 90 }) },
    };
    const host = { draw() {}, editorApplyScrollBounds() {} };
    const entry = (url, decoded) => ({ url, buffer: decoded, peaks: null });
    const env = new Function(
        'S', 'host', 'setStatus', 'computeWaveform', '_trackAudioCacheEntry',
        '_stopTrackAudioSources', '_detachTrackMeters', '_resetAuditionForNewSong',
        '_mixResetFirstPlay', 'fetch', 'AbortController', 'window',
        `let audioLoadGeneration = 0; let audioLoadController = null; let trackPreloadGeneration = 0;
         const trackAudioCache = new Map();
         const trackGainNodes = new Map();
         ${block}
         return { activateTrackAudioSource, loadAudio, cancelAudioLoad, trackAudioCache,
                  gen: () => audioLoadGeneration };`,
    )(S, host, () => {}, () => {}, entry,
      () => {}, () => {}, () => {}, () => {},
      async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(0) }),
      AbortController, { AudioContext: function () {} });
    return { S, env };
}

let pass = 0, fail = 0;
async function t(name, fn) {
    try { await fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}

await t('activateTrackAudioSource cache-hit advances the load generation', async () => {
    const { S, env } = makeEnv();
    S.audioSources = [{ id: 'master', url: '/B', name: 'Master Mix' }];
    env.trackAudioCache.set('master', { url: '/B', buffer: { duration: 90 }, peaks: null });
    const g0 = env.gen();
    const ok = await env.activateTrackAudioSource('master');
    assert.strictEqual(ok, true, 'cached source activates');
    assert.strictEqual(env.gen(), g0 + 1, 'a pending decode is invalidated before install');
});

await t('loadAudio cache-hit advances the load generation', async () => {
    const { env } = makeEnv();
    env.trackAudioCache.set('stem:a', { url: '/A', buffer: { duration: 90 }, peaks: null });
    const g0 = env.gen();
    const ok = await env.loadAudio('/A', { sourceId: 'stem:a', preserveTimeline: true });
    assert.strictEqual(ok, true, 'cached url loads');
    assert.strictEqual(env.gen(), g0 + 1, 'a pending decode is invalidated before install');
});

console.log(`audio cache cancel: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
