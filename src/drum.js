// ════════════════════════════════════════════════════════════════════
// Drum editor — the piece-lane grid view of S.drumTab.hits[], its lane
// model, and the undo commands that write it.
//
// Activates when the user clicks the "🥁 Edit Drums" toggle button (visible
// only when S.drumTab is non-null). The editor canvas is reused: main.js's
// draw() forks early to _drumEditorDraw, and onMouseDown forks to
// _drumEditorOnMouseDown. Save goes through the regular _buildSaveBody, which
// already ships drum_tab on the wire.
//
// Lanes are listed top→bottom in a physical-kit order (cymbals high, kick low)
// — what a drummer expects when reading a sheet vertically. Time runs
// left→right as in the rest of the editor.
//
// Still in main.js: the mouse/drag handlers that CONSTRUCT these commands, the
// toolbar buttons, and the MIDI-import flow (which is about tempo, not drums).
// They reach the commands as plain imports. Three symbols travel the other way
// — draw, drawWaveform, updateArrangementSelector — and would close a cycle, so
// they arrive through the shared `host` object in src/host.js.
//
// Browser surface: `ctx` (the shared 2D context) and `localStorage` (the
// density pref, which is editor state and never pack data).
// ════════════════════════════════════════════════════════════════════
import { ctx } from './canvas.js';
import { drawSelectionRect } from './draw.js';
import { LABEL_W, TIMELINE_TOP, WAVEFORM_H, timeToX, xToTime } from './geometry.js';
import { host } from './host.js';
import { S, editGen } from './state.js';
import { setStatus } from './ui.js';

// Physical-kit ordering of the drum piece-ids. Mirrors lib/drums.py's
// PIECES dict but ordered for visual editing rather than data shape.
export const DRUM_PIECE_ORDER = [
    'china', 'splash', 'crash_l', 'crash_r', 'stack',
    'hh_open', 'hh_closed', 'hh_pedal',
    'ride', 'ride_bell', 'bell',
    'tom_hi', 'tom_mid', 'tom_low', 'tom_floor',
    'snare', 'snare_xstick',
    'kick',
];

/* @pure:drum-density:start */
// Compact row grouping — the community 7-row shape (mirrors core
// lib/drums.py PRESET_RB4 family boundaries), physical-kit top→bottom to
// match the Full order. RENDER/SELECTION grouping ONLY: hits keep their
// real piece-ids (EDITOR-VIEW-MODALITY-DESIGN V6 — one grid, density
// presets, never a second data path). `canonical` is the piece an ADD in
// that row authors — each family's bread-and-butter voice.
export const DRUM_COMPACT_LANES = [
    { pieces: ['china', 'splash', 'crash_l', 'crash_r', 'stack'], label: 'Crash', canonical: 'crash_l' },
    { pieces: ['hh_open', 'hh_closed', 'hh_pedal'],               label: 'Hi-hat', canonical: 'hh_closed' },
    { pieces: ['ride', 'ride_bell', 'bell'],                      label: 'Ride', canonical: 'ride' },
    { pieces: ['tom_hi', 'tom_mid'],                              label: 'Toms', canonical: 'tom_hi' },
    { pieces: ['tom_low', 'tom_floor'],                           label: 'Fl toms', canonical: 'tom_floor' },
    { pieces: ['snare', 'snare_xstick'],                          label: 'Snare', canonical: 'snare' },
    { pieces: ['kick'],                                           label: 'Kick', canonical: 'kick' },
];

// The lane table for a density mode: [{pieces, label, canonical}], one
// entry per visual row. Full = one row per piece (today's grid, label
// null → per-piece meta label). Unknown densities fall back to full so a
// corrupted pref can never blank the grid.
export function _drumLaneTablePure(density, fullOrder, compactLanes) {
    if (density !== 'compact') {
        return fullOrder.map(p => ({ pieces: [p], label: null, canonical: p }));
    }
    return compactLanes.map(l => ({
        pieces: l.pieces.slice(), label: l.label, canonical: l.canonical,
    }));
}

// Which visual row a piece-id lives on (-1 for unknown pieces — the
// renderer skips them, same as today's indexOf contract).
export function _drumLaneIdxForPiecePure(pieceId, laneTable) {
    for (let i = 0; i < laneTable.length; i++) {
        if (laneTable[i].pieces.includes(pieceId)) return i;
    }
    return -1;
}
/* @pure:drum-density:end */

/* @pure:drum-limb-lint:start */
// The two kit pieces played with the FEET (the rest are stick/hand pieces).
// A drummer has two hands, so at most two hand pieces can sound at one instant.
export const DRUM_FEET_PIECES = new Set(['kick', 'hh_pedal']);
// Hits closer than this (seconds) count as one instant. Tight enough that a
// fast roll or a flam pair (~30 ms) stays separate, loose enough to catch hits
// authored/imported onto the same grid tick with tiny rounding differences.
export const DRUM_LIMB_EPSILON = 0.012;

