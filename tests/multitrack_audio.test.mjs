import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, '..', 'src', 'audio.js'), 'utf8');
const start = source.indexOf('function _ensureTrackGain(');
const end = source.indexOf('// Undoable audio placement shift', start);
if (start < 0 || end < 0) throw new Error('multitrack transport block missing');
const block = source.slice(start, end).replace(/^export\s+/gm, '');

function param() {
    return { value: 0, calls: [], setTargetAtTime(v, t, c) { this.calls.push([v, t, c]); } };
}
const made = [];
const ctx = {
    currentTime: 10,
    destination: {},
    createGain() {
        const node = { gain: param(), connect() {}, disconnect() {} };
        made.push(node); return node;
    },
    createBufferSource() {
        const node = {
            buffer: null, connected: null, starts: [], stopped: false,
            connect(target) { this.connected = target; },
            start(...args) { this.starts.push(args); },
            stop() { this.stopped = true; },
        };
        made.push(node); return node;
    },
};
const S = {
    audioCtx: ctx, cursorTime: 12, audioShift: 0, audioBuffer: { duration: 90 },
    audioUrl: '/master', activeAudioSourceId: 'master', audioSource: null,
    audioSources: [
        { id: 'master', url: '/master', offset: 0 },
        { id: 'stem:drums', url: '/drums', offset: 0.25 },
        { id: 'stem:bass', url: '/bass', offset: 0 },
    ],
};
const host = { partStripState: () => ({ audible: true, vol: 10 ** (6 / 20) }) };
const env = new Function('S', 'host', '_attachMeterTap', '_ensureRefGain', '_audioBufferStartPure',
    `const playingTrackSources = new Map(); const trackGainNodes = new Map();
     const trackAudioCache = new Map([
       ['master', {url:'/master', buffer:{duration:90}}],
       ['stem:drums', {url:'/drums', buffer:{duration:90}}],
       ['stem:bass', {url:'/bass', buffer:{duration:90}}]
     ]);
     ${block}
     return { start: _startTrackAudioSources, stop: _stopTrackAudioSources,
       playing: playingTrackSources, gains: trackGainNodes };`)(
    S, host, () => {}, () => ({ connect() {} }),
    (cursor, shift, duration) => ({ play: cursor < duration, offset: cursor - shift, delay: 0 }),
);

assert.strictEqual(env.start(0.5), 3, 'every decoded source starts');
assert.strictEqual(env.playing.size, 3);
const nodes = [...env.playing.values()];
assert.ok(nodes.every(node => node.starts[0][0] === 10.5), 'all sources share one context start frame');
assert.strictEqual(env.playing.get('stem:drums').starts[0][1], 11.75, 'per-source offset is honored');
assert.strictEqual(S.audioSource, env.playing.get('master'), 'focused source remains the waveform reference');
assert.strictEqual(env.gains.size, 3, 'each source owns an independent fader gain');
assert.ok([...env.gains.values()].every(node => Math.abs(node.gain.value - 10 ** (6 / 20)) < 1e-9),
    'audio gain nodes honor the channel strip\'s +6 dB headroom');
env.stop();
assert.ok(nodes.every(node => node.stopped), 'stop silences every source');
assert.strictEqual(env.playing.size, 0);

console.log('multitrack audio: 7 passed');
