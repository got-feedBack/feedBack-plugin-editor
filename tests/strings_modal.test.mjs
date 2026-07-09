'use strict';
/*
 * Tests for the tuning-aware Strings modal (@pure:string-tuning block +
 * the real AddStringCmd driven at both ends).
 *
 * What changed: the add/remove END is the user's choice (previously a
 * hardcoded policy — high-side adds were unreachable except the one 5→6
 * bass case), guitar-family arrangements allow 4–8 strings (floor was 6,
 * making 5-lane banjo charts unconstructible), and each string's tuning
 * offset is directly editable through the undoable SetStringTuningCmd —
 * so re-entrant setups (banjo's high drone 5th) are typable. These fail
 * on main: _stringsRangePure / SetStringTuningCmd don't exist and the
 * guitar floor is 6.
 *
 * Run: node tests/strings_modal.test.mjs
 */
import assert from 'node:assert';
import { AddStringCmd, RemoveStringCmd, _normalizeTuningToLanes } from '../src/commands.js';
import { EditHistory } from '../src/history.js';
import { setHostHooks } from '../src/host.js';
import { seedState, trackHooks } from './_history_env.mjs';
import fs from 'node:fs';
import { _stringCountFor } from '../src/lanes.js';

const src = fs.readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');

function extractBlock(name) {
    const re = new RegExp(
        '/\\* @pure:' + name + ':start \\*/[\\s\\S]*?/\\* @pure:' + name + ':end \\*/');
    const m = src.match(re);
    if (!m) {
        console.error(`FAIL: @pure:${name} block not found in src/main.js`);
        process.exit(1);
    }
    return m[0];
}

function extractFn(name) {
    const start = src.indexOf('function ' + name + '(');
    assert.ok(start >= 0, `function ${name} must exist`);
    const open = src.indexOf('{', start);
    let depth = 0;
    for (let i = open; i < src.length; i++) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}' && --depth === 0) return src.slice(start, i + 1);
    }
    throw new Error(`unbalanced braces extracting ${name}`);
}
// Extract a `window.<name> = (…) => { … };` arrow assignment whole.
function extractWindowFn(name) {
    const marker = 'window.' + name + ' = ';
    const start = src.indexOf(marker);
    assert.ok(start >= 0, `window.${name} must exist`);
    const open = src.indexOf('{', start);
    let depth = 0;
    for (let i = open; i < src.length; i++) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}' && --depth === 0) {
            let end = i + 1;
            if (src[end] === ';') end++;
            return src.slice(start, end);
        }
    }
    throw new Error(`unbalanced braces extracting window.${name}`);
}

const tuningBlock = extractBlock('string-tuning');
const notesOnStringSrc = extractFn('_notesOnString');
const addStringHandlerSrc = extractWindowFn('editorAddString');
const removeStringHandlerSrc = extractWindowFn('editorRemoveString');

// Handler-level harness — drives the REAL `editorAddString` /
// `editorRemoveString` against the REAL `_stringCountFor` (the stateful
// path that carried the corruption bugs), not the tuning-length stub the
// pure-command harness uses. This is what catches an add/remove at an end
// the pitch/label model can't represent.
function makeHandlerEnv(seed) {
    const S = seedState(seed);
    const env = new Function(
        'window', 'S', 'draw', 'updateStatus', '_renderStringsModal', '_stringCountFor',
        'AddStringCmd', 'RemoveStringCmd',
        '"use strict";'
        + tuningBlock + '\n' + notesOnStringSrc + '\n'
        + addStringHandlerSrc + '\n' + removeStringHandlerSrc + '\n'
        + 'return { window, _stringCountFor, _addPositionPure,'
        + ' _removePositionPure };'
    )(
        {},                       // window
        S,
        () => {},                 // draw
        () => {},                 // updateStatus
        () => {},                 // _renderStringsModal (DOM-free)
        _stringCountFor,          // the REAL one, imported from src/lanes.js
        AddStringCmd, RemoveStringCmd,
    );
    S.history = new EditHistory();
    return env;
}

