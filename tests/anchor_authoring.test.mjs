/*
 * Anchor authoring semantics — the "promote preserves the full computed set"
 * fix (got-feedback/feedback-plugin-editor#5, charrette PR 2).
 *
 * The backend treats a non-empty `anchors_user` as the COMPLETE authored anchor
 * list (empty => recompute from notes/source). The editor lane previously
 * promoted only the clicked computed/source anchor into `anchors_user`, so the
 * first interaction collapsed a whole computed set down to one anchor and
 * dropped the rest on save. This drives the REAL anchor authoring code from
 * src/annotation-lanes.js against a seeded `S` + a recording undo history, and
 * pins that both authoring entry points — clicking a fallback marker and adding
 * a new anchor in empty space — materialize the WHOLE fallback set first.
 *
 * Run: node tests/anchor_authoring.test.mjs
 */
import assert from 'node:assert';
import {
    AddAnchorCmd, PromoteAnchorsCmd, _anchorsAreDirty, _bumpAnchorsDirty, _ensureAnchors,
    _promoteAnchor, _readAnchorSnapshot,
} from '../src/annotation-lanes.js';
import { seedState } from './_history_env.mjs';

const api = {
    AddAnchorCmd, PromoteAnchorsCmd, _anchorsAreDirty, _bumpAnchorsDirty, _ensureAnchors,
    _promoteAnchor, _readAnchorSnapshot,
};

// annotation-lanes.js closes over the REAL `S`, so seed that rather than
// fabricating one. The history stays a recording stub: these cases assert on
// exec/rollback, not on EditHistory's stack or its read-only-roll lock.
function makeEnv(arr) {
    const undoStack = [];
    const S = seedState({ arrangements: [arr], currentArr: 0, anchorSel: null });
    S.history = {
        exec(cmd) { cmd.exec(); undoStack.push(cmd); },
        undo() { const c = undoStack.pop(); if (c) c.rollback(); },
    };
    return { S, api };
}

// A computed/source fallback set with no authored overrides yet.
function computedArr() {
    return {
        anchors: [
            { time: 0, fret: 1, width: 4 },
            { time: 5, fret: 5, width: 4 },
            { time: 10, fret: 9, width: 5 },
        ],
        // anchors_user absent -> fallback is active
    };
}

let pass = 0, fail = 0;
function t(name, fn) {
    try { fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}

// 1. The regression: promoting ONE computed anchor seeds the WHOLE set.
t('promote seeds the full computed set, not a lone anchor', () => {
    const arr = computedArr();
    const { api } = makeEnv(arr);
    const snap0 = api._readAnchorSnapshot(arr);
    assert.strictEqual(snap0.isAuto, true);
    assert.strictEqual(snap0.list.length, 3);

    const target = api._promoteAnchor(arr, arr.anchors[1], true);
    assert.strictEqual(arr.anchors_user.length, 3, 'all 3 preserved (not collapsed to 1)');
    assert.ok(target && arr.anchors_user.includes(target), 'returns the clicked anchor copy');
    assert.strictEqual(target.fret, 5);
    assert.deepStrictEqual(
        arr.anchors_user.map(a => [a.time, a.fret, a.width]),
        [[0, 1, 4], [5, 5, 4], [10, 9, 5]], 'every anchor value preserved');
    assert.ok(!arr.anchors.includes(target), 'seeded copies are fresh objects');

    const snap1 = api._readAnchorSnapshot(arr);
    assert.strictEqual(snap1.isAuto, false);
    assert.strictEqual(snap1.list, arr.anchors_user);
});

// 2. Undo a promote restores the empty => recompute fallback state.
t('undo promote restores the fallback (empty anchors_user)', () => {
    const arr = computedArr();
    const { S, api } = makeEnv(arr);
    api._promoteAnchor(arr, arr.anchors[0], true);
    assert.strictEqual(api._anchorsAreDirty(arr), true);
    S.history.undo();
    assert.strictEqual(arr.anchors_user.length, 0);
    assert.strictEqual(api._anchorsAreDirty(arr), false);
    assert.strictEqual(api._readAnchorSnapshot(arr).isAuto, true);
});

// 3. Already-authored markers pass through untouched (idempotent).
t('promote is a no-op for an already-authored marker', () => {
    const arr = { anchors: [], anchors_user: [{ time: 2, fret: 3, width: 4 }] };
    const { api } = makeEnv(arr);
    const a = arr.anchors_user[0];
    assert.strictEqual(api._promoteAnchor(arr, a, false), a);
    assert.strictEqual(arr.anchors_user.length, 1);
});

// 4. Second entry point: adding a new anchor in empty space while on the
//    fallback seeds the whole computed set AND the new anchor in ONE command,
//    so the computed anchors aren't dropped — and a single undo fully reverts
//    the gesture back to the empty => recompute fallback (the regression: two
//    commands left the seeded set behind, still saved as authored).
t('add-new on fallback: one command seeds the set + new anchor, one undo reverts', () => {
    const arr = computedArr();
    const { S, api } = makeEnv(arr);
    const anchor = { time: 7, fret: 2, width: 4 };
    S.history.exec(new api.PromoteAnchorsCmd(0, arr.anchors, null, anchor));
    assert.strictEqual(arr.anchors_user.length, 4, '3 computed + 1 new');
    assert.ok(arr.anchors_user.includes(anchor), 'the new anchor is seeded by reference');
    assert.strictEqual(api._anchorsAreDirty(arr), true);
    assert.deepStrictEqual(
        arr.anchors_user.filter(a => a !== anchor).map(a => [a.time, a.fret, a.width]),
        [[0, 1, 4], [5, 5, 4], [10, 9, 5]], 'computed anchors intact');
    // A SINGLE undo returns to the empty => recompute-on-save fallback.
    S.history.undo();
    assert.strictEqual(arr.anchors_user.length, 0, 'one undo clears the whole gesture');
    assert.strictEqual(api._anchorsAreDirty(arr), false, 'not dirty -> not saved as authored');
    assert.strictEqual(api._readAnchorSnapshot(arr).isAuto, true);
});

// 5. On an already-authored arrangement a new anchor is a plain single add
//    (no re-seeding of the computed set), reverted by a single undo.
t('add-new when already authored is a plain single add', () => {
    const arr = { anchors: [{ time: 0, fret: 1, width: 4 }], anchors_user: [{ time: 3, fret: 4, width: 4 }] };
    const { S, api } = makeEnv(arr);
    const anchor = { time: 8, fret: 6, width: 4 };
    S.history.exec(new api.AddAnchorCmd(0, anchor));
    assert.strictEqual(arr.anchors_user.length, 2, 'existing authored anchor + the new one');
    S.history.undo();
    assert.strictEqual(arr.anchors_user.length, 1, 'back to the single authored anchor');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