// Physical-feasibility conflicts in a drum tab — ADVISORY ONLY, never blocks
// (the drum sibling of the fretted playability lint; DAW doc F5.4). Two rules,
// evaluated per near-simultaneous cluster (hits within `epsilon` of the
// cluster's first hit):
//   • 'hands' — more than TWO stick-struck (non-foot) pieces at one instant:
//     3+ simultaneous hand pieces needs 3+ hands.
//   • 'hihat' — a contradictory hi-hat state at one instant: hh_open with
//     hh_closed (can't be both), or hh_open with hh_pedal (the foot can't be
//     up-for-open and down-on-the-pedal at once).
// Feet (kick, hh_pedal) never count toward the hand limit; two feet + two
// hands is the playable ceiling. Returns one entry per conflicted cluster:
// {time, indices, pieces, reasons}. `hits` is assumed time-sorted (the editor
// keeps S.drumTab.hits sorted); hits with a non-finite time are skipped.
export function _drumLimbConflictsPure(hits, epsilon) {
    const eps = Number.isFinite(epsilon) ? epsilon : DRUM_LIMB_EPSILON;
    const out = [];
    if (!Array.isArray(hits)) return out;
    const n = hits.length;
    let i = 0;
    while (i < n) {
        const t0 = hits[i] && Number(hits[i].t);
        if (!Number.isFinite(t0)) { i++; continue; }
        // Cluster [i, j): every following hit within eps of the cluster START
        // (bounded from t0, so a long roll never chains into one giant cluster).
        let j = i + 1;
        while (j < n) {
            const tj = Number(hits[j].t);
            if (!Number.isFinite(tj) || tj - t0 >= eps) break;
            j++;
        }
        if (j - i >= 2) {
            const indices = [];
            const pieces = [];
            const handPieces = new Set();
            const present = new Set();
            for (let k = i; k < j; k++) {
                indices.push(k);
                const p = hits[k].p;
                pieces.push(p);
                present.add(p);
                if (!DRUM_FEET_PIECES.has(p)) handPieces.add(p);
            }
            const reasons = [];
            if (handPieces.size > 2) reasons.push('hands');
            if (present.has('hh_open') && (present.has('hh_closed') || present.has('hh_pedal'))) {
                reasons.push('hihat');
            }
            if (reasons.length) out.push({ time: t0, indices, pieces, reasons });
        }
        i = j > i ? j : i + 1;
    }
    return out;
}

// Flatten conflicts to the Set of conflicted hit indices (for the renderer).
export function _drumConflictIndexSetPure(hits, epsilon) {
    const set = new Set();
    for (const c of _drumLimbConflictsPure(hits, epsilon)) {
        for (const idx of c.indices) set.add(idx);
    }
    return set;
}
/* @pure:drum-limb-lint:end */

// Cross-frame memo for the advisory limb-lint. The pure clusterer is O(n) and
// the drum draw loop is already O(n), but re-clustering EVERY frame (playback,
// idle repaint) is the exact per-frame-recompute bug the section-coverage strip
// hit — so cache the conflict list behind the edit generation (bumped by
// EditHistory._afterEdit on every commit/undo/redo) plus the hits array
// identity+length. Two subtleties this guards:
//   • LIVE drum-move drag: `_drumEditorOnDragMove` mutates hit `.t` in place and
//     only RE-SORTS on drop (`_drumEditorOnDragEnd`), so mid-drag the array is
//     transiently unsorted. The clusterer assumes time-sorted input, so running
//     it then can flash spurious/missed markers. It's advisory, so we simply
//     PAUSE the lint for the drag's duration (return no conflicts) and let it
//     re-appear correctly on drop — never mark a transiently-unsorted array.
//   • add/remove change hits.length; an in-place move commits with an edit-gen
//     bump — so the cheap key catches every real change without a deep scan.
let _drumLintCache = { key: null, hitsRef: null, value: [] };
export function _drumLimbConflicts(hits) {
    // Live drum-move drag → hits unsorted in place; advisory lint pauses.
    if (S.drag && S.drag.type === 'drum-move') return [];
    const key = editGen + '|' + (Array.isArray(hits) ? hits.length : -1);
    if (key !== _drumLintCache.key || _drumLintCache.hitsRef !== hits) {
        _drumLintCache = {
            key, hitsRef: hits,
            value: _drumLimbConflictsPure(hits, DRUM_LIMB_EPSILON),
        };
    }
    return _drumLintCache.value;
}

// Density pref (editor localStorage, never pack data) + a memoized lane
// table so per-frame draw/hit paths never rebuild it.
let _drumDensityCache = null;
export function _drumDensityMode() {
    if (_drumDensityCache === null) {
        try {
            _drumDensityCache = localStorage.getItem('editorDrumDensity') === 'compact'
                ? 'compact' : 'full';
        } catch (_) { _drumDensityCache = 'full'; }
    }
    return _drumDensityCache;
}
let _drumLaneTableMemo = null;
let _drumLaneTableMemoMode = null;
export function _drumLanes() {
    const mode = _drumDensityMode();
    if (_drumLaneTableMemoMode !== mode) {
        _drumLaneTableMemo = _drumLaneTablePure(mode, DRUM_PIECE_ORDER, DRUM_COMPACT_LANES);
        _drumLaneTableMemoMode = mode;
    }
    return _drumLaneTableMemo;
}
export function _drumLaneIdxForPiece(pieceId) {
    return _drumLaneIdxForPiecePure(pieceId, _drumLanes());
}

