// ════════════════════════════════════════════════════════════════════
// The annotation lanes — tone changes, anchors, and handshapes.
//
// Three thin strips drawn around the chart, each with its own draw pass and
// its own mouse handlers. They travel together because they lean on each
// other: the handshape lane positions itself off _anchorLaneTopY, and both it
// and the anchor lane share _currentAnchorArr. Split apart, those would be
// cross-module imports for no gain.
//
// main.js keeps the canvas event routing (deciding which strip is under the
// cursor) and forwards to the on*LaneMouse* handlers here. Four of its symbols
// travel the other way — draw, hideContextMenu, snapTime, _editorPromptText —
// and would close a cycle, so they arrive through the shared `host` object in
// src/host.js.
//
// snapTime stays in main.js because its onset-snap path reaches _ensureOnsets
// and the onset cache; _editorPromptText stays because it owns a modal and the
// shared _editorPromptCancel handle. Neither is a lane concern.
//
// TONE_LANE_H moved to geometry.js, where ANCHOR_LANE_H and HS_LANE_H already
// live. The tones modal's window.* handlers are exported as plain functions —
// a top-level `window.x =` throws when this module is imported under node.
//
// Browser surface: `ctx` (the shared 2D context) and the tones-modal DOM.
// ════════════════════════════════════════════════════════════════════
import { ctx } from './canvas.js';
import {
    _buildPreservedTemplates, _bumpHandshapesDirty, _ensureHandshapes, _fretKeyForL,
    _normFingers, relinkChordTemplate,
} from './chords.js';
import { _beatBarTopY } from './draw.js';
import {
    ANCHOR_LANE_H, BEAT_H, HS_LANE_H, LABEL_W, TONE_LANE_H, timeToX, xToTime,
} from './geometry.js';
import { host } from './host.js';
import { lanes } from './lanes.js';
import { S } from './state.js';
import { setStatus } from './ui.js';

// ─── Tone-lane slot data (PR3c) ────────────────────────────────────
export const _TONE_SLOT_DEFAULTS = ['Clean', 'Drive', 'Lead', 'Crunch', 'Effect'];
export const _TONE_SLOT_COLORS = ['#7dd3fc', '#f87171', '#fbbf24', '#a78bfa', '#34d399'];

// ════════════════════════════════════════════════════════════════════
// Tone lane — PR3c of the tones+notation UI follow-up.
//
// Renders tone-change markers on a thin strip at the top of the
// canvas, lets the user click-to-add / drag-to-move / Del-to-remove
// markers, and surfaces a Tones… modal for slot renaming + base
// selection. All edits go through `S.history` so undo/redo works.
//
// `TONE_LANE_H` is imported from geometry.js; `_TONE_SLOT_DEFAULTS` and
// `_TONE_SLOT_COLORS` are declared at the top of this module. Both are
// initialised before any callsite runs.
// ════════════════════════════════════════════════════════════════════

// Derive a 5-slot list from a raw tones object's `base` + `changes`.
// Shared between `_readToneSnapshot` (no mutation) and `_ensureTones`
// (writes back) so they always produce the same ordering. Without
// this the UI would show `_TONE_SLOT_DEFAULTS` for archive loads (where
// the backend writes `{base, changes, definitions}` without `slots`)
// and `RenameToneSlotsCmd`'s index-based remap would target the
// wrong names.
function _deriveSlots(t) {
    if (t && Array.isArray(t.slots) && t.slots.length === 5
            && t.slots.every(s => typeof s === 'string' && s)) {
        return t.slots.slice();
    }
    const seen = new Set();
    const seeded = [];
    const consider = name => {
        if (typeof name === 'string' && name && !seen.has(name)
                && seeded.length < 5) {
            seen.add(name);
            seeded.push(name);
        }
    };
    if (t) consider(t.base);
    if (t && Array.isArray(t.changes)) {
        for (const c of t.changes) {
            if (c && typeof c.name === 'string') consider(c.name);
        }
    }
    for (const name of _TONE_SLOT_DEFAULTS) consider(name);
    // Pad with synthetic names, looping suffix until we find one that
    // doesn't collide with already-seeded user names.
    let synthetic = 1;
    while (seeded.length < 5) {
        const candidate = 'Slot ' + synthetic++;
        if (!seen.has(candidate)) {
            seen.add(candidate);
            seeded.push(candidate);
        }
    }
    return seeded.slice(0, 5);
}

// Read-only projection of an arrangement's tones — returns the
// authored data when present and a safe default otherwise, WITHOUT
// mutating `arr`. Use this from display / no-op-compare paths so
// merely opening the Tones modal doesn't synthesize a `tones` object
// the sloppak full-snapshot save would then persist to disk.
function _readToneSnapshot(arr) {
    const t = (arr && typeof arr.tones === 'object' && arr.tones) || null;
    const slots = _deriveSlots(t);
    const baseFromArr = t && typeof t.base === 'string' && t.base;
    const base = baseFromArr && slots.includes(baseFromArr)
        ? baseFromArr
        : slots[0];
    return {
        slots,
        base,
        changes: Array.isArray(t && t.changes) ? t.changes : [],
        definitions: Array.isArray(t && t.definitions) ? t.definitions : [],
    };
}

export function _ensureTones(arr) {
    if (!arr) return null;
    if (!arr.tones || typeof arr.tones !== 'object') arr.tones = {};
    const t = arr.tones;
    if (!Array.isArray(t.changes)) t.changes = [];
    if (!Array.isArray(t.definitions)) t.definitions = [];
    // Reuse `_deriveSlots` so the seeded slot ordering matches what
    // `_readToneSnapshot` returned to the read-only paths (modal,
    // context menu, click-to-add). Without that alignment,
    // `RenameToneSlotsCmd`'s index-based name remap would target a
    // different slot than the user saw in the UI.
    t.slots = _deriveSlots(t);
    if (typeof t.base !== 'string' || !t.slots.includes(t.base)) {
        t.base = t.slots[0];
    }
    return t;
}

// Track authored tone edits via a per-arrangement counter rather
// than a sticky boolean. Every mutating command bumps the counter
// on `exec` and decrements it on `rollback`, so the count returns
// to 0 after a complete undo to the load state — and `_buildSaveBody`
// + the Build Song warning can skip arrangements where the net
// authored count is zero.
//
// A sticky `_dirty` would cause the editor to ship `<tones>` even
// after the user undid every edit, silently downgrading what the
// backend writes for a no-net-change arrangement.
function _bumpTonesDirty(arr, delta) {
    if (!arr) return;
    _ensureTones(arr);
    const next = (arr.tones._editCount || 0) + delta;
    arr.tones._editCount = next > 0 ? next : 0;
}
export function _tonesAreDirty(arr) {
    return !!(arr && arr.tones && (arr.tones._editCount || 0) > 0);
}

// Strip client-only fields (`_editCount`, formerly `_dirty`) before
// shipping `arr.tones` to the backend. Returns a fresh object so we
// don't mutate the in-memory state.
export function _stripToneInternals(tones) {
    if (!tones || typeof tones !== 'object') return tones;
    const { _editCount, _dirty, ...wire } = tones;
    return wire;
}

export function _currentToneArr() {
    if (!S.arrangements || !S.arrangements[S.currentArr]) return null;
    return S.arrangements[S.currentArr];
}

// ─── Lane drawing ───────────────────────────────────────────────────

