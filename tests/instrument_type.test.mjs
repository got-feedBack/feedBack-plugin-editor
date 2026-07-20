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

import { _typeKind, _arrTypeKind, _arrKindFromName, arrKind } from '../src/instrument.js';
import { isKeysArr, KEYS_PATTERN, _rollPitchCtxFor } from '../src/keys.js';
import { _seedExtendedStringsFromTuning } from '../src/lanes.js';
import { _trackKindBadgePure } from '../src/track-session.js';
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

// ── _arrKindFromName + arrKind (the canonical resolver) ───────────────
t('KEYS_PATTERN is re-exported from keys.js (its home is now the leaf)', () => {
    assert.strictEqual(KEYS_PATTERN.test('Piano'), true);
    assert.strictEqual(KEYS_PATTERN.test('Electric Piano'), false, 'prefix-anchored, unchanged');
});

t('_arrKindFromName mirrors the legacy runtime inference (keys before bass)', () => {
    assert.strictEqual(_arrKindFromName('Piano'), 'keys');
    assert.strictEqual(_arrKindFromName('Synth Lead'), 'keys');
    assert.strictEqual(_arrKindFromName('Drums'), 'drums');
    assert.strictEqual(_arrKindFromName('Drums 2'), 'drums');
    assert.strictEqual(_arrKindFromName('Drumkit'), 'guitar', 'prefix is /^drums/ — "Drumkit" is not "drums"');
    assert.strictEqual(_arrKindFromName('Synth Bass'), 'keys', 'keys wins over bass');
    assert.strictEqual(_arrKindFromName('Bass'), 'bass');
    assert.strictEqual(_arrKindFromName('Lead'), 'guitar');
    assert.strictEqual(_arrKindFromName(''), 'guitar');
});

t('arrKind: authored type wins, name inference is the fallback', () => {
    assert.strictEqual(arrKind({ name: 'Lead', type: 'drums' }), 'drums', 'type wins');
    assert.strictEqual(arrKind({ name: 'Grand Piano', type: 'guitar' }), 'guitar', 'type wins over keys name');
    assert.strictEqual(arrKind({ name: 'Piano' }), 'keys', 'untyped → name inference');
    assert.strictEqual(arrKind({ name: 'Bass' }), 'bass');
    assert.strictEqual(arrKind({ name: 'Backing Vox', type: 'vocals' }), 'vocals');
    assert.strictEqual(arrKind(null), 'guitar', 'no arr → guitar default');
});

// ── the Tracks-view kind badge ────────────────────────────────────────
t('_trackKindBadgePure: audio shows the layer, transcription shows the instrument', () => {
    assert.deepStrictEqual(_trackKindBadgePure({ type: 'audio', sourceKind: 'master' }, []), ['MIX', 'Master mix']);
    assert.deepStrictEqual(_trackKindBadgePure({ type: 'audio', sourceKind: 'stem' }, []), ['AUD', 'Audio']);
    assert.deepStrictEqual(_trackKindBadgePure({ type: 'transcription', targetId: 'drums' }, []), ['DRM', 'Drums']);
    const arrs = [{ name: 'Lead' }, { name: 'Piano' }, { name: 'Rhythm', type: 'bass' }, { name: 'Choir', type: 'vocals' }];
    assert.deepStrictEqual(_trackKindBadgePure({ type: 'transcription', targetId: 'Lead', mixKey: 'arr:0' }, arrs), ['GTR', 'Guitar']);
    assert.deepStrictEqual(_trackKindBadgePure({ type: 'transcription', targetId: 'Piano', mixKey: 'arr:1' }, arrs), ['KEY', 'Keys']);
    assert.deepStrictEqual(_trackKindBadgePure({ type: 'transcription', targetId: 'Rhythm', mixKey: 'arr:2' }, arrs), ['BAS', 'Bass'], 'type wins over the non-bass name');
    assert.deepStrictEqual(_trackKindBadgePure({ type: 'transcription', targetId: 'Choir', mixKey: 'arr:3' }, arrs), ['VOX', 'Vocals']);
});

// ── view routing honors type (a converted reader) ────────────────────
t('_rollPitchCtxFor: a typed-keys part has no fretted context regardless of name', () => {
    assert.strictEqual(_rollPitchCtxFor({ name: 'Lead', type: 'keys' }), null, 'typed keys → null (no fretted ctx)');
    assert.strictEqual(_rollPitchCtxFor({ name: 'Piano' }), null, 'untyped keys name → null (fallback, unchanged)');
    const gtr = _rollPitchCtxFor({ name: 'Grand Piano', type: 'guitar', tuning: [40, 45, 50, 55, 59, 64], capo: 0 });
    assert.notStrictEqual(gtr, null, 'typed guitar named "Piano" → a real fretted ctx (type wins)');
});

for (const [name, fn] of tests) {
    try { await fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
