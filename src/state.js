/* Slopsmith Arrangement Editor — canonical edit state.
 *
 * The single mutable state object every module reads and writes (constitution
 * §I). `S` is never reassigned — only its properties are — so importing the
 * binding read-only is exactly right.
 */

export const S = {
    // Song data
    title: '', artist: '', sessionId: null, filename: '',
    format: 'sloppak',
    arrangements: [],
    currentArr: 0,
    beats: [], sections: [], duration: 0, offset: 0,
    // Cumulative UI-applied audio offset (the toolbar "Offset" nudge), kept
    // separate from the pack's `offset`. _effectiveAudioOffset() adds it so a
    // mid-session +Keys/+Drums import lands in phase with a chart the user has
    // already realigned. TempoOffsetCmd is the only writer (so undo restores it);
    // _resetOffsetUI clears it on load. Never written to the pack.
    appliedOffset: 0,
    // Audio placement shift (seconds): slides the RECORDING in time while the
    // chart/grid/notes stay fixed — the inverse of the chart-side `offset`
    // above, and non-destructive (the samples are never stretched). At playhead
    // chart-time T the audio plays buffer-time (T - audioShift); the waveform
    // and onset strip render shifted to match. One value for the whole audio
    // group (stems, when added, ride it together). AudioShiftCmd is the writer;
    // persisted to the pack as `audio_shift` so a Replace-Audio realignment
    // survives reload.
    audioShift: 0,
    // Selected tone-change marker — stored as a direct ref into the
    // active arrangement's `arr.tones.changes` array (not an index)
    // so commands that sort/splice that array don't invalidate the
    // selection. `null` means no marker is selected — Del key falls
    // through to the note delete path.
    toneSel: null,
    // Selected anchor marker — direct ref into the active
    // arrangement's `arr.anchors_user` array. Same semantics as
    // `toneSel`. `null` means no anchor is selected.
    anchorSel: null,
    // Selected handshape — direct ref into the active arrangement's
    // `arr.handshapes` array. Same semantics as `anchorSel`. `null` = none.
    handshapeSel: null,

    // Drum tab — null until the user adds drums via the +Drums modal, then
    // a dict matching docs/sloppak-spec.md §5.3 ({version,name,kit,hits}).
    // Persisted via _buildSaveBody as the `drum_tab` field on the save body.
    drumTab: null,
    // True once the user imports or edits the drum tab this session.
    // _buildSaveBody only ships `drum_tab` when this is set, so a tab
    // merely loaded from disk doesn't get re-persisted on every save.
    drumTabDirty: false,
    // Drum editor mode — when true, the editor canvas swaps to a piece-lane
    // grid view of S.drumTab.hits[]. drumSel is the set of selected hit
    // indices. Both reset whenever the user loads a different sloppak.
    drumEditMode: false,
    // Parts view: stacked all-parts overview (navigational; mutually
    // exclusive with drumEditMode / tempoMapMode like they are with
    // each other).
    partsViewMode: false,
    drumSel: new Set(),

    // Per-part mix state (mixer panel, B6) — 'arr:<idx>' / 'drums' →
    // { vol, mute, solo }. Session-scoped UI state (never the pack): the
    // canonical source for part mute/solo/volume that the mixer strips,
    // the guide-clap gate (via host.partClapState) and the future
    // Parts-gutter M/S/A all read. Reset when a song is installed.
    partMix: {},

    // Tempo Map mode — EOF-style: drag the song-wide beat grid's measure
    // downbeats ("sync points") to fit it to the audio; BPM is derived
    // from sync-point spacing. tempoSel/tempoHover index into S.beats. Under
    // beat-primary a grid edit reprojects EVERY part from its beat, so there
    // is no "which parts ride" choice to make. Mode resets on song load.
    tempoMapMode: false,
    tempoSel: -1,
    tempoHover: -1,
    // Multi-selected barlines (PR 5a) — a Set of downbeat indices into S.beats,
    // the S.drumSel pattern. SEPARATE from tempoSel (the single focus that
    // inspector/tap/lock/modulate/suggest key on): Shift+click a range, marquee
    // on empty grid, or Ctrl+A add here. Index-based, so it is CLEARED (never
    // remapped) on any topology change (TempoGridCmd) and on mode exit.
    tempoSelMulti: new Set(),

    // View
    scrollX: 0,   // seconds
    zoom: 120,     // px per second
    snapIdx: 3,    // default 1/4 (index 3 after the 1/3T insert)
    snapEnabled: true,
    // Snap target: 'grid' = tempo-map subdivisions; 'onset' = nearest detected
    // audio transient within ONSET_SNAP_TOL (falls back to grid when none near).
    // UI pref only (persisted to localStorage), never written to the pack.
    snapMode: 'grid',
    // Swing percentage for grid snap (D2): 50 = straight; >50 displaces the
    // off subdivision of each pair (54/58/62 presets). Beat-domain — fed
    // through the tempo-map converter, so a swung note survives a flex.
    // UI pref only (persisted to localStorage), never written to the pack.
    swingPct: 50,

    // Selection
    sel: new Set(),

    // Bar-range selection for the "Loop in 3D" handoff. Drag on the bottom
    // beat bar (measure strip) to set { startTime, endTime } in seconds,
    // snapped to downbeat boundaries. `null` = no bar range selected.
    barSel: null,
    loopEnabled: false,
    // Live Tab view (view-modality): an orthogonal lens flag like
    // partsViewMode — mode toggles clear it, the draw pass enforces it.
    tabViewMode: false,
    // Which staves the score view engraves: 'tab' | 'notation' | 'both'.
    tabViewStaff: 'tab',
    // True when this editor session was opened from the 3D highway's
    // "Edit region" action. Used to make the preview button read as a
    // return trip instead of a fresh action.
    returnToHighway: false,
    // Drag state
    drag: null, // { type, startX, startY, startTime, startString, noteIdx, origTimes, origStrings }

    // Keyboard note-entry caret: which string lane a typed fret places onto when
    // nothing is selected (String view only). ↑/↓ move it; a fret digit places a
    // note at (caretString, snapped cursorTime). Drawn as a caret cell in that
    // state so it reads as an entry position.
    caretString: 0,
    // The fret the caret cell ghosts (the last one placed) — what a typed digit
    // will carry until you type a different one.
    caretFret: 0,

    // Playback
    playing: false,
    cursorTime: 0,
    audioCtx: null, audioBuffer: null, audioSource: null,
    playStartWall: 0, playStartTime: 0,
    // Audition speed (playback-only, editor pref — never pack data) and the
    // output-latency-compensated PAINT playhead (drawCursor only; every logic
    // path reads cursorTime).
    audioUrl: null, auditionRate: 1, cursorDrawTime: 0,

    // Waveform cache
    waveformPeaks: null,

    // History
    history: null,
    // True when the current job contains work not durably saved. This is
    // explicit because MIDI takes and imports are not all history commands.
    sessionDirty: false,

    // Songs list cache
    songsList: null,
};

