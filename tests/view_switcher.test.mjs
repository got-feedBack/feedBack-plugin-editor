/*
 * Tests for the per-part view switcher + universal read-first piano roll
 * (src/keys.js: view-pref resolution, the isKeysMode/isKeysArr split,
 * _rollMidiForNote, the sounding-pitch piano range; plus the EditHistory
 * read-only-roll gate, which is still sliced out of src/main.js).
 *
 * The view became a per-part CHOICE instead of a function of the part's
 * name: fretted parts may opt into the piano roll (read-first — rendering
 * at sounding pitch, every mutation inert until suggest-position lands).
 * These fail on main, where none of the seam exists.
 *
 * Run: node tests/view_switcher.test.mjs
 */
import assert from 'node:assert';
import { EditHistory } from '../src/history.js';
import { ToggleTechniqueCmd } from '../src/commands.js';
import { lockNotices, seedState, setRollView, trackHooks } from './_history_env.mjs';
import fs from 'node:fs';
import * as keys from '../src/keys.js';
import {
    _partViewKeyPure, _rollMidiForNote, _viewForPure, noteToMidi, updatePianoRange, } from '../src/keys.js';
import { LC } from '../src/lanes.js';
import { S } from '../src/state.js';
import { isDrumArrangement } from '../src/drum-arrangement.js';

// Only @pure:edit-history is still sliced — it lives in src/main.js.
const src = fs.readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');

