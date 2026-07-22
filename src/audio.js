// ════════════════════════════════════════════════════════════════════
// Audio, playback, and the guide-clap / metronome / mixer that ride on it.
//
// The playback engine (startPlayback / stopPlayback / playbackTick), the
// waveform, the onset strip, follow-scroll, and the WebAudio graph — plus the
// guide claps (a tick per charted event), the metronome, the A/B reference
// loop, the per-bus mixer, and the edit blip.
//
// It owns the rAF loop: `rafId` is module-scope, set by playbackTick and
// cancelled by teardownAudio(), which main.js's screen teardown calls.
//
// main.js keeps the render (draw / drawNow), the scroll-bounds math, and the
// A/B loop-region selection; those arrive through the shared `host` object. The
// transport clock and loop-region pures come from src/transport.js so the
// recorder, the guide scheduler and this engine cannot drift apart.
//
// The 8 window.editor* toolbar handlers are exported and re-attached by main.js.
// Import-time button-seeding moved into initAudio(), called from init().
//
// Browser surface: WebAudio (AudioContext), `canvas` (for waveform width),
// ════════════════════════════════════════════════════════════════════
import { timeOf } from './beats.js';
import { DPR, canvas } from './canvas.js';
import { LABEL_W, timeToX } from './geometry.js';
import {
    DRUM_PIECE_GM_NOTE, _drumHitGainPure, _gmEventsInWindowPure, _gmGuideModePure,
    _gmKindPure, _gmSanitizeEventsPure, _gmVoiceDurationPure, editorGmVoiceFor,
    ensureGmDrum, ensureGmPreset, gmDrumReady, gmDrumVoiceAt, gmPresetReady, gmVoiceAt,
} from './gm-guide.js';
import { host } from './host.js';
import { _pickOnsetsPure, _spectralFluxOnsetsPlan, _spectralFluxStep } from './onsets.js';
import { _tourNoteAction } from './tour.js';
import { _rollMidiForNote, _rollPitchCtx, _rollPitchCtxFor, midiToFreq } from './keys.js';
import { isDrumArrangement } from './drum-arrangement.js';
import { arrKind } from './instrument.js';
import { _recState } from './midi-record.js';
import { notes } from './notes.js';
import { S } from './state.js';
import { _feelRangesLive, _groupingAccentsLive } from './tempo-marks.js';
import {
    _composeSongDurationPure, _cursorDrawTimePure, _loopPlaybackRestartTimePure,
    _normalizeLoopRegionPure, _countInPlanPure, _transportChartTimePure,
} from './transport.js';
import { setStatus } from './ui.js';

// The rAF handle for the playback loop. Module-scope so playbackTick and
// teardownAudio share it; main.js reaches the cancel through teardownAudio().
let rafId = null;
let audioLoadController = null;
let audioLoadGeneration = 0;
let activeSourceGeneration = 0;

// Lazily create the shared AudioContext. Compose mode never decodes a
// recording (loadAudio is the only other creation site), yet the transport
// clock + metronome/guide voices still need a context to schedule on — make
// one on demand. Call from a user gesture (decode / play) so the browser does
// not hand back a permanently-suspended context.
function _ensureAudioCtx() {
    if (!S.audioCtx) {
        const Ctor = window.AudioContext || window.webkitAudioContext;
        if (!Ctor) return null;            // no Web Audio — leave S.audioCtx unset so callers bail
        S.audioCtx = new Ctor();
    }
    return S.audioCtx;
}

export async function loadAudio(url) {
    if (!url) return false;
    cancelAudioLoad();
    const generation = audioLoadGeneration;
    audioLoadController = typeof AbortController === 'function' ? new AbortController() : null;
    try {
        _ensureAudioCtx();
        const resp = await fetch(url, audioLoadController ? { signal: audioLoadController.signal } : undefined);
        const buf = await resp.arrayBuffer();
        const decoded = await S.audioCtx.decodeAudioData(buf);
        if (generation !== audioLoadGeneration) return false;
        S.audioBuffer = decoded;
        S.duration = S.audioBuffer.duration;
        S.masterAudioDuration = S.audioBuffer.duration;
        // Keep the playable URL for the pitch-preserving audition path (the
        // MediaElement needs a src; the decoded buffer feeds waveform + onsets).
        S.audioUrl = url;
        S.masterAudioUrl = url;
        S.activeAudioSourceId = 'master';
        S.activeAudioSourceOffset = 0;
        _resetAuditionForNewSong();   // a per-song pref never carries across loads
        // A new recording is loaded — re-arm the hearing-safety fade so it
        // applies to this recording too, not just the session's first one.
        _mixResetFirstPlay();
        host.editorApplyScrollBounds();
        computeWaveform();
        return true;
    } catch (e) {
        if (e && e.name !== 'AbortError') console.error('Audio load error:', e);
        return false;
    } finally {
        if (generation === audioLoadGeneration) audioLoadController = null;
    }
}

