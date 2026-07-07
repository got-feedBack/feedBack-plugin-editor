'use strict';
/*
 * Tests for the undoable part rename (@pure:rename-arr block + the real
 * RenameArrangementCmd): renames are display-label edits, undoable, and
 * HARD-guarded against changing the part's inferred instrument kind —
 * the name still drives lane layout (/bass/i → 4 lanes), the piano roll
 * (keys pattern) and drum routing, so a cross-kind rename would strand
 * notes on invisible strings. Unblocked by #101 (manifest merge keeps
 * `type`/unknown keys across saves). These fail on main, where none of
 * this exists.
 *
 * Run: node tests/rename_part.test.js
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
function extractClass(name) {
    const start = src.indexOf('class ' + name);
    assert.ok(start >= 0, `class ${name} must exist`);
    const open = src.indexOf('{', start);
    let depth = 0;
    for (let i = open; i < src.length; i++) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}' && --depth === 0) return src.slice(start, i + 1);
    }
    throw new Error(`unbalanced braces extracting ${name}`);
}
const KEYS_PATTERN_SRC = (src.match(/const KEYS_PATTERN = [^\n]+\n/) || [null])[0];
assert.ok(KEYS_PATTERN_SRC, 'KEYS_PATTERN must exist');

let pass = 0, fail = 0;
function t(name, fn) {
    try { fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}

// ── Pure: kind inference + rename guard ──────────────────────────────

const P = new Function(
    '"use strict";' + KEYS_PATTERN_SRC + extractBlock('rename-arr')
    + '\nreturn { _arrKindPure, _renameGuardPure };'
)();

t('kind inference mirrors the layout rules: keys > drums > bass > guitar', () => {
    assert.strictEqual(P._arrKindPure('Piano'), 'keys');
    assert.strictEqual(P._arrKindPure('Synth Bass'), 'keys', 'keys pattern wins over /bass/i');
    assert.strictEqual(P._arrKindPure('Drums'), 'drums');
    assert.strictEqual(P._arrKindPure('Bass'), 'bass');
    assert.strictEqual(P._arrKindPure('Lead'), 'guitar');
    assert.strictEqual(P._arrKindPure(''), 'guitar');
});

t('same-kind renames pass, trimmed', () => {
    const g = P._renameGuardPure('Lead', '  Solo Guitar  ', ['Rhythm']);
    assert.deepStrictEqual(g, { ok: true, reason: '', name: 'Solo Guitar' });
    assert.strictEqual(P._renameGuardPure('Bass', 'Fretless Bass', []).ok, true);
    assert.strictEqual(P._renameGuardPure('Piano', 'Piano 2', []).ok, true);
    // KEYS_PATTERN is start-anchored (the layout rule): "Electric Piano"
    // is NOT a keys name, so renaming a keys part to it must refuse —
    // the guard mirrors what the lane/roll routing would actually do.
    assert.strictEqual(P._renameGuardPure('Piano', 'Electric Piano', []).ok, false);
});

t('cross-kind renames refuse and say why', () => {
    const g = P._renameGuardPure('Lead', 'Bass 2', []);
    assert.strictEqual(g.ok, false);
    assert.ok(/guitar → bass/.test(g.reason), 'names the kind change');
    assert.strictEqual(P._renameGuardPure('Bass', 'Lead', []).ok, false);
    assert.strictEqual(P._renameGuardPure('Lead', 'Keys Solo', []).ok, false);
});

t('empty, too-long, duplicate, and no-op inputs are handled', () => {
    assert.strictEqual(P._renameGuardPure('Lead', '   ', []).ok, false);
    assert.strictEqual(P._renameGuardPure('Lead', 'x'.repeat(61), []).ok, false);
    const dup = P._renameGuardPure('Lead', 'rhythm', ['Rhythm']);
    assert.strictEqual(dup.ok, false, 'case-insensitive duplicate refused');
    const noop = P._renameGuardPure('Lead', 'Lead', ['Rhythm']);
    assert.strictEqual(noop.ok, false);
    assert.strictEqual(noop.reason, '', 'a no-op rename fails silently (no scolding)');
});

// ── The real command, round-tripped through EditHistory ──────────────

function makeEnv() {
    const S = {
        currentArr: 0,
        arrangements: [{ id: 'a1', name: 'Lead' }, { id: 'a2', name: 'Rhythm' }],
    };
    const calls = { selector: 0 };
    const env = new Function(
        'document', 'S', 'updateArrangementSelector', 'draw', 'updateStatus',
        '"use strict";' + extractBlock('edit-history') + '\n' + extractClass('RenameArrangementCmd')
        + '\nreturn { EditHistory, RenameArrangementCmd };'
    )(
        { getElementById: () => ({ disabled: false }) },
        S,
        () => { calls.selector++; },
        () => {},
        () => {},
    );
    return { ...env, S, calls, history: new env.EditHistory() };
}

t('rename round-trips: exec applies, undo restores, redo replays; selector follows', () => {
    const { S, history, RenameArrangementCmd, calls } = makeEnv();
    history.exec(new RenameArrangementCmd(0, 'Solo'));
    assert.strictEqual(S.arrangements[0].name, 'Solo');
    assert.ok(calls.selector >= 1, 'selector refreshed on exec');
    history.doUndo();
    assert.strictEqual(S.arrangements[0].name, 'Lead');
    history.doRedo();
    assert.strictEqual(S.arrangements[0].name, 'Solo');
    assert.strictEqual(S.arrangements[1].name, 'Rhythm', 'other parts untouched');
    assert.strictEqual(S.arrangements[0].id, 'a1', 'the stable id NEVER changes on rename');
});

t('the command targets its captured index even after a switch', () => {
    const { S, history, RenameArrangementCmd } = makeEnv();
    const cmd = new RenameArrangementCmd(0, 'Solo');
    S.currentArr = 1;   // user switches before exec/undo
    history.exec(cmd);
    assert.strictEqual(S.arrangements[0].name, 'Solo', 'captured index wins');
    assert.strictEqual(S.arrangements[1].name, 'Rhythm');
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
