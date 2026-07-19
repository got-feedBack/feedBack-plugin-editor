// Strings (tuning) editor: add/remove strings on the active fretted arrangement
// and edit per-string tuning offsets, all undoable. The window.editor* entry
// points are re-attached by main.js; repaint/status go through host.

import { AddStringCmd, RemoveStringCmd, RemoveStringWithNotesCmd } from './commands.js';
import { LANE_H, TIMELINE_TOP, WAVEFORM_H } from './geometry.js';
import { isKeysMode, KEYS_PATTERN } from './keys.js';
import { _stringCountFor, laneLabels } from './lanes.js';
import { S, editGen } from './state.js';
import { host } from './host.js';


/* @pure:string-tuning:start */
// Range per role. Bass 4–6 (add low B, then high C). Guitar 6–8 (add low
// B, then low F#). These floors/ceilings are NOT free policy: the pitch
// and label model (`_openMidiForArr` / `laneLabels`) can only represent a
// FIXED set of extended shapes — guitar strings are prepended at the low
// end, bass adds low B at the 5th then high C at the 6th. A guitar below
// 6 or a string added at the "wrong" end has no consistent open-pitch or
// label, so `_stringCountFor` would re-snap the count and silently
// re-interpret every note index. The modal therefore offers each add/
// remove only at the end the model supports (see `_addPositionPure` /
// `_removePositionPure`); direct per-string tuning entry below covers the
// exotic tunings (drop/open/re-entrant) that changing the COUNT cannot.
function _stringsRangePure(isBass) {
    return isBass ? { min: 4, max: 6 } : { min: 6, max: 8 };
}

// The only END an add may touch for a given role + current count, or null
// when the arrangement is at its ceiling. Mirrors the fixed extension
// order baked into `_openMidiForArr`/`laneLabels`: bass grows low (4→5)
// then high (5→6); guitar grows low (6→7→8). Adding at any other end
// yields a count/label/pitch shape the renderer can't represent, so the
// modal never offers it. Pure — role + count in, position out.
function _addPositionPure(isBass, cur) {
    if (isBass) {
        if (cur === 4) return 'low';   // 4→5 adds low B
        if (cur === 5) return 'high';  // 5→6 adds high C
        return null;                   // 6-string bass is the ceiling
    }
    if (cur === 6 || cur === 7) return 'low';  // 6→7 low B, 7→8 low F#
    return null;                               // 8-string guitar is the ceiling
}

// The only END a remove may touch — the inverse of `_addPositionPure`, so
// removing always peels the string the last add appended and the count
// collapses back to a shape the model can represent. null at the floor.
function _removePositionPure(isBass, cur) {
    if (isBass) {
        if (cur === 6) return 'high';  // 6→5 peels high C
        if (cur === 5) return 'low';   // 5→4 peels low B
        return null;                   // 4-string bass is the floor
    }
    if (cur === 7 || cur === 8) return 'low';  // 8→7, 7→6 peel the low ext
    return null;                               // 6-string guitar is the floor
}

// Clamp a per-string tuning offset (semitones from that lane's standard
// pitch). ±36 covers everything real — a re-entrant banjo drone sits far
// above its lane position, an octave-down 8-string far below — while a
// junk value can never author NaN into the wire tuning array.
function _stringTuningClampPure(v) {
    const n = Math.round(Number(v));
    if (!Number.isFinite(n)) return 0;
    return Math.max(-36, Math.min(36, n));
}

