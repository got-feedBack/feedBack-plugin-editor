'use strict';
/*
 * Tests for the audio mixer (@pure:audio-mixer math + the @pure:audio-bus
 * runtime): the 3-fader popover (recording / guide / click), first-play
 * fade, and the edit-preview blip.
 *
 * The stateful assertions drive the REAL _ensureMasterBus / _ensureRefGain /
 * _mixSetBusGain / _editBlipAt against a stub AudioContext + localStorage —
 * these would FAIL on main, where the bus gains are hardcoded (0.35 / 0.25),
 * no reference gain node exists, and there is no blip.
 *
 * Run: node tests/audio_mixer.test.js
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'audio.js'), 'utf8');

function extract(name) {
    const re = new RegExp(
        '/\\* @pure:' + name + ':start \\*/[\\s\\S]*?/\\* @pure:' + name + ':end \\*/');
    const m = src.match(re);
    if (!m) {
        console.error(`FAIL: @pure:${name} block not found in src/main.js`);
        process.exit(1);
    }
    return m[0].replace(/^export\s+/gm, '');
}

const mixBlock = extract('audio-mixer');
const busBlock = extract('audio-bus');

// ── Pure math ────────────────────────────────────────────────────────
const P = new Function(
    '"use strict";' + mixBlock
    + '\nreturn { MIX_DEFAULT_PCT, _mixPctFromStoredPure, _mixGainForPctPure,'
    + ' _mixFirstPlayStartGainPure, _mixDragChangedPitchPure, _mixMeterLevelPure };'
)();

// ── Stateful env: real bus + blip code over stub ctx/localStorage ────
function stubParam() {
    return {
        value: 0, calls: [],
        setValueAtTime(v, t) { this.calls.push(['set', v, t]); this.value = v; },
        exponentialRampToValueAtTime(v, t) { this.calls.push(['exp', v, t]); },
        linearRampToValueAtTime(v, t) { this.calls.push(['lin', v, t]); },
        setTargetAtTime(v, t, c) { this.calls.push(['target', v, t, c]); },
    };
}
function stubCtx(state = 'running') {
    const made = [];
    return {
        state, currentTime: 10, destination: { kind: 'dest' }, made,
        createGain() {
            const n = { kind: 'gain', gain: stubParam(), to: null, connect(t) { this.to = t; } };
            made.push(n); return n;
        },
        createDynamicsCompressor() {
            const n = {
                kind: 'comp', to: null,
                threshold: stubParam(), knee: stubParam(), ratio: stubParam(),
                attack: stubParam(), release: stubParam(),
                connect(t) { this.to = t; },
            };
            made.push(n); return n;
        },
        createOscillator() {
            const n = {
                kind: 'osc', type: '', frequency: stubParam(), to: null,
                started: false, connect(t) { this.to = t; },
                start() { this.started = true; }, stop() {},
            };
            made.push(n); return n;
        },
    };
}
function stubStorage(seed = {}) {
    const map = new Map(Object.entries(seed));
    return {
        getItem: (k) => (map.has(k) ? map.get(k) : null),
        setItem: (k, v) => { map.set(k, String(v)); },
        map,
    };
}
function makeEnv({ ctxState = 'running', storage = {} } = {}) {
    const ls = stubStorage(storage);
    const S = { audioCtx: stubCtx(ctxState), activeAudioSourceId: 'master' };
    const voices = [];
    const host = { partStripState: () => ({ audible: true, vol: 1 }) };
    const env = new Function(
        'S', 'localStorage', '_guideVoices', 'host',
        '"use strict";' + mixBlock + '\n' + busBlock
        + '\nreturn { _ensureMasterBus, _ensureRefGain, _mixLoadPct, _mixSetBusGain,'
        + ' _mixApplyFirstPlayFade, _mixResetFirstPlay, _editBlipAt, editorEditBlipEnabled,'
        + ' voices: () => _guideVoices };'
    )(S, ls, voices, host);
    return { ...env, S, ls, initialVoices: voices };
}

