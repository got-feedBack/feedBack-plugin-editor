'use strict';
/*
 * Inspector technique edits become undoable (gap-audit #3). The inspector's
 * boolean flags (editorInspectorSetFlag) and scalar technique inputs
 * (editorInspectorSetTech: bend peak / slide_to / slide_unpitch_to) used to
 * mutate n.techniques IN PLACE with no undo — a documented PR3b trap: a
 * keyboard technique toggle undid, an inspector click didn't. Both now route
 * through the undo history — flags via ToggleTechniqueCmd (the same command the
 * keyboard path uses), scalars via the new SetTechScalarCmd (which carries the
 * authored bend curve through the rescale).
 *
 * Held to the testing habits: the REAL command classes run through the REAL
 * EditHistory (no stub of the subject); exec → rollback restores the note array
 * EXACTLY (deep-equality); exec → rollback → redo reproduces. Then the REAL
 * dispatchers (editorInspectorSetTech / editorInspectorSetFlag) are extracted and
 * driven with a stubbed host/S so their command routing, the "exactly ONE history
 * entry per commit" guarantee, the read-only-roll refusal, and the reject-bounce
 * are all exercised. The undo assertions fail on main (raw in-place mutation).
 *
 * Run: node --test tests/inspector_undo.test.mjs
 */
import assert from 'node:assert';
import fs from 'node:fs';
import { SetTechScalarCmd, ToggleTechniqueCmd } from '../src/commands.js';
import { S as realS } from '../src/state.js';
import { EditHistory } from '../src/history.js';
import { seedState, trackHooks } from './_history_env.mjs';

const inspSrc = fs.readFileSync(new URL('../src/inspector.js', import.meta.url), 'utf8');
const unexport = (code) => code.replace(/^export\s+/gm, '');
function extractFromInspector(decl) {
    const start = inspSrc.indexOf(decl);
    assert.ok(start >= 0, `not found in inspector.js: ${decl}`);
    const open = inspSrc.indexOf('{', start);
    let depth = 0;
    for (let i = open; i < inspSrc.length; i++) {
        if (inspSrc[i] === '{') depth++;
        else if (inspSrc[i] === '}' && --depth === 0) return unexport(inspSrc.slice(start, i + 1));
    }
    throw new Error(`unbalanced braces for ${decl}`);
}

// Commands resolve their targets through the REAL notes() → REAL S. Seed one
// arrangement pointed at CURRENT so the cases assert on the array they built.
seedState({ arrangements: [{ id: 'a1', name: 'Lead', notes: [] }], currentArr: 0 });
trackHooks();

let CURRENT = [];
const setCurrent = (arr) => { CURRENT = arr; realS.arrangements[0].notes = arr; };
const clone = (x) => JSON.parse(JSON.stringify(x));
const note = (over = {}) => ({ time: 0, string: 2, fret: 5, sustain: 0.5, techniques: { ...over } });

