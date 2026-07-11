/* Slopsmith Arrangement Editor — the fretboard companion strip
 * (view-modality P7 / VA.6, design V13.2 ★).
 *
 * A docked, collapsible mini-fretboard under the timeline for the ACTIVE
 * fretted part: tuning / string count / capo drawn from the arrangement
 * (capo as a visual nut-bar — chart frets index right of it). Selecting
 * note(s) lights every same-pitch candidate position from the P6 resolver's
 * enumeration, annotated: bright inside the active anchor window / dim
 * outside, open-string candidates drawn square, and a small stretch-cost
 * digit (fret travel vs the previous note's hand position). Click a
 * candidate → assigns it through the SAME command path as P5 cycling
 * (`MoveToStringCmd`, pitch-preserving — which also clears the suggested
 * mark, undo re-marks). Right-click a lit position cycles the
 * `fret_finger` teaching mark (1-4 · T · none) via `SetTeachingMarkCmd`.
 *
 * The render/hit-test idiom (xLine/xNote/rowY geometry, windowed frets,
 * capped fret spacing, inlay dots, hollow-vs-filled note dots) is ported
 * from Virtuoso's Live fretboard strip (screen.js §13) with Christian's
 * blessing — read for the port, never modified. The editor owns ALL
 * candidate/annotation logic (position.js pures).
 *
 * Perf: a DOM/canvas SIDECAR, never part of the main draw loop — it
 * repaints only when the selection or an edit changes it (memo on editGen +
 * a selection snapshot), plus its own interactions. Inert (bare neck) with
 * no selection; hidden entirely on keys parts, drum mode, tempo-map mode
 * and the parts overview.
 *
 * Handshape-template lighting (the P7 follow-up): when the selection sits
 * inside an authored handshape span, the covered chord template's shape
 * renders as GHOST dots under the candidate lights (chord sky / arpeggio
 * violet, finger digits when the template carries them, label top-right) —
 * the "hold this shape" context behind the per-note candidates. Advisory
 * display only: ghosts aren't hit-testable and never dispatch.
 */

import { S, editGen } from './state.js';
import { host } from './host.js';
import { setStatus } from './ui.js';
import { notes, _isSuggested } from './notes.js';
import { isKeysArr } from './keys.js';
import { _stringCountFor, _openMidiForArr } from './lanes.js';
import { _enumerateFrettedPositionsPure, _activeAnchorAtPure } from './position.js';
import {
    MoveToStringCmd, SetTeachingMarkCmd, _prevNoteBefore, _rollAnchorList,
} from './commands.js';
import { _noteNamesForKeyPure } from './theory.js';

/* @pure:fretboard-strip:start */

// Per-string colors, low string (index 0) first — the same rainbow-order
// convention as Virtuoso's strip, so players moving between the two read
// string identity the same way.
export const STRIP_STRING_COLORS = Object.freeze([
    '#e74c3c', '#f39c12', '#2ecc71', '#3498db', '#9b59b6', '#e91e63',
    '#1abc9c', '#f1c40f', '#95a5a6', '#7f8c8d',
]);

// The fret_finger teaching-mark cycle for right-click: none → 1..4 → T → none
// (-1 = unset, 0 = thumb, 1-4 = fingers — the inspector's encoding).
export function _stripFingerCyclePure(cur) {
    const order = [-1, 1, 2, 3, 4, 0];
    const i = order.indexOf(Number.isInteger(cur) ? cur : -1);
    return order[(i < 0 ? 0 : i + 1) % order.length];
}
export const FINGER_LABELS = Object.freeze({ 0: 'T', 1: '1', 2: '2', 3: '3', 4: '4' });

