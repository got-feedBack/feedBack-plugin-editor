/*
 * Tests for the fretboard companion strip (src/fretboard-strip.js, P7/VA.6).
 *
 * Pure layer: candidate annotation math (enumeration × anchor window ×
 * stretch cost × open-string distinction), the display fret window, the
 * shared geometry/hit-test mapping, and the finger cycle. Command layer:
 * the click-assign path (MoveToStringCmd, pitch-preserving) round-trips
 * through the REAL EditHistory including the suggested-mark clear/re-mark,
 * and the right-click finger mark round-trips through SetTeachingMarkCmd.
 *
 * Run: node tests/fretboard_strip.test.mjs
 */
import assert from 'node:assert';

globalThis.document = globalThis.document || {
    getElementById: () => null, addEventListener: () => {}, activeElement: null,
};
globalThis.localStorage = globalThis.localStorage || { getItem: () => null, setItem: () => {} };
globalThis.window = globalThis.window || globalThis;

const {
    FINGER_LABELS, _stripAnnotationsPure, _stripFingerCyclePure,
    _stripDisplayWindowPure, _stripFretWindowPure, _stripGeometryPure, _stripHitTestPure,
} = await import('../src/fretboard-strip.js');
const { MoveToStringCmd, SetTeachingMarkCmd } = await import('../src/commands.js');
const { EditHistory } = await import('../src/history.js');
const { S } = await import('../src/state.js');
const { notes, _isSuggested, _markSuggested } = await import('../src/notes.js');