let pass = 0, fail = 0;
function t(name, fn) {
    try { fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}

// ── Pure: view resolution + pref keying ──────────────────────────────

const P = { _partViewKeyPure, _viewForPure };

t('keys-named parts are piano-locked regardless of any stored pref', () => {
    assert.strictEqual(P._viewForPure('Piano', undefined), 'piano');
    assert.strictEqual(P._viewForPure('Keys 2', 'string'), 'piano');
    assert.strictEqual(P._viewForPure('Synth Lead', null), 'piano');
});

t('fretted parts default to string and honor a piano override; junk → string', () => {
    assert.strictEqual(P._viewForPure('Lead', undefined), 'string');
    assert.strictEqual(P._viewForPure('Bass', 'piano'), 'piano');
    assert.strictEqual(P._viewForPure('Rhythm', 'weird'), 'string');
    assert.strictEqual(P._viewForPure('', undefined), 'string');
});

t('pref key prefers a stable id over the display name', () => {
    assert.strictEqual(P._partViewKeyPure({ id: 'lead', name: 'Lead Guitar' }), 'lead');
    assert.strictEqual(P._partViewKeyPure({ id: 0, name: 'Lead' }), '0', 'numeric id 0 still counts');
    assert.strictEqual(P._partViewKeyPure({ name: 'Lead' }), 'Lead', 'no id → name fallback');
    assert.strictEqual(P._partViewKeyPure(null), '');
});

// ── Stateful: prefs + predicates over stub localStorage ──────────────

// keys.js reads the real `S` and the ambient `localStorage`. Install a stub on
// globalThis (module code resolves it at call time) and seed the real S, instead
// of re-evaluating the module's source inside a sandbox.
function makeViewEnv(seedS, seed = {}) {
    const map = new Map(Object.entries(seed));
    globalThis.localStorage = {
        getItem: k => (map.has(k) ? map.get(k) : null),
        setItem: (k, v) => { map.set(k, String(v)); },
        removeItem: k => { map.delete(k); },
    };
    Object.assign(S, seedS);
    LC.active = false;
    // `_viewPrefs` memoizes per `S.filename`; bounce the key so a fresh seed is
    // actually read rather than served from the previous test's cache.
    const real = S.filename;
    S.filename = '\u0000reset';
    keys._viewPrefs();
    S.filename = real;
    return { env: keys, ls: { map }, S };
}

t('per-song pref round-trip: override honored, other songs unaffected', () => {
    const seed = { filename: 'song.sloppak', currentArr: 0, arrangements: [{ id: 'lead', name: 'Lead' }] };
    const { env, ls, S } = makeViewEnv(seed, {
        'editorViewPref:song.sloppak': '{"lead":"piano"}',
        'editorViewPref:other.sloppak': '{"lead":"piano"}',
    });
    assert.strictEqual(env.viewFor(S.arrangements[0]), 'piano');
    assert.strictEqual(env.isKeysMode(), true, 'piano SURFACE active');
    assert.strictEqual(env.isKeysArr(), false, 'still fretted DATA');
    assert.strictEqual(env._rollReadOnly(), true, 'fretted-in-roll is read-only');
    S.filename = 'third.sloppak';
    assert.strictEqual(env.viewFor(S.arrangements[0]), 'string', 'no pref for this song');
    assert.strictEqual(env._rollReadOnly(), false);
    assert.ok(ls.map.has('editorViewPref:other.sloppak'), 'other songs untouched');
});

t('id-keyed pref survives a display rename; keys parts never become read-only', () => {
    const seed = { filename: 's.sloppak', currentArr: 0, arrangements: [{ id: 'a1', name: 'Lead' }] };
    const { env, S } = makeViewEnv(seed, { 'editorViewPref:s.sloppak': '{"a1":"piano"}' });
    S.arrangements[0].name = 'Renamed Solo';
    assert.strictEqual(env.viewFor(S.arrangements[0]), 'piano', 'stable id keeps the pref');
    S.arrangements[0].name = 'Piano';   // becomes a keys part by name
    assert.strictEqual(env.isKeysMode(), true);
    assert.strictEqual(env.isKeysArr(), true);
    assert.strictEqual(env._rollReadOnly(), false, 'keys data in the roll is fully editable');
});

t('junk stored JSON never breaks resolution', () => {
    const seed = { filename: 'x.sloppak', currentArr: 0, arrangements: [{ id: 'a', name: 'Lead' }] };
    const { env, S } = makeViewEnv(seed, { 'editorViewPref:x.sloppak': '[not json' });
    assert.strictEqual(env.viewFor(S.arrangements[0]), 'string');
});

// ── Sounding-pitch mapping in the roll ───────────────────────────────

const M = { _rollMidiForNote, noteToMidi };
const GUITAR_CTX = {
    openMidi: [40, 45, 50, 55, 59, 64],
    tuning: [0, 0, 0, 0, 0, 0],
    capo: 2,
};

t('_rollMidiForNote: keys packing without a ctx, sounding pitch with one', () => {
    assert.strictEqual(M._rollMidiForNote({ string: 2, fret: 5 }, null), 2 * 24 + 5, 'packing');
    assert.strictEqual(M._rollMidiForNote({ string: 0, fret: 0 }, GUITAR_CTX), 42, 'capo added once');
    assert.strictEqual(M._rollMidiForNote({ string: 9, fret: 0 }, GUITAR_CTX), null, 'unknown string skips');
});

t('piano range fits FRETTED parts to sounding pitch, not the wire packing', () => {
    // updatePianoRange is the SOLE writer of `pianoRange` / `PIANO_LANE_H`; both
    // are exported `let`s. Read them back through the namespace to prove the live
    // binding updates for importers (a destructured copy would go stale).
    S.arrangements = [{
        name: 'Lead', tuning: [0, 0, 0, 0, 0, 0], chords: [],
        // Open low E (sounding 40) and open high e (sounding 64), no capo.
        notes: [{ string: 0, fret: 0 }, { string: 5, fret: 0 }],
    }];
    S.currentArr = 0;
    LC.active = false;
    updatePianoRange();

    assert.strictEqual(keys.pianoRange.lo, Math.max(0, Math.floor(40 / 12) * 12 - 6),
        'floor from sounding 40');
    assert.strictEqual(keys.pianoRange.hi, Math.min(143, Math.ceil(65 / 12) * 12 + 5),
        'ceiling from sounding 64');
    // The wire packing would have put string 5 fret 0 at 5*24+0 = 120.
    assert.ok(keys.pianoRange.hi < 100, 'range comes from sounding pitch, not string*24+fret');
    assert.ok(keys.PIANO_LANE_H > 0, 'lane height re-derived alongside the range');
});

t('a KEYS part uses the wire packing, not sounding pitch', () => {
    S.arrangements = [{ name: 'Keys', tuning: [], chords: [], notes: [{ string: 2, fret: 5 }] }];
    S.currentArr = 0;
    LC.active = false;
    updatePianoRange();
    const midi = noteToMidi(2, 5);   // 53
    assert.ok(keys.pianoRange.lo <= midi && midi <= keys.pianoRange.hi,
        'the packed pitch sits inside the derived range');
});

// ── The read-only-roll gate in EditHistory ───────────────────────────

// EditHistory imports _rollReadOnly for real, so the gate is driven through
// actual state: a part named 'Lead' is fretted, and rollView puts it in the
// piano roll — which IS the read-only condition. The precondition assert keeps a
// future keys-pattern change from silently unlocking this suite.
function makeHistory(locked) {
    seedState({ arrangements: [{ id: 'a1', name: 'Lead', notes: [] }], rollView: locked.value });
    assert.strictEqual(keys._rollReadOnly(), locked.value, 'harness precondition');
    trackHooks();
    const before = lockNotices();
    return { history: new EditHistory(), notices: { get count() { return lockNotices() - before; } } };
}

t('read-only roll: exec is inert — no mutation, no undo entry, one notice', () => {
    const locked = { value: true };
    const { history, notices } = makeHistory(locked);
    let applied = 0;
    history.exec({ exec() { applied++; }, rollback() { applied--; } });
    assert.strictEqual(applied, 0, 'command must not run');
    assert.strictEqual(history.undo.length, 0, 'nothing lands on the undo stack');
    assert.strictEqual(notices.count, 1, 'the user is told why');
});

t('unlocked: exec applies and undoes exactly as before (regression)', () => {
    const locked = { value: false };
    const { history } = makeHistory(locked);
    let applied = 0;
    history.exec({ exec() { applied++; }, rollback() { applied--; } });
    assert.strictEqual(applied, 1);
    assert.strictEqual(history.undo.length, 1);
    history.doUndo();
    assert.strictEqual(applied, 0);
});

t('lock lifts live: the same history accepts commands once unlocked', () => {
    const locked = { value: true };
    const { history } = makeHistory(locked);
    let applied = 0;
    const cmd = { exec() { applied++; }, rollback() { applied--; } };
    history.exec(cmd);
    assert.strictEqual(applied, 0);
    setRollView(false);   // user switches back to String view
    history.exec(cmd);
    assert.strictEqual(applied, 1);
});

// ── Read-only roll must not freeze song-scope edits, and undo/redo of
//    note-scope commands must respect the lock (regressions for #119) ──

t('read-only roll: SONG-scope command (drum/tempo) still executes', () => {
    // A fretted part shown in the roll locks NOTE edits only. Song-level
    // commands (drum tab, tempo grid) target song data, not the fretted
    // chart, so they must pass through — otherwise viewing an unrelated
    // part in the roll would freeze tempo/drum editing entirely.
    const locked = { value: true };
    const { history, notices } = makeHistory(locked);
    let applied = 0;
    history.exec({ songScope: true, exec() { applied++; }, rollback() { applied--; } });
    assert.strictEqual(applied, 1, 'song-scope command must run despite the roll lock');
    assert.strictEqual(history.undo.length, 1, 'song-scope command lands on the undo stack');
    assert.strictEqual(notices.count, 0, 'no read-only notice for a song-scope edit');
});

t('read-only roll: undo/redo of a NOTE-scope command is inert (no chart write)', () => {
    // Author a note-scope edit in String view (unlocked), then switch the
    // part into the read-only roll. undo/redo must NOT roll the fretted
    // chart back/forward — that would bypass the exec/drag lock and mutate
    // read-only data.
    const locked = { value: false };
    const { history, notices } = makeHistory(locked);
    let applied = 0;
    const cmd = { exec() { applied++; }, rollback() { applied--; } };
    history.exec(cmd);
    assert.strictEqual(applied, 1);
    setRollView(true);              // user switches this part into the roll
    const noticesBefore = notices.count;
    history.doUndo();
    assert.strictEqual(applied, 1, 'undo must not roll back a read-only fretted chart');
    assert.strictEqual(history.undo.length, 1, 'the command stays on the undo stack');
    assert.ok(notices.count > noticesBefore, 'the user is told why undo is blocked');
    history.doRedo();               // redo stack is empty here, but assert no crash
    assert.strictEqual(applied, 1, 'nothing re-executed');
});

t('read-only roll: SONG-scope undo still works (drum edit reverts)', () => {
    // Song-scope commands are exempt from the note lock on the way in AND
    // on the way out, so a drum/tempo edit can still be undone while a
    // fretted part is shown read-only in the roll.
    const locked = { value: false };
    const { history } = makeHistory(locked);
    let applied = 0;
    history.exec({ songScope: true, exec() { applied++; }, rollback() { applied--; } });
    assert.strictEqual(applied, 1);
    locked.value = true;            // an unrelated fretted part is in the roll
    history.doUndo();
    assert.strictEqual(applied, 0, 'song-scope undo is unaffected by the roll lock');
    assert.strictEqual(history.redo.length, 1, 'and it moves to the redo stack');
});

// ── Direct-mutation note-edit paths must respect the read-only roll ──
//    (regressions for #119: these bypass EditHistory, so the exec lock
//     alone can't stop them — each entry point is guarded at its source).

// The inspector moved to src/inspector.js, where its handlers are exported
// function declarations rather than `window.NAME = (…) => {…}` arrows, and reach
// main.js through `host`. Same body, different header.
const inspSrc = fs.readFileSync(new URL('../src/inspector.js', import.meta.url), 'utf8');
function extractInspectorFn(name, globals) {
    const marker = 'export function ' + name + '(';
    const start = inspSrc.indexOf(marker);
    assert.ok(start >= 0, `export function ${name} must exist in inspector.js`);
    const open = inspSrc.indexOf('{', start);
    let depth = 0, end = -1;
    for (let i = open; i < inspSrc.length; i++) {
        if (inspSrc[i] === '{') depth++;
        else if (inspSrc[i] === '}' && --depth === 0) { end = i; break; }
    }
    assert.ok(end > 0, `unbalanced braces extracting ${name}`);
    const decl = inspSrc.slice(start, end + 1).replace(/^export\s+/, '');
    const names = Object.keys(globals);
    const fn = new Function(...names, '"use strict";' + decl + '\nreturn ' + name + ';');
    return fn(...names.map(k => globals[k]));
}

// Extract a `window.NAME = (...) => { ... };` arrow assignment and rebuild
// it as a callable with the named globals stubbed in.
function extractWinFn(name, globals) {
    const marker = 'window.' + name + ' = ';
    const start = src.indexOf(marker);
    assert.ok(start >= 0, `window.${name} must exist`);
    const open = src.indexOf('{', src.indexOf('=>', start));
    let depth = 0, end = -1;
    for (let i = open; i < src.length; i++) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}' && --depth === 0) { end = i; break; }
    }
    assert.ok(end > 0, `unbalanced braces extracting ${name}`);
    const arrowSrc = src.slice(start + marker.length, end + 1); // "(args) => {...}"
    const names = Object.keys(globals);
    const fn = new Function(...names, '"use strict"; return (' + arrowSrc + ');');
    return fn(...names.map(k => globals[k]));
}