// Annotate the selection's candidate positions for the strip.
//   sel:  [{ idx, string, fret, time, techniques }]  (the selected notes)
//   ctx:  { openMidi, tuning, capo, anchors }        (the active arrangement)
//   prevFretAt(time, exceptIdx) → the previous note's fret or null
// Returns one entry per (selected note × candidate):
//   { noteIdx, string, fret,        — the CHART position this entry represents
//     current,                      — true for the note's own position
//     inWindow,                     — open or inside the active anchor window
//     open,                         — fret === 0 (an open/capo'd-open string)
//     stretch,                      — |fret − prevFret|, null with no prev
//     finger }                      — the note's fret_finger mark (current only)
export function _stripAnnotationsPure(sel, ctx, prevFretAt) {
    const out = [];
    if (!Array.isArray(sel) || !ctx || !Array.isArray(ctx.openMidi)) return out;
    const capo = Number(ctx.capo) || 0;
    const off = (s) => (Array.isArray(ctx.tuning) && ctx.tuning[s] !== undefined)
        ? (Number(ctx.tuning[s]) || 0) : 0;
    for (const n of sel) {
        if (!n || !Number.isInteger(n.string) || !Number.isInteger(n.fret)) continue;
        if (ctx.openMidi[n.string] === undefined) continue;
        const pitch = ctx.openMidi[n.string] + off(n.string) + capo + n.fret;
        const anchor = _activeAnchorAtPure(ctx.anchors, n.time);
        const lo = anchor && Number.isFinite(anchor.fret) ? anchor.fret : null;
        const hi = lo !== null ? lo + (Number.isFinite(anchor.width) ? anchor.width : 4) : null;
        const prevFret = typeof prevFretAt === 'function' ? prevFretAt(n.time, n.idx) : null;
        for (const c of _enumerateFrettedPositionsPure(pitch, ctx.openMidi, ctx.tuning, capo)) {
            const current = c.string === n.string && c.fret === n.fret;
            out.push({
                noteIdx: n.idx,
                string: c.string,
                fret: c.fret,
                current,
                open: c.fret === 0,
                inWindow: c.fret === 0 || lo === null || (c.fret >= lo && c.fret < hi),
                stretch: !current && Number.isFinite(prevFret) ? Math.abs(c.fret - prevFret) : null,
                finger: current && n.techniques && Number.isInteger(n.techniques.fret_finger)
                    ? n.techniques.fret_finger : null,
            });
        }
    }
    return out;
}

// The handshape template covering time `t` on this arrangement, resolved to
// a drawable shape — { dots: [{string, fret, finger}], arp, label } — or null
// when no span covers `t`, the chord_id dangles, or the template has no
// played strings. Chart frets (capo-relative), same space as annotations.
// Nested/overlapping spans: the latest-starting (innermost) span wins, the
// same shape the player is holding NOW. Strings at/above L are dropped (GP
// templates arrive padded to 6 on narrower charts).
export function _stripHandshapeShapePure(arr, t, L) {
    if (!arr || !Array.isArray(arr.handshapes) || !Number.isFinite(t)) return null;
    const EPS = 1e-6;
    let hs = null;
    for (const h of arr.handshapes) {
        if (!h || !Number.isFinite(h.start_time) || !Number.isFinite(h.end_time)) continue;
        if (t < h.start_time - EPS || t > h.end_time + EPS) continue;
        if (!hs || h.start_time > hs.start_time) hs = h;
    }
    if (!hs) return null;
    const ct = Array.isArray(arr.chord_templates) ? arr.chord_templates[hs.chord_id] : null;
    if (!ct || !Array.isArray(ct.frets)) return null;
    const n = Number.isFinite(L) && L > 0 ? Math.min(L, ct.frets.length) : ct.frets.length;
    const dots = [];
    for (let s = 0; s < n; s++) {
        const f = ct.frets[s];
        if (!Number.isFinite(f) || f < 0) continue;
        const fg = Array.isArray(ct.fingers) && Number.isFinite(ct.fingers[s]) && ct.fingers[s] >= 0
            ? ct.fingers[s] : null;
        dots.push({ string: s, fret: f, finger: fg });
    }
    if (!dots.length) return null;
    const label = (typeof ct.displayName === 'string' && ct.displayName)
        || (typeof ct.name === 'string' && ct.name)
        || (hs.arp ? 'arp' : 'shape');
    return { dots, arp: !!hs.arp, label };
}

