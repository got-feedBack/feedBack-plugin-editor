/*
 * Stem playback engine (src/audio.js): the mixer routing that makes stems
 * audible with mute/solo/fader, and the sample-alignment placement math.
 *
 * The Web Audio graph itself isn't unit-testable in node; these pin the
 * PURE decisions the engine is built on — the audio-band mixer parts, the
 * whole-map solo rule over 'audio:<id>' keys, and the per-source buffer
 * placement (shared with the master, so stems stay aligned).
 *
 * Run: node tests/stem_engine.test.mjs
 */
import assert from 'node:assert';

const { _mixerPartsPure, _mixerPartStripState, _mixerPartAudiblePure } = await import('../src/mixer-panel.js');
const {
    _audioBufferStartPure, _stemCatchupPure, _stemCatchupAllowedPure, _pruneStaleStems,
    _scheduledSourceIdsPure, syncStemAudio, audioStemWaveform, activateTrackAudioSource,
    resetStemAudioCache, _liveAudioSourcesPure, _staleAudioSourceIdsPure,
} = await import('../src/audio.js');
const { S } = await import('../src/state.js');

let pass = 0, fail = 0;
const tests = [];
const t = (name, fn) => tests.push([name, fn]);

t('the mixer lists stem strips (audio band first), honoring removals', () => {
    const parts = _mixerPartsPure(
        [{ name: 'Lead' }, { name: 'Drums', type: 'drums' }], { hits: [{}] },
        [{ id: 'Guitar_L', name: 'Gtr L' }, { id: 'Bass_DI', name: 'Bass' }, { id: 'gone' }],
        ['gone']);
    assert.deepStrictEqual(parts.map(p => p.key),
        ['audio:Guitar_L', 'audio:Bass_DI', 'arr:0', 'arr:1'],
        'stems first (removed dropped), then parts — the drums arrangement is an ordinary arr:<idx> strip now');
    assert.strictEqual(parts[3].name, 'Drums', 'the drums strip follows its arrangement name');
    assert.strictEqual(parts[0].name, 'Gtr L');
    assert.strictEqual(parts[0].kind, 'audio');
});

t('the master mix leads the audio band as its own strip when a recording exists', () => {
    const parts = _mixerPartsPure([{ name: 'Lead' }], null,
        [{ id: 'gtr', name: 'Gtr' }], [], { name: 'Song Master' });
    assert.deepStrictEqual(parts.map(p => p.key), ['audio:master', 'audio:gtr', 'arr:0'],
        'master strip first, then stems, then parts');
    assert.strictEqual(parts[0].name, 'Song Master');
    assert.strictEqual(parts[0].kind, 'audio');
    // Compose mode (no recording) passes no master descriptor — no phantom strip.
    const none = _mixerPartsPure([{ name: 'Lead' }], null, [{ id: 'gtr' }], []);
    assert.ok(!none.some(p => p.key === 'audio:master'), 'no master strip without a recording');
    // A removed master is honored (tombstoned like any source).
    const removed = _mixerPartsPure([], null, [], ['master'], { name: 'X' });
    assert.ok(!removed.some(p => p.key === 'audio:master'), 'a removed master shows no strip');
});

t('a stem strip reads state from S.partMix under its audio: key', () => {
    S.partMix = { 'audio:Guitar_L': { vol: 80, mute: false, solo: false } };
    const st = _mixerPartStripState('audio:Guitar_L');
    assert.deepStrictEqual(st, { audible: true, vol: 0.8 }, 'vol 0..1 for the gain node');
});

t('the whole-map solo rule spans stems AND synth parts', () => {
    // A soloed stem silences an unsoloed synth part, and vice-versa — one
    // audio band, one rule.
    const mix = { 'audio:Guitar_L': { solo: true }, 'arr:0': {}, 'audio:Bass_DI': {} };
    assert.strictEqual(_mixerPartAudiblePure(mix, 'audio:Guitar_L'), true, 'the soloed stem sounds');
    assert.strictEqual(_mixerPartAudiblePure(mix, 'arr:0'), false, 'an unsoloed synth part is silenced by a stem solo');
    assert.strictEqual(_mixerPartAudiblePure(mix, 'audio:Bass_DI'), false, 'and so is an unsoloed stem');
    assert.strictEqual(_mixerPartAudiblePure(mix, 'audio:master'), false,
        'the master (full-mix recording) is a peer: a stem solo isolates against it too');
    // Mute always wins, even over its own solo.
    assert.strictEqual(_mixerPartAudiblePure({ 'audio:x': { solo: true, mute: true } }, 'audio:x'), false);
});

