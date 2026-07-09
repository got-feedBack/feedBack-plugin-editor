'use strict';
/*
 * Tests for the per-part view switcher + universal read-first piano roll
 * (@pure:view-pref block, the isKeysMode/isKeysArr split, _rollMidiForNote,
 * the sounding-pitch piano range, and the EditHistory read-only-roll gate).
 *
 * The view became a per-part CHOICE instead of a function of the part's
 * name: fretted parts may opt into the piano roll (read-first — rendering
 * at sounding pitch, every mutation inert until suggest-position lands).
 * These fail on main, where none of the seam exists.
 *
 * Run: node tests/view_switcher.test.js
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
const KEYS_PATTERN_SRC = (src.match(/const KEYS_PATTERN = [^\n]+\n/) || [null])[0];
assert.ok(KEYS_PATTERN_SRC, 'KEYS_PATTERN must exist');

let pass = 0, fail = 0;
function t(name, fn) {
    try { fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}

// ── Pure: view resolution + pref keying ──────────────────────────────

const P = new Function(
    '"use strict";' + KEYS_PATTERN_SRC + extractBlock('view-pref')
    + '\nreturn { _partViewKeyPure, _viewForPure };'
)();

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

function makeViewEnv(S, seed = {}) {
    const map = new Map(Object.entries(seed));
    const ls = {
        getItem: k => (map.has(k) ? map.get(k) : null),
        setItem: (k, v) => { map.set(k, String(v)); },
        removeItem: k => { map.delete(k); },
        map,
    };
    const envSrc = '"use strict";'
        + KEYS_PATTERN_SRC + extractBlock('view-pref')
        + '\nlet _viewPrefCache = null;\nlet _viewPrefFor = null;\n'
        + extractFn('_viewPrefs') + '\n' + extractFn('_viewPrefsSave') + '\n'
        + extractFn('viewFor') + '\n' + extractFn('isKeysArr') + '\n'
        + extractFn('isKeysMode') + '\n' + extractFn('_rollReadOnly') + '\n'
        + 'return { viewFor, isKeysArr, isKeysMode, _rollReadOnly, _viewPrefs, _viewPrefsSave };';
    return { env: new Function('S', 'localStorage', envSrc)(S, ls), ls, S };
}

t('per-song pref round-trip: override honored, other songs unaffected', () => {
    const S = { filename: 'song.sloppak', currentArr: 0, arrangements: [{ id: 'lead', name: 'Lead' }] };
    const { env, ls } = makeViewEnv(S, {
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
    const S = { filename: 's.sloppak', currentArr: 0, arrangements: [{ id: 'a1', name: 'Lead' }] };
    const { env } = makeViewEnv(S, { 'editorViewPref:s.sloppak': '{"a1":"piano"}' });
    S.arrangements[0].name = 'Renamed Solo';
    assert.strictEqual(env.viewFor(S.arrangements[0]), 'piano', 'stable id keeps the pref');
    S.arrangements[0].name = 'Piano';   // becomes a keys part by name
    assert.strictEqual(env.isKeysMode(), true);
    assert.strictEqual(env.isKeysArr(), true);
    assert.strictEqual(env._rollReadOnly(), false, 'keys data in the roll is fully editable');
});

t('junk stored JSON never breaks resolution', () => {
    const S = { filename: 'x.sloppak', currentArr: 0, arrangements: [{ id: 'a', name: 'Lead' }] };
    const { env } = makeViewEnv(S, { 'editorViewPref:x.sloppak': '[not json' });
    assert.strictEqual(env.viewFor(S.arrangements[0]), 'string');
});

// ── Sounding-pitch mapping in the roll ───────────────────────────────

const M = new Function(
    '"use strict";' + extractBlock('fret-pitch')
    + '\n' + extractFn('noteToMidi') + '\n' + extractFn('_rollMidiForNote')
    + '\nreturn { _rollMidiForNote, noteToMidi };'
)();
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
    const rangeSrc = '"use strict";'
        + extractBlock('fret-pitch') + '\n'
        + extractFn('noteToMidi') + '\n' + extractFn('_rollMidiForNote') + '\n'
        + 'let pianoRange = { lo: 36, hi: 96 };\nlet PIANO_LANE_H = 10;\n'
        + extractFn('updatePianoRange') + '\n'
        + 'return (notesArr, rctx) => {'
        + '  globalThis.__vsNotes = notesArr; globalThis.__vsCtx = rctx;'
        + '  updatePianoRange();'
        + '  return pianoRange;'
        + '};';
    const run = new Function(
        'notes', '_rollPitchCtx',
        rangeSrc
    )(() => globalThis.__vsNotes, () => globalThis.__vsCtx);
    // Open low E (sounding 40) + high-e fret 0 (sounding 64), no capo.
    const r = run(
        [{ string: 0, fret: 0 }, { string: 5, fret: 0 }],
        { openMidi: [40, 45, 50, 55, 59, 64], tuning: [0, 0, 0, 0, 0, 0], capo: 0 });
    assert.strictEqual(r.lo, Math.max(0, Math.floor(40 / 12) * 12 - 6), 'floor from sounding 40');
    assert.strictEqual(r.hi, Math.min(143, Math.ceil(65 / 12) * 12 + 5), 'ceiling from sounding 64');
    // The packing would have put string 5 fret 0 at 120 — assert we did NOT.
    assert.ok(r.hi < 100, 'range must come from sounding pitch, not string*24+fret');
    delete globalThis.__vsNotes; delete globalThis.__vsCtx;
});

// ── The read-only-roll gate in EditHistory ───────────────────────────

function makeHistory(locked) {
    const S = { currentArr: 0 };
    const notices = { count: 0 };
    const env = new Function(
        'document', 'S', 'draw', 'updateStatus', '_rollReadOnly', '_rollLockNotice',
        '"use strict";' + extractBlock('edit-history') + '\nreturn { EditHistory };'
    )(
        { getElementById: () => ({ disabled: false }) },
        S, () => {}, () => {},
        () => locked.value,
        () => { notices.count++; },
    );
    return { history: new env.EditHistory(), notices };
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
    locked.value = false;   // user switches back to String view
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
    locked.value = true;            // user switches this part into the roll
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
    const note = { string: 0, fret: 3, techniques: {} };
    const locked = { value: true };
    let notices = 0, renders = 0;
    const setFlag = extractWinFn('editorInspectorSetFlag', {
        _selectedNotes: () => [note],
        _rollReadOnly: () => locked.value,
        _rollLockNotice: () => { notices++; },
        _renderInspector: () => { renders++; },
        draw: () => {},
        updateStatus: () => {},
    });
    setFlag('accent', true);
    assert.strictEqual(note.techniques.accent, undefined, 'no write while read-only');
    assert.strictEqual(notices, 1, 'the user is told why');
    assert.ok(renders >= 1, 'the checkbox is bounced back to the model');
    locked.value = false;
    setFlag('accent', true);
    assert.strictEqual(note.techniques.accent, true, 'writes once editable');
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
