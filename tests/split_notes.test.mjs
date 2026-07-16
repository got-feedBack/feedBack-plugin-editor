/*
 * SplitNotesCmd + _splitTechniquesPure (src/commands.js) — the Scissors tool /
 * Split-at-playhead core. Real-import suite over the real `S` (seeded via
 * tests/_history_env.mjs) and the real EditHistory.
 *
 * Non-negotiables covered: exec → rollback restores the EXACT original array
 * (same refs, same order — the ref-snapshot contract); redo rebuilds the same
 * halves; technique distribution (onset verbs → first half, end-of-note verbs
 * → second, whole-note marks → both); degenerate-split guards; the
 * sorted-by-time invariant when another note starts inside the split span.
 *
 * Run: node tests/split_notes.test.mjs
 */
import assert from 'node:assert';
import { seedState, trackHooks } from './_history_env.mjs';
import { EditHistory } from '../src/history.js';
import { SplitNotesCmd, _splitTechniquesPure, _SPLIT_MIN_SEGMENT } from '../src/commands.js';
import { S } from '../src/state.js';

let pass = 0, fail = 0;
function t(name, fn) {
    try { fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}

const note = (time, sustain, tech = {}, string = 2, fret = 12) => ({
    time, string, fret, sustain, techniques: { ...tech },
});

function seed(notesArr) {
    trackHooks();
    seedState({
        arrangements: [{ name: 'Lead', notes: notesArr, chords: [], chord_templates: [] }],
        currentArr: 0,
    });
    S.history = new EditHistory();
    return S.arrangements[0].notes;
}

// ── _splitTechniquesPure ─────────────────────────────────────────────

t('onset verbs stay on the first half; end verbs move to the second', () => {
    const tech = {
        bend: 2, bend_intent: 1, bend_values: [{ t: 0, v: 2 }],
        slide_to: 14, slide_unpitch_to: -1, link_next: true,
        palm_mute: true, accent: true, hand: 'lh',
    };
    const { first, second } = _splitTechniquesPure(tech);
    // First: keeps bends, loses slides/link.
    assert.strictEqual(first.bend, 2);
    assert.deepStrictEqual(first.bend_values, [{ t: 0, v: 2 }]);
    assert.ok(!('slide_to' in first) && !('link_next' in first));
    // Second: keeps slides/link, loses bends.
    assert.strictEqual(second.slide_to, 14);
    assert.strictEqual(second.link_next, true);
    assert.ok(!('bend' in second) && !('bend_values' in second));
    // Whole-note marks copy to both (incl. the keys hand).
    for (const half of [first, second]) {
        assert.strictEqual(half.palm_mute, true);
        assert.strictEqual(half.accent, true);
        assert.strictEqual(half.hand, 'lh');
    }
    // Input untouched.
    assert.strictEqual(tech.bend, 2);
    assert.strictEqual(tech.slide_to, 14);
});

t('null/absent techniques split into two empty dicts', () => {
    const { first, second } = _splitTechniquesPure(null);
    assert.deepStrictEqual(first, {});
    assert.deepStrictEqual(second, {});
});

// ── SplitNotesCmd ────────────────────────────────────────────────────

t('splits a spanning note into two seamless halves', () => {
    const nn = seed([note(1.0, 1.0)]);
    S.history.exec(new SplitNotesCmd([0], 1.4));
    assert.strictEqual(nn.length, 2);
    assert.strictEqual(nn[0].time, 1.0);
    assert.ok(Math.abs(nn[0].sustain - 0.4) < 1e-9);
    assert.strictEqual(nn[1].time, 1.4);
    assert.ok(Math.abs(nn[1].sustain - 0.6) < 1e-9);
    // Same position, pitch preserved.
    assert.strictEqual(nn[0].string, 2);
    assert.strictEqual(nn[1].fret, 12);
});

t('undo restores the EXACT original array — same refs, same order', () => {
    const original = [note(0, 0.5), note(1.0, 1.0), note(1.2, 0.1)];
    const nn = seed(original.slice());
    const refs = nn.slice();
    S.history.exec(new SplitNotesCmd([1], 1.5));
    assert.strictEqual(nn.length, 4);
    S.history.doUndo();
    assert.strictEqual(nn.length, 3);
    for (let i = 0; i < refs.length; i++) {
        assert.strictEqual(nn[i], refs[i], 'ref identity at ' + i);
    }
});

t('redo rebuilds the same two halves', () => {
    const nn = seed([note(1.0, 1.0)]);
    S.history.exec(new SplitNotesCmd([0], 1.5));
    const after = nn.map(n => ({ ...n, techniques: { ...n.techniques } }));
    S.history.doUndo();
    S.history.doRedo();
    assert.deepStrictEqual(
        nn.map(n => ({ ...n, techniques: { ...n.techniques } })), after);
});

t('keeps the sorted-by-time invariant when a note starts inside the span', () => {
    // A(0→2s) split at 1.5 with B at 1.0: A2 (t=1.5) must land AFTER B.
    const nn = seed([note(0, 2.0), note(1.0, 0.2, {}, 3, 5)]);
    S.history.exec(new SplitNotesCmd([0], 1.5));
    const times = nn.map(n => n.time);
    assert.deepStrictEqual(times, [0, 1.0, 1.5]);
});

t('degenerate splits are skipped (guards, no-op command)', () => {
    const nn = seed([note(1.0, 1.0)]);
    // Too close to the onset / the tail / outside entirely.
    for (const tt of [1.0 + _SPLIT_MIN_SEGMENT / 2, 2.0 - _SPLIT_MIN_SEGMENT / 2, 0.5, 3.0]) {
        const cmd = new SplitNotesCmd([0], tt);
        cmd.exec();
        assert.strictEqual(nn.length, 1, 'no split at t=' + tt);
        assert.strictEqual(cmd.splitCount, 0);
        cmd.rollback();
        assert.strictEqual(nn.length, 1);
    }
});

t('zero-sustain notes never split', () => {
    const nn = seed([note(1.0, 0)]);
    const cmd = new SplitNotesCmd([0], 1.0);
    cmd.exec();
    assert.strictEqual(nn.length, 1);
});

t('multi-note split: every spanning target splits in one command', () => {
    const nn = seed([note(0, 2.0), note(1.0, 1.0, {}, 1, 3), note(1.4, 0.05)]);
    S.history.exec(new SplitNotesCmd([0, 1, 2], 1.5));
    // note 0 and 1 span 1.5; note 2 (1.4→1.45) does not.
    assert.strictEqual(nn.length, 5);
    S.history.doUndo();
    assert.strictEqual(nn.length, 3);
});

t('selection clears on a real split (like delete)', () => {
    const nn = seed([note(1.0, 1.0)]);
    S.sel.add(0);
    S.history.exec(new SplitNotesCmd([0], 1.5));
    assert.strictEqual(S.sel.size, 0);
    assert.strictEqual(nn.length, 2);
});

t('split passes the read-only fretted roll (pitch-preserving)', () => {
    const cmd = new SplitNotesCmd([0], 1.5);
    assert.strictEqual(cmd.pitchPreserving, true);
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