export function drawToneLane(w) {
    const arr = _currentToneArr();
    if (!arr) return;
    // Don't mutate `arr` from the render path — calling `_ensureTones`
    // here would silently attach an empty `tones` object to every
    // archive/sloppak just by drawing the canvas, which the Build Song
    // warning would then mistake for authored content. Use
    // `_readToneSnapshot` so the slot list is derived from
    // `base + changes[].name` for archive loads where `arr.tones.slots`
    // is absent — markers render with their authored color/label
    // instead of grey "unknown" until the first mutation.
    const snap = _readToneSnapshot(arr);
    const slots = snap.slots;
    const base = (arr.tones && typeof arr.tones.base === 'string')
        ? arr.tones.base
        : '';
    const changes = snap.changes;

    // Lane background — a darker strip overlaid on the waveform's top
    // edge so markers stand out against the waveform noise below.
    ctx.fillStyle = 'rgba(8,8,20,0.85)';
    ctx.fillRect(0, 0, w, TONE_LANE_H);
    ctx.strokeStyle = '#1f2937';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, TONE_LANE_H - 0.5);
    ctx.lineTo(w, TONE_LANE_H - 0.5);
    ctx.stroke();

    // Base-tone label. Hide entirely when there's no authored tone
    // data (no base AND no changes) so the lane stays visually empty
    // for unauthored projects. When changes exist but `base` is empty
    // (older XML loaded without `<tonebase>`) fall back to the first
    // slot so the lane still shows *some* base context.
    // Draw past `LABEL_W` because `drawLabels()` later paints the
    // 0..LABEL_W strip and would otherwise cover this text with the
    // waveform's "Audio" label.
    const effectiveBase = base || (changes.length > 0 ? slots[0] : '');
    if (effectiveBase) {
        const baseIdx = slots.indexOf(effectiveBase);
        ctx.fillStyle = baseIdx >= 0
            ? _TONE_SLOT_COLORS[baseIdx]
            : '#94a3b8';
        ctx.font = 'bold 9px monospace';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText('base: ' + effectiveBase, LABEL_W + 4, TONE_LANE_H / 2);
    }

    // Markers — small filled triangles at each change time, colored
    // by slot, with the slot name to the right. Selection is tracked
    // by object ref (`S.toneSel`) rather than index so that
    // Add/Move/Remove-induced sorts/splices don't shift it onto a
    // different marker. Clip the marker region to `LABEL_W..w` so a
    // marker at t==0 (centered at x=LABEL_W) doesn't draw its left
    // half under the label strip that `drawLabels()` later paints
    // over.
    ctx.save();
    ctx.beginPath();
    ctx.rect(LABEL_W, 0, Math.max(0, w - LABEL_W), TONE_LANE_H);
    ctx.clip();
    for (let i = 0; i < changes.length; i++) {
        const c = changes[i];
        if (typeof c.t !== 'number' || !isFinite(c.t)) continue;
        const x = timeToX(c.t);
        if (x < -40 || x > w + 40) continue;
        const sel = S.toneSel === c;
        const slotIdx = slots.indexOf(c.name);
        const color = slotIdx >= 0
            ? _TONE_SLOT_COLORS[slotIdx]
            : '#94a3b8';
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(x, 2);
        ctx.lineTo(x + 5, TONE_LANE_H - 2);
        ctx.lineTo(x - 5, TONE_LANE_H - 2);
        ctx.closePath();
        ctx.fill();
        if (sel) {
            ctx.strokeStyle = '#fff';
            ctx.lineWidth = 1.5;
            ctx.stroke();
        }
        // Label to the right of the marker.
        ctx.fillStyle = color;
        ctx.font = '9px monospace';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(c.name, x + 7, TONE_LANE_H / 2);
    }
    ctx.restore();
}

// Returns the nearest tone-change *ref* under the cursor, or `null`
// when no marker is in range. Ref-based so callers don't have to
// re-derive when the changes list re-sorts after a move/add/remove.
function _hitToneMarker(x) {
    const arr = _currentToneArr();
    if (!arr || !arr.tones || !Array.isArray(arr.tones.changes)) return null;
    const HIT = 7;  // px tolerance around the triangle
    let best = null, bestDx = Infinity;
    for (const c of arr.tones.changes) {
        if (typeof c.t !== 'number' || !isFinite(c.t)) continue;
        const dx = Math.abs(timeToX(c.t) - x);
        // Enforce the documented HIT tolerance — without the `<=HIT`
        // gate, an `Infinity`-seeded `bestDx` would accept any marker
        // regardless of distance.
        if (dx <= HIT && dx < bestDx) { best = c; bestDx = dx; }
    }
    return best;
}

// ─── Cmd classes ────────────────────────────────────────────────────

export class AddToneChangeCmd {
    constructor(arrIdx, change) {
        this.arrIdx = arrIdx; this.change = change;
    }
    exec() {
        const arr = S.arrangements[this.arrIdx];
        if (!arr) return;
        _bumpTonesDirty(arr, +1);
        const changes = arr.tones.changes;
        changes.push(this.change);
        changes.sort((a, b) => a.t - b.t);
    }
    rollback() {
        const arr = S.arrangements[this.arrIdx];
        if (!arr || !arr.tones) return;
        _bumpTonesDirty(arr, -1);
        const i = arr.tones.changes.indexOf(this.change);
        if (i >= 0) arr.tones.changes.splice(i, 1);
    }
}

export class RemoveToneChangeCmd {
    constructor(arrIdx, change) {
        this.arrIdx = arrIdx; this.change = change;
    }
    exec() {
        const arr = S.arrangements[this.arrIdx];
        if (!arr || !arr.tones) return;
        _bumpTonesDirty(arr, +1);
        const i = arr.tones.changes.indexOf(this.change);
        if (i >= 0) arr.tones.changes.splice(i, 1);
    }
    rollback() {
        const arr = S.arrangements[this.arrIdx];
        if (!arr) return;
        _bumpTonesDirty(arr, -1);
        const changes = arr.tones.changes;
        changes.push(this.change);
        changes.sort((a, b) => a.t - b.t);
    }
}

class MoveToneChangeCmd {
    constructor(arrIdx, change, oldT, newT) {
        this.arrIdx = arrIdx; this.change = change;
        this.oldT = oldT; this.newT = newT;
    }
    exec() {
        const arr = S.arrangements[this.arrIdx];
        if (!arr) return;
        _bumpTonesDirty(arr, +1);
        this.change.t = this.newT;
        arr.tones.changes.sort((a, b) => a.t - b.t);
    }
    rollback() {
        const arr = S.arrangements[this.arrIdx];
        if (!arr) return;
        _bumpTonesDirty(arr, -1);
        this.change.t = this.oldT;
        arr.tones.changes.sort((a, b) => a.t - b.t);
    }
}

class RenameToneSlotsCmd {
    constructor(arrIdx, newSlots, newBase) {
        this.arrIdx = arrIdx;
        this.newSlots = newSlots.slice();
        this.newBase = newBase;
        this.oldSlots = null;
        this.oldBase = null;
    }
    exec() {
        const arr = S.arrangements[this.arrIdx];
        if (!arr) return;
        const t = _ensureTones(arr);
        this.oldSlots = t.slots.slice();
        this.oldBase = t.base;
        // Rename placed-change slot references that point at the old
        // slot names — keeps the lane's existing markers attached to
        // the renamed slots so they don't orphan to an unknown name.
        for (const c of t.changes) {
            const idx = this.oldSlots.indexOf(c.name);
            if (idx >= 0) c.name = this.newSlots[idx];
        }
        // Same for the base name — pick the renamed slot at the old
        // base's index.
        const baseIdx = this.oldSlots.indexOf(this.oldBase);
        t.slots = this.newSlots.slice();
        // Honor an explicit `newBase` choice; fall back to the
        // index-preserved rename so the active base survives renames.
        if (this.newBase && t.slots.includes(this.newBase)) {
            t.base = this.newBase;
        } else if (baseIdx >= 0) {
            t.base = t.slots[baseIdx];
        } else {
            t.base = t.slots[0];
        }
        _bumpTonesDirty(arr, +1);
    }
    rollback() {
        const arr = S.arrangements[this.arrIdx];
        if (!arr || !this.oldSlots) return;
        const t = _ensureTones(arr);
        for (const c of t.changes) {
            const idx = this.newSlots.indexOf(c.name);
            if (idx >= 0) c.name = this.oldSlots[idx];
        }
        t.slots = this.oldSlots.slice();
        t.base = this.oldBase;
        _bumpTonesDirty(arr, -1);
    }
}

// ─── Mouse interactions ─────────────────────────────────────────────

export function onToneLaneMouseDown(e, x) {
    const arr = _currentToneArr();
    if (!arr) return false;
    // Mutually exclusive selection across timeline lanes — without
    // this clear, `S.anchorSel` would survive a tone-lane click and
    // the Del handler (which checks anchor first) would delete the
    // stale anchor instead of the just-clicked tone marker.
    S.anchorSel = null;
    S.handshapeSel = null;
    const hit = _hitToneMarker(x);
    if (hit) {
        S.toneSel = hit;
        S.drag = {
            type: 'tone',
            startX: x,
            origT: hit.t,
            change: hit,
        };
        host.draw();
        return true;
    }
    // Empty area click — place a new change snapped to the grid. The
    // first add against an unauthored arrangement is what should
    // synthesise `arr.tones`, and that happens inside
    // `AddToneChangeCmd.exec` via `_bumpTonesDirty(+1)`. Read via
    // `_readToneSnapshot` here so the slot lookup doesn't mutate
    // state for a click outside any marker.
    const t = host.snapTime(Math.max(0, xToTime(x)));
    if (t < 0) return false;
    const snap = _readToneSnapshot(arr);
    const nonBase = snap.slots.filter(s => s !== snap.base);
    // Use a Map so user-controlled slot names like "__proto__" or
    // "constructor" can't pollute the count lookup via an Object
    // prototype chain hit.
    const counts = new Map();
    for (const s of nonBase) counts.set(s, 0);
    for (const c of snap.changes) {
        if (counts.has(c.name)) counts.set(c.name, counts.get(c.name) + 1);
    }
    let pick = nonBase[0] || snap.base;
    let pickCount = Infinity;
    for (const s of nonBase) {
        const n = counts.get(s) || 0;
        if (n < pickCount) { pick = s; pickCount = n; }
    }
    const change = { t, name: pick };
    S.history.exec(new AddToneChangeCmd(S.currentArr, change));
    S.toneSel = change;
    host.draw();
    return true;
}

