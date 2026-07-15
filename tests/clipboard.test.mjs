/*
 * The note clipboard as FIRST-CLASS commands (Ctrl+C / Ctrl+X / Ctrl+V).
 *
 * Copy/paste existed only as inline keydown code: invisible to the shortcut
 * panel, the Edit menu and the command palette; no Cut at all; techniques
 * copied with a SHALLOW spread (every paste shared one bend-curve array with
 * the original — editing any corrupted all); paste ignored snap and pasted
 * onto strings the target track doesn't have. This suite pins the fixed
 * behaviour: relative-time packing, deep-clone independence, the lane clamp,
 * the t≥0 clamp, and the full copy → cut → paste verb flow through the real
 * EditHistory (exec → rollback deep-equality → redo).
 *
 * Fails on main (the pures and verbs don't exist there).
 * Run: node tests/clipboard.test.mjs
 */
import assert from 'node:assert';

globalThis.document = globalThis.document || {
    getElementById: () => null, addEventListener: () => {}, activeElement: null,
};
globalThis.localStorage = globalThis.localStorage || { getItem: () => null, setItem: () => {} };
globalThis.window = globalThis.window || globalThis;

const {
    _clipboardPackPure, _clipboardPastePlanPure,
    _editorCopySelection, _editorPasteAtPlayhead,
} = await import('../src/input.js');
const { S } = await import('../src/state.js');
const { EditHistory } = await import('../src/history.js');

