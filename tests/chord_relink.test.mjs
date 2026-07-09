/*
 * E0 regression test for the chord-template re-link logic in src/chords.js.
 *
 * Drives the real exports of src/chords.js — the chord-template re-link helpers
 * are pure (no DOM, no S), so they import directly. No source-text slicing.
 *
 * Run: node tests/chord_relink.test.mjs
 */
import assert from 'node:assert';
import {
    _buildPreservedTemplates, _groupFn, _mergeChordFn, _normChordFn,
    _normFingers, _parseGuideTones, _sanitizeCaged, _sanitizeGuideTones,
    buildHandshapeChordIdMap, dropOrphanedHandshapes, relinkChordTemplate,
    remapHandshapeChordIds,
} from '../src/chords.js';

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

// ════════════════════════════════════════════════════════════════════
// dropOrphanedHandshapes: a deleted chord must not leave its handshape
// behind (which would also resurrect the deleted chord's template via the
// map builder's preserve-append) — the "removed power chord still there
// after saving" bug.
// ════════════════════════════════════════════════════════════════════

// 8b. The headline bug: chord deleted -> its chord-shape handshape drops.
t('drops a chord-shape handshape whose chord was deleted', () => {
    const handshapes = [
        { chord_id: 0, start_time: 4.0, end_time: 4.6, arp: false }, // chord deleted
        { chord_id: 0, start_time: 6.0, end_time: 6.6, arp: false }, // chord kept
    ];
    const chords = [{ time: 6.0 }];
    const notes = [{ time: 4.0 }]; // leftover single note doesn't keep a chord shape
    const out = dropOrphanedHandshapes(handshapes, chords, notes);
    assert.strictEqual(out.length, 1);
    assert.strictEqual(out[0], handshapes[1]); // same object, identity preserved
});

// 8c. Boundary times count as inside the span (float-drift epsilon).
t('keeps a handshape whose chord sits exactly on the span boundary', () => {
    const handshapes = [{ chord_id: 0, start_time: 4.0, end_time: 4.6, arp: false }];
    assert.strictEqual(
        dropOrphanedHandshapes(handshapes, [{ time: 4.0 }], []).length, 1);
    assert.strictEqual(
        dropOrphanedHandshapes(handshapes, [{ time: 4.6 }], []).length, 1);
    assert.strictEqual(
        dropOrphanedHandshapes(handshapes, [{ time: 4.7 }], []).length, 0);
});

// 8d. Arpeggio handshapes frame single notes: notes keep them alive, and
// deleting every note under one drops it too.
t('arp handshape: kept by notes in span, dropped when span is empty', () => {
    const hs = [{ chord_id: 0, start_time: 1.0, end_time: 2.0, arp: true }];
    assert.strictEqual(dropOrphanedHandshapes(hs, [], [{ time: 1.5 }]).length, 1);
    assert.strictEqual(dropOrphanedHandshapes(hs, [{ time: 1.2 }], []).length, 1);
    assert.strictEqual(dropOrphanedHandshapes(hs, [], [{ time: 3.0 }]).length, 0);
});

// 8e. Defensive: nullish / malformed inputs never throw.
t('dropOrphanedHandshapes handles nullish inputs without throwing', () => {
    assert.deepStrictEqual(dropOrphanedHandshapes(null, [], []), []);
    assert.deepStrictEqual(dropOrphanedHandshapes([], null, null), []);
    const hs = [{ chord_id: 0, start_time: 0, end_time: 1, arp: false }, null];
    assert.deepStrictEqual(
        dropOrphanedHandshapes(hs, [null, { time: 'x' }], null), []);
});

// ════════════════════════════════════════════════════════════════════
// §6.6 voicing carry-forward + §6.3.1 fn instance round-trip helpers.
// ════════════════════════════════════════════════════════════════════

// 9. voicing survives the rebuild (carry-forward), or it would blank on save.
t('preserves voicing through the rebuild; defaults to "" when absent', () => {
    const L = 6;
    const preserved = _buildPreservedTemplates([
        { name: 'Am', frets: [-1, 0, 2, 2, 1, 0], fingers: [-1] * 6, voicing: 'open' },
    ], L);
    assert.strictEqual(relinkChordTemplate([-1, 0, 2, 2, 1, 0], preserved, L).voicing, 'open');
    // Unknown fret pattern -> blank voicing, not stale metadata.
    assert.strictEqual(relinkChordTemplate([3, 2, 0, 0, 0, 3], preserved, L).voicing, '');
});

