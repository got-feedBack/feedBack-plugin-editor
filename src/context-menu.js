// ════════════════════════════════════════════════════════════════════
// The canvas context menu, and the prompt dialogs it opens.
//
// Right-click a note -> showContextMenu builds a menu of edits (change fret,
// bend, slide, delete, position moves); each entry runs a command from
// src/commands.js. The prompt* dialogs (promptFret / promptBend / promptSlide /
// promptSlideUnpitch) are the modal editors those entries and the keyboard
// shortcuts open; they read back through src/ui.js's _editorPromptText.
//
// main.js imports these directly and keeps the canvas event that decides WHEN to
// open the menu. Three of its symbols travel back — draw, updateStatus,
// _editBlipAt — through the shared `host` object. promptBend and hideContextMenu
// are already host hooks (the inspector and several modes call them); they now
// resolve to the exports here.
//
// Browser surface: the menu and dialog DOM it builds.
// ════════════════════════════════════════════════════════════════════
import {
    ChangeFretCmd, DeleteNotesCmd, SetBendShapeCmd, _canMoveString, _execAcceptPositions,
    _execMoveString,
} from './commands.js';
import { host } from './host.js';
import { _renderInspector } from './inspector.js';
import { _rollLockNotice, _rollReadOnly } from './keys.js';
import {
    BEND_INTENTS, _isSuggested, bendPresetCurve, notes, rescaleBendCurveToPeak, sanitizeBendCurve,
} from './notes.js';
import { S } from './state.js';
import { _editorPromptText, _installModalKeyboard } from './ui.js';

// ════════════════════════════════════════════════════════════════════
// Context menu
// ════════════════════════════════════════════════════════════════════

export function showContextMenu(cx, cy, idx) {
    const menu = document.getElementById('editor-context-menu');

    // Pre-compute move-string validity once for the whole menu so both
    // items share the same check without re-evaluating per render pass.
    const canUp   = _canMoveString(+1);
    const canDown = _canMoveString(-1);

    const n = notes()[idx];
    const items = [
        // Suggest-position (VA.3): confirm the machine's pick for the current
        // selection (clears the suggested mark; undo re-marks). Shown only when
        // the clicked note is still an unconfirmed suggestion.
        ...(_isSuggested(n) ? [
            { label: '✓ Accept position', action: () => { hideContextMenu(); _execAcceptPositions(); } },
            { type: 'sep' },
        ] : []),
        { label: 'Move Up 1 String',   action: () => { hideContextMenu(); _execMoveString(+1); }, disabled: !canUp },
        { label: 'Move Down 1 String', action: () => { hideContextMenu(); _execMoveString(-1); }, disabled: !canDown },
        { type: 'sep' },
        { label: 'Change Fret...', action: () => promptFret(idx) },
        { label: 'Bend...', action: () => promptBend(idx) },
        { label: 'Slide To...', action: () => promptSlide(idx) },
        { label: 'Slide Unpitched To...', action: () => promptSlideUnpitch(idx) },
        { label: 'Delete', action: () => { S.history.exec(new DeleteNotesCmd([...S.sel])); host.draw(); host.updateStatus(); } },
        { type: 'sep' },
        { label: 'Hammer-On', toggle: 'hammer_on', idx },
        { label: 'Pull-Off', toggle: 'pull_off', idx },
        { label: 'Palm Mute', toggle: 'palm_mute', idx },
        { label: 'Fret-Hand Mute', toggle: 'fret_hand_mute', idx },
        { label: 'Harmonic', toggle: 'harmonic', idx },
        { label: 'Pinch Harmonic', toggle: 'harmonic_pinch', idx },
        { label: 'Accent', toggle: 'accent', idx },
        { label: 'Tap', toggle: 'tap', idx },
        { label: 'Slap', toggle: 'slap', idx },
        { label: 'Pop (Pluck)', toggle: 'pluck', idx },
        { label: 'Tremolo', toggle: 'tremolo', idx },
        { label: 'Vibrato', toggle: 'vibrato', idx },
        { label: 'Mute', toggle: 'mute', idx },
        { label: 'Link Next', toggle: 'link_next', idx },
        { label: 'Ignore', toggle: 'ignore', idx },
    ];

    let html = '';
    for (const it of items) {
        if (it.type === 'sep') {
            html += '<div class="border-t border-gray-700 my-1"></div>';
            continue;
        }
        if (it.toggle) {
            const techs = n.techniques || {};
            const on = techs[it.toggle];
            html += `<button class="w-full text-left px-3 py-1 text-xs hover:bg-dark-500 flex items-center gap-2" onclick="editorToggleTech(${idx},'${it.toggle}')">
                <span class="w-3">${on ? '\u2713' : ''}</span>${it.label}</button>`;
        } else if (it.disabled) {
            // Greyed-out, non-interactive entry for invalid move directions.
            html += `<button class="w-full text-left px-3 py-1 text-xs opacity-40 cursor-not-allowed" disabled>${it.label}</button>`;
        } else {
            html += `<button class="w-full text-left px-3 py-1 text-xs hover:bg-dark-500" data-action="${items.indexOf(it)}">${it.label}</button>`;
        }
    }
    menu.innerHTML = html;
    // Wire up non-toggle, non-disabled actions
    menu.querySelectorAll('[data-action]').forEach(btn => {
        const actionItem = items[parseInt(btn.dataset.action)];
        btn.onclick = () => { hideContextMenu(); actionItem.action(); };
    });

    menu.style.left = cx + 'px';
    menu.style.top = cy + 'px';
    menu.classList.remove('hidden');
}
export function hideContextMenu() {
    document.getElementById('editor-context-menu').classList.add('hidden');
}