export function cancelAudioLoad() {
    audioLoadGeneration++;
    if (audioLoadController) {
        try { audioLoadController.abort(); } catch (_) {}
        audioLoadController = null;
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

export function computeWaveform() {
    if (!S.audioBuffer) return;
    const data = S.audioBuffer.getChannelData(0);
    // ~3 ms per bin: fine enough that each pixel covers ≥1 bin even at high
    // zoom, yet bounded (≈1 MB of typed arrays for a 5-minute song).
    const binSamples = Math.max(64, Math.round(S.audioBuffer.sampleRate * 0.003));
    S.waveformPeaks = _buildWaveformPeaks(data, binSamples);
    // New audio ⇒ any in-flight analysis is now chewing on the wrong buffer. The
    // CACHE needs no reset: _ensureOnsets() keys it on the source identity, so it
    // invalidates itself here AND on the paths that never reach computeWaveform
    // (loadCDLC, create import, audio clear).
    _cancelOnsetJob();
}

/* @pure:onset-strip:start */
// Transient/onset estimation from the waveform RMS cache — a cheap
// client-side "where do events probably live" hint (no server round-trip,
// no DSP deps). An onset fires where the RMS rises sharply above the local
// baseline (the mean of the preceding window), gated by an absolute noise
// floor and a refractory gap so one attack registers once. Returns
// [{t, s}] — time in seconds and a 0..1 strength.
function _onsetTimesFromPeaksPure(rms, binSec, opts) {
    if (!rms || !rms.length || !(binSec > 0)) return [];
    const o = opts || {};
    const baselineBins = Math.max(2, o.baselineBins || 16);
    const ratio = o.ratio || 1.5;
    const floorFrac = o.floorFrac || 0.05;
    const riseFrac = o.riseFrac || 0.03;
    const minGapSec = o.minGapSec || 0.05;
    let global = 0;
    for (let i = 0; i < rms.length; i++) if (rms[i] > global) global = rms[i];
    if (!(global > 0)) return [];
    const floor = global * floorFrac;
    const refractory = Math.max(1, Math.round(minGapSec / binSec));
    const out = [];
    let sum = 0;
    for (let i = 0; i < Math.min(baselineBins, rms.length); i++) sum += rms[i];
    let lastOnset = -Infinity;
    for (let i = baselineBins; i < rms.length; i++) {
        const base = sum / baselineBins;
        const v = rms[i];
        if (v > floor && v > rms[i - 1]
                && v > base * ratio && v - base > global * riseFrac
                && i - lastOnset >= refractory) {
            out.push({
                t: i * binSec,
                s: Math.max(0, Math.min(1, (v - base) / global)),
            });
            lastOnset = i;
        }
        // Slide the baseline window.
        sum += v - rms[i - baselineBins];
    }
    return out;
}
/* @pure:onset-strip:end */

/* @pure:onset-snap:start */
// Nearest-onset snap: given time-sorted onsets [{t,...}], return the onset
// time nearest to `t` when it lies within `tol` seconds, else null (the caller
// falls back to grid snap). Binary-searches the sorted onsets so the hot drag
// path stays O(log n). Guards non-finite t, empty onsets, and tol <= 0.
export function _nearestOnsetTimePure(onsets, t, tol) {
    if (!Array.isArray(onsets) || onsets.length === 0) return null;
    if (!Number.isFinite(t) || !(tol > 0)) return null;
    // First onset with .t >= t.
    let lo = 0, hi = onsets.length;
    while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (onsets[mid].t < t) lo = mid + 1; else hi = mid;
    }
    // The nearest onset is one of onsets[lo-1] (last before t) / onsets[lo].
    let best = null, bestD = Infinity;
    for (let i = lo - 1; i <= lo; i++) {
        if (i < 0 || i >= onsets.length) continue;
        const o = onsets[i];
        if (!o || !Number.isFinite(o.t)) continue;
        const d = Math.abs(o.t - t);
        if (d < bestD) { bestD = d; best = o.t; }
    }
    return bestD <= tol ? best : null;
}
/* @pure:onset-snap:end */

// ── Onset strip toggle + lazy cache ──────────────────────────────────
let _onsetCache = null;    // [{t, s, bands?}] for the source in _onsetCacheKey
let _onsetCacheKey = null; // the S.audioBuffer (or peaks) the cache was computed from
let _onsetStripOn = null;  // cached enabled flag; null until first read

export function _onsetStripEnabled() {
    // Cache the flag so the draw path (every frame during playback) doesn't
    // hit localStorage synchronously. Seeded once from storage, then kept in
    // sync by _editorToggleOnsetStrip.
    if (_onsetStripOn === null) {
        try { _onsetStripOn = localStorage.getItem('editorOnsetStrip') === '1'; }
        catch (_) { _onsetStripOn = false; }
    }
    return _onsetStripOn;
}

// Which detector produced the current cache — 'spectral-flux' (banded, PCM) or
// 'rms' (the pass-1 envelope fallback). Read for the status/debug surface.
let _onsetDetector = null;
export function _onsetDetectorLabel() { return _onsetDetector; }

// The in-flight banded-onset analysis (chunked across timer ticks), or null.
// Cancelled on a new load / teardown via its `cancelled` flag.
let _onsetJob = null;

export function _ensureOnsets() {
    // Key the cache on the analysed source itself, not on a hand-maintained
    // invalidation. computeWaveform() is NOT the only way the audio changes:
    // loadCDLC (file-ops.js) and the create-mode import (create.js) both drop
    // S.audioBuffer/S.waveformPeaks directly, and computeWaveform() early-returns
    // when there is no buffer — so a plain `if (_onsetCache) return _onsetCache`
    // hands the PREVIOUS song's onsets to the onset strip, onset-snap, tempo-snap
    // and Sync phase. Identity check here fixes every caller at once.
    const key = S.audioBuffer || S.waveformPeaks || null;
    if (_onsetCache && _onsetCacheKey === key) return _onsetCache;
    // The source moved, so any in-flight job is analysing the OLD one. Its own
    // per-resume buffer check would bail it anyway; dropping it here stops it
    // burning ticks first.
    _cancelOnsetJob();
    _onsetCache = null; _onsetCacheKey = null; _onsetDetector = null;
    const dur = (S.audioBuffer && S.audioBuffer.duration) || S.duration || 0;
    if (!key || dur <= 0) return null;
    // Return the cheap RMS-envelope onsets IMMEDIATELY (zero delay for the strip /
    // snap), and upgrade to banded spectral-flux (P2-2) in the BACKGROUND — the
    // few-hundred-ms STFT is chunked across timer ticks so it never freezes a
    // frame, then replaces the cache and repaints. No buffer ⇒ RMS is the answer.
    const pk = S.waveformPeaks;
    _onsetCache = (pk && pk.bins && pk.rms) ? _onsetTimesFromPeaksPure(pk.rms, dur / pk.bins) : [];
    _onsetCacheKey = key;
    _onsetDetector = 'rms';
    if (S.audioBuffer) _startOnsetFluxJob();
    return _onsetCache;
}

// Kick off the banded spectral-flux analysis, chunked across timer ticks.
// Downsamples once (cheap O(N)), then steps the STFT a bounded number of frames
// per tick; on completion swaps in the sharper onsets and redraws.
// setTimeout, not rAF: rAF is frozen in a backgrounded window (the job would
// stall until the editor is looked at again) and doesn't exist under node, and
// a chunk that runs BETWEEN frames costs the paint less than one that runs in it.
function _startOnsetFluxJob() {
    const buf = S.audioBuffer;
    if (!buf) return;
    let plan;
    // Same plan _spectralFluxOnsetsPure() builds — the chunked driver below is the
    // ONLY thing that differs between the sync and background paths.
    try { plan = _spectralFluxOnsetsPlan(buf.getChannelData(0), buf.sampleRate); }
    catch (_) { return; }                 // stay on RMS if setup fails
    const job = { cancelled: false };
    _onsetJob = job;
    const FRAMES_PER_TICK = 1500;         // a few ms of FFT work per tick
    const step = () => {
        // Precondition re-check on every resume: the session can swap the audio out
        // WITHOUT going through computeWaveform/teardownAudio — loading an
        // audio-less song just nulls S.audioBuffer (file-ops.js, create.js) — so the
        // cancelled flag alone doesn't catch it. Onsets for a buffer that is no
        // longer the session's must never land in the session's cache.
        // (…and only ever clear the handle if it is still OURS — a cancelled job's
        // last tick must not null out the replacement job that took its place.)
        if (job.cancelled || S.audioBuffer !== buf) { if (_onsetJob === job) _onsetJob = null; return; }
        let done = false;
        try { done = _spectralFluxStep(plan, FRAMES_PER_TICK); }
        catch (_) { _onsetJob = null; return; }   // keep the RMS cache on error
        if (!done) { setTimeout(step, 0); return; }
        _onsetJob = null;
        let onsets = null;
        try { onsets = _pickOnsetsPure(plan.res, {}); } catch (_) { onsets = null; }
        if (onsets && onsets.length) {
            _onsetCache = onsets;
            _onsetCacheKey = buf;         // stamp the source we actually analysed
            _onsetDetector = 'spectral-flux';
            if (host && typeof host.draw === 'function') host.draw();   // repaint with the sharper onsets
        }
    };
    setTimeout(step, 0);
}

// Cancel any in-flight analysis (new audio / teardown) — the next step bails.
function _cancelOnsetJob() {
    if (_onsetJob) { _onsetJob.cancelled = true; _onsetJob = null; }
}

// Onsets in CHART/timeline time — buffer-time onsets plus the audio placement
// shift — for everything that relates a detected attack to a musical position
// (Suggest-fit, onset snap, Sync phase). Returns the raw cached array UNCHANGED
// when there is no shift (the common case → zero allocation on hot paths); only
// maps when the recording has been slid. The buffer-time `_ensureOnsets()` cache
// stays the source of truth (memoized on the peaks); the shift is applied on read
// so it always tracks the live S.audioShift.
export function _ensureOnsetsShifted() {
    const raw = _ensureOnsets();
    const sh = (Number(S.audioShift) || 0) + (Number(S.activeAudioSourceOffset) || 0);
    if (!raw || !sh) return raw;
    return raw.map(o => ({ ...o, t: o.t + sh }));   // carry s + per-band strengths
}

// ── Metronome-guide analysis (analysis-only; never touches playback) ──
// The tempo guide can be a STEM, and the transport still owns exactly one
// decoded buffer (the session recording). Guide analysis therefore decodes
// the guide source into a LOCAL buffer and runs the same pure spectral-flux
// pipeline against it — S.audioBuffer / S.waveformPeaks / playback are never
// touched, so locking a click stem as the guide can't reroute what the user
// hears or sees. One-slot cache keyed by (sourceId, url); a generation token
// guards the async fetch+decode+STFT against song switches and re-requests.
let _guideOnsetCache = null;   // { sourceId, url, onsets }  (buffer-time)
let _guideGeneration = 0;
let _guideInflight = null;     // { sourceId, url, promise } — coalesce concurrent same-guide requests

// New song boundary: drop the cache and orphan any in-flight guide job so a
// previous song's decode can never land on the current one.
export function _guideAnalysisReset() {
    _guideOnsetCache = null;
    _guideInflight = null;
    _guideGeneration++;
}

// Coalesce concurrent requests for the SAME (sourceId, url): a second G press
// before the first decode lands must reuse the in-flight promise, not start a
// rival generation that supersedes — and null out — the first. Different guides
// (or a song switch, which resets _guideInflight) still supersede via the token.
export function ensureGuideOnsets(sourceId, url) {
    if (!sourceId || !url) return Promise.resolve(null);
    if (_guideOnsetCache && _guideOnsetCache.sourceId === sourceId
            && _guideOnsetCache.url === url) {
        return Promise.resolve(_guideOnsetCache.onsets);
    }
    if (_guideInflight && _guideInflight.sourceId === sourceId && _guideInflight.url === url) {
        return _guideInflight.promise;
    }
    const promise = _computeGuideOnsets(sourceId, url);
    _guideInflight = { sourceId, url, promise };
    const clear = () => { if (_guideInflight && _guideInflight.promise === promise) _guideInflight = null; };
    promise.then(clear, clear);
    return promise;
}

async function _computeGuideOnsets(sourceId, url) {
    const generation = ++_guideGeneration;
    let decoded;
    try {
        _ensureAudioCtx();
        const resp = await fetch(url);
        if (!resp.ok) return null;
        const raw = await resp.arrayBuffer();
        decoded = await S.audioCtx.decodeAudioData(raw);
    } catch (_) { return null; }
    if (generation !== _guideGeneration) return null;   // superseded mid-decode
    // Same chunked STFT the session buffer gets (setTimeout ticks, never
    // freeze a frame) — awaitable here because the G handler shows progress
    // and revalidates its own preconditions after the await.
    let plan;
    try { plan = _spectralFluxOnsetsPlan(decoded.getChannelData(0), decoded.sampleRate); }
    catch (_) { return null; }
    const FRAMES_PER_TICK = 1500;
    const onsets = await new Promise((resolve) => {
        const step = () => {
            if (generation !== _guideGeneration) { resolve(null); return; }
            let done = false;
            try { done = _spectralFluxStep(plan, FRAMES_PER_TICK); }
            catch (_) { resolve(null); return; }
            if (!done) { setTimeout(step, 0); return; }
            try { resolve(_pickOnsetsPure(plan.res, {})); } catch (_) { resolve(null); }
        };
        setTimeout(step, 0);
    });
    if (!onsets || !onsets.length || generation !== _guideGeneration) return null;
    _guideOnsetCache = { sourceId, url, onsets };
    return onsets;
}

// Guide onsets in CHART time — the guide rides the same session timeline as
// the recording, so the same placement shift applies on read (mirror of
// _ensureOnsetsShifted).
export async function ensureGuideOnsetsShifted(sourceId, url, sourceOffset = 0) {
    const raw = await ensureGuideOnsets(sourceId, url);
    const sh = (Number(S.audioShift) || 0) + (Number(sourceOffset) || 0);
    if (!raw || !sh) return raw;
    return raw.map(o => ({ ...o, t: o.t + sh }));
}

export function _refreshOnsetBtn() {
    const btn = document.getElementById('editor-onset-btn');
    if (!btn) return;
    const on = _onsetStripEnabled();
    btn.classList.toggle('bg-accent', on);
    btn.classList.toggle('hover:bg-accent-light', on);
    btn.classList.toggle('bg-dark-600', !on);
    btn.classList.toggle('hover:bg-dark-500', !on);
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
}

export function _editorToggleOnsetStrip() {
    const next = !_onsetStripEnabled();
    _onsetStripOn = next;
    if (next) _tourNoteAction('onsets');   // C3 Transcribe tour: step 1 task
    try { localStorage.setItem('editorOnsetStrip', next ? '1' : '0'); } catch (_) {}
    _refreshOnsetBtn();
    host.draw();
    setStatus(next
        ? 'Onset strip on — amber blocks mark detected attacks in the recording (display only)'
        : 'Onset strip off');
    return true;
}
// window.editorToggleOnsetStrip re-attached in main.js

// ── Snap target: grid ↔ audio onset ──────────────────────────────────
export function _refreshSnapModeBtn() {
    const btn = document.getElementById('editor-snapmode-btn');
    if (!btn) return;
    const onset = S.snapMode === 'onset';
    btn.textContent = onset ? 'Onset' : 'Grid';
    btn.classList.toggle('bg-accent', onset);
    btn.classList.toggle('hover:bg-accent-light', onset);
    btn.classList.toggle('bg-dark-600', !onset);
    btn.classList.toggle('hover:bg-dark-500', !onset);
    btn.setAttribute('aria-pressed', onset ? 'true' : 'false');
}

export function _editorToggleSnapMode() {
    S.snapMode = S.snapMode === 'onset' ? 'grid' : 'onset';
    if (S.snapMode === 'onset') _tourNoteAction('snapOnset');   // C3 Transcribe tour: final task
    try { localStorage.setItem('editorSnapMode', S.snapMode); } catch (_) {}
    _refreshSnapModeBtn();
    if (S.snapMode === 'onset') {
        const onsets = _ensureOnsets();
        setStatus(onsets && onsets.length
            ? 'Snap to onset — placement snaps to the nearest detected attack (falls back to grid when none is near)'
            : 'Snap to onset — no transients detected yet (load a recording, turn on Onsets); snapping to grid until then');
    } else {
        setStatus('Snap to grid — placement snaps to the tempo-map subdivisions');
    }
    return true;
}
// window.editorToggleSnapMode re-attached in main.js


/* @pure:audio-shift:start */
// Where to start the buffer given the playhead chart-time, the audio placement
// shift, and the buffer length. The audio plays buffer-time (cursorTime -
// audioShift): a positive shift slides the recording LATER, so the chart runs
// ahead of the audio and the source start is delayed; a negative shift skips
// into the buffer. Returns { play, offset, delay } — `play:false` when the
// (shifted) audio has already ended at this chart position, so no source is
// created and only the transport clock runs.
export function _audioBufferStartPure(cursorTime, audioShift, bufferDuration) {
    const bufOff = (Number(cursorTime) || 0) - (Number(audioShift) || 0);
    const dur = Number(bufferDuration) || 0;
    if (dur > 0 && bufOff >= dur) return { play: false, offset: 0, delay: 0 };
    if (bufOff < 0) return { play: true, offset: 0, delay: -bufOff };
    return { play: true, offset: bufOff, delay: 0 };
}

// Effective timeline length for shifted audio. A positive shift delays the
// recording, so its tail ends after the raw buffer duration; negative shifts
// crop the front but do not shrink the chart the user already has.
export function _audioTimelineDurationPure(timelineDuration, audioShift, bufferDuration) {
    const base = Math.max(0, Number(timelineDuration) || 0);
    const dur = Math.max(0, Number(bufferDuration) || 0);
    const sh = Number(audioShift) || 0;
    const shiftedEnd = dur > 0 ? dur + Math.max(0, sh) : 0;
    return Math.max(base, shiftedEnd);
}
/* @pure:audio-shift:end */

function _audioTimelineDuration() {
    return _audioTimelineDurationPure(S.duration, S.audioShift, S.masterAudioDuration || S.duration);
}

// ── Audition speed (design slice 5): pitch-preserving slow practice ──────────
// Playback-only, ≤100%, one toggle back to 100%. Never touches source time, the
// tempo map, exported audio, or dirty state — it is an editor pref, not pack
// data. The clock (_transportChartTimePure / _guideChartToCtxPure) carries the
// rate; the reference audio reroutes onto a MediaElement (preservesPitch) only
// when slowed — the sample-accurate AudioBufferSource path stays the rate-1
// default (zero regression).
export const AUDITION_PRESETS = [1, 0.75, 0.5];

// ── Output-latency compensation for the VISUAL playhead ──────────────────────
// audioCtx.currentTime is when samples are HANDED TO the output; the sound is
// HEARD one output buffer later (~10-30ms wired, 100-300ms on Bluetooth). The
// marker is drawn from the ctx clock, so it leads the ear by that latency. We
// compensate the PAINT ONLY: S.cursorDrawTime (drawn line) subtracts the held
// latency; S.cursorTime (placement / snap / edit / scheduling truth) is never
// touched. All heard audio — reference, claps, metronome — shares this latency,
// so one offset re-aligns the marker to everything at once. Sampled-and-held per
// play pass (a raw per-frame read shimmers); baseLatency fallback, NaN-guarded.
let _heldOutputLatency = 0;
function _readOutputLatency() {
    const ctx = S.audioCtx;
    if (!ctx) return 0;
    const ol = Number(ctx.outputLatency);
    if (Number.isFinite(ol) && ol > 0) return ol;
    const bl = Number(ctx.baseLatency);
    return Number.isFinite(bl) && bl > 0 ? bl : 0;
}

export function _auditionRate() {
    const r = Number(S.auditionRate);
    // Clamp to (0, 1]: a practice slow-downer never speeds up, and never to 0.
    return Number.isFinite(r) && r > 0 && r <= 1 ? r : 1;
}
function _auditionActive() { return _auditionRate() < 1 && !!S.audioUrl && !!S.audioBuffer; }

// The hidden <audio> the reference rides for pitch-preserving slowdown, and its
// one MediaElementSourceNode (a node can be made from an element only once, so
// both are memoised for the session's context).
let _refMediaEl = null;
let _refMediaNode = null;
// The src we last ASSIGNED. Never compare against el.src: the getter returns the
// RESOLVED absolute URL, so a relative audio_url (the server's normal form)
// would mismatch on every call and re-assign src — reloading the element and
// stalling playback on every seek/loop-wrap. Compare what we set, not what it echoes.
let _refMediaSrc = null;
let _refMediaPlayTimer = null;   // the deferred play() (count-in / +ve audio shift)
function _ensureRefMedia() {
    if (!S.audioCtx || !S.audioUrl || typeof Audio !== 'function') return null;
    if (!_refMediaEl) {
        _refMediaEl = new Audio();
        _refMediaEl.crossOrigin = 'anonymous';
        _refMediaEl.preload = 'auto';
    }
    if (_refMediaSrc !== S.audioUrl) { _refMediaEl.src = S.audioUrl; _refMediaSrc = S.audioUrl; }
    if (!_refMediaNode) {
        try { _refMediaNode = S.audioCtx.createMediaElementSource(_refMediaEl); }
        catch (_) { _refMediaNode = null; return null; }
        _refMediaNode.connect(_activeRefTarget() || S.audioCtx.destination);
    }
    return _refMediaEl;
}
function _stopRefMedia() {
    // Kill the deferred play() FIRST — pausing an element whose start is still
    // queued would otherwise let the timer resume audio after an explicit stop /
    // teardown / song change (CodeRabbit).
    if (_refMediaPlayTimer) { clearTimeout(_refMediaPlayTimer); _refMediaPlayTimer = null; }
    if (_refMediaEl) { try { _refMediaEl.pause(); } catch (_) {} }
}
// Slave the media element to the authoritative ctx/chart clock: seek it to the
// SOURCE offset for the current cursor, set preservesPitch + playbackRate, play
// (honouring a positive audio-shift delay). Returns true if it took the source.
function _startRefMediaAt(st, preRoll = 0) {
    const el = _ensureRefMedia();
    if (!el) return false;
    // The active source may have changed since the media node was wired — re-point
    // it at the current active source's per-source gain so its strip fader applies.
    if (_refMediaNode) {
        try { _refMediaNode.disconnect(); } catch (_) { /* not connected yet */ }
        _refMediaNode.connect(_activeRefTarget() || S.audioCtx.destination);
    }
    if (_refMediaPlayTimer) { clearTimeout(_refMediaPlayTimer); _refMediaPlayTimer = null; }
    const r = _auditionRate();
    el.preservesPitch = true;
    el.mozPreservesPitch = true;
    el.webkitPreservesPitch = true;
    el.playbackRate = r;
    try { el.currentTime = Math.max(0, st.offset); } catch (_) { /* not seekable yet */ }
    const go = () => { const p = el.play(); if (p && p.catch) p.catch(() => {}); };
    const wait = (Number(preRoll) || 0) + (st.delay > 0 ? st.delay : 0);
    if (wait > 0) _refMediaPlayTimer = setTimeout(() => { _refMediaPlayTimer = null; go(); }, wait * 1000);
    else go();
    return true;
}
// The ctx/chart clock is authoritative; the element is slaved. Each tick, if the
// element has drifted from the SOURCE offset for the current cursor by more than
// ~30 ms (a hidden-tab stall, a ratechange settling), re-seat it — bounded and
// inaudible. Placement/snapping is always resolved from the source clock, never
// from where the ear lands in the stretched signal.
function _auditionResyncMedia() {
    if (!_auditionActive() || !_refMediaEl || _refMediaEl.paused) return;
    const st = _audioBufferStartPure(S.cursorTime,
        (Number(S.audioShift) || 0) + (Number(S.activeAudioSourceOffset) || 0),
        S.audioBuffer && S.audioBuffer.duration);
    if (!st.play) return;
    if (Math.abs(_refMediaEl.currentTime - st.offset) > 0.03) {
        try { _refMediaEl.currentTime = Math.max(0, st.offset); } catch (_) { /* seeking */ }
    }
}

// Verb: set the audition speed (≤1). An editor pref — never stored in the pack,
// never marks dirty. Re-seats a live playback onto the right engine path so the
// change is heard immediately.
export function editorSetAuditionRate(rate) {
    const r = Number(rate);
    const next = Number.isFinite(r) && r > 0 && r <= 1 ? r : 1;
    if (next === _auditionRate()) { _auditionRefreshUi(); return; }
    S.auditionRate = next;
    if (S.playing) _restartPlaybackAt(S.cursorTime);   // swap engine path live
    _auditionRefreshUi();
    // The restart can DEMOTE the rate (no slow path for this recording) — it has
    // already said so; don't overwrite that with a cheery "50%" it isn't playing.
    const eff = _auditionRate();
    if (eff !== next) return;
    const pct = Math.round(eff * 100);
    setStatus(eff < 1
        ? `Audition ${pct}% — slowed for practice, pitch preserved (playback only; the chart is unchanged).`
        : 'Audition 100% — full speed.');
}
export function editorAuditionRate() { return _auditionRate(); }
// Reset to full speed when a new song loads (a per-song pref never persists).
export function _resetAuditionForNewSong() {
    S.auditionRate = 1;
    _trainerDisarm();   // an armed trainer without its ladder would only spam the status line
    _stopRefMedia();
    _auditionRefreshUi();
}
function _auditionRefreshUi() {
    const sel = document.getElementById('editor-audition-speed');
    if (sel) {
        const v = String(_auditionRate());
        if (sel.value !== v) sel.value = v;
    }
    if (host && typeof host.updateTimeDisplay === 'function') host.updateTimeDisplay();
}

export function _startAudioSourceAtCursor(preRoll = 0) {
    // Slide the recording by S.audioShift (the chart clock, anchored below, is
    // untouched — only the buffer read position moves). A positive shift can
    // push the audio start into the future (delay) or, near the end, past the
    // buffer entirely (no source; the transport still runs so the cursor and
    // guide advance over the trailing silence).
    const st = _audioBufferStartPure(S.cursorTime,
        (Number(S.audioShift) || 0) + (Number(S.activeAudioSourceOffset) || 0),
        S.audioBuffer && S.audioBuffer.duration);
    let slow = _auditionActive();
    if (slow && st.play) {
        // Pitch-preserving slow path: the reference rides the MediaElement, so
        // the sample-accurate BufferSource is silenced. Both feed the SAME
        // _refGain, so the mixer fader / A-B mute / first-play fade still apply.
        if (S.audioSource) { try { S.audioSource.stop(); } catch (_) {} S.audioSource = null; }
        _mixApplyFirstPlayFade();
        if (!_startRefMediaAt(st, preRoll)) {
            // Slow path unavailable (no <audio> ctor, or the context refused a
            // MediaElementSource — CORS-tainted media). DEMOTE to 100% and fall
            // through to the BufferSource: silence under a half-speed clock is the
            // one failure mode this must never ship.
            slow = false;
            S.auditionRate = 1;
            _auditionRefreshUi();
            setStatus('Audition speed is unavailable for this recording — playing at 100%.');
        }
    }
    if (!slow && st.play) {
        _stopRefMedia();   // rate 1 → the slow-path element must be silent
        S.audioSource = S.audioCtx.createBufferSource();
        S.audioSource.buffer = S.audioBuffer;
        // Reference recording stays on a transparent path to destination — its
        // mixer fader is a plain gain (unity by default): the guide-clap limiter
        // must never color the recording, even when claps are off. Only the
        // guide/click voices sum through the limiter (see _ensureMasterBus).
        const target = _activeRefTarget();
        if (target) S.audioSource.connect(target);
        else S.audioSource.connect(S.audioCtx.destination);
        _mixApplyFirstPlayFade();
        const when = (preRoll > 0 || st.delay > 0) ? S.audioCtx.currentTime + preRoll + st.delay : 0;
        S.audioSource.start(when, st.offset);
    } else if (!st.play) {
        _stopRefMedia();
        S.audioSource = null;
    }
    // Studio stems ride alongside the master on the sample-accurate path —
    // same anchor, so they stay aligned. Not on the audition-slow path (the
    // BufferSource is silenced there); a slow-then-fast toggle restarts them.
    if (slow) _stopStemSources();
    else _startStemSources(preRoll);
    _anchorTransportAtCursor(preRoll);
}

// Undoable audio placement shift. Song-scoped (it's not tied to one arrangement)
// and a pure scalar move — no beats/notes change. Re-seats a live audio source so
// the new placement is heard immediately, and redraws the (shifted) waveform.
export class AudioShiftCmd {
    constructor(oldShift, newShift) {
        this.oldShift = Number(oldShift) || 0;
        this.newShift = Number(newShift) || 0;
        this.songScope = true;
    }
    exec() { S.audioShift = this.newShift; _afterAudioShiftChange(); }
    rollback() { S.audioShift = this.oldShift; _afterAudioShiftChange(); }
}
function _afterAudioShiftChange() {
    // If playing, restart the source at the cursor so the buffer offset updates
    // mid-playback (the transport clock/cursor are untouched — only the audio moves).
    if (S.playing) _restartPlaybackAt(S.cursorTime);
    if (host && typeof host.editorApplyScrollBounds === 'function') host.editorApplyScrollBounds();
    if (host && typeof host.draw === 'function') host.draw();
}

// Verb: set the absolute audio shift (seconds, 1ms resolution), undoably.
export function editorSetAudioShift(val) {
    const next = Math.round((parseFloat(val) || 0) * 1000) / 1000;
    const cur = Number(S.audioShift) || 0;
    if (Math.abs(next - cur) < 1e-4) return;
    S.history.exec(new AudioShiftCmd(cur, next));
    setStatus(`Audio shifted ${next >= 0 ? '+' : ''}${(next * 1000).toFixed(0)}ms — recording moved, chart unchanged.`);
}
export function editorNudgeAudioShift(delta) {
    editorSetAudioShift((Number(S.audioShift) || 0) + (Number(delta) || 0));
}

// Anchor the transport clock at the current cursor: pin wall-time to the
// AudioContext clock and chart-time to cursorTime, so playbackTick can derive
// the cursor from the ctx clock. In buffered mode this rides alongside the
// BufferSource; in compose mode it IS the whole clock (there is no source).
// Every (re)start is a seek from the clap scheduler's perspective, so drop
// already-queued voices and restart the window at the new cursor — otherwise
// claps scheduled before a loop wrap / seek fire at their old positions
// ("ghost claps").
export function _anchorTransportAtCursor(preRoll = 0) {
    // A positive preRoll pins the wall anchor IN THE FUTURE: the whole
    // chart→ctx time mapping (source, guide scheduler, record clock) shifts
    // with it, so a count-in needs no other plumbing. During the pre-roll
    // playbackTick clamps the cursor at the start position.
    S.playStartWall = S.audioCtx.currentTime + preRoll;
    S.playStartTime = S.cursorTime;
    // Sample the output latency once per (re)start and hold it for the pass, so
    // the compensated marker doesn't shimmer as the estimate settles frame to frame.
    _heldOutputLatency = _readOutputLatency();
    // Re-seat the PAINT clock with the logical one. A loop wrap paints
    // synchronously (host.drawNow) before the next tick recomputes it, so a stale
    // cursorDrawTime would flash the marker at the old position for one frame.
    S.cursorDrawTime = S.cursorTime;
    _guideResetSchedule();
}

// Resolve compose-mode duration from live state: the grid end via the A1
// converter (timeOf of the last beat), the last authored event on the active
// surface, and an optional user-set length (S.composeLength). Buffered mode
// never calls this — there S.duration is the recording's own length.
export function _composeSongDuration() {
    const userLen = (typeof S.composeLength === 'number') ? S.composeLength : NaN;
    const gridEnd = (S.beats && S.beats.length >= 2)
        ? timeOf(S.beats, S.beats.length - 1)
        : 0;
    let contentEnd = 0;
    for (const t of _guideSourceTimes()) if (t > contentEnd) contentEnd = t;
    return _composeSongDurationPure(gridEnd, contentEnd, userLen);
}

export function _restartPlaybackAt(t) {
    if (S.audioSource) {
        try { S.audioSource.stop(); } catch (_) {}
        S.audioSource = null;
    }
    _stopStemSources();   // re-scheduled by _startAudioSourceAtCursor below
    S.cursorTime = Math.max(0, Math.min(_audioTimelineDuration() || Infinity, t));
    // Compose mode re-anchors the clock without a BufferSource — the guide/
    // click scheduler is the only sound (charrette §1.7).
    if (S.audioBuffer) _startAudioSourceAtCursor();
    else _anchorTransportAtCursor();
}

export function startPlayback() {
    // Compose mode (no recording) still needs a context — for the transport
    // clock and the metronome/guide voices that are its only sound. Make one
    // on the play gesture; the decode path is the only other creation site.
    _ensureAudioCtx();
    if (!S.audioCtx) return;                        // no Web Audio available at all
    const composing = !S.audioBuffer;
    if (composing) {
        // No buffer to bound the song: the grid defines its length (§1.7).
        S.duration = _composeSongDuration();
        if (!(S.duration > 0)) return;              // empty grid + no content — nothing to play
    }
    if (S.audioCtx.state === 'suspended') S.audioCtx.resume();
    const region = host.selectedLoopRegion();
    if (S.loopEnabled && region && (S.cursorTime < region.startTime || S.cursorTime >= region.endTime)) {
        S.cursorTime = region.startTime;
    }
    // Count-in (D3-adjacent; the charrette's Count): N bars of clicks in the
    // meter/tempo at the cursor BEFORE anything sounds. The shifted transport
    // anchor does the rest. Loop wraps and mid-play seeks route through
    // _restartPlaybackAt and stay immediate.
    let preRoll = 0;
    let countClicks = null;
    const countBars = editorCountInBars();
    if (countBars > 0) {
        const plan = _countInPlanPure(S.beats, S.cursorTime, countBars);
        if (plan) { preRoll = plan.duration; countClicks = plan.clicks; }
    }
    if (composing) {
        // No reference recording ⇒ no A/B pass to arm; just anchor the clock so
        // playbackTick advances the cursor and the guide/click scheduler (the
        // only sound here) fires off the grid.
        _anchorTransportAtCursor(preRoll);
    } else {
        // Every (re)start — including seeks, which route through here — begins
        // an A/B cycle on the RECORDING pass, so the user always hears the real
        // thing first from a fresh position. Reset BEFORE the first tick /
        // scheduler sync so _guideTick can never schedule a guide pass off a
        // stale phase, and so the first-play fade (in _startAudioSourceAtCursor)
        // is the last automation written to the ref gain, not clobbered by this.
        _abPhase = 'recording';
        _abApplyRefGain();
        _startAudioSourceAtCursor(preRoll);
    }
    // Schedule the count-in clicks AFTER the anchor: both branches run
    // _guideResetSchedule() → _guideCancelVoices(), which stops every voice in
    // _guideVoices. Scheduling before that (the obvious spot) would cancel the
    // clicks before they sound — a silent count-in. Nothing between here and
    // playback start cancels voices, so these survive to fire during the pre-roll.
    if (countClicks) {
        const base = S.audioCtx.currentTime;
        for (const c of countClicks) _metroClickVoiceAt(base + c.at, c.accent);
    }
    S.playing = true;
    updatePlayIcon();
    playbackTick();
    _guideTimerSync();
}
export function stopPlayback() {
    if (S.audioSource) {
        try { S.audioSource.stop(); } catch (_) {}
        S.audioSource = null;
    }
    _stopStemSources();
    _stopRefMedia();
    S.playing = false;
    updatePlayIcon();
    if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
    _guideTimerSync();
    _guideCancelVoices();
    // Restore the reference to its fader level (a stop mid-guide-pass must
    // never leave the recording silently muted).
    _abApplyRefGain();
}

export function playbackTick() {
    if (!S.playing) return;
    // Clamped at the start position while a count-in pre-roll runs (the
    // anchor sits in the future, so the raw chart time would read negative).
    S.cursorTime = Math.max(S.playStartTime,
        _transportChartTimePure(S.playStartTime, S.playStartWall, S.audioCtx.currentTime, _auditionRate()));
    // Paint-only: where the audio LEAVING THE SPEAKER now sits (ctxNow − latency),
    // so the drawn line matches what's heard. Logic still uses S.cursorTime.
    S.cursorDrawTime = _cursorDrawTimePure(
        S.playStartTime, S.playStartWall, S.audioCtx.currentTime, _heldOutputLatency, _auditionRate());
    _auditionResyncMedia();
    const timelineEnd = _audioTimelineDuration();
    const loopRestart = _recState === 'recording'
        ? null
        : _loopPlaybackRestartTimePure(S.cursorTime, S.barSel, S.loopEnabled, timelineEnd);
    if (loopRestart !== null) {
        // A/B compare flips its pass BEFORE the restart so the ramped
        // reference mute/unmute lands with the wrap, not a frame late.
        _abOnLoopWrap();
        // Trainer (P2-10): count the completed pass and maybe step the rate —
        // BEFORE the restart, which re-anchors the clock at the new rate. Seat
        // the cursor at the wrap FIRST: a rate step re-seats live playback at
        // S.cursorTime, which still sits PAST the loop end here — restarting
        // there would burst a few ms of audio from beyond the loop.
        S.cursorTime = loopRestart;
        _trainerOnLoopWrap();
        // Bring the view back with the cursor when the loop start is off-screen.
        // BOTH wrap paths below return before the follow block at the end of the
        // tick, so this is the only frame that can scroll — and the restart is
        // measured against the CURRENT scrollX, so it has to run before the
        // clamp writes a new one.
        {
            const viewW = canvas ? canvas.width / DPR : 800;
            const target = _scrollInPlayActive()
                ? _scrollInPlayTargetPure(loopRestart, viewW, S.zoom, editorFollowEnabled())
                : _loopWrapScrollTargetPure(
                    loopRestart, timeToX(loopRestart), viewW, S.zoom, editorFollowEnabled());
            if (target !== null) S.scrollX = host.editorClampScrollX(target);
        }
        if (_trainerWrapWantsCountIn()) {
            // Route the pass through the full start path so the armed
            // count-in pre-roll precedes it (at the slowed tempo — the
            // count-in clicks ride the same rate transform as everything).
            // startPlayback restarts the A/B cycle on the recording pass; the
            // wrap already flipped the phase, so carry it across the restart or
            // A/B would never reach a guide pass while the trainer runs.
            const abPhase = _abPhase;
            stopPlayback();
            S.cursorTime = loopRestart;
            startPlayback();
            if (_abActive()) { _abPhase = abPhase; _abApplyRefGain(); }
            host.updateTimeDisplay();
            host.drawNow();
            return;   // startPlayback scheduled its own tick.
        }
        _restartPlaybackAt(loopRestart);
        host.updateTimeDisplay();
        // playbackTick already runs once per animation frame — paint
        // synchronously rather than queueing a second rAF via host.draw().
        host.drawNow();
        rafId = requestAnimationFrame(playbackTick);
        return;
    }
    if (S.cursorTime >= timelineEnd) {
        // If a live MIDI recording is active, finalize it at the song end
        // before resetting the cursor — otherwise chartTimeNow() keeps
        // advancing past S.duration and emits notes beyond the chart.
        if (_recState === 'recording') {
            window.editorStopRecordMidi();
        } else {
            stopPlayback();
        }
        S.cursorTime = 0;
        host.updateTimeDisplay(); // reflect the reset immediately before returning
        host.drawNow();
        return; // stopPlayback() already cancelled rafId; don't re-schedule.
    }

    // Auto-scroll to follow the playhead — unless follow is toggled off
    // (Shift+L), which lets an author inspect/edit one spot while the
    // song plays on.
    {
        const cx = timeToX(S.cursorTime);
        const w = canvas ? canvas.width / DPR : 800;
        const target = _scrollInPlayActive()
            ? _scrollInPlayTargetPure(S.cursorTime, w, S.zoom, editorFollowEnabled())
            : _followScrollTargetPure(S.cursorTime, cx, w, S.zoom, editorFollowEnabled());
        if (target !== null) S.scrollX = host.editorClampScrollX(target);
    }

    host.updateTimeDisplay();
    host.drawNow();
    rafId = requestAnimationFrame(playbackTick);
}

/* @pure:follow-scroll:start */
// Every follow fraction is measured against the USABLE timeline width — the
// canvas minus the fixed LABEL_W label gutter — NOT the full canvas width.
// The old math compared a gutter-inclusive cursor x (timeToX adds LABEL_W)
// against a fraction of the full width and landed without subtracting the
// gutter, so the trigger and landing drifted with canvas width: 52px is a
// bigger slice of a narrow canvas than a wide one, which read as "follow
// doesn't respect the edge at different resolutions". (The DPR axis is fine —
// both cursorX and viewW are already CSS px; do NOT add a DPR term here.)
export const FOLLOW_TRIGGER_FRAC = 0.8;   // page when the cursor passes this…
export const FOLLOW_LAND_FRAC = 0.3;      // …and land it here (read-ahead room)
export const FOLLOW_CENTER_FRAC = 0.5;    // continuous mode pins here (Logic)

export function _followUsableWPure(viewW) {
    const w = Number(viewW) - LABEL_W;
    return w > 0 ? w : 0;
}

// Page-catch policy: once the cursor crosses TRIGGER of the USABLE width, jump
// the window so the cursor lands at LAND — but only when follow is on. Returns
// the UNCLAMPED scrollX target, or null for "don't move".
export function _followScrollTargetPure(cursorTime, cursorX, viewW, zoom, followOn) {
    if (!followOn || !(zoom > 0)) return null;
    const usableW = _followUsableWPure(viewW);
    if (usableW <= 0) return null;
    if (!((cursorX - LABEL_W) > usableW * FOLLOW_TRIGGER_FRAC)) return null;
    return cursorTime - (usableW * FOLLOW_LAND_FRAC) / zoom;
}

// Continuous "Scroll in Play" (Logic's View ▸ Scroll in Play): pin the cursor
// at CENTER of the usable width and slide the timeline under it every tick —
// no trigger. The scrollX clamp does the rest: near the start/end the target
// pins to 0 / max, so the cursor travels TOWARD centre over the first half-view
// and away over the last, which is exactly Logic's centred-scroll wording
// ("after the playhead reaches the centre… it stays centred") for free.
// Returns the UNCLAMPED scrollX target, or null for "don't move".
export function _scrollInPlayTargetPure(cursorTime, viewW, zoom, followOn) {
    if (!followOn || !(zoom > 0)) return null;
    const usableW = _followUsableWPure(viewW);
    if (usableW <= 0) return null;
    return cursorTime - (usableW * FOLLOW_CENTER_FRAC) / zoom;
}

// The canvas x (CSS px) where the active policy parks the cursor. The painted
// pin reads THIS, and the scroll targets above derive from the same fraction,
// so the pin can never point somewhere the scroll doesn't actually hold.
export function _followPinXPure(viewW, frac) {
    return LABEL_W + _followUsableWPure(viewW) * frac;
}
/* @pure:follow-scroll:end */

/* @pure:loop-wrap-scroll:start */
// A/B loop wrap: the cursor jumps BACKWARD to the loop start, which the
// forward-only policy above cannot express — it only fires past 80% of the view
// and returns null for anything to the left. Combined with both wrap paths in
// playbackTick returning before the follow block ever runs, a loop whose start
// sat off the left edge (longer than the viewport, or scrolled away by the pass
// that just played) looped on with the view stranded downstream, watching empty
// timeline. Recenters only when the restart point is NOT comfortably on screen,
// so a loop that already fits the window never twitches on every pass.
// Returns the UNCLAMPED scrollX target, or null for "don't move".
export function _loopWrapScrollTargetPure(restartTime, restartX, viewW, zoom, followOn) {
    if (!followOn || !(zoom > 0)) return null;
    const usableW = _followUsableWPure(viewW);
    if (usableW <= 0) return null;
    // Same gutter-aware band as the forward policy: the left guard was already
    // correct; the right bound now uses the usable width so the "already on
    // screen, don't twitch" window matches the trigger the forward pass uses.
    if (restartX >= LABEL_W && restartX <= LABEL_W + usableW * FOLLOW_TRIGGER_FRAC) return null;
    return restartTime - (usableW * FOLLOW_LAND_FRAC) / zoom;
}
/* @pure:loop-wrap-scroll:end */

export function editorFollowEnabled() {
    // Default ON — follow is today's behavior; the pref only records an
    // explicit opt-out.
    try { return localStorage.getItem('editorFollow') !== '0'; }
    catch (_) { return true; }
}

// Scroll in Play: the continuous-centred manner of following (Logic's term).
// Default OFF — page-jump is today's behavior and the less-motion default,
// same as Logic/Ableton, which both ship page and make continuous opt-in.
export function editorScrollInPlayEnabled() {
    try { return localStorage.getItem('editorScrollInPlay') === '1'; }
    catch (_) { return false; }
}

// Does the OS ask for reduced motion? Continuous scroll is constant horizontal
// motion; under prefers-reduced-motion we honour the pref's INTENT (still
// "follow") but fall back to the page-jump manner, which moves far less.
function _prefersReducedMotion() {
    try { return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); }
    catch (_) { return false; }
}