let pass = 0, fail = 0;
function t(name, fn) {
    try { fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}

// Standard 6-string: E2 A2 D3 G3 B3 E4, low string first.
const OPEN = [40, 45, 50, 55, 59, 64];
const CTX = (over = {}) => ({
    openMidi: OPEN, tuning: [0, 0, 0, 0, 0, 0], capo: 0, anchors: [], ...over,
});

t('annotations: enumeration, current flag, open distinction', () => {
    // String 0 fret 5 sounds A2 (45) — also the open string 1.
    const sel = [{ idx: 0, string: 0, fret: 5, time: 1, techniques: null }];
    const ann = _stripAnnotationsPure(sel, CTX(), () => null);
    assert.strictEqual(ann.length, 2);
    const cur = ann.find((a) => a.current);
    const open = ann.find((a) => a.open);
    assert.deepStrictEqual({ s: cur.string, f: cur.fret }, { s: 0, f: 5 });
    assert.deepStrictEqual({ s: open.string, f: open.fret }, { s: 1, f: 0 });
    assert.strictEqual(cur.stretch, null, 'the current position carries no stretch cost');
});

t('annotations: anchor window brightens/dims, opens always bright', () => {
    // E4 (64): open string 5, string 4 fret 5, string 3 fret 9, ...
    const sel = [{ idx: 0, string: 4, fret: 5, time: 2, techniques: null }];
    const anchors = [{ time: 0, fret: 4, width: 4 }];   // window [4, 8)
    const ann = _stripAnnotationsPure(sel, CTX({ anchors }), () => null);
    const at = (s, f) => ann.find((a) => a.string === s && a.fret === f);
    assert.strictEqual(at(4, 5).inWindow, true, 'fret 5 inside [4,8)');
    assert.strictEqual(at(3, 9).inWindow, false, 'fret 9 outside');
    assert.strictEqual(at(5, 0).inWindow, true, 'open needs no hand position');
});

t('annotations: stretch cost is fret travel vs the previous note', () => {
    const sel = [{ idx: 1, string: 4, fret: 5, time: 2, techniques: null }];
    const ann = _stripAnnotationsPure(sel, CTX(), () => 7);   // prev hand at 7
    const at = (s, f) => ann.find((a) => a.string === s && a.fret === f);
    assert.strictEqual(at(3, 9).stretch, 2);
    assert.strictEqual(at(5, 0).stretch, 7);
});

t('annotations: capo-aware (chart frets index from the capo)', () => {
    // Capo 2: string 0 fret 3 sounds 40+2+3 = 45. Same pitch on string 1:
    // fret = 45 − 45 − 2 = −2 → invalid; so only its own position remains.
    const sel = [{ idx: 0, string: 0, fret: 3, time: 0, techniques: null }];
    const ann = _stripAnnotationsPure(sel, CTX({ capo: 2 }), () => null);
    assert.strictEqual(ann.length, 1);
    assert.strictEqual(ann[0].current, true);
});

t('annotations: malformed selection entries are skipped, never throw', () => {
    const ann = _stripAnnotationsPure(
        [null, { idx: 0, string: 99, fret: 2, time: 0 }, { idx: 1, string: 0, fret: 'x', time: 0 }],
        CTX(), () => null);
    assert.deepStrictEqual(ann, []);
});

t('fret window: nut always shown, expands to candidates, capped at 24', () => {
    assert.deepStrictEqual(_stripFretWindowPure([], 0), { lo: 0, hi: 12 });
    assert.strictEqual(_stripFretWindowPure([{ fret: 14 }], 2).hi, 17);
    assert.strictEqual(_stripFretWindowPure([{ fret: 24 }], 5).hi, 24);
});

t('display and hit-test window widens for active handshape dots', () => {
    const ann = [{ fret: 5 }];
    const shape = { dots: [{ string: 0, fret: 17 }] };
    assert.deepStrictEqual(_stripDisplayWindowPure(ann, shape, 0), { lo: 0, hi: 18 });
    assert.deepStrictEqual(_stripDisplayWindowPure(ann, null, 0),
        _stripFretWindowPure(ann, 0));
});

t('geometry: low string at the bottom, spacing capped, shared with hit-test', () => {
    const g = _stripGeometryPure(800, 112, 6, 0, 12);
    assert.ok(g.rowY(0) > g.rowY(5), 'string 0 renders below string 5');
    assert.ok(g.spaceW <= 72, 'per-fret width is capped');
    const gWide = _stripGeometryPure(4000, 112, 6, 0, 6);
    assert.strictEqual(gWide.spaceW, 72, 'wide strips cap instead of stretching');
});

t('hit-test: nearest annotation within radius, physical (capo) space', () => {
    const g = _stripGeometryPure(800, 112, 6, 0, 12);
    const ann = [
        { noteIdx: 0, string: 0, fret: 5, current: true },
        { noteIdx: 0, string: 1, fret: 0, current: false },
    ];
    const hit = _stripHitTestPure(g.xNote(5), g.rowY(0), g, ann, 0);
    assert.strictEqual(hit, ann[0]);
    const miss = _stripHitTestPure(g.xNote(9), g.rowY(3), g, ann, 0);
    assert.strictEqual(miss, null);
    // With capo 2, the same CHART fret sits 2 fret-spaces right.
    const hitCapo = _stripHitTestPure(g.xNote(7), g.rowY(0), g, ann, 2);
    assert.strictEqual(hitCapo, ann[0]);
    // Open candidates render just right of the capo bar — the hit-test must
    // land there too (renderer/hit-test share one mapping).
    ann[1].open = true;
    const hitOpen = _stripHitTestPure(g.xLine(2) + 9, g.rowY(1), g, ann, 2);
    assert.strictEqual(hitOpen, ann[1]);
    // A CURRENT open note under a capo uses the same placement — right-click
    // (finger cycling) must land on the drawn dot.
    ann[1].current = true;
    assert.strictEqual(_stripHitTestPure(g.xLine(2) + 9, g.rowY(1), g, ann, 2), ann[1]);
});

t('finger cycle: none → 1 → 2 → 3 → 4 → T → none, garbage restarts', () => {
    const seq = [-1];
    for (let i = 0; i < 6; i++) seq.push(_stripFingerCyclePure(seq[seq.length - 1]));
    assert.deepStrictEqual(seq, [-1, 1, 2, 3, 4, 0, -1]);
    assert.strictEqual(FINGER_LABELS[0], 'T');
    assert.strictEqual(_stripFingerCyclePure(undefined), 1, 'unset cycles like none');
});

// ── Command layer, through the REAL EditHistory ──────────────────────

function seedArr() {
    const arr = {
        name: 'Lead', tuning: [0, 0, 0, 0, 0, 0], capo: 0,
        notes: [
            { time: 1, string: 0, fret: 5, sustain: 0, techniques: {} },
            { time: 2, string: 4, fret: 5, sustain: 0, techniques: {} },
        ],
        chords: [],
    };
    S.arrangements = [arr];
    S.currentArr = 0;
    S.sel = new Set([0]);
    S.drumEditMode = false; S.tempoMapMode = false; S.partsViewMode = false;
    S.history = new EditHistory();
    return arr;
}

t('click-assign: MoveToStringCmd round-trip clears + re-marks suggested', () => {
    seedArr();
    const n = notes()[0];
    _markSuggested(n);
    const cmd = new MoveToStringCmd([{ index: 0, oldString: 0, oldFret: 5, newString: 1, newFret: 0 }]);
    cmd.pitchPreserving = true;
    S.history.exec(cmd);
    assert.deepStrictEqual({ s: n.string, f: n.fret }, { s: 1, f: 0 }, 'assigned');
    assert.strictEqual(_isSuggested(n), false, 'a deliberate choice confirms the note');
    S.history.doUndo();
    assert.deepStrictEqual({ s: n.string, f: n.fret }, { s: 0, f: 5 }, 'undo restores position');
    assert.strictEqual(_isSuggested(n), true, 'undo restores the suggested mark');
    S.history.doRedo();
    assert.deepStrictEqual({ s: n.string, f: n.fret }, { s: 1, f: 0 }, 'redo re-applies');
    assert.strictEqual(_isSuggested(n), false);
});

t('finger mark: SetTeachingMarkCmd round-trip', () => {
    seedArr();
    const n = notes()[0];
    S.history.exec(new SetTeachingMarkCmd([0], 'fret_finger', 2));
    assert.strictEqual(n.techniques.fret_finger, 2);
    S.history.exec(new SetTeachingMarkCmd([0], 'fret_finger', _stripFingerCyclePure(2)));
    assert.strictEqual(n.techniques.fret_finger, 3);
    S.history.doUndo();
    assert.strictEqual(n.techniques.fret_finger, 2);
    S.history.doUndo();
    assert.strictEqual(n.techniques.fret_finger, undefined, 'back to never-authored');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
