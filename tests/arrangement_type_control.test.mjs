/*
 * Instrument-type control — the escape hatch that AUTHORS an arrangement's
 * `type` so a fretted (string+fret) chart whose NAME contains a keys word
 * ("Electric Piano", "Lead Synth") is no longer piano-locked. The authored
 * type WINS over name inference in every reader (arrKind / _isBassArr /
 * viewFor / isKeysArr), and the set is undoable (Principle IV).
 *
 * Fails on unfixed code: SetArrangementTypeCmd does not exist in
 * src/arrangement.js, so there is no way to override the name inference and a
 * keys-named fretted part stays keys-locked.
 *
 * Run: node tests/arrangement_type_control.test.mjs
 */
import assert from 'node:assert';
import fs from 'node:fs';
import { EditHistory } from '../src/history.js';
import { arrKind, _isBassArr } from '../src/instrument.js';
import { isKeysArr, viewFor } from '../src/keys.js';
import { seedState, setRollView, trackHooks } from './_history_env.mjs';
import { editorSetArrangementType } from '../src/arrangement.js';

const src = fs.readFileSync(new URL('../src/arrangement.js', import.meta.url), 'utf8');
function extractClass(name) {
    const start = src.indexOf('class ' + name);
    assert.ok(start >= 0, `class ${name} must exist in src/arrangement.js`);
    const open = src.indexOf('{', start);
    let depth = 0;
    for (let i = open; i < src.length; i++) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}' && --depth === 0) return src.slice(start, i + 1);
    }
    throw new Error(`unbalanced braces extracting ${name}`);
}

