'use strict';
/*
 * Tests for drum-editor undo (AddDrumHitCmd / DeleteDrumHitsCmd /
 * MoveDrumHitsCmd / ToggleDrumArticulationCmd) and the EditHistory
 * hardening (MAX_UNDO cap + arrangement tagging).
 *
 * Bug: every drum mutation (click-add, drag-move, Del, g/f/k articulation)
 * bypassed EditHistory — a mis-drag or stray Delete was unrecoverable, and
 * Ctrl+Z in drum-edit mode silently undid the LAST NOTE EDIT in the hidden
 * guitar/keys arrangement instead. The commands here hold hit REFERENCES
 * (never indices — the hits array is re-sorted after adds/moves and replaced
 * by delete's filter()) and mark S.drumTabDirty on both exec and rollback so
 * a save after undo persists the reverted state.
 *
 * Also covers the new EditHistory hardening:
 *   - the undo stack is capped at MAX_UNDO (oldest dropped first);
 *   - exec() tags each command with the active arrangement (`_arrIdx`) so
 *     undo/redo can route back to it; `songScope` commands tag -1.
 *
 * screen.js is a single browser IIFE, so this extracts the marked
 * `@pure:drum-cmds` + `@pure:edit-history` blocks (browser-free) and eval's
 * them in isolation — real source, no drift.
 *
 * Run: node tests/drum_undo.test.js
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');

function extract(name) {
    const re = new RegExp(
        '/\\* @pure:' + name + ':start \\*/[\\s\\S]*?/\\* @pure:' + name + ':end \\*/');
    const m = src.match(re);
    if (!m) {
        console.error(`FAIL: @pure:${name} block not found in screen.js`);
        process.exit(1);
    }
    return m[0];
}

const drumBlock = extract('drum-cmds');
const historyBlock = extract('edit-history');

// Build an isolated environment. The drum commands read S.drumTab/S.drumSel
// and call updateArrangementSelector() (a DOM refresher — stubbed to a call
// counter). EditHistory's doUndo/doRedo call draw()/updateStatus() (stubbed
// no-ops) and read S.currentArr through a typeof guard, so passing S in makes
// the tagging observable. _historyEnsureArr lives OUTSIDE the pure block on
// purpose (it touches window/document); the typeof guard skips it here.
function makeEnv() {
    const S = {
        drumTab: { hits: [] },
        drumSel: new Set(),
        drumTabDirty: false,
        currentArr: 0,
    };
    const calls = { selector: 0 };
    const env = new Function(
        'document', 'S', 'updateArrangementSelector', 'draw', 'updateStatus',
        '"use strict";'
        + historyBlock + '\n' + drumBlock + '\n'
        + 'return { EditHistory, AddDrumHitCmd, DeleteDrumHitsCmd, '
        + 'MoveDrumHitsCmd, ToggleDrumArticulationCmd, _drumSortAndRemapSel };'
    )(
        { getElementById: () => null },
        S,
        () => { calls.selector++; },
        () => {},
        () => {},
    );
    return { ...env, S, calls, history: new env.EditHistory() };
}