// The EFFECTIVE manner used by playbackTick + the pin: scroll-in-play only
// when the user asked for it AND the OS isn't asking for reduced motion.
export function _scrollInPlayActive() {
    return editorScrollInPlayEnabled() && !_prefersReducedMotion();
}

export function _editorToggleFollow() {
    const next = !editorFollowEnabled();
    try { localStorage.setItem('editorFollow', next ? '1' : '0'); } catch (_) {}
    if (!next) {
        setStatus('Follow off — the view stays put while the song plays (Shift+L)');
    } else if (_scrollInPlayActive()) {
        setStatus('Follow on — the playhead stays pinned and the view scrolls under it (Shift+L)');
    } else {
        setStatus('Follow on — the view jumps ahead to keep the playhead in sight (Shift+L)');
    }
    return true;
}

export function _editorToggleScrollInPlay() {
    const next = !editorScrollInPlayEnabled();
    try { localStorage.setItem('editorScrollInPlay', next ? '1' : '0'); } catch (_) {}
    if (!next) {
        setStatus('Scroll in Play off — the view jumps ahead a page to catch the playhead');
    } else if (!editorFollowEnabled()) {
        // Reachable via the command palette even while the menu item is dimmed —
        // say plainly that it's inert until Follow is on.
        setStatus('Scroll in Play on — takes effect when Follow is on (Shift+L)');
    } else if (_prefersReducedMotion()) {
        setStatus('Scroll in Play on — honouring your system’s reduced-motion setting, so the view still jumps rather than scrolling');
    } else {
        setStatus('Scroll in Play on — the playhead pins and the view scrolls under it during playback');
    }
    return true;
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

// ════════════════════════════════════════════════════════════════════
// Guide claps — a percussive tick per charted event during playback, so
// authors can verify note placement by ear (charting-by-ear was silent:
// the editor had zero note sonification). Claps are scheduled by a
// setInterval lookahead loop — NOT the rAF draw loop — so audio timing
// stays sample-accurate even when host.draw() is saturated, and every voice
// sums through a limited master bus (hearing safety).
// ════════════════════════════════════════════════════════════════════

/* @pure:guide-clap:start */
// Half-open window query over a SORTED event-time array: returns the times t
// with from <= t < to, deduplicated at 1 ms resolution so a chord stack
// (several notes at one timestamp) claps once instead of N voices stacking
// into a louder transient.
function _guideClapTimesInWindowPure(times, from, to) {
    if (!Array.isArray(times) || !times.length || !(to > from)) return [];
    // Binary search for the first index with times[i] >= from.
    let lo = 0, hi = times.length;
    while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (times[mid] < from) lo = mid + 1; else hi = mid;
    }
    const out = [];
    let lastKey = null;
    for (let i = lo; i < times.length && times[i] < to; i++) {
        const key = Math.round(times[i] * 1000);
        if (key === lastKey) continue;
        lastKey = key;
        out.push(times[i]);
    }
    return out;
}
// Map chart-seconds onto the AudioContext clock via the transport anchor
// (_startAudioSourceAtCursor records wall/chart time as the audio starts).
// The inverse of _transportChartTimePure: `rate` (audition speed) STRETCHES the
// chart→wall mapping, so a guide/metronome event at chart time `chartT` sounds
// at the slowed wall position and stays aligned with the audition-rate audio.
// rate=1 is bit-identical to the pre-audition formula.
export function _guideChartToCtxPure(chartT, playStartWall, playStartTime, rate = 1) {
    const r = Number.isFinite(rate) && rate > 0 ? rate : 1;
    return playStartWall + (chartT - playStartTime) / r;
}
// Sanitize a raw event-time array before the window query, matching every
// other time-array consumer in this file (_editorJumpNote / -Beat / -Anchor):
// drop non-finite entries — a stray NaN/undefined time would reach
// osc.start(NaN) and throw inside the tick, killing clap scheduling — and
// sort ascending, which the early-terminating window scan relies on.
function _guideSanitizeTimesPure(times) {
    if (!Array.isArray(times)) return [];
    return times.filter(Number.isFinite).sort((a, b) => a - b);
}
// Clamp the lookahead window end to the loop-region end so no clap is
// scheduled past the boundary: the 120 ms lookahead can queue voices for
// events after the loop end before the rAF-detected wrap cancels them
// ("ghost claps" past the loop). No-op when looping is off.
function _guideWindowEndPure(rawTo, loopEnabled, loopEndTime) {
    if (loopEnabled && Number.isFinite(loopEndTime)) return Math.min(rawTo, loopEndTime);
    return rawTo;
}
// Metronome clicks for the beat rows in [from, to): every beat entry gets a
// click, downbeats (measure > 0) get the accent; sub-beats are measure -1.
// Same half-open window contract as the clap query so the shared scheduler
// never double-fires a beat across adjacent ticks.
// P2-6: `accentsByMeasure` (measure → grouping accent map, plain data so the
// sliced env stays clean) also accents the grouping-cell STARTS inside a
// grouped bar — `2+2+3` clicks strong-weak-strong-weak-strong-weak-weak, so
// the click teaches where the riff resets. Absent/ungrouped = downbeat-only,
// bit-identical to the pre-grouping click.
// P2-8: `feelRanges` (sorted [{fromMeasure, ratio}], plain data) halves the
// felt click under a half-time feel — accents land on every OTHER beat, the
// pulse a drummer actually references. Double-time (ratio 2) leaves the
// click as-is (every beat is already clicked; the marker's other consumers
// carry the meaning). Inline walk keeps the sliced env self-contained.
function _metroClicksInWindowPure(beats, from, to, accentsByMeasure, feelRanges) {
    if (!Array.isArray(beats) || !beats.length || !(to > from)) return [];
    let lo = 0, hi = beats.length;
    while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (beats[mid].time < from) lo = mid + 1; else hi = mid;
    }
    // Establish the in-bar position at the window edge: scan back to the
    // owning downbeat (bounded by one bar's beats).
    let measure = -1, pos = -1;
    for (let j = lo; j >= 0; j--) {
        if (beats[j] && beats[j].measure > 0) { measure = beats[j].measure; pos = lo - j; break; }
    }
    const out = [];
    for (let i = lo; i < beats.length && beats[i].time < to; i++) {
        const down = beats[i].measure > 0;
        if (down) { measure = beats[i].measure; pos = 0; }
        const map = (!down && accentsByMeasure) ? accentsByMeasure.get(measure) : null;
        let feel = 1;
        if (feelRanges) {
            for (const f of feelRanges) { if (f.fromMeasure <= measure) feel = f.ratio; else break; }
        }
        const feltAccent = feel === 0.5 && pos >= 0 && pos % 2 === 0;
        out.push({ t: beats[i].time, accent: down || !!(map && pos >= 0 && map[pos] === 1) || feltAccent });
        pos++;
    }
    return out;
}
/* @pure:guide-clap:end */