export function onToneLaneMouseMove(e, x) {
    if (!S.drag || S.drag.type !== 'tone') return false;
    const arr = _currentToneArr();
    if (!arr) return false;
    // Snap the drag target so dropped markers land on the same grid
    // subdivision the rest of the editor uses. Skip the sort during
    // live drag — the commit on mouseup goes through
    // `MoveToneChangeCmd` which sorts once, and sorting on every
    // mousemove was O(n log n) per frame on big arrangements.
    const newT = host.snapTime(Math.max(0, xToTime(x)));
    S.drag.change.t = newT;
    // Selection is by ref, so the deferred sort doesn't invalidate it.
    S.toneSel = S.drag.change;
    host.draw();
    return true;
}

export function onToneLaneMouseUp() {
    if (!S.drag || S.drag.type !== 'tone') return false;
    const change = S.drag.change;
    const origT = S.drag.origT;
    const newT = change.t;
    S.drag = null;
    if (origT !== newT) {
        // The drag mutated `change.t` in-place for live feedback;
        // replay through the command history so undo/redo can restore
        // the pre-drag time. Roll back to `origT` first, then `exec()`
        // applies `newT` and re-sorts.
        const arr = _currentToneArr();
        if (arr) {
            change.t = origT;
            S.history.exec(new MoveToneChangeCmd(S.currentArr, change, origT, newT));
        }
    }
    host.draw();
    return true;
}

export function onToneLaneContextMenu(e, x) {
    const arr = _currentToneArr();
    if (!arr) return false;
    const change = _hitToneMarker(x);
    if (!change) return false;
    // Clear the anchor selection while interacting with a tone marker
    // so a subsequent Del hits the right path. Mirrors the mousedown
    // mutual-exclusion above.
    S.anchorSel = null;
    S.handshapeSel = null;
    // Capture the arrangement index NOW. If the user switches
    // arrangements while the context menu is open, a later
    // `S.currentArr` read inside the click handlers would dispatch
    // the command at the wrong arrangement.
    const menuArrIdx = S.currentArr;
    // A hit means `arr.tones.changes` already contains this change, so
    // `arr.tones` is non-null. `arr.tones.slots` / `arr.tones.base`
    // may still be absent on freshly-loaded data (the load path leaves
    // slot seeding to first-author), so go through `_readToneSnapshot`
    // for the slot list to avoid iterating `undefined`.
    const snap = _readToneSnapshot(arr);
    // Build the slot-picker via DOM APIs (not `innerHTML`) so a
    // user-named slot like `<img onerror=…>` can't inject markup
    // into the menu. The previous `innerHTML` version interpolated
    // slot names into both an attribute and the button body without
    // escaping.
    const menu = document.getElementById('editor-context-menu');
    menu.replaceChildren();

    const header = document.createElement('div');
    header.className = 'px-3 py-1 text-[10px] text-gray-500';
    header.textContent = 'Change slot';
    menu.appendChild(header);

    for (const slot of snap.slots) {
        const active = slot === change.name;
        const btn = document.createElement('button');
        btn.className = 'w-full text-left px-3 py-1 text-xs hover:bg-dark-500 flex items-center gap-2';
        const tick = document.createElement('span');
        tick.className = 'w-3';
        tick.textContent = active ? '✓' : '';
        btn.appendChild(tick);
        btn.appendChild(document.createTextNode(slot));
        if (slot === snap.base) {
            const baseTag = document.createElement('span');
            baseTag.className = 'text-[10px] text-gray-500';
            baseTag.textContent = ' (base)';
            btn.appendChild(baseTag);
        }
        btn.onclick = () => {
            host.hideContextMenu();
            const oldName = change.name;
            if (oldName === slot) return;
            // Slot rename via single-name rebind. Wrap in a command so
            // undo restores the prior name.
            S.history.exec({
                _change: change,
                _old: oldName,
                _new: slot,
                _arr: arr,
                exec() { this._change.name = this._new; _bumpTonesDirty(this._arr, +1); },
                rollback() { this._change.name = this._old; _bumpTonesDirty(this._arr, -1); },
            });
            host.draw();
        };
        menu.appendChild(btn);
    }

    const sep = document.createElement('div');
    sep.className = 'border-t border-gray-700 my-1';
    menu.appendChild(sep);

    const delBtn = document.createElement('button');
    delBtn.className = 'w-full text-left px-3 py-1 text-xs hover:bg-dark-500 text-rose-300';
    delBtn.textContent = 'Delete tone change';
    delBtn.onclick = () => {
        host.hideContextMenu();
        // Use the captured `menuArrIdx` rather than the live
        // `S.currentArr` so a mid-menu arrangement switch can't
        // route the delete (and its dirty-counter bump) to the wrong
        // arrangement.
        S.history.exec(new RemoveToneChangeCmd(menuArrIdx, change));
        S.toneSel = null;
        host.draw();
    };
    menu.appendChild(delBtn);

    menu.style.left = e.clientX + 'px';
    menu.style.top = e.clientY + 'px';
    menu.classList.remove('hidden');
    return true;
}

// ─── Modal handlers ─────────────────────────────────────────────────

export function editorShowTonesModal() {
    const arr = _currentToneArr();
    if (!arr) return;
    // Read-only snapshot — don't synthesize an `arr.tones` just by
    // opening the modal. Apply path mutates via `RenameToneSlotsCmd`
    // when the user actually changes something.
    const t = _readToneSnapshot(arr);
    const container = document.getElementById('editor-tones-slots');
    // Build the per-slot rows via DOM APIs (not `innerHTML`) so a
    // pathological loaded slot name like `"><script>` can't break
    // out of the value attribute and inject markup.
    container.replaceChildren();
    for (let i = 0; i < 5; i++) {
        const slotName = t.slots[i];
        const isBase = slotName === t.base;
        const label = document.createElement('label');
        label.className = 'flex items-center gap-2';

        const radio = document.createElement('input');
        radio.type = 'radio';
        radio.name = 'editor-tones-base';
        radio.value = String(i);
        radio.checked = isBase;
        radio.className = 'text-cyan-500';
        radio.title = 'Set as base tone';
        label.appendChild(radio);

        const text = document.createElement('input');
        text.type = 'text';
        text.id = 'editor-tones-slot-' + i;
        text.value = slotName;  // value assignment doesn't parse HTML
        text.maxLength = 32;
        text.className = 'flex-1 bg-dark-800 border border-gray-700 rounded px-2 py-1 text-xs text-gray-200 outline-none';
        label.appendChild(text);

        container.appendChild(label);
    }
    document.getElementById('editor-tones-modal').classList.remove('hidden');
}

export function editorHideTonesModal() {
    document.getElementById('editor-tones-modal').classList.add('hidden');
}

export function editorApplyTonesModal() {
    const arr = _currentToneArr();
    if (!arr) return;
    const newSlots = [];
    for (let i = 0; i < 5; i++) {
        const v = (document.getElementById('editor-tones-slot-' + i).value || '').trim();
        if (!v) {
            setStatus('Tone slot ' + (i + 1) + ' name cannot be empty');
            return;
        }
        newSlots.push(v);
    }
    if (new Set(newSlots).size !== 5) {
        setStatus('Tone slot names must be unique');
        return;
    }
    const baseIdx = parseInt(
        (document.querySelector('input[name="editor-tones-base"]:checked') || {}).value || '0',
        10,
    );
    const newBase = newSlots[baseIdx] || newSlots[0];
    // No-op short-circuit: skip the command (and the dirty bump) when
    // every slot name + the base match the current state. Read via
    // `_readToneSnapshot` so the comparison itself doesn't synthesize
    // a `tones` object on `arr` — that would then leak into the next
    // sloppak full-snapshot save even after a Cancel-equivalent Apply.
    const snap = _readToneSnapshot(arr);
    const slotsUnchanged = newSlots.length === snap.slots.length
        && newSlots.every((name, i) => name === snap.slots[i]);
    if (slotsUnchanged && newBase === snap.base) {
        editorHideTonesModal();
        return;
    }
    S.history.exec(new RenameToneSlotsCmd(S.currentArr, newSlots, newBase));
    editorHideTonesModal();
    host.draw();
}

// Show the Tones… toolbar button once a song is loaded (matches the
// reveal pattern of +Drums / +Keys / Strings / Build / Save).
export function _updateTonesButtonVisibility() {
    const btn = document.getElementById('editor-tones-btn');
    if (!btn) return;
    if (S.sessionId) btn.classList.remove('hidden');
    else btn.classList.add('hidden');
}

// ─── Build Song warning ─────────────────────────────────────────────

