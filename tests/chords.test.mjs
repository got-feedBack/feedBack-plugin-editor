/*
 * Tests for the chord load/save round-trip (src/chords.js), driven against the
 * real `S` and the real `lanes()`.
 *
 * The template-dedupe case is a regression guard for a latent bug found while
 * extracting this module (Copilot, PR #151): `reconstructChords` keyed its local
 * template-dedupe map with a raw `frets.join(',')`, while `relinkChordTemplate`
 * looks the preserved templates up — and `buildHandshapeChordIdMap` re-keys the
 * rebuilt ones — via `_fretKeyForL`, which normalizes every non-finite slot to
 * -1. So two chords differing only by `NaN` vs `undefined` in one slot minted two
 * templates that both relinked to the same preserved entry. On valid charts the
 * two keys are identical, which is why nothing had caught it.
 *
 * Run: node tests/chords.test.mjs
 */
import assert from 'node:assert';
import {
    _fretKeyForL, flattenChords, reconstructChords, relinkChordTemplate,
} from '../src/chords.js';
import { LC, lanes } from '../src/lanes.js';
import { S } from '../src/state.js';

let pass = 0, fail = 0;
function t(name, fn) {
    try { fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}

function seed(arr) {
    S.arrangements = [arr];
    S.currentArr = 0;
    S.history = { reset() {} };
    S.handshapeSel = null;
    LC.active = false;   // no draw frame open; lanes() must really compute
}
const note = (time, string, fret) => ({ time, string, fret, sustain: 0, techniques: {} });

// ── the key normalizer the whole module agrees on ────────────────────

t('_fretKeyForL is exactly join(",") when every fret is finite', () => {
    assert.strictEqual(_fretKeyForL([3, 2, 0, -1, -1, -1], 6), [3, 2, 0, -1, -1, -1].join(','));
});

t('_fretKeyForL folds every non-finite slot to -1', () => {
    assert.strictEqual(_fretKeyForL([3, NaN, -1, -1, -1, -1], 6), '3,-1,-1,-1,-1,-1');
    assert.strictEqual(_fretKeyForL([3, undefined, -1, -1, -1, -1], 6), '3,-1,-1,-1,-1,-1');
    assert.strictEqual(_fretKeyForL([3, '2', -1, -1, -1, -1], 6), '3,-1,-1,-1,-1,-1');
});

// ── reconstructChords ────────────────────────────────────────────────

t('same-time notes become one chord; a solo stays a solo', () => {
    seed({ name: 'Lead', chord_templates: [], notes: [
        note(0, 3, 1),                 // solo
        note(1, 0, 3), note(1, 1, 2),  // chord
    ] });
    assert.strictEqual(lanes(), 6);
    reconstructChords();
    const arr = S.arrangements[0];
    assert.strictEqual(arr.notes.length, 1);
    assert.strictEqual(arr.chords.length, 1);
    assert.strictEqual(arr.chord_templates.length, 1);
});

t('identical voicings at different times share ONE template', () => {
    seed({ name: 'Lead', chord_templates: [], notes: [
        note(0, 0, 3), note(0, 1, 2),
        note(1, 0, 3), note(1, 1, 2),
    ] });
    reconstructChords();
    const arr = S.arrangements[0];
    assert.strictEqual(arr.chords.length, 2);
    assert.strictEqual(arr.chord_templates.length, 1, 'deduped by fret pattern');
    assert.strictEqual(arr.chords[0].chord_id, arr.chords[1].chord_id);
});

t('voicings differing only by a non-finite slot dedupe to ONE template', () => {
    // Both normalize to '3,-1,-1,-1,-1,-1'. Keyed by a raw join they would be
    // '3,NaN,-1,...' and '3,,-1,...' — two templates, both relinking to the
    // same preserved entry, and a handshape chord_id remap landing on the first.
    seed({ name: 'Lead', chord_templates: [], notes: [
        note(0, 0, 3), note(0, 1, NaN),
        note(1, 0, 3), note(1, 1, undefined),
    ] });
    reconstructChords();
    const arr = S.arrangements[0];
    assert.strictEqual(arr.chords.length, 2, 'still two chord instances');
    assert.strictEqual(arr.chord_templates.length, 1,
        'one template — a raw join(",") key would have minted two');
    assert.strictEqual(arr.chords[0].chord_id, arr.chords[1].chord_id);
});

// ── flattenChords is the inverse half of the round-trip ──────────────

t('flattenChords folds chord members back into notes, tagged _fromChord', () => {
    seed({
        name: 'Lead', chord_templates: [],
        notes: [note(0, 3, 1)],
        chords: [{ time: 1, chord_id: 0, notes: [note(1, 0, 3), note(1, 1, 2)] }],
    });
    flattenChords();
    const arr = S.arrangements[0];
    assert.strictEqual(arr.chords.length, 0, 'chords are consumed');
    assert.strictEqual(arr.notes.length, 3, 'solo + both members');
    assert.deepStrictEqual(arr.notes.map(n => !!n._fromChord), [false, true, true]);
    assert.ok(arr.notes.every((n, i, a) => i === 0 || a[i - 1].time <= n.time), 'sorted by time');
});

t('flatten → reconstruct is a round-trip for a plain chord chart', () => {
    seed({ name: 'Lead', chord_templates: [], notes: [
        note(0, 0, 3), note(0, 1, 2),
    ] });
    reconstructChords();
    const built = S.arrangements[0];
    assert.strictEqual(built.chords.length, 1);
    flattenChords();
    const flat = S.arrangements[0];
    assert.strictEqual(flat.chords.length, 0);
    assert.strictEqual(flat.notes.length, 2, 'both members come back');
    assert.deepStrictEqual(flat.notes.map(n => n.fret).sort(), [2, 3]);
});

// ── relinkChordTemplate: the stored row is normalized (issue #152) ────

t('the stored frets row is widened to the chart\'s string count', () => {
    // Reachable via buildHandshapeChordIdMap's preserve-append, which hands a
    // template straight off the wire — 6-wide even on a 7/8-string chart.
    const tmpl = relinkChordTemplate([3, 2, 0, -1, -1, -1], {}, 8);
    assert.strictEqual(tmpl.frets.length, 8, 'padded to L, like fingers always was');
    assert.deepStrictEqual(tmpl.frets, [3, 2, 0, -1, -1, -1, -1, -1]);
    assert.strictEqual(tmpl.fingers.length, 8);
});

t('non-finite fret slots are folded to -1 rather than reaching the wire', () => {
    const tmpl = relinkChordTemplate([3, NaN, undefined, '2', -1, -1], {}, 6);
    assert.deepStrictEqual(tmpl.frets, [3, -1, -1, -1, -1, -1]);
    assert.ok(tmpl.frets.every(Number.isFinite), 'no NaN/undefined survives');
});

t('a narrowed row still finds its preserved template', () => {
    // The lookup key and the stored row now come from the same fold, so a
    // 6-wide preserved entry is still found when relinking on an 8-wide chart.
    const key = _fretKeyForL([3, 2, 0, -1, -1, -1], 8);
    const preserved = { [key]: { name: 'C', displayName: 'Cmaj', fingers: [3, 2, 1] } };
    const tmpl = relinkChordTemplate([3, 2, 0, -1, -1, -1], preserved, 8);
    assert.strictEqual(tmpl.name, 'C', 'carried the authored name forward');
    assert.strictEqual(tmpl.displayName, 'Cmaj');
});

// ── relinkChordTemplate: `arp` is wire-coerced (issue #152) ───────────

t('arp: the STRING "false" does not switch arpeggio on', () => {
    const frets = [3, -1, -1, -1, -1, -1];
    const withArp = (v) => relinkChordTemplate(frets, { [_fretKeyForL(frets, 6)]: { arp: v } }, 6).arp;
    assert.strictEqual(withArp('false'), false, 'the whole point: !!"false" was true');
    assert.strictEqual(withArp('0'), false);
    assert.strictEqual(withArp('no'), false);
    assert.strictEqual(withArp(0), false);
});

t('arp: real truthy spellings still switch it on', () => {
    const frets = [3, -1, -1, -1, -1, -1];
    const withArp = (v) => relinkChordTemplate(frets, { [_fretKeyForL(frets, 6)]: { arp: v } }, 6).arp;
    assert.strictEqual(withArp(true), true);
    assert.strictEqual(withArp('true'), true);
    assert.strictEqual(withArp('1'), true);
    assert.strictEqual(withArp(1), true);
});

t('arp: no preserved template → false', () => {
    assert.strictEqual(relinkChordTemplate([3, -1, -1, -1, -1, -1], {}, 6).arp, false);
});

// ── solo notes carry no chord provenance (issue #152) ─────────────────

t('a chord reduced to one note leaves no chord provenance on the survivor', () => {
    seed({ name: 'Lead', chord_templates: [], notes: [],
        chords: [{ time: 1, chord_id: 0, fn: { rn: 'I', q: 'maj', deg: 0 }, notes: [
            note(1, 0, 3), note(1, 1, 2),
        ] }] });
    flattenChords();
    const arr = S.arrangements[0];
    assert.deepStrictEqual(Object.keys(arr.notes[0]).filter(k => k[0] === '_').sort(),
        ['_chordId', '_fn', '_fromChord'], 'flatten tags the members');

    arr.notes.splice(1, 1);   // the user deletes one member; the other is a solo
    reconstructChords();
    const solo = S.arrangements[0].notes[0];
    assert.deepStrictEqual(Object.keys(solo).filter(k => k[0] === '_'), [],
        'no _fn (which _groupFn would later adopt), no _fromChord, no _chordId');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