t('a stem solo gates the master through the LIVE strip hook the engine ramps from', () => {
    // _mixerPartStripState is what main.js wires into host.partStripState —
    // the exact value applyStemMix / _ensureStemGain seed and ramp the per-
    // source gain nodes to. Drive it through the real S, both directions.
    const savedMix = S.partMix;
    try {
        S.partMix = { 'audio:Guitar_L': { solo: true } };
        assert.deepStrictEqual(_mixerPartStripState('audio:master'), { audible: false, vol: 1 },
            'while a stem is soloed the master gain ramps to 0 (pre-fix: stayed at unity)');
        assert.deepStrictEqual(_mixerPartStripState('audio:Guitar_L'), { audible: true, vol: 1 });
        S.partMix = { 'arr:0': { solo: true } };
        assert.deepStrictEqual(_mixerPartStripState('audio:master'), { audible: false, vol: 1 },
            'a transcription-part solo gates the master too — one solo rule across bands');
        S.partMix = { 'audio:master': { solo: true }, 'audio:Guitar_L': {} };
        assert.deepStrictEqual(_mixerPartStripState('audio:master'), { audible: true, vol: 1 },
            'the master\'s own solo keeps it audible');
        assert.deepStrictEqual(_mixerPartStripState('audio:Guitar_L'), { audible: false, vol: 1 },
            'and isolates the recording against the stems');
    } finally { S.partMix = savedMix; }
});

t('each stem places its buffer from its OWN shift+offset — the alignment contract', () => {
    // Two stems at the same cursor: one un-offset, one nudged +0.5s. Both
    // compute against the SAME cursor with the SAME formula the master uses,
    // so they start sample-aligned relative to their own placement.
    const cursor = 10, shift = 0.2, dur = 60;
    const a = _audioBufferStartPure(cursor, shift + 0, dur);       // stem A, offset 0
    const b = _audioBufferStartPure(cursor, shift + 0.5, dur);     // stem B, offset +0.5
    assert.deepStrictEqual(a, { play: true, offset: 9.8, delay: 0 }, 'cursor - (shift+offset)');
    assert.deepStrictEqual(b, { play: true, offset: 9.3, delay: 0 }, 'its own offset shifts the read point');
    // A stem whose (shifted) audio has already ended does not play — the
    // scheduler skips it, the transport still runs.
    assert.strictEqual(_audioBufferStartPure(70, 0, 60).play, false);
    // Negative net placement delays the start instead of clipping.
    assert.deepStrictEqual(_audioBufferStartPure(0, 0.3, 60), { play: true, offset: 0, delay: 0.3 });
});

t('a stem decoded during playback catches up to the transport without skipping count-in', () => {
    assert.deepStrictEqual(_stemCatchupPure(8, 12, 10.5, 1),
        { preRoll: 1.5, cursorTime: 8 }, 'before the anchor it waits with the master at the start cursor');
    assert.deepStrictEqual(_stemCatchupPure(8, 12, 14.5, 1),
        { preRoll: 0, cursorTime: 10.5 }, 'after the anchor it seeks to the live transport time');
    assert.deepStrictEqual(_stemCatchupPure(8, 12, 14, 0.5),
        { preRoll: 0, cursorTime: 9 }, 'audition rate is part of the authoritative chart clock');
});

t('late stems stay suppressed on the pitch-preserving slow path', () => {
    assert.strictEqual(_stemCatchupAllowedPure(true, false), true);
    assert.strictEqual(_stemCatchupAllowedPure(true, true), false,
        'a normal-speed BufferSource must not join slowed reference audio');
    assert.strictEqual(_stemCatchupAllowedPure(false, false), false);
});