export async function promptFret(idx) {
    hideContextMenu();
    const current = notes()[idx].fret;
    const val = await _editorPromptText({
        title: 'Edit Fret', label: 'Fret number (0–24)', value: String(current),
    });
    if (val === null) return;
    // Strict-integer parse so `12abc` / `0x10` fall back to 0 instead
    // of silently truncating to a surprising value. `_parseFretInput`
    // returns -1 on bad input; clamp to [0, 24] for the fretboard.
    const parsed = _parseFretInput(val);
    const fret = Math.max(0, Math.min(24, parsed < 0 ? 0 : parsed));
    S.history.exec(new ChangeFretCmd(idx, fret));
    host.editBlipAt();
    host.draw();
    _renderInspector();
}

// Bend authoring (§6.2.1): a modal with the peak amount (`bn`), an intent
// dropdown (`bt`) and an interactive drag-point curve editor (`bnv`). Applies
// to the full selection when the right-clicked note is part of it, else just
// that note. Wrapped in SetBendShapeCmd so the whole edit is one undo step.
export async function promptBend(idx) {
    hideContextMenu();
    const n = notes()[idx];
    if (!n) return;
    const targets = (S.sel && S.sel.size && S.sel.has(idx)) ? [...S.sel] : [idx];
    const techs = n.techniques || {};
    const startBn = Number(techs.bend) || 0;
    const startBt = Number(techs.bend_intent) || 0;
    const startBnv = sanitizeBendCurve(techs.bend_values)
        || bendPresetCurve(startBt, startBn || 1, n.sustain);
    const result = await _editorBendModal({
        bn: startBn, bt: startBt, bnv: startBnv, sustain: n.sustain,
    });
    if (result === null) return;  // cancelled
    S.history.exec(new SetBendShapeCmd(
        targets, result.bn, result.bt, sanitizeBendCurve(result.bnv)));
    host.draw();
    _renderInspector();
    host.updateStatus();
}

