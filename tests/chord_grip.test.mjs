/*
 * Chord-shape-aware joint position resolve (gap-audit #7). The bulk resolver
 * used to place each note of a simultaneous cluster GREEDILY (lowest free fret,
 * one at a time), which spreads a chord across the neck until the stretch lint
 * scolds it. Now a cluster is resolved JOINTLY as one coherent grip
 * (_resolveChordGripPure): the minimum-fretted-span distinct-string assignment
 * within the hand. A cluster with no coherent grip falls back to the per-note
 * path, so nothing regresses.
 *
 * Pinned: the grip search itself (min span, distinct strings, open strings are
 * free, anchor-window eligibility, occupancy, the too-wide refusal), and the
 * end-to-end _resolveWindowPure integration — a chord that greedy spreads to a
 * 6-fret stretch now lands as a 2-fret grip (fails on main: greedy per-note).
 *
 * Standard 6-string, no capo: openMidi = [40,45,50,55,59,64]; sounding pitch of
 * (string s, fret f) = openMidi[s] + f.  Run: node --test tests/chord_grip.test.mjs
 */
import assert from 'node:assert';

globalThis.document = globalThis.document || { getElementById: () => null, addEventListener: () => {}, activeElement: null };
globalThis.localStorage = globalThis.localStorage || { getItem: () => null, setItem: () => {} };
globalThis.window = globalThis.window || globalThis;

const { _resolveChordGripPure } = await import('../src/position.js');
const { _resolveWindowPure } = await import('../src/anchor-resolve.js');

const OPEN = [40, 45, 50, 55, 59, 64];
const CTX = { openMidi: OPEN, tuning: [0, 0, 0, 0, 0, 0], capo: 0 };
const NOANCHOR = { anchorFret: null, window: 4, maxSpan: 5 };
const N = (time, string, fret, sustain = 0) => ({ time, string, fret, sustain, techniques: {} });
const grip = (r) => (r ? r.assignments.map(a => ({ i: a.idx, s: a.string, f: a.fret })) : null);

