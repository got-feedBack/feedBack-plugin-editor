/* Slopsmith Arrangement Editor — the painters.
 *
 * Everything that puts pixels on the chart canvas: lane and grid backgrounds,
 * the section-coverage strip, the notes (fretted and piano-roll), the cursor
 * and the marquee — plus the song-key highlight state the note painters
 * consult, and `canvasH`, which depends on the roll's lane count. The
 * timeline header (minimap + ruler, which absorbed the old beat bar) paints
 * in src/ruler.js.
 *
 * Reads `ctx` (src/canvas.js), the geometry, the lane and keys models, and `S`.
 * It does NOT know the per-frame orchestrator: `drawNow()` stays in main.js and
 * calls in here, so the edge is one-way and no seam is needed. `drawWaveform`
 * stays there too — it paints the onset strip and bookmark overlays, which live
 * in main.js.
 */

import { ctx } from './canvas.js';
import { host } from './host.js';
import {
    LABEL_W,
    LANE_H,
    MINIMAP_H,
    MIN_NOTE_W,
    NOTE_PAD,
    TIMELINE_TOP,
    WAVEFORM_H,
    laneScrollY,
    laneToY,
    strToY,
    timeToX,
} from './geometry.js';
import {
    PIANO_LANE_H,
    PIANO_OCTAVE_COLORS,
    _rollMidiForNote,
    _rollPitchCtx,
    isBlackKey,
    editorKeyNoteNames,
    isKeysMode,
    midiToNote,
    midiToY,
    noteToMidi,
    pianoLaneCount,
    pianoRange,
} from './keys.js';
import {
    _openMidiForArr,
    _soundingPitchPure,
    _stringCountFor,
    colorForLane,
    laneLabels,
    laneToStr,
    lanes,
    strToLane,
} from './lanes.js';
import { _isSuggested, notes, sanitizeBendCurve } from './notes.js';
import { _lintFlaggedSet } from './playability-lint.js';
import { _maybeFireFirstCovered } from './signposts.js';
import {
    SCALE_INTERVALS,
    _SCALE_DEGREE_LABELS,
    _pcInScalePure,
    _scaleDegreeColorPure,
    _scaleDegreeSemisPure,
} from './theory.js';
import { S, editGen } from './state.js';
import { CP } from './canvas-appearance.js';
import { HAND_LH_COLOR, HAND_RH_COLOR, _editorHandShadingEnabled } from './hand.js';

export function drawLanes(w) {
    if (isKeysMode()) return drawPianoLanes(w);
    const L = lanes();
    for (let l = 0; l < L; l++) {
        const y = laneToY(l);
        ctx.fillStyle = l % 2 === 0 ? CP('laneEven') : CP('laneOdd');
        ctx.fillRect(LABEL_W, y, w - LABEL_W, LANE_H);
        // Separator
        ctx.strokeStyle = CP('laneSep');
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(LABEL_W, y + LANE_H);
        ctx.lineTo(w, y + LANE_H);
        ctx.stroke();
    }
}

// ── Song key / scale + in-key highlight (piano roll) ─────────────────
// S.editorKey = { tonic: 0..11, scale: <SCALE_INTERVALS id> } | null. The
// key is a per-song editor preference (localStorage keyed by S.filename,
// never the feedpak — this is a view aid, not chart data). The highlight
// on/off is a global editor preference. Neither is authoritative harmony
// data; a later PR authors keys.json regions and this reads from them.
let _editorKeyLoadedFor = null;

export function editorKeyHighlightEnabled() {
    try { return localStorage.getItem('editorKeyHighlight') === '1'; }
    catch (_) { return false; }
}

// Lazily load the saved key for the current song (called from the control
// refresh, which runs every draw) so no song-load-path edit is needed.
export function _loadEditorKeyIfNeeded() {
    if (_editorKeyLoadedFor === S.filename) return;
    _editorKeyLoadedFor = S.filename;
    S.editorKey = null;
    // No filename yet (unsaved song): don't read a bare `editorKey:` slot —
    // otherwise every unsaved song would share the same stored key.
    if (!S.filename) return;
    try {
        const raw = localStorage.getItem('editorKey:' + (S.filename || ''));
        if (raw) {
            const k = JSON.parse(raw);
            if (Number.isInteger(k.tonic) && SCALE_INTERVALS[k.scale]) {
                S.editorKey = { tonic: k.tonic, scale: k.scale };
            }
        }
    } catch (_) { /* ignore */ }
}

export function _persistEditorKey() {
    // No filename yet (unsaved song): don't write a bare `editorKey:` slot that
    // every unsaved song would collide on; the in-memory key still applies.
    if (!S.filename) return;
    try {
        const key = 'editorKey:' + (S.filename || '');
        if (S.editorKey) localStorage.setItem(key, JSON.stringify(S.editorKey));
        else localStorage.removeItem(key);
    } catch (_) { /* ignore */ }
}

// The active highlight settings, or null when off / unset / invalid — the
// single guard every render path consults, so a bad state can't paint.
function _activeKeyHighlight() {
    if (!editorKeyHighlightEnabled()) return null;
    const k = S.editorKey;
    if (!k || !Number.isInteger(k.tonic) || !SCALE_INTERVALS[k.scale]) return null;
    return k;
}

