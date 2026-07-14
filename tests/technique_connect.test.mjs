/*
 * Slides and ties CONNECT to their target note (#238 follow-up). The
 * technique overlays drew a fixed-size glyph inside the note; now a pitched
 * slide's diagonal reaches the next same-string note when that note is the
 * slide's actual landing (fret === slide_to), and a tie's legato arc spans to
 * the linked note's head. Both fall back to the old within-note glyphs when
 * no target is charted — never a line to a note the gesture doesn't reach.
 *
 * Pinned here: the next-on-same-string map (one reverse pass, object-keyed
 * for the draw loop), and the slide-connection rule. Fails on main (the
 * pures don't exist there).
 *
 * Run: node tests/technique_connect.test.mjs
 */
import assert from 'node:assert';

globalThis.document = globalThis.document || {
    getElementById: () => null, addEventListener: () => {}, activeElement: null,
};
globalThis.localStorage = globalThis.localStorage || { getItem: () => null, setItem: () => {} };
globalThis.window = globalThis.window || globalThis;

const { _nextSameStringMapPure, _slideConnectsPure } = await import('../src/draw.js');

let pass = 0, fail = 0;
function t(name, fn) {
    try { fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}

const N = (time, string, fret) => ({ time, string, fret, sustain: 0, techniques: {} });

t('the map links each note to the NEXT note on its own string, skipping other strings', () => {
    const a = N(0, 2, 5), b = N(1, 3, 7), c = N(2, 2, 7), d = N(3, 2, 9);
    const map = _nextSameStringMapPure([a, b, c, d]);
    assert.strictEqual(map.get(a), c, 'a → c (b is on another string)');
    assert.strictEqual(map.get(c), d);
    assert.strictEqual(map.get(d), undefined, 'the last note on a string has no target');
    assert.strictEqual(map.get(b), undefined);
    assert.strictEqual(_nextSameStringMapPure([]).size, 0);
});

t('a slide connects only when the next note IS its landing fret', () => {
    const landing = N(2, 2, 7);
    assert.strictEqual(_slideConnectsPure({ slide_to: 7 }, landing), true);
    assert.strictEqual(_slideConnectsPure({ slide_to: 9 }, landing), false,
        'next note is not where the slide lands — keep the glyph');
    assert.strictEqual(_slideConnectsPure({ slide_to: 7 }, undefined), false, 'no next note');
    assert.strictEqual(_slideConnectsPure({}, landing), false, 'no slide at all');
    assert.strictEqual(_slideConnectsPure(null, landing), false);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