// ── Shared edit generation ──────────────────────────────────────────
// Bumped once per committed edit by `EditHistory._afterEdit()`. Three memos key
// on it — the section-coverage strip (draw.js), the chord-at-cursor readout and
// the drum-limb lint (both main.js) — because an in-place note-time move keeps
// the notes array's identity AND length, so a cheap cache key cannot see it.
//
// A counter cannot be written across a module boundary (import bindings are
// read-only), so readers import the live `editGen` binding and the one writer
// calls `bumpEditGen()`.
export let editGen = 0;

export function bumpEditGen() {
    editGen++;
}

export function markSessionDirty() {
    if (S.sessionId) S.sessionDirty = true;
}

export function markSessionSaved() {
    S.sessionDirty = false;
    S.drumTabDirty = false;
    for (const arr of S.arrangements || []) {
        if (!arr) continue;
        if (arr.tones && Object.prototype.hasOwnProperty.call(arr.tones, '_editCount')) {
            arr.tones._editCount = 0;
        }
        if (Object.prototype.hasOwnProperty.call(arr, '_anchorEditCount')) arr._anchorEditCount = 0;
        if (Object.prototype.hasOwnProperty.call(arr, '_handshapeEditCount')) arr._handshapeEditCount = 0;
    }
}

export function sessionIsDirty() {
    if (!S.sessionId) return false;
    if (S.sessionDirty || S.drumTabDirty) return true;
    return (S.arrangements || []).some((arr) => !!(arr
        && ((arr.tones && arr.tones._editCount > 0)
            || arr._anchorEditCount > 0
            || arr._handshapeEditCount > 0)));
}