/* @pure:audition-trainer:start */
// ── Audition trainer (P2-10): loop-and-step-up + finer click ────────────────
// The practice ladder the trainer climbs — the same three steps the speed
// select offers, so the trainer never lands on a rate the UI can't show.
export const TRAINER_LADDER = [0.5, 0.75, 1];

// The next ladder step ABOVE `rate` (null at/above the top). Tolerant of a
// hand-picked off-ladder rate: it climbs to the nearest step above it.
export function _trainerNextRatePure(ladder, rate) {
    for (const r of (ladder || [])) { if (r > rate + 1e-9) return r; }
    return null;
}

// One completed loop pass: count it, and after `passesPerStep` clean passes
// propose the next ladder rate. Pure — the caller owns the state and the
// engine call. Returns { passes, stepTo } where stepTo is null except on the
// pass that earns the step (and null forever once the top is reached).
export function _trainerOnWrapPure(passes, passesPerStep, rate, ladder) {
    const n = (Number(passes) || 0) + 1;
    const per = Math.max(1, Number(passesPerStep) || 1);
    if (n < per) return { passes: n, stepTo: null };
    return { passes: 0, stepTo: _trainerNextRatePure(ladder, rate) };
}

// How fine the metronome clicks at a given audition rate: quarters at (near)
// full speed, 8ths slowed, 16ths at half speed and below. The drum seat's
// rule — the student references the intended pulse while slowed.
export function _metroSubdivForRatePure(rate) {
    const r = Number.isFinite(rate) ? rate : 1;
    if (r <= 0.55) return 4;
    if (r < 0.9) return 2;
    return 1;
}

// Subdivision click times BETWEEN adjacent grid beats — `div`−1 evenly-spaced
// ticks per beat span, beats themselves excluded (the accented/plain beat
// clicks already schedule). A PURE function of the beat grid: click times are
// independent of the audition rate, so the click stays LOCKED to the grid at
// every speed and the student hears their micro-timing against the intended
// pulse — the click must never wobble with the transform.
export function _metroSubdivClicksPure(beats, from, to, div) {
    const d = Math.max(1, Math.floor(Number(div) || 1));
    if (d < 2 || !Array.isArray(beats) || beats.length < 2 || !(to > from)) return [];
    const out = [];
    for (let i = 0; i + 1 < beats.length; i++) {
        const t0 = beats[i].time, t1 = beats[i + 1].time;
        if (t0 >= to) break;          // beats are sorted — nothing further is in the window
        if (t1 <= from) continue;     // this span's ticks all sit before it
        const span = t1 - t0;
        if (!(span > 0)) continue;
        for (let k = 1; k < d; k++) {
            const t = t0 + (span * k) / d;
            if (t >= from && t < to) out.push({ t });
        }
    }
    return out;
}
/* @pure:audition-trainer:end */

const GUIDE_LOOKAHEAD = 0.12;  // seconds scheduled ahead of the transport
const GUIDE_TICK_MS = 25;      // scheduler cadence
let _guideTimer = null;
let _guideScheduledUntil = 0;  // chart-seconds watermark (exclusive)
let _guideVoices = [];         // queued {osc, gain, until} for cancel-on-seek
let _bandFiredKeys = new Set();   // band-mode cross-tick dedupe (part-scoped)
let _guideLastFiredKey = null; // last-fired 1 ms bucket key, PERSISTED across
                               // ticks so a chord straddling a window boundary
                               // (same bucket, split by the 25 ms tick) can't
                               // double-fire — per-window dedupe alone resets.

export function editorGuideClapEnabled() {
    try {
        const raw = localStorage.getItem('editorGuideClap');
        if (raw === '1') return true;
        if (raw === '0') return false;
    } catch (_) { /* fall through to the session default */ }
    // DAW default: transcription tracks are live beside recordings and stems
    // until the user explicitly turns them off or mutes their track strips.
    return true;
}
// Guide voice mode (DAW 1.2): 'clap' (default) or 'gm' — pitched GM
// instrument voices at the same charted times. The guide toggle (C) stays
// the master on/off either way; mode only changes WHAT sounds.
export function editorGuideVoiceMode() {
    let raw = null;
    try { raw = localStorage.getItem('editorGuideVoice'); } catch (_) {}
    return _gmGuideModePure(raw);
}
export function _editorSetGuideVoiceMode(mode) {
    const next = _gmGuideModePure(mode);
    try { localStorage.setItem('editorGuideVoice', next); } catch (_) {}
    if (next === 'gm') {
        // Warm the current part's preset now so the first play doesn't
        // spend its opening bars on the clap fallback.
        const gm = _guideGmProgram();
        if (gm !== null && _ensureAudioCtx()) ensureGmPreset(gm, S.audioCtx);
        setStatus('Guide voice: instrument — charted notes play as a GM voice'
            + (editorGuideClapEnabled() ? '' : ' (turn the guide on to hear it — C)'));
    } else {
        setStatus('Guide voice: clap');
    }
}
export function editorMetronomeEnabled() {
    try { return localStorage.getItem('editorMetronome') === '1'; }
    catch (_) { return false; }
}

/* @pure:audio-mixer:start */
// Mixer math for the bus faders (source / guide / click / master) and the
// edit-preview blip gating. Fader percents live in editor prefs (never the
// pack). Christian's console rule: EVERY fader — buses and master included —
// is unity at 100 with +10 dB of headroom above (100..110 maps to dB, the
// same curve as the channel strips in mixer-panel.js), so no fader has an
// inert zone. Corrupted prefs still clamp, so a bad value can never blast
// a bus past +10 dB.
const MIX_DEFAULT_PCT = Object.freeze({ ref: 100, guide: 35, click: 25, master: 100 });
const MIX_FADER_MAX_PCT = 110;   // unity + 10 dB, matching MIXER_FADER_MAX
// Parse a stored fader percent: corrupted values clamp into [0, 110] and
// non-numeric ones fall back, so a bad pref can never blast a bus.
function _mixPctFromStoredPure(raw, fallbackPct) {
    const n = parseInt(raw, 10);
    if (!Number.isFinite(n)) return fallbackPct;
    return Math.max(0, Math.min(MIX_FADER_MAX_PCT, n));
}
function _mixGainForPctPure(pct) {
    const p = Number(pct);
    if (!Number.isFinite(p)) return 0;
    const c = Math.max(0, Math.min(MIX_FADER_MAX_PCT, p));
    if (c <= 100) return c / 100;
    return 10 ** ((c - 100) / 20);   // 100..110 → 0..+10 dB
}
// First play of a session starts the recording below target and ramps up
// (~0.35 s): an unexpectedly hot recording is reached, never jumped to.
// Quiet targets keep a small audible floor so the fade is never mistaken
// for a broken/silent load.
function _mixFirstPlayStartGainPure(target) {
    if (!(target > 0)) return 0;
    return Math.min(target, Math.max(0.05, target * 0.3));
}
// Rate-limit for the edit-preview blip: a group edit (set fret on N notes)
// must read as ONE cue, not a machine-gun transient.
function _mixBlipAllowedPure(nowMs, lastMs, gapMs) {
    if (!Number.isFinite(lastMs)) return true;
    return (nowMs - lastMs) >= gapMs;
}
// A committed drag only previews when it changed PITCH — any string delta
// (a note moved to another string sounds a different pitch) or any fret
// delta (a moved keys/piano-roll pitch, or a fret-changing drag). Time-only
// moves and marquee selects carry no string/fret delta, so they stay silent.
export function _mixDragChangedPitchPure(dstrings, dfrets) {
    const ds = Array.isArray(dstrings) && dstrings.some(d => d !== 0);
    const df = Array.isArray(dfrets) && dfrets.some(d => d !== 0);
    return ds || df;
}
// Time-domain samples → a DAW meter position. Visible range −60..0 dBFS;
// silence and invalid samples pin at zero.
export function _mixMeterLevelPure(samples) {
    if (!samples || !samples.length) return 0;
    let sum = 0;
    for (let i = 0; i < samples.length; i++) {
        const sample = Number(samples[i]);
        if (Number.isFinite(sample)) sum += sample * sample;
    }
    const rms = Math.sqrt(sum / samples.length);
    if (!(rms > 0)) return 0;
    const db = 20 * Math.log10(rms);
    return Math.max(0, Math.min(1, (db + 60) / 60));
}
// Peak sample level in dBFS (for the clip-aware readout). −Infinity on silence.
export function _mixMeterPeakDbPure(samples) {
    if (!samples || !samples.length) return -Infinity;
    let peak = 0;
    for (let i = 0; i < samples.length; i++) {
        const sample = Math.abs(Number(samples[i]));
        if (Number.isFinite(sample) && sample > peak) peak = sample;
    }
    return peak > 0 ? 20 * Math.log10(peak) : -Infinity;
}
/* @pure:audio-mixer:end */