t('a removed stem\'s phantom solo no longer silences the live band', () => {
    // Bass was soloed, then removed from the roster. Its 'audio:Bass_DI' solo
    // entry lingers in S.partMix, and the whole-map solo rule counts it — so
    // every LIVE track (the surviving stem and the synth part) goes silent
    // even though the soloed source is gone. Pre-prune, that's the bug.
    S.partMix = { 'audio:Bass_DI': { solo: true }, 'audio:Guitar_L': {}, 'arr:0': {} };
    assert.strictEqual(_mixerPartAudiblePure(S.partMix, 'audio:Guitar_L'), false,
        'the stale solo silences the live stem (the bug)');
    assert.strictEqual(_mixerPartAudiblePure(S.partMix, 'arr:0'), false,
        'and the live synth part too');
    // Roster shrinks to just Guitar_L (Bass removed). Prune retires the ghost.
    _pruneStaleStems(new Set(['Guitar_L']));
    assert.strictEqual(S.partMix['audio:Bass_DI'], undefined, 'the removed stem\'s mix entry is gone');
    assert.deepStrictEqual(S.partMix['audio:Guitar_L'], {}, 'the live stem\'s entry is untouched');
    assert.strictEqual(_mixerPartAudiblePure(S.partMix, 'audio:Guitar_L'), true, 'the live band sounds again');
    assert.strictEqual(_mixerPartAudiblePure(S.partMix, 'arr:0'), true);
});

t('pruning a soloed removed stem signals a live-gain re-apply', () => {
    // Deleting the removed stem's 'audio:' key fixes the whole-map solo RULE,
    // but the surviving gain nodes (live stem AND synth part) still sit at the
    // solo'd-away zero the removed solo forced. A delayed fetch/catch-up never
    // re-ramps the PART gains, so prune must signal the mix be re-applied — it
    // returns true when it removes a soloed entry. (Pre-fix it returned
    // undefined and the live band stayed silent.)
    S.partMix = { 'audio:Bass_DI': { solo: true }, 'audio:Guitar_L': {}, 'arr:0': {} };
    assert.strictEqual(_pruneStaleStems(new Set(['Guitar_L'])), true,
        'removing the soloed stem signals a re-ramp');
    // Removing an unsoloed stem changes no live gains — no re-apply needed.
    S.partMix = { 'audio:Bass_DI': {}, 'audio:Guitar_L': {} };
    assert.strictEqual(_pruneStaleStems(new Set(['Guitar_L'])), false,
        'removing an unsoloed stem needs no re-ramp');
});

t('the scheduler plays every live source EXCEPT the active one', () => {
    const sources = [{ id: 'master' }, { id: 'Guitar_L' }, { id: 'Bass_DI' }];
    // Master active (default): the scheduler plays only the stems.
    assert.deepStrictEqual(_scheduledSourceIdsPure(sources, 'master'), ['Guitar_L', 'Bass_DI']);
    // Focus a stem: it moves to the reference path, the master joins the
    // scheduler — everything still plays, only the active one is excluded here.
    assert.deepStrictEqual(_scheduledSourceIdsPure(sources, 'Guitar_L'), ['master', 'Bass_DI']);
    assert.deepStrictEqual(_scheduledSourceIdsPure([], 'master'), []);
    assert.deepStrictEqual(_scheduledSourceIdsPure(sources, 'nope'), ['master', 'Guitar_L', 'Bass_DI'],
        'an unknown active id excludes nothing');
});

t('the live roster honors master and stem tombstones', () => {
    const stems = [{ id: 'gtr', url: '/gtr.ogg' }, { id: 'bass', url: '/bass.ogg' }];
    assert.deepStrictEqual(_liveAudioSourcesPure('/master.ogg', stems, ['master', 'bass'])
        .map(source => source.id), ['gtr']);
    assert.deepStrictEqual(_staleAudioSourceIdsPure(['master', 'gtr', 'bass'], new Set(['gtr'])),
        ['master', 'bass'], 'removed source caches/gains are identified for teardown');
});

t('removing the active source repairs the reference to a live fallback', async () => {
    const saved = {
        audioCtx: S.audioCtx, stems: S.stems, playing: S.playing, audioBuffer: S.audioBuffer,
        audioUrl: S.audioUrl, masterAudioUrl: S.masterAudioUrl, trackSession: S.trackSession,
        activeAudioSourceId: S.activeAudioSourceId, activeAudioSourceOffset: S.activeAudioSourceOffset,
        duration: S.duration, masterAudioDuration: S.masterAudioDuration,
    };
    const savedFetch = globalThis.fetch;
    const samples = new Float32Array(128);
    const oldStem = { sampleRate: 44100, duration: 1, getChannelData: () => samples };
    const master = { sampleRate: 44100, duration: 1, getChannelData: () => samples };
    try {
        resetStemAudioCache();
        Object.assign(S, { playing: false, audioBuffer: oldStem, audioUrl: '/stem.ogg',
            masterAudioUrl: '/master.ogg', activeAudioSourceId: 'stem', activeAudioSourceOffset: 0,
            stems: [{ id: 'stem', url: '/stem.ogg' }],
            trackSession: { removedSourceIds: ['stem'] },
            audioCtx: { decodeAudioData: async () => master, currentTime: 0 } });
        globalThis.fetch = async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) });
        await syncStemAudio();
        assert.strictEqual(S.activeAudioSourceId, 'master');
        assert.strictEqual(S.audioBuffer, master, 'the removed source buffer no longer owns playback/waveform');
    } finally {
        resetStemAudioCache();
        Object.assign(S, saved);
        if (savedFetch === undefined) delete globalThis.fetch; else globalThis.fetch = savedFetch;
    }
});

