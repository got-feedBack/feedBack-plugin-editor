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
    /** Paint the shared minimap and ruler header. */
    drawTimelineHeader: () => {},
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
    /** The session audio offset an import should shift its notes by (seconds). */
    effectiveAudioOffset: () => 0,
    /** After a load, apply any pending view/part selection stashed for the song. */
    applyEditorPendingView: () => {},
    /** Open the add-note dialog (a double-click on empty grid). */
    showAddNote: () => {},
    /** Refresh the zoom-level readout after a wheel zoom. */
    updateZoomDisplay: () => {},
    /** Parts-view mousedown / dblclick routing (parts view lives in main.js). */
    partsViewOnMouseDown: () => {},
    partsViewOnDblClick: () => {},
    /** Arm a transcription target (arrangement / drums) from the Tracks area. */
    selectTrackSessionTarget: () => {},
    /** Focus an audio source as the active waveform/onset reference. */
    selectTrackSessionSource: () => {},
    /** Leave the Tracks overview and open a transcription's native editor. */
    openTrackSessionTarget: () => {},
    /** Vertically scroll the shared track-header/canvas lane stack. */
    scrollTrackArea: () => false,
    /** Cached waveform for one audio source's lane ({peaks, duration} or null). */
    trackWaveform: () => null,
    /** View-mode / part-move / key-highlight / parts-view toggles (main.js). */
    editorCycleViewMode: () => {},
    editorMovePart: () => {},
    editorToggleKeyHighlight: () => {},
    editorTogglePartsView: () => {},
    /** Resolve the measure index at the current selection (tempo layer, main.js).
     *  -1 = none resolved, so the default is inert (callers apply only on >= 0). */
    tempoResolvedMeasureIdx: () => -1,
    /** Recompute the canvas size / lane metrics after a view-mode reflow (main.js). */
    resizeCanvas: () => {},
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
    /** Save the current editor job; resolves true only after durable success. */
    saveSession: async () => false,
    /** Finalize an active MIDI take before a destructive transition. */
    finalizeRecording: () => {},
    /** Abort an audio decode/fetch that belongs to the outgoing job. */
    cancelAudioLoad: () => {},
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
     * Show/hide + relight the drum-pad strip on a mode flip. Lives in
     * src/drum-pad-strip.js; src/drum.js flips the mode but already imports
     * the strip's command surface the other way — it crosses here.
     */
    refreshDrumPadStrip: () => {},
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
    /** Install create-time audio/transcription rows in a DAW track session. */
    installCreatedTrackSession: () => {},
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

    // ── Seek and snap, for src/loop.js ────────────────────────────────
    /** Move the cursor/transport to a chart time. */
    editorSeekToTime: () => {},
    /** The current snap step in seconds. */
    editorSnapStepSeconds: () => 0,
    /** Whether the note-entry preview cell should be drawn (a view pref). */
    editorEntryPreviewEnabled: () => true,

    // ── Rendering and scroll, for src/audio.js ────────────────────────
    /** Force an immediate synchronous repaint (draw() is rAF-coalesced). */
    drawNow: () => {},
    /** Clamp a scrollX to the song bounds. */
    editorClampScrollX: (x) => x,
    /** Re-apply scroll bounds after the viewport or duration changed. */
    editorApplyScrollBounds: () => {},
    /** The A/B loop region currently selected, or null. */
    selectedLoopRegion: () => null,
    /** Enable/disable looping over the selected region. */
    setLoopRegionEnabled: () => {},

    // ── Dialogs and canvas geometry, for src/inspector.js ────────────
    /** Open the bend-curve editor for a note. Async: resolves when it closes. */
    promptBend: async () => {},
    /** Re-measure the canvas on the next frame (a lane count changed). */
    scheduleCanvasResize: () => {},

    // ── Mixer panel (B6), crossing both ways ──────────────────────────
    /**
     * Per-part gate for the guide claps, consulted by src/audio.js when it
     * schedules voices. Lives in src/mixer-panel.js (the canonical
     * `S.partMix` owner); audio.js must not import that module, so it
     * crosses here. Inert default: audible at unity — exactly the
     * pre-panel behavior. Part solo NEVER gates the reference recording
     * (D5), which rides its own transparent gain path.
     */
    partClapState: () => ({ audible: true, vol: 1 }),
    /**
     * Bus-fader percents + edit-blip flag for seeding the panel's controls.
     * Owned by src/audio.js (the `editorMix*` prefs); the panel reads them
     * through here so it stays audio-import-free.
     */
    mixUiState: () => ({ pcts: { ref: 100, guide: 35, click: 25, master: 100 }, blip: true }),
    /** Live post-fader meter levels + peak dB per bus and stem track. */
    mixerMeterLevels: () => ({ ref: 0, guide: 0, click: 0, master: 0, tracks: {}, peaks: {}, trackPeaks: {} }),
    /** Mixer strip keys in Tracks-column row order (mixer follows a reorder). */
    mixerTrackOrder: () => [],
    /**
     * Per-part strip state BY KEY ('arr:<idx>', the drums arrangement included)
     * for band-mode MIDI playback: {audible, vol 0..1} with the whole-map solo rule.
     * Owned by src/mixer-panel.js; inert default = every part at unity.
     */
    partStripState: () => ({ audible: true, vol: 1 }),
    /**
     * A Tracks strip changed (band mode ramps its per-part gain live), or
     * the play-all mode itself toggled — panel/engine cross-notify without
     * an import cycle. Inert defaults for bare-host unit tests.
     */
    partMixChanged: () => {},
    /** The visible audio-source roster changed (remove/restore/import/rename). */
    audioSourcesChanged: () => {},
    stripUiChanged: () => {},
    /** The persisted band-mode pref, read by the panel's header toggle. */
    playAllTracksEnabled: () => false,
};

export function setHostHooks(hooks) { Object.assign(host, hooks); }
