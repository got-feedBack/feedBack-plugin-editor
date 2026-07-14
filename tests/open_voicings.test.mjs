/*
 * Open voicings in chord grips — "use opens, flag for review" (#245 follow-up).
 *
 * The grip resolver used to BAIL on any cluster note playable both open and
 * fretted (a real articulation choice), dropping the whole chord to the
 * per-note path, which refused it. Now the grip is allowed to voice such a
 * note OPEN — opens are how real chord shapes use the neck — but the choice is
 * never silently confirmed: the pick is tagged `ambiguousOpen`, the tag rides
 * _resolveWindowPure's moves and its `ambiguousOpen` index list, and the
 * sweep's "Accept all" excludes those refs (the refused-notes pattern) so the
 * charter confirms each flagged open individually. The SINGLETON resolver
 * (_suggestPositionPure) still refuses open-vs-fretted — the change is scoped
 * to grips, where a coherent shape justifies the machine taking the open.
 *
 * Every case here fails on pre-fix main (the grip returned null for any
 * ambiguous cluster). Standard 6-string, no capo: openMidi = [40,45,50,55,59,64].
 * Run: node --test tests/open_voicings.test.mjs
 */
import assert from 'node:assert';

globalThis.document = globalThis.document || { getElementById: () => null, addEventListener: () => {}, activeElement: null };
globalThis.localStorage = globalThis.localStorage || { getItem: () => null, setItem: () => {} };
globalThis.window = globalThis.window || globalThis;

const { _resolveChordGripPure } = await import('../src/position.js');
const { _acceptAllRefsPure, _resolveWindowPure } = await import('../src/anchor-resolve.js');

const OPEN = [40, 45, 50, 55, 59, 64];
const CTX = { openMidi: OPEN, tuning: [0, 0, 0, 0, 0, 0], capo: 0 };
const NOANCHOR = { anchorFret: null, window: 4, maxSpan: 5 };
const N = (time, string, fret, sustain = 0) => ({ time, string, fret, sustain, techniques: {} });

let pass = 0, fail = 0;
function t(name, fn) {
    try { fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}

// ── the flag itself ──────────────────────────────────────────────────────────
t('an UNAMBIGUOUS open (its only position) is never flagged', () => {
    // Anchor [10,14): 60 fits only s2f10, 57 only s1f12; 64 fits nowhere fretted
    // in-window — its open string is its ONE way to sound, not a choice.
    const r = _resolveChordGripPure(
        [{ idx: 0, pitch: 60 }, { idx: 1, pitch: 57 }, { idx: 2, pitch: 64 }],
        CTX, { anchorFret: 10, window: 4, maxSpan: 5 }, null, new Set());
    assert.strictEqual(r.assignments[2].fret, 0, 'voiced open');
    assert.ok(!r.assignments[2].ambiguousOpen, 'no fretted alternative existed → no flag');
});

t('a FRETTED pick is never flagged, even when an open alternative existed', () => {
    // Two notes both sounding 64: distinct strings force one fretted (s4f5) while
    // the other takes the open (s5f0). Only the OPEN pick is the machine choosing
    // an articulation — the fretted one carries no flag.
    const r = _resolveChordGripPure(
        [{ idx: 0, pitch: 64 }, { idx: 1, pitch: 64 }], CTX, NOANCHOR, null, new Set());
    const open = r.assignments.filter(a => a.fret === 0);
    const fretted = r.assignments.filter(a => a.fret > 0);
    assert.strictEqual(open.length, 1);
    assert.strictEqual(fretted.length, 1);
    assert.strictEqual(open[0].ambiguousOpen, true, 'the open pick is flagged');
    assert.ok(!fretted[0].ambiguousOpen, 'the fretted pick is not');
});

// ── propagation through _resolveWindowPure ───────────────────────────────────
t('an identity open pick writes NO move but is still listed for review', () => {
    // Note 0 already sits on the open string the grip picks (s5f0 sounding 64,
    // fretted alternatives exist). No move to write — but the machine still made
    // the ambiguous choice, so the index must reach the bulk-accept exclusion.
    const nn = [N(1, 5, 0), N(1, 2, 10)];
    const ctx = { ...CTX, prevFretAt: () => null };
    const r = _resolveWindowPure(nn, { start: 0, end: Infinity }, [], ctx, () => true);
    assert.deepStrictEqual(r.ambiguousOpen, [0], 'identity pick still flagged');
    assert.ok(!r.moves.some(m => m.index === 0), 'no move for the identity pick');
    assert.strictEqual(r.refused.length, 0);
});

t('the SINGLETON path still refuses open-vs-fretted (scope guard)', () => {
    // One lone note sounding 64 (open E or s4f5/…): outside a chord there is no
    // shape to justify the machine choosing — Byron's conservative baseline holds.
    const nn = [N(1, 2, 14)];
    const ctx = { ...CTX, prevFretAt: () => null };
    const r = _resolveWindowPure(nn, { start: 0, end: Infinity }, [], ctx, () => true);
    assert.deepStrictEqual(r.refused, [{ index: 0, reason: 'open-vs-fretted' }]);
    assert.strictEqual(r.moves.length, 0);
    assert.deepStrictEqual(r.ambiguousOpen, [], 'singletons never carry the grip flag');
});

// ── the bulk-accept gate ─────────────────────────────────────────────────────
t('"Accept all" excludes flagged opens exactly like refused notes', () => {
    // The sweep unions refused + ambiguous-open refs into one review-only set and
    // feeds it to the same pure the refused gate always used.
    const placed = { id: 'placed' }, refusedRef = { id: 'refused' }, openRef = { id: 'open' };
    const refs = [placed, refusedRef, openRef];
    const reviewOnly = new Set([refusedRef, openRef]);
    const sug = new Set(refs);
    const accepted = _acceptAllRefsPure(refs, 0, reviewOnly, (n) => sug.has(n));
    assert.deepStrictEqual(accepted, [placed], 'only the unflagged placement is bulk-confirmed');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
