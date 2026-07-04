/* Slopsmith Arrangement Editor — DAW-style timeline note editor */

(function () {
'use strict';

// ════════════════════════════════════════════════════════════════════
// Constants
// ════════════════════════════════════════════════════════════════════

// Highway colours, keyed by pitch *label* (the same labels `laneLabels()`
// emits) so colours stay locked to a string's note regardless of the
// arrangement's string count. A 4-string bass G/D/A/E gets
// orange/blue/yellow/red just like the same pitches on a 6-string
// guitar. Extended-range strings (7/8-guitar's low B/F#, 6-bass's high C)
// reuse the dusty-pink/steel-blue accents.
const STRING_LABEL_COLORS = {
    'E':  '#FC3A51', // low E   — red
    'A':  '#FFC600', // A       — yellow
    'D':  '#3FAAFF', // D       — blue
    'G':  '#FF8A00', // G       — orange
    'B':  '#58D263', // B       — green (guitar string 4)
    'e':  '#C473FF', // high e  — purple
    'B↓': '#E07A8A', // 7-string low B          — dusty pink
    'C↑': '#E07A8A', // 6-string bass high C    — dusty pink
    'F#↓': '#8AA0B8',// 8-string low F#         — steel blue
};

// Cached per-frame alongside `lanes()` to avoid re-allocating
// `laneLabels()` per note inside drawNotes / drawLabels.
let _laneLabelsCacheValue = null;
function colorForLane(l) {
    // `laneLabels()` is low → high (string-index order); strToLane
    // converts string index → lane. During draw() the cache is hot
    // (set once per frame), so per-note colorForLane reads a single
    // index rather than re-running the label computation.
    const labels = _lanesCacheActive && _laneLabelsCacheValue
        ? _laneLabelsCacheValue
        : laneLabels();
    const lbl = labels[laneToStr(l)];
    return STRING_LABEL_COLORS[lbl] || '#888';
}

let WAVEFORM_H = 70;
let LANE_H = 44;
const MAX_LANES = 8;
let BEAT_H = 24;
const LABEL_W = 52;
const MIN_NOTE_W = 18;
const NOTE_PAD = 3;
/* @pure:snap-options:start */
const SNAP_OPTIONS = Object.freeze([
    { label: '1/1', value: 1, subdivisions: 1 },
    { label: '1/2', value: 1 / 2, subdivisions: 2 },
    { label: '1/4', value: 1 / 4, subdivisions: 4 },
    { label: '1/8', value: 1 / 8, subdivisions: 8 },
    { label: '1/12', value: 1 / 12, subdivisions: 12 },
    { label: '1/16', value: 1 / 16, subdivisions: 16 },
    { label: '1/24', value: 1 / 24, subdivisions: 24 },
    { label: '1/32', value: 1 / 32, subdivisions: 32 },
    { label: '1/48', value: 1 / 48, subdivisions: 48 },
    { label: '1/64', value: 1 / 64, subdivisions: 64 },
    { label: '1/96', value: 1 / 96, subdivisions: 96 },
]);
const SNAP_VALUES = SNAP_OPTIONS.map(opt => opt.value);

function _editorSnapOptionLabelsPure() {
    return SNAP_OPTIONS.map(opt => opt.label);
}

function _editorSnapSubdivisionsPure(snapValue) {
    if (!snapValue) return 0;
    return Math.max(1, Math.round(1 / snapValue));
}

function _editorEffectiveSnapValuePure(snapEnabled, snapValue) {
    return snapEnabled ? snapValue : 0;
}
/* @pure:snap-options:end */
const DPR = window.devicePixelRatio || 1;

// ── Piano roll constants ────────────────────────────────────────────
const PIANO_NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const PIANO_OCTAVE_COLORS = [
    '#ff4466', '#ff8844', '#ffcc33', '#66dd55', '#44ccaa',
    '#44aaff', '#7766ff', '#cc55ff', '#ff55aa', '#aaaaaa',
];
let PIANO_LANE_H = 10;  // pixels per MIDI semitone
let pianoRange = { lo: 36, hi: 96 }; // MIDI range, updated per arrangement
// Names that should open in keys (piano-roll) editor mode. Arrangements
// named "Piano", "Keyboard", or "Synth" render as piano-roll charts rather
// than 6-string guitar charts.
const KEYS_PATTERN = /^(keys|piano|keyboard|synth)/i;

// ════════════════════════════════════════════════════════════════════
// State
// ════════════════════════════════════════════════════════════════════

// ─── Tone-lane constants (PR3c) ────────────────────────────────────
// Hoisted to module scope so the values are initialised before any
// callsite — `draw()` calls `drawToneLane()` which reads them, and
// async callbacks could in theory fire before the bottom of the
// IIFE if any of them got scheduled during init().
const TONE_LANE_H = 16;
const _TONE_SLOT_DEFAULTS = ['Clean', 'Drive', 'Lead', 'Crunch', 'Effect'];
const _TONE_SLOT_COLORS = ['#7dd3fc', '#f87171', '#fbbf24', '#a78bfa', '#34d399'];

// ─── Anchor-lane constants (PR3d) ──────────────────────────────────
// Anchor lane lives below the beat bar so its time axis stays
// aligned with notes and tones. 18px gives enough room for a fret
// label plus a width-strip visualization.
const ANCHOR_LANE_H = 18;
const HS_LANE_H = 20;   // E2: handshape (chord-shape / arpeggio) span lane

const S = {
    // Song data
    title: '', artist: '', sessionId: null, filename: '',
    format: 'sloppak',
    arrangements: [],
    currentArr: 0,
    beats: [], sections: [], duration: 0, offset: 0,
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
    drumSel: new Set(),

    // Tempo Map mode — EOF-style: drag the song-wide beat grid's measure
    // downbeats ("sync points") to fit it to the audio; BPM is derived
    // from sync-point spacing. tempoSel/tempoHover index into S.beats.
    // tempoRideScope decides which notes re-time when the grid moves:
    // 'drum' (only drum_tab hits) or 'all' (every arrangement). Hydrated
    // from localStorage on init. Mode resets on song load.
    tempoMapMode: false,
    tempoSel: -1,
    tempoHover: -1,
    tempoRideScope: 'drum',

    // View
    scrollX: 0,   // seconds
    zoom: 120,     // px per second
    snapIdx: 2,    // default 1/4
    snapEnabled: true,

    // Selection
    sel: new Set(),

    // Bar-range selection for the "Loop in 3D" handoff. Drag on the bottom
    // beat bar (measure strip) to set { startTime, endTime } in seconds,
    // snapped to downbeat boundaries. `null` = no bar range selected.
    barSel: null,
    // True when this editor session was opened from the 3D highway's
    // "Edit region" action. Used to make the preview button read as a
    // return trip instead of a fresh action.
    returnToHighway: false,
    // Drag state
    drag: null, // { type, startX, startY, startTime, startString, noteIdx, origTimes, origStrings }

    // Playback
    playing: false,
    cursorTime: 0,
    audioCtx: null, audioBuffer: null, audioSource: null,
    playStartWall: 0, playStartTime: 0,

    // Waveform cache
    waveformPeaks: null,

    // History
    history: null,

    // Songs list cache
    songsList: null,

    // Clipboard
    clipboard: null, // { notes: [...], baseTime }
};

let canvas, ctx;
let rafId = null;

// ════════════════════════════════════════════════════════════════════
// Coordinate mapping
// ════════════════════════════════════════════════════════════════════

function isBassArr() {
    if (!S.arrangements.length) return false;
    const arr = S.arrangements[S.currentArr];
    return !!arr && /bass/i.test(arr.name || '');
}

// Active arrangement string count. Mirrors lib/song.py:arrangement_string_count
// so the editor agrees with the highway: combine name-based default (Bass→4,
// else→6), tuning length when ≠6 (length 6 is RS-schema padding), an
// explicit `_extendedStrings` counter that AddStringCmd / RemoveStringCmd
// bump (disambiguates the bass-with-tuning-length-6 case — could be
// either a 4-string padded or a genuine 6-string), chord-template width,
// and the max note-string index. Clamped to [4, MAX_LANES].
//
// `lanes()` is O(N) over notes+chords and is on the hot path (strToLane /
// laneToStr / yToStr are called per-note inside drawNotes and per-mousemove
// in hit-testing). To avoid the resulting O(N²) per frame on large
// arrangements, draw() seeds a per-frame cache that this function reads
// from when active. Mutations outside the draw frame still recompute.
let _lanesCacheActive = false;
let _lanesCacheValue = 6;
// Seed `_extendedStrings` from each arrangement's tuning length. Two
// modes:
//   * Always seed when `tuningLen > 6` — RS-XML never pads past 6, so
//     any length above that is an unambiguous extended-range signal
//     (string6+ attrs were emitted). Applies to all sources including
//     a previously-extended archive reloaded in this session.
//   * When `authoritativeLength` is true (sloppak / GP-imported create-
//     mode), also seed when `tuningLen > baseline` even if ≤ 6 —
//     those sources don't apply RS padding, so a 6-slot bass tuning
//     genuinely means 6-string bass. Skipping this path for archive
//     loads preserves the standard bass-padded-to-6 → 4 inference.
function _seedExtendedStringsFromTuning(arrangements, authoritativeLength) {
    for (const arr of arrangements || []) {
        if (typeof arr._extendedStrings === 'number') continue;  // already set
        const isBass = /bass/i.test(arr.name || '');
        const baseline = isBass ? 4 : 6;
        const tuningLen = Array.isArray(arr.tuning) ? arr.tuning.length : baseline;
        if (tuningLen > 6) {
            arr._extendedStrings = tuningLen - baseline;
        } else if (authoritativeLength && tuningLen > baseline
                   && !(isBass && tuningLen === 6)) {
            // A length-EXACTLY-6 bass tuning is ambiguous — RS-converted
            // sloppaks pad a 4-string bass to 6 zero-slots, identical on the
            // wire to a genuine 6-string bass. Never infer 6-string from it
            // (matches core arrangement_string_count, which ignores len==6);
            // let the actual note/chord string indices decide. Without this a
            // padded 4-string bass feedpak is read as 6-string, so every note
            // shifts up a lane and low-E renders on the low-B lane.
            arr._extendedStrings = tuningLen - baseline;
        }
    }
}

function _stringCountFor(arr) {
    if (!arr) return 6;
    const isBass = /bass/i.test(arr.name || '');
    const baseline = isBass ? 4 : 6;
    // User-added strings via the Strings modal — authoritative even
    // when tuning happens to be ambiguous length 6 (the standard RS-XML
    // bass padding length).
    let n = baseline + Math.max(0, arr._extendedStrings || 0);
    const tuningLen = Array.isArray(arr.tuning) ? arr.tuning.length : 6;
    if (tuningLen !== 6) n = Math.max(n, tuningLen);
    // Chord-template signal: count the highest *used* fret slot (not
    // the raw array length). RS XML pads chord_templates to width 6
    // unconditionally, so a 4-string bass arrangement also has
    // ct.frets.length === 6 with fret[4..5] === -1. Looking at the
    // last non(-1) index instead means a 4-string bass with no notes
    // on string 4/5 reads as 4 (correct), and a real 6/7-string
    // template that played notes on those high strings still bumps
    // `n` up.
    for (const ct of arr.chord_templates || []) {
        if (Array.isArray(ct.frets)) {
            for (let i = ct.frets.length - 1; i >= 0; i--) {
                if (ct.frets[i] !== -1) {
                    if (i + 1 > n) n = i + 1;
                    break;
                }
            }
        }
    }
    for (const note of arr.notes || []) {
        if (note.string + 1 > n) n = note.string + 1;
    }
    for (const ch of arr.chords || []) {
        for (const cn of ch.notes || []) {
            if (cn.string + 1 > n) n = cn.string + 1;
        }
    }
    return Math.max(4, Math.min(MAX_LANES, n));
}
function lanes() {
    if (_lanesCacheActive) return _lanesCacheValue;
    if (!S.arrangements.length) return 6;
    return _stringCountFor(S.arrangements[S.currentArr]);
}
// Build display labels in RS string-index order (low → high). Extended-range
// instruments add strings at the low end (7-string guitar adds low B below
// low E; 5-string bass adds low B below low E), and 6-string bass adds high
// C on top. The arrow notation marks those non-standard strings.
function laneLabels() {
    const L = lanes();
    if (isBassArr()) {
        // 4-string standard: E A D G
        // 5-string: B↓ E A D G  (low B added)
        // 6-string: B↓ E A D G C (low B + high C added)
        if (L <= 4) return ['E', 'A', 'D', 'G'].slice(0, L);
        if (L === 5) return ['B↓', 'E', 'A', 'D', 'G'];
        return ['B↓', 'E', 'A', 'D', 'G', 'C↑'].slice(0, L);
    }
    // Guitar standard: E A D G B e (low → high)
    // 7-string: B↓ E A D G B e  (low B added)
    // 8-string: F#↓ B↓ E A D G B e (low F# and low B added)
    if (L <= 6) return ['E', 'A', 'D', 'G', 'B', 'e'].slice(0, L);
    if (L === 7) return ['B↓', 'E', 'A', 'D', 'G', 'B', 'e'];
    return ['F#↓', 'B↓', 'E', 'A', 'D', 'G', 'B', 'e'].slice(0, L);
}

function timeToX(t)  { return LABEL_W + (t - S.scrollX) * S.zoom; }
function xToTime(x)  { return (x - LABEL_W) / S.zoom + S.scrollX; }

const EDITOR_SCROLL_TAIL_SECONDS = 2;

/* @pure:scroll-bounds:start */
function _editorViewportDurationPure(canvasWidthPx, labelWidthPx, zoomPxPerSecond) {
    const w = Number(canvasWidthPx);
    const label = Number(labelWidthPx);
    const zoom = Number(zoomPxPerSecond);
    if (!Number.isFinite(w) || !Number.isFinite(label) || !Number.isFinite(zoom) || zoom <= 0) return 0;
    return Math.max(0, (w - label) / zoom);
}

function _editorMaxScrollXPure(durationSeconds, viewportDurationSeconds, tailSeconds) {
    const duration = Number(durationSeconds);
    const view = Number(viewportDurationSeconds);
    const tail = Number(tailSeconds);
    if (!Number.isFinite(duration) || duration <= 0) return 0;
    const v = Math.max(0, Number.isFinite(view) ? view : 0);
    // The song already fits on screen → pin to the start (no scroll, no tail).
    // The tail only extends the range once the content itself runs past the
    // viewport, so a short/zoomed-out song can't hide its beginning.
    if (duration <= v) return 0;
    return Math.max(0, duration + Math.max(0, Number.isFinite(tail) ? tail : 0) - v);
}

function _editorClampScrollXPure(scrollX, durationSeconds, viewportDurationSeconds, tailSeconds) {
    const raw = Number(scrollX);
    const safe = Number.isFinite(raw) ? raw : 0;
    return Math.max(0, Math.min(safe, _editorMaxScrollXPure(durationSeconds, viewportDurationSeconds, tailSeconds)));
}
/* @pure:scroll-bounds:end */

function _editorViewportDuration() {
    const w = canvas ? canvas.width / DPR : 800;
    return _editorViewportDurationPure(w, LABEL_W, S.zoom);
}

function _editorClampScrollX(scrollX) {
    return _editorClampScrollXPure(scrollX, S.duration, _editorViewportDuration(), EDITOR_SCROLL_TAIL_SECONDS);
}

function _editorApplyScrollBounds() {
    S.scrollX = _editorClampScrollX(S.scrollX);
    return S.scrollX;
}
// ── Bar selection (Loop-in-3D handoff) ──────────────────────────────
/* @pure:loop-region:start */
function _barSpanForTimesPure(downbeats, duration, t0, t1) {
    if (!Array.isArray(downbeats) || !downbeats.length) return null;
    const lo = Math.min(t0, t1);
    const hi = Math.max(t0, t1);
    let start = downbeats[0];
    for (const t of downbeats) {
        if (t <= lo + 1e-6) start = t;
        else break;
    }
    let end = null;
    for (const t of downbeats) {
        if (t > hi + 1e-6) {
            end = t;
            break;
        }
    }
    if (end === null) end = Math.max(duration || hi, hi);
    return end > start ? { startTime: start, endTime: end } : null;
}

function _adjustBarSelEdgePure(region, edge, rawTime, downbeats, duration) {
    if (!region || !Array.isArray(downbeats) || !downbeats.length) return region;
    if (edge === 'start') {
        let start = downbeats[0];
        for (const t of downbeats) {
            if (t <= rawTime + 1e-6) start = t;
            else break;
        }
        start = Math.min(start, region.endTime);
        if (start >= region.endTime - 1e-6) {
            const idx = downbeats.findIndex(t => Math.abs(t - region.endTime) <= 1e-6);
            if (idx > 0) start = downbeats[idx - 1];
            else start = Math.min(start, region.startTime);
        }
        return region.endTime > start ? { startTime: start, endTime: region.endTime } : region;
    }
    if (edge === 'end') {
        let end = null;
        for (const t of downbeats) {
            if (t > rawTime + 1e-6) {
                end = t;
                break;
            }
        }
        if (end === null) end = Math.max(duration || rawTime, rawTime);
        end = Math.max(end, region.startTime);
        if (end <= region.startTime + 1e-6) {
            const idx = downbeats.findIndex(t => Math.abs(t - region.startTime) <= 1e-6);
            if (idx >= 0 && idx < downbeats.length - 1) end = downbeats[idx + 1];
            else end = Math.max(duration || rawTime, rawTime);
        }
        return end > region.startTime ? { startTime: region.startTime, endTime: end } : region;
    }
    return region;
}
/* @pure:loop-region:end */

// Downbeat times in ascending order, from the song-wide beat grid.
function _downbeatTimes() {
    return S.beats.filter(b => b.measure > 0).map(b => b.time).sort((a, b) => a - b);
}
// Snap a pair of raw times to a whole-bar span: start = the downbeat at or
// before the earlier time, end = the downbeat strictly after the later time
// (falling back to the song end). Returns null when the chart has no
// downbeats (so the beat bar can't define bars).
function _barSpanForTimes(t0, t1) {
    return _barSpanForTimesPure(_downbeatTimes(), S.duration || Math.max(t0, t1), t0, t1);
}
function laneToY(l)  { return WAVEFORM_H + l * LANE_H; }
function yToLane(y)  { return Math.floor((y - WAVEFORM_H) / LANE_H); }
function strToLane(s) { return (lanes() - 1) - s; }
function laneToStr(l) { return (lanes() - 1) - l; }
function strToY(s)   { return laneToY(strToLane(s)); }
function yToStr(y)   { const l = Math.max(0, Math.min(lanes() - 1, yToLane(y))); return laneToStr(l); }
function canvasH()   {
    return _beatBarTopY() + BEAT_H;
}

// ── Piano roll mode helpers ─────────────────────────────────────────

function _loopStripTrackBounds() {
    const track = document.getElementById('editor-loop-strip-track');
    if (!track) return null;
    const r = track.getBoundingClientRect();
    return { left: r.left, width: Math.max(1, r.width) };
}

function _loopStripTimeFromClientX(clientX) {
    const b = _loopStripTrackBounds();
    if (!b || !canvas) return 0;
    const ratio = Math.max(0, Math.min(1, (clientX - b.left) / b.width));
    const viewDur = Math.max(0, ((canvas.width / DPR) - LABEL_W) / S.zoom);
    return S.scrollX + ratio * viewDur;
}

function _fmtLoopTime(t) {
    const total = Math.max(0, t || 0);
    const m = Math.floor(total / 60);
    const s = Math.floor(total % 60);
    const ms = Math.floor((total - Math.floor(total)) * 10);
    return m + ':' + String(s).padStart(2, '0') + '.' + ms;
}

function _regionMeasureLabel(region) {
    const starts = _downbeatTimes();
    if (!region || !starts.length) return _fmtLoopTime(region && region.startTime || 0);
    let startMeasure = 1;
    let endMeasure = startMeasure;
    for (let i = 0; i < starts.length; i++) {
        if (starts[i] <= region.startTime + 1e-6) startMeasure = i + 1;
        if (starts[i] < region.endTime - 1e-6) endMeasure = i + 1;
    }
    return 'Bars ' + startMeasure + '–' + endMeasure;
}

function _renderLoopStrip() {
    const root = document.getElementById('editor-loop-strip');
    const empty = document.getElementById('editor-loop-strip-empty');
    const sel = document.getElementById('editor-loop-strip-selection');
    const clear = document.getElementById('editor-loop-strip-clear');
    const label = document.getElementById('editor-loop-strip-label');
    if (!root || !empty || !sel || !clear || !label || !canvas) return;
    const beatsReady = _downbeatTimes().length > 0;
    root.classList.toggle('opacity-60', !beatsReady);
    empty.textContent = beatsReady ? 'Drag to set loop region' : 'No bar grid available';
    if (!S.barSel || !beatsReady) {
        sel.classList.add('hidden');
        clear.classList.add('hidden');
        empty.classList.remove('hidden');
        return;
    }
    empty.classList.add('hidden');
    sel.classList.remove('hidden');
    clear.classList.remove('hidden');
    const viewDur = Math.max(0, ((canvas.width / DPR) - LABEL_W) / S.zoom);
    const left = ((S.barSel.startTime - S.scrollX) / Math.max(0.0001, viewDur)) * 100;
    const right = ((S.barSel.endTime - S.scrollX) / Math.max(0.0001, viewDur)) * 100;
    const clampedLeft = Math.max(0, Math.min(100, left));
    const clampedRight = Math.max(0, Math.min(100, right));
    sel.style.left = clampedLeft + '%';
    sel.style.width = Math.max(0, clampedRight - clampedLeft) + '%';
    label.textContent = _regionMeasureLabel(S.barSel) + '  ' + _fmtLoopTime(S.barSel.startTime) + '–' + _fmtLoopTime(S.barSel.endTime);
}

function _clearBarSelection() {
    S.barSel = null;
    _updateLoopIn3DBtn();
    draw();
}

function _loopStripOnMouseDown(e) {
    if (!canvas || !S.beats.length) return;
    const track = document.getElementById('editor-loop-strip-track');
    if (!track || !track.contains(e.target)) return;
    if (e.target && e.target.id === 'editor-loop-strip-clear') return;
    const region = S.barSel;
    const rawTime = _loopStripTimeFromClientX(e.clientX);
    if (region) {
        if (e.target && e.target.id === 'editor-loop-strip-start') {
            S.drag = { type: 'loopstrip', mode: 'start' };
            e.preventDefault();
            return;
        }
        if (e.target && e.target.id === 'editor-loop-strip-end') {
            S.drag = { type: 'loopstrip', mode: 'end' };
            e.preventDefault();
            return;
        }
    }
    S.drag = { type: 'loopstrip', mode: 'create', startTime: rawTime };
    S.barSel = _barSpanForTimes(rawTime, rawTime);
    _updateLoopIn3DBtn();
    draw();
    e.preventDefault();
}

function _loopStripOnMouseMove(e) {
    if (!S.drag || S.drag.type !== 'loopstrip') return false;
    const rawTime = _loopStripTimeFromClientX(e.clientX);
    const downbeats = _downbeatTimes();
    if (S.drag.mode === 'create') {
        S.barSel = _barSpanForTimes(S.drag.startTime, rawTime);
    } else if (S.drag.mode === 'start' && S.barSel) {
        S.barSel = _adjustBarSelEdgePure(S.barSel, 'start', rawTime, downbeats, S.duration || rawTime);
    } else if (S.drag.mode === 'end' && S.barSel) {
        S.barSel = _adjustBarSelEdgePure(S.barSel, 'end', rawTime, downbeats, S.duration || rawTime);
    }
    _updateLoopIn3DBtn();
    draw();
    return true;
}

function _loopStripOnMouseUp() {
    if (!S.drag || S.drag.type !== 'loopstrip') return false;
    S.drag = null;
    _updateLoopIn3DBtn();
    draw();
    return true;
}
function isKeysMode() {
    if (!S.arrangements.length) return false;
    const arr = S.arrangements[S.currentArr];
    return arr && KEYS_PATTERN.test(arr.name || '');
}

function pianoLaneCount() { return pianoRange.hi - pianoRange.lo + 1; }

function midiToNote(midi) { return PIANO_NOTE_NAMES[midi % 12] + (Math.floor(midi / 12) - 1); }
function isBlackKey(midi) { const pc = midi % 12; return pc===1||pc===3||pc===6||pc===8||pc===10; }

function noteToMidi(string, fret) { return string * 24 + fret; }
function midiToString(midi) { return Math.floor(midi / 24); }
function midiToFret(midi) { return midi % 24; }

// Piano roll Y: higher MIDI = higher on screen (lower Y)
function midiToY(midi) { return WAVEFORM_H + (pianoRange.hi - midi) * PIANO_LANE_H; }
function yToMidi(y) {
    const m = pianoRange.hi - Math.floor((y - WAVEFORM_H) / PIANO_LANE_H);
    return Math.max(pianoRange.lo, Math.min(pianoRange.hi, m));
}

// expandOnly=true preserves any wider current range (used during in-place
// edits so adding a low note doesn't collapse the viewport and lose
// previously-clickable upper lanes). Load/import/arrangement-switch call
// without it so the viewport snaps cleanly to the new arrangement.
function updatePianoRange(expandOnly = false) {
    const nn = notes();
    // noteToMidi encodes up to string=5, fret=23 → max 143; match the drag-clamp ceiling.
    let lo = 143, hi = 0;
    for (const n of nn) {
        const m = noteToMidi(n.string, n.fret);
        if (m < lo) lo = m;
        if (m > hi) hi = m;
    }
    if (lo > hi) {
        // Empty arrangement: expose the full 88-key range so any starting
        // pitch is clickable. Lanes are deliberately thin (~4px) to keep the
        // viewport within ~352px — once a note is added the range snaps to
        // the actual note range and lanes return to normal height.
        pianoRange = { lo: 21, hi: 108, _fromEmpty: true };
        PIANO_LANE_H = 4;
        return;
    }
    // Expand to octave boundaries with padding; ceiling matches drag-clamp max of 143.
    let nlo = Math.max(0, Math.floor(lo / 12) * 12 - 6);
    let nhi = Math.min(143, Math.ceil((hi + 1) / 12) * 12 + 5);
    if (expandOnly && pianoRange && !pianoRange._fromEmpty) {
        nlo = Math.min(nlo, pianoRange.lo);
        nhi = Math.max(nhi, pianoRange.hi);
    }
    pianoRange = { lo: nlo, hi: nhi };
    // Adjust lane height to fill available space nicely. Allow down to 4px
    // so wide note ranges (many octaves) remain visible without overflowing
    // the canvas wrapper.
    PIANO_LANE_H = Math.max(4, Math.min(14, 350 / (nhi - nlo + 1)));
}

function snapTime(t) {
    const sv = _editorEffectiveSnapValuePure(S.snapEnabled, SNAP_VALUES[S.snapIdx]);
    if (!sv || S.beats.length < 2) return t;
    // Find surrounding beat
    let bi = 0;
    for (let i = 0; i < S.beats.length - 1; i++) {
        if (S.beats[i].time <= t) bi = i; else break;
    }
    const bt = S.beats[bi].time;
    const nt = bi < S.beats.length - 1 ? S.beats[bi + 1].time : bt + 0.5;
    const bd = nt - bt;
    const subs = _editorSnapSubdivisionsPure(sv);
    const sd = bd / subs;
    const idx = Math.round((t - bt) / sd);
    return bt + idx * sd;
}

// ════════════════════════════════════════════════════════════════════
// Note accessors
// ════════════════════════════════════════════════════════════════════

function notes() { return S.arrangements.length ? S.arrangements[S.currentArr].notes : []; }
function chords() { return S.arrangements.length ? S.arrangements[S.currentArr].chords : []; }

/* @pure:chord-resize:start */
function _resizeTargetIndicesPure(noteList, index, expandChord) {
    if (!Array.isArray(noteList) || index < 0 || index >= noteList.length) return [];
    if (!expandChord) return [index];
    const n = noteList[index];
    if (!n || typeof n.time !== 'number') return [index];
    const key = n.time.toFixed(4);
    const out = [];
    for (let i = 0; i < noteList.length; i++) {
        const other = noteList[i];
        if (other && typeof other.time === 'number' && other.time.toFixed(4) === key) {
            out.push(i);
        }
    }
    return out.length ? out : [index];
}

function _maxSustainBeforeCollisionPure(noteList, targetIndices) {
    if (!Array.isArray(noteList) || !Array.isArray(targetIndices) || !targetIndices.length) {
        return Infinity;
    }
    const targetSet = new Set(targetIndices);
    let limit = Infinity;
    for (const idx of targetIndices) {
        const n = noteList[idx];
        if (!n || typeof n.time !== 'number') continue;
        for (let i = 0; i < noteList.length; i++) {
            if (targetSet.has(i)) continue;
            const other = noteList[i];
            if (!other || other.string !== n.string || typeof other.time !== 'number') continue;
            if (other.time > n.time + 0.0001) {
                limit = Math.min(limit, other.time - n.time);
            }
        }
    }
    return limit;
}

function _resizeSustainsForDeltaPure(noteList, targetIndices, anchorOrigSustain, delta) {
    const desired = Math.max(0, (Number(anchorOrigSustain) || 0) + (Number(delta) || 0));
    const limit = _maxSustainBeforeCollisionPure(noteList, targetIndices);
    const sustain = Math.max(0, Math.min(desired, limit));
    return targetIndices.map(() => sustain);
}
/* @pure:chord-resize:end */

// Flatten chord notes into the main notes array on load, tagging with _fromChord.
// On save, reconstruct chords from notes sharing the same time+_fromChord group.
function flattenChords() {
    if (!S.arrangements.length) return;
    _flattenArrChords(S.arrangements[S.currentArr]);
}

// Fold a SPECIFIC arrangement's chord notes into its `notes` array (the body of
// flattenChords, but arr-scoped instead of reading S.currentArr). Used by the
// replace-chart command so its exec()/redo flatten the TARGET arrangement — and
// produce identical state each time — regardless of which arrangement is active.
function _flattenArrChords(arr) {
    if (!arr) return;
    // Harmony function (§6.3.1) rides the chord INSTANCE. We carry it on the
    // spread note objects — every note of the chord gets the same `_fn` — so it
    // travels with the notes through ANY edit that mutates note.time (drag,
    // global shift, time-scale, tempo remap). reconstructChords adopts a group's
    // fn by majority vote (_groupFn), so a single note dragged into another chord
    // is outvoted and can't impose a stale fn. (Supersedes the old time-keyed
    // `arr._chordFn` store, which silently lost fn whenever a chord moved.)
    delete arr._chordFn;
    if (!Array.isArray(arr.notes)) arr.notes = [];
    for (const ch of arr.chords || []) {
        const fn = _normChordFn(ch.fn);
        for (const cn of ch.notes || []) {
            arr.notes.push({
                time: cn.time || ch.time,
                string: cn.string,
                fret: cn.fret,
                sustain: cn.sustain || 0,
                techniques: cn.techniques || {},
                _fromChord: true,
                _chordId: ch.chord_id,
                _fn: fn || null,
            });
        }
    }
    arr.chords = [];
    arr.notes.sort((a, b) => a.time - b.time);
}

// E2: coerce a wire-style boolean the way the backend's `_safe_bool` does
// (routes.py) — native bool, 0/1, and the string spellings true/false/yes/no/
// 1/0/"". JS `!!"false"` is truthy, so a hand-edited / legacy sloppak with
// `arp: "false"` must NOT flip arpeggio on during a load→save round-trip.
function _safeWireBool(v, dflt) {
    if (typeof v === 'boolean') return v;
    if (v === null || v === undefined) return dflt;
    if (typeof v === 'number') return v !== 0;
    if (typeof v === 'string') {
        const s = v.trim().toLowerCase();
        if (s === 'true' || s === '1' || s === 'yes') return true;
        if (s === 'false' || s === '0' || s === 'no' || s === '') return false;
    }
    return dflt;
}

// E2: coerce a wire-style number the way the backend's `_safe_int` / `float`
// do — accept native numbers and numeric strings (a hand-edited sloppak may
// carry `chord_id: "0"`, `start_time: "1.2"`). Returns `dflt` for blank /
// non-numeric / non-finite input.
function _wireFloat(v, dflt) {
    if (typeof v === 'number') return Number.isFinite(v) ? v : dflt;
    if (typeof v === 'string' && v.trim() !== '') {
        const n = Number(v);
        if (Number.isFinite(n)) return n;
    }
    return dflt;
}

// E2: coerce a loaded handshape into a robust editable dict using the wire
// field names the backend reads (chord_id/start_time/end_time/arp). Mirrors
// the backend's `_valid_handshape_dicts` coercion (numeric strings accepted)
// so a hand-edited pack isn't silently dropped. The `arp` default matches the
// backend's absent-default (False, via `_safe_bool`) so a load→save round-trip
// of a legacy payload is a no-op; freshly drawn regions default `arp:true` in
// the authoring UI (PR-B), not here.
function _normalizeHandshape(hs) {
    const cidNum = _wireFloat(hs && hs.chord_id, NaN);
    const cid = Number.isFinite(cidNum) ? Math.trunc(cidNum) : -1;
    let st = _wireFloat(hs && hs.start_time, 0);
    let et = _wireFloat(hs && hs.end_time, st);
    if (st < 0) st = 0;
    if (et < st) et = st;
    const rawArp = (hs && hs.arp !== undefined) ? hs.arp
        : (hs && hs.arpeggio !== undefined) ? hs.arpeggio : false;
    return { chord_id: cid, start_time: st, end_time: et, arp: _safeWireBool(rawArp, false) };
}

/* @pure:chord-relink:start — pure, no browser deps; node-tested by
   tests/chord_relink.test.js (extracted + eval'd from this marked block).
   Keep self-contained: these must not reference any other screen.js symbol. */
// Normalize a frets array to a width-L comma key so loaded/GP templates
// (padded to 6) match the editor's L-wide rebuilt frets on 7/8-string charts.
function _fretKeyForL(frets, L) {
    const out = new Array(L);
    for (let i = 0; i < L; i++) {
        out[i] = (Array.isArray(frets) && Number.isFinite(frets[i])) ? frets[i] : -1;
    }
    return out.join(',');
}
// Return a length-L fingers array from `fingers` (pad/trim with -1).
function _normFingers(fingers, L) {
    const out = new Array(L).fill(-1);
    if (Array.isArray(fingers)) {
        for (let i = 0; i < L && i < fingers.length; i++) {
            out[i] = Number.isFinite(fingers[i]) ? fingers[i] : -1;
        }
    }
    return out;
}
// §6.6 CAGED shape (display only): keep only the enum letters, else "".
function _sanitizeCaged(caged) {
    const c = (typeof caged === 'string') ? caged.trim() : '';
    return /^[CAGED]$/.test(c) ? c : '';
}
// §6.6 guide tones (display only): keep only the int entries in 0..11, dropping
// non-ints (bool excluded) and out-of-range values. Mirrors core's wire guard.
function _sanitizeGuideTones(tones) {
    if (!Array.isArray(tones)) return [];
    return tones.filter(n => Number.isInteger(n) && n >= 0 && n <= 11);
}
// Parse a comma-separated guide-tone string (inspector text input) into a clean
// int array via _sanitizeGuideTones — e.g. "4, 10, 12, x" -> [4, 10].
function _parseGuideTones(raw) {
    if (Array.isArray(raw)) return _sanitizeGuideTones(raw);
    if (typeof raw !== 'string') return [];
    return _sanitizeGuideTones(
        raw.split(',').map(s => {
            const t = s.trim();
            return /^-?\d+$/.test(t) ? parseInt(t, 10) : NaN;
        }));
}
// fret-pattern (width-L) -> authored template; first occurrence wins.
// Note: the flattened editor model has exactly ONE template per fret pattern,
// so two authored chords that share frets but differ in name/fingers
// necessarily collapse to one here (first wins). That's a pre-existing model
// limitation — before this change both collapsed to a *blank* template, so this
// is strictly an improvement; a fuller fix (per-`_chordId` templates) is E1/E2.
function _buildPreservedTemplates(oldTemplates, L) {
    const preserved = {};
    if (Array.isArray(oldTemplates)) {
        for (const ct of oldTemplates) {
            if (!ct || !Array.isArray(ct.frets)) continue;
            const k = _fretKeyForL(ct.frets, L);
            if (!(k in preserved)) preserved[k] = ct;
        }
    }
    return preserved;
}
// Build a rebuilt template for `frets`, carrying authored metadata when the
// fret pattern matches a preserved template; blank otherwise. `frets` is the
// authoritative current voicing.
// Carries the authored, round-trippable template fields: chordName (`name`),
// per-string `fingers`, `displayName` (falls back to `name`), and the
// template-level `arp` flag. E1 added the chord-inspector authoring UI and the
// matching backend emission (routes.py wire/XML writers + read side), so these
// persist through save and reload instead of being silent dead-state.
function relinkChordTemplate(frets, preserved, L) {
    const old = preserved[_fretKeyForL(frets, L)];
    const name = (old && typeof old.name === 'string') ? old.name : '';
    return {
        name,
        frets: frets.slice(),
        fingers: _normFingers(old && old.fingers, L),
        displayName: (old && typeof old.displayName === 'string') ? old.displayName : name,
        arp: !!(old && old.arp),
        // §6.6 voicing — carry it forward or the save rebuild BLANKS it (same
        // carry-forward gotcha as name/displayName/fingers/arp).
        voicing: (old && typeof old.voicing === 'string') ? old.voicing : '',
        // §6.6 caged + guideTones — same carry-forward gotcha as voicing; sanitize
        // here too so a stale invalid value can't survive the rebuild.
        caged: _sanitizeCaged(old && old.caged),
        guideTones: _sanitizeGuideTones(old && old.guideTones),
    };
}

// Normalize a chord-instance harmony function (§6.3.1) to the round-trippable
// shape, keeping only the set keys. Partial fns are allowed in-memory (the
// inspector authors rn/q/deg incrementally); the save range-guard (routes.py)
// is what enforces the spec's all-three-keys rule before it reaches the wire.
// Returns null when nothing is set.
function _normChordFn(fn) {
    if (!fn || typeof fn !== 'object') return null;
    const out = {};
    if (typeof fn.rn === 'string' && fn.rn.trim()) out.rn = fn.rn.trim();
    if (typeof fn.q === 'string' && fn.q.trim()) out.q = fn.q.trim();
    if (Number.isInteger(fn.deg) && fn.deg >= 0 && fn.deg <= 11) out.deg = fn.deg;
    return Object.keys(out).length ? out : null;
}

// Merge a partial harmony-function patch ({rn?|q?|deg?}) onto a base fn,
// keeping only the set keys. A key present in `patch` overwrites (blank/invalid
// clears it). Returns null when the result is empty.
function _mergeChordFn(base, patch) {
    const merged = {
        rn: base && typeof base.rn === 'string' ? base.rn : '',
        q: base && typeof base.q === 'string' ? base.q : '',
        deg: base && Number.isInteger(base.deg) ? base.deg : null,
    };
    if (patch && 'rn' in patch) merged.rn = typeof patch.rn === 'string' ? patch.rn.trim() : '';
    if (patch && 'q' in patch) merged.q = typeof patch.q === 'string' ? patch.q.trim() : '';
    if (patch && 'deg' in patch) {
        const d = patch.deg;
        merged.deg = (Number.isInteger(d) && d >= 0 && d <= 11) ? d : null;
    }
    return _normChordFn(merged);
}

// Adopt a note group's harmony function (§6.3.1) by MAJORITY: the `_fn` value
// carried by more than half the group's notes, else null. fn rides the chord
// instance and is carried on every note of the chord (so it travels with the
// notes through moves / shifts / tempo remaps). Authoring writes the same `_fn`
// to all of a chord's notes (unanimous), so a real chord always keeps its fn;
// a single note dragged in from another chord is outvoted and can't impose a
// stale fn — the property the time-keyed store used to guarantee.
function _groupFn(groupNotes) {
    if (!Array.isArray(groupNotes) || !groupNotes.length) return null;
    const counts = new Map();   // normalized key -> { fn, n }
    for (const n of groupNotes) {
        const fn = _normChordFn(n && n._fn);
        if (!fn) continue;
        const key = JSON.stringify([fn.rn || '', fn.q || '',
            Number.isInteger(fn.deg) ? fn.deg : null]);
        const e = counts.get(key);
        if (e) e.n++; else counts.set(key, { fn, n: 1 });
    }
    let best = null;
    for (const e of counts.values()) if (!best || e.n > best.n) best = e;
    return best && best.n * 2 > groupNotes.length ? best.fn : null;
}
// E2: build an old-template-index -> new-template-index map for handshapes'
// `chord_id` references after reconstructChords() rebuilt the template list.
// `templateMap` (new fret-key -> new index) and `chordTemplates` (the new
// list) are the rebuild outputs; both may be MUTATED here to append a
// preserved template for an arpeggio handshape whose voicing produced no
// same-time chord (so it isn't in the rebuild) — those must not be dropped.
// Only templates actually referenced by a surviving handshape are appended,
// and each orphan voicing is appended once (deduped via `templateMap`).
function buildHandshapeChordIdMap(handshapes, oldTemplates, templateMap, chordTemplates, L) {
    const oldToNew = {};
    if (!Array.isArray(handshapes) || !Array.isArray(oldTemplates)
        || !templateMap || !Array.isArray(chordTemplates)) return oldToNew;
    for (const hs of handshapes) {
        if (!hs) continue;
        const oldIdx = hs.chord_id;
        if (!Number.isInteger(oldIdx) || oldIdx < 0 || oldIdx >= oldTemplates.length) continue;
        if (oldIdx in oldToNew) continue;
        const old = oldTemplates[oldIdx];
        if (!old || !Array.isArray(old.frets)) continue;
        const key = _fretKeyForL(old.frets, L);
        if (key in templateMap) {
            oldToNew[oldIdx] = templateMap[key];
        } else {
            const newIdx = chordTemplates.length;
            // Re-link through the preserved metadata so the appended template
            // is width-L normalized and keeps name/displayName/fingers/arp.
            chordTemplates.push(relinkChordTemplate(old.frets, { [key]: old }, L));
            templateMap[key] = newIdx;
            oldToNew[oldIdx] = newIdx;
        }
    }
    return oldToNew;
}
// E2: apply an old->new chord_id remap to handshapes, dropping any whose old
// `chord_id` has no mapping (its template no longer exists -> invalid; the
// backend validator drops these too). Mutates each surviving handshape's
// `chord_id` IN PLACE and returns the filtered array of the SAME objects —
// preserving object identity so undo/redo command refs (which `indexOf` the
// handshape) survive a save, where reconstructChords() reassigns
// `arr.handshapes`. (Cloning here would orphan those refs.)
function remapHandshapeChordIds(handshapes, oldToNew) {
    if (!Array.isArray(handshapes) || !oldToNew) return [];
    const out = [];
    for (const hs of handshapes) {
        if (!hs) continue;
        const mapped = oldToNew[hs.chord_id];
        if (mapped === undefined) continue;
        hs.chord_id = mapped;
        out.push(hs);
    }
    return out;
}
/* @pure:chord-relink:end */

/* @pure:bend-shape:start — pure, no browser deps; node-tested by
 * tests/bend_shape.test.js. Helpers for authoring the §6.2.1 bend curve. */

// Bend-intent (`bt`) options, in spec order.
const BEND_INTENTS = [
    { v: 0, label: 'Bend up' },
    { v: 1, label: 'Release' },
    { v: 2, label: 'Pre-bend' },
    { v: 3, label: 'Pre-bend + release' },
    { v: 4, label: 'Round-trip' },
];

// Generate a sensible bend curve ([{t, v}], t = seconds-from-onset) for a
// given intent `bt`, peak `bn` and note `sustain`. Used to seed the curve
// editor and by the preset buttons.
function bendPresetCurve(bt, bn, sustain) {
    const T = sustain > 0 ? sustain : 1.0;
    const peak = Math.max(0, bn) || 0;
    const mid = Math.round(T * 0.5 * 1000) / 1000;
    const end = Math.round(T * 1000) / 1000;
    switch (Number(bt) || 0) {
        case 1: // release: held bend let down to pitch
            return [{ t: 0, v: peak }, { t: end, v: 0 }];
        case 2: // pre-bend: already bent, held
            return [{ t: 0, v: peak }, { t: end, v: peak }];
        case 3: // pre-bend + release
            return [{ t: 0, v: peak }, { t: mid, v: peak }, { t: end, v: 0 }];
        case 4: // round-trip: up then back down
            return [{ t: 0, v: 0 }, { t: mid, v: peak }, { t: end, v: 0 }];
        default: // 0 up
            return [{ t: 0, v: 0 }, { t: end, v: peak }];
    }
}

// Sanitize an authored curve for persistence: drop non-finite / non-dict
// entries, round (t to 3, v to 1) and sort by t. No magnitude clamp — mirrors
// core's `_sanitize_bend_curve` / the backend `_safe_bend_curve` (a bend can
// legitimately exceed the editor's 3-semitone authoring cap), and the curve
// canvas already bounds authored values. Returns null for empty / all-invalid
// input so an absent curve serializes as omitted, never [].
function sanitizeBendCurve(raw) {
    if (!Array.isArray(raw)) return null;
    const out = [];
    for (const p of raw) {
        if (!p || typeof p !== 'object') continue;
        const t = Number(p.t);
        const v = Number(p.v);
        if (!Number.isFinite(t) || !Number.isFinite(v)) continue;
        out.push({
            t: Math.round(t * 1000) / 1000,
            v: Math.round(v * 10) / 10,
        });
    }
    if (!out.length) return null;
    out.sort((a, b) => a.t - b.t);
    return out;
}

// Rescale a bend curve so its peak == `peak` (preserves shape). Returns null
// when the curve is empty/invalid, `peak <= 0`, or the curve is all-zero
// (unscalable) — callers then drop the curve so the scalar `bn` and `bnv` can
// never contradict each other.
function rescaleBendCurveToPeak(raw, peak) {
    const clean = sanitizeBendCurve(raw);
    if (!clean || !(peak > 0)) return null;
    const oldPeak = clean.reduce((m, p) => Math.max(m, p.v), 0);
    if (!(oldPeak > 0)) return null;
    const k = peak / oldPeak;
    const out = clean.map(p => ({ t: p.t, v: Math.round(p.v * k * 10) / 10 }));
    // A target peak below bnv's 0.1 precision (e.g. 0.04) rounds every point to
    // 0 — the curve can't carry the peak. Report unscalable so the caller drops
    // it and keeps the scalar bn, rather than deriving a contradictory 0.
    if (!(out.reduce((m, p) => Math.max(m, p.v), 0) > 0)) return null;
    return out;
}
/* @pure:bend-shape:end */

/* @pure:teaching-marks:start — pure, no browser deps; node-tested by
 * tests/teaching_marks.test.js. Helpers for authoring the §6.2.2 teaching
 * marks (fg fret-hand finger, ch strum group, sd scale degree). Display only —
 * the editor authors them; nothing here feeds grading. */

// Fret-hand-finger (`fg`) picker options, in spec order (-1 unset … 4 pinky).
const FRET_FINGER_OPTIONS = [
    { v: -1, label: 'Unset' },
    { v: 0, label: 'Thumb' },
    { v: 1, label: 'Index' },
    { v: 2, label: 'Middle' },
    { v: 3, label: 'Ring' },
    { v: 4, label: 'Pinky' },
];

// Next free strum-group key (`ch`) across a note list: max used (>= 0) + 1, or
// 0 when none is grouped yet. Used by "Group as strum" so a new gesture never
// collides with an existing one.
function nextUnusedStrumGroup(noteList) {
    let max = -1;
    if (Array.isArray(noteList)) {
        for (const n of noteList) {
            const ch = n && n.techniques ? n.techniques.strum_group : undefined;
            if (Number.isInteger(ch) && ch > max) max = ch;
        }
    }
    return max + 1;
}
/* @pure:teaching-marks:end */

// Reconstruct chords from notes at the same time before saving
function reconstructChords() {
    if (!S.arrangements.length) return;
    const arr = S.arrangements[S.currentArr];
    const L = lanes();
    // E0: snapshot the authored chord-template store (still present on
    // `arr.chord_templates` here) keyed by fret pattern, so the rebuild below
    // preserves name/displayName/fingers/arp instead of blanking them.
    const _preserved = _buildPreservedTemplates(arr.chord_templates, L);
    // E2: keep the OLD template list so handshape `chord_id` references (old
    // indices) can be remapped to the rebuilt indices below.
    const oldTemplates = arr.chord_templates;
    const byTime = {};
    const soloNotes = [];
    for (const n of arr.notes) {
        const key = n.time.toFixed(4);
        if (!byTime[key]) byTime[key] = [];
        byTime[key].push(n);
    }
    const newNotes = [];
    const newChords = [];
    // Always rebuild chord_templates from scratch so repeated saves don't
    // accumulate duplicate entries (flattenChords has already emptied
    // arr.chords, so the old templates are no longer referenced).
    const chordTemplates = [];
    const templateMap = {};

    for (const key of Object.keys(byTime).sort((a, b) => parseFloat(a) - parseFloat(b))) {
        const group = byTime[key];
        if (group.length === 1) {
            // A lone note is not a chord, so it carries no harmony fn. Drop any
            // `_fn` it inherited (e.g. a chord note dragged out) so the internal
            // field can't ride into the saved wire via arr.notes.
            delete group[0]._fn;
            newNotes.push(group[0]);
        } else {
            // Multiple notes at same time = chord
            const frets = new Array(L).fill(-1);
            for (const n of group) {
                if (n.string >= 0 && n.string < L) frets[n.string] = n.fret;
            }
            const fretKey = frets.join(',');
            let tmplIdx;
            if (fretKey in templateMap) {
                tmplIdx = templateMap[fretKey];
            } else {
                tmplIdx = chordTemplates.length;
                // E0: carry authored name/displayName/fingers/arp forward when
                // this fret pattern matches a preserved template; blank otherwise.
                // Width-normalized to L so 7/8-string charts match correctly.
                chordTemplates.push(relinkChordTemplate(frets, _preserved, L));
                templateMap[fretKey] = tmplIdx;
            }
            // Harmony function (§6.3.1) rides the instance: adopt it from the
            // group's notes by majority (_groupFn), so it survives chord moves and
            // a stray dragged-in note can't impose a foreign fn. A partial fn is
            // kept here and dropped by the save range-guard.
            const _fn = _groupFn(group);
            newChords.push({
                time: group[0].time,
                chord_id: tmplIdx,
                high_density: false,
                fn: _fn,
                notes: group.map(n => ({
                    time: n.time,
                    string: n.string,
                    fret: n.fret,
                    sustain: n.sustain || 0,
                    techniques: n.techniques || {},
                })),
            });
        }
    }
    arr.notes = newNotes;
    arr.chords = newChords;
    arr.chord_templates = chordTemplates;
    // #18: this rebuild just replaced arr.notes with fresh note objects (and
    // moved same-time groups into arr.chords), so every index-based undo command
    // now points at the wrong note. Reset the undo/redo history HERE — atomically
    // with the identity-changing assignment, before the handshape remap below
    // (which can throw) — so a stale stack can't survive a partial rebuild.
    // reconstructChords() runs ONLY at save/build time, so this only ever drops
    // cross-save undo. (Follow-up: stable note ids would preserve it — #18 Option 2.)
    if (S.history) S.history.reset();
    // E2: remap authored handshapes' `chord_id` from the OLD template indices
    // to the rebuilt ones (matched by fret pattern). An arpeggio handshape
    // whose voicing produced no same-time chord gets its preserved template
    // appended (so it survives); references with no template are dropped to
    // match the backend's `chord_id < len(chord_templates)` validator.
    if (Array.isArray(arr.handshapes) && arr.handshapes.length) {
        const oldToNew = buildHandshapeChordIdMap(
            arr.handshapes, oldTemplates, templateMap, chordTemplates, L);
        const _selWasHere = S.handshapeSel && arr.handshapes.includes(S.handshapeSel);
        arr.handshapes = remapHandshapeChordIds(arr.handshapes, oldToNew);
        // If the selected handshape was in THIS arrangement and the remap
        // dropped it (its template vanished), clear the now-dangling selection.
        if (_selWasHere && !arr.handshapes.includes(S.handshapeSel)) S.handshapeSel = null;
    }
}

// ════════════════════════════════════════════════════════════════════
// Drawing
// ════════════════════════════════════════════════════════════════════

function draw() {
    if (!canvas) return;
    // Keep the loop strip (DOM, independent of the canvas render) in sync for
    // EVERY mode — drum-edit and tempo-map both return early below, so rendering
    // it here rather than at the tail stops a clear/drag from leaving a stale
    // selection while one of those modes is active.
    _renderLoopStrip();
    updateBPMDisplay();
    updateTempoSigDisplay();
    const w = canvas.width / DPR;
    const h = canvas.height / DPR;
    ctx.save();
    ctx.scale(DPR, DPR);
    ctx.clearRect(0, 0, w, h);

    // Drum editor mode forks the canvas to a piece-lane grid view. The
    // guitar/keys draw chain below is skipped entirely so its lane-cache
    // logic doesn't try to walk a non-existent arrangement (`S.drumTab`
    // is not in S.arrangements[]).
    if (S.drumEditMode && S.drumTab) {
        try { _drumEditorDraw(w, h); }
        finally { ctx.restore(); }
        return;
    }

    // Tempo Map mode forks to a sync-point editor view. Like drum mode it
    // skips the guitar/keys draw chain — it only needs the waveform + the
    // song-wide beat grid, not any arrangement's notes.
    if (S.tempoMapMode) {
        try { _tempoMapDraw(w, h); }
        finally { ctx.restore(); }
        return;
    }

    // Seed the per-frame `lanes()` cache. drawNotes calls strToLane on every
    // note (and per-note hit tests do the same), so without this every
    // frame is O(N²) over the arrangement. The labels array is cached
    // alongside since `colorForLane` reads it once per note. Enable
    // the cache BEFORE calling `laneLabels()` so that helper's internal
    // `lanes()` call hits the cache too (otherwise we'd do two full
    // O(N) scans per frame).
    _lanesCacheActive = false;  // force a real compute first
    _lanesCacheValue = lanes();
    _lanesCacheActive = true;
    _laneLabelsCacheValue = laneLabels();
    try {
        drawWaveform(w);
        drawToneLane(w);
        drawLanes(w);
        drawGrid(w);
        drawSections(w);
        drawBarSel(w);
        drawBeatBar(w);
        drawNotes(w);
        drawSelectionRect(w);
        drawGhostNotes();
        drawAnchorLane(w);
        drawHandshapeLane(w);
        // Draw cursor AFTER the anchor lane so the playhead line
        // appears on top of the lane instead of getting overdrawn —
        // the cursor's time-axis extent intentionally spans every
        // strip that shares the time axis (lanes, beat bar, anchor
        // lane). Tone lane sits at y=0 above the cursor's start, so
        // it doesn't need similar reordering.
        drawCursor(w, h);
        drawLabels(w);
    } finally {
        _lanesCacheActive = false;
        _laneLabelsCacheValue = null;
    }

    ctx.restore();
}

function drawWaveform(w) {
    ctx.fillStyle = '#08081a';
    ctx.fillRect(0, 0, w, WAVEFORM_H);
    if (typeof editorWaveformVisible !== 'undefined' && !editorWaveformVisible) return;
    const pk = S.waveformPeaks;
    const dur = S.duration || 0;
    if (!pk || !pk.bins || dur <= 0) return;

    const N = pk.bins;
    const mid = WAVEFORM_H / 2;
    const amp = WAVEFORM_H / 2 - 4;
    // Visible pixel span of the audio (clamped to the waveform lane).
    const xLo = Math.max(LABEL_W, Math.floor(timeToX(0)));
    const xHi = Math.min(w, Math.ceil(timeToX(dur)));
    if (xHi <= xLo) return;

    // Per-column bin range for the pixel [px, px+1). Each column aggregates
    // every bin it spans, so the shape stays correct from full-song zoom-out
    // down to a single bin per pixel.
    const binRange = (px) => {
        let i0 = Math.floor(xToTime(px) / dur * N);
        let i1 = Math.floor(xToTime(px + 1) / dur * N);
        if (i0 < 0) i0 = 0;
        if (i1 >= N) i1 = N - 1;
        if (i1 < i0) i1 = i0;
        return [i0, i1];
    };

    // Faint zero line.
    ctx.strokeStyle = 'rgba(120,150,210,0.18)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(xLo, mid + 0.5);
    ctx.lineTo(xHi, mid + 0.5);
    ctx.stroke();

    // Peak (min→max) envelope — the true asymmetric outline, drawn light.
    ctx.fillStyle = 'rgba(90,150,235,0.40)';
    for (let px = xLo; px < xHi; px++) {
        const [i0, i1] = binRange(px);
        let lo = pk.min[i0], hi = pk.max[i0];
        for (let i = i0 + 1; i <= i1; i++) {
            if (pk.min[i] < lo) lo = pk.min[i];
            if (pk.max[i] > hi) hi = pk.max[i];
        }
        const yHi = mid - hi * amp;
        const yLo = mid - lo * amp;
        ctx.fillRect(px, yHi, 1, Math.max(1, yLo - yHi));
    }

    // RMS body — loudness, drawn brighter and symmetric around the zero line.
    ctx.fillStyle = 'rgba(130,185,255,0.85)';
    for (let px = xLo; px < xHi; px++) {
        const [i0, i1] = binRange(px);
        let sumSq = 0, cnt = 0;
        for (let i = i0; i <= i1; i++) { const r = pk.rms[i]; sumSq += r * r; cnt++; }
        const h = (cnt ? Math.sqrt(sumSq / cnt) : 0) * amp;
        if (h > 0.5) ctx.fillRect(px, mid - h, 1, Math.max(1, 2 * h));
    }
}

function drawLanes(w) {
    if (isKeysMode()) return drawPianoLanes(w);
    const L = lanes();
    for (let l = 0; l < L; l++) {
        const y = laneToY(l);
        ctx.fillStyle = l % 2 === 0 ? '#0c0c1c' : '#0f0f24';
        ctx.fillRect(LABEL_W, y, w - LABEL_W, LANE_H);
        // Separator
        ctx.strokeStyle = '#1a1a35';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(LABEL_W, y + LANE_H);
        ctx.lineTo(w, y + LANE_H);
        ctx.stroke();
    }
}

function drawPianoLanes(w) {
    for (let midi = pianoRange.lo; midi <= pianoRange.hi; midi++) {
        const y = midiToY(midi);
        const black = isBlackKey(midi);
        ctx.fillStyle = black ? '#0a0a1a' : '#0e0e22';
        ctx.fillRect(LABEL_W, y, w - LABEL_W, PIANO_LANE_H);

        // Octave boundary (C notes)
        if (midi % 12 === 0) {
            ctx.strokeStyle = '#2a2a55';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(LABEL_W, y + PIANO_LANE_H);
            ctx.lineTo(w, y + PIANO_LANE_H);
            ctx.stroke();
        }
    }
}

function drawGrid(w) {
    const st = S.scrollX - 1;
    const et = S.scrollX + (w - LABEL_W) / S.zoom + 1;
    const laneBottom = isKeysMode()
        ? WAVEFORM_H + pianoLaneCount() * PIANO_LANE_H
        : WAVEFORM_H + lanes() * LANE_H;
    for (const b of S.beats) {
        if (b.time < st || b.time > et) continue;
        const x = timeToX(b.time);
        if (x < LABEL_W || x > w) continue;
        const meas = b.measure > 0;
        ctx.strokeStyle = meas ? '#2a2a50' : '#16162c';
        ctx.lineWidth = meas ? 1.5 : 0.5;
        ctx.beginPath();
        ctx.moveTo(x, WAVEFORM_H);
        ctx.lineTo(x, laneBottom);
        ctx.stroke();
    }
}

function drawSections(w) {
    const st = S.scrollX - 1;
    const et = S.scrollX + (w - LABEL_W) / S.zoom + 1;
    const laneBottom = isKeysMode()
        ? WAVEFORM_H + pianoLaneCount() * PIANO_LANE_H
        : WAVEFORM_H + lanes() * LANE_H;
    ctx.font = '9px monospace';
    ctx.textBaseline = 'top';
    for (const s of S.sections) {
        if (s.start_time < st || s.start_time > et) continue;
        const x = timeToX(s.start_time);
        if (x < LABEL_W || x > w) continue;
        // Dashed vertical line
        ctx.strokeStyle = '#e8c04060';
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(x, WAVEFORM_H);
        ctx.lineTo(x, laneBottom);
        ctx.stroke();
        ctx.setLineDash([]);
        // Label at top of lanes
        ctx.fillStyle = '#e8c040';
        ctx.textAlign = 'left';
        ctx.fillText(s.name, x + 3, WAVEFORM_H + 2);
    }
}

// Y coordinate of the beat bar's top edge. Branches on keys mode
// because keys lanes use a different per-lane height. `canvasH`,
// `_anchorLaneTopY`, `drawBeatBar` all call through here so they
// can't drift as new strips are added.
function _beatBarTopY() {
    return isKeysMode()
        ? WAVEFORM_H + pianoLaneCount() * PIANO_LANE_H
        : WAVEFORM_H + lanes() * LANE_H;
}

// Highlight the bar range selected for "Loop in 3D" — a translucent blue
// band with bright edges spanning the full chart height, drawn under the
// notes so they stay legible.
function drawBarSel(w) {
    if (!S.barSel) return;
    const x1 = timeToX(S.barSel.startTime);
    const x2 = timeToX(S.barSel.endTime);
    if (x2 < LABEL_W || x1 > w) return;
    const cx1 = Math.max(LABEL_W, x1);
    const cx2 = Math.min(w, x2);
    const bot = canvasH();
    ctx.save();
    ctx.fillStyle = 'rgba(80,160,255,0.10)';
    ctx.fillRect(cx1, 0, Math.max(0, cx2 - cx1), bot);
    ctx.strokeStyle = 'rgba(80,160,255,0.7)';
    ctx.lineWidth = 1.5;
    if (x1 >= LABEL_W && x1 <= w) { ctx.beginPath(); ctx.moveTo(x1, 0); ctx.lineTo(x1, bot); ctx.stroke(); }
    if (x2 >= LABEL_W && x2 <= w) { ctx.beginPath(); ctx.moveTo(x2, 0); ctx.lineTo(x2, bot); ctx.stroke(); }
    ctx.restore();
}

function drawBeatBar(w) {
    const y = _beatBarTopY();
    ctx.fillStyle = '#08081a';
    ctx.fillRect(0, y, w, BEAT_H);
    ctx.fillStyle = '#08081a';
    ctx.fillRect(0, y, LABEL_W, BEAT_H);

    // Left gutter label — identifies the strip and hints that it's
    // drag-to-select for "Loop in 3D".
    ctx.fillStyle = S.barSel ? '#6aa0ff' : '#667';
    ctx.font = '8px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('⇆ bars', LABEL_W / 2, y + BEAT_H / 2);

    ctx.fillStyle = '#555';
    ctx.font = '9px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const st = S.scrollX - 1;
    const et = S.scrollX + (w - LABEL_W) / S.zoom + 1;
    for (const b of S.beats) {
        if (b.measure <= 0 || b.time < st || b.time > et) continue;
        const x = timeToX(b.time);
        if (x < LABEL_W || x > w) continue;
        ctx.fillText(String(b.measure), x, y + BEAT_H / 2);
    }
}

function drawLabels(w) {
    // Waveform label
    ctx.fillStyle = '#0a0a1a';
    ctx.fillRect(0, 0, LABEL_W, WAVEFORM_H);
    ctx.fillStyle = '#555';
    ctx.font = '9px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Audio', LABEL_W / 2, WAVEFORM_H / 2);

    if (isKeysMode()) return drawPianoLabels(w);

    // String labels. `labels` is in RS string-index order (low → high); lanes
    // are drawn high-to-low (lane 0 = top = highest string). Colours come
    // from `colorForLane()` which looks up the string's pitch label in
    // `STRING_LABEL_COLORS` — so a 4-string bass G/D/A/E reads orange/blue/
    // yellow/red just like the same pitches on a 6-string guitar.
    const L = lanes();
    const labels = laneLabels();
    for (let l = 0; l < L; l++) {
        const y = laneToY(l);
        ctx.fillStyle = '#0a0a1a';
        ctx.fillRect(0, y, LABEL_W, LANE_H);
        const s = laneToStr(l);
        ctx.fillStyle = colorForLane(l);
        ctx.font = 'bold 12px monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(labels[s] || String(s), LABEL_W / 2, y + LANE_H / 2);
    }
}

function drawPianoLabels() {
    // MIDI note labels on the left axis
    ctx.font = '8px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let midi = pianoRange.lo; midi <= pianoRange.hi; midi++) {
        const y = midiToY(midi);
        ctx.fillStyle = '#0a0a1a';
        ctx.fillRect(0, y, LABEL_W, PIANO_LANE_H);

        // Only label C notes and F notes to avoid clutter
        if (midi % 12 === 0 || midi % 12 === 5) {
            const octave = Math.floor(midi / 12) - 1;
            const color = PIANO_OCTAVE_COLORS[Math.min(octave + 1, PIANO_OCTAVE_COLORS.length - 1)];
            ctx.fillStyle = color;
            ctx.fillText(midiToNote(midi), LABEL_W / 2, y + PIANO_LANE_H / 2);
        }
    }
}

function drawNotes(w) {
    const nn = notes();
    const st = S.scrollX - 2;
    const et = S.scrollX + (w - LABEL_W) / S.zoom + 2;
    const keysMode = isKeysMode();
    for (let i = 0; i < nn.length; i++) {
        const n = nn[i];
        if (n.time + (n.sustain || 0) < st || n.time > et) continue;
        if (keysMode) {
            _drawPianoNote(n, S.sel.has(i));
        } else {
            _drawNote(n, S.sel.has(i));
        }
    }
}

function _drawNote(n, selected) {
    const x = timeToX(n.time);
    const y = strToY(n.string) + NOTE_PAD;
    const sw = Math.max(MIN_NOTE_W, (n.sustain || 0) * S.zoom);
    const h = LANE_H - NOTE_PAD * 2;
    const color = colorForLane(strToLane(n.string));

    // Body
    ctx.fillStyle = color + 'cc';
    ctx.beginPath();
    ctx.roundRect(x, y, sw, h, 3);
    ctx.fill();

    // Border
    if (selected) {
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
    } else {
        ctx.strokeStyle = color;
        ctx.lineWidth = 0.5;
    }
    ctx.beginPath();
    ctx.roundRect(x, y, sw, h, 3);
    ctx.stroke();

    // Fret number
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 13px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(n.fret), x + Math.min(sw, MIN_NOTE_W) / 2, y + h / 2);

    // Technique badges
    const techs = n.techniques || {};
    const badges = [];
    if (techs.hammer_on) badges.push('H');
    if (techs.pull_off) badges.push('P');
    if (techs.slide_to >= 0) badges.push('/' + techs.slide_to);
    if (techs.slide_unpitch_to >= 0) badges.push('↓' + techs.slide_unpitch_to);
    if (techs.bend > 0) badges.push('b');
    if (techs.harmonic) badges.push('*');
    if (techs.harmonic_pinch) badges.push('*P');
    if (techs.palm_mute) badges.push('PM');
    if (techs.fret_hand_mute) badges.push('FM');
    if (techs.tap) badges.push('T');
    if (techs.slap) badges.push('S');
    if (techs.pluck) badges.push('P!');
    if (techs.tremolo) badges.push('~');
    if (techs.vibrato) badges.push('V');
    if (techs.mute) badges.push('x');
    if (techs.link_next) badges.push('→');
    if (techs.ignore) badges.push('I');
    if (badges.length) {
        ctx.fillStyle = '#ffffffbb';
        ctx.font = '7px monospace';
        ctx.textAlign = 'left';
        ctx.fillText(badges.join(' '), x + 2, y + 9);
    }

    // Sustain tail
    if (sw > MIN_NOTE_W) {
        ctx.fillStyle = color + '40';
        ctx.fillRect(x + MIN_NOTE_W, y + h / 2 - 2, sw - MIN_NOTE_W, 4);
    }
}

function _drawPianoNote(n, selected) {
    const midi = noteToMidi(n.string, n.fret);
    if (midi < pianoRange.lo || midi > pianoRange.hi) return;

    const x = timeToX(n.time);
    const y = midiToY(midi) + 1;
    const sw = Math.max(MIN_NOTE_W, (n.sustain || 0) * S.zoom);
    const h = PIANO_LANE_H - 2;
    const octave = Math.floor(midi / 12);
    const color = PIANO_OCTAVE_COLORS[Math.min(octave, PIANO_OCTAVE_COLORS.length - 1)];

    // Body
    ctx.fillStyle = color + 'cc';
    ctx.beginPath();
    ctx.roundRect(x, y, sw, h, 2);
    ctx.fill();

    // Border
    if (selected) {
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
    } else {
        ctx.strokeStyle = color;
        ctx.lineWidth = 0.5;
    }
    ctx.beginPath();
    ctx.roundRect(x, y, sw, h, 2);
    ctx.stroke();

    // Note name (only if enough space)
    if (sw >= 20 && h >= 8) {
        ctx.fillStyle = '#000';
        ctx.font = `bold ${Math.min(9, h - 1)}px monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(midiToNote(midi), x + Math.min(sw, 24) / 2, y + h / 2);
    }
}

function drawCursor(w, h) {
    const x = timeToX(S.cursorTime);
    if (x < LABEL_W || x > w) return;
    ctx.strokeStyle = '#ff4444';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    // Extend the playhead through every time-axis-aligned strip
    // (waveform, tone lane, lanes, beat bar, anchor lane). `canvasH()`
    // stops at the beat-bar bottom, which would clip the cursor above
    // the anchor lane.
    ctx.lineTo(x, h);
    ctx.stroke();
}

function drawSelectionRect() {
    if (!S.drag || (S.drag.type !== 'select' && S.drag.type !== 'drum-select')) return;
    // The drum marquee only materialises once the pointer has actually
    // moved — a stationary press is a click-to-add-hit, not a select.
    if (S.drag.type === 'drum-select' && !S.drag.moved) return;
    const x1 = Math.min(S.drag.startX, S.drag.curX);
    const y1 = Math.min(S.drag.startY, S.drag.curY);
    const x2 = Math.max(S.drag.startX, S.drag.curX);
    const y2 = Math.max(S.drag.startY, S.drag.curY);
    ctx.strokeStyle = '#4080e0';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
    ctx.setLineDash([]);
    ctx.fillStyle = '#4080e018';
    ctx.fillRect(x1, y1, x2 - x1, y2 - y1);
}

// ════════════════════════════════════════════════════════════════════
// Hit testing
// ════════════════════════════════════════════════════════════════════

const EDGE_GRAB = 8; // pixels from right edge to trigger resize

function hitNote(mx, my) {
    const nn = notes();
    const keysMode = isKeysMode();
    for (let i = nn.length - 1; i >= 0; i--) {
        const n = nn[i];
        const x = timeToX(n.time);
        let y, w, h;
        if (keysMode) {
            const midi = noteToMidi(n.string, n.fret);
            y = midiToY(midi) + 1;
            w = Math.max(MIN_NOTE_W, (n.sustain || 0) * S.zoom);
            h = PIANO_LANE_H - 2;
        } else {
            y = strToY(n.string) + NOTE_PAD;
            w = Math.max(MIN_NOTE_W, (n.sustain || 0) * S.zoom);
            h = LANE_H - NOTE_PAD * 2;
        }
        if (mx >= x && mx <= x + w && my >= y && my <= y + h) return i;
    }
    return -1;
}

function hitNoteEdge(mx, my) {
    // Returns note index if mouse is near the right edge of a note (for sustain resize)
    const nn = notes();
    for (let i = nn.length - 1; i >= 0; i--) {
        const n = nn[i];
        const x = timeToX(n.time);
        const y = strToY(n.string) + NOTE_PAD;
        const w = Math.max(MIN_NOTE_W, (n.sustain || 0) * S.zoom);
        const h = LANE_H - NOTE_PAD * 2;
        const rightEdge = x + w;
        if (mx >= rightEdge - EDGE_GRAB && mx <= rightEdge + EDGE_GRAB && my >= y && my <= y + h) return i;
    }
    return -1;
}

// ════════════════════════════════════════════════════════════════════
// Undo / Redo
// ════════════════════════════════════════════════════════════════════

/* @pure:edit-history:start */
class EditHistory {
    constructor() { this.undo = []; this.redo = []; }
    exec(cmd) { cmd.exec(); this.undo.push(cmd); this.redo = []; this._afterEdit(); this._ui(); }
    doUndo() { if (!this.undo.length) return; const c = this.undo.pop(); c.rollback(); this.redo.push(c); this._afterEdit(); this._ui(); draw(); updateStatus(); }
    doRedo() { if (!this.redo.length) return; const c = this.redo.pop(); c.exec(); this.undo.push(c); this._afterEdit(); this._ui(); draw(); updateStatus(); }
    // #18: drop the whole stack when the model is rebuilt under us (the save /
    // build flatten+reconstructChords round-trip renumbers arr.notes, so every
    // index-based command would now roll back into the wrong note). Reuse the
    // live instance + its _ui() wiring rather than reassigning S.history.
    // Not _afterEdit() — that nudges the piano viewport, which a clear shouldn't.
    reset() { this.undo = []; this.redo = []; this._ui(); }
    _afterEdit() {
        // Keep the keys viewport in sync with the current note range so
        // multi-octave authoring works without manual range control.
        // expandOnly=true so adding a note outside the current viewport
        // extends it instead of collapsing to the latest note's octave.
        if (typeof isKeysMode === 'function' && isKeysMode()) updatePianoRange(true);
    }
    _ui() {
        const u = document.getElementById('editor-undo');
        const r = document.getElementById('editor-redo');
        if (u) u.disabled = !this.undo.length;
        if (r) r.disabled = !this.redo.length;
    }
}
/* @pure:edit-history:end */

class MoveNoteCmd {
    constructor(indices, dtimes, dstrings, dfrets) {
        this.indices = indices;
        this.dtimes = dtimes;
        this.dstrings = dstrings;
        this.dfrets = dfrets; // null for guitar mode, array for piano mode
    }
    exec() {
        const nn = notes();
        for (let i = 0; i < this.indices.length; i++) {
            nn[this.indices[i]].time += this.dtimes[i];
            nn[this.indices[i]].string += this.dstrings[i];
            if (this.dfrets) nn[this.indices[i]].fret += this.dfrets[i];
        }
    }
    rollback() {
        const nn = notes();
        for (let i = 0; i < this.indices.length; i++) {
            nn[this.indices[i]].time -= this.dtimes[i];
            nn[this.indices[i]].string -= this.dstrings[i];
            if (this.dfrets) nn[this.indices[i]].fret -= this.dfrets[i];
        }
    }
}

// Snapshot the selected note refs, then remap `S.sel` back to fresh
// indices after the caller has mutated `notes()` (typically via a
// sort that would otherwise leave stale indices pointing at the
// wrong objects). Inspector bulk edits read through `S.sel`, so any
// command that sorts/reorders has to keep the index→ref binding
// consistent.
function _withStableSelection(mutate) {
    if (!S.sel || S.sel.size === 0) {
        mutate();
        return;
    }
    const nn = notes();
    const selectedRefs = [...S.sel]
        .map(i => nn[i])
        .filter(Boolean);
    mutate();
    const after = notes();
    // Build a single ref→index map (O(N)) instead of calling
    // `Array.indexOf` once per selected ref (O(selected × N)). Matters
    // on long arrangements / large multi-selects.
    const refToIdx = new Map();
    for (let i = 0; i < after.length; i++) refToIdx.set(after[i], i);
    S.sel.clear();
    for (const ref of selectedRefs) {
        const i = refToIdx.get(ref);
        if (i !== undefined) S.sel.add(i);
    }
}

class AddNoteCmd {
    constructor(note) { this.note = note; this.idx = -1; }
    exec() {
        const nn = notes();
        nn.push(this.note);
        // Sorting the notes array can shift the indices stored in
        // `S.sel` so they end up pointing at different note objects.
        // Re-bind the selection through the ref→index round-trip.
        _withStableSelection(() => {
            nn.sort((a, b) => a.time - b.time);
        });
        this.idx = nn.indexOf(this.note);
    }
    rollback() {
        const nn = notes();
        // Removing via splice shifts every index past `i` down by one,
        // so the selection would silently re-bind to wrong notes after
        // undo. Wrap the removal so `S.sel` stays bound to refs across
        // the index shift.
        _withStableSelection(() => {
            const i = nn.indexOf(this.note);
            if (i >= 0) nn.splice(i, 1);
        });
    }
}

class DeleteNotesCmd {
    constructor(indices) {
        this.indices = [...indices].sort((a, b) => b - a);
        this.removed = [];
    }
    exec() {
        const nn = notes();
        this.removed = [];
        for (const i of this.indices) {
            this.removed.push({ idx: i, note: nn[i] });
            nn.splice(i, 1);
        }
        S.sel.clear();
    }
    rollback() {
        const nn = notes();
        for (const r of [...this.removed].reverse()) {
            nn.splice(r.idx, 0, r.note);
        }
    }
}

class ResizeSustainCmd {
    constructor(index, newSustain) {
        this.index = index;
        this.newSustain = newSustain;
        this.oldSustain = notes()[index].sustain || 0;
    }
    exec() { notes()[this.index].sustain = this.newSustain; }
    rollback() { notes()[this.index].sustain = this.oldSustain; }
}

class ResizeSustainGroupCmd {
    constructor(indices, newSustains) {
        this.indices = indices.slice();
        this.newSustains = newSustains.slice();
        const nn = notes();
        this.oldSustains = this.indices.map(i => nn[i] ? (nn[i].sustain || 0) : 0);
    }
    exec() {
        const nn = notes();
        for (let i = 0; i < this.indices.length; i++) {
            if (nn[this.indices[i]]) nn[this.indices[i]].sustain = this.newSustains[i];
        }
    }
    rollback() {
        const nn = notes();
        for (let i = 0; i < this.indices.length; i++) {
            if (nn[this.indices[i]]) nn[this.indices[i]].sustain = this.oldSustains[i];
        }
    }
}

class ChangeFretCmd {
    constructor(index, newFret) {
        this.index = index;
        this.newFret = newFret;
        this.oldFret = notes()[index].fret;
    }
    exec() { notes()[this.index].fret = this.newFret; }
    rollback() { notes()[this.index].fret = this.oldFret; }
}

class ToggleTechniqueCmd {
    constructor(indices, key, value, fretValue = null) {
        this.indices = indices.slice();
        this.key = key;
        this.value = !!value;
        this.fretValue = fretValue;
        const nn = notes();
        this.old = this.indices.map(i => ({
            tech: !!(nn[i] && nn[i].techniques && nn[i].techniques[key]),
            fret: nn[i] ? nn[i].fret : 0,
        }));
    }
    exec() {
        const nn = notes();
        for (const i of this.indices) {
            const n = nn[i];
            if (!n) continue;
            if (!n.techniques) n.techniques = {};
            n.techniques[this.key] = this.value;
            if (this.fretValue !== null) n.fret = this.fretValue;
        }
    }
    rollback() {
        const nn = notes();
        this.indices.forEach((i, k) => {
            const n = nn[i];
            if (!n) return;
            if (!n.techniques) n.techniques = {};
            n.techniques[this.key] = this.old[k].tech;
            n.fret = this.old[k].fret;
        });
    }
}

// Set the full bend shape (peak `bend`, intent `bend_intent`, curve
// `bend_values` — §6.2.1) on one or more notes as a single undoable edit.
// Snapshots the prior bend triple per note so undo restores it exactly.
class SetBendShapeCmd {
    constructor(indices, bn, bt, bnv) {
        this.indices = indices.slice();
        this.bn = bn;
        this.bt = bt;
        // Store a defensive copy; null when the note has no curve.
        this.bnv = Array.isArray(bnv) && bnv.length
            ? bnv.map(p => ({ t: p.t, v: p.v }))
            : null;
        this.old = this.indices.map(i => {
            const t = notes()[i].techniques || {};
            return {
                bend: t.bend,
                bend_intent: t.bend_intent,
                bend_values: t.bend_values,
            };
        });
    }
    exec() {
        for (const i of this.indices) {
            const n = notes()[i];
            if (!n.techniques) n.techniques = {};
            n.techniques.bend = this.bn;
            n.techniques.bend_intent = this.bt;
            n.techniques.bend_values = this.bnv
                ? this.bnv.map(p => ({ t: p.t, v: p.v }))
                : null;
        }
    }
    rollback() {
        this.indices.forEach((i, k) => {
            const n = notes()[i];
            if (!n.techniques) n.techniques = {};
            const o = this.old[k];
            n.techniques.bend = o.bend;
            n.techniques.bend_intent = o.bend_intent;
            n.techniques.bend_values = o.bend_values;
        });
    }
}

// Set only the bend intent (`bt`) on a set of notes — used by the inspector
// dropdown so changing intent across a multi-selection doesn't flatten each
// note's distinct peak/curve (which the full SetBendShapeCmd would).
class SetBendIntentCmd {
    constructor(indices, bt) {
        this.indices = indices.slice();
        this.bt = Number(bt) || 0;
        this.old = this.indices.map(i => (notes()[i].techniques || {}).bend_intent);
    }
    exec() {
        for (const i of this.indices) {
            const n = notes()[i];
            if (!n.techniques) n.techniques = {};
            n.techniques.bend_intent = this.bt;
        }
    }
    rollback() {
        this.indices.forEach((i, k) => {
            const n = notes()[i];
            if (!n.techniques) n.techniques = {};
            n.techniques.bend_intent = this.old[k];
        });
    }
}

// Teaching marks (§6.2.2) — set one integer technique field (fret_finger /
// scale_degree / strum_group) across a set of notes as one undoable edit,
// snapshotting the prior per-note value. -1 is the unset sentinel (the save
// path omits it from the wire). Display only — never feeds grading.
class SetTeachingMarkCmd {
    constructor(indices, key, value) {
        this.indices = indices.slice();
        this.key = key;
        this.value = Number.isInteger(value) ? value : -1;
        this.old = this.indices.map(i => {
            const t = notes()[i].techniques || {};
            return t[key];
        });
    }
    exec() {
        for (const i of this.indices) {
            const n = notes()[i];
            if (!n.techniques) n.techniques = {};
            n.techniques[this.key] = this.value;
        }
    }
    rollback() {
        this.indices.forEach((i, k) => {
            const n = notes()[i];
            if (!n.techniques) n.techniques = {};
            n.techniques[this.key] = this.old[k];
        });
    }
}

// Edit a chord-instance harmony function (§6.3.1). fn rides the instance: it is
// carried as `_fn` on EVERY note at the chord's time, so it travels with the
// notes through any time-mutating edit and reconstructChords adopts it by
// majority. One undo unit; snapshots each note's prior `_fn` by object ref.
class EditChordFnCmd {
    constructor(arrIdx, timeKey, baseFn, patch) {
        this.arrIdx = arrIdx;
        this.timeKey = timeKey;
        this.next = _mergeChordFn(baseFn, patch) || null;
        this._targets = null;   // [{ note, prev }] filled at exec()
    }
    _groupNotes() {
        const arr = S.arrangements[this.arrIdx];
        if (!arr || !Array.isArray(arr.notes)) return [];
        return arr.notes.filter(n => n.time.toFixed(4) === this.timeKey);
    }
    exec() {
        const grp = this._groupNotes();
        // Snapshot by object ref (not index) so undo is robust to reordering;
        // `prev === undefined` marks a note that had no `_fn`.
        this._targets = grp.map(n => ({ note: n, prev: ('_fn' in n) ? n._fn : undefined }));
        for (const n of grp) n._fn = this.next;
    }
    rollback() {
        if (!this._targets) return;
        for (const t of this._targets) {
            if (t.prev === undefined) delete t.note._fn;
            else t.note._fn = t.prev;
        }
    }
}

// ── Move-to-string helpers ──────────────────────────────────────────
// Standard open-string MIDI pitches (low → high, string index order).
// Guitar E2=40 A2=45 D3=50 G3=55 B3=59 e4=64; extended low strings
// prepend B1=35 (7-str) and F#1=30 (8-str).
// Bass  E1=28 A1=33 D2=38 G2=43; extended: B0=23 low, C3=48 high.
// These match the chart's own pitch reference so that fret=0 on each
// string resolves to the correct open-string MIDI note.
const _GUITAR_OPEN_MIDI = [40, 45, 50, 55, 59, 64]; // 6-string standard
const _BASS_OPEN_MIDI   = [28, 33, 38, 43];           // 4-string standard

// Return the open-string MIDI array for the active arrangement,
// extended/trimmed to `laneCount` strings. Extended-range strings
// are prepended at the low end (matching how AddStringCmd works).
function _openMidiForArr(arr, laneCount) {
    const isBass = /bass/i.test(arr.name || '');
    const base = isBass ? _BASS_OPEN_MIDI.slice() : _GUITAR_OPEN_MIDI.slice();
    // Extend low end: each additional low string is 5 semitones below
    // the current lowest (perfect 4th), matching standard guitar/bass
    // tuning intervals. 6-string bass high-C is a special case handled
    // by appending at the high end instead.
    while (base.length < laneCount) {
        if (isBass && base.length === 5) {
            // 6-string bass: high C (MIDI 48) above G (43)
            base.push(48);
        } else {
            base.unshift(base[0] - 5);
        }
    }
    // Trim in case laneCount is less than baseline (shouldn't occur
    // in practice, but guards against unexpected arrangements).
    return base.slice(0, laneCount);
}

// Compute the absolute pitch (MIDI) of a note given the arrangement's
// tuning offsets.  `openMidi[s]` is the standard open-string pitch for
// string `s`; `arr.tuning[s]` is the per-string semitone offset from
// standard (e.g. −2 for Drop D on string 0, 0 for standard).
function _absolutePitch(openMidi, tuning, stringIdx, fret) {
    const offset = (Array.isArray(tuning) && tuning[stringIdx] !== undefined)
        ? (Number(tuning[stringIdx]) || 0)
        : 0;
    return openMidi[stringIdx] + offset + fret;
}

// Try to move a single note to an adjacent string while preserving its
// absolute pitch.  `direction` is +1 (higher string index) or -1 (lower).
// Returns { targetString, targetFret } when valid, or null when the
// resulting fret would be out of range [0, 24] or the target string
// doesn't exist.
function _getMoveStringResult(noteIdx, direction) {
    if (isKeysMode()) return null;          // keys mode: no string concept
    const arr = S.arrangements[S.currentArr];
    if (!arr) return null;
    const n = notes()[noteIdx];
    if (!n) return null;

    const laneCount = _stringCountFor(arr);
    const targetString = n.string + direction;
    if (targetString < 0 || targetString >= laneCount) return null;

    // Normalise tuning length to laneCount (mirrors _normalizeTuningToLanes
    // but non-destructively — we only need the values, not to mutate arr).
    const rawTuning = Array.isArray(arr.tuning) ? arr.tuning : [];
    const tuning = rawTuning.slice(0, laneCount);
    while (tuning.length < laneCount) tuning.push(0);

    const openMidi = _openMidiForArr(arr, laneCount);
    const pitch    = _absolutePitch(openMidi, tuning, n.string, n.fret);
    const targetOffset = (Number(tuning[targetString]) || 0);
    const targetFret   = pitch - openMidi[targetString] - targetOffset;

    if (!Number.isInteger(targetFret) || targetFret < 0 || targetFret > 24) return null;
    return { targetString, targetFret };
}

// Return true when every note in the current selection can move one
// string in `direction` without leaving the fret range [0, 24].
function _canMoveString(direction) {
    if (!S.sel || S.sel.size === 0) return false;
    if (isKeysMode()) return false;
    for (const idx of S.sel) {
        if (_getMoveStringResult(idx, direction) === null) return false;
    }
    return true;
}

// Undo-able command: move a set of notes to adjacent strings, adjusting
// frets to preserve absolute pitch.  `moves` is an array of
// { index, oldString, oldFret, newString, newFret }.
class MoveToStringCmd {
    constructor(moves) { this.moves = moves; }
    exec() {
        const nn = notes();
        for (const m of this.moves) {
            nn[m.index].string = m.newString;
            nn[m.index].fret   = m.newFret;
        }
    }
    rollback() {
        const nn = notes();
        for (const m of this.moves) {
            nn[m.index].string = m.oldString;
            nn[m.index].fret   = m.oldFret;
        }
    }
}

// Build the MoveToStringCmd payload and execute it for all selected notes.
function _execMoveString(direction) {
    const nn = notes();
    const moves = [];
    for (const idx of S.sel) {
        const n = nn[idx];
        const result = _getMoveStringResult(idx, direction);
        if (!result) return; // guard — shouldn't happen if menu item was enabled
        moves.push({
            index:     idx,
            oldString: n.string,
            oldFret:   n.fret,
            newString: result.targetString,
            newFret:   result.targetFret,
        });
    }
    if (!moves.length) return;
    S.history.exec(new MoveToStringCmd(moves));
    draw();
    _renderInspector();
}

// Extend an arrangement's string count by one. `position` is 'low' for
// adding at the lowest end (guitar low B/F#, 4→5-string bass low B) and
// 'high' for adding at the high end (5→6-string bass high C). Adding at
// the low end shifts every existing note's string index up by 1 so the
// chart visually stays put — only the new lowest lane is empty.
// Layout side-effect for any command that changes `lanes()`. Pulled
// out so AddStringCmd / RemoveStringCmd exec & rollback can drive a
// LANE_H recomputation on Ctrl-Z / Ctrl-Y too. Takes the target
// arrangement index because undo/redo may fire after the user has
// switched to a different arrangement — only resize when the
// mutation hits the visible chart, so we don't mis-size LANE_H on
// behalf of an off-screen arrangement.
//
// We defer to the next animation frame so the click-handler reflow
// completes before resizeCanvas reads `wrap.clientHeight`. Calling
// inline can hit a transient layout where the read returns 0; the
// early-return inside resizeCanvas then skips the LANE_H update,
// extra lanes overflow the canvas, and the new string isn't visible
// until the next legitimate resize event (e.g. screen-change observer).
function _resizeForLaneChange(arrIdx) {
    if (typeof resizeCanvas !== 'function') return;
    if (arrIdx !== undefined && arrIdx !== S.currentArr) return;
    requestAnimationFrame(() => resizeCanvas());
}

// Normalize `arr.tuning` so its length equals the arrangement's *real*
// string count instead of the RS-XML padded length (which is always 6
// for both 4-string bass and 6-string guitar). Without this, an
// add-string on a 4-string bass loaded from RS XML would treat the
// padded 6-slot tuning as 6 real strings and extend to 7. We slice
// excess zero-tail padding when tuning.length > realCount and pad
// when shorter. Idempotent — safe to call before every mutation.
function _normalizeTuningToLanes(arr, realCount) {
    let t = Array.isArray(arr.tuning) ? arr.tuning.slice() : [];
    if (t.length > realCount) {
        // Drop trailing zeros first (RS-XML padding). Callers compute
        // `realCount` via `_stringCountFor(arr)` which already factors
        // in any non-zero high-index offsets, so anything left after
        // that trim is stale and the explicit slice below honours the
        // length contract.
        while (t.length > realCount && t[t.length - 1] === 0) {
            t.pop();
        }
        if (t.length > realCount) {
            t = t.slice(0, realCount);
        }
    }
    while (t.length < realCount) t.push(0);
    arr.tuning = t;
}

class AddStringCmd {
    constructor(arrIdx, position) {
        this.arrIdx = arrIdx;
        this.position = position;
    }
    _arr() { return S.arrangements[this.arrIdx]; }
    exec() {
        const arr = this._arr();
        // Normalize against `_stringCountFor(arr)` rather than the
        // global `lanes()` which reads from `S.currentArr`. Undo/redo
        // can fire after the user has switched arrangements, so we
        // must compute the count against the command's TARGET arr.
        _normalizeTuningToLanes(arr, _stringCountFor(arr));
        const tuning = arr.tuning.slice();
        if (this.position === 'low') {
            tuning.unshift(0);
            for (const n of arr.notes || []) n.string += 1;
            for (const ch of arr.chords || []) {
                for (const cn of ch.notes || []) cn.string += 1;
            }
            for (const ct of arr.chord_templates || []) {
                if (Array.isArray(ct.frets)) ct.frets.unshift(-1);
                if (Array.isArray(ct.fingers)) ct.fingers.unshift(-1);
            }
        } else {
            tuning.push(0);
            for (const ct of arr.chord_templates || []) {
                if (Array.isArray(ct.frets)) ct.frets.push(-1);
                if (Array.isArray(ct.fingers)) ct.fingers.push(-1);
            }
        }
        arr.tuning = tuning;
        // Bump the explicit extension counter so lanes() / the save
        // detection function don't have to guess when tuning.length
        // happens to be 6 (the ambiguous bass-padded-or-real-6 case).
        arr._extendedStrings = (arr._extendedStrings || 0) + 1;
        _resizeForLaneChange(this.arrIdx);
    }
    rollback() {
        const arr = this._arr();
        const tuning = Array.isArray(arr.tuning) ? arr.tuning.slice() : [0, 0, 0, 0, 0, 0];
        if (this.position === 'low') {
            tuning.shift();
            for (const n of arr.notes || []) n.string -= 1;
            for (const ch of arr.chords || []) {
                for (const cn of ch.notes || []) cn.string -= 1;
            }
            for (const ct of arr.chord_templates || []) {
                if (Array.isArray(ct.frets)) ct.frets.shift();
                if (Array.isArray(ct.fingers)) ct.fingers.shift();
            }
        } else {
            tuning.pop();
            for (const ct of arr.chord_templates || []) {
                if (Array.isArray(ct.frets)) ct.frets.pop();
                if (Array.isArray(ct.fingers)) ct.fingers.pop();
            }
        }
        arr.tuning = tuning;
        // AddStringCmd's rollback undoes a prior add, so decrement.
        arr._extendedStrings = Math.max(0, (arr._extendedStrings || 0) - 1);
        _resizeForLaneChange(this.arrIdx);
    }
}

// Remove a string from the active arrangement. `position === 'low'` peels
// off the low extension (guitar 7→6 / 8→7, bass 5→4); `position === 'high'`
// peels the high C off a 6-string bass — the editor exposes both via the
// Strings modal. Callers must first verify no notes live on the targeted
// string (validation lives in the UI handler so the user gets a clear
// error message in the modal rather than a silent data drop here).
class RemoveStringCmd {
    constructor(arrIdx, position) {
        this.arrIdx = arrIdx;
        this.position = position;
        // Snapshots filled in by exec() — keeping them off the
        // constructor means instantiation is a pure data move. If a
        // future code path ever builds a RemoveStringCmd without
        // running it (e.g. for previewing), the live arrangement
        // stays untouched.
        this.removedOffset = 0;
        this.removedTemplateCols = [];
    }
    _arr() { return S.arrangements[this.arrIdx]; }
    exec() {
        const arr = this._arr();
        // Normalize tuning to the real string count first so the
        // snapshot reflects the actual column we're dropping, not an
        // RS-XML padding zero. Snapshot happens immediately after so
        // rollback can restore the exact pre-remove state. Use
        // `_stringCountFor(arr)` (not `lanes()`) so undo/redo after
        // an arrangement switch still operates on this command's
        // TARGET arrangement.
        _normalizeTuningToLanes(arr, _stringCountFor(arr));
        const t = arr.tuning || [];
        this.removedOffset = this.position === 'low' ? t[0] : t[t.length - 1];
        this.removedTemplateCols = (arr.chord_templates || []).map(ct => {
            const fretLen = Array.isArray(ct.frets) ? ct.frets.length : 0;
            const fingerLen = Array.isArray(ct.fingers) ? ct.fingers.length : 0;
            // Empty arrays would otherwise yield colIdx == -1, store
            // `undefined`, and push that back as the rollback value —
            // corrupting the template on undo. Fall back to -1 when
            // the column doesn't exist.
            const fretCol = this.position === 'low' ? 0 : fretLen - 1;
            const fingerCol = this.position === 'low' ? 0 : fingerLen - 1;
            return {
                fret: fretLen > 0 && fretCol >= 0 ? ct.frets[fretCol] : -1,
                finger: fingerLen > 0 && fingerCol >= 0 ? ct.fingers[fingerCol] : -1,
            };
        });
        const tuning = arr.tuning.slice();
        if (this.position === 'low') {
            tuning.shift();
            for (const n of arr.notes || []) n.string -= 1;
            for (const ch of arr.chords || []) {
                for (const cn of ch.notes || []) cn.string -= 1;
            }
            for (const ct of arr.chord_templates || []) {
                if (Array.isArray(ct.frets)) ct.frets.shift();
                if (Array.isArray(ct.fingers)) ct.fingers.shift();
            }
        } else {
            tuning.pop();
            for (const ct of arr.chord_templates || []) {
                if (Array.isArray(ct.frets)) ct.frets.pop();
                if (Array.isArray(ct.fingers)) ct.fingers.pop();
            }
        }
        arr.tuning = tuning;
        arr._extendedStrings = Math.max(0, (arr._extendedStrings || 0) - 1);
        _resizeForLaneChange(this.arrIdx);
    }
    rollback() {
        const arr = this._arr();
        const tuning = arr.tuning.slice();
        const restore = (ct, i) => {
            const cols = this.removedTemplateCols[i] || { fret: -1, finger: -1 };
            return cols;
        };
        if (this.position === 'low') {
            tuning.unshift(this.removedOffset);
            for (const n of arr.notes || []) n.string += 1;
            for (const ch of arr.chords || []) {
                for (const cn of ch.notes || []) cn.string += 1;
            }
            (arr.chord_templates || []).forEach((ct, i) => {
                const cols = restore(ct, i);
                if (Array.isArray(ct.frets)) ct.frets.unshift(cols.fret);
                if (Array.isArray(ct.fingers)) ct.fingers.unshift(cols.finger);
            });
        } else {
            tuning.push(this.removedOffset);
            (arr.chord_templates || []).forEach((ct, i) => {
                const cols = restore(ct, i);
                if (Array.isArray(ct.frets)) ct.frets.push(cols.fret);
                if (Array.isArray(ct.fingers)) ct.fingers.push(cols.finger);
            });
        }
        arr.tuning = tuning;
        // RemoveStringCmd's rollback restores the removed string, so
        // re-increment the extension counter (mirrors AddStringCmd.exec).
        arr._extendedStrings = (arr._extendedStrings || 0) + 1;
        _resizeForLaneChange(this.arrIdx);
    }
}

/* @pure:replace-chart:start */
// The chart fields ReplaceArrangementChartCmd swaps out — everything tied to
// the note content of an arrangement. Song-level timing (beats/sections/audio)
// and the arrangement's identity (name, tones) are deliberately NOT here.
const _REPLACE_CHART_FIELDS = [
    'notes', 'chords', 'chord_templates', 'tuning', 'capo',
    '_extendedStrings', 'anchors_user', 'anchors', 'handshapes',
];

// Overwrite `arr`'s chart from a freshly imported `incoming` arrangement while
// keeping `arr`'s name (so keys/bass mode detection stays stable). Returns a
// snapshot for _restoreChartFields() to roll back exactly. Pure (no S / DOM) so
// it's unit-testable. Snapshots whole values/arrays by reference — never by
// index — so undo survives an arrangement switch.
function _swapChartFields(arr, incoming) {
    const snap = {};
    for (const k of _REPLACE_CHART_FIELDS) snap[k] = arr[k];
    // Force the swapped-in chart to carry the target's display name (callers
    // set this too; belt-and-braces so a stray incoming.name can't rename the
    // arrangement or flip its keys/bass rendering mode).
    incoming.name = arr.name;
    // Deep-copy the incoming chart so the arrangement owns INDEPENDENT arrays.
    // The command flattens chords into `notes` in place after this, and redo
    // re-runs the swap from the SAME `incoming` object — sharing references
    // would bake the flattened chord notes back into `incoming` and duplicate
    // them on the next flatten/save. Chart data is plain and JSON-safe.
    const clone = (v) => (v == null ? v : JSON.parse(JSON.stringify(v)));
    arr.notes = clone(incoming.notes) || [];
    arr.chords = clone(incoming.chords) || [];
    arr.chord_templates = clone(incoming.chord_templates) || [];
    if (Array.isArray(incoming.tuning)) arr.tuning = clone(incoming.tuning);
    if (typeof incoming.capo === 'number') arr.capo = incoming.capo;
    // These were derived from the OLD notes: `_extendedStrings` tracked the old
    // tuning's lane count (let _stringCountFor re-derive from the new tuning);
    // `anchors_user`/`anchors` were hand positions at old fret/note positions
    // (the backend re-computes anchors from the new notes on save when there's
    // no authored `anchors_user`); handshapes referenced old chord instances.
    // `arr.phrases` is deliberately KEPT — phrases are time-anchored to the
    // song's sections (which this swap does not touch) and their per-level notes
    // repopulate from the new chart on save (_repopulate_phrase_levels).
    delete arr._extendedStrings;
    delete arr.anchors_user;
    delete arr.anchors;
    delete arr.handshapes;
    return snap;
}

// Restore a snapshot from _swapChartFields(). A field absent (undefined) in the
// pre-swap arrangement is deleted, not set to undefined, so the object shape
// round-trips exactly.
function _restoreChartFields(arr, snap) {
    for (const k of Object.keys(snap)) {
        if (snap[k] === undefined) delete arr[k];
        else arr[k] = snap[k];
    }
}
/* @pure:replace-chart:end */

// Replace an existing arrangement's CHART (notes/chords/templates/tuning) with a
// freshly imported guitar/bass chart, keeping the arrangement's name, tones, and
// the song-level timeline. Undoable within the session (one step); the save
// round-trip resets history, so a snapshot-based rollback is all this needs.
class ReplaceArrangementChartCmd {
    constructor(arrIdx, incoming) {
        this.arrIdx = arrIdx;
        this.incoming = incoming;
        this._snap = null;
    }
    _arr() { return S.arrangements[this.arrIdx]; }
    exec() {
        const arr = this._arr();
        this._snap = _swapChartFields(arr, this.incoming);
        // Fold the imported chords into `notes` (the editor's live model keeps
        // the active chart flattened). Doing it INSIDE exec — on the target arr,
        // from a fresh deep copy — means a redo reproduces the identical state
        // and never double-flattens.
        _flattenArrChords(arr);
        // The new chart may change the lane count (4↔5/6 bass, 6↔7/8 guitar), so
        // recompute LANE_H if the target is the visible arrangement (rAF-guarded;
        // no-op otherwise). Covers redo; the initial import also resizes from the
        // handler after it switches S.currentArr.
        _resizeForLaneChange(this.arrIdx);
    }
    rollback() {
        _restoreChartFields(this._arr(), this._snap);
        _resizeForLaneChange(this.arrIdx);
    }
}

// ════════════════════════════════════════════════════════════════════
// Mouse interactions
// ════════════════════════════════════════════════════════════════════

function getMousePos(e) {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
}

function onMouseDown(e) {
    const { x, y } = getMousePos(e);
    hideContextMenu();
    hideAddNote();

    // Middle button = pan
    if (e.button === 1) {
        e.preventDefault();
        S.drag = { type: 'pan', startX: x, origScroll: S.scrollX };
        return;
    }

    // Right button = context menu (handled in onContextMenu)
    if (e.button === 2) return;

    // Drum-edit mode hijacks the left click so the lane-grid editor can
    // add/remove/select hits without going through the guitar-arrangement
    // click pipeline below (which would crash on a missing
    // S.arrangements[currentArr]).
    if (S.drumEditMode && S.drumTab) {
        _drumEditorOnMouseDown(e, x, y);
        return;
    }

    // Tempo Map mode hijacks the left click for sync-point editing.
    if (S.tempoMapMode) {
        _tempoMapOnMouseDown(e, x, y);
        return;
    }

    // Tone lane sits in the top TONE_LANE_H px (an overlay on the
    // waveform's top edge). Hijack the click before the waveform-seek
    // handler so add/move/select-marker interactions work.
    if (y >= 0 && y < TONE_LANE_H && S.arrangements && S.arrangements.length) {
        if (onToneLaneMouseDown(e, x)) return;
    }
    // Anchor lane sits below the beat bar.
    if (S.arrangements && S.arrangements.length) {
        const anchorTop = _anchorLaneTopY();
        if (y >= anchorTop && y < anchorTop + ANCHOR_LANE_H) {
            if (onAnchorLaneMouseDown(e, x, y)) return;
        }
    }
    // Handshape lane sits directly below the anchor lane.
    if (S.arrangements && S.arrangements.length) {
        const hsTop = _handshapeLaneTopY();
        if (y >= hsTop && y < hsTop + HS_LANE_H) {
            if (onHandshapeLaneMouseDown(e, x, y)) return;
        }
    }
    // Beat bar (bottom measure strip) → drag-select a bar range for the
    // "Loop in 3D" handoff. Left button only; right-click still opens the
    // section menu via onContextMenu.
    if (e.button === 0 && S.beats.length) {
        const bbTop = _beatBarTopY();
        if (y >= bbTop && y < bbTop + BEAT_H) {
            const t = xToTime(x);
            S.drag = { type: 'barsel', startTime: t };
            S.barSel = _barSpanForTimes(t, t);
            draw();
            return;
        }
    }
    // Click outside the tone lane → clear the tone selection so the
    // next Del press targets the note path instead of the previously
    // selected tone marker.
    if (S.toneSel !== null) {
        S.toneSel = null;
        // No explicit `draw()` here — the surrounding mouse-down path
        // already triggers one for the new interaction.
    }
    // Same story for anchor selection — a stale `S.anchorSel` would
    // otherwise hijack the next Del press from the note delete path.
    if (S.anchorSel !== null) {
        S.anchorSel = null;
    }
    // …and the handshape selection (the handshape-lane mousedown returns
    // early, so a click reaching here is outside that lane).
    if (S.handshapeSel !== null) {
        S.handshapeSel = null;
    }

    // Left button
    if (y < WAVEFORM_H) {
        // Block waveform seek while recording: restarting the AudioBufferSourceNode
        // would fire onended and prematurely finalize the take.
        if (_recState === 'recording') return;
        // Click on waveform = set cursor
        S.cursorTime = Math.max(0, xToTime(x));
        if (S.playing) { stopPlayback(); startPlayback(); }
        draw();
        return;
    }

    // Block note editing while recording: mid-take edits to arr.notes would be
    // silently overwritten by _recNotes when the take is finalized on Stop.
    if (_recState === 'recording') return;

    // Check for sustain edge grab first
    const edgeIdx = hitNoteEdge(x, y);
    if (edgeIdx >= 0) {
        const nn = notes();
        const resizeIndices = _resizeTargetIndicesPure(nn, edgeIdx, !isKeysMode() && !e.altKey);
        const allResizeSelected = resizeIndices.every(i => S.sel.has(i));
        if (!allResizeSelected) {
            S.sel.clear();
            for (const i of resizeIndices) S.sel.add(i);
        }
        const n = nn[edgeIdx];
        S.drag = {
            type: 'resize',
            noteIdx: edgeIdx,
            indices: resizeIndices,
            startX: x,
            origSustain: n.sustain || 0,
            origSustains: resizeIndices.map(i => nn[i].sustain || 0),
        };
        draw();
        return;
    }

    const idx = hitNote(x, y);

    if (idx >= 0) {
        // Click on note — also select all chord siblings (same time).
        // In keys mode same-timestamp notes are independent voices (not
        // a strummed chord), so skip the sibling expansion.
        const nn = notes();
        const clickedTime = nn[idx].time;
        const chordSiblings = [idx];
        if (!isKeysMode()) {
            for (let i = 0; i < nn.length; i++) {
                if (i !== idx && Math.abs(nn[i].time - clickedTime) < 0.001) chordSiblings.push(i);
            }
        }

        if (e.shiftKey) {
            // Multi-select toggle — toggle the whole chord group
            const allSelected = chordSiblings.every(i => S.sel.has(i));
            for (const i of chordSiblings) {
                if (allSelected) S.sel.delete(i); else S.sel.add(i);
            }
        } else if (!S.sel.has(idx)) {
            S.sel.clear();
            for (const i of chordSiblings) S.sel.add(i);
        }

        // Start drag
        const selArr = [...S.sel];
        S.drag = {
            type: 'move',
            startX: x, startY: y,
            origTimes: selArr.map(i => nn[i].time),
            origStrings: selArr.map(i => nn[i].string),
            origFrets: selArr.map(i => nn[i].fret),
            indices: selArr,
            moved: false,
        };
        draw();
    } else {
        // Click on empty space = start selection rect or deselect
        if (!e.shiftKey) S.sel.clear();
        S.drag = {
            type: 'select',
            startX: x, startY: y,
            curX: x, curY: y,
        };
        draw();
    }
}

function onMouseMove(e) {
    const { x, y } = getMousePos(e);
    // Activate the lane cache for the handler's lifetime so per-note
    // hit-test helpers (`hitNoteEdge` / `hitNote` → `strToY` →
    // `strToLane` → `lanes()`) stay O(1) per note instead of O(N).
    // A local `const L = lanes()` alone doesn't help those nested
    // calls; the global cache does. Cleared in `finally` so any
    // exception unwinding the handler doesn't leak the flag.
    const _prevActive = _lanesCacheActive;
    const _prevValue = _lanesCacheValue;
    _lanesCacheActive = false;
    _lanesCacheValue = lanes();
    const L = _lanesCacheValue;
    _lanesCacheActive = true;
    try {
        _onMouseMoveBody(e, x, y, L);
    } finally {
        _lanesCacheActive = _prevActive;
        _lanesCacheValue = _prevValue;
    }
}

function _onMouseMoveBody(e, x, y, L) {

    if (_loopStripOnMouseMove(e)) return;

    // Bar-range drag on the beat bar — re-snap the span to the cursor.
    if (S.drag && S.drag.type === 'barsel') {
        S.barSel = _barSpanForTimes(S.drag.startTime, xToTime(x));
        draw();
        return;
    }

    // Tone-marker drag — hijack before any of the existing
    // drag-handler branches so the marker tracks the cursor.
    if (S.drag && S.drag.type === 'tone') {
        onToneLaneMouseMove(e, x);
        return;
    }
    if (S.drag && S.drag.type === 'anchor') {
        onAnchorLaneMouseMove(e, x);
        return;
    }
    if (S.drag && S.drag.type === 'handshape') {
        onHandshapeLaneMouseMove(e, x);
        return;
    }

    // Cursor hint when not dragging
    if (!S.drag) {
        // In drum-edit mode the guitar/keys hover logic (hitNoteEdge) is
        // irrelevant and shows misleading resize cursors over the drum grid.
        if (S.drumEditMode && S.drumTab) {
            if (canvas) canvas.style.cursor = '';
            return;
        }
        // Tempo-map mode: highlight the sync-point pole under the cursor.
        if (S.tempoMapMode) {
            const hit = _tempoSyncAtX(x, y);
            if (hit !== S.tempoHover) { S.tempoHover = hit; draw(); }
            if (canvas) canvas.style.cursor = hit >= 0 ? 'ew-resize' : '';
            return;
        }
        // Beat bar (bottom measure strip) → text-ish cursor to signal it's
        // drag-to-select-bars for "Loop in 3D".
        const bbTop = _beatBarTopY();
        if (canvas && S.beats.length && y >= bbTop && y < bbTop + BEAT_H) {
            canvas.style.cursor = 'col-resize';
        } else if (canvas && y >= WAVEFORM_H && y < WAVEFORM_H + L * LANE_H) {
            canvas.style.cursor = hitNoteEdge(x, y) >= 0 ? 'ew-resize' : '';
        } else if (canvas) {
            canvas.style.cursor = '';
        }
        return;
    }

    if (S.drag.type === 'pan') {
        const dx = x - S.drag.startX;
        S.scrollX = _editorClampScrollX(S.drag.origScroll - dx / S.zoom);
        draw();
        return;
    }

    // Drum-edit drag: move every selected hit in time and lane in lockstep.
    if (S.drag.type === 'drum-move') {
        _drumEditorOnDragMove(x, y);
        draw();
        return;
    }

    // Drum-edit marquee: track the rubber-band rect; flip `moved` once the
    // pointer has left the click threshold so mouseup knows it's a box
    // select rather than an add-hit click.
    if (S.drag.type === 'drum-select') {
        S.drag.curX = x;
        S.drag.curY = y;
        // Euclidean threshold so a diagonal drag (e.g. dx=dy=2.5, ~3.5px)
        // counts as a marquee, not a click — a per-axis check would miss it.
        const ddx = x - S.drag.startX;
        const ddy = y - S.drag.startY;
        if (ddx * ddx + ddy * ddy > 9) S.drag.moved = true;
        draw();
        return;
    }

    // Tempo-map drag: re-space the two measures around the dragged pole.
    if (S.drag.type === 'tempo-sync') {
        _tempoMapOnDragMove(x);
        return;
    }

    if (S.drag.type === 'select') {
        S.drag.curX = x;
        S.drag.curY = y;
        draw();
        return;
    }

    if (S.drag.type === 'resize') {
        const dt = (x - S.drag.startX) / S.zoom;
        const nn = notes();
        const nextSustains = _resizeSustainsForDeltaPure(
            nn, S.drag.indices, S.drag.origSustain, dt);
        for (let i = 0; i < S.drag.indices.length; i++) {
            nn[S.drag.indices[i]].sustain = nextSustains[i];
        }
        draw();
        return;
    }

    if (S.drag.type === 'move') {
        S.drag.moved = true;
        const nn = notes();
        const dt = (x - S.drag.startX) / S.zoom;
        const dy = y - S.drag.startY;

        if (isKeysMode()) {
            const dMidi = -Math.round(dy / PIANO_LANE_H);
            for (let i = 0; i < S.drag.indices.length; i++) {
                const ni = S.drag.indices[i];
                let newTime = S.drag.origTimes[i] + dt;
                newTime = snapTime(Math.max(0, newTime));
                nn[ni].time = newTime;

                const origMidi = noteToMidi(S.drag.origStrings[i], S.drag.origFrets[i]);
                const newMidi = Math.max(0, Math.min(143, origMidi + dMidi));
                nn[ni].string = midiToString(newMidi);
                nn[ni].fret = midiToFret(newMidi);
            }
        } else {
            const dLanes = Math.round(dy / LANE_H);
            for (let i = 0; i < S.drag.indices.length; i++) {
                const ni = S.drag.indices[i];
                let newTime = S.drag.origTimes[i] + dt;
                newTime = snapTime(Math.max(0, newTime));
                nn[ni].time = newTime;

                const origLane = strToLane(S.drag.origStrings[i]);
                // Reuse the locally-cached `L` from onMouseMove instead of
                // calling lanes() per dragged note.
                const newLane = Math.max(0, Math.min(L - 1, origLane + dLanes));
                nn[ni].string = laneToStr(newLane);
            }
        }
        draw();
    }
}

function onMouseUp(e) {
    if (!S.drag) return;
    if (_loopStripOnMouseUp()) return;
    const { x, y } = getMousePos(e);

    // Bar-range select finalise — refresh the Loop-in-3D button state.
    if (S.drag.type === 'barsel') {
        S.drag = null;
        _updateLoopIn3DBtn();
        draw();
        return;
    }

    // Drum-edit drag finalise: sort hits, remap selection indices, clear
    // S.drag. No undo command — out of scope for the initial drum editor
    // PR (would need a DrumMoveCmd that captures origTimes/origPieces).
    if (S.drag.type === 'drum-move') {
        _drumEditorOnDragEnd();
        return;
    }

    if (S.drag.type === 'drum-select') {
        _drumEditorOnSelectEnd();
        return;
    }

    if (S.drag.type === 'tempo-sync') {
        _tempoMapOnDragEnd();
        return;
    }

    if (S.drag.type === 'tone') {
        onToneLaneMouseUp();
        return;
    }

    if (S.drag.type === 'anchor') {
        onAnchorLaneMouseUp();
        return;
    }

    if (S.drag.type === 'handshape') {
        onHandshapeLaneMouseUp();
        return;
    }

    if (S.drag.type === 'resize') {
        const nn = notes();
        const finalSustains = S.drag.indices.map(i => nn[i].sustain || 0);
        // Revert so the command can apply the grouped edit as one undo step.
        for (let i = 0; i < S.drag.indices.length; i++) {
            nn[S.drag.indices[i]].sustain = S.drag.origSustains[i];
        }
        const changed = finalSustains.some((v, i) => v !== S.drag.origSustains[i]);
        if (changed) {
            S.history.exec(new ResizeSustainGroupCmd(S.drag.indices, finalSustains));
        }
    }

    if (S.drag.type === 'move' && S.drag.moved) {
        // Commit move as undo command
        const nn = notes();
        const dtimes = S.drag.indices.map((ni, i) => nn[ni].time - S.drag.origTimes[i]);
        const dstrings = S.drag.indices.map((ni, i) => nn[ni].string - S.drag.origStrings[i]);
        const dfrets = isKeysMode()
            ? S.drag.indices.map((ni, i) => nn[ni].fret - S.drag.origFrets[i])
            : null;

        // Revert to original first so exec() applies the delta
        for (let i = 0; i < S.drag.indices.length; i++) {
            nn[S.drag.indices[i]].time = S.drag.origTimes[i];
            nn[S.drag.indices[i]].string = S.drag.origStrings[i];
            if (dfrets) nn[S.drag.indices[i]].fret = S.drag.origFrets[i];
        }
        S.history.exec(new MoveNoteCmd(S.drag.indices, dtimes, dstrings, dfrets));
    }

    if (S.drag.type === 'select') {
        // Select notes inside rectangle
        const x1 = Math.min(S.drag.startX, S.drag.curX);
        const y1 = Math.min(S.drag.startY, S.drag.curY);
        const x2 = Math.max(S.drag.startX, S.drag.curX);
        const y2 = Math.max(S.drag.startY, S.drag.curY);

        const nn = notes();
        const keysMode = isKeysMode();
        for (let i = 0; i < nn.length; i++) {
            const nx = timeToX(nn[i].time);
            let ny;
            if (keysMode) {
                const midi = noteToMidi(nn[i].string, nn[i].fret);
                ny = midiToY(midi) + PIANO_LANE_H / 2;
            } else {
                ny = strToY(nn[i].string) + LANE_H / 2;
            }
            if (nx >= x1 && nx <= x2 && ny >= y1 && ny <= y2) {
                S.sel.add(i);
            }
        }
    }

    S.drag = null;
    draw();
    updateStatus();
}

function onDblClick(e) {
    if (S.drumEditMode || S.tempoMapMode) return;  // those modes own canvas interaction
    if (_recState === 'recording') return;  // block note addition during active take
    const { x, y } = getMousePos(e);
    const keysMode = isKeysMode();
    const laneBottom = keysMode
        ? WAVEFORM_H + pianoLaneCount() * PIANO_LANE_H
        : WAVEFORM_H + lanes() * LANE_H;
    if (y < WAVEFORM_H || y > laneBottom) return;

    const idx = hitNote(x, y);
    if (idx >= 0) return; // double-click on existing note = no-op

    // Show add-note dialog
    const t = snapTime(Math.max(0, xToTime(x)));
    if (keysMode) {
        const midi = yToMidi(y);
        showAddNote(e.clientX, e.clientY, t, midiToString(midi), midiToFret(midi));
    } else {
        const s = yToStr(y);
        showAddNote(e.clientX, e.clientY, t, s);
    }
}

function onWheel(e) {
    e.preventDefault();
    if (e.ctrlKey) {
        // Ctrl+scroll = zoom
        const { x } = getMousePos(e);
        const timeBefore = xToTime(x);
        const factor = e.deltaY < 0 ? 1.15 : 0.87;
        S.zoom = Math.max(20, Math.min(2000, S.zoom * factor));
        // Keep the time under cursor stable
        S.scrollX = timeBefore - (x - LABEL_W) / S.zoom;
        S.scrollX = _editorClampScrollX(S.scrollX);
    } else {
        // Scroll = pan
        S.scrollX = _editorClampScrollX(S.scrollX + e.deltaY / S.zoom * 2);
    }
    updateZoomDisplay();
    draw();
}


const EDITOR_SHORTCUT_PROFILE_KEY = 'editor.shortcutProfile';
const EDITOR_RIGHT_CLICK_BEHAVIOR_KEY = 'editor.rightClickBehavior';
const EDITOR_SHORTCUT_PROFILES = new Set(['feedback', 'eof']);
const EDITOR_RIGHT_CLICK_BEHAVIORS = new Set(['context', 'eofEdit']);
let editorShortcutProfile = 'feedback';
let editorRightClickBehavior = null;
let editorWaveformVisible = true;

/* @pure:shortcut-profile:start */
function _editorKeySigPure(e) {
    const mods = [];
    if (e.ctrlKey || e.metaKey) mods.push('Ctrl');
    if (e.shiftKey) mods.push('Shift');
    if (e.altKey) mods.push('Alt');
    let key = e.key || '';
    if (key.length === 1) key = key.toUpperCase();
    return mods.concat(key).join('+');
}

const EDITOR_SHORTCUT_COMMANDS = Object.freeze([
    { id: 'save', label: 'Save project', group: 'File', status: 'ready', keys: { feedback: 'Ctrl+S', eof: 'F2 / Ctrl+S' } },
    { id: 'toggleWaveform', label: 'Show/hide waveform', group: 'View', status: 'ready', keys: { feedback: 'W', eof: 'F5' } },
    { id: 'importMidi', label: 'Import MIDI / keys', group: 'File', status: 'ready', keys: { feedback: '', eof: 'F6' } },
    { id: 'importXml', label: 'Import XML source', group: 'File', status: 'ready', keys: { feedback: '', eof: 'F7' } },
    { id: 'importGp', label: 'Import Guitar Pro source', group: 'File', status: 'ready', keys: { feedback: '', eof: 'F12' } },
    { id: 'prevBeat', label: 'Jump to previous beat', group: 'Timeline', status: 'ready', keys: { feedback: 'Page Up', eof: 'Page Up' } },
    { id: 'nextBeat', label: 'Jump to next beat', group: 'Timeline', status: 'ready', keys: { feedback: 'Page Down', eof: 'Page Down' } },
    { id: 'prevNote', label: 'Jump to previous note', group: 'Timeline', status: 'ready', keys: { feedback: 'Alt+Left', eof: 'Shift+Page Up' } },
    { id: 'nextNote', label: 'Jump to next note', group: 'Timeline', status: 'ready', keys: { feedback: 'Alt+Right', eof: 'Shift+Page Down' } },
    { id: 'prevGrid', label: 'Jump to previous grid line', group: 'Timeline', status: 'ready', keys: { feedback: 'Ctrl+Page Up', eof: 'Ctrl+Shift+Page Up' } },
    { id: 'nextGrid', label: 'Jump to next grid line', group: 'Timeline', status: 'ready', keys: { feedback: 'Ctrl+Page Down', eof: 'Ctrl+Shift+Page Down' } },
    { id: 'prevAnchor', label: 'Jump to previous anchor', group: 'Timeline', status: 'ready', keys: { feedback: 'Ctrl+Alt+Left', eof: 'Alt+Page Up' } },
    { id: 'nextAnchor', label: 'Jump to next anchor', group: 'Timeline', status: 'ready', keys: { feedback: 'Ctrl+Alt+Right', eof: 'Alt+Page Down' } },
    { id: 'shortenSustain', label: 'Shorten selected sustain', group: 'Grid and sustain', status: 'ready', keys: { feedback: '', eof: '[' } },
    { id: 'lengthenSustain', label: 'Lengthen selected sustain', group: 'Grid and sustain', status: 'ready', keys: { feedback: '', eof: ']' } },
    { id: 'toggleSnap', label: 'Toggle snap on/off', group: 'Grid and sustain', status: 'ready', keys: { feedback: 'G', eof: '' } },
    { id: 'snapDown', label: 'Decrease snap resolution', group: 'Grid and sustain', status: 'ready', keys: { feedback: ',', eof: ',' } },
    { id: 'snapUp', label: 'Increase snap resolution', group: 'Grid and sustain', status: 'ready', keys: { feedback: '.', eof: '.' } },
    { id: 'editFret', label: 'Edit fret / fingering', group: 'Notes', status: 'ready', keys: { feedback: 'F', eof: 'F / Ctrl+F' } },
    { id: 'noteMenu', label: 'Open note edit menu', group: 'Notes', status: 'ready', keys: { feedback: '', eof: 'N' } },
    { id: 'bend', label: 'Edit bend', group: 'Notes', status: 'ready', keys: { feedback: 'B', eof: 'Ctrl+B' } },
    { id: 'unpitchedSlide', label: 'Edit unpitched slide', group: 'Notes', status: 'ready', keys: { feedback: 'U', eof: 'Ctrl+U' } },
    { id: 'transposeStringUp', label: 'Move selection up one string', group: 'Notes', status: 'ready', keys: { feedback: 'Shift+Up', eof: 'Shift+Up' } },
    { id: 'transposeStringDown', label: 'Move selection down one string', group: 'Notes', status: 'ready', keys: { feedback: 'Shift+Down', eof: 'Shift+Down' } },
    { id: 'slideUp', label: 'Pitched slide up', group: 'Notes', status: 'planned', keys: { feedback: 'Ctrl+Up', eof: 'Ctrl+Up' } },
    { id: 'slideDown', label: 'Pitched slide down', group: 'Notes', status: 'planned', keys: { feedback: 'Ctrl+Down', eof: 'Ctrl+Down' } },
    { id: 'toggleHammerOn', label: 'Toggle hammer-on', group: 'Techniques', status: 'ready', keys: { feedback: 'H', eof: 'H' } },
    { id: 'togglePullOff', label: 'Toggle pull-off', group: 'Techniques', status: 'ready', keys: { feedback: 'P', eof: 'P' } },
    { id: 'toggleTap', label: 'Toggle tap', group: 'Techniques', status: 'ready', keys: { feedback: 'Y', eof: 'T / Ctrl+T' } },
    { id: 'togglePinchHarmonic', label: 'Toggle pinch harmonic', group: 'Techniques', status: 'ready', keys: { feedback: 'Shift+N', eof: 'Shift+H' } },
    { id: 'toggleNaturalHarmonic', label: 'Toggle natural harmonic', group: 'Techniques', status: 'ready', keys: { feedback: 'N', eof: 'Ctrl+H' } },
    { id: 'togglePalmMute', label: 'Toggle palm mute', group: 'Techniques', status: 'ready', keys: { feedback: 'M', eof: 'Ctrl+M' } },
    { id: 'toggleMuteOpen', label: 'Mute and set fret open', group: 'Techniques', status: 'ready', keys: { feedback: 'X', eof: 'Ctrl+X' } },
    { id: 'toggleMuteRetain', label: 'Mute and retain fret', group: 'Techniques', status: 'ready', keys: { feedback: 'Shift+X', eof: 'Shift+X' } },
    { id: 'toggleVibrato', label: 'Toggle vibrato', group: 'Techniques', status: 'ready', keys: { feedback: 'V', eof: 'Shift+V' } },
    { id: 'toggleLinkNext', label: 'Toggle link-next', group: 'Techniques', status: 'ready', keys: { feedback: '', eof: 'Shift+N' } },
    { id: 'toggleAccent', label: 'Toggle accent', group: 'Techniques', status: 'ready', keys: { feedback: 'A', eof: 'Ctrl+Shift+A' } },
    { id: 'toggleIgnore', label: 'Toggle ignore', group: 'Techniques', status: 'ready', keys: { feedback: 'Ctrl+Shift+I', eof: 'Ctrl+Shift+I' } },
    { id: 'toggleTremolo', label: 'Toggle tremolo', group: 'Techniques', status: 'ready', keys: { feedback: 'Ctrl+Shift+O', eof: 'Ctrl+Shift+O' } },
    { id: 'togglePop', label: 'Toggle pop / pluck', group: 'Techniques', status: 'ready', keys: { feedback: 'O', eof: 'Ctrl+Shift+P' } },
    { id: 'fretUp', label: 'Increase selected fret', group: 'Notes', status: 'ready', keys: { feedback: 'Ctrl++', eof: 'Ctrl++' } },
    { id: 'fretDown', label: 'Decrease selected fret', group: 'Notes', status: 'ready', keys: { feedback: 'Ctrl+-', eof: 'Ctrl+-' } },
    { id: 'setAnchor', label: 'Set anchor at cursor', group: 'Structure', status: 'ready', keys: { feedback: 'Shift+F', eof: 'Shift+F' } },
    { id: 'selectLike', label: 'Select matching string/fret', group: 'Selection', status: 'ready', keys: { feedback: 'Ctrl+L', eof: 'Ctrl+L' } },
    { id: 'resnapSelection', label: 'Resnap selection to grid', group: 'Grid and sustain', status: 'ready', keys: { feedback: 'Shift+R', eof: 'Shift+R' } },
    { id: 'addSection', label: 'Add section at cursor', group: 'Structure', status: 'ready', keys: { feedback: 'Shift+M', eof: 'Shift+S' } },
    { id: 'addPhrase', label: 'Add phrase at cursor', group: 'Structure', status: 'ready', keys: { feedback: 'Shift+P', eof: 'Shift+P' } },
    { id: 'addToneChange', label: 'Add tone change at cursor', group: 'Structure', status: 'ready', keys: { feedback: 'Ctrl+Shift+T', eof: 'Ctrl+Shift+T' } },
    { id: 'addHandshape', label: 'Add handshape from selection', group: 'Structure', status: 'ready', keys: { feedback: 'Ctrl+H', eof: 'Ctrl+Shift+H' } },
    { id: 'setTimeSignature', label: 'Set time signature', group: 'Tempo map', status: 'ready', keys: { feedback: 'Shift+T', eof: 'Shift+I' } },
    { id: 'toggleGridDisplay', label: 'Toggle grid display density', group: 'Grid and sustain', status: 'planned', keys: { feedback: 'Shift+G', eof: 'Shift+G' } },
    { id: 'customGridSnap', label: 'Open custom snap settings', group: 'Grid and sustain', status: 'planned', keys: { feedback: 'Alt+G', eof: 'Ctrl+Shift+G' } },
    { id: 'midiTones', label: 'MIDI tone spot-check', group: 'Preview', status: 'planned', keys: { feedback: '', eof: 'Shift+T' } },
    { id: 'placeMoverPhrase', label: 'Place mover phrase', group: 'Structure', status: 'planned', keys: { feedback: 'Ctrl+Shift+R', eof: 'Ctrl+Shift+R' } },
]);

function _editorShortcutRowsPure(profile) {
    const p = profile === 'eof' ? 'eof' : 'feedback';
    return EDITOR_SHORTCUT_COMMANDS.map(cmd => ({
        id: cmd.id,
        label: cmd.label,
        group: cmd.group,
        status: cmd.status,
        key: (cmd.keys && cmd.keys[p]) || '',
    }));
}
function _editorEofCommandForKeyPure(e) {
    const sig = _editorKeySigPure(e);
    const key = (e.key || '').toLowerCase();
    const plain = !e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey;
    const ctrl = (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey;
    const shift = e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey;
    const ctrlShift = (e.ctrlKey || e.metaKey) && e.shiftKey && !e.altKey;
    const alt = e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey;

    if (sig === 'F2') return 'save';
    if (sig === 'F5') return 'toggleWaveform';
    if (sig === 'F6') return 'importMidi';
    if (sig === 'F7') return 'importXml';
    if (sig === 'F12') return 'importGp';
    if (sig === 'PageUp') return 'prevBeat';
    if (sig === 'PageDown') return 'nextBeat';
    if (sig === 'Shift+PageUp') return 'prevNote';
    if (sig === 'Shift+PageDown') return 'nextNote';
    if (sig === 'Ctrl+Shift+PageUp') return 'prevGrid';
    if (sig === 'Ctrl+Shift+PageDown') return 'nextGrid';
    if (sig === 'Alt+PageUp') return 'prevAnchor';
    if (sig === 'Alt+PageDown') return 'nextAnchor';
    if (plain && key === '[') return 'shortenSustain';
    if (plain && key === ']') return 'lengthenSustain';
    if (plain && key === ',') return 'snapDown';
    if (plain && key === '.') return 'snapUp';
    if (plain && key === 'f') return 'editFret';
    if (plain && key === 'h') return 'toggleHammerOn';
    if (plain && key === 'p') return 'togglePullOff';
    if (plain && key === 'n') return 'noteMenu';
    if (plain && key === 't') return 'toggleTap';
    if (shift && key === 'f') return 'setAnchor';
    if (shift && key === 'g') return 'toggleGridDisplay';
    if (shift && key === 'h') return 'togglePinchHarmonic';
    if (shift && key === 'i') return 'setTimeSignature';
    if (shift && key === 'n') return 'toggleLinkNext';
    if (shift && key === 'p') return 'addPhrase';
    if (shift && key === 'r') return 'resnapSelection';
    if (shift && key === 's') return 'addSection';
    if (shift && key === 't') return 'midiTones';
    if (shift && key === 'v') return 'toggleVibrato';
    if (shift && key === 'x') return 'toggleMuteRetain';
    if (ctrl && key === 'b') return 'bend';
    if (ctrl && key === 'f') return 'editFret';
    if (ctrl && key === 'h') return 'toggleNaturalHarmonic';
    if (ctrl && key === 'l') return 'selectLike';
    if (ctrl && key === 'm') return 'togglePalmMute';
    if (ctrl && key === 's') return 'save';
    if (ctrl && key === 't') return 'toggleTap';
    if (ctrl && key === 'u') return 'unpitchedSlide';
    if (ctrl && key === 'x') return 'toggleMuteOpen';
     if (ctrl && (key === '+' || key === '=')) return 'fretUp';
    if (ctrl && key === '-') return 'fretDown';
    if (ctrlShift && key === 'a') return 'toggleAccent';
    if (ctrlShift && key === 'g') return 'customGridSnap';
    if (ctrlShift && key === 'h') return 'addHandshape';
    if (ctrlShift && key === 'i') return 'toggleIgnore';
    if (ctrlShift && key === 'o') return 'toggleTremolo';
    if (ctrlShift && key === 'p') return 'togglePop';
    if (ctrlShift && key === 'r') return 'placeMoverPhrase';
    if (ctrlShift && key === 't') return 'addToneChange';
    if (ctrlShift && e.key === 'ArrowUp') return 'slideUp';
    if (ctrlShift && e.key === 'ArrowDown') return 'slideDown';
    if (shift && e.key === 'ArrowUp') return 'transposeStringUp';
    if (shift && e.key === 'ArrowDown') return 'transposeStringDown';
    if (ctrl && e.key === 'ArrowUp') return 'slideUp';
    if (ctrl && e.key === 'ArrowDown') return 'slideDown';
    if (alt && (e.key === 'PageUp' || e.key === 'PageDown')) return e.key === 'PageUp' ? 'prevAnchor' : 'nextAnchor';
    return null;
}


function _editorDefaultRightClickBehaviorPure(profile) {
    return profile === 'eof' ? 'eofEdit' : 'context';
}

function _editorEffectiveRightClickBehaviorPure(profile, savedBehavior) {
    return (savedBehavior === 'context' || savedBehavior === 'eofEdit')
        ? savedBehavior
        : _editorDefaultRightClickBehaviorPure(profile);
}

function _editorFeedbackCommandForKeyPure(e) {
    const sig = _editorKeySigPure(e);
    const key = (e.key || '').toLowerCase();
    const plain = !e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey;
    const ctrl = (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey;
    const shift = e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey;
    const alt = e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey;
    const ctrlAlt = (e.ctrlKey || e.metaKey) && e.altKey && !e.shiftKey;
    const ctrlShift = (e.ctrlKey || e.metaKey) && e.shiftKey && !e.altKey;

    if (ctrl && key === 's') return 'save';
    if (plain && key === 'w') return 'toggleWaveform';
    if (sig === 'PageUp') return 'prevBeat';
    if (sig === 'PageDown') return 'nextBeat';
    if (alt && e.key === 'ArrowLeft') return 'prevNote';
    if (alt && e.key === 'ArrowRight') return 'nextNote';
    if (sig === 'Ctrl+PageUp') return 'prevGrid';
    if (sig === 'Ctrl+PageDown') return 'nextGrid';
    if (ctrlAlt && e.key === 'ArrowLeft') return 'prevAnchor';
    if (ctrlAlt && e.key === 'ArrowRight') return 'nextAnchor';
    if (plain && key === 'g') return 'toggleSnap';
    if (plain && key === ',') return 'snapDown';
    if (plain && key === '.') return 'snapUp';
    if (plain && key === 'f') return 'editFret';
    if (plain && key === 'b') return 'bend';
    if (plain && key === 'u') return 'unpitchedSlide';
    if (shift && e.key === 'ArrowUp') return 'transposeStringUp';
    if (shift && e.key === 'ArrowDown') return 'transposeStringDown';
    if (plain && key === 'h') return 'toggleHammerOn';
    if (plain && key === 'p') return 'togglePullOff';
    if (plain && key === 'y') return 'toggleTap';
    if (plain && key === 'v') return 'toggleVibrato';
    if (plain && key === 'm') return 'togglePalmMute';
    if (plain && key === 'x') return 'toggleMuteOpen';
    if (shift && key === 'x') return 'toggleMuteRetain';
    if (plain && key === 'n') return 'toggleNaturalHarmonic';
    if (shift && key === 'n') return 'togglePinchHarmonic';
    if (plain && key === 'o') return 'togglePop';
    if (plain && key === 'a') return 'toggleAccent';
    if (shift && key === 't') return 'setTimeSignature';
    if (ctrl && key === 'h') return 'addHandshape';
    if (ctrlShift && key === 'i') return 'toggleIgnore';
    if (ctrlShift && key === 'o') return 'toggleTremolo';
    if (ctrlShift && key === 't') return 'addToneChange';
    if (ctrl && (key === '+' || key === '=')) return 'fretUp';
    if (ctrl && key === '-') return 'fretDown';
    if (shift && key === 'f') return 'setAnchor';
    if (ctrl && key === 'l') return 'selectLike';
    if (shift && key === 'r') return 'resnapSelection';
    if (shift && key === 'm') return 'addSection';
    if (shift && key === 'p') return 'addPhrase';
    if (ctrl && e.key === 'ArrowUp') return 'slideUp';
    if (ctrl && e.key === 'ArrowDown') return 'slideDown';
    return null;
}
/* @pure:shortcut-profile:end */

function _editorIsTypingTarget(e) {
    return !!(e && e.target && e.target.matches && e.target.matches('input, select, textarea'));
}

function _editorSyncRightClickBehaviorControls() {
    const val = _editorEffectiveRightClickBehaviorPure(editorShortcutProfile, editorRightClickBehavior);
    const el = document.getElementById('editor-right-click-behavior');
    if (el) el.value = val;
    const hint = document.getElementById('editor-right-click-hint');
    if (hint) {
        hint.textContent = val === 'eofEdit'
            ? 'Right-click note lanes add/remove notes; lanes and markers keep context menus.'
            : 'Right-click opens context menus.';
    }
}

function _editorLoadShortcutProfile() {
    try {
        const saved = localStorage.getItem(EDITOR_SHORTCUT_PROFILE_KEY);
        if (EDITOR_SHORTCUT_PROFILES.has(saved)) editorShortcutProfile = saved;
        const savedRightClick = localStorage.getItem(EDITOR_RIGHT_CLICK_BEHAVIOR_KEY);
        if (EDITOR_RIGHT_CLICK_BEHAVIORS.has(savedRightClick)) editorRightClickBehavior = savedRightClick;
    } catch (_) {}
    const el = document.getElementById('editor-shortcut-profile');
    if (el) el.value = editorShortcutProfile;
    _editorSyncRightClickBehaviorControls();
}

window.editorSetRightClickBehavior = (behavior) => {
    editorRightClickBehavior = EDITOR_RIGHT_CLICK_BEHAVIORS.has(behavior) ? behavior : null;
    try {
        if (editorRightClickBehavior) localStorage.setItem(EDITOR_RIGHT_CLICK_BEHAVIOR_KEY, editorRightClickBehavior);
        else localStorage.removeItem(EDITOR_RIGHT_CLICK_BEHAVIOR_KEY);
    } catch (_) {}
    _editorSyncRightClickBehaviorControls();
    setStatus(_editorEffectiveRightClickBehaviorPure(editorShortcutProfile, editorRightClickBehavior) === 'eofEdit'
        ? 'Right-click behavior: add/remove notes'
        : 'Right-click behavior: context menus');
};
window.editorSetShortcutProfile = (profile) => {
    editorShortcutProfile = EDITOR_SHORTCUT_PROFILES.has(profile) ? profile : 'feedback';
    try { localStorage.setItem(EDITOR_SHORTCUT_PROFILE_KEY, editorShortcutProfile); } catch (_) {}
    const el = document.getElementById('editor-shortcut-profile');
    if (el) el.value = editorShortcutProfile;
    const panelEl = document.getElementById('editor-shortcut-panel-profile');
    if (panelEl) panelEl.value = editorShortcutProfile;
    _editorSyncRightClickBehaviorControls();
    _editorRenderShortcutPanel();
    setStatus(editorShortcutProfile === 'eof' ? 'Shortcut profile: EOF Legacy' : 'Shortcut profile: FeedBack');
};

function _editorCommandById(id) {
    return EDITOR_SHORTCUT_COMMANDS.find(cmd => cmd.id === id) || null;
}

function _editorRenderShortcutPanel() {
    const panel = document.getElementById('editor-shortcut-panel');
    const list = document.getElementById('editor-shortcut-command-list');
    if (!panel || !list || panel.classList.contains('hidden')) return;
    const profileEl = document.getElementById('editor-shortcut-panel-profile');
    if (profileEl) profileEl.value = editorShortcutProfile;
    _editorSyncRightClickBehaviorControls();
    const subtitle = document.getElementById('editor-shortcut-panel-subtitle');
    if (subtitle) {
        subtitle.textContent = editorShortcutProfile === 'eof'
            ? 'EOF Legacy shows migration-friendly keys and clickable command controls.'
            : 'FeedBack shows clickable command controls; the native key map will expand in a later pass.';
    }
    list.replaceChildren();
    const groups = new Map();
    for (const row of _editorShortcutRowsPure(editorShortcutProfile)) {
        if (!groups.has(row.group)) groups.set(row.group, []);
        groups.get(row.group).push(row);
    }
    for (const [group, rows] of groups) {
        const section = document.createElement('div');
        section.className = 'rounded border border-gray-700/70 bg-dark-900/45';
        const title = document.createElement('div');
        title.className = 'px-2 py-1.5 border-b border-gray-700/70 text-[11px] uppercase tracking-wide text-gray-500';
        title.textContent = group;
        section.appendChild(title);
        const body = document.createElement('div');
        body.className = 'divide-y divide-gray-800';
        for (const row of rows) {
            const line = document.createElement('div');
            line.className = 'flex items-center gap-2 px-2 py-1.5';
            const label = document.createElement('button');
            label.type = 'button';
            label.className = row.status === 'ready'
                ? 'min-w-0 flex-1 text-left text-gray-200 hover:text-white'
                : 'min-w-0 flex-1 text-left text-gray-500 cursor-not-allowed';
            label.textContent = row.label;
            label.disabled = row.status !== 'ready';
            label.onclick = () => window.editorRunShortcutCommand(row.id);
            const key = document.createElement('span');
            key.className = 'shrink-0 rounded bg-dark-700 border border-gray-700 px-1.5 py-0.5 font-mono text-[11px] text-gray-300';
            key.textContent = row.key || 'Button';
            const badge = document.createElement('span');
            badge.className = row.status === 'ready'
                ? 'shrink-0 rounded px-1.5 py-0.5 text-[10px] bg-green-900/50 text-green-300 border border-green-800/60'
                : 'shrink-0 rounded px-1.5 py-0.5 text-[10px] bg-dark-700 text-gray-500 border border-gray-700';
            badge.textContent = row.status === 'ready' ? 'Ready' : 'Planned';
            line.append(label, key, badge);
            body.appendChild(line);
        }
        section.appendChild(body);
        list.appendChild(section);
    }
}

window.editorToggleShortcutPanel = (force) => {
    const panel = document.getElementById('editor-shortcut-panel');
    if (!panel) return;
    const show = force === undefined ? panel.classList.contains('hidden') : !!force;
    panel.classList.toggle('hidden', !show);
    if (show) _editorRenderShortcutPanel();
};

window.editorRunShortcutCommand = (id) => {
    const def = _editorCommandById(id);
    if (!def) return false;
    if (def.status !== 'ready') {
        setStatus(`${def.label} is planned but not wired yet.`);
        return true;
    }
    const handled = _editorRunEofCommand(id);
    _editorRenderShortcutPanel();
    return handled;
};
function _editorCurrentNoteIndices() {
    return (!S.drumEditMode && !S.tempoMapMode && S.sel && S.sel.size) ? [...S.sel] : [];
}

function _editorToggleTechnique(key, { openFret = false } = {}) {
    const idxs = _editorCurrentNoteIndices();
    if (!idxs.length) { setStatus('Select notes first'); return false; }
    const nn = notes();
    const next = !idxs.every(i => !!(nn[i] && nn[i].techniques && nn[i].techniques[key]));
    S.history.exec(new ToggleTechniqueCmd(idxs, key, next, openFret ? 0 : null));
    draw();
    updateStatus();
    return true;
}

function _editorAdjustSelectedFret(delta) {
    const idxs = _editorCurrentNoteIndices();
    if (!idxs.length) { setStatus('Select notes first'); return false; }
    const nn = notes();
    for (const i of idxs) {
        if (!nn[i]) continue;
        const next = Math.max(0, Math.min(24, (parseInt(nn[i].fret) || 0) + delta));
        S.history.exec(new ChangeFretCmd(i, next));
    }
    draw();
    updateStatus();
    return true;
}

function _editorAdjustSelectedSustain(delta) {
    const idxs = _editorCurrentNoteIndices();
    if (!idxs.length) { setStatus('Select notes first'); return false; }
    const nn = notes();
    const orig = idxs.map(i => nn[i] ? (nn[i].sustain || 0) : 0);
    const next = idxs.map((i, k) => {
        const vals = _resizeSustainsForDeltaPure(nn, [i], orig[k], delta);
        return vals[0] || 0;
    });
    if (!next.some((v, i) => v !== orig[i])) return true;
    S.history.exec(new ResizeSustainGroupCmd(idxs, next));
    draw();
    updateStatus();
    return true;
}

function _editorToggleSnapEnabled() {
    window.editorSetSnapEnabled(!S.snapEnabled);
    return true;
}

function _editorSnapStepSeconds() {
    if (!S.beats || S.beats.length < 2) return 0.25;
    const t = S.cursorTime || 0;
    let bi = 0;
    for (let i = 0; i < S.beats.length - 1; i++) {
        if (S.beats[i].time <= t) bi = i; else break;
    }
    const bt = S.beats[bi].time;
    const nt = bi < S.beats.length - 1 ? S.beats[bi + 1].time : bt + 0.5;
    const sv = _editorEffectiveSnapValuePure(S.snapEnabled, SNAP_VALUES[S.snapIdx]);
    const subs = _editorSnapSubdivisionsPure(sv);
    if (!subs) return Math.max(0.001, nt - bt);
    return Math.max(0.001, (nt - bt) / subs);
}

function _editorSeekToTime(t) {
    S.cursorTime = Math.max(0, Math.min(S.duration || Infinity, t));
    const margin = 0.15 * (canvas ? canvas.width / S.zoom : 10);
    if (S.cursorTime < S.scrollX) S.scrollX = _editorClampScrollX(S.cursorTime - margin);
    const right = S.scrollX + ((canvas ? canvas.width : 800) - LABEL_W) / S.zoom;
    if (S.cursorTime > right) S.scrollX = _editorClampScrollX(S.cursorTime - margin);
    if (S.playing) { stopPlayback(); startPlayback(); }
    draw();
    updateTimeDisplay();
}

function _editorJumpBeat(dir) {
    const beats = (S.beats || []).map(b => b.time).filter(t => Number.isFinite(t)).sort((a, b) => a - b);
    const cur = S.cursorTime || 0;
    const next = dir > 0 ? beats.find(t => t > cur + 0.0001) : [...beats].reverse().find(t => t < cur - 0.0001);
    if (next !== undefined) _editorSeekToTime(next);
}

function _editorJumpNote(dir) {
    const times = notes().map(n => n.time).filter(t => Number.isFinite(t)).sort((a, b) => a - b);
    const cur = S.cursorTime || 0;
    const next = dir > 0 ? times.find(t => t > cur + 0.0001) : [...times].reverse().find(t => t < cur - 0.0001);
    if (next !== undefined) _editorSeekToTime(next);
}

function _editorJumpGrid(dir) {
    _editorSeekToTime((S.cursorTime || 0) + dir * _editorSnapStepSeconds());
}

function _editorJumpAnchor(dir) {
    const arr = S.arrangements[S.currentArr] || {};
    const anchors = _anchorProjection(arr).map(a => a.anchor.time).filter(t => Number.isFinite(t)).sort((a, b) => a - b);
    const cur = S.cursorTime || 0;
    const next = dir > 0 ? anchors.find(t => t > cur + 0.0001) : [...anchors].reverse().find(t => t < cur - 0.0001);
    if (next !== undefined) _editorSeekToTime(next);
}

function _editorSelectLike() {
    const idxs = _editorCurrentNoteIndices();
    if (!idxs.length) { setStatus('Select a note first'); return false; }
    const n0 = notes()[idxs[0]];
    if (!n0) return false;
    S.sel.clear();
    notes().forEach((n, i) => {
        if (n.string === n0.string && n.fret === n0.fret) S.sel.add(i);
    });
    draw();
    updateStatus();
    return true;
}

function _editorResnapSelection() {
    const idxs = _editorCurrentNoteIndices();
    if (!idxs.length) { setStatus('Select notes first'); return false; }
    const nn = notes();
    const oldTimes = idxs.map(i => nn[i].time);
    const newTimes = oldTimes.map(t => snapTime(t));
    for (let i = 0; i < idxs.length; i++) nn[idxs[i]].time = oldTimes[i];
    const dtimes = newTimes.map((t, i) => t - oldTimes[i]);
    const dstrings = idxs.map(() => 0);
    S.history.exec(new MoveNoteCmd(idxs, dtimes, dstrings, null));
    draw();
    updateStatus();
    return true;
}

function _editorSetAnchorAtCursor() {
    if (!S.arrangements.length || isKeysMode()) { setStatus('Anchors are for guitar/bass arrangements'); return false; }
    const idxs = _editorCurrentNoteIndices();
    const nn = notes();
    const atCursor = idxs.map(i => nn[i]).filter(Boolean);
    const fret = atCursor.length ? Math.max(1, Math.min(...atCursor.map(n => n.fret || 1))) : 1;
    const anchor = { time: snapTime(S.cursorTime || 0), fret, width: 4 };
    S.history.exec(new AddAnchorCmd(S.currentArr, anchor));
    S.anchorSel = anchor;
    draw();
    return true;
}

function _editorAddSectionAtCursor() {
    const name = 'section';
    const num = S.sections.filter(s => s.name === name).length + 1;
    S.sections.push({ name, number: num, start_time: snapTime(S.cursorTime || 0) });
    S.sections.sort((a, b) => a.start_time - b.start_time);
    draw();
    setStatus('Section added');
    return true;
}

function _editorAddPhraseAtCursor() {
    const arr = S.arrangements[S.currentArr];
    if (!arr) return false;
    if (!Array.isArray(arr.phrases)) arr.phrases = [];
    const name = 'phrase';
    const num = arr.phrases.filter(p => p.name === name).length + 1;
    arr.phrases.push({ name, number: num, start_time: snapTime(S.cursorTime || 0), levels: [] });
    arr.phrases.sort((a, b) => (a.start_time || 0) - (b.start_time || 0));
    draw();
    setStatus('Phrase added');
    return true;
}

function _editorAddToneAtCursor() {
    const arr = S.arrangements[S.currentArr];
    if (!arr) return false;
    const tones = _ensureTones(arr);
    const slots = (tones.slots || []).slice();
    const name = slots[1] || slots[0] || 'Tone A';
    const change = { t: snapTime(S.cursorTime || 0), name };
    S.history.exec(new AddToneChangeCmd(S.currentArr, change));
    S.toneSel = change;
    draw();
    setStatus('Tone change added');
    return true;
}

function _editorAddHandshapeFromSelection() {
    const ctx = _selectedChordContext();
    if (!ctx) { setStatus('Select one chord group first'); return false; }
    const sustains = ctx.notes.map(n => n.sustain || 0);
    const start = ctx.time;
    const end = start + Math.max(0.25, ...sustains);
    const hs = { start_time: start, end_time: end, arp: false };
    S.history.exec(new AddHandshapeCmd(S.currentArr, hs, lanes()));
    S.handshapeSel = hs;
    draw();
    setStatus('Handshape added');
    return true;
}

function _editorOpenImportXml() {
    window.editorShowCreateModal();
    setStatus('Choose EOF XML files in the New dialog.');
    setTimeout(() => document.getElementById('editor-create-eof')?.click(), 0);
}

function _editorOpenImportGp() {
    if (S.arrangements.length) window.editorShowImportGuitarModal();
    else window.editorShowCreateModal();
    setTimeout(() => {
        const input = document.getElementById(S.arrangements.length ? 'editor-import-guitar-file' : 'editor-create-gp');
        input?.click();
    }, 0);
}

function _editorOpenImportMidi() {
    if (S.arrangements.length) window.editorShowAddKeysModal();
    else window.editorShowCreateModal();
    setTimeout(() => {
        const input = document.getElementById(S.arrangements.length ? 'editor-add-keys-file' : 'editor-create-gp');
        input?.click();
    }, 0);
}

async function _editorPromptTempoSignatureAtCursor() {
    const val = await _editorPromptText({
        title: 'Set Time Signature', label: 'Beats per measure', value: '4', placeholder: '4',
    });
    if (val == null) return;
    const beats = Math.max(1, Math.min(16, parseInt(val, 10) || 4));
    const d = _tempoResolvedMeasureIdx();
    if (d >= 0) _tempoSetBeatsPerMeasure(d, beats);
}

function _editorToggleWaveform() {
    editorWaveformVisible = !editorWaveformVisible;
    draw();
    setStatus(editorWaveformVisible ? 'Waveform shown' : 'Waveform hidden');
}

function _editorUnsupportedEofCommand(label) {
    setStatus(`${label} is not available in this editor mode yet.`);
    return true;
}

function _editorRunEofCommand(cmd) {
    switch (cmd) {
    case 'save': editorSave(); return true;
    case 'toggleWaveform': return _editorToggleWaveform();
    case 'importMidi': _editorOpenImportMidi(); return true;
    case 'importXml': _editorOpenImportXml(); return true;
    case 'importGp': _editorOpenImportGp(); return true;
    case 'prevBeat': _editorJumpBeat(-1); return true;
    case 'nextBeat': _editorJumpBeat(+1); return true;
    case 'prevNote': _editorJumpNote(-1); return true;
    case 'nextNote': _editorJumpNote(+1); return true;
    case 'prevGrid': _editorJumpGrid(-1); return true;
    case 'nextGrid': _editorJumpGrid(+1); return true;
    case 'prevAnchor': _editorJumpAnchor(-1); return true;
    case 'nextAnchor': _editorJumpAnchor(+1); return true;
    case 'toggleSnap': return _editorToggleSnapEnabled();
    case 'shortenSustain': return _editorAdjustSelectedSustain(-_editorSnapStepSeconds());
    case 'lengthenSustain': return _editorAdjustSelectedSustain(+_editorSnapStepSeconds());
    case 'snapDown': window.editorSetSnap(Math.max(0, S.snapIdx - 1)); return true;
    case 'snapUp': window.editorSetSnap(Math.min(SNAP_VALUES.length - 1, S.snapIdx + 1)); return true;
    case 'editFret': { const idxs = _editorCurrentNoteIndices(); if (idxs.length) promptFret(idxs[0]); else setStatus('Select a note first'); return true; }
    case 'noteMenu': { const idxs = _editorCurrentNoteIndices(); if (idxs.length) showContextMenu(window.innerWidth / 2, window.innerHeight / 2, idxs[0]); else setStatus('Select a note first'); return true; }
    case 'bend': { const idxs = _editorCurrentNoteIndices(); if (idxs.length) promptBend(idxs[0]); else setStatus('Select a note first'); return true; }
    case 'unpitchedSlide': { const idxs = _editorCurrentNoteIndices(); if (idxs.length) promptSlideUnpitch(idxs[0]); else setStatus('Select a note first'); return true; }
    case 'slideUp': return _editorUnsupportedEofCommand('Pitched slide shortcut');
    case 'slideDown': return _editorUnsupportedEofCommand('Pitched slide shortcut');
    case 'transposeStringUp': _execMoveString(+1); return true;
    case 'transposeStringDown': _execMoveString(-1); return true;
    case 'toggleHammerOn': return _editorToggleTechnique('hammer_on');
    case 'togglePullOff': return _editorToggleTechnique('pull_off');
    case 'toggleTap': return _editorToggleTechnique('tap');
    case 'togglePinchHarmonic': return _editorToggleTechnique('harmonic_pinch');
    case 'toggleNaturalHarmonic': return _editorToggleTechnique('harmonic');
    case 'togglePalmMute': return _editorToggleTechnique('palm_mute');
    case 'toggleFretHandMute': return _editorToggleTechnique('fret_hand_mute');
    case 'toggleMuteOpen': return _editorToggleTechnique('mute', { openFret: true });
    case 'toggleMuteRetain': return _editorToggleTechnique('mute');
    case 'toggleVibrato': return _editorToggleTechnique('vibrato');
    case 'toggleLinkNext': return _editorToggleTechnique('link_next');
    case 'toggleAccent': return _editorToggleTechnique('accent');
    case 'toggleIgnore': return _editorToggleTechnique('ignore');
    case 'toggleTremolo': return _editorToggleTechnique('tremolo');
    case 'togglePop': return _editorToggleTechnique('pluck');
    case 'fretUp': return _editorAdjustSelectedFret(+1);
    case 'fretDown': return _editorAdjustSelectedFret(-1);
    case 'setAnchor': return _editorSetAnchorAtCursor();
    case 'selectLike': return _editorSelectLike();
    case 'resnapSelection': return _editorResnapSelection();
    case 'addSection': return _editorAddSectionAtCursor();
    case 'addPhrase': return _editorAddPhraseAtCursor();
    case 'addToneChange': return _editorAddToneAtCursor();
    case 'addHandshape': return _editorAddHandshapeFromSelection();
    case 'setTimeSignature': _editorPromptTempoSignatureAtCursor(); return true;
    case 'toggleGridDisplay': return _editorUnsupportedEofCommand('Grid display toggle');
    case 'customGridSnap': return _editorUnsupportedEofCommand('Custom grid snap');
    case 'midiTones': return _editorUnsupportedEofCommand('MIDI tones');
    case 'placeMoverPhrase': return _editorUnsupportedEofCommand('Mover phrase');
    default: return false;
    }
}

function _editorDispatchFeedbackShortcut(e) {
    if (editorShortcutProfile !== 'feedback' || _editorIsTypingTarget(e)) return false;
    const cmd = _editorFeedbackCommandForKeyPure(e);
    if (!cmd) return false;
    const def = _editorCommandById(cmd);
    if (def && def.status !== 'ready') return false;
    e.preventDefault();
    return _editorRunEofCommand(cmd);
}
function _editorDispatchEofShortcut(e) {
    if (editorShortcutProfile !== 'eof' || _editorIsTypingTarget(e)) return false;
    const cmd = _editorEofCommandForKeyPure(e);
    if (!cmd) return false;
    e.preventDefault();
    return _editorRunEofCommand(cmd);
}

function _editorRightClickNoteEdit(e, x, y) {
    const behavior = _editorEffectiveRightClickBehaviorPure(editorShortcutProfile, editorRightClickBehavior);
    if (behavior !== 'eofEdit' || !S.arrangements.length) return false;
    // Block mid-take edits like every other note-editing input — a MIDI take
    // reassigns arr.notes = _recNotes on Stop, so an add/remove here would be
    // silently overwritten and muddle undo history.
    if (_recState === 'recording') return false;
    const keysMode = isKeysMode();
    const laneBottom = keysMode
        ? WAVEFORM_H + pianoLaneCount() * PIANO_LANE_H
        : WAVEFORM_H + lanes() * LANE_H;
    if (y < WAVEFORM_H || y > laneBottom) return false;
    // Only inside the timeline grid — a right-click on the left string/piano
    // label margin (x < LABEL_W) is not a note edit; without this it would
    // clamp xToTime()<0 to 0 and add a note at the song start.
    if (x < LABEL_W) return false;

    const idx = hitNote(x, y);
    if (idx >= 0) {
        S.history.exec(new DeleteNotesCmd([idx]));
        draw();
        updateStatus();
        setStatus('Note removed');
        return true;
    }

    const time = snapTime(Math.max(0, xToTime(x)));
    let note;
    if (keysMode) {
        const midi = yToMidi(y);
        note = { time, string: midiToString(midi), fret: midiToFret(midi), sustain: 0, techniques: {} };
    } else {
        note = { time, string: yToStr(y), fret: 0, sustain: 0, techniques: {} };
    }
    const cmd = new AddNoteCmd(note);
    S.history.exec(cmd);
    S.sel.clear();
    if (cmd.idx >= 0) S.sel.add(cmd.idx);
    draw();
    updateStatus();
    setStatus('Note added');
    return true;
}
function onContextMenu(e) {
    if (S.drumEditMode) { e.preventDefault(); return; }  // drum-edit mode handles interaction
    if (S.tempoMapMode) { e.preventDefault(); _tempoMapOnContextMenu(e); return; }
    e.preventDefault();
    const { x, y } = getMousePos(e);

    // Tone-lane right-click — slot picker for the hit marker (and a
    // delete entry). Falls through to the existing menu logic when
    // there's no marker under the cursor.
    if (y >= 0 && y < TONE_LANE_H && S.arrangements && S.arrangements.length) {
        if (onToneLaneContextMenu(e, x)) return;
    }
    // Anchor-lane right-click — edit-fret/width + delete.
    if (S.arrangements && S.arrangements.length) {
        const anchorTop = _anchorLaneTopY();
        if (y >= anchorTop && y < anchorTop + ANCHOR_LANE_H) {
            if (onAnchorLaneContextMenu(e, x, y)) return;
        }
    }
    // Handshape-lane right-click — toggle arp / pick shape / delete.
    if (S.arrangements && S.arrangements.length) {
        const hsTop = _handshapeLaneTopY();
        if (y >= hsTop && y < hsTop + HS_LANE_H) {
            if (onHandshapeLaneContextMenu(e, x, y)) return;
        }
    }

    if (_editorRightClickNoteEdit(e, x, y)) return;

    // Right-click on beat bar or lanes with no note = section menu
    const beatBarY = isKeysMode()
        ? WAVEFORM_H + pianoLaneCount() * PIANO_LANE_H
        : WAVEFORM_H + lanes() * LANE_H;
    if (y >= beatBarY || (y >= WAVEFORM_H && hitNote(x, y) < 0)) {
        showSectionMenu(e.clientX, e.clientY, xToTime(x));
        return;
    }

    const idx = hitNote(x, y);
    if (idx < 0) return;

    if (!S.sel.has(idx)) {
        S.sel.clear();
        S.sel.add(idx);
        // Selection changed — refresh the status bar's selection count
        // and the inspector's bulk-edit state so both reflect the
        // just-right-clicked note instead of the previous selection.
        // updateStatus() already calls _renderInspector internally.
        updateStatus();
    }
    draw();
    showContextMenu(e.clientX, e.clientY, idx);
}

function showSectionMenu(cx, cy, time) {
    const menu = document.getElementById('editor-context-menu');
    // Check if clicking near an existing section
    let nearSection = null;
    for (const s of S.sections) {
        if (Math.abs(s.start_time - time) < 1.0) { nearSection = s; break; }
    }

    let html = '';
    html += `<button class="w-full text-left px-3 py-1 text-xs hover:bg-dark-500" data-action="add">Add Section Here</button>`;
    if (nearSection) {
        html += `<button class="w-full text-left px-3 py-1 text-xs hover:bg-dark-500" data-action="rename">Rename "${nearSection.name}"</button>`;
        html += `<button class="w-full text-left px-3 py-1 text-xs hover:bg-dark-500 text-red-400" data-action="delete">Delete "${nearSection.name}"</button>`;
    }
    menu.innerHTML = html;
    menu.querySelectorAll('[data-action]').forEach(btn => {
        btn.onclick = async () => {
            hideContextMenu();
            if (btn.dataset.action === 'add') {
                const name = await _editorPromptText({
                    title: 'Add Section', label: 'Section name', value: 'verse',
                });
                if (!name) return;
                const num = S.sections.filter(s => s.name === name).length + 1;
                S.sections.push({ name, number: num, start_time: snapTime(time) });
                S.sections.sort((a, b) => a.start_time - b.start_time);
                draw();
            } else if (btn.dataset.action === 'rename' && nearSection) {
                const name = await _editorPromptText({
                    title: 'Rename Section', label: 'New name', value: nearSection.name,
                });
                if (name) { nearSection.name = name; draw(); }
            } else if (btn.dataset.action === 'delete' && nearSection) {
                const i = S.sections.indexOf(nearSection);
                if (i >= 0) { S.sections.splice(i, 1); draw(); }
            }
        };
    });
    menu.style.left = cx + 'px';
    menu.style.top = cy + 'px';
    menu.classList.remove('hidden');
}

function onKeyDown(e) {
    // Only handle when editor screen is visible
    const screen = document.getElementById('plugin-editor');
    if (!screen || !screen.classList.contains('active')) return;

    if (e.key === ' ' && !e.target.matches('input, select, textarea')) {
        e.preventDefault();
        editorTogglePlay();
        return;
    }

    // Block all mutating shortcuts while a take is active so mid-take
    // edits can't be silently overwritten when arr.notes = _recNotes on
    // Stop. This covers tempo-map structural edits (Insert / [ ] /
    // Delete) and note edits alike. Spacebar (above) is still allowed
    // because it routes to editorTogglePlay → editorStopRecordMidi,
    // which cleanly finalizes the take.
    if (_recState === 'recording') return;

    // Drum-edit articulation toggles take priority over the shortcut-profile
    // dispatch: a plain 'f' in drum-edit mode must toggle flam, not resolve to
    // the FeedBack/EOF `editFret` command (which claims plain 'f'). Only fires
    // with a drum selection; otherwise falls through to the dispatch below.
    if (S.drumEditMode && S.drumSel.size && S.drumTab
        && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey
        && !e.target.matches('input, select, textarea')) {
        const dk = e.key.toLowerCase();
        if (dk === 'g' || dk === 'f' || dk === 'k') {
            e.preventDefault();
            _drumEditorToggleArticulation(dk);
            draw();
            return;
        }
    }

    if (_editorDispatchFeedbackShortcut(e)) return;
    if (_editorDispatchEofShortcut(e)) return;

    // Tempo-map mode: Insert key adds a sync point at the cursor.
    if (S.tempoMapMode && e.key === 'Insert'
            && !e.target.matches('input, select, textarea')) {
        e.preventDefault();
        _tempoInsertSyncPoint(S.cursorTime);
        return;
    }

    // Tempo-map mode: [ / ] change the selected measure's time signature.
    if (S.tempoMapMode && (e.key === '[' || e.key === ']') && S.tempoSel >= 0
            && !e.target.matches('input, select, textarea')) {
        e.preventDefault();
        const d = S.tempoSel;
        if (S.beats[d] && S.beats[d].measure > 0) {
            const cur = _tempoMeasureBeatCount(d);
            _tempoSetBeatsPerMeasure(d, cur + (e.key === ']' ? 1 : -1));
        }
        return;
    }

    if (e.key === 'Delete' || e.key === 'Backspace') {
        // Tempo-map mode: delete the selected sync point.
        if (S.tempoMapMode && S.tempoSel >= 0 &&
                !e.target.matches('input, select, textarea')) {
            e.preventDefault();
            _tempoDeleteSyncPoint(S.tempoSel);
            return;
        }
        // Anchor-lane: delete the selected anchor. Same focus / mode
        // gates as the tone-lane Del path.
        if (S.anchorSel && !S.drumEditMode && !S.tempoMapMode &&
                !e.target.matches('input, select, textarea')) {
            const arr = _currentAnchorArr();
            if (arr && Array.isArray(arr.anchors_user)
                    && arr.anchors_user.includes(S.anchorSel)) {
                e.preventDefault();
                S.history.exec(new RemoveAnchorCmd(S.currentArr, S.anchorSel));
                S.anchorSel = null;
                draw();
                return;
            }
        }
        // Handshape-lane: delete the selected handshape. Same gates.
        if (S.handshapeSel && !S.drumEditMode && !S.tempoMapMode &&
                !e.target.matches('input, select, textarea')) {
            const arr = _currentAnchorArr();
            if (arr && Array.isArray(arr.handshapes)
                    && arr.handshapes.includes(S.handshapeSel)) {
                e.preventDefault();
                S.history.exec(new RemoveHandshapeCmd(S.currentArr, S.handshapeSel));
                // Drop any in-flight drag on the just-deleted handshape so a
                // trailing mouseup can't enqueue a move/resize for a detached
                // object (and falsely bump the dirty count).
                if (S.drag && S.drag.type === 'handshape' && S.drag.hs === S.handshapeSel) {
                    S.drag = null;
                }
                S.handshapeSel = null;
                draw();
                return;
            }
        }
        // Tone-lane: delete the selected tone-change marker. Same
        // input-focus guard as the note-delete path below. Skip when
        // drum-edit or tempo-map mode is active — those modes own
        // Delete for their own selections, and `S.toneSel` isn't
        // cleared when entering them, so an old tone selection could
        // otherwise hijack the keypress.
        if (S.toneSel && !S.drumEditMode && !S.tempoMapMode &&
                !e.target.matches('input, select, textarea')) {
            const arr = _currentToneArr();
            if (arr && arr.tones && Array.isArray(arr.tones.changes)
                    && arr.tones.changes.includes(S.toneSel)) {
                e.preventDefault();
                S.history.exec(new RemoveToneChangeCmd(S.currentArr, S.toneSel));
                S.toneSel = null;
                draw();
                return;
            }
        }
        // Drum-edit mode: delete selected drum hits in place. No undo
        // (would need a sibling DrumEditCmd class — out of scope for this PR).
        // Guard against focus being inside a form control (mirrors the note-
        // delete path below) so typing in a text input doesn't delete hits.
        if (S.drumEditMode && S.drumSel.size && S.drumTab &&
                !e.target.matches('input, select, textarea')) {
            e.preventDefault();
            _drumEditorDeleteSelection();
            draw();
            return;
        }
        // Guard: in drum-edit mode S.sel may still hold a prior guitar/keys
        // selection from before mode entry; deleting those notes while the
        // user thinks they're editing drums would be surprising. Only run
        // the guitar/keys delete path when drum-edit mode is inactive.
        if (!S.drumEditMode && S.sel.size && !e.target.matches('input, select, textarea')) {
            e.preventDefault();
            S.history.exec(new DeleteNotesCmd([...S.sel]));
            draw();
            updateStatus();
            return;
        }
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        e.preventDefault();
        editorUndo();
        return;
    }
    if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.shiftKey && e.key === 'Z'))) {
        e.preventDefault();
        editorRedo();
        return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
        if (!e.target.matches('input, select, textarea')) {
            e.preventDefault();
            if (S.drumEditMode && S.drumTab) {
                // Select every drum hit. No filter — the user wants every
                // hit even off-screen, mirroring the guitar Ctrl+A path.
                S.drumSel = new Set();
                const hits = S.drumTab.hits || [];
                for (let i = 0; i < hits.length; i++) S.drumSel.add(i);
                draw();
                return;
            }
            // Tempo-map mode has no note selection — Ctrl+A is inert.
            if (S.tempoMapMode) return;
            const nn = notes();
            for (let i = 0; i < nn.length; i++) S.sel.add(i);
            draw();
            return;
        }
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'c') {
        // Copy/paste act on the guitar/keys arrangement's S.sel. In
        // drum-edit mode the canvas shows the drum grid, so a paste here
        // would mutate the hidden arrangement with no visual feedback —
        // skip both shortcuts while drum-edit mode is active.
        if (!S.drumEditMode && !S.tempoMapMode && S.sel.size && !e.target.matches('input, select, textarea')) {
            e.preventDefault();
            const nn = notes();
            const selNotes = [...S.sel].map(i => nn[i]);
            const baseTime = Math.min(...selNotes.map(n => n.time));
            S.clipboard = {
                notes: selNotes.map(n => ({
                    time: n.time - baseTime,
                    string: n.string,
                    fret: n.fret,
                    sustain: n.sustain || 0,
                    techniques: { ...(n.techniques || {}) },
                })),
                baseTime,
            };
            setStatus(`Copied ${selNotes.length} notes`);
            return;
        }
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'v') {
        if (!S.drumEditMode && !S.tempoMapMode && S.clipboard && S.clipboard.notes.length && !e.target.matches('input, select, textarea')) {
            e.preventDefault();
            const pasteTime = S.cursorTime;
            const newNotes = S.clipboard.notes.map(n => ({
                time: n.time + pasteTime,
                string: n.string,
                fret: n.fret,
                sustain: n.sustain,
                techniques: { ...(n.techniques || {}) },
            }));
            // Batch add via a compound command. Wrap both exec (sort
            // can reshuffle) and rollback (splice shifts indices) in
            // `_withStableSelection` so undo/redo can't leave `S.sel`
            // pointing at unrelated notes.
            const nn = notes();
            const addCmd = {
                _notes: newNotes,
                exec() {
                    _withStableSelection(() => {
                        for (const n of this._notes) nn.push(n);
                        nn.sort((a, b) => a.time - b.time);
                    });
                },
                rollback() {
                    _withStableSelection(() => {
                        for (const n of this._notes) {
                            const i = nn.indexOf(n);
                            if (i >= 0) nn.splice(i, 1);
                        }
                    });
                },
            };
            S.history.exec(addCmd);
            // Select pasted notes
            S.sel.clear();
            for (const n of newNotes) { const i = nn.indexOf(n); if (i >= 0) S.sel.add(i); }
            draw();
            updateStatus();
            setStatus(`Pasted ${newNotes.length} notes at cursor`);
            return;
        }
    }
}

// ════════════════════════════════════════════════════════════════════
// Context menu
// ════════════════════════════════════════════════════════════════════

function showContextMenu(cx, cy, idx) {
    const menu = document.getElementById('editor-context-menu');

    // Pre-compute move-string validity once for the whole menu so both
    // items share the same check without re-evaluating per render pass.
    const canUp   = _canMoveString(+1);
    const canDown = _canMoveString(-1);

    const items = [
        { label: 'Move Up 1 String',   action: () => { hideContextMenu(); _execMoveString(+1); }, disabled: !canUp },
        { label: 'Move Down 1 String', action: () => { hideContextMenu(); _execMoveString(-1); }, disabled: !canDown },
        { type: 'sep' },
        { label: 'Change Fret...', action: () => promptFret(idx) },
        { label: 'Bend...', action: () => promptBend(idx) },
        { label: 'Slide To...', action: () => promptSlide(idx) },
        { label: 'Slide Unpitched To...', action: () => promptSlideUnpitch(idx) },
        { label: 'Delete', action: () => { S.history.exec(new DeleteNotesCmd([...S.sel])); draw(); updateStatus(); } },
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

    const n = notes()[idx];
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
function hideContextMenu() {
    document.getElementById('editor-context-menu').classList.add('hidden');
}

async function promptFret(idx) {
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
    draw();
    _renderInspector();
}

// Bend authoring (§6.2.1): a modal with the peak amount (`bn`), an intent
// dropdown (`bt`) and an interactive drag-point curve editor (`bnv`). Applies
// to the full selection when the right-clicked note is part of it, else just
// that note. Wrapped in SetBendShapeCmd so the whole edit is one undo step.
async function promptBend(idx) {
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
    draw();
    _renderInspector();
    updateStatus();
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

async function promptSlide(idx) {
    hideContextMenu();
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
    draw();
    _renderInspector();
}

async function promptSlideUnpitch(idx) {
    hideContextMenu();
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
    draw();
    _renderInspector();
}

// ════════════════════════════════════════════════════════════════════
// Add note dialog
// ════════════════════════════════════════════════════════════════════

let addNoteData = null;

function showAddNote(cx, cy, time, string, fret) {
    const isKeys = isKeysMode();
    addNoteData = { time, string, fret, isKeys };
    const dlg = document.getElementById('editor-add-note-dialog');
    dlg.style.left = cx + 'px';
    dlg.style.top = cy + 'px';
    dlg.classList.remove('hidden');

    document.getElementById('editor-add-fret-col').classList.toggle('hidden', isKeys);
    document.getElementById('editor-add-pitch-col').classList.toggle('hidden', !isKeys);

    if (isKeys) {
        const midi = noteToMidi(string, fret);
        document.getElementById('editor-add-pitch-label').textContent = midiToNote(midi);
        const sus = document.getElementById('editor-add-sustain');
        sus.focus();
        sus.select();
    } else {
        const inp = document.getElementById('editor-add-fret');
        inp.value = fret != null ? String(fret) : '0';
        inp.focus();
        inp.select();
    }
}

function hideAddNote() {
    document.getElementById('editor-add-note-dialog').classList.add('hidden');
    addNoteData = null;
}

window.editorConfirmAddNote = function() {
    if (!addNoteData) return;
    const fret = addNoteData.isKeys
        ? addNoteData.fret
        : Math.max(0, Math.min(24, parseInt(document.getElementById('editor-add-fret').value) || 0));
    const sustain = Math.max(0, parseFloat(document.getElementById('editor-add-sustain').value) || 0);
    const note = {
        time: addNoteData.time,
        string: addNoteData.string,
        fret,
        sustain,
        techniques: {},
    };
    S.history.exec(new AddNoteCmd(note));
    hideAddNote();
    draw();
    updateStatus();
};

window.editorHideAddNote = hideAddNote;

// Handle Enter key in add-note dialog
document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && addNoteData) {
        e.preventDefault();
        editorConfirmAddNote();
    }
    if (e.key === 'Escape') {
        hideAddNote();
        hideContextMenu();
        editorHideLoadModal();
    }
});

// ════════════════════════════════════════════════════════════════════
// Audio / Playback
// ════════════════════════════════════════════════════════════════════

async function loadAudio(url) {
    if (!url) return;
    try {
        if (!S.audioCtx) S.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const resp = await fetch(url);
        const buf = await resp.arrayBuffer();
        S.audioBuffer = await S.audioCtx.decodeAudioData(buf);
        S.duration = S.audioBuffer.duration;
        _editorApplyScrollBounds();
        computeWaveform();
    } catch (e) {
        console.error('Audio load error:', e);
    }
}

// Build a high-resolution min / max / RMS cache from one channel of PCM so
// the waveform can render its true (asymmetric) shape and stay sharp when
// zoomed in: `min`/`max` are the signed sample extremes per bin (the peak
// envelope), `rms` is the per-bin loudness (the body). Pure — channel data
// in, typed arrays out — so it's unit-testable. `bins` is the entry count.
function _buildWaveformPeaks(data, binSamples) {
    const bins = Math.max(1, Math.floor(data.length / binSamples));
    const min = new Float32Array(bins);
    const max = new Float32Array(bins);
    const rms = new Float32Array(bins);
    for (let b = 0; b < bins; b++) {
        const start = b * binSamples;
        // The last bin soaks up any remainder so no tail samples are dropped.
        const end = (b === bins - 1) ? data.length : start + binSamples;
        let lo = Infinity, hi = -Infinity, sumSq = 0, cnt = 0;
        for (let s = start; s < end; s++) {
            const v = data[s];
            if (v < lo) lo = v;
            if (v > hi) hi = v;
            sumSq += v * v;
            cnt++;
        }
        min[b] = cnt ? lo : 0;
        max[b] = cnt ? hi : 0;
        rms[b] = cnt ? Math.sqrt(sumSq / cnt) : 0;
    }
    return { min, max, rms, bins };
}

function computeWaveform() {
    if (!S.audioBuffer) return;
    const data = S.audioBuffer.getChannelData(0);
    // ~3 ms per bin: fine enough that each pixel covers ≥1 bin even at high
    // zoom, yet bounded (≈1 MB of typed arrays for a 5-minute song).
    const binSamples = Math.max(64, Math.round(S.audioBuffer.sampleRate * 0.003));
    S.waveformPeaks = _buildWaveformPeaks(data, binSamples);
}

function startPlayback() {
    if (!S.audioBuffer || !S.audioCtx) return;
    if (S.audioCtx.state === 'suspended') S.audioCtx.resume();
    S.audioSource = S.audioCtx.createBufferSource();
    S.audioSource.buffer = S.audioBuffer;
    S.audioSource.connect(S.audioCtx.destination);
    S.audioSource.start(0, S.cursorTime);
    S.playStartWall = S.audioCtx.currentTime;
    S.playStartTime = S.cursorTime;
    S.playing = true;
    updatePlayIcon();
    playbackTick();
}

function stopPlayback() {
    if (S.audioSource) {
        try { S.audioSource.stop(); } catch (_) {}
        S.audioSource = null;
    }
    S.playing = false;
    updatePlayIcon();
    if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
}

function playbackTick() {
    if (!S.playing) return;
    S.cursorTime = S.playStartTime + (S.audioCtx.currentTime - S.playStartWall);
    if (S.cursorTime >= S.duration) {
        // If a live MIDI recording is active, finalize it at the song end
        // before resetting the cursor — otherwise chartTimeNow() keeps
        // advancing past S.duration and emits notes beyond the chart.
        if (_recState === 'recording') {
            editorStopRecordMidi();
        } else {
            stopPlayback();
        }
        S.cursorTime = 0;
        updateTimeDisplay(); // reflect the reset immediately before returning
        draw();
        return; // stopPlayback() already cancelled rafId; don't re-schedule.
    }

    // Auto-scroll to follow cursor
    const cx = timeToX(S.cursorTime);
    const w = canvas ? canvas.width / DPR : 800;
    if (cx > w * 0.8) {
        S.scrollX = _editorClampScrollX(S.cursorTime - (w * 0.3) / S.zoom);
    }

    updateTimeDisplay();
    draw();
    rafId = requestAnimationFrame(playbackTick);
}

function updatePlayIcon() {
    const icon = document.getElementById('editor-play-icon');
    if (!icon) return;
    if (S.playing) {
        icon.innerHTML = '<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>';
    } else {
        icon.innerHTML = '<path d="M8 5v14l11-7z"/>';
    }
}

function updateTimeDisplay() {
    const el = document.getElementById('editor-time-display');
    if (!el) return;
    const fmt = (t) => {
        const m = Math.floor(t / 60);
        const s = Math.floor(t % 60);
        return m + ':' + String(s).padStart(2, '0');
    };
    el.textContent = fmt(S.cursorTime) + ' / ' + fmt(S.duration);
}

// ════════════════════════════════════════════════════════════════════
// File operations
// ════════════════════════════════════════════════════════════════════

async function loadCDLC(filename) {
    setStatus('Loading ' + filename + '...');
    try {
        const resp = await fetch('/api/plugins/editor/load', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ filename }),
        });
        const data = await resp.json();
        if (data.error) { setStatus('Error: ' + data.error); return; }

        S.title = data.title || '';
        S.artist = data.artist || '';
        S.filename = filename;
        S.sessionId = data.session_id;
        S.format = data.format || 'archive';
        S.arrangements = data.arrangements || [];
        // Sloppak sources don't pad tuning to 6 slots like RS XML does,
        // so a bass arrangement arriving with tuning.length === 6 from
        // a sloppak is a genuine 6-string bass (not padded 4-string).
        // Seed `_extendedStrings` so `_stringCountFor` doesn't fall
        // back to the baseline-and-ignore-length-6 heuristic for these.
        // Sloppak sources have authoritative tuning lengths (no RS
        // padding). archive sources still get the `tuningLen > 6` path so
        // a previously-extended-saved archive is detected on reload.
        _seedExtendedStringsFromTuning(S.arrangements, S.format !== 'archive');
        // E2: normalize loaded handshapes into robust editable dicts (wire
        // field names) so span-lane authoring + the save round-trip operate
        // on them. The server emits them per-arrangement (_song_to_dict); the
        // editor kept them verbatim before but never normalized them.
        for (const a of S.arrangements) {
            if (!a) continue;
            a.handshapes = (a.handshapes || []).map(_normalizeHandshape)
                // Drop degenerate zero-/negative-length spans: they convey no
                // region and would render/hit-test as a 2px sliver. Authoring
                // enforces HS_MIN_SPAN; a loaded payload may not.
                .filter(hs => hs.end_time > hs.start_time)
                .sort((x, y) => x.start_time - y.start_time);
        }
        S.beats = data.beats || [];
        S.sections = data.sections || [];
        S.duration = data.duration || 0;
        S.offset = data.offset || 0;
        // Drum tab is loaded server-side when the manifest carries a
        // `drum_tab:` key and the file passes schema validation. Treat
        // a missing/falsey value as "no drums" so the +Drums modal can
        // tell whether the user is adding-or-replacing.
        S.drumTab = data.drum_tab ?? null;
        // Normalize hits: sort by t so drum-editor hit-testing and dragging
        // work correctly even if drum_tab.json was saved out of order.
        if (S.drumTab && Array.isArray(S.drumTab.hits)) {
            S.drumTab.hits.sort((a, b) => (a.t || 0) - (b.t || 0));
        }
        // Freshly loaded from disk — not dirty until the user edits it.
        S.drumTabDirty = false;
        // Exit drum-edit mode on song change so we don't carry a stale
        // selection into a sloppak whose hits[] is different.
        S.drumEditMode = false;
        S.drumSel = new Set();
        // Exit tempo-map mode too — its selection indexes into the old
        // song's beats[].
        S.tempoMapMode = false;
        S.tempoSel = -1;
        S.tempoHover = -1;
        // Abandon any in-progress drag — the global mouse handlers act on
        // S.drag regardless of mode, so a stale drag would otherwise keep
        // mutating the newly-loaded song's data.
        S.drag = null;
        S.currentArr = 0;
        S.sel.clear();
        S.toneSel = null;
        S.anchorSel = null;
        S.handshapeSel = null;
        S.scrollX = 0;
        S.cursorTime = 0;
        // Drop any bar-range selection from the previously-loaded song; a
        // pending view (highway handoff / return trip) re-sets it below.
        S.barSel = null;
        S.returnToHighway = false;
        S.history = new EditHistory();

        // Reset offset UI so _effectiveAudioOffset() doesn't carry over a
        // delta from a previous session's sync nudge into this one.
        _resetOffsetUI();

        // Flatten chord notes into main notes array for unified editing
        flattenChords();
        if (isKeysMode()) updatePianoRange();

        // Update UI
        document.getElementById('editor-song-title').textContent =
            `${S.artist} — ${S.title}`;
        S.createMode = false;
        document.getElementById('editor-save-btn').disabled = false;
        document.getElementById('editor-save-btn').classList.remove('hidden');
        document.getElementById('editor-build-btn').classList.add('hidden');
        document.getElementById('editor-play-btn').disabled = !data.audio_url;
        document.getElementById('editor-sync-btn').classList.toggle('hidden', !data.audio_url);
        document.getElementById('editor-replace-audio-btn').classList.remove('hidden');
        _updateTonesButtonVisibility();
        updateArrangementSelector();
        updateStatus();
        updateTimeDisplay();
        updateBPMDisplay();

        // Load audio
        if (data.audio_url) {
            await loadAudio(data.audio_url);
        }

        draw();
        setStatus('Loaded: ' + S.artist + ' — ' + S.title);
        // Apply a pending view (highway "Edit region" handoff or our own
        // return trip) now that the song is fully loaded, then refresh the
        // Loop-in-3D button's enabled state.
        _applyEditorPendingView(filename);
        _updateLoopIn3DBtn();
    } catch (e) {
        setStatus('Load failed: ' + e.message);
    }
}

function updateArrangementSelector() {
    const sel = document.getElementById('editor-arrangement');
    sel.innerHTML = '';
    S.arrangements.forEach((arr, i) => {
        const opt = document.createElement('option');
        opt.value = i;
        opt.textContent = arr.name;
        sel.appendChild(opt);
    });
    sel.style.display = S.arrangements.length > 1 ? '' : 'none';
    // Re-apply the active arrangement after the rebuild so callers that
    // changed S.currentArr (e.g. + Keys / + Drums append, remove-arr)
    // don't end up with a `<select>` snapped back to option 0 while the
    // canvas edits the appended arrangement. Clamp to the valid range
    // so an out-of-bounds S.currentArr doesn't render as a blank value.
    if (S.arrangements.length > 0) {
        const idx = Math.max(0, Math.min(S.currentArr || 0, S.arrangements.length - 1));
        S.currentArr = idx;
        sel.value = String(idx);
    }

    // "+ Drums" button: shown on any active session — the modal lets the
    // user add OR replace a drum tab. The old gate ("hide when a drums
    // ARRANGEMENT exists") is obsolete now that drums live in their own
    // `drum_tab.json` payload rather than the arrangements list. Legacy
    // sloppaks that still carry a guitar-encoded "drums" arrangement also
    // keep the button visible so the user can upgrade them to the new
    // format.
    const drumsBtn = document.getElementById('editor-add-drums-btn');
    if (drumsBtn) {
        // Gate to sloppak sessions only — drum_tab.json is a sloppak-spec
        // artefact and _save_archive silently ignores the drum_tab payload,
        // so showing the button on archive would mislead users into thinking
        // drums will persist after save. Mirrors the +Keys button pattern.
        drumsBtn.classList.toggle('hidden', !S.sessionId || S.format !== 'sloppak');
        if (S.drumTab) {
            const hitCount = (S.drumTab.hits || []).length;
            const kitCount = (S.drumTab.kit || []).length;
            drumsBtn.textContent = `⟳ Drums (${hitCount})`;
            drumsBtn.title = `Drum tab present: ${hitCount} hits across ${kitCount} pieces — click to replace`;
            drumsBtn.classList.remove('bg-red-900', 'hover:bg-red-800');
            drumsBtn.classList.add('bg-green-900', 'hover:bg-green-800');
        } else {
            drumsBtn.textContent = '+ Drums';
            drumsBtn.title = 'Import a drum tab from a Guitar Pro or MIDI file';
            drumsBtn.classList.add('bg-red-900', 'hover:bg-red-800');
            drumsBtn.classList.remove('bg-green-900', 'hover:bg-green-800');
        }
    }

    // Show "+ Keys" button on sloppak sessions; multiple Keys arrangements are allowed.
    const keysBtn = document.getElementById('editor-add-keys-btn');
    if (keysBtn) {
        keysBtn.classList.toggle('hidden', !S.sessionId || S.format !== 'sloppak');
    }

    // Show "+ Guitar/Bass" (GP guitar/bass import → add or replace) on sloppak
    // sessions only — same gate as +Keys (add-arrangement / chart swap persist
    // only through the sloppak save path).
    const importGuitarBtn = document.getElementById('editor-import-guitar-btn');
    if (importGuitarBtn) {
        importGuitarBtn.classList.toggle('hidden', !S.sessionId || S.format !== 'sloppak');
    }

    // Show "⋮ Strings" tuning editor whenever a guitar/bass arrangement is
    // active (not Keys-mode — piano-roll arrangements have no string concept).
    // Available on both archive and sloppak; the save-time prompt handles the
    // format constraint if archive can't carry the result.
    const stringsBtn = document.getElementById('editor-strings-btn');
    if (stringsBtn) {
        const active = S.arrangements[S.currentArr];
        const stringsMode = !!active
            && !KEYS_PATTERN.test(active.name || '')
            && !/^drums/i.test(active.name || '');
        stringsBtn.classList.toggle('hidden', !S.sessionId || !stringsMode);
    }

    // Show "● Record" (live MIDI) button on sloppak sessions only — archive's
    // add-arrangement path requires an xml_path we can't synthesize, and
    // archive build silently drops extra arrangements anyway. Mirror the
    // "+ Keys" gate exactly so users only see Record where it persists.
    const recBtn = document.getElementById('editor-record-midi-btn');
    if (recBtn) {
        recBtn.classList.toggle('hidden', !S.sessionId || S.format !== 'sloppak');
        if (!navigator.requestMIDIAccess) {
            recBtn.disabled = true;
            recBtn.title = 'Web MIDI not available — use Chrome or Edge.';
        } else {
            recBtn.disabled = false;
            recBtn.title = 'Record a Keys arrangement live from a MIDI keyboard (Chrome/Edge)';
        }
    }

    // Show remove button when there are multiple arrangements
    const removeBtn = document.getElementById('editor-remove-arr-btn');
    if (removeBtn) {
        removeBtn.classList.toggle('hidden', S.arrangements.length <= 1);
    }
}

// ════════════════════════════════════════════════════════════════════
// Load modal
// ════════════════════════════════════════════════════════════════════

async function showLoadModal() {
    const modal = document.getElementById('editor-load-modal');
    modal.classList.remove('hidden');
    document.getElementById('editor-load-search').value = '';

    if (!S.songsList) {
        try {
            S.songsList = await fetch('/api/plugins/editor/songs').then(r => r.json());
        } catch {
            S.songsList = [];
        }
    }
    // Don't dump the whole library on open — it can be thousands of rows.
    // Show a prompt and populate results as the user types (see filterSongs).
    // If the library is empty / the fetch failed, fall through to the
    // existing "No custom song files found" empty state instead of telling the user
    // to search for something that isn't there.
    if (S.songsList && S.songsList.length) renderSongPrompt();
    else renderSongList(S.songsList || []);
    document.getElementById('editor-load-search').focus();
}

// Empty/initial state for the load list: prompt to search rather than
// rendering every custom song up front.
function renderSongPrompt() {
    const list = document.getElementById('editor-load-list');
    if (list) {
        list.innerHTML = '<div class="text-xs text-gray-500 p-3 text-center">Start typing to search by song, artist, or filename…</div>';
    }
}

// Escape a string for safe interpolation into innerHTML. Covers the five
// chars that matter for HTML context (& must be first to avoid double-escape).
function _editorEscHtml(s) {
    return String(s ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// Reset the offset input and its applied-delta dataset, called when loading
// any session so _effectiveAudioOffset() doesn't carry over a previous nudge.
function _resetOffsetUI() {
    const el = document.getElementById('editor-offset');
    if (el) { el.value = '0'; el.dataset.applied = '0'; }
}

function _normalizeSongList(raw) {
    // Backend now returns [{filename, format}] objects. Older deployments
    // may still return plain string filenames — normalize either shape and
    // default missing fields so callers can rely on a consistent shape.
    return (raw || []).map(item => {
        if (typeof item === 'string') {
            return {
                filename: item,
                format: /\.(feedpak|sloppak)$/.test(item.toLowerCase()) ? 'sloppak' : 'archive',
                title: '', artist: '',
            };
        }
        const filename = String(item?.filename ?? '');
        const format = String(item?.format
            ?? (/\.(feedpak|sloppak)$/.test(filename.toLowerCase()) ? 'sloppak' : 'archive'));
        // title/artist are best-effort enrichment from the library cache;
        // absent for unscanned songs, in which case we show the filename only.
        return { filename, format, title: String(item?.title ?? ''), artist: String(item?.artist ?? '') };
    });
}

function renderSongList(files) {
    const list = document.getElementById('editor-load-list');
    files = _normalizeSongList(files);
    list.innerHTML = '';
    if (!files.length) {
        list.innerHTML = '<div class="text-xs text-gray-500 p-2">No custom song files found</div>';
        return;
    }
    // Cap the rendered rows so a broad query (e.g. a single letter) can't
    // inject thousands of nodes; the search box narrows from here.
    const CAP = 200;
    const shown = files.slice(0, CAP);
    // Build the DOM imperatively so filenames never reach innerHTML.
    for (const f of shown) {
        const btn = document.createElement('button');
        btn.className = 'w-full text-left px-3 py-1.5 text-xs text-gray-300 hover:bg-dark-500 rounded flex items-center gap-2';
        btn.addEventListener('click', () => editorLoadFile(f.filename));

        // Prefer the real song name (title — artist) when the library cache
        // had it; fall back to the raw filename otherwise. The filename is
        // always shown as a dim subtitle so it stays identifiable/pickable.
        const songName = f.title
            ? (f.artist ? `${f.title} — ${f.artist}` : f.title)
            : '';
        const col = document.createElement('span');
        col.className = 'flex-1 min-w-0';
        const primary = document.createElement('span');
        primary.className = 'block truncate';
        primary.textContent = songName || f.filename;
        col.appendChild(primary);
        if (songName) {
            const sub = document.createElement('span');
            sub.className = 'block truncate text-[10px] text-gray-500';
            sub.textContent = f.filename;
            col.appendChild(sub);
        }
        btn.appendChild(col);

        const badge = document.createElement('span');
        const badgeColor = f.format === 'sloppak'
            ? 'bg-green-900/40 text-green-300'
            : 'bg-blue-900/40 text-blue-300';
        badge.className = `px-1.5 py-0.5 rounded text-[10px] uppercase tracking-wide ${badgeColor}`;
        badge.textContent = f.format;
        btn.appendChild(badge);

        list.appendChild(btn);
    }
    if (files.length > CAP) {
        const more = document.createElement('div');
        more.className = 'text-xs text-gray-500 p-2 text-center';
        more.textContent = `Showing first ${CAP} of ${files.length} — refine your search`;
        list.appendChild(more);
    }
}

function filterSongs(q) {
    if (!S.songsList) return;
    const query = (q || '').trim().toLowerCase();
    // Empty query → show the prompt (or the empty state if there's nothing
    // to search) instead of the entire library.
    if (!query) { if (S.songsList.length) renderSongPrompt(); else renderSongList([]); return; }
    const list = _normalizeSongList(S.songsList);
    // Match song name, artist, OR raw filename so users can search either way.
    const filtered = list.filter(f =>
        f.filename.toLowerCase().includes(query)
        || (f.title && f.title.toLowerCase().includes(query))
        || (f.artist && f.artist.toLowerCase().includes(query)));
    renderSongList(filtered);
}

// ════════════════════════════════════════════════════════════════════
// Save
// ════════════════════════════════════════════════════════════════════

// True if the *active* arrangement has more strings than stock-RS
// archive can carry (>6 guitar, >4 bass). archive saves are
// per-arrangement (the /save endpoint only writes `arrangement_index`),
// so checking other arrangements would surface the format prompt
// even when the save would only touch a standard one — annoying for
// users who, say, edited bass while leaving an extended lead alone.
// Uses `_stringCountFor` which composes the explicit
// `_extendedStrings` counter with chord-template width and max-note-
// index signals (so a 5-string bass with no notes on the new lane
// still trips the prompt, and a 6-string bass after a high-C add
// does too because `_extendedStrings` is set).
function _activeArrangementExceedsArchiveLimit() {
    const a = S.arrangements[S.currentArr];
    if (!a) return false;
    const isBass = /bass/i.test(a.name || '');
    const roleLimit = isBass ? 4 : 6;
    return _stringCountFor(a) > roleLimit;
}

// Prep work common to all save paths: normalise chord state across
// arrangements, then return the request body for the chosen endpoint.
// `forceFullSnapshot` is true for save_as_sloppak so the new sloppak
// gets every arrangement (not just S.currentArr).
function _buildSaveBody(forceFullSnapshot) {
    if (_recState === 'recording') editorStopRecordMidi();

    const savedArr = S.currentArr;
    if (S.format === 'sloppak' || forceFullSnapshot) {
        for (let i = 0; i < S.arrangements.length; i++) {
            S.currentArr = i;
            flattenChords();
            reconstructChords();
        }
        S.currentArr = savedArr;
    } else {
        reconstructChords();
    }

    const arr = S.arrangements[S.currentArr];
    const body = {
        session_id: S.sessionId,
        arrangement_index: S.currentArr,
        notes: arr.notes,
        chords: arr.chords,
        chord_templates: arr.chord_templates,
        beats: S.beats,
        sections: S.sections,
        // Always ship title/artist so archive saves persist in-session
        // metadata edits too. Backend merges with session metadata
        // (album/year captured at load time) so all four fields
        // round-trip regardless of save path.
        metadata: {
            title: S.title,
            artist: S.artist,
        },
    };
    if (S.format === 'sloppak' || forceFullSnapshot) {
        // Strip the client-only `_editCount` field from each
        // arrangement's tones dict so the backend doesn't see it.
        // Backend reads tones from `body.arrangements[*].tones` here —
        // a top-level `body.tones` would be ignored, so don't
        // duplicate the payload.
        //
        // Skip `tones` entirely when the arrangement has no net
        // authored edits this session. Commands that mutate tones
        // (Add/Move/Remove/Rename) all run `_ensureTones` to
        // synthesize a `{}` shape; if every edit then gets undone,
        // the synthesized object stays behind. Shipping it would
        // overwrite the on-disk `tones: null` sentinel with an
        // empty `{base, slots, changes, definitions}` dict on the
        // next sloppak save.
        body.arrangements = S.arrangements.map(a => {
            if (!a) return a;
            // Strip `_anchorEditCount` / `_handshapeEditCount` from every
            // arrangement so the dirty counters never leak to the backend's
            // wire format. `rest` still carries `handshapes` (remapped by the
            // reconstructChords pass above) for the sloppak round-trip.
            const { _anchorEditCount, _handshapeEditCount, ...rest } = a;
            if (!rest.tones) return rest;
            // Distinguish loaded-but-unauthored data (ship verbatim,
            // round-trip through sloppak) from a synthesized-then-
            // fully-undone state (strip so the backend's preserve
            // branch fires).
            //   - Loaded data: `_editCount` key is *absent* (load
            //     path doesn't set it); ship as-is.
            //   - Authored this session: `_editCount > 0` → ship.
            //   - Synthesized + fully undone: `_editCount === 0`
            //     → strip the field; the empty object would
            //     otherwise overwrite a `tones: null` sentinel on
            //     disk.
            const editCount = rest.tones._editCount;
            if (editCount === 0) {
                const { tones, ...rest2 } = rest;
                return rest2;
            }
            return { ...rest, tones: _stripToneInternals(rest.tones) };
        });
    } else if (_tonesAreDirty(arr)) {
        // Single-arrangement (archive) save — the backend reads
        // `body.tones` directly. Ship it only when net authored
        // edits exist this session; a complete undo back to load
        // state returns the count to 0 → omit the field and let
        // the backend's preserve-from-disk branch fire.
        body.tones = _stripToneInternals(arr.tones);
    }
    // PR3d: ship `anchors_user` for single-arr archive saves when
    // the user has authored anchors this session. Full-snapshot
    // sloppak saves ride through `body.arrangements[i].anchors_user`
    // already (every arrangement object carries it intact).
    if (S.format !== 'sloppak' && !forceFullSnapshot
            && _anchorsAreDirty(arr) && Array.isArray(arr.anchors_user)) {
        body.anchors_user = arr.anchors_user;
    }
    // E2: ship `handshapes` for single-arr archive saves whenever any exist.
    // Unlike anchors (index-free {time,fret,width}), a handshape's `chord_id`
    // is an index into `chord_templates`, which reconstructChords() rebuilds
    // (and remaps the handshapes against) on EVERY save. So a dirty-only gate
    // is unsafe: editing notes can reindex templates while leaving handshapes
    // "clean", and the backend's absent→preserve path (`_FIELD_ABSENT`) would
    // then keep stale `chord_id`s pointing at the wrong rebuilt templates.
    // Shipping the freshly-remapped list keeps chord_ids consistent; ship an
    // empty list only when the user explicitly cleared authored handshapes.
    if (S.format !== 'sloppak' && !forceFullSnapshot && Array.isArray(arr.handshapes)
            && (arr.handshapes.length > 0 || _handshapesAreDirty(arr))) {
        body.handshapes = arr.handshapes;
    }
    // Drum-tab payload — separate from arrangements (see sloppak-spec §5.3).
    // S.drumTab is null while the sloppak has none; after +Drums it holds the
    // parsed JSON dict. Only ship `drum_tab` when the user actually
    // imported / edited it this session (`S.drumTabDirty`) — a tab merely
    // loaded from disk is left out so the backend's no-op path preserves
    // the manifest entry unchanged instead of re-serialising the whole
    // hit list on every unrelated save.
    if (S.drumTabDirty && S.drumTab !== undefined && S.drumTab !== null) {
        body.drum_tab = S.drumTab;
    }
    return body;
}

async function saveCDLC() {
    if (!S.sessionId) return;
    // archive can't carry >6-string guitar / >4-string bass. If the user
    // pushed past those limits while editing, ask them whether to spill
    // into a new .sloppak or accept the truncation before we touch disk.
    if (S.format === 'archive' && _activeArrangementExceedsArchiveLimit()) {
        document.getElementById('editor-save-format-modal').classList.remove('hidden');
        return;
    }
    setStatus('Saving...');
    const body = _buildSaveBody(false);
    try {
        const resp = await fetch('/api/plugins/editor/save', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        const data = await resp.json();
        if (data.error) { setStatus('Save error: ' + data.error); return; }
        setStatus('Saved successfully');
    } catch (e) {
        setStatus('Save failed: ' + e.message);
    } finally {
        flattenChords();
        // (Undo history was invalidated inside _buildSaveBody's reconstructChords
        // rebuild — see #18 there; nothing to reset here.)
        draw();
    }
}

window.editorHideSaveFormatModal = () => {
    document.getElementById('editor-save-format-modal').classList.add('hidden');
};

// "Save as Sloppak" — POST the full arrangement snapshot to the new
// /save_as_sloppak route. The backend writes a .sloppak next to the
// source .archive, then flips the session into sloppak mode so the next
// regular Save uses the native sloppak path.
window.editorSaveAsSloppakConfirm = async () => {
    document.getElementById('editor-save-format-modal').classList.add('hidden');
    if (!S.sessionId) return;
    setStatus('Saving as Sloppak...');
    const body = _buildSaveBody(true);
    try {
        const resp = await fetch('/api/plugins/editor/save_as_sloppak', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        const data = await resp.json();
        if (data.error) { setStatus('Save error: ' + data.error); return; }
        // Flip session into sloppak mode so subsequent edits route to
        // _save_sloppak. The original archive stays on disk untouched.
        if (data.filename) S.filename = data.filename;
        S.format = 'sloppak';
        // Normalize in-memory tuning to the real string count so a
        // subsequent /save (which now goes through the native sloppak
        // path) doesn't serialize the RS-XML length-6 padding back into
        // the sloppak manifest — a later reload would otherwise seed
        // `_extendedStrings` from the padded length and mis-detect a
        // 4-string bass as 6-string.
        for (const arr of S.arrangements) {
            _normalizeTuningToLanes(arr, _stringCountFor(arr));
        }
        // `updateArrangementSelector` is what owns the + Keys / Strings /
        // Record toolbar gates and the remove-arrangement button. Refresh
        // it immediately so the user sees sloppak-only controls light up
        // the moment the conversion lands.
        updateArrangementSelector();
        // Prefer the relative filename over `data.path` so we don't
        // leak absolute server filesystem paths into the status UI.
        const displayName = data.filename || (data.path ? data.path.split('/').pop() : '');
        _kickLibraryRescan();   // new file → surface it in the library automatically
        setStatus('Saved as Sloppak: ' + displayName);
    } catch (e) {
        setStatus('Save failed: ' + e.message);
    } finally {
        flattenChords();
        // (Undo history already invalidated by reconstructChords in _buildSaveBody — #18.)
        draw();
    }
};

// ════════════════════════════════════════════════════════════════════
// UI Helpers
// ════════════════════════════════════════════════════════════════════

function setStatus(msg) {
    const el = document.getElementById('editor-status');
    if (el) el.textContent = msg;
}

// Kick an incremental library rescan so a song the editor just wrote shows up
// without the user manually rescanning from Settings — then refresh the library
// view so it appears without a page reload too. Uses the mtime-based
// /api/rescan, then (on the v3 UI) drops the cached library scroll snapshot so
// the next visit re-fetches, and polls /api/scan-status to reload the grid the
// moment the scan finishes (mirrors the v3 upload flow). No-ops gracefully on
// other UIs — the server still indexes the file regardless.
function _kickLibraryRescan(doneMsg) {
    fetch('/api/rescan', { method: 'POST' }).catch(() => {});
    // Signal plugins (e.g. Song Preview) that the library changed so they can
    // refresh immediately — their own audits read the files on disk and don't
    // need to wait for the core scan to finish.
    try { window.slopsmith?.emit?.('library:changed'); } catch (_) {}
    const songs = window.v3Songs;
    // v3: drop the cached library scroll snapshot so the next Songs visit
    // re-fetches instead of restoring the stale (pre-build) view.
    if (songs) { try { songs._scrollHelpers?.clearSnapshot?.(); } catch (_) {} }
    let sawRunning = false, ticks = 0;
    const timer = setInterval(async () => {
        ticks++;
        let sd = null;
        try { const r = await fetch('/api/scan-status'); if (r.ok) sd = await r.json(); } catch (_) {}
        if (sd && sd.running) sawRunning = true;
        // "Finished" = a scan we watched has stopped, OR we never caught one
        // running within a few ticks (it was quick). Hard bail at ~90s.
        const finished = (sawRunning && sd && !sd.running) || (!sawRunning && ticks >= 4);
        if (finished || ticks >= 90) {
            clearInterval(timer);
            if (finished) {
                if (songs && typeof songs.reload === 'function') {
                    try { songs.reload(); } catch (_) {}   // refresh grid + count
                }
                if (doneMsg) setStatus(doneMsg);            // truthful confirmation
            }
        }
    }, 1000);
}

function updateStatus() {
    const nn = notes();
    const cc = chords();
    document.getElementById('editor-note-count').textContent =
        `${nn.length} notes, ${cc.length} chords` + (S.sel.size ? ` | ${S.sel.size} selected` : '');
    _renderInspector();
    // Selection drives the Loop-in-3D fallback region, so keep the button's
    // enabled state in sync whenever the status (selection count) refreshes.
    _updateLoopIn3DBtn();
    setStatus('Ready');
}

// ════════════════════════════════════════════════════════════════════
// Inspector panel — right-side note attribute editor (PR3b of the
// tones+notation UI follow-up). Reflects S.sel; mutations apply to
// every selected note so multi-select bulk edits work without a new
// command class.
// ════════════════════════════════════════════════════════════════════

// All boolean technique flags the inspector exposes. The label is what
// the UI shows; the key matches the `techniques` dict on a note.
const _INSPECTOR_FLAGS = [
    { key: 'hammer_on',      label: 'Hammer-On' },
    { key: 'pull_off',       label: 'Pull-Off' },
    { key: 'palm_mute',      label: 'Palm Mute' },
    { key: 'fret_hand_mute', label: 'Fret-Hand Mute' },
    { key: 'mute',           label: 'String Mute' },
    { key: 'harmonic',       label: 'Harmonic' },
    { key: 'harmonic_pinch', label: 'Pinch Harmonic' },
    { key: 'accent',         label: 'Accent' },
    { key: 'vibrato',        label: 'Vibrato' },
    { key: 'tremolo',        label: 'Tremolo' },
    { key: 'tap',            label: 'Tap' },
    { key: 'slap',           label: 'Slap' },
    { key: 'pluck',          label: 'Pop (Pluck)' },
    { key: 'link_next',      label: 'Link Next' },
    { key: 'ignore',         label: 'Ignore' },
];

function _selectedNotes() {
    if (!S.sel || S.sel.size === 0) return [];
    const nn = notes();
    return [...S.sel].map(i => nn[i]).filter(Boolean);
}

// Reduce a getter across the selection: returns the shared value, or
// `null` when the selection is mixed. Used to render either a concrete
// value or the "(mixed)" placeholder.
function _selSharedValue(sel, getter, eq) {
    eq = eq || ((a, b) => a === b);
    if (sel.length === 0) return null;
    const first = getter(sel[0]);
    for (let i = 1; i < sel.length; i++) {
        if (!eq(getter(sel[i]), first)) return null;
    }
    return first;
}

function _renderInspector() {
    const el = document.getElementById('editor-inspector');
    if (!el) return;
    const sel = _selectedNotes();
    const wasVisible = !el.classList.contains('hidden');
    if (sel.length === 0) {
        if (wasVisible) {
            el.classList.add('hidden');
            el.innerHTML = '';
            // Hiding the panel grows the canvas wrap back to full
            // width — without a resize the canvas backing buffer keeps
            // the old narrower width and we render into a stale region.
            _scheduleCanvasResize();
        }
        return;
    }
    if (!wasVisible) {
        el.classList.remove('hidden');
        // Showing the panel shrinks the canvas wrap; refresh the canvas
        // backing dimensions so notes stay inside the visible region
        // instead of being clipped past the panel's left edge.
        _scheduleCanvasResize();
    }

    // Header: condensed summary of the selection.
    const sharedString = _selSharedValue(sel, n => n.string);
    const sharedFret = _selSharedValue(sel, n => n.fret);
    const sharedTime = _selSharedValue(sel, n => n.time);
    const sharedSustain = _selSharedValue(sel, n => n.sustain || 0);
    const headerCount = sel.length === 1
        ? '1 note selected'
        : `${sel.length} notes selected`;
    const mixed = '<span class="text-amber-400">(mixed)</span>';
    const fmtStr = v => v === null ? mixed : v;
    const fmtTime = v => v === null ? mixed : v.toFixed(3);
    const fmtSus = v => v === null ? mixed : (v || 0).toFixed(3);

    // Numeric inputs — when the selection has a shared value, prefill
    // it; when mixed, leave blank and let the user supply a new value
    // that applies to all.
    const sharedBend = _selSharedValue(sel, n => (n.techniques && n.techniques.bend) || 0);
    const sharedBt = _selSharedValue(sel, n => (n.techniques && n.techniques.bend_intent) || 0);
    const sharedSlide = _selSharedValue(sel, n => {
        const v = n.techniques && n.techniques.slide_to;
        return v === undefined ? -1 : v;
    });
    const sharedSlideU = _selSharedValue(sel, n => {
        const v = n.techniques && n.techniques.slide_unpitch_to;
        return v === undefined ? -1 : v;
    });
    // Teaching marks (§6.2.2): fret-hand finger, scale-degree override, strum
    // group. Default to -1 (unset) so a note that never authored them reads as
    // unset rather than "mixed" against an authored sibling.
    const sharedFinger = _selSharedValue(sel, n => {
        const v = n.techniques && n.techniques.fret_finger;
        return Number.isInteger(v) ? v : -1;
    });
    const sharedScaleDeg = _selSharedValue(sel, n => {
        const v = n.techniques && n.techniques.scale_degree;
        return Number.isInteger(v) ? v : -1;
    });
    const sharedStrum = _selSharedValue(sel, n => {
        const v = n.techniques && n.techniques.strum_group;
        return Number.isInteger(v) ? v : -1;
    });
    const inputVal = v => v === null ? '' : String(v);

    // Chord inspector (E1): when the selection is a chord (>=2 notes sharing a
    // time), author the shared chord template — name / displayName / per-string
    // fingering / arp. Edits land on the matching `arr.chord_templates` entry
    // (created if this chord hasn't been saved yet), which reconstructChords()
    // carries through save via relinkChordTemplate.
    const chordHtml = _chordInspectorHtml(_selectedChordContext(sel));

    let html = `
        <div class="space-y-1">
            <div class="font-semibold text-gray-100">${headerCount}</div>
            <div class="text-gray-400">string: ${fmtStr(sharedString)}</div>
            <div class="text-gray-400">fret: ${fmtStr(sharedFret)}</div>
            <div class="text-gray-400">time: ${fmtTime(sharedTime)}</div>
            <div class="text-gray-400">sustain: ${fmtSus(sharedSustain)}</div>
        </div>
        ${chordHtml}
        <div class="space-y-2 border-t border-gray-700 pt-3">
            <label class="flex items-center gap-2">
                <span class="w-24 text-gray-400">Sustain</span>
                <input type="number" min="0" step="0.05" value="${inputVal(sharedSustain)}"
                    placeholder="${sharedSustain === null ? 'mixed' : ''}"
                    onchange="editorInspectorSetField('sustain', this.value)"
                    class="flex-1 bg-dark-700 border border-gray-700 rounded px-1 py-0.5 text-xs">
            </label>
            <label class="flex items-center gap-2">
                <span class="w-24 text-gray-400">Bend (semi)</span>
                <input type="number" min="0" max="3" step="0.5" value="${inputVal(sharedBend)}"
                    placeholder="${sharedBend === null ? 'mixed' : ''}"
                    onchange="editorInspectorSetTech('bend', this.value)"
                    class="flex-1 bg-dark-700 border border-gray-700 rounded px-1 py-0.5 text-xs">
            </label>
            <label class="flex items-center gap-2">
                <span class="w-24 text-gray-400">Bend intent</span>
                <select onchange="editorInspectorSetBendIntent(this.value)"
                    class="flex-1 bg-dark-700 border border-gray-700 rounded px-1 py-0.5 text-xs">
                    ${BEND_INTENTS.map(o => `<option value="${o.v}"${o.v === (sharedBt ?? 0) ? ' selected' : ''}>${o.label}</option>`).join('')}
                </select>
            </label>
            <div class="flex items-center gap-2">
                <span class="w-24 text-gray-400">Bend curve</span>
                <button type="button" onclick="editorOpenBendCurve()"
                    class="flex-1 bg-dark-700 hover:bg-dark-600 border border-gray-700 rounded px-1 py-0.5 text-xs">Edit curve…</button>
            </div>
            <label class="flex items-center gap-2">
                <span class="w-24 text-gray-400">Slide to</span>
                <input type="number" min="-1" max="24" step="1" value="${inputVal(sharedSlide)}"
                    placeholder="${sharedSlide === null ? 'mixed' : ''}"
                    onchange="editorInspectorSetTech('slide_to', this.value)"
                    class="flex-1 bg-dark-700 border border-gray-700 rounded px-1 py-0.5 text-xs">
            </label>
            <label class="flex items-center gap-2">
                <span class="w-24 text-gray-400">Slide unp.</span>
                <input type="number" min="-1" max="24" step="1" value="${inputVal(sharedSlideU)}"
                    placeholder="${sharedSlideU === null ? 'mixed' : ''}"
                    onchange="editorInspectorSetTech('slide_unpitch_to', this.value)"
                    class="flex-1 bg-dark-700 border border-gray-700 rounded px-1 py-0.5 text-xs">
            </label>
        </div>
        <div class="space-y-2 border-t border-gray-700 pt-3">
            <div class="text-gray-500 text-[10px] uppercase tracking-wide">Teaching marks</div>
            <label class="flex items-center gap-2">
                <span class="w-24 text-gray-400">Finger</span>
                <select onchange="editorInspectorSetFretFinger(this.value)"
                    class="flex-1 bg-dark-700 border border-gray-700 rounded px-1 py-0.5 text-xs">
                    ${FRET_FINGER_OPTIONS.map(o => `<option value="${o.v}"${o.v === (sharedFinger ?? -1) ? ' selected' : ''}>${o.label}</option>`).join('')}
                </select>
            </label>
            <label class="flex items-center gap-2">
                <span class="w-24 text-gray-400">Scale deg.</span>
                <input type="number" min="-1" max="11" step="1" value="${inputVal(sharedScaleDeg)}"
                    placeholder="${sharedScaleDeg === null ? 'mixed' : 'auto'}"
                    title="0–11 semitones above the key tonic; -1 / blank = auto-derive"
                    onchange="editorInspectorSetScaleDegree(this.value)"
                    class="flex-1 bg-dark-700 border border-gray-700 rounded px-1 py-0.5 text-xs">
            </label>
            <div class="flex items-center gap-2">
                <span class="w-24 text-gray-400">Strum grp ${sharedStrum === null ? '(mixed)' : (sharedStrum >= 0 ? '#' + sharedStrum : '—')}</span>
                <button type="button" onclick="editorGroupAsStrum()"
                    class="flex-1 bg-dark-700 hover:bg-dark-600 border border-gray-700 rounded px-1 py-0.5 text-xs">Group</button>
                <button type="button" onclick="editorUngroupStrum()"
                    class="flex-1 bg-dark-700 hover:bg-dark-600 border border-gray-700 rounded px-1 py-0.5 text-xs">Ungroup</button>
            </div>
        </div>
        <div class="space-y-1 border-t border-gray-700 pt-3">`;

    for (const f of _INSPECTOR_FLAGS) {
        const sharedFlag = _selSharedValue(sel, n => !!(n.techniques && n.techniques[f.key]));
        // Three states: true / false / null (mixed). HTML's `indeterminate`
        // is only set via property, not attribute — handle it after
        // injecting via the post-mount pass below.
        const checked = sharedFlag === true;
        const indeterminate = sharedFlag === null;
        html += `
            <label class="flex items-center gap-2">
                <input type="checkbox" data-flag="${f.key}" ${checked ? 'checked' : ''}
                    ${indeterminate ? 'data-indeterminate="1"' : ''}
                    onchange="editorInspectorSetFlag('${f.key}', this.checked)"
                    class="rounded border-gray-600 bg-dark-700">
                <span>${f.label}</span>
            </label>`;
    }
    html += `</div>`;
    el.innerHTML = html;

    // Apply indeterminate state to the inputs that need it — the
    // attribute alone doesn't work; the JS property does.
    for (const cb of el.querySelectorAll('input[type=checkbox][data-indeterminate="1"]')) {
        cb.indeterminate = true;
    }
}

// Inspector mutators. All operate on the full S.sel so a multi-select
// edit applies bulk-style. Edits skip the undo history for now — PR3b
// keeps the scope tight; a TechBulkCmd lands when the inspector grows
// to need richer per-edit undo (PR3c handles tone/anchor lanes, where
// undo IS load-bearing).

// Bounds for the inspector's numeric inputs. Mirrors the limits the
// prompt-based editors (`promptFret`, `promptSlide`, `promptBend`)
// enforce — `type="number" min/max` on the inputs is only a UI hint;
// users can paste / type out-of-range values, so we clamp here too.
const _INSPECTOR_BOUNDS = {
    // Sustain has no hard upper bound elsewhere (drag-resize / add-note
    // dialog leave it unconstrained), so the inspector matches — only
    // the lower clamp matters for input sanity.
    sustain: { min: 0, max: Infinity, integer: false },
    bend:    { min: 0, max: 3,  integer: false }, // half-steps, 3 = +3 semitones
    // `emptyAs: -1` matches the prompt semantic ("-1 or empty = no
    // slide") so the inspector and `promptSlide` / `promptSlideUnpitch`
    // accept the same set of inputs. Without it, deleting the input
    // value would be treated as a parse error and silently bounce back.
    slide_to:         { min: -1, max: 24, integer: true, emptyAs: -1 },
    slide_unpitch_to: { min: -1, max: 24, integer: true, emptyAs: -1 },
};

function _coerceInspectorNumber(rawValue, bounds) {
    if (rawValue === null || rawValue === undefined) return null;
    const s = String(rawValue).trim();
    if (s === '') {
        // Some fields (slide_to, slide_unpitch_to) interpret an empty
        // input as a "clear" affordance — match the prompt-based path.
        return bounds.emptyAs !== undefined ? bounds.emptyAs : null;
    }
    let v;
    if (bounds.integer) {
        // Strict plain-decimal integer regex — matches the
        // prompt-based path's `_parseFretInput`. Rejects `1e1`, `1.9`,
        // `12abc` so the inspector and the right-click prompt produce
        // the same accept/reject decision on identical input.
        if (!/^[-+]?\d+$/.test(s)) return null;
        v = Number(s);
    } else {
        // `Number('1e1abc')` is NaN; `parseFloat('1e1abc')` would
        // partial-parse to 10. Use `Number(...)` so junk-tail input
        // rejects instead of coercing.
        v = Number(s);
    }
    if (!Number.isFinite(v)) return null;
    if (v < bounds.min) v = bounds.min;
    if (v > bounds.max) v = bounds.max;
    return v;
}

window.editorInspectorSetField = (field, raw) => {
    const sel = _selectedNotes();
    if (sel.length === 0) return;
    const bounds = _INSPECTOR_BOUNDS[field];
    if (!bounds) return;
    const v = _coerceInspectorNumber(raw, bounds);
    if (v === null) {
        // Reject silently — but re-render so the input snaps back to
        // the current shared value instead of leaving the user looking
        // at an unapplied edit.
        _renderInspector();
        return;
    }
    if (field === 'sustain') {
        for (const n of sel) n.sustain = v;
    }
    draw();
    updateStatus();
};

window.editorInspectorSetTech = (key, raw) => {
    const sel = _selectedNotes();
    if (sel.length === 0) return;
    const bounds = _INSPECTOR_BOUNDS[key];
    if (!bounds) return;
    const v = _coerceInspectorNumber(raw, bounds);
    if (v === null) {
        // Same as `editorInspectorSetField` — bounce the input back
        // to the current shared value on rejection so the panel can't
        // drift visually from the underlying model.
        _renderInspector();
        return;
    }
    for (const n of sel) {
        if (!n.techniques) n.techniques = {};
        n.techniques[key] = v;
        // Editing the scalar peak must keep any authored curve consistent
        // (renderers/graders read bnv as authoritative): rescale the curve to
        // the new peak, or drop it when the peak is 0 / the curve is unscalable.
        if (key === 'bend' && sanitizeBendCurve(n.techniques.bend_values)) {
            const scaled = v > 0
                ? rescaleBendCurveToPeak(n.techniques.bend_values, v)
                : null;
            n.techniques.bend_values = scaled;
            // bnv rounds points to 0.1, so a non-0.1 `v` (e.g. 0.25) would leave
            // bn disagreeing with the curve's real peak. Snap bn to the curve.
            if (scaled) n.techniques.bend = scaled.reduce((m, p) => Math.max(m, p.v), 0);
        }
    }
    draw();
    updateStatus();
};

window.editorInspectorSetBendIntent = (raw) => {
    const idxs = [...(S.sel || [])];
    if (!idxs.length) return;
    const bt = Number(raw) || 0;
    S.history.exec(new SetBendIntentCmd(idxs, bt));
    draw();
    updateStatus();
    _renderInspector();
};

window.editorOpenBendCurve = () => {
    const idxs = [...(S.sel || [])];
    if (!idxs.length) return;
    // promptBend re-derives the target set from S.sel; pass any selected index.
    promptBend(idxs[0]);
};

window.editorInspectorSetFlag = (key, on) => {
    const sel = _selectedNotes();
    if (sel.length === 0) return;
    for (const n of sel) {
        if (!n.techniques) n.techniques = {};
        n.techniques[key] = !!on;
    }
    draw();
    updateStatus();
};

// ─── Teaching marks (§6.2.2) ────────────────────────────────────────
// Author fg (fret-hand finger), sd (scale-degree override) and ch (strum
// group) on the current selection. Each is one undoable batch edit
// (SetTeachingMarkCmd). Display only — these never affect grading.
function _applyTeachingMark(key, value) {
    const idxs = [...(S.sel || [])];
    if (!idxs.length) return;
    S.history.exec(new SetTeachingMarkCmd(idxs, key, value));
    draw();
    updateStatus();
    _renderInspector();
}

window.editorInspectorSetFretFinger = (raw) => {
    const v = Math.trunc(Number(raw));
    if (!Number.isFinite(v)) return;
    _applyTeachingMark('fret_finger', Math.max(-1, Math.min(4, v)));
};

window.editorInspectorSetScaleDegree = (raw) => {
    const s = String(raw).trim();
    // Empty input clears the override back to -1 (auto/unset).
    const v = s === '' ? -1 : Math.trunc(Number(s));
    if (!Number.isFinite(v)) { _renderInspector(); return; }
    _applyTeachingMark('scale_degree', Math.max(-1, Math.min(11, v)));
};

// "Group as strum": assign every selected note a shared, unused ch key so the
// highway renders them as one strum/rake gesture (pkd gives direction).
window.editorGroupAsStrum = () => {
    if (!(S.sel && S.sel.size)) return;
    _applyTeachingMark('strum_group', nextUnusedStrumGroup(notes()));
};

// "Ungroup": clear the strum-group key on the selection (-1 = not grouped).
window.editorUngroupStrum = () => {
    if (!(S.sel && S.sel.size)) return;
    _applyTeachingMark('strum_group', -1);
};

// ─── Chord inspector (E1) ───────────────────────────────────────────
// Resolve the current selection to a chord and its width-L fret pattern +
// matching chord template, or null when the selection isn't a chord.
//
// The fret pattern is built from the FULL save-time group — every note sharing
// the selection's `time.toFixed(4)` key — not just the selected subset, and
// using the same key reconstructChords() groups by. That way a partial
// selection (e.g. rectangle-selecting 2 of a 3-note chord) still authors the
// triad's fret key, so the metadata survives the save-time rebuild instead of
// being dropped onto a dyad key reconstructChords() never produces.
function _selectedChordContext(sel) {
    sel = sel || _selectedNotes();
    if (sel.length < 2) return null;
    if (!S.arrangements.length) return null;
    const arr = S.arrangements[S.currentArr];
    if (!arr) return null;
    // The selection must fall within a single save-time group; reconstructChords
    // keys groups on `time.toFixed(4)`, so match that exactly.
    const key = sel[0].time.toFixed(4);
    for (const n of sel) { if (n.time.toFixed(4) !== key) return null; }
    const L = lanes();
    const frets = new Array(L).fill(-1);
    const group = [];
    for (const n of notes()) {
        if (n.time.toFixed(4) !== key) continue;
        group.push(n);
        if (n.string >= 0 && n.string < L) frets[n.string] = n.fret;
    }
    if (group.length < 2) return null; // single note at this time isn't a chord
    const fretKey = _fretKeyForL(frets, L);
    let tmpl = null;
    for (const ct of (arr.chord_templates || [])) {
        if (ct && Array.isArray(ct.frets) && _fretKeyForL(ct.frets, L) === fretKey) { tmpl = ct; break; }
    }
    // Harmony function rides the instance — carried on the chord's notes (_fn).
    const fn = _groupFn(group);
    return { arr, L, frets, fretKey, tmpl, key, fn, group };
}

function _chordAttrEsc(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/"/g, '&quot;')
        .replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Build the chord-section HTML, or '' when the selection isn't a chord. Finger
// pickers are shown only for sounding strings (fret >= 0); unused strings carry
// no finger.
function _chordInspectorHtml(ctx) {
    if (!ctx) return '';
    const t = ctx.tmpl;
    const name = t && typeof t.name === 'string' ? t.name : '';
    const displayName = t && typeof t.displayName === 'string' ? t.displayName : '';
    const arp = !!(t && t.arp);
    const voicing = t && typeof t.voicing === 'string' ? t.voicing : '';
    // Harmony function (§6.3.1) rides the chord instance, not the template.
    const fn = ctx.fn || {};
    const fnRn = typeof fn.rn === 'string' ? fn.rn : '';
    const fnQ = typeof fn.q === 'string' ? fn.q : '';
    const fnDeg = Number.isInteger(fn.deg) ? String(fn.deg) : '';
    const VOICINGS = ['', 'open', 'triad', 'shell', 'drop2', 'drop3', 'barre'];
    const voicingOpts = VOICINGS.map(v =>
        `<option value="${_chordAttrEsc(v)}"${v === voicing ? ' selected' : ''}>${v || '—'}</option>`).join('');
    // §6.6 CAGED shape + guide tones (template fields, display only).
    const caged = _sanitizeCaged(t && t.caged);
    const CAGED_SHAPES = ['', 'C', 'A', 'G', 'E', 'D'];
    const cagedOpts = CAGED_SHAPES.map(v =>
        `<option value="${_chordAttrEsc(v)}"${v === caged ? ' selected' : ''}>${v || '—'}</option>`).join('');
    const guideTonesStr = _sanitizeGuideTones(t && t.guideTones).join(', ');

    let fingersHtml = '';
    for (let i = 0; i < ctx.L; i++) {
        const fr = ctx.frets[i];
        if (fr < 0) continue;
        const cur = (t && Array.isArray(t.fingers) && Number.isFinite(t.fingers[i])) ? t.fingers[i] : -1;
        const opt = (v, label) => `<option value="${v}" ${cur === v ? 'selected' : ''}>${label}</option>`;
        fingersHtml += `
            <label class="flex items-center gap-2">
                <span class="w-24 text-gray-400">S${i + 1} (fret ${fr})</span>
                <select onchange="editorChordSetFinger(${i}, this.value)"
                    class="flex-1 bg-dark-700 border border-gray-700 rounded px-1 py-0.5 text-xs">
                    ${opt(-1, '—')}${opt(0, 'open')}${opt(1, '1')}${opt(2, '2')}${opt(3, '3')}${opt(4, '4')}
                </select>
            </label>`;
    }

    return `
        <div class="space-y-2 border-t border-gray-700 pt-3">
            <div class="font-semibold text-gray-100">Chord</div>
            <label class="flex items-center gap-2">
                <span class="w-24 text-gray-400">Name</span>
                <input type="text" value="${_chordAttrEsc(name)}" placeholder="e.g. Em7"
                    onchange="editorChordSetName(this.value)"
                    class="flex-1 bg-dark-700 border border-gray-700 rounded px-1 py-0.5 text-xs">
            </label>
            <label class="flex items-center gap-2">
                <span class="w-24 text-gray-400">Display</span>
                <input type="text" value="${_chordAttrEsc(displayName)}"
                    placeholder="${_chordAttrEsc(name) || 'same as name'}"
                    onchange="editorChordSetDisplayName(this.value)"
                    class="flex-1 bg-dark-700 border border-gray-700 rounded px-1 py-0.5 text-xs">
            </label>
            ${fingersHtml}
            <label class="flex items-center gap-2">
                <input type="checkbox" ${arp ? 'checked' : ''}
                    onchange="editorChordToggleArp(this.checked)"
                    class="rounded border-gray-600 bg-dark-700">
                <span>Arpeggio</span>
            </label>
            <label class="flex items-center gap-2">
                <span class="w-24 text-gray-400">Voicing</span>
                <select onchange="editorChordSetVoicing(this.value)"
                    title="§6.6 key-independent voicing type (display only)"
                    class="flex-1 bg-dark-700 border border-gray-700 rounded px-1 py-0.5 text-xs">
                    ${voicingOpts}
                </select>
            </label>
            <label class="flex items-center gap-2">
                <span class="w-24 text-gray-400">CAGED</span>
                <select onchange="editorChordSetCaged(this.value)"
                    title="§6.6 CAGED shape the fingering derives from (display only)"
                    class="flex-1 bg-dark-700 border border-gray-700 rounded px-1 py-0.5 text-xs">
                    ${cagedOpts}
                </select>
            </label>
            <label class="flex items-center gap-2">
                <span class="w-24 text-gray-400">Guide tones</span>
                <input type="text" value="${_chordAttrEsc(guideTonesStr)}" placeholder="e.g. 4, 10"
                    onchange="editorChordSetGuideTones(this.value)"
                    title="§6.6 semitone offsets 0-11 above the root (display only)"
                    class="flex-1 bg-dark-700 border border-gray-700 rounded px-1 py-0.5 text-xs">
            </label>
            <div class="space-y-2 border-t border-gray-700 pt-3">
                <div class="text-gray-500 text-[10px] uppercase tracking-wide"
                    title="§6.3.1 harmonic function — display only; all three needed to persist">Function</div>
                <label class="flex items-center gap-2">
                    <span class="w-24 text-gray-400">Numeral</span>
                    <input type="text" value="${_chordAttrEsc(fnRn)}" placeholder="e.g. ii7"
                        onchange="editorChordSetFnRn(this.value)"
                        class="flex-1 bg-dark-700 border border-gray-700 rounded px-1 py-0.5 text-xs">
                </label>
                <label class="flex items-center gap-2">
                    <span class="w-24 text-gray-400">Quality</span>
                    <input type="text" value="${_chordAttrEsc(fnQ)}" placeholder="e.g. m7"
                        onchange="editorChordSetFnQuality(this.value)"
                        class="flex-1 bg-dark-700 border border-gray-700 rounded px-1 py-0.5 text-xs">
                </label>
                <label class="flex items-center gap-2">
                    <span class="w-24 text-gray-400">Root deg.</span>
                    <input type="number" min="0" max="11" step="1" value="${_chordAttrEsc(fnDeg)}"
                        placeholder="0–11"
                        title="0–11 semitones of the chord root above the key tonic"
                        onchange="editorChordSetFnDeg(this.value)"
                        class="flex-1 bg-dark-700 border border-gray-700 rounded px-1 py-0.5 text-xs">
                </label>
            </div>
        </div>`;
}

// Apply a patch (subset of {name, displayName, fingers, arp}) to the selected
// chord's template via the undo history.
function _editorChordPatch(patch) {
    const ctx = _selectedChordContext();
    if (!ctx) return;
    S.history.exec(new EditChordTemplateCmd(S.currentArr, ctx.L, ctx.frets, patch));
    draw();
    _renderInspector();
}

window.editorChordSetName = (raw) => _editorChordPatch({ name: String(raw == null ? '' : raw).trim() });
window.editorChordSetDisplayName = (raw) => _editorChordPatch({ displayName: String(raw == null ? '' : raw).trim() });
window.editorChordToggleArp = (on) => _editorChordPatch({ arp: !!on });
window.editorChordSetVoicing = (raw) => _editorChordPatch({ voicing: String(raw == null ? '' : raw).trim() });
// §6.6 CAGED shape + guide tones — enum/range-guarded, routed as one undoable
// template patch like voicing (sanitizers live in the @pure:chord-relink block).
window.editorChordSetCaged = (raw) => _editorChordPatch({ caged: _sanitizeCaged(raw) });
window.editorChordSetGuideTones = (raw) => _editorChordPatch({ guideTones: _parseGuideTones(raw) });

// Apply a partial harmony-function patch ({rn?|q?|deg?}) to the selected
// chord's instance (the notes at its time), merged onto the current fn, via the
// undo history. fn rides the instance, so it is NOT a template patch.
function _editorChordFnPatch(patch) {
    const ctx = _selectedChordContext();
    if (!ctx) return;
    S.history.exec(new EditChordFnCmd(S.currentArr, ctx.key, ctx.fn, patch));
    draw();
    _renderInspector();
}

window.editorChordSetFnRn = (raw) => _editorChordFnPatch({ rn: String(raw == null ? '' : raw).trim() });
window.editorChordSetFnQuality = (raw) => _editorChordFnPatch({ q: String(raw == null ? '' : raw).trim() });
window.editorChordSetFnDeg = (raw) => {
    const s = String(raw == null ? '' : raw).trim();
    // Blank clears deg; otherwise parse and clamp-validate to 0..11 (else clear).
    const d = s === '' ? null : parseInt(s, 10);
    _editorChordFnPatch({ deg: (Number.isInteger(d) && d >= 0 && d <= 11) ? d : null });
};
window.editorChordSetFinger = (stringIdx, raw) => {
    const ctx = _selectedChordContext();
    if (!ctx) return;
    const i = Number(stringIdx);
    if (!Number.isInteger(i) || i < 0 || i >= ctx.L) return;
    const v = parseInt(raw, 10);
    if (![-1, 0, 1, 2, 3, 4].includes(v)) { _renderInspector(); return; }
    // Fingers persist as one width-L array — start from the current template
    // (or a blank width-L array) and change just this string.
    const base = _normFingers(ctx.tmpl && ctx.tmpl.fingers, ctx.L);
    base[i] = v;
    _editorChordPatch({ fingers: base });
};

function updateZoomDisplay() {
    const el = document.getElementById('editor-zoom-display');
    if (el) el.textContent = Math.round(S.zoom);
}

function _tempoResolvedMeasureIdx() {
    if (!S.tempoMapMode) return -1;
    if (S.tempoSel >= 0) return S.tempoSel;
    const measures = _tempoMeasures();
    if (!measures.length) return -1;
    const t = Math.max(0, S.cursorTime || 0);
    for (let k = measures.length - 1; k >= 0; k--) {
        if (measures[k].time <= t + 1e-6) return measures[k].i;
    }
    return measures[0].i;
}

function updateBPMDisplay() {
    const el = document.getElementById('editor-bpm');
    if (!el || S.beats.length < 2) return;
    if (document.activeElement === el) return;
    if (S.tempoMapMode) {
        const d = _tempoResolvedMeasureIdx();
        const m = _tempoMeasures().find(mm => mm.i === d) || null;
        if (m && !m.isLast && m.bpm > 0) {
            el.value = m.bpm.toFixed(2);
            return;
        }
    }
    el.value = getTabBPM().toFixed(1);
}

function updateTempoSigDisplay() {
    const el = document.getElementById('editor-tempo-sig');
    if (!el || document.activeElement === el) return;
    const d = _tempoResolvedMeasureIdx();
    if (d < 0) {
        el.value = '';
        return;
    }
    el.value = String(_tempoMeasureBeatCount(d));
}

// Defer a `resizeCanvas` until layout has settled — used when a
// sibling panel (inspector) just toggled visibility. Without the
// rAF the panel's `display:none → flex` transition hasn't applied
// when `clientWidth` is read, so the canvas would resize to the
// pre-toggle width.
function _scheduleCanvasResize() {
    // `resizeCanvas` already calls `draw()` once it has the new
    // dimensions; no extra render needed here.
    requestAnimationFrame(() => {
        resizeCanvas();
    });
}

function resizeCanvas() {
    if (!canvas) return;
    const wrap = document.getElementById('editor-canvas-wrap');
    const w = wrap.clientWidth;
    const h = wrap.clientHeight;
    if (w <= 0 || h <= 0) return;

    // Dynamically size lanes to fill available height
    const minBeat = 20, minWave = 50;
    BEAT_H = Math.max(minBeat, Math.floor(h * 0.05));
    WAVEFORM_H = Math.max(minWave, Math.floor(h * 0.12));
    // Reserve `ANCHOR_LANE_H` for the anchor strip below the beat bar
    // so the lanes still fill the remaining vertical space.
    // Reserve the handshape lane (HS_LANE_H) alongside the anchor lane so the
    // note lanes still fill the remaining height; the max(30,…) floor keeps
    // short canvases from starving them.
    LANE_H = Math.max(30, Math.floor((h - WAVEFORM_H - BEAT_H - ANCHOR_LANE_H - HS_LANE_H) / lanes()));

    canvas.width = w * DPR;
    canvas.height = h * DPR;
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    // The max scroll depends on the (now-changed) canvas width — re-clamp so a
    // widen doesn't leave the timeline scrolled past the new max with blank tail.
    _editorApplyScrollBounds();
    draw();
}

// ════════════════════════════════════════════════════════════════════
// Global API (called from HTML)
// ════════════════════════════════════════════════════════════════════

window.editorShowLoadModal = showLoadModal;
window.editorHideLoadModal = () => document.getElementById('editor-load-modal').classList.add('hidden');
window.editorFilterSongs = filterSongs;
window.editorLoadFile = (f) => { editorHideLoadModal(); loadCDLC(f); };
window.editorSave = saveCDLC;
window.editorUndo = () => S.history && S.history.doUndo();
window.editorRedo = () => S.history && S.history.doRedo();
window.editorTogglePlay = () => {
    // Route stops through the recorder while a take is active so the
    // spacebar (or any other transport caller) finalizes the recording
    // cleanly instead of leaving _recState stuck in 'recording'.
    if (_recState === 'recording') {
        editorStopRecordMidi();
        return;
    }
    if (S.playing) stopPlayback(); else startPlayback();
};
window.editorZoom = (dir) => {
    const factor = dir > 0 ? 1.3 : 0.77;
    S.zoom = Math.max(20, Math.min(2000, S.zoom * factor));
    _editorApplyScrollBounds();
    updateZoomDisplay();
    draw();
};
window.editorSetSnap = (idx) => {
    const n = parseInt(idx, 10);
    S.snapIdx = Math.max(0, Math.min(SNAP_VALUES.length - 1, Number.isFinite(n) ? n : S.snapIdx));
    const el = document.getElementById('editor-snap');
    if (el) el.selectedIndex = S.snapIdx;
};
window.editorSetSnapEnabled = (enabled) => {
    S.snapEnabled = !!enabled;
    const el = document.getElementById('editor-snap-enabled');
    if (el) el.checked = S.snapEnabled;
    setStatus(S.snapEnabled ? 'Snap enabled' : 'Snap disabled');
};
window.editorSetBPM = (val) => {
    const newBPM = parseFloat(val);
    if (!newBPM || newBPM <= 0 || S.beats.length < 2) return;
    if (S.tempoMapMode) {
        const d = _tempoResolvedMeasureIdx();
        if (d < 0) return;
        const measures = _tempoMeasures();
        const m = measures.find(mm => mm.i === d) || null;
        if (!m || m.isLast || !(m.bpm > 0)) {
            setStatus('Select a non-final measure to edit its BPM.');
            updateBPMDisplay();
            return;
        }
        const newBeats = _tempoSetMeasureBpmPure(S.beats, d, newBPM, MIN_MEASURE, _r3);
        if (!newBeats) {
            updateBPMDisplay();
            return;
        }
        S.history.exec(new TempoMapCmd(S.beats.map(b => ({ ...b })), newBeats, 'bpm'));
        updateBPMDisplay();
        draw();
        setStatus(`Measure ${m.measure} tempo changed: ${m.bpm.toFixed(2)} → ${newBPM.toFixed(2)} BPM`);
        return;
    }
    const oldBPM = getTabBPM();
    const factor = oldBPM / newBPM;
    if (Math.abs(factor - 1) < 0.001) return;

    // Scale all times
    const nn = notes();
    for (const n of nn) {
        n.time *= factor;
        if (n.sustain) n.sustain *= factor;
    }
    for (const b of S.beats) b.time *= factor;
    for (const s of S.sections) s.start_time *= factor;

    updateBPMDisplay();
    draw();
    setStatus(`Tempo changed: ${oldBPM.toFixed(1)} → ${newBPM.toFixed(1)} BPM`);
};
window.editorSetTempoSignature = (val) => {
    if (!S.tempoMapMode || S.beats.length < 2) return;
    const d = _tempoResolvedMeasureIdx();
    if (d < 0) return;
    const n = parseInt(val, 10);
    if (!Number.isFinite(n)) { updateTempoSigDisplay(); return; }
    const m = _tempoMeasures().find(mm => mm.i === d) || null;
    const prev = _tempoMeasureBeatCount(d);
    _tempoSetBeatsPerMeasure(d, n);
    updateTempoSigDisplay();
    const next = _tempoMeasureBeatCount(d);
    if (m && prev !== next) {
        setStatus(`Measure ${m.measure} time signature changed: ${prev}/4 → ${next}/4`);
    }
};
// Rigidly shift all of ONE arrangement's time-bearing fields by `delta` seconds:
// notes, chords (+ their notes), source + authored anchors, handshape spans, and
// phrase windows. Sustains are durations, so they do NOT move. Field set mirrors
// the tempo-remap walk (_captureScopedTimes / the remap apply). Pure — node-tested.
function _shiftArrangementTimes(arr, delta) {
    if (!arr) return;
    for (const n of (arr.notes || [])) {
        if (typeof n.time === 'number') n.time += delta;
    }
    for (const ch of (arr.chords || [])) {
        if (typeof ch.time === 'number') ch.time += delta;
        for (const cn of (ch.notes || [])) {
            if (typeof cn.time === 'number') cn.time += delta;
        }
    }
    for (const a of (arr.anchors || [])) {
        if (typeof a.time === 'number') a.time += delta;
    }
    for (const a of (arr.anchors_user || [])) {
        if (typeof a.time === 'number') a.time += delta;
    }
    for (const hs of (arr.handshapes || [])) {
        if (typeof hs.start_time === 'number') hs.start_time += delta;
        if (typeof hs.end_time === 'number') hs.end_time += delta;
    }
    for (const ph of (arr.phrases || [])) {
        if (typeof ph.time === 'number') ph.time += delta;
    }
}

window.editorApplyOffset = (val) => {
    const offset = parseFloat(val) || 0;
    const currentOffset = parseFloat(document.getElementById('editor-offset').dataset.applied || '0');
    const delta = offset - currentOffset;
    if (Math.abs(delta) < 0.0001) return;
    // Shift EVERY arrangement, not just the current one. Beats / sections / drums
    // (below) are global, so shifting only the current arrangement's notes left
    // the OTHER arrangements (and every arrangement's chords / anchors /
    // handshapes / phrases) out of phase. The user then re-nudged each one to
    // realign it — poisoning `dataset.applied`, so each later +Keys / +Drums
    // import landed progressively further off (#2). One apply now moves
    // everything together and `dataset.applied` stays the single source of truth.
    for (const arr of S.arrangements) _shiftArrangementTimes(arr, delta);
    for (const b of S.beats) b.time += delta;
    for (const s of S.sections) s.start_time += delta;
    // Drum-tab hits live outside S.arrangements, so the loops above miss
    // them — shift them by the same delta or an offset nudge leaves the
    // drum chart out of sync with the guitar/beats it just realigned.
    // Clamp at 0 and round to 3 dp: the save path rejects hits with a
    // negative `t` as malformed (silent loss), and 3 dp matches the
    // server-side and drum-editor rounding conventions.
    if (S.drumTab && Array.isArray(S.drumTab.hits)) {
        for (const h of S.drumTab.hits) {
            if (typeof h.t === 'number') {
                h.t = Math.max(0, Math.round((h.t + delta) * 1000) / 1000);
            }
        }
        S.drumTabDirty = true;
    }
    document.getElementById('editor-offset').dataset.applied = String(offset);
    draw();
    setStatus(`Offset: ${offset >= 0 ? '+' : ''}${(offset * 1000).toFixed(0)}ms`);
};

// Effective audio offset to send when importing a new arrangement: the
// song's loaded offset plus any UI-applied shift the user already made
// via editorApplyOffset (which moves notes/beats but never updates
// S.offset). Without this, a +Keys/+Drums import after a sync nudge
// lands out of phase with the chart the user just realigned.
function _effectiveAudioOffset() {
    const base = Number(S.offset) || 0;
    const el = document.getElementById('editor-offset');
    const applied = el ? parseFloat(el.dataset.applied || '0') || 0 : 0;
    return base + applied;
}
window.editorNudgeOffset = (delta) => {
    const el = document.getElementById('editor-offset');
    const current = parseFloat(el.value) || 0;
    el.value = (current + delta).toFixed(3);
    editorApplyOffset(el.value);
};
window.editorSelectArrangement = (val) => {
    S.currentArr = parseInt(val) || 0;
    S.sel.clear();
    // Tone + anchor selections are per-arrangement — clear them so
    // Del after the switch doesn't remove a same-ref marker in the
    // new arrangement.
    S.toneSel = null;
    S.anchorSel = null;
    S.handshapeSel = null;
    flattenChords();
    if (isKeysMode()) updatePianoRange();
    draw();
    updateStatus();
};
window.editorToggleTech = (idx, tech) => {
    const n = notes()[idx];
    if (!n.techniques) n.techniques = {};
    n.techniques[tech] = !n.techniques[tech];
    hideContextMenu();
    draw();
    // Refresh the inspector — when the right-click toggle fires on a
    // selected note, the panel's checkbox state needs to follow the
    // mutation or it stays stale until the next selection change.
    _renderInspector();
};

// ════════════════════════════════════════════════════════════════════
// Loop in 3D — hand the selected bar range to the 3D highway, then come
// back to the exact edit position. Pairs with app.js's song:ready loop
// applier (consumes window._pendingHighwayLoop) and the highway's
// "Edit region" button (sets window._editorPendingView). See
// docs / CLAUDE.md "Editor ⇄ 3D Highway region round-trip".
// ════════════════════════════════════════════════════════════════════

// The region to preview, in seconds. Prefer an explicit bar-bar drag
// (S.barSel); otherwise fall back to the span of the current note selection,
// snapped to whole bars — so the user can just select notes (which they
// already know how to do) and hit the button. Returns null when neither
// exists.
function _effectiveLoopRegion() {
    if (S.barSel) return { startTime: S.barSel.startTime, endTime: S.barSel.endTime };
    const sel = _selectedNotes();
    if (sel.length) {
        let lo = Infinity, hi = -Infinity;
        for (const n of sel) {
            lo = Math.min(lo, n.time);
            hi = Math.max(hi, n.time + (n.sustain || 0));
        }
        if (Number.isFinite(lo) && Number.isFinite(hi)) return _barSpanForTimes(lo, hi);
    }
    return null;
}

/* @pure:pending-view:start */
function _resolvePendingViewStatePure(pv, fallbackZoom, viewWidthPx, labelW) {
    const nextZoom = (typeof pv.zoom === 'number' && pv.zoom > 0) ? pv.zoom : fallbackZoom;
    const out = {
        returnToHighway: !!pv.returnToHighway,
        barSel: pv.barSel ? { startTime: pv.barSel.startTime, endTime: pv.barSel.endTime } : null,
        zoom: nextZoom,
        cursorTime: typeof pv.cursorTime === 'number'
            ? pv.cursorTime
            : (pv.barSel ? pv.barSel.startTime : null),
        scrollX: null,
    };
    if (typeof pv.scrollX === 'number') {
        out.scrollX = Math.max(0, pv.scrollX);
    } else if (pv.barSel) {
        const margin = (Math.max(0, viewWidthPx - labelW) * 0.25) / Math.max(0.0001, nextZoom);
        out.scrollX = Math.max(0, pv.barSel.startTime - margin);
    }
    return out;
}
/* @pure:pending-view:end */

// Enable the toolbar button when there's a region to preview (a bar drag OR a
// note selection) on a loaded, playable song. Create-mode sessions have
// nothing on disk for the highway to stream, so they stay disabled.
function _updateLoopIn3DBtn() {
    const btn = document.getElementById('editor-loop3d-btn');
    if (!btn) return;
    const region = _effectiveLoopRegion();
    const ok = !!(region && S.filename && !S.createMode);
    btn.disabled = !ok;
    btn.textContent = S.returnToHighway ? '↩ Back to 3D' : '▶ Loop in 3D';
    btn.title = S.createMode
        ? 'Build the song first to preview it on the 3D highway'
        : (region
            ? (S.returnToHighway
                ? 'Save and preview this region back on the 3D highway'
                : 'Loop this region on the 3D highway')
            : 'Select some notes or set a loop region to pick what the 3D highway should preview');
}
window._editorUpdateLoopIn3DBtn = _updateLoopIn3DBtn;

window.editorLoopIn3D = async () => {
    const region = _effectiveLoopRegion();
    if (!region || !S.filename || S.createMode) return;
    // If saving would defer to the archive-overflow format modal (the
    // arrangement no longer fits the archive's string limit), let the user
    // resolve that first — don't pop the modal AND navigate to the highway on
    // top of it (which would also stream the un-saved chart). saveCDLC() shows
    // the modal; bail out of the handoff so the user can retry after choosing.
    if (S.format === 'archive' && _activeArrangementExceedsArchiveLimit()) {
        await saveCDLC();
        return;
    }
    // Pin the resolved region as the bar selection so it's highlighted and
    // carried in the return context.
    S.barSel = { startTime: region.startTime, endTime: region.endTime };
    const sel = { startTime: region.startTime, endTime: region.endTime };
    // Persist edits in place so the highway streams the latest chart. Uses
    // the same save path as the Save button (in-place sloppak write, not the
    // heavy create-mode build).
    if (S.sessionId) {
        try { await saveCDLC(); } catch (e) { /* surfaced via setStatus */ }
    }
    // Capture where we are so the return trip lands on the same spot.
    const returnCtx = {
        filename: S.filename,
        arrangement: S.currentArr,
        scrollX: S.scrollX,
        zoom: S.zoom,
        cursorTime: S.cursorTime,
        barSel: sel,
    };
    window._pendingHighwayLoop = { a: sel.startTime, b: sel.endTime, returnCtx };
    if (typeof window.playSong === 'function') {
        await window.playSong(S.filename, S.currentArr, {});
    }
};

// Consume a pending view handed over by the highway's "Edit region" button
// (or by our own return trip). Called at the tail of loadCDLC once the song
// is loaded, so scroll/arrangement/selection land on the intended region.
function _applyEditorPendingView(filename) {
    const pv = window._editorPendingView;
    if (!pv || pv.filename !== filename) return;
    window._editorPendingView = null;
    if (typeof pv.arrangement === 'number' &&
        pv.arrangement >= 0 && pv.arrangement < S.arrangements.length &&
        pv.arrangement !== S.currentArr) {
        // Reuse the arrangement switch (re-flattens chords, redraws).
        window.editorSelectArrangement(pv.arrangement);
    }
    const viewW = canvas ? (canvas.width / DPR) : 800;
    const next = _resolvePendingViewStatePure(pv, S.zoom, viewW, LABEL_W);
    S.returnToHighway = next.returnToHighway;
    if (next.barSel) S.barSel = next.barSel;
    if (typeof next.zoom === 'number' && next.zoom > 0) { S.zoom = next.zoom; updateZoomDisplay(); }
    if (typeof next.cursorTime === 'number') S.cursorTime = next.cursorTime;
    if (typeof next.scrollX === 'number') S.scrollX = _editorClampScrollX(next.scrollX);
    else _editorApplyScrollBounds();
    updateStatus();
    _updateLoopIn3DBtn();
    draw();
}

// Allow loading from other plugins/screens
window.editSong = (filename) => {
    showScreen('plugin-editor');
    loadCDLC(filename);
};

// Register an "Open in editor" action on the v3 song-card three-dot menu, so a
// song can be loaded straight into the editor (sibling to core's "Edit
// metadata"). Routed through the shared ui.library-card-injection registry, so
// it only appears when this plugin is loaded — and only in v3, where the
// registry exists (guarded for v2, which has no such menu). register() rejects
// duplicate ids, so re-running the script is a no-op.
(function _registerEditorCardAction() {
    const sm = window.slopsmith;
    if (!sm || !sm.libraryCardActions) return;
    sm.libraryCardActions.register({
        id: 'editor.open-in-editor',
        pluginId: 'editor',
        label: 'Open in editor',
        placement: 'menu',
        order: 15, // just under core's "Edit metadata" (10)
        applies: (song) => !!(song && song.filename),
        run: (song) => window.editSong(song.filename),
    });
})();

// ════════════════════════════════════════════════════════════════════
// Sync Tempo — detect audio BPM and scale notes to match
// ════════════════════════════════════════════════════════════════════

let syncState = { tabBPM: 0, audioBPM: 0 };

function detectAudioBPM() {
    if (!S.audioBuffer) return 0;
    const data = S.audioBuffer.getChannelData(0);
    const sr = S.audioBuffer.sampleRate;

    // Bandpass-approximate: use short + long energy windows for spectral flux
    const winSize = 1024;
    const hopSize = 512;
    const numFrames = Math.floor((data.length - winSize) / hopSize);
    const energy = new Float32Array(numFrames);
    for (let i = 0; i < numFrames; i++) {
        let sum = 0;
        const off = i * hopSize;
        for (let j = 0; j < winSize; j++) {
            sum += data[off + j] * data[off + j];
        }
        energy[i] = Math.sqrt(sum / winSize);
    }

    // Onset: spectral flux with adaptive threshold
    const onset = new Float32Array(numFrames);
    const avgWin = 16;
    for (let i = avgWin; i < numFrames; i++) {
        const diff = Math.max(0, energy[i] - energy[i - 1]);
        // Subtract local average to suppress sustained notes
        let localAvg = 0;
        for (let j = i - avgWin; j < i; j++) localAvg += Math.max(0, energy[j] - energy[j - 1]);
        localAvg /= avgWin;
        onset[i] = Math.max(0, diff - localAvg * 1.2);
    }

    // Autocorrelation for BPM range 60-220
    const frameDur = hopSize / sr;
    const minLag = Math.floor(60 / (220 * frameDur));
    const maxLag = Math.floor(60 / (60 * frameDur));
    const useLen = Math.min(onset.length, Math.floor(30 / frameDur));

    // Collect all peaks, not just the best
    const corrs = new Float32Array(maxLag + 1);
    for (let lag = minLag; lag <= Math.min(maxLag, useLen / 2); lag++) {
        let corr = 0;
        const n = useLen - lag;
        for (let i = 0; i < n; i++) corr += onset[i] * onset[i + lag];
        corrs[lag] = corr;
    }

    // Find top peaks in autocorrelation
    const peaks = [];
    for (let lag = minLag + 1; lag < maxLag; lag++) {
        if (corrs[lag] > corrs[lag - 1] && corrs[lag] > corrs[lag + 1] && corrs[lag] > 0) {
            peaks.push({ lag, corr: corrs[lag], bpm: 60 / (lag * frameDur) });
        }
    }
    peaks.sort((a, b) => b.corr - a.corr);

    if (!peaks.length) return 120;

    // Score each candidate: prefer strong correlation + BPM in 80-180 sweet spot
    // Also check if 2x or 0.5x of a candidate has strong correlation (harmonic check)
    let bestScore = -Infinity;
    let bestBPM = peaks[0].bpm;

    for (const p of peaks.slice(0, 10)) {
        let score = p.corr;

        // Boost BPMs in the 90-180 range (most common for music)
        if (p.bpm >= 90 && p.bpm <= 180) score *= 1.5;
        else if (p.bpm >= 70 && p.bpm <= 200) score *= 1.1;

        // Check if half-tempo has strong support (penalize sub-harmonics)
        const halfLag = Math.round(p.lag / 2);
        if (halfLag >= minLag && halfLag <= maxLag && corrs[halfLag] > p.corr * 0.6) {
            // Half-lag is also strong — this candidate might be a sub-harmonic
            score *= 0.7;
        }

        // Check if double-tempo also has support (confirms this is the real beat)
        const dblLag = p.lag * 2;
        if (dblLag <= maxLag && corrs[dblLag] > p.corr * 0.3) {
            score *= 1.3;
        }

        if (score > bestScore) {
            bestScore = score;
            bestBPM = p.bpm;
        }
    }

    return bestBPM;
}

function getTabBPM() {
    if (S.beats.length < 2) return 120;
    // Find average BPM from downbeats (measure > 0)
    const downbeats = S.beats.filter(b => b.measure > 0);
    if (downbeats.length < 2) {
        // Fallback: use all consecutive beats
        let total = 0;
        for (let i = 1; i < Math.min(S.beats.length, 50); i++) {
            total += S.beats[i].time - S.beats[i - 1].time;
        }
        const avgInterval = total / (Math.min(S.beats.length, 50) - 1);
        return 60 / avgInterval;
    }
    // Measure intervals between consecutive downbeats, divide by beats per measure
    let intervals = [];
    for (let i = 1; i < downbeats.length; i++) {
        const dt = downbeats[i].time - downbeats[i - 1].time;
        // Count beats between these downbeats
        const beatsInMeasure = S.beats.filter(
            b => b.time >= downbeats[i - 1].time && b.time < downbeats[i].time
        ).length;
        if (beatsInMeasure > 0) intervals.push(dt / beatsInMeasure);
    }
    if (!intervals.length) return 120;
    const avg = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    return 60 / avg;
}

window.editorSyncTempo = () => {
    if (!S.audioBuffer || S.beats.length < 2) {
        setStatus('Need audio and beats loaded for sync');
        return;
    }

    setStatus('Detecting audio BPM...');
    syncState.tabBPM = getTabBPM();
    syncState.audioBPM = detectAudioBPM();

    document.getElementById('sync-tab-bpm').textContent = syncState.tabBPM.toFixed(1);
    document.getElementById('sync-audio-bpm').textContent = syncState.audioBPM.toFixed(1);
    document.getElementById('sync-manual-bpm').value = '';
    document.getElementById('sync-offset').value = '0';
    editorSyncUpdateFactor();

    const dlg = document.getElementById('editor-sync-dialog');
    const btn = document.getElementById('editor-sync-btn');
    const rect = btn.getBoundingClientRect();
    dlg.style.left = rect.left + 'px';
    dlg.style.top = (rect.bottom + 4) + 'px';
    dlg.classList.remove('hidden');
    setStatus('Ready');
};

window.editorSyncUpdateFactor = () => {
    const manual = parseFloat(document.getElementById('sync-manual-bpm').value);
    const audioBPM = manual > 0 ? manual : syncState.audioBPM;
    const factor = audioBPM / syncState.tabBPM;
    document.getElementById('sync-factor').textContent = factor.toFixed(4);
    if (manual > 0) {
        document.getElementById('sync-audio-bpm').textContent = manual.toFixed(1) + ' (manual)';
    } else {
        document.getElementById('sync-audio-bpm').textContent = syncState.audioBPM.toFixed(1);
    }
};

window.editorHideSyncDialog = () => {
    document.getElementById('editor-sync-dialog').classList.add('hidden');
};

window.editorApplySync = () => {
    const manual = parseFloat(document.getElementById('sync-manual-bpm').value);
    const audioBPM = manual > 0 ? manual : syncState.audioBPM;
    const factor = audioBPM / syncState.tabBPM;
    const offset = parseFloat(document.getElementById('sync-offset').value) || 0;

    if (factor <= 0 || !isFinite(factor)) return;

    // Scale all note times and sustains
    const nn = notes();
    for (const n of nn) {
        n.time = n.time / factor + offset;
        if (n.sustain) n.sustain = n.sustain / factor;
    }

    // Scale beat times
    for (const b of S.beats) {
        b.time = b.time / factor + offset;
    }

    // Scale section times
    for (const s of S.sections) {
        s.start_time = s.start_time / factor + offset;
    }

    editorHideSyncDialog();
    draw();
    setStatus(`Tempo synced: scaled ${factor.toFixed(4)}x` + (offset ? `, offset ${offset}s` : ''));
};

// ════════════════════════════════════════════════════════════════════
// Create mode
// ════════════════════════════════════════════════════════════════════

let createState = {
    gpPath: null,
    tracks: null,
    audioUrl: null,
    audioMode: 'file', // 'file' or 'youtube'
    artPath: null,
    previewPath: null,
    eofFiles: null,    // FileList[] of selected EOF arrangement XMLs
    initialArrangement: 'Lead',
    initDrumTab: true,
};

// ════════════════════════════════════════════════════════════════════
// "New…" entry point — format picker → sloppak-create OR archive-create.
// The button used to go straight to the archive create modal; drummers
// asked for a sloppak-first path so they don't have to make-archive-
// then-save-as-sloppak just to land in drum-charting mode.
// ════════════════════════════════════════════════════════════════════

// Shared keyboard-handling for dynamically-generated modals: stop
// propagation so global shortcuts can't fire, trap Tab/Shift-Tab so
// focus doesn't escape, close on Escape. Returns the keydown listener
// so callers could remove it on close if they ever wanted to.
function _installModalKeyboard(modal, inner, onClose) {
    const FOCUSABLE_SEL = 'a[href], button:not([disabled]),'
        + ' input:not([disabled]), select:not([disabled]),'
        + ' textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
    // Backdrop must be focusable so click-on-overlay can still receive
    // focus (and we can immediately re-direct it inside) — otherwise
    // the click sends focus to <body>, key events skip the modal
    // handler, and global editor shortcuts (Space/Delete/…) fire
    // through the dimmed background.
    modal.tabIndex = -1;
    modal.addEventListener('mousedown', (e) => {
        if (e.target === modal) {
            // Defer until after the click's default focus change so we
            // win the focus-move race.
            setTimeout(() => {
                const f = inner.querySelector(FOCUSABLE_SEL);
                f?.focus();
            }, 0);
        }
    });
    const handler = (e) => {
        e.stopPropagation();
        if (e.key === 'Escape') {
            e.preventDefault();
            onClose();
            return;
        }
        if (e.key === 'Tab') {
            const items = Array.from(inner.querySelectorAll(FOCUSABLE_SEL));
            if (!items.length) return;
            const first = items[0], last = items[items.length - 1];
            const active = document.activeElement;
            // If focus is on the backdrop itself (after an overlay
            // click) or on anything outside `inner`, Tab would
            // otherwise escape via the browser's default sequential
            // navigation. Pull it back to the appropriate end.
            const insideInner = inner.contains(active);
            if (e.shiftKey && (!insideInner || active === first)) {
                e.preventDefault(); last.focus();
            } else if (!e.shiftKey && (!insideInner || active === last)) {
                e.preventDefault(); first.focus();
            }
        }
    };
    modal.addEventListener('keydown', handler);
    return handler;
}

// Cancel hook for the currently-open `_editorPromptText` modal (null when
// none is open). Lets a newly-opened prompt settle the previous one as a
// cancel so its awaiter never hangs.
let _editorPromptCancel = null;

// In-app replacement for `window.prompt()`, which Electron (the desktop
// app) does not implement — there it returns null and logs a warning, so
// every prompt-based editor action (add/rename section, edit fret/bend/
// slide, edit anchor) silently no-ops on desktop while their no-prompt
// siblings like Delete still work (issue #480). Returns a Promise that
// resolves to the entered string on OK/Enter (the empty string is a valid
// OK, matching `prompt()`), or null on Cancel/Escape. (Clicking the dimmed
// overlay does not dismiss — same as the editor's other modals, which
// re-focus the dialog instead; use Cancel/Escape.)
function _editorPromptText({ title = '', label = '', value = '', placeholder = '' } = {}) {
    return new Promise((resolve) => {
        // Settle any still-open prompt as a cancel BEFORE replacing it, so
        // an in-flight `await` can't hang forever when a second prompt
        // opens (e.g. two quick context-menu actions). `_editorPromptCancel`
        // holds the live prompt's cancel hook; invoking it resolves that
        // Promise with null and clears the ref.
        if (_editorPromptCancel) _editorPromptCancel();
        document.getElementById('editor-text-prompt')?.remove();

        const modal = document.createElement('div');
        modal.id = 'editor-text-prompt';
        modal.className = 'fixed inset-0 bg-black/70 z-50 flex items-center justify-center';

        const inner = document.createElement('div');
        inner.className = 'bg-dark-800 border border-gray-700 rounded-lg p-6 max-w-sm w-full mx-4';

        let settled = false;
        const done = (val) => {
            if (settled) return;
            settled = true;
            _editorPromptCancel = null;
            modal.remove();
            resolve(val);
        };

        // Dialog semantics so assistive tech announces the modal context
        // and that focus is trapped inside it.
        const inputId = 'editor-text-prompt-input';
        inner.setAttribute('role', 'dialog');
        inner.setAttribute('aria-modal', 'true');

        if (title) {
            const h = document.createElement('h3');
            h.id = 'editor-text-prompt-title';
            h.className = 'text-lg font-semibold mb-3';
            h.textContent = title;
            inner.appendChild(h);
            inner.setAttribute('aria-labelledby', h.id);
        } else {
            inner.setAttribute('aria-label', label || 'Input');
        }
        if (label) {
            const l = document.createElement('label');
            l.htmlFor = inputId;
            l.className = 'block text-xs text-gray-400 mb-1';
            l.textContent = label;
            inner.appendChild(l);
        }

        const input = document.createElement('input');
        input.type = 'text';
        input.id = inputId;
        input.value = value;
        input.placeholder = placeholder;
        // When there's no visible <label>, give screen readers a name.
        if (!label) input.setAttribute('aria-label', title || 'Value');
        input.className = 'w-full px-2 py-1 bg-dark-700 border border-gray-600 rounded text-sm mb-4';
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); done(input.value); }
        });
        inner.appendChild(input);

        const row = document.createElement('div');
        row.className = 'flex justify-end gap-2';
        const cancelBtn = document.createElement('button');
        cancelBtn.type = 'button';
        cancelBtn.className = 'px-3 py-1 bg-dark-700 hover:bg-dark-600 rounded text-sm';
        cancelBtn.textContent = 'Cancel';
        cancelBtn.onclick = () => done(null);
        const okBtn = document.createElement('button');
        okBtn.type = 'button';
        okBtn.className = 'px-3 py-1 bg-blue-700 hover:bg-blue-600 rounded text-sm';
        okBtn.textContent = 'OK';
        okBtn.onclick = () => done(input.value);
        row.appendChild(cancelBtn);
        row.appendChild(okBtn);
        inner.appendChild(row);

        modal.appendChild(inner);
        // Escape resolves as a cancel (null); the backdrop only re-focuses.
        _installModalKeyboard(modal, inner, () => done(null));
        // Expose this prompt's cancel so a later prompt can settle it.
        _editorPromptCancel = () => done(null);
        document.body.appendChild(modal);
        input.focus();
        input.select();
    });
}

window.editorShowNewFormatPicker = () => {
    // Remove any stale picker (e.g. opened twice).
    document.getElementById('editor-new-format-picker')?.remove();

    const modal = document.createElement('div');
    modal.id = 'editor-new-format-picker';
    modal.className = 'fixed inset-0 bg-black/70 z-50 flex items-center justify-center';

    const inner = document.createElement('div');
    inner.className = 'bg-dark-800 border border-gray-700 rounded-lg p-6 max-w-md w-full mx-4';

    const title = document.createElement('h3');
    title.className = 'text-lg font-semibold mb-4';
    title.textContent = 'What are you making?';
    inner.appendChild(title);

    const mkBtn = (heading, blurb, onClick) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'w-full text-left p-3 mb-2 bg-dark-700 hover:bg-dark-600 rounded border border-gray-700';
        const h = document.createElement('div');
        h.className = 'font-medium text-sm';
        h.textContent = heading;
        const p = document.createElement('div');
        p.className = 'text-xs text-gray-400 mt-1';
        p.textContent = blurb;
        b.appendChild(h); b.appendChild(p);
        b.onclick = () => { modal.remove(); onClick(); };
        return b;
    };
    inner.appendChild(mkBtn(
        '🎵  Sloppak',
        'Audio + chart with drum tab and stems available from the start. '
        + 'Best for new songs.',
        () => window.editorShowCreateSloppakModal(),
    ));
    inner.appendChild(mkBtn(
        '🎸  Import from Guitar Pro',
        'Build a chart from a Guitar Pro file (.gp3–.gp8). Audio and '
        + 'arrangements are imported and saved as a native .sloppak.',
        () => window.editorShowCreateModal(),
    ));

    const cancel = document.createElement('div');
    cancel.className = 'flex justify-end mt-2';
    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'px-3 py-1 bg-dark-700 hover:bg-dark-600 rounded text-sm';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.onclick = () => modal.remove();
    cancel.appendChild(cancelBtn);
    inner.appendChild(cancel);

    modal.appendChild(inner);
    // Keep global shortcuts (Space → play, Delete → erase notes, etc.)
    // from firing while the picker is open, but handle Escape locally
    // so keyboard users can dismiss without tabbing to Cancel.
    _installModalKeyboard(modal, inner, () => modal.remove());
    document.body.appendChild(modal);
    // Move focus into the modal so subsequent keystrokes (Escape,
    // Tab, etc.) bubble through this listener — otherwise focus
    // stays on the toolbar "New…" button outside the modal and the
    // global onKeyDown still gets keystrokes.
    inner.querySelector('button')?.focus();
};

window.editorShowCreateModal = () => {
    // Include the GP-audio-sync fields so a prior import session's
    // gp8AudioMode / autoSyncAudioUrl / lastSync can't leak into this one
    // (which would apply the previous song's audio/offset to a new import).
    createState = {
        gpPath: null, tracks: null, audioUrl: null, audioMode: 'file', artPath: null,
        previewPath: null, eofFiles: null,
        initialArrangement: 'Lead', initDrumTab: true,
        gp8AudioMode: 'none', autoSyncAudioUrl: null, lastSync: null,
    };
    document.getElementById('editor-create-modal').classList.remove('hidden');
    document.getElementById('editor-create-tracks').classList.add('hidden');
    document.getElementById('editor-create-go').disabled = true;
    document.getElementById('editor-create-status').textContent = '';
    document.getElementById('editor-audio-status').textContent = '';
    document.getElementById('editor-create-gp').value = '';
    document.getElementById('editor-create-audio').value = '';
    document.getElementById('editor-create-yt-url').value = '';
    const _eofIn = document.getElementById('editor-create-eof'); if (_eofIn) _eofIn.value = '';
    const _pvIn = document.getElementById('editor-create-preview'); if (_pvIn) _pvIn.value = '';
    document.getElementById('editor-create-title').value = '';
    document.getElementById('editor-create-artist').value = '';
    document.getElementById('editor-create-album').value = '';
    document.getElementById('editor-create-year').value = '';
    const _drumTab = document.getElementById('editor-create-drum-tab');
    if (_drumTab) _drumTab.checked = true;
    const _goBtn = document.getElementById('editor-create-go');
    if (_goBtn) _goBtn.textContent = 'Import & Open in Editor';
    // Reset the GP8/auto-sync UI so stale banner/section/refine state from a
    // previous session isn't shown before a file is chosen.
    document.getElementById('editor-gp8-audio-banner')?.classList.add('hidden');
    document.getElementById('editor-autosync-section')?.classList.add('hidden');
    document.getElementById('editor-refine-row')?.classList.add('hidden');
    const _gas = document.getElementById('editor-autosync-status');
    if (_gas) _gas.textContent = '';
    const _refineStatus = document.getElementById('editor-refine-status');
    if (_refineStatus) _refineStatus.textContent = '';
    _renderCreateArrangementButtons();
    _refreshCreateBlankOptions();
    editorSetAudioMode('file');
    updateCreateButton();
};

window.editorHideCreateModal = () => {
    document.getElementById('editor-create-modal').classList.add('hidden');
};

// ════════════════════════════════════════════════════════════════════
// Sloppak-create modal — straight to sloppak mode with optional empty
// drum_tab pre-initialised. POSTs multipart {audio, metadata JSON} to
// /api/plugins/editor/create_sloppak; on success the editor opens the
// newly-written sloppak via the existing loadCDLC path.
// ════════════════════════════════════════════════════════════════════

window.editorShowCreateSloppakModal = () => {
    document.getElementById('editor-create-sloppak-modal')?.remove();

    let audioFile = null;

    const modal = document.createElement('div');
    modal.id = 'editor-create-sloppak-modal';
    modal.className = 'fixed inset-0 bg-black/70 z-50 flex items-center justify-center';

    const inner = document.createElement('div');
    inner.className = 'bg-dark-800 border border-gray-700 rounded-lg p-6 max-w-xl w-full mx-4 max-h-[90vh] overflow-y-auto';

    const title = document.createElement('h3');
    title.className = 'text-lg font-semibold mb-1';
    title.textContent = 'New Sloppak';
    inner.appendChild(title);

    const sub = document.createElement('p');
    sub.className = 'text-xs text-gray-400 mb-4';
    sub.textContent = 'Audio + chart in slopsmith\'s native sloppak format.';
    inner.appendChild(sub);

    // ── Audio drop / picker ─────────────────────────────────────────
    // It's a <div> for layout reasons (drop targets need to accept
    // dragover/drop, which is awkward on a native <button>), but
    // semantically it behaves like a button — surface that to assistive
    // tech via role + an accessible name, and to keyboards via the
    // existing Space/Enter handler.
    const dropZone = document.createElement('div');
    dropZone.className = 'border-2 border-dashed border-gray-600 hover:border-gray-500 rounded p-6 mb-3 text-center cursor-pointer transition-colors';
    dropZone.tabIndex = 0;
    dropZone.setAttribute('role', 'button');
    dropZone.setAttribute('aria-label',
        'Pick or drop the audio file for the new sloppak');
    const dropMsg = document.createElement('div');
    dropMsg.className = 'text-sm text-gray-400';
    dropMsg.textContent = 'Drop an audio file here, or click to pick';
    const dropHint = document.createElement('div');
    dropHint.className = 'text-xs text-gray-600 mt-1';
    dropHint.textContent = 'mp3 / wav / flac / m4a / ogg';
    dropZone.appendChild(dropMsg);
    dropZone.appendChild(dropHint);

    const hiddenFileInput = document.createElement('input');
    hiddenFileInput.type = 'file';
    hiddenFileInput.accept = 'audio/*,.mp3,.wav,.flac,.m4a,.ogg,.opus';
    hiddenFileInput.className = 'hidden';
    dropZone.appendChild(hiddenFileInput);

    const setAudio = (file) => {
        audioFile = file || null;
        if (!file) {
            dropMsg.textContent = 'Drop an audio file here, or click to pick';
            dropMsg.className = 'text-sm text-gray-400';
            dropHint.textContent = 'mp3 / wav / flac / m4a / ogg';
            return;
        }
        dropMsg.textContent = `📂 ${file.name}`;
        dropMsg.className = 'text-sm text-gray-200';
        const mb = (file.size / 1048576).toFixed(1);
        // .ogg uploads skip the ffmpeg re-encode pass server-side; the
        // hint should reflect that rather than always promising a
        // re-encode.
        const isOgg = /\.ogg$/i.test(file.name || '');
        dropHint.textContent = isOgg
            ? `${mb} MB — kept as .ogg (no re-encode)`
            : `${mb} MB — re-encoded to .ogg on create`;
    };

    dropZone.onclick = () => hiddenFileInput.click();
    dropZone.onkeydown = (e) => {
        if (e.key === ' ' || e.key === 'Enter') {
            e.preventDefault();
            hiddenFileInput.click();
        }
    };
    hiddenFileInput.onchange = () => setAudio(hiddenFileInput.files?.[0] || null);
    dropZone.ondragover = (e) => {
        e.preventDefault();
        dropZone.classList.add('border-blue-500');
    };
    dropZone.ondragleave = () => dropZone.classList.remove('border-blue-500');
    dropZone.ondrop = (e) => {
        e.preventDefault();
        dropZone.classList.remove('border-blue-500');
        setAudio(e.dataTransfer.files?.[0] || null);
    };
    inner.appendChild(dropZone);

    // ── Metadata fields ─────────────────────────────────────────────
    const mkRow = (label, el) => {
        const row = document.createElement('div');
        row.className = 'mb-2';
        const lab = document.createElement('label');
        lab.className = 'block text-xs text-gray-400 mb-1';
        lab.textContent = label;
        row.appendChild(lab);
        row.appendChild(el);
        return row;
    };
    const mkInput = (placeholder, type = 'text') => {
        const i = document.createElement('input');
        i.type = type;
        i.placeholder = placeholder;
        i.className = 'w-full px-2 py-1 bg-dark-700 border border-gray-700 rounded text-sm';
        return i;
    };

    const titleInput = mkInput('Song title');
    const artistInput = mkInput('Artist');
    const albumInput = mkInput('Album (optional)');
    const yearInput = mkInput('Year (optional)', 'number');
    inner.appendChild(mkRow('Title', titleInput));
    inner.appendChild(mkRow('Artist', artistInput));

    const albumRow = document.createElement('div');
    albumRow.className = 'grid grid-cols-3 gap-2 mb-2';
    const albumWrap = mkRow('Album', albumInput); albumWrap.className = 'col-span-2 mb-0';
    const yearWrap = mkRow('Year', yearInput); yearWrap.className = 'mb-0';
    albumRow.appendChild(albumWrap);
    albumRow.appendChild(yearWrap);
    inner.appendChild(albumRow);

    // ── Initial arrangement ────────────────────────────────────────
    const arrRow = document.createElement('div');
    arrRow.className = 'mb-2';
    const arrLab = document.createElement('label');
    arrLab.className = 'block text-xs text-gray-400 mb-1';
    arrLab.textContent = 'Initial arrangement';
    arrRow.appendChild(arrLab);
    const arrButtons = document.createElement('div');
    arrButtons.className = 'flex gap-1';
    let arrChoice = 'Lead';
    const refreshArrButtons = () => {
        arrButtons.querySelectorAll('button').forEach(b => {
            const on = b.dataset.arr === arrChoice;
            b.className = 'px-3 py-1 rounded text-sm ' + (on
                ? 'bg-blue-600 text-white'
                : 'bg-dark-700 hover:bg-dark-600 text-gray-300');
        });
    };
    for (const name of ['Lead', 'Rhythm', 'Bass']) {
        const b = document.createElement('button');
        b.type = 'button';
        b.dataset.arr = name;
        b.textContent = name;
        b.onclick = () => { arrChoice = name; refreshArrButtons(); };
        arrButtons.appendChild(b);
    }
    refreshArrButtons();
    arrRow.appendChild(arrButtons);
    inner.appendChild(arrRow);

    const arrNote = document.createElement('p');
    arrNote.className = 'text-xs text-gray-500 mb-3';
    arrNote.textContent = 'Default tuning is E standard (Bass: BEAD-equivalent 4 strings). Adjust later from the editor toolbar.';
    inner.appendChild(arrNote);

    // ── Drum tab init ──────────────────────────────────────────────
    const drumWrap = document.createElement('label');
    drumWrap.className = 'flex items-center gap-2 mb-4 cursor-pointer';
    const drumCb = document.createElement('input');
    drumCb.type = 'checkbox';
    drumCb.checked = true;
    drumCb.className = 'cursor-pointer';
    const drumLab = document.createElement('span');
    drumLab.className = 'text-sm';
    drumLab.textContent = 'Also start an empty drum tab';
    drumWrap.appendChild(drumCb);
    drumWrap.appendChild(drumLab);
    inner.appendChild(drumWrap);

    // ── Status + buttons ───────────────────────────────────────────
    const status = document.createElement('div');
    status.className = 'text-xs mb-2 min-h-[1em]';
    inner.appendChild(status);

    const buttons = document.createElement('div');
    buttons.className = 'flex justify-end gap-2';
    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'px-3 py-1 bg-dark-700 hover:bg-dark-600 rounded text-sm';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.onclick = () => modal.remove();

    let inFlight = false;
    const createBtn = document.createElement('button');
    createBtn.className = 'px-3 py-1 bg-green-700 hover:bg-green-600 rounded text-sm font-medium';
    createBtn.textContent = 'Create';
    createBtn.onclick = async () => {
        if (!audioFile) {
            status.textContent = 'Pick an audio file first.';
            status.className = 'text-xs mb-2 min-h-[1em] text-red-400';
            return;
        }
        const t = titleInput.value.trim();
        const a = artistInput.value.trim();
        if (!t) {
            status.textContent = 'Title is required.';
            status.className = 'text-xs mb-2 min-h-[1em] text-red-400';
            titleInput.focus();
            return;
        }
        if (!a) {
            status.textContent = 'Artist is required.';
            status.className = 'text-xs mb-2 min-h-[1em] text-red-400';
            artistInput.focus();
            return;
        }
        const yearRaw = yearInput.value.trim();
        // Send year as a string verbatim — the backend extracts the
        // 4-digit year via regex and accepts either int or str.
        // `Number(yearRaw) || yearRaw` would coerce "1990.5" to a
        // float which the strict backend validator rejects with 400.
        const meta = {
            title: t,
            artist: a,
            album: albumInput.value.trim(),
            year: yearRaw,
            initial_arrangement: arrChoice,
            init_drum_tab: drumCb.checked,
        };
        const fd = new FormData();
        fd.append('audio', audioFile);
        fd.append('metadata', JSON.stringify(meta));

        inFlight = true;
        createBtn.disabled = true;
        cancelBtn.disabled = true;
        status.className = 'text-xs mb-2 min-h-[1em] text-gray-400';
        status.textContent = 'Uploading + building sloppak…';
        try {
            const resp = await fetch('/api/plugins/editor/create_sloppak', {
                method: 'POST', body: fd,
            });
            const data = await resp.json();
            if (!resp.ok || !data.success) {
                status.textContent = 'Error: ' + (data.error || resp.statusText);
                status.className = 'text-xs mb-2 min-h-[1em] text-red-400';
                inFlight = false;
                createBtn.disabled = false;
                cancelBtn.disabled = false;
                return;
            }
            modal.remove();
            _kickLibraryRescan();   // surface the new song in the library automatically
            // Open the freshly-written sloppak via the existing load
            // path so the editor state initialises identically to a
            // normal sloppak load.
            await loadCDLC(data.filename);
        } catch (e) {
            status.textContent = 'Failed: ' + e.message;
            status.className = 'text-xs mb-2 min-h-[1em] text-red-400';
            inFlight = false;
            createBtn.disabled = false;
            cancelBtn.disabled = false;
        }
    };
    buttons.appendChild(cancelBtn);
    buttons.appendChild(createBtn);
    inner.appendChild(buttons);

    modal.appendChild(inner);
    // Stop key events at the modal boundary so the global onKeyDown
    // doesn't intercept Space (toggle play) while typing in inputs,
    // but honor Escape locally so keyboard users can dismiss the
    // dialog the way they'd expect.
    // Escape closes the dialog UNLESS a create is in-flight — once the
    // server-side write starts we don't want Escape to "dismiss" the
    // UI while the request is still going to land a new sloppak (and
    // open it). Cancel button is already disabled in the same state.
    _installModalKeyboard(modal, inner, () => {
        if (inFlight) return;
        modal.remove();
    });
    document.body.appendChild(modal);

    titleInput.focus();
};

window.editorSetAudioMode = (mode) => {
    createState.audioMode = mode;
    document.getElementById('editor-audio-file-input').classList.toggle('hidden', mode !== 'file');
    document.getElementById('editor-audio-yt-input').classList.toggle('hidden', mode !== 'youtube');
    document.getElementById('editor-audio-mode-file').classList.toggle('is-active', mode === 'file');
    document.getElementById('editor-audio-mode-yt').classList.toggle('is-active', mode === 'youtube');
};

window.editorGPFileSelected = async (input) => {
    if (!input.files.length) return;
    const file = input.files[0];
    const status = document.getElementById('editor-create-status');
    status.textContent = 'Uploading Guitar Pro file...';

    const form = new FormData();
    form.append('file', file);

    try {
        const resp = await fetch('/api/plugins/editor/import-gp', { method: 'POST', body: form });
        const data = await resp.json();
        if (data.error) { status.textContent = 'Error: ' + data.error; return; }

        createState.gpPath = data.gp_path;
        createState.tracks = data.tracks;

        // Show track list
        const listEl = document.getElementById('editor-create-track-list');
        listEl.innerHTML = data.tracks.map(t => {
            const isDrums = !!(t.is_drums || t.is_percussion);
            const badge = isDrums ? ' (drums)'
                : t.is_piano ? ' (keys)'
                : '';
            const disabled = t.notes === 0;
            const safeName = _editorEscHtml(t.name);
            return `<label class="flex items-center gap-2 text-xs text-gray-300 py-0.5">
                <input type="checkbox" value="${t.index}" checked
                    class="accent-accent" ${disabled ? 'disabled' : ''}>
                <span class="${isDrums ? 'text-red-300' : t.is_piano ? 'text-indigo-300' : ''}">${safeName}</span>
                <span class="text-gray-600">${Number(t.strings) || 0}str, ${Number(t.notes) || 0} notes${badge}</span>
            </label>`;
        }).join('');
        document.getElementById('editor-create-tracks').classList.remove('hidden');

        // Auto-fill title from filename
        const stem = file.name.replace(/\.(gp[345x]?|gpx)$/i, '');
        if (!document.getElementById('editor-create-title').value) {
            document.getElementById('editor-create-title').value = stem;
        }

        // Show/hide GP8 embedded audio banner and auto-sync section
        const _banner = document.getElementById('editor-gp8-audio-banner');
        const _syncSec = document.getElementById('editor-autosync-section');
        createState.gp8AudioMode = 'none';
        createState.autoSyncAudioUrl = null;
        // Clear any sync result from a previously-selected GP file in this same
        // modal, so editorDoCreate() doesn't seed a stale audio_offset (from the
        // old file) into the conversion of this new one. Also hide the refine
        // row, which only applies to a live sync result.
        createState.lastSync = null;
        const _refineRow = document.getElementById('editor-refine-row');
        if (_refineRow) _refineRow.classList.add('hidden');
        // Also reset the auto-sync UI: clear the status text (so it doesn't
        // still read "ready" against empty state) and the file input value (so
        // re-selecting the same audio file fires a fresh change event).
        const _asStatus = document.getElementById('editor-autosync-status');
        if (_asStatus) _asStatus.textContent = '';
        const _asInput = document.getElementById('editor-autosync-audio');
        if (_asInput) _asInput.value = '';
        if (data.has_embedded_audio) {
            document.getElementById('editor-gp8-sync-count').textContent = data.sync_point_count || 0;
            if (_banner) _banner.classList.remove('hidden');
            if (_syncSec) _syncSec.classList.add('hidden');
            editorSetGP8AudioMode('embedded');
        } else {
            if (_banner) _banner.classList.add('hidden');
            // Show auto-sync section for ALL GP formats — gp_autosync works on GP3-GP8
            if (_syncSec) _syncSec.classList.remove('hidden');
            createState.gp8AudioMode = 'none';
        }

        status.textContent = `Parsed: ${data.tracks.length} tracks found`;
        _refreshCreateBlankOptions();
        updateCreateButton();
    } catch (e) {
        status.textContent = 'Upload failed: ' + e.message;
    }
};

// Shared upload helper for the Create modal and the Replace Audio modal.
// Returns the new audio URL on success or null on missing input / failure.
// The caller is responsible for any "missing input" UX (the helper returns
// null silently in that case so its callers can decide whether to show a
// message — `uploadCreateAudio`'s caller prechecks; the replace flow shows
// a "Choose a file" hint).
async function _uploadAudioForMode({ mode, ytInputId, fileInputId, statusEl }) {
    if (mode === 'youtube') {
        const url = document.getElementById(ytInputId).value.trim();
        if (!url) return null;
        statusEl.textContent = 'Downloading from YouTube...';
        try {
            const resp = await fetch('/api/plugins/editor/youtube-audio', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url }),
            });
            const data = await resp.json();
            if (data.error) { statusEl.textContent = 'Error: ' + data.error; return null; }
            statusEl.textContent = 'Audio ready: ' + (data.title || 'downloaded');
            return data.audio_url;
        } catch (e) {
            statusEl.textContent = 'Download failed: ' + e.message;
            return null;
        }
    }
    const input = document.getElementById(fileInputId);
    if (!input.files.length) return null;
    statusEl.textContent = 'Uploading audio...';
    const form = new FormData();
    form.append('file', input.files[0]);
    try {
        const resp = await fetch('/api/plugins/editor/upload-audio', { method: 'POST', body: form });
        const data = await resp.json();
        if (data.error) { statusEl.textContent = 'Error: ' + data.error; return null; }
        statusEl.textContent = 'Audio uploaded';
        return data.audio_url;
    } catch (e) {
        statusEl.textContent = 'Upload failed: ' + e.message;
        return null;
    }
}

async function uploadCreateAudio() {
    const url = await _uploadAudioForMode({
        mode: createState.audioMode,
        ytInputId: 'editor-create-yt-url',
        fileInputId: 'editor-create-audio',
        statusEl: document.getElementById('editor-audio-status'),
    });
    if (!url) return false;
    createState.audioUrl = url;
    return true;
}

function _createHasAudioInput() {
    if (createState.audioMode === 'youtube') {
        return !!document.getElementById('editor-create-yt-url')?.value.trim();
    }
    return !!(document.getElementById('editor-create-audio')?.files || []).length;
}

/* @pure:create-gate:start */
function _createGateOpenPure(state, ctx) {
    const hasGP = !!state.gpPath;
    const hasEof = !!(state.eofFiles && state.eofFiles.length);
    if (hasGP || hasEof) return true;
    return !!(ctx && ctx.hasAudio && ctx.title && ctx.artist);
}
/* @pure:create-gate:end */

function _renderCreateArrangementButtons() {
    const wrap = document.getElementById('editor-create-arr-buttons');
    if (!wrap) return;
    const choices = ['Lead', 'Rhythm', 'Bass'];
    if (!choices.includes(createState.initialArrangement)) {
        createState.initialArrangement = 'Lead';
    }
    wrap.replaceChildren();
    for (const name of choices) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = name;
        btn.className = 'px-2 py-1 rounded text-xs font-medium '
            + (name === createState.initialArrangement
                ? 'bg-accent text-white'
                : 'bg-dark-600 text-gray-300 hover:bg-dark-500');
        btn.onclick = () => {
            createState.initialArrangement = name;
            _renderCreateArrangementButtons();
            updateCreateButton();
        };
        wrap.appendChild(btn);
    }
}

function _refreshCreateBlankOptions() {
    const blankOpts = document.getElementById('editor-create-blank-opts');
    if (!blankOpts) return;
    blankOpts.classList.toggle('hidden', !!createState.gpPath || !!(createState.eofFiles && createState.eofFiles.length));
}

function updateCreateButton() {
    const title = !!document.getElementById('editor-create-title')?.value.trim();
    const artist = !!document.getElementById('editor-create-artist')?.value.trim();
    const canCreate = _createGateOpenPure(createState, {
        hasAudio: _createHasAudioInput(),
        title,
        artist,
    });
    document.getElementById('editor-create-go').disabled = !canCreate;
}

// Wire up input change events for enabling the create button. Changing the
// Step 2 audio inputs also invalidates a cached upload URL — otherwise
// editorDoCreate() skips re-upload (it only uploads when audioUrl is unset)
// and reuses the previously-selected file/URL.
document.addEventListener('change', (e) => {
    if (e.target.id === 'editor-create-audio') {
        createState.audioUrl = null;
        updateCreateButton();
    } else if (e.target.id === 'editor-create-drum-tab') {
        createState.initDrumTab = !!e.target.checked;
    }
});
document.addEventListener('input', (e) => {
    if (e.target.id === 'editor-create-yt-url') {
        createState.audioUrl = null;
        updateCreateButton();
    } else if (e.target.id === 'editor-create-title' || e.target.id === 'editor-create-artist') {
        updateCreateButton();
    }
});


window.editorSetGP8AudioMode = (mode) => {
    createState.gp8AudioMode = mode;
    const embBtn = document.getElementById('editor-gp8-btn-embedded');
    const uplBtn = document.getElementById('editor-gp8-btn-upload');
    const syncSec = document.getElementById('editor-autosync-section');
    // 'upload' and 'autosync' are both the manual-audio path — treat identically
    const isManual = (mode === 'upload' || mode === 'autosync');
    if (embBtn) embBtn.className = mode === 'embedded'
        ? 'px-2 py-1 rounded text-xs font-medium bg-accent text-white'
        : 'px-2 py-1 rounded text-xs font-medium bg-dark-600 text-gray-300 hover:bg-dark-500';
    if (uplBtn) uplBtn.className = isManual
        ? 'px-2 py-1 rounded text-xs font-medium bg-accent text-white'
        : 'px-2 py-1 rounded text-xs font-medium bg-dark-600 text-gray-300 hover:bg-dark-500';
    if (syncSec) syncSec.classList.toggle('hidden', mode === 'embedded');
};

window.editorAutoSyncAudioSelected = async (input) => {
    if (!input.files.length) return;
    const file = input.files[0];
    const status = document.getElementById('editor-autosync-status');
    if (status) status.textContent = 'Uploading audio...';
    const form = new FormData();
    form.append('file', file);
    try {
        const resp = await fetch('/api/plugins/editor/upload-audio', { method: 'POST', body: form });
        const data = await resp.json();
        if (data.error) { if (status) status.textContent = 'Upload failed: ' + data.error; return; }
        createState.autoSyncAudioUrl = data.audio_url;
        createState.gp8AudioMode = 'autosync';
        // Clear any previous sync result so editorDoCreate() re-runs autosync
        // rather than reusing a stale offset from a prior upload
        createState.lastSync = null;
        const _rr = document.getElementById('editor-refine-row');
        if (_rr) _rr.classList.add('hidden');
        if (status) status.textContent = `✓ ${file.name} ready for auto-sync`;
    } catch (e) {
        if (status) status.textContent = 'Upload failed: ' + e.message;
    }
};

window.editorRefineSync = async () => {
    if (!createState.lastSync || !createState.autoSyncAudioUrl) return;
    const barsPerPoint = Math.max(1, parseInt(document.getElementById('editor-refine-bars').value) || 8);
    const status = document.getElementById('editor-refine-status');
    const btn = document.getElementById('editor-refine-btn');
    if (status) status.textContent = 'Refining...';
    if (btn) btn.disabled = true;
    try {
        const resp = await fetch('/api/plugins/editor/refine-sync', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                audio_url: createState.autoSyncAudioUrl,
                audio_offset: createState.lastSync.audio_offset,
                sync_points: createState.lastSync.sync_points || [],
                bars_per_point: barsPerPoint,
            }),
        });
        const data = await resp.json();
        if (data.error) {
            if (status) status.textContent = `Failed: ${data.error}`;
        } else {
            createState.lastSync = { ...createState.lastSync, ...data };
            if (status) status.textContent = `✓ ${data.sync_point_count} points refined, offset ${(data.audio_offset ?? 0).toFixed(3)}s`;
        }
    } catch (e) {
        if (status) status.textContent = `Error: ${e.message}`;
    } finally {
        if (btn) btn.disabled = false;
    }
};

window.editorDoCreate = async () => {
    // EOF arrangement-XML import takes priority when XML files are selected.
    if (createState.eofFiles && createState.eofFiles.length) {
        await _editorDoEofCreate();
        return;
    }
    if (!createState.gpPath) {
        await _editorDoBlankCreate();
        return;
    }
    const status = document.getElementById('editor-create-status');
    const btn = document.getElementById('editor-create-go');
    btn.disabled = true;

    // 'upload' (user clicked "Supply own audio") and 'autosync' are the same
    // manual-audio path — the auto-sync uploader provides createState
    // .autoSyncAudioUrl for both. Normalise so the offset/audio_url/skip logic
    // below doesn't treat a not-yet-flipped 'upload' as a no-audio import.
    const _gpAudioMode = (createState.gp8AudioMode === 'upload')
        ? 'autosync' : (createState.gp8AudioMode || 'none');

    // Upload/download the Step-2 audio first — but only in modes where it's the
    // source of truth. In embedded mode the GP8 OGG is extracted server-side,
    // and in autosync mode the audio came from the auto-sync uploader, so a
    // stale/invalid Step-2 value must not block (or be downloaded for) the
    // import.
    if (_gpAudioMode !== 'embedded' && _gpAudioMode !== 'autosync') {
        const hasAudioInput = createState.audioMode === 'youtube'
            ? !!document.getElementById('editor-create-yt-url').value.trim()
            : !!(document.getElementById('editor-create-audio').files || []).length;

        if (hasAudioInput && !createState.audioUrl) {
            const ok = await uploadCreateAudio();
            if (!ok) { btn.disabled = false; return; }
        }
    }

    // Get selected track indices
    const checkboxes = document.querySelectorAll('#editor-create-track-list input[type=checkbox]:checked:not(:disabled)');
    const trackIndices = [...checkboxes].map(cb => parseInt(cb.value));

    // Auto-sync: align tab to audio before conversion if user supplied audio.
    // Only carry a prior sync offset forward in autosync mode — in embedded /
    // manual modes a leftover lastSync offset would be sent to convert-gp (and
    // in embedded mode would override the GP8 FramePadding-derived offset),
    // misaligning the import.
    let _autoSyncOffset = _gpAudioMode === 'autosync'
        ? (createState.lastSync?.audio_offset ?? null)
        : null;
    // "Supply own audio" was chosen but no audio file was uploaded — don't
    // silently import with no audio; prompt the user to pick a file (or switch
    // back to embedded/MIDI).
    if (_gpAudioMode === 'autosync' && !createState.autoSyncAudioUrl) {
        status.textContent = 'Select an audio file for auto-sync, or choose a different audio option.';
        btn.disabled = false;
        return;
    }
    if (_gpAudioMode === 'autosync' && createState.autoSyncAudioUrl && _autoSyncOffset === null) {
        status.textContent = 'Auto-syncing tab to audio (~10s)...';
        try {
            const syncResp = await fetch('/api/plugins/editor/autosync-gp', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    gp_path: createState.gpPath,
                    audio_url: createState.autoSyncAudioUrl,
                }),
            });
            const syncData = await syncResp.json();
            if (syncData.ok) {
                _autoSyncOffset = syncData.audio_offset;
                createState.lastSync = syncData;
                // Show refine row and pause — let user optionally refine
                // before clicking Import again to proceed to conversion.
                const _refineRow = document.getElementById('editor-refine-row');
                if (_refineRow) _refineRow.classList.remove('hidden');
                const _goBtn = document.getElementById('editor-create-go');
                if (_goBtn) _goBtn.textContent = 'Import & Open in Editor';
                status.textContent = `✓ Synced: ${syncData.sync_point_count} points, offset ${(_autoSyncOffset ?? 0).toFixed(3)}s — optionally refine below, then click Import.`;
                // Re-enable Import button so user can click again to convert
                if (_goBtn) {
                    _goBtn.disabled = false;
                    _goBtn.removeAttribute('aria-disabled');
                    _goBtn.focus();
                }
                // Store offset and return — user clicks Import again to convert
                createState.lastSync.audio_offset = _autoSyncOffset;
                return;
            } else {
                // Explicit auto-sync was requested but failed — don't silently
                // import a misaligned chart at offset 0. Stop and let the user
                // decide (retry, or remove the audio via ✕ to import unsynced).
                status.textContent = `Auto-sync failed: ${syncData.error || 'unknown error'}. `
                    + 'Click Import to retry, or remove the audio (✕) to import without sync.';
                btn.disabled = false;
                return;
            }
        } catch (_) {
            status.textContent = 'Auto-sync request failed (network/server). '
                + 'Click Import to retry, or remove the audio (✕) to import without sync.';
            btn.disabled = false;
            return;
        }
    }

    status.textContent = 'Converting Guitar Pro to chart...';

    // Resolve which audio URL to send to convert-gp and persist it so
    // editorBuild() uses the same value on subsequent builds.
    //   - autosync: the uploaded auto-sync audio
    //   - embedded: send empty — the backend extracts the GP8 OGG, and a stale
    //     user URL here would (a) mask an extraction failure and (b) be used
    //     instead of the embedded track. The extracted URL is persisted from
    //     the response below.
    //   - otherwise: whatever audio the user supplied in Step 2.
    let _convertAudioUrl;
    if (_gpAudioMode === 'embedded') {
        _convertAudioUrl = '';
    } else if (_gpAudioMode === 'autosync' && createState.autoSyncAudioUrl) {
        _convertAudioUrl = createState.autoSyncAudioUrl;
    } else {
        _convertAudioUrl = createState.audioUrl || '';
    }
    if (_convertAudioUrl) createState.audioUrl = _convertAudioUrl;

    try {
        const resp = await fetch('/api/plugins/editor/convert-gp', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                gp_path: createState.gpPath,
                audio_url: _convertAudioUrl,
                // Only 'embedded' changes backend behaviour; omit the field
                // otherwise to keep the API surface tight.
                ...(_gpAudioMode === 'embedded' ? { audio_mode: 'embedded' } : {}),
                ...(_autoSyncOffset !== null ? { audio_offset: _autoSyncOffset } : {}),
                track_indices: trackIndices.length ? trackIndices : null,
                title: document.getElementById('editor-create-title').value || 'Untitled',
                artist: document.getElementById('editor-create-artist').value || 'Unknown',
                album: document.getElementById('editor-create-album').value || '',
                year: document.getElementById('editor-create-year').value || '',
            }),
        });
        const data = await resp.json();
        if (data.error) { status.textContent = 'Error: ' + data.error; btn.disabled = false; return; }

        await window.editorApplyCreateResult(data);
    } catch (e) {
        status.textContent = 'Import failed: ' + e.message;
        btn.disabled = false;
    }
};

async function _editorDoBlankCreate() {
    const status = document.getElementById('editor-create-status');
    const btn = document.getElementById('editor-create-go');
    const val = (id) => ((document.getElementById(id)?.value) || '').trim();
    const title = val('editor-create-title');
    const artist = val('editor-create-artist');
    if (!title) {
        if (status) status.textContent = 'Title is required.';
        if (btn) btn.disabled = false;
        return;
    }
    if (!artist) {
        if (status) status.textContent = 'Artist is required.';
        if (btn) btn.disabled = false;
        return;
    }
    if (!_createHasAudioInput()) {
        if (status) status.textContent = 'Audio is required for an audio-only project.';
        if (btn) btn.disabled = false;
        return;
    }
    if (btn) btn.disabled = true;

    if (!createState.audioUrl) {
        status.textContent = 'Uploading audio...';
        const ok = await uploadCreateAudio();
        if (!ok) { if (btn) btn.disabled = false; return; }
    }

    const artInput = document.getElementById('editor-create-art');
    if (artInput && artInput.files && artInput.files.length && !createState.artPath) {
        const form = new FormData();
        form.append('file', artInput.files[0]);
        try {
            const r = await fetch('/api/plugins/editor/upload-art', { method: 'POST', body: form });
            const d = await r.json();
            if (d.art_path) createState.artPath = d.art_path;
        } catch (_) {}
    }

    createState.initDrumTab = !!document.getElementById('editor-create-drum-tab')?.checked;
    const metadata = {
        title,
        artist,
        album: val('editor-create-album'),
        year: val('editor-create-year'),
        audio_url: createState.audioUrl,
        initial_arrangement: createState.initialArrangement || 'Lead',
        init_drum_tab: !!createState.initDrumTab,
    };
    if (createState.artPath) metadata.art_path = createState.artPath;

    const form = new FormData();
    form.append('metadata', JSON.stringify(metadata));
    status.textContent = 'Building sloppak...';
    try {
        const resp = await fetch('/api/plugins/editor/create_sloppak', { method: 'POST', body: form });
        const data = await resp.json();
        if (!resp.ok || !data.success) {
            status.textContent = 'Error: ' + (data.error || resp.statusText);
            if (btn) btn.disabled = false;
            return;
        }
        editorHideCreateModal();
        if (typeof _kickLibraryRescan === 'function') _kickLibraryRescan();
        await loadCDLC(data.filename);
    } catch (e) {
        status.textContent = 'Failed: ' + e.message;
        if (btn) btn.disabled = false;
    }
}

// Apply a create-mode import result (from convert-gp OR import-xml-project) to
// the editor and open it. The two import sources return the same shape
// (_song_to_dict + session_id + create_mode), so this is shared.
window.editorApplyCreateResult = async (data) => {
    // Persist the audio URL the backend actually used (e.g. GP8-extracted or the
    // project's uploaded mix) so editorBuild() reuses it on later builds.
    if (data.audio_url) createState.audioUrl = data.audio_url;

    // Load into editor
    editorHideCreateModal();
    S.title = data.title || '';
    S.artist = data.artist || '';
    S.filename = '';
    S.sessionId = data.session_id;
    S.format = 'sloppak';
    S.arrangements = data.arrangements || [];
    // Create-mode import — the source builds tuning to the actual string count,
    // so length 6 means a genuine 6-string bass / standard guitar (not a
    // padded tuning). Seed `_extendedStrings` to keep `_stringCountFor` honest.
    _seedExtendedStringsFromTuning(S.arrangements, /* authoritative */ true);
    S.beats = data.beats || [];
    S.sections = data.sections || [];
    S.duration = data.duration || 0;
    S.offset = data.offset || 0;
    S.currentArr = 0;
    S.sel.clear();
    S.toneSel = null;
    S.anchorSel = null;
    S.handshapeSel = null;
    S.scrollX = 0;
    S.cursorTime = 0;
    S.barSel = null;
    S.returnToHighway = false;
    S.history = new EditHistory();
    S.createMode = true;

    // An import may carry a drum track (returned as a `drum_tab`) and/or piano
    // "Keys" arrangements. Sessions are always sloppak now; load the imported
    // drum_tab into the drum editor and mark it dirty so the build persists it.
    S.drumTab = data.drum_tab ?? null;
    if (S.drumTab && Array.isArray(S.drumTab.hits)) {
        S.drumTab.hits.sort((a, b) => (a.t || 0) - (b.t || 0));
    }
    S.drumTabDirty = !!S.drumTab;
    S.drumEditMode = false;
    S.drumSel = new Set();
    const _importHasDrums = !!(S.drumTab && (S.drumTab.hits || []).length);
    const _importHasKeys = (S.arrangements || []).some(
        a => KEYS_PATTERN.test(a.name || ''));
    if (_importHasDrums || _importHasKeys) S.format = 'sloppak';

    // Reset offset UI so _effectiveAudioOffset() doesn't carry over a
    // delta from a previous session's sync nudge.
    _resetOffsetUI();

    flattenChords();
    if (isKeysMode()) updatePianoRange();

    document.getElementById('editor-song-title').textContent =
        `${S.artist} — ${S.title} (new)`;
    document.getElementById('editor-save-btn').classList.add('hidden');
    document.getElementById('editor-build-btn').classList.remove('hidden');
    document.getElementById('editor-play-btn').disabled = !data.audio_url;
    document.getElementById('editor-sync-btn').classList.toggle('hidden', !data.audio_url);
    document.getElementById('editor-replace-audio-btn').classList.remove('hidden');
    _updateTonesButtonVisibility();
    updateArrangementSelector();
    updateStatus();
    updateTimeDisplay();
    updateBPMDisplay();

    if (data.audio_url) await loadAudio(data.audio_url);
    draw();
    setStatus('Imported — edit notes then click Build Song');
};

// EOF arrangement XML(s) selected — just record them. The shared "Import & Open"
// button (editorDoCreate) then assembles audio/art/preview/metadata and imports.
window.editorEofFilesSelected = (input) => {
    const xmls = [...(input.files || [])].filter(f => /\.xml$/i.test(f.name));
    createState.eofFiles = xmls.length ? xmls : null;
    _refreshCreateBlankOptions();
    updateCreateButton();
    const st = document.getElementById('editor-create-status');
    if (st) st.textContent = xmls.length
        ? `${xmls.length} EOF arrangement file(s) selected — set audio/art/preview, then Import.`
        : '';
};

// EOF import path for editorDoCreate: upload the (optional) audio, POST the
// arrangement XML(s) + audio URL + metadata, then open the result. Album art and
// the preview clip are baked later at Build (editorBuild), from their own inputs.
async function _editorDoEofCreate() {
    const status = document.getElementById('editor-create-status');
    const btn = document.getElementById('editor-create-go');
    btn.disabled = true;
    try {
        // Audio is optional for EOF (the chart opens regardless), but upload it
        // when supplied so the editor can play in sync.
        const hasAudioFile = !!(document.getElementById('editor-create-audio').files || []).length;
        const hasYt = createState.audioMode === 'youtube'
            && !!document.getElementById('editor-create-yt-url').value.trim();
        if (!createState.audioUrl && (hasAudioFile || hasYt)) {
            status.textContent = 'Uploading audio…';
            await uploadCreateAudio();   // sets createState.audioUrl on success
        }

        status.textContent = 'Importing EOF arrangement(s)…';
        const form = new FormData();
        for (const f of createState.eofFiles) form.append('files', f, f.name);
        form.append('audio_url', createState.audioUrl || '');
        form.append('title', document.getElementById('editor-create-title').value || '');
        form.append('artist', document.getElementById('editor-create-artist').value || '');
        form.append('album', document.getElementById('editor-create-album').value || '');
        form.append('year', document.getElementById('editor-create-year').value || '');

        const resp = await fetch('/api/plugins/editor/import-xml-project',
            { method: 'POST', body: form });
        const data = await resp.json();
        if (data.error) { status.textContent = 'Error: ' + data.error; btn.disabled = false; return; }
        await window.editorApplyCreateResult(data);
    } catch (e) {
        status.textContent = 'Import failed: ' + e.message;
        btn.disabled = false;
    }
}

window.editorBuild = async () => {
    if (!S.sessionId || !S.createMode) return;
    // PR3c: warn before building when authored tone slots have no
    // matching gear definition — DLC Builder defaults them to stock
    // clean in the output archive. Confirm prompt lets the user
    // continue or bail back to the modal to pull definitions in.
    if (!_editorConfirmToneDefinitions()) {
        setStatus('Build cancelled');
        return;
    }
    setStatus('Building custom song...');

    // Reconstruct chords for ALL arrangements before sending. Each
    // arrangement must be flattened first: reconstructChords() rebuilds
    // arr.chords purely from arr.notes, so on an arrangement still in
    // its non-flattened state (chords in arr.chords, not spread into
    // arr.notes) it finds no note clusters and wipes every chord. Only
    // the last-viewed arrangement is flattened, so without this the
    // build silently drops chords from every other arrangement.
    // flattenChords() is a no-op on already-flattened ones — this
    // mirrors the flatten-then-reconstruct pass in _buildSaveBody.
    const savedArr = S.currentArr;
    const allArrangements = [];
    for (let i = 0; i < S.arrangements.length; i++) {
        S.currentArr = i;
        flattenChords();
        reconstructChords();
        const arr = S.arrangements[i];
        // PR3c: include authored tones in the build payload too.
        // Without this, tones authored on the tone lane / via the
        // Tones… modal in create mode would silently drop when
        // building since `editorBuild` doesn't route through
        // `_buildSaveBody`. Gate on the net-edit counter so a build
        // after a full undo doesn't ship unchanged tones.
        let buildTones = null;
        if (_tonesAreDirty(arr)) {
            buildTones = _stripToneInternals(arr.tones);
        }
        const arrEntry = {
            name: arr.name,
            // Ship tuning + capo so the backend's `_is_extended_range`
            // tuning-length check fires for arrangements where the
            // user extended via the Strings modal but hasn't placed
            // notes on the new lanes yet. Without these the build
            // would route to archive and then crash inside the converter's note-chart
            // compiler when it sees the >6 tuning slots.
            tuning: Array.isArray(arr.tuning) ? arr.tuning.slice() : [0, 0, 0, 0, 0, 0],
            capo: arr.capo || 0,
            // Explicit extension counter — required for the 6-string
            // bass case where tuning.length==6 is ambiguous between
            // RS-padded 4-string and genuine 6-string. Backend's
            // `_is_extended_range` consumes this signal too.
            _extendedStrings: arr._extendedStrings || 0,
            notes: arr.notes,
            chords: arr.chords,
            chord_templates: arr.chord_templates,
        };
        if (buildTones) arrEntry.tones = buildTones;
        if (arr._gp_notation) arrEntry._gp_notation = arr._gp_notation;
        // PR3d: include authored anchors too — same dirty-gate as
        // tones so an unauthored build doesn't ship empties. The
        // `_anchorEditCount` counter lives on `arr`, not on the
        // entry built above, so nothing extra to strip here.
        if (_anchorsAreDirty(arr) && Array.isArray(arr.anchors_user)) {
            arrEntry.anchors_user = arr.anchors_user;
        }
        // E2: include handshapes whenever any exist — chord_ids were remapped
        // by the reconstructChords() pass above and must stay consistent with
        // the rebuilt templates (see the archive-save note in _buildSaveBody).
        // `_handshapeEditCount` lives on `arr`, not the entry, so nothing extra
        // to strip. Ship an empty list only on an explicit clear.
        if (Array.isArray(arr.handshapes)
                && (arr.handshapes.length > 0 || _handshapesAreDirty(arr))) {
            arrEntry.handshapes = arr.handshapes;
        }
        allArrangements.push(arrEntry);
    }
    S.currentArr = savedArr;

    // Upload album art if selected
    const artInput = document.getElementById('editor-create-art');
    if (artInput && artInput.files && artInput.files.length && !createState.artPath) {
        const form = new FormData();
        form.append('file', artInput.files[0]);
        try {
            const r = await fetch('/api/plugins/editor/upload-art', { method: 'POST', body: form });
            const d = await r.json();
            if (d.art_path) createState.artPath = d.art_path;
        } catch (_) {}
    }

    // Upload preview clip if selected (baked into the .sloppak as preview.<ext>)
    const previewInput = document.getElementById('editor-create-preview');
    if (previewInput && previewInput.files && previewInput.files.length && !createState.previewPath) {
        const form = new FormData();
        form.append('file', previewInput.files[0]);
        try {
            const r = await fetch('/api/plugins/editor/upload-preview', { method: 'POST', body: form });
            const d = await r.json();
            if (d.preview_path) createState.previewPath = d.preview_path;
        } catch (_) {}
    }

    try {
        const resp = await fetch('/api/plugins/editor/build', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                session_id: S.sessionId,
                arrangements: allArrangements,
                beats: S.beats,
                sections: S.sections,
                audio_url: createState.audioUrl || '',
                art_path: createState.artPath || '',
                preview_path: createState.previewPath || '',
                // Drums and piano "Keys" arrangements can only live in a
                // sloppak. editorDoCreate sets S.format='sloppak' when the GP
                // import brought either; forward that as the build target so
                // the server writes a sloppak (not a archive that silently drops
                // them), and ship the imported drum_tab so it's persisted.
                target_format: S.format === 'sloppak' ? 'sloppak' : '',
                drum_tab: (S.drumTab && Array.isArray(S.drumTab.hits)) ? S.drumTab : null,
                metadata: {
                    title: S.title,
                    artist: S.artist,
                    artistName: S.artist,
                },
            }),
        });
        const data = await resp.json();
        if (data.error) { setStatus('Build error: ' + data.error); return; }
        _kickLibraryRescan();   // refresh the library grid in the background
        setStatus('Built - added to library!');
    } catch (e) {
        setStatus('Build failed: ' + e.message);
    } finally {
        // Re-flatten current arrangement for continued editing
        flattenChords();
        // (Undo history already invalidated by the reconstructChords pass above — #18.)
        draw();
    }
};

// ════════════════════════════════════════════════════════════════════
// Replace audio
// ════════════════════════════════════════════════════════════════════

let replaceAudioState = { audioMode: 'file' };

window.editorShowReplaceAudioModal = () => {
    if (!S.sessionId) return;
    replaceAudioState = { audioMode: 'file' };
    document.getElementById('editor-replace-audio').value = '';
    document.getElementById('editor-replace-yt-url').value = '';
    document.getElementById('editor-replace-audio-status').textContent = '';
    document.getElementById('editor-replace-audio-apply').disabled = false;
    document.getElementById('editor-replace-audio-modal').classList.remove('hidden');
    editorSetReplaceAudioMode('file');
};

window.editorHideReplaceAudioModal = () => {
    document.getElementById('editor-replace-audio-modal').classList.add('hidden');
};

window.editorSetReplaceAudioMode = (mode) => {
    replaceAudioState.audioMode = mode;
    document.getElementById('editor-replace-audio-file-input').classList.toggle('hidden', mode !== 'file');
    document.getElementById('editor-replace-audio-yt-input').classList.toggle('hidden', mode !== 'youtube');
    document.getElementById('editor-replace-mode-file').classList.toggle('is-active', mode === 'file');
    document.getElementById('editor-replace-mode-yt').classList.toggle('is-active', mode === 'youtube');
};

async function _uploadReplaceAudio() {
    const statusEl = document.getElementById('editor-replace-audio-status');
    // Pre-check missing input so we surface a hint here (the shared helper
    // returns null silently on missing input so the create-modal flow's
    // optional-audio path keeps its existing no-status behavior).
    if (replaceAudioState.audioMode === 'youtube') {
        if (!document.getElementById('editor-replace-yt-url').value.trim()) {
            statusEl.textContent = 'Enter a YouTube URL';
            return null;
        }
    } else if (!document.getElementById('editor-replace-audio').files.length) {
        statusEl.textContent = 'Choose a file';
        return null;
    }
    return _uploadAudioForMode({
        mode: replaceAudioState.audioMode,
        ytInputId: 'editor-replace-yt-url',
        fileInputId: 'editor-replace-audio',
        statusEl,
    });
}

window.editorApplyReplaceAudio = async () => {
    if (!S.sessionId) return;
    const status = document.getElementById('editor-replace-audio-status');
    const apply = document.getElementById('editor-replace-audio-apply');
    apply.disabled = true;
    try {
        const audioUrl = await _uploadReplaceAudio();
        if (!audioUrl) { apply.disabled = false; return; }

        const resp = await fetch('/api/plugins/editor/replace-audio', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ session_id: S.sessionId, audio_url: audioUrl }),
        });
        const data = await resp.json();
        if (data.error) {
            status.textContent = 'Error: ' + data.error;
            apply.disabled = false;
            return;
        }

        // Keep create-mode build in sync — Build Song reads createState.audioUrl.
        if (S.createMode) createState.audioUrl = audioUrl;

        // Stop active playback before swapping the buffer; otherwise the old
        // BufferSource keeps playing under the new S.audioBuffer/duration and
        // playbackTick desyncs against the new track length.
        if (S.playing) stopPlayback();
        // loadAudio() swallows fetch/decode errors and only logs to console,
        // so detect failure by checking that the buffer reference actually
        // changed. Without this we would close the modal and announce
        // "Audio replaced" even on an unsupported / corrupt upload.
        const prevBuffer = S.audioBuffer;
        await loadAudio(audioUrl);
        if (!S.audioBuffer || S.audioBuffer === prevBuffer) {
            status.textContent = 'Failed to decode audio (unsupported format?)';
            apply.disabled = false;
            return;
        }
        if (S.cursorTime > S.duration) S.cursorTime = 0;
        _editorApplyScrollBounds();
        document.getElementById('editor-play-btn').disabled = false;
        document.getElementById('editor-sync-btn').classList.remove('hidden');
        updateTimeDisplay();
        draw();

        const HINTS = {
            none:    'Audio replaced',
            save:    'Audio replaced (Save to persist to .sloppak)',
            build:   'Audio replaced (will persist on next Build Song)',
            rebuild: "Audio replaced (playback only — archive won't be repacked)",
        };
        editorHideReplaceAudioModal();
        setStatus(HINTS[data.next_step] || (data.persisted ? HINTS.none : HINTS.rebuild));
    } catch (e) {
        status.textContent = 'Failed: ' + e.message;
        apply.disabled = false;
    }
};

// ════════════════════════════════════════════════════════════════════
// Init
// ════════════════════════════════════════════════════════════════════

// In the fee[dB]ack v0.3.0 "v3" shell the editor renders inside #v3-main — a
// scrolling region whose first child is the (tall, ~170px) #v3-topbar, with the
// screens stacked below it. The legacy root uses `h-screen pt-16`, which makes
// the editor a full 100vh tall (so it overflows past the topbar) and pads the
// top for the now-hidden legacy navbar. In v3 we instead size the root to the
// space left under the topbar — height: calc(100vh - <topbar height>) — and
// keep it in normal flow, so the DAW gets a proper full height WITHOUT covering
// the topbar's search/nav (a ResizeObserver tracks topbar height changes). The
// classic UI is untouched.
let _v3LayoutObs = null;
let _v3TopbarWatch = null;
function _applyV3Layout() {
    if (!(window.slopsmith && window.slopsmith.uiVersion === 'v3')) return;
    const screen = document.getElementById('plugin-editor');
    const root = screen && screen.firstElementChild;
    if (!screen || !root || screen.dataset.v3Layout === '1') return;
    root.classList.remove('h-screen', 'pt-16');
    // Mark the screen container (not just the root) so the shipped v3 theme
    // sheet — scoped under [data-v3-layout="1"] — also reaches the editor's
    // modals/dialogs, which are siblings of the root inside #plugin-editor.
    screen.dataset.v3Layout = '1';
    // Re-query the topbar each call so a topbar that mounts AFTER us is still
    // accounted for (height falls back to full-viewport only while it's absent).
    const fit = () => {
        const tb = document.getElementById('v3-topbar');
        const h = tb ? Math.round(tb.getBoundingClientRect().height) : 0;
        root.style.height = 'calc(100vh - ' + h + 'px)';
        // The wrapper height changed — recompute the canvas backing size and
        // lane geometry (the window-resize path does this too).
        if (typeof resizeCanvas === 'function') resizeCanvas();
    };
    // The editor plugin can initialise before the v3 shell mounts #v3-topbar.
    // Keep fitting until the topbar exists, then attach a ResizeObserver to it
    // (responsive wrap / async-filled content). Bounded so it can't spin forever.
    let tries = 0;
    const ensure = () => {
        fit();
        const tb = document.getElementById('v3-topbar');
        if (tb) {
            if (_v3TopbarWatch) { _v3TopbarWatch.disconnect(); _v3TopbarWatch = null; }
            if (typeof ResizeObserver === 'function' && !_v3LayoutObs) {
                _v3LayoutObs = new ResizeObserver(fit);
                _v3LayoutObs.observe(tb);
            }
        } else if (tries++ < 120) {
            requestAnimationFrame(ensure);
        } else if (!_v3TopbarWatch && typeof MutationObserver === 'function' && document.body) {
            // Topbar still absent after the rAF window — watch the DOM so an
            // unusually late mount can't leave the editor stuck at
            // calc(100vh - 0px). Disconnected as soon as the topbar appears.
            _v3TopbarWatch = new MutationObserver(() => {
                if (document.getElementById('v3-topbar')) ensure();
            });
            _v3TopbarWatch.observe(document.body, { childList: true, subtree: true });
            // Never let the body observer linger: drop it after 10s even if the
            // topbar never mounts, so it can't sit subtree-watching forever.
            setTimeout(() => {
                if (_v3TopbarWatch) { _v3TopbarWatch.disconnect(); _v3TopbarWatch = null; }
            }, 10000);
        }
    };
    ensure();
}

function init() {
    canvas = document.getElementById('editor-canvas');
    if (!canvas) return;
    ctx = canvas.getContext('2d');
    _applyV3Layout();
    S.history = new EditHistory();

    _editorLoadShortcutProfile();

    // Restore the Tempo Map "apply to" scope preference.
    try {
        const sc = localStorage.getItem('editor-tempomap-scope');
        if (sc === 'drum' || sc === 'all') S.tempoRideScope = sc;
    } catch (_) { /* localStorage unavailable */ }

    canvas.addEventListener('mousedown', onMouseDown);
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    canvas.addEventListener('dblclick', onDblClick);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('contextmenu', onContextMenu);
    document.addEventListener('keydown', onKeyDown);
    document.getElementById('editor-loop-strip-track')?.addEventListener('mousedown', _loopStripOnMouseDown);
    document.getElementById('editor-loop-strip-clear')?.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); _clearBarSelection(); });

    // Prevent middle-click paste
    canvas.addEventListener('auxclick', (e) => { if (e.button === 1) e.preventDefault(); });

    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    // Observe screen visibility for resize
    const obs = new MutationObserver(() => {
        const screen = document.getElementById('plugin-editor');
        if (screen && screen.classList.contains('active')) {
            setTimeout(resizeCanvas, 50);
        }
    });
    const screen = document.getElementById('plugin-editor');
    if (screen) obs.observe(screen, { attributes: true, attributeFilter: ['class'] });

    draw();
}

// ════════════════════════════════════════════════════════════════════
// Remove arrangement
// ════════════════════════════════════════════════════════════════════

window.editorRemoveArrangement = async () => {
    if (_recState !== 'idle') {
        setStatus('Cannot remove an arrangement while recording. Stop the take first.');
        return;
    }
    if (S.arrangements.length <= 1) return;
    const removeIdx = S.currentArr;
    const arr = S.arrangements[removeIdx];
    if (!confirm(`Remove "${arr.name}" arrangement?`)) return;

    // Remove from backend first
    if (S.sessionId) {
        try {
            const resp = await fetch('/api/plugins/editor/remove-arrangement', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    session_id: S.sessionId,
                    arrangement_index: removeIdx,
                }),
            });
            const result = await resp.json();
            if (result.error) {
                setStatus('Remove failed: ' + result.error);
                return;
            }
        } catch (e) {
            setStatus('Remove failed: ' + e.message);
            return;
        }
    }

    // Then update frontend state
    S.arrangements.splice(removeIdx, 1);
    S.currentArr = Math.min(removeIdx, S.arrangements.length - 1);
    S.sel.clear();
    flattenChords();
    updateArrangementSelector();
    document.getElementById('editor-arrangement').value = S.currentArr;
    updateStatus();
    draw();
    setStatus(`Removed "${arr.name}" arrangement`);
};

// ════════════════════════════════════════════════════════════════════
// Add Drums — drum_tab.json import from a GP or MIDI file.
// Persists via _buildSaveBody's `drum_tab` field on the next save_song.
// ════════════════════════════════════════════════════════════════════

// Buffered state from the upload phase: a successful parse stores the
// server-side temp path + file kind here, then editorDoAddDrums commits.
// Cleared on every modal-open and on every fresh file selection.
let _addDrumsFile = null;  // { kind: 'gp' | 'midi', path: string }

window.editorShowAddDrumsModal = () => {
    _addDrumsFile = null;
    document.getElementById('editor-add-drums-modal').classList.remove('hidden');
    document.getElementById('editor-add-drums-tracks').classList.add('hidden');
    document.getElementById('editor-add-drums-go').disabled = true;
    document.getElementById('editor-add-drums-status').textContent = '';
    const fileInput = document.getElementById('editor-add-drums-gp');
    if (fileInput) fileInput.value = '';
    // Show the "will replace" notice only when a drum_tab already lives on
    // the sloppak so the user knows what's about to happen.
    const existingEl = document.getElementById('editor-add-drums-existing');
    if (existingEl) {
        existingEl.classList.toggle('hidden', !S.drumTab);
    }
};

window.editorHideAddDrumsModal = () => {
    document.getElementById('editor-add-drums-modal').classList.add('hidden');
};

// File-kind dispatcher — GP path lists tracks via /import-gp, MIDI path
// via /import-drums-midi-list. Both eventually populate the same picker.
window.editorDrumsFileSelected = async (input) => {
    const file = input.files[0];
    if (!file) return;

    const statusEl = document.getElementById('editor-add-drums-status');
    const goBtn = document.getElementById('editor-add-drums-go');

    // Drop any prior successful parse so a later failure can't commit via
    // the older file's path.
    _addDrumsFile = null;
    goBtn.disabled = true;
    document.getElementById('editor-add-drums-tracks').classList.add('hidden');

    // Detect "no extension" explicitly — `split('.').pop()` on a dotless
    // filename returns the whole name, which would otherwise surface a
    // misleading "Unsupported file type: drums" message.
    const dotIdx = file.name.lastIndexOf('.');
    const ext = dotIdx >= 0 ? file.name.slice(dotIdx + 1).toLowerCase() : '';
    const isMidi = (ext === 'mid' || ext === 'midi');
    const isGp = ['gp', 'gp3', 'gp4', 'gp5', 'gpx'].includes(ext);
    if (!isMidi && !isGp) {
        statusEl.textContent = 'Unsupported file type (expected .gp* or .mid/.midi)';
        return;
    }

    statusEl.textContent = isMidi ? 'Parsing MIDI file...' : 'Parsing GP file...';
    const formData = new FormData();
    formData.append('file', file);

    try {
        const url = isMidi
            ? '/api/plugins/editor/import-drums-midi-list'
            : '/api/plugins/editor/import-gp';
        const resp = await fetch(url, { method: 'POST', body: formData });
        const data = await resp.json();
        if (data.error) {
            statusEl.textContent = 'Error: ' + data.error;
            return;
        }

        // Both endpoints return `{tracks: [...]}` shaped the same way.
        // GP returns every track and we filter to drum/percussion; MIDI
        // returns channel-9 only so the filter is a no-op there.
        const tracks = data.tracks || [];
        const drumTracks = isMidi
            ? tracks
            : tracks.filter(t => (t.is_drums || t.is_percussion) && t.notes > 0);
        if (drumTracks.length === 0) {
            statusEl.textContent = isMidi
                ? 'No drum (channel-10) tracks found in this MIDI file.'
                : 'No drum/percussion tracks found in this GP file.';
            return;
        }

        const path = isMidi ? data.midi_path : data.gp_path;
        _addDrumsFile = { kind: isMidi ? 'midi' : 'gp', path };

        const listEl = document.getElementById('editor-add-drums-track-list');
        listEl.innerHTML = drumTracks.map((t, i) => {
            const safeName = _editorEscHtml(t.name);
            const checked = i === 0 ? 'checked' : '';
            return `<label class="flex items-center gap-2 text-xs text-gray-300 py-0.5">
                <input type="radio" name="drums-track" value="${Number.isFinite(Number(t.index)) ? Number(t.index) : 0}" ${checked} class="accent-red-500">
                <span class="text-red-300">${safeName}</span>
                <span class="text-gray-600">${Number(t.notes) || 0} notes</span>
            </label>`;
        }).join('');
        document.getElementById('editor-add-drums-tracks').classList.remove('hidden');
        goBtn.disabled = false;
        statusEl.textContent = `Found ${drumTracks.length} drum track(s).`;
    } catch (e) {
        statusEl.textContent = 'Failed: ' + e.message;
    }
};

// Back-compat alias — the modal HTML used to call this; some test
// scaffolds might still wire it up. Forwards to the new dispatcher.
window.editorDrumsGPSelected = (input) => window.editorDrumsFileSelected(input);

window.editorDoAddDrums = async () => {
    if (!_addDrumsFile || !S.sessionId) return;

    const statusEl = document.getElementById('editor-add-drums-status');
    const goBtn = document.getElementById('editor-add-drums-go');
    goBtn.disabled = true;
    statusEl.textContent = 'Importing drum track...';

    const radio = document.querySelector('input[name="drums-track"]:checked');
    const trackIndex = radio ? parseInt(radio.value) : 0;

    try {
        const url = _addDrumsFile.kind === 'midi'
            ? '/api/plugins/editor/import-drums-midi'
            : '/api/plugins/editor/import-drums-tab';
        const bodyKey = _addDrumsFile.kind === 'midi' ? 'midi_path' : 'gp_path';
        const resp = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                [bodyKey]: _addDrumsFile.path,
                track_index: trackIndex,
                audio_offset: _effectiveAudioOffset(),
            }),
        });
        const data = await resp.json();
        if (data.error || !data.drum_tab) {
            statusEl.textContent = 'Error: ' + (data.error || 'no drum_tab in response');
            goBtn.disabled = false;
            return;
        }

        // Stash on session state; the next save_song ships it as
        // `drum_tab` and the backend writes drum_tab.json + manifest key.
        // Normalize hits: ensure sorted by t so drum-editor hit-testing and
        // dragging work correctly, and clear any stale selection so indices
        // from the old tab don't point into the new hits array.
        S.drumTab = data.drum_tab;
        if (S.drumTab && Array.isArray(S.drumTab.hits)) {
            S.drumTab.hits.sort((a, b) => (a.t || 0) - (b.t || 0));
        }
        S.drumTabDirty = true;  // user-imported — persist on next save
        S.drumSel = new Set();

        editorHideAddDrumsModal();
        const hitCount = Array.isArray(data.drum_tab.hits)
            ? data.drum_tab.hits.length : 0;
        const unmapped = Array.isArray(data.unmapped) ? data.unmapped : [];
        const droppedCount = unmapped.reduce((s, u) => s + Math.max(0, Number(u.count) || 0), 0);
        if (droppedCount > 0) {
            setStatus(`Drum tab imported (${hitCount} hits, ${droppedCount} unmapped — see dialog) — save to persist`);
        } else {
            setStatus(`Drum tab imported (${hitCount} hits) — save to persist`);
        }
        // Refresh the toolbar drum button (text/colour) and canvas so the
        // user immediately sees the "⟳ Drums (N)" state without waiting for
        // an unrelated redraw.
        updateArrangementSelector();
        draw();
        // Surface the warning + manual-mapping UI only when there are
        // actual notes to triage — gate on droppedCount rather than
        // unmapped.length so an empty/zero-count row can't open a
        // hollow dialog.
        if (droppedCount > 0) {
            _showDrumImportUnmappedModal(unmapped);
        }
    } catch (e) {
        statusEl.textContent = 'Failed: ' + e.message;
        goBtn.disabled = false;
    }
};

// ════════════════════════════════════════════════════════════════════
// Strings (tuning) editor — add/remove strings on the active arrangement
// ════════════════════════════════════════════════════════════════════

// Range per role. Bass extends low-then-high (4 → 5 add low B → 6 add high
// C); guitar extends low-only (6 → 7 low B → 8 low F#).
function _stringsRangeForActive() {
    const arr = S.arrangements[S.currentArr];
    const isBass = arr && /bass/i.test(arr.name || '');
    return isBass
        ? { min: 4, max: 6, defaultPos: 'low' }
        : { min: 6, max: 8, defaultPos: 'low' };
}

function _nextAddPosition(arr, isBass) {
    // Use `_stringCountFor(arr)` so the result is anchored to the
    // passed arrangement (not whichever one is currently visible).
    // It already disambiguates RS-XML padding from a genuine
    // extended count — without that, a 4-string bass with padded
    // length-6 tuning would be treated as "5→6 high-C add" instead
    // of the expected "4→5 low-B".
    const cur = _stringCountFor(arr);
    if (isBass && cur === 5) return 'high';  // 5→6 bass adds high C
    return 'low';
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
        list.textContent = '';
        for (let i = 0; i < labels.length; i++) {
            const lbl = labels[i];
            const rawOff = tuning[i];
            const off = Number.isFinite(Number(rawOff)) ? Number(rawOff) : 0;
            const offTxt = off === 0 ? '0' : (off > 0 ? `+${off}` : `${off}`);
            const row = document.createElement('div');
            row.className = 'flex justify-between bg-dark-800 rounded px-2 py-1';
            const left = document.createElement('span');
            left.textContent = `String ${i} (${lbl})`;
            const right = document.createElement('span');
            right.className = 'text-gray-500';
            right.textContent = `${offTxt} st`;
            row.appendChild(left);
            row.appendChild(right);
            list.appendChild(row);
        }
    }

    const addBtn = document.getElementById('editor-strings-add');
    const removeBtn = document.getElementById('editor-strings-remove');
    const warn = document.getElementById('editor-strings-warning');
    const curCount = labels.length;  // === lanes()
    if (addBtn) addBtn.disabled = curCount >= max;
    if (removeBtn) {
        // Only the most-recently-added low/high string is removable, and
        // only if no notes live on it. For 6-bass, that's the high C
        // (last index). For everything else it's the low extension
        // (index 0). We mirror the add-position logic.
        const pos = curCount === 6 && isBass ? 'high' : 'low';
        const targetIdx = pos === 'low' ? 0 : curCount - 1;
        const blockers = _notesOnString(arr, targetIdx);
        const atFloor = curCount <= min;
        removeBtn.disabled = atFloor || blockers > 0;
        if (warn) {
            if (atFloor) {
                warn.textContent = `Already at the minimum ${min} strings.`;
            } else if (blockers > 0) {
                warn.textContent = `${blockers} note${blockers === 1 ? '' : 's'} on string ${targetIdx} — delete or move them before removing.`;
            } else {
                warn.textContent = '';
            }
        }
    }
}

window.editorShowStringsModal = () => {
    const arr = S.arrangements[S.currentArr];
    if (!arr) return;
    if (KEYS_PATTERN.test(arr.name || '') || /^drums/i.test(arr.name || '')) return;
    document.getElementById('editor-strings-modal').classList.remove('hidden');
    _renderStringsModal();
};

window.editorHideStringsModal = () => {
    document.getElementById('editor-strings-modal').classList.add('hidden');
};

window.editorAddString = () => {
    const arr = S.arrangements[S.currentArr];
    if (!arr) return;
    const isBass = /bass/i.test(arr.name || '');
    const { max } = _stringsRangeForActive();
    // Compute the count directly from the active arrangement rather
    // than going through `lanes()` — the latter consults a per-draw
    // cache and our intent here is explicitly "what is this
    // arrangement's current string count?", independent of draw state.
    if (_stringCountFor(arr) >= max) return;
    const pos = _nextAddPosition(arr, isBass);
    // The command's exec() calls _resizeForLaneChange() itself, which
    // covers undo/redo too — no need to duplicate the resize here.
    S.history.exec(new AddStringCmd(S.currentArr, pos));
    _renderStringsModal();
    draw();
    updateStatus();
};

window.editorRemoveString = () => {
    const arr = S.arrangements[S.currentArr];
    if (!arr) return;
    const isBass = /bass/i.test(arr.name || '');
    const { min } = _stringsRangeForActive();
    // Same reasoning as editorAddString — anchor on `arr` directly
    // rather than the cached `lanes()`.
    const cur = _stringCountFor(arr);
    if (cur <= min) return;
    // Mirror the position logic from add: 6-bass removes high (last),
    // everything else removes the low extension (index 0).
    const pos = cur === 6 && isBass ? 'high' : 'low';
    const targetIdx = pos === 'low' ? 0 : cur - 1;
    if (_notesOnString(arr, targetIdx) > 0) return;  // UI button is disabled too
    // The command's exec() handles the resize internally (covers
    // undo/redo too); see editorAddString.
    S.history.exec(new RemoveStringCmd(S.currentArr, pos));
    _renderStringsModal();
    draw();
    updateStatus();
};

// ════════════════════════════════════════════════════════════════════
// Add Keys arrangement (sloppak — GP or MIDI source)
// ════════════════════════════════════════════════════════════════════

let _addKeysSourcePath = null;       // server-side path to the uploaded file
let _addKeysSourceFormat = null;     // 'gp' or 'midi'
// Cached after a successful list-tracks call; the keys-track radio value
// is an index into this array, not the track's MIDI/GP index, because
// format-0 channel splits can yield multiple picker entries sharing the
// same MIDI `index`.
let _addKeysSortedTracks = [];
// Bumped on every file-select so a slow async parse (e.g. the MusicXML
// delegation round-trip) from a superseded file can't append a stale result.
let _addKeysReqSeq = 0;

window.editorShowAddKeysModal = () => {
    if (S.format !== 'sloppak') return;
    document.getElementById('editor-add-keys-modal').classList.remove('hidden');
    document.getElementById('editor-add-keys-tracks').classList.add('hidden');
    document.getElementById('editor-add-keys-go').disabled = true;
    document.getElementById('editor-add-keys-status').textContent = '';
    const fi = document.getElementById('editor-add-keys-file');
    if (fi) fi.value = '';
    _addKeysSourcePath = null;
    _addKeysSourceFormat = null;
};

window.editorHideAddKeysModal = () => {
    document.getElementById('editor-add-keys-modal').classList.add('hidden');
    // Invalidate any in-flight MusicXML parse so closing the modal cancels the
    // import instead of silently appending once the request resolves.
    _addKeysReqSeq++;
};

window.editorKeysFileSelected = async (input) => {
    const file = input.files && input.files[0];
    if (!file) return;
    const statusEl = document.getElementById('editor-add-keys-status');
    statusEl.textContent = 'Parsing ' + file.name + '...';

    // Drop any state from a previous successful parse so a later parse
    // failure (or empty-tracks result) can't be silently committed via
    // editorDoAddKeys using the older file's path.
    _addKeysSourcePath = null;
    _addKeysSortedTracks = [];
    const reqSeq = ++_addKeysReqSeq;  // invalidates any in-flight parse for an earlier file
    document.getElementById('editor-add-keys-go').disabled = true;
    document.getElementById('editor-add-keys-tracks').classList.add('hidden');

    const lower = file.name.toLowerCase();

    // MusicXML is delegated to the musicxml_import plugin's parse-arrangement
    // endpoint, which returns a ready editor arrangement (with authored
    // notation stashed) — no per-track pick, so append it straight away.
    if (lower.endsWith('.xml') || lower.endsWith('.musicxml')) {
        _addKeysSourceFormat = 'musicxml';
        try {
            const b64 = await _editorFileToBase64(file);
            const resp = await fetch('/api/plugins/musicxml_import/parse-arrangement', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ filename: file.name, data: b64 }),
            });
            if (resp.status === 404) {
                statusEl.textContent = 'MusicXML import needs the "Import MusicXML" plugin installed.';
                return;
            }
            const data = await resp.json().catch(() => ({}));
            // A newer file was selected while this parse was in flight — drop it.
            if (reqSeq !== _addKeysReqSeq) return;
            if (!resp.ok || data.error) {
                statusEl.textContent = 'Error: ' + (data.error || resp.status);
                return;
            }
            const arr = data.arrangement;
            if (!arr || !(arr.notes || []).length) {
                statusEl.textContent = 'No notes found in this MusicXML file.';
                return;
            }
            // Align to the session's audio offset, matching the GP/MIDI import
            // paths (which pass audio_offset server-side). MusicXML times come
            // back at score-time (offset 0), so shift them client-side.
            const offset = _effectiveAudioOffset();
            if (offset) {
                for (const n of arr.notes) n.time = (Number(n.time) || 0) + offset;
                // The endpoint currently returns no chords, but shift them too
                // (and their nested tones) so flattenChords() stays aligned if
                // it ever does.
                for (const ch of (arr.chords || [])) {
                    if (ch.time != null) ch.time = (Number(ch.time) || 0) + offset;
                    for (const cn of (ch.notes || [])) {
                        if (cn.time != null) cn.time = (Number(cn.time) || 0) + offset;
                    }
                }
            }
            // v1 saves keys notation via the editor's heuristic (PR #52), so drop
            // the authored notation stash here — keeping un-shifted notation
            // alongside offset-shifted notes would be inconsistent. (Preserving
            // authored notation through edits is a tracked follow-up.)
            delete arr.notation;
            await _editorAppendKeysArrangement(arr, statusEl, {
                isStale: () => reqSeq !== _addKeysReqSeq,
            });
        } catch (e) {
            statusEl.textContent = 'Failed: ' + e.message;
        }
        return;
    }

    const isMidi = lower.endsWith('.mid') || lower.endsWith('.midi');
    _addKeysSourceFormat = isMidi ? 'midi' : 'gp';

    const fd = new FormData();
    fd.append('file', file);

    try {
        const url = isMidi
            ? '/api/plugins/editor/import-midi'
            : '/api/plugins/editor/import-gp';
        const resp = await fetch(url, { method: 'POST', body: fd });
        const data = await resp.json();
        // A newer file was selected (incl. a MusicXML one) while this GP/MIDI
        // parse was in flight — don't repopulate the picker for a stale file.
        if (reqSeq !== _addKeysReqSeq) return;
        if (data.error) {
            statusEl.textContent = 'Error: ' + data.error;
            return;
        }
        const tracks = data.tracks || [];
        // Surface piano-flagged tracks first; include all so the user can override.
        const sorted = tracks.slice().sort((a, b) => {
            const ap = (a.is_piano ? 0 : 1);
            const bp = (b.is_piano ? 0 : 1);
            if (ap !== bp) return ap - bp;
            return (b.notes || 0) - (a.notes || 0);
        });

        if (sorted.length === 0) {
            statusEl.textContent = 'No tracks found in this file.';
            // Leave the cleared state from above in place — no usable
            // tracks means editorDoAddKeys must remain disabled.
            return;
        }

        // Only commit the new state once we know there's a usable track set.
        _addKeysSourcePath = isMidi ? data.midi_path : data.gp_path;
        // Stash so editorDoAddKeys can resolve the radio value back to the
        // full track entry (it carries both `index` and `channel_filter`,
        // which can collide if a format-0 file produced multiple entries
        // sharing the same `index`).
        _addKeysSortedTracks = sorted;

        const listEl = document.getElementById('editor-add-keys-track-list');
        const defaultChecked = _keysDefaultSelection(sorted);
        // Checkbox value is the position in `sorted` (not t.index) because
        // format-0 channel splits produce multiple entries that share the same
        // MIDI track_index — we need a unique key. Multi-select: a detected
        // RH/LH piano pair is pre-checked so both hands import and merge.
        listEl.innerHTML = sorted.map((t, pos) => {
            const checked = defaultChecked.has(pos) ? 'checked' : '';
            const isDrums = !!(t.is_drums || t.is_percussion);
            const flag = t.is_piano ? '<span class="text-indigo-300">[keys]</span>' : '';
            const drumsTag = isDrums ? '<span class="text-red-400">[drums]</span>' : '';
            const safeName = _editorEscHtml(t.name || '') || _editorEscHtml('Track ' + t.index);
            return `<label class="flex items-center gap-2 text-xs text-gray-300 py-0.5">
                <input type="checkbox" name="keys-track" value="${pos}" ${checked} class="accent-indigo-500">
                <span class="text-gray-200">${safeName}</span>
                ${flag} ${drumsTag}
                <span class="text-gray-600 ml-auto">${Number(t.notes) || 0} notes</span>
            </label>`;
        }).join('');
        document.getElementById('editor-add-keys-tracks').classList.remove('hidden');
        document.getElementById('editor-add-keys-go').disabled = false;
        const found = sorted.filter(t => t.is_piano).length;
        const pairHint = defaultChecked.size > 1
            ? ' An RH/LH pair is pre-selected — both hands merge into one piano.'
            : '';
        statusEl.textContent = found > 0
            ? `Found ${found} keyboard track(s). Select one or more.${pairHint}`
            : `No tracks auto-flagged as keyboard — select one or more manually.`;
    } catch (e) {
        statusEl.textContent = 'Failed: ' + e.message;
    }
};

// Mirror gp2rs_gpx._find_piano_pairs: a keys track named "<stem> RH" pairs with
// "<stem> LH" (word-boundary, case-insensitive). Pre-select detected pairs so
// both hands import and merge into one piano by default; if none pair, select
// the first keyboard track. Returns a Set of positions in `tracks`.
function _keysDefaultSelection(tracks) {
    const checked = new Set();
    const keys = tracks
        .map((t, pos) => ({ pos, name: String(t.name || '').trim().toLowerCase(), is: !!t.is_piano }))
        .filter(t => t.is);
    const consumed = new Set();
    for (const a of keys) {
        if (consumed.has(a.pos) || !/\brh\b/.test(a.name)) continue;
        const stem = a.name.replace(/\s*\brh\b\s*$/, '').trim();
        for (const b of keys) {
            if (b.pos === a.pos || consumed.has(b.pos) || !/\blh\b/.test(b.name)) continue;
            if (b.name.replace(/\s*\blh\b\s*$/, '').trim() === stem) {
                checked.add(a.pos); checked.add(b.pos);
                consumed.add(a.pos); consumed.add(b.pos);
                break;
            }
        }
    }
    if (checked.size === 0) {
        const firstPiano = tracks.findIndex(t => t.is_piano);
        checked.add(firstPiano >= 0 ? firstPiano : 0);
    }
    return checked;
}

window.editorDoAddKeys = async () => {
    if (!_addKeysSourcePath || !S.sessionId) return;
    const statusEl = document.getElementById('editor-add-keys-status');
    const goBtn = document.getElementById('editor-add-keys-go');
    goBtn.disabled = true;
    statusEl.textContent = 'Importing keys track...';

    // Checkbox values are positions in _addKeysSortedTracks; resolve them back
    // to full entries (each carries `index` and `channel_filter`). Multiple
    // keys tracks can be imported at once — an RH/LH piano pair is merged into
    // one arrangement server-side (convert_file._find_piano_pairs).
    const checkedEls = Array.from(
        document.querySelectorAll('input[name="keys-track"]:checked'));
    const positions = checkedEls.length ? checkedEls.map(el => parseInt(el.value)) : [0];
    const pickedList = positions.map(p => _addKeysSortedTracks[p]).filter(Boolean);
    if (!pickedList.length) { statusEl.textContent = 'No track selected.'; goBtn.disabled = false; return; }
    const trackIndices = pickedList.map(p => Number(p.index) || 0);
    // MIDI keys import is single-track; use the first selected track + channel.
    const picked = pickedList[0];
    const trackIndex = Number(picked.index) || 0;
    const channelFilter = (picked.channel_filter == null) ? null : Number(picked.channel_filter);

    try {
        const url = _addKeysSourceFormat === 'midi'
            ? '/api/plugins/editor/import-keys-midi'
            : '/api/plugins/editor/import-keys';
        const audioOffset = _effectiveAudioOffset();
        const body = _addKeysSourceFormat === 'midi'
            ? { midi_path: _addKeysSourcePath, track_index: trackIndex, audio_offset: audioOffset,
                channel_filter: channelFilter }
            : { gp_path: _addKeysSourcePath, track_indices: trackIndices, audio_offset: audioOffset };
        const resp = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        const data = await resp.json();
        if (data.error) {
            statusEl.textContent = 'Error: ' + data.error;
            goBtn.disabled = false;
            return;
        }

        // The GP path may return several arrangements (one per non-merged keys
        // track); the MIDI path returns one. Append each in order.
        const arrangements = Array.isArray(data.arrangements)
            ? data.arrangements
            : (data.arrangement ? [data.arrangement] : []);
        const xmlPaths = Array.isArray(data.xml_paths) ? data.xml_paths : [];
        let allOk = arrangements.length > 0;
        for (let i = 0; i < arrangements.length; i++) {
            const ok = await _editorAppendKeysArrangement(arrangements[i], statusEl, {
                xml_path: xmlPaths[i] || data.xml_path || '',
            });
            if (!ok) { allOk = false; break; }
        }
        if (!allOk) goBtn.disabled = false;
    } catch (e) {
        statusEl.textContent = 'Failed: ' + e.message;
        goBtn.disabled = false;
    }
};

// Read a File as base64 (no data: prefix) for endpoints that take inline bytes.
function _editorFileToBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            const res = String(reader.result || '');
            const comma = res.indexOf(',');
            resolve(comma >= 0 ? res.slice(comma + 1) : res);
        };
        reader.onerror = () => reject(reader.error || new Error('read failed'));
        reader.readAsDataURL(file);
    });
}

// Register an imported Keys arrangement with the session, append it in-memory,
// switch to it, and refresh the view. Shared by the GP/MIDI track import and the
// MusicXML delegation path. Returns true on success.
async function _editorAppendKeysArrangement(arrangement, statusEl, opts = {}) {
    if (!arrangement || !S.sessionId) {
        if (statusEl) statusEl.textContent = 'No arrangement to add.';
        return false;
    }
    // Normalize optional arrays so flattenChords()/the piano-roll don't choke on
    // a notes-only arrangement (e.g. a MusicXML response without `chords`).
    arrangement.chords = arrangement.chords || [];
    arrangement.chord_templates = arrangement.chord_templates || [];
    try {
        // Register with the server-side session (no-op for sloppak).
        const addResp = await fetch('/api/plugins/editor/add-arrangement', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                session_id: S.sessionId,
                arrangement,
                xml_path: opts.xml_path || '',
            }),
        });
        const addData = await addResp.json().catch(() => ({}));
        if (!addResp.ok || addData.error) {
            if (statusEl) statusEl.textContent = 'Error registering arrangement: ' + (addData.error || addResp.status);
            return false;
        }
        // The import may have been canceled/superseded while registration was in
        // flight (modal closed or another file picked) — don't mutate state then.
        if (typeof opts.isStale === 'function' && opts.isStale()) return false;

        S.arrangements.push(arrangement);
        S.currentArr = S.arrangements.length - 1;
        const sel = document.getElementById('editor-arrangement');
        if (sel) sel.value = S.currentArr;

        flattenChords();
        if (typeof updatePianoRange === 'function') updatePianoRange();
        updateArrangementSelector();
        updateStatus();
        draw();

        // Shared with the guitar/bass import — hide whichever modal opened this
        // (default: the Add-Keys modal) and label the toast accordingly.
        (opts.hideModal || editorHideAddKeysModal)();
        const label = opts.label || 'Keys';
        setStatus('Added ' + label + ' arrangement (' + (arrangement.notes || []).length + ' notes). Save to commit.');
        return true;
    } catch (e) {
        if (statusEl) statusEl.textContent = 'Failed: ' + e.message;
        return false;
    }
}

function _uniqueKeysName() {
    const taken = new Set(S.arrangements.map(a => (a.name || '').trim().toLowerCase()));
    if (!taken.has('keys')) return 'Keys';
    // The taken set has a finite number of entries, so a free slot is guaranteed
    // within taken.size + 1 iterations; the +2 ceiling is a safety margin.
    const limit = taken.size + 2;
    for (let i = 2; i <= limit; i++) if (!taken.has(`keys ${i}`)) return `Keys ${i}`;
    return `Keys ${Date.now()}`;
}

let _addingEmptyKeys = false;

window.editorAddEmptyKeys = async () => {
    if (S.format !== 'sloppak' || !S.sessionId) return;
    if (_addingEmptyKeys) return;
    _addingEmptyKeys = true;
    const statusEl = document.getElementById('editor-add-keys-status');
    const arrangement = {
        name: _uniqueKeysName(),
        tuning: [0, 0, 0, 0, 0, 0],
        capo: 0,
        notes: [],
        chords: [],
        chord_templates: [],
    };
    try {
        const resp = await fetch('/api/plugins/editor/add-arrangement', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ session_id: S.sessionId, arrangement }),
        });
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok || data.error) {
            statusEl.textContent = 'Error registering arrangement: ' + (data.error || resp.status);
            return;
        }

        S.arrangements.push(arrangement);
        S.currentArr = S.arrangements.length - 1;
        const sel = document.getElementById('editor-arrangement');
        if (sel) sel.value = S.currentArr;

        flattenChords();
        if (typeof updatePianoRange === 'function') updatePianoRange();
        updateArrangementSelector();
        updateStatus();
        draw();

        editorHideAddKeysModal();
        setStatus('Added empty Keys arrangement. Double-click the chart to add notes; save to commit.');
    } catch (e) {
        statusEl.textContent = 'Failed: ' + e.message;
    } finally {
        _addingEmptyKeys = false;
    }
};

// ════════════════════════════════════════════════════════════════════
// Import a GUITAR / BASS track from a GP file (add or replace)
// ════════════════════════════════════════════════════════════════════

let _importGuitarPath = null;      // server-side path to the uploaded GP file
let _importGuitarTracks = [];      // guitar/bass tracks from the last parse
let _importGuitarReqSeq = 0;       // invalidates in-flight parses when superseded

/* @pure:guitar-import:start */
// Keep only guitar/bass tracks — drop piano/drums/percussion/vocal. Mirrors the
// backend guard in import-guitar-track so the picker and the server agree.
function _isGuitarBassTrack(t) {
    return !!t && !t.is_piano && !t.is_drums && !t.is_percussion && !t.is_vocal;
}

// Derive an arrangement name for an imported guitar/bass track, de-duped
// against `existingNames`. A BASS track's name MUST contain "bass" so
// _stringCountFor / isBassArr lay out 4 lanes (E/A/D/G) instead of 6 — the same
// invariant the "don't mis-read a 4-string bass as 6-string" fix relies on. A
// guitar track whose name would start with keys/drums/… is renamed to a neutral
// guitar role so convert_file routes it through the guitar converter (it
// dispatches by name), not the piano/drum one.
function _guitarImportName(track, existingNames) {
    const taken = new Set((existingNames || [])
        .map(n => String(n || '').trim().toLowerCase()));
    const dedupe = (base) => {
        if (!taken.has(base.toLowerCase())) return base;
        // A free slot is guaranteed within taken.size + 1 tries; +2 is margin.
        for (let i = 2; i <= taken.size + 2; i++) {
            const cand = `${base} ${i}`;
            if (!taken.has(cand.toLowerCase())) return cand;
        }
        return `${base} ${Date.now()}`;
    };
    if (track && track.is_bass) return dedupe('Bass');
    let base = String((track && track.name) || '').trim();
    if (!base || /^(keys|piano|keyboard|synth|drums|percussion)/i.test(base)) {
        base = 'Lead';
    }
    return dedupe(base);
}
/* @pure:guitar-import:end */

window.editorShowImportGuitarModal = () => {
    if (S.format !== 'sloppak' || !S.sessionId) return;
    document.getElementById('editor-import-guitar-modal').classList.remove('hidden');
    document.getElementById('editor-import-guitar-tracks').classList.add('hidden');
    document.getElementById('editor-import-guitar-dest').classList.add('hidden');
    document.getElementById('editor-import-guitar-go').disabled = true;
    document.getElementById('editor-import-guitar-status').textContent = '';
    const fi = document.getElementById('editor-import-guitar-file');
    if (fi) fi.value = '';
    _importGuitarPath = null;
    _importGuitarTracks = [];
};

window.editorHideImportGuitarModal = () => {
    document.getElementById('editor-import-guitar-modal').classList.add('hidden');
    // Invalidate any in-flight upload so closing the modal cancels the import.
    _importGuitarReqSeq++;
};

window.editorImportGuitarDestChanged = () => {
    const dest = (document.querySelector('input[name="guitar-dest"]:checked') || {}).value;
    const sel = document.getElementById('editor-import-guitar-replace-target');
    if (sel) sel.classList.toggle('hidden', dest !== 'replace');
};

// The guitar/bass track currently selected in the picker (or null).
function _importGuitarSelectedTrack() {
    const checked = document.querySelector('input[name="guitar-track"]:checked');
    return checked ? _importGuitarTracks[parseInt(checked.value)] : null;
}

// Rebuild the Replace-target dropdown for the currently-selected track. Only
// SAME-FAMILY guitar/bass arrangements are offered (Keys/Drums always excluded):
// the swap keeps the TARGET's name, so dropping a bass chart onto a guitar
// arrangement — or vice-versa — would render/save it with the wrong lane count
// (bass lanes are name-driven, /bass/i). Option value is the REAL arrangement
// index so the family filter can't misroute the swap. With no eligible target,
// Replace is disabled and the destination falls back to Add.
window.editorImportGuitarRefreshReplaceTargets = () => {
    const picked = _importGuitarSelectedTrack();
    const wantBass = !!(picked && picked.is_bass);
    const replaceSel = document.getElementById('editor-import-guitar-replace-target');
    const replaceRadio = document.querySelector('input[name="guitar-dest"][value="replace"]');
    const eligible = S.arrangements
        .map((a, i) => ({ a, i }))
        .filter(({ a }) => {
            const nm = a.name || '';
            if (KEYS_PATTERN.test(nm) || /^drums/i.test(nm)) return false;
            return /bass/i.test(nm) === wantBass;
        });
    if (replaceSel) {
        replaceSel.innerHTML = eligible.map(({ a, i }) =>
            `<option value="${i}">${_editorEscHtml(a.name || ('Arrangement ' + (i + 1)))}</option>`
        ).join('');
    }
    if (replaceRadio) {
        replaceRadio.disabled = eligible.length === 0;
        replaceRadio.title = eligible.length === 0
            ? `No ${wantBass ? 'bass' : 'guitar'} arrangement to replace.`
            : '';
        if (eligible.length === 0 && replaceRadio.checked) {
            const addRadio = document.querySelector('input[name="guitar-dest"][value="add"]');
            if (addRadio) addRadio.checked = true;
        }
    }
    editorImportGuitarDestChanged();
};

window.editorImportGuitarFileSelected = async (input) => {
    const file = input.files && input.files[0];
    if (!file) return;
    const statusEl = document.getElementById('editor-import-guitar-status');
    statusEl.textContent = 'Parsing ' + file.name + '...';

    // Drop any prior parse so a later failure can't be committed with the old
    // file's path, and invalidate any in-flight upload for an earlier file.
    _importGuitarPath = null;
    _importGuitarTracks = [];
    const reqSeq = ++_importGuitarReqSeq;
    document.getElementById('editor-import-guitar-go').disabled = true;
    document.getElementById('editor-import-guitar-tracks').classList.add('hidden');
    document.getElementById('editor-import-guitar-dest').classList.add('hidden');

    const fd = new FormData();
    fd.append('file', file);
    try {
        const resp = await fetch('/api/plugins/editor/import-gp', { method: 'POST', body: fd });
        const data = await resp.json();
        // A newer file was selected while this parse was in flight — drop it.
        if (reqSeq !== _importGuitarReqSeq) return;
        if (data.error) { statusEl.textContent = 'Error: ' + data.error; return; }

        // Guitar/bass only; surface the most-played tracks first.
        const tracks = (data.tracks || [])
            .filter(_isGuitarBassTrack)
            .sort((a, b) => (b.notes || 0) - (a.notes || 0));
        if (tracks.length === 0) {
            statusEl.textContent = 'No guitar or bass tracks found in this file.';
            return;
        }

        _importGuitarPath = data.gp_path;
        _importGuitarTracks = tracks;

        const listEl = document.getElementById('editor-import-guitar-track-list');
        listEl.innerHTML = tracks.map((t, pos) => {
            const checked = pos === 0 ? 'checked' : '';
            const bassTag = t.is_bass ? '<span class="text-blue-300">[bass]</span>' : '';
            const safeName = _editorEscHtml(t.name || '') || _editorEscHtml('Track ' + t.index);
            return `<label class="flex items-center gap-2 text-xs text-gray-300 py-0.5">
                <input type="radio" name="guitar-track" value="${pos}" ${checked} onchange="editorImportGuitarRefreshReplaceTargets()" class="accent-blue-500">
                <span class="text-gray-200">${safeName}</span>
                ${bassTag}
                <span class="text-gray-600 ml-auto">${Number(t.notes) || 0} notes</span>
            </label>`;
        }).join('');

        // Reset the destination to Add each time a file is (re)picked, then
        // populate the Replace target dropdown for the default-selected track.
        const addRadio = document.querySelector('input[name="guitar-dest"][value="add"]');
        if (addRadio) addRadio.checked = true;
        editorImportGuitarRefreshReplaceTargets();

        document.getElementById('editor-import-guitar-tracks').classList.remove('hidden');
        document.getElementById('editor-import-guitar-dest').classList.remove('hidden');
        document.getElementById('editor-import-guitar-go').disabled = false;
        const bassCount = tracks.filter(t => t.is_bass).length;
        statusEl.textContent =
            `Found ${tracks.length} guitar/bass track(s)` +
            (bassCount ? ` (${bassCount} bass)` : '') + '. Pick one and a destination.';
    } catch (e) {
        statusEl.textContent = 'Failed: ' + e.message;
    }
};

window.editorDoImportGuitar = async () => {
    if (!_importGuitarPath || !S.sessionId) return;
    const statusEl = document.getElementById('editor-import-guitar-status');
    const goBtn = document.getElementById('editor-import-guitar-go');
    goBtn.disabled = true;

    const checked = document.querySelector('input[name="guitar-track"]:checked');
    const picked = checked ? _importGuitarTracks[parseInt(checked.value)] : null;
    if (!picked) { statusEl.textContent = 'No track selected.'; goBtn.disabled = false; return; }
    const trackIndex = Number(picked.index) || 0;

    const dest = (document.querySelector('input[name="guitar-dest"]:checked') || {}).value || 'add';
    let targetIdx = -1;
    if (dest === 'replace') {
        const sel = document.getElementById('editor-import-guitar-replace-target');
        targetIdx = sel ? parseInt(sel.value) : -1;
        if (!(targetIdx >= 0 && targetIdx < S.arrangements.length)) {
            statusEl.textContent = 'Pick an arrangement to replace.'; goBtn.disabled = false; return;
        }
    }

    // Convert under a guitar/bass-safe name so the guitar converter runs (and a
    // bass gets a /bass/i name → 4 lanes). On Replace the target's name may be
    // "Keys"/"Drums" or anything, so derive a fresh conversion name from the
    // TRACK; the chart adopts the target's display name in the replace command.
    const reqSeq = _importGuitarReqSeq;
    const existingNames = S.arrangements.map(a => a.name || '');
    const name = dest === 'replace'
        ? _guitarImportName(picked, [])
        : _guitarImportName(picked, existingNames);

    statusEl.textContent = dest === 'replace' ? 'Importing (replace)...' : 'Importing track...';
    try {
        const resp = await fetch('/api/plugins/editor/import-guitar-track', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                gp_path: _importGuitarPath,
                track_index: trackIndex,
                audio_offset: _effectiveAudioOffset(),
                name,
            }),
        });
        const data = await resp.json();
        if (data.error) { statusEl.textContent = 'Error: ' + data.error; goBtn.disabled = false; return; }
        // The modal was closed / a new file picked while this was in flight.
        if (reqSeq !== _importGuitarReqSeq) return;
        const arrangement = data.arrangement;
        if (!arrangement) { statusEl.textContent = 'No arrangement returned.'; goBtn.disabled = false; return; }

        if (dest === 'replace') {
            // Keep the target's existing name (it already reflects the
            // instrument) — swap only the chart. One undo step.
            const cmd = new ReplaceArrangementChartCmd(targetIdx, arrangement);
            // exec() swaps the chart AND flattens it (see the command).
            S.history.exec(cmd);
            S.currentArr = targetIdx;
            // Drop selections/marker refs — they pointed at the OLD chart, so a
            // stale index/ref could now hit an unintended imported note or
            // marker on the next edit. Mirrors editorSelectArrangement.
            S.sel.clear();
            S.toneSel = null;
            S.anchorSel = null;
            S.handshapeSel = null;
            const arrSel = document.getElementById('editor-arrangement');
            if (arrSel) arrSel.value = String(targetIdx);
            // Recompute LANE_H for the now-visible replaced chart (exec's own
            // resize ran before this currentArr switch, so it no-op'd then).
            _resizeForLaneChange(targetIdx);
            if (typeof updatePianoRange === 'function') updatePianoRange();
            updateArrangementSelector();
            updateStatus();
            draw();
            editorHideImportGuitarModal();
            const nm = S.arrangements[targetIdx] && S.arrangements[targetIdx].name;
            setStatus('Replaced "' + nm + '" chart (' + (arrangement.notes || []).length +
                ' notes). Undo (Ctrl+Z) reverts it. Save to commit.');
        } else {
            const ok = await _editorAppendKeysArrangement(arrangement, statusEl, {
                xml_path: data.xml_path || '',
                label: 'Guitar/Bass',
                hideModal: editorHideImportGuitarModal,
                isStale: () => reqSeq !== _importGuitarReqSeq,
            });
            if (!ok) goBtn.disabled = false;
        }
    } catch (e) {
        statusEl.textContent = 'Failed: ' + e.message;
        goBtn.disabled = false;
    }
};

// ════════════════════════════════════════════════════════════════════
// Record Keys arrangement live from a MIDI keyboard (Web MIDI API)
// ════════════════════════════════════════════════════════════════════

let _recMidiAccess = null;
let _recMidiInput = null;
let _recState = 'idle';                    // idle | recording | finalizing
let _recChannel = -1;                      // -1 = all, else 0..15
const _recHeld = new Map();                // pitch -> [{onTime, channel}, ...] FIFO
const _recPending = new Map();             // pitch -> [{onTime, channel}, ...] FIFO (pedal-deferred)
const _recSustainOn = new Set();           // channels with CC64 pedal currently held
let _recNotes = [];                        // finalized {time,string,fret,sustain,techniques}
let _recArrIdx = -1;                       // index of the in-progress Keys arrangement
let ghostNotes = null;                     // alias of _recNotes while recording (for drawGhostNotes)
let _recCountEl = null;                    // cached count DOM element (set at record-start)
let _recCountLastMs = 0;                   // last timestamp _recCount updated the DOM
const REC_COUNT_THROTTLE_MS = 80;          // max DOM update rate for the note counter

function chartTimeNow() {
    // editorStartRecordMidi guards against !S.audioCtx, so this only runs
    // during an active recording with a loaded audio context.
    return S.playStartTime + (S.audioCtx.currentTime - S.playStartWall);
}

async function _recMidiInit() {
    if (_recMidiAccess) return true;
    if (!navigator.requestMIDIAccess) return false;
    try {
        _recMidiAccess = await navigator.requestMIDIAccess({ sysex: false });
        _recMidiAccess.onstatechange = () => _recMidiUpdateDeviceList();
        return true;
    } catch (e) {
        console.warn('[Editor] MIDI access denied:', e);
        return false;
    }
}

function _recMidiUpdateDeviceList() {
    const sel = document.getElementById('editor-record-midi-device');
    const noDevice = document.getElementById('editor-record-midi-no-device');
    const startBtn = document.getElementById('editor-record-midi-start');
    if (!sel) return;
    const inputs = [];
    if (_recMidiAccess) _recMidiAccess.inputs.forEach(inp => inputs.push(inp));

    const saved = localStorage.getItem('editor.recordMidiDeviceId') || '';
    // Build options with createElement so device-supplied id/name strings
    // can't break out into HTML — Web MIDI metadata comes from the OS/USB
    // descriptor and isn't safe to interpolate via innerHTML.
    sel.replaceChildren();
    for (const inp of inputs) {
        const opt = document.createElement('option');
        opt.value = inp.id;
        const label = inp.name || inp.manufacturer || `MIDI Device (${inp.id})`;
        opt.textContent = label;
        if (inp.id === saved) opt.selected = true;
        sel.appendChild(opt);
    }

    const empty = !inputs.length;
    if (noDevice) noDevice.classList.toggle('hidden', !empty);
    if (startBtn) startBtn.disabled = empty;
}

function _recMidiConnect(id) {
    if (_recMidiInput) _recMidiInput.onmidimessage = null;
    _recMidiInput = null;
    if (!_recMidiAccess) return;
    _recMidiAccess.inputs.forEach(inp => {
        if (inp.id === id) {
            _recMidiInput = inp;
            _recMidiInput.onmidimessage = _recMidiOnMessage;
            localStorage.setItem('editor.recordMidiDeviceId', id);
        }
    });
}

function _recMidiOnMessage(e) {
    if (_recState !== 'recording') return;
    const [status, data1, velocity] = e.data;
    const ch = status & 0x0F;
    if (_recChannel >= 0 && ch !== _recChannel) return;
    const cmd = status & 0xF0;
    const note = data1;  // semantic alias: note number for on/off, cc number for B0 messages

    if (cmd === 0x90 && velocity > 0) {
        // Note on — push held entry (FIFO supports rapid retriggers).
        // Tag with `ch` so multi-channel layered/split keyboards in
        // "All channels" mode can pair note-offs with the correct take.
        let q = _recHeld.get(note);
        if (!q) { q = []; _recHeld.set(note, q); }
        q.push({ onTime: chartTimeNow(), channel: ch });
    } else if (cmd === 0x80 || (cmd === 0x90 && velocity === 0)) {
        // Note off — match the oldest held entry from the same channel.
        // Without the channel match, two layered channels playing the same
        // pitch would close each other's notes in arbitrary order.
        const q = _recHeld.get(note);
        if (!q || !q.length) return;
        const idx = q.findIndex(e => e.channel === ch);
        if (idx < 0) return;
        const [entry] = q.splice(idx, 1);
        if (!q.length) _recHeld.delete(note);
        if (_recSustainOn.has(ch)) {
            let p = _recPending.get(note);
            if (!p) { p = []; _recPending.set(note, p); }
            p.push(entry);
        } else {
            _recFinalizeNote(note, entry.onTime, chartTimeNow());
        }
    } else if (cmd === 0xB0 && data1 === 64) {
        // CC64 sustain pedal — per-channel state so layered/split keyboards
        // that emit CC64 on multiple channels don't cross-flush takes.
        if (velocity >= 64) {
            _recSustainOn.add(ch);
        } else {
            _recSustainOn.delete(ch);
            const off = chartTimeNow();
            for (const [pitch, queue] of _recPending) {
                const remaining = [];
                for (const entry of queue) {
                    if (entry.channel === ch) {
                        _recFinalizeNote(pitch, entry.onTime, off);
                    } else {
                        remaining.push(entry);
                    }
                }
                if (remaining.length) _recPending.set(pitch, remaining);
                else _recPending.delete(pitch);
            }
        }
    }
}

function _recFinalizeNote(pitch, onTime, offTime) {
    const sustain = Math.max(0, offTime - onTime);
    _recNotes.push({
        time: onTime,
        string: Math.floor(pitch / 24),
        fret: pitch % 24,
        sustain: sustain < 0.05 ? 0 : sustain,
        techniques: {},
    });
    _recCount();
}

function _recCount() {
    const now = performance.now();
    if (now - _recCountLastMs < REC_COUNT_THROTTLE_MS) return;   // throttle DOM writes
    _recCountLastMs = now;
    if (_recCountEl) _recCountEl.textContent = _recNotes.length + ' notes';
}

window.editorShowRecordMidiModal = async () => {
    if (!S.sessionId) return;
    const modal = document.getElementById('editor-record-midi-modal');
    const setup = document.getElementById('editor-record-midi-setup');
    const active = document.getElementById('editor-record-midi-active');
    const status = document.getElementById('editor-record-midi-status');
    const noWebMidi = document.getElementById('editor-record-midi-no-webmidi');
    const startBtn = document.getElementById('editor-record-midi-start');
    const chanSel = document.getElementById('editor-record-midi-channel');

    setup.classList.remove('hidden');
    active.classList.add('hidden');
    status.textContent = '';

    // Populate channel dropdown 1..16 once.
    if (chanSel.options.length === 1) {
        for (let i = 1; i <= 16; i++) {
            const opt = document.createElement('option');
            opt.value = String(i - 1);
            opt.textContent = String(i);
            chanSel.appendChild(opt);
        }
    }

    if (!navigator.requestMIDIAccess) {
        if (noWebMidi) noWebMidi.classList.remove('hidden');
        if (startBtn) startBtn.disabled = true;
    } else {
        if (noWebMidi) noWebMidi.classList.add('hidden');
        const granted = await _recMidiInit();
        if (!granted) {
            status.textContent = 'MIDI access denied — grant permission in browser settings and reload this page.';
            if (startBtn) startBtn.disabled = true;
        } else {
            status.textContent = '';
            _recMidiUpdateDeviceList();
        }
    }

    modal.classList.remove('hidden');
};

window.editorHideRecordMidiModal = () => {
    // Refuse to close while a take is active — explicit Stop is required.
    if (_recState !== 'idle') return;
    document.getElementById('editor-record-midi-modal').classList.add('hidden');
};

window.editorStartRecordMidi = () => {
    if (_recState !== 'idle') return;
    const sel = document.getElementById('editor-record-midi-device');
    const chanSel = document.getElementById('editor-record-midi-channel');
    const status = document.getElementById('editor-record-midi-status');
    const setup = document.getElementById('editor-record-midi-setup');
    const active = document.getElementById('editor-record-midi-active');
    if (S.format !== 'sloppak' || !S.sessionId) {
        status.textContent = 'Recording requires a sloppak editing session.';
        return;
    }
    if (!S.audioBuffer || !S.audioCtx) {
        status.textContent = 'Audio not loaded — cannot derive note timing.';
        return;
    }
    if (!sel || !sel.value) {
        status.textContent = 'Select a MIDI device first.';
        return;
    }
    _recMidiConnect(sel.value);
    if (!_recMidiInput) {
        status.textContent = 'Failed to connect to MIDI device.';
        return;
    }

    // Splice + start playback synchronously inside the click handler:
    //   (a) Chrome/Edge autoplay policy requires the AudioContext.resume()
    //       inside startPlayback() to fire during the user-gesture grace
    //       period — an awaited fetch would expire it and the transport
    //       would never advance, putting every captured note at t=0.
    //   (b) Punch-in (Record while already playing) must arm at the exact
    //       playhead the user clicked from, not wherever audio drifted to
    //       during a network round-trip.
    // The /add-arrangement POST is fired-and-forgotten — for sloppak it's
    // a no-op acknowledgement, and saving the session commits whatever
    // is in S.arrangements regardless.
    const arrangement = {
        name: _uniqueKeysName(),
        tuning: [0, 0, 0, 0, 0, 0],
        capo: 0,
        notes: [],
        chords: [],
        chord_templates: [],
    };

    S.arrangements.push(arrangement);
    S.currentArr = S.arrangements.length - 1;
    _recArrIdx = S.currentArr;
    const arrSel = document.getElementById('editor-arrangement');
    if (arrSel) arrSel.value = S.currentArr;
    flattenChords();
    if (typeof updatePianoRange === 'function') updatePianoRange();
    updateArrangementSelector();
    // Lock the selector for the duration of the take so a mid-recording
    // switch can't make Stop finalize into a stale arrangement index.
    if (arrSel) arrSel.disabled = true;

    _recHeld.clear();
    _recPending.clear();
    _recSustainOn.clear();
    _recNotes = [];
    _recCountEl = document.getElementById('editor-record-midi-count');
    _recCountLastMs = 0;  // reset throttle so the initial "0 notes" shows immediately
    _recCount();
    _recChannel = parseInt(chanSel.value);
    if (Number.isNaN(_recChannel)) _recChannel = -1;

    setup.classList.add('hidden');
    active.classList.remove('hidden');
    status.textContent = '';

    ghostNotes = _recNotes;
    _recState = 'recording';
    // Restart cleanly if a playback is already running — startPlayback()
    // allocates a fresh AudioBufferSourceNode and overwrites S.audioSource,
    // which would otherwise orphan the existing source and desync stop.
    // Refresh S.cursorTime from chartTimeNow() before the restart so
    // punch-in resumes from the actual audio position, not the last
    // playbackTick() snapshot (which can lag on throttled/slow frames).
    if (S.playing) {
        S.cursorTime = chartTimeNow();
        stopPlayback();
    }
    startPlayback();

    // Reliable end-of-song finalize: rAF (playbackTick) can be throttled
    // or paused in backgrounded tabs and miss the EOF clamp, leaving
    // _recState='recording' after audio actually ends. AudioBufferSourceNode's
    // onended fires regardless of tab visibility. The state guard inside
    // also makes this a no-op when stopPlayback() triggers onended via
    // explicit Stop / spacebar — those paths set _recState='finalizing'
    // before audioSource.stop() runs.
    if (S.audioSource) {
        S.audioSource.onended = () => {
            if (_recState === 'recording') editorStopRecordMidi();
        };
    }

    fetch('/api/plugins/editor/add-arrangement', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: S.sessionId, arrangement }),
    }).catch(e => console.warn('[Editor] add-arrangement registration failed:', e));
};

window.editorStopRecordMidi = () => {
    if (_recState !== 'recording') return;
    _recState = 'finalizing';

    // Capture stop-time before stopping audio so the chart-time formula
    // still reads the in-flight playhead. Clamp to S.duration: when this
    // path is reached via the EOF branch in playbackTick, chartTimeNow()
    // has already crossed the song boundary, and any held/pedal-deferred
    // notes would otherwise be finalized past the chart length.
    const stopTime = Math.min(chartTimeNow(), S.duration || Infinity);
    stopPlayback();

    // When the take finalized at EOF (e.g. via audioSource.onended in a
    // backgrounded tab where playbackTick was throttled), playbackTick's
    // cursor-reset branch never ran. Reset here so the next playback
    // starts from 0, not from a stale end-of-song position.
    if (S.duration && stopTime >= S.duration) {
        S.cursorTime = 0;
        updateTimeDisplay();
    }

    // Cap any still-held notes (key never released).
    for (const [pitch, queue] of _recHeld) {
        for (const { onTime } of queue) _recFinalizeNote(pitch, onTime, stopTime);
    }
    _recHeld.clear();
    // Cap any pedal-deferred notes (sustain still down at stop).
    for (const [pitch, queue] of _recPending) {
        for (const { onTime } of queue) _recFinalizeNote(pitch, onTime, stopTime);
    }
    _recPending.clear();
    _recSustainOn.clear();

    if (_recMidiInput) _recMidiInput.onmidimessage = null;

    // Populate the target arrangement registered at Start time. No second
    // POST: the arrangement was already registered with the backend, so
    // the splice is purely an in-memory note swap.
    _recNotes.sort((a, b) => a.time - b.time);
    const arr = S.arrangements[_recArrIdx];
    if (arr) arr.notes = _recNotes;

    // Flush the final note count to the modal before hiding it.
    _recCountLastMs = 0;
    _recCount();

    // Restore focus to the recorded arrangement (user may have switched the
    // selector via keyboard / OS events that bypass the disabled flag) and
    // unlock the selector now that the take is final.
    S.currentArr = _recArrIdx;
    const arrSel = document.getElementById('editor-arrangement');
    if (arrSel) {
        arrSel.disabled = false;
        arrSel.value = String(_recArrIdx);
    }

    // Clear the ghost overlay BEFORE the redraw so the new notes don't
    // render twice (once as real notes, once as translucent ghosts).
    ghostNotes = null;
    _recState = 'idle';

    flattenChords();
    if (typeof updatePianoRange === 'function') updatePianoRange();
    updateArrangementSelector();
    updateStatus();
    draw();

    document.getElementById('editor-record-midi-modal').classList.add('hidden');
    const n = arr ? arr.notes.length : 0;
    setStatus(n
        ? `Recorded Keys arrangement (${n} notes). Save to commit.`
        : 'Stopped — no notes captured. The empty Keys arrangement is in the switcher.');
};

function drawGhostNotes() {
    if (!ghostNotes || !ghostNotes.length || !isKeysMode()) return;
    const w = canvas.width / DPR;
    const st = S.scrollX - 2;
    const et = S.scrollX + (w - LABEL_W) / S.zoom + 2;
    ctx.save();
    ctx.globalAlpha = 0.45;
    ctx.fillStyle = '#f43f5e';   // rose-500 — echoes the Record button
    for (const n of ghostNotes) {
        if (n.time + (n.sustain || 0) < st || n.time > et) continue;
        const midi = noteToMidi(n.string, n.fret);
        const x = timeToX(n.time);
        const y = midiToY(midi);
        const nw = Math.max(2, (n.sustain || 0) * S.zoom);
        ctx.fillRect(x, y, nw + 2, Math.max(2, PIANO_LANE_H - 1));
    }
    ctx.restore();
}

// ════════════════════════════════════════════════════════════════════
// Drum editor mode — piece-lane grid view of S.drumTab.hits[].
//
// Activates when the user clicks the "🥁 Edit Drums" toggle button
// (visible only when S.drumTab is non-null). The editor canvas is
// reused: draw() forks early to _drumEditorDraw, and onMouseDown
// forks to _drumEditorOnMouseDown. Save goes through the regular
// _buildSaveBody which already ships drum_tab on the wire.
//
// Lanes are listed top→bottom in a physical-kit order (cymbals high,
// kick low) — matches what a drummer expects when reading a sheet
// vertically. Time runs left→right as in the rest of the editor.
// ════════════════════════════════════════════════════════════════════

// Physical-kit ordering of the drum piece-ids. Mirrors lib/drums.py's
// PIECES dict but ordered for visual editing rather than data shape.
const DRUM_PIECE_ORDER = [
    'china', 'splash', 'crash_l', 'crash_r', 'stack',
    'hh_open', 'hh_closed', 'hh_pedal',
    'ride', 'ride_bell', 'bell',
    'tom_hi', 'tom_mid', 'tom_low', 'tom_floor',
    'snare', 'snare_xstick',
    'kick',
];

// GM Percussion (channel 10) names for the unmapped-notes import dialog
// — gives users a hint of what was dropped instead of just a number.
const _GM_PERC_NAMES = {
    27: 'High Q',           28: 'Slap',             29: 'Scratch Push',
    30: 'Scratch Pull',     31: 'Sticks',           32: 'Square Click',
    33: 'Metronome Click',  34: 'Metronome Bell',   35: 'Acoustic Bass Drum',
    36: 'Bass Drum 1',      37: 'Side Stick',       38: 'Acoustic Snare',
    39: 'Hand Clap',        40: 'Electric Snare',   41: 'Low Floor Tom',
    42: 'Closed Hi-Hat',    43: 'High Floor Tom',   44: 'Pedal Hi-Hat',
    45: 'Low Tom',          46: 'Open Hi-Hat',      47: 'Low-Mid Tom',
    48: 'Hi-Mid Tom',       49: 'Crash Cymbal 1',   50: 'High Tom',
    51: 'Ride Cymbal 1',    52: 'Chinese Cymbal',   53: 'Ride Bell',
    54: 'Tambourine',       55: 'Splash Cymbal',    56: 'Cowbell',
    57: 'Crash Cymbal 2',   58: 'Vibraslap',        59: 'Ride Cymbal 2',
    60: 'Hi Bongo',         61: 'Low Bongo',        62: 'Mute Hi Conga',
    63: 'Open Hi Conga',    64: 'Low Conga',        65: 'High Timbale',
    66: 'Low Timbale',      67: 'High Agogo',       68: 'Low Agogo',
    69: 'Cabasa',           70: 'Maracas',          71: 'Short Whistle',
    72: 'Long Whistle',     73: 'Short Guiro',      74: 'Long Guiro',
    75: 'Claves',           76: 'Hi Wood Block',    77: 'Low Wood Block',
    78: 'Mute Cuica',       79: 'Open Cuica',       80: 'Mute Triangle',
    81: 'Open Triangle',    82: 'Shaker',           83: 'Jingle Bell',
    84: 'Belltree',         85: 'Castanets',        86: 'Mute Surdo',
    87: 'Open Surdo',
};

// Post-import warning: the server returns any percussion notes it couldn't
// auto-map to one of the 18 drum pieces. Show them with a per-row dropdown
// so the user can drop them or hand-map each one. Synthesizes hits client-
// side from the times the server captured — no second server round-trip.
function _showDrumImportUnmappedModal(unmapped) {
    document.getElementById('editor-drum-unmapped-modal')?.remove();

    const modal = document.createElement('div');
    modal.id = 'editor-drum-unmapped-modal';
    modal.className = 'fixed inset-0 bg-black/70 z-50 flex items-center justify-center';

    const inner = document.createElement('div');
    inner.className = 'bg-dark-800 border border-gray-700 rounded-lg p-6 max-w-2xl w-full max-h-[80vh] flex flex-col mx-4';

    const title = document.createElement('h3');
    title.className = 'text-lg font-semibold mb-2';
    title.textContent = 'Unmapped percussion notes';
    inner.appendChild(title);

    const total = unmapped.reduce((s, u) => s + Math.max(0, Number(u.count) || 0), 0);
    const intro = document.createElement('p');
    intro.className = 'text-sm text-gray-400 mb-4';
    intro.textContent = `${total} note${total === 1 ? '' : 's'} (across `
        + `${unmapped.length} MIDI value${unmapped.length === 1 ? '' : 's'}) `
        + `don't map to one of the ${DRUM_PIECE_ORDER.length} slopsmith drum `
        + `pieces. Drop them, or pick a drum piece per row and add them to `
        + `your tab.`;
    inner.appendChild(intro);

    const listWrap = document.createElement('div');
    listWrap.className = 'flex-1 overflow-y-auto border border-gray-700 rounded mb-4';
    const table = document.createElement('table');
    table.className = 'w-full text-sm';
    const thead = document.createElement('thead');
    thead.innerHTML = '<tr class="bg-dark-700 text-gray-400">'
        + '<th class="text-left p-2">MIDI</th>'
        + '<th class="text-left p-2">GM name</th>'
        + '<th class="text-left p-2">Count</th>'
        + '<th class="text-left p-2">Map to</th></tr>';
    table.appendChild(thead);

    // Keep the times arrays in a JS Map keyed by the row element rather
    // than round-tripping through JSON.stringify/JSON.parse on a dataset
    // attribute — avoids extra CPU + DOM payload for large unmapped sets.
    const rowTimes = new Map();
    const tbody = document.createElement('tbody');
    for (const u of unmapped) {
        const tr = document.createElement('tr');
        tr.className = 'border-t border-gray-800';
        tr.dataset.midi = String(u.midi);
        rowTimes.set(tr, Array.isArray(u.times) ? u.times : []);
        const tdMidi = document.createElement('td');
        tdMidi.className = 'p-2 font-mono';
        tdMidi.textContent = u.midi;
        const tdName = document.createElement('td');
        tdName.className = 'p-2 text-gray-500';
        tdName.textContent = _GM_PERC_NAMES[u.midi] || '—';
        const tdCount = document.createElement('td');
        tdCount.className = 'p-2';
        // Coerce to a number so a malformed response (missing / null /
        // non-numeric count) doesn't render "undefined" in the cell.
        tdCount.textContent = Number(u.count) || 0;
        const tdMap = document.createElement('td');
        tdMap.className = 'p-2';
        const sel = document.createElement('select');
        sel.className = 'bg-dark-700 border border-gray-700 rounded px-1 py-0.5';
        const optDrop = document.createElement('option');
        optDrop.value = '';
        optDrop.textContent = '(drop)';
        sel.appendChild(optDrop);
        for (const pid of DRUM_PIECE_ORDER) {
            const opt = document.createElement('option');
            opt.value = pid;
            opt.textContent = (DRUM_PIECE_META[pid] && DRUM_PIECE_META[pid].label) || pid;
            sel.appendChild(opt);
        }
        tdMap.appendChild(sel);
        tr.appendChild(tdMidi);
        tr.appendChild(tdName);
        tr.appendChild(tdCount);
        tr.appendChild(tdMap);
        tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    listWrap.appendChild(table);
    inner.appendChild(listWrap);

    const buttons = document.createElement('div');
    buttons.className = 'flex justify-end gap-2';
    const dropBtn = document.createElement('button');
    dropBtn.className = 'px-3 py-1 bg-dark-700 hover:bg-dark-600 rounded';
    // The notes are already dropped server-side; closing the dialog
    // discards them permanently (no way to reopen). Label matches that
    // intent so it's clearly the inverse of "Add mapped".
    dropBtn.textContent = 'Discard unmapped';
    dropBtn.onclick = () => modal.remove();
    const addBtn = document.createElement('button');
    addBtn.className = 'px-3 py-1 bg-blue-600 hover:bg-blue-500 rounded';
    addBtn.textContent = 'Add mapped';
    addBtn.onclick = () => {
        if (!S.drumTab || !Array.isArray(S.drumTab.hits)) {
            modal.remove();
            return;
        }
        // Build a key-set of existing hits so we don't duplicate against
        // the imported drum_tab if two unmapped notes resolve to the
        // same (rounded-time, piece) — keeps the editor's in-memory
        // hits consistent with what the server would dedupe on save.
        const seen = new Set(S.drumTab.hits.map(
            h => `${Math.round((h.t || 0) * 1000)}|${h.p}`));
        let added = 0, skipped = 0;
        for (const tr of tbody.querySelectorAll('tr')) {
            const sel = tr.querySelector('select');
            if (!sel || !sel.value) continue;
            const pid = sel.value;
            const times = rowTimes.get(tr) || [];
            for (const t of times) {
                // Guard against malformed payload: skip NaN / Infinity /
                // negative times rather than push invalid hit objects
                // that break sort/draw and would be dropped by the
                // backend on save anyway.
                if (!Number.isFinite(t) || t < 0) continue;
                const tRounded = Math.round(t * 1000) / 1000;
                const key = `${Math.round(t * 1000)}|${pid}`;
                if (seen.has(key)) { skipped++; continue; }
                seen.add(key);
                S.drumTab.hits.push({ t: tRounded, p: pid, v: 100 });
                added++;
            }
        }
        if (added > 0) {
            S.drumTab.hits.sort((a, b) => (a.t || 0) - (b.t || 0));
            S.drumTabDirty = true;
            updateArrangementSelector();
            draw();
        }
        if (added > 0 || skipped > 0) {
            const skipMsg = skipped > 0 ? ` (${skipped} duplicate${skipped === 1 ? '' : 's'} skipped)` : '';
            setStatus(`Added ${added} hit${added === 1 ? '' : 's'} from mapped notes${skipMsg} — save to persist`);
        }
        modal.remove();
    };
    buttons.appendChild(dropBtn);
    buttons.appendChild(addBtn);
    inner.appendChild(buttons);

    // Stop key events at the modal boundary so the global onKeyDown
    // doesn't intercept Space (→ play/pause) or Delete while a button
    // is focused. The browser still gets the event to activate the
    // focused button on Space/Enter natively.
    modal.addEventListener('keydown', (e) => e.stopPropagation());

    modal.appendChild(inner);
    document.body.appendChild(modal);
}

// Display colour + shape hint per piece-id — mirrors lib/drums.py::PIECES
// so the editor visual matches what the player highway shows.
const DRUM_PIECE_META = {
    kick:         { label: 'Kick',   color: '#f59e0b', cat: 'kick'   },
    snare:        { label: 'Snare',  color: '#ef4444', cat: 'drum'   },
    snare_xstick: { label: 'Sn(x)',  color: '#dc2626', cat: 'drum'   },
    tom_hi:       { label: 'Tom 1',  color: '#eab308', cat: 'drum'   },
    tom_mid:      { label: 'Tom 2',  color: '#ca8a04', cat: 'drum'   },
    tom_low:      { label: 'Tom 3',  color: '#a16207', cat: 'drum'   },
    tom_floor:    { label: 'Floor',  color: '#854d0e', cat: 'drum'   },
    hh_closed:    { label: 'HH cl',  color: '#22d3ee', cat: 'cymbal' },
    hh_open:      { label: 'HH op',  color: '#06b6d4', cat: 'cymbal' },
    hh_pedal:     { label: 'HH pd',  color: '#0891b2', cat: 'cymbal' },
    crash_l:      { label: 'Crash L',color: '#84cc16', cat: 'cymbal' },
    crash_r:      { label: 'Crash R',color: '#65a30d', cat: 'cymbal' },
    splash:       { label: 'Splash', color: '#a3e635', cat: 'cymbal' },
    china:        { label: 'China',  color: '#4d7c0f', cat: 'cymbal' },
    stack:        { label: 'Stack',  color: '#94a3b8', cat: 'cymbal' },
    ride:         { label: 'Ride',   color: '#3b82f6', cat: 'cymbal' },
    ride_bell:    { label: 'R.Bell', color: '#1d4ed8', cat: 'cymbal' },
    bell:         { label: 'Bell',   color: '#fde047', cat: 'cymbal' },
};

const DRUM_LANE_H = 22;
const DRUM_HIT_RADIUS = 8;

function _drumPieceCount()        { return DRUM_PIECE_ORDER.length; }
function _drumLaneIdxToY(idx)     { return WAVEFORM_H + idx * DRUM_LANE_H; }
function _drumYToLaneIdx(y) {
    const idx = Math.floor((y - WAVEFORM_H) / DRUM_LANE_H);
    if (idx < 0 || idx >= _drumPieceCount()) return -1;
    return idx;
}
function _drumPieceAtY(y) {
    const i = _drumYToLaneIdx(y);
    return i >= 0 ? DRUM_PIECE_ORDER[i] : null;
}

// Hit lookup: which hit (if any) is under (x, y)? Returns the index into
// S.drumTab.hits[], or -1. Tolerance is the hit's draw radius.
function _drumHitAtPoint(x, y) {
    if (!S.drumTab) return -1;
    const pieceUnder = _drumPieceAtY(y);
    if (!pieceUnder) return -1;
    const t = xToTime(x);
    const yLane = _drumLaneIdxToY(DRUM_PIECE_ORDER.indexOf(pieceUnder)) + DRUM_LANE_H / 2;
    const hits = S.drumTab.hits || [];  // guard against malformed tabs with no hits[]
    for (let i = 0; i < hits.length; i++) {
        const h = hits[i];
        // Hits are sorted by time; bail once we're past the click window.
        // This check must run before the piece filter so hits on other lanes
        // don't prevent the early break from firing.
        if (h.t > t + 0.5) break;
        if (h.p !== pieceUnder) continue;
        const hx = timeToX(h.t);
        const dx = Math.abs(hx - x);
        const dy = Math.abs(yLane - y);
        if (dx < DRUM_HIT_RADIUS + 2 && dy < DRUM_LANE_H / 2) return i;
    }
    return -1;
}

function _drumEditorDraw(w, h) {
    const hits = S.drumTab.hits || [];
    const visibleStart = S.scrollX - 0.5;
    const visibleEnd = S.scrollX + (w - LABEL_W) / S.zoom + 0.5;

    drawWaveform(w);

    // ── Lane grid ─────────────────────────────────────────────────────
    for (let i = 0; i < _drumPieceCount(); i++) {
        const piece = DRUM_PIECE_ORDER[i];
        const meta = DRUM_PIECE_META[piece];
        const y = _drumLaneIdxToY(i);
        ctx.fillStyle = i % 2 === 0 ? '#0c0c1c' : '#0f0f24';
        ctx.fillRect(LABEL_W, y, w - LABEL_W, DRUM_LANE_H);
        // Lane separator
        ctx.strokeStyle = '#1a1a35';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(LABEL_W, y + DRUM_LANE_H);
        ctx.lineTo(w, y + DRUM_LANE_H);
        ctx.stroke();
        // Lane label (left margin)
        ctx.fillStyle = meta.color;
        ctx.font = '10px sans-serif';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        ctx.fillText(meta.label, LABEL_W - 4, y + DRUM_LANE_H / 2);
    }

    // ── Beat grid (reuse the existing helper geometry) ────────────────
    for (const b of (S.beats || [])) {
        if (b.time < visibleStart || b.time > visibleEnd) continue;
        const x = timeToX(b.time);
        // Guard: skip lines that fall into the left label margin so beat
        // lines from the padding region don't overdraw lane labels.
        if (x < LABEL_W || x > w) continue;
        ctx.strokeStyle = b.measure > 0 ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.05)';
        ctx.lineWidth = b.measure > 0 ? 1 : 0.5;
        ctx.beginPath();
        ctx.moveTo(x, WAVEFORM_H);
        ctx.lineTo(x, WAVEFORM_H + _drumPieceCount() * DRUM_LANE_H);
        ctx.stroke();
    }

    // ── Hits ──────────────────────────────────────────────────────────
    for (let i = 0; i < hits.length; i++) {
        const h = hits[i];
        if (h.t < visibleStart || h.t > visibleEnd) continue;
        const pieceIdx = DRUM_PIECE_ORDER.indexOf(h.p);
        if (pieceIdx < 0) continue;  // unknown piece-id; renderer skip
        const meta = DRUM_PIECE_META[h.p];
        const cx = timeToX(h.t);
        // Guard: skip hits that fall into the left label margin (same as
        // drawNotes/drawGrid) so hit dots don't overdraw lane labels.
        if (cx < LABEL_W || cx > w) continue;
        const cy = _drumLaneIdxToY(pieceIdx) + DRUM_LANE_H / 2;
        const sel = S.drumSel.has(i);
        const vel = (typeof h.v === 'number') ? h.v : 100;
        const alpha = Math.max(0.4, vel / 127);
        const r = h.g ? DRUM_HIT_RADIUS * 0.6 : DRUM_HIT_RADIUS;

        // Selection halo — a thin bright amber RING (not a filled white
        // circle). The previous filled style read like a permanent
        // property of the hit ("what's the big white circle around
        // that note?"); a coloured outline clearly says "this hit is
        // currently selected — click elsewhere to deselect".
        if (sel) {
            ctx.strokeStyle = '#facc15';   // amber-400
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(cx, cy, r + 3, 0, Math.PI * 2);
            ctx.stroke();
            ctx.lineWidth = 1;             // reset for downstream draws
        }

        // Shape: cymbals = circle (ring if open hat), drums = rect,
        // kick = full-lane-height vertical bar. 5 px wide is a deliberate
        // trade-off: thin enough that double-bass at 88 ms / 120 px/s
        // zoom (≈ 10.5 px spacing) shows two distinct bars with ~5 px
        // gap, but fat enough to actually see at a glance. Faster than
        // 32nd-notes at 240 BPM (≈ 3.7 px spacing) will visually merge —
        // user zooms in for those.
        if (meta.cat === 'kick') {
            const bw = 5;
            const bx = cx - bw / 2;
            const by = cy - DRUM_LANE_H / 2 + 1;
            const bh = DRUM_LANE_H - 2;
            // Inner fill — velocity drives brightness.
            ctx.fillStyle = meta.color;
            ctx.globalAlpha = alpha;
            ctx.fillRect(bx, by, bw, bh);
            // Hard black outline so adjacent kicks read as distinct
            // glyphs even when their bars touch at very narrow zoom.
            ctx.globalAlpha = 1;
            ctx.strokeStyle = '#000';
            ctx.lineWidth = 1;
            ctx.strokeRect(bx, by, bw, bh);
            // Bright top-cap accent — adds a small "head" the eye can
            // catch in dense passages.
            ctx.fillStyle = '#fde68a';
            ctx.globalAlpha = Math.min(1, alpha + 0.2);
            ctx.fillRect(bx, by, bw, 3);
            ctx.globalAlpha = 1;
        } else if (h.p === 'hh_open') {
            // Ring for open hat
            ctx.strokeStyle = meta.color;
            ctx.globalAlpha = alpha;
            ctx.lineWidth = 2;
            ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
            ctx.globalAlpha = 1;
        } else if (meta.cat === 'cymbal') {
            ctx.fillStyle = meta.color;
            ctx.globalAlpha = alpha;
            ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
            ctx.globalAlpha = 1;
        } else {
            // Drum (snare / tom) — rounded rectangle
            ctx.fillStyle = meta.color;
            ctx.globalAlpha = alpha;
            ctx.fillRect(cx - r, cy - r * 0.6, r * 2, r * 1.2);
            ctx.globalAlpha = 1;
        }

        // Articulation badges
        if (h.f) {
            // Flam — small leading dot 4px to the left
            ctx.fillStyle = meta.color;
            ctx.globalAlpha = 0.6;
            ctx.beginPath(); ctx.arc(cx - 8, cy, r * 0.4, 0, Math.PI * 2); ctx.fill();
            ctx.globalAlpha = 1;
        }
        if (h.k && meta && meta.cat === 'cymbal') {
            // Choke — fade-out tail to the right. Cymbal-only: a stray `k`
            // on a drum piece (malformed/imported data) must not render a
            // tail, matching _drumEditorToggleArticulation's cymbal gate.
            const tailW = Math.max(4, h.k * S.zoom);
            const grad = ctx.createLinearGradient(cx, 0, cx + tailW, 0);
            grad.addColorStop(0, meta.color);
            grad.addColorStop(1, 'rgba(0,0,0,0)');
            ctx.fillStyle = grad;
            ctx.fillRect(cx, cy - 2, tailW, 4);
        }
        if (h.g) {
            // Ghost — outline pip in the center
            ctx.strokeStyle = '#fff';
            ctx.lineWidth = 1;
            ctx.beginPath(); ctx.arc(cx, cy, 2, 0, Math.PI * 2); ctx.stroke();
        }
    }

    // ── Cursor ────────────────────────────────────────────────────────
    if (S.cursorTime >= visibleStart && S.cursorTime <= visibleEnd) {
        ctx.strokeStyle = 'rgba(255,255,255,0.5)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(timeToX(S.cursorTime), WAVEFORM_H);
        ctx.lineTo(timeToX(S.cursorTime), WAVEFORM_H + _drumPieceCount() * DRUM_LANE_H);
        ctx.stroke();
    }

    // ── Marquee rubber-band selection rect ────────────────────────────
    drawSelectionRect();

    // ── HUD ───────────────────────────────────────────────────────────
    ctx.fillStyle = '#94a3b8';
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    const hud = `Drum editor — ${hits.length} hits, ${S.drumSel.size} selected. Click empty: add. Drag empty: select box. Click hit: select. Del: remove. G/F/K: ghost/flam/choke.`;
    ctx.fillText(hud, LABEL_W + 6, WAVEFORM_H + _drumPieceCount() * DRUM_LANE_H + 6);
}

// ════════════════════════════════════════════════════════════════════
// Tempo Map editor — EOF-style sync-point editing of the song-wide
// beat grid (S.beats). Tempo is implicit: BPM is derived from the
// spacing between measure downbeats.
// ════════════════════════════════════════════════════════════════════

const TEMPO_HUD_H = 26;        // bottom strip height in tempo-map mode
const TEMPO_POLE_HALF = 6;     // sync-point pole grab half-width (px)

// Dimmed, non-interactive reference layer for tempo-map mode: the
// current arrangement's notes (spread by string) and the drum_tab
// hits (spread by piece), plotted at their absolute times.
function _tempoDrawReferenceNotes(w, gridBottom, visStart, visEnd) {
    const bandTop = WAVEFORM_H + 46;
    const bandBot = gridBottom - 8;
    if (bandBot <= bandTop) return;
    const bandMid = (bandTop + bandBot) / 2;
    const REF_R = 4;  // reference-dot radius

    const dot = (x, y) => {
        ctx.beginPath();
        ctx.arc(x, y, REF_R, 0, Math.PI * 2);
        ctx.fill();
    };

    const arr = S.arrangements[S.currentArr];
    if (arr) {
        const L = Math.max(1, lanes());
        ctx.fillStyle = 'rgba(130,170,255,0.55)';
        const plot = (t, str) => {
            if (typeof t !== 'number' || t < visStart || t > visEnd) return;
            const x = timeToX(t);
            if (x < LABEL_W || x > w) return;
            const frac = L > 1 ? ((str || 0) % L) / (L - 1) : 0.5;
            dot(x, bandTop + REF_R + frac * (bandMid - bandTop - 2 * REF_R - 4));
        };
        for (const n of (arr.notes || [])) plot(n.time, n.string);
        for (const ch of (arr.chords || [])) {
            for (const cn of (ch.notes || [])) plot(cn.time != null ? cn.time : ch.time, cn.string);
        }
    }

    if (S.drumTab && Array.isArray(S.drumTab.hits)) {
        const pc = Math.max(1, _drumPieceCount());
        ctx.fillStyle = 'rgba(251,191,36,0.60)';
        for (const hit of S.drumTab.hits) {
            if (typeof hit.t !== 'number' || hit.t < visStart || hit.t > visEnd) continue;
            const x = timeToX(hit.t);
            if (x < LABEL_W || x > w) continue;
            const pi = DRUM_PIECE_ORDER.indexOf(hit.p);
            const frac = (pi >= 0 && pc > 1) ? pi / (pc - 1) : 0.5;
            dot(x, bandMid + REF_R + 4 + frac * (bandBot - bandMid - 2 * REF_R - 4));
        }
    }
}

// Derive per-measure metrics from S.beats. A measure spans from one
// downbeat (`measure > 0`) to the next; the beats between them (the
// downbeat itself + its sub-beats) give the implicit time signature,
// and BPM = beats / measureDuration * 60.
// Returns [{k, i, time, measure, nextI, nextTime, beats, bpm, isLast}],
// where `i` is the S.beats index of the downbeat.
function _tempoMeasures() {
    const beats = S.beats || [];
    const dbIdx = [];
    for (let i = 0; i < beats.length; i++) {
        if (beats[i].measure > 0) dbIdx.push(i);
    }
    const out = [];
    for (let k = 0; k < dbIdx.length; k++) {
        const i = dbIdx[k];
        const nextI = (k + 1 < dbIdx.length) ? dbIdx[k + 1] : null;
        const time = beats[i].time;
        let beatCount, bpm, nextTime;
        if (nextI !== null) {
            nextTime = beats[nextI].time;
            beatCount = nextI - i;
            const dur = nextTime - time;
            bpm = dur > 1e-6 ? (beatCount / dur) * 60 : 0;
        } else {
            // Last measure has no closing downbeat — reuse the previous
            // measure's metrics so the display value is stable.
            nextTime = null;
            const prev = out[out.length - 1];
            // No previous measure (single-downbeat grid): count the
            // downbeat plus its trailing sub-beats — beats.length - i,
            // matching _tempoMeasureBeatCount().
            beatCount = prev ? prev.beats : Math.max(1, beats.length - i);
            bpm = prev ? prev.bpm : 0;
        }
        out.push({
            k, i, time, measure: beats[i].measure,
            nextI, nextTime, beats: beatCount, bpm, isLast: nextI === null,
        });
    }
    return out;
}

function _tempoMapDraw(w, h) {
    const visibleStart = S.scrollX - 0.5;
    const visibleEnd = S.scrollX + (w - LABEL_W) / S.zoom + 0.5;
    const gridBottom = h - TEMPO_HUD_H;

    drawWaveform(w);

    // Grid region background.
    ctx.fillStyle = '#0c0c1c';
    ctx.fillRect(LABEL_W, WAVEFORM_H, w - LABEL_W, gridBottom - WAVEFORM_H);

    if (!S.beats || S.beats.length < 2) {
        ctx.fillStyle = '#64748b';
        ctx.font = '12px sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText('No beat grid on this song — nothing to tempo-map.',
            LABEL_W + 12, WAVEFORM_H + 30);
        return;
    }

    // Beat grid lines (downbeats brighter than sub-beats).
    for (const b of S.beats) {
        if (b.time < visibleStart || b.time > visibleEnd) continue;
        const x = timeToX(b.time);
        if (x < LABEL_W || x > w) continue;
        const meas = b.measure > 0;
        ctx.strokeStyle = meas ? 'rgba(255,255,255,0.10)' : 'rgba(255,255,255,0.04)';
        ctx.lineWidth = meas ? 1 : 0.5;
        ctx.beginPath();
        ctx.moveTo(x, WAVEFORM_H);
        ctx.lineTo(x, gridBottom);
        ctx.stroke();
    }

    // Dimmed reference layer — the current arrangement's notes + drum
    // hits, fixed at their absolute times so the user can drag the grid
    // to line up with them (and the waveform).
    _tempoDrawReferenceNotes(w, gridBottom, visibleStart, visibleEnd);

    // Measures: per-measure labels + draggable sync-point poles.
    const measures = _tempoMeasures();
    for (const m of measures) {
        const x = timeToX(m.time);

        // Per-measure label, centred in the span (only if wide enough).
        if (m.nextTime !== null) {
            const xa = timeToX(m.time), xb = timeToX(m.nextTime);
            const xMid = (xa + xb) / 2;
            if (xb - xa > 46 && xMid > LABEL_W && xMid < w) {
                ctx.textAlign = 'center';
                ctx.textBaseline = 'top';
                ctx.fillStyle = '#cbd5e1';
                ctx.font = 'bold 10px monospace';
                ctx.fillText(`M${m.measure}`, xMid, WAVEFORM_H + 4);
                ctx.fillStyle = m.isLast ? '#64748b' : '#fbbf24';
                ctx.font = '10px monospace';
                ctx.fillText(`${m.bpm.toFixed(2)} BPM`, xMid, WAVEFORM_H + 17);
                ctx.fillStyle = '#64748b';
                ctx.font = '9px monospace';
                ctx.fillText(`${m.beats}/4`, xMid, WAVEFORM_H + 30);
            }
        }

        // Sync-point pole + grab handle.
        if (x >= LABEL_W && x <= w) {
            const sel = (m.i === S.tempoSel);
            const hov = (m.i === S.tempoHover);
            if (sel) {
                ctx.strokeStyle = 'rgba(251,191,36,0.25)';
                ctx.lineWidth = 7;
                ctx.beginPath();
                ctx.moveTo(x, WAVEFORM_H);
                ctx.lineTo(x, gridBottom);
                ctx.stroke();
            }
            ctx.strokeStyle = sel ? '#fbbf24' : hov ? '#93c5fd' : '#64748b';
            ctx.lineWidth = sel ? 3 : 2;
            ctx.beginPath();
            ctx.moveTo(x, WAVEFORM_H);
            ctx.lineTo(x, gridBottom);
            ctx.stroke();
            ctx.fillStyle = sel ? '#fbbf24' : hov ? '#93c5fd' : '#94a3b8';
            ctx.fillRect(x - TEMPO_POLE_HALF, WAVEFORM_H, TEMPO_POLE_HALF * 2, 13);
            ctx.fillStyle = '#0c0c1c';
            ctx.font = 'bold 9px monospace';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'top';
            ctx.fillText('↔', x, WAVEFORM_H + 2);
        }
    }

    // Playback cursor.
    if (S.cursorTime >= visibleStart && S.cursorTime <= visibleEnd) {
        const cx = timeToX(S.cursorTime);
        ctx.strokeStyle = 'rgba(255,255,255,0.5)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(cx, WAVEFORM_H);
        ctx.lineTo(cx, gridBottom);
        ctx.stroke();
    }

    // HUD strip.
    ctx.fillStyle = '#08081a';
    ctx.fillRect(0, gridBottom, w, TEMPO_HUD_H);
    const hudY = gridBottom + TEMPO_HUD_H / 2;
    ctx.fillStyle = '#94a3b8';
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(
        `Tempo Map — ${measures.length} measures · drag a pole to retime · `
        + `right-click: insert/delete · [ ]: time signature`,
        LABEL_W + 6, hudY);
}

function _ensureTempoSignatureControl() {
    let wrap = document.getElementById('editor-tempo-sig-wrap');
    if (wrap) return wrap;
    const bpm = document.getElementById('editor-bpm');
    if (!bpm || !bpm.parentNode) return null;
    wrap = document.createElement('span');
    wrap.id = 'editor-tempo-sig-wrap';
    wrap.className = 'hidden items-center gap-1';
    wrap.innerHTML = '<span class="text-xs text-gray-500">Sig:</span>'
        + '<input type="number" id="editor-tempo-sig" min="1" max="16" step="1" '
        + 'class="w-11 bg-dark-700 border border-gray-700 rounded px-1.5 py-0.5 text-xs text-gray-300 outline-none text-center" '
        + 'title="Edit selected measure beats per bar" onchange="editorSetTempoSignature(this.value)">'
        + '<span class="text-xs text-gray-500">/4</span>';
    const bpmNext = bpm.nextSibling;
    bpm.parentNode.insertBefore(wrap, bpmNext);
    return wrap;
}
// ── Tempo Map toolbar toggle ────────────────────────────────────────

function _ensureTempoMapButton() {
    let btn = document.getElementById('editor-tempo-map-btn');
    if (!btn) {
        const anchor = document.getElementById('editor-save-btn');
        if (!anchor) return null;
        btn = document.createElement('button');
        btn.id = 'editor-tempo-map-btn';
        btn.type = 'button';
        btn.textContent = '🎵 Tempo Map';
        btn.className = 'px-3 py-1 bg-dark-600 hover:bg-dark-500 rounded text-xs font-medium hidden';
        btn.title = 'Open the EOF-style tempo-map editor';
        btn.onclick = () => {
            // Finalize any in-progress canvas drag before switching
            // modes — commit a moved sync-point / drum drag (don't
            // discard the edit) and clear S.drag so the global mouse
            // handlers don't act on a stale drag afterwards.
            _finalizeActiveDrag();
            S.tempoMapMode = !S.tempoMapMode;
            S.tempoSel = -1;
            S.tempoHover = -1;
            if (S.tempoMapMode) {
                // Tempo and drum modes are mutually exclusive.
                S.drumEditMode = false;
                S.drumSel = new Set();
                hideContextMenu();
                hideAddNote();
                S.sel.clear();
            }
            _refreshTempoMapButton();
            _refreshDrumEditButton();
            draw();
        };
        anchor.parentNode.insertBefore(btn, anchor.nextSibling);
    }
    return btn;
}

let _tempoMapBtnState = '';  // memoized signature; updates only on change

function _refreshTempoMapButton() {
    const btn = _ensureTempoMapButton();
    const sigWrap = _ensureTempoSignatureControl();
    if (!btn) return;
    // The grid is song-wide and round-trips through archive + sloppak, so
    // the button is NOT format-gated — only a beat grid is required.
    const hasGrid = !!(S.beats && S.beats.length >= 2);
    const sig = `${!!S.sessionId}|${hasGrid}|${!!S.tempoMapMode}`;
    if (sig === _tempoMapBtnState) return;
    _tempoMapBtnState = sig;
    btn.classList.toggle('hidden', !S.sessionId || !hasGrid);
    if (sigWrap) {
        sigWrap.classList.toggle('hidden', !S.tempoMapMode || !hasGrid);
        sigWrap.classList.toggle('inline-flex', !!S.tempoMapMode && hasGrid);
    }
    if (S.tempoMapMode) {
        btn.textContent = '🎸 Back to Notes';
        btn.classList.add('bg-amber-600', 'hover:bg-amber-500');
        btn.classList.remove('bg-dark-600', 'hover:bg-dark-500');
    } else {
        btn.textContent = '🎵 Tempo Map';
        btn.classList.remove('bg-amber-600', 'hover:bg-amber-500');
        btn.classList.add('bg-dark-600', 'hover:bg-dark-500');
    }
    // Sync works on the song-wide BPM only, so keep that disabled in
    // tempo-map mode. The BPM input itself stays active there and edits the
    // selected measure (or the one under the playhead if nothing is selected).
    const bpmEl = document.getElementById('editor-bpm');
    if (bpmEl) {
        bpmEl.disabled = false;
        bpmEl.style.opacity = '';
        if (bpmEl.dataset.origTitle === undefined) bpmEl.dataset.origTitle = bpmEl.title || '';
        bpmEl.title = S.tempoMapMode
            ? 'Edit the selected measure BPM in Tempo Map mode'
            : bpmEl.dataset.origTitle;
    }
    const syncEl = document.getElementById('editor-sync-btn');
    if (syncEl) {
        syncEl.disabled = !!S.tempoMapMode;
        syncEl.style.opacity = S.tempoMapMode ? '0.4' : '';
        if (S.tempoMapMode) {
            if (syncEl.dataset.origTitle === undefined) {
                syncEl.dataset.origTitle = syncEl.title || '';
            }
            syncEl.title = 'Disabled in Tempo Map mode — edit per-measure tempo on the grid';
        } else if (syncEl.dataset.origTitle !== undefined) {
            syncEl.title = syncEl.dataset.origTitle;
            delete syncEl.dataset.origTitle;
        }
    }
}

// ── Scope toggle — a DOM control overlaid on the canvas, shown only
// in tempo-map mode. (DOM rather than canvas-drawn: a clickable
// control is more robust and gets native hit-testing for free.)

function _ensureTempoScopeToggle() {
    let el = document.getElementById('editor-tempo-scope');
    if (!el) {
        const wrap = document.getElementById('editor-canvas-wrap');
        if (!wrap) return null;
        el = document.createElement('div');
        el.id = 'editor-tempo-scope';
        el.className = 'absolute hidden items-center gap-1 px-2 py-1 '
            + 'bg-dark-800 border border-gray-700 rounded text-xs z-10';
        el.style.right = '10px';
        el.style.bottom = '8px';
        // The beat grid and section markers always move with a tempo
        // edit; this toggle only picks which instrument NOTES re-time —
        // hence "Notes that ride the grid", not "Apply tempo edits to".
        el.title = 'The beat grid and section markers always move with a '
            + 'tempo edit. This chooses which instrument notes re-time too.';
        el.innerHTML =
            '<span class="text-gray-500 mr-1">Notes that ride the grid:</span>'
            + '<button type="button" data-scope="drum" class="px-2 py-0.5 rounded"></button>'
            + '<button type="button" data-scope="all" class="px-2 py-0.5 rounded"></button>';
        el.querySelectorAll('button').forEach(b => {
            b.textContent = b.dataset.scope === 'drum' ? 'Drum tab' : 'All instruments';
            b.onclick = () => {
                S.tempoRideScope = b.dataset.scope;
                try {
                    localStorage.setItem('editor-tempomap-scope', S.tempoRideScope);
                } catch (_) { /* localStorage unavailable */ }
                _refreshTempoScopeToggle();
                draw();
            };
        });
        wrap.appendChild(el);
    }
    return el;
}

let _tempoScopeToggleState = '';  // memo signature; runs every draw()

function _refreshTempoScopeToggle() {
    const el = _ensureTempoScopeToggle();
    if (!el) return;
    // Memoize on the only inputs that affect the control — _refreshTempo-
    // ScopeToggle runs on every draw() (every animation frame during
    // playback), so skip the DOM writes when nothing changed.
    const sig = `${!!S.tempoMapMode}|${S.tempoRideScope}`;
    if (sig === _tempoScopeToggleState) return;
    _tempoScopeToggleState = sig;
    el.classList.toggle('hidden', !S.tempoMapMode);
    el.classList.toggle('flex', !!S.tempoMapMode);
    el.querySelectorAll('button').forEach(b => {
        const active = b.dataset.scope === S.tempoRideScope;
        b.className = 'px-2 py-0.5 rounded ' + (active
            ? 'bg-amber-600 text-white font-medium'
            : 'bg-dark-600 text-gray-400 hover:bg-dark-500');
    });
}

// ── Tempo Map interaction ───────────────────────────────────────────

// Return the S.beats index of the sync-point pole (a downbeat) nearest
// to canvas x within the pole grab zone, or -1. y must be inside the
// grid region.
function _tempoSyncAtX(x, y) {
    if (!canvas) return -1;
    const gridBottom = canvas.height / DPR - TEMPO_HUD_H;
    if (y < WAVEFORM_H || y > gridBottom) return -1;
    let best = -1, bestDist = TEMPO_POLE_HALF + 2;
    const beats = S.beats || [];
    for (let i = 0; i < beats.length; i++) {
        if (beats[i].measure <= 0) continue;
        const d = Math.abs(timeToX(beats[i].time) - x);
        if (d < bestDist) { bestDist = d; best = i; }
    }
    return best;
}

function _tempoMapOnMouseDown(e, x, y) {
    if (!canvas) return;

    // Waveform-area click sets the playback cursor.
    if (y < WAVEFORM_H) {
        // Block the seek while a MIDI take is recording — restarting the
        // source node would prematurely finalize the take (mirrors the
        // guard on the normal-mode waveform click).
        if (_recState === 'recording') return;
        S.cursorTime = Math.max(0, xToTime(x));
        if (S.playing) { stopPlayback(); startPlayback(); }
        draw();
        return;
    }

    // Click a sync-point pole to select it and start a drag.
    const hit = _tempoSyncAtX(x, y);
    S.tempoSel = hit;
    if (hit >= 0) {
        S.drag = {
            type: 'tempo-sync',
            beatIdx: hit,
            startX: x,
            origBeats: S.beats.map(b => ({ ...b })),
            moved: false,
        };
    }
    draw();
}

// Right-click in tempo-map mode: insert a sync point on open grid, or
// delete / change the time signature of the sync point under the cursor.
function _tempoMapOnContextMenu(e) {
    const { x, y } = getMousePos(e);
    const menu = document.getElementById('editor-context-menu');
    if (!menu) return;
    const onPole = _tempoSyncAtX(x, y);
    const mkBtn = (action, label, cls) =>
        `<button class="w-full text-left px-3 py-1 text-xs hover:bg-dark-500 ${cls || ''}" `
        + `data-action="${action}">${label}</button>`;
    let html = '';
    if (onPole >= 0) {
        const cur = _tempoMeasureBeatCount(onPole);
        html += `<div class="px-3 py-1 text-xs text-gray-500">Measure: ${cur} beats</div>`;
        if (cur < 16) html += mkBtn('tsplus', 'Add a beat (time signature +)');
        if (cur > 1) html += mkBtn('tsminus', 'Remove a beat (time signature −)');
        html += '<div class="border-t border-gray-700 my-1"></div>';
        html += mkBtn('delete', 'Delete sync point', 'text-red-400');
    } else {
        html += mkBtn('insert', 'Insert sync point here');
    }
    menu.innerHTML = html;
    menu.querySelectorAll('[data-action]').forEach(btn => {
        btn.onclick = () => {
            hideContextMenu();
            const a = btn.dataset.action;
            if (a === 'delete') _tempoDeleteSyncPoint(onPole);
            else if (a === 'insert') _tempoInsertSyncPoint(xToTime(x));
            else if (a === 'tsplus') _tempoSetBeatsPerMeasure(onPole, _tempoMeasureBeatCount(onPole) + 1);
            else if (a === 'tsminus') _tempoSetBeatsPerMeasure(onPole, _tempoMeasureBeatCount(onPole) - 1);
        };
    });
    menu.style.left = e.clientX + 'px';
    menu.style.top = e.clientY + 'px';
    menu.classList.remove('hidden');
}

// ── Insert / delete sync points ─────────────────────────────────────
//
// Both are pure `measure`-field edits on S.beats: insert promotes the
// nearest interior sub-beat to a downbeat (splitting a measure), delete
// demotes a downbeat back to a sub-beat (merging two measures). No beat
// time moves, so no note re-timing is needed — TempoGridCmd just swaps
// the beats array.

// Renumber every downbeat sequentially, preserving the first one's number.
function _tempoRenumberMeasures(beats) {
    let m = null;
    for (const b of beats) {
        if (b.measure > 0) {
            m = (m === null) ? b.measure : m + 1;
            b.measure = m;
        }
    }
}

function _tempoInsertSyncPoint(time) {
    const beats = S.beats || [];
    if (beats.length < 2) return;
    const dbIdx = [];
    for (let i = 0; i < beats.length; i++) if (beats[i].measure > 0) dbIdx.push(i);
    if (!dbIdx.length) return;
    // Locate the measure [d, ndb) containing `time`.
    let d = dbIdx[0], ndb = beats.length;
    for (let k = 0; k < dbIdx.length; k++) {
        const i = dbIdx[k];
        const nextI = (k + 1 < dbIdx.length) ? dbIdx[k + 1] : beats.length;
        const endT = (nextI < beats.length) ? beats[nextI].time : Infinity;
        if (time >= beats[i].time && time < endT) { d = i; ndb = nextI; break; }
    }
    // Promote the interior sub-beat nearest to `time`.
    let bestS = -1, bestDist = Infinity;
    for (let i = d + 1; i < ndb; i++) {
        if (beats[i].measure > 0) continue;
        const dist = Math.abs(beats[i].time - time);
        if (dist < bestDist) { bestDist = dist; bestS = i; }
    }
    if (bestS < 0) {
        setStatus('Measure has no beat to split on — nothing to insert.');
        return;
    }
    const oldBeats = beats.map(b => ({ ...b }));
    const newBeats = beats.map(b => ({ ...b }));
    newBeats[bestS].measure = 1;  // placeholder; renumbered next
    _tempoRenumberMeasures(newBeats);
    S.history.exec(new TempoGridCmd(oldBeats, newBeats, 'insert'));
    S.tempoSel = bestS;
    draw();
}

function _tempoDeleteSyncPoint(beatIdx) {
    const beats = S.beats || [];
    if (beatIdx < 0 || beatIdx >= beats.length || beats[beatIdx].measure <= 0) return;
    const dbIdx = [];
    for (let i = 0; i < beats.length; i++) if (beats[i].measure > 0) dbIdx.push(i);
    if (dbIdx[0] === beatIdx || dbIdx[dbIdx.length - 1] === beatIdx) {
        setStatus("Can't delete the first or last sync point.");
        return;
    }
    const oldBeats = beats.map(b => ({ ...b }));
    const newBeats = beats.map(b => ({ ...b }));
    newBeats[beatIdx].measure = -1;  // demote to sub-beat
    _tempoRenumberMeasures(newBeats);
    S.history.exec(new TempoGridCmd(oldBeats, newBeats, 'delete'));
    S.tempoSel = -1;
    draw();
}

// ── Time signature ──────────────────────────────────────────────────
//
// Re-subdivide the measure starting at downbeat `d` to `newCount`
// beats. The measure's [downbeat, next-downbeat] time span is fixed,
// so only the interior grid lines move — note times are untouched.

/* @pure:tempo-map-timesig:start */
function _tempoSetBeatsPerMeasurePure(beats, d, newCount, duration, round) {
    const count = Math.max(1, Math.min(16, Math.round(newCount)));
    if (!Array.isArray(beats) || d < 0 || d >= beats.length || !beats[d] || beats[d].measure <= 0) return null;
    let ndb = -1;
    for (let i = d + 1; i < beats.length; i++) {
        if (beats[i].measure > 0) { ndb = i; break; }
    }
    const startT = beats[d].time;
    let endT, tailIdx;
    if (ndb >= 0) { endT = beats[ndb].time; tailIdx = ndb; }
    else { endT = duration || beats[beats.length - 1].time; tailIdx = beats.length; }
    if (endT <= startT) return null;
    const r = typeof round === 'function' ? round : (v => v);
    const head = beats.slice(0, d + 1).map(b => ({ ...b }));
    const tail = beats.slice(tailIdx).map(b => ({ ...b }));
    const interior = [];
    for (let k = 1; k < count; k++) {
        interior.push({ time: r(startT + (endT - startT) * k / count), measure: -1 });
    }
    return head.concat(interior, tail);
}
/* @pure:tempo-map-timesig:end */

function _tempoSetBeatsPerMeasure(d, newCount) {
    const beats = S.beats || [];
    const newBeats = _tempoSetBeatsPerMeasurePure(beats, d, newCount, S.duration, _r3);
    if (!newBeats) return;
    _tempoRenumberMeasures(newBeats);
    S.history.exec(new TempoGridCmd(beats.map(b => ({ ...b })), newBeats, 'timesig'));
    updateTempoSigDisplay();
    draw();
}

// Beats currently in the measure starting at downbeat index `d`.
function _tempoMeasureBeatCount(d) {
    const beats = S.beats || [];
    for (let i = d + 1; i < beats.length; i++) {
        if (beats[i].measure > 0) return i - d;
    }
    return beats.length - d;  // last measure
}

// Undo command for insert/delete/time-signature edits — these only
// change `measure` fields / sub-beat layout, never beat times, so no
// note re-timing is involved; it just swaps the beats array.
class TempoGridCmd {
    constructor(oldBeats, newBeats, label) {
        this.oldBeats = oldBeats.map(b => ({ ...b }));
        this.newBeats = newBeats.map(b => ({ ...b }));
        this.label = label || 'grid';
    }
    exec() { S.beats = this.newBeats.map(b => ({ ...b })); }
    rollback() { S.beats = this.oldBeats.map(b => ({ ...b })); }
}

// ── Drag: move a sync point, re-spacing the two adjacent measures ────

const MIN_MEASURE = 0.05;  // s — minimum gap a dragged downbeat keeps

/* @pure:tempo-map-bpm:start */
function _tempoSetMeasureBpmPure(beats, d, newBpm, minMeasure, round) {
    if (!Array.isArray(beats) || beats.length < 2 || !Number.isFinite(newBpm) || newBpm <= 0) return null;
    if (d < 0 || d >= beats.length || !beats[d] || beats[d].measure <= 0) return null;
    let ndb = -1;
    for (let i = d + 1; i < beats.length; i++) {
        if (beats[i].measure > 0) { ndb = i; break; }
    }
    if (ndb < 0) return null;
    const beatCount = ndb - d;
    if (beatCount <= 0) return null;
    const r = typeof round === 'function' ? round : (v => v);
    const gapMin = Number.isFinite(minMeasure) && minMeasure > 0 ? minMeasure : 0.05;
    const startT = beats[d].time;
    const oldEnd = beats[ndb].time;
    const span = Math.max(gapMin, (beatCount * 60) / newBpm);
    const newEnd = r(startT + span);
    const dt = newEnd - oldEnd;
    const out = beats.map(b => ({ ...b }));
    for (let k = 1; k < beatCount; k++) {
        out[d + k].time = r(startT + (newEnd - startT) * k / beatCount);
    }
    out[ndb].time = newEnd;
    for (let i = ndb + 1; i < out.length; i++) {
        out[i].time = r(out[i].time + dt);
    }
    return out;
}
/* @pure:tempo-map-bpm:end */

// Move the downbeat at index `d` in `beats` to `newT`, re-spacing the
// interior sub-beats of the two adjacent measures. Downbeats other than
// `d` keep their exact time — edits stay local. Mutates `beats`.
function _tempoApplyDrag(beats, d, newT) {
    let pdb = -1, ndb = -1;
    for (let i = d - 1; i >= 0; i--) { if (beats[i].measure > 0) { pdb = i; break; } }
    for (let i = d + 1; i < beats.length; i++) { if (beats[i].measure > 0) { ndb = i; break; } }
    const oldT = beats[d].time;
    beats[d].time = newT;
    // Previous measure — re-space its interior, or rigid-shift a pickup.
    if (pdb >= 0) {
        const span = d - pdb;
        for (let k = 1; k < span; k++) {
            beats[pdb + k].time = beats[pdb].time + (newT - beats[pdb].time) * k / span;
        }
    } else {
        const dt = newT - oldT;
        for (let i = 0; i < d; i++) beats[i].time += dt;
    }
    // Next measure — re-space its interior, or rigid-shift the tail.
    if (ndb >= 0) {
        const span = ndb - d;
        for (let k = 1; k < span; k++) {
            beats[d + k].time = newT + (beats[ndb].time - newT) * k / span;
        }
    } else {
        const dt = newT - oldT;
        for (let i = d + 1; i < beats.length; i++) beats[i].time += dt;
    }
}

function _tempoMapOnDragMove(x) {
    const dg = S.drag;
    if (!dg || dg.type !== 'tempo-sync') return;
    if (!dg.moved && Math.abs(x - dg.startX) < 3) return;
    dg.moved = true;
    const d = dg.beatIdx;
    const orig = dg.origBeats;
    // Bounding downbeats from the ORIGINAL grid.
    let pdb = -1, ndb = -1;
    for (let i = d - 1; i >= 0; i--) { if (orig[i].measure > 0) { pdb = i; break; } }
    for (let i = d + 1; i < orig.length; i++) { if (orig[i].measure > 0) { ndb = i; break; } }
    const loBound = pdb >= 0 ? orig[pdb].time + MIN_MEASURE : 0;
    const hiBound = ndb >= 0
        ? orig[ndb].time - MIN_MEASURE
        : (S.duration || orig[orig.length - 1].time);
    const newT = Math.max(loBound, Math.min(hiBound, xToTime(x)));
    // Rebuild from the original grid each move so re-drags don't compound.
    S.beats = orig.map(b => ({ ...b }));
    _tempoApplyDrag(S.beats, d, newT);
    draw();
}

function _tempoMapOnDragEnd() {
    const dg = S.drag;
    S.drag = null;
    if (!dg || dg.type !== 'tempo-sync') return;
    if (!dg.moved) { draw(); return; }  // a click-select, not a drag
    const newBeats = S.beats.map(b => ({ ...b }));
    S.beats = dg.origBeats;  // revert — TempoMapCmd.exec re-applies it
    // A drag re-spaces beats in place; it never adds or removes one, so
    // the counts must match. Validate here, before the command reaches
    // history — bailing inside exec() would still leave an inert undo
    // entry on the stack. A mismatch means a real bug upstream.
    if (newBeats.length !== dg.origBeats.length) {
        console.error('[tempo] drag changed beat count — discarding edit '
            + '(this should be impossible).');
        draw();
        return;
    }
    S.history.exec(new TempoMapCmd(dg.origBeats, newBeats, 'drag'));
    draw();
}

// Finalize whatever canvas drag is in progress before a mode switch:
// a moved sync-point / drum drag commits to history via its own
// drag-end handler; any other drag (pan / select / resize) is simply
// cleared. Leaves S.drag null either way.
function _finalizeActiveDrag() {
    if (!S.drag) return;
    if (S.drag.type === 'tempo-sync') _tempoMapOnDragEnd();
    else if (S.drag.type === 'drum-move') _drumEditorOnDragEnd();
    // Commit an in-flight handshape create/move/resize through its own mouseup
    // so the edit lands as a history command (instead of being silently
    // dropped when a mode toggle interrupts the drag).
    else if (S.drag.type === 'handshape') onHandshapeLaneMouseUp();
    else S.drag = null;
}

// ── Notes ride the grid — piecewise-linear time remapper ────────────

// Build remap(t): maps an absolute time from the old beat grid to the
// new one by linear interpolation within the corresponding segment.
// A segment whose endpoints didn't move maps identically, so edits to
// one measure leave the rest of the song untouched.
function _makeTimeRemap(oldBeats, newBeats) {
    const ot = oldBeats.map(b => b.time);
    const nt = newBeats.map(b => b.time);
    const n = ot.length;
    return function remap(t) {
        if (n === 0) return t;
        if (t <= ot[0]) return t + (nt[0] - ot[0]);
        if (t >= ot[n - 1]) return t + (nt[n - 1] - ot[n - 1]);
        let lo = 0, hi = n - 1;
        while (lo < hi) {
            const m = (lo + hi + 1) >> 1;
            if (ot[m] <= t) lo = m; else hi = m - 1;
        }
        const span = ot[lo + 1] - ot[lo];
        const frac = span > 1e-9 ? (t - ot[lo]) / span : 0;
        return nt[lo] + frac * (nt[lo + 1] - nt[lo]);
    };
}

const _r3 = v => Math.round(v * 1000) / 1000;

// The arrangements an 'all'-scope tempo edit re-times. archive saves only
// persist the active arrangement (_buildSaveBody ships body.arrangements
// for sloppak only), so re-timing a non-active arrangement on a archive
// would be silently lost on reload — limit archive to the active one.
// A TempoMapCmd freezes this list at construction so capture / remap /
// restore all agree even if the user switches arrangements later.
function _tempoRetimeArrangements() {
    if (S.format === 'archive') {
        const a = S.arrangements[S.currentArr];
        return a ? [a] : [];
    }
    return (S.arrangements || []).filter(Boolean);
}

// Apply `remap` to every timed object the scope re-times. Always
// re-times drum_tab hits; 'all' additionally re-times the given
// arrangements' notes/chords/anchors/handshapes/phrases + sections.
function _applyTempoRemap(remap, scope, arrs) {
    if (S.drumTab && Array.isArray(S.drumTab.hits)) {
        for (const h of S.drumTab.hits) {
            if (typeof h.t === 'number') h.t = _r3(remap(h.t));
        }
        S.drumTabDirty = true;
    }
    // Sections mark song structure — they ride the grid in EVERY scope.
    // The grid moved, so a section marker must follow its measure
    // regardless of which instruments' notes ride.
    for (const s of (S.sections || [])) {
        if (typeof s.start_time === 'number') s.start_time = _r3(remap(s.start_time));
    }
    if (scope !== 'all') return;
    const remapNote = (o) => {
        if (typeof o.time !== 'number') return;
        const oldT = o.time;
        o.time = _r3(remap(oldT));
        if (typeof o.sustain === 'number' && o.sustain > 0) {
            o.sustain = Math.max(0, _r3(remap(oldT + o.sustain) - remap(oldT)));
        }
    };
    for (const arr of (arrs || [])) {
        if (!arr) continue;
        for (const n of (arr.notes || [])) remapNote(n);
        for (const ch of (arr.chords || [])) {
            if (typeof ch.time === 'number') ch.time = _r3(remap(ch.time));
            for (const cn of (ch.notes || [])) remapNote(cn);
        }
        for (const a of (arr.anchors || [])) {
            if (typeof a.time === 'number') a.time = _r3(remap(a.time));
        }
        // PR3d: the authored anchor list lives in `arr.anchors_user`
        // and is what the backend ships when non-empty. Remap it
        // alongside the legacy `arr.anchors` so an "all"-scope tempo
        // edit doesn't leave the two lists out of sync.
        for (const a of (arr.anchors_user || [])) {
            if (typeof a.time === 'number') a.time = _r3(remap(a.time));
        }
        for (const hs of (arr.handshapes || [])) {
            // Wire fields are start_time / end_time (lib/song.py
            // hand_shape_to_wire) — not the camelCase note fields.
            if (typeof hs.start_time === 'number') hs.start_time = _r3(remap(hs.start_time));
            if (typeof hs.end_time === 'number') hs.end_time = _r3(remap(hs.end_time));
        }
        for (const ph of (arr.phrases || [])) {
            if (typeof ph.time === 'number') ph.time = _r3(remap(ph.time));
        }
    }
}

// Snapshot the exact times the scope re-times, so undo restores them
// without inverse-remap rounding drift. `arrs` is the frozen list the
// owning TempoMapCmd will also remap and restore.
// Each captured entry keeps a direct reference to the timed object
// (`ref`) plus its pre-edit values — NOT an array index. Drum-hit and
// note arrays get re-sorted by edits outside undo history (e.g.
// _drumEditorAddHit / AddNoteCmd sort by time), so an index-keyed
// snapshot could restore times onto the wrong objects. Refs are stable
// across reordering; objects added later simply aren't in the snapshot,
// and a removed object's ref is harmlessly detached.
function _captureScopedTimes(scope, arrs) {
    const snap = { drum: null, arr: null, sections: null };
    if (S.drumTab && Array.isArray(S.drumTab.hits)) {
        snap.drum = S.drumTab.hits.map(h => ({ ref: h, t: h.t }));
    }
    // Sections ride the grid in every scope — always snapshot them.
    snap.sections = (S.sections || []).map(s => ({ ref: s, start_time: s.start_time }));
    if (scope === 'all') {
        snap.arr = (arrs || []).map(arr => {
            if (!arr) return null;
            return {
                notes: (arr.notes || []).map(n => ({ ref: n, time: n.time, sustain: n.sustain })),
                chords: (arr.chords || []).map(ch => ({
                    ref: ch, time: ch.time,
                    notes: (ch.notes || []).map(cn => ({ ref: cn, time: cn.time, sustain: cn.sustain })),
                })),
                anchors: (arr.anchors || []).map(a => ({ ref: a, time: a.time })),
                anchors_user: (arr.anchors_user || []).map(a => ({ ref: a, time: a.time })),
                handshapes: (arr.handshapes || []).map(hs => ({
                    ref: hs, start_time: hs.start_time, end_time: hs.end_time,
                })),
                phrases: (arr.phrases || []).map(p => ({ ref: p, time: p.time })),
            };
        });
    }
    return snap;
}

function _restoreScopedTimes(snap, scope) {
    if (snap.drum) {
        for (const e of snap.drum) { if (e.ref) e.ref.t = e.t; }
    }
    // Sections ride in every scope — always restore them.
    if (snap.sections) {
        for (const e of snap.sections) { if (e.ref) e.ref.start_time = e.start_time; }
    }
    if (scope === 'all' && snap.arr) {
        for (const a of snap.arr) {
            if (!a) continue;
            for (const e of a.notes) {
                if (!e.ref) continue;
                e.ref.time = e.time;
                e.ref.sustain = e.sustain;
            }
            for (const e of a.chords) {
                if (e.ref) e.ref.time = e.time;
                for (const cn of e.notes) {
                    if (!cn.ref) continue;
                    cn.ref.time = cn.time;
                    cn.ref.sustain = cn.sustain;
                }
            }
            for (const e of a.anchors) { if (e.ref) e.ref.time = e.time; }
            // PR3d: restore the authored anchor list too (was
            // snapshotted alongside `anchors` above).
            if (a.anchors_user) {
                for (const e of a.anchors_user) { if (e.ref) e.ref.time = e.time; }
            }
            for (const e of a.handshapes) {
                if (!e.ref) continue;
                if (e.start_time !== undefined) e.ref.start_time = e.start_time;
                if (e.end_time !== undefined) e.ref.end_time = e.end_time;
            }
            for (const e of a.phrases) { if (e.ref) e.ref.time = e.time; }
        }
    }
}

// Undo command for one tempo-map edit. Captures the scope AND the exact
// arrangement objects it re-times at first exec, so capture / remap /
// restore stay consistent even if the scope toggle is flipped or the
// user switches arrangements between the edit and an undo.
class TempoMapCmd {
    constructor(oldBeats, newBeats, label) {
        this.oldBeats = oldBeats.map(b => ({ ...b }));
        this.newBeats = newBeats.map(b => ({ ...b }));
        this.scope = S.tempoRideScope;
        this.label = label || 'tempo';
        this.before = null;
        this.arrs = null;
    }
    exec() {
        // Invariant: oldBeats / newBeats have equal length — TempoMapCmd
        // only carries time-shift (drag) edits. _tempoMapOnDragEnd
        // validates this before the command is ever created, so a
        // length-changing edit can't reach here (those use TempoGridCmd).
        if (!this.before) {
            this.arrs = (this.scope === 'all') ? _tempoRetimeArrangements() : [];
            this.before = _captureScopedTimes(this.scope, this.arrs);
        }
        S.beats = this.newBeats.map(b => ({ ...b }));
        _applyTempoRemap(_makeTimeRemap(this.oldBeats, this.newBeats),
                         this.scope, this.arrs);
    }
    rollback() {
        S.beats = this.oldBeats.map(b => ({ ...b }));
        _restoreScopedTimes(this.before, this.scope);
    }
}

// Add a hit at the snap-aligned time on the lane under (x, y). Returns
// true if added (false if click was outside the lane grid).
function _drumEditorAddHit(x, y) {
    const piece = _drumPieceAtY(y);
    if (!piece) return false;
    // Reject clicks in the left label gutter — xToTime(x) there is
    // negative and clamps to t=0, which would silently add an off-screen
    // hit at the start of the song.
    if (x < LABEL_W) return false;
    const rawT = xToTime(x);
    // Snap using snapTime() so drum hits align with the rest of the editor.
    // Clamp after snapping: when the first beat is offset from 0, snapTime
    // can round backward past zero and produce a negative timestamp.
    let t = Math.max(0, snapTime(Math.max(0, rawT)));
    if (!Array.isArray(S.drumTab.hits)) S.drumTab.hits = [];
    S.drumTab.hits.push({ t: Math.round(t * 1000) / 1000, p: piece, v: 100 });
    S.drumTab.hits.sort((a, b) => a.t - b.t);
    S.drumTabDirty = true;
    // Keep the ⟳ Drums (N) toolbar count in sync after adding a hit.
    updateArrangementSelector();
    return true;
}

function _drumEditorOnMouseDown(e, x, y) {
    // Click in the waveform area above the lane grid → set cursor (no note edit).
    if (y < WAVEFORM_H) {
        // Waveform-area click sets the cursor like in guitar mode.
        S.cursorTime = Math.max(0, xToTime(x));
        if (S.playing) { stopPlayback(); startPlayback(); }
        draw();
        return;
    }
    if (y > WAVEFORM_H + _drumPieceCount() * DRUM_LANE_H) return;
    // Clicks in the left lane-label gutter aren't on the time grid —
    // ignore them so they neither hit-test nor add a hit.
    if (x < LABEL_W) return;

    const idx = _drumHitAtPoint(x, y);
    if (idx >= 0) {
        // Clicked on an existing hit. Two paths from here:
        //   - plain click → ensure that hit is in the selection, then start
        //     a drag that moves every selected hit together.
        //   - Shift+click → toggle the hit in/out of the selection (no drag).
        if (e.shiftKey) {
            if (S.drumSel.has(idx)) S.drumSel.delete(idx);
            else S.drumSel.add(idx);
            draw();
            return;
        }
        // If the click target isn't already selected, clear and select it
        // so the user can grab-and-drag without a separate select click.
        if (!S.drumSel.has(idx)) {
            S.drumSel.clear();
            S.drumSel.add(idx);
        }
        // Snapshot the selected hits so move math can compute deltas off
        // the original times / pieces (not the live mutating values).
        const indices = [...S.drumSel];
        const origTimes = indices.map(i => S.drumTab.hits[i].t);
        const origPieces = indices.map(i => S.drumTab.hits[i].p);
        S.drag = {
            type: 'drum-move',
            startX: x,
            startY: y,
            // Anchor time for delta-snap: cursor time at drag start, used by
            // _drumEditorOnDragMove to compute a beat-aware snapped delta via
            // snapTime(t0 + rawDt) - snapTime(t0).
            startTime: xToTime(x),
            indices,
            origTimes,
            origPieces,
            moved: false,
        };
        draw();
        return;
    }
    // Clicked empty grid spot. Defer the add-vs-marquee decision to
    // mouseup: a stationary press adds a hit (the long-standing behaviour),
    // a press-and-drag draws a rubber-band selection box (parity with the
    // guitar/keys editor). The selection is NOT cleared here — clearing is
    // deferred to mouseup so a press that neither moves nor lands a valid
    // hit leaves the existing selection intact (no-op), and a non-shift
    // marquee replaces it while shift unions onto it.
    S.drag = {
        type: 'drum-select',
        startX: x, startY: y,
        curX: x, curY: y,
        // Where to drop a hit if this turns out to be a click, not a drag.
        addX: x, addY: y,
        shift: e.shiftKey,
        moved: false,
    };
    draw();
}

// Apply an in-progress drum-move drag — called from _onMouseMoveBody
// when S.drag.type === 'drum-move'. Computes a single time delta from
// the cursor drift (snapped to the editor's snap grid) and applies it
// uniformly to every selected hit. Snapping per-hit collapses sub-grid
// detail (e.g. 16th-note double-bass gets quantised to quarter-notes if
// snap is set to ¼), so we snap the DELTA once and let it ride.
function _drumEditorOnDragMove(x, y) {
    if (!S.drag || S.drag.type !== 'drum-move' || !S.drumTab) return;
    const dx = x - S.drag.startX;
    const dy = y - S.drag.startY;
    const rawDt = dx / S.zoom;
    const dLanes = Math.round(dy / DRUM_LANE_H);
    if (Math.abs(dx) > 2 || Math.abs(dy) > 2) S.drag.moved = true;
    // Don't mutate hit positions for sub-2px movements: the threshold above
    // distinguishes a click (no move) from a real drag. Applying snapped
    // deltas before `moved` is set could snap a note across a grid boundary
    // even though the user never intended to drag.
    if (!S.drag.moved) return;
    // Guard against a malformed/older drum_tab whose `hits` is missing or
    // not an array — indexing it below would throw mid-drag. Matches the
    // defensive `|| []` other drum-editor helpers use.
    if (!Array.isArray(S.drumTab.hits)) return;
    const hits = S.drumTab.hits;
    // Snap the COMMON delta once by anchoring at the drag start time and
    // delegating to snapTime(), which respects per-surrounding-beat
    // intervals and handles tempo changes correctly. This preserves the
    // relative spacing between selected hits even when the editor's snap
    // grid is coarser than the chart's note resolution.
    const t0 = S.drag.startTime ?? 0;
    const rawTarget = t0 + rawDt;
    const snappedDt = snapTime(rawTarget) - snapTime(t0);
    for (let k = 0; k < S.drag.indices.length; k++) {
        const idx = S.drag.indices[k];
        const h = hits[idx];
        if (!h) continue;
        const newT = Math.max(0, S.drag.origTimes[k] + snappedDt);
        h.t = Math.round(newT * 1000) / 1000;

        // Lane (piece) movement — index into DRUM_PIECE_ORDER.
        // Skip remap for unknown piece ids (indexOf returns -1) to avoid
        // silently mapping the hit to lane 0 ("china") on the first drag.
        const origPieceIdx = DRUM_PIECE_ORDER.indexOf(S.drag.origPieces[k]);
        if (origPieceIdx >= 0) {
            const newPieceIdx = Math.max(
                0,
                Math.min(DRUM_PIECE_ORDER.length - 1, origPieceIdx + dLanes),
            );
            h.p = DRUM_PIECE_ORDER[newPieceIdx];
        }
    }
}

// Finalise a drum-move drag — keep the hits array sorted by time so the
// renderer's binary-search-friendly early-break stays correct, then
// remap the selection indices through the sort. Called from onMouseUp
// when S.drag.type === 'drum-move'.
function _drumEditorOnDragEnd() {
    if (!S.drag || S.drag.type !== 'drum-move' || !S.drumTab) return;
    const moved = !!S.drag.moved;
    if (moved) {
        S.drumTabDirty = true;
        const hits = S.drumTab.hits;
        // Tag selected hits with a transient marker so we can recover their
        // indices after the sort.
        const sentinel = Symbol('drumSel');
        for (const idx of S.drag.indices) {
            if (hits[idx]) hits[idx][sentinel] = true;
        }
        hits.sort((a, b) => a.t - b.t);
        S.drumSel = new Set();
        for (let i = 0; i < hits.length; i++) {
            if (hits[i][sentinel]) {
                S.drumSel.add(i);
                delete hits[i][sentinel];
            }
        }
    }
    S.drag = null;
    draw();
}

// Finalise a drum marquee drag. The selection is cleared lazily here (not
// on mousedown), so a press that does nothing leaves it intact:
//   - real drag (moved): non-shift replaces the selection, shift unions
//     onto it; either way every hit whose centre falls inside the
//     rubber-band rect is added.
//   - stationary press (no move): a plain click → add a hit at the press
//     point (clearing the selection only if the hit landed), matching the
//     pre-marquee behaviour.
// Called from onMouseUp when S.drag.type === 'drum-select'.
function _drumEditorOnSelectEnd() {
    if (!S.drag || S.drag.type !== 'drum-select' || !S.drumTab) {
        S.drag = null;
        draw();
        return;
    }
    if (!S.drag.moved) {
        // Plain click on empty grid → add a hit. Only clear the selection
        // if the hit actually landed (a press on a dead spot — e.g. the
        // bottom grid border where _drumPieceAtY returns null — is a no-op
        // and must not wipe the current selection).
        const added = _drumEditorAddHit(S.drag.addX, S.drag.addY);
        S.drag = null;
        if (added) S.drumSel.clear();
        draw();
        return;
    }
    // Marquee. Non-shift replaces the selection; shift unions onto it.
    if (!S.drag.shift) S.drumSel.clear();
    // Select hits whose drawn centre lies inside the rect.
    const x1 = Math.min(S.drag.startX, S.drag.curX);
    const y1 = Math.min(S.drag.startY, S.drag.curY);
    const x2 = Math.max(S.drag.startX, S.drag.curX);
    const y2 = Math.max(S.drag.startY, S.drag.curY);
    const hits = Array.isArray(S.drumTab.hits) ? S.drumTab.hits : [];
    for (let i = 0; i < hits.length; i++) {
        const h = hits[i];
        const laneIdx = DRUM_PIECE_ORDER.indexOf(h.p);
        if (laneIdx < 0) continue;  // unknown piece → not on the grid
        const hx = timeToX(h.t);
        const hy = _drumLaneIdxToY(laneIdx) + DRUM_LANE_H / 2;
        if (hx >= x1 && hx <= x2 && hy >= y1 && hy <= y2) S.drumSel.add(i);
    }
    S.drag = null;
    draw();
}

function _drumEditorDeleteSelection() {
    if (!S.drumTab || !S.drumSel.size) return;
    if (!Array.isArray(S.drumTab.hits)) return;
    const drop = S.drumSel;
    S.drumTab.hits = S.drumTab.hits.filter((_, i) => !drop.has(i));
    S.drumSel = new Set();
    S.drumTabDirty = true;
    // Keep the ⟳ Drums (N) toolbar count in sync after deleting hits.
    updateArrangementSelector();
}

function _drumEditorToggleArticulation(kind) {
    if (!S.drumTab) return;
    // Guard a malformed/older drum_tab with missing/non-array `hits`.
    if (!Array.isArray(S.drumTab.hits)) return;
    if (S.drumSel.size) S.drumTabDirty = true;
    const field = kind === 'g' ? 'g' : kind === 'f' ? 'f' : 'k';
    for (const idx of S.drumSel) {
        const h = S.drumTab.hits[idx];
        if (!h) continue;
        if (field === 'k') {
            // Choke is only meaningful on cymbal pieces; ignored on drums.
            const meta = DRUM_PIECE_META[h.p];
            if (!meta || meta.cat !== 'cymbal') continue;
            if (h.k) delete h.k; else h.k = 0.08;
        } else {
            if (h[field]) delete h[field]; else h[field] = true;
        }
    }
}

// ── Drum-edit toggle button (injected next to the +Drums button) ─────

function _ensureDrumEditButton() {
    let btn = document.getElementById('editor-drum-edit-btn');
    if (!btn) {
        const drumsBtn = document.getElementById('editor-add-drums-btn');
        if (!drumsBtn) return null;
        btn = document.createElement('button');
        btn.id = 'editor-drum-edit-btn';
        btn.type = 'button';
        btn.textContent = '🥁 Edit Drums';
        btn.className = 'px-3 py-1 bg-dark-600 hover:bg-dark-500 rounded text-xs font-medium hidden';
        btn.title = 'Open the piece-lane drum editor';
        btn.onclick = () => {
            S.drumEditMode = !S.drumEditMode;
            S.drumSel = new Set();
            // Close any open guitar/keys note UI and drop the stale
            // arrangement selection — while the drum grid is showing, the
            // note context menu / add-note popover would otherwise stay
            // interactive and could mutate the hidden arrangement.
            hideContextMenu();
            hideAddNote();
            S.sel.clear();
            // Finalize any in-progress canvas drag before the mode
            // switch — commit a moved drag rather than discard it.
            _finalizeActiveDrag();
            // Tempo and drum modes are mutually exclusive.
            if (S.drumEditMode) {
                S.tempoMapMode = false;
                S.tempoSel = -1;
            }
            _refreshDrumEditButton();
            _refreshTempoMapButton();
            draw();
        };
        drumsBtn.parentNode.insertBefore(btn, drumsBtn.nextSibling);
    }
    return btn;
}

let _drumEditBtnState = '';  // cached signature; button only updates when state changes

function _refreshDrumEditButton() {
    const btn = _ensureDrumEditButton();
    if (!btn) return;
    // Memoize on the fields that actually affect the button so it
    // does not cause layout/paint work on every requestAnimationFrame.
    // Include format: drum editing can only be persisted in sloppak sessions.
    const sig = `${!!S.drumTab}|${!!S.sessionId}|${!!S.drumEditMode}|${S.format}`;
    if (sig === _drumEditBtnState) return;
    _drumEditBtnState = sig;
    btn.classList.toggle('hidden', !S.drumTab || !S.sessionId || S.format !== 'sloppak');
    if (S.drumEditMode) {
        btn.textContent = '🎸 Back to Notes';
        btn.classList.add('bg-amber-600', 'hover:bg-amber-500');
        btn.classList.remove('bg-dark-600', 'hover:bg-dark-500');
    } else {
        btn.textContent = '🥁 Edit Drums';
        btn.classList.remove('bg-amber-600', 'hover:bg-amber-500');
        btn.classList.add('bg-dark-600', 'hover:bg-dark-500');
    }
}

// Hook into the existing updateArrangementSelector toolbar pass so the
// button shows/hides alongside +Drums whenever the editor re-renders
// its controls.
const _checkBtnInterval = setInterval(() => {
    if (document.getElementById('editor-add-drums-btn')) {
        _refreshDrumEditButton();
        clearInterval(_checkBtnInterval);
    }
}, 200);
// Run on every draw via a lightweight side-channel — draw is called on
// every state change. Memoization in _refreshDrumEditButton prevents
// DOM mutations on every requestAnimationFrame tick.
const _origDraw = draw;
draw = function () {
    _refreshDrumEditButton();
    _refreshTempoMapButton();
    _refreshTempoScopeToggle();
    return _origDraw.apply(this, arguments);
};

// Run init after DOM is ready
if (document.getElementById('editor-canvas')) {
    init();
} else {
    // Wait for plugin screen to be injected
    const check = setInterval(() => {
        if (document.getElementById('editor-canvas')) {
            clearInterval(check);
            init();
        }
    }, 100);
}

// ════════════════════════════════════════════════════════════════════
// Tone lane — PR3c of the tones+notation UI follow-up.
//
// Renders tone-change markers on a thin strip at the top of the
// canvas, lets the user click-to-add / drag-to-move / Del-to-remove
// markers, and surfaces a Tones… modal for slot renaming + base
// selection. All edits go through `S.history` so undo/redo works.
//
// `TONE_LANE_H`, `_TONE_SLOT_DEFAULTS`, `_TONE_SLOT_COLORS` are
// declared at the top of this IIFE (alongside `S`) so callsites
// further down the file resolve them safely.
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

function _ensureTones(arr) {
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
function _tonesAreDirty(arr) {
    return !!(arr && arr.tones && (arr.tones._editCount || 0) > 0);
}

// Strip client-only fields (`_editCount`, formerly `_dirty`) before
// shipping `arr.tones` to the backend. Returns a fresh object so we
// don't mutate the in-memory state.
function _stripToneInternals(tones) {
    if (!tones || typeof tones !== 'object') return tones;
    const { _editCount, _dirty, ...wire } = tones;
    return wire;
}

function _currentToneArr() {
    if (!S.arrangements || !S.arrangements[S.currentArr]) return null;
    return S.arrangements[S.currentArr];
}

// ─── Lane drawing ───────────────────────────────────────────────────

function drawToneLane(w) {
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

class AddToneChangeCmd {
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

class RemoveToneChangeCmd {
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

function onToneLaneMouseDown(e, x) {
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
        draw();
        return true;
    }
    // Empty area click — place a new change snapped to the grid. The
    // first add against an unauthored arrangement is what should
    // synthesise `arr.tones`, and that happens inside
    // `AddToneChangeCmd.exec` via `_bumpTonesDirty(+1)`. Read via
    // `_readToneSnapshot` here so the slot lookup doesn't mutate
    // state for a click outside any marker.
    const t = snapTime(Math.max(0, xToTime(x)));
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
    draw();
    return true;
}

function onToneLaneMouseMove(e, x) {
    if (!S.drag || S.drag.type !== 'tone') return false;
    const arr = _currentToneArr();
    if (!arr) return false;
    // Snap the drag target so dropped markers land on the same grid
    // subdivision the rest of the editor uses. Skip the sort during
    // live drag — the commit on mouseup goes through
    // `MoveToneChangeCmd` which sorts once, and sorting on every
    // mousemove was O(n log n) per frame on big arrangements.
    const newT = snapTime(Math.max(0, xToTime(x)));
    S.drag.change.t = newT;
    // Selection is by ref, so the deferred sort doesn't invalidate it.
    S.toneSel = S.drag.change;
    draw();
    return true;
}

function onToneLaneMouseUp() {
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
    draw();
    return true;
}

function onToneLaneContextMenu(e, x) {
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
            hideContextMenu();
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
            draw();
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
        hideContextMenu();
        // Use the captured `menuArrIdx` rather than the live
        // `S.currentArr` so a mid-menu arrangement switch can't
        // route the delete (and its dirty-counter bump) to the wrong
        // arrangement.
        S.history.exec(new RemoveToneChangeCmd(menuArrIdx, change));
        S.toneSel = null;
        draw();
    };
    menu.appendChild(delBtn);

    menu.style.left = e.clientX + 'px';
    menu.style.top = e.clientY + 'px';
    menu.classList.remove('hidden');
    return true;
}

// ─── Modal handlers ─────────────────────────────────────────────────

window.editorShowTonesModal = () => {
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
};

window.editorHideTonesModal = () => {
    document.getElementById('editor-tones-modal').classList.add('hidden');
};

window.editorApplyTonesModal = () => {
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
    draw();
};

// Show the Tones… toolbar button once a song is loaded (matches the
// reveal pattern of +Drums / +Keys / Strings / Build / Save).
function _updateTonesButtonVisibility() {
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
// cancelled at the warning prompt. Called from `editorBuild` before
// the network request. Declared as a plain function inside the
// module IIFE so the bare-name reference at the callsite resolves
// through normal lexical scoping (the previous `window.` assignment
// relied on the browser's global → IIFE fallback, which works but
// is fragile).
function _editorConfirmToneDefinitions() {
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
function _readAnchorSnapshot(arr) {
    if (!arr) return { list: [], isAuto: false };
    const userList = Array.isArray(arr.anchors_user) ? arr.anchors_user : null;
    if (userList && userList.length > 0) {
        return { list: userList, isAuto: false };
    }
    const autoList = Array.isArray(arr.anchors) ? arr.anchors : [];
    return { list: autoList, isAuto: true };
}

function _currentAnchorArr() {
    if (!S.arrangements || !S.arrangements[S.currentArr]) return null;
    return S.arrangements[S.currentArr];
}

// Ensure `arr.anchors_user` exists for authoring. Only seeds the
// array — the dirty counter lives on `arr` itself (set by
// `_bumpAnchorsDirty`, not here) so load-time `_song_to_dict`
// passthroughs that already shipped an `anchors_user` aren't
// flagged as authored.
function _ensureAnchors(arr) {
    if (!arr) return null;
    if (!Array.isArray(arr.anchors_user)) arr.anchors_user = [];
    return arr.anchors_user;
}

// Edit counter lives on `arr` rather than `arr.anchors_user` so a
// load that synthesised `anchors_user = []` via `_ensureAnchors`
// doesn't get spuriously flagged as authored, AND the JSON
// serialisation paths below explicitly strip `_anchorEditCount` from
// the wire body so the counter never leaks to the backend.
function _bumpAnchorsDirty(arr, delta) {
    if (!arr) return;
    _ensureAnchors(arr);
    const next = (arr._anchorEditCount || 0) + delta;
    arr._anchorEditCount = next > 0 ? next : 0;
}

function _anchorsAreDirty(arr) {
    return !!(arr && (arr._anchorEditCount || 0) > 0);
}

// E2: handshape dirty tracking — mirrors the anchor pattern above. The edit
// counter lives on `arr` (not on `arr.handshapes`) so a load that normalized
// handshapes via `_normalizeHandshape` isn't flagged as authored, and the
// serialize paths strip `_handshapeEditCount` from the wire body.
function _ensureHandshapes(arr) {
    if (!arr) return null;
    if (!Array.isArray(arr.handshapes)) arr.handshapes = [];
    return arr.handshapes;
}

function _bumpHandshapesDirty(arr, delta) {
    if (!arr) return;
    _ensureHandshapes(arr);
    const next = (arr._handshapeEditCount || 0) + delta;
    arr._handshapeEditCount = next > 0 ? next : 0;
}

function _handshapesAreDirty(arr) {
    return !!(arr && (arr._handshapeEditCount || 0) > 0);
}

function _anchorLaneTopY() {
    // Anchor lane sits right below the beat bar — reuse the shared
    // `_beatBarTopY()` so it stays in sync with keys vs guitar mode
    // (and with whatever else uses the beat-bar Y).
    return _beatBarTopY() + BEAT_H;
}

// ─── Lane drawing ───────────────────────────────────────────────────

function drawAnchorLane(w) {
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
function _promoteAnchor(arr, anchor, isAuto) {
    if (!arr || !anchor) return anchor;
    if (!isAuto) return anchor;
    const autoList = Array.isArray(arr.anchors) ? arr.anchors : [];
    const cmd = new PromoteAnchorsCmd(S.currentArr, autoList, anchor);
    S.history.exec(cmd);
    return cmd.target || anchor;
}

// ─── Cmd classes ────────────────────────────────────────────────────

class AddAnchorCmd {
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
class PromoteAnchorsCmd {
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

class RemoveAnchorCmd {
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
class EditChordTemplateCmd {
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

function onAnchorLaneMouseDown(e, x, y) {
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
        draw();
        return true;
    }
    // Empty area click — place a new anchor at the snapped time with
    // a sensible default (fret 1, width 4). The right-click context
    // menu lets the user edit fret/width afterwards.
    const t = snapTime(Math.max(0, xToTime(x)));
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
    draw();
    return true;
}

function onAnchorLaneMouseMove(e, x) {
    if (!S.drag || S.drag.type !== 'anchor') return false;
    const arr = _currentAnchorArr();
    if (!arr) return false;
    // Same perf trick as the tone-lane drag — update `.time` in-place
    // for live feedback; defer the sort to mouseup (MoveAnchorCmd).
    S.drag.anchor.time = snapTime(Math.max(0, xToTime(x)));
    S.anchorSel = S.drag.anchor;
    draw();
    return true;
}

function onAnchorLaneMouseUp() {
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
    draw();
    return true;
}

function onAnchorLaneContextMenu(e, x, y) {
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
        hideContextMenu();
        const fretStr = await _editorPromptText({
            title: 'Edit Anchor', label: 'Hand-position fret — index finger (1–24)', value: String(hit.fret),
        });
        if (fretStr === null) return;
        const widthStr = await _editorPromptText({
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
        draw();
    };
    menu.appendChild(editBtn);

    const sep = document.createElement('div');
    sep.className = 'border-t border-gray-700 my-1';
    menu.appendChild(sep);

    const delBtn = document.createElement('button');
    delBtn.className = 'w-full text-left px-3 py-1 text-xs hover:bg-dark-500 text-rose-300';
    delBtn.textContent = 'Delete anchor';
    delBtn.onclick = () => {
        hideContextMenu();
        S.history.exec(new RemoveAnchorCmd(menuArrIdx, hit));
        S.anchorSel = null;
        draw();
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

function _handshapeLaneTopY() {
    // Sits directly below the anchor lane.
    return _anchorLaneTopY() + ANCHOR_LANE_H;
}

// Compute the width-L fret pattern (voicing) covered by a [s, e] span from the
// flattened editor notes. Prefers a same-time chord (>=2 notes); otherwise
// combines the span's single notes into one shape (the arpeggio case). Returns
// null when the span covers no notes.
function _handshapeSpanFrets(arr, s, e, L) {
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

function drawHandshapeLane(w) {
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

class AddHandshapeCmd {
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

class RemoveHandshapeCmd {
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

function onHandshapeLaneMouseDown(e, x, y) {
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
            startX: x, grabTime: snapTime(Math.max(0, xToTime(x))),
        };
        draw();
        return true;
    }
    // Empty lane → begin a create drag. arp defaults true (arpeggio framing is
    // the dominant case the highway renders).
    const t = snapTime(Math.max(0, xToTime(x)));
    S.handshapeSel = null;
    S.drag = {
        type: 'handshape', mode: 'create', anchorTime: t,
        hs: { start_time: t, end_time: t, arp: true },
    };
    draw();
    return true;
}

function onHandshapeLaneMouseMove(e, x) {
    if (!S.drag || S.drag.type !== 'handshape') return false;
    const t = snapTime(Math.max(0, xToTime(x)));
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
    draw();
    return true;
}

function onHandshapeLaneMouseUp() {
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
    draw();
    return true;
}

function onHandshapeLaneContextMenu(e, x, y) {
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
        hideContextMenu();
        S.history.exec(new ToggleHandshapeArpCmd(menuArrIdx, hs));
        draw();
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
                hideContextMenu();
                if (idx !== hs.chord_id) {
                    S.history.exec(new SetHandshapeChordCmd(menuArrIdx, hs, hs.chord_id, idx));
                }
                draw();
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
        hideContextMenu();
        S.history.exec(new RemoveHandshapeCmd(menuArrIdx, hs));
        S.handshapeSel = null;
        draw();
    };
    menu.appendChild(delBtn);

    menu.style.left = e.clientX + 'px';
    menu.style.top = e.clientY + 'px';
    menu.classList.remove('hidden');
    return true;
}

})();
