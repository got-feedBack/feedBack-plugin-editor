/*
 * Regression: a DOUBLE-click in the piano-roll keyboard gutter must NOT open
 * the Add Note dialog. The gutter is audition-only (single-click plays the
 * row's pitch via onMouseDown); before the fix, onDblClick had no gutter guard,
 * so double-clicking a key fell through to hitNote()==-1 and called
 * showAddNote() at time 0 — silently inserting a note the user never asked for.
 * This violates the PR contract ("it never adds or selects a note").
 *
 * Pins the real onDblClick + the real _inKeyboardGutterPure from src/main.js
 * (single browser IIFE) by brace-matching, and asserts showAddNote is NOT
 * called for a gutter double-click, but IS called for a click in the note area.
 * Fails on pre-fix src/main.js (showAddNote fires in the gutter).
 *
 * Run: node tests/keyboard_gutter_dblclick.test.mjs
 */
import assert from 'node:assert';
import fs from 'node:fs';
import { _inKeyboardGutterPure } from '../src/keys.js';

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
function extractBlock(name) {
    const re = new RegExp('/\\* @pure:' + name + ':start \\*/[\\s\\S]*?/\\* @pure:' + name + ':end \\*/');
    const m = src.match(re);
    assert.ok(m, `@pure:${name} block must exist`);
    return m[0];
}

// _inKeyboardGutterPure is a real import from src/keys.js; `onDblClick` still
// lives in src/main.js and is still brace-extracted.

// Geometry matching src/main.js defaults.
const LABEL_W = 52, WAVEFORM_H = 70, PIANO_LANE_H = 10;
const pianoRange = { lo: 36, hi: 96 };

// Build an onDblClick with every free global injected. showAddNote is a spy.
function makeDblClick(keysMode) {
    const calls = { showAddNote: 0, lockNotice: 0 };
    const deps = {
        S: { partsViewMode: false, drumEditMode: false, tempoMapMode: false },
        _partsViewOnDblClick: () => {},
        _recState: 'idle',
        getMousePos: (e) => ({ x: e.x, y: e.y }),
        isKeysMode: () => keysMode,
        WAVEFORM_H, PIANO_LANE_H, LANE_H: 44, LABEL_W,
        pianoLaneCount: () => pianoRange.hi - pianoRange.lo + 1,
        lanes: () => 6,
        _inKeyboardGutterPure,
        hitNote: () => -1,           // empty space — no existing note under cursor
        _rollReadOnly: () => false,  // authoring allowed
        _rollLockNotice: () => { calls.lockNotice++; },
        snapTime: (t) => t,
        xToTime: (x) => (x - LABEL_W) / 1 + 0,
        yToMidi: (y) => pianoRange.hi - Math.floor((y - WAVEFORM_H) / PIANO_LANE_H),
        midiToString: (m) => Math.floor(m / 24),
        midiToFret: (m) => m % 24,
        yToStr: () => 0,
        showAddNote: () => { calls.showAddNote++; },
    };
    const names = Object.keys(deps);
    const fn = new Function(...names, '"use strict";' + extractFn('onDblClick') + '\nreturn onDblClick;')(
        ...names.map((n) => deps[n])
    );
    return { fn, calls };
}

let passed = 0, failed = 0;
function t(name, run) {
    try { run(); passed++; console.log('  ok ' + name); }
    catch (e) { failed++; console.error('  FAIL ' + name + '\n    ' + (e && e.message)); }
}

// A y inside the lanes; an x inside the gutter (< LABEL_W).
const yInLanes = WAVEFORM_H + 5;

t('double-click in the keyboard gutter does NOT open Add Note (keys mode)', () => {
    const { fn, calls } = makeDblClick(true);
    fn({ x: 10, y: yInLanes, clientX: 10, clientY: yInLanes });
    assert.strictEqual(calls.showAddNote, 0, 'gutter double-click must not add a note');
});

t('double-click in the note area (x >= LABEL_W) still opens Add Note', () => {
    const { fn, calls } = makeDblClick(true);
    fn({ x: LABEL_W + 20, y: yInLanes, clientX: LABEL_W + 20, clientY: yInLanes });
    assert.strictEqual(calls.showAddNote, 1, 'note-area double-click still authors');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
