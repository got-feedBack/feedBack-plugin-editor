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
    '\nreturn { relinkChordTemplate, _fretKeyForL, _normFingers, _buildPreservedTemplates,' +
    ' buildHandshapeChordIdMap, remapHandshapeChordIds };'
)();
const {
    relinkChordTemplate, _normFingers, _buildPreservedTemplates,
    buildHandshapeChordIdMap, remapHandshapeChordIds,
} = api;

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
    // E1 carries displayName + arp through the rebuild too (now that the
    // inspector authors them and routes.py persists them).
    assert.strictEqual(out.displayName, 'Em7');
    assert.strictEqual(out.arp, false);
});

// 1b. E1: an authored displayName + arp=true survive the rebuild.
t('preserves displayName + arp on a matching fret pattern', () => {
    const L = 6;
    const preserved = _buildPreservedTemplates([
        { name: 'Em7', displayName: 'Em7 (fingerpicked)', arp: true,
          frets: [0, 2, 2, 0, 0, 0], fingers: [-1, 2, 1, -1, -1, -1] },
    ], L);
    const out = relinkChordTemplate([0, 2, 2, 0, 0, 0], preserved, L);
    assert.strictEqual(out.name, 'Em7');
    assert.strictEqual(out.displayName, 'Em7 (fingerpicked)');
    assert.strictEqual(out.arp, true);
});