// Returns the list of authored tone-slot names that have no matching
// gear definition in arr.tones.definitions. When the build path
// proceeds anyway, DLC Builder defaults those slots to stock clean.
function _undefinedToneSlotNames(arr) {
    if (!arr || !arr.tones) return [];
    const t = arr.tones;
    const usedNames = new Set();
    if (t.base) usedNames.add(t.base);
    for (const c of (t.changes || [])) {
        if (typeof c.name === 'string' && c.name) usedNames.add(c.name);
    }
    if (usedNames.size === 0) return [];
    const defined = new Set();
    for (const def of (t.definitions || [])) {
        if (def && typeof def === 'object') {
            const n = def.Name || def.name || def.Key || def.key;
            if (typeof n === 'string' && n) defined.add(n);
        }
    }
    return [...usedNames].filter(n => !defined.has(n));
}

// Returns `true` when the build should proceed, `false` when the user
// cancelled at the warning prompt. Called from `editorBuild` before the
// network request — an ordinary exported function, so main.js imports it by
// name rather than reaching through `window.`.
export function _editorConfirmToneDefinitions() {
    if (!S.arrangements) return true;
    const missing = new Set();
    for (const arr of S.arrangements) {
        // Only warn for arrangements the user has actually authored
        // tones on this session (net of undos). Without the gate, the
        // warning would fire on every build of a normal create-mode
        // song since `_undefinedToneSlotNames` treats an unauthored
        // "Clean" base (or any unloaded base) as a missing definition.
        if (!_tonesAreDirty(arr)) continue;
        for (const name of _undefinedToneSlotNames(arr)) missing.add(name);
    }
    if (missing.size === 0) return true;
    const list = [...missing].sort().join(', ');
    return window.confirm(
        'Tone slots without gear definitions:\n  ' + list + '\n\n' +
        'They will fall back to stock clean in the built chart. Continue?',
    );
}

// ════════════════════════════════════════════════════════════════════
// Anchor lane — PR3d of the tones+notation UI follow-up.
//
// Renders fret-position anchors on a thin strip just below the beat
// bar. Authoring lets the user override the editor's auto-anchor
// computation; the backend honours `arr.anchors_user` when non-empty
// and falls back to `_compute_anchors` otherwise (see PR1B / #34).
// ════════════════════════════════════════════════════════════════════

// Read-only projection of an arrangement's anchors. When
// `arr.anchors_user` is non-empty, that's the active authored list.
// When empty (or absent), the backend re-computes anchors from
// notes/chords on save, so we render the legacy `arr.anchors`
// passthrough as a dimmed preview of what'll be regenerated.
// `isAuto` lets the caller distinguish for rendering + decide
// whether to "promote" an anchor into `anchors_user` on interaction.
export function _readAnchorSnapshot(arr) {
    if (!arr) return { list: [], isAuto: false };
    const userList = Array.isArray(arr.anchors_user) ? arr.anchors_user : null;
    if (userList && userList.length > 0) {
        return { list: userList, isAuto: false };
    }
    const autoList = Array.isArray(arr.anchors) ? arr.anchors : [];
    return { list: autoList, isAuto: true };
}

export function _currentAnchorArr() {
    if (!S.arrangements || !S.arrangements[S.currentArr]) return null;
    return S.arrangements[S.currentArr];
}

// Ensure `arr.anchors_user` exists for authoring. Only seeds the
// array — the dirty counter lives on `arr` itself (set by
// `_bumpAnchorsDirty`, not here) so load-time `_song_to_dict`
// passthroughs that already shipped an `anchors_user` aren't
// flagged as authored.
export function _ensureAnchors(arr) {
    if (!arr) return null;
    if (!Array.isArray(arr.anchors_user)) arr.anchors_user = [];
    return arr.anchors_user;
}

// Edit counter lives on `arr` rather than `arr.anchors_user` so a
// load that synthesised `anchors_user = []` via `_ensureAnchors`
// doesn't get spuriously flagged as authored, AND the JSON
// serialisation paths below explicitly strip `_anchorEditCount` from
// the wire body so the counter never leaks to the backend.
export function _bumpAnchorsDirty(arr, delta) {
    if (!arr) return;
    _ensureAnchors(arr);
    const next = (arr._anchorEditCount || 0) + delta;
    arr._anchorEditCount = next > 0 ? next : 0;
}

export function _anchorsAreDirty(arr) {
    return !!(arr && (arr._anchorEditCount || 0) > 0);
}

export function _anchorLaneTopY() {
    // Anchor lane sits right below the beat bar — reuse the shared
    // `_beatBarTopY()` so it stays in sync with keys vs guitar mode
    // (and with whatever else uses the beat-bar Y).
    return _beatBarTopY() + BEAT_H;
}

// ─── Lane drawing ───────────────────────────────────────────────────

export function drawAnchorLane(w) {
    const arr = _currentAnchorArr();
    if (!arr) return;
    const top = _anchorLaneTopY();
    const snap = _readAnchorSnapshot(arr);

    // Lane background.
    ctx.fillStyle = '#0a0a1a';
    ctx.fillRect(0, top, w, ANCHOR_LANE_H);
    ctx.strokeStyle = '#1f2937';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, top + 0.5);
    ctx.lineTo(w, top + 0.5);
    ctx.stroke();

    // Left label.
    ctx.fillStyle = '#94a3b8';
    ctx.font = 'bold 9px monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText('anchors', 4, top + ANCHOR_LANE_H / 2);

    const { list, isAuto } = snap;
    // Auto-fallback list renders dimmed so the user can see what the
    // backend will recompute. Clicking an auto marker promotes it
    // into `arr.anchors_user` (see `onAnchorLaneMouseDown`).
    const fillColor = isAuto ? '#475569' : '#a3e635';
    const selColor = '#fbbf24';
    const textColor = isAuto ? '#64748b' : '#a3e635';
    ctx.save();
    ctx.beginPath();
    ctx.rect(LABEL_W, top, Math.max(0, w - LABEL_W), ANCHOR_LANE_H);
    ctx.clip();
    for (let i = 0; i < list.length; i++) {
        const a = list[i];
        if (!a || typeof a.time !== 'number' || !isFinite(a.time)) continue;
        const x = timeToX(a.time);
        if (x < -40 || x > w + 40) continue;
        const fret = Number.isFinite(a.fret) ? a.fret : 1;
        const width = Number.isFinite(a.width) ? a.width : 4;
        const sel = !isAuto && S.anchorSel === a;
        ctx.fillStyle = sel ? selColor : fillColor;
        ctx.beginPath();
        ctx.moveTo(x, top + 2);
        ctx.lineTo(x + 4, top + 6);
        ctx.lineTo(x - 4, top + 6);
        ctx.closePath();
        ctx.fill();
        if (sel) {
            ctx.strokeStyle = '#fff';
            ctx.lineWidth = 1.5;
            ctx.stroke();
        }
        ctx.fillStyle = sel ? selColor : textColor;
        ctx.font = '9px monospace';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(`${fret}+${width}`, x + 5, top + ANCHOR_LANE_H / 2 + 2);
    }
    ctx.restore();
}

// Returns `{ anchor, isAuto }` for the nearest marker, or `null`.
// `isAuto = true` means the hit object lives in `arr.anchors` (the
// auto-fallback list), not in `arr.anchors_user` — interaction
// callers need to promote it into the user list before mutating.
function _hitAnchorMarker(x, y) {
    const arr = _currentAnchorArr();
    if (!arr) return null;
    const top = _anchorLaneTopY();
    if (y < top || y >= top + ANCHOR_LANE_H) return null;
    const snap = _readAnchorSnapshot(arr);
    const HIT = 6;
    let best = null, bestDx = Infinity;
    for (const a of snap.list) {
        if (!a || typeof a.time !== 'number' || !isFinite(a.time)) continue;
        const dx = Math.abs(timeToX(a.time) - x);
        if (dx <= HIT && dx < bestDx) { best = a; bestDx = dx; }
    }
    if (!best) return null;
    return { anchor: best, isAuto: snap.isAuto };
}

// Promote a computed/source-fallback anchor into `arr.anchors_user`.
//
// The backend treats a NON-EMPTY `anchors_user` as the complete authored
// list (empty => recompute from notes/source), so promoting only the clicked
// marker would silently drop every OTHER computed/source anchor on the next
// save. Seed fresh copies of the WHOLE fallback set on this first authored
// interaction, and return the copy standing in for the clicked marker (so
// select / drag / edit operate on an authored member). Idempotent for
// already-authored markers (returns the input as-is).
export function _promoteAnchor(arr, anchor, isAuto) {
    if (!arr || !anchor) return anchor;
    if (!isAuto) return anchor;
    const autoList = Array.isArray(arr.anchors) ? arr.anchors : [];
    const cmd = new PromoteAnchorsCmd(S.currentArr, autoList, anchor);
    S.history.exec(cmd);
    return cmd.target || anchor;
}

