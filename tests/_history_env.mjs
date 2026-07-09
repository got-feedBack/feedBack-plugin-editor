/*
 * Shared environment for the suites that exercise src/history.js.
 *
 * Not a test file — `node --test` globs `*.test.{js,mjs}`, so this is skipped.
 *
 * EditHistory used to be sliced out of src/main.js and eval'd with a fabricated
 * `S` and hand-stubbed `_rollReadOnly` / `_rollLockNotice`. Now it is a real
 * import that closes over the REAL `S` from src/state.js and the REAL view
 * predicates from src/keys.js, so a suite that fabricates its own `S` would go
 * green while testing an object the history never touches.
 *
 * Two consequences, both handled here:
 *
 *   1. Seed the real `S` (Object.assign, never reassign — importers hold the
 *      same object).
 *   2. Drive the roll lock through real state instead of stubbing the predicate.
 *      `_rollReadOnly()` is `isKeysMode() && !isKeysArr()`: a FRETTED part
 *      (name not matching KEYS_PATTERN) shown in the roll. `_viewPrefs()`
 *      returns its live cache object, so writing the part key into it is enough
 *      — no localStorage. The cache is memoised on `S.filename`, which is why
 *      seedState() always sets the same one.
 *
 * `EditHistory._ui()` and `setStatus()` reach for `document`; the stub below
 * stands in for the toolbar buttons and the status line.
 */
import { S } from '../src/state.js';
import { _partViewKeyPure, _viewPrefs } from '../src/keys.js';
import { setHistoryHooks } from '../src/history.js';

const SONG = 'history-test.sloppak';

const _els = {};

// setStatus() writes textContent; log every write so a suite can COUNT lock
// notices (the old sandboxes injected a counting _rollLockNotice stub).
const _statusLog = [];
export const statusEl = {
    _v: '',
    get textContent() { return this._v; },
    set textContent(v) { this._v = v; _statusLog.push(v); },
};

if (typeof globalThis.document === 'undefined') {
    globalThis.document = {
        getElementById(id) {
            if (id === 'editor-status') return statusEl;
            return (_els[id] ||= { id, disabled: false, value: '' });
        },
    };
}

export const undoBtn = () => document.getElementById('editor-undo');
export const redoBtn = () => document.getElementById('editor-redo');

/** Messages passed to setStatus() — how a suite observes _rollLockNotice().
 *  `statusMessages` is the LIVE array, so a suite can hold it and read it later. */
export const statusMessages = _statusLog;
export const lastStatus = () => statusEl._v;
export const statusLog = () => _statusLog.slice();
export const lockNotices = () => _statusLog.filter(m => /read-only/.test(m)).length;
export const clearStatus = () => { _statusLog.length = 0; statusEl._v = ''; };

/**
 * Seed the real `S`. `rollView: true` puts every arrangement in the piano roll;
 * combined with a fretted part name that is exactly the read-only lock.
 */
export function seedState({ arrangements = [], currentArr = 0, rollView = false, ...rest } = {}) {
    Object.assign(S, {
        filename: SONG,
        arrangements,
        currentArr,
        sel: new Set(),
        ...rest,
    });
    setRollView(rollView);
    clearStatus();
    return S;
}

/** Move every arrangement in/out of the piano roll, live — the view prefs cache
 *  is the same object viewFor() reads, so mutating it flips isKeysMode(). */
export function setRollView(on) {
    const prefs = _viewPrefs();
    for (const k of Object.keys(prefs)) delete prefs[k];
    if (on) for (const a of S.arrangements) if (a) prefs[_partViewKeyPure(a)] = 'piano';
}

/**
 * Install counting stand-ins for the three main.js symbols history.js cannot
 * import back without closing a cycle. Pass `ensureArr` to model a refusal.
 */
export function trackHooks({ ensureArr } = {}) {
    const calls = { draw: 0, updateStatus: 0, ensureArr: [] };
    setHistoryHooks({
        draw: () => { calls.draw++; },
        updateStatus: () => { calls.updateStatus++; },
        ensureArr: (cmd) => {
            calls.ensureArr.push(cmd);
            return ensureArr ? ensureArr(cmd) : true;
        },
    });
    return calls;
}
