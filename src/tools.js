// Click tools — the pointer-tool system (View: CLICK-TOOLS-DESIGN.md).
//
// The DAW-parity model is Logic Pro's Tool menu: **T opens a tool palette at
// the pointer; the next key picks the left-click tool** — plus Live's Draw
// Mode (the Cableton profile toggles the Pencil on `B`). The right mouse
// button reaches the same vocabulary through the extended right-click
// assignment, so left and right click have feature parity in every preset.
//
// Per-profile palette semantics (Christian's calls, 2026-07-16):
//   FeedBack  — T opens the palette; **T,T = Tempo Map** (the old plain-T
//               habit survives as a double-tap; tempo map reads as "the
//               tempo tool"). Esc or T,V = Pointer.
//   Logical   — Logic-exact: **T,T = Pointer** (reset). Tempo Map moves to
//               plain `G` (Logic's G = global tracks, where the tempo track
//               lives — that profile's snap toggle falls back to menu/toolbar).
//   Cableton  — like FeedBack, plus plain `B` toggles Pencil ↔ Pointer
//               (Live Draw Mode; that profile's bend key falls back to the
//               inspector/menu).
//   Legacy    — zero key changes (1:1 EOF: plain T stays Tap). The palette
//               is reachable from the View menu / command palette only.
//
// Pencil semantics are Live's Draw Mode, which is ALSO EOF's right-click
// edit: click empty = add a snap-quantized note instantly (no dialog),
// click a note = delete it. Logic purists keep the separate Eraser.

import { host } from './host.js';
import { setStatus } from './ui.js';

/* @pure:click-tools:start */
// Tool ids, in palette display order. `pointer` is the universal default.
export const EDITOR_TOOLS = Object.freeze([
    { id: 'pointer', key: 'v', label: 'Pointer', cursor: 'default' },
    { id: 'pencil', key: 'b', label: 'Pencil (draw)', cursor: 'crosshair' },
    { id: 'eraser', key: 'e', label: 'Eraser', cursor: 'cell' },
    { id: 'marquee', key: 'm', label: 'Marquee', cursor: 'crosshair' },
    { id: 'mute', key: 'u', label: 'Mute', cursor: 'pointer' },
    { id: 'scissors', key: 'c', label: 'Scissors (split)', cursor: 'col-resize' },
]);
const _TOOL_IDS = new Set(EDITOR_TOOLS.map(t => t.id));

export function _editorToolValidPure(id) {
    return _TOOL_IDS.has(id) ? id : 'pointer';
}

// Which plain key opens the palette in note mode, per profile. Legacy (EOF)
// deliberately has NONE — its key map stays 1:1 EOF (plain T = Tap there);
// the palette is reachable via the View menu / command palette instead.
export function _editorPaletteOpenKeyPure(profile) {
    return profile === 'eof' ? null : 't';
}

// The palette state machine: a key pressed WHILE THE PALETTE IS OPEN.
// Returns {tool}, {mode:'tempoMap'}, {close:true}, or null (ignored key —
// palette stays open). Palette keys are live only while open, so they can
// never collide with note-entry digits or any global bind.
//
// The second-T semantics are the per-profile product call:
//   logical → Logic-exact: T,T resets to Pointer.
//   feedback/cableton → T,T = Tempo Map (the old plain-T muscle memory).
export function _editorPaletteKeyActionPure(profile, key) {
    const k = (key || '').toLowerCase();
    if (k === 'escape') return { close: true };
    if (k === 't') {
        return profile === 'logical'
            ? { tool: 'pointer' }
            : { mode: 'tempoMap' };
    }
    for (const tool of EDITOR_TOOLS) {
        if (tool.key === k) return { tool: tool.id };
    }
    return null;
}

// Right-click assignment vocabulary — feature parity with the left tools.
// 'context' (the shortcut menu) and 'eofEdit' (the fused EOF add/delete verb)
// keep their existing meanings; 'tool:<id>' runs that tool's click action on
// the right button. Anything else falls back to the profile default
// ('eofEdit' for Legacy, 'context' elsewhere) — same shape as before, so a
// stored pre-extension value keeps working unchanged.
export function _editorRightAssignValidPure(value) {
    if (value === 'context' || value === 'eofEdit') return value;
    if (typeof value === 'string' && value.startsWith('tool:')) {
        const id = value.slice(5);
        if (_TOOL_IDS.has(id) && id !== 'pointer') return value;
    }
    return null;
}

export function _editorEffectiveRightAssignPure(profile, saved) {
    return _editorRightAssignValidPure(saved)
        || (profile === 'eof' ? 'eofEdit' : 'context');
}
/* @pure:click-tools:end */

// ── Left-tool state (global editor preference, like the theme) ───────
const EDITOR_LEFT_TOOL_KEY = 'editor.leftTool';
let _leftTool = null;

export function editorLeftTool() {
    if (_leftTool === null) {
        let raw = null;
        try { raw = localStorage.getItem(EDITOR_LEFT_TOOL_KEY); }
        catch (_) { /* private mode */ }
        _leftTool = _editorToolValidPure(raw);
    }
    return _leftTool;
}