// The display window in PHYSICAL frets: always show the nut and capo region,
// stretch to cover every annotation (chart fret + capo), keep a workable
// minimum span, never past fret 24.
export function _stripFretWindowPure(annotations, capo, minSpan = 12) {
    const cap = Math.max(0, Number(capo) || 0);
    let hi = cap + minSpan;
    for (const a of annotations || []) {
        const phys = cap + a.fret;
        if (phys + 1 > hi) hi = phys + 1;
    }
    return { lo: 0, hi: Math.min(24, Math.max(hi, minSpan)) };
}

export function _stripDisplayWindowPure(annotations, shape, capo) {
    const dots = shape && Array.isArray(shape.dots) ? shape.dots : [];
    return _stripFretWindowPure((annotations || []).concat(dots), capo);
}

// Strip geometry (the Virtuoso §13 parametrization): map physical fret /
// string index to canvas x/y, capped per-fret spacing, low string at the
// bottom. Pure so the hit-test can share it with the renderer.
export function _stripGeometryPure(W, H, nStrings, lo, hi) {
    const padL = 34, padR = 12, padT = 10, padB = 16;
    const nSpaces = Math.max(1, hi - lo);
    const usableW = Math.max(1, W - padL - padR);
    const spaceW = Math.min(usableW / nSpaces, 72);
    const x0 = padL + Math.max(0, (usableW - spaceW * nSpaces) / 2);
    const rowH = (H - padT - padB) / Math.max(1, nStrings - 1);
    return {
        padT, rowH, x0, spaceW, lo, hi, nStrings,
        xLine: (f) => x0 + (f - lo) * spaceW,
        // Notehead x: open notes sit just right of the nut line; fretted notes
        // centered in their fret space.
        xNote: (f) => f <= lo ? x0 + 4 : x0 + (f - lo - 0.5) * spaceW,
        rowY: (s) => padT + (nStrings - 1 - s) * rowH,
    };
}

// Nearest annotation to a canvas point, within `radius` px. Works in
// PHYSICAL fret space (capo passed in), same mapping as the renderer —
// including the open-candidate placement just right of the capo bar, so a
// click lands exactly where the square is drawn.
export function _stripHitTestPure(x, y, geom, annotations, capo, radius = 11) {
    let best = null, bestD = radius * radius;
    const cap = Math.max(0, Number(capo) || 0);
    for (const a of annotations || []) {
        const ax = (a.open && cap > 0) ? geom.xLine(cap) + 9 : geom.xNote(cap + a.fret);
        const ay = geom.rowY(a.string);
        const d = (x - ax) * (x - ax) + (y - ay) * (y - ay);
        if (d <= bestD) { best = a; bestD = d; }
    }
    return best;
}
/* @pure:fretboard-strip:end */

const PREF_KEY = 'editorFretboardStrip';
const DOT_FRETS = [3, 5, 7, 9, 12, 15, 17, 19, 21, 24];
const DOUBLE_DOT = [12, 24];

let stripCtx = null;
let lastKey = '';          // memo: (editGen, arr, selection, size) render key

const $strip = () => document.getElementById('editor-fretboard-strip');
const $canvas = () => document.getElementById('editor-fretboard-canvas');

export function fretboardStripEnabled() {
    try { return localStorage.getItem(PREF_KEY) === '1'; } catch (_) { return false; }
}