// ── Live metering ────────────────────────────────────────────────────
// An AnalyserNode taps each metered node; a zero-gain sink keeps the browser
// processing the analyser without adding an audible copy. Bus taps persist
// across songs; per-track ('track:...') taps are dropped on song switch.
const _meterAnalysers = Object.create(null);
let _meterSilentSink = null;

function _attachMeterTap(node, key) {
    const ctx = S.audioCtx;
    if (!node || !ctx || typeof ctx.createAnalyser !== 'function' || _meterAnalysers[key]) return;
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.65;
    if (!_meterSilentSink && typeof ctx.createGain === 'function') {
        _meterSilentSink = ctx.createGain();
        _meterSilentSink.gain.value = 0;
        _meterSilentSink.connect(ctx.destination);
    }
    node.connect(analyser);
    if (_meterSilentSink) analyser.connect(_meterSilentSink);
    _meterAnalysers[key] = analyser;
}

function _detachMeterTap(key) {
    const analyser = _meterAnalysers[key];
    if (!analyser) return;
    try { analyser.disconnect(); } catch (_) { /* already gone */ }
    delete _meterAnalysers[key];
}

// The host-hook read side: current post-fader levels + peak dB per bus and
// per stem track. The mixer panel samples this each frame.
export function audioMixerMeterLevels() {
    const levels = { ref: 0, guide: 0, click: 0, master: 0, tracks: {}, peaks: {}, trackPeaks: {} };
    for (const key of ['ref', 'guide', 'click', 'master']) {
        const analyser = _meterAnalysers[key];
        if (!analyser || typeof analyser.getFloatTimeDomainData !== 'function') continue;
        const samples = new Float32Array(analyser.fftSize || 256);
        analyser.getFloatTimeDomainData(samples);
        levels[key] = _mixMeterLevelPure(samples);
        levels.peaks[key] = _mixMeterPeakDbPure(samples);
    }
    for (const [key, analyser] of Object.entries(_meterAnalysers)) {
        if (!key.startsWith('track:') || !analyser || typeof analyser.getFloatTimeDomainData !== 'function') continue;
        const samples = new Float32Array(analyser.fftSize || 256);
        analyser.getFloatTimeDomainData(samples);
        const trackKey = key.slice(6);   // drop 'track:'
        levels.tracks[trackKey] = _mixMeterLevelPure(samples);
        levels.trackPeaks[trackKey] = _mixMeterPeakDbPure(samples);
    }
    return levels;
}

/* @pure:audio-bus:start */
// Guide-voice bus ONLY: the claps sum through their own gain into a limiter
// so many simultaneous voices can never spike, then to the destination. The
// reference recording deliberately does NOT pass through here — it stays on a
// transparent path straight to destination (see _startAudioSourceAtCursor) so
// the limiter never colors loud / brickwalled reference recordings, whether
// or not guide claps are ever used.
let _masterBus = null;
function _ensureMasterBus() {
    if (_masterBus || !S.audioCtx) return _masterBus;
    const ctx = S.audioCtx;
    const guideGain = ctx.createGain();
    guideGain.gain.value = _mixGainForPctPure(_mixLoadPct().guide);
    // Click sits well under the reference/guide by default (≈ -12 dB) — the
    // metronome should be felt, not fought with. Both levels come from the
    // mixer prefs; the defaults preserve the shipped balance.
    const clickGain = ctx.createGain();
    clickGain.gain.value = _mixGainForPctPure(_mixLoadPct().click);
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -1;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.25;
    // A master gain sits AFTER the limiter — the program's final trim and the
    // point the master meter taps. The reference recording joins here too
    // (post-limiter), so it's metered and master-trimmed without ever being
    // colored by the guide limiter.
    const masterGain = ctx.createGain();
    masterGain.gain.value = _mixGainForPctPure(_mixLoadPct().master);
    guideGain.connect(limiter);
    clickGain.connect(limiter);
    limiter.connect(masterGain);
    masterGain.connect(ctx.destination);
    _masterBus = { guideGain, clickGain, limiter, masterGain };
    _attachMeterTap(guideGain, 'guide');
    _attachMeterTap(clickGain, 'click');
    _attachMeterTap(masterGain, 'master');
    return _masterBus;
}

// Fader percents, cached so audio paths never read localStorage
// synchronously mid-schedule; seeded once, kept in sync by _mixSetBusGain.
let _mixPctCache = null;
export function _mixLoadPct() {
    if (_mixPctCache) return _mixPctCache;
    let ref = null, guide = null, click = null, master = null;
    try {
        ref = localStorage.getItem('editorMixRef');
        guide = localStorage.getItem('editorMixGuide');
        click = localStorage.getItem('editorMixClick');
        master = localStorage.getItem('editorMixMaster');
    } catch (_) {}
    _mixPctCache = {
        ref: _mixPctFromStoredPure(ref, MIX_DEFAULT_PCT.ref),
        guide: _mixPctFromStoredPure(guide, MIX_DEFAULT_PCT.guide),
        click: _mixPctFromStoredPure(click, MIX_DEFAULT_PCT.click),
        master: _mixPctFromStoredPure(master, MIX_DEFAULT_PCT.master),
    };
    return _mixPctCache;
}

// Recording volume node: a TRANSPARENT gain straight to destination — the
// reference still never sums through the guide limiter (see the bus comment
// above). This only adds user volume control; unity by default.
let _refGain = null;
function _ensureRefGain() {
    if (_refGain || !S.audioCtx) return _refGain;
    _refGain = S.audioCtx.createGain();
    _refGain.gain.value = _mixGainForPctPure(_mixLoadPct().ref);
    // Route to the master gain (post-limiter) so the recording rides the
    // master trim and feeds the 'ref' meter — still bypassing the limiter,
    // so a hot recording is never colored.
    const bus = _ensureMasterBus();
    _refGain.connect(bus ? bus.masterGain : S.audioCtx.destination);
    _attachMeterTap(_refGain, 'ref');
    return _refGain;
}

// First-play fade (hearing safety): once per loaded recording, the
// reference ramps from a reduced level up to its fader target as playback
// starts. Re-armed by _mixResetFirstPlay() on every new/replaced recording
// (see loadAudio()) — the ramp guards against an unexpectedly hot recording,
// so it must not go stale after the very first song of a session.
let _mixFirstPlayDone = false;
function _mixApplyFirstPlayFade() {
    if (_mixFirstPlayDone || !_refGain || !S.audioCtx) return;
    _mixFirstPlayDone = true;
    const target = _mixGainForPctPure(_mixLoadPct().ref);
    const now = S.audioCtx.currentTime;
    _refGain.gain.setValueAtTime(_mixFirstPlayStartGainPure(target), now);
    _refGain.gain.linearRampToValueAtTime(target, now + 0.35);
}

// Re-arm the first-play fade: called whenever a new reference recording is
// decoded (loadCDLC, create/import, and replace-audio all funnel through
// loadAudio()) so each new recording gets the hearing-safety ramp, not just
// the first one of the screen's lifetime.
function _mixResetFirstPlay() {
    _mixFirstPlayDone = false;
}

// Apply a fader move: persist the pref and ramp the live node (~20 ms
// smoothing) — a gain change is never a stepped jump mid-audio.
function _mixSetBusGain(bus, pct) {
    const key = bus === 'ref' ? 'editorMixRef'
        : bus === 'guide' ? 'editorMixGuide'
        : bus === 'master' ? 'editorMixMaster' : 'editorMixClick';
    const p = _mixPctFromStoredPure(String(pct), MIX_DEFAULT_PCT[bus]);
    _mixLoadPct()[bus] = p;
    try { localStorage.setItem(key, String(p)); } catch (_) {}
    const node = bus === 'ref' ? _refGain
        : bus === 'guide' ? (_masterBus && _masterBus.guideGain)
        : bus === 'master' ? (_masterBus && _masterBus.masterGain)
        : (_masterBus && _masterBus.clickGain);
    if (node && S.audioCtx) {
        // The recording fader must never un-mute an active A/B guide pass:
        // route ref moves through the A/B-aware target so a nudge ramps to
        // the fresh level on a recording pass but stays muted on a guide
        // pass. Guarded — the @pure:audio-bus test sandbox has no
        // _abApplyRefGain, where this falls back to the plain fader ramp.
        if (bus === 'ref' && typeof _abApplyRefGain === 'function') {
            _abApplyRefGain();
        } else {
            node.gain.setTargetAtTime(_mixGainForPctPure(p), S.audioCtx.currentTime, 0.02);
        }
    }
    return p;
}

export function editorEditBlipEnabled() {
    try { return localStorage.getItem('editorEditBlip') !== '0'; }
    catch (_) { return true; }
}

// Edit-preview blip: a soft confirmation tick on note ADD and PITCH change
// only (never marquee/time-only moves). It sums straight into the shared
// limiter — NOT through the guide fader — so muting guide claps never also
// silences the edit cue, while the limiter still tames it. It skips when the
// context isn't running — an edit must never resume audio — and is pitched
// apart from the 1750 Hz guide clap so the two read as different cues.
let _mixLastBlipMs = null;
export function _editBlipAt() {
    if (!editorEditBlipEnabled()) return;
    if (!S.audioCtx || S.audioCtx.state !== 'running') return;
    const bus = _ensureMasterBus();
    if (!bus) return;
    const nowMs = Date.now();
    if (!_mixBlipAllowedPure(nowMs, _mixLastBlipMs, 60)) return;
    _mixLastBlipMs = nowMs;
    const ctx = S.audioCtx;
    const when = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = 1320;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(0.5, when + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, when + 0.04);
    osc.connect(g);
    g.connect(bus.limiter);
    osc.start(when);
    osc.stop(when + 0.05);
    _guideVoices.push({ osc, gain: g, until: when + 0.05 });
    // Same bounded-bookkeeping rule as the scheduler tick.
    if (_guideVoices.length > 64) {
        const nowCtx = ctx.currentTime;
        _guideVoices = _guideVoices.filter(v => v.until > nowCtx);
    }
}

// Audition one pitch for the keyboard gutter (click a piano key → hear it).
// A gentle, hearing-safe voice through the master limiter (soft attack, ~0.28
// peak, ~320 ms decay) — the same envelope shape as the edit blip but pitched
// and a touch longer, so it reads as a note rather than a tick. No-op when the
// context isn't running (autoplay-gated) or the pitch is out of audible range.
export function _auditionPitch(midi) {
    if (!S.audioCtx || S.audioCtx.state !== 'running') return;
    const freq = midiToFreq(midi);
    if (!(freq > 0) || freq > 20000) return;
    const bus = _ensureMasterBus();
    if (!bus) return;
    const ctx = S.audioCtx;
    const when = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(0.28, when + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, when + 0.32);
    osc.connect(g);
    g.connect(bus.limiter);
    osc.start(when);
    osc.stop(when + 0.34);
    _guideVoices.push({ osc, gain: g, until: when + 0.34 });
    if (_guideVoices.length > 64) {
        const nowCtx = ctx.currentTime;
        _guideVoices = _guideVoices.filter(v => v.until > nowCtx);
    }
}
/* @pure:audio-bus:end */

// Event times for the active editing surface: the drum grid claps drum hits,
// every other view claps the current arrangement's (time-sorted) notes.
function _guideSourceTimes() {
    // NB: NOT gated by per-part mute/solo — this is the surface's raw event
    // set, also consumed by _composeSongDuration() to bound the song. The
    // mixer's audible gate lives at the clap scheduler (below), so muting a
    // part silences its claps without shrinking the transport (mixer panel, B6).
    if (S.drumEditMode) {
        const hits = (S.drumTab && Array.isArray(S.drumTab.hits)) ? S.drumTab.hits : [];
        return _guideSanitizeTimesPure(hits.map(h => h.t));
    }
    // Band mode (play all tracks): the song is bounded by EVERY part's
    // events — all arrangements' notes AND the drum grid's hits (drum
    // charts live in S.drumTab, not an arrangement) — so a bass outro or a
    // late drum hit past the lead's last note stays reachable, and a
    // drum-only chart still has a song at all (review #280, item 8).
    // Checked BEFORE the no-arrangements early-out for the same reason.
    if (editorPlayAllTracksEnabled()) {
        const all = [];
        for (const a of S.arrangements) {
            if (a && Array.isArray(a.notes)) for (const n of a.notes) all.push(n.time);
        }
        const hits = (S.drumTab && Array.isArray(S.drumTab.hits)) ? S.drumTab.hits : [];
        for (const h of hits) all.push(h.t);
        return _guideSanitizeTimesPure(all);
    }
    if (!S.arrangements.length) return [];
    return _guideSanitizeTimesPure(notes().map(n => n.time));
}

// The current part's GM program for the pitched guide (null = keep
// clapping: no arrangements, or the drum grid — drums keep their clap).
function _guideGmProgram() {
    if (S.drumEditMode || !S.arrangements.length) return null;
    const arr = S.arrangements[S.currentArr];
    if (!arr) return null;
    return editorGmVoiceFor(_gmKindPure(arrKind(arr)));
}

// Pitched events for the current arrangement: the same charted times the
// clap fires on, carrying the roll's MIDI truth — keys packing for keys
// parts, capo-aware sounding pitch for fretted (the ONE shared converter,
// _rollMidiForNote, so the guide can never disagree with the roll/strip).
function _guidePitchedEvents() {
    if (S.drumEditMode || !S.arrangements.length) return [];
    const rctx = _rollPitchCtx();
    return _gmSanitizeEventsPure(notes().map(n => ({
        t: n.time,
        midi: _rollMidiForNote(n, rctx),
        sus: n.sustain,
    })));
}

/* @pure:midi-playback:start */
// ── Multi-track MIDI playback (chart playback, DAW 1.x) ──────────────
// "Play all tracks": every part's charted notes voice their GM instrument
// simultaneously — the arrangement as a BAND — and the Mixer's Tracks strips
// become a real mixer over them (per-part gain nodes, the same architecture
// as per-stem gains). OFF = today's behavior (active part only), bit-
// identical. Drum parts clap (GM percussion is a follow-up).
//
// The band roster: one entry per mixable part, in strip order — the SAME
// `arr:<idx>` keys the mixer panel uses (the drums arrangement included), so
// the strips and the engine can never disagree about who is who.
function _bandPartsPure(arrangements, drumTab) {
    const out = [];
    let anyDrumArr = false;
    (arrangements || []).forEach((a, i) => {
        if (!a) return;
        if (a.type === 'drums') {
            // A drum PART (a song can hold several): each plays ITS OWN tab's
            // kit through its own `arr:<idx>` channel — the SAME key its mixer
            // strip uses. An empty part (no hits yet) schedules nothing.
            anyDrumArr = true;
            if (!(a.drumTab && Array.isArray(a.drumTab.hits) && a.drumTab.hits.length)) return;
            out.push({ key: 'arr:' + i, idx: i, name: a.name || 'Drums' });
            return;
        }
        out.push({ key: 'arr:' + i, idx: i, name: a.name || ('Track ' + (i + 1)) });
    });
    if (!anyDrumArr && drumTab && Array.isArray(drumTab.hits) && drumTab.hits.length) {
        // Legacy unmaterialized tab (create-mode compose): the old singleton
        // band entry, keyed by the legacy 'drums' strip key.
        out.push({ key: 'drums', idx: -1, name: 'Drums' });
    }
    return out;
}
// Part-scoped cross-tick dedupe key (two parts firing the same millisecond
// must BOTH sound — a single scalar key would swallow the second one).
function _bandFiredKeyPure(partKey, t) {
    return partKey + '|' + Math.round(t * 1000);
}
/* @pure:midi-playback:end */

