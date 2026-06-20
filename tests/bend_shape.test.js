'use strict';
/*
 * Tests for the §6.2.1 bend-shape authoring helpers in screen.js. screen.js is
 * a single browser IIFE, so this extracts the `@pure:bend-shape` marked block
 * (browser-free) and eval's it in isolation — real source, no drift.
 *
 * Run: node tests/bend_shape.test.js
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const src = fs.readFileSync(path.join(__dirname, '..', 'screen.js'), 'utf8');
const m = src.match(/\/\* @pure:bend-shape:start[\s\S]*?@pure:bend-shape:end \*\//);
if (!m) {
    console.error('FAIL: @pure:bend-shape block not found in screen.js');
    process.exit(1);
}
const { bendPresetCurve, sanitizeBendCurve, BEND_INTENTS } = new Function(
    '"use strict";' + m[0] +
    '\nreturn { bendPresetCurve, sanitizeBendCurve, BEND_INTENTS };'
)();

let pass = 0, fail = 0;
function t(name, fn) {
    try { fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}

// ── BEND_INTENTS ─────────────────────────────────────────────────────────────
t('BEND_INTENTS covers the five spec intents 0..4', () => {
    assert.deepStrictEqual(BEND_INTENTS.map(o => o.v), [0, 1, 2, 3, 4]);
});

// ── bendPresetCurve ──────────────────────────────────────────────────────────
t('up preset rises 0 -> peak over the sustain', () => {
    assert.deepStrictEqual(bendPresetCurve(0, 2, 1.0),
        [{ t: 0, v: 0 }, { t: 1, v: 2 }]);
});
t('round-trip preset goes up then back to 0', () => {
    assert.deepStrictEqual(bendPresetCurve(4, 2, 1.0),
        [{ t: 0, v: 0 }, { t: 0.5, v: 2 }, { t: 1, v: 0 }]);
});
t('pre-bend preset starts and stays at peak', () => {
    assert.deepStrictEqual(bendPresetCurve(2, 1.5, 0.8),
        [{ t: 0, v: 1.5 }, { t: 0.8, v: 1.5 }]);
});
t('release preset starts high and lets down', () => {
    assert.deepStrictEqual(bendPresetCurve(1, 2, 1.0),
        [{ t: 0, v: 2 }, { t: 1, v: 0 }]);
});
t('falls back to a 1s window when sustain is 0', () => {
    assert.deepStrictEqual(bendPresetCurve(0, 1, 0),
        [{ t: 0, v: 0 }, { t: 1, v: 1 }]);
});

// ── sanitizeBendCurve ────────────────────────────────────────────────────────
t('drops bad entries and sorts by t (no magnitude clamp)', () => {
    const out = sanitizeBendCurve([
        { t: 0.5, v: 2 },
        { t: 0.0, v: 0 },
        { t: 'x', v: 1 },        // non-numeric t -> dropped
        { t: 0.25, v: NaN },     // non-finite v -> dropped
        'garbage',               // non-object -> dropped
    ]);
    assert.deepStrictEqual(out, [{ t: 0, v: 0 }, { t: 0.5, v: 2 }]);
});
t('rounds t to 3 and v to 1 decimals', () => {
    assert.deepStrictEqual(sanitizeBendCurve([{ t: 0.123456, v: 1.74 }]),
        [{ t: 0.123, v: 1.7 }]);
});
t('empty / non-list / all-invalid -> null (never [])', () => {
    assert.strictEqual(sanitizeBendCurve([]), null);
    assert.strictEqual(sanitizeBendCurve(null), null);
    assert.strictEqual(sanitizeBendCurve('nope'), null);
    assert.strictEqual(sanitizeBendCurve([{ t: 'a', v: 'b' }, 42]), null);
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
