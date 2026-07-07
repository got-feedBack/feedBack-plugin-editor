'use strict';
/*
 * Tests for the fretted-lane in-key highlight (@pure:fret-pitch +
 * @pure:scale composed): sounding pitch = openMidi + tuning offset +
 * CAPO + fret, capo added exactly ONCE — the guitar-charrette seat's
 * flagged double-count trap. The convention (chart frets are
 * capo-relative) is core's: lib/song.py pitch_from_base, shared by the
 * tuner and the highway's scale-degree derivation.
 *
 * Also pins the division of labor: _absolutePitch (string-moves) still
 * OMITS capo — it compares two pitches on one arrangement where the capo
 * cancels — so composing the two can never double-count.
 *
 * These fail on main: _soundingPitchPure doesn't exist and _drawNote has
 * no key treatment.
 *
 * Run: node tests/fret_key_highlight.test.js
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const src = fs.readFileSync(path.join(__dirname, '..', 'screen.js'), 'utf8');

function extractBlock(name) {
    const re = new RegExp(
        '/\\* @pure:' + name + ':start \\*/[\\s\\S]*?/\\* @pure:' + name + ':end \\*/');
    const m = src.match(re);
    if (!m) {
        console.error(`FAIL: @pure:${name} block not found in screen.js`);
        process.exit(1);
    }
    return m[0];
}
// ASSUMPTION: the extracted function's body contains no `{`/`}` inside a
// string, regex, or comment — a naive brace count would miscount those.
// Safe here because the only function extracted is `_absolutePitch`, a
// three-line pure arithmetic helper with no such tokens. If that ever
// changes, export the pure helpers from screen.js and import them instead
// of parsing source text.
function extractFn(name) {
    const start = src.indexOf('function ' + name);
    assert.ok(start >= 0, `function ${name} must exist`);
    const open = src.indexOf('{', start);
    let depth = 0;
    for (let i = open; i < src.length; i++) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}' && --depth === 0) return src.slice(start, i + 1);
    }
    throw new Error(`unbalanced braces extracting ${name}`);
}

const env = new Function(
    '"use strict";'
    + extractBlock('fret-pitch') + '\n'
    + extractBlock('scale') + '\n'
    + extractFn('_absolutePitch') + '\n'
    + 'return { _soundingPitchPure, _pcInScalePure, _absolutePitch };'
)();
const { _soundingPitchPure, _pcInScalePure, _absolutePitch } = env;

const GUITAR = [40, 45, 50, 55, 59, 64]; // E A D G B E
const STD = [0, 0, 0, 0, 0, 0];

let pass = 0, fail = 0;
function t(name, fn) {
    try { fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}

// ── The formula, against known pitches ───────────────────────────────

t('no capo: standard-tuning open low E is 40, A-string fret 3 is C (48)', () => {
    assert.strictEqual(_soundingPitchPure(GUITAR, STD, 0, 0, 0), 40);
    assert.strictEqual(_soundingPitchPure(GUITAR, STD, 0, 1, 3), 48);
});

t('capo is added exactly once: capo 2, open low E sounds F# (42)', () => {
    assert.strictEqual(_soundingPitchPure(GUITAR, STD, 2, 0, 0), 42);
    // Fret numbers are capo-relative: capo 2 + "fret 3" on the A string
    // sounds 45 + 2 + 3 = 50 (D), not 45 + 3.
    assert.strictEqual(_soundingPitchPure(GUITAR, STD, 2, 1, 3), 50);
});

t('tuning offset and capo compose: Drop-D string 0 with capo 1 sounds D# (39)', () => {
    const dropD = [-2, 0, 0, 0, 0, 0];
    assert.strictEqual(_soundingPitchPure(GUITAR, dropD, 1, 0, 0), 39);
});

t('junk inputs return null (skip, never paint garbage)', () => {
    assert.strictEqual(_soundingPitchPure(GUITAR, STD, 0, 9, 0), null, 'no such string');
    assert.strictEqual(_soundingPitchPure(null, STD, 0, 0, 0), null);
    assert.strictEqual(_soundingPitchPure(GUITAR, STD, 0, 0, NaN), null);
    assert.strictEqual(_soundingPitchPure(GUITAR, STD, 'x', 0, 5), 45, 'junk capo coerces to 0');
});

// ── The trap, pinned: _absolutePitch still omits capo ────────────────

t('_absolutePitch (string-moves) omits capo; composing the two never double-counts', () => {
    // Same note, capo 2: the move helper sees 40, the sounding helper 42.
    assert.strictEqual(_absolutePitch(GUITAR, STD, 0, 0), 40);
    assert.strictEqual(
        _soundingPitchPure(GUITAR, STD, 2, 0, 0) - _absolutePitch(GUITAR, STD, 0, 0),
        2, 'the difference is exactly one capo, never two');
});

// ── Membership end-to-end (the render path's exact computation) ──────

function outOfKey(openMidi, tuning, capo, s, f, tonic, scale) {
    const midi = _soundingPitchPure(openMidi, tuning, capo, s, f);
    return midi !== null && !_pcInScalePure(((midi % 12) + 12) % 12, tonic, scale);
}

t('E major, no capo: open E in key, F natural (fret 1) out of key', () => {
    assert.strictEqual(outOfKey(GUITAR, STD, 0, 0, 0, 4, 'major'), false);
    assert.strictEqual(outOfKey(GUITAR, STD, 0, 0, 1, 4, 'major'), true);
});

t('capo flips membership: the SAME chart fret changes keys with the capo', () => {
    // G major (tonic 7). A-string fret 1 = A# — out of key uncapoed...
    assert.strictEqual(outOfKey(GUITAR, STD, 0, 1, 1, 7, 'major'), true);
    // ...but with capo 1 the same chart fret sounds B — in key. Ignoring
    // the capo (main's only helper) would keep flagging it.
    assert.strictEqual(outOfKey(GUITAR, STD, 1, 1, 1, 7, 'major'), false);
});

t('unresolvable pitch never flags (stays fully lit)', () => {
    assert.strictEqual(outOfKey(GUITAR, STD, 0, 9, 0, 0, 'major'), false);
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