// The active arrangement's strip context, or null when the strip has no
// business rendering (keys part, drum mode, overview, tempo map, no song).
function stripArrCtx() {
    if (S.drumEditMode || S.tempoMapMode || S.partsViewMode) return null;
    const arr = S.arrangements && S.arrangements[S.currentArr];
    if (!arr || isKeysArr()) return null;
    const laneCount = _stringCountFor(arr);
    const rawTuning = Array.isArray(arr.tuning) ? arr.tuning : [];
    const tuning = rawTuning.slice(0, laneCount);
    while (tuning.length < laneCount) tuning.push(0);
    return {
        arr, laneCount, tuning,
        openMidi: _openMidiForArr(arr, laneCount),
        capo: Number(arr.capo) || 0,
        anchors: _rollAnchorList(arr),
    };
}

function selectedNotes() {
    const nn = notes();
    const out = [];
    for (const idx of S.sel) {
        const n = nn[idx];
        if (n) out.push({ idx, string: n.string, fret: n.fret, time: n.time, techniques: n.techniques });
    }
    return out;
}

function currentAnnotations(ctx) {
    return _stripAnnotationsPure(
        selectedNotes(), ctx,
        (time, exceptIdx) => {
            const p = _prevNoteBefore(ctx.arr, time, exceptIdx);
            return p && Number.isFinite(p.fret) ? p.fret : null;
        });
}

// ── Render ───────────────────────────────────────────────────────────