function drawPianoLanes(w) {
    const hl = _activeKeyHighlight();
    for (let midi = pianoRange.lo; midi <= pianoRange.hi; midi++) {
        const y = midiToY(midi);
        const black = isBlackKey(midi);
        ctx.fillStyle = black ? CP('pianoRowBlack') : CP('pianoRowWhite');
        ctx.fillRect(LABEL_W, y, w - LABEL_W, PIANO_LANE_H);

        // Out-of-key rows get a neutral desaturating wash (never red —
        // chromaticism isn't an error). In-key rows are left as drawn.
        if (hl && !_pcInScalePure(midi % 12, hl.tonic, hl.scale)) {
            ctx.fillStyle = 'rgba(20,20,34,0.55)';
            ctx.fillRect(LABEL_W, y, w - LABEL_W, PIANO_LANE_H);
        }

        // Octave boundary (C notes)
        if (midi % 12 === 0) {
            ctx.strokeStyle = CP('octaveLine');
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(LABEL_W, y + PIANO_LANE_H);
            ctx.lineTo(w, y + PIANO_LANE_H);
            ctx.stroke();
        }
    }
}

export function drawGrid(w) {
    const st = S.scrollX - 1;
    const et = S.scrollX + (w - LABEL_W) / S.zoom + 1;
    const laneTop = TIMELINE_TOP + WAVEFORM_H;
    const laneBottom = _beatBarTopY();
    for (const b of S.beats) {
        if (b.time < st || b.time > et) continue;
        const x = timeToX(b.time);
        if (x < LABEL_W || x > w) continue;
        const meas = b.measure > 0;
        // Palette-routed (View ▸ Canvas appearance…): the old constants
        // (#2a2a50 / #16162c @ 0.5px) left beat lines invisible on some
        // panels — brighter defaults + a full-width beat stroke, and the
        // grid-strength slider scales from there.
        ctx.strokeStyle = meas ? CP('gridMeasure') : CP('gridBeat');
        ctx.lineWidth = meas ? 1.5 : 1;
        ctx.beginPath();
        ctx.moveTo(x, laneTop);
        ctx.lineTo(x, laneBottom);
        ctx.stroke();
    }
}

// Per-section spans with a hasContent flag: does any charted note-time fall
// in the section's [start, nextStart) window? The last section runs to the
// song end (open-ended when duration is unknown), and is INCLUSIVE of its
// upper edge — extended to the final note time when notes sit at or past a
// stale/short duration, so trailing content is never invisible. A note on an
// INTERIOR boundary belongs to the LATER section (half-open). Sections are
// sorted defensively and non-finite start_times dropped. Returns [] when
// there are no sections. Ambient progress — never a score.
export function _sectionCoveragePure(sections, noteTimes, duration) {
    if (!Array.isArray(sections) || !sections.length) return [];
    const secs = sections
        .filter(s => s && Number.isFinite(Number(s.start_time)))
        .map(s => Number(s.start_time))
        .sort((a, b) => a - b);
    if (!secs.length) return [];
    const dur = (Number.isFinite(duration) && duration > 0) ? duration : Infinity;
    const times = Array.isArray(noteTimes)
        ? noteTimes.map(Number).filter(Number.isFinite)
        : [];
    // The final span has no later section to bound it, so it owns every
    // trailing note: extend its end past `dur` to the last note time when a
    // note sits at/after the (possibly stale/short) duration, and treat its
    // upper edge as INCLUSIVE. Interior spans stay half-open [start, next) so
    // a note on an interior boundary still belongs to the LATER section — the
    // inclusive edge is only the outermost one, so there's no double-count.
    let maxT = -Infinity;
    for (const t of times) if (t > maxT) maxT = t;
    const lastEnd = maxT > dur ? maxT : dur;   // may be Infinity
    const out = [];
    for (let i = 0; i < secs.length; i++) {
        const start = secs[i];
        const isLast = (i + 1 >= secs.length);
        const end = isLast ? lastEnd : secs[i + 1];   // may be Infinity (last)
        let hasContent = false;
        for (const t of times) {
            if (t >= start && (isLast ? t <= end : t < end)) { hasContent = true; break; }
        }
        out.push({ start, end, hasContent });
    }
    return out;
}

// Note times of the ACTIVE arrangement (flattened — chord notes already live
// in notes() for the current arrangement).
function _currentNoteTimes() {
    return notes().map(n => n.time);
}

// Cross-frame memo for the section-coverage strip. drawSections runs on every
// requestAnimationFrame during playback, but coverage only changes on
// note/section/duration edits — never while the cursor moves. Recomputing the
// pure helper (an O(N) note-time pass plus an O(sections×notes) scan) every
// frame is the same per-frame O(N) trap the lanes()/laneLabels() caches in
// draw() deliberately avoid, so memoize behind a cheap key. In-place note-time
// moves keep the notes-array identity AND length, so they're caught by
// `editGen` (src/state.js), bumped by EditHistory._afterEdit() — the edit-contract
// hook every mutation flows through (constitution IV). The section fingerprint
// is O(sections) (a handful, negligible beside the O(notes) scan skipped) and
// catches add/remove/retime/reorder without wiring every section mutation site.
let _covCache = { key: null, notesRef: null, value: [] };
function _sectionCoverage() {
    const secs = S.sections || [];
    const ns = notes();
    // A live note-move drag mutates note.time in place every mousemove and
    // only commits to EditHistory on mouseUp, so `editGen` has not
    // bumped yet — bypass the memo for the drag's duration to keep the strip
    // live (matching the pre-memo per-frame recompute). This is the ONE
    // interactive path that changes note times without an edit-gen bump; the
    // perf target (playback) has no active drag, so it still hits the cache.
    if (S.drag && S.drag.type === 'move') {
        return _sectionCoveragePure(secs, _currentNoteTimes(), S.duration || 0);
    }
    let secSig = secs.length + ':';
    for (const s of secs) secSig += (s ? s.start_time : 'x') + ',';
    const key = editGen + '|' + S.currentArr + '|' + ns.length
        + '|' + (S.duration || 0) + '|' + secSig;
    if (key !== _covCache.key || _covCache.notesRef !== ns) {
        _covCache = {
            key, notesRef: ns,
            value: _sectionCoveragePure(secs, _currentNoteTimes(), S.duration || 0),
        };
        // Coverage only recomputes on an edit (editGen/section/duration change),
        // not per frame — the right place to check the first-covered first-win.
        _maybeFireFirstCovered(_covCache.value);
    }
    return _covCache.value;
}