// The persisted mode pref ('1' = the band plays; default off).
let _playAllPref;   // '1' | '0' | null (no stored choice)
export function editorPlayAllTracksEnabled() {
    if (_playAllPref === undefined) {
        try { _playAllPref = localStorage.getItem('editorPlayAllTracks'); }
        catch (_) { _playAllPref = null; }
    }
    if (_playAllPref === '1') return true;
    if (_playAllPref === '0') return false;
    // DAW default: every transcription track is live, including beside stems.
    // Per-track M/S/faders are the normal way to control what is heard.
    return true;
}
export function editorTogglePlayAllTracks() {
    const next = !editorPlayAllTracksEnabled();
    _playAllPref = next ? '1' : '0';
    try { localStorage.setItem('editorPlayAllTracks', _playAllPref); } catch (_) { /* pref just won't persist */ }
    // A live toggle mid-play: everything queued in the lookahead window
    // belongs to the OLD mode (single guide voice ↔ the whole band), so
    // cancel it and restart the schedule window at the current transport
    // time — the next tick refills in the new mode (review #280, item 9).
    // Web Audio lets a started one-shot be stop()ped and a wavetable
    // envelope cancel()ed (gmVoiceAt's adapter), so queued voices die now;
    // only a clap tail already sounding (<60 ms) decays on its own.
    if (S.playing && S.audioCtx) {
        _guideResetSchedule();
        _guideScheduledUntil = _transportChartTimePure(
            S.playStartTime, S.playStartWall, S.audioCtx.currentTime, _auditionRate());
    }
    setStatus(next
        ? 'All tracks play their instruments — mix them with the Tracks strips (Shift+C). The recording is unaffected.'
        : 'Back to the single guide voice — only the current track sounds.');
    host.stripUiChanged();
    return true;
}

// One GainNode per part key, summing into the guide bus — the Tracks strips
// ramp these live (~20 ms, the house fader rule), so a mute/solo/volume
// gesture never restarts or pops. Lazy per key; dropped on teardown.
let _partGains = null;
function _ensurePartGain(key) {
    const bus = _ensureMasterBus();
    if (!bus) return null;
    if (!_partGains) _partGains = {};
    if (!_partGains[key]) {
        const g = S.audioCtx.createGain();
        // A fresh GainNode starts at Web Audio unity — seat it at the
        // strip's CURRENT mute/solo/volume before anything connects or
        // schedules through it, or a muted / solo'd-away / turned-down
        // part leaks its first note at full level (review #280, item 10).
        // The ~20 ms ramps of _partGainsApply take over from here.
        const st = host.partStripState(key);
        g.gain.value = st.audible ? st.vol : 0;
        g.connect(bus.guideGain);
        _attachMeterTap(g, 'track:' + key);
        _partGains[key] = g;
    }
    return _partGains[key];
}
export function _partGainsApply(immediate) {
    if (!_partGains || !S.audioCtx) return;
    const now = S.audioCtx.currentTime;
    for (const key of Object.keys(_partGains)) {
        const st = host.partStripState(key);
        const target = st.audible ? st.vol : 0;
        const g = _partGains[key].gain;
        if (immediate) { g.cancelScheduledValues(now); g.setValueAtTime(target, now); }
        else g.setTargetAtTime(target, now, 0.02);
    }
}
function _partGainsReset() {
    if (_partGains) {
        for (const key of Object.keys(_partGains)) {
            _detachMeterTap('track:' + key);
            try { _partGains[key].disconnect(); } catch (_) { /* context gone */ }
        }
    }
    _partGains = null;
}

// ════════════════════════════════════════════════════════════════════
// Stem playback engine.
//
// Studio stems (S.stems) play ALONGSIDE the master recording, sample-
// aligned: each is decoded once into stemAudioCache, then scheduled at the
// SAME transport anchor as the master so they can't drift. The master keeps
// its own path (S.audioSource → _refGain, the audition MediaElement, A/B) —
// stems are purely ADDITIVE, so a stem-engine fault can never take the
// recording down with it.
//
// Mix routing reuses the band-mode mixer: a stem's gain reads
// host.partStripState('audio:<id>') — the SAME S.partMix store and whole-map
// solo rule the synth parts use — and connects to _refGain (the transparent
// path, never the guide limiter). Volume ceiling is unity, matching the
// current per-part contract; meters and +10 dB headroom are a later polish.
//
// Known limitation: at audition speed < 1 the master reroutes to a
// pitch-preserving MediaElement and the sample-accurate BufferSource path is
// silenced — so stems do not sound while slowed (they resume at 100%).
// ════════════════════════════════════════════════════════════════════
const stemAudioCache = new Map();     // sourceId → { url, buffer, peaks }
const playingStemSources = new Map(); // sourceId → live AudioBufferSourceNode
const stemGainNodes = new Map();      // sourceId → GainNode
let stemDecodeGeneration = 0;

const MASTER_SOURCE_ID = 'master';
const stemKey = (sourceId) => 'audio:' + sourceId;

// Every live audio source — the master recording PLUS the stems — minus the
// track session's non-destructive removals. The master's URL comes from
// S.masterAudioUrl so it survives while a STEM is the active buffer (at
// which point S.audioUrl points at the stem).
export function _liveAudioSourcesPure(masterUrl, stems, removedSourceIds) {
    const removed = new Set(Array.isArray(removedSourceIds) ? removedSourceIds : []);
    const seen = new Set();
    const out = [];
    if (masterUrl && !removed.has(MASTER_SOURCE_ID)) {
        out.push({ id: MASTER_SOURCE_ID, url: masterUrl, offset: 0 });
        seen.add(MASTER_SOURCE_ID);
    }
    for (const raw of (Array.isArray(stems) ? stems : [])) {
        const id = raw && typeof raw.id === 'string' ? raw.id : '';
        const url = raw && typeof raw.url === 'string' ? raw.url : '';
        if (!id || !url || removed.has(id) || seen.has(id)) continue;
        seen.add(id);
        out.push({ id, url, offset: Number(raw.offset) || 0 });
    }
    return out;
}

function _liveAudioSources() {
    const masterUrl = S.masterAudioUrl
        || (S.activeAudioSourceId === MASTER_SOURCE_ID ? S.audioUrl : '') || '';
    return _liveAudioSourcesPure(masterUrl, S.stems,
        S.trackSession && S.trackSession.removedSourceIds);
}

// The sources the multi-source scheduler plays: every live source EXCEPT the
// active one, which plays via the S.audioSource reference path (its buffer is
// what the waveform shows and onset tools analyze). Pure, for the tests.
export function _scheduledSourceIdsPure(sources, activeId) {
    return (Array.isArray(sources) ? sources : [])
        .map(s => s && s.id).filter(id => id && id !== activeId);
}

export function _staleAudioSourceIdsPure(existingIds, liveIds) {
    const live = liveIds instanceof Set ? liveIds : new Set(liveIds || []);
    return [...(existingIds || [])].filter(id => !live.has(id));
}

// Decode every live source into the cache (parallel, generation-guarded, one
// failure never blocks the rest). The master's buffer is usually already
// decoded as S.audioBuffer — adopt it directly rather than re-fetching. Drops
// cache entries for sources that are gone. Safe to call repeatedly.
export async function syncStemAudio() {
    const sources = _liveAudioSources();
    const liveIds = new Set(sources.map(s => s.id));
    // Retire stems that left the roster BEFORE any await — a removed/renamed
    // stem must stop sounding now, and a stale SOLO it left in partMix would
    // otherwise silence every live track (see _pruneStaleStems). Runs before the
    // fetch/ctx guards so the solo cleanup happens even headless.
    _pruneStaleStems(liveIds);
    if (typeof fetch !== 'function') return;
    _ensureAudioCtx();
    if (!S.audioCtx) return;
    const generation = ++stemDecodeGeneration;
    for (const id of _staleAudioSourceIdsPure(stemAudioCache.keys(), liveIds)) stemAudioCache.delete(id);
    // Adopt the already-decoded active buffer (usually the master) for free.
    if (S.audioBuffer && S.activeAudioSourceId && liveIds.has(S.activeAudioSourceId)) {
        const src = sources.find(s => s.id === S.activeAudioSourceId);
        const cached = stemAudioCache.get(S.activeAudioSourceId);
        if (src && S.audioUrl === src.url && (!cached || cached.url !== src.url)) {
            stemAudioCache.set(S.activeAudioSourceId, { url: src.url, buffer: S.audioBuffer, peaks: null });
        }
    }
    await Promise.all(sources.map(async (source) => {
        const cached = stemAudioCache.get(source.id);
        if (cached && cached.url === source.url && cached.buffer) return;
        try {
            const resp = await fetch(source.url);
            if (!resp.ok) return;
            const raw = await resp.arrayBuffer();
            const buffer = await S.audioCtx.decodeAudioData(raw);
            if (generation !== stemDecodeGeneration) return;   // superseded
            stemAudioCache.set(source.id, { url: source.url, buffer, peaks: null });
        } catch (_) { /* one unavailable source must not block the session */ }
    }));
    if (generation !== stemDecodeGeneration) return;
    let activeRepaired = false;
    if (!liveIds.has(S.activeAudioSourceId)) {
        // Prefer the master, then any other live source — a failed decode of
        // one candidate must not strand the removed id as active, so keep
        // trying until one activates.
        const candidates = [
            ...sources.filter(source => source.id === MASTER_SOURCE_ID),
            ...sources.filter(source => source.id !== MASTER_SOURCE_ID),
        ];
        for (const source of candidates) {
            if (await activateTrackAudioSource(source.id)) { activeRepaired = true; break; }
        }
        if (!activeRepaired) {
            // Nothing decoded — clear the stale reference and reset to the
            // no-source state so playback doesn't keep the removed buffer.
            activeSourceGeneration++;
            cancelAudioLoad();
            S.audioBuffer = null;
            S.waveformPeaks = null;
            S.audioUrl = null;
            S.activeAudioSourceId = MASTER_SOURCE_ID;
            S.activeAudioSourceOffset = 0;
            if (S.playing) _restartPlaybackAt(S.cursorTime);
            host.draw();
            activeRepaired = true;
        }
    }
    if (generation === stemDecodeGeneration
        && !activeRepaired && _stemCatchupAllowedPure(S.playing, _auditionActive())) {
        const catchup = _stemCatchupPure(
            S.playStartTime, S.playStartWall, S.audioCtx.currentTime, _auditionRate());
        _startStemSources(catchup.preRoll, catchup.cursorTime);
    }
}

export function _stemCatchupAllowedPure(playing, auditionActive) {
    return !!playing && !auditionActive;
}

export function _stemCatchupPure(playStartTime, playStartWall, currentTime, rate = 1) {
    const remaining = Math.max(0, (Number(playStartWall) || 0) - (Number(currentTime) || 0));
    return {
        preRoll: remaining,
        cursorTime: remaining > 0
            ? Math.max(0, Number(playStartTime) || 0)
            : _transportChartTimePure(playStartTime, playStartWall, currentTime, rate),
    };
}

// Retire every stem no longer in `liveIds` (a set of live source ids): stop its
// playing node, drop its gain node, and — the one that bites — delete its
// 'audio:<id>' entry from S.partMix. That entry is counted by the whole-map
// solo rule, so a stale SOLO left behind by a removed stem would silence every
// live track. Same hazard the arrangement-delete path guards against by
// renumbering the arr:<idx> keys (see _partMixDropArrangementPure).
export function _pruneStaleStems(liveIds) {
    for (const id of [...playingStemSources.keys()]) {
        if (liveIds.has(id)) continue;
        try { playingStemSources.get(id).stop(); } catch (_) { /* already stopped */ }
        playingStemSources.delete(id);
    }
    for (const id of [...stemGainNodes.keys()]) {
        if (liveIds.has(id)) continue;
        try { stemGainNodes.get(id).disconnect(); } catch (_) { /* context gone */ }
        stemGainNodes.delete(id);
    }
    let removedSolo = false;
    if (S.partMix && typeof S.partMix === 'object') {
        for (const key of Object.keys(S.partMix)) {
            if (key.startsWith('audio:') && !liveIds.has(key.slice('audio:'.length))) {
                removedSolo = removedSolo || !!(S.partMix[key] && S.partMix[key].solo);
                delete S.partMix[key];
            }
        }
    }
    // If the removed stem was the soloed one, deleting its key fixes the solo
    // RULE — but every live gain node (surviving stems AND synth parts) still
    // sits at its solo'd-away zero until re-ramped. A delayed fetch/catch-up
    // won't touch the part gains, so reapply the whole mix now (the same pair
    // partMixChanged uses — both bands read partStripState). Returns whether a
    // solo was pruned so callers/tests can observe the re-apply decision.
    if (removedSolo) { _partGainsApply(false); applyStemMix(false); }
    return removedSolo;
}

// Make `sourceId` the active reference: its decoded buffer becomes what the
// main waveform shows and what onset tools (Suggest, snap) analyze. Playback
// is NOT rerouted — the newly-active source plays via the reference path and
// every other live source keeps playing through the scheduler, so what you
// hear is unchanged; only what you SEE and analyze follows the click.
export async function activateTrackAudioSource(sourceId) {
    if (!sourceId) return false;
    const generation = ++activeSourceGeneration;
    const source = _liveAudioSources().find(item => item.id === sourceId);
    if (!source || !source.url) { setStatus('That audio source is unavailable in this song.'); return false; }
    if (sourceId === S.activeAudioSourceId && S.audioUrl === source.url
        && (Number(S.activeAudioSourceOffset) || 0) === source.offset) return true;
    let cached = stemAudioCache.get(sourceId);
    if (!cached || cached.url !== source.url || !cached.buffer) {
        if (typeof fetch !== 'function' || !S.audioCtx) return false;
        try {
            const resp = await fetch(source.url);
            if (!resp.ok) throw new Error('fetch');
            const buffer = await S.audioCtx.decodeAudioData(await resp.arrayBuffer());
            if (generation !== activeSourceGeneration) return false;
            cached = { url: source.url, buffer, peaks: null };
            stemAudioCache.set(sourceId, cached);
        } catch (_) {
            if (generation === activeSourceGeneration) setStatus('That audio source could not be loaded.');
            return false;
        }
    }
    if (generation !== activeSourceGeneration) return false;
    // A master load started before this selection must not land afterward and
    // silently replace the chosen reference buffer.
    cancelAudioLoad();
    // The active source becomes the reference buffer. The timeline length is
    // the master's — a stem shares it — so don't let a slightly-different stem
    // duration move the chart's end.
    S.audioBuffer = cached.buffer;
    S.audioUrl = source.url;
    S.activeAudioSourceId = sourceId;
    S.activeAudioSourceOffset = Number(source.offset) || 0;
    if (sourceId === MASTER_SOURCE_ID) {
        S.duration = cached.buffer.duration;
        S.masterAudioDuration = cached.buffer.duration;
    }
    host.editorApplyScrollBounds();
    computeWaveform();          // waveform now shows this source
    if (S.playing) _restartPlaybackAt(S.cursorTime);   // re-split active vs scheduled
    host.draw();
    return true;
}

// New song boundary: orphan in-flight decodes and drop every buffer.
export function resetStemAudioCache() {
    activeSourceGeneration++;
    stemDecodeGeneration++;
    stemAudioCache.clear();
    _stopStemSources();
    _stemGainsReset();   // detaches each stem's meter tap with its gain
    S.activeAudioSourceId = MASTER_SOURCE_ID;
    S.activeAudioSourceOffset = 0;
}

// A stem's cached min/max waveform peaks for its lane (lazy — built on first
// request from the decoded buffer). Feeds host.trackWaveform.
export function audioStemWaveform(sourceId) {
    const cached = stemAudioCache.get(sourceId);
    if (!cached || !cached.buffer) return null;
    if (!cached.peaks) {
        // _buildWaveformPeaks wants a channel Float32Array, NOT the AudioBuffer —
        // passing the buffer made every data[s] read `undefined`, collapsing the
        // peaks to ±Infinity so the lane drew off-canvas (invisible stems). Match
        // computeWaveform's ~3 ms/bin resolution so a stem lane looks like the master.
        const channel = cached.buffer.getChannelData(0);
        const binSamples = Math.max(64, Math.round(cached.buffer.sampleRate * 0.003));
        cached.peaks = _buildWaveformPeaks(channel, binSamples);
    }
    return { peaks: cached.peaks, duration: cached.buffer.duration };
}

function _ensureStemGain(sourceId) {
    if (stemGainNodes.has(sourceId)) return stemGainNodes.get(sourceId);
    if (!S.audioCtx) return null;
    const gain = S.audioCtx.createGain();
    const st = host.partStripState(stemKey(sourceId));
    // Seed at the strip's current state BEFORE connecting, so a muted stem
    // never leaks its first sample (mirrors _ensurePartGain).
    gain.gain.value = st && st.audible !== false ? Math.max(0, Number(st.vol) || 0) : 0;
    gain.connect(_ensureRefGain() || S.audioCtx.destination);
    _attachMeterTap(gain, 'track:audio:' + sourceId);
    stemGainNodes.set(sourceId, gain);
    return gain;
}

