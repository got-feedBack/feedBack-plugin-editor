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
import { timeToX } from './geometry.js';
import {
    _gmEventsInWindowPure, _gmGuideModePure, _gmKindPure, _gmSanitizeEventsPure,
    _gmVoiceDurationPure, editorGmVoiceFor, ensureGmPreset, gmPresetReady, gmVoiceAt,
} from './gm-guide.js';
import { host } from './host.js';
import { _pickOnsetsPure, _spectralFluxOnsetsPlan, _spectralFluxStep } from './onsets.js';
import { _tourNoteAction } from './tour.js';
import { _rollMidiForNote, _rollPitchCtx, midiToFreq } from './keys.js';
import { _recState } from './midi-record.js';
import { notes } from './notes.js';
import { S } from './state.js';
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
        // Keep the playable URL for the pitch-preserving audition path (the
        // MediaElement needs a src; the decoded buffer feeds waveform + onsets).
        S.audioUrl = url;
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
    const dur = S.duration || 0;
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
    const sh = Number(S.audioShift) || 0;
    if (!raw || !sh) return raw;
    return raw.map(o => ({ ...o, t: o.t + sh }));   // carry s + per-band strengths
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
    return _audioTimelineDurationPure(S.duration, S.audioShift, S.audioBuffer && S.audioBuffer.duration);
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
        const refGain = _ensureRefGain();
        _refMediaNode.connect(refGain || S.audioCtx.destination);
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
    const st = _audioBufferStartPure(S.cursorTime, S.audioShift, S.audioBuffer && S.audioBuffer.duration);
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
    const st = _audioBufferStartPure(S.cursorTime, S.audioShift, S.audioBuffer && S.audioBuffer.duration);
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
        const refGain = _ensureRefGain();
        if (refGain) S.audioSource.connect(refGain);
        else S.audioSource.connect(S.audioCtx.destination);
        _mixApplyFirstPlayFade();
        const when = (preRoll > 0 || st.delay > 0) ? S.audioCtx.currentTime + preRoll + st.delay : 0;
        S.audioSource.start(when, st.offset);
    } else if (!st.play) {
        _stopRefMedia();
        S.audioSource = null;
    }
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
        // BEFORE the restart, which re-anchors the clock at the new rate.
        _trainerOnLoopWrap();
        if (_trainerWrapWantsCountIn()) {
            // Route the pass through the full start path so the armed
            // count-in pre-roll precedes it (at the slowed tempo — the
            // count-in clicks ride the same rate transform as everything).
            stopPlayback();
            S.cursorTime = loopRestart;
            startPlayback();
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
        const target = _followScrollTargetPure(
            S.cursorTime, cx, w, S.zoom, editorFollowEnabled());
        if (target !== null) S.scrollX = host.editorClampScrollX(target);
    }

    host.updateTimeDisplay();
    host.drawNow();
    rafId = requestAnimationFrame(playbackTick);
}

/* @pure:follow-scroll:start */
// Follow-playhead scroll policy: once the cursor crosses 80% of the view,
// jump the window so the cursor sits at 30% — but only when follow is on.
// Returns the UNCLAMPED scrollX target, or null for "don't move".
function _followScrollTargetPure(cursorTime, cursorX, viewW, zoom, followOn) {
    if (!followOn) return null;
    if (!(cursorX > viewW * 0.8)) return null;
    return cursorTime - (viewW * 0.3) / zoom;
}
/* @pure:follow-scroll:end */

export function editorFollowEnabled() {
    // Default ON — follow is today's behavior; the pref only records an
    // explicit opt-out.
    try { return localStorage.getItem('editorFollow') !== '0'; }
    catch (_) { return true; }
}

