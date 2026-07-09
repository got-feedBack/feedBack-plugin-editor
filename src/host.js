// ════════════════════════════════════════════════════════════════════
// The host callbacks — the handful of main.js symbols that extracted modules
// still need, and cannot import back without closing a cycle (main.js imports
// them).
//
// This started as a `setXHooks()` per module. By the fourth module the same
// four callbacks — draw, hideContextMenu, snapTime, editorPromptText — were
// being threaded through four separate hook objects, so they collapse here.
// A new module needs no new plumbing: import `host` and call `host.draw()`.
//
// ── The trap this exists to contain ──────────────────────────────────
// `draw` is REASSIGNED near the bottom of main.js to a wrapper that refreshes
// seven toolbar buttons before repainting. Passing the bare identifier to
// setHostHooks() captures the ORIGINAL function forever, and since the canvas
// still repaints, nothing looks wrong — only the button refreshes silently stop
// happening. That shipped in #165/#166 and took a Codex review to spot.
//
// So: pass a THUNK for anything main.js reassigns — `draw: (...a) => draw(...a)`
// — not the identifier. Before wiring a symbol here, check it is not reassigned
// (`grep -n '^\s*<name> = ' src/main.js`).
//
// The defaults are inert but type-honest: snapTime is the identity, not a no-op
// returning undefined, and editorPromptText resolves to null (a cancelled
// prompt). A module imported under node with no host wired must degrade, never
// crash — that is how the unit tests exercise it.
// ════════════════════════════════════════════════════════════════════

export const host = {
    /** Schedule a canvas repaint. Reassigned in main.js — always wire a thunk. */
    draw: () => {},
    /** Paint the waveform band. Called from inside the drum editor's frame. */
    drawWaveform: () => {},
    /** Refresh the status/transport readouts. */
    updateStatus: () => {},
    /** Rebuild the arrangement <select> after a structural edit. */
    updateArrangementSelector: () => {},
    /** Dismiss the canvas context menu. */
    hideContextMenu: () => {},
    /** Snap a time to the active grid (or the nearest onset). Identity default. */
    snapTime: (t) => t,
    /** Modal text prompt; resolves to null when cancelled. */
    editorPromptText: async () => null,
    /**
     * Undo/redo arrangement guard: switch to the arrangement a command was
     * executed against, or refuse when it is gone. `true` means "proceed".
     */
    ensureArr: () => true,
};

export function setHostHooks(hooks) { Object.assign(host, hooks); }
