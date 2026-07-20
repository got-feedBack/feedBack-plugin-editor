/*
 * Instrument type as first-class DATA (src/instrument.js).
 *
 * Pinned here:
 *   - _typeKind maps the manifest `type` facet (feedpak-spec §5.2 — "piano" for
 *     the keys family, plus the plural set the multitrack work grows into) to the
 *     editor's runtime kind, or null when absent/blank/unrecognized;
 *   - the load-bearing DATA/view predicates now HONOR an authored `type` over the
 *     name — isKeysArr (keys.js) and the 4-vs-6 bass baseline
 *     (_seedExtendedStringsFromTuning, lanes.js);
 *   - and they stay BYTE-IDENTICAL for untyped/legacy arrangements: with no
 *     `type`, every predicate falls back to its exact previous name test.
 *
 * Fails on main: src/instrument.js does not exist and the predicates read only
 * the name (a typed part named against its instrument can't override).
 *
 * Run: node tests/instrument_type.test.mjs
 */
import assert from 'node:assert';

import { _typeKind, _arrTypeKind } from '../src/instrument.js';
import { isKeysArr } from '../src/keys.js';
import { _seedExtendedStringsFromTuning } from '../src/lanes.js';
import { seedState } from './_history_env.mjs';

let pass = 0; let fail = 0;
const tests = [];
const t = (name, fn) => tests.push([name, fn]);

// ── _typeKind ─────────────────────────────────────────────────────────
t('_typeKind maps the manifest vocabulary to runtime kinds', () => {
    for (const v of ['piano', 'keyboard', 'synth', 'keys']) assert.strictEqual(_typeKind(v), 'keys', v);
    assert.strictEqual(_typeKind('bass'), 'bass');
    for (const v of ['guitar', 'lead', 'rhythm']) assert.strictEqual(_typeKind(v), 'guitar', v);
    for (const v of ['drum', 'drums']) assert.strictEqual(_typeKind(v), 'drums', v);
    for (const v of ['vocal', 'vocals', 'voice']) assert.strictEqual(_typeKind(v), 'vocals', v);
    // case + whitespace insensitive
    assert.strictEqual(_typeKind('  Piano '), 'keys');
    assert.strictEqual(_typeKind('BASS'), 'bass');
});

t('_typeKind is null for absent / blank / unrecognized / non-string', () => {
    assert.strictEqual(_typeKind(''), null);
    assert.strictEqual(_typeKind('   '), null);
    assert.strictEqual(_typeKind('tuba'), null, 'unrecognized → null (falls back to name)');
    assert.strictEqual(_typeKind(undefined), null);
    assert.strictEqual(_typeKind(null), null);
    assert.strictEqual(_typeKind(42), null);
});

t('_arrTypeKind reads arr.type (and is null when untyped)', () => {
    assert.strictEqual(_arrTypeKind({ type: 'piano' }), 'keys');
    assert.strictEqual(_arrTypeKind({ type: '  ' }), null);
    assert.strictEqual(_arrTypeKind({ name: 'Piano' }), null, 'no type field → null (name is the caller’s fallback)');
    assert.strictEqual(_arrTypeKind(null), null);
});

// ── isKeysArr: authored type wins; untyped falls back to name ──────────
const setArr = (arr) => { seedState({ arrangements: [arr], currentArr: 0 }); };

t('isKeysArr: an authored `type` overrides the name (both directions)', () => {
    setArr({ name: 'Lead', type: 'keys' });
    assert.strictEqual(isKeysArr(), true, 'typed keys, non-keys name → keys');
    setArr({ name: 'Grand Piano', type: 'guitar' });
    assert.strictEqual(isKeysArr(), false, 'typed guitar, keys-looking name → NOT keys');
});

t('isKeysArr: untyped falls back to the exact prefix name test (byte-identical)', () => {
    setArr({ name: 'Piano' });
    assert.strictEqual(isKeysArr(), true, 'keys-prefix name → keys');
    setArr({ name: 'Synth Lead' });
    assert.strictEqual(isKeysArr(), true, 'synth-prefix → keys');
    setArr({ name: 'Electric Piano' });
    assert.strictEqual(isKeysArr(), false, 'NOT keys-prefixed → falls through, same as today');
    setArr({ name: 'Lead' });
    assert.strictEqual(isKeysArr(), false);
});

// ── the bass 4-vs-6 baseline honors type, else the name ───────────────
t('_seedExtendedStringsFromTuning: type drives the 4-vs-6 baseline', () => {
    // typed bass with a NON-bass name → baseline 4 (len 5 → +1 extended)
    const a = [{ name: 'Rhythm', type: 'bass', tuning: [0, 0, 0, 0, 0] }];
    _seedExtendedStringsFromTuning(a, true);
    assert.strictEqual(a[0]._extendedStrings, 1, 'typed bass → baseline 4');
    // typed KEYS named "Synth Bass" → NOT bass → baseline 6 (len 5 < 6 → unset)
    const b = [{ name: 'Synth Bass', type: 'keys', tuning: [0, 0, 0, 0, 0] }];
    _seedExtendedStringsFromTuning(b, true);
    assert.strictEqual(b[0]._extendedStrings, undefined, 'typed keys → baseline 6, len 5 not extended');
});

t('_seedExtendedStringsFromTuning: untyped falls back to the /bass/ name test (byte-identical)', () => {
    const bass = [{ name: 'Bass', tuning: [0, 0, 0, 0, 0] }];        // len 5, name bass → baseline 4
    _seedExtendedStringsFromTuning(bass, true);
    assert.strictEqual(bass[0]._extendedStrings, 1, 'untyped bass name → baseline 4, +1');
    const gtr = [{ name: 'Rhythm', tuning: [0, 0, 0, 0, 0] }];       // len 5, non-bass → baseline 6, unset
    _seedExtendedStringsFromTuning(gtr, true);
    assert.strictEqual(gtr[0]._extendedStrings, undefined, 'untyped non-bass, len 5 → baseline 6, unset');
});

for (const [name, fn] of tests) {
    try { await fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
