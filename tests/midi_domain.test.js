'use strict';
/*
 * Tests for the MIDI-input backend adapter (@pure:midi-adapter block +
 * the unified _recMidiOnData routing): the editor's live-record path now
 * prefers the host `midi-input` capability domain (the org's one
 * device-access boundary) and keeps the private Web-MIDI path only as a
 * fallback for older hosts. Both paths deliver RAW BYTES into one routing
 * function, so capture behavior is identical regardless of backend —
 * pinned here by driving the real router with byte sequences.
 *
 * The backend selection + device-row normalization fail on main (no
 * adapter exists); the routing tests pin behavioral equivalence across
 * the migration.
 *
 * Run: node tests/midi_domain.test.js
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');

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

let pass = 0, fail = 0;
function t(name, fn) {
    try { fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}

// ── Backend selection + device-row normalization ─────────────────────

const A = new Function(
    '"use strict";' + extractBlock('midi-adapter')
    + '\nreturn { _recMidiBackendPure, _recMidiDeviceRowsPure };'
)();

t('backend: the host domain wins whenever present (v1), even with Web-MIDI', () => {
    assert.strictEqual(A._recMidiBackendPure({ version: 1 }, true), 'domain');
    assert.strictEqual(A._recMidiBackendPure({ version: 1 }, false), 'domain');
});

t('backend: older hosts fall back to private Web-MIDI; neither → none', () => {
    assert.strictEqual(A._recMidiBackendPure(null, true), 'private');
    assert.strictEqual(A._recMidiBackendPure(undefined, false), 'none');
    assert.strictEqual(A._recMidiBackendPure({ version: 2 }, true), 'private',
        'an unknown future domain version is not silently assumed compatible');
});

t('device rows normalize both shapes to one {id, label} picker contract', () => {
    assert.deepStrictEqual(
        A._recMidiDeviceRowsPure('domain', [
            { logicalSourceKey: 'web-midi::abc', label: 'Piano-88' },
            { logicalSourceKey: 'web-midi::def', label: '' },
        ]),
        [{ id: 'web-midi::abc', label: 'Piano-88' }, { id: 'web-midi::def', label: 'MIDI input' }]);
    assert.deepStrictEqual(
        A._recMidiDeviceRowsPure('private', [
            { id: 'x1', name: 'Keystation' },
            { id: 'x2', name: '', manufacturer: 'Acme' },
            { id: 'x3' },
        ]),
        [
            { id: 'x1', label: 'Keystation' },
            { id: 'x2', label: 'Acme' },
            { id: 'x3', label: 'MIDI Device (x3)' },
        ]);
    assert.deepStrictEqual(A._recMidiDeviceRowsPure('domain', null), []);
});

// ── Routing equivalence: the REAL _recMidiOnData over raw bytes ──────
// The domain handle delivers e.data (bytes); the private path unwraps the
// event to the same bytes. One router, one behavior.

function makeRecEnv() {
    const preamble =
        'let _recState = "recording";\n'
        + 'let _recChannel = -1;\n'
        + 'const _recHeld = new Map();\n'
        + 'const _recPending = new Map();\n'
        + 'const _recSustainOn = new Set();\n'
        + 'let _recNotes = [];\n'
        + 'let _now = 0;\n'
        + 'function chartTimeNow() { return _now; }\n'
        + 'function _recCount() {}\n';
    const env = new Function(
        '"use strict";' + preamble
        + extractFn('_recFinalizeNote') + '\n'
        + extractFn('_recMidiOnData') + '\n'
        + 'return {'
        + '  feed: (bytes, atTime) => { _now = atTime; _recMidiOnData(bytes); },'
        + '  notes: () => _recNotes,'
        + '  setChannel: (c) => { _recChannel = c; },'
        + '  setState: (s) => { _recState = s; },'
        + '};'
    )();
    return env;
}

t('note on/off pairs capture with sustain; velocity-0 note-on counts as off', () => {
    const env = makeRecEnv();
    env.feed([0x90, 60, 100], 1.0);     // C4 on
    env.feed([0x80, 60, 0], 1.5);       // off → 0.5 s sustain
    env.feed([0x90, 62, 100], 2.0);     // D4 on
    env.feed([0x90, 62, 0], 2.02);      // vel-0 on = off; <50 ms → sustain 0
    assert.strictEqual(env.notes().length, 2);
    assert.strictEqual(env.notes()[0].time, 1.0);
    assert.strictEqual(env.notes()[0].sustain, 0.5);
    assert.strictEqual(env.notes()[1].sustain, 0, 'sub-50ms tap has no sustain');
    // Keys packing: pitch 60 → string 2, fret 12.
    assert.strictEqual(env.notes()[0].string, 2);
    assert.strictEqual(env.notes()[0].fret, 12);
});

t('channel filter drops other channels; "all channels" keeps them', () => {
    const filtered = makeRecEnv();
    filtered.setChannel(0);
    filtered.feed([0x91, 60, 100], 1.0);   // channel 1 — filtered out
    filtered.feed([0x81, 60, 0], 1.5);
    assert.strictEqual(filtered.notes().length, 0);
    const all = makeRecEnv();
    all.feed([0x91, 60, 100], 1.0);
    all.feed([0x81, 60, 0], 1.5);
    assert.strictEqual(all.notes().length, 1);
});

t('CC64 sustain pedal defers note-off until pedal release (per channel)', () => {
    const env = makeRecEnv();
    env.feed([0xB0, 64, 127], 0.5);     // pedal down (ch 0)
    env.feed([0x90, 60, 100], 1.0);     // on
    env.feed([0x80, 60, 0], 1.2);       // off while pedal held → pending
    assert.strictEqual(env.notes().length, 0, 'held by the pedal');
    env.feed([0xB0, 64, 0], 3.0);       // pedal up → flush
    assert.strictEqual(env.notes().length, 1);
    assert.ok(Math.abs(env.notes()[0].sustain - 2.0) < 1e-9, 'sustains to pedal release');
});

t('cross-channel pedal isolation: channel 1 pedal never flushes channel 0 takes', () => {
    const env = makeRecEnv();
    env.feed([0xB0, 64, 127], 0.5);     // ch0 pedal down
    env.feed([0x90, 60, 100], 1.0);     // ch0 note
    env.feed([0x80, 60, 0], 1.2);       // deferred on ch0
    env.feed([0xB1, 64, 0], 2.0);       // ch1 pedal up — must NOT flush ch0
    assert.strictEqual(env.notes().length, 0);
    env.feed([0xB0, 64, 0], 4.0);       // ch0 pedal up
    assert.strictEqual(env.notes().length, 1);
});

t('idle state ignores everything (the listener may stay attached between takes)', () => {
    const env = makeRecEnv();
    env.setState('idle');
    env.feed([0x90, 60, 100], 1.0);
    env.feed([0x80, 60, 0], 1.5);
    assert.strictEqual(env.notes().length, 0);
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
