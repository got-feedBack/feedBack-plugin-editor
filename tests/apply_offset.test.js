'use strict';
/*
 * Tests for `_shiftArrangementTimes` in src/main.js — the per-arrangement rigid
 * time shift used by editorApplyOffset. The bug (#2): editorApplyOffset only
 * shifted the CURRENT arrangement's notes while beats/sections/drums shifted
 * globally, so other arrangements (and all arrangements' chords/anchors/
 * handshapes/phrases) drifted; the user re-nudged each one, poisoning
 * `dataset.applied`. The fix shifts every arrangement's full time-bearing set.
 * The helper is pure; extract it by brace-matching and eval in isolation.
 *
 * Run: node tests/apply_offset.test.js
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

function extractFn(src, name) {
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

const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
const _shiftArrangementTimes = new Function(
    '"use strict";' + extractFn(src, '_shiftArrangementTimes') +
    '\nreturn _shiftArrangementTimes;')();

let pass = 0, fail = 0;
function t(name, fn) {
    try { fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}

function fullArr() {
    return {
        notes: [{ time: 1.0, sustain: 0.5 }, { time: 2.0, sustain: 0.25 }],
        chords: [{ time: 3.0, notes: [{ time: 3.0, sustain: 0.5 }, { time: 3.0, sustain: 0.5 }] }],
        anchors: [{ time: 1.0, fret: 1, width: 4 }],
        anchors_user: [{ time: 2.0, fret: 5, width: 4 }],
        handshapes: [{ chord_id: 0, start_time: 3.0, end_time: 3.5 }],
        phrases: [{ time: 0.0 }, { time: 4.0 }],
    };
}

t('shifts every time-bearing field by +delta', () => {
    const arr = fullArr();
    _shiftArrangementTimes(arr, 1.5);
    assert.deepStrictEqual(arr.notes.map(n => n.time), [2.5, 3.5]);
    assert.strictEqual(arr.chords[0].time, 4.5);
    assert.deepStrictEqual(arr.chords[0].notes.map(c => c.time), [4.5, 4.5]);
    assert.strictEqual(arr.anchors[0].time, 2.5);
    assert.strictEqual(arr.anchors_user[0].time, 3.5);
    assert.strictEqual(arr.handshapes[0].start_time, 4.5);
    assert.strictEqual(arr.handshapes[0].end_time, 5.0);
    assert.deepStrictEqual(arr.phrases.map(p => p.time), [1.5, 5.5]);
});

t('does NOT move sustains (durations are preserved)', () => {
    const arr = fullArr();
    _shiftArrangementTimes(arr, 2.0);
    assert.deepStrictEqual(arr.notes.map(n => n.sustain), [0.5, 0.25]);
    assert.deepStrictEqual(arr.chords[0].notes.map(c => c.sustain), [0.5, 0.5]);
});

t('negative delta shifts backward', () => {
    const arr = { notes: [{ time: 2.0 }], chords: [], anchors: [], handshapes: [] };
    _shiftArrangementTimes(arr, -0.75);
    assert.strictEqual(arr.notes[0].time, 1.25);
});

t('tolerates missing arrays / null arr / non-numeric times', () => {
    assert.doesNotThrow(() => _shiftArrangementTimes(null, 1));
    assert.doesNotThrow(() => _shiftArrangementTimes({}, 1));
    const arr = { notes: [{ time: 'x' }, { time: 1.0 }], handshapes: [{ start_time: 1.0 }] };
    _shiftArrangementTimes(arr, 1.0);
    assert.strictEqual(arr.notes[0].time, 'x');     // non-numeric untouched
    assert.strictEqual(arr.notes[1].time, 2.0);
    assert.strictEqual(arr.handshapes[0].start_time, 2.0);  // missing end_time ok
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