export function drawSections(w) {
    const st = S.scrollX - 1;
    const et = S.scrollX + (w - LABEL_W) / S.zoom + 1;
    const laneTop = TIMELINE_TOP + WAVEFORM_H;
    const laneBottom = _beatBarTopY();
    // Completeness strip: a thin band at the top of the lane area tinting
    // each section by whether the active arrangement has notes in it — an
    // at-a-glance "where is this chart still empty", drawn under the section
    // lines below. Neutral, no percentage, no red.
    const cov = _sectionCoverage();
    for (const c of cov) {
        const x0 = Math.max(LABEL_W, timeToX(c.start));
        const x1 = Math.min(w, timeToX(c.end));
        if (x1 <= x0) continue;
        ctx.fillStyle = c.hasContent ? 'rgba(120,170,255,0.20)' : 'rgba(255,255,255,0.035)';
        ctx.fillRect(x0, laneTop, x1 - x0, 3);
    }
    // Section NAMES live on the ruler now (drawRuler, workspace-shell B3) —
    // the dashed boundary lines stay here as in-chart guides.
    for (const s of S.sections) {
        if (s.start_time < st || s.start_time > et) continue;
        const x = timeToX(s.start_time);
        if (x < LABEL_W || x > w) continue;
        ctx.strokeStyle = '#e8c04060';
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(x, laneTop);
        ctx.lineTo(x, laneBottom);
        ctx.stroke();
        ctx.setLineDash([]);
    }
}

// Y coordinate of the note-lane band's BOTTOM edge (the old beat bar's top —
// the bar itself retired into the B3 ruler at the canvas top, but the name
// stays because every sub-lane and hit-test anchors here). Branches on keys
// mode because keys lanes use a different per-lane height. `canvasH`,
// `_anchorLaneTopY`, the grid and section painters all call through here so
// they can't drift as new strips are added.
export function _beatBarTopY() {
    // The roll scrolls vertically now, so the lanes pinned BELOW it (anchor,
    // handshape, beat bar) ride with the note content — they annotate the
    // chart, so they belong to the same scrollable body. The string view has
    // no vertical scroll, where laneScrollY() is 0 and this is unchanged.
    return TIMELINE_TOP + (isKeysMode()
        ? WAVEFORM_H - laneScrollY() + pianoLaneCount() * PIANO_LANE_H
        : WAVEFORM_H + lanes() * LANE_H);
}

// Highlight the bar range selected for "Loop in 3D" — a translucent blue
// band with bright edges spanning the full chart height, drawn under the
// notes so they stay legible.
export function drawBarSel(w) {
    if (!S.barSel) return;
    const x1 = timeToX(S.barSel.startTime);
    const x2 = timeToX(S.barSel.endTime);
    if (x2 < LABEL_W || x1 > w) return;
    const cx1 = Math.max(LABEL_W, x1);
    const cx2 = Math.min(w, x2);
    const top = MINIMAP_H;   // chart-space band; the minimap paints its own
    const bot = canvasH();
    ctx.save();
    ctx.fillStyle = 'rgba(80,160,255,0.10)';
    ctx.fillRect(cx1, top, Math.max(0, cx2 - cx1), bot - top);
    ctx.strokeStyle = 'rgba(80,160,255,0.7)';
    ctx.lineWidth = 1.5;
    if (x1 >= LABEL_W && x1 <= w) { ctx.beginPath(); ctx.moveTo(x1, top); ctx.lineTo(x1, bot); ctx.stroke(); }
    if (x2 >= LABEL_W && x2 <= w) { ctx.beginPath(); ctx.moveTo(x2, top); ctx.lineTo(x2, bot); ctx.stroke(); }
    ctx.restore();
}

export function drawLabels(w) {
    // Timeline-header gutter (minimap + ruler) — the left column over the
    // whole-song and ruler bands, labelled so the two strips read distinctly.
    ctx.fillStyle = CP('gutterBg');
    ctx.fillRect(0, 0, LABEL_W, TIMELINE_TOP);
    ctx.fillStyle = '#556';
    ctx.font = '8px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('song', LABEL_W / 2, MINIMAP_H / 2);
    ctx.fillStyle = S.barSel ? '#6aa0ff' : '#667';
    ctx.fillText('⇆ bars', LABEL_W / 2, MINIMAP_H + (TIMELINE_TOP - MINIMAP_H) / 2);

    // Waveform label
    ctx.fillStyle = CP('gutterBg');
    ctx.fillRect(0, TIMELINE_TOP, LABEL_W, WAVEFORM_H);
    ctx.fillStyle = '#555';
    ctx.font = '9px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Audio', LABEL_W / 2, TIMELINE_TOP + WAVEFORM_H / 2);

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
        ctx.fillStyle = CP('gutterBg');
        ctx.fillRect(0, y, LABEL_W, LANE_H);
        const s = laneToStr(l);
        ctx.fillStyle = colorForLane(l);
        ctx.font = 'bold 12px monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(labels[s] || String(s), LABEL_W / 2, y + LANE_H / 2);
    }
}

