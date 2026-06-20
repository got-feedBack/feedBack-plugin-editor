'use strict';
/*
 * E0 regression test for the chord-template re-link logic in screen.js.
 *
 * screen.js is a single browser IIFE (no module exports), so this test
 * extracts the `@pure:chord-relink` marked block — which is self-contained and
 * browser-free — and eval's it in isolation. Tests the real source, no drift.
 *
 * Run: node tests/chord_relink.test.js
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const src = fs.readFileSync(path.join(__dirname, '..', 'screen.js'), 'utf8');
const m = src.match(/\/\* @pure:chord-relink:start[\s\S]*?@pure:chord-relink:end \*\//);
if (!m) {
    console.error('FAIL: @pure:chord-relink block not found in screen.js');
    process.exit(1);
}
const api = new Function(
    '"use strict";' + m[0] +
    '\nreturn { relinkChordTemplate, _fretKeyForL, _normFingers, _buildPreservedTemplates };'
)();
const { relinkChordTemplate, _normFingers, _buildPreservedTemplates } = api;

let pass = 0, fail = 0;
function t(name, fn) {
    try { fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}

// 1. The headline bug: a named, fingered chord survives the rebuild.
t('preserves name + fingers on a matching fret pattern (Em7)', () => {
    const L = 6;
    const preserved = _buildPreservedTemplates([
        { name: 'Em7', displayName: 'Em7', arp: false,
          frets: [0, 2, 2, 0, 0, 0], fingers: [-1, 2, 1, -1, -1, -1] },
    ], L);
    const out = relinkChordTemplate([0, 2, 2, 0, 0, 0], preserved, L);
    assert.strictEqual(out.name, 'Em7');
    assert.deepStrictEqual(out.fingers, [-1, 2, 1, -1, -1, -1]);
    assert.deepStrictEqual(out.frets, [0, 2, 2, 0, 0, 0]);
    // E0 carries only persisted fields (name/fingers); displayName/arp deferred to E1.
    assert.ok(!('displayName' in out) && !('arp' in out));
});

// 2. Unknown fret pattern -> blank (no false metadata).
t('blanks metadata for an unknown fret pattern', () => {
    const L = 6;
    const preserved = _buildPreservedTemplates([
        { name: 'Em7', frets: [0, 2, 2, 0, 0, 0], fingers: [-1, 2, 1, -1, -1, -1] },
    ], L);
    const out = relinkChordTemplate([3, 2, 0, 0, 0, 3], preserved, L);
    assert.strictEqual(out.name, '');
    assert.deepStrictEqual(out.fingers, [-1, -1, -1, -1, -1, -1]);
});

// 3. Width normalization: a width-6 stored template matches a width-7 chart.
t('width-normalizes fret keys across L (6 -> 7)', () => {
    const L = 7;
    const preserved = _buildPreservedTemplates([
        { name: 'Pwr', frets: [3, 5, 5, -1, -1, -1], fingers: [1, 3, 4, -1, -1, -1] },
    ], L);
    const out = relinkChordTemplate([3, 5, 5, -1, -1, -1, -1], preserved, L);
    assert.strictEqual(out.name, 'Pwr');
    assert.deepStrictEqual(out.fingers, [1, 3, 4, -1, -1, -1, -1]);
});

// 4. _normFingers trims an over-wide fingers array.
t('_normFingers trims over-wide input', () => {
    assert.deepStrictEqual(_normFingers([1, 2, 3, 4, 5, 6, 7, 8], 6), [1, 2, 3, 4, 5, 6]);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