export function _editorToggleFollow() {
    const next = !editorFollowEnabled();
    try { localStorage.setItem('editorFollow', next ? '1' : '0'); } catch (_) {}
    setStatus(next
        ? 'Follow on — the view tracks the playhead during playback (Shift+L)'
        : 'Follow off — the view stays put while the song plays (Shift+L)');
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
function _metroClicksInWindowPure(beats, from, to) {
    if (!Array.isArray(beats) || !beats.length || !(to > from)) return [];
    let lo = 0, hi = beats.length;
    while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (beats[mid].time < from) lo = mid + 1; else hi = mid;
    }
    const out = [];
    for (let i = lo; i < beats.length && beats[i].time < to; i++) {
        out.push({ t: beats[i].time, accent: beats[i].measure > 0 });
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
        if (t1 <= from - (t1 - t0) || t0 >= to) { if (t0 >= to) break; continue; }
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
let _guideLastFiredKey = null; // last-fired 1 ms bucket key, PERSISTED across
                               // ticks so a chord straddling a window boundary
                               // (same bucket, split by the 25 ms tick) can't
                               // double-fire — per-window dedupe alone resets.

export function editorGuideClapEnabled() {
    try { return localStorage.getItem('editorGuideClap') === '1'; }
    catch (_) { return false; }
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
            + (editorGuideClapEnabled() ? '' : ' (turn guide claps on to hear it — C)'));
    } else {
        setStatus('Guide voice: clap');
    }
}
export function editorMetronomeEnabled() {
    try { return localStorage.getItem('editorMetronome') === '1'; }
    catch (_) { return false; }
}

/* @pure:audio-mixer:start */
// Mixer math for the 3-fader popover (recording / guide / click) and the
// edit-preview blip gating. Fader percents live in editor prefs (never the
// pack) and map linearly onto bus gain, so 100% = the bus's design ceiling
// (unity) — nothing here can boost a bus past the shipped headroom.
const MIX_DEFAULT_PCT = Object.freeze({ ref: 100, guide: 35, click: 25 });
// Parse a stored fader percent: corrupted values clamp into [0, 100] and
// non-numeric ones fall back, so a bad pref can never blast a bus.
function _mixPctFromStoredPure(raw, fallbackPct) {
    const n = parseInt(raw, 10);
    if (!Number.isFinite(n)) return fallbackPct;
    return Math.max(0, Math.min(100, n));
}
function _mixGainForPctPure(pct) {
    const p = Number(pct);
    if (!Number.isFinite(p)) return 0;
    return Math.max(0, Math.min(100, p)) / 100;
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
/* @pure:audio-mixer:end */

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
    guideGain.connect(limiter);
    clickGain.connect(limiter);
    limiter.connect(ctx.destination);
    _masterBus = { guideGain, clickGain, limiter };
    return _masterBus;
}

