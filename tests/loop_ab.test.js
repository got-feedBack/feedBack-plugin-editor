'use strict';
/*
 * Tests for loop A/B compare (@pure:loop-ab block): while looping, each
 * pass alternates between the RECORDING (reference audible, claps off)
 * and the GUIDE (reference muted through the mixer's transparent ref
 * gain, claps on) — the ear-training loop from the DAW-workspace design
 * (1.6). These fail on main, where the block doesn't exist.
 *
 * Run: node tests/loop_ab.test.js
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'audio.js'), 'utf8');
// _setLoopRegionEnabled moved to src/loop.js (the loop-region UI); slice it from
// there when a case needs the real disarm path.
const loopSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'loop.js'), 'utf8');
const _m0 = src.match(/\/\* @pure:loop-ab:start \*\/[\s\S]*?\/\* @pure:loop-ab:end \*\//);
if (!_m0) {
    console.error('FAIL: @pure:loop-ab block not found in src/audio.js');
    process.exit(1);
}
const m = [_m0[0].replace(/^export\s+/gm, '')];
const { _abClapsEnabledPure, _abNextPhasePure, _abRefTargetPure } = new Function(
    '"use strict";' + m[0]
    + '\nreturn { _abClapsEnabledPure, _abNextPhasePure, _abRefTargetPure };'
)();

let pass = 0, fail = 0;
function t(name, fn) {
    try { fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}

t('A/B inactive: the claps pref rules, untouched', () => {
    assert.strictEqual(_abClapsEnabledPure(false, 'recording', true), true);
    assert.strictEqual(_abClapsEnabledPure(false, 'guide', false), false);
});

t('A/B active: guide passes clap even with the pref OFF; recording passes stay clean even with it ON', () => {
    assert.strictEqual(_abClapsEnabledPure(true, 'guide', false), true);
    assert.strictEqual(_abClapsEnabledPure(true, 'recording', true), false);
});

t('phase flip is a strict two-cycle', () => {
    assert.strictEqual(_abNextPhasePure('recording'), 'guide');
    assert.strictEqual(_abNextPhasePure('guide'), 'recording');
});

t('reference mutes ONLY during an active, playing guide pass', () => {
    assert.strictEqual(_abRefTargetPure(true, true, 'guide', 0.8), 0);
    assert.strictEqual(_abRefTargetPure(true, true, 'recording', 0.8), 0.8);
    assert.strictEqual(_abRefTargetPure(true, false, 'guide', 0.8), 0.8,
        'stopping mid-guide-pass restores the fader level');
    assert.strictEqual(_abRefTargetPure(false, true, 'guide', 0.8), 0.8,
        'A/B off (or loop disarmed) never mutes');
});

t('a full loop session alternates recording → guide → recording …', () => {
    // Compose the pures the way the wrap handler does: start on recording,
    // flip per wrap, derive the audible surfaces per pass.
    let phase = 'recording';
    const passes = [];
    for (let wrap = 0; wrap < 4; wrap++) {
        passes.push({
            phase,
            claps: _abClapsEnabledPure(true, phase, false),
            refGain: _abRefTargetPure(true, true, phase, 1),
        });
        phase = _abNextPhasePure(phase);
    }
    assert.deepStrictEqual(passes, [
        { phase: 'recording', claps: false, refGain: 1 },
        { phase: 'guide', claps: true, refGain: 0 },
        { phase: 'recording', claps: false, refGain: 1 },
        { phase: 'guide', claps: true, refGain: 0 },
    ], 'each pass is exactly one of the two surfaces, never both, never neither');
});

// ── Stateful wiring: drive the REAL runtime over stub ctx/DOM ─────────
// The pure math above is correct on its own; the historical bugs live in
// the STATEFUL glue that decides WHEN to (re)apply the ref gain. These
// extract the audio-mixer/audio-bus/loop-ab blocks plus the loose A/B
// runtime and drive them against stubs. They FAIL on the pre-review head:
//  1. the recording fader ramped straight to its level during a guide
//     pass, un-muting the reference the A/B mode had silenced;
//  2. mid-play A/B arming set S.loopEnabled directly instead of arming the
//     loop (which seeks the cursor into the region).

function extractBlock(name) {
    const re = new RegExp(
        '/\\* @pure:' + name + ':start \\*/[\\s\\S]*?/\\* @pure:' + name + ':end \\*/');
    const mm = src.match(re);
    if (!mm) { console.error('FAIL: @pure:' + name + ' block not found'); process.exit(1); }
    return mm[0].replace(/^export\s+/gm, '');
}
// The loose A/B runtime (state + _abActive/_abApplyRefGain/_abOnLoopWrap/
// _refreshLoopABBtn/_editorToggleLoopAB) is not a @pure block — slice it by
// its stable endpoints.
const abRuntime = (() => {
    const mm = src.match(
        /(?:export )?let _abOn = false;[\s\S]*?\n\/\/ window\.editorToggleLoopAB re-attached in main\.js/);
    if (!mm) { console.error('FAIL: A/B runtime slice not found'); process.exit(1); }
    return mm[0].replace(/^export\s+/gm, '');
})();