t('a failed fallback decode clears the removed source instead of leaving it active', async () => {
    const saved = {
        audioCtx: S.audioCtx, stems: S.stems, playing: S.playing, audioBuffer: S.audioBuffer,
        audioUrl: S.audioUrl, masterAudioUrl: S.masterAudioUrl, trackSession: S.trackSession,
        activeAudioSourceId: S.activeAudioSourceId, activeAudioSourceOffset: S.activeAudioSourceOffset,
        waveformPeaks: S.waveformPeaks,
    };
    const savedFetch = globalThis.fetch;
    const samples = new Float32Array(128);
    const oldStem = { sampleRate: 44100, duration: 1, getChannelData: () => samples };
    try {
        resetStemAudioCache();
        Object.assign(S, { playing: false, audioBuffer: oldStem, audioUrl: '/stem.ogg',
            masterAudioUrl: '/master.ogg', activeAudioSourceId: 'stem', activeAudioSourceOffset: 0,
            stems: [{ id: 'stem', url: '/stem.ogg' }],
            trackSession: { removedSourceIds: ['stem'] },
            audioCtx: { decodeAudioData: async () => oldStem, currentTime: 0 } });
        // Every source fails to load: the master fallback cannot decode either.
        globalThis.fetch = async () => ({ ok: false });
        await syncStemAudio();
        assert.strictEqual(S.audioBuffer, null, 'the removed source buffer no longer owns playback/waveform');
        assert.strictEqual(S.audioUrl, null, 'and its url is cleared');
        assert.strictEqual(S.activeAudioSourceId, 'master', 'the active id resets to the no-source master anchor');
    } finally {
        resetStemAudioCache();
        Object.assign(S, saved);
        if (savedFetch === undefined) delete globalThis.fetch; else globalThis.fetch = savedFetch;
    }
});

t('a decoded stem yields FINITE, non-flat lane peaks (channel data, not the AudioBuffer)', async () => {
    // Regression: audioStemWaveform once passed the AudioBuffer straight to the
    // peak builder, which indexes it like a Float32Array — every sample read
    // `undefined`, collapsing min/max to ±Infinity so the lane drew off-canvas
    // (invisible stems). It must read getChannelData(0) first.
    const sine = new Float32Array(44100);
    for (let i = 0; i < sine.length; i++) sine[i] = Math.sin(i * 0.1) * 0.8;
    const fakeBuf = { sampleRate: 44100, duration: 1, length: sine.length, getChannelData: () => sine };
    const savedCtx = S.audioCtx, savedStems = S.stems, savedPlaying = S.playing, savedFetch = globalThis.fetch, savedBuffer = S.audioBuffer;
    const savedMasterUrl = S.masterAudioUrl, savedAudioUrl = S.audioUrl;
    const savedActiveId = S.activeAudioSourceId, savedActiveOffset = S.activeAudioSourceOffset;
    try {
        S.audioBuffer = null;
        S.playing = false;
        S.masterAudioUrl = '';
        S.stems = [{ id: 'gtr', url: 'blob:gtr' }];
        S.audioCtx = { decodeAudioData: async () => fakeBuf, currentTime: 0 };
        globalThis.fetch = async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) });
        await syncStemAudio();
        const wf = audioStemWaveform('gtr');
        assert.ok(wf && wf.peaks && wf.peaks.bins > 0, 'peaks build for a decoded stem');
        let maxHi = -Infinity;
        for (const v of wf.peaks.max) if (v > maxHi) maxHi = v;
        assert.ok(Number.isFinite(maxHi), 'peak extremes are finite (channel data was read, not the buffer)');
        assert.ok(maxHi > 0.1, 'a loud sine produces a visibly non-flat lane, not a zero/Infinity line');
    } finally {
        resetStemAudioCache();
        S.audioCtx = savedCtx; S.stems = savedStems; S.playing = savedPlaying;
        S.audioBuffer = savedBuffer;
        S.masterAudioUrl = savedMasterUrl; S.audioUrl = savedAudioUrl;
        S.activeAudioSourceId = savedActiveId; S.activeAudioSourceOffset = savedActiveOffset;
        if (savedFetch === undefined) delete globalThis.fetch; else globalThis.fetch = savedFetch;
    }
});

