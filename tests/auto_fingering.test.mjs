/*
 * Auto-fingering — propose a fret-hand finger for every fretted note from its
 * fret relative to the hand anchor. All the fret_finger plumbing already existed
 * (the teaching mark, its XML round-trip, the fretboard-strip display) but
 * nothing ever PROPOSED a finger; this fills that gap. Proves:
 *   1. _suggestFingerForFretPure — open→none, one finger per fret in the window,
 *      refuse outside the reachable hand span / with no anchor.
 *   2. _suggestFingersPure — maps notes, omits the refused (leaving their marks).
 *   3. SetTeachingMarksCmd — per-note assignment as one undoable step.
 *
 * Run: node tests/auto_fingering.test.mjs
 */
import assert from 'node:assert';
import { S } from '../src/state.js';
import { EditHistory } from '../src/history.js';
import { _suggestFingerForFretPure, _suggestFingersPure } from '../src/position.js';
import { SetTeachingMarksCmd } from '../src/commands.js';
import { seedState, trackHooks } from './_history_env.mjs';

let pass = 0, fail = 0;
function t(name, fn) {
    try { fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}

// ── 1. _suggestFingerForFretPure ─────────────────────────────────────────────
t('open string → none (-1), regardless of anchor', () => {
    assert.strictEqual(_suggestFingerForFretPure(0, 5), -1);
    assert.strictEqual(_suggestFingerForFretPure(0, null), -1);
});
t('one finger per fret across the hand window (index at the anchor)', () => {
    assert.strictEqual(_suggestFingerForFretPure(5, 5), 1);
    assert.strictEqual(_suggestFingerForFretPure(6, 5), 2);
    assert.strictEqual(_suggestFingerForFretPure(7, 5), 3);
    assert.strictEqual(_suggestFingerForFretPure(8, 5), 4);
});
t('refuse (null) below the anchor and past the 4-fret span', () => {
    assert.strictEqual(_suggestFingerForFretPure(4, 5), null);   // below the anchor
    assert.strictEqual(_suggestFingerForFretPure(9, 5), null);   // off=4, beyond width 4
});
t('refuse with no hand position; clamp a wide window to 4', () => {
    assert.strictEqual(_suggestFingerForFretPure(5, null), null);
    assert.strictEqual(_suggestFingerForFretPure(11, 5, 8), 4);  // off=6 → clamp 4
    assert.strictEqual(_suggestFingerForFretPure(NaN, 5), null);
});

// ── 2. _suggestFingersPure ───────────────────────────────────────────────────
t('_suggestFingersPure fingers what it can and OMITS the refused', () => {
    const out = _suggestFingersPure([
        { idx: 0, fret: 5, anchorFret: 5, width: 4 },   // → 1
        { idx: 1, fret: 0, anchorFret: 5, width: 4 },   // open → -1
        { idx: 2, fret: 20, anchorFret: 5, width: 4 },  // out of hand → omitted
        { idx: 3, fret: 7, anchorFret: 5, width: 4 },   // → 3
    ]);
    assert.deepStrictEqual(out, [
        { idx: 0, value: 1 }, { idx: 1, value: -1 }, { idx: 3, value: 3 },
    ], 'idx 2 (unreachable) is left untouched');
});

// ── 3. SetTeachingMarksCmd round-trip ────────────────────────────────────────
function seed() {
    trackHooks();
    seedState({
        arrangements: [{ name: 'Guitar', notes: [
            { string: 0, fret: 5, time: 0, techniques: {} },
            { string: 1, fret: 7, time: 1, techniques: { fret_finger: 2 } },   // has a prior mark
            { string: 2, fret: 0, time: 2, techniques: {} },
        ], chords: [] }],
        currentArr: 0,
        history: new EditHistory(),
    });
}
const fingerOf = i => S.arrangements[0].notes[i].techniques.fret_finger;
t('SetTeachingMarksCmd assigns per-note fingers and round-trips exec→undo→redo', () => {
    seed();
    S.history.exec(new SetTeachingMarksCmd('fret_finger', [
        { idx: 0, value: 1 }, { idx: 1, value: 3 }, { idx: 2, value: -1 },
    ]));
    assert.strictEqual(fingerOf(0), 1);
    assert.strictEqual(fingerOf(1), 3, 'overwrote the prior mark');
    assert.strictEqual(fingerOf(2), -1);

    S.history.doUndo();
    assert.strictEqual(fingerOf(0), undefined, 'undo restored the (unset) prior');
    assert.strictEqual(fingerOf(1), 2, 'undo restored the prior mark exactly');

    S.history.doRedo();
    assert.strictEqual(fingerOf(1), 3, 'redo re-applied');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