let pass = 0, fail = 0;
function t(name, fn) {
    try { fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}

const N = (time, string, fret, extra = {}) =>
    ({ time, string, fret, sustain: 0, techniques: {}, ...extra });

// ── the pures ────────────────────────────────────────────────────────

t('pack stores times RELATIVE to the earliest note, sorted', () => {
    const clip = _clipboardPackPure([N(4, 1, 3), N(2, 0, 5), N(3, 2, 7)], 0, false);
    assert.deepStrictEqual(clip.notes.map(c => c.dt), [0, 1, 2]);
    assert.deepStrictEqual(clip.notes.map(c => c.fret), [5, 7, 3], 'sorted by time, not input order');
    assert.strictEqual(_clipboardPackPure([], 0, false), null);
});

t('bend curves are DEEP-copied — no paste ever shares an array with the source', () => {
    const src = N(1, 0, 5, { techniques: { bend: 1, bend_values: [{ t: 0, v: 1 }] } });
    const clip = _clipboardPackPure([src], 0, false);
    src.techniques.bend_values[0].v = 99;                       // mutate the ORIGINAL
    assert.strictEqual(clip.notes[0].techniques.bend_values[0].v, 1, 'clipboard unaffected');
    const a = _clipboardPastePlanPure(clip, 10, 6).notes[0];
    const b = _clipboardPastePlanPure(clip, 20, 6).notes[0];
    a.techniques.bend_values[0].v = 42;                         // mutate ONE paste
    assert.strictEqual(b.techniques.bend_values[0].v, 1, 'sibling paste unaffected');
    assert.strictEqual(clip.notes[0].techniques.bend_values[0].v, 1, 'clipboard still unaffected');
});

t('the paste plan retimes at the anchor, clamps t≥0, and skips missing strings', () => {
    const clip = _clipboardPackPure([N(2, 0, 1), N(3, 5, 2)], 0, false);
    const plan = _clipboardPastePlanPure(clip, 10, 6);
    assert.deepStrictEqual(plan.notes.map(n => n.time), [10, 11]);
    // A 4-string target: the string-5 note has nowhere to go — kept honest.
    const bass = _clipboardPastePlanPure(clip, 10, 4);
    assert.strictEqual(bass.notes.length, 1);
    assert.strictEqual(bass.laneSkipped, 1);
    assert.strictEqual(_clipboardPastePlanPure(null, 10, 6), null);
});

// ── the verbs through the real history ───────────────────────────────

function seed(notes) {
    Object.assign(S, {
        arrangements: [{ name: 'Lead', tuning: [0, 0, 0, 0, 0, 0], capo: 0, notes }],
        currentArr: 0,
        sel: new Set(notes.map((_, i) => i)),
        drumEditMode: false, tempoMapMode: false,
        cursorTime: 0, snapEnabled: false, beats: [],
        history: new EditHistory(),
    });
}

t('copy → move playhead → paste lands the phrase at the playhead, selected, one undo', () => {
    const notes = [N(1, 0, 3), N(1.5, 1, 5)];
    seed(notes);
    assert.strictEqual(_editorCopySelection(false), true);
    S.cursorTime = 8;
    S.sel.clear();
    assert.strictEqual(_editorPasteAtPlayhead(), true);
    const nn = S.arrangements[0].notes;
    assert.strictEqual(nn.length, 4);
    const pasted = nn.filter(n => n.time >= 8);
    assert.deepStrictEqual(pasted.map(n => n.time), [8, 8.5], 'internal timing preserved');
    assert.strictEqual(S.sel.size, 2, 'the pasted notes are selected');
    assert.strictEqual(S.history.undo.length, 1, 'one undoable step');
    const before = JSON.stringify(nn.map(n => ({ t: n.time, s: n.string, f: n.fret })));
    S.history.doUndo();
    assert.strictEqual(S.arrangements[0].notes.length, 2, 'undo removes the paste');
    S.history.doRedo();
    assert.strictEqual(JSON.stringify(S.arrangements[0].notes.map(n => ({ t: n.time, s: n.string, f: n.fret }))),
        before, 'redo reproduces exactly');
});

t('cut removes the notes (undoably) and the clipboard survives the undo', () => {
    seed([N(1, 0, 3), N(2, 1, 5)]);
    assert.strictEqual(_editorCopySelection(true), true);
    assert.strictEqual(S.arrangements[0].notes.length, 0, 'cut removed them');
    S.history.doUndo();
    assert.strictEqual(S.arrangements[0].notes.length, 2, 'undo restores the notes');
    // …but the clipboard still pastes (the text-editor contract).
    S.cursorTime = 10;
    S.sel.clear();
    assert.strictEqual(_editorPasteAtPlayhead(), true);
    assert.strictEqual(S.arrangements[0].notes.length, 4);
});

t('mode and shape guards: drum/tempo modes refuse; keys↔fretted refuses', () => {
    seed([N(1, 0, 3)]);
    _editorCopySelection(false);
    S.drumEditMode = true;
    assert.strictEqual(_editorPasteAtPlayhead(), false, 'drum mode → not handled');
    S.drumEditMode = false;
    S.tempoMapMode = true;
    assert.strictEqual(_editorPasteAtPlayhead(), false, 'tempo map → not handled');
    S.tempoMapMode = false;
    // The keys↔fretted refusal, actually exercised: copy from the fretted
    // track, then try to paste onto a keys-named arrangement — refused
    // (handled, but nothing added), and the reverse direction refuses too.
    S.arrangements.push({ name: 'Keys', tuning: [], capo: 0, notes: [] });
    S.currentArr = 1;
    S.cursorTime = 10;
    assert.strictEqual(_editorPasteAtPlayhead(), true, 'handled (status message)');
    assert.strictEqual(S.arrangements[1].notes.length, 0, 'nothing pasted onto keys');
    S.arrangements[1].notes = [N(1, 0, 60)];
    S.sel = new Set([0]);
    _editorCopySelection(false);                     // keys-shaped clipboard
    S.currentArr = 0;
    assert.strictEqual(_editorPasteAtPlayhead(), true);
    assert.strictEqual(S.arrangements[0].notes.length, 1, 'nothing pasted onto fretted');
});

t('registry-path write guards: Tracks overview blocks cut and paste (copy stays free)', () => {
    // Menu/palette dispatch bypasses onKeyDown's gates — the commands
    // themselves must refuse writes in the read-only Tracks overview.
    seed([N(1, 0, 3), N(2, 1, 5)]);
    _editorCopySelection(false);
    S.partsViewMode = true;
    assert.strictEqual(_editorPasteAtPlayhead(), true, 'handled (refusal status)');
    assert.strictEqual(S.arrangements[0].notes.length, 2, 'paste blocked in the overview');
    assert.strictEqual(_editorCopySelection(true), true);
    assert.strictEqual(S.arrangements[0].notes.length, 2, 'cut blocked in the overview');
    assert.strictEqual(_editorCopySelection(false), true, 'plain copy is a read — allowed');
    S.partsViewMode = false;
    S.cursorTime = 10;
    assert.strictEqual(_editorPasteAtPlayhead(), true);
    assert.strictEqual(S.arrangements[0].notes.length, 4, 'leaving the overview unblocks');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