t('a slower source selection cannot overwrite a newer active source', async () => {
    const saved = {
        audioCtx: S.audioCtx, stems: S.stems, playing: S.playing, audioBuffer: S.audioBuffer,
        audioUrl: S.audioUrl, masterAudioUrl: S.masterAudioUrl,
        activeAudioSourceId: S.activeAudioSourceId, activeAudioSourceOffset: S.activeAudioSourceOffset,
    };
    const savedFetch = globalThis.fetch;
    const samples = new Float32Array(128);
    const buffer = (name) => ({ name, sampleRate: 44100, duration: 1,
        getChannelData: () => samples });
    let resolveA; let resolveB;
    try {
        resetStemAudioCache();
        S.playing = false;
        S.audioBuffer = buffer('master');
        S.audioUrl = '/master.ogg';
        S.masterAudioUrl = '/master.ogg';
        S.activeAudioSourceId = 'master';
        S.stems = [{ id: 'a', url: '/a.ogg' }, { id: 'b', url: '/b.ogg', offset: 0.2 }];
        S.audioCtx = { decodeAudioData: async raw => raw, currentTime: 0 };
        globalThis.fetch = (url) => new Promise(resolve => {
            const finish = (decoded) => resolve({ ok: true, arrayBuffer: async () => decoded });
            if (url === '/a.ogg') resolveA = finish;
            else resolveB = finish;
        });
        const first = activateTrackAudioSource('a');
        const second = activateTrackAudioSource('b');
        const b = buffer('b');
        resolveB(b);
        assert.strictEqual(await second, true);
        const a = buffer('a');
        resolveA(a);
        assert.strictEqual(await first, false, 'the superseded request reports that it did not activate');
        assert.strictEqual(S.activeAudioSourceId, 'b');
        assert.strictEqual(S.audioBuffer, b, 'late A decode cannot replace B');
        assert.strictEqual(S.activeAudioSourceOffset, 0.2, 'the active reference carries its own placement');
    } finally {
        resetStemAudioCache();
        Object.assign(S, saved);
        if (savedFetch === undefined) delete globalThis.fetch; else globalThis.fetch = savedFetch;
    }
});

t('reselecting the current source cancels an in-flight switch', async () => {
    const saved = {
        audioCtx: S.audioCtx, stems: S.stems, playing: S.playing, audioBuffer: S.audioBuffer,
        audioUrl: S.audioUrl, masterAudioUrl: S.masterAudioUrl,
        activeAudioSourceId: S.activeAudioSourceId, activeAudioSourceOffset: S.activeAudioSourceOffset,
    };
    const savedFetch = globalThis.fetch;
    const samples = new Float32Array(128);
    const master = { sampleRate: 44100, duration: 1, getChannelData: () => samples };
    let resolveStem;
    try {
        resetStemAudioCache();
        Object.assign(S, { playing: false, audioBuffer: master, audioUrl: '/master.ogg',
            masterAudioUrl: '/master.ogg', activeAudioSourceId: 'master', activeAudioSourceOffset: 0,
            stems: [{ id: 'stem', url: '/stem.ogg' }],
            audioCtx: { decodeAudioData: async raw => raw, currentTime: 0 } });
        globalThis.fetch = () => new Promise(resolve => { resolveStem = resolve; });
        const pending = activateTrackAudioSource('stem');
        assert.strictEqual(await activateTrackAudioSource('master'), true,
            'reselecting the current source is an intentional newest request');
        resolveStem({ ok: true, arrayBuffer: async () => ({ sampleRate: 44100, duration: 1,
            getChannelData: () => samples }) });
        assert.strictEqual(await pending, false);
        assert.strictEqual(S.activeAudioSourceId, 'master');
        assert.strictEqual(S.audioBuffer, master);
    } finally {
        resetStemAudioCache();
        Object.assign(S, saved);
        if (savedFetch === undefined) delete globalThis.fetch; else globalThis.fetch = savedFetch;
    }
});

for (const [name, fn] of tests) {
    try { await fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