// ─── Cmd classes ────────────────────────────────────────────────────

export class AddAnchorCmd {
    constructor(arrIdx, anchor) {
        this.arrIdx = arrIdx; this.anchor = anchor;
    }
    exec() {
        const arr = S.arrangements[this.arrIdx];
        if (!arr) return;
        _bumpAnchorsDirty(arr, +1);
        arr.anchors_user.push(this.anchor);
        arr.anchors_user.sort((a, b) => a.time - b.time);
    }
    rollback() {
        const arr = S.arrangements[this.arrIdx];
        if (!arr || !Array.isArray(arr.anchors_user)) return;
        _bumpAnchorsDirty(arr, -1);
        const i = arr.anchors_user.indexOf(this.anchor);
        if (i >= 0) arr.anchors_user.splice(i, 1);
    }
}

// Seed `arr.anchors_user` with fresh copies of a computed/source fallback
// set — the first authored interaction against fallback anchors. This is the
// single choke point that prevents a lone promote/insert from collapsing the
// whole computed set (a non-empty `anchors_user` is authoritative on save).
// Undo removes exactly the seeded copies, restoring the empty => recompute
// state. `clicked`, when given, is the fallback marker the caller interacted
// with; `.target` exposes its authored copy for selection / drag.
export class PromoteAnchorsCmd {
    constructor(arrIdx, autoAnchors, clicked, extra) {
        this.arrIdx = arrIdx;
        this.copies = [];
        this.target = null;
        for (const a of (Array.isArray(autoAnchors) ? autoAnchors : [])) {
            if (!a || typeof a.time !== 'number' || !isFinite(a.time)) continue;
            const copy = {
                time: a.time,
                fret: Number.isFinite(a.fret) ? a.fret : 1,
                width: Number.isFinite(a.width) ? a.width : 4,
            };
            this.copies.push(copy);
            if (a === clicked) this.target = copy;
        }
        // Clicked marker wasn't in the fallback list (defensive) — seed a lone
        // copy so the caller still gets a usable authored ref to work with.
        if (clicked && !this.target) {
            const copy = {
                time: typeof clicked.time === 'number' ? clicked.time : 0,
                fret: Number.isFinite(clicked.fret) ? clicked.fret : 1,
                width: Number.isFinite(clicked.width) ? clicked.width : 4,
            };
            this.copies.push(copy);
            this.target = copy;
        }
        // A brand-new anchor authored in the SAME gesture (first insert in empty
        // lane space while on the fallback): seed it alongside the promoted set
        // so the whole gesture is ONE undoable step — a single undo returns to
        // the empty => recompute-on-save fallback (two separate commands would
        // leave the seeded set behind after one undo). Kept by reference, not
        // copied, so the caller's selection/drag ref stays live; it's the target.
        if (extra) {
            this.copies.push(extra);
            this.target = extra;
        }
    }
    exec() {
        const arr = S.arrangements[this.arrIdx];
        if (!arr) return;
        _bumpAnchorsDirty(arr, +1);
        _ensureAnchors(arr);
        for (const c of this.copies) arr.anchors_user.push(c);
        arr.anchors_user.sort((a, b) => a.time - b.time);
    }
    rollback() {
        const arr = S.arrangements[this.arrIdx];
        if (!arr || !Array.isArray(arr.anchors_user)) return;
        _bumpAnchorsDirty(arr, -1);
        for (const c of this.copies) {
            const i = arr.anchors_user.indexOf(c);
            if (i >= 0) arr.anchors_user.splice(i, 1);
        }
    }
}

export class RemoveAnchorCmd {
    constructor(arrIdx, anchor) {
        this.arrIdx = arrIdx; this.anchor = anchor;
    }
    exec() {
        const arr = S.arrangements[this.arrIdx];
        if (!arr || !Array.isArray(arr.anchors_user)) return;
        _bumpAnchorsDirty(arr, +1);
        const i = arr.anchors_user.indexOf(this.anchor);
        if (i >= 0) arr.anchors_user.splice(i, 1);
    }
    rollback() {
        const arr = S.arrangements[this.arrIdx];
        if (!arr) return;
        _bumpAnchorsDirty(arr, -1);
        _ensureAnchors(arr);
        arr.anchors_user.push(this.anchor);
        arr.anchors_user.sort((a, b) => a.time - b.time);
    }
}

class MoveAnchorCmd {
    constructor(arrIdx, anchor, oldTime, newTime) {
        this.arrIdx = arrIdx; this.anchor = anchor;
        this.oldTime = oldTime; this.newTime = newTime;
    }
    exec() {
        const arr = S.arrangements[this.arrIdx];
        if (!arr) return;
        _bumpAnchorsDirty(arr, +1);
        this.anchor.time = this.newTime;
        arr.anchors_user.sort((a, b) => a.time - b.time);
    }
    rollback() {
        const arr = S.arrangements[this.arrIdx];
        if (!arr) return;
        _bumpAnchorsDirty(arr, -1);
        this.anchor.time = this.oldTime;
        arr.anchors_user.sort((a, b) => a.time - b.time);
    }
}

class EditAnchorFretWidthCmd {
    constructor(arrIdx, anchor, oldFret, oldWidth, newFret, newWidth) {
        this.arrIdx = arrIdx; this.anchor = anchor;
        this.oldFret = oldFret; this.oldWidth = oldWidth;
        this.newFret = newFret; this.newWidth = newWidth;
    }
    exec() {
        const arr = S.arrangements[this.arrIdx];
        if (!arr) return;
        _bumpAnchorsDirty(arr, +1);
        this.anchor.fret = this.newFret;
        this.anchor.width = this.newWidth;
    }
    rollback() {
        const arr = S.arrangements[this.arrIdx];
        if (!arr) return;
        _bumpAnchorsDirty(arr, -1);
        this.anchor.fret = this.oldFret;
        this.anchor.width = this.oldWidth;
    }
}

// Edit (or create) the chord template for a width-L fret pattern. Chord
// templates are rebuilt at save by reconstructChords(), keyed on the fret
// pattern, so editing/creating the matching `arr.chord_templates` entry here
// makes the authored name/displayName/fingers/arp survive the rebuild (see
// relinkChordTemplate). The flattened editor model holds one template per fret
// pattern, so this shared template is what every same-fret chord resolves to.
export class EditChordTemplateCmd {
    // patch is a subset of { name, displayName, fingers, arp }.
    constructor(arrIdx, L, frets, patch) {
        this.arrIdx = arrIdx;
        this.L = L;
        this.frets = frets.slice();
        this.fretKey = _fretKeyForL(frets, L);
        this.patch = patch;
        this._created = false; // did exec() create the entry?
        this._prev = null;     // snapshot of the patched fields, for rollback
    }
    _find(arr) {
        if (!Array.isArray(arr.chord_templates)) arr.chord_templates = [];
        for (const ct of arr.chord_templates) {
            if (ct && Array.isArray(ct.frets) && _fretKeyForL(ct.frets, this.L) === this.fretKey) return ct;
        }
        return null;
    }
    exec() {
        const arr = S.arrangements[this.arrIdx];
        if (!arr) return;
        let ct = this._find(arr);
        if (!ct) {
            ct = { name: '', displayName: '', frets: this.frets.slice(), fingers: _normFingers(null, this.L), arp: false };
            arr.chord_templates.push(ct);
            this._created = true;
        }
        // Snapshot only the fields the patch touches so rollback restores
        // exactly those (and leaves other authored fields untouched).
        this._prev = {};
        for (const k of Object.keys(this.patch)) {
            this._prev[k] = Array.isArray(ct[k]) ? ct[k].slice() : ct[k];
            ct[k] = Array.isArray(this.patch[k]) ? this.patch[k].slice() : this.patch[k];
        }
    }
    rollback() {
        const arr = S.arrangements[this.arrIdx];
        if (!arr || !Array.isArray(arr.chord_templates)) return;
        if (this._created) {
            const i = arr.chord_templates.findIndex(
                ct => ct && Array.isArray(ct.frets) && _fretKeyForL(ct.frets, this.L) === this.fretKey);
            if (i >= 0) arr.chord_templates.splice(i, 1);
            this._created = false;
            return;
        }
        const ct = this._find(arr);
        if (!ct || !this._prev) return;
        for (const k of Object.keys(this._prev)) {
            ct[k] = Array.isArray(this._prev[k]) ? this._prev[k].slice() : this._prev[k];
        }
    }
}

// ─── Mouse interactions ─────────────────────────────────────────────

