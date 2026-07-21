'use strict';
/*
 * Tests for part reorder (@pure:reorder-part + the real _editorMovePart):
 * move the current part one slot earlier/later. The order persists
 * because sloppak saves ship the CLIENT S.arrangements array and the
 * manifest merge keys by id. The move renumbers indices, so the undo
 * history resets (the remove-arrangement rationale) — pinned here.
 * These fail on main, where reorder doesn't exist.
 *
 * Run: node tests/reorder_part.test.js
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');

function extractBlock(name) {
    const re = new RegExp(
        '/\\* @pure:' + name + ':start \\*/[\\s\\S]*?/\\* @pure:' + name + ':end \\*/');
    const m = src.match(re);
    if (!m) {
        console.error(`FAIL: @pure:${name} block not found in src/main.js`);
        process.exit(1);
    }
    return m[0];
}
function extractFn(name) {
    const start = src.indexOf('function ' + name);
    assert.ok(start >= 0, `function ${name} must exist`);
    const open = src.indexOf('{', start);
    let depth = 0;
    for (let i = open; i < src.length; i++) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}' && --depth === 0) return src.slice(start, i + 1);
    }
    throw new Error(`unbalanced braces extracting ${name}`);
}

let pass = 0, fail = 0;
function t(name, fn) {
    try { fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}

// ── Pure target math ─────────────────────────────────────────────────

const P = new Function(
    '"use strict";' + extractBlock('reorder-part')
    + '\nreturn { _movePartTargetPure };'
)();

t('one-slot moves inside the list; ends and degenerate inputs refuse', () => {
    assert.strictEqual(P._movePartTargetPure(1, -1, 3), 0);
    assert.strictEqual(P._movePartTargetPure(1, +1, 3), 2);
    assert.strictEqual(P._movePartTargetPure(0, -1, 3), -1, 'first can’t move earlier');
    assert.strictEqual(P._movePartTargetPure(2, +1, 3), -1, 'last can’t move later');
    assert.strictEqual(P._movePartTargetPure(0, +1, 1), -1, 'single part never moves');
    assert.strictEqual(P._movePartTargetPure('x', 1, 3), -1);
    assert.strictEqual(P._movePartTargetPure(5, -1, 3), -1, 'out-of-range from');
});

// ── #336 regression: Remove/Reorder button gates count PITCHED parts only ──
// A song with 1 pitched part + a drums arrangement is arrangements.length===2,
// so the pre-fix `length`-based gates wrongly showed Remove (a silent no-op) and
// reorder (which corrupts). The gate must key on the pitched count. Fails pre-fix.
const AFF = new Function(
    '"use strict";' + extractBlock('arr-affordances').replace(/^export\s+/gm, '')
    + '\nreturn { _arrAffordancePure };'
)();

t('a lone pitched part beside a drums arrangement offers neither Remove nor Reorder', () => {
    // pitchedCount 1 (the drums arrangement is excluded before this call).
    const a = AFF._arrAffordancePure(1, 0, 'sess-1', 'sloppak');
    assert.strictEqual(a.canRemove, false, 'Remove hidden — removing the last pitched part is refused');
    assert.strictEqual(a.canReorder, false, 'Reorder hidden — nothing to reorder');
    assert.strictEqual(a.upDisabled, true);
    assert.strictEqual(a.downDisabled, true);
});

t('2 pitched parts on a sloppak session enable Remove + Reorder, bounded at the ends', () => {
    const first = AFF._arrAffordancePure(2, 0, 'sess-1', 'sloppak');
    assert.strictEqual(first.canRemove, true);
    assert.strictEqual(first.canReorder, true);
    assert.strictEqual(first.upDisabled, true, 'first part can’t move earlier');
    assert.strictEqual(first.downDisabled, false, 'first part can move later');
    const last = AFF._arrAffordancePure(2, 1, 'sess-1', 'sloppak');
    // The LAST pitched part (idx 1) can't move down PAST the drums arrangement.
    assert.strictEqual(last.downDisabled, true, 'last pitched part can’t move past drums');
    assert.strictEqual(last.upDisabled, false);
});

t('reorder stays gated to live sloppak sessions even with 2+ pitched parts', () => {
    assert.strictEqual(AFF._arrAffordancePure(2, 0, 'sess-1', 'archive').canReorder, false, 'archive: no reorder');
    assert.strictEqual(AFF._arrAffordancePure(2, 0, '', 'sloppak').canReorder, false, 'no session: no reorder');
    // Remove doesn't depend on session/format — it only needs 2+ pitched parts.
    assert.strictEqual(AFF._arrAffordancePure(2, 0, '', 'archive').canRemove, true);
});

// ── The real handler over an injected environment ────────────────────

// The real helper the handler uses to bound the move — the derived drums
// arrangement (type:"drums", appended last) is never counted.
const pitchedArrangementCount = (arrs) =>
    (Array.isArray(arrs) ? arrs : []).filter(a => !(a && a.type === 'drums')).length;

function makeEnv(arrs, currentArr, format) {
    const S = {
        currentArr,
        arrangements: arrs,
        sel: new Set([0, 1]),
        history: { resets: 0, reset() { this.resets++; } },
        // Reorder persists only through the full-snapshot sloppak save; the
        // handler refuses on any other format. Default to sloppak so the
        // happy-path cases exercise a real move.
        sessionId: 'sess-1',
        format: format || 'sloppak',
    };
    const calls = { selector: 0, draw: 0 };
    const env = new Function(
        'S', '_recState', 'updateArrangementSelector', 'draw', 'updateStatus', 'setStatus',
        'pitchedArrangementCount',
        '"use strict";' + extractBlock('reorder-part') + '\n' + extractFn('_editorMovePart')
        + '\nreturn { move: _editorMovePart };'
    )(
        S, 'idle',
        () => { calls.selector++; },
        () => { calls.draw++; },
        () => {},
        () => {},
        pitchedArrangementCount,
    );
    return { ...env, S, calls };
}

t('moving later swaps adjacents, follows the part, resets history, clears selection', () => {
    const a = { id: 'a', name: 'Lead' }, b = { id: 'b', name: 'Bass' }, c = { id: 'c', name: 'Rhythm' };
    const { move, S, calls } = makeEnv([a, b, c], 0);
    move(+1);
    assert.deepStrictEqual(S.arrangements, [b, a, c], 'same objects, new order');
    assert.strictEqual(S.currentArr, 1, 'selection follows the moved part');
    assert.strictEqual(S.history.resets, 1, 'index renumbering drops the undo stack');
    assert.strictEqual(S.sel.size, 0, 'note selection cleared');
    assert.ok(calls.selector >= 1, 'selector rebuilt');
});

t('moving earlier from the end, then bumping the first slot, is a clean no-op', () => {
    const a = { id: 'a' }, b = { id: 'b' };
    const { move, S } = makeEnv([a, b], 1);
    move(-1);
    assert.deepStrictEqual(S.arrangements, [b, a]);
    assert.strictEqual(S.currentArr, 0);
    const resetsAfterMove = S.history.resets;
    move(-1);   // already first — must be a total no-op
    assert.deepStrictEqual(S.arrangements, [b, a], 'no change');
    assert.strictEqual(S.history.resets, resetsAfterMove, 'no gratuitous history reset');
});

t('archive sessions refuse the move — the order would be lost on save', () => {
    // `_buildSaveBody(false)` only ships the full arrangements snapshot for
    // sloppak; an archive save writes just the active arrangement keyed by
    // `arrangement_index`, so a client-only reorder is silently dropped (and
    // the stale index re-targets the wrong part). The handler must refuse.
    const a = { id: 'a', name: 'Lead' }, b = { id: 'b', name: 'Bass' };
    const { move, S } = makeEnv([a, b], 0, 'archive');
    move(+1);
    assert.deepStrictEqual(S.arrangements, [a, b], 'untouched on archive');
    assert.strictEqual(S.currentArr, 0, 'selection unchanged');
    assert.strictEqual(S.history.resets, 0, 'no history reset when refused');
});

t('recording blocks reordering (a take pins its arrangement index)', () => {
    const a = { id: 'a' }, b = { id: 'b' };
    const S = {
        currentArr: 0, arrangements: [a, b], sel: new Set(),
        history: { resets: 0, reset() { this.resets++; } },
    };
    const env = new Function(
        'S', '_recState', 'updateArrangementSelector', 'draw', 'updateStatus', 'setStatus',
        'pitchedArrangementCount',
        '"use strict";' + extractBlock('reorder-part') + '\n' + extractFn('_editorMovePart')
        + '\nreturn { move: _editorMovePart };'
    )(S, 'recording', () => {}, () => {}, () => {}, () => {}, pitchedArrangementCount);
    env.move(+1);
    assert.deepStrictEqual(S.arrangements, [a, b], 'untouched mid-take');
    assert.strictEqual(S.history.resets, 0);
});

// ── #336 regression: a pitched part must never move PAST the drums arrangement ──
// The drums arrangement is appended LAST (type:"drums"). Bounding the move by
// arrangements.length (instead of the pitched count) let the last pitched part
// swap BELOW drums — breaking append-last and shifting every arr:<idx> mix key
// (mute/solo/vol then apply to the wrong part). Fails pre-fix.
const drums = () => ({ id: 'drums', name: 'Drums', type: 'drums' });

t('the last pitched part cannot move later past the drums arrangement (no-op)', () => {
    const a = { id: 'a', name: 'Lead' }, b = { id: 'b', name: 'Bass' }, d = drums();
    // Bass is the last PITCHED part (idx 1); drums sits at idx 2.
    const { move, S } = makeEnv([a, b, d], 1);
    move(+1);
    assert.deepStrictEqual(S.arrangements, [a, b, d], 'order unchanged — Bass stays above drums');
    assert.strictEqual(S.currentArr, 1, 'selection unchanged');
    assert.strictEqual(S.arrangements[2].type, 'drums', 'drums stays LAST (append-last held)');
    assert.strictEqual(S.history.resets, 0, 'no history reset on a refused move');
});

t('a single pitched part beside drums cannot reorder at all (no-op)', () => {
    const a = { id: 'a', name: 'Lead' }, d = drums();
    const { move, S } = makeEnv([a, d], 0);
    move(+1);
    assert.deepStrictEqual(S.arrangements, [a, d], 'Lead never swaps below drums');
    assert.strictEqual(S.arrangements[1].type, 'drums', 'drums stays last');
});

t('a valid pitched move still works with drums present, and drums stays last (arr:idx integrity)', () => {
    const a = { id: 'a', name: 'Lead' }, b = { id: 'b', name: 'Bass' }, d = drums();
    const { move, S } = makeEnv([a, b, d], 0);   // move Lead later
    move(+1);
    assert.deepStrictEqual(S.arrangements, [b, a, d], 'pitched parts swapped, drums untouched');
    assert.strictEqual(S.currentArr, 1, 'selection follows the moved part');
    assert.strictEqual(S.arrangements[2].type, 'drums', 'drums remains the last (arr:2) entry');
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