t('read-only roll: context-menu editorToggleTech does not mutate the fretted chart', () => {
    const note = { string: 0, fret: 3, techniques: {} };
    const locked = { value: true };
    let notices = 0;
    const toggle = extractWinFn('editorToggleTech', {
        notes: () => [note],
        _rollReadOnly: () => locked.value,
        _rollLockNotice: () => { notices++; },
        hideContextMenu: () => {},
        draw: () => {},
        _renderInspector: () => {},
    });
    toggle(0, 'palm_mute');
    assert.strictEqual(note.techniques.palm_mute, undefined, 'no write while read-only');
    assert.strictEqual(notices, 1, 'the user is told why');
    locked.value = false;   // switch back to String view
    toggle(0, 'palm_mute');
    assert.strictEqual(note.techniques.palm_mute, true, 'writes once editable');
});

t('read-only roll: inspector editorInspectorSetFlag does not mutate the fretted chart', () => {
    // Now routes through ToggleTechniqueCmd (gap-audit #3), so the command
    // resolves its target through the REAL notes() — seed one arrangement holding
    // the note, and drive the handler's own S stub (sel + history).
    const note = { string: 0, fret: 3, techniques: {} };
    seedState({ arrangements: [{ id: 'a1', name: 'Lead', notes: [note] }], currentArr: 0 });
    const locked = { value: true };
    let notices = 0, renders = 0;
    const history = new EditHistory();
    const setFlag = extractInspectorFn('editorInspectorSetFlag', {
        S: { sel: new Set([0]), history },
        _rollReadOnly: () => locked.value,
        _rollLockNotice: () => { notices++; },
        _renderInspector: () => { renders++; },
        host: { draw() {}, updateStatus() {} },
        ToggleTechniqueCmd,
    });
    setFlag('accent', true);
    assert.strictEqual(note.techniques.accent, undefined, 'no write while read-only');
    assert.strictEqual(notices, 1, 'the user is told why');
    assert.ok(renders >= 1, 'the checkbox is bounced back to the model');
    assert.strictEqual(history.undo.length, 0, 'no commit under the lock');
    locked.value = false;
    setFlag('accent', true);
    assert.strictEqual(note.techniques.accent, true, 'writes once editable');
    assert.strictEqual(history.undo.length, 1, 'and now it is one undoable commit');
});

