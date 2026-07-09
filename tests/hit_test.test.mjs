/*
 * Tests for pointer hit testing (src/hit-test.js), driven against the real `S`,
 * the real lane/keys models and the real geometry.
 *
 * The keys-mode edge case is a regression guard for a bug CodeRabbit found while
 * extracting this module (PR #160). `hitNote` branches on `isKeysMode()` and
 * resolves a note to its piano-roll row via `midiToY`. `hitNoteEdge` did not —
 * it always computed `y` from `strToY(n.string)`, the fretted lane band. So the
 * sustain-resize grab zone sat on the wrong rows in the piano roll, even though
 * the call site in main.js explicitly documents that edge-drag resize "applies
 * directly even in the read-only fretted roll (V4)": a duration edit is
 * pitch-preserving and passes the roll's edit lock.
 *
 * Two functions computing the same note rectangle two different ways is why they
 * drifted, so both now share one `_noteRect`.
 *
 * Run: node tests/hit_test.test.mjs
 */
import assert from 'node:assert';
import { LABEL_W, MIN_NOTE_W, NOTE_PAD, setLaneMetrics, strToY } from '../src/geometry.js';
import { hitNote, hitNoteEdge } from '../src/hit-test.js';
import { LC } from '../src/lanes.js';
import * as keys from '../src/keys.js';
import { S } from '../src/state.js';

let pass = 0, fail = 0;
function t(name, fn) {
    try { fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}

const note = (time, string, fret, sustain) => ({ time, string, fret, sustain, techniques: {} });

/** Seed a 6-string guitar part. `view` picks the fretted lanes or the roll. */
function seed(view) {
    const map = new Map();
    if (view === 'piano') map.set('editorViewPref:x.sloppak', '{"a1":"piano"}');
    globalThis.localStorage = {
        getItem: (k) => (map.has(k) ? map.get(k) : null),
        setItem: (k, v) => { map.set(k, String(v)); },
        removeItem: (k) => { map.delete(k); },
    };
    // `_viewPrefs` memoizes per S.filename; bounce the key so each seed re-reads.
    S.filename = '\u0000reset';
    keys._viewPrefs();
    S.filename = 'x.sloppak';
    S.currentArr = 0;
    S.scrollX = 0;
    S.zoom = 120;
    S.arrangements = [{
        id: 'a1', name: 'Lead', tuning: [0, 0, 0, 0, 0, 0], chords: [],
        notes: [note(0, 0, 0, 1)],       // open low E, 1s sustain → sounding MIDI 40
    }];
    LC.active = false;
    setLaneMetrics(1000);
    keys.updatePianoRange();
    assert.strictEqual(keys.isKeysMode(), view === 'piano', 'fixture is in the expected view');
}

// ── fretted lanes ────────────────────────────────────────────────────

t('fretted: hitNote finds the note body, hitNoteEdge finds its right edge', () => {
    seed('string');
    const x = LABEL_W;                                  // t = 0
    const y = strToY(0) + NOTE_PAD + 2;                 // inside the low-E lane
    const w = Math.max(MIN_NOTE_W, 1 * S.zoom);         // 1s × 120px/s

    assert.strictEqual(hitNote(x + 2, y), 0, 'body');
    assert.strictEqual(hitNoteEdge(x + w, y), 0, 'right edge');
    assert.strictEqual(hitNoteEdge(x + 2, y), -1, 'middle of the note is not an edge');
});

t('fretted: a miss above the lane returns -1 from both', () => {
    seed('string');
    assert.strictEqual(hitNote(LABEL_W + 2, 0), -1);
    assert.strictEqual(hitNoteEdge(LABEL_W + 2, 0), -1);
});

// ── piano roll (the regression) ──────────────────────────────────────

t('roll: hitNote finds the note on its SOUNDING-pitch row', () => {
    seed('piano');
    const x = LABEL_W;
    const y = keys.midiToY(40) + 1;                     // open low E sounds MIDI 40
    assert.strictEqual(hitNote(x + 2, y + 1), 0);
});

t('roll: hitNoteEdge grabs the SAME row as hitNote (was the fretted lane)', () => {
    seed('piano');
    const x = LABEL_W;
    const w = Math.max(MIN_NOTE_W, 1 * S.zoom);
    const y = keys.midiToY(40) + 1;

    // Before the fix this returned -1: hitNoteEdge computed y from strToY(0),
    // i.e. the fretted lane band, which in the roll is nowhere near the note.
    assert.strictEqual(hitNoteEdge(x + w, y + 1), 0, 'edge is grabbable in the roll');
    assert.strictEqual(hitNoteEdge(x + 2, y + 1), -1, 'middle of the note is not an edge');
});

t('roll: the edge is NOT grabbable at the old fretted-lane y', () => {
    seed('piano');
    const w = Math.max(MIN_NOTE_W, 1 * S.zoom);
    const strayY = strToY(0) + NOTE_PAD + 2;            // where the bug looked
    assert.notStrictEqual(keys.midiToY(40) + 1, strayY, 'the two rows really do differ');
    assert.strictEqual(hitNoteEdge(LABEL_W + w, strayY), -1);
});

t('roll: an unresolvable pitch is skipped rather than mis-placed', () => {
    seed('piano');
    S.arrangements[0].notes = [note(0, 9, 0, 1)];       // no such string
    assert.strictEqual(hitNote(LABEL_W + 2, 100), -1);
    assert.strictEqual(hitNoteEdge(LABEL_W + 2, 100), -1);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
