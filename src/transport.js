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
// `rate` (audition speed, default 1 = normal) scales how fast chart time
// advances against the wall clock: at 0.5 the cursor moves at half speed, so a
// pitch-preserving slow-down stays sample-synced with the reference. rate=1 is
// bit-identical to the pre-audition formula (the 4th arg simply defaults away).
export function _transportChartTimePure(playStartTime, playStartWall, ctxNow, rate = 1) {
    const r = Number.isFinite(rate) && rate > 0 ? rate : 1;
    return playStartTime + (ctxNow - playStartWall) * r;
}

// The PAINT-ONLY playhead: the chart time of the audio LEAVING THE SPEAKER right
// now (ctxNow − output latency), so the drawn line sits on what's heard. Clamped
// at the start position exactly like the logical cursor in playbackTick — without
// that clamp a count-in pre-roll (anchor in the future) drags the marker
// backwards by preRoll·rate and sweeps it in while nothing is sounding yet.
// Latency is sanitized here too: 0/undefined/NaN (Firefox has no outputLatency)
// collapses to no compensation rather than an NaN marker.
export function _cursorDrawTimePure(playStartTime, playStartWall, ctxNow, outputLatency, rate = 1) {
    const lat = Number.isFinite(outputLatency) && outputLatency > 0 ? outputLatency : 0;
    return Math.max(playStartTime,
        _transportChartTimePure(playStartTime, playStartWall, ctxNow - lat, rate));
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

/* @pure:count-in:start */
// Count-in plan (the charrette's Count-in, deferred out of B2 because the
// feature didn't exist): N bars of metronome clicks BEFORE the transport
// starts, in the meter and tempo AT the cursor. Pure and grid-derived:
//   duration  seconds of pre-roll
//   clicks    [{ at, accent }] — offsets from pre-roll start; downbeats accent
// With no usable grid (< 2 beats) it counts a 4/4 bar at 120 BPM — a play
// gesture should never fail because the song lacks a tempo map. Returns
// null when bars is not a positive integer.
export function _countInPlanPure(beats, cursorTime, bars) {
    const n = Math.round(Number(bars));
    if (!Number.isInteger(n) || n <= 0) return null;
    let gap = 0.5, bpb = 4;
    if (Array.isArray(beats) && beats.length >= 2) {
        const t = Number.isFinite(cursorTime) ? cursorTime : 0;
        let i = 0;
        while (i + 1 < beats.length && beats[i + 1].time <= t) i++;
        const g = (i + 1 < beats.length ? beats[i + 1].time - beats[i].time
            : beats[beats.length - 1].time - beats[beats.length - 2].time);
        if (g > 1e-3) gap = g;
        // Beats per bar: the enclosing measure's downbeat-to-downbeat span.
        let d = -1, ndb = -1;
        for (let k = i; k >= 0; k--) if (beats[k] && beats[k].measure > 0) { d = k; break; }
        if (d >= 0) for (let k = d + 1; k < beats.length; k++) if (beats[k] && beats[k].measure > 0) { ndb = k; break; }
        if (d >= 0 && ndb > d) bpb = ndb - d;
    }
    const clicks = [];
    for (let k = 0; k < n * bpb; k++) clicks.push({ at: k * gap, accent: k % bpb === 0 });
    return { duration: n * bpb * gap, clicks };
}
/* @pure:count-in:end */