// Undoable per-string tuning edit — the modal's direct-entry rows. Holds
// the target arrangement INDEX (undo can fire after an arrangement
// switch) plus the exact old offset; lane count never changes, so no
// resize is involved.
class SetStringTuningCmd {
    constructor(arrIdx, stringIdx, newOffset) {
        this.arrIdx = arrIdx;
        this.stringIdx = stringIdx;
        this.newOffset = _stringTuningClampPure(newOffset);
        const arr = S.arrangements[arrIdx];
        const t = (arr && arr.tuning) || [];
        this.oldOffset = Number.isFinite(Number(t[stringIdx])) ? Number(t[stringIdx]) : 0;
    }
    _arr() { return S.arrangements[this.arrIdx]; }
    _set(v) {
        const arr = this._arr();
        if (!arr) return;
        if (!Array.isArray(arr.tuning)) arr.tuning = [];
        while (arr.tuning.length <= this.stringIdx) arr.tuning.push(0);
        arr.tuning[this.stringIdx] = v;
    }
    exec() { this._set(this.newOffset); }
    rollback() { this._set(this.oldOffset); }
}
/* @pure:string-tuning:end */

// ── Canvas −/+ string-count buttons (outside the sliced block: these
//    reference KEYS_PATTERN, which the legacy harness doesn't inject) ──

// Whether the buttons apply at all: only the plain fretted String view.
// Every lens that owns the timeline instead (piano roll, drum editor,
// Tempo Map, Parts, Tab view) hides them, as do the non-fretted
// arrangement kinds the Strings modal already refuses.
export function _stringButtonsVisiblePure(arrName, flags) {
    const f = flags || {};
    if (f.keysMode || f.drumEdit || f.tempoMap || f.partsView || f.tabView) return false;
    const name = arrName || '';
    return !KEYS_PATTERN.test(name) && !/^drums/i.test(name);
}

// Tooltip copy for the buttons. Count-centric: they always grow/shrink
// the string COUNT by one, but the END the model extends differs by role
// (bass 5→6 adds a HIGH C), so each label names the string that will
// appear or go.
export function _stringAddLabelPure(isBass, cur) {
    if (isBass) {
        if (cur === 4) return 'Add a 5th string (low B)';
        if (cur === 5) return 'Add a 6th string (high C)';
        return 'A bass supports up to 6 strings';
    }
    if (cur === 6) return 'Add a 7th string (low B)';
    if (cur === 7) return 'Add an 8th string (low F#)';
    return 'A guitar supports up to 8 strings';
}
export function _stringRemoveLabelPure(isBass, cur) {
    if (isBass) {
        if (cur === 6) return 'Remove the high C (6th string)';
        if (cur === 5) return 'Remove the low B (5th string)';
        return 'A bass needs at least 4 strings';
    }
    if (cur === 8) return 'Remove the low F# (8th string)';
    if (cur === 7) return 'Remove the low B (7th string)';
    return 'A guitar needs at least 6 strings';
}

function _stringsRangeForActive() {
    const arr = S.arrangements[S.currentArr];
    const isBass = arr && /bass/i.test(arr.name || '');
    return _stringsRangePure(!!isBass);
}

function _notesOnString(arr, idx) {
    let count = 0;
    for (const n of arr.notes || []) if (n.string === idx) count += 1;
    for (const ch of arr.chords || []) {
        for (const cn of ch.notes || []) if (cn.string === idx) count += 1;
    }
    return count;
}