export function onAnchorLaneMouseDown(e, x, y) {
    const arr = _currentAnchorArr();
    if (!arr) return false;
    // Mutually exclusive with the tone-lane selection — see the
    // matching note in `onToneLaneMouseDown`.
    S.toneSel = null;
    S.handshapeSel = null;
    const hit = _hitAnchorMarker(x, y);
    if (hit) {
        // Auto-fallback hits get promoted into `arr.anchors_user` so
        // subsequent select / drag / Del semantics work against the
        // authored list. Already-authored hits pass through.
        const target = _promoteAnchor(arr, hit.anchor, hit.isAuto);
        S.anchorSel = target;
        S.drag = {
            type: 'anchor',
            startX: x,
            origTime: target.time,
            anchor: target,
        };
        host.draw();
        return true;
    }
    // Empty area click — place a new anchor at the snapped time with
    // a sensible default (fret 1, width 4). The right-click context
    // menu lets the user edit fret/width afterwards.
    const t = host.snapTime(Math.max(0, xToTime(x)));
    if (t < 0) return false;
    const anchor = { time: t, fret: 1, width: 4 };
    const userList = Array.isArray(arr.anchors_user) ? arr.anchors_user : null;
    if (userList && userList.length > 0) {
        // Already authoring — a plain single-command add.
        S.history.exec(new AddAnchorCmd(S.currentArr, anchor));
    } else {
        // Still on the fallback: seed the whole computed/source set the user can
        // see AND this new anchor as ONE undoable command, so a single undo
        // returns to the empty => recompute-on-save fallback. A bare add would
        // make `anchors_user` = [the new one] and drop every computed anchor on
        // save; two separate commands would leave the seed behind after one undo.
        const autoList = Array.isArray(arr.anchors) ? arr.anchors : [];
        S.history.exec(new PromoteAnchorsCmd(S.currentArr, autoList, null, anchor));
    }
    S.anchorSel = anchor;
    host.draw();
    return true;
}

export function onAnchorLaneMouseMove(e, x) {
    if (!S.drag || S.drag.type !== 'anchor') return false;
    const arr = _currentAnchorArr();
    if (!arr) return false;
    // Same perf trick as the tone-lane drag — update `.time` in-place
    // for live feedback; defer the sort to mouseup (MoveAnchorCmd).
    S.drag.anchor.time = host.snapTime(Math.max(0, xToTime(x)));
    S.anchorSel = S.drag.anchor;
    host.draw();
    return true;
}

export function onAnchorLaneMouseUp() {
    if (!S.drag || S.drag.type !== 'anchor') return false;
    const anchor = S.drag.anchor;
    const origTime = S.drag.origTime;
    const newTime = anchor.time;
    S.drag = null;
    if (origTime !== newTime) {
        const arr = _currentAnchorArr();
        if (arr) {
            anchor.time = origTime;
            S.history.exec(new MoveAnchorCmd(S.currentArr, anchor, origTime, newTime));
        }
    }
    host.draw();
    return true;
}

export function onAnchorLaneContextMenu(e, x, y) {
    const arr = _currentAnchorArr();
    if (!arr) return false;
    const raw = _hitAnchorMarker(x, y);
    if (!raw) return false;
    // Promote first so the edit/delete commands operate on a member
    // of `arr.anchors_user` (the authored list). Without promotion
    // the commands would mutate an `arr.anchors` ref that the save
    // path doesn't ship.
    const hit = _promoteAnchor(arr, raw.anchor, raw.isAuto);
    // Clear the tone selection while interacting with an anchor —
    // mirrors the tone-lane context menu's clear above.
    S.toneSel = null;
    S.handshapeSel = null;
    const menuArrIdx = S.currentArr;
    const menu = document.getElementById('editor-context-menu');
    menu.replaceChildren();

    const editBtn = document.createElement('button');
    editBtn.className = 'w-full text-left px-3 py-1 text-xs hover:bg-dark-500';
    editBtn.textContent = `Edit fret/width (currently ${hit.fret}+${hit.width})`;
    editBtn.onclick = async () => {
        host.hideContextMenu();
        const fretStr = await host.editorPromptText({
            title: 'Edit Anchor', label: 'Hand-position fret — index finger (1–24)', value: String(hit.fret),
        });
        if (fretStr === null) return;
        const widthStr = await host.editorPromptText({
            title: 'Edit Anchor', label: 'Hand span (frets, 1–24)', value: String(hit.width),
        });
        if (widthStr === null) return;
        // Strict-integer parse matching `_parseFretInput` semantics so
        // out-of-range / non-decimal input rejects rather than
        // partial-parses.
        const fretM = fretStr.trim().match(/^[-+]?\d+$/);
        const widthM = widthStr.trim().match(/^[-+]?\d+$/);
        if (!fretM || !widthM) return;
        const newFret = Math.max(1, Math.min(24, parseInt(fretM[0], 10)));
        const newWidth = Math.max(1, Math.min(24, parseInt(widthM[0], 10)));
        if (newFret === hit.fret && newWidth === hit.width) return;
        S.history.exec(new EditAnchorFretWidthCmd(
            menuArrIdx, hit, hit.fret, hit.width, newFret, newWidth,
        ));
        host.draw();
    };
    menu.appendChild(editBtn);

    const sep = document.createElement('div');
    sep.className = 'border-t border-gray-700 my-1';
    menu.appendChild(sep);

    const delBtn = document.createElement('button');
    delBtn.className = 'w-full text-left px-3 py-1 text-xs hover:bg-dark-500 text-rose-300';
    delBtn.textContent = 'Delete anchor';
    delBtn.onclick = () => {
        host.hideContextMenu();
        S.history.exec(new RemoveAnchorCmd(menuArrIdx, hit));
        S.anchorSel = null;
        host.draw();
    };
    menu.appendChild(delBtn);

    menu.style.left = e.clientX + 'px';
    menu.style.top = e.clientY + 'px';
    menu.classList.remove('hidden');
    return true;
}

// ════════════════════════════════════════════════════════════════════
// Handshape lane — E2 (got-feedback/feedback-plugin-editor#5).
//
// Renders authored handshapes (chord-shape / arpeggio framing regions) as
// horizontal bars on a thin strip just below the anchor lane. A handshape is
// a time span { chord_id, start_time, end_time, arp } whose `chord_id` indexes
// `arr.chord_templates`. Modelled on the anchor lane above, but spans (with
// resize edges) rather than point markers. The chord_id is resolved from the
// voicing covered by the span at authoring time; reconstructChords() remaps it
// to the rebuilt template indices on save (see buildHandshapeChordIdMap).
// ════════════════════════════════════════════════════════════════════

const HS_EDGE_HIT = 5;   // px from a bar edge that grabs a resize handle
const HS_MIN_SPAN = 0.02; // s — smallest authorable / resizable span

export function _handshapeLaneTopY() {
    // Sits directly below the anchor lane.
    return _anchorLaneTopY() + ANCHOR_LANE_H;
}

// Compute the width-L fret pattern (voicing) covered by a [s, e] span from the
// flattened editor notes. Prefers a same-time chord (>=2 notes); otherwise
// combines the span's single notes into one shape (the arpeggio case). Returns
// null when the span covers no notes.
export function _handshapeSpanFrets(arr, s, e, L) {
    if (!arr || !Array.isArray(arr.notes)) return null;
    const EPS = 1e-6;
    const inSpan = arr.notes.filter(
        n => n && typeof n.time === 'number' && n.time >= s - EPS && n.time <= e + EPS);
    if (!inSpan.length) return null;
    const byTime = {};
    for (const n of inSpan) {
        const k = n.time.toFixed(4);
        (byTime[k] || (byTime[k] = [])).push(n);
    }
    let chord = null;
    for (const k of Object.keys(byTime)) {
        if (byTime[k].length >= 2 && (!chord || byTime[k].length > chord.length)) chord = byTime[k];
    }
    const frets = new Array(L).fill(-1);
    for (const n of (chord || inSpan)) {
        if (n.string >= 0 && n.string < L) frets[n.string] = n.fret;
    }
    return frets;
}

// Human label for a handshape bar — the covered template's displayName/name,
// falling back to the framing kind.
function _handshapeLabel(arr, hs) {
    const ct = Array.isArray(arr.chord_templates) ? arr.chord_templates[hs.chord_id] : null;
    if (ct && typeof ct.displayName === 'string' && ct.displayName) return ct.displayName;
    if (ct && typeof ct.name === 'string' && ct.name) return ct.name;
    return hs.arp ? 'arp' : 'shape';
}

// ─── Lane drawing ───────────────────────────────────────────────────

export function drawHandshapeLane(w) {
    const arr = _currentAnchorArr();
    if (!arr) return;
    const top = _handshapeLaneTopY();

    // Lane background.
    ctx.fillStyle = '#0a0a1a';
    ctx.fillRect(0, top, w, HS_LANE_H);
    ctx.strokeStyle = '#1f2937';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, top + 0.5);
    ctx.lineTo(w, top + 0.5);
    ctx.stroke();

    // Left label.
    ctx.fillStyle = '#94a3b8';
    ctx.font = 'bold 9px monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText('shapes', 4, top + HS_LANE_H / 2);

    const list = Array.isArray(arr.handshapes) ? arr.handshapes : [];
    ctx.save();
    ctx.beginPath();
    ctx.rect(LABEL_W, top, Math.max(0, w - LABEL_W), HS_LANE_H);
    ctx.clip();
    // Existing handshapes, plus the in-progress create preview (if any).
    const preview = (S.drag && S.drag.type === 'handshape' && S.drag.mode === 'create')
        ? S.drag.hs : null;
    for (const hs of preview ? list.concat([preview]) : list) {
        _drawHandshapeBar(arr, hs, top, w, hs === S.handshapeSel, hs === preview);
    }
    ctx.restore();
}