// The graph node the ACTIVE source's reference playback (the rate-1 BufferSource
// AND the audition MediaElement alike) feeds into: its OWN per-source gain, so
// the active source's channel strip — the master mix included — governs its
// level/mute/solo, then on into _refGain (the SOURCE submix). Non-active sources
// already route this way via _startStemSources. Falls back to _refGain, then the
// destination, before any per-source gain can exist.
function _activeRefTarget() {
    return _ensureStemGain(S.activeAudioSourceId)
        || _ensureRefGain()
        || (S.audioCtx ? S.audioCtx.destination : null);
}

// Ramp every stem gain to its strip state (mute/solo/fader). ~20 ms house
// ramp, or immediate when seating at (re)start.
export function applyStemMix(immediate = false) {
    if (!S.audioCtx) return;
    const now = S.audioCtx.currentTime;
    for (const [sourceId, gain] of stemGainNodes) {
        const st = host.partStripState(stemKey(sourceId));
        const target = st && st.audible !== false ? Math.max(0, Number(st.vol) || 0) : 0;
        if (immediate) { gain.gain.cancelScheduledValues(now); gain.gain.setValueAtTime(target, now); }
        else gain.gain.setTargetAtTime(target, now, 0.02);
    }
}

// Schedule every live source EXCEPT the active one (which plays via the
// S.audioSource reference path), sample-aligned: each computes its placement
// from S.audioShift + its own offset and starts at the SAME preRoll-shifted
// anchor. Called from the reference's rate-1 start path (never audition-slow).
function _startStemSources(preRoll = 0, cursorTime = S.cursorTime) {
    _stopStemSources();
    if (!S.audioCtx) return 0;
    let started = 0;
    for (const source of _liveAudioSources()) {
        if (source.id === S.activeAudioSourceId) continue;   // plays via S.audioSource
        const cached = stemAudioCache.get(source.id);
        if (!cached || !cached.buffer) continue;   // not decoded yet — syncStemAudio catches up
        const placement = _audioBufferStartPure(
            cursorTime, (Number(S.audioShift) || 0) + source.offset, cached.buffer.duration);
        if (!placement.play) continue;
        const node = S.audioCtx.createBufferSource();
        node.buffer = cached.buffer;
        node.connect(_ensureStemGain(source.id) || _ensureRefGain() || S.audioCtx.destination);
        const when = (preRoll > 0 || placement.delay > 0)
            ? S.audioCtx.currentTime + preRoll + placement.delay : 0;
        node.start(when, placement.offset);
        playingStemSources.set(source.id, node);
        started++;
    }
    applyStemMix(true);
    return started;
}

function _stopStemSources() {
    for (const node of playingStemSources.values()) {
        try { node.stop(); } catch (_) { /* already stopped */ }
    }
    playingStemSources.clear();
}

function _stemGainsReset() {
    for (const [sourceId, gain] of stemGainNodes) {
        _detachMeterTap('track:audio:' + sourceId);   // own the tap we attached
        try { gain.disconnect(); } catch (_) { /* context gone */ }
    }
    stemGainNodes.clear();
}

// Per-part pitched events (chart truth: the same converter the roll uses,
// per arrangement) — drum parts return [] here; their hits clap instead.
function _bandPartPitchedEvents(idx) {
    const arr = S.arrangements[idx];
    if (!arr || arrKind(arr) === 'drums') return [];
    const rctx = _rollPitchCtxFor(arr);
    return _gmSanitizeEventsPure((arr.notes || []).map(n => ({
        t: n.time,
        midi: _rollMidiForNote(n, rctx),
        sus: n.sustain,
    })));
}

// Voice a drum tab's hits in [from, to) as the GM KIT through `target`
// (null = the guide bus): each piece plays its one-shot (kick, snare, hats,
// toms, cymbals — DRUM_PIECE_GM_NOTE), lazily loaded on first sight; a hit
// whose sound isn't ready yet ticks instead (the never-silent rule). The
// dedupe key is piece-scoped AND part-scoped (`keyPrefix`): kick + snare on
// the same millisecond BOTH sound, and TWO drum parts hitting the same piece
// on the same millisecond both sound too. Used by band mode (per-part gain
// target + each part's OWN tab) and the drum-edit guide (defaults: the
// active tab, the legacy 'drums' prefix).
function _drumKitVoicesInWindow(from, to, target, scale, tab = S.drumTab, keyPrefix = 'drums') {
    const hits = (tab && Array.isArray(tab.hits)) ? tab.hits : [];
    if (!hits.length) return;
    const bus = _ensureMasterBus();
    const tgt = target || (bus && bus.guideGain);
    if (!tgt) return;
    for (const h of hits) {
        if (!h || !Number.isFinite(h.t) || h.t < from || h.t >= to) continue;
        const key = _bandFiredKeyPure(keyPrefix + ':' + (h.p || ''), h.t);
        if (_bandFiredKeys.has(key)) continue;
        _bandFiredKeys.add(key);
        const note = DRUM_PIECE_GM_NOTE[h.p];
        const when = _guideChartToCtxPure(h.t, S.playStartWall, S.playStartTime, _auditionRate());
        if (note && gmDrumReady(note)) {
            // Authored velocity carries (ghost notes stay quiet, accents ring);
            // gmDrumVoiceAt clamps the floor. See _drumHitGainPure.
            const v = gmDrumVoiceAt(S.audioCtx, tgt, note, when, _drumHitGainPure(h.v, scale));
            if (v) { _guideVoices.push(v); continue; }
        }
        if (note) ensureGmDrum(note, S.audioCtx);   // tick while it loads
        _guideClapVoiceAt(when, tgt, Number.isFinite(scale) ? scale : 1);
    }
}

function _guideClapVoiceAt(when, target, scale) {
    const bus = _ensureMasterBus();
    if (!bus) return;
    // The part's strip volume (mixer panel, B6) scales the clap peak; at
    // zero the voice is skipped entirely (an exponential ramp target must
    // stay positive, and a silent oscillator is pointless bookkeeping).
    // Band mode passes an explicit per-part TARGET (the part's gain node
    // owns the strip level there) and a unit scale.
    const partVol = Number.isFinite(scale) ? scale : host.partClapState().vol;
    if (!(partVol > 0)) return;
    const ctx = S.audioCtx;
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = 1750;
    const g = ctx.createGain();
    // Soft tick: 3 ms ramp in (never a 0 ms transient) and ~45 ms exponential
    // decay — a locatable placement cue without startle.
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(0.8 * Math.min(1, partVol), when + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, when + 0.048);
    osc.connect(g);
    g.connect(target || bus.guideGain);
    osc.start(when);
    osc.stop(when + 0.06);
    _guideVoices.push({ osc, gain: g, until: when + 0.06 });
}

// Count-in pref (D-T-count-in): 0 = off, else bars of pre-roll clicks
// before the transport starts. Editor pref, never the pack.
export function editorCountInBars() {
    let raw = null;
    try { raw = localStorage.getItem('editorCountIn'); } catch (_) {}
    const n = parseInt(raw || '0', 10);
    return n === 1 || n === 2 || n === 4 ? n : 0;
}
export function editorSetCountIn(v) {
    const n = parseInt(v, 10);
    const bars = n === 1 || n === 2 || n === 4 ? n : 0;
    try {
        localStorage.setItem('editorCountIn', String(bars));
        // Remember the last non-zero count so the Count toggle can re-arm it —
        // recorded here so ALL write paths (toolbar select, LCD cell, toggle)
        // share one memory, not just the ones that set it themselves.
        if (bars > 0) localStorage.setItem('editorCountInLast', String(bars));
    } catch (_) {}
    const el = document.getElementById('editor-countin');
    if (el) el.value = String(bars);
    setStatus(bars
        ? `Count-in: ${bars} bar${bars === 1 ? '' : 's'} of clicks before playback (and recording) starts`
        : 'Count-in off');
}

// Metronome click: a band-limited soft pip. The accent (downbeat) is
// differentiated mainly by PITCH (~1000 vs ~800 Hz) with only a small level
// delta — the hearing-safe way to accent, rather than a louder transient.
function _metroClickVoiceAt(when, accent) {
    const bus = _ensureMasterBus();
    if (!bus) return;
    const ctx = S.audioCtx;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = accent ? 1000 : 800;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(accent ? 0.9 : 0.68, when + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, when + 0.04);
    osc.connect(g);
    g.connect(bus.clickGain);
    osc.start(when);
    osc.stop(when + 0.05);
    _guideVoices.push({ osc, gain: g, until: when + 0.05 });
}

// Cancel every queued-but-unfinished clap — stale voices would otherwise
// fire at their pre-seek positions after a loop wrap or scrub.
function _guideCancelVoices() {
    for (const v of _guideVoices) {
        try { v.osc.stop(); } catch (_) {}
        try { v.gain.disconnect(); } catch (_) {}
    }
    _guideVoices = [];
}

function _guideResetSchedule() {
    _guideCancelVoices();
    _guideScheduledUntil = S.cursorTime || 0;
    _guideLastFiredKey = null;  // a seek/wrap breaks cross-tick dedupe continuity
    // Same rule for the band's part-scoped keys (typeof-guarded: the sliced
    // compose_transport suite extracts this function without module state).
    if (typeof _bandFiredKeys !== 'undefined') _bandFiredKeys.clear();
}

function _guideTick() {
    // A/B overrides the claps pref while active: guide passes clap even
    // with the pref off; recording passes stay clean even with it on.
    const claps = _abClapsEnabledPure(_abActive(), _abPhase, editorGuideClapEnabled());
    const metro = editorMetronomeEnabled();
    // Band tracks are real DAW channels, not a flavor of the old guide-clap
    // toggle. They stay live beside stems until their own strip is muted.
    // A/B's recording-only pass remains an intentional global audition mute.
    const bandParts = (editorPlayAllTracksEnabled() && !S.drumEditMode
        && (!_abActive() || claps)) ? _bandPartsPure(S.arrangements, S.drumTab) : null;
    const bandLive = !!(bandParts && bandParts.length);
    if (!S.playing || !S.audioCtx || (!claps && !metro && !bandLive)) return;
    const nowChart = _transportChartTimePure(S.playStartTime, S.playStartWall, S.audioCtx.currentTime, _auditionRate());
    // Clamp the lookahead end to the loop-region end while looping, so no clap
    // is scheduled past the boundary before the rAF wrap cancels the window.
    const loopRegion = S.loopEnabled ? _normalizeLoopRegionPure(S.barSel, S.duration) : null;
    const to = _guideWindowEndPure(
        nowChart + GUIDE_LOOKAHEAD, !!loopRegion, loopRegion ? loopRegion.endTime : NaN);
    // If the timer stalled (hidden tab), skip events that are already in the
    // past rather than machine-gunning them late; 5 ms of grace keeps an
    // event exactly at the cursor audible.
    const from = Math.max(_guideScheduledUntil, nowChart - 0.005);
    if (to <= from) return;
    // Per-part mute/solo (mixer panel, B6): the active surface's part gates
    // its own guide here (only the guide — the reference audio rides its own
    // per-source strips: part solos never gate it (D5), and audio-band solos
    // reach it through applyStemMix, never this path). Gated at the
    // scheduler, not in _guideSourceTimes, so it never touches song duration.
    // The pitched GM voice IS this part's guide voice, so it sits inside the
    // same gate as the clap fallback.
    // Band mode gates on the REAL roster, not S.arrangements.length — a
    // drum-only chart has no arrangements but is still a band of one
    // (review #280, item 8).
    if (bandParts && bandParts.length) {
        // ── Band mode (multi-track MIDI playback) ────────────────────
        // EVERY part voices its own GM instrument through its own gain node
        // (the Tracks strips mix them live); drum parts clap. The per-part
        // gain owns the strip level, so voices schedule at unit scale, and
        // the dedupe key is part-scoped (two parts on the same millisecond
        // must both sound).
        _partGainsApply(false);
        for (const part of bandParts) {
            const target = _ensurePartGain(part.key);
            if (!target) continue;
            const arr = part.idx >= 0 ? S.arrangements[part.idx] : null;
            // The drum-grid arrangement (type:"drums") voices real GM percussion
            // from ITS OWN drum tab through this part's gain (review #282) —
            // with several drum parts, each voices its own hits, part-scoped
            // dedupe so two parts hitting the same piece both sound. Its own
            // notes are empty, so it must be caught BEFORE the clap-notes path
            // below. `part.key === 'drums'` is the legacy fallback for an
            // un-materialized tab (create-mode compose; idx -1 in the roster).
            if (part.key === 'drums' || (arr && isDrumArrangement(arr))) {
                _drumKitVoicesInWindow(from, to, target, 1,
                    (arr && arr.drumTab) || S.drumTab, part.key);
                continue;
            }
            // A drum-ENCODED pitched part (a legacy "Drums"-named arrangement with
            // real notes, not type:"drums") claps its rhythm through this part's
            // gain, else it voices neither GM nor clap and goes silent (review
            // #280 follow-up; GM percussion here is a follow-up).
            if (arr && arrKind(arr) === 'drums') {
                const times = _guideSanitizeTimesPure((arr.notes || []).map(n => n.time));
                for (const t of _guideClapTimesInWindowPure(times, from, to)) {
                    const k = _bandFiredKeyPure(part.key, t);
                    if (_bandFiredKeys.has(k)) continue;
                    _bandFiredKeys.add(k);
                    _guideClapVoiceAt(_guideChartToCtxPure(t, S.playStartWall, S.playStartTime, _auditionRate()), target, 1);
                }
                continue;
            }
            const gm = editorGmVoiceFor(_gmKindPure(arrKind(arr)));
            const ready = gm !== null && gmPresetReady(gm);
            if (gm !== null && !ready) ensureGmPreset(gm, S.audioCtx);   // clap while it loads
            const groups = _gmEventsInWindowPure(_bandPartPitchedEvents(part.idx), from, to, 4);
            for (const gp of groups) {
                const k = _bandFiredKeyPure(part.key, gp.t);
                if (_bandFiredKeys.has(k)) continue;
                _bandFiredKeys.add(k);
                const when = _guideChartToCtxPure(gp.t, S.playStartWall, S.playStartTime, _auditionRate());
                if (ready) {
                    for (const v of gp.voices) {
                        const voice = gmVoiceAt(S.audioCtx, target, gm, when, v.midi,
                            _gmVoiceDurationPure(v.sus) / _auditionRate());
                        if (voice) { _guideVoices.push(voice); continue; }
                        _guideClapVoiceAt(when, target, 1);   // ONE clap for the bucket
                        break;
                    }
                } else {
                    _guideClapVoiceAt(when, target, 1);
                }
            }
        }
    } else if (claps && host.partClapState().audible) {
        // Pitched GM mode (DAW 1.2): same charted times, instrument voices.
        // Falls back to the clap whenever the preset isn't ready (loading,
        // offline, no source) — the guide is never silent while enabled.
        const gm = editorGuideVoiceMode() === 'gm' ? _guideGmProgram() : null;
        if (gm !== null && gmPresetReady(gm)) {
            const bus = _ensureMasterBus();
            const groups = _gmEventsInWindowPure(_guidePitchedEvents(), from, to, 4);
            for (const gp of groups) {
                // Same cross-tick dedupe as the clap path (bucket split by a
                // window boundary must not re-fire).
                if (gp.key === _guideLastFiredKey) continue;
                _guideLastFiredKey = gp.key;
                const when = _guideChartToCtxPure(gp.t, S.playStartWall, S.playStartTime, _auditionRate());
                for (const v of gp.voices) {
                    // The sustain is in CHART seconds; gmVoiceAt schedules in WALL
                    // seconds. At 0.5x a note must ring twice as long to still cover
                    // its note in the slowed audio — divide by the rate, same as the
                    // chart→ctx mapping above.
                    const voice = bus && gmVoiceAt(
                        S.audioCtx, bus.guideGain, gm, when, v.midi,
                        _gmVoiceDurationPure(v.sus) / _auditionRate());
                    if (voice) { _guideVoices.push(voice); continue; }
                    // Race: preset dropped mid-tick — ONE clap for the whole
                    // bucket (never a stacked clap per chord note), then on.
                    _guideClapVoiceAt(when);
                    break;
                }
            }
        } else {
            if (gm !== null) ensureGmPreset(gm, S.audioCtx);   // clap while it loads
            if (S.drumEditMode) {
                // The drum grid's guide is the KIT, not a tick (each piece
                // plays its one-shot; still gated by the drum strip above).
                _drumKitVoicesInWindow(from, to, null, host.partClapState().vol);
            } else {
                const times = _guideClapTimesInWindowPure(_guideSourceTimes(), from, to);
                for (const t of times) {
                    // Cross-tick dedupe: skip an event in the same 1 ms bucket as the last
                    // clap already fired in a previous window (chord split by the boundary).
                    const key = Math.round(t * 1000);
                    if (key === _guideLastFiredKey) continue;
                    _guideLastFiredKey = key;
                    _guideClapVoiceAt(_guideChartToCtxPure(t, S.playStartWall, S.playStartTime, _auditionRate()));
                }
            }
        }
    }
    if (metro) {
        const clicks = _metroClicksInWindowPure(S.beats || [], from, to, _groupingAccentsLive(), _feelRangesLive());
        for (const c of clicks) {
            _metroClickVoiceAt(
                _guideChartToCtxPure(c.t, S.playStartWall, S.playStartTime, _auditionRate()), c.accent);
        }
        // Slowed audition subdivides the click (P2-10): 8ths, then 16ths, so
        // the slowed pulse still carries the rhythm. The subdivision times are
        // a pure function of the GRID — locked to it at every speed; only the
        // chart→ctx mapping (shared with every voice above) knows the rate.
        const div = _metroSubdivForRatePure(_auditionRate());
        if (div > 1) {
            for (const c of _metroSubdivClicksPure(S.beats || [], from, to, div)) {
                _metroClickVoiceAt(
                    _guideChartToCtxPure(c.t, S.playStartWall, S.playStartTime, _auditionRate()), false);
            }
        }
    }
    _guideScheduledUntil = to;
    // Drop bookkeeping for voices that already finished (bounded memory).
    if (_guideVoices.length > 64) {
        const nowCtx = S.audioCtx.currentTime;
        _guideVoices = _guideVoices.filter(v => v.until > nowCtx);
    }
    // Cross-tick dedupe keys accrue on every voiced path — band parts AND the
    // drum-edit guide (#282). The window only advances, so old keys are dead;
    // bound the scratch set here so it covers both (safe: never re-fires).
    if (_bandFiredKeys.size > 4096) _bandFiredKeys.clear();
}

