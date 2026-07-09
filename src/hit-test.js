/* Slopsmith Arrangement Editor — pointer hit testing.
 *
 * Which note is under the cursor, and whether the cursor is on a note's right
 * edge (the sustain-resize grab zone). Pure geometry over `S`; no DOM, no
 * canvas. Sits directly on geometry + keys + notes, and imports nothing else.
 *
 * Callers seed the per-frame lane cache (lanes.js's `LC`) around these: `lanes()`
 * is O(N) over notes+chords, and both helpers reach it once per note through
 * strToY -> strToLane.
 */

import { LANE_H, MIN_NOTE_W, NOTE_PAD, strToY, timeToX } from './geometry.js';
import {
    PIANO_LANE_H,
    _rollMidiForNote,
    _rollPitchCtx,
    isKeysMode,
    midiToY,
} from './keys.js';
import { notes } from './notes.js';
import { S } from './state.js';

const EDGE_GRAB = 8; // pixels from right edge to trigger resize

/** The on-screen rectangle of note `n`, in whichever view is active.
 *
 * `hitNote` and `hitNoteEdge` used to compute this independently, and drifted:
 * only `hitNote` grew the keys-mode branch, so the sustain-resize grab zone kept
 * looking in the fretted lane band while the roll drew notes on sounding-pitch
 * rows (CodeRabbit, PR #160). One computation, one place.
 *
 * Returns null when the note has no resolvable pitch in the roll — callers skip
 * it rather than hit-test a wrong row. `rctx` is hoisted by the caller: it costs
 * an arrangement scan, and this runs once per note.
 */
function _noteRect(n, keysMode, rctx) {
    const x = timeToX(n.time);
    const w = Math.max(MIN_NOTE_W, (n.sustain || 0) * S.zoom);
    if (keysMode) {
        const midi = _rollMidiForNote(n, rctx);
        if (midi === null) return null;
        return { x, w, y: midiToY(midi) + 1, h: PIANO_LANE_H - 2 };
    }
    return { x, w, y: strToY(n.string) + NOTE_PAD, h: LANE_H - NOTE_PAD * 2 };
}

export function hitNote(mx, my) {
    const nn = notes();
    const keysMode = isKeysMode();
    // Fretted-in-roll hit-testing must use the same sounding-pitch mapping
    // the draw uses — hoisted once, not per note.
    const rctx = keysMode ? _rollPitchCtx() : null;
    for (let i = nn.length - 1; i >= 0; i--) {
        const r = _noteRect(nn[i], keysMode, rctx);
        if (!r) continue;
        if (mx >= r.x && mx <= r.x + r.w && my >= r.y && my <= r.y + r.h) return i;
    }
    return -1;
}

/** Note index whose RIGHT EDGE is under the cursor (the sustain-resize grab).
 *
 * Works in the roll too: edge-drag resize is a DURATION edit, pitch-preserving,
 * so it passes the read-only fretted roll's edit lock (V4). It therefore has to
 * use the same rows the roll draws on.
 */
export function hitNoteEdge(mx, my) {
    const nn = notes();
    const keysMode = isKeysMode();
    const rctx = keysMode ? _rollPitchCtx() : null;
    for (let i = nn.length - 1; i >= 0; i--) {
        const r = _noteRect(nn[i], keysMode, rctx);
        if (!r) continue;
        const rightEdge = r.x + r.w;
        if (mx >= rightEdge - EDGE_GRAB && mx <= rightEdge + EDGE_GRAB
            && my >= r.y && my <= r.y + r.h) return i;
    }
    return -1;
}