function _drawHandshapeBar(arr, hs, top, w, sel, isPreview) {
    if (!hs || !Number.isFinite(hs.start_time) || !Number.isFinite(hs.end_time)) return;
    const x0 = timeToX(hs.start_time);
    const x1 = timeToX(hs.end_time);
    if (x1 < -40 || x0 > w + 40) return;
    const left = Math.min(x0, x1);
    const width = Math.max(2, Math.abs(x1 - x0));
    const barTop = top + 2;
    const barH = HS_LANE_H - 4;
    // Arpeggio framing vs held chord shape get distinct fills.
    const fill = hs.arp ? '#7c3aed' : '#0ea5e9';
    ctx.globalAlpha = isPreview ? 0.5 : (sel ? 0.95 : 0.75);
    ctx.fillStyle = fill;
    ctx.fillRect(left, barTop, width, barH);
    ctx.globalAlpha = 1;
    if (sel) {
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(left + 0.5, barTop + 0.5, width - 1, barH - 1);
    }
    // Label (clipped to the bar width).
    ctx.save();
    ctx.beginPath();
    ctx.rect(left, barTop, width, barH);
    ctx.clip();
    ctx.fillStyle = '#e5e7eb';
    ctx.font = '9px monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(_handshapeLabel(arr, hs), left + 3, top + HS_LANE_H / 2 + 1);
    ctx.restore();
}

// ─── Hit testing ────────────────────────────────────────────────────

// Returns { hs, edge } where edge ∈ {'left','right',null} for the topmost bar
// under (x, y), or null. Within HS_EDGE_HIT px of an edge → resize handle.
function _hitHandshape(x, y) {
    const arr = _currentAnchorArr();
    if (!arr || !Array.isArray(arr.handshapes)) return null;
    const top = _handshapeLaneTopY();
    if (y < top || y >= top + HS_LANE_H) return null;
    // Iterate last-drawn-first so the topmost (later) bar wins on overlap.
    for (let i = arr.handshapes.length - 1; i >= 0; i--) {
        const hs = arr.handshapes[i];
        if (!hs || !Number.isFinite(hs.start_time) || !Number.isFinite(hs.end_time)) continue;
        const xL = timeToX(hs.start_time);
        const xR = timeToX(hs.end_time);
        const lo = Math.min(xL, xR), hi = Math.max(xL, xR);
        if (x < lo - HS_EDGE_HIT || x > hi + HS_EDGE_HIT) continue;
        let edge = null;
        if (Math.abs(x - xL) <= HS_EDGE_HIT) edge = 'left';
        else if (Math.abs(x - xR) <= HS_EDGE_HIT) edge = 'right';
        return { hs, edge };
    }
    return null;
}

// ─── Cmd classes ────────────────────────────────────────────────────

export class AddHandshapeCmd {
    // `hs` is { start_time, end_time, arp }; chord_id is resolved on first
    // exec from the voicing under the span. When that voicing has no existing
    // template, one is appended (at the tail, so live chord_id refs held by
    // other handshapes don't shift) and removed again on rollback.
    //
    // Template handling is split deliberately: exec() resolves/appends by
    // FRET-PATTERN KEY (so a redo across a save's reconstruct finds the rebuilt
    // template instead of pushing a duplicate), while rollback() removes by
    // OBJECT IDENTITY (so once a save has replaced the template objects we leave
    // them alone — the rebuilt template may now back a real chord, not just us).
    constructor(arrIdx, hs, L) {
        this.arrIdx = arrIdx; this.hs = hs; this.L = L;
        this._resolved = false; this._tmpl = null; this._key = null;
        this._appended = false;
    }
    _resolve(arr) {
        const frets = _handshapeSpanFrets(arr, this.hs.start_time, this.hs.end_time, this.L);
        if (!frets) { this._tmpl = null; this._key = null; return; }
        this._key = _fretKeyForL(frets, this.L);
        // Pre-build a template (carrying authored metadata if the voicing
        // matches a preserved one) for the case where none exists at exec time.
        const preserved = _buildPreservedTemplates(arr.chord_templates, this.L);
        this._tmpl = relinkChordTemplate(frets, preserved, this.L);
    }
    _findByKey(arr) {
        if (this._key == null || !Array.isArray(arr.chord_templates)) return -1;
        return arr.chord_templates.findIndex(
            ct => ct && Array.isArray(ct.frets) && _fretKeyForL(ct.frets, this.L) === this._key);
    }
    exec() {
        const arr = S.arrangements[this.arrIdx];
        if (!arr) return;
        if (!this._resolved) { this._resolve(arr); this._resolved = true; }
        _bumpHandshapesDirty(arr, +1);
        this._appended = false;
        if (this._key != null) {
            if (!Array.isArray(arr.chord_templates)) arr.chord_templates = [];
            let idx = this._findByKey(arr);
            if (idx < 0 && this._tmpl) {
                arr.chord_templates.push(this._tmpl); // tail-append
                idx = arr.chord_templates.length - 1;
                this._appended = true;
            }
            this.hs.chord_id = idx >= 0 ? idx : 0;
        } else if (!Number.isInteger(this.hs.chord_id)) {
            this.hs.chord_id = 0;
        }
        _ensureHandshapes(arr);
        arr.handshapes.push(this.hs);
        arr.handshapes.sort((a, b) => a.start_time - b.start_time);
    }
    rollback() {
        const arr = S.arrangements[this.arrIdx];
        if (!arr) return;
        _bumpHandshapesDirty(arr, -1);
        const i = arr.handshapes.indexOf(this.hs);
        if (i >= 0) arr.handshapes.splice(i, 1);
        // Remove the template only if THIS exec appended this exact object and
        // it's still present at the tail and unreferenced by any handshape.
        // Identity (not key) is deliberate: a save's reconstructChords() rebuilds
        // arr.chord_templates with fresh objects, so afterwards indexOf() is -1
        // and we correctly leave the reconstruct-owned template alone — it may
        // now back a real chord (arr.chords[*].chord_id), not just our handshape.
        if (this._appended && this._tmpl && Array.isArray(arr.chord_templates)) {
            const ti = arr.chord_templates.indexOf(this._tmpl);
            if (ti >= 0 && ti === arr.chord_templates.length - 1
                    && !arr.handshapes.some(h => h.chord_id === ti)) {
                arr.chord_templates.splice(ti, 1);
            }
        }
    }
}

export class RemoveHandshapeCmd {
    constructor(arrIdx, hs) { this.arrIdx = arrIdx; this.hs = hs; }
    exec() {
        const arr = S.arrangements[this.arrIdx];
        if (!arr || !Array.isArray(arr.handshapes)) return;
        _bumpHandshapesDirty(arr, +1);
        const i = arr.handshapes.indexOf(this.hs);
        if (i >= 0) arr.handshapes.splice(i, 1);
    }
    rollback() {
        const arr = S.arrangements[this.arrIdx];
        if (!arr) return;
        _bumpHandshapesDirty(arr, -1);
        _ensureHandshapes(arr);
        arr.handshapes.push(this.hs);
        arr.handshapes.sort((a, b) => a.start_time - b.start_time);
    }
}

// Move the whole span (both edges shift). Resize moves a single edge. Both
// store old + new {start,end} so rollback is exact; the live drag mutates the
// hs in place and defers the command to mouseup (mirrors MoveAnchorCmd).
class MoveHandshapeCmd {
    constructor(arrIdx, hs, oldStart, oldEnd, newStart, newEnd) {
        this.arrIdx = arrIdx; this.hs = hs;
        this.oldStart = oldStart; this.oldEnd = oldEnd;
        this.newStart = newStart; this.newEnd = newEnd;
    }
    _apply(s, e) {
        const arr = S.arrangements[this.arrIdx];
        if (!arr) return;
        this.hs.start_time = s; this.hs.end_time = e;
        if (Array.isArray(arr.handshapes)) arr.handshapes.sort((a, b) => a.start_time - b.start_time);
    }
    exec() { _bumpHandshapesDirty(S.arrangements[this.arrIdx], +1); this._apply(this.newStart, this.newEnd); }
    rollback() { _bumpHandshapesDirty(S.arrangements[this.arrIdx], -1); this._apply(this.oldStart, this.oldEnd); }
}

class ResizeHandshapeCmd extends MoveHandshapeCmd {}