function stubParam() {
    return {
        value: 0, calls: [],
        setValueAtTime(v, t) { this.calls.push(['set', v, t]); this.value = v; },
        exponentialRampToValueAtTime(v, t) { this.calls.push(['exp', v, t]); },
        linearRampToValueAtTime(v, t) { this.calls.push(['lin', v, t]); },
        setTargetAtTime(v, t, c) { this.calls.push(['target', v, t, c]); this.value = v; },
    };
}
function stubCtx() {
    return {
        state: 'running', currentTime: 10, destination: { kind: 'dest' },
        createGain() { return { kind: 'gain', gain: stubParam(), connect() {} }; },
        createDynamicsCompressor() {
            return { threshold: {}, knee: {}, ratio: {}, attack: {}, release: {},
                gain: stubParam(), connect() {} };
        },
    };
}
function stubLocalStorage() {
    const store = {};
    return {
        getItem: (k) => (k in store ? store[k] : null),
        setItem: (k, v) => { store[k] = String(v); },
    };
}

// Build the runtime sandbox. `spies` collects side effects we assert on.
function buildAB(opts) {
    opts = opts || {};
    const S = {
        audioCtx: stubCtx(), playing: !!opts.playing,
        loopEnabled: !!opts.loopEnabled, cursorTime: opts.cursorTime || 0,
        // A/B compares against a reference recording, so it only arms with a
        // buffer present (compose mode has none). Default to buffered here.
        audioBuffer: 'audioBuffer' in opts ? opts.audioBuffer : {},
    };
    const spies = { setLoopRegionEnabled: [] };
    const region = opts.region || { startTime: 5, endTime: 9 };
    const doc = { getElementById: () => null };
    const win = {};
    const mixBlock = extractBlock('audio-mixer');
    const busBlock = extractBlock('audio-bus');
    const abPure = extractBlock('loop-ab');
    // Optionally splice in the REAL _setLoopRegionEnabled: its hoisted
    // function declaration shadows the same-named spy param, so the sandbox
    // drives the true loop-disarm path (for the "restore ref on disable" test).
    let loopArm = '';
    if (opts.withLoopArm) {
        const mm = loopSrc.match(/(?:export )?function _setLoopRegionEnabled\(enabled\) \{[\s\S]*?\n\}/);
        if (!mm) { console.error('FAIL: _setLoopRegionEnabled not found'); process.exit(1); }
        loopArm = '\n' + mm[0].replace(/^export\s+/gm, '');
    }
    // The A/B runtime reaches main.js through `host` now; map its two methods to
    // the same spies the injected params used to be.
    const host = {
        selectedLoopRegion: () => region,
        setLoopRegionEnabled: (enabled) => {
            spies.setLoopRegionEnabled.push(enabled); S.loopEnabled = !!enabled;
        },
        draw: () => {}, drawNow: () => {}, updateTimeDisplay: () => {},
        editorClampScrollX: (x) => x, editorApplyScrollBounds: () => {},
    };
    const env = new Function(
        'S', 'localStorage', 'document', 'window', '_guideVoices', 'host',
        '_selectedLoopRegion', '_setLoopRegionEnabled', '_updateLoopRegionControls',
        '_guideTimerSync', 'setStatus', '_editorSeekToTime', 'draw', '_attachMeterTap',
        '"use strict";' + mixBlock + '\n' + busBlock + '\n' + abPure + '\n' + abRuntime + loopArm
        + '\nreturn { _ensureRefGain, _mixSetBusGain, _mixLoadPct, _abApplyRefGain,'
        + ' _abActive, _editorToggleLoopAB, _setLoopRegionEnabled, refGainNode: () => _refGain,'
        + ' setPhase: (p) => { _abPhase = p; }, setOn: (v) => { _abOn = v; },'
        + ' getOn: () => _abOn, getPhase: () => _abPhase };'
    )(
        S, stubLocalStorage(), doc, win, [], host,
        () => region,
        (enabled) => { spies.setLoopRegionEnabled.push(enabled); S.loopEnabled = !!enabled; },
        () => {},   // _updateLoopRegionControls (pre-fix arming path uses this)
        () => {},   // _guideTimerSync
        () => {},   // setStatus
        () => {},   // _editorSeekToTime
        () => {},   // draw
        () => {},   // _attachMeterTap (meter taps are a no-op in the sliced env)
    );
    return { env, S, spies, region };
}

