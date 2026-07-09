'use strict';
/*
 * E2 (PR-B) integration test for handshape authoring → save round-trip.
 *
 * src/main.js is a single browser IIFE, so this test pulls the REAL source for
 * the two pieces that actually carry the logic:
 *   1. `_handshapeSpanFrets` — extracted by brace-matching from src/main.js
 *      (it's self-contained: only uses its args + Array/Object/Number), and
 *   2. the `@pure:chord-relink` helpers (eval'd from the marked block).
 * It then replays the authoring path (AddHandshapeCmd._resolve: voicing ->
 * find-or-create template -> chord_id) and the save path (reconstructChords:
 * rebuild templates from same-time chords -> remap handshape chord_ids), and
 * asserts the produced handshapes are backend-valid (chord_id < len(templates),
 * the rule routes.py enforces). No drift: the risky bits run the real source.
 *
 * Run: node tests/handshape_authoring.test.js
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');

// ── pull the @pure:chord-relink helpers (same approach as chord_relink.test) ─
const pm = src.match(/\/\* @pure:chord-relink:start[\s\S]*?@pure:chord-relink:end \*\//);
if (!pm) { console.error('FAIL: @pure:chord-relink block not found'); process.exit(1); }
const pure = new Function(
    '"use strict";' + pm[0] +
    '\nreturn { relinkChordTemplate, _fretKeyForL, _buildPreservedTemplates,' +
    ' buildHandshapeChordIdMap, remapHandshapeChordIds };'
)();
const {
    relinkChordTemplate, _fretKeyForL, _buildPreservedTemplates,
    buildHandshapeChordIdMap, remapHandshapeChordIds,
} = pure;

// ── extract `function _handshapeSpanFrets(...) { ... }` by brace matching ────
function extractFn(name) {
    const start = src.indexOf('function ' + name);
    if (start < 0) throw new Error('function ' + name + ' not found');
    const open = src.indexOf('{', start);
    let depth = 0;
    for (let i = open; i < src.length; i++) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}') { depth--; if (depth === 0) return src.slice(start, i + 1); }
    }
    throw new Error('unbalanced braces for ' + name);
}
const _handshapeSpanFrets = new Function(
    '"use strict";' + extractFn('_handshapeSpanFrets') + '\nreturn _handshapeSpanFrets;'
)();

let pass = 0, fail = 0;
function t(name, fn) {
    try { fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}

// Replays AddHandshapeCmd._resolve: find-or-create the template for the span
// voicing using the real pure helpers, returning the chord_id (tail index).
function authorHandshape(arr, hs, L) {
    const frets = _handshapeSpanFrets(arr, hs.start_time, hs.end_time, L);
    if (!frets) { hs.chord_id = 0; return hs; }
    const key = _fretKeyForL(frets, L);
    let idx = arr.chord_templates.findIndex(
        ct => ct && Array.isArray(ct.frets) && _fretKeyForL(ct.frets, L) === key);
    if (idx < 0) {
        const preserved = _buildPreservedTemplates(arr.chord_templates, L);
        arr.chord_templates.push(relinkChordTemplate(frets, preserved, L)); // tail-append
        idx = arr.chord_templates.length - 1;
    }
    hs.chord_id = idx;
    return hs;
}

// Replays reconstructChords(): rebuild templates from same-time chords, then
// remap handshape chord_ids via the real pure helpers. Returns the rebuilt
// chord_templates + remapped handshapes (what the save body ships).
function reconstructAndRemap(arr, L) {
    const oldTemplates = arr.chord_templates;
    const byTime = {};
    for (const n of arr.notes) {
        const k = n.time.toFixed(4);
        (byTime[k] || (byTime[k] = [])).push(n);
    }
    const chordTemplates = [];
    const templateMap = {};
    const preserved = _buildPreservedTemplates(oldTemplates, L);
    for (const k of Object.keys(byTime).sort((a, b) => parseFloat(a) - parseFloat(b))) {
        const g = byTime[k];
        if (g.length < 2) continue;
        const frets = new Array(L).fill(-1);
        for (const n of g) if (n.string >= 0 && n.string < L) frets[n.string] = n.fret;
        const fk = frets.join(',');
        if (!(fk in templateMap)) {
            templateMap[fk] = chordTemplates.length;
            chordTemplates.push(relinkChordTemplate(frets, preserved, L));
        }
    }
    let handshapes = arr.handshapes;
    if (Array.isArray(handshapes) && handshapes.length) {
        const oldToNew = buildHandshapeChordIdMap(handshapes, oldTemplates, templateMap, chordTemplates, L);
        handshapes = remapHandshapeChordIds(handshapes, oldToNew);
    }
    return { chordTemplates, handshapes };
}

// ════════════════════════════════════════════════════════════════════

// 1. _handshapeSpanFrets: a same-time chord in the span yields its voicing.
t('_handshapeSpanFrets resolves a held chord voicing', () => {
    const L = 6;
    const arr = { notes: [
        { time: 1.0, string: 1, fret: 0 },
        { time: 1.0, string: 2, fret: 2 },
        { time: 0.5, string: 0, fret: 5 }, // outside span
    ] };
    assert.deepStrictEqual(_handshapeSpanFrets(arr, 0.9, 1.1, L), [-1, 0, 2, -1, -1, -1]);
});

// 2. _handshapeSpanFrets: single notes across the span combine into one shape.
t('_handshapeSpanFrets combines an arpeggio of single notes', () => {
    const L = 6;
    const arr = { notes: [
        { time: 2.0, string: 0, fret: 3 },
        { time: 2.1, string: 1, fret: 5 },
        { time: 2.2, string: 2, fret: 5 },
    ] };
    assert.deepStrictEqual(_handshapeSpanFrets(arr, 1.9, 2.4, L), [3, 5, 5, -1, -1, -1]);
});

// 3. Empty span -> null (caller blocks creation / falls back).
t('_handshapeSpanFrets returns null for an empty span', () => {
    assert.strictEqual(_handshapeSpanFrets({ notes: [] }, 0, 1, 6), null);
});

// 4. Full authoring → save round-trip: a held-shape handshape and an arpeggio
// handshape both persist with backend-valid chord_ids; the arp's synthesized
// template survives via the orphan-append.
t('authoring → reconstruct keeps both handshapes backend-valid', () => {
    const L = 6;
    const arr = {
        notes: [
            // held chord at t=1.0
            { time: 1.0, string: 1, fret: 0 },
            { time: 1.0, string: 2, fret: 2 },
            // arpeggio (single notes) around t=2.x
            { time: 2.0, string: 0, fret: 3 },
            { time: 2.1, string: 1, fret: 5 },
            { time: 2.2, string: 2, fret: 5 },
        ],
        // Loaded templates: the held voicing + an unrelated one.
        chord_templates: [
            { name: 'Em', displayName: 'Em', arp: false, frets: [-1, 0, 2, -1, -1, -1], fingers: [-1, -1, 1, -1, -1, -1] },
            { name: 'X',  displayName: 'X',  arp: false, frets: [3, 3, 3, 3, 3, 3], fingers: [-1, -1, -1, -1, -1, -1] },
        ],
        handshapes: [],
    };
    // Author a held-shape region over the chord, and an arp region over the
    // run. authorHandshape resolves chord_id (find-or-create template) and the
    // explicit push mirrors AddHandshapeCmd.exec.
    const h1 = authorHandshape(arr, { start_time: 0.9, end_time: 1.1, arp: false }, L);
    const h2 = authorHandshape(arr, { start_time: 1.9, end_time: 2.4, arp: true }, L);
    arr.handshapes.push(h1, h2);

    // The arp voicing had no loaded template -> one was appended at authoring.
    assert.ok(arr.chord_templates.length >= 3, 'arp template appended at authoring');
    assert.ok(h1.chord_id < arr.chord_templates.length);
    assert.ok(h2.chord_id < arr.chord_templates.length);

    // Save: rebuild templates + remap chord_ids.
    const { chordTemplates, handshapes } = reconstructAndRemap(arr, L);
    assert.strictEqual(handshapes.length, 2, 'both handshapes survive save');
    for (const h of handshapes) {
        assert.ok(Number.isInteger(h.chord_id) && h.chord_id >= 0
            && h.chord_id < chordTemplates.length,
            `chord_id ${h.chord_id} must be a valid index into ${chordTemplates.length} templates`);
    }
    // Held handshape -> the rebuilt chord template (held voicing).
    const held = handshapes.find(h => !h.arp);
    assert.deepStrictEqual(chordTemplates[held.chord_id].frets, [-1, 0, 2, -1, -1, -1]);
    // Arp handshape -> the appended (orphan) template carrying its voicing.
    const arp = handshapes.find(h => h.arp);
    assert.deepStrictEqual(chordTemplates[arp.chord_id].frets, [3, 5, 5, -1, -1, -1]);
    assert.strictEqual(arp.arp, true);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
