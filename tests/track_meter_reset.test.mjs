// Regression: switching songs tears down the per-track gain nodes, so the
// meter taps keyed to them must be forgotten too. Otherwise _attachMeterTap's
// dedupe guard leaves every audio-track VU meter reading the dead old node
// after the first song switch. Extracts the real reset path and drives it
// against mock analyser/gain graphs — no WebAudio needed.
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.join(here, '..', 'src', 'audio.js'), 'utf8');

function extract(name) {
    const start = src.indexOf('function ' + name + '(');
    if (start < 0) throw new Error('could not find definition of ' + name);
    const open = src.indexOf('{', start);
    let depth = 0;
    for (let i = open; i < src.length; i++) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}' && --depth === 0) return src.slice(start, i + 1);
    }
    throw new Error('could not extract ' + name);
}

const reset = extract('resetTrackAudioCache');
const detach = extract('_detachTrackMeters');
assert.match(reset, /_detachTrackMeters\(\)/, 'resetTrackAudioCache must invalidate the track meter taps');

function analyser() { return { disconnected: false, disconnect() { this.disconnected = true; } }; }

const S = { activeAudioSourceId: 'stem:bass' };
const env = new Function('S', `
    let trackPreloadGeneration = 4;
    const trackAudioCache = new Map([['master', {}], ['stem:bass', {}]]);
    const trackGainNodes = new Map([['master', { disconnect() {} }]]);
    function _stopTrackAudioSources() {}
    const _meterAnalysers = Object.create(null);
    _meterAnalysers['ref'] = arguments[1]();
    _meterAnalysers['track:audio:master'] = arguments[1]();
    _meterAnalysers['track:audio:stem:bass'] = arguments[1]();
    ${detach}
    ${reset}
    return { reset: resetTrackAudioCache, meters: _meterAnalysers, cache: trackAudioCache };
`)(S, analyser);

const before = env.meters;
const trackMaster = before['track:audio:master'];
const trackBass = before['track:audio:stem:bass'];
env.reset();

assert.ok(!('track:audio:master' in env.meters), 'stale track meter tap is dropped on reset');
assert.ok(!('track:audio:stem:bass' in env.meters), 'every track meter tap is dropped');
assert.ok(trackMaster.disconnected && trackBass.disconnected, 'the old track analysers are disconnected');
assert.ok('ref' in env.meters, 'bus meter taps survive a song switch');
assert.strictEqual(env.cache.size, 0, 'the decoded-source cache is cleared');
assert.strictEqual(S.activeAudioSourceId, 'master', 'active source resets to master');

console.log('track meter reset: 6 passed');
