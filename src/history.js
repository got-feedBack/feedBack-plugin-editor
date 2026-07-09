// ════════════════════════════════════════════════════════════════════
// Undo / redo stack.
//
// The 47 command classes still live in src/main.js — they are interleaved with
// the feature code that constructs them, and each reaches deep into it. Only
// the stack itself lifts cleanly. Every command is duck-typed: `exec()`,
// `rollback()`, and the three opt-out flags this file reads (`songScope`,
// `pitchPreserving`, `suggestResolved`).
//
// Browser surface: `document.getElementById` in _ui(), for the toolbar's
// undo/redo buttons.
//
// main.js coupling is three symbols — `_historyEnsureArr`, `draw`,
// `updateStatus` — and importing them would close a cycle (main.js imports this
// module). They arrive through setHistoryHooks() instead, the same shape as
// canvas.js's setCanvas() and geometry.js's setLaneMetrics().
// ════════════════════════════════════════════════════════════════════
import { S, bumpEditGen } from './state.js';
import { isKeysMode, updatePianoRange, _rollReadOnly, _rollLockNotice } from './keys.js';

// Cap the undo stack so a marathon session can't grow memory without bound —
// the stack held every command since the last save/load. Oldest entries drop
// first; 500 comfortably exceeds any realistic between-saves editing run.
export const MAX_UNDO = 500;

// Defaults keep the class usable before main.js wires it up (and in tests that
// only exercise the stack): ensureArr never refuses, the UI callbacks no-op.
const _hooks = {
    ensureArr: () => true,
    draw: () => {},
    updateStatus: () => {},
};

export function setHistoryHooks(hooks) { Object.assign(_hooks, hooks); }

// A NOTE-scope command is refused while a fretted part is shown in the
// read-only piano roll (V4). Three carve-outs pass:
//   songScope        — edits song-level data (drum tab, tempo grid), not the
//                      fretted chart, so an unrelated part being in the roll
//                      must not freeze tempo/drum editing.
//   pitchPreserving  — the VA.5 position cycle and sustain resize can never
//                      change what a note SOUNDS like, only which string/fret
//                      plays it (or for how long), so the "no silent pitch
//                      writes" contract the lock protects is unbreakable here
//                      by construction.
//   suggestResolved  — the VA.3 suggest-position writer (resolved adds +
//                      Accept) IS the sanctioned string/fret write path the
//                      lock was holding the door for. It marks, never guesses.
// Nothing else opts out. Returns true when the command must not run.
function _locked(cmd) {
    if (cmd.songScope === true || cmd.pitchPreserving === true || cmd.suggestResolved === true) return false;
    if (!_rollReadOnly()) return false;
    _rollLockNotice();
    return true;
}

export class EditHistory {
    constructor() { this.undo = []; this.redo = []; }

    exec(cmd) {
        if (_locked(cmd)) return;
        // Tag each command with the arrangement it was executed against: most
        // commands resolve their target through the notes()/chords() accessors
        // at rollback time, so an undo issued after switching arrangements
        // would silently mutate the WRONG arrangement's notes.
        cmd._arrIdx = (cmd.songScope === true) ? -1 : (S.currentArr ?? -1);
        cmd.exec();
        this.undo.push(cmd);
        if (this.undo.length > MAX_UNDO) this.undo.shift();
        this.redo = [];
        this._afterEdit();
        this._ui();
    }

    doUndo() {
        if (!this.undo.length) return;
        const c = this.undo[this.undo.length - 1];
        // Peek-then-pop: if the command belongs to another arrangement,
        // ensureArr switches to it (or refuses when it's gone) BEFORE the
        // command leaves the stack, so a refused undo loses nothing.
        if (!_hooks.ensureArr(c)) return;
        // Rolling a NOTE-scope command back would write the fretted chart shown
        // read-only in the roll, bypassing the exec/drag lock. Refuse — peek
        // only, so the command stays on the stack. ensureArr above has already
        // switched to the command's arrangement, so this evaluates against the
        // part the rollback would actually touch.
        if (_locked(c)) return;
        this.undo.pop(); c.rollback(); this.redo.push(c);
        this._afterEdit(); this._ui(); _hooks.draw(); _hooks.updateStatus();
    }

    doRedo() {
        if (!this.redo.length) return;
        const c = this.redo[this.redo.length - 1];
        if (!_hooks.ensureArr(c)) return;
        // Re-exec of a NOTE-scope command writes the read-only chart: same lock.
        if (_locked(c)) return;
        this.redo.pop(); c.exec(); this.undo.push(c);
        // Re-apply the MAX_UNDO cap: a redo pushes back onto the undo stack, so
        // without this a redo-heavy session could grow it past the bound that
        // exec()/doUndo already enforce. Oldest drops first, mirroring exec().
        if (this.undo.length > MAX_UNDO) this.undo.shift();
        this._afterEdit(); this._ui(); _hooks.draw(); _hooks.updateStatus();
    }

    // #18: drop the whole stack when the model is rebuilt under us (the save /
    // build flatten+reconstructChords round-trip renumbers arr.notes, so every
    // index-based command would now roll back into the wrong note). Reuse the
    // live instance + its _ui() wiring rather than reassigning S.history.
    // Not _afterEdit() — that nudges the piano viewport, which a clear shouldn't.
    reset() { this.undo = []; this.redo = []; this._ui(); }

    _afterEdit() {
        // Bump the shared edit generation: the section-coverage, chord-display
        // and drum-lint memos all key on it. An in-place note-time move keeps
        // the notes array's identity and length, so their cheap cache keys
        // can't see it — this bump is what forces a recompute.
        bumpEditGen();
        // Keep the keys viewport in sync with the current note range so
        // multi-octave authoring works without manual range control.
        // expandOnly=true so adding a note outside the current viewport
        // extends it instead of collapsing to the latest note's octave.
        if (isKeysMode()) updatePianoRange(true);
    }

    _ui() {
        const u = document.getElementById('editor-undo');
        const r = document.getElementById('editor-redo');
        if (u) u.disabled = !this.undo.length;
        if (r) r.disabled = !this.redo.length;
    }
}