let pass = 0, fail = 0;
function t(name, fn) {
    try { fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}

// ── _resolveChordGripPure ────────────────────────────────────────────────────
t('picks the minimum-span distinct-string grip (60+62 → span 2, not 6)', () => {
    // 60: s3f5 / s4f1 …  62: s4f3 / s3f7 …  Greedy lowest-fret would take 60→s4f1
    // then 62→s3f7 (span 6). The tight grip is 60→s3f5, 62→s4f3 (span 2).
    const r = _resolveChordGripPure([{ idx: 0, pitch: 60 }, { idx: 1, pitch: 62 }], CTX, NOANCHOR, null, new Set());
    assert.strictEqual(r.span, 2);
    assert.deepStrictEqual(grip(r), [{ i: 0, s: 3, f: 5 }, { i: 1, s: 4, f: 3 }]);
});

t('three-note chord uses an open string for free (not counted in the span)', () => {
    // 60,62,64 → 60:s3f5, 62:s4f3, 64:s5f0 (open E). Fretted span {5,3} = 2.
    const r = _resolveChordGripPure(
        [{ idx: 0, pitch: 60 }, { idx: 1, pitch: 62 }, { idx: 2, pitch: 64 }], CTX, NOANCHOR, null, new Set());
    assert.strictEqual(r.span, 2, 'the open string is free');
    assert.deepStrictEqual(grip(r), [{ i: 0, s: 3, f: 5 }, { i: 1, s: 4, f: 3 }, { i: 2, s: 5, f: 0 }]);
});

t('every note lands on a distinct string', () => {
    const r = _resolveChordGripPure(
        [{ idx: 0, pitch: 60 }, { idx: 1, pitch: 62 }, { idx: 2, pitch: 64 }], CTX, NOANCHOR, null, new Set());
    const strings = r.assignments.map(a => a.string);
    assert.strictEqual(new Set(strings).size, strings.length, 'no two notes share a string');
});

t('refuses (null) when even the tightest grip is wider than maxSpan', () => {
    // The tightest 60+62 grip is span 2; a maxSpan of 1 has no coherent grip.
    const r = _resolveChordGripPure([{ idx: 0, pitch: 60 }, { idx: 1, pitch: 62 }],
        CTX, { anchorFret: null, window: 1, maxSpan: 1 }, null, new Set());
    assert.strictEqual(r, null);
});

t('routes around strings occupied by other (non-cluster) notes', () => {
    // Block s3 and s4 (the natural grip). 60→s1f15, 62→s2f12 is then the min span (3).
    const r = _resolveChordGripPure([{ idx: 0, pitch: 60 }, { idx: 1, pitch: 62 }],
        CTX, NOANCHOR, null, new Set([3, 4]));
    assert.deepStrictEqual(grip(r), [{ i: 0, s: 1, f: 15 }, { i: 1, s: 2, f: 12 }]);
    assert.strictEqual(r.span, 3);
});

t('honours the anchor window: only in-window (or open) frets are eligible', () => {
    // Anchor at fret 3, window 4 → [3,7). 60 has only s3f5 in-window; 62 only s4f3.
    const r = _resolveChordGripPure([{ idx: 0, pitch: 60 }, { idx: 1, pitch: 62 }],
        CTX, { anchorFret: 3, window: 4, maxSpan: 5 }, null, new Set());
    assert.deepStrictEqual(grip(r), [{ i: 0, s: 3, f: 5 }, { i: 1, s: 4, f: 3 }]);
});

t('refuses when a note has no eligible position (fully occupied / out of window)', () => {
    // Occupy every string 60 could use → no candidate → whole cluster refused.
    const r = _resolveChordGripPure([{ idx: 0, pitch: 60 }, { idx: 1, pitch: 62 }],
        CTX, NOANCHOR, null, new Set([0, 1, 2, 3, 4, 5]));
    assert.strictEqual(r, null);
});

t('deterministic: identical clusters always resolve to the same grip', () => {
    const a = _resolveChordGripPure([{ idx: 0, pitch: 60 }, { idx: 1, pitch: 62 }], CTX, NOANCHOR, null, new Set());
    const b = _resolveChordGripPure([{ idx: 0, pitch: 60 }, { idx: 1, pitch: 62 }], CTX, NOANCHOR, null, new Set());
    assert.deepStrictEqual(grip(a), grip(b));
});

// ── _resolveWindowPure integration (fails on main — greedy per-note) ──────────
t('bulk resolve lands a chord as one grip, not a greedy spread', () => {
    // Two simultaneous suggested notes sounding 60 and 62 (both parked on s2).
    // Greedy (main): 60→s4f1, 62→s3f7 — a 6-fret stretch the lint flags.
    // Grip (here): 60→s3f5, 62→s4f3 — a 2-fret hand.
    const nn = [N(2, 2, 10), N(2, 2, 12)];
    const ctx = { ...CTX, prevFretAt: () => null };
    const r = _resolveWindowPure(nn, { start: 0, end: Infinity }, [], ctx, () => true);
    assert.strictEqual(r.refused.length, 0);
    const m0 = r.moves.find(m => m.index === 0);
    const m1 = r.moves.find(m => m.index === 1);
    assert.deepStrictEqual({ s: m0.newString, f: m0.newFret }, { s: 3, f: 5 });
    assert.deepStrictEqual({ s: m1.newString, f: m1.newFret }, { s: 4, f: 3 });
    const frets = [m0.newFret, m1.newFret];
    assert.ok(Math.max(...frets) - Math.min(...frets) <= 4, 'the chord fits one hand');
});

t('a singleton note still resolves through the per-note path unchanged', () => {
    // One suggested note sounding 48 (s0 f8), anchor window [2,6) → s1 f3.
    const nn = [N(1, 0, 8)];
    const anchors = [{ time: 0, fret: 2, width: 4 }];
    const ctx = { ...CTX, prevFretAt: () => null };
    const r = _resolveWindowPure(nn, { start: 0, end: Infinity }, anchors, ctx, () => true);
    assert.deepStrictEqual(r.moves[0], { index: 0, oldString: 0, oldFret: 8, newString: 1, newFret: 3 });
});

t('a cluster with no coherent grip falls back to per-note (no regression)', () => {
    // Anchor window [10,12) width 2, maxSpan 3. Two notes sounding 48: candidates
    // s1f3 (out of window) and s0f8 (out of window) → no in-window grip AND the
    // per-note resolver also refuses (outside-anchor-window) — both left as-is.
    const nn = [N(2, 0, 8, 0.5), N(2, 0, 8, 0.5)];
    const anchors = [{ time: 0, fret: 10, width: 2 }];
    const ctx = { ...CTX, prevFretAt: () => null };
    const r = _resolveWindowPure(nn, { start: 0, end: Infinity }, anchors, ctx, () => true);
    assert.strictEqual(r.moves.length, 0);
    assert.strictEqual(r.refused.length, 2, 'both fall back and refuse — never guessed');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
