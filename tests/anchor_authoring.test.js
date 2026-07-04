'use strict';
/*
 * Anchor authoring semantics — the "promote preserves the full computed set"
 * fix (got-feedback/feedback-plugin-editor#5, charrette PR 2).
 *
 * The backend treats a non-empty `anchors_user` as the COMPLETE authored anchor
 * list (empty => recompute from notes/source). The editor lane previously
 * promoted only the clicked computed/source anchor into `anchors_user`, so the
 * first interaction collapsed a whole computed set down to one anchor and
 * dropped the rest on save. This test pulls the REAL anchor authoring source
 * (screen.js is a single browser IIFE) by brace-matching, runs it against a
 * fake `S` + undo history, and pins that both authoring entry points — clicking
 * a fallback marker and adding a new anchor in empty space — materialize the
 * WHOLE fallback set first.
 *
 * Run: node tests/anchor_authoring.test.js
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const src = fs.readFileSync(path.join(__dirname, '..', 'screen.js'), 'utf8');

// Brace-match a `function name(` / `class Name ` declaration out of the IIFE.
function extractDecl(header) {
    const start = src.indexOf(header);
    if (start < 0) throw new Error('decl not found: ' + header);
    const open = src.indexOf('{', start);
    let depth = 0;
    for (let i = open; i < src.length; i++) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}') { depth--; if (depth === 0) return src.slice(start, i + 1); }
    }
    throw new Error('unbalanced braces: ' + header);
}

const sandbox = new Function('S', '"use strict";' + [
    extractDecl('function _readAnchorSnapshot('),
    extractDecl('function _ensureAnchors('),
    extractDecl('function _bumpAnchorsDirty('),
    extractDecl('function _anchorsAreDirty('),
    extractDecl('class PromoteAnchorsCmd '),
    extractDecl('class AddAnchorCmd '),
    extractDecl('function _promoteAnchor('),
    extractDecl('function _promoteAutoAnchorsIfNeeded('),
].join('\n') +
    '\nreturn { _readAnchorSnapshot, _ensureAnchors, _bumpAnchorsDirty, _anchorsAreDirty,' +
    ' PromoteAnchorsCmd, AddAnchorCmd, _promoteAnchor, _promoteAutoAnchorsIfNeeded };');

function makeEnv(arr) {
    const undoStack = [];
    const S = {
        arrangements: [arr],
        currentArr: 0,
        anchorSel: null,
        history: {
            exec(cmd) { cmd.exec(); undoStack.push(cmd); },
            undo() { const c = undoStack.pop(); if (c) c.rollback(); },
        },
    };
    return { S, api: sandbox(S) };
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

// 4. Second entry point: adding a new anchor in empty space seeds the fallback
//    first, so the computed anchors aren't dropped by the first authored insert.
t('add-new seeds the fallback before the first authored insert', () => {
    const arr = computedArr();
    const { S, api } = makeEnv(arr);
    api._promoteAutoAnchorsIfNeeded(arr);
    assert.strictEqual(arr.anchors_user.length, 3, 'fallback materialized first');
    S.history.exec(new api.AddAnchorCmd(0, { time: 7, fret: 2, width: 4 }));
    assert.strictEqual(arr.anchors_user.length, 4, '3 computed + 1 new');
    assert.ok(arr.anchors_user.some(a => a.time === 7 && a.fret === 2), 'new anchor present');
    assert.deepStrictEqual(
        arr.anchors_user.filter(a => a.time !== 7).map(a => [a.time, a.fret, a.width]),
        [[0, 1, 4], [5, 5, 4], [10, 9, 5]], 'computed anchors intact');
});

// 5. _promoteAutoAnchorsIfNeeded is a no-op once authored, and seeds an empty
//    list (no phantom anchor) when there's nothing to preserve.
t('_promoteAutoAnchorsIfNeeded: no-op when authored; empty when nothing to seed', () => {
    const authored = { anchors: [{ time: 0, fret: 1, width: 4 }], anchors_user: [{ time: 3, fret: 4, width: 4 }] };
    makeEnv(authored).api._promoteAutoAnchorsIfNeeded(authored);
    assert.strictEqual(authored.anchors_user.length, 1, 'authored list untouched');

    const empty = { anchors: [] };
    makeEnv(empty).api._promoteAutoAnchorsIfNeeded(empty);
    assert.ok(Array.isArray(empty.anchors_user) && empty.anchors_user.length === 0);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
