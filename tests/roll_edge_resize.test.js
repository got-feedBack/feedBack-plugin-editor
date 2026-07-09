'use strict';
/*
 * Edge-drag sustain resize in the READ-ONLY fretted roll (V4).
 *
 * A fretted part shown in the piano roll is edit-locked (no silent pitch/position
 * writes) until the suggest-position writer lands. But a sustain edit is a
 * DURATION change — it never changes what a note SOUNDS like, only how long it
 * rings — so it should apply directly, exactly like the VA.5 position-cycle's
 * `pitchPreserving` carve-out. This makes ResizeSustainCmd / ResizeSustainGroupCmd
 * carry `pitchPreserving = true` so the edit lock passes them (and onMouseDown no
 * longer suppresses the edge grab in the read-only roll).
 *
 * On main the resize commands are NOT pitchPreserving, so the edit lock blocks
 * them in a read-only roll — these cases fail on main.
 *
 * Run: node tests/roll_edge_resize.test.js
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const src = fs.readFileSync(path.join(__dirname, '..', 'screen.js'), 'utf8');

function extractBlock(name) {
    const re = new RegExp('/\\* @pure:' + name + ':start[\\s\\S]*?@pure:' + name + ':end \\*/');
    const m = src.match(re);
    if (!m) { console.error(`FAIL: @pure:${name} block not found in screen.js`); process.exit(1); }
    return m[0];
}
function extractClass(name) {
    const start = src.indexOf('class ' + name);
    assert.ok(start >= 0, `class ${name} must exist in screen.js`);
    const open = src.indexOf('{', start);
    let depth = 0;
    for (let i = open; i < src.length; i++) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}' && --depth === 0) return src.slice(start, i + 1);
    }
    throw new Error(`unbalanced braces extracting class ${name}`);
}

let pass = 0, fail = 0;
function t(name, fn) {
    try { fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + (e && e.message)); }
}

// The locked-roll harness: _rollReadOnly ⇒ true, like a fretted part in the roll.
function makeEnv(seed) {
    const S = {
        currentArr: 0,
        arrangements: [{ id: 'a1', name: 'Lead', notes: seed.map(n => ({ ...n })) }],
    };
    const notices = [];
    const fullSrc = '"use strict";'
        + extractBlock('edit-history')
        + '\n' + extractClass('ResizeSustainCmd')
        + '\n' + extractClass('ResizeSustainGroupCmd')
        + '\nconst history = new EditHistory(); S.history = history;'
        + '\nreturn { history, ResizeSustainCmd, ResizeSustainGroupCmd };';
    const env = new Function(
        'S', 'document', 'notes', 'draw', 'updateStatus', '_rollReadOnly', '_rollLockNotice',
        fullSrc
    )(
        S,
        { getElementById: () => null },
        () => S.arrangements[S.currentArr].notes,
        () => {}, () => {},
        () => true,                       // read-only fretted roll
        () => notices.push('LOCKED'),
    );
    return { S, env, notices, notes: () => S.arrangements[0].notes };
}

// ── the flag itself ───────────────────────────────────────────────────────────
t('ResizeSustainCmd and ResizeSustainGroupCmd both declare pitchPreserving', () => {
    const { env } = makeEnv([{ time: 0, string: 3, fret: 1, sustain: 0.5 }]);
    assert.strictEqual(new env.ResizeSustainCmd(0, 1.0).pitchPreserving, true, 'single');
    assert.strictEqual(new env.ResizeSustainGroupCmd([0], [1.0]).pitchPreserving, true, 'group');
});

// ── it passes the read-only-roll lock (the whole point) ───────────────────────
t('a single resize applies in the read-only fretted roll and round-trips', () => {
    const { env, notes } = makeEnv([{ time: 0, string: 3, fret: 1, sustain: 0.5 }]);
    env.history.exec(new env.ResizeSustainCmd(0, 1.25));
    assert.strictEqual(notes()[0].sustain, 1.25, 'resize applied despite the lock');
    assert.strictEqual(env.history.undo.length, 1, 'one undo step (lock passed via pitchPreserving)');
    env.history.doUndo();
    assert.strictEqual(notes()[0].sustain, 0.5, 'undo restored the original duration (undo also passes the lock)');
    env.history.doRedo();
    assert.strictEqual(notes()[0].sustain, 1.25, 'redo re-applied');
});

t('a group resize applies in the read-only fretted roll and round-trips', () => {
    const { env, notes } = makeEnv([
        { time: 0, string: 3, fret: 1, sustain: 0.5 },
        { time: 0, string: 2, fret: 3, sustain: 0.5 },
    ]);
    env.history.exec(new env.ResizeSustainGroupCmd([0, 1], [1.0, 2.0]));
    assert.deepStrictEqual(notes().map(n => n.sustain), [1.0, 2.0], 'both resized despite the lock');
    assert.strictEqual(env.history.undo.length, 1);
    env.history.doUndo();
    assert.deepStrictEqual(notes().map(n => n.sustain), [0.5, 0.5], 'undo restored both durations');
});

// ── the lock is still REAL — only pitchPreserving passes ──────────────────────
t('the read-only-roll lock still blocks an ordinary (non-pitchPreserving) command', () => {
    const { env, notes, notices } = makeEnv([{ time: 0, string: 3, fret: 1, sustain: 0.5 }]);
    let ran = false;
    env.history.exec({ exec() { ran = true; notes()[0].sustain = 9; }, rollback() {} });  // no pitchPreserving
    assert.strictEqual(ran, false, 'an unflagged command stays inert in the locked roll');
    assert.strictEqual(notes()[0].sustain, 0.5, 'nothing was written');
    assert.strictEqual(env.history.undo.length, 0);
    assert.ok(notices.includes('LOCKED'), 'the user is told why');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