// ── The arrangement switcher must drop the engraved-tab lens on a mode
//    switch. draw() checks S.tabViewMode FIRST (main.js), so a stale lens
//    keeps painting the previous part's tab over the new mode. The
//    Edit-Drums button already clears it; editorSwitcherSelect (and its
//    twin openTrackSessionTarget) did not. ────────────────────────────────
const DRUMS = () => ({ id: 'drums', name: 'Drums', type: 'drums', drumTab: { version: 1 } });
const GTR = (name = 'Lead') => ({ id: name.toLowerCase(), name, notes: [], chords: [] });

function makeSwitcher() {
    let selectorSyncs = 0;
    const fn = extractWinFn('editorSwitcherSelect', {
        isDrumArrangement,
        S,
        _finalizeActiveDrag: () => {},
        _refreshPartsViewButton: () => {},
        _refreshDrumEditButton: () => {},
        _refreshTempoMapButton: () => {},
        updateArrangementSelector: () => { selectorSyncs++; },
        draw: () => {},
        updateStatus: () => {},
        window: { editorSelectArrangement: (v) => { S.currentArr = parseInt(v) || 0; } },
    });
    return { fn, counts: { get selectorSyncs() { return selectorSyncs; } } };
}

t('switcher → Drums drops the engraved lens (draw checks tabViewMode first)', () => {
    Object.assign(S, {
        arrangements: [GTR('Lead'), DRUMS()], currentArr: 0,
        drumTab: { version: 1 }, format: 'sloppak',
        tabViewMode: true, drumEditMode: false, drumSel: new Set(),
        partsViewMode: false, tempoMapMode: false, tempoSel: -1, sel: new Set(),
    });
    makeSwitcher().fn('1');   // the Drums option
    assert.strictEqual(S.drumEditMode, true, 'drum grid opened');
    assert.strictEqual(S.tabViewMode, false, 'lens dropped so the drum grid is what draws');
});

