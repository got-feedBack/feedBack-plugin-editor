/*
 * Tests for the piano-roll keyboard gutter (DAW 4.1):
 * midiToFreq (equal-tempered pitch), _inKeyboardGutterPure (the click hit
 * region), and _auditionPitch (the click-to-hear voice: autoplay guard +
 * one gentle scheduled oscillator at the row's pitch).
 *
 * All fail on main — none of these exist there.
 *
 * Run: node tests/keyboard_gutter.test.mjs
 */
import assert from 'node:assert';
import fs from 'node:fs';
import { _inKeyboardGutterPure, midiToFreq } from '../src/keys.js';

const src = fs.readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');

function extractFn(name) {
    const start = src.indexOf('function ' + name);
    assert.ok(start >= 0, `function ${name} must exist`);
    const open = src.indexOf('{', start);
    let depth = 0;
    for (let i = open; i < src.length; i++) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}' && --depth === 0) return src.slice(start, i + 1);
    }
    throw new Error('unbalanced braces extracting ' + name);
}

let passed = 0, failed = 0;
function t(name, fn) {
    try { fn(); passed++; console.log('  ok ' + name); }
    catch (e) { failed++; console.error('  FAIL ' + name + '\n    ' + (e && e.message)); }
}

const P = { midiToFreq, _inKeyboardGutterPure };

// ── midiToFreq ───────────────────────────────────────────────────────

t('midiToFreq: equal temperament anchored at A4 = 440', () => {
    assert.strictEqual(P.midiToFreq(69), 440);
    assert.strictEqual(P.midiToFreq(81), 880, 'A5 one octave up');
    assert.strictEqual(P.midiToFreq(57), 220, 'A3 one octave down');
    assert.ok(Math.abs(P.midiToFreq(60) - 261.6256) < 0.001, 'middle C ≈ 261.63');
    assert.ok(Math.abs(P.midiToFreq(64) - 329.6276) < 0.001, 'E4 ≈ 329.63');
});

t('midiToFreq: non-finite input → 0 (never schedules a NaN oscillator)', () => {
    assert.strictEqual(P.midiToFreq(NaN), 0);
    assert.strictEqual(P.midiToFreq(undefined), 0);
    assert.strictEqual(P.midiToFreq('x'), 0);
});

// ── _inKeyboardGutterPure ────────────────────────────────────────────

t('_inKeyboardGutterPure: inside the LABEL_W column beside the pitch lanes', () => {
    const W = 52, top = 70, bottom = 400;
    assert.strictEqual(P._inKeyboardGutterPure(10, 100, W, top, bottom), true);
    assert.strictEqual(P._inKeyboardGutterPure(0, top, W, top, bottom), true, 'top-left corner included');
});

t('_inKeyboardGutterPure: half-open on every edge (never overlaps notes/strips)', () => {
    const W = 52, top = 70, bottom = 400;
    assert.strictEqual(P._inKeyboardGutterPure(52, 100, W, top, bottom), false, 'x==labelW is the note area');
    assert.strictEqual(P._inKeyboardGutterPure(-1, 100, W, top, bottom), false);
    assert.strictEqual(P._inKeyboardGutterPure(10, 69, W, top, bottom), false, 'above the lanes (waveform)');
    assert.strictEqual(P._inKeyboardGutterPure(10, 400, W, top, bottom), false, 'at/below the last lane');
});

// ── _auditionPitch: guard + scheduling ───────────────────────────────

function makeAuditionEnv(ctxState) {
    const scheduled = [];
    let ctx = null;
    if (ctxState) {
        ctx = {
            state: ctxState,
            currentTime: 5,
            createOscillator: () => {
                const o = { type: '', frequency: {}, connect() {}, start(w) { o._start = w; }, stop(w) { o._stop = w; } };
                scheduled.push(o);
                return o;
            },
            createGain: () => ({ gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} }),
        };
    }
    const S = { audioCtx: ctx };
    const env = new Function(
        'S', 'midiToFreq', '_ensureMasterBus', '_guideVoices',
        '"use strict";' + extractFn('_auditionPitch')
        + '\nreturn { _auditionPitch, voices: _guideVoices };'
    );
    const guideVoices = [];
    // midiToFreq is small; re-provide it rather than extract twice.
    const midiToFreq = m => (Number.isFinite(Number(m)) ? 440 * Math.pow(2, (Number(m) - 69) / 12) : 0);
    const api = env(S, midiToFreq, () => ({ limiter: { } }), guideVoices);
    return { api, scheduled, guideVoices };
}

t('_auditionPitch: no-op when the audio context is absent or suspended', () => {
    const absent = makeAuditionEnv(null);
    absent.api._auditionPitch(60);
    assert.strictEqual(absent.scheduled.length, 0, 'no ctx → nothing scheduled');
    assert.strictEqual(absent.guideVoices.length, 0);

    const suspended = makeAuditionEnv('suspended');
    suspended.api._auditionPitch(60);
    assert.strictEqual(suspended.scheduled.length, 0, 'suspended ctx → nothing scheduled');
});

t('_auditionPitch: a running ctx schedules exactly one voice at the row pitch', () => {
    const { api, scheduled, guideVoices } = makeAuditionEnv('running');
    api._auditionPitch(69);
    assert.strictEqual(scheduled.length, 1, 'one oscillator');
    assert.strictEqual(scheduled[0].frequency.value, 440, 'A4 → 440 Hz');
    assert.strictEqual(scheduled[0].type, 'triangle');
    assert.ok(scheduled[0]._stop > scheduled[0]._start, 'has a positive duration');
    assert.strictEqual(guideVoices.length, 1, 'tracked for cleanup');
});

t('_auditionPitch: an out-of-audible pitch is refused', () => {
    const { api, scheduled } = makeAuditionEnv('running');
    api._auditionPitch(200);   // ~2.1 MHz — above the 20 kHz guard
    assert.strictEqual(scheduled.length, 0, 'inaudibly-high pitch schedules nothing');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
