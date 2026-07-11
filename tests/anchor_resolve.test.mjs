/*
 * Tests for resolve-positions-in-window + the sweep (src/anchor-resolve.js,
 * P8/VA.7 item 2).
 *
 * Pinned: the anchor-window math, that the bulk resolver only ever touches
 * suggested notes and honors every refusal (refused notes keep their
 * position — never guessed), string occupancy including claims from earlier
 * repicks in the same pass, the sweep cursor state machine, and the
 * ResolveWindowCmd round-trip through the real EditHistory — with the
 * suggested marks SURVIVING the bulk write (the machine picked; only the
 * sweep's accepts confirm).
 *
 * Run: node tests/anchor_resolve.test.mjs
 */
import assert from 'node:assert';

globalThis.document = globalThis.document || {
    getElementById: () => null, addEventListener: () => {}, activeElement: null,
};
globalThis.localStorage = globalThis.localStorage || { getItem: () => null, setItem: () => {} };
globalThis.window = globalThis.window || globalThis;

const {
    ResolveWindowCmd, _acceptAllRefsPure, _anchorWindowPure, _resolveAnchorsPure,
    _resolveWindowPure, _sweepStepPure,
} = await import('../src/anchor-resolve.js');
const { AcceptPositionsCmd } = await import('../src/commands.js');
const { EditHistory } = await import('../src/history.js');
const { S } = await import('../src/state.js');
const { notes, _isSuggested, _markSuggested } = await import('../src/notes.js');

