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

const src = fs.readFileSync(path.join(__dirname, '..', 'screen.js'), 'utf8');

function extractBlock(name) {
    const re = new RegExp(
        '/\\* @pure:' + name + ':start \\*/[\\s\\S]*?/\\* @pure:' + name + ':end \\*/');
    const m = src.match(re);
    if (!m) {
        console.error(`FAIL: @pure:${name} block not found in screen.js`);
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

// ── The real handler over an injected environment ────────────────────

function makeEnv(arrs, currentArr) {
    const S = {
        currentArr,
        arrangements: arrs,
        sel: new Set([0, 1]),
        history: { resets: 0, reset() { this.resets++; } },
    };
    const calls = { selector: 0, draw: 0 };
    const env = new Function(
        'S', '_recState', 'updateArrangementSelector', 'draw', 'updateStatus', 'setStatus',
        '"use strict";' + extractBlock('reorder-part') + '\n' + extractFn('_editorMovePart')
        + '\nreturn { move: _editorMovePart };'
    )(
        S, 'idle',
        () => { calls.selector++; },
        () => { calls.draw++; },
        () => {},
        () => {},
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

t('recording blocks reordering (a take pins its arrangement index)', () => {
    const a = { id: 'a' }, b = { id: 'b' };
    const S = {
        currentArr: 0, arrangements: [a, b], sel: new Set(),
        history: { resets: 0, reset() { this.resets++; } },
    };
    const env = new Function(
        'S', '_recState', 'updateArrangementSelector', 'draw', 'updateStatus', 'setStatus',
        '"use strict";' + extractBlock('reorder-part') + '\n' + extractFn('_editorMovePart')
        + '\nreturn { move: _editorMovePart };'
    )(S, 'recording', () => {}, () => {}, () => {}, () => {});
    env.move(+1);
    assert.deepStrictEqual(S.arrangements, [a, b], 'untouched mid-take');
    assert.strictEqual(S.history.resets, 0);
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