let pass = 0, fail = 0;
function t(name, fn) {
    try { fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}

// ── SetTechScalarCmd — slide targets round-trip exactly ──────────────────────
t('slide_to: exec sets all; rollback restores exactly; redo reproduces', () => {
    setCurrent([note({ slide_to: -1 }), note({ slide_to: -1 })]);
    const before = clone(CURRENT);
    const h = new EditHistory();
    h.exec(new SetTechScalarCmd([0, 1], 'slide_to', 7));
    assert.deepStrictEqual(CURRENT.map(n => n.techniques.slide_to), [7, 7]);
    h.doUndo();
    assert.deepStrictEqual(CURRENT, before, 'undo restores the exact array (fails on main: raw mutation)');
    h.doRedo();
    assert.deepStrictEqual(CURRENT.map(n => n.techniques.slide_to), [7, 7]);
});

t('slide_unpitch_to: single note round-trips; leaves other fields alone', () => {
    setCurrent([note({ slide_unpitch_to: -1 })]);
    const before = clone(CURRENT);
    const h = new EditHistory();
    h.exec(new SetTechScalarCmd([0], 'slide_unpitch_to', 4));
    assert.strictEqual(CURRENT[0].techniques.slide_unpitch_to, 4);
    assert.strictEqual(CURRENT[0].fret, 5, 'fret untouched');
    h.doUndo();
    assert.deepStrictEqual(CURRENT, before);
});

// ── SetTechScalarCmd — bend carries the authored curve through the rescale ───
t('bend: rescales the authored curve to the new peak; undo restores curve + peak', () => {
    const curve = [{ t: 0, v: 0 }, { t: 0.5, v: 1 }, { t: 1, v: 2 }];
    setCurrent([note({ bend: 2, bend_values: curve.map(p => ({ ...p })) })]);
    const before = clone(CURRENT);
    const h = new EditHistory();
    h.exec(new SetTechScalarCmd([0], 'bend', 1));
    assert.strictEqual(CURRENT[0].techniques.bend, 1, 'peak snapped to the rescaled curve max');
    assert.deepStrictEqual(CURRENT[0].techniques.bend_values,
        [{ t: 0, v: 0 }, { t: 0.5, v: 0.5 }, { t: 1, v: 1 }], 'curve rescaled to peak 1');
    h.doUndo();
    assert.deepStrictEqual(CURRENT, before, 'undo restores the exact prior bend + curve');
    h.doRedo();
    assert.strictEqual(CURRENT[0].techniques.bend, 1);
});

t('bend → 0 drops the curve; undo restores it', () => {
    const curve = [{ t: 0, v: 0 }, { t: 1, v: 2 }];
    setCurrent([note({ bend: 2, bend_values: curve.map(p => ({ ...p })) })]);
    const before = clone(CURRENT);
    const h = new EditHistory();
    h.exec(new SetTechScalarCmd([0], 'bend', 0));
    assert.strictEqual(CURRENT[0].techniques.bend, 0);
    assert.strictEqual(CURRENT[0].techniques.bend_values, null, 'zero peak drops the curve');
    h.doUndo();
    assert.deepStrictEqual(CURRENT, before, 'undo restores the dropped curve');
});

// ── ToggleTechniqueCmd — boolean flag round-trips (already covered by keyboard;
//    proven here for the inspector's value=!!on path) ──────────────────────────
t('flag: exec sets the boolean on all; rollback restores each prior value', () => {
    setCurrent([note({ palm_mute: false }), note({ palm_mute: true })]);
    const before = clone(CURRENT);
    const h = new EditHistory();
    h.exec(new ToggleTechniqueCmd([0, 1], 'palm_mute', true));
    assert.deepStrictEqual(CURRENT.map(n => n.techniques.palm_mute), [true, true]);
    h.doUndo();
    assert.deepStrictEqual(CURRENT, before, 'mixed selection restored to its per-note values');
});

// ── Drive the REAL dispatchers editorInspectorSetTech / editorInspectorSetFlag ─
// Extracted + run with a stubbed host/S so command ROUTING, the one-commit
// guarantee, the roll-lock refusal, and the reject-bounce are all exercised.
let DNOTES = [];
const dS = { sel: new Set(), history: null };
let renderCount = 0, lockCount = 0, rollLocked = false;
const api = new Function(
    'host', 'S', '_renderInspector', '_rollReadOnly', '_rollLockNotice',
    'SetTechScalarCmd', 'ToggleTechniqueCmd',
    '"use strict";'
    + extractFromInspector('export const _INSPECTOR_BOUNDS =') + '\n'
    + extractFromInspector('export function _coerceInspectorNumber') + '\n'
    + extractFromInspector('export function editorInspectorSetTech') + '\n'
    + extractFromInspector('export function editorInspectorSetFlag') + '\n'
    + 'return { editorInspectorSetTech, editorInspectorSetFlag };'
)(
    { draw() {}, updateStatus() {} },
    dS,
    () => { renderCount++; },
    () => rollLocked,
    () => { lockCount++; },
    SetTechScalarCmd, ToggleTechniqueCmd,
);
const { editorInspectorSetTech, editorInspectorSetFlag } = api;

function reset(arr, sel) {
    DNOTES = arr;
    realS.arrangements[0].notes = arr;
    dS.sel = new Set(sel);
    dS.history = new EditHistory();
    renderCount = 0; lockCount = 0; rollLocked = false;
}

t('dispatcher setTech: routes to SetTechScalarCmd; one commit; undo restores', () => {
    reset([note({ slide_to: -1 }), note({ slide_to: -1 })], [0, 1]);
    editorInspectorSetTech('slide_to', '9');
    assert.deepStrictEqual(DNOTES.map(n => n.techniques.slide_to), [9, 9], 'set-all');
    assert.strictEqual(dS.history.undo.length, 1, 'a single Ctrl+Z');
    assert.strictEqual(renderCount, 0, 'no reject re-render on a valid edit');
    dS.history.doUndo();
    assert.deepStrictEqual(DNOTES.map(n => n.techniques.slide_to), [-1, -1], 'undo restores');
});

t('dispatcher setTech reject: junk bounces (re-render), no commit', () => {
    reset([note({ slide_to: -1 })], [0]);
    editorInspectorSetTech('slide_to', '2.5');   // integer field → non-integer rejects
    assert.strictEqual(DNOTES[0].techniques.slide_to, -1, 'unchanged on reject');
    assert.strictEqual(dS.history.undo.length, 0, 'no commit');
    assert.strictEqual(renderCount, 1, 're-render snaps the input back');
});

t('dispatcher setTech empty slide clears to -1 (emptyAs), one commit', () => {
    reset([note({ slide_to: 7 })], [0]);
    editorInspectorSetTech('slide_to', '');      // emptyAs: -1
    assert.strictEqual(DNOTES[0].techniques.slide_to, -1, 'empty = clear');
    assert.strictEqual(dS.history.undo.length, 1);
});

t('dispatcher setFlag: routes to ToggleTechniqueCmd; one commit; undo restores; re-renders', () => {
    reset([note({ tap: false }), note({ tap: false })], [0, 1]);
    editorInspectorSetFlag('tap', true);
    assert.deepStrictEqual(DNOTES.map(n => n.techniques.tap), [true, true]);
    assert.strictEqual(dS.history.undo.length, 1, 'one undoable step');
    assert.strictEqual(renderCount, 1, 'reflects the committed value');
    dS.history.doUndo();
    assert.deepStrictEqual(DNOTES.map(n => n.techniques.tap), [false, false]);
});

t('dispatcher read-only roll: both refuse — lock notice, no commit', () => {
    reset([note({ palm_mute: false, slide_to: -1 })], [0]);
    rollLocked = true;
    editorInspectorSetFlag('palm_mute', true);
    editorInspectorSetTech('slide_to', '5');
    assert.strictEqual(DNOTES[0].techniques.palm_mute, false, 'flag refused');
    assert.strictEqual(DNOTES[0].techniques.slide_to, -1, 'scalar refused');
    assert.strictEqual(dS.history.undo.length, 0, 'no commit under the lock');
    assert.strictEqual(lockCount, 2, 'each refusal fired the lock notice');
});

t('dispatcher empty selection: early-return before lock/history/render', () => {
    reset([note({ tap: false })], []);
    editorInspectorSetFlag('tap', true);
    editorInspectorSetTech('slide_to', '5');
    assert.strictEqual(dS.history.undo.length, 0, 'no commit');
    assert.strictEqual(lockCount, 0, 'returned before the lock check');
    assert.strictEqual(renderCount, 0, 'returned before any re-render');
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
