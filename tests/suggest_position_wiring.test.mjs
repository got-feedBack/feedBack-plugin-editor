/*
 * Suggest-position WRITE-PATH wiring — P6 / VA.3 (design V4).
 *
 * The pure resolver is covered by suggest_position.test.js; this suite covers
 * the wiring AROUND it — the trust-critical glue that actually writes notes:
 *   1. _rollAddByPitch resolves an unambiguous pitch → writes a note MARKED
 *      SUGGESTED, and passes the read-only-roll edit lock via `suggestResolved`.
 *   2. an ambiguous pitch is NOT written — it hands off to the confirm popover.
 *   3. a popover pick is born CONFIRMED (never marked suggested).
 *   4. mark lifecycle: add→suggested, undo removes+unmarks, redo re-marks;
 *      a deliberate position move (MoveToStringCmd) CONFIRMS + undo re-marks;
 *      Accept clears the selection's marks + undo restores them.
 *   5. the lock still blocks an ordinary (unflagged) command in the locked roll.
 *   6. WIRE PURITY: a suggested add puts NOTHING on the note object, so the save
 *      payload (arr.notes solos + reconstructChords chord members) carries no
 *      suggested/fingering/confidence field — proven end-to-end through the real
 *      reconstructChords, plus the adversarial demonstration of WHY a note field
 *      would be wrong (leaks on solos, vanishes on chords).
 *
 * These reference P6 wiring absent on main (the marks, the write path, the
 * `suggestResolved` lock carve-out), so the suite fails on main.
 *
 * Run: node tests/suggest_position_wiring.test.mjs
 */
import assert from 'node:assert';
import fs from 'node:fs';
import { reconstructChords } from '../src/chords.js';
import {
    _clearSuggested, _isSuggested, _markSuggested, _suggestedCount, _suggestedNotes,
} from '../src/notes.js';
import {
    _activeAnchorAtPure, _enumerateFrettedPositionsPure, _suggestPositionPure,
} from '../src/position.js';
import { LC, lanes } from '../src/lanes.js';
import { S as realS } from '../src/state.js';

// The suggest blocks and the roll-add helpers still live in src/main.js and are
// still sliced; `reconstructChords` moved to src/chords.js and is imported, so
// section 6 drives it against the REAL `S` rather than a fabricated one.
const src = fs.readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');

function extractBlock(name) {
    // Lenient start: some blocks carry trailing prose after `:start` (e.g.
    // chord-relink) rather than an immediate `*/`, so match up to the :end.
    const re = new RegExp('/\\* @pure:' + name + ':start[\\s\\S]*?@pure:' + name + ':end \\*/');
    const m = src.match(re);
    if (!m) { console.error(`FAIL: @pure:${name} block not found in src/main.js`); process.exit(1); }
    return m[0];
}
function extractByKeyword(keyword, label) {
    const start = src.indexOf(keyword);
    assert.ok(start >= 0, `${label || keyword} must exist in src/main.js`);
    const open = src.indexOf('{', start);
    let depth = 0;
    for (let i = open; i < src.length; i++) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}' && --depth === 0) return src.slice(start, i + 1);
    }
    throw new Error(`unbalanced braces extracting ${label || keyword}`);
}
const extractFn = name => extractByKeyword('function ' + name + '(', 'function ' + name);
const extractClass = name => extractByKeyword('class ' + name, 'class ' + name);

let pass = 0, fail = 0;
function t(name, fn) {
    try { fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + (e && e.message)); }
}

// Standard 6-string guitar, low → high: E2 A2 D3 G3 B3 E4.
const OPEN = [40, 45, 50, 55, 59, 64];
const TUN = [0, 0, 0, 0, 0, 0];
const NOTE_KEYS = ['fret', 'string', 'sustain', 'techniques', 'time'];

function assertPureNote(n, label) {
    assert.deepStrictEqual(Object.keys(n).sort(), NOTE_KEYS,
        `${label}: note carries exactly the wire fields (no mark/confidence field)`);
}
function assertNoForbidden(obj, label) {
    const s = JSON.stringify(obj);
    assert.ok(!/suggest|fingering|confidence/i.test(s),
        `${label}: serialized payload has no suggested/fingering/confidence field`);
}