function _renderStringsModal() {
    const arr = S.arrangements[S.currentArr];
    if (!arr) return;
    const labels = laneLabels();           // low → high, length === lanes()
    // Normalize the display tuning to the real string count so we don't
    // surface RS-XML padding zeros as if they were real strings.
    const tuning = (arr.tuning || []).slice(0, labels.length);
    while (tuning.length < labels.length) tuning.push(0);
    const { min, max } = _stringsRangeForActive();
    const isBass = /bass/i.test(arr.name || '');

    const summary = document.getElementById('editor-strings-summary');
    if (summary) {
        summary.textContent = `${arr.name || 'Arrangement'} — ${labels.length} string${labels.length === 1 ? '' : 's'} (${isBass ? 'bass' : 'guitar'}; range ${min}–${max})`;
    }

    const list = document.getElementById('editor-strings-list');
    if (list) {
        // Build rows with createElement / textContent rather than
        // innerHTML — `tuning[i]` arrives from imported/edited JSON
        // and could be non-numeric, so interpolating it raw would
        // open a DOM-injection vector. Coercing to Number defends
        // both against bad input AND against future code that may
        // surface `lbl` values that aren't already HTML-safe.
        // Display low → high so it reads naturally; `tuning` is also
        // low → high in RS XML order, so iterating tuning matches.
        // Each row carries a DIRECT-ENTRY offset input (semitones from
        // that lane's standard pitch), so any tuning — drop, open,
        // banjo's re-entrant drone — is typable, not just reachable
        // through presets. Edits go through SetStringTuningCmd (undoable).
        list.textContent = '';
        for (let i = 0; i < labels.length; i++) {
            const lbl = labels[i];
            const rawOff = tuning[i];
            const off = Number.isFinite(Number(rawOff)) ? Number(rawOff) : 0;
            const row = document.createElement('div');
            row.className = 'flex items-center justify-between bg-dark-800 rounded px-2 py-1';
            const left = document.createElement('span');
            left.textContent = `String ${i} (${lbl})`;
            const right = document.createElement('label');
            right.className = 'flex items-center gap-1 text-gray-500';
            const input = document.createElement('input');
            input.type = 'number';
            input.min = '-36';
            input.max = '36';
            input.step = '1';
            // The wrapping <label>'s only text is the "st" unit, so without
            // this a screen reader announces the field as just "st spinbutton"
            // with no indication of which string it retunes.
            input.setAttribute('aria-label', `String ${i} (${lbl}) tuning offset in semitones`);
            input.value = String(off);
            input.className = 'w-14 bg-dark-700 border border-gray-700 rounded px-1 py-0.5 text-xs text-gray-300 outline-none text-center';
            input.title = 'Semitones from this lane’s standard pitch (e.g. -2 = whole-step down; a re-entrant drone can sit far above)';
            input.onchange = () => window.editorSetStringTuning(i, input.value);
            const unit = document.createElement('span');
            unit.textContent = 'st';
            right.appendChild(input);
            right.appendChild(unit);
            row.appendChild(left);
            row.appendChild(right);
            list.appendChild(row);
        }
    }

    const curCount = labels.length;  // === lanes()
    const warn = document.getElementById('editor-strings-warning');
    // Enable each end ONLY where the pitch/label model can represent the
    // resulting shape (see `_addPositionPure`/`_removePositionPure`). A
    // guitar has no valid high string and a 4/5-string guitar has no valid
    // low removal, so offering those ends would silently corrupt note
    // indices — hence a hard per-end gate, not a blanket ceiling/floor.
    const addPos = _addPositionPure(!!isBass, curCount);
    const removePos = _removePositionPure(!!isBass, curCount);
    const addLow = document.getElementById('editor-strings-add-low');
    const addHigh = document.getElementById('editor-strings-add-high');
    if (addLow) addLow.disabled = addPos !== 'low';
    if (addHigh) addHigh.disabled = addPos !== 'high';
    // The removable end still refuses to drop a string that carries notes,
    // so removal can never silently discard chart content.
    const removableIdx = removePos === 'low' ? 0 : (removePos === 'high' ? curCount - 1 : -1);
    const blockers = removableIdx >= 0 ? _notesOnString(arr, removableIdx) : 0;
    const removeLow = document.getElementById('editor-strings-remove-low');
    const removeHigh = document.getElementById('editor-strings-remove-high');
    if (removeLow) removeLow.disabled = removePos !== 'low' || blockers > 0;
    if (removeHigh) removeHigh.disabled = removePos !== 'high' || blockers > 0;
    if (warn) {
        if (!removePos) {
            warn.textContent = `Already at the minimum ${min} strings.`;
        } else if (blockers > 0) {
            warn.textContent = `${blockers} note${blockers === 1 ? '' : 's'} on the ${removePos} string — delete or move them before removing.`;
        } else {
            warn.textContent = '';
        }
    }
}