export function _editorToggleDrumDensity() {
    const next = _drumDensityMode() === 'compact' ? 'full' : 'compact';
    _drumDensityCache = next;
    try { localStorage.setItem('editorDrumDensity', next); } catch (_) {}
    // Row count changed — drop selection (indices keep meaning, but the
    // user's visual anchor doesn't) and repaint.
    S.drumSel = new Set();
    host.draw();
    setStatus(next === 'compact'
        ? 'Compact rows — families share a row (colors keep each piece distinct); adding writes the family’s main piece'
        : 'Full rows — one row per drum piece');
    return true;
}

// Display colour + shape hint per piece-id — mirrors lib/drums.py::PIECES
// so the editor visual matches what the player highway shows.
export const DRUM_PIECE_META = {
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

export const DRUM_LANE_H = 22;
export const DRUM_HIT_RADIUS = 8;

// Lane-count/geometry helpers route through the density lane table:
// Full = one row per piece (unchanged), Compact = family rows. "Piece at
// Y" answers with the row's CANONICAL piece — the add-target; hit lookup
// matches any member of the row (see _drumHitAtPoint).
export function _drumPieceCount()        { return _drumLanes().length; }
export function _drumLaneIdxToY(idx)     { return (TIMELINE_TOP + WAVEFORM_H) + idx * DRUM_LANE_H; }
export function _drumYToLaneIdx(y) {
    const idx = Math.floor((y - (TIMELINE_TOP + WAVEFORM_H)) / DRUM_LANE_H);
    if (idx < 0 || idx >= _drumPieceCount()) return -1;
    return idx;
}
export function _drumPieceAtY(y) {
    const i = _drumYToLaneIdx(y);
    return i >= 0 ? _drumLanes()[i].canonical : null;
}

// Hit lookup: which hit (if any) is under (x, y)? Returns the index into
// S.drumTab.hits[], or -1. Tolerance is the hit's draw radius.
export function _drumHitAtPoint(x, y) {
    if (!S.drumTab) return -1;
    const laneIdx = _drumYToLaneIdx(y);
    if (laneIdx < 0) return -1;
    // Match ANY piece that lives on this visual row — in Compact several
    // family members share it; in Full the row has exactly one piece
    // (today's behavior unchanged).
    const lanePieces = _drumLanes()[laneIdx].pieces;
    const t = xToTime(x);
    const yLane = _drumLaneIdxToY(laneIdx) + DRUM_LANE_H / 2;
    const hits = S.drumTab.hits || [];  // guard against malformed tabs with no hits[]
    for (let i = 0; i < hits.length; i++) {
        const h = hits[i];
        // Hits are sorted by time; bail once we're past the click window.
        // This check must run before the piece filter so hits on other lanes
        // don't prevent the early break from firing.
        if (h.t > t + 0.5) break;
        if (!lanePieces.includes(h.p)) continue;
        const hx = timeToX(h.t);
        const dx = Math.abs(hx - x);
        const dy = Math.abs(yLane - y);
        if (dx < DRUM_HIT_RADIUS + 2 && dy < DRUM_LANE_H / 2) return i;
    }
    return -1;
}

export function _drumEditorDraw(w, h) {
    const hits = S.drumTab.hits || [];
    const visibleStart = S.scrollX - 0.5;
    const visibleEnd = S.scrollX + (w - LABEL_W) / S.zoom + 0.5;

    host.drawTimelineHeader(w);
    host.drawWaveform(w);

    // ── Lane grid ─────────────────────────────────────────────────────
    const laneTable = _drumLanes();
    for (let i = 0; i < laneTable.length; i++) {
        const lane = laneTable[i];
        const meta = DRUM_PIECE_META[lane.canonical];
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
        // Lane label (left margin): family label in Compact, per-piece
        // label in Full. Hits keep their own piece colors either way.
        ctx.fillStyle = meta.color;
        ctx.font = '10px sans-serif';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        ctx.fillText(lane.label || meta.label, LABEL_W - 4, y + DRUM_LANE_H / 2);
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
        ctx.moveTo(x, (TIMELINE_TOP + WAVEFORM_H));
        ctx.lineTo(x, (TIMELINE_TOP + WAVEFORM_H) + _drumPieceCount() * DRUM_LANE_H);
        ctx.stroke();
    }

    // ── Playability lint (advisory) ───────────────────────────────────
    // Conflicted-hit index set from the MEMOIZED limb-lint — the O(n) cluster
    // pass runs only when the hits actually change (edit-gen + array id/len),
    // not on every repaint, and pauses during a live drum-move drag (unsorted
    // hits). Drum-editor-mode only; never touches guitar/keys; never mutates.
    const _lintConflicts = _drumLimbConflicts(hits);
    const _conflictIdx = new Set();
    for (const c of _lintConflicts) for (const idx of c.indices) _conflictIdx.add(idx);

    // ── Hits ──────────────────────────────────────────────────────────
    for (let i = 0; i < hits.length; i++) {
        const h = hits[i];
        if (h.t < visibleStart || h.t > visibleEnd) continue;
        const pieceIdx = _drumLaneIdxForPiece(h.p);
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

        // Playability advisory: a small amber warning triangle above a hit
        // that participates in a physically-impossible simultaneity (3+ hands
        // or a contradictory hi-hat state). Advisory only — the hit is drawn
        // and editable exactly as normal.
        if (_conflictIdx.has(i)) {
            const wy = cy - DRUM_LANE_H / 2 + 4;
            ctx.fillStyle = '#facc15';
            ctx.strokeStyle = '#0a0a1a';
            ctx.lineWidth = 0.75;
            ctx.beginPath();
            ctx.moveTo(cx, wy - 3);
            ctx.lineTo(cx + 3.2, wy + 3);
            ctx.lineTo(cx - 3.2, wy + 3);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
        }
    }

    // ── Cursor ────────────────────────────────────────────────────────
    if (S.cursorTime >= visibleStart && S.cursorTime <= visibleEnd) {
        ctx.strokeStyle = 'rgba(255,255,255,0.5)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(timeToX(S.cursorTime), (TIMELINE_TOP + WAVEFORM_H));
        ctx.lineTo(timeToX(S.cursorTime), (TIMELINE_TOP + WAVEFORM_H) + _drumPieceCount() * DRUM_LANE_H);
        ctx.stroke();
    }

    // ── Marquee rubber-band selection rect ────────────────────────────
    drawSelectionRect();

    // ── HUD ───────────────────────────────────────────────────────────
    ctx.fillStyle = '#94a3b8';
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    const hud = `Drum editor — ${hits.length} hits, ${S.drumSel.size} selected. Click empty: add. Drag empty: select box. Click hit: select. Del: remove. G/F/K: ghost/flam/choke. A/N: accent/normal. Alt+drag or Shift+↑/↓: velocity.`;
    const hudY = (TIMELINE_TOP + WAVEFORM_H) + _drumPieceCount() * DRUM_LANE_H + 6;
    ctx.fillText(hud, LABEL_W + 6, hudY);
    // Advisory playability count on its own line — amber, non-blocking. Wording
    // stays gentle (these are hints for the human, not errors).
    if (_lintConflicts.length) {
        const spots = _lintConflicts.length;
        ctx.fillStyle = '#facc15';
        ctx.fillText(
            `⚠ ${spots} playability ${spots === 1 ? 'hint' : 'hints'}: `
            + `a spot needs 3+ hands or an impossible hi-hat state (advisory — nothing is blocked).`,
            LABEL_W + 6, hudY + 15);
    }
}

/* @pure:drum-cmds:start */
// Undo commands for the drum editor — the drum siblings of the note command
// classes above (drum edits previously bypassed EditHistory entirely). All
// four hold HIT OBJECT REFERENCES, never indices: the hits array is re-sorted
// after adds/moves and REPLACED by delete's filter(), so captured indices go
// stale, but refs survive both. Every exec()/rollback() marks S.drumTabDirty
// so a save issued after an undo persists the reverted state. All are
// `songScope` — drum_tab is song-level, not per-arrangement — so undo never
// needs to switch the active arrangement for them.

// Sort hits by time and rebind S.drumSel to the given refs' fresh indices
// (S.drumSel is index-based, so every reorder must remap it or the selection
// silently jumps to different hits).
export function _drumSortAndRemapSel(selectRefs) {
    const hits = S.drumTab.hits;
    hits.sort((a, b) => a.t - b.t);
    S.drumSel = new Set();
    if (selectRefs && selectRefs.length) {
        const want = new Set(selectRefs);
        for (let i = 0; i < hits.length; i++) {
            if (want.has(hits[i])) S.drumSel.add(i);
        }
    }
}

// Refs for the currently selected hits — snapshot BEFORE a mutation that
// reorders the array, then hand back to _drumSortAndRemapSel to preserve the
// user's selection across the reorder.
export function _drumSelectedRefs() {
    if (!Array.isArray(S.drumTab.hits)) return [];
    return [...S.drumSel].map(i => S.drumTab.hits[i]).filter(Boolean);
}

export class AddDrumHitCmd {
    constructor(hit) { this.hit = hit; this.songScope = true; }
    exec() {
        if (!Array.isArray(S.drumTab.hits)) S.drumTab.hits = [];
        const keepSel = _drumSelectedRefs();
        S.drumTab.hits.push(this.hit);
        _drumSortAndRemapSel(keepSel);
        S.drumTabDirty = true;
        host.updateArrangementSelector();
    }
    rollback() {
        const keepSel = _drumSelectedRefs().filter(h => h !== this.hit);
        const i = S.drumTab.hits.indexOf(this.hit);
        if (i >= 0) S.drumTab.hits.splice(i, 1);
        _drumSortAndRemapSel(keepSel);
        S.drumTabDirty = true;
        host.updateArrangementSelector();
    }
}

export class DeleteDrumHitsCmd {
    constructor(hitRefs) { this.hits = [...hitRefs]; this.songScope = true; }
    exec() {
        const drop = new Set(this.hits);
        S.drumTab.hits = S.drumTab.hits.filter(h => !drop.has(h));
        S.drumSel = new Set();
        S.drumTabDirty = true;
        host.updateArrangementSelector();
    }
    rollback() {
        S.drumTab.hits.push(...this.hits);
        // Reselect the restored hits so a follow-up action (re-delete,
        // articulation toggle) has the same selection the delete consumed.
        _drumSortAndRemapSel(this.hits);
        S.drumTabDirty = true;
        host.updateArrangementSelector();
    }
}

export class MoveDrumHitsCmd {
    // Carries before/after value pairs; exec() SETS the target values rather
    // than applying a delta, so the drag path can revert-then-exec exactly
    // like the note-drag MoveNoteCmd finalize (idempotent under redo).
    constructor(hitRefs, origTimes, origPieces, newTimes, newPieces) {
        this.hits = [...hitRefs];
        this.origTimes = origTimes;
        this.origPieces = origPieces;
        this.newTimes = newTimes;
        this.newPieces = newPieces;
        this.songScope = true;
    }
    _apply(times, pieces) {
        for (let k = 0; k < this.hits.length; k++) {
            this.hits[k].t = times[k];
            this.hits[k].p = pieces[k];
        }
        // Keep the moved hits selected through the resort (supersedes the old
        // sentinel-Symbol remap that lived in _drumEditorOnDragEnd).
        _drumSortAndRemapSel(this.hits);
        S.drumTabDirty = true;
    }
    exec() { this._apply(this.newTimes, this.newPieces); }
    rollback() { this._apply(this.origTimes, this.origPieces); }
}

export class ToggleDrumArticulationCmd {
    // f/k toggles are involutive per hit, so rollback = exec and mixed
    // initial states round-trip exactly. The GHOST toggle additionally pulls
    // a normal-strength hit's velocity down to the ghost level — a ghost IS
    // a quiet hit (import derives g from v < 40, and both the renderer and
    // guide audio scale with v), so ghosting a v:100 hit without quieting it
    // would author a contradiction. That makes 'g' asymmetric: it snapshots
    // {had, v} per hit at construction and restores both exactly on
    // rollback (including deleting a v that wasn't there). The choke
    // cymbal-only gate is applied at CONSTRUCTION (callers pass only the
    // refs the toggle really touches).
    constructor(hitRefs, field) {
        this.hits = [...hitRefs];
        this.field = field;
        this.songScope = true;
        if (field === 'g') {
            this.before = this.hits.map(h => ({ had: !!h.g, v: h.v }));
        }
    }
    _toggle() {
        for (const h of this.hits) {
            if (this.field === 'k') {
                if (h.k) delete h.k; else h.k = 0.08;
            } else if (h[this.field]) {
                delete h[this.field];
            } else {
                h[this.field] = true;
            }
        }
        S.drumTabDirty = true;
    }
    exec() {
        if (this.field !== 'g') { this._toggle(); return; }
        for (let i = 0; i < this.hits.length; i++) {
            const h = this.hits[i];
            if (this.before[i].had) {
                // Un-ghost: the flag lifts, authored dynamics stay put.
                delete h.g;
            } else {
                h.g = true;
                // Pull a normal-strength hit down to ghost level; a hit
                // that is already quiet keeps its authored velocity.
                const v = typeof h.v === 'number' ? h.v : 100;
                if (v > DRUM_GHOST_VELOCITY + 5) h.v = DRUM_GHOST_VELOCITY;
            }
        }
        S.drumTabDirty = true;
    }
    rollback() {
        if (this.field !== 'g') { this._toggle(); return; }
        for (let i = 0; i < this.hits.length; i++) {
            const h = this.hits[i];
            if (this.before[i].had) h.g = true; else delete h.g;
            if (this.before[i].v === undefined) delete h.v;
            else h.v = this.before[i].v;
        }
        S.drumTabDirty = true;
    }
}

// The velocity a ghosted hit pulls down to. The MIDI importer derives
// g from v < 40, so 35 round-trips as a ghost on re-import.
export const DRUM_GHOST_VELOCITY = 35;

// Clamp any velocity input to MIDI 1..127; non-numeric falls back to the
// import default (100) so a malformed value can't author v:NaN.
export function _drumClampVelocityPure(v) {
    const n = Math.round(Number(v));
    if (!Number.isFinite(n)) return 100;
    return Math.max(1, Math.min(127, n));
}

// Alt-drag velocity mapping (the piano-roll idiom): dragging UP makes the
// hit louder — 1 velocity step per pixel of vertical drift off the
// hit's original value.
export function _drumVelocityDragValuePure(origV, dy) {
    const base = typeof origV === 'number' ? origV : 100;
    return _drumClampVelocityPure(base - dy);
}

// Build a drum hit for a hand-mapped unmapped-notes import. Carries the
// source velocity through (default 100 when the server didn't capture one)
// and derives the ghost flag from it the SAME way the MIDI importer does
// (g ⇐ v below the ghost band). `DRUM_GHOST_VELOCITY + 5` is the shared
// ghost-band boundary (currently 40, matching the core importer's v < 40),
// so all three velocity paths — this import, the ghost-pull, and
// SetDrumVelocityCmd — agree on when a hit is a ghost.
export function _drumImportHitPure(t, pid, rawV) {
    const v = _drumClampVelocityPure(rawV === undefined ? 100 : rawV);
    const hit = { t, p: pid, v };
    if (v < DRUM_GHOST_VELOCITY + 5) hit.g = true;
    return hit;
}

export class SetDrumVelocityCmd {
    // One velocity edit for a set of hits (Alt-drag, ±10 nudge keys, the
    // accent/normal quick sets). Holds refs + the exact old values so
    // rollback restores authored dynamics verbatim — a hit that had no
    // explicit v gets the field DELETED again, not set to 100.
    //
    // A ghost IS a quiet hit (the pull in ToggleDrumArticulationCmd and the
    // importer's `g` ⇐ `v < 40` derivation both encode this), so raising a
    // ghosted hit's velocity back above the ghost band (Accent / ↑ / drag
    // up) must LIFT the ghost flag in the same edit — otherwise the edit
    // authors a contradictory "loud ghost" that the renderer draws as a
    // small-but-bright pip and re-import would flip back to a ghost. The old
    // g-state is snapshotted so rollback restores the exact {g, v} pair.
    constructor(hitRefs, newVs) {
        this.hits = [...hitRefs];
        this.newVs = Array.isArray(newVs)
            ? newVs.map(_drumClampVelocityPure)
            : this.hits.map(() => _drumClampVelocityPure(newVs));
        this.oldVs = this.hits.map(h => h.v);
        this.oldGs = this.hits.map(h => !!h.g);
        this.songScope = true;
    }
    exec() {
        for (let i = 0; i < this.hits.length; i++) {
            const h = this.hits[i];
            h.v = this.newVs[i];
            // Only ever CLEAR the flag (never auto-ghost a quieted hit — a
            // quiet non-ghost hit is legitimate); the threshold mirrors the
            // ghost-pull boundary in ToggleDrumArticulationCmd's exec.
            if (h.g && this.newVs[i] > DRUM_GHOST_VELOCITY + 5) delete h.g;
        }
        S.drumTabDirty = true;
    }
    rollback() {
        for (let i = 0; i < this.hits.length; i++) {
            const h = this.hits[i];
            if (this.oldVs[i] === undefined) delete h.v;
            else h.v = this.oldVs[i];
            // exec only clears g, so restoring the snapshot re-sets it where
            // it was lifted and no-ops everywhere else.
            if (this.oldGs[i]) h.g = true; else delete h.g;
        }
        S.drumTabDirty = true;
    }
}
/* @pure:drum-cmds:end */

// ════════════════════════════════════════════════════════════════════
// Canvas interaction and the toolbar buttons.
//
// main.js routes the raw canvas events here once S.drumEditMode is on, and
// forwards Delete / velocity keys. It kept these when the model moved out in
// #166 only because they had no section banner of their own; they belong here.
//
// `_refreshTempoMapButton` lives in src/tempo.js, which already imports this
// module — so it crosses through `host` rather than closing a cycle.
// ════════════════════════════════════════════════════════════════════

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
    // Snap using host.snapTime() so drum hits align with the rest of the editor.
    // Clamped on BOTH sides, for two different reasons: before, because the
    // padding region left of t=0 would hand snapTime a negative time; after,
    // because when the first beat is offset from 0 snapTime can still round
    // backward past zero.
    const t = Math.max(0, host.snapTime(Math.max(0, rawT)));
    // Sort, dirty flag, and the ⟳ Drums (N) toolbar count all live in the
    // command's exec() so undo/redo replay them identically.
    S.history.exec(new AddDrumHitCmd({ t: Math.round(t * 1000) / 1000, p: piece, v: 100 }));
    return true;
}