function draw() {
    const canvas = $canvas();
    const ctx2 = stripCtx;
    const actx = stripArrCtx();
    if (!canvas || !ctx2 || !actx) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    if (rect.width < 4 || rect.height < 4) return;
    const pxW = Math.max(1, Math.floor(rect.width * dpr));
    const pxH = Math.max(1, Math.floor(rect.height * dpr));
    if (canvas.width !== pxW || canvas.height !== pxH) { canvas.width = pxW; canvas.height = pxH; }
    ctx2.setTransform(dpr, 0, 0, dpr, 0, 0);
    const W = rect.width, H = rect.height;
    ctx2.fillStyle = 'rgba(8,10,18,0.94)';
    ctx2.fillRect(0, 0, W, H);

    const ann = currentAnnotations(actx);
    // Handshape-template lighting: the shape covering the selection's earliest
    // time, if any. Its dots widen the fret window so a shape up the neck
    // can't clip off the right edge.
    const selT = ann.length ? Math.min(...selectedNotes().map((n) => n.time)) : null;
    const shape = selT === null ? null : _stripHandshapeShapePure(actx.arr, selT, actx.laneCount);
    const { lo, hi } = _stripDisplayWindowPure(ann, shape, actx.capo);
    const g = _stripGeometryPure(W, H, actx.laneCount, lo, hi);

    // Fret lines + nut.
    for (let f = lo; f <= hi; f++) {
        const x = g.xLine(f);
        ctx2.strokeStyle = f === 0 ? '#555' : '#23233a';
        ctx2.lineWidth = f === 0 ? 3 : 1;
        ctx2.beginPath(); ctx2.moveTo(x, g.rowY(actx.laneCount - 1)); ctx2.lineTo(x, g.rowY(0)); ctx2.stroke();
    }
    // Inlay dots.
    ctx2.fillStyle = '#1a1a30';
    const midRow = (actx.laneCount - 1) / 2;
    for (const f of DOT_FRETS) {
        if (f <= lo || f > hi) continue;
        const x = g.xLine(f - 0.5);
        const rows = DOUBLE_DOT.includes(f) ? [midRow - 1, midRow + 1] : [midRow];
        for (const r of rows) {
            ctx2.beginPath(); ctx2.arc(x, g.padT + r * g.rowH, 4, 0, 6.2832); ctx2.fill();
        }
    }
    // Capo as a visual nut-bar: chart frets index right of it.
    if (actx.capo > 0 && actx.capo >= lo && actx.capo <= hi) {
        const x = g.xLine(actx.capo);
        ctx2.strokeStyle = '#f59e0b'; ctx2.lineWidth = 5; ctx2.globalAlpha = 0.85;
        ctx2.beginPath(); ctx2.moveTo(x, g.rowY(actx.laneCount - 1) - 4); ctx2.lineTo(x, g.rowY(0) + 4); ctx2.stroke();
        ctx2.globalAlpha = 1;
        ctx2.fillStyle = '#f59e0b'; ctx2.font = '700 7px sans-serif'; ctx2.textAlign = 'center'; ctx2.textBaseline = 'top';
        ctx2.fillText('CAPO', x, g.rowY(0) + 4);
    }
    // Strings + sounding-open labels (tuning + capo aware). Spell them the
    // way the song key does, same as the roll — Eb, not D#, in a flat key.
    ctx2.font = 'bold 10px sans-serif'; ctx2.textBaseline = 'middle';
    const openNames = _noteNamesForKeyPure(S.editorKey);
    for (let s = 0; s < actx.laneCount; s++) {
        const y = g.rowY(s);
        const col = STRIP_STRING_COLORS[s % STRIP_STRING_COLORS.length];
        ctx2.strokeStyle = col; ctx2.globalAlpha = 0.4;
        ctx2.lineWidth = 1 + (actx.laneCount - 1 - s) * 0.25;
        ctx2.beginPath(); ctx2.moveTo(g.xLine(lo), y); ctx2.lineTo(g.xLine(hi), y); ctx2.stroke();
        ctx2.globalAlpha = 1; ctx2.fillStyle = col; ctx2.textAlign = 'right';
        const openPitch = (actx.openMidi[s] || 0) + (actx.tuning[s] || 0) + actx.capo;
        ctx2.fillText(openNames[((openPitch % 12) + 12) % 12], g.xLine(lo) - 6, y);
    }
    // Fret numbers.
    ctx2.fillStyle = '#4a4a5a'; ctx2.font = '9px sans-serif'; ctx2.textAlign = 'center'; ctx2.textBaseline = 'top';
    for (let f = lo + 1; f <= hi; f++) ctx2.fillText(String(f), g.xLine(f - 0.5), g.rowY(0) + 4);

    // Anchor-window box for the selection's time (the home-box idiom).
    if (ann.length) {
        const t0 = selT;
        const anchor = _activeAnchorAtPure(actx.anchors, t0);
        if (anchor && Number.isFinite(anchor.fret) && anchor.fret > 0) {
            const w = Number.isFinite(anchor.width) ? anchor.width : 4;
            const x0 = g.xNote(actx.capo + anchor.fret) - 10;
            const x1 = g.xNote(actx.capo + anchor.fret + w - 1) + 10;
            const yTop = Math.min(g.rowY(0), g.rowY(actx.laneCount - 1)) - 8;
            const yH = Math.abs(g.rowY(0) - g.rowY(actx.laneCount - 1)) + 16;
            ctx2.globalAlpha = 0.06; ctx2.fillStyle = '#60a5fa';
            ctx2.fillRect(x0, yTop, x1 - x0, yH);
            ctx2.globalAlpha = 0.3; ctx2.setLineDash([4, 3]); ctx2.lineWidth = 1; ctx2.strokeStyle = '#60a5fa';
            ctx2.strokeRect(x0, yTop, x1 - x0, yH);
            ctx2.setLineDash([]); ctx2.globalAlpha = 1;
        }
    }

    // Handshape-template ghosts UNDER the candidate lights: hollow rounded
    // squares in the framing color (chord sky / arpeggio violet), finger
    // digit inside when the template carries one, label top-right. Advisory
    // only — never hit-testable, never dispatches.
    if (shape) {
        const shapeCol = shape.arp ? '#7c3aed' : '#0ea5e9';
        ctx2.lineWidth = 1.5;
        for (const d of shape.dots) {
            const x = (d.fret === 0 && actx.capo > 0) ? g.xLine(actx.capo) + 9 : g.xNote(actx.capo + d.fret);
            const y = g.rowY(d.string);
            ctx2.globalAlpha = 0.55;
            ctx2.strokeStyle = shapeCol;
            ctx2.strokeRect(x - 6, y - 6, 12, 12);
            if (d.finger !== null && FINGER_LABELS[d.finger] !== undefined) {
                ctx2.fillStyle = shapeCol;
                ctx2.font = 'bold 8px monospace';
                ctx2.textAlign = 'center';
                ctx2.textBaseline = 'middle';
                ctx2.fillText(FINGER_LABELS[d.finger], x, y);
            }
        }
        ctx2.globalAlpha = 0.8;
        ctx2.fillStyle = shapeCol;
        ctx2.font = 'bold 9px sans-serif';
        ctx2.textAlign = 'right';
        ctx2.textBaseline = 'top';
        ctx2.fillText(shape.label + (shape.arp ? ' (arp)' : ''), W - 12, 2);
        ctx2.globalAlpha = 1;
    }

    // Candidates + current positions. Open positions (current AND candidate)
    // sit just right of the effective nut — the ONE rule the hit-test uses,
    // so a selected capo'd open string draws where right-click finds it.
    for (const a of ann) {
        const x = (a.open && actx.capo > 0) ? g.xLine(actx.capo) + 9 : g.xNote(actx.capo + a.fret);
        const y = g.rowY(a.string);
        const col = STRIP_STRING_COLORS[a.string % STRIP_STRING_COLORS.length];
        ctx2.globalAlpha = a.inWindow ? 0.95 : 0.35;
        if (a.current) {
            ctx2.fillStyle = col;
            ctx2.beginPath(); ctx2.arc(x, y, 7, 0, 6.2832); ctx2.fill();
            const label = a.finger !== null && FINGER_LABELS[a.finger] !== undefined
                ? FINGER_LABELS[a.finger] : String(a.fret);
            ctx2.fillStyle = '#0b0b10'; ctx2.font = '700 8px sans-serif';
            ctx2.textAlign = 'center'; ctx2.textBaseline = 'middle';
            ctx2.fillText(label, x, y);
        } else if (a.open) {
            // Open-string candidates read differently: a square (x already
            // sits at the effective nut via the shared placement above).
            ctx2.strokeStyle = col; ctx2.lineWidth = 1.8;
            ctx2.strokeRect(x - 5, y - 5, 10, 10);
        } else {
            ctx2.strokeStyle = col; ctx2.lineWidth = 1.8;
            ctx2.beginPath(); ctx2.arc(x, y, 7, 0, 6.2832); ctx2.stroke();
            if (a.stretch !== null && a.stretch > 0 && g.spaceW >= 22) {
                ctx2.fillStyle = col; ctx2.font = '700 7px sans-serif';
                ctx2.textAlign = 'center'; ctx2.textBaseline = 'middle';
                ctx2.fillText(String(a.stretch), x + 10, y - 8);
            }
        }
        ctx2.globalAlpha = 1;
    }
}

