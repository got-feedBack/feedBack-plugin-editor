/* Slopsmith Arrangement Editor — the transport clock and the compose-mode
 * song length.
 *
 * Two pure functions, no imports. `_transportChartTimePure` is the ONE formula
 * that turns the AudioContext wall clock into chart time, read by playbackTick,
 * the guide scheduler and the MIDI recorder — they must agree exactly, so they
 * share it rather than each deriving it. `_composeSongDurationPure` answers
 * "how long is this song?" when no audio bounds it.
 *
 * The @pure block markers stay: nothing slices them any more, but they name the
 * boundary this module was cut on.
 */

/* @pure:transport:start */
// The transport clock (charrette §1.7): chart-time is where the cursor sits in
// the song, derived from the AudioContext wall clock against the anchor pinned
// at play/seek start. ONE formula, read by playbackTick, the guide scheduler,
// and the record clock — buffered and buffer-less alike (a recording rides
// this clock; it is not the source of time).
export function _transportChartTimePure(playStartTime, playStartWall, ctxNow) {
    return playStartTime + (ctxNow - playStartWall);
}

// Compose-mode song length (charrette §1.7): with no recording, the GRID — not
// an audio buffer — bounds the song. Prefer an explicit user length; else the
// time of the last grid beat (timeOf(lastBeat)), extended if authored content
// runs past the grid so a note beyond the last bar still plays out. Non-finite
// or non-positive inputs collapse to 0.
export const COMPOSE_CONTENT_TAIL = 0.25; // seconds past the last authored onset, so its
                                   // guide clap (a ~60 ms voice) rings out before
                                   // playbackTick hits duration and cancels voices.
export function _composeSongDurationPure(gridEndTime, contentEndTime, userLen) {
    if (Number.isFinite(userLen) && userLen > 0) return userLen;
    const g = Number.isFinite(gridEndTime) && gridEndTime > 0 ? gridEndTime : 0;
    const c = Number.isFinite(contentEndTime) && contentEndTime > 0 ? contentEndTime : 0;
    // Content-bound (a note past the last grid beat): pad by a tail so the final
    // clap plays out. Grid-bound and explicit userLen stay exact.
    if (c > g) return c + COMPOSE_CONTENT_TAIL;
    return g;
}
/* @pure:transport:end */

// Loop-region math (charrette §1.6). Pure: _normalizeLoopRegionPure clamps a
// {startTime,endTime} to the song and orders it; _loopPlaybackRestartTimePure
// says where playback resumes when the cursor runs off the loop. Both the loop
// UI in main.js and the playback engine in src/audio.js read them.
export function _normalizeLoopRegionPure(region, duration) {
    if (!region) return null;
    let start = Number(region.startTime);
    let end = Number(region.endTime);
    if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
    if (end < start) [start, end] = [end, start];
    const maxT = Number(duration);
    if (Number.isFinite(maxT) && maxT > 0) {
        start = Math.max(0, Math.min(start, maxT));
        end = Math.max(0, Math.min(end, maxT));
    } else {
        start = Math.max(0, start);
        end = Math.max(0, end);
    }
    return end > start + 0.001 ? { startTime: start, endTime: end } : null;
}

export function _loopPlaybackRestartTimePure(cursorTime, region, enabled, duration) {
    if (!enabled) return null;
    const r = _normalizeLoopRegionPure(region, duration);
    if (!r) return null;
    const t = Number(cursorTime);
    if (!Number.isFinite(t)) return null;
    return t >= r.endTime - 0.001 ? r.startTime : null;
}