export function _drumEditorOnMouseDown(e, x, y) {
    // Click in the waveform area above the lane grid → set cursor (no note edit).
    if (y < (TIMELINE_TOP + WAVEFORM_H)) {
        // Waveform-area click sets the cursor like in guitar mode.
        S.cursorTime = Math.max(0, xToTime(x));
        if (S.playing) { host.stopPlayback(); host.startPlayback(); }
        host.draw();
        return;
    }
    if (y > (TIMELINE_TOP + WAVEFORM_H) + _drumPieceCount() * DRUM_LANE_H) return;
    // Clicks in the left lane-label gutter aren't on the time grid —
    // ignore them so they neither hit-test nor add a hit.
    if (x < LABEL_W) return;

    const idx = _drumHitAtPoint(x, y);
    if (idx >= 0) {
        // Clicked on an existing hit. Three paths from here:
        //   - plain click → ensure that hit is in the selection, then start
        //     a drag that moves every selected hit together.
        //   - Alt+click → start a VELOCITY drag on the selection (vertical,
        //     piano-roll idiom: up = louder, 1 step/px).
        //   - Shift+click → toggle the hit in/out of the selection (no drag).
        if (e.altKey) {
            if (!S.drumSel.has(idx)) {
                S.drumSel.clear();
                S.drumSel.add(idx);
            }
            const indices = [...S.drumSel];
            S.drag = {
                type: 'drum-velocity',
                startY: y,
                indices,
                origVs: indices.map(i => S.drumTab.hits[i].v),
                moved: false,
            };
            host.draw();
            return;
        }
        if (e.shiftKey) {
            if (S.drumSel.has(idx)) S.drumSel.delete(idx);
            else S.drumSel.add(idx);
            host.draw();
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
            // host.snapTime(t0 + rawDt) - host.snapTime(t0).
            startTime: xToTime(x),
            indices,
            origTimes,
            origPieces,
            moved: false,
        };
        host.draw();
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
    host.draw();
}

// Apply an in-progress drum-move drag — called from _onMouseMoveBody
// when S.drag.type === 'drum-move'. Computes a single time delta from
// the cursor drift (snapped to the editor's snap grid) and applies it
// uniformly to every selected hit. Snapping per-hit collapses sub-grid
// detail (e.g. 16th-note double-bass gets quantised to quarter-notes if
// snap is set to ¼), so we snap the DELTA once and let it ride.
export function _drumEditorOnDragMove(x, y) {
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
    // delegating to host.snapTime(), which respects per-surrounding-beat
    // intervals and handles tempo changes correctly. This preserves the
    // relative spacing between selected hits even when the editor's snap
    // grid is coarser than the chart's note resolution.
    const t0 = S.drag.startTime ?? 0;
    const rawTarget = t0 + rawDt;
    const snappedDt = host.snapTime(rawTarget) - host.snapTime(t0);
    for (let k = 0; k < S.drag.indices.length; k++) {
        const idx = S.drag.indices[k];
        const h = hits[idx];
        if (!h) continue;
        const newT = Math.max(0, S.drag.origTimes[k] + snappedDt);
        h.t = Math.round(newT * 1000) / 1000;

        // Lane (piece) movement — via the density lane table. Skip remap
        // for unknown piece ids (-1) to avoid silently mapping the hit to
        // lane 0 on the first drag. Staying on the SAME row keeps the
        // hit's original piece (a time-only drag in Compact must never
        // rewrite hh_open → hh_closed); crossing rows assigns the target
        // row's canonical piece — in Full that's the row's only piece,
        // exactly today's behavior.
        const laneTable = _drumLanes();
        const origLaneIdx = _drumLaneIdxForPiece(S.drag.origPieces[k]);
        if (origLaneIdx >= 0) {
            const newLaneIdx = Math.max(
                0,
                Math.min(laneTable.length - 1, origLaneIdx + dLanes),
            );
            h.p = newLaneIdx === origLaneIdx
                ? S.drag.origPieces[k]
                : laneTable[newLaneIdx].canonical;
        }
    }
}

// Finalise a drum-move drag — keep the hits array sorted by time so the
// renderer's binary-search-friendly early-break stays correct, then
// remap the selection indices through the sort. Called from onMouseUp
// when S.drag.type === 'drum-move'.
export function _drumEditorOnDragEnd() {
    if (!S.drag || S.drag.type !== 'drum-move' || !S.drumTab) return;
    if (S.drag.moved && Array.isArray(S.drumTab.hits)) {
        // The drag applied positions live; revert each hit to its origin and
        // let the command's exec() re-apply the move — the same finalize
        // pattern as the note-drag MoveNoteCmd path, so undo/redo replay the
        // exact drag result (sort + selection remap included).
        const hits = S.drumTab.hits;
        const refs = [], origT = [], origP = [], newT = [], newP = [];
        for (let k = 0; k < S.drag.indices.length; k++) {
            const h = hits[S.drag.indices[k]];
            if (!h) continue;
            refs.push(h);
            origT.push(S.drag.origTimes[k]);
            origP.push(S.drag.origPieces[k]);
            newT.push(h.t);
            newP.push(h.p);
            h.t = S.drag.origTimes[k];
            h.p = S.drag.origPieces[k];
        }
        // Skip the command when the snapped delta was a no-op (sub-grid drag
        // that rounded back to the start) — no state changed, so pushing an
        // empty command would only pollute the undo stack.
        const changed = newT.some((t, k) => t !== origT[k])
            || newP.some((p, k) => p !== origP[k]);
        if (refs.length && changed) {
            S.history.exec(new MoveDrumHitsCmd(refs, origT, origP, newT, newP));
        }
    }
    S.drag = null;
    host.draw();
}

// Apply an in-progress velocity drag — vertical drift maps 1 velocity step
// per pixel off each hit's ORIGINAL value (not the live one, so the drag
// never accumulates). Live-preview only; the commit happens on drag end.
export function _drumEditorOnVelocityDragMove(y) {
    if (!S.drag || S.drag.type !== 'drum-velocity' || !S.drumTab) return;
    if (!Array.isArray(S.drumTab.hits)) return;
    const dy = y - S.drag.startY;
    if (Math.abs(dy) > 2) S.drag.moved = true;
    if (!S.drag.moved) return;
    let shown = null;
    for (let k = 0; k < S.drag.indices.length; k++) {
        const h = S.drumTab.hits[S.drag.indices[k]];
        if (!h) continue;
        h.v = _drumVelocityDragValuePure(S.drag.origVs[k], dy);
        if (shown === null) shown = h.v;
    }
    if (shown !== null) {
        setStatus(`Velocity ${shown}${S.drag.indices.length > 1 ? ` (${S.drag.indices.length} hits)` : ''}`);
    }
}

// Finalise a velocity drag — revert to the originals and let the command's
// exec() re-apply, so undo/redo replay the exact result (the MoveDrumHitsCmd
// finalize pattern).
export function _drumEditorOnVelocityDragEnd() {
    if (!S.drag || S.drag.type !== 'drum-velocity' || !S.drumTab) {
        S.drag = null;
        host.draw();
        return;
    }
    if (S.drag.moved && Array.isArray(S.drumTab.hits)) {
        const refs = [], newVs = [];
        let changed = false;
        for (let k = 0; k < S.drag.indices.length; k++) {
            const h = S.drumTab.hits[S.drag.indices[k]];
            if (!h) continue;
            refs.push(h);
            newVs.push(h.v);
            if (h.v !== S.drag.origVs[k]) changed = true;
            // Revert to the original (including "no v" hits, so a no-op
            // drag leaves the wire data untouched).
            if (S.drag.origVs[k] === undefined) delete h.v;
            else h.v = S.drag.origVs[k];
        }
        if (refs.length && changed) {
            S.history.exec(new SetDrumVelocityCmd(refs, newVs));
        }
    }
    S.drag = null;
    host.draw();
}

// Nudge / set the selection's velocity from the keyboard (Shift+↑/↓ = ±10,
// A = accent, N = normal). One undoable command per keypress.
export function _drumEditorNudgeVelocity(delta) {
    if (!S.drumTab || !Array.isArray(S.drumTab.hits)) return;
    const refs = _drumSelectedRefs();
    if (!refs.length) return;
    const newVs = refs.map(h =>
        _drumClampVelocityPure((typeof h.v === 'number' ? h.v : 100) + delta));
    S.history.exec(new SetDrumVelocityCmd(refs, newVs));
    setStatus(`Velocity ${newVs[0]}${refs.length > 1 ? ` (${refs.length} hits)` : ''}`);
}
export function _drumEditorSetVelocity(value, label) {
    if (!S.drumTab || !Array.isArray(S.drumTab.hits)) return;
    const refs = _drumSelectedRefs();
    if (!refs.length) return;
    S.history.exec(new SetDrumVelocityCmd(refs, value));
    setStatus(`${label} (velocity ${_drumClampVelocityPure(value)}, ${refs.length} hit${refs.length === 1 ? '' : 's'})`);
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
export function _drumEditorOnSelectEnd() {
    if (!S.drag || S.drag.type !== 'drum-select' || !S.drumTab) {
        S.drag = null;
        host.draw();
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
        host.draw();
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
        const laneIdx = _drumLaneIdxForPiece(h.p);
        if (laneIdx < 0) continue;  // unknown piece → not on the grid
        const hx = timeToX(h.t);
        const hy = _drumLaneIdxToY(laneIdx) + DRUM_LANE_H / 2;
        if (hx >= x1 && hx <= x2 && hy >= y1 && hy <= y2) S.drumSel.add(i);
    }
    S.drag = null;
    host.draw();
}

export function _drumEditorDeleteSelection() {
    if (!S.drumTab || !S.drumSel.size) return;
    if (!Array.isArray(S.drumTab.hits)) return;
    const refs = _drumSelectedRefs();
    if (!refs.length) return;
    S.history.exec(new DeleteDrumHitsCmd(refs));
}

export function _drumEditorToggleArticulation(kind) {
    if (!S.drumTab) return;
    // Guard a malformed/older drum_tab with missing/non-array `hits`.
    if (!Array.isArray(S.drumTab.hits)) return;
    const field = kind === 'g' ? 'g' : kind === 'f' ? 'f' : 'k';
    let refs = _drumSelectedRefs();
    if (field === 'k') {
        // Choke is only meaningful on cymbal pieces; filter here so the
        // command holds exactly the hits it will toggle (symmetric undo).
        refs = refs.filter(h => {
            const meta = DRUM_PIECE_META[h.p];
            return meta && meta.cat === 'cymbal';
        });
    }
    if (!refs.length) return;
    S.history.exec(new ToggleDrumArticulationCmd(refs, field));
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
            host.hideContextMenu();
            host.hideAddNote();
            S.sel.clear();
            // Finalize any in-progress canvas drag before the mode
            // switch — commit a moved drag rather than discard it.
            host.finalizeActiveDrag();
            // Tempo, drum, and parts modes are mutually exclusive.
            if (S.drumEditMode) {
                S.tempoMapMode = false;
                S.tempoSel = -1;
                S.partsViewMode = false;
                S.tabViewMode = false;
            }
            _refreshDrumEditButton();
            host.refreshTempoMapButton();
            host.refreshPartsViewButton();
            host.refreshDrumPadStrip();
            host.draw();
        };
        drumsBtn.parentNode.insertBefore(btn, drumsBtn.nextSibling);
    }
    return btn;
}