// The left axis of the piano roll is drawn as an actual keyboard gutter: one
// key per MIDI row, white/black shaded like a real keyboard laid on its side,
// C rows labelled with their octave. It's clickable (see onMouseDown) to
// audition the pitch. Black keys are inset from the front (right) edge so the
// white keys' tails read between them, exactly as on a side-on keyboard.
const _GUTTER_BLACK_INSET = 0.42;  // fraction of LABEL_W the black key leaves as white tail on the right
function drawPianoLabels() {
    ctx.font = '8px monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    const blackW = LABEL_W * (1 - _GUTTER_BLACK_INSET);
    for (let midi = pianoRange.lo; midi <= pianoRange.hi; midi++) {
        const y = midiToY(midi);
        const black = isBlackKey(midi);
        // White base for every row (the black key's tail shows on the right).
        ctx.fillStyle = '#c9c9d6';
        ctx.fillRect(0, y, LABEL_W, PIANO_LANE_H);
        if (black) {
            // Black key: a darker bar from the back (left) edge, leaving the
            // white tail on the right — the side-on keyboard read.
            ctx.fillStyle = '#1b1b2a';
            ctx.fillRect(0, y, blackW, PIANO_LANE_H);
        }
        // Row separators only between two adjacent WHITE keys (E–F, B–C) — the
        // spots a real keyboard has no black key between, so the boundary needs
        // a drawn line to read as two distinct keys.
        if (!black && !isBlackKey(midi + 1) && midi < pianoRange.hi) {
            ctx.strokeStyle = '#9a9aac';
            ctx.lineWidth = 0.5;
            ctx.beginPath();
            ctx.moveTo(0, y + 0.5);
            ctx.lineTo(LABEL_W, y + 0.5);
            ctx.stroke();
        }
        // Label C rows with their octave (e.g. C4), on the white tail so it
        // stays legible whether or not the row is a black key.
        if (midi % 12 === 0 && PIANO_LANE_H >= 7) {
            ctx.fillStyle = '#3a3a4a';
            ctx.fillText(midiToNote(midi), LABEL_W - blackW + 2, y + PIANO_LANE_H / 2);
        }
    }
    // Front-edge divider so the keyboard reads as a panel distinct from the grid.
    ctx.strokeStyle = '#2a2a55';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(LABEL_W - 0.5, TIMELINE_TOP + WAVEFORM_H);
    ctx.lineTo(LABEL_W - 0.5, midiToY(pianoRange.lo) + PIANO_LANE_H);
    ctx.stroke();
}

