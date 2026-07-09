'use strict';
/*
 * Tests for `_keysDefaultSelection` in screen.js — the Add-Keys picker's
 * default-selection logic that pre-checks a detected RH/LH piano pair (mirrors
 * gp2rs_gpx._find_piano_pairs) so both hands import and merge into one piano.
 * The function is pure (array in → Set of positions out); extract it by
 * brace-matching and eval it in isolation.
 *
 * Run: node tests/keys_pair_select.test.js
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
const _keysDefaultSelection = new Function(
    '"use strict";' + extractFn(src, '_keysDefaultSelection') +
    '\nreturn _keysDefaultSelection;')();

let pass = 0, fail = 0;
function t(name, fn) {
    try { fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}
const sel = (tracks) => [..._keysDefaultSelection(tracks)].sort((a, b) => a - b);

// November Rain shape: a "Piano RH" + "Piano LH" pair among non-keys tracks.
t('pre-selects a detected RH/LH piano pair (both hands)', () => {
    const tracks = [
        { name: 'Vocal', is_piano: false },
        { name: 'Bass Guitar', is_piano: false },
        { name: 'Piano RH', is_piano: true },
        { name: 'Piano LH', is_piano: true },
        { name: 'Drums', is_piano: false },
    ];
    assert.deepStrictEqual(sel(tracks), [2, 3]);  // both piano positions
});

t('order-independent: LH listed before RH still pairs', () => {
    const tracks = [
        { name: 'Piano LH', is_piano: true },
        { name: 'Piano RH', is_piano: true },
    ];
    assert.deepStrictEqual(sel(tracks), [0, 1]);
});

t('single keyboard track with no partner → just that track', () => {
    const tracks = [
        { name: 'Strings', is_piano: false },
        { name: 'Synth Lead', is_piano: true },
    ];
    assert.deepStrictEqual(sel(tracks), [1]);
});

t('two UNRELATED keyboard tracks (no RH/LH) → only the first', () => {
    const tracks = [
        { name: 'Piano', is_piano: true },
        { name: 'Organ', is_piano: true },
    ];
    assert.deepStrictEqual(sel(tracks), [0]);
});

t('only the matching-stem partner pairs, not a stray LH', () => {
    const tracks = [
        { name: 'Piano RH', is_piano: true },
        { name: 'Strings LH', is_piano: true },   // different stem — must not pair
        { name: 'Piano LH', is_piano: true },
    ];
    assert.deepStrictEqual(sel(tracks), [0, 2]);  // Piano RH + Piano LH only
});

t('no keyboard tracks at all → position 0', () => {
    assert.deepStrictEqual(sel([{ name: 'Gtr', is_piano: false }]), [0]);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