let _drumEditBtnState = '';  // cached signature; button only updates when state changes

export function _refreshDrumEditButton() {
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

// ── Drum row-density toggle (Full / Compact) ─────────────────────────
let _drumDensityBtnState = '';
function _ensureDrumDensityButton() {
    let btn = document.getElementById('editor-drum-density-btn');
    if (!btn) {
        const editBtn = document.getElementById('editor-drum-edit-btn');
        if (!editBtn) return null;
        btn = document.createElement('button');
        btn.id = 'editor-drum-density-btn';
        btn.type = 'button';
        btn.className = 'px-2 py-1 bg-dark-600 hover:bg-dark-500 rounded text-xs font-medium hidden';
        btn.title = 'Row density: Full = one row per drum piece; Compact = family rows '
            + '(crash / hi-hat / ride / toms / floor toms / snare / kick — the community '
            + '7-row shape). Hits keep their real pieces and colors either way; adding in '
            + 'a Compact row writes the family’s main piece, and dragging onto another '
            + 'row does too.';
        btn.onclick = () => _editorToggleDrumDensity();
        editBtn.insertAdjacentElement('afterend', btn);
    }
    return btn;
}
export function _refreshDrumDensityButton() {
    const btn = _ensureDrumDensityButton();
    if (!btn) return;
    const sig = `${!!S.drumEditMode}|${_drumDensityMode()}`;
    if (sig === _drumDensityBtnState) return;
    _drumDensityBtnState = sig;
    btn.classList.toggle('hidden', !S.drumEditMode);
    btn.textContent = _drumDensityMode() === 'compact' ? 'Rows: Compact' : 'Rows: Full';
}
