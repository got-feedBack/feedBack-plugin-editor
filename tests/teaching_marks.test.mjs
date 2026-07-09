/*
 * Tests for the §6.2.2 teaching-marks authoring helpers in src/main.js. src/main.js
 * block (browser-free) and eval's it in isolation — real source, no drift.
 *
 * Run: node tests/teaching_marks.test.mjs
 */
import assert from 'node:assert';
import { FRET_FINGER_OPTIONS, nextUnusedStrumGroup } from '../src/notes.js';

let pass = 0, fail = 0;
function t(name, fn) {
    try { fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}

// ── FRET_FINGER_OPTIONS ──────────────────────────────────────────────────────
t('FRET_FINGER_OPTIONS covers -1 (unset) + 0..4 (thumb..pinky) in order', () => {
    assert.deepStrictEqual(FRET_FINGER_OPTIONS.map(o => o.v), [-1, 0, 1, 2, 3, 4]);
    assert.strictEqual(FRET_FINGER_OPTIONS[1].label, 'Thumb');
    assert.strictEqual(FRET_FINGER_OPTIONS[5].label, 'Pinky');
});

// ── nextUnusedStrumGroup ─────────────────────────────────────────────────────
const tech = (strum_group) => ({ techniques: { strum_group } });

t('first group is 0 when nothing is grouped', () => {
    assert.strictEqual(nextUnusedStrumGroup([]), 0);
    assert.strictEqual(nextUnusedStrumGroup([{ techniques: {} }, { techniques: { strum_group: -1 } }]), 0);
});

t('returns max used + 1 across the note list', () => {
    assert.strictEqual(nextUnusedStrumGroup([tech(0), tech(2), tech(1)]), 3);
    assert.strictEqual(nextUnusedStrumGroup([tech(5), tech(-1), tech(2)]), 6);
});

t('ignores non-integer / missing strum_group values', () => {
    assert.strictEqual(nextUnusedStrumGroup([tech(1.5), tech('3'), { }, null, tech(2)]), 3);
});

t('tolerates bad input', () => {
    assert.strictEqual(nextUnusedStrumGroup(null), 0);
    assert.strictEqual(nextUnusedStrumGroup(undefined), 0);
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