// 9b. caged + guideTones survive the rebuild (carry-forward), sanitized.
t('preserves caged + guideTones through the rebuild; sanitizes + defaults', () => {
    const L = 6;
    const preserved = _buildPreservedTemplates([
        { name: 'G7', frets: [3, 2, 0, 0, 0, 1], fingers: new Array(6).fill(-1),
          caged: 'E', guideTones: [4, 10, 12, -1] },
    ], L);
    const kept = relinkChordTemplate([3, 2, 0, 0, 0, 1], preserved, L);
    assert.strictEqual(kept.caged, 'E');
    assert.deepStrictEqual(kept.guideTones, [4, 10]);   // out-of-range dropped on carry
    // Unknown fret pattern -> defaults, not stale metadata.
    const blank = relinkChordTemplate([-1, 0, 2, 2, 1, 0], preserved, L);
    assert.strictEqual(blank.caged, '');
    assert.deepStrictEqual(blank.guideTones, []);
});

// 9c. the pure sanitizer/parse helpers (shared with the inspector handlers).
t('_sanitizeCaged keeps only the enum letters', () => {
    assert.strictEqual(_sanitizeCaged(' C '), 'C');
    assert.strictEqual(_sanitizeCaged('X'), '');
    assert.strictEqual(_sanitizeCaged('e'), '');   // lower-case rejected
    assert.strictEqual(_sanitizeCaged(7), '');
});

t('_sanitizeGuideTones + _parseGuideTones clamp/filter to 0..11 ints', () => {
    assert.deepStrictEqual(_sanitizeGuideTones([4, 10, 12, -1, 'x', true]), [4, 10]);
    assert.deepStrictEqual(_parseGuideTones('4, 10, 12, x'), [4, 10]);
    assert.deepStrictEqual(_parseGuideTones(' 0 ,11'), [0, 11]);
    assert.deepStrictEqual(_parseGuideTones(''), []);
    assert.deepStrictEqual(_parseGuideTones([3, 5]), [3, 5]);   // array passthrough
    assert.deepStrictEqual(_parseGuideTones(7), []);
});

// 10. _normChordFn keeps only set keys; drops partial deg/strings; null when empty.
t('_normChordFn normalizes + keeps only set keys', () => {
    assert.deepStrictEqual(_normChordFn({ rn: ' V7 ', q: ' 7 ', deg: 7 }),
        { rn: 'V7', q: '7', deg: 7 });
    assert.deepStrictEqual(_normChordFn({ rn: 'ii7' }), { rn: 'ii7' });   // partial allowed
    assert.strictEqual(_normChordFn({ rn: '', q: '  ' }), null);          // all blank -> null
    assert.strictEqual(_normChordFn({ deg: 15 }), null);                  // out of range dropped
    assert.strictEqual(_normChordFn({ deg: true }), null);                // bool rejected
    assert.strictEqual(_normChordFn(null), null);
});

// 11. _mergeChordFn merges a partial patch onto the current fn (authoring path).
t('_mergeChordFn merges patches + clears on blank/invalid', () => {
    assert.deepStrictEqual(_mergeChordFn({ rn: 'ii7', q: 'm7' }, { deg: 2 }),
        { rn: 'ii7', q: 'm7', deg: 2 });
    assert.deepStrictEqual(_mergeChordFn({ rn: 'ii7', q: 'm7', deg: 2 }, { q: '' }),
        { rn: 'ii7', deg: 2 });                                           // blank clears q
    assert.deepStrictEqual(_mergeChordFn({ rn: 'ii7', q: 'm7', deg: 2 }, { deg: null }),
        { rn: 'ii7', q: 'm7' });                                          // null clears deg
    assert.strictEqual(_mergeChordFn(null, { deg: 99 }), null);          // invalid deg, nothing else
});

// 11. _groupFn adopts a chord's fn from its notes by majority, so fn rides the
// instance across moves while a stray dragged-in note can't impose a foreign fn.
const _FN = { rn: 'vi', q: 'm', deg: 9 };
const _FN2 = { rn: 'V7', q: '7', deg: 7 };
t('_groupFn: unanimous chord notes keep their fn (survives a whole-chord move)', () => {
    // Every note of an authored chord carries the same _fn — as after a move,
    // which mutates note.time but not the carried _fn.
    assert.deepStrictEqual(
        _groupFn([{ _fn: _FN }, { _fn: _FN }, { _fn: _FN }]), _FN);
});
t('_groupFn: a single stray fn note is outvoted (no leak into another chord)', () => {
    // Two notes of the destination chord carry _FN; one note dragged in carries
    // a foreign _FN2 — majority wins, the stray fn is dropped.
    assert.deepStrictEqual(_groupFn([{ _fn: _FN }, { _fn: _FN }, { _fn: _FN2 }]), _FN);
    // A lone fn note dragged into a no-fn chord is a minority -> none.
    assert.strictEqual(_groupFn([{ _fn: _FN2 }, {}, {}]), null);
});
t('_groupFn: no majority / empty -> null', () => {
    assert.strictEqual(_groupFn([{ _fn: _FN }, { _fn: _FN2 }]), null);  // 1 vs 1 tie
    assert.strictEqual(_groupFn([{ _fn: _FN }, {}]), null);             // 1 of 2 (not > half)
    assert.strictEqual(_groupFn([]), null);
    assert.strictEqual(_groupFn(null), null);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
