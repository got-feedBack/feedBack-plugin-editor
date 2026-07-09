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

export function hitNote(mx, my) {
    const nn = notes();
    const keysMode = isKeysMode();
    // Fretted-in-roll hit-testing must use the same sounding-pitch mapping
    // the draw uses — hoisted once, not per note.
    const rctx = keysMode ? _rollPitchCtx() : null;
    for (let i = nn.length - 1; i >= 0; i--) {
        const n = nn[i];
        const x = timeToX(n.time);
        let y, w, h;
        if (keysMode) {
            const midi = _rollMidiForNote(n, rctx);
            if (midi === null) continue;
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

export function hitNoteEdge(mx, my) {
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