export const editorShowStringsModal = () => {
    const arr = S.arrangements[S.currentArr];
    if (!arr) return;
    if (KEYS_PATTERN.test(arr.name || '') || /^drums/i.test(arr.name || '')) return;
    document.getElementById('editor-strings-modal').classList.remove('hidden');
    _renderStringsModal();
};

export const editorHideStringsModal = () => {
    document.getElementById('editor-strings-modal').classList.add('hidden');
};

export const editorAddString = (pos) => {
    const arr = S.arrangements[S.currentArr];
    if (!arr) return;
    const isBass = /bass/i.test(arr.name || '');
    // Compute the count directly from the active arrangement rather
    // than going through `lanes()` — the latter consults a per-draw
    // cache and our intent here is explicitly "what is this
    // arrangement's current string count?", independent of draw state.
    const cur = _stringCountFor(arr);
    // Only ever add at the END the pitch/label model supports for this
    // role + count. A mismatched request (guitar high, bass low at 5, …)
    // is rejected outright rather than silently coerced, because adding
    // at the unsupported end re-snaps the count and re-labels every note.
    const valid = _addPositionPure(isBass, cur);
    if (!valid || pos !== valid) return;
    // The command's exec() calls _resizeForLaneChange() itself, which
    // covers undo/redo too — no need to duplicate the resize here.
    S.history.exec(new AddStringCmd(S.currentArr, valid));
    _renderStringsModal();
    host.draw();
    host.updateStatus();
};

export const editorRemoveString = (pos) => {
    const arr = S.arrangements[S.currentArr];
    if (!arr) return;
    const isBass = /bass/i.test(arr.name || '');
    // Same reasoning as editorAddString — anchor on `arr` directly
    // rather than the cached `lanes()`.
    const cur = _stringCountFor(arr);
    // Only remove the END the model can collapse back to a representable
    // shape (the inverse of the add order). Any other end would leave the
    // count at a value the labels/pitches no longer match.
    const valid = _removePositionPure(isBass, cur);
    if (!valid || pos !== valid) return;
    const targetIdx = valid === 'low' ? 0 : cur - 1;
    if (_notesOnString(arr, targetIdx) > 0) return;  // UI button is disabled too
    // The command's exec() handles the resize internally (covers
    // undo/redo too); see editorAddString.
    S.history.exec(new RemoveStringCmd(S.currentArr, valid));
    _renderStringsModal();
    host.draw();
    host.updateStatus();
};

// ── Canvas button refresh + handlers ─────────────────────────────────