let pass = 0, fail = 0;
function t(name, fn) {
    try { fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}

// ── Pure math tests ──────────────────────────────────────────────────

t('stored percents parse with clamping; junk falls back', () => {
    assert.strictEqual(P._mixPctFromStoredPure('42', 100), 42);
    assert.strictEqual(P._mixPctFromStoredPure('-5', 100), 0);
    assert.strictEqual(P._mixPctFromStoredPure('250', 100), 100);
    assert.strictEqual(P._mixPctFromStoredPure(null, 35), 35);
    assert.strictEqual(P._mixPctFromStoredPure('abc', 25), 25);
});

t('percent → gain is linear, clamped, NaN-safe', () => {
    assert.strictEqual(P._mixGainForPctPure(0), 0);
    assert.strictEqual(P._mixGainForPctPure(35), 0.35);
    assert.strictEqual(P._mixGainForPctPure(100), 1);
    assert.strictEqual(P._mixGainForPctPure(150), 1);
    assert.strictEqual(P._mixGainForPctPure(NaN), 0);
});

t('meter converts sample RMS into a clamped -60..0 dBFS display level', () => {
    assert.strictEqual(P._mixMeterLevelPure(new Float32Array(8)), 0);
    assert.ok(Math.abs(P._mixMeterLevelPure(new Float32Array([0.1, -0.1])) - (40 / 60)) < 1e-6);
    assert.strictEqual(P._mixMeterLevelPure(new Float32Array([1, -1])), 1);
    assert.strictEqual(P._mixMeterLevelPure(null), 0);
});

t('first-play start gain: reduced but never inaudible, never above target', () => {
    assert.ok(Math.abs(P._mixFirstPlayStartGainPure(1) - 0.3) < 1e-9);
    assert.strictEqual(P._mixFirstPlayStartGainPure(0.1), 0.05, 'floor at 0.05');
    assert.strictEqual(P._mixFirstPlayStartGainPure(0.04), 0.04, 'min(target, floor)');
    assert.strictEqual(P._mixFirstPlayStartGainPure(0), 0);
});

t('drag pitch detection: string/keys-fret deltas count, time-only does not', () => {
    assert.strictEqual(P._mixDragChangedPitchPure([0, 0], null), false);
    assert.strictEqual(P._mixDragChangedPitchPure([0, 1], null), true);
    assert.strictEqual(P._mixDragChangedPitchPure([0, 0], [0, 2]), true);
    assert.strictEqual(P._mixDragChangedPitchPure([], []), false);
});

// ── Stateful: bus gains come from prefs (FAILS on main: hardcoded) ───

t('master bus seeds guide/click gains from stored prefs', () => {
    const env = makeEnv({ storage: { editorMixGuide: '10', editorMixClick: '50' } });
    const bus = env._ensureMasterBus();
    assert.ok(Math.abs(bus.guideGain.gain.value - 0.10) < 1e-9);
    assert.ok(Math.abs(bus.clickGain.gain.value - 0.50) < 1e-9);
});

t('master bus defaults preserve the shipped balance (0.35 / 0.25)', () => {
    const env = makeEnv();
    const bus = env._ensureMasterBus();
    assert.ok(Math.abs(bus.guideGain.gain.value - 0.35) < 1e-9);
    assert.ok(Math.abs(bus.clickGain.gain.value - 0.25) < 1e-9);
});

t('reference gain node: unity by default, straight to destination, not the limiter', () => {
    const env = makeEnv();
    const rg = env._ensureRefGain();
    assert.strictEqual(rg.gain.value, 1);
    const bus = env._ensureMasterBus();
    assert.strictEqual(rg.to, bus.masterGain, 'reference joins the final master gain without passing through the limiter');
    assert.strictEqual(bus.masterGain.to, env.S.audioCtx.destination);
});

t('fader move persists the pref and ramps the live node (never a step)', () => {
    const env = makeEnv();
    env._ensureMasterBus();
    const p = env._mixSetBusGain('guide', '80');
    assert.strictEqual(p, 80);
    assert.strictEqual(env.ls.map.get('editorMixGuide'), '80');
    const calls = env._ensureMasterBus().guideGain.gain.calls;
    const last = calls[calls.length - 1];
    assert.strictEqual(last[0], 'target', 'uses setTargetAtTime');
    assert.ok(Math.abs(last[1] - 0.8) < 1e-9);
    assert.ok(last[3] > 0, 'nonzero smoothing time constant');
});

t('master fader persists and ramps the final output gain', () => {
    const env = makeEnv({ storage: { editorMixMaster: '90' } });
    const bus = env._ensureMasterBus();
    assert.strictEqual(bus.masterGain.gain.value, 0.9);
    assert.strictEqual(env._mixSetBusGain('master', '55'), 55);
    assert.strictEqual(env.ls.map.get('editorMixMaster'), '55');
    assert.strictEqual(bus.masterGain.gain.calls.at(-1)[0], 'target');
});
t('fader input clamps out-of-range values before persisting', () => {
    const env = makeEnv();
    env._ensureRefGain();
    assert.strictEqual(env._mixSetBusGain('ref', '9999'), 100);
    assert.strictEqual(env.ls.map.get('editorMixRef'), '100');
});

t('first-play fade ramps the reference up once, then never again', () => {
    const env = makeEnv();
    const rg = env._ensureRefGain();
    env._mixApplyFirstPlayFade();
    const kinds = rg.gain.calls.map(c => c[0]);
    assert.deepStrictEqual(kinds, ['set', 'lin'], 'setValueAtTime then linearRamp');
    assert.ok(Math.abs(rg.gain.calls[0][1] - 0.3) < 1e-9, 'starts at 30% of unity target');
    assert.strictEqual(rg.gain.calls[1][1], 1, 'ramps to the fader target');
    env._mixApplyFirstPlayFade();
    assert.strictEqual(rg.gain.calls.length, 2, 'second play does not re-fade');
});

t('first-play fade re-arms after a new recording loads (_mixResetFirstPlay)', () => {
    const env = makeEnv();
    const rg = env._ensureRefGain();
    env._mixApplyFirstPlayFade();
    assert.strictEqual(rg.gain.calls.length, 2, 'first recording fades once');
    // loadAudio() calls this on every decoded recording, guitar/keys or
    // replaced — the ramp is a hearing-safety guard, not a one-shot.
    env._mixResetFirstPlay();
    env._mixApplyFirstPlayFade();
    const kinds = rg.gain.calls.slice(2).map(c => c[0]);
    assert.deepStrictEqual(kinds, ['set', 'lin'], 'fades again for the new recording');
});

// ── Stateful: silent edits ──────────────────────────────────────────
t('edit compatibility hook is inert and never creates audio nodes', () => {
    const env = makeEnv();
    assert.strictEqual(env.editorEditBlipEnabled(), false);
    assert.strictEqual(env._editBlipAt(), false);
    assert.strictEqual(env.S.audioCtx.made.length, 0);
});
console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
