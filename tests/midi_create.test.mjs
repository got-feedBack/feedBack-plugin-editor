/*
 * MIDI-only create + real multitrack unpack (the dkcjungle-2.mid fix):
 * a staged MIDI is a project now, and EVERY selected track imports.
 *
 * Pinned here:
 *   - the default title reads from the filename (never empty — the
 *     blank-create backend requires one);
 *   - unpacked track names are KEYS-SAFE: kind inference is name-driven and
 *     the imported notes use keys packing, so 'Bass, Baby.' must become
 *     'Keys — Bass, Baby.' (a bare bass-name would render the packing as
 *     fretted lanes — garbage);
 *   - the placeholder seed is removed ONLY when it is provably untouched
 *     (flagged index, seeded name, zero notes/chords, not the last part).
 *
 * Fails on main (the pures don't exist there).
 * Run: node tests/midi_create.test.mjs
 */
import assert from 'node:assert';

globalThis.document = globalThis.document || {
    getElementById: () => null, addEventListener: () => {}, activeElement: null,
};
globalThis.localStorage = globalThis.localStorage || { getItem: () => null, setItem: () => {} };
globalThis.window = globalThis.window || globalThis;

const { _midiDefaultTitlePure } = await import('../src/create.js');
const { _midiKeysArrNamePure, _midiSeedRemovablePure } = await import('../src/import.js');
const { KEYS_PATTERN } = await import('../src/keys.js');

let pass = 0, fail = 0;
function t(name, fn) {
    try { fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}

t('the default title reads from the filename and is never empty', () => {
    assert.strictEqual(_midiDefaultTitlePure('dkcjungle-2.mid'), 'dkcjungle 2');
    assert.strictEqual(_midiDefaultTitlePure('My_Song.midi'), 'My Song');
    assert.strictEqual(_midiDefaultTitlePure(''), 'MIDI import');
    assert.strictEqual(_midiDefaultTitlePure('.mid'), 'MIDI import');
});

t('unpacked track names are keys-safe — the kind stays keys whatever the track was called', () => {
    for (const raw of ['Bass, Baby.', 'Normal Tune', 'DRUMS!!', 'guitar solo', '']) {
        const name = _midiKeysArrNamePure(raw, 7);
        assert.ok(KEYS_PATTERN.test(name), `${JSON.stringify(name)} must read as keys`);
        if (raw) assert.ok(name.includes(raw), 'the source track stays identifiable');
    }
    assert.strictEqual(_midiKeysArrNamePure('', 7), 'Keys — Track 7', 'unnamed tracks fall back honestly');
});

t('the seed placeholder is removed ONLY when provably untouched', () => {
    const seed = { name: 'Lead', notes: [], chords: [] };
    assert.strictEqual(_midiSeedRemovablePure(seed, 0, 0, 2), true);
    assert.strictEqual(_midiSeedRemovablePure(seed, 0, 0, 1), false, 'never the last part');
    assert.strictEqual(_midiSeedRemovablePure({ ...seed, notes: [{}] }, 0, 0, 2), false, 'user work stays');
    assert.strictEqual(_midiSeedRemovablePure({ ...seed, name: 'Lead 2' }, 0, 0, 2), false, 'renamed = not the seed');
    assert.strictEqual(_midiSeedRemovablePure(seed, 1, 0, 2), false, 'wrong index');
    assert.strictEqual(_midiSeedRemovablePure(seed, 0, undefined, 2), false, 'no flag = no cleanup');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