// ── The write-path harness (locked roll: _rollReadOnly ⇒ true) ────────────────
// `_suggestedCount` moved to src/notes.js and closes over the REAL `S`, so the
// sandbox has to share that object rather than fabricate its own — otherwise the
// count would read an arrangement the commands never touched.
function makeEnv({ notes: seed = [], arrName = 'Lead' } = {}) {
    Object.assign(realS, {
        currentArr: 0,
        arrangements: [{ id: 'a1', name: arrName, tuning: TUN.slice(),
                         notes: seed.map(n => ({ ...n })), anchors_user: [], anchors: [] }],
        sel: new Set(),
    });
    const S = realS;
    const statuses = [];
    const refusals = [];   // records _rollConfirmPosition handoffs
    const fullSrc = '"use strict";'
        + extractBlock('edit-history')
        + '\n' + extractFn('_withStableSelection')
        + '\n' + extractClass('AddNoteCmd')
        + '\n' + extractClass('MoveToStringCmd')
        + '\n' + extractClass('AcceptPositionsCmd')
        + '\n' + extractFn('_rollAnchorList')
        + '\n' + extractFn('_occupiedStringsAt')
        + '\n' + extractFn('_prevNoteBefore')
        + '\n' + extractFn('_defaultAddSustain')
        + '\n' + extractFn('_commitAddResolved')
        + '\n' + extractFn('_rollAddByPitch')
        + '\n' + extractFn('_execAcceptPositions')
        + '\nconst history = new EditHistory(); S.history = history;'
        + '\nreturn { history, _rollAddByPitch, _commitAddResolved, _execAcceptPositions,'
        + ' _isSuggested, _markSuggested, _clearSuggested, _suggestedCount,'
        + ' AddNoteCmd, MoveToStringCmd };';
    const env = new Function(
        'S', 'document', 'notes', 'setStatus', 'draw', 'updateStatus', '_renderInspector',
        '_editBlipAt', '_rollReadOnly', '_rollLockNotice', '_editorCurrentNoteIndices',
        '_rollPitchCtx', '_rollConfirmPosition',
        '_markSuggested', '_clearSuggested', '_isSuggested', '_suggestedNotes',
        '_suggestPositionPure', '_enumerateFrettedPositionsPure', '_activeAnchorAtPure',
        '_suggestedCount',
        fullSrc
    )(
        S,
        { getElementById: () => ({ disabled: false }) },
        () => S.arrangements[S.currentArr].notes,
        m => statuses.push(m),
        () => {}, () => {}, () => {}, () => {},
        () => true,                                   // _rollReadOnly: the locked fretted roll
        () => statuses.push('LOCKED'),
        () => (S.sel && S.sel.size ? [...S.sel] : []),
        () => ({ openMidi: OPEN, tuning: TUN.slice(), capo: 0 }),
        (res, pitch, time) => refusals.push({ reason: res.reason, pitch, time, candidates: res.candidates }),
        _markSuggested, _clearSuggested, _isSuggested, _suggestedNotes,  // src/notes.js
        _suggestPositionPure, _enumerateFrettedPositionsPure, _activeAnchorAtPure,
        _suggestedCount,
    );
    return { S, env, statuses, refusals, notes: () => S.arrangements[0].notes };
}

// ── 1. resolve → write + mark suggested, passing the lock ─────────────────────
t('an unambiguous pitch is written, marked suggested, and passes the read-only-roll lock', () => {
    // pitch 56 = G#3: only fretted (s0/16 s1/11 s2/6 s3/1), no open ⇒ lowest = s3/1.
    const { env, notes, S } = makeEnv();
    env._rollAddByPitch(56, 0, 0, 0);
    const nn = notes();
    assert.strictEqual(nn.length, 1, 'the note was written INSIDE the locked roll');
    assert.deepStrictEqual({ string: nn[0].string, fret: nn[0].fret }, { string: 3, fret: 1 });
    assert.strictEqual(env.history.undo.length, 1, 'one undo step (suggestResolved passed the lock)');
    assert.ok(env._isSuggested(nn[0]), 'marked suggested (machine pick)');
    assert.strictEqual(env._suggestedCount(), 1, 'unresolved count reflects the mark');
    assert.ok(S.sel.has(0), 'the new note is selected');
    assertPureNote(nn[0], 'suggested add');
    assertNoForbidden(nn[0], 'suggested add');
});

