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
import { readFileSync } from 'node:fs';
import { _rollTechBadgesPure, _slideDirPure, _techBadgesPure } from '../src/draw.js';

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
    // …and neither is a non-number: `null >= 0` / `false >= 0` are both TRUE in
    // JS, which would badge a cleared or imported-as-null field as '/null'.
    assert.deepStrictEqual(_techBadgesPure({ slide_to: null, slide_unpitch_to: null }), []);
    assert.deepStrictEqual(_techBadgesPure({ slide_to: false, slide_unpitch_to: '' }), []);
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

t('accent is a badge — it has no overlay in either view, so nothing else shows it', () => {
    assert.deepStrictEqual(_techBadgesPure({ accent: true }), ['>']);
    assert.deepStrictEqual(_rollTechBadgesPure({ accent: true }), ['>']);
});

// ── 3. Badge placement in the roll ───────────────────────────────────────────
// The badge string must stay glued to the note HEAD. drawNotes culls a note by
// its START time, so a long sustain's right edge sits arbitrarily far off the
// right of the canvas — anchoring the badges there hides them on exactly the
// notes the roll draws widest. Runs the REAL _drawPianoNote against a stub ctx
// (same extract-and-inject harness as tests/waveform_render.test.js).
const src = readFileSync(new URL('../src/draw.js', import.meta.url), 'utf8');
function extractFn(name) {
    const start = src.indexOf('function ' + name);
    assert.ok(start >= 0, 'function ' + name + ' must exist');
    const open = src.indexOf('{', start);
    let depth = 0;
    for (let i = open; i < src.length; i++) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}' && --depth === 0) return src.slice(start, i + 1);
    }
    throw new Error('unbalanced braces extracting ' + name);
}

const LABEL_W = 60, MIN_NOTE_W = 18, PIANO_LANE_H = 10, ZOOM = 100;
const calls = { text: [], rect: [] };
const ctx = {
    fillStyle: '', strokeStyle: '', lineWidth: 1, font: '', textAlign: '', textBaseline: '',
    fillText: (s, x, y) => calls.text.push({ s, x, y, align: ctx.textAlign }),
    fillRect: (x, y, w, h) => calls.rect.push({ x, y, w, h, style: ctx.fillStyle }),
    beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, fill() {}, arc() {},
    roundRect() {}, setLineDash() {},
};
const drawPianoNote = new Function(
    'ctx', 'S', 'MIN_NOTE_W', 'PIANO_LANE_H', 'pianoRange', 'timeToX', 'midiToY',
    'noteToMidi', 'midiToNote', 'editorKeyNoteNames', 'colorForLane', 'strToLane',
    'PIANO_OCTAVE_COLORS', '_isSuggested', '_pcInScalePure', '_slideDirPure',
    '_rollTechBadgesPure',
    '"use strict";' + extractFn('_drawPianoNote') + '\nreturn _drawPianoNote;'
)(
    ctx, { zoom: ZOOM, scrollX: 0 }, MIN_NOTE_W, PIANO_LANE_H, { lo: 36, hi: 96 },
    (t2) => LABEL_W + t2 * ZOOM, (m) => (96 - m) * PIANO_LANE_H,
    (s2, f) => s2 * 24 + f, () => 'C4', () => null, () => '#3b82f6', (s2) => s2,
    ['#3b82f6'], () => false, () => true, _slideDirPure, _rollTechBadgesPure,
);
const badgeCall = () => calls.text.find(c => c.s.includes('PM'));

t('badges on a LONG sustain stay at the note head, not off at its right edge', () => {
    calls.text = [];
    // 30 s sustain at 100 px/s → the note box ends ~3000 px right of the head:
    // way past any canvas. The note is still drawn (culled by START), so its
    // badges must be too.
    const n = { time: 0, sustain: 30, string: 0, fret: 5, techniques: { palm_mute: true } };
    drawPianoNote(n, false, null, 60, true, false);
    const b = badgeCall();
    assert.ok(b, 'the badge string is drawn');
    const head = LABEL_W;                       // timeToX(0)
    assert.ok(b.x - head < MIN_NOTE_W * 2,
        `badge anchored to the head, got x=${b.x} (head=${head})`);
    assert.strictEqual(b.align, 'left');
});

t('badges clear the centred note label, and sit at the left edge when there is none', () => {
    calls.text = [];
    const head = LABEL_W;
    // Labelled note (sw >= 20): badges start past the label's 24px chip.
    drawPianoNote({ time: 0, sustain: 1, string: 0, fret: 5, techniques: { palm_mute: true } },
        false, null, 60, true, false);
    assert.strictEqual(badgeCall().x, head + 26);
    // Unlabelled note (sw = MIN_NOTE_W = 18 < 20): badges start at the left edge.
    calls.text = [];
    drawPianoNote({ time: 0, sustain: 0, string: 0, fret: 5, techniques: { palm_mute: true } },
        false, null, 60, true, false);
    assert.strictEqual(badgeCall().x, head + 2);
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