// ── Refresh (memoized — the sidecar never rides the draw loop) ───────

export function _fretboardStripRefresh() {
    const strip = $strip();
    if (!strip) return;
    const actx = stripArrCtx();
    const want = fretboardStripEnabled() && !!actx;
    if (strip.classList.contains('hidden') !== !want) strip.classList.toggle('hidden', !want);
    _refreshToggleBtn(!!actx);
    if (!want) { lastKey = ''; return; }
    const canvas = $canvas();
    const key = [
        typeof editGen === 'number' ? editGen : 0,
        S.currentArr,
        [...S.sel].sort((a, b) => a - b).join(','),
        canvas ? `${canvas.clientWidth}x${canvas.clientHeight}` : '',
        actx.capo, actx.laneCount,
    ].join('|');
    if (key === lastKey) return;
    lastKey = key;
    draw();
}

function _refreshToggleBtn(available) {
    const btn = document.getElementById('editor-fretboard-btn');
    if (!btn) return;
    const pressed = fretboardStripEnabled() ? 'true' : 'false';
    if (btn.getAttribute('aria-pressed') !== pressed) btn.setAttribute('aria-pressed', pressed);
    if (btn.disabled !== !available) btn.disabled = !available;
}

export function editorToggleFretboardStrip() {
    const next = !fretboardStripEnabled();
    try { localStorage.setItem(PREF_KEY, next ? '1' : '0'); } catch (_) {}
    if (next && !stripArrCtx()) {
        setStatus('Fretboard strip shows for fretted parts (not keys or drums)');
    } else {
        setStatus(next
            ? 'Fretboard strip on — select notes to light their playable positions; click one to assign it'
            : 'Fretboard strip off');
    }
    lastKey = '';
    _fretboardStripRefresh();
    return true;
}