let pass = 0, fail = 0;
function t(name, fn) {
    try { fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}

// Standard 6-string, no capo. prevFretAt: none (lowest-fret tiebreak).
const OPEN = [40, 45, 50, 55, 59, 64];
const CTX = { openMidi: OPEN, tuning: [0, 0, 0, 0, 0, 0], capo: 0, prevFretAt: () => null };
const N = (time, string, fret, sustain = 0) => ({ time, string, fret, sustain, techniques: {} });

t('anchor window: to the next anchor, Infinity for the last, unsorted ok', () => {
    const a1 = { time: 4, fret: 2, width: 4 };
    const anchors = [{ time: 8, fret: 5, width: 4 }, a1, { time: 0, fret: 1, width: 4 }];
    assert.deepStrictEqual(_anchorWindowPure(anchors, a1), { start: 4, end: 8 });
    assert.deepStrictEqual(_anchorWindowPure(anchors, anchors[0]), { start: 8, end: Infinity });
    assert.strictEqual(_anchorWindowPure(anchors, { time: NaN }), null);
});

t('dual anchor list: authored wins, computed falls back', () => {
    assert.deepStrictEqual(
        _resolveAnchorsPure({ anchors_user: [{ time: 1 }], anchors: [{ time: 2 }] }), [{ time: 1 }]);
    assert.deepStrictEqual(_resolveAnchorsPure({ anchors: [{ time: 2 }] }), [{ time: 2 }]);
    assert.deepStrictEqual(_resolveAnchorsPure(null), []);
});

t('resolve: a suggested note repicks into the window; confirmed notes never touched', () => {
    // Note at string 0 fret 8 sounds 48 — also string 1 fret 3, which sits
    // inside the anchor window [2, 6). The confirmed twin must not move.
    const nn = [N(1, 0, 8), N(3, 0, 8)];
    const anchors = [{ time: 0, fret: 2, width: 4 }];
    const sug = new Set([nn[0]]);
    const r = _resolveWindowPure(nn, { start: 0, end: Infinity }, anchors, CTX, (n) => sug.has(n));
    assert.deepStrictEqual(r.targets, [0], 'only the suggested note is a target');
    assert.strictEqual(r.moves.length, 1);
    assert.deepStrictEqual(r.moves[0], { index: 0, oldString: 0, oldFret: 8, newString: 1, newFret: 3 });
    assert.strictEqual(r.refused.length, 0);
});

t('resolve: refusals keep the note as-is — never guessed', () => {
    // Window [10, 12): pitch 48 has no candidate inside it → refused.
    const nn = [N(1, 0, 8)];
    const anchors = [{ time: 0, fret: 10, width: 2 }];
    const r = _resolveWindowPure(nn, { start: 0, end: Infinity }, anchors, CTX, () => true);
    assert.strictEqual(r.moves.length, 0);
    assert.strictEqual(r.refused.length, 1);
    assert.strictEqual(r.refused[0].reason, 'outside-anchor-window');
});

t('resolve: an earlier repick claims its string for later notes', () => {
    // Two simultaneous suggested notes, both sounding 48. The first takes
    // string 1 fret 3 (in-window); the second finds string 1 occupied and
    // its only other candidate (string 0 fret 8) outside the window → refused.
    const nn = [N(2, 0, 8, 0.5), N(2, 5, 8, 0.5)];
    // Give the second note pitch 48 too: string 5 open is 64 — instead put it
    // on string 0 as well but at a different index; same-position twins.
    nn[1] = N(2, 0, 8, 0.5);
    const anchors = [{ time: 0, fret: 2, width: 4 }];
    const r = _resolveWindowPure(nn, { start: 0, end: Infinity }, anchors, CTX, () => true);
    assert.strictEqual(r.moves.length, 1, 'first note wins the in-window string');
    assert.deepStrictEqual({ s: r.moves[0].newString, f: r.moves[0].newFret }, { s: 1, f: 3 });
    assert.strictEqual(r.refused.length, 1, 'second refuses rather than guessing');
});

t('resolve: the least-travel tie-break sees IN-PASS repicks, not stale frets', () => {
    // A (s0 f8, sounds 48) repicks into the window at s1 f3. B (s3 f6,
    // sounds 61) has TWO in-window candidates: s3 f6 and s4 f2. From A's
    // IN-PASS hand (f3) the closer pick is f2; from A's stale pre-pass fret
    // (f8) it would be f6 — the pre-fix behavior.
    const nn = [N(1, 0, 8), N(2, 3, 6)];
    const anchors = [{ time: 0, fret: 2, width: 5 }];
    const ctx = { ...CTX, prevFretAt: (t, i) => (i === 1 ? { idx: 0, fret: 8 } : null) };
    const r = _resolveWindowPure(nn, { start: 0, end: Infinity }, anchors, ctx, () => true);
    const moveB = r.moves.find((m) => m.index === 1);
    assert.ok(moveB, 'B repicks');
    assert.deepStrictEqual({ s: moveB.newString, f: moveB.newFret }, { s: 4, f: 2 },
        'travel measured from the in-pass f3, not the stale f8');
});

t('resolve: window boundaries are honored (end-exclusive)', () => {
    const nn = [N(7.999, 0, 8), N(8.0, 0, 8)];
    const anchors = [{ time: 0, fret: 2, width: 4 }, { time: 8, fret: 5, width: 4 }];
    const r = _resolveWindowPure(nn, { start: 0, end: 8 }, anchors, CTX, () => true);
    assert.deepStrictEqual(r.targets, [0], 'the note at the boundary belongs to the next window');
});

t('accept-all skips refused notes: they stay suggested, stay in the honest gap', () => {
    // Three swept refs; the middle one was refused (never re-fingered).
    const placed = { id: 'placed' }, refused = { id: 'refused' }, other = { id: 'other' };
    const refs = [placed, refused, other];
    const refusedSet = new Set([refused]);
    const sug = new Set([placed, refused, other]);
    const accepted = _acceptAllRefsPure(refs, 0, refusedSet, (n) => sug.has(n));
    assert.deepStrictEqual(accepted, [placed, other], 'refused note is never bulk-accepted');
    assert.ok(!accepted.includes(refused), 'refused ref excluded → its mark survives → still counted');
    // Cursor is honored: from index 1, `placed` (before the cursor) is left alone.
    assert.deepStrictEqual(_acceptAllRefsPure(refs, 1, refusedSet, (n) => sug.has(n)), [other]);
    // An already-accepted (no-longer-suggested) note drops out too.
    assert.deepStrictEqual(
        _acceptAllRefsPure(refs, 0, refusedSet, (n) => n === other), [other]);
});

t('sweep cursor: advance, back-step clamp, done past the end', () => {
    assert.strictEqual(_sweepStepPure(3, 0, 'next'), 1);
    assert.strictEqual(_sweepStepPure(3, 2, 'next'), null, 'past the end = done');
    assert.strictEqual(_sweepStepPure(3, 0, 'prev'), 0, 'clamped at the start');
    assert.strictEqual(_sweepStepPure(3, 2, 'prev'), 1);
    assert.strictEqual(_sweepStepPure(0, 0, 'next'), null);
});

function seedArr() {
    const arr = {
        name: 'Lead', tuning: [0, 0, 0, 0, 0, 0], capo: 0,
        notes: [N(1, 0, 8), N(3, 1, 5)], chords: [],
    };
    S.arrangements = [arr];
    S.currentArr = 0;
    S.sel = new Set();
    S.drumEditMode = false; S.tempoMapMode = false; S.partsViewMode = false;
    S.history = new EditHistory();
    return arr;
}

t('ResolveWindowCmd: round-trip; suggested marks SURVIVE the bulk write', () => {
    seedArr();
    const n = notes()[0];
    _markSuggested(n);
    S.history.exec(new ResolveWindowCmd([
        { index: 0, oldString: 0, oldFret: 8, newString: 1, newFret: 3 },
    ]));
    assert.deepStrictEqual({ s: n.string, f: n.fret }, { s: 1, f: 3 });
    assert.strictEqual(_isSuggested(n), true, 'a bulk repick is still a machine pick');
    S.history.doUndo();
    assert.deepStrictEqual({ s: n.string, f: n.fret }, { s: 0, f: 8 });
    assert.strictEqual(_isSuggested(n), true);
    S.history.doRedo();
    assert.deepStrictEqual({ s: n.string, f: n.fret }, { s: 1, f: 3 });
});

t('the sweep accept path: AcceptPositionsCmd clears one mark, undo re-marks', () => {
    seedArr();
    const n = notes()[0];
    _markSuggested(n);
    S.history.exec(new AcceptPositionsCmd([n]));
    assert.strictEqual(_isSuggested(n), false);
    S.history.doUndo();
    assert.strictEqual(_isSuggested(n), true);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
