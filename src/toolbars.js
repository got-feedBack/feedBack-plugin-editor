/* Slopsmith Arrangement Editor — toggleable toolbars + density presets
 * (workspace-shell B5, charrette §2.3 / §3.1 / D-C4).
 *
 * The flat toolbar row's divider-groups become named, individually toggleable
 * toolbars. Each group is wrapped in a `.editor-tb` span (`display: contents`,
 * so the row's flex layout and gap are pixel-identical); hiding one is a CSS
 * class flip — zero canvas cost, nothing re-plumbs. A toolbar id may span
 * MULTIPLE wrappers (`grid` = the zoom chunk + the snap chunk, which sit apart
 * in the row), so visibility always applies via querySelectorAll.
 *
 * Charrette locks honored here:
 *  - Density presets are TASK-based (Compose / Transcribe / Everything),
 *    never "Beginner/Advanced". Compose = File+Edit+Grid; Transcribe adds
 *    Tempo+Overlays; Everything = all.
 *  - The surface NEVER auto-reverts to a lighter preset. Only three things
 *    change it: an explicit toggle, an explicit preset pick, and the one
 *    allowed content-action reveal (a pitched part activates -> the Harmony
 *    toolbar appears and STAYS — the wrapper around today's key-controls
 *    auto-show, which keeps its own inner show/hide logic untouched).
 *  - State is an editor-pref blob (localStorage `editorToolbars`), never the
 *    pack. First run (no pref) = Everything, i.e. exactly today's surface.
 *  - `Structure` has no toolbar buttons yet (section/phrase ops live in the
 *    menu bar under Add ▸ Markers) — it joins TOOLBAR_GROUPS when it does;
 *    the Transport cluster (loop/claps/click/count) takes its slot for now.
 *
 * The right-click checklist popover reuses the menu bar's item classes; its
 * one document-level listener (click-away close) rides host.addGlobalListener
 * into the teardown registry, so screen re-injection can't stack copies.
 */

import { host } from './host.js';

/* @pure:toolbar-state:start */
// The toggleable toolbars, in row order. `label` is what the View menu and
// the right-click checklist show.
export const TOOLBAR_GROUPS = Object.freeze([
    { id: 'file', label: 'File' },
    { id: 'parts', label: 'Parts' },
    { id: 'edit', label: 'Edit' },
    { id: 'transport', label: 'Transport' },
    { id: 'grid', label: 'Grid' },
    { id: 'tempo', label: 'Tempo' },
    { id: 'harmony', label: 'Harmony' },
    { id: 'overlays', label: 'Overlays' },
]);

// Task-based density presets (charrette §3.1). Everything = all groups, kept
// as a computed list so a new toolbar can never silently miss it.
export const TOOLBAR_PRESETS = Object.freeze({
    compose: Object.freeze(['file', 'edit', 'grid']),
    transcribe: Object.freeze(['file', 'edit', 'grid', 'tempo', 'overlays']),
    everything: Object.freeze(TOOLBAR_GROUPS.map((g) => g.id)),
});

const _ids = () => TOOLBAR_GROUPS.map((g) => g.id);
const _hasPreset = (name) => typeof name === 'string'
    && Object.prototype.hasOwnProperty.call(TOOLBAR_PRESETS, name);

// Parse + validate the persisted pref blob. Anything malformed — bad JSON,
// unknown preset, unknown toolbar ids, non-boolean overrides — degrades to
// the surviving valid parts, and an empty/absent blob is the default state
// (preset Everything, no overrides, no reveals): today's surface exactly.
export function _toolbarStateLoadPure(raw) {
    const state = { preset: 'everything', overrides: {}, revealed: {} };
    if (typeof raw !== 'string' || !raw) return state;
    let obj = null;
    try { obj = JSON.parse(raw); } catch (_) { return state; }
    if (!obj || typeof obj !== 'object') return state;
    if (_hasPreset(obj.preset)) state.preset = obj.preset;
    const known = new Set(_ids());
    if (obj.overrides && typeof obj.overrides === 'object') {
        for (const [k, v] of Object.entries(obj.overrides)) {
            if (known.has(k) && typeof v === 'boolean') state.overrides[k] = v;
        }
    }
    if (obj.revealed && typeof obj.revealed === 'object') {
        for (const k of Object.keys(obj.revealed)) {
            if (known.has(k) && obj.revealed[k] === true) state.revealed[k] = true;
        }
    }
    return state;
}