let pass = 0, fail = 0;
function t(name, fn) {
    try { fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}

// ── AddDrumHitCmd ────────────────────────────────────────────────────────────
t('add: exec inserts sorted, sets dirty, refreshes selector; undo removes', () => {
    const { S, calls, history, AddDrumHitCmd } = makeEnv();
    S.drumTab.hits = [{ t: 1.0, p: 'kick' }, { t: 3.0, p: 'snare' }];
    const hit = { t: 2.0, p: 'hh_closed', v: 100 };
    history.exec(new AddDrumHitCmd(hit));
    assert.deepStrictEqual(S.drumTab.hits.map(h => h.t), [1.0, 2.0, 3.0], 'sorted insert');
    assert.strictEqual(S.drumTabDirty, true, 'dirty after exec');
    assert.ok(calls.selector >= 1, 'selector refreshed');
    S.drumTabDirty = false;
    history.doUndo();
    assert.deepStrictEqual(S.drumTab.hits.map(h => h.t), [1.0, 3.0], 'undo removed the hit');
    assert.strictEqual(S.drumTabDirty, true, 'dirty after rollback (save persists the undo)');
    history.doRedo();
    assert.deepStrictEqual(S.drumTab.hits.map(h => h.t), [1.0, 2.0, 3.0], 'redo re-adds');
});

t('add: existing selection survives the resort by ref', () => {
    const { S, history, AddDrumHitCmd } = makeEnv();
    const a = { t: 2.0, p: 'snare' };
    S.drumTab.hits = [a, { t: 3.0, p: 'kick' }];
    S.drumSel = new Set([0]);           // "a" selected at index 0
    history.exec(new AddDrumHitCmd({ t: 1.0, p: 'kick' }));  // sorts "a" to index 1
    assert.deepStrictEqual([...S.drumSel], [1], 'selection followed the ref through the sort');
    assert.strictEqual(S.drumTab.hits[1], a);
});

t('add: exec creates hits array on a malformed drum_tab', () => {
    const { S, history, AddDrumHitCmd } = makeEnv();
    S.drumTab = {};                     // older/malformed: no hits array
    history.exec(new AddDrumHitCmd({ t: 1.0, p: 'kick' }));
    assert.strictEqual(S.drumTab.hits.length, 1);
});

// ── DeleteDrumHitsCmd ────────────────────────────────────────────────────────
t('delete: exec removes refs + clears selection; undo restores sorted + reselects', () => {
    const { S, history, DeleteDrumHitsCmd } = makeEnv();
    const a = { t: 1.0, p: 'kick' }, b = { t: 2.0, p: 'snare' }, c = { t: 3.0, p: 'ride' };
    S.drumTab.hits = [a, b, c];
    S.drumSel = new Set([0, 2]);
    history.exec(new DeleteDrumHitsCmd([a, c]));
    assert.deepStrictEqual(S.drumTab.hits, [b], 'refs removed');
    assert.strictEqual(S.drumSel.size, 0, 'selection cleared');
    history.doUndo();
    assert.deepStrictEqual(S.drumTab.hits.map(h => h.t), [1.0, 2.0, 3.0], 'restored in time order');
    assert.deepStrictEqual([...S.drumSel].sort(), [0, 2], 'restored hits reselected');
    history.doRedo();
    assert.deepStrictEqual(S.drumTab.hits, [b], 'redo re-deletes');
});

// ── MoveDrumHitsCmd ──────────────────────────────────────────────────────────
t('move: revert-then-exec applies new values; undo restores originals + order', () => {
    const { S, history, MoveDrumHitsCmd } = makeEnv();
    const a = { t: 1.0, p: 'kick' }, b = { t: 2.0, p: 'snare' };
    S.drumTab.hits = [a, b];
    // Simulate the drag-end finalize: live drag moved `a` to t=3.0/lane ride,
    // then reverted it to the origin before exec (the note-drag pattern).
    history.exec(new MoveDrumHitsCmd([a], [1.0], ['kick'], [3.0], ['ride']));
    assert.strictEqual(a.t, 3.0);
    assert.strictEqual(a.p, 'ride');
    assert.deepStrictEqual(S.drumTab.hits, [b, a], 'resorted after the move');
    assert.deepStrictEqual([...S.drumSel], [1], 'moved hit stays selected through the sort');
    history.doUndo();
    assert.strictEqual(a.t, 1.0);
    assert.strictEqual(a.p, 'kick');
    assert.deepStrictEqual(S.drumTab.hits, [a, b], 'order restored');
    history.doRedo();
    assert.strictEqual(a.t, 3.0, 'redo replays the move');
});

// ── ToggleDrumArticulationCmd ────────────────────────────────────────────────
t('articulation: mixed ghost states round-trip exactly under undo', () => {
    const { S, history, ToggleDrumArticulationCmd } = makeEnv();
    const a = { t: 1.0, p: 'snare', g: true }, b = { t: 2.0, p: 'snare' };
    S.drumTab.hits = [a, b];
    history.exec(new ToggleDrumArticulationCmd([a, b], 'g'));
    assert.strictEqual(a.g, undefined, 'ghost removed where set');
    assert.strictEqual(b.g, true, 'ghost added where unset');
    history.doUndo();
    assert.strictEqual(a.g, true, 'original ghost restored');
    assert.strictEqual(b.g, undefined, 'original non-ghost restored');
});

t('articulation: choke toggles 0.08 on/off and round-trips', () => {
    const { S, history, ToggleDrumArticulationCmd } = makeEnv();
    const cym = { t: 1.0, p: 'crash_l' };
    S.drumTab.hits = [cym];
    history.exec(new ToggleDrumArticulationCmd([cym], 'k'));
    assert.strictEqual(cym.k, 0.08, 'choke set');
    history.doUndo();
    assert.strictEqual(cym.k, undefined, 'choke removed on undo');
});

// ── EditHistory hardening ────────────────────────────────────────────────────
t('history: undo stack is capped at 500, oldest dropped first', () => {
    const { history } = makeEnv();
    let applied = 0;
    for (let i = 0; i < 505; i++) {
        history.exec({ exec() { applied++; }, rollback() { applied--; } });
    }
    assert.strictEqual(history.undo.length, 500, 'capped at MAX_UNDO');
    assert.strictEqual(applied, 505, 'all commands executed');
    while (history.undo.length) history.doUndo();
    assert.strictEqual(applied, 5, 'the 5 evicted commands stay applied');
});

t('history: exec tags commands with the active arrangement; songScope tags -1', () => {
    const { S, history, AddDrumHitCmd } = makeEnv();
    S.currentArr = 2;
    const noteCmd = { exec() {}, rollback() {} };
    history.exec(noteCmd);
    assert.strictEqual(noteCmd._arrIdx, 2, 'arrangement-scoped command tagged with currentArr');
    const drumCmd = new AddDrumHitCmd({ t: 1.0, p: 'kick' });
    history.exec(drumCmd);
    assert.strictEqual(drumCmd._arrIdx, -1, 'songScope command tagged -1');
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