function makeEnv(seed) {
    const S = seedState(seed);
    // AddStringCmd is a real import now, so it runs against the REAL
    // _stringCountFor and the REAL _normalizeTuningToLanes rather than the
    // tuning-length stub this harness used to inject. The handler harness above
    // already drove those; this one no longer differs from it on that axis.
    const env = new Function(
        'S', '"use strict";' + tuningBlock
        + '\nreturn { SetStringTuningCmd, _stringsRangePure, _stringTuningClampPure,'
        + ' _addPositionPure, _removePositionPure };'
    )(S);
    return { ...env, AddStringCmd, _normalizeTuningToLanes, S, history: new EditHistory() };
}

trackHooks();
setHostHooks({ resizeForLaneChange: () => {} });

let pass = 0, fail = 0;
function t(name, fn) {
    try { fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}

// ── Range policy ─────────────────────────────────────────────────────

t('range: bass 4–6, guitar 6–8 (floors match the fixed pitch/label model)', () => {
    const env = makeEnv({ arrangements: [], currentArr: 0 });
    assert.deepStrictEqual(env._stringsRangePure(true), { min: 4, max: 6 });
    // Guitar floor is 6, NOT 4: the label/pitch model has no consistent
    // shape for a sub-6 guitar, so dropping below it would corrupt indices.
    assert.deepStrictEqual(env._stringsRangePure(false), { min: 6, max: 8 });
});

t('add/remove position pures follow the fixed extension order', () => {
    const env = makeEnv({ arrangements: [], currentArr: 0 });
    // Bass grows low (4→5) then high (5→6); shrinks high (6→5) then low (5→4).
    assert.strictEqual(env._addPositionPure(true, 4), 'low');
    assert.strictEqual(env._addPositionPure(true, 5), 'high');
    assert.strictEqual(env._addPositionPure(true, 6), null);
    assert.strictEqual(env._removePositionPure(true, 6), 'high');
    assert.strictEqual(env._removePositionPure(true, 5), 'low');
    assert.strictEqual(env._removePositionPure(true, 4), null);
    // Guitar grows low only (6→7→8); never a high end; never below 6.
    assert.strictEqual(env._addPositionPure(false, 6), 'low');
    assert.strictEqual(env._addPositionPure(false, 7), 'low');
    assert.strictEqual(env._addPositionPure(false, 8), null);
    assert.strictEqual(env._removePositionPure(false, 7), 'low');
    assert.strictEqual(env._removePositionPure(false, 6), null);
});

t('tuning offset clamps to ±36 semitones; junk falls back to 0', () => {
    const env = makeEnv({ arrangements: [], currentArr: 0 });
    assert.strictEqual(env._stringTuningClampPure(-2), -2);
    assert.strictEqual(env._stringTuningClampPure(29), 29, 'a re-entrant drone offset survives');
    assert.strictEqual(env._stringTuningClampPure(99), 36);
    assert.strictEqual(env._stringTuningClampPure(-99), -36);
    assert.strictEqual(env._stringTuningClampPure('abc'), 0);
});

// ── SetStringTuningCmd ───────────────────────────────────────────────

t('per-string tuning edit round-trips under undo/redo', () => {
    const S = {
        currentArr: 0,
        arrangements: [{ name: 'Lead', tuning: [0, 0, 0, 0, 0, 0], notes: [], chords: [] }],
    };
    const env = makeEnv(S);
    env.history.exec(new env.SetStringTuningCmd(0, 0, -2));
    assert.strictEqual(S.arrangements[0].tuning[0], -2, 'drop-D low string');
    env.history.doUndo();
    assert.strictEqual(S.arrangements[0].tuning[0], 0);
    env.history.doRedo();
    assert.strictEqual(S.arrangements[0].tuning[0], -2);
});

t('tuning edit targets its captured arrangement, not whichever is active at undo', () => {
    const S = {
        currentArr: 0,
        arrangements: [
            { name: 'Lead', tuning: [0, 0, 0, 0, 0, 0], notes: [], chords: [] },
            { name: 'Rhythm', tuning: [0, 0, 0, 0, 0, 0], notes: [], chords: [] },
        ],
    };
    const env = makeEnv(S);
    env.history.exec(new env.SetStringTuningCmd(0, 2, 5));
    S.currentArr = 1;  // user switches before undoing
    env.history.doUndo();
    assert.strictEqual(S.arrangements[0].tuning[2], 0, 'undo lands on the captured arr');
    assert.strictEqual(S.arrangements[1].tuning[2], 0, 'the active arr is untouched');
});

t('tuning edit pads a short tuning array instead of writing a hole', () => {
    const S = {
        currentArr: 0,
        arrangements: [{ name: 'Lead', tuning: [0, 0], notes: [], chords: [] }],
    };
    const env = makeEnv(S);
    env.history.exec(new env.SetStringTuningCmd(0, 4, 12));
    const tun = S.arrangements[0].tuning;
    assert.strictEqual(tun.length, 5);
    assert.deepStrictEqual(tun, [0, 0, 0, 0, 12], 'gap filled with 0s, no undefined holes');
});

t('command input is clamped at the boundary', () => {
    const S = {
        currentArr: 0,
        arrangements: [{ name: 'Lead', tuning: [0], notes: [], chords: [] }],
    };
    const env = makeEnv(S);
    env.history.exec(new env.SetStringTuningCmd(0, 0, 999));
    assert.strictEqual(S.arrangements[0].tuning[0], 36);
});

// ── Command-level mechanics (raw AddStringCmd, count stubbed) ────────

t('low-side add shifts note lanes up; direct re-entrant offset then undo round-trips', () => {
    // Adding at the LOW end shifts existing notes up one lane, a large offset
    // can then be typed directly (re-entrant drone), and a full undo restores
    // the chart.
    //
    // The fixture is a 4-string BASS, not the 'Banjo' this used to use. The
    // command now runs against the REAL _stringCountFor rather than an injected
    // tuning-length stub, and the real model has no banjo: it reads a 4-length
    // tuning on a non-bass part as a padded guitar and reports 6. Only a name
    // the string-count model actually recognises gives a 4-string chart.
    const S = {
        currentArr: 0,
        arrangements: [{
            name: 'Bass',
            tuning: [-2, 0, 0, -1],  // relative-ish fixture, 4 strings
            notes: [{ time: 1, string: 0, fret: 2 }],
            chords: [],
            chord_templates: [],
        }],
    };
    const env = makeEnv(S);
    env.history.exec(new env.AddStringCmd(0, 'low'));
    const arr = S.arrangements[0];
    assert.strictEqual(arr.tuning.length, 5);
    assert.strictEqual(arr.notes[0].string, 1, 'existing notes shift up on a low add');
    env.history.exec(new env.SetStringTuningCmd(0, 0, 29));
    assert.strictEqual(arr.tuning[0], 29, 're-entrant drone offset typed directly');
    // Full undo restores the original chart exactly.
    env.history.doUndo();
    env.history.doUndo();
    assert.deepStrictEqual(arr.tuning, [-2, 0, 0, -1]);
    assert.strictEqual(arr.notes[0].string, 0);
});

t('high-side add leaves note lanes alone (6-string-bass high-C shape)', () => {
    const S = {
        currentArr: 0,
        arrangements: [{
            name: 'Bass',
            tuning: [0, 0, 0, 0, 0],
            notes: [{ time: 1, string: 4, fret: 3 }],
            chords: [],
            chord_templates: [],
        }],
    };
    const env = makeEnv(S);
    env.history.exec(new env.AddStringCmd(0, 'high'));
    const arr = S.arrangements[0];
    assert.strictEqual(arr.tuning.length, 6);
    assert.strictEqual(arr.notes[0].string, 4, 'high add never renumbers notes');
});

// ── Handler-level regressions (REAL _stringCountFor) ─────────────────
// These drive the window handlers through the same _stringCountFor the
// renderer uses. Each FAILS on pre-fix code, where the handler added or
// removed at an end the pitch/label model can't represent — silently
// re-snapping the string count and re-interpreting note indices.

function guitar6(notesArr) {
    return {
        currentArr: 0,
        arrangements: [{
            name: 'Lead', tuning: [0, 0, 0, 0, 0, 0],
            notes: notesArr, chords: [], chord_templates: [],
        }],
    };
}

t('REGRESSION: guitar high-add is refused (no phantom 7th / relabelled notes)', () => {
    const S = guitar6([{ time: 1, string: 2, fret: 3 }]);
    const env = makeHandlerEnv(S);
    env.window.editorAddString('high');            // guitar has no valid high end
    const arr = S.arrangements[0];
    assert.strictEqual(arr.tuning.length, 6, 'string count unchanged');
    assert.strictEqual(env._stringCountFor(arr), 6);
    assert.strictEqual(arr.notes[0].string, 2, 'note index untouched');
});

t('REGRESSION: guitar remove-low from 6 is refused (no silent note shift)', () => {
    // Low string carries no notes, so pre-fix the button/handler allowed
    // the remove — shifting every note down a lane while the count stayed 6.
    const S = guitar6([{ time: 1, string: 3, fret: 5 }]);
    const env = makeHandlerEnv(S);
    env.window.editorRemoveString('low');
    const arr = S.arrangements[0];
    assert.strictEqual(arr.tuning.length, 6, 'string count unchanged');
    assert.strictEqual(arr.notes[0].string, 3, 'note index untouched');
});

t('REGRESSION: guitar remove-high from a 7-string is refused (Codex #2)', () => {
    // A low-extended 7-string guitar: popping the HIGH end collapses to 6
    // but leaves the low-B column + shifted note indices in place.
    const S = {
        currentArr: 0,
        arrangements: [{
            name: 'Lead', tuning: [0, 0, 0, 0, 0, 0, 0],
            notes: [{ time: 1, string: 1, fret: 5 }],  // none on the high (idx 6) string
            chords: [], chord_templates: [],
        }],
    };
    const env = makeHandlerEnv(S);
    assert.strictEqual(env._stringCountFor(S.arrangements[0]), 7);
    env.window.editorRemoveString('high');
    const arr = S.arrangements[0];
    assert.strictEqual(arr.tuning.length, 7, 'string count unchanged');
    assert.strictEqual(arr.notes[0].string, 1, 'note index untouched');
});

t('REGRESSION: bass high-add at 4 strings is refused (5th must be low B)', () => {
    const S = {
        currentArr: 0,
        arrangements: [{
            name: 'Bass', tuning: [0, 0, 0, 0],
            notes: [{ time: 1, string: 3, fret: 3 }],
            chords: [], chord_templates: [],
        }],
    };
    const env = makeHandlerEnv(S);
    env.window.editorAddString('high');            // 4-string bass grows low, not high
    const arr = S.arrangements[0];
    assert.strictEqual(arr.tuning.length, 4, 'string count unchanged');
    assert.strictEqual(arr.notes[0].string, 3, 'note index untouched');
});

t('model-valid ops still work: guitar low-add (6→7) shifts notes up', () => {
    const S = guitar6([{ time: 1, string: 2, fret: 3 }]);
    const env = makeHandlerEnv(S);
    env.window.editorAddString('low');
    const arr = S.arrangements[0];
    assert.strictEqual(arr.tuning.length, 7);
    assert.strictEqual(arr.notes[0].string, 3, 'low add renumbers notes up one lane');
});

t('model-valid ops still work: bass low-add (4→5) then high-add (5→6 high C)', () => {
    const S = {
        currentArr: 0,
        arrangements: [{
            name: 'Bass', tuning: [0, 0, 0, 0],
            notes: [{ time: 1, string: 1, fret: 3 }],
            chords: [], chord_templates: [],
        }],
    };
    const env = makeHandlerEnv(S);
    env.window.editorAddString('low');             // 4→5 low B
    let arr = S.arrangements[0];
    assert.strictEqual(arr.tuning.length, 5);
    assert.strictEqual(arr.notes[0].string, 2, 'notes shift up on the low add');
    env.window.editorAddString('high');            // 5→6 high C, no renumber
    arr = S.arrangements[0];
    assert.strictEqual(arr.tuning.length, 6);
    assert.strictEqual(arr.notes[0].string, 2, 'high-C add leaves note lanes alone');
});

t('remove refuses an end string that carries notes (notes guard intact)', () => {
    // 7-string guitar with a note on the low (removable) string → refused.
    const S = {
        currentArr: 0,
        arrangements: [{
            name: 'Lead', tuning: [0, 0, 0, 0, 0, 0, 0],
            notes: [{ time: 1, string: 0, fret: 2 }],
            chords: [], chord_templates: [],
        }],
    };
    const env = makeHandlerEnv(S);
    env.window.editorRemoveString('low');
    const arr = S.arrangements[0];
    assert.strictEqual(arr.tuning.length, 7, 'removal blocked while a note lives on the low string');
    assert.strictEqual(arr.notes[0].string, 0);
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