// ── Audition trainer — loop-and-step-up (P2-10) ──────────────────────
// The classic slow-downer practice pattern: loop a short A/B
// selection slowed, and after every N completed passes step the audition
// rate up the ladder toward 100%. Rides the existing rate transform (#247)
// and loop region — no new audio path. Session-only state: a trainer armed
// on a later visit would read as a playback bug, exactly like A/B.

const TRAINER_PASSES_PER_STEP = 3;
let _trainerOn = false;
let _trainerPasses = 0;

// Armed AND the loop it rides is on — like _abActive(). Turning Loop off with
// the trainer armed can never leave a lit button over a trainer that will never
// see a wrap; the transport bar reads the lamp from here every tick.
export function _trainerActive() { return _trainerOn && !!S.loopEnabled; }

// Disarm and reset the ladder. Called on the exits that make a trainer
// meaningless: the loop region cleared, a new song loaded, the screen torn
// down. (Session-only state, exactly like A/B — see _abDisarm.)
export function _trainerDisarm() {
    _trainerOn = false;
    _trainerPasses = 0;
    _trainerRefreshBtn();
}

function _trainerRefreshBtn() {
    const btn = document.getElementById('editor-tp-trainer');
    if (!btn) return;
    // The transport bar styles "on" off aria-pressed (.editor-transport-btn
    // [aria-pressed="true"]) — there is no class to toggle.
    btn.setAttribute('aria-pressed', _trainerActive() ? 'true' : 'false');
}

export function editorToggleAuditionTrainer() {
    if (!_trainerOn) {
        const region = _normalizeLoopRegionPure(S.barSel, S.duration);
        if (!region || !S.loopEnabled) {
            setStatus('Trainer needs a loop: select a bar range and turn Loop on, then arm the trainer.');
            return true;
        }
        if (!_auditionActive() && _auditionRate() >= 1) {
            // Start the ladder at its slowest step; the select mirrors it.
            editorSetAuditionRate(TRAINER_LADDER[0]);
        }
        _trainerOn = true;
        _trainerPasses = 0;
        const pct = Math.round(_auditionRate() * 100);
        const ci = editorCountInBars();
        setStatus(`Trainer armed at ${pct}%: every ${TRAINER_PASSES_PER_STEP} passes the speed steps up toward 100%`
            + (ci ? ` — your ${ci}-bar count-in precedes each pass.` : ' — tip: arm Count for a count-in before each pass.'));
    } else {
        _trainerOn = false;
        setStatus('Trainer off — speed stays where it is.');
    }
    _trainerRefreshBtn();
    return true;
}

// Called from the playbackTick loop-wrap branch (one completed pass). May
// step the rate — safe exactly there because the wrap re-anchors the clock.
function _trainerOnLoopWrap() {
    if (!_trainerActive()) return;
    const r = _trainerOnWrapPure(_trainerPasses, TRAINER_PASSES_PER_STEP, _auditionRate(), TRAINER_LADDER);
    _trainerPasses = r.passes;
    if (r.stepTo !== null) {
        editorSetAuditionRate(r.stepTo);
        if (r.stepTo >= 1) {
            _trainerDisarm();
            setStatus('Trainer: full speed reached — you earned it. Trainer off.');
            return;
        }
        setStatus(`Trainer: stepping up to ${Math.round(r.stepTo * 100)}%.`);
        return;
    }
    setStatus(`Trainer: pass ${r.passes}/${TRAINER_PASSES_PER_STEP} at ${Math.round(_auditionRate() * 100)}%.`);
}

// A trainer pass restarts through the full start path when a count-in is
// armed, so the pre-roll clicks precede the pass at the slowed tempo (the
// count-in scheduler already rides the rate transform). Recording never
// takes this path — the wrap branch is skipped entirely while recording.
function _trainerWrapWantsCountIn() {
    return _trainerActive() && editorCountInBars() > 0 && !!S.audioBuffer;
}

// ── Loop A/B compare — the ear-training loop ─────────────────────────
// While looping, alternate each pass between the RECORDING (reference
// audible, claps off) and the GUIDE (reference muted via the mixer's
// transparent ref gain, claps on) so a charter can hear what they charted
// against what the artist played, one pass apart. Session-only state —
// deliberately not persisted: silently muting the recording on a later
// session would read as a playback bug.

/* @pure:loop-ab:start */
// Do claps schedule this tick? A/B overrides the claps pref while active:
// guide passes clap even with the pref off, recording passes stay clean
// even with it on.
function _abClapsEnabledPure(abActive, phase, clapsPref) {
    return abActive ? phase === 'guide' : clapsPref;
}
function _abNextPhasePure(phase) {
    return phase === 'guide' ? 'recording' : 'guide';
}
// The reference gain target: muted only during an ACTIVE A/B guide pass
// while playing; every other state restores the mixer fader's value.
function _abRefTargetPure(abActive, playing, phase, faderGain) {
    return (abActive && playing && phase === 'guide') ? 0 : faderGain;
}
/* @pure:loop-ab:end */

export let _abOn = false;
export let _abPhase = 'recording';   // every play starts by hearing the real thing

// A/B compares the recording against the guide — meaningless with no reference
// buffer (compose mode), where it would only gate half of each loop's claps to
// silence. Require a buffer so compose loops keep every clap.
function _abActive() { return _abOn && !!S.loopEnabled && !!S.audioBuffer; }

// Disarm A/B and restore the reference gain. main.js calls this from the loop
// disarm and the song-change reset — the only A/B state writes outside this
// module, kept here because the state is a live export (read-only to importers).
export function _abDisarm() {
    _abOn = false;
    _abPhase = 'recording';
    _abApplyRefGain();
    // Disarming A/B can flip _guideTimerSync's "want" (it includes _abActive()),
    // so re-sync here rather than leaving each caller to remember (CodeRabbit).
    _guideTimerSync();
}

export function _abApplyRefGain() {
    const rg = _ensureRefGain();
    if (!rg || !S.audioCtx) return;
    const target = _abRefTargetPure(
        _abActive(), !!S.playing, _abPhase,
        _mixGainForPctPure(_mixLoadPct().ref));
    // Same ~20 ms ramp as every mixer move — a phase flip is never a pop.
    rg.gain.setTargetAtTime(target, S.audioCtx.currentTime, 0.02);
}

function _abOnLoopWrap() {
    if (!_abActive()) return;
    _abPhase = _abNextPhasePure(_abPhase);
    _abApplyRefGain();
    setStatus(_abPhase === 'guide'
        ? 'A/B: guide pass (recording muted)'
        : 'A/B: recording pass');
}

export function _refreshLoopABBtn() {
    const btn = document.getElementById('editor-loop-ab-btn');
    if (!btn) return;
    const region = host.selectedLoopRegion();
    btn.disabled = !region;
    btn.classList.toggle('bg-accent', _abOn);
    btn.classList.toggle('hover:bg-accent-light', _abOn);
    btn.classList.toggle('bg-dark-600', !_abOn);
    btn.classList.toggle('hover:bg-dark-500', !_abOn);
    btn.setAttribute('aria-pressed', _abOn ? 'true' : 'false');
    btn.title = region
        ? 'A/B compare: each loop pass alternates — recording, then guide claps only (Alt+B)'
        : 'Set a loop region first — A/B alternates recording and guide per pass';
}

export function _editorToggleLoopAB() {
    if (!_abOn && !host.selectedLoopRegion()) {
        setStatus('Set a loop region first — A/B alternates recording and guide per pass');
        return true;
    }
    _abOn = !_abOn;
    _abPhase = 'recording';
    if (_abOn && !S.loopEnabled && host.selectedLoopRegion()) {
        // A/B is meaningless without looping — arm the loop exactly like the
        // Loop button, including the seek into the region when the cursor
        // sits outside it, so A/B never rides a pre-loop stretch of audio.
        host.setLoopRegionEnabled(true);
    }
    _abApplyRefGain();
    _refreshLoopABBtn();
    _guideTimerSync();   // guide passes need the scheduler even with claps off
    setStatus(_abOn
        ? 'Loop A/B on — first pass plays the recording, the next plays only the guide claps'
        : 'Loop A/B off');
    return true;
}
// window.editorToggleLoopAB re-attached in main.js

// Start/stop the scheduler to match "playing AND enabled". Called from
// startPlayback/stopPlayback and from the toggle (mid-play enable works).
export function _guideTimerSync() {
    const bandLive = editorPlayAllTracksEnabled() && !S.drumEditMode
        && _bandPartsPure(S.arrangements, S.drumTab).length > 0;
    const want = S.playing
        && (editorGuideClapEnabled() || editorMetronomeEnabled() || _abActive() || bandLive);
    if (want && !_guideTimer) {
        _guideScheduledUntil = _transportChartTimePure(
            S.playStartTime, S.playStartWall, S.audioCtx.currentTime, _auditionRate());
        _guideTimer = setInterval(_guideTick, GUIDE_TICK_MS);
        _guideTick(); // fill the first window now, not one tick late
    } else if (!want && _guideTimer) {
        clearInterval(_guideTimer);
        _guideTimer = null;
    }
}

export function _refreshGuideBtn() {
    const btn = document.getElementById('editor-guide-btn');
    if (!btn) return;
    const on = editorGuideClapEnabled();
    btn.classList.toggle('bg-accent', on);
    btn.classList.toggle('hover:bg-accent-light', on);
    btn.classList.toggle('bg-dark-600', !on);
    btn.classList.toggle('hover:bg-dark-500', !on);
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
}

export function _editorToggleGuideClap() {
    const next = !editorGuideClapEnabled();
    try { localStorage.setItem('editorGuideClap', next ? '1' : '0'); } catch (_) {}
    _refreshGuideBtn();
    _guideTimerSync();
    setStatus(next
        ? 'Guide voices on — charted notes play their instruments during playback (C toggles)'
        : 'Guide voices off');
    return true;
}
// window.editorToggleGuideClap re-attached in main.js

export function _refreshMetronomeBtn() {
    const btn = document.getElementById('editor-metronome-btn');
    if (!btn) return;
    const on = editorMetronomeEnabled();
    btn.classList.toggle('bg-accent', on);
    btn.classList.toggle('hover:bg-accent-light', on);
    btn.classList.toggle('bg-dark-600', !on);
    btn.classList.toggle('hover:bg-dark-500', !on);
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
}

export function _editorToggleMetronome() {
    const next = !editorMetronomeEnabled();
    try { localStorage.setItem('editorMetronome', next ? '1' : '0'); } catch (_) {}
    _refreshMetronomeBtn();
    _guideTimerSync();
    setStatus(next
        ? 'Metronome on — clicks follow the beat grid, accented on downbeats'
        : 'Metronome off');
    return true;
}
// window.editorToggleMetronome re-attached in main.js

// ── Audio mixer faders ───────────────────────────────────────────────
// The mixer UI moved to src/mixer-panel.js (workspace-shell B6 — the docked
// panel that replaced the floating popover). This module keeps the bus
// faders' write path and prefs; the panel seeds its controls through
// host.mixUiState (wired in main.js to _mixLoadPct + editorEditBlipEnabled).

export function editorSetMixLevel(bus, val) {
    if (bus !== 'ref' && bus !== 'guide' && bus !== 'click' && bus !== 'master') return;
    const p = _mixSetBusGain(bus, val);
    const label = document.getElementById('editor-mix-' + bus + '-val');
    // dB label (matching the strips), never '%'. Uses the shared pct→gain
    // curve so the label is honest above unity too (100..110 → 0..+10 dB).
    const gain = _mixGainForPctPure(p);
    const text = gain > 0
        ? (gain >= 1 ? '+' : '−') + Math.abs(20 * Math.log10(gain)).toFixed(1) + ' dB'
        : '−∞ dB';
    if (label) label.textContent = text;
    // Keep the slider's screen-reader value in step with the visible dB label.
    const slider = document.getElementById('editor-mix-' + bus);
    if (slider) slider.setAttribute?.('aria-valuetext', text);
}

export function editorSetEditBlip(on) {
    try { localStorage.setItem('editorEditBlip', on ? '1' : '0'); } catch (_) {}
    setStatus(on
        ? 'Edit blip on — a soft tick confirms note adds and pitch changes'
        : 'Edit blip off');
}

// Wired by main.js's init(), not at import — a module must have no side
// effects when it is loaded, or its tests cannot import it without a DOM.
// Seeds every audio toolbar button and restores the snap-mode pref.
export function initAudio() {
    _refreshOnsetBtn();
    // Seed the snap target from the persisted editor pref (grid by default).
    try {
        if (localStorage.getItem('editorSnapMode') === 'onset') S.snapMode = 'onset';
    } catch (_) {}
    // Seed the count-in select from the persisted pref.
    const ciEl = document.getElementById('editor-countin');
    if (ciEl) ciEl.value = String(editorCountInBars());
    _refreshSnapModeBtn();
    _refreshGuideBtn();
    _refreshMetronomeBtn();
}


// Stop playback and cancel every loop this module owns — main.js's screen
// teardown calls this so a replaced editor screen doesn't keep sounding or
// scheduling. The old inline teardown cancelled only the audio source and the
// rAF frame; the guide/metronome setInterval outlived it (a latent leak, since
// _guideTimer is module-scope and the module is never re-loaded). Clearing
// S.playing and syncing drops it — _guideTimerSync stops the timer when nothing
// wants it — and _guideCancelVoices silences any queued oscillators (Codex).
export function teardownAudio() {
    cancelAudioLoad();
    _cancelOnsetJob();
    _partGainsReset();
    _stemGainsReset();
    _stopStemSources();
    try { if (S.audioSource) { S.audioSource.stop(); S.audioSource = null; } } catch (_) { /* already stopped */ }
    _stopRefMedia();
    try { if (rafId) { cancelAnimationFrame(rafId); rafId = null; } } catch (_) { /* no frame queued */ }
    S.playing = false;
    _trainerDisarm();   // session-only: a replaced screen never comes back armed
    _guideTimerSync();
    _guideCancelVoices();
}