export function setEditorLeftTool(id) {
    const tool = _editorToolValidPure(id);
    _leftTool = tool;
    try { localStorage.setItem(EDITOR_LEFT_TOOL_KEY, tool); }
    catch (_) { /* private mode */ }
    _applyToolCursor();
    const def = EDITOR_TOOLS.find(t => t.id === tool);
    setStatus('Tool: ' + (def ? def.label : tool));
    if (host && typeof host.draw === 'function') host.draw();
    return tool;
}

// Sync the canvas cursor to the active left tool. Side-effect-free w.r.t. tool
// state — it only reads editorLeftTool() — so init can call it to restore a
// persisted destructive tool's cursor (e.g. Eraser) without re-triggering a
// tool change. setEditorLeftTool() calls it too.
export function _applyToolCursor() {
    if (typeof document === 'undefined') return;
    const canvas = document.getElementById('editor-canvas');
    if (!canvas) return;
    const def = EDITOR_TOOLS.find(t => t.id === editorLeftTool());
    canvas.style.cursor = def ? def.cursor : 'default';
}

// ── The palette popover ──────────────────────────────────────────────
// Built once, positioned at the pointer on open (Logic's behavior), torn
// down with the screen via the teardown-tracked registry in main.js's
// keydown path (the palette itself holds no global listeners — the open/
// key/close flow arrives through the existing keydown dispatch).

let _paletteOpen = false;
let _lastMouse = { x: 0, y: 0 };

export function editorToolPaletteOpen() { return _paletteOpen; }

export function editorTrackToolMouse(x, y) { _lastMouse = { x, y }; }

function _paletteEl() {
    return typeof document !== 'undefined'
        ? document.getElementById('editor-tool-palette') : null;
}

export function editorOpenToolPalette(profile) {
    const el = _paletteEl();
    if (!el) return false;
    _renderPalette(el, profile);
    // At the pointer, clamped into the viewport (Logic opens the Tool menu
    // under the cursor).
    const pad = 8;
    const w = 200, h = el.offsetHeight || 220;
    const x = Math.min(Math.max(pad, _lastMouse.x), (window.innerWidth || 1200) - w - pad);
    const y = Math.min(Math.max(pad, _lastMouse.y), (window.innerHeight || 800) - h - pad);
    el.style.left = x + 'px';
    el.style.top = y + 'px';
    el.classList.remove('hidden');
    _paletteOpen = true;
    return true;
}

export function editorCloseToolPalette() {
    const el = _paletteEl();
    if (el) el.classList.add('hidden');
    _paletteOpen = false;
}

function _renderPalette(el, profile) {
    const active = editorLeftTool();
    const rows = EDITOR_TOOLS.map(t => (
        `<button data-tool="${t.id}" class="editor-tool-row w-full flex items-center justify-between px-3 py-1.5 rounded text-left text-xs ${t.id === active ? 'bg-accent/20 text-white' : 'text-gray-300 hover:bg-dark-600'}">`
        + `<span>${t.label}</span><span class="text-gray-500 font-mono uppercase">${t.key}</span></button>`
    ));
    // The second-T row mirrors _editorPaletteKeyActionPure so the UI and the
    // key dispatch can never disagree.
    if (profile !== 'logical') {
        rows.push('<div class="border-t border-gray-700 my-1"></div>');
        rows.push('<button data-mode="tempoMap" class="editor-tool-row w-full flex items-center justify-between px-3 py-1.5 rounded text-left text-xs text-gray-300 hover:bg-dark-600">'
            + '<span>Tempo Map mode</span><span class="text-gray-500 font-mono uppercase">t</span></button>');
    }
    el.querySelector('.editor-tool-palette-rows').innerHTML = rows.join('');
}

// Palette click dispatch — wired from main.js boot with the command runner
// passed in (tools.js can't import input.js back without closing a cycle;
// same seams-not-cycles rule as host.js).
export function editorToolPaletteClick(e, runCommand) {
    const btn = e.target && e.target.closest
        ? e.target.closest('[data-tool],[data-mode]') : null;
    if (!btn) return false;
    editorCloseToolPalette();
    if (btn.dataset.tool) { setEditorLeftTool(btn.dataset.tool); return true; }
    if (btn.dataset.mode === 'tempoMap' && typeof runCommand === 'function') {
        runCommand('toggleTempoMap');
        return true;
    }
    return false;
}

if (typeof window !== 'undefined') {
    // Menu / command-palette entry points (View ▸ Tool ▸ …).
    window.editorSetLeftTool = (id) => setEditorLeftTool(id);
    window.editorShowToolPalette = () => {
        // Menu-opened: center-ish rather than at a stale mouse point.
        if (!_lastMouse.x && !_lastMouse.y) {
            _lastMouse = {
                x: (window.innerWidth || 1200) / 2 - 100,
                y: (window.innerHeight || 800) / 3,
            };
        }
        editorOpenToolPalette(typeof window.editorShortcutProfileName === 'function'
            ? window.editorShortcutProfileName() : 'feedback');
    };
}