// Effective visibility: an explicit user toggle wins; otherwise the preset's
// set, widened by any sticky content-action reveals.
export function _toolbarVisiblePure(state) {
    const preset = _hasPreset(state.preset)
        ? TOOLBAR_PRESETS[state.preset]
        : TOOLBAR_PRESETS.everything;
    const out = {};
    for (const id of _ids()) {
        out[id] = (typeof state.overrides[id] === 'boolean')
            ? state.overrides[id]
            : (preset.includes(id) || state.revealed[id] === true);
    }
    return out;
}

// Flip one toolbar from its EFFECTIVE state (so toggling a preset-shown
// toolbar hides it, and toggling it again shows it — no three-state surprise).
export function _toolbarTogglePure(state, id) {
    if (!_ids().includes(id)) return state;
    const visible = _toolbarVisiblePure(state)[id];
    return {
        preset: state.preset,
        overrides: { ...state.overrides, [id]: !visible },
        revealed: { ...state.revealed },
    };
}

// Picking a preset is a layout statement: it clears manual overrides and
// sticky reveals so the named surface is exactly what you get.
export function _toolbarPresetPure(state, name) {
    if (!_hasPreset(name)) return state;
    return { preset: name, overrides: {}, revealed: {} };
}

// The one allowed content-action reveal: show a toolbar and make it STICK
// (a preset-hidden toolbar gains a `revealed` mark, never an override, so
// "Reset layout" still returns to the pure preset). No-op when already
// visible or explicitly hidden by the user — a reveal never fights a choice.
export function _toolbarRevealPure(state, id) {
    if (!_ids().includes(id)) return state;
    if (typeof state.overrides[id] === 'boolean') return state;   // user chose; respect it
    if (_toolbarVisiblePure(state)[id]) return state;
    return {
        preset: state.preset,
        overrides: { ...state.overrides },
        revealed: { ...state.revealed, [id]: true },
    };
}
/* @pure:toolbar-state:end */

const PREF_KEY = 'editorToolbars';
let _state = null;

function tbState() {
    if (_state) return _state;
    let raw = null;
    try { raw = localStorage.getItem(PREF_KEY); } catch (_) { /* blocked storage */ }
    _state = _toolbarStateLoadPure(raw);
    return _state;
}

function saveTb() {
    try { localStorage.setItem(PREF_KEY, JSON.stringify(_state)); } catch (_) { /* blocked storage */ }
}

// Apply effective visibility to the DOM. A toolbar id can own several
// wrappers; all flip together.
export function applyToolbars() {
    if (typeof document === 'undefined') return;
    const visible = _toolbarVisiblePure(tbState());
    document.querySelectorAll('#editor-toolbar-row .editor-tb').forEach((el) => {
        const id = el.dataset.tb;
        if (id in visible) el.classList.toggle('editor-tb-off', !visible[id]);
    });
}

export function toggleToolbar(id) {
    _state = _toolbarTogglePure(tbState(), id);
    saveTb();
    applyToolbars();
}

export function applyToolbarPreset(name) {
    _state = _toolbarPresetPure(tbState(), name);
    saveTb();
    applyToolbars();
}

// Reset layout = back to the current preset's pure default (clear overrides
// and reveals; the preset choice itself is kept).
export function resetToolbarLayout() {
    _state = _toolbarPresetPure(tbState(), tbState().preset);
    saveTb();
    applyToolbars();
}