// Fader percents, cached so audio paths never read localStorage
// synchronously mid-schedule; seeded once, kept in sync by _mixSetBusGain.
let _mixPctCache = null;
export function _mixLoadPct() {
    if (_mixPctCache) return _mixPctCache;
    let ref = null, guide = null, click = null;
    try {
        ref = localStorage.getItem('editorMixRef');
        guide = localStorage.getItem('editorMixGuide');
        click = localStorage.getItem('editorMixClick');
    } catch (_) {}
    _mixPctCache = {
        ref: _mixPctFromStoredPure(ref, MIX_DEFAULT_PCT.ref),
        guide: _mixPctFromStoredPure(guide, MIX_DEFAULT_PCT.guide),
        click: _mixPctFromStoredPure(click, MIX_DEFAULT_PCT.click),
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
    _refGain.connect(S.audioCtx.destination);
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
        : bus === 'guide' ? 'editorMixGuide' : 'editorMixClick';
    const p = _mixPctFromStoredPure(String(pct), MIX_DEFAULT_PCT[bus]);
    _mixLoadPct()[bus] = p;
    try { localStorage.setItem(key, String(p)); } catch (_) {}
    const node = bus === 'ref' ? _refGain
        : bus === 'guide' ? (_masterBus && _masterBus.guideGain)
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
    if (!S.arrangements.length) return [];
    return _guideSanitizeTimesPure(notes().map(n => n.time));
}

// The current part's GM program for the pitched guide (null = keep
// clapping: no arrangements, or the drum grid — drums keep their clap).
function _guideGmProgram() {
    if (S.drumEditMode || !S.arrangements.length) return null;
    const arr = S.arrangements[S.currentArr];
    if (!arr) return null;
    return editorGmVoiceFor(_gmKindPure(arr.name));
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

function _guideClapVoiceAt(when) {
    const bus = _ensureMasterBus();
    if (!bus) return;
    // The part's strip volume (mixer panel, B6) scales the clap peak; at
    // zero the voice is skipped entirely (an exponential ramp target must
    // stay positive, and a silent oscillator is pointless bookkeeping).
    const partVol = host.partClapState().vol;
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
    g.connect(bus.guideGain);
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
}

function _guideTick() {
    // A/B overrides the claps pref while active: guide passes clap even
    // with the pref off; recording passes stay clean even with it on.
    const claps = _abClapsEnabledPure(_abActive(), _abPhase, editorGuideClapEnabled());
    const metro = editorMetronomeEnabled();
    if (!S.playing || !S.audioCtx || (!claps && !metro)) return;
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
    // its own guide here (only the guide — the reference recording is a bus,
    // not a part, and stays audible under any solo, D5). Gated at the
    // scheduler, not in _guideSourceTimes, so it never touches song duration.
    // The pitched GM voice IS this part's guide voice, so it sits inside the
    // same gate as the clap fallback.
    if (claps && host.partClapState().audible) {
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
    if (metro) {
        const clicks = _metroClicksInWindowPure(S.beats || [], from, to);
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
}

// ── Audition trainer — loop-and-step-up (P2-10) ──────────────────────
// The Riff-Repeater / slow-downer practice pattern: loop a short A/B
// selection slowed, and after every N completed passes step the audition
// rate up the ladder toward 100%. Rides the existing rate transform (#247)
// and loop region — no new audio path. Session-only state: a trainer armed
// on a later visit would read as a playback bug, exactly like A/B.

const TRAINER_PASSES_PER_STEP = 3;
let _trainerOn = false;
let _trainerPasses = 0;

export function _trainerActive() { return _trainerOn; }

function _trainerRefreshBtn() {
    const btn = document.getElementById('editor-tp-trainer');
    if (!btn) return;
    btn.classList.toggle('editor-tp-on', _trainerOn);
    btn.setAttribute('aria-pressed', _trainerOn ? 'true' : 'false');
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
    if (!_trainerOn) return;
    const r = _trainerOnWrapPure(_trainerPasses, TRAINER_PASSES_PER_STEP, _auditionRate(), TRAINER_LADDER);
    _trainerPasses = r.passes;
    if (r.stepTo !== null) {
        editorSetAuditionRate(r.stepTo);
        if (r.stepTo >= 1) {
            _trainerOn = false;
            _trainerRefreshBtn();
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
    return _trainerOn && editorCountInBars() > 0 && !!S.audioBuffer;
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
    const want = S.playing
        && (editorGuideClapEnabled() || editorMetronomeEnabled() || _abActive());
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
        ? 'Guide claps on — charted notes tick during playback (C toggles)'
        : 'Guide claps off');
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
    if (bus !== 'ref' && bus !== 'guide' && bus !== 'click') return;
    const p = _mixSetBusGain(bus, val);
    const label = document.getElementById(
        (bus === 'ref' ? 'editor-mix-ref' : bus === 'guide' ? 'editor-mix-guide' : 'editor-mix-click') + '-val');
    if (label) label.textContent = p + '%';
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
    try { if (S.audioSource) { S.audioSource.stop(); S.audioSource = null; } } catch (_) { /* already stopped */ }
    _stopRefMedia();
    try { if (rafId) { cancelAnimationFrame(rafId); rafId = null; } } catch (_) { /* no frame queued */ }
    S.playing = false;
    _guideTimerSync();
    _guideCancelVoices();
}