// 1c. E1: displayName falls back to name when absent; arp defaults to false.
t('displayName falls back to name; arp defaults false', () => {
    const L = 6;
    const preserved = _buildPreservedTemplates([
        { name: 'Am', frets: [-1, 0, 2, 2, 1, 0], fingers: [-1, -1, 2, 3, 1, -1] },
    ], L);
    const out = relinkChordTemplate([-1, 0, 2, 2, 1, 0], preserved, L);
    assert.strictEqual(out.displayName, 'Am');
    assert.strictEqual(out.arp, false);
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
    assert.strictEqual(out.displayName, '');
    assert.strictEqual(out.arp, false);
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

// ════════════════════════════════════════════════════════════════════
// E2: handshape chord_id remap (old template index -> rebuilt index).
// Mirrors reconstructChords(): `templateMap` (new fret-key -> new index) and
// `chordTemplates` (the rebuilt list) are the rebuild outputs.
// ════════════════════════════════════════════════════════════════════

// 5. Name-matched remap: a handshape's chord_id follows its template to the
// new index when the rebuild reordered the templates.
t('remaps handshape chord_id by fret pattern (reordered rebuild)', () => {
    const L = 6;
    const oldTemplates = [
        { name: 'Em7', frets: [0, 2, 2, 0, 0, 0], fingers: [-1, 2, 1, -1, -1, -1] },
        { name: 'D',   frets: [-1, -1, 0, 2, 3, 2], fingers: [-1, -1, -1, 1, 3, 2] },
    ];
    // Rebuild emitted D at index 0 and Em7 at index 1.
    const chordTemplates = [
        { name: 'D',   frets: [-1, -1, 0, 2, 3, 2] },
        { name: 'Em7', frets: [0, 2, 2, 0, 0, 0] },
    ];
    const templateMap = { '-1,-1,0,2,3,2': 0, '0,2,2,0,0,0': 1 };
    const handshapes = [{ chord_id: 0, start_time: 1, end_time: 2, arp: false }];
    const oldToNew = buildHandshapeChordIdMap(handshapes, oldTemplates, templateMap, chordTemplates, L);
    assert.deepStrictEqual(oldToNew, { 0: 1 });
    const out = remapHandshapeChordIds(handshapes, oldToNew);
    assert.strictEqual(out.length, 1);
    assert.strictEqual(out[0].chord_id, 1);
    assert.strictEqual(out[0].arp, false);
    assert.strictEqual(out[0].start_time, 1);
    // No orphan appended — both voicings were in the rebuild.
    assert.strictEqual(chordTemplates.length, 2);
    // Identity preserved + mutated in place (so undo/redo refs survive save).
    assert.strictEqual(out[0], handshapes[0]);
    assert.strictEqual(handshapes[0].chord_id, 1);
});

// 6. Arpeggio orphan: a handshape's template produced no same-time chord (so
// it's absent from the rebuild) — its preserved template is appended and the
// handshape is kept, remapped to the appended index. Two handshapes sharing
// the orphan voicing append exactly one template.
t('appends orphan template for arpeggio handshape; dedupes shared voicing', () => {
    const L = 6;
    const oldTemplates = [
        { name: 'Am', displayName: 'Am', arp: true,
          frets: [-1, 0, 2, 2, 1, 0], fingers: [-1, -1, 2, 3, 1, -1] },
    ];
    // Rebuild produced an unrelated chord; the Am voicing isn't present.
    const chordTemplates = [{ name: 'C', frets: [-1, 3, 2, 0, 1, 0] }];
    const templateMap = { '-1,3,2,0,1,0': 0 };
    const handshapes = [
        { chord_id: 0, start_time: 1, end_time: 2, arp: true },
        { chord_id: 0, start_time: 3, end_time: 4, arp: true },
    ];
    const oldToNew = buildHandshapeChordIdMap(handshapes, oldTemplates, templateMap, chordTemplates, L);
    assert.deepStrictEqual(oldToNew, { 0: 1 });
    // Exactly one template appended (deduped), carrying authored metadata.
    assert.strictEqual(chordTemplates.length, 2);
    assert.strictEqual(chordTemplates[1].name, 'Am');
    assert.strictEqual(chordTemplates[1].displayName, 'Am');
    assert.strictEqual(chordTemplates[1].arp, true);
    assert.deepStrictEqual(chordTemplates[1].frets, [-1, 0, 2, 2, 1, 0]);
    const out = remapHandshapeChordIds(handshapes, oldToNew);
    assert.strictEqual(out.length, 2);
    assert.strictEqual(out[0].chord_id, 1);
    assert.strictEqual(out[1].chord_id, 1);
});

// 7. Invalid references dropped: out-of-range chord_id, and an old template
// with no frets, both yield no mapping -> the handshape is dropped.
t('drops handshapes with invalid / unmappable chord_id', () => {
    const L = 6;
    const oldTemplates = [
        { name: 'Em7', frets: [0, 2, 2, 0, 0, 0] },
        { name: 'broken' }, // no frets -> unmappable
    ];
    const chordTemplates = [{ name: 'Em7', frets: [0, 2, 2, 0, 0, 0] }];
    const templateMap = { '0,2,2,0,0,0': 0 };
    const handshapes = [
        { chord_id: 0, start_time: 0, end_time: 1, arp: true },  // valid
        { chord_id: 5, start_time: 1, end_time: 2, arp: true },  // out of range
        { chord_id: 1, start_time: 2, end_time: 3, arp: true },  // template has no frets
    ];
    const oldToNew = buildHandshapeChordIdMap(handshapes, oldTemplates, templateMap, chordTemplates, L);
    assert.deepStrictEqual(oldToNew, { 0: 0 });
    const out = remapHandshapeChordIds(handshapes, oldToNew);
    assert.strictEqual(out.length, 1);
    assert.strictEqual(out[0].chord_id, 0);
    assert.strictEqual(out[0].start_time, 0);
    assert.strictEqual(chordTemplates.length, 1); // nothing appended
});

// 8. Defensive: empty / nullish inputs never throw.
t('handles empty + nullish inputs without throwing', () => {
    assert.deepStrictEqual(buildHandshapeChordIdMap([], [], {}, [], 6), {});
    assert.deepStrictEqual(buildHandshapeChordIdMap(null, null, null, null, 6), {});
    assert.deepStrictEqual(remapHandshapeChordIds([], {}), []);
    assert.deepStrictEqual(remapHandshapeChordIds(null, {}), []);
    assert.deepStrictEqual(remapHandshapeChordIds([{ chord_id: 0 }], null), []);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