export function revealToolbar(id) {
    const before = tbState();
    _state = _toolbarRevealPure(before, id);
    if (_state !== before) { saveTb(); applyToolbars(); }
}

// What the View menu / checklist needs to render checkmarks.
export function getToolbarCtx() {
    const state = tbState();
    return { visible: _toolbarVisiblePure(state), preset: state.preset };
}

// ── Right-click checklist ─────────────────────────────────────────────
const CTX_ID = 'editor-tb-context';

function hideTbContext() {
    const el = document.getElementById(CTX_ID);
    if (el) el.remove();
}

function showTbContext(x, y) {
    hideTbContext();
    const ctx = getToolbarCtx();
    const rows = TOOLBAR_GROUPS.map((g) =>
        `<button class="editor-menu-item" data-tb-toggle="${g.id}" role="menuitemcheckbox" aria-checked="${ctx.visible[g.id]}">`
        + `<span class="editor-menu-label">${ctx.visible[g.id] ? '✓ ' : '  '}${g.label}</span></button>`).join('');
    const presets = ['compose', 'transcribe', 'everything'].map((p) =>
        `<button class="editor-menu-item" data-tb-preset="${p}" role="menuitemradio" aria-checked="${ctx.preset === p}">`
        + `<span class="editor-menu-label">${ctx.preset === p ? '✓ ' : '  '}${p[0].toUpperCase()}${p.slice(1)}</span></button>`).join('');
    const el = document.createElement('div');
    el.id = CTX_ID;
    el.className = 'editor-menu-drop editor-tb-context';
    el.setAttribute('role', 'menu');
    el.innerHTML = `<div class="editor-menu-hdr">Toolbars</div>${rows}`
        + `<div class="editor-menu-sep"></div><div class="editor-menu-hdr">Density preset</div>${presets}`
        + `<div class="editor-menu-sep"></div>`
        + `<button class="editor-menu-item" data-tb-reset="1"><span class="editor-menu-label">Reset layout</span></button>`;
    el.style.left = x + 'px';
    el.style.top = y + 'px';
    el.addEventListener('click', (e) => {
        const t = e.target instanceof HTMLElement ? e.target.closest('.editor-menu-item') : null;
        if (!t) return;
        if (t.dataset.tbToggle) { toggleToolbar(t.dataset.tbToggle); showTbContext(x, y); return; }
        if (t.dataset.tbPreset) { applyToolbarPreset(t.dataset.tbPreset); showTbContext(x, y); return; }
        if (t.dataset.tbReset) { resetToolbarLayout(); hideTbContext(); }
    });
    const screen = document.getElementById('plugin-editor');
    (screen || document.body).appendChild(el);
    // Keep the popover on-screen when opened near the right edge.
    const r = el.getBoundingClientRect();
    if (r.right > window.innerWidth - 4) el.style.left = Math.max(4, window.innerWidth - r.width - 4) + 'px';
}

export function initToolbars() {
    if (typeof document === 'undefined') return;
    applyToolbars();
    const row = document.getElementById('editor-toolbar-row');
    if (row) {
        // In-DOM listener: dies with the screen DOM on re-injection.
        row.addEventListener('contextmenu', (e) => {
            // Right-click on an input/select keeps the native menu (paste etc.).
            const t = e.target instanceof HTMLElement ? e.target : null;
            if (t && t.closest('input, select, textarea')) return;
            e.preventDefault();
            showTbContext(e.clientX, e.clientY);
        });
    }
    // The ONE document-level listener — teardown-registered so re-injection
    // can't stack copies (same idiom as the menu bar's click-away).
    host.addGlobalListener(document, 'mousedown', (e) => {
        const el = document.getElementById(CTX_ID);
        if (el && e.target instanceof Node && !el.contains(e.target)) hideTbContext();
    });
}

// Test seam: reset the module-level cache so suites can exercise load paths.
export function _resetToolbarStateForTest() { _state = null; }
