/*
 * Chord-click selection behaviour — the profile-derived answer to "does
 * clicking one note of a same-time chord select just that note (DAW-style) or
 * the whole strum (EOF-style)?", the explicit user override on top, and the one
 * grouping decision (profile default → override → Alt inversion → keys-DATA
 * exemption) that mouse.js's resize grab and select grab both read.
 *
 * Fails on main: none of these resolvers exist there.
 * Run: node --test tests/chord_select_behavior.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert';

// shortcuts.js touches document/localStorage at call time only (module load is
// clean), but keep the stubs so an accidental control-sync stays inert.
globalThis.document = globalThis.document || { getElementById: () => null };
globalThis.localStorage = globalThis.localStorage || { getItem: () => null, setItem: () => {}, removeItem: () => {} };
globalThis.window = globalThis.window || globalThis;

const {
    _editorDefaultChordSelectBehaviorPure,
    _editorEffectiveChordSelectBehaviorPure,
    _editorChordGrabsStrumPure,
} = await import('../src/shortcuts.js');

test('default: only Legacy (EOF) treats the strum as the unit', () => {
    assert.strictEqual(_editorDefaultChordSelectBehaviorPure('eof'), 'chord');
    assert.strictEqual(_editorDefaultChordSelectBehaviorPure('feedback'), 'single');
    assert.strictEqual(_editorDefaultChordSelectBehaviorPure('logical'), 'single');
    assert.strictEqual(_editorDefaultChordSelectBehaviorPure('cableton'), 'single');
    // An unknown profile falls to the DAW-safe default, not chord.
    assert.strictEqual(_editorDefaultChordSelectBehaviorPure('nonsense'), 'single');
});

test('effective: a valid saved override wins over the profile default', () => {
    // EOF default is chord; a user who pinned single gets single.
    assert.strictEqual(_editorEffectiveChordSelectBehaviorPure('eof', 'single'), 'single');
    // FeedBack default is single; a user who pinned chord gets chord.
    assert.strictEqual(_editorEffectiveChordSelectBehaviorPure('feedback', 'chord'), 'chord');
});

test('effective: null / invalid override falls through to the profile default', () => {
    assert.strictEqual(_editorEffectiveChordSelectBehaviorPure('eof', null), 'chord');
    assert.strictEqual(_editorEffectiveChordSelectBehaviorPure('feedback', undefined), 'single');
    assert.strictEqual(_editorEffectiveChordSelectBehaviorPure('feedback', 'garbage'), 'single');
    // Guard the near-miss: the right-click vocabulary must not leak in here.
    assert.strictEqual(_editorEffectiveChordSelectBehaviorPure('eof', 'context'), 'chord');
});

test('grab: single-note default — plain grab is one note, Alt grabs the strum', () => {
    assert.strictEqual(_editorChordGrabsStrumPure('single', false, false), false);
    assert.strictEqual(_editorChordGrabsStrumPure('single', true, false), true);
});

test('grab: chord default — plain grab is the strum, Alt isolates one note', () => {
    assert.strictEqual(_editorChordGrabsStrumPure('chord', false, false), true);
    assert.strictEqual(_editorChordGrabsStrumPure('chord', true, false), false);
});

test('grab: keys DATA never groups, whichever behaviour or modifier', () => {
    // Independent voices — even chord-mode + no Alt must not sweep siblings.
    assert.strictEqual(_editorChordGrabsStrumPure('chord', false, true), false);
    assert.strictEqual(_editorChordGrabsStrumPure('chord', true, true), false);
    assert.strictEqual(_editorChordGrabsStrumPure('single', false, true), false);
    assert.strictEqual(_editorChordGrabsStrumPure('single', true, true), false);
});

test('grab: Alt is a strict boolean invert (truthy/falsy coerced, not passed through)', () => {
    // e.altKey is always a real boolean in the DOM, but the helper must not
    // return a non-boolean if handed 0/1 — the caller feeds it straight to a
    // branch and an index-expansion loop.
    assert.strictEqual(_editorChordGrabsStrumPure('chord', 0, false), true);
    assert.strictEqual(_editorChordGrabsStrumPure('chord', 1, false), false);
    assert.strictEqual(_editorChordGrabsStrumPure('single', 0, false), false);
    assert.strictEqual(_editorChordGrabsStrumPure('single', 1, false), true);
});