t('switcher → a pitched part drops the drum-notation lens', () => {
    Object.assign(S, {
        arrangements: [GTR('Lead'), GTR('Bass'), DRUMS()], currentArr: 0,
        drumTab: { version: 1 }, format: 'sloppak',
        tabViewMode: true, drumEditMode: true, drumSel: new Set(), sel: new Set(),
    });
    makeSwitcher().fn('1');   // Bass — a pitched part
    assert.strictEqual(S.drumEditMode, false, 'left drum mode');
    assert.strictEqual(S.tabViewMode, false, 'drum-notation lens dropped over the pitched arrangement');
});

t('switcher → a pitched part leaves Parts and Tempo Map view too (draw renders the live lens)', () => {
    // Parts/Tempo are mutually-exclusive lenses like the drum grid: the drums
    // branch and openTrackSessionTarget both drop them, so the pitched branch
    // must too, else currentArr moves but draw() keeps painting the old lens.
    Object.assign(S, {
        arrangements: [GTR('Lead'), GTR('Bass'), DRUMS()], currentArr: 0,
        drumTab: { version: 1 }, format: 'sloppak',
        tabViewMode: false, drumEditMode: false, drumSel: new Set(), sel: new Set(),
        partsViewMode: true, tempoMapMode: true, tempoSel: 3,
    });
    makeSwitcher().fn('1');   // Bass — a pitched part
    assert.strictEqual(S.currentArr, 1, 'switched to the pitched part');
    assert.strictEqual(S.partsViewMode, false, 'left Parts view so the part is what draws');
    assert.strictEqual(S.tempoMapMode, false, 'left Tempo Map view');
    assert.strictEqual(S.tempoSel, -1, 'tempo selection cleared with the mode');
});

t('switcher → Drums resyncs the <select> even when the drums path is unavailable', () => {
    Object.assign(S, {
        arrangements: [GTR('Lead'), DRUMS()], currentArr: 0,
        drumTab: null, format: 'sloppak',   // no drum tab → the guarded early return
        tabViewMode: false, drumEditMode: false, sel: new Set(),
    });
    const { fn, counts } = makeSwitcher();
    fn('1');
    assert.strictEqual(counts.selectorSyncs, 1,
        'the dropdown is snapped back off the Drums option it optimistically showed');
    assert.strictEqual(S.drumEditMode, false, 'nothing switched');
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
