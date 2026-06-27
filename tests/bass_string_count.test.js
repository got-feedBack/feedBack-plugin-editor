'use strict';
/*
 * Regression test: a 4-string bass feedpak whose tuning is RS-padded to 6 slots
 * must NOT be read as a 6-string bass. Before the fix, _seedExtendedStringsFromTuning
 * treated a length-6 bass tuning as authoritative on sloppak load, so _stringCountFor
 * returned 6 → lanes [B↓,E,A,D,G,C] → string-0 (low E) notes rendered on the B↓ lane.
 * The fix ignores the ambiguous length-6 bass tuning (matching core
 * arrangement_string_count) and lets note string indices decide.
 *
 * Run: node tests/bass_string_count.test.js
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

const src = fs.readFileSync(path.join(__dirname, '..', 'screen.js'), 'utf8');
const { _seedExtendedStringsFromTuning, _stringCountFor } = new Function(
    '"use strict"; const MAX_LANES = 8;' +
    extractFn(src, '_seedExtendedStringsFromTuning') +
    extractFn(src, '_stringCountFor') +
    '\nreturn { _seedExtendedStringsFromTuning, _stringCountFor };')();

let pass = 0, fail = 0;
function t(name, fn) {
    try { fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}

const padded6 = [0, 0, 0, 0, 0, 0];
const notesUpTo = (s) => Array.from({ length: s + 1 }, (_, i) => ({ string: i }));

// The exact shape of a converted bass feedpak: name "Bass", tuning len 6, notes 0..3.
t('4-string bass with RS-padded len-6 tuning reads as 4 strings (the bug)', () => {
    const arr = { name: 'Bass', tuning: padded6.slice(), notes: notesUpTo(3), chords: [] };
    _seedExtendedStringsFromTuning([arr], /* authoritative (sloppak) */ true);
    assert.strictEqual(_stringCountFor(arr), 4);   // was 6 before the fix
    assert.strictEqual(arr._extendedStrings, undefined);  // not seeded from len-6
});

t('genuine 6-string bass (notes reach string 5) still reads as 6', () => {
    const arr = { name: 'Bass', tuning: padded6.slice(), notes: notesUpTo(5), chords: [] };
    _seedExtendedStringsFromTuning([arr], true);
    assert.strictEqual(_stringCountFor(arr), 6);   // note indices drive it
});

t('5-string bass (len-5 tuning) reads as 5 strings', () => {
    const arr = { name: 'Bass', tuning: [0, 0, 0, 0, 0], notes: notesUpTo(3), chords: [] };
    _seedExtendedStringsFromTuning([arr], true);
    assert.strictEqual(_stringCountFor(arr), 5);   // len != 6 is trustworthy
});

t('6-string guitar (len-6 tuning) still reads as 6', () => {
    const arr = { name: 'Lead', tuning: padded6.slice(), notes: notesUpTo(3), chords: [] };
    _seedExtendedStringsFromTuning([arr], true);
    assert.strictEqual(_stringCountFor(arr), 6);   // guitar baseline 6
});

t('7-string guitar (len-7 tuning) reads as 7 regardless of source', () => {
    const arr = { name: 'Lead', tuning: [0, 0, 0, 0, 0, 0, 0], notes: notesUpTo(3), chords: [] };
    _seedExtendedStringsFromTuning([arr], false);  // even non-authoritative
    assert.strictEqual(_stringCountFor(arr), 7);
});

t('archive load (non-authoritative) also reads padded len-6 bass as 4', () => {
    const arr = { name: 'Bass', tuning: padded6.slice(), notes: notesUpTo(3), chords: [] };
    _seedExtendedStringsFromTuning([arr], /* archive */ false);
    assert.strictEqual(_stringCountFor(arr), 4);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