export function drawNotes(w) {
    const nn = notes();
    const st = S.scrollX - 2;
    const et = S.scrollX + (w - LABEL_W) / S.zoom + 2;
    const keysMode = isKeysMode();
    // Hoist the active-highlight lookup out of the per-note loop: it reads
    // localStorage, so resolving it once per draw (not once per visible note)
    // keeps drawNotes off the synchronous-storage path during playback/scroll.
    const hl = _activeKeyHighlight();
    // Fretted lanes resolve notes to SOUNDING pitch (tuning + capo + fret) —
    // the whole context is hoisted here so _drawNote does zero per-note
    // arrangement work. `ghl` is null whenever the highlight can't apply.
    let ghl = null;
    if (hl && !keysMode) {
        const arr = S.arrangements[S.currentArr];
        if (arr) {
            const laneCount = _stringCountFor(arr);
            const tuning = (Array.isArray(arr.tuning) ? arr.tuning : []).slice(0, laneCount);
            while (tuning.length < laneCount) tuning.push(0);
            ghl = {
                hl,
                openMidi: _openMidiForArr(arr, laneCount),
                tuning,
                capo: Number(arr.capo) || 0,
            };
        }
    }
    // Fretted-in-roll draws at SOUNDING pitch — one hoisted context, and
    // the same mapping hit-testing/marquee use (they must never disagree).
    const rctx = keysMode ? _rollPitchCtx() : null;
    // Playability lint (P9): a memoized Set keyed on the edit generation —
    // hoisted so the per-note check is a Set.has, never a lint pass.
    const lintFlags = _lintFlaggedSet();
    // Slide/tie target lookup: resolved ONCE per frame here (keys mode never
    // draws these overlays), then threaded to each _drawNote so the per-note
    // draw stays an O(1) map read.
    const nextMap = keysMode ? null : _nextSameString(nn);
    for (let i = 0; i < nn.length; i++) {
        const n = nn[i];
        if (n.time + (n.sustain || 0) < st || n.time > et) continue;
        if (keysMode) {
            const midi = _rollMidiForNote(n, rctx);
            if (midi !== null) _drawPianoNote(n, S.sel.has(i), hl, midi, !!rctx, lintFlags.has(i));
        } else {
            _drawNote(n, S.sel.has(i), ghl, lintFlags.has(i), nextMap);
        }
    }

    // Keyboard-entry caret: in String view with nothing selected, preview the note
    // a typed fret will drop — its STRING (the lane the cell sits on), its LENGTH
    // (the box is the note value = the snap step, so it earns its note shape), and
    // the FRET it'll carry (a ghosted digit). ↑/↓ move the string, 0-9 place. A
    // view pref (host.editorEntryPreviewEnabled) — off if the box distracts.
    if (!keysMode && S.sel.size === 0
            && (!host.editorEntryPreviewEnabled || host.editorEntryPreviewEnabled())) {
        // Draw on the grid the typed note will actually LAND on: _editorPlaceAtCaret
        // places at snapTime(cursor), so after a free (Alt) scrub — or mid-playback —
        // the raw cursor sits off-grid and a box drawn there would promise a position
        // the note won't take. The cell must not lie about WHERE.
        const cx = timeToX(host.snapTime ? host.snapTime(S.cursorTime || 0) : (S.cursorTime || 0));
        const cy = strToY(S.caretString || 0) + NOTE_PAD;
        const ch = LANE_H - NOTE_PAD * 2;
        const step = host.editorSnapStepSeconds ? host.editorSnapStepSeconds() : 0;
        const cw = _caretCellWidthPure(step, S.zoom, MIN_NOTE_W);
        ctx.save();
        // Faint fill: the box is the note's FOOTPRINT (its length), not just an edge.
        ctx.fillStyle = '#38bdf822';
        ctx.fillRect(cx, cy, cw, ch);
        ctx.strokeStyle = '#38bdf8';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([3, 2]);
        ctx.strokeRect(cx, cy, cw, ch);
        ctx.setLineDash([]);
        // Ghost the fret it will carry (last placed), so you see WHICH note lands.
        const gf = Math.max(0, Math.min(24, Number(S.caretFret) || 0));
        ctx.fillStyle = '#7dd3fc';
        ctx.font = 'bold 13px monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        // Centred in the cell's FIRST MIN_NOTE_W (the cell is never narrower than
        // that), so the digit stays put as the box grows with the note value.
        ctx.fillText(String(gf), cx + MIN_NOTE_W / 2, cy + ch / 2);
        ctx.restore();
    }
}

/* @pure:technique-overlays:start */
// Screen points for a bend curve over a note. `pts` = bend_values [{t,v}] (t in
// 0..1 of the note span, v = semitones ≥ 0). Maps t across [x0, x0+w] and v
// UPWARD from yBase by up to `rise` px at the curve's max semitone. Returns
// [{x,y}] (≥2), or [] when there's nothing to draw.
export function _bendCurvePointsPure(pts, x0, w, yBase, rise) {
    const c = (Array.isArray(pts) ? pts : []).filter(p => p && Number.isFinite(p.t) && Number.isFinite(p.v));
    if (c.length < 2) return [];
    const maxV = Math.max(0.0001, ...c.map(p => Math.max(0, p.v)));
    return c.map(p => ({
        x: x0 + Math.max(0, Math.min(1, p.t)) * w,
        y: yBase - (Math.max(0, p.v) / maxV) * rise,
    }));
}

// Slide direction from a note at `fret` to `slideTo`: +1 up, -1 down, 0 none.
export function _slideDirPure(fret, slideTo) {
    if (!Number.isFinite(slideTo) || slideTo < 0 || !Number.isFinite(fret)) return 0;
    return slideTo > fret ? 1 : (slideTo < fret ? -1 : 0);
}

// Vibrato squiggle across [x0, x0+w] around yMid, amplitude `amp`, ~one cycle
// per `cycleW` px (min 2 cycles). Returns [{x,y}].
export function _vibratoPointsPure(x0, w, yMid, amp, cycleW) {
    if (!(w > 0)) return [];
    const cycles = Math.max(2, Math.round(w / Math.max(4, cycleW || 8)));
    const steps = cycles * 6;
    const out = [];
    for (let i = 0; i <= steps; i++) {
        const f = i / steps;
        out.push({ x: x0 + f * w, y: yMid + Math.sin(f * cycles * 2 * Math.PI) * amp });
    }
    return out;
}
/* @pure:technique-overlays:end */

/* @pure:tech-badges:start */
// Compact text badges for the techniques that have NO graphical overlay.
// Shared by String view (_drawNote) and the piano roll (_drawPianoNote) so the
// two views speak one technique vocabulary. Bend / vibrato / tie are excluded:
// String view draws them as graphics, and the roll appends its own compact
// glyphs (see _rollTechBadgesPure) for the two that can't fit a thin lane.
export function _techBadgesPure(techs) {
    const t = techs || {};
    const badges = [];
    if (t.hammer_on) badges.push('H');
    if (t.pull_off) badges.push('P');
    // Number.isFinite, not a bare `>= 0`: `null >= 0` and `false >= 0` are BOTH
    // true, so a cleared / imported-as-null slide field would badge as '/null'.
    // Same guard _slideDirPure uses, so the badge and the diagonal agree.
    if (Number.isFinite(t.slide_to) && t.slide_to >= 0) badges.push('/' + t.slide_to);
    if (Number.isFinite(t.slide_unpitch_to) && t.slide_unpitch_to >= 0) badges.push('↓' + t.slide_unpitch_to);
    if (t.harmonic) badges.push('*');
    if (t.harmonic_pinch) badges.push('*P');
    if (t.accent) badges.push('>');
    if (t.palm_mute) badges.push('PM');
    if (t.fret_hand_mute) badges.push('FM');
    if (t.tap) badges.push('T');
    if (t.slap) badges.push('S');
    if (t.pluck) badges.push('P!');
    if (t.tremolo) badges.push('~');
    if (t.mute) badges.push('x');
    if (t.ignore) badges.push('I');
    return badges;
}

// Roll-view technique markers: the shared badges, plus compact glyphs for the
// two overlay techniques a 4–14px lane can't draw as graphics (a bend curve or
// vibrato squiggle needs vertical room the roll hasn't got). Slide and tie DO
// fit a thin box, so the roll draws those as graphics like String view — slide
// keeps its '/N' badge (as in _drawNote), tie stays graphical-only.
export function _rollTechBadgesPure(techs) {
    const t = techs || {};
    const extra = [];
    const bend = Number(t.bend) || 0;
    if (bend > 0) extra.push('b' + bend);
    if (t.vibrato) extra.push('v');
    return extra.concat(_techBadgesPure(t));
}
/* @pure:tech-badges:end */

/* @pure:technique-connect:start */
// Next note on the SAME STRING, per note — the target a pitched slide lands
// on and the note a tie (link_next) legatos into. One reverse pass; returned
// as a Map keyed by note OBJECT so the draw loop (which has the note, not its
// index) reads it in O(1).
export function _nextSameStringMapPure(nn) {
    const map = new Map();
    const lastByString = new Map();
    // Order by CURRENT time, not array order: drag moves mutate n.time in
    // place without re-sorting the array (that identity-stability is the
    // draw-memo contract), so after a drag the array can be out of time
    // order and "next in the array" would link the wrong note.
    const byTime = (nn || []).filter(Boolean)
        .slice().sort((a, b) => (a.time - b.time) || (a.string - b.string));
    for (let i = byTime.length - 1; i >= 0; i--) {
        const n = byTime[i];
        const prev = lastByString.get(n.string);
        if (prev) map.set(n, prev);
        lastByString.set(n.string, n);
    }
    return map;
}

// A slide CONNECTS to the next same-string note only when that note is the
// slide's actual landing (its fret equals slide_to) — otherwise the target
// isn't charted and the within-note glyph stays (never draw a line to a note
// the gesture doesn't reach).
export function _slideConnectsPure(techs, next) {
    return !!(next && techs && Number.isFinite(techs.slide_to)
        && next.fret === techs.slide_to);
}
/* @pure:technique-connect:end */

// The per-frame lookup: memoized on editGen + the notes array identity (the
// standard draw-memo contract — in-place time moves keep identity, and every
// committed edit bumps the gen). Cost per frame after an edit: one O(n) pass.
// Called ONCE per frame by drawNotes and threaded to every _drawNote, so the
// move-drag bypass below stays O(n)/frame (not O(n²) via a per-note recompute).
let _nextStrMemo = { gen: -1, ref: null, map: null };
export function _nextSameString(nn) {
    // A live note-move drag mutates note time/string/fret in place every
    // mousemove and only commits (bumping editGen) on mouseUp — so the
    // editGen-keyed memo would serve the PRE-drag map for the whole drag,
    // defeating _nextSameStringMapPure's own time-order handling and linking
    // slides/ties to the wrong target until release. Bypass for the drag's
    // duration, exactly as _sectionCoverage does for the coverage strip.
    if (S.drag && S.drag.type === 'move') return _nextSameStringMapPure(nn);
    if (_nextStrMemo.gen === editGen && _nextStrMemo.ref === nn && _nextStrMemo.map) {
        return _nextStrMemo.map;
    }
    _nextStrMemo = { gen: editGen, ref: nn, map: _nextSameStringMapPure(nn) };
    return _nextStrMemo.map;
}

function _drawNote(n, selected, ghl, linted, nextMap) {
    const x = timeToX(n.time);
    const y = strToY(n.string) + NOTE_PAD;
    const sw = Math.max(MIN_NOTE_W, (n.sustain || 0) * S.zoom);
    const h = LANE_H - NOTE_PAD * 2;
    const color = colorForLane(strToLane(n.string));
    // Suggested (machine-picked, unconfirmed) position: render provisional —
    // dimmer body + dashed border — so an unresolved fingering reads at a glance.
    const suggested = _isSuggested(n);

    // In-key highlight (mirrors the piano roll's treatment): out-of-key
    // notes dim, never redden — chromaticism is not an error. Membership
    // uses the SOUNDING pitch (tuning + capo + fret); an unresolvable
    // pitch stays fully lit rather than falsely flagged.
    let outOfKey = false;
    let degMidi = null;   // sounding pitch, hoisted for the scale-degree overlay
    if (ghl) {
        degMidi = _soundingPitchPure(
            ghl.openMidi, ghl.tuning, ghl.capo, n.string, n.fret);
        outOfKey = degMidi !== null
            && !_pcInScalePure(((degMidi % 12) + 12) % 12, ghl.hl.tonic, ghl.hl.scale);
    }

    // Body
    ctx.fillStyle = color + (suggested || outOfKey ? '55' : 'cc');
    ctx.beginPath();
    ctx.roundRect(x, y, sw, h, 3);
    ctx.fill();

    // Border
    if (selected) {
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
    } else {
        ctx.strokeStyle = color;
        ctx.lineWidth = suggested ? 1 : 0.5;
    }
    if (suggested) ctx.setLineDash([3, 2]);
    ctx.beginPath();
    ctx.roundRect(x, y, sw, h, 3);
    ctx.stroke();
    if (suggested) ctx.setLineDash([]);

    // Playability-lint underline (P9): advisory amber, under the note.
    if (linted) {
        ctx.strokeStyle = '#f59e0b';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x + 1, y + h + 1.5);
        ctx.lineTo(x + Math.max(sw, MIN_NOTE_W) - 1, y + h + 1.5);
        ctx.stroke();
    }

    // Fret number
    ctx.fillStyle = outOfKey ? 'rgba(255,255,255,0.6)' : '#fff';
    ctx.font = 'bold 13px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(n.fret), x + Math.min(sw, MIN_NOTE_W) / 2, y + h / 2);

    // Scale-degree overlay (only when the key highlight is active): a small
    // degree label in the note's top-right, coloured by role so the 1/3/5/7
    // skeleton pops. Out-of-key notes still show their chromatic degree,
    // dimmed — so a fretted line reads as scale degrees at a glance. Skipped
    // when the sounding pitch is unresolvable (degMidi null).
    if (ghl && degMidi !== null) {
        const semis = _scaleDegreeSemisPure(((degMidi % 12) + 12) % 12, ghl.hl.tonic);
        if (semis >= 0) {
            ctx.fillStyle = _scaleDegreeColorPure(semis) + (outOfKey ? '99' : 'ff');
            ctx.font = '7px monospace';
            ctx.textAlign = 'right';
            ctx.textBaseline = 'top';
            ctx.fillText(_SCALE_DEGREE_LABELS[semis], x + Math.min(sw, MIN_NOTE_W) - 2, y + 1);
        }
    }

    const techs = n.techniques || {};

    // ── Graphical technique overlays (draw the technique, not just a letter) ──
    const _ovW = Math.max(sw, MIN_NOTE_W);
    // Bend: the authored curve (bend_values), or a synthesized 0→bend→hold when
    // only the semitone amount is set. Rises in amber from the note's baseline
    // with an arrowhead at the peak — the tab-notation bend read at a glance.
    const _bendSemis = Number(techs.bend) || 0;
    if (_bendSemis > 0) {
        let bnv = sanitizeBendCurve(techs.bend_values);
        if (!bnv || bnv.length < 2) bnv = [{ t: 0, v: 0 }, { t: 0.35, v: _bendSemis }, { t: 1, v: _bendSemis }];
        const cp = _bendCurvePointsPure(bnv, x, _ovW, y + h, Math.min(h * 1.3, LANE_H * 0.7));
        if (cp.length >= 2) {
            ctx.strokeStyle = '#fbbf24';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(cp[0].x, cp[0].y);
            for (let i = 1; i < cp.length; i++) ctx.lineTo(cp[i].x, cp[i].y);
            ctx.stroke();
            const pk = cp[cp.length - 1];
            ctx.fillStyle = '#fbbf24';
            ctx.beginPath();
            ctx.moveTo(pk.x, pk.y - 3); ctx.lineTo(pk.x - 3, pk.y + 2); ctx.lineTo(pk.x + 3, pk.y + 2);
            ctx.closePath(); ctx.fill();
        }
    }
    // Slide: a diagonal sloping up or down toward the target. When the NEXT
    // note on this string IS the slide's landing (fret === slide_to), the
    // diagonal reaches all the way to that note's head — the gesture visibly
    // connects to where it lands. No charted landing → the within-note glyph.
    const _sdir = _slideDirPure(n.fret, techs.slide_to);
    if (_sdir !== 0) {
        const _next = nextMap.get(n);
        const _endX = _slideConnectsPure(techs, _next)
            ? Math.max(x + _ovW - 1, timeToX(_next.time) - 1)
            : x + _ovW - 1;
        ctx.strokeStyle = '#93c5fd';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(x + 1, _sdir > 0 ? y + h - 1 : y + 1);
        ctx.lineTo(_endX, _sdir > 0 ? y + 1 : y + h - 1);
        ctx.stroke();
    }
    // Vibrato: a small squiggle just above the note.
    if (techs.vibrato) {
        const vp = _vibratoPointsPure(x, _ovW, y - 2, 2, 8);
        if (vp.length) {
            ctx.strokeStyle = '#c4b5fd';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(vp[0].x, vp[0].y);
            for (let i = 1; i < vp.length; i++) ctx.lineTo(vp[i].x, vp[i].y);
            ctx.stroke();
        }
    }
    // Tie (link_next): a legato arc from this note's tail to the LINKED
    // note's head — the two notes visibly belong to one gesture. With no
    // next note on the string (or an overlap), the old trailing hook stays.
    if (techs.link_next) {
        ctx.strokeStyle = '#a7f3d0';
        ctx.lineWidth = 1.5;
        const _next = nextMap.get(n);
        const _headX = _next ? timeToX(_next.time) : -1;
        ctx.beginPath();
        if (_next && _headX > x + _ovW + 2) {
            const midX = (x + _ovW + _headX) / 2;
            ctx.moveTo(x + _ovW, y + h / 2);
            ctx.quadraticCurveTo(midX, y - 3, _headX, y + h / 2);
        } else {
            ctx.arc(x + _ovW, y + h / 2, 4, -Math.PI / 2, Math.PI / 2);
        }
        ctx.stroke();
    }

    // Technique badges (for the techniques with no graphical overlay above).
    const badges = _techBadgesPure(techs);
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

function _drawPianoNote(n, selected, hl, midi, fretted, linted) {
    // `midi` is resolved by the caller through _rollMidiForNote — keys
    // packing or fretted sounding pitch — so this renderer never guesses.
    if (midi === undefined) midi = noteToMidi(n.string, n.fret);
    if (midi < pianoRange.lo || midi > pianoRange.hi) return;

    const x = timeToX(n.time);
    const y = midiToY(midi) + 1;
    const sw = Math.max(MIN_NOTE_W, (n.sustain || 0) * S.zoom);
    const h = PIANO_LANE_H - 2;
    const octave = Math.floor(midi / 12);
    // Fretted-in-roll notes wear their STRING's lane color, not the octave
    // color: the Y axis already says the pitch, so the color's job is to
    // say WHERE the pitch is played — which is exactly what the Shift+↑/↓
    // position cycle changes, making a cycle step visible as a color flip
    // at a fixed Y (VA.5).
    // Keys notes with an authored hand wear the HAND color when hand
    // shading is on (same argument: Y already says the pitch, so color's
    // job is WHO PLAYS IT — LH warm, RH cool). Unassigned notes keep the
    // octave palette, so unassigned reads as "no call made", never a lie.
    const _hand = !fretted && _editorHandShadingEnabled()
        ? (n.techniques && n.techniques.hand) : null;
    const color = fretted
        ? colorForLane(strToLane(n.string))
        : _hand === 'lh' ? HAND_LH_COLOR
        : _hand === 'rh' ? HAND_RH_COLOR
        : PIANO_OCTAVE_COLORS[Math.min(octave, PIANO_OCTAVE_COLORS.length - 1)];
    // Suggested (machine-picked, unconfirmed) position — render provisional
    // (dimmer + dashed). Only fretted-in-roll adds are ever marked.
    const suggested = _isSuggested(n);

    // In-key highlight: dim out-of-key notes (lower body alpha) so chromatic
    // notes read as chromatic without being hidden or flagged as wrong.
    // `hl` is resolved once per draw in drawNotes (see hoist there) and passed
    // in, so this path never reads localStorage per note.
    const outOfKey = !!hl && !_pcInScalePure(midi % 12, hl.tonic, hl.scale);

    // Body
    ctx.fillStyle = color + (suggested || outOfKey ? '55' : 'cc');
    ctx.beginPath();
    ctx.roundRect(x, y, sw, h, 2);
    ctx.fill();

    // Border
    if (selected) {
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
    } else {
        ctx.strokeStyle = color;
        ctx.lineWidth = suggested ? 1 : 0.5;
    }
    if (suggested) ctx.setLineDash([3, 2]);
    ctx.beginPath();
    ctx.roundRect(x, y, sw, h, 2);
    ctx.stroke();
    if (suggested) ctx.setLineDash([]);

    // Playability-lint underline (P9) — same advisory treatment as String view.
    if (linted) {
        ctx.strokeStyle = '#f59e0b';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x + 1, y + h + 1);
        ctx.lineTo(x + Math.max(sw, MIN_NOTE_W) - 1, y + h + 1);
        ctx.stroke();
    }

    // Note name — or, for fretted-in-roll, the s·f position chip (the
    // note name is redundant with the Y axis there; string·fret is the
    // one fact the roll would otherwise hide). Raw string index, matching
    // the Strings modal's "String N" labels.
    const labelled = sw >= 20 && h >= 8;
    if (labelled) {
        ctx.fillStyle = '#000';
        ctx.font = `bold ${Math.min(9, h - 1)}px monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const label = fretted ? (n.string + '·' + n.fret) : midiToNote(midi, editorKeyNoteNames());
        ctx.fillText(label, x + Math.min(sw, 24) / 2, y + h / 2);
    }

    // ── Technique indication (roll view) ──────────────────────────────────
    // The dense roll (4–14px lanes) can't fit String view's tall bend curve or
    // above-note vibrato squiggle, so techniques read as a compact badge string
    // — set just past the centred name/position label — plus the
    // two overlays that DO fit a thin box: the slide diagonal and the legato
    // tie hook. On a lane too short for text, a 2px corner dot still marks that
    // the note carries techniques, so nothing is ever fully invisible.
    const techs = n.techniques || {};

    // Slide: a diagonal across the note toward the target fret.
    const _sdir = _slideDirPure(n.fret, techs.slide_to);
    if (_sdir !== 0) {
        ctx.strokeStyle = '#93c5fd';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(x + 1, _sdir > 0 ? y + h - 1 : y + 1);
        ctx.lineTo(x + sw - 1, _sdir > 0 ? y + 1 : y + h - 1);
        ctx.stroke();
    }
    // Tie (link_next): a small legato hook off the trailing edge.
    if (techs.link_next) {
        ctx.strokeStyle = '#a7f3d0';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(x + sw, y + h / 2, Math.min(4, h), -Math.PI / 2, Math.PI / 2);
        ctx.stroke();
    }
    // Badges (every remaining technique, incl. compact bend / vibrato glyphs).
    const badges = _rollTechBadgesPure(techs);
    if (badges.length) {
        if (h >= 7) {
            // Anchored to the note HEAD, just past the centred label when one is
            // drawn — NOT to the note's right edge. A note is culled by its
            // START, so a long sustain's right edge sits arbitrarily far off
            // screen: a right-edge anchor would hide the badges on exactly the
            // notes the roll draws widest, and float them seconds away from the
            // onset the technique belongs to.
            ctx.fillStyle = '#ffffffdd';
            ctx.font = '7px monospace';
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            ctx.fillText(badges.join(' '), labelled ? x + Math.min(sw, 24) + 2 : x + 2, y + h / 2);
        } else {
            // Too short for text — a presence dot in the top-left corner.
            ctx.fillStyle = '#fde68a';
            ctx.fillRect(x + 1, y + 1, 2, 2);
        }
    }
}

// The note-entry caret's width in px: the note VALUE (snap step, seconds) at the
// current zoom, floored to a visible minimum so the cell always shows even at
// tiny steps / low zoom. A step of 0 (no grid) → the minimum. Pure.
export function _caretCellWidthPure(stepSec, zoom, minW) {
    const mw = Number(minW) || 0;
    const w = (Number(stepSec) > 0 && Number(zoom) > 0) ? stepSec * zoom : 0;
    return Math.max(mw, w);
}

export function drawCursor(w, h) {
    // While playing, paint the playhead at the OUTPUT-latency-compensated time
    // (S.cursorDrawTime) so the line sits on the audio actually leaving the
    // speaker, not the buffered-ahead schedule — the marker matches what's heard
    // (crucial on Bluetooth). Stopped/scrubbing falls back to S.cursorTime, which
    // is exact on the waveform for note placement. Render-only: every logic path
    // (snap, edit, seek, follow-scroll) reads S.cursorTime, never this.
    const ct = (S.playing && Number.isFinite(S.cursorDrawTime)) ? S.cursorDrawTime : S.cursorTime;
    const x = timeToX(ct);
    if (x < LABEL_W || x > w) return;
    ctx.strokeStyle = '#ff4444';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    // Starts below the minimap: everything from the ruler down shares the
    // chart's time⇄x space; the minimap is whole-song scale and paints its
    // own playhead tick.
    ctx.moveTo(x, MINIMAP_H);
    // Extend the playhead through every time-axis-aligned strip
    // (waveform, tone lane, lanes, beat bar, anchor lane). `canvasH()`
    // stops at the beat-bar bottom, which would clip the cursor above
    // the anchor lane.
    ctx.lineTo(x, h);
    ctx.stroke();
}

export function drawSelectionRect() {
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

function canvasH()   {
    return _beatBarTopY();
}
