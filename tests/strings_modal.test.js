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
 * Run: node tests/strings_modal.test.js
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
function extractClass(name) {
    const start = src.indexOf('class ' + name);
    assert.ok(start >= 0, `class ${name} must exist`);
    const open = src.indexOf('{', start);
    let depth = 0;
    for (let i = open; i < src.length; i++) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}' && --depth === 0) return src.slice(start, i + 1);
    }
    throw new Error(`unbalanced braces extracting ${name}`);
}

const tuningBlock = extractBlock('string-tuning');
const historyBlock = extractBlock('edit-history');
const addStringSrc = extractClass('AddStringCmd');

function makeEnv(S) {
    const env = new Function(
        'document', 'S', 'draw', 'updateStatus',
        '_normalizeTuningToLanes', '_stringCountFor', '_resizeForLaneChange',
        '"use strict";'
        + historyBlock + '\n' + tuningBlock + '\n' + addStringSrc + '\n'
        + 'return { EditHistory, SetStringTuningCmd, AddStringCmd,'
        + ' _stringsRangePure, _stringTuningClampPure };'
    )(
        { getElementById: () => ({ disabled: false }) },
        S,
        () => {},
        () => {},
        () => {},                                  // normalize: fixtures are exact
        (arr) => (arr.tuning || []).length,        // count = real tuning length
        () => {},                                  // resize: no-op off-DOM
    );
    return { ...env, S, history: new env.EditHistory() };
}

let pass = 0, fail = 0;
function t(name, fn) {
    try { fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}

// ── Range policy ─────────────────────────────────────────────────────

t('range: bass 4–6, guitar-family 4–8 (floor dropped for banjo charts)', () => {
    const env = makeEnv({ arrangements: [], currentArr: 0 });
    assert.deepStrictEqual(env._stringsRangePure(true), { min: 4, max: 6 });
    assert.deepStrictEqual(env._stringsRangePure(false), { min: 4, max: 8 });
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

// ── Either-end add through the real AddStringCmd ─────────────────────

t('banjo-style construction: high-side add + re-entrant offset on a 4-lane chart', () => {
    // 4-lane guitar-family chart (legal now that the floor is 4) → add a
    // 5th lane at the LOW end and pitch it far ABOVE its lane position:
    // the re-entrant drone. Notes shift up one lane on the low add.
    const S = {
        currentArr: 0,
        arrangements: [{
            name: 'Banjo',
            tuning: [-2, 0, 0, -1],  // D G B D relative-ish fixture
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

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
