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
// — not the identifier. Before wiring a symbol here, check it is not reassigned:
//
//     grep -nE '^[[:space:]]*<name> = ' src/main.js
//
// (POSIX class, not `\s`: GNU grep accepts `\s` as an extension, BSD grep does
// not, and a silent zero-match here is exactly the wrong answer to get.)
//
// The defaults are inert but type-honest: snapTime is the identity, not a no-op
// returning undefined. A module imported under node with no host wired must
// degrade, never crash — that is how the unit tests exercise it.
//
// A symbol only belongs here if it genuinely cannot leave main.js. When one can,
// move it and delete the hook: `editorPromptText` was here until the modal
// primitives found their home in src/ui.js.
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
    /**
     * Undo/redo arrangement guard: switch to the arrangement a command was
     * executed against, or refuse when it is gone. `true` means "proceed".
     */
    ensureArr: () => true,
    /** Flash the edit-confirmation blip at a canvas point. Purely cosmetic. */
    editBlipAt: () => {},
    /** Indices (into notes()) of the current selection, in stable order. */
    editorCurrentNoteIndices: () => [],
    /** Re-render the right-side note inspector from the current selection. */
    renderInspector: () => {},
    /** Re-derive lane metrics after a string was added/removed, on the next frame. */
    resizeForLaneChange: () => {},
    /** Ambiguous-pitch popover: let the user pick a string/fret for a roll add. */
    rollConfirmPosition: () => {},

    // ── Transport, loop strip and toolbar, for src/tempo.js ──────────
    /** Canvas coordinates of a mouse event, in CSS pixels. */
    getMousePos: () => ({ x: 0, y: 0 }),
    /** True while a MIDI/audio take is being recorded — tempo edits stay out. */
    isRecording: () => false,
    /** Dismiss the Add Note dialog. */
    hideAddNote: () => {},
    startPlayback: () => {},
    stopPlayback: () => {},
    /** Toolbar readouts for the current BPM and time signature. */
    updateBPMDisplay: () => {},
    updateTempoSigDisplay: () => {},
    /** Re-render the A/B loop strip after the beat grid moved under it. */
    renderLoopStrip: () => {},
    updateLoopIn3DBtn: () => {},
    /** Lift the loop region onto beat coordinates before the grid changes… */
    loopReliftBeats: () => {},
    /** …and project it back to seconds afterwards. */
    loopReprojectFromBeats: () => {},
    /** The 🥁 button's visibility depends on which mode is active. */
    refreshDrumEditButton: () => {},
    /**
     * The 🎵 Tempo Map button. Lives in src/tempo.js, and src/drum.js needs it
     * when leaving drum mode — but tempo.js already imports drum.js, so a direct
     * import would close a cycle. It crosses here instead.
     */
    refreshTempoMapButton: () => {},
    /** The Parts-view toggle, whose enabled state tracks the active mode. */
    refreshPartsViewButton: () => {},

    // ── The load/audio pipeline, for src/create.js ───────────────────
    /** Open a pack into the editor (fetch, parse, seed S, redraw). */
    loadCDLC: () => {},
    /** Decode an audio URL into the playback graph and the waveform peaks. */
    loadAudio: () => {},
    /** Ask the host app to re-scan the song library after a build. */
    kickLibraryRescan: () => {},
    /** Clear the audio-offset input and its applied-delta dataset. */
    resetOffsetUI: () => {},
    /** Toolbar transport readout. */
    updateTimeDisplay: () => {},
    /**
     * Register a listener on the teardown-tracked global registry, so a
     * re-injected editor screen doesn't leak it.
     */
    addGlobalListener: () => {},
    /**
     * Commit or clear whatever canvas drag is in flight before a mode switch.
     * It dispatches across tempo, drum, handshape and pan drags, so it belongs
     * to none of them and stays in main.js.
     */
    finalizeActiveDrag: () => {},

    // ── Dialogs and canvas geometry, for src/inspector.js ────────────
    /** Open the bend-curve editor for a note. Async: resolves when it closes. */
    promptBend: async () => {},
    /** Re-measure the canvas on the next frame (a lane count changed). */
    scheduleCanvasResize: () => {},
};

export function setHostHooks(hooks) { Object.assign(host, hooks); }
