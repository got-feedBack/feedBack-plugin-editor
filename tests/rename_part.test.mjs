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
 * Run: node tests/rename_part.test.mjs
 */
import assert from 'node:assert';
import { EditHistory } from '../src/history.js';
import { seedState, trackHooks } from './_history_env.mjs';
import fs from 'node:fs';
import { KEYS_PATTERN } from '../src/keys.js';

const src = fs.readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');

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


let pass = 0, fail = 0;
function t(name, fn) {
    try { fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}

// ── Pure: kind inference + rename guard ──────────────────────────────

// KEYS_PATTERN is a real import now; @pure:rename-arr is still in src/main.js.
const P = new Function('KEYS_PATTERN',
    '"use strict";' + extractBlock('rename-arr')
    + '\nreturn { _arrKindPure, _arrSaveKindPure, _renameGuardPure };'
)(KEYS_PATTERN);

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
});

t('a name the editor and the save read differently is refused (both facets guarded)', () => {
    // Regression for the guard-vs-persistence mismatch. A name feeds two
    // interpreters that disagree:
    //   • runtime lane/roll router — PREFIX KEYS_PATTERN (_arrKindPure)
    //   • save-side type/notation — WORD-BOUNDARY \b(keys|…)\b (_arrSaveKindPure,
    //     mirrors routes.py `_KEYS_NAME_RE`)
    // "Electric Piano" is runtime-guitar but save-keys; a one-facet guard
    // waved through renames that re-lane the chart under the OTHER facet.
    assert.strictEqual(P._arrKindPure('Electric Piano'), 'guitar',
        'runtime prefix rule misses "Electric Piano"');
    assert.strictEqual(P._arrSaveKindPure('Electric Piano'), 'keys',
        'save-side word-boundary rule catches "Electric Piano"');
    assert.strictEqual(P._arrKindPure('keysolo'), 'keys',
        'runtime prefix rule catches "keysolo"');
    assert.strictEqual(P._arrSaveKindPure('keysolo'), 'other',
        'save-side word-boundary rule misses "keysolo"');

    // guitar (both facets) → "Electric Piano" (save flips to keys):
    // pre-fix returned ok:true and let the save silently re-lane the chart.
    const g = P._renameGuardPure('Lead', 'Electric Piano', []);
    assert.strictEqual(g.ok, false, 'guitar → save-side-keys rename is refused');
    assert.ok(/guitar → keys/.test(g.reason), 'names the kind change');

    // keys ("Piano") → "Electric Piano": SAME display label (both keys) but
    // the runtime facet moves keys → guitar, flipping the LIVE piano roll to
    // guitar lanes until save. Pre-fix (and a naive union guard) allowed it.
    const g2 = P._renameGuardPure('Piano', 'Electric Piano', []);
    assert.strictEqual(g2.ok, false, 'keys → runtime-guitar rename is refused');
    assert.ok(/read differently/.test(g2.reason), 'explains the interpreter disagreement');

    // A stray save-side keys word on a guitar part is likewise blocked.
    assert.strictEqual(P._renameGuardPure('Rhythm', 'Rhythm + Synth Pad', []).ok, false);
    // A runtime-only keys prefix on a guitar part is blocked too.
    assert.strictEqual(P._renameGuardPure('Rhythm', 'Synthwave Lead', []).ok, false);
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

// EditHistory is a real import and closes over the REAL `S`, so the sliced
// command must share that same object rather than a fabricated one.
function makeEnv() {
    const S = seedState({
        arrangements: [{ id: 'a1', name: 'Lead', notes: [] }, { id: 'a2', name: 'Rhythm', notes: [] }],
    });
    const calls = { selector: 0 };
    const env = new Function(
        'S', 'updateArrangementSelector',
        '"use strict";' + extractClass('RenameArrangementCmd')
        + '\nreturn { RenameArrangementCmd };'
    )(
        S,
        () => { calls.selector++; },
    );
    trackHooks();
    return { ...env, S, calls, history: new EditHistory() };
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