// Rides the rAF draw-coalesce (called once per drawNow flush), so it must
// stay cheap: everything it writes is derived from this key, and an
// unchanged key bails before any DOM write.
let _stringBtnsKey = '';
let _stringBtnsGen = -1;
let _stringBtnsArrIdx = -1;
let _stringBtnsCur = 6;
export function editorStringButtonsRefresh() {
    const box = document.getElementById('editor-string-btns');
    if (!box) return;
    const arr = S.arrangements[S.currentArr];
    const show = !!arr && _stringButtonsVisiblePure(arr.name, {
        keysMode: isKeysMode(), drumEdit: !!S.drumEditMode, tempoMap: !!S.tempoMapMode,
        partsView: !!S.partsViewMode, tabView: !!S.tabViewMode,
    });
    if (!show) {
        if (_stringBtnsKey !== 'hidden') { box.classList.add('hidden'); _stringBtnsKey = 'hidden'; }
        return;
    }
    const isBass = /bass/i.test(arr.name || '');
    // _stringCountFor walks every note, so memo it on the edit generation
    // (the repo's standard dirty key — in-place moves keep array identity)
    // rather than paying O(notes) on every rAF flush.
    const gen = typeof editGen === 'number' ? editGen : 0;
    if (gen !== _stringBtnsGen || S.currentArr !== _stringBtnsArrIdx) {
        _stringBtnsGen = gen;
        _stringBtnsArrIdx = S.currentArr;
        _stringBtnsCur = _stringCountFor(arr);
    }
    const cur = _stringBtnsCur;
    // Bottom-anchored inside the LOWEST string's label cell (lanes draw
    // high-to-low, so the band bottom is the low string). LANE_H is a live
    // binding re-derived on resize; cur*LANE_H tracks add/remove.
    const top = TIMELINE_TOP + WAVEFORM_H + cur * LANE_H - 21;
    const key = `${top}|${cur}|${isBass}`;
    if (key === _stringBtnsKey) return;
    _stringBtnsKey = key;
    box.classList.remove('hidden');
    box.style.top = top + 'px';
    const addBtn = document.getElementById('editor-string-btn-add');
    const rmBtn = document.getElementById('editor-string-btn-remove');
    if (addBtn) {
        addBtn.disabled = !_addPositionPure(isBass, cur);
        addBtn.title = _stringAddLabelPure(isBass, cur);
    }
    if (rmBtn) {
        rmBtn.disabled = !_removePositionPure(isBass, cur);
        rmBtn.title = _stringRemoveLabelPure(isBass, cur);
    }
}

export const editorCanvasStringAdd = () => {
    const arr = S.arrangements[S.currentArr];
    if (!arr) return;
    const pos = _addPositionPure(/bass/i.test(arr.name || ''), _stringCountFor(arr));
    if (pos) editorAddString(pos);
};

export const editorCanvasStringRemove = () => {
    const arr = S.arrangements[S.currentArr];
    if (!arr) return;
    const isBass = /bass/i.test(arr.name || '');
    const cur = _stringCountFor(arr);
    const pos = _removePositionPure(isBass, cur);
    if (!pos) return;
    const targetIdx = pos === 'low' ? 0 : cur - 1;
    const blockers = _notesOnString(arr, targetIdx);
    if (blockers === 0) { editorRemoveString(pos); return; }
    // The active arrangement is always chord-flattened, so its content on
    // the target string lives in arr.notes. If chord constituents somehow
    // carry notes there anyway (an unflattened state this path can't
    // delete safely), fall back to the modal, whose warning explains.
    let chordNotes = 0;
    for (const ch of arr.chords || []) {
        for (const cn of ch.notes || []) if (cn.string === targetIdx) chordNotes += 1;
    }
    if (chordNotes > 0) { editorShowStringsModal(); return; }
    const lbl = laneLabels()[targetIdx] || `string ${targetIdx}`;
    if (!confirm(`${blockers} note${blockers === 1 ? '' : 's'} live on the ${pos === 'low' ? 'lowest' : 'highest'} string (${lbl}). Remove the string and delete ${blockers === 1 ? 'that note' : 'them'}? (Undoable.)`)) return;
    const indices = [];
    (arr.notes || []).forEach((n, i) => { if (n && n.string === targetIdx) indices.push(i); });
    S.history.exec(new RemoveStringWithNotesCmd(S.currentArr, pos, indices));
    _renderStringsModal();   // keep the modal honest if it's open behind
    host.draw();
    host.updateStatus();
};

export const editorSetStringTuning = (stringIdx, value) => {
    const arr = S.arrangements[S.currentArr];
    if (!arr) return;
    const i = Number(stringIdx);
    if (!Number.isInteger(i) || i < 0 || i >= _stringCountFor(arr)) return;
    const cmd = new SetStringTuningCmd(S.currentArr, i, value);
    // Skip no-op edits (blur without change re-fires onchange in some
    // browsers) so the undo stack doesn't collect empty steps.
    if (cmd.newOffset === cmd.oldOffset) { _renderStringsModal(); return; }
    S.history.exec(cmd);
    _renderStringsModal();
    host.draw();
    host.updateStatus();
};