// The bend-shape modal. Resolves to {bn, bt, bnv} on OK, or null on Cancel.
// The curve editor: left-click empty space adds a point, drag moves it,
// right-click deletes it; x = time across the note, y = semitones.
function _editorBendModal({ bn = 0, bt = 0, bnv = null, sustain = 0 } = {}) {
    return new Promise((resolve) => {
        document.getElementById('editor-bend-modal')?.remove();
        const Tmax = sustain > 0 ? sustain : 1.0;
        let curBn = Math.max(0, Math.min(3, Number(bn) || 0));
        let curBt = Number(bt) || 0;
        let pts = (sanitizeBendCurve(bnv) || []).map(p => ({ t: p.t, v: p.v }));

        const modal = document.createElement('div');
        modal.id = 'editor-bend-modal';
        modal.className = 'fixed inset-0 bg-black/70 z-50 flex items-center justify-center';
        const inner = document.createElement('div');
        inner.className = 'bg-dark-800 border border-gray-700 rounded-lg p-6 w-full max-w-md mx-4';
        inner.setAttribute('role', 'dialog');
        inner.setAttribute('aria-modal', 'true');
        inner.setAttribute('aria-label', 'Edit bend');

        let settled = false;
        const done = (val) => {
            if (settled) return;
            settled = true;
            modal.remove();
            resolve(val);
        };

        // Vmax: keep the peak and any authored point visible (>= 3 semis).
        const vmax = () => Math.max(3, curBn, ...pts.map(p => p.v), 1);
        const W = 380, H = 170, pad = 26;
        const toX = (t) => pad + (Tmax > 0 ? t / Tmax : 0) * (W - 2 * pad);
        const toY = (v) => H - pad - (v / vmax()) * (H - 2 * pad);
        const fromX = (px) => Math.max(0, Math.min(1, (px - pad) / (W - 2 * pad))) * Tmax;
        const fromY = (py) => Math.max(0, Math.min(1, (H - pad - py) / (H - 2 * pad))) * vmax();

        inner.innerHTML = `
            <h3 class="text-lg font-semibold mb-3">Edit bend</h3>
            <div class="flex items-center gap-3 mb-3">
                <label class="flex items-center gap-2">
                    <span class="text-xs text-gray-400">Peak (semi)</span>
                    <input id="bend-bn" type="number" min="0" max="3" step="0.5" value="${curBn}"
                        class="w-20 bg-dark-700 border border-gray-600 rounded px-1 py-0.5 text-xs">
                </label>
                <label class="flex items-center gap-2 flex-1">
                    <span class="text-xs text-gray-400">Intent</span>
                    <select id="bend-bt" class="flex-1 bg-dark-700 border border-gray-600 rounded px-1 py-0.5 text-xs">
                        ${BEND_INTENTS.map(o => `<option value="${o.v}"${o.v === curBt ? ' selected' : ''}>${o.label}</option>`).join('')}
                    </select>
                </label>
            </div>
            <canvas id="bend-canvas" width="${W}" height="${H}"
                class="w-full bg-dark-900 border border-gray-700 rounded cursor-crosshair"></canvas>
            <p class="text-[11px] text-gray-500 mt-1">Click to add a point · drag to move · right-click to remove. Preset from intent:</p>
            <div class="flex gap-2 mt-2">
                <button type="button" id="bend-preset" class="px-2 py-1 bg-dark-700 hover:bg-dark-600 rounded text-xs">Apply preset</button>
                <button type="button" id="bend-clear" class="px-2 py-1 bg-dark-700 hover:bg-dark-600 rounded text-xs">Clear curve</button>
                <div class="flex-1"></div>
                <button type="button" id="bend-cancel" class="px-3 py-1 bg-dark-700 hover:bg-dark-600 rounded text-sm">Cancel</button>
                <button type="button" id="bend-ok" class="px-3 py-1 bg-blue-700 hover:bg-blue-600 rounded text-sm">OK</button>
            </div>`;
        modal.appendChild(inner);
        document.body.appendChild(modal);

        const canvas = inner.querySelector('#bend-canvas');
        const cx = canvas.getContext('2d');
        const bnInput = inner.querySelector('#bend-bn');
        const btSelect = inner.querySelector('#bend-bt');

        const redraw = () => {
            cx.clearRect(0, 0, W, H);
            // Baseline (0 semis) + frame.
            cx.strokeStyle = '#374151';
            cx.lineWidth = 1;
            cx.strokeRect(pad, pad, W - 2 * pad, H - 2 * pad);
            cx.beginPath();
            cx.moveTo(pad, toY(0)); cx.lineTo(W - pad, toY(0));
            cx.stroke();
            // Curve through the time-sorted points.
            const sorted = pts.slice().sort((a, b) => a.t - b.t);
            if (sorted.length) {
                cx.strokeStyle = '#60a5fa';
                cx.lineWidth = 2;
                cx.beginPath();
                sorted.forEach((p, i) => {
                    const X = toX(p.t), Y = toY(p.v);
                    if (i === 0) cx.moveTo(X, Y); else cx.lineTo(X, Y);
                });
                cx.stroke();
                cx.fillStyle = '#93c5fd';
                for (const p of sorted) {
                    cx.beginPath();
                    cx.arc(toX(p.t), toY(p.v), 4, 0, Math.PI * 2);
                    cx.fill();
                }
            }
        };
        redraw();

        const evtPos = (e) => {
            const r = canvas.getBoundingClientRect();
            return {
                px: (e.clientX - r.left) * (W / r.width),
                py: (e.clientY - r.top) * (H / r.height),
            };
        };
        const nearest = (px, py) => {
            let best = -1, bestD = 12 * 12;
            pts.forEach((p, i) => {
                const dx = toX(p.t) - px, dy = toY(p.v) - py;
                const d = dx * dx + dy * dy;
                if (d < bestD) { bestD = d; best = i; }
            });
            return best;
        };
        let drag = null;  // dragged point object reference
        canvas.addEventListener('pointerdown', (e) => {
            if (e.button !== 0) return;
            const { px, py } = evtPos(e);
            const hit = nearest(px, py);
            if (hit >= 0) {
                drag = pts[hit];
            } else {
                drag = { t: fromX(px), v: fromY(py) };
                pts.push(drag);
            }
            canvas.setPointerCapture(e.pointerId);
            redraw();
        });
        canvas.addEventListener('pointermove', (e) => {
            if (!drag) return;
            const { px, py } = evtPos(e);
            drag.t = fromX(px);
            drag.v = fromY(py);
            redraw();
        });
        const endDrag = () => {
            if (!drag) return;
            drag = null;
            pts.sort((a, b) => a.t - b.t);
            redraw();
        };
        canvas.addEventListener('pointerup', endDrag);
        canvas.addEventListener('pointercancel', endDrag);
        canvas.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            const { px, py } = evtPos(e);
            const hit = nearest(px, py);
            if (hit >= 0) { pts.splice(hit, 1); redraw(); }
        });

        bnInput.addEventListener('change', () => {
            const v = Number(bnInput.value);
            curBn = Number.isFinite(v) ? Math.max(0, Math.min(3, v)) : 0;
            // Keep the curve consistent with the Peak input: rescale to the new
            // peak (preserves shape), or clear it — when Peak is 0 (= no bend),
            // or when the curve is empty/all-zero so it can't carry the peak
            // (else OK would derive bn=0 and silently discard the Peak edit).
            pts = curBn > 0 ? (rescaleBendCurveToPeak(pts, curBn) || []) : [];
            bnInput.value = String(curBn);
            redraw();
        });
        btSelect.addEventListener('change', () => { curBt = Number(btSelect.value) || 0; });
        inner.querySelector('#bend-preset').onclick = () => {
            pts = bendPresetCurve(curBt, curBn || 1, sustain).map(p => ({ t: p.t, v: p.v }));
            redraw();
        };
        inner.querySelector('#bend-clear').onclick = () => { pts = []; redraw(); };
        inner.querySelector('#bend-cancel').onclick = () => done(null);
        inner.querySelector('#bend-ok').onclick = () => {
            const cleanBnv = sanitizeBendCurve(pts);
            // `bn` is the PEAK; when a curve exists it MUST equal the curve's
            // peak (renderers/graders treat bnv as authoritative). Reconcile so
            // a saved `bn` can never contradict `bnv`.
            const finalBn = (cleanBnv && cleanBnv.length)
                ? Math.max(0, ...cleanBnv.map(p => p.v))
                : curBn;
            done({ bn: finalBn, bt: curBt, bnv: cleanBnv });
        };

        _installModalKeyboard(modal, inner, () => done(null));
        bnInput.focus();
    });
}

