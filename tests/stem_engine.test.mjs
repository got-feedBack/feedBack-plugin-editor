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
const { _audioBufferStartPure, _stemCatchupPure, _stemCatchupAllowedPure, _pruneStaleStems } = await import('../src/audio.js');
const { S } = await import('../src/state.js');

let pass = 0, fail = 0;
const tests = [];
const t = (name, fn) => tests.push([name, fn]);

t('the mixer lists stem strips (audio band first), honoring removals', () => {
    const parts = _mixerPartsPure(
        [{ name: 'Lead' }], { hits: [{}] },
        [{ id: 'Guitar_L', name: 'Gtr L' }, { id: 'Bass_DI', name: 'Bass' }, { id: 'gone' }],
        ['gone']);
    assert.deepStrictEqual(parts.map(p => p.key),
        ['audio:Guitar_L', 'audio:Bass_DI', 'arr:0', 'drums'],
        'stems first (removed dropped), then parts, then drums');
    assert.strictEqual(parts[0].name, 'Gtr L');
    assert.strictEqual(parts[0].kind, 'audio');
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
    // Mute always wins, even over its own solo.
    assert.strictEqual(_mixerPartAudiblePure({ 'audio:x': { solo: true, mute: true } }, 'audio:x'), false);
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

for (const [name, fn] of tests) {
    try { await fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