// ── 2. refusal → hand off to the popover, write nothing ───────────────────────
t('an ambiguous pitch (open-vs-fretted) writes nothing and hands off to the confirm popover', () => {
    // pitch 55 = G3: open s3/0 AND fretted s2/5 etc. ⇒ open-vs-fretted refusal.
    const { env, notes, refusals } = makeEnv();
    env._rollAddByPitch(55, 0, 5, 6);
    assert.strictEqual(notes().length, 0, 'nothing written on a refusal');
    assert.strictEqual(env.history.undo.length, 0);
    assert.strictEqual(refusals.length, 1, 'popover was invoked');
    assert.strictEqual(refusals[0].reason, 'open-vs-fretted');
    assert.ok(refusals[0].candidates.length >= 2, 'candidate list carried to the popover');
});

// ── 3. a popover pick is CONFIRMED, not suggested ─────────────────────────────
t('a popover pick (user chose) is written confirmed — never marked suggested', () => {
    const { env, notes } = makeEnv();
    env._commitAddResolved({ string: 3, fret: 0 }, 0, false);   // suggested=false
    const nn = notes();
    assert.strictEqual(nn.length, 1);
    assert.strictEqual(env.history.undo.length, 1, 'a user pick also passes the lock');
    assert.ok(!env._isSuggested(nn[0]), 'user pick is confirmed, not suggested');
    assert.strictEqual(env._suggestedCount(), 0);
    assertPureNote(nn[0], 'confirmed add');
});

// ── 4a. undo removes + unmarks, redo re-marks ─────────────────────────────────
t('undo removes a suggested note and clears its mark; redo restores both', () => {
    const { env, notes } = makeEnv();
    env._rollAddByPitch(56, 0, 0, 0);
    const ref = notes()[0];
    env.history.doUndo();
    assert.strictEqual(notes().length, 0, 'undo removed the note in the locked roll');
    assert.ok(!env._isSuggested(ref), 'undo cleared the suggested mark');
    env.history.doRedo();
    assert.strictEqual(notes().length, 1);
    assert.ok(env._isSuggested(notes()[0]), 'redo re-marked it suggested');
});

// ── 4b. a deliberate position move CONFIRMS; undo re-marks ────────────────────
t('moving a suggested note (MoveToStringCmd) confirms it; undo restores the suggested mark', () => {
    const { env, notes } = makeEnv({ notes: [{ time: 0, string: 3, fret: 1, sustain: 0, techniques: {} }] });
    const ref = notes()[0];
    env._markSuggested(ref);
    assert.ok(env._isSuggested(ref), 'precondition: suggested');
    const mv = new env.MoveToStringCmd([{ index: 0, oldString: 3, oldFret: 1, newString: 2, newFret: 6 }]);
    mv.pitchPreserving = true;                         // a same-pitch move passes the lock
    env.history.exec(mv);
    assert.deepStrictEqual({ string: ref.string, fret: ref.fret }, { string: 2, fret: 6 }, 'moved');
    assert.ok(!env._isSuggested(ref), 'a deliberate position choice confirms the note');
    env.history.doUndo();
    assert.deepStrictEqual({ string: ref.string, fret: ref.fret }, { string: 3, fret: 1 }, 'move undone');
    assert.ok(env._isSuggested(ref), 'undo restored the suggested state');
});

// ── 4c. Accept clears the selection's marks; undo restores them ───────────────
t('Accept confirms the selected suggested notes in one undo step; undo re-marks exactly those', () => {
    const { env, notes, S } = makeEnv({
        notes: [
            { time: 0, string: 3, fret: 1, sustain: 0, techniques: {} },
            { time: 1, string: 2, fret: 6, sustain: 0, techniques: {} },
        ],
    });
    const nn = notes();
    env._markSuggested(nn[0]);
    env._markSuggested(nn[1]);
    S.sel = new Set([0, 1]);
    assert.strictEqual(env._suggestedCount(), 2, 'precondition: two suggested');
    env._execAcceptPositions();
    assert.strictEqual(env._suggestedCount(), 0, 'both confirmed');
    assert.strictEqual(env.history.undo.length, 1, 'one undo step for the whole Accept');
    env.history.doUndo();
    assert.strictEqual(env._suggestedCount(), 2, 'undo re-marked exactly the accepted notes');
});

