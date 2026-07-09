'use strict';
/*
 * Chord sustain resize helper tests for screen.js.
 *
 * Run: node tests/chord_resize.test.js
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
const m = src.match(/\/\* @pure:chord-resize:start \*\/[\s\S]*?\/\* @pure:chord-resize:end \*\//);
if (!m) {
    console.error('FAIL: @pure:chord-resize block not found in screen.js');
    process.exit(1);
}

const api = new Function(
    '"use strict";' + m[0] + '\nreturn { _resizeTargetIndicesPure, _resizeSustainsForDeltaPure, _maxSustainBeforeCollisionPure };'
)();

let pass = 0;
let fail = 0;
function t(name, fn) {
    try { fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}

const notes = [
    { time: 1, string: 0, fret: 3, sustain: 0.25 },
    { time: 1, string: 1, fret: 5, sustain: 0.25 },
    { time: 1, string: 2, fret: 7, sustain: 0.25 },
    { time: 2, string: 1, fret: 6, sustain: 0.1 },
    { time: 3, string: 0, fret: 8, sustain: 0.1 },
];

t('default resize targets every same-time chord note', () => {
    assert.deepStrictEqual(api._resizeTargetIndicesPure(notes, 1, true), [0, 1, 2]);
});

t('alt/single-note resize targets only the grabbed note', () => {
    assert.deepStrictEqual(api._resizeTargetIndicesPure(notes, 1, false), [1]);
});

t('group resize applies one sustain to every chord member', () => {
    assert.deepStrictEqual(
        api._resizeSustainsForDeltaPure(notes, [0, 1, 2], 0.25, 0.5),
        [0.75, 0.75, 0.75],
    );
});

t('group resize clamps each member independently at its own collision limit', () => {
    // Same +2.5 delta from orig 0.25 wants 2.75 for every member, but each is
    // capped by its OWN next same-string onset: string 0 → idx4 @ t=3 (cap 2),
    // string 1 → idx3 @ t=2 (cap 1), string 2 → no later onset (uncapped). A
    // member that would collide stops at its limit while the others extend —
    // it is NOT flattened to the group-wide minimum.
    assert.deepStrictEqual(
        api._resizeSustainsForDeltaPure(notes, [0, 1, 2], 0.25, 2.5),
        [2, 1, 2.75],
    );
});

t('collision ignores other chord members in the resize target set', () => {
    assert.strictEqual(api._maxSustainBeforeCollisionPure(notes, [0, 1, 2]), 1);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);