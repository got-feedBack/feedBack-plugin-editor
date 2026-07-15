/*
 * Multi-track MIDI playback ("band mode"): every part's charted notes voice
 * their GM instrument simultaneously, and the Mixer's Tracks strips become a
 * real mixer over them (per-part gain nodes, whole-map solo rule).
 *
 * Pinned here:
 *   - the band roster uses EXACTLY the mixer panel's strip keys
 *     ('arr:<idx>' / 'drums'), so strips and engine can never disagree;
 *   - the per-key strip state applies the DAW rule ACROSS parts (a solo on
 *     one track silences the others' gains, mute always wins);
 *   - the dedupe key is part-scoped (two parts on the same millisecond
 *     both sound);
 *   - the pref round-trips localStorage and the toggle notifies the panel;
 *   - band mode bounds the song by EVERY part's notes; off = active only.
 *
 * Fails on main (the band-mode exports don't exist there).
 * Run: node tests/midi_playback.test.mjs
 */
import assert from 'node:assert';

globalThis.document = globalThis.document || {
    getElementById: () => null, addEventListener: () => {}, activeElement: null,
};
const stored = {};
globalThis.localStorage = {
    getItem: (k) => (k in stored ? stored[k] : null),
    setItem: (k, v) => { stored[k] = v; },
};
globalThis.window = globalThis.window || globalThis;

const audio = await import('../src/audio.js');
const { editorPlayAllTracksEnabled, editorTogglePlayAllTracks } = audio;
const { _mixerPartStripState } = await import('../src/mixer-panel.js');
const { host, setHostHooks } = await import('../src/host.js');
const { S } = await import('../src/state.js');

let pass = 0, fail = 0;
function t(name, fn) {
    try { fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}

// The @pure:midi-playback block, sliced (the pures are module-local).
import { readFileSync } from 'node:fs';
const src = readFileSync(new URL('../src/audio.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
function slice(name) {
    const at = src.indexOf(`function ${name}`);
    const body = src.slice(at, src.indexOf('\n}', at) + 2);
    return new Function(`return (${body.replace(`function ${name}`, 'function')})`)();
}
const _bandPartsPure = slice('_bandPartsPure');
const _bandFiredKeyPure = slice('_bandFiredKeyPure');

t('the band roster mirrors the mixer strip keys, drums last', () => {
    const parts = _bandPartsPure(
        [{ name: 'Lead' }, { name: 'Bass' }],
        { hits: [{ t: 1 }] });
    assert.deepStrictEqual(parts.map(p => p.key), ['arr:0', 'arr:1', 'drums']);
    assert.deepStrictEqual(_bandPartsPure([{ name: 'Lead' }], null).map(p => p.key), ['arr:0'],
        'no drum tab = no drums strip');
    assert.deepStrictEqual(_bandPartsPure([{ name: 'Lead' }], { hits: [] }).map(p => p.key), ['arr:0'],
        'an EMPTY drum tab is not a part');
});

t('the dedupe key is part-scoped: same millisecond, two parts, both fire', () => {
    assert.notStrictEqual(_bandFiredKeyPure('arr:0', 1.234), _bandFiredKeyPure('arr:1', 1.234));
    assert.strictEqual(_bandFiredKeyPure('arr:0', 1.2341), _bandFiredKeyPure('arr:0', 1.2344),
    'same 1 ms bucket within a part dedupes');
});

t('per-key strip state applies the DAW rule ACROSS parts', () => {
    Object.assign(S, { partMix: { 'arr:0': { vol: 80, mute: false, solo: true } } });
    const soloed = _mixerPartStripState('arr:0');
    assert.strictEqual(soloed.audible, true);
    assert.ok(Math.abs(soloed.vol - 0.8) < 1e-9);
    const other = _mixerPartStripState('arr:1');
    assert.strictEqual(other.audible, false, "someone else's solo silences this part");
    S.partMix = { 'arr:0': { vol: 100, mute: true, solo: true } };
    assert.strictEqual(_mixerPartStripState('arr:0').audible, false, 'mute beats own solo');
    S.partMix = {};
    assert.deepStrictEqual(_mixerPartStripState('drums'), { audible: true, vol: 1 }, 'untouched = unity');
});

t('the pref round-trips and the toggle notifies the panel', () => {
    let pinged = 0;
    setHostHooks({ stripUiChanged: () => { pinged++; } });
    assert.strictEqual(editorPlayAllTracksEnabled(), false, 'default off');
    editorTogglePlayAllTracks();
    assert.strictEqual(editorPlayAllTracksEnabled(), true);
    assert.strictEqual(stored.editorPlayAllTracks, '1', 'persisted');
    assert.strictEqual(pinged, 1, 'panel repaints its header toggle');
    editorTogglePlayAllTracks();
    assert.strictEqual(editorPlayAllTracksEnabled(), false);
    assert.strictEqual(stored.editorPlayAllTracks, '0');
    assert.ok(host, 'host imports clean');
});

t('band mode bounds the song by EVERY part; off = the active part only', () => {
    const sliceTimes = slice('_guideSourceTimes');
    // _guideSourceTimes closes over module state — exercise via the sliced
    // body with injected stand-ins.
    const env = {
        S: {
            drumEditMode: false,
            arrangements: [
                { notes: [{ time: 1 }, { time: 2 }] },
                { notes: [{ time: 9 }] },          // the bass outro
            ],
            currentArr: 0,
        },
        notes: () => env.S.arrangements[0].notes,
        _guideSanitizeTimesPure: (ts) => ts.filter(Number.isFinite).sort((a, b) => a - b),
        editorPlayAllTracksEnabled: () => env.on,
        on: false,
    };
    const fn = new Function('S', 'notes', '_guideSanitizeTimesPure', 'editorPlayAllTracksEnabled',
        `return (${src.slice(src.indexOf('function _guideSourceTimes'), src.indexOf('\n}', src.indexOf('function _guideSourceTimes')) + 2).replace('function _guideSourceTimes', 'function')})()`);
    const off = fn(env.S, env.notes, env._guideSanitizeTimesPure, () => false);
    assert.deepStrictEqual(off, [1, 2], 'off: active part only');
    const on = fn(env.S, env.notes, env._guideSanitizeTimesPure, () => true);
    assert.deepStrictEqual(on, [1, 2, 9], 'on: the bass outro bounds the song');
    assert.ok(sliceTimes, 'slice sanity');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