// Parse a `prompt()` fret input strictly: a plain decimal integer
// (optionally signed). Anything else (`0x10`, `12abc`, `--3`, `1.5`)
// falls back to `-1`, which the slide setters treat as "no slide".
// Using a regex rather than raw `parseInt` because `parseInt('12abc')`
// silently returns `12` and `parseInt('0x10', 10)` silently returns
// `0`, both of which would be surprising fret values for the user.
function _parseFretInput(val) {
    if (val === null || val === undefined) return -1;
    const m = String(val).trim().match(/^[-+]?\d+$/);
    if (!m) return -1;
    const n = Number(m[0]);
    return Number.isFinite(n) ? n : -1;
}

export async function promptSlide(idx) {
    hideContextMenu();
    // Read-only roll (V4): slide authoring mutates n.techniques directly
    // (it bypasses EditHistory), so the exec lock can't catch it — guard
    // the entry point like every other note-edit path in the roll.
    if (_rollReadOnly()) { _rollLockNotice(); return; }
    const n = notes()[idx];
    const techs = n.techniques || {};
    const current = techs.slide_to >= 0 ? techs.slide_to : '';
    const val = await _editorPromptText({
        title: 'Slide', label: 'Slide to fret (-1 or empty = no slide)',
        value: String(current),
    });
    if (val === null) return;
    if (!n.techniques) n.techniques = {};
    const fret = _parseFretInput(val);
    n.techniques.slide_to = fret < 0 ? -1 : Math.min(24, fret);
    host.draw();
    _renderInspector();
}

export async function promptSlideUnpitch(idx) {
    hideContextMenu();
    // Read-only roll (V4): direct n.techniques mutation — guard like promptSlide.
    if (_rollReadOnly()) { _rollLockNotice(); return; }
    const n = notes()[idx];
    const techs = n.techniques || {};
    const current = techs.slide_unpitch_to >= 0 ? techs.slide_unpitch_to : '';
    const val = await _editorPromptText({
        title: 'Unpitched Slide',
        label: 'Slide unpitched to fret (-1 or empty = no slide)',
        value: String(current),
    });
    if (val === null) return;
    if (!n.techniques) n.techniques = {};
    const fret = _parseFretInput(val);
    n.techniques.slide_unpitch_to = fret < 0 ? -1 : Math.min(24, fret);
    host.draw();
    _renderInspector();
}