// ── 5. the lock still blocks an ordinary command ──────────────────────────────
t('the read-only-roll lock still blocks an ordinary (unflagged) command', () => {
    const { env, notes, statuses } = makeEnv();
    env.history.exec(new env.AddNoteCmd({ time: 0, string: 0, fret: 0, sustain: 0, techniques: {} }));
    assert.strictEqual(notes().length, 0, 'an add WITHOUT suggestResolved stays inert in the locked roll');
    assert.strictEqual(env.history.undo.length, 0);
    assert.ok(statuses.includes('LOCKED'), 'the user is told why');
});

// ── 6. WIRE PURITY through the real reconstructChords (solo AND chord) ─────────
// reconstructChords closes over the real `S` (src/state.js) and the real
// `lanes()`, so drive those instead of a sandbox. The fixture arrangement is a
// 6-string guitar part ('Lead', notes on strings 0-3), so lanes() computes 6 —
// exactly what the old `() => 6` stub asserted by fiat.
function makeReconstruct() {
    realS.arrangements = [null];
    realS.currentArr = 0;
    realS.history = { reset() {} };
    realS.handshapeSel = null;
    LC.active = false;   // no draw frame is open; lanes() must really compute
    return { S: realS, reconstructChords };
}

t('a suggested add leaves NO field on the wire — solo and chord survive reconstructChords clean', () => {
    const { S, reconstructChords } = makeReconstruct();
    // Notes exactly as _commitAddResolved builds them: one solo + a two-note chord.
    S.arrangements[0] = {
        name: 'Lead', chord_templates: [],
        notes: [
            { time: 0, string: 3, fret: 1, sustain: 0, techniques: {} },       // solo
            { time: 1, string: 0, fret: 3, sustain: 0, techniques: {} },       // chord member
            { time: 1, string: 1, fret: 2, sustain: 0, techniques: {} },       // chord member
        ],
    };
    // Pin the premise of using the real lanes() instead of the old `() => 6`
    // stub: this fixture really is a 6-lane part.
    assert.strictEqual(lanes(), 6, 'the fixture is a 6-string guitar arrangement');
    reconstructChords();
    const arr = S.arrangements[0];
    assert.strictEqual(arr.notes.length, 1, 'the solo stays a solo');
    assert.strictEqual(arr.chords.length, 1, 'the same-time pair becomes one chord');
    assert.strictEqual(arr.chords[0].notes.length, 2, 'both chord members preserved');
    assertPureNote(arr.notes[0], 'solo (by-reference)');
    for (const cn of arr.chords[0].notes) assertPureNote(cn, 'chord member (rebuilt)');
    assertNoForbidden({ notes: arr.notes, chords: arr.chords }, 'save payload');
});

t('WHY a WeakSet: a note FIELD leaks on solos and vanishes on chords (regression guard)', () => {
    const { S, reconstructChords } = makeReconstruct();
    S.arrangements[0] = {
        name: 'Lead', chord_templates: [],
        notes: [
            { time: 0, string: 3, fret: 1, sustain: 0, techniques: {}, _suggested: true },  // solo
            { time: 1, string: 0, fret: 3, sustain: 0, techniques: {}, _suggested: true },  // chord
            { time: 1, string: 1, fret: 2, sustain: 0, techniques: {}, _suggested: true },  // chord
        ],
    };
    reconstructChords();
    const arr = S.arrangements[0];
    // The solo is serialized BY REFERENCE ⇒ a note field would ride to the wire.
    assert.ok('_suggested' in arr.notes[0], 'a note field LEAKS on solos (would hit the wire)');
    // The chord member is REBUILT via an explicit field mapper ⇒ a note field is lost.
    assert.ok(!('_suggested' in arr.chords[0].notes[0]), 'a note field VANISHES on chords (would be lost)');
    // Both failures are exactly why "suggested" is a module WeakSet, not a note field.
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