let pass = 0, fail = 0;
const t = (name, fn) => {
    try { fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
};

// EditHistory closes over the REAL S; the sliced command must share it (same
// pattern as rename_part.test.mjs). Inject the host stubs the command calls.
function makeEnv(arrangements) {
    const S = seedState({ arrangements });
    const calls = { selector: 0, lane: 0 };
    const env = new Function(
        'S', 'host',
        '"use strict";' + extractClass('SetArrangementTypeCmd')
        + '\nreturn { SetArrangementTypeCmd };',
    )(S, {
        updateArrangementSelector: () => { calls.selector++; },
        resizeForLaneChange: () => { calls.lane++; },
    });
    trackHooks();
    return { ...env, S, calls, history: new EditHistory() };
}

t('authoring type=guitar rescues a fretted chart stamped type=piano (arrKind/isKeysArr/viewFor → guitar/string)', () => {
    // The real bug: an older save word-boundary-inferred "Electric Piano" and
    // stamped `type: piano` into the manifest. This PR honors that stamped type,
    // so the fretted chart now loads piano-locked with no way out — until this
    // control overrides it.
    const { S, history, SetArrangementTypeCmd, calls } = makeEnv(
        [{ id: 'a1', name: 'Electric Piano', type: 'piano', notes: [], tuning: [40, 45, 50, 55, 59, 64] }]);
    assert.strictEqual(arrKind(S.arrangements[0]), 'keys', 'stamped type=piano loads it keys');
    assert.strictEqual(viewFor(S.arrangements[0]), 'piano', 'so it opens piano-locked');
    history.exec(new SetArrangementTypeCmd(0, 'guitar'));
    assert.strictEqual(S.arrangements[0].type, 'guitar');
    assert.strictEqual(arrKind(S.arrangements[0]), 'guitar', 'authored type wins over the keys name');
    assert.strictEqual(isKeysArr(), false, 'no longer keys-locked');
    assert.strictEqual(viewFor(S.arrangements[0]), 'string', 'now opens in string view');
    assert.ok(calls.selector >= 1, 'selector refreshed so the control follows');
    assert.ok(calls.lane >= 1, 'lane metrics rebuilt in place');
});

t('authoring type=bass wins over a keys-word name for the bass predicate', () => {
    const { S, history, SetArrangementTypeCmd } = makeEnv(
        [{ id: 'a1', name: 'Grand Piano', notes: [], tuning: [28, 33, 38, 43] }]);
    assert.strictEqual(_isBassArr(S.arrangements[0]), false, 'name is not /bass/');
    history.exec(new SetArrangementTypeCmd(0, 'bass'));
    assert.strictEqual(_isBassArr(S.arrangements[0]), true, 'authored bass wins');
    assert.strictEqual(arrKind(S.arrangements[0]), 'bass');
});

t('the type set is undoable — undo clears an authored-onto-untyped type, redo re-applies', () => {
    // Untyped, keys-PREFIX name → keys by name inference (the fallback path).
    const { S, history, SetArrangementTypeCmd } = makeEnv(
        [{ id: 'a1', name: 'Piano', notes: [] }]);
    assert.strictEqual(S.arrangements[0].type, undefined, 'starts untyped');
    history.exec(new SetArrangementTypeCmd(0, 'guitar'));
    assert.strictEqual(arrKind(S.arrangements[0]), 'guitar');
    history.doUndo();
    assert.strictEqual(S.arrangements[0].type, undefined, 'undo removes the authored type');
    assert.strictEqual(arrKind(S.arrangements[0]), 'keys', 'back to name inference');
    history.doRedo();
    assert.strictEqual(S.arrangements[0].type, 'guitar', 'redo re-applies');
});

t('undo restores a PRIOR authored type (keys → guitar → undo → keys), never deletes it', () => {
    const { S, history, SetArrangementTypeCmd } = makeEnv(
        [{ id: 'a1', name: 'Lead', type: 'keys', notes: [] }]);
    assert.strictEqual(arrKind(S.arrangements[0]), 'keys');
    history.exec(new SetArrangementTypeCmd(0, 'guitar'));
    assert.strictEqual(arrKind(S.arrangements[0]), 'guitar');
    history.doUndo();
    assert.strictEqual(S.arrangements[0].type, 'keys', 'prior authored type restored, not deleted');
});

t('the escape hatch works even when the fretted part is shown READ-ONLY in the roll (lock opt-out)', () => {
    // A fretted part with a non-keys name, manually flipped into the piano roll,
    // is read-only (_rollReadOnly). The type control is still shown there — and
    // is exactly the escape hatch that state needs. A type set writes no note,
    // so the note-write lock must not swallow it. Pre-fix: SetArrangementTypeCmd
    // carried no lock opt-out, so _locked() blocked it and arr.type never moved.
    const { S, history, SetArrangementTypeCmd } = makeEnv(
        [{ id: 'a1', name: 'Rhythm', notes: [], tuning: [40, 45, 50, 55, 59, 64] }]);
    setRollView(true);   // fretted part → piano roll → _rollReadOnly() === true
    assert.strictEqual(arrKind(S.arrangements[0]), 'guitar', 'starts fretted');
    history.exec(new SetArrangementTypeCmd(0, 'bass'));
    assert.strictEqual(S.arrangements[0].type, 'bass', 'type set applied despite the read-only roll');
    assert.strictEqual(arrKind(S.arrangements[0]), 'bass', 'reader honors it');
    history.doUndo();
    assert.strictEqual(S.arrangements[0].type, undefined, 'undo also passes the lock');
});

t('picking Keys authors the CANONICAL spec type "piano", not the read-only alias "keys"', () => {
    // Spec §5.2 spells the keyboard type "piano"; "keys" is only a READ alias.
    // The backend persists arr.type verbatim, so the control must WRITE "piano"
    // or a corrected keys track lands in the manifest with a spelling other
    // consumers (Keys Highway 3D, Staff View) keyed on "piano" won't recognize.
    // Pre-fix: editorSetArrangementType passed the raw "keys" option value through.
    const S = seedState({
        arrangements: [{ id: 'a1', name: 'Rhythm', notes: [], tuning: [40, 45, 50, 55, 59, 64] }],
    });
    S.history = new EditHistory();
    trackHooks();
    editorSetArrangementType('keys');
    assert.strictEqual(S.arrangements[0].type, 'piano', 'writes the canonical spec spelling');
    assert.strictEqual(arrKind(S.arrangements[0]), 'keys', 'still resolves to the keys kind');
    // guitar/bass are already canonical spellings — verify they pass through as-is.
    editorSetArrangementType('bass');
    assert.strictEqual(S.arrangements[0].type, 'bass', 'bass is its own canonical spelling');
});

t('picking the currently-INFERRED kind AUTHORS it (frees the rename guard), not a no-op', () => {
    // An untyped "Bass" track infers bass by NAME. The rename guard refuses to
    // rename an untyped track to a name that changes its inferred kind
    // ("Bass" → "Low End" would read guitar), and only a typed track escapes
    // that. So stamping the inferred kind is the intended unlock — the old
    // guard (kind === arrKind, effective) wrongly no-op'd it because the name
    // already inferred bass, trapping the workflow.
    const S = seedState({
        arrangements: [{ id: 'a1', name: 'Bass', notes: [], tuning: [28, 33, 38, 43] }],
    });
    S.history = new EditHistory();
    trackHooks();
    assert.strictEqual(S.arrangements[0].type, undefined, 'starts untyped (name-inferred bass)');
    assert.strictEqual(arrKind(S.arrangements[0]), 'bass', 'effective kind already bass by name');
    editorSetArrangementType('bass');
    assert.strictEqual(S.arrangements[0].type, 'bass', 'authored the inferred kind so identity is now DATA');
    // Re-picking the SAME authored kind is a genuine no-op (no second history entry).
    const undoLen = S.history.undo.length;
    editorSetArrangementType('bass');
    assert.strictEqual(S.history.undo.length, undoLen, 're-picking an already-authored kind costs nothing');
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
