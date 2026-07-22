/*
 * Keys (piano) playability lint. Keys parts were the ONE instrument with no
 * playability feedback: _lintResults() bailed to an empty pass on isKeysArr(),
 * and the whole lint pass is fret/anchor-shaped. This adds a piano lint —
 * per-hand over-octave/10th stretch, >5-in-a-hand, and muddy low voicings —
 * and routes keys parts to it instead of bailing.
 *
 * Pins the pure rules AND the wiring (a keys arrangement now yields issues).
 * Run: node tests/keys_lint.test.mjs
 */
import assert from 'node:assert';
import { S } from '../src/state.js';
import { _keysLintPure, _lintResults } from '../src/playability-lint.js';

// A keys note: pitch is the piano-locked string*24 + fret packing; the hand
// ('lh'/'rh') rides under techniques, absent = unassigned.
const kn = (midi, time = 0, hand) => ({
    time, string: Math.floor(midi / 24), fret: midi % 24, sustain: 0,
    techniques: hand ? { hand } : {},
});
const only = (issues, rule) => issues.filter((i) => i.rule === rule);
const has = (issues, rule) => issues.some((i) => i.rule === rule);

let pass = 0, fail = 0;
const t = (name, fn) => {
    try { fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
};

t('no issues on empty or single-note input', () => {
    assert.deepStrictEqual(_keysLintPure([]), []);
    assert.deepStrictEqual(_keysLintPure([kn(60, 0, 'rh')]), []);
});

t('an exact octave in one hand is fine (an octave is reachable, not > an octave)', () => {
    assert.deepStrictEqual(_keysLintPure([kn(60, 0, 'rh'), kn(72, 0, 'rh')]), []);   // span 12
});

t('over an octave in one hand warns; beyond a 10th escalates', () => {
    const minor9 = _keysLintPure([kn(60, 0, 'rh'), kn(73, 0, 'rh')]);   // span 13
    assert.deepStrictEqual(only(minor9, 'keys-span').length, 1);
    assert.match(minor9[0].detail, /over an octave/);

    const tenth = _keysLintPure([kn(60, 0, 'lh'), kn(76, 0, 'lh')]);    // span 16 = a 10th
    assert.match(tenth[0].detail, /over an octave/, 'a 10th itself sits in the warn band');

    const beyond = _keysLintPure([kn(60, 0, 'rh'), kn(77, 0, 'rh')]);   // span 17
    assert.match(beyond[0].detail, /beyond a 10th/);
});

t('span is PER HAND — a wide two-hand voicing is fine', () => {
    const issues = _keysLintPure([
        kn(36, 0, 'lh'), kn(40, 0, 'lh'),   // lh pair, span 4
        kn(80, 0, 'rh'), kn(84, 0, 'rh'),   // rh pair, span 4; total spread 48
    ]);
    assert.deepStrictEqual(only(issues, 'keys-span'), []);
});

t('unassigned notes are not span-linted (assign hands first)', () => {
    assert.deepStrictEqual(only(_keysLintPure([kn(60, 0), kn(84, 0)]), 'keys-span'), []);   // span 24, no hands
});

t('more than five notes in one hand is flagged (a hand has five fingers)', () => {
    const six = [60, 62, 64, 65, 67, 69].map((m) => kn(m, 0, 'rh'));   // 6 notes, span 9
    const issues = _keysLintPure(six);
    assert.ok(has(issues, 'keys-hand'));
    assert.deepStrictEqual(only(issues, 'keys-span'), [], 'a 9-semitone span (< octave) does not also flag');
    assert.strictEqual(only(issues, 'keys-hand')[0].indices.length, 6);
});

t('a tight low voicing is muddy; the same interval high, or an open low interval, is not', () => {
    assert.ok(has(_keysLintPure([kn(36, 0), kn(38, 0)]), 'keys-muddy-low'), 'a whole tone at E2 muds up');
    assert.deepStrictEqual(only(_keysLintPure([kn(60, 0), kn(62, 0)]), 'keys-muddy-low'), [], 'fine up high');
    assert.deepStrictEqual(only(_keysLintPure([kn(36, 0), kn(43, 0)]), 'keys-muddy-low'), [], 'an open 5th is fine');
});

t('muddy-low judges the two LOWEST pitches, ignoring higher cluster notes', () => {
    const issues = _keysLintPure([kn(36, 0), kn(38, 0), kn(72, 0)]);
    const md = issues.find((i) => i.rule === 'keys-muddy-low');
    assert.ok(md, 'the low pair is flagged');
    assert.deepStrictEqual(md.indices.slice().sort((a, b) => a - b), [0, 1], 'the two low notes, not the high one');
});

t('notes at different onsets are not one cluster', () => {
    assert.deepStrictEqual(_keysLintPure([kn(60, 0, 'rh'), kn(77, 1.0, 'rh')]), []);   // 1s apart
});

t('issues carry rule / time / indices', () => {
    const [iss] = _keysLintPure([kn(60, 0.5, 'rh'), kn(77, 0.5, 'rh')]);
    assert.strictEqual(iss.rule, 'keys-span');
    assert.strictEqual(iss.time, 0.5);
    assert.deepStrictEqual(iss.indices.slice().sort((a, b) => a - b), [0, 1]);
});

// ── the wiring: _lintResults routes a keys part to the keys lint ─────────────
t('_lintResults now lints a keys arrangement instead of bailing to empty', () => {
    Object.assign(S, {
        arrangements: [{
            name: 'Piano',   // KEYS_PATTERN → isKeysArr() true (no anchors needed)
            notes: [kn(60, 0.5, 'rh'), kn(77, 0.5, 'rh')], chords: [],
        }],
        currentArr: 0, drumEditMode: false, filename: 'k.sloppak', sel: new Set(),
    });
    const res = _lintResults();
    assert.ok(has(res.issues, 'keys-span'), 'a keys part gets feedback (this was empty on main)');
    assert.ok(res.flagged.has(0) && res.flagged.has(1), 'the flagged set marks both reached notes');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