class ToggleHandshapeArpCmd {
    constructor(arrIdx, hs) { this.arrIdx = arrIdx; this.hs = hs; }
    exec() {
        const arr = S.arrangements[this.arrIdx];
        if (!arr) return;
        _bumpHandshapesDirty(arr, +1);
        this.hs.arp = !this.hs.arp;
    }
    rollback() {
        const arr = S.arrangements[this.arrIdx];
        if (!arr) return;
        _bumpHandshapesDirty(arr, -1);
        this.hs.arp = !this.hs.arp;
    }
}

class SetHandshapeChordCmd {
    // Resolve old/new templates by FRET-PATTERN key, not bare index: a save
    // runs reconstructChords() which rebuilds `arr.chord_templates` (and the
    // indices), so a stored index would go stale across a save → undo. The
    // flattened model has one template per fret pattern, so the key is unique;
    // the captured index is a fallback when the key no longer resolves.
    constructor(arrIdx, hs, oldId, newId) {
        this.arrIdx = arrIdx; this.hs = hs;
        this.oldId = oldId; this.newId = newId;
        this.L = lanes();
        const cts = (S.arrangements[arrIdx] && S.arrangements[arrIdx].chord_templates) || [];
        this.oldKey = this._keyOf(cts[oldId]);
        this.newKey = this._keyOf(cts[newId]);
    }
    _keyOf(ct) {
        return (ct && Array.isArray(ct.frets)) ? _fretKeyForL(ct.frets, this.L) : null;
    }
    _resolve(key, fallback) {
        const cts = (S.arrangements[this.arrIdx] && S.arrangements[this.arrIdx].chord_templates) || [];
        if (key != null) {
            const i = cts.findIndex(ct => this._keyOf(ct) === key);
            if (i >= 0) return i;
        }
        return fallback;
    }
    exec() {
        const arr = S.arrangements[this.arrIdx];
        if (!arr) return;
        _bumpHandshapesDirty(arr, +1);
        this.hs.chord_id = this._resolve(this.newKey, this.newId);
    }
    rollback() {
        const arr = S.arrangements[this.arrIdx];
        if (!arr) return;
        _bumpHandshapesDirty(arr, -1);
        this.hs.chord_id = this._resolve(this.oldKey, this.oldId);
    }
}

// ─── Mouse interactions ─────────────────────────────────────────────

export function onHandshapeLaneMouseDown(e, x, y) {
    const arr = _currentAnchorArr();
    if (!arr) return false;
    S.toneSel = null;
    S.anchorSel = null;
    const hit = _hitHandshape(x, y);
    if (hit) {
        S.handshapeSel = hit.hs;
        const mode = hit.edge === 'left' ? 'resize-left'
            : hit.edge === 'right' ? 'resize-right' : 'move';
        S.drag = {
            type: 'handshape', mode, hs: hit.hs,
            origStart: hit.hs.start_time, origEnd: hit.hs.end_time,
            startX: x, grabTime: host.snapTime(Math.max(0, xToTime(x))),
        };
        host.draw();
        return true;
    }
    // Empty lane → begin a create drag. arp defaults true (arpeggio framing is
    // the dominant case the highway renders).
    const t = host.snapTime(Math.max(0, xToTime(x)));
    S.handshapeSel = null;
    S.drag = {
        type: 'handshape', mode: 'create', anchorTime: t,
        hs: { start_time: t, end_time: t, arp: true },
    };
    host.draw();
    return true;
}

export function onHandshapeLaneMouseMove(e, x) {
    if (!S.drag || S.drag.type !== 'handshape') return false;
    const t = host.snapTime(Math.max(0, xToTime(x)));
    const d = S.drag;
    if (d.mode === 'create') {
        d.hs.start_time = Math.min(d.anchorTime, t);
        d.hs.end_time = Math.max(d.anchorTime, t);
    } else if (d.mode === 'resize-left') {
        d.hs.start_time = Math.min(t, d.hs.end_time - HS_MIN_SPAN);
        if (d.hs.start_time < 0) d.hs.start_time = 0;
    } else if (d.mode === 'resize-right') {
        d.hs.end_time = Math.max(t, d.hs.start_time + HS_MIN_SPAN);
    } else { // move — shift both edges, preserving width, clamped at 0
        const span = d.origEnd - d.origStart;
        let s = d.origStart + (t - d.grabTime);
        if (s < 0) s = 0;
        d.hs.start_time = s;
        d.hs.end_time = s + span;
    }
    host.draw();
    return true;
}

export function onHandshapeLaneMouseUp() {
    if (!S.drag || S.drag.type !== 'handshape') return false;
    const d = S.drag;
    S.drag = null;
    const arr = _currentAnchorArr();
    if (d.mode === 'create') {
        // Only create when the span both clears the min length AND covers a
        // resolvable voicing — a handshape over empty bars would otherwise
        // fall back to chord_id 0 (an unrelated shape) or an invalid ref.
        if (arr && d.hs.end_time - d.hs.start_time >= HS_MIN_SPAN
                && _handshapeSpanFrets(arr, d.hs.start_time, d.hs.end_time, lanes())) {
            S.history.exec(new AddHandshapeCmd(S.currentArr, d.hs, lanes()));
            S.handshapeSel = d.hs;
        } else if (arr) {
            setStatus('Handshape needs notes in the span — nothing to frame.');
        }
    } else {
        const newStart = d.hs.start_time, newEnd = d.hs.end_time;
        if (arr && (newStart !== d.origStart || newEnd !== d.origEnd)) {
            // Restore, then route through the command for clean undo.
            d.hs.start_time = d.origStart; d.hs.end_time = d.origEnd;
            const Cmd = d.mode === 'move' ? MoveHandshapeCmd : ResizeHandshapeCmd;
            S.history.exec(new Cmd(S.currentArr, d.hs, d.origStart, d.origEnd, newStart, newEnd));
        }
    }
    host.draw();
    return true;
}

export function onHandshapeLaneContextMenu(e, x, y) {
    const arr = _currentAnchorArr();
    if (!arr) return false;
    const hit = _hitHandshape(x, y);
    if (!hit) return false;
    const hs = hit.hs;
    S.handshapeSel = hs;
    S.toneSel = null;
    S.anchorSel = null;
    const menuArrIdx = S.currentArr;
    const menu = document.getElementById('editor-context-menu');
    menu.replaceChildren();

    const arpBtn = document.createElement('button');
    arpBtn.className = 'w-full text-left px-3 py-1 text-xs hover:bg-dark-500';
    arpBtn.textContent = hs.arp ? 'Make held chord shape' : 'Make arpeggio';
    arpBtn.onclick = () => {
        host.hideContextMenu();
        S.history.exec(new ToggleHandshapeArpCmd(menuArrIdx, hs));
        host.draw();
    };
    menu.appendChild(arpBtn);

    // Choose the covered template — lets the user repoint a handshape whose
    // span no longer matches the auto-resolved voicing.
    const templates = Array.isArray(arr.chord_templates) ? arr.chord_templates : [];
    if (templates.length) {
        const sep = document.createElement('div');
        sep.className = 'border-t border-gray-700 my-1';
        menu.appendChild(sep);
        const hdr = document.createElement('div');
        hdr.className = 'px-3 py-1 text-[10px] uppercase tracking-wide text-gray-500';
        hdr.textContent = 'Set shape';
        menu.appendChild(hdr);
        templates.forEach((ct, idx) => {
            if (!ct) return;
            const label = (ct.displayName || ct.name
                || (Array.isArray(ct.frets) ? ct.frets.join(' ') : `#${idx}`));
            const b = document.createElement('button');
            b.className = 'w-full text-left px-3 py-1 text-xs hover:bg-dark-500'
                + (idx === hs.chord_id ? ' text-sky-300' : '');
            b.textContent = (idx === hs.chord_id ? '• ' : '') + label;
            b.onclick = () => {
                host.hideContextMenu();
                if (idx !== hs.chord_id) {
                    S.history.exec(new SetHandshapeChordCmd(menuArrIdx, hs, hs.chord_id, idx));
                }
                host.draw();
            };
            menu.appendChild(b);
        });
    }

    const sep2 = document.createElement('div');
    sep2.className = 'border-t border-gray-700 my-1';
    menu.appendChild(sep2);

    const delBtn = document.createElement('button');
    delBtn.className = 'w-full text-left px-3 py-1 text-xs hover:bg-dark-500 text-rose-300';
    delBtn.textContent = 'Delete handshape';
    delBtn.onclick = () => {
        host.hideContextMenu();
        S.history.exec(new RemoveHandshapeCmd(menuArrIdx, hs));
        S.handshapeSel = null;
        host.draw();
    };
    menu.appendChild(delBtn);

    menu.style.left = e.clientX + 'px';
    menu.style.top = e.clientY + 'px';
    menu.classList.remove('hidden');
    return true;
}