// ── Interactions ─────────────────────────────────────────────────────

function hitAt(e) {
    const canvas = $canvas();
    const actx = stripArrCtx();
    if (!canvas || !actx) return null;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left, y = e.clientY - rect.top;
    const ann = currentAnnotations(actx);
    if (!ann.length) return null;
    const selT = Math.min(...selectedNotes().map((n) => n.time));
    const shape = _stripHandshapeShapePure(actx.arr, selT, actx.laneCount);
    const { lo, hi } = _stripDisplayWindowPure(ann, shape, actx.capo);
    const g = _stripGeometryPure(rect.width, rect.height, actx.laneCount, lo, hi);
    return { hit: _stripHitTestPure(x, y, g, ann, actx.capo), actx };
}

function onClick(e) {
    const r = hitAt(e);
    if (!r || !r.hit || r.hit.current) return;
    const n = notes()[r.hit.noteIdx];
    if (!n) return;
    // The SAME command path as P5 cycling: a deliberate position choice —
    // pitch-preserving (passes the read-only-roll lock) and it clears the
    // suggested mark (undo re-marks; MoveToStringCmd owns both).
    const wasSuggested = typeof _isSuggested === 'function' && _isSuggested(n);
    const cmd = new MoveToStringCmd([{
        index: r.hit.noteIdx,
        oldString: n.string, oldFret: n.fret,
        newString: r.hit.string, newFret: r.hit.fret,
    }]);
    cmd.pitchPreserving = true;
    S.history.exec(cmd);
    setStatus(`Position set: string ${r.hit.string + 1}, fret ${r.hit.fret}`
        + (wasSuggested ? ' (suggestion confirmed)' : ''));
    lastKey = '';
    _fretboardStripRefresh();
    host.draw();
    host.renderInspector();
}

function onContextMenu(e) {
    e.preventDefault();
    const r = hitAt(e);
    if (!r || !r.hit || !r.hit.current) return;
    const n = notes()[r.hit.noteIdx];
    if (!n) return;
    const cur = n.techniques && Number.isInteger(n.techniques.fret_finger)
        ? n.techniques.fret_finger : -1;
    const next = _stripFingerCyclePure(cur);
    S.history.exec(new SetTeachingMarkCmd([r.hit.noteIdx], 'fret_finger', next));
    setStatus(next === -1
        ? 'Fret-hand finger cleared'
        : `Fret-hand finger: ${FINGER_LABELS[next]}`);
    lastKey = '';
    _fretboardStripRefresh();
    host.draw();
    host.renderInspector();
}

// ── Boot ─────────────────────────────────────────────────────────────

export function initFretboardStrip() {
    const strip = $strip();
    const canvas = $canvas();
    if (!strip || !canvas) return;
    stripCtx = canvas.getContext('2d');
    canvas.addEventListener('click', onClick);
    canvas.addEventListener('contextmenu', onContextMenu);
    const collapse = document.getElementById('editor-fretboard-collapse');
    if (collapse) collapse.addEventListener('click', () => editorToggleFretboardStrip());
    // A resize changes the canvas box — re-key so the next refresh repaints.
    host.addGlobalListener(window, 'resize', () => { lastKey = ''; _fretboardStripRefresh(); });
    _fretboardStripRefresh();
}