t('ref fader during an active A/B guide pass stays MUTED (never un-mutes the reference)', () => {
    const { env } = buildAB({ playing: true, loopEnabled: true });
    env.setOn(true);
    env.setPhase('guide');
    env._ensureRefGain();
    const g = env.refGainNode().gain;
    // A recording-fader nudge to 80% must NOT lift the reference off 0.
    env._mixSetBusGain('ref', '80');
    const last = g.calls[g.calls.length - 1];
    assert.ok(last && last[0] === 'target', 'ref bus ramps via setTargetAtTime');
    assert.strictEqual(last[1], 0,
        'guide pass keeps the recording muted even as its fader moves (pre-fix ramped to 0.8)');
});

t('ref fader on a recording pass ramps to the fresh fader level (mute is guide-pass-only)', () => {
    const { env } = buildAB({ playing: true, loopEnabled: true });
    env.setOn(true);
    env.setPhase('recording');
    env._ensureRefGain();
    const g = env.refGainNode().gain;
    env._mixSetBusGain('ref', '80');
    const last = g.calls[g.calls.length - 1];
    assert.strictEqual(last[1], 0.8, 'recording pass follows the fader');
});

t('mid-play A/B arming delegates to the loop arm (seeks into region) — no raw S.loopEnabled write', () => {
    const { env, spies } = buildAB({ playing: true, loopEnabled: false, cursorTime: 0 });
    env._editorToggleLoopAB();
    assert.deepStrictEqual(spies.setLoopRegionEnabled, [true],
        'arming A/B routes through _setLoopRegionEnabled(true) — which owns the cursor '
        + 'seek into the region — instead of a raw S.loopEnabled=true that skips the seek');
});

t('disabling the loop mid-guide-pass RESTORES the recording (never leaves it silently muted)', () => {
    // A/B on, playing, on a guide pass with the reference muted at 0.
    const { env, S } = buildAB({ withLoopArm: true, playing: true, loopEnabled: true });
    env.setOn(true);
    env.setPhase('guide');
    env._ensureRefGain();
    const g = env.refGainNode().gain;
    env._abApplyRefGain();
    assert.strictEqual(g.value, 0, 'guide pass starts muted');
    // User presses Loop to disarm the region (region still selected).
    env._setLoopRegionEnabled(false);
    const last = g.calls[g.calls.length - 1];
    assert.strictEqual(last[1], 1,
        'loop off restores the reference to its fader level (pre-fix left it muted at 0)');
    assert.strictEqual(S.loopEnabled, false);
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
