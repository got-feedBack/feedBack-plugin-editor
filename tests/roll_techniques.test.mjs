/*
 * Techniques in the Piano-roll view (gap-audit #2). `_drawPianoNote` drew ZERO
 * technique indication — bends, slides, mutes, hammer-ons and the rest were all
 * invisible once you switched String view → roll, a real notation gap. The roll
 * now shows them, but its 4–14px lanes can't carry String view's tall graphical
 * overlays, so the vocabulary is a compact badge string (shared with String view
 * so the two agree) plus a couple of roll-only glyphs for the techniques that a
 * thin lane can't draw as graphics. The badge builders are pure, so the mapping
 * is testable without a canvas:
 *   1. _techBadgesPure — the shared badge list (String view + roll).
 *   2. _rollTechBadgesPure — the shared list + compact bend / vibrato glyphs.
 *
 * Run: node --test tests/roll_techniques.test.mjs
 */
import assert from 'node:assert';
import { _techBadgesPure, _rollTechBadgesPure } from '../src/draw.js';

let pass = 0, fail = 0;
function t(name, fn) {
    try { fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}

// ── 1. _techBadgesPure (the shared list) ─────────────────────────────────────
t('empty / missing techniques → no badges', () => {
    assert.deepStrictEqual(_techBadgesPure({}), []);
    assert.deepStrictEqual(_techBadgesPure(null), []);
    assert.deepStrictEqual(_techBadgesPure(undefined), []);
});

t('boolean techniques map to their letters, in a stable order', () => {
    assert.deepStrictEqual(
        _techBadgesPure({ hammer_on: true, pull_off: true, palm_mute: true }),
        ['H', 'P', 'PM']);
    assert.deepStrictEqual(
        _techBadgesPure({ tap: true, slap: true, pluck: true, tremolo: true, mute: true, ignore: true }),
        ['T', 'S', 'P!', '~', 'x', 'I']);
    assert.deepStrictEqual(
        _techBadgesPure({ harmonic: true, harmonic_pinch: true, fret_hand_mute: true }),
        ['*', '*P', 'FM']);
});

t('slide targets badge with their destination fret; 0 is a real target', () => {
    assert.deepStrictEqual(_techBadgesPure({ slide_to: 7 }), ['/7']);
    assert.deepStrictEqual(_techBadgesPure({ slide_to: 0 }), ['/0']); // >= 0, not falsy
    assert.deepStrictEqual(_techBadgesPure({ slide_unpitch_to: 3 }), ['↓3']);
    // A negative sentinel is "no slide" — no badge.
    assert.deepStrictEqual(_techBadgesPure({ slide_to: -1, slide_unpitch_to: -1 }), []);
});

t('bend / vibrato / tie are NOT in the shared list (graphical in String view)', () => {
    assert.deepStrictEqual(_techBadgesPure({ bend: 2 }), []);
    assert.deepStrictEqual(_techBadgesPure({ vibrato: true }), []);
    assert.deepStrictEqual(_techBadgesPure({ link_next: true }), []);
});

// ── 2. _rollTechBadgesPure (roll = shared + bend/vibrato glyphs) ──────────────
t('roll adds a bend glyph carrying the semitone amount', () => {
    assert.deepStrictEqual(_rollTechBadgesPure({ bend: 2 }), ['b2']);
    assert.deepStrictEqual(_rollTechBadgesPure({ bend: 0 }), []);   // no bend
    assert.deepStrictEqual(_rollTechBadgesPure({}), []);
});

t('roll adds a vibrato glyph', () => {
    assert.deepStrictEqual(_rollTechBadgesPure({ vibrato: true }), ['v']);
});

t('roll extends — never replaces — the shared badges, glyphs first', () => {
    assert.deepStrictEqual(
        _rollTechBadgesPure({ bend: 1, vibrato: true, hammer_on: true, palm_mute: true }),
        ['b1', 'v', 'H', 'PM']);
    // Slide still comes through the shared list (it also draws as a diagonal).
    assert.deepStrictEqual(_rollTechBadgesPure({ slide_to: 5 }), ['/5']);
});

t('roll leaves the tie (link_next) to the graphical hook — no badge', () => {
    assert.deepStrictEqual(_rollTechBadgesPure({ link_next: true }), []);
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
