// ════════════════════════════════════════════════════════════════════
// Record a Keys arrangement live from a MIDI keyboard (Web MIDI API).
//
// Two backends: the browser's Web MIDI, and the desktop app's native bridge —
// `_recMidiBackendPure` picks between them from the page domain and whether
// navigator.requestMIDIAccess exists, so the choice is testable without either.
//
// `_recState` is exported as a live `let`. Every writer is in this file, so the
// rest of the editor can read it (an import binding is read-only, which is
// exactly the guarantee wanted) — main.js wires it to host.isRecording() for the
// modules that only need the predicate.
//
// `drawGhostNotes` paints the in-flight take over the roll; main.js's drawNow
// calls it. The transport clock comes from src/transport.js so the recorder and
// the playback tick cannot drift apart.
//
// Browser surface: the record modal, `navigator.requestMIDIAccess`, and `ctx`.
// ════════════════════════════════════════════════════════════════════
import { DPR, canvas, ctx } from './canvas.js';
import { flattenChords } from './chords.js';
import { LABEL_W, timeToX } from './geometry.js';
import { host } from './host.js';
import { PIANO_LANE_H, _uniqueKeysName, isKeysMode, midiToY, noteToMidi, updatePianoRange } from './keys.js';
import { S } from './state.js';
import { _transportChartTimePure } from './transport.js';
import { setStatus } from './ui.js';

// ════════════════════════════════════════════════════════════════════
// Record Keys arrangement live from a MIDI keyboard (Web MIDI API)
// ════════════════════════════════════════════════════════════════════

let _recMidiAccess = null;                 // legacy private Web-MIDI access (fallback path)
let _recMidiInput = null;                  // legacy private Web-MIDI input (fallback path)
let _recMidiHandle = null;                 // host midi-input domain live handle {addListener, removeListener}
let _recMidiOpenKey = null;                // logicalSourceKey _recMidiHandle belongs to
let _recMidiOpenGen = 0;                   // bumped on every open/teardown; stale async opens self-close
export let _recState = 'idle';                    // idle | recording | finalizing
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
    return _transportChartTimePure(S.playStartTime, S.playStartWall, S.audioCtx.currentTime);
}

/* @pure:midi-adapter:start */
// Which MIDI backend the record path uses. The host `midi-input`
// capability domain is the org's ONE device-access boundary (one
// permission prompt, one source list, PII-redacted diagnostics) — prefer
// it whenever the host ships it; fall back to the editor's legacy private
// Web-MIDI path on older hosts; 'none' when neither exists.
export function _recMidiBackendPure(domain, hasWebMidi) {
    if (domain && domain.version === 1) return 'domain';
    return hasWebMidi ? 'private' : 'none';
}
// Normalize a device list to the picker's one shape [{id, label}]:
// domain sources carry {logicalSourceKey, label}; private Web-MIDI inputs
// carry {id, name, manufacturer}.
function _recMidiDeviceRowsPure(backend, list) {
    if (backend === 'domain') {
        return (list || []).map(s => ({
            id: s.logicalSourceKey,
            label: s.label || 'MIDI input',
        }));
    }
    return (list || []).map(inp => ({
        id: inp.id,
        label: inp.name || inp.manufacturer || `MIDI Device (${inp.id})`,
    }));
}
/* @pure:midi-adapter:end */

function _recMidiDomain() {
    const d = window.feedBack && window.feedBack.midiInput;
    return (d && d.version === 1) ? d : null;
}
export function _recMidiBackend() {
    return _recMidiBackendPure(
        _recMidiDomain(),
        typeof navigator !== 'undefined' && !!navigator.requestMIDIAccess);
}

async function _recMidiInit() {
    const backend = _recMidiBackend();
    if (backend === 'domain') {
        // `discover` is the domain's permission boundary (it gates the whole
        // Web-MIDI input list) — the analog of requestMIDIAccess below.
        try {
            const r = await _recMidiDomain().discover();
            return !(r && r.outcome === 'denied');
        } catch (e) {
            console.warn('[Editor] MIDI discover failed:', e);
            return false;
        }
    }
    if (backend !== 'private') return false;
    if (_recMidiAccess) return true;
    try {
        _recMidiAccess = await navigator.requestMIDIAccess({ sysex: false });
        _recMidiAccess.onstatechange = () => _recMidiUpdateDeviceList();
        return true;
    } catch (e) {
        console.warn('[Editor] MIDI access denied:', e);
        return false;
    }
}

// Pre-open the domain session for `id` (modal-open / device-change time,
// where async is fine). Start must stay SYNCHRONOUS — see the user-gesture
// comment in editorStartRecordMidi — so the session is ready before the
// Start click and _recMidiConnect only attaches the listener.
async function _recMidiEnsureOpen(id) {
    const d = _recMidiDomain();
    if (!d || !id) return false;
    if (_recMidiHandle && _recMidiOpenKey === id) return true;
    _recMidiDisconnectDomain();          // bumps _recMidiOpenGen
    // Snapshot the generation AFTER teardown. If a newer open — or a
    // teardown (device change / modal close) — happens while we await, the
    // generation moves on and this resolution is stale: we must NOT install
    // its handle (that would leak the session opened by the newer request
    // and resurrect a handle after teardown). Close the orphaned ref instead.
    const gen = ++_recMidiOpenGen;
    try {
        d.select(id);
        const r = await d.open({ requester: 'editor-record', logicalSourceKey: id });
        if (!r || !r.handle) return false;
        if (gen !== _recMidiOpenGen) {
            try { d.close({ requester: 'editor-record', logicalSourceKey: id }); } catch (_) { /* best-effort */ }
            return false;
        }
        _recMidiHandle = r.handle;
        _recMidiOpenKey = id;
        try { localStorage.setItem('editor.recordMidiDeviceId', id); } catch (_) {}
        return true;
    } catch (e) {
        console.warn('[Editor] MIDI open failed:', e);
        return false;
    }
}

function _recMidiDisconnectDomain() {
    const d = _recMidiDomain();
    if (_recMidiHandle) {
        try { _recMidiHandle.removeListener(_recMidiOnData); } catch (_) { /* best-effort */ }
    }
    if (d && _recMidiOpenKey) {
        // Release our ref on the SHARED session (the domain refcounts across
        // consumers — closing here never yanks the device from the drums
        // plugin or the input wizard).
        try { d.close({ requester: 'editor-record', logicalSourceKey: _recMidiOpenKey }); } catch (_) { /* best-effort */ }
    }
    _recMidiHandle = null;
    _recMidiOpenKey = null;
    // Invalidate any open() still in flight so its late resolution self-closes
    // instead of resurrecting a handle onto this torn-down session.
    _recMidiOpenGen++;
}

export function editorRecordMidiDeviceChanged(id) {
    try { localStorage.setItem('editor.recordMidiDeviceId', id); } catch (_) {}
    // Domain path: swap the pre-opened session to the new device now, so
    // the Start click stays synchronous. Private path connects at Start.
    if (_recMidiBackend() === 'domain') _recMidiEnsureOpen(id);
}

function _recMidiUpdateDeviceList() {
    const sel = document.getElementById('editor-record-midi-device');
    const noDevice = document.getElementById('editor-record-midi-no-device');
    const startBtn = document.getElementById('editor-record-midi-start');
    if (!sel) return;
    const backend = _recMidiBackend();
    let raw = [];
    if (backend === 'domain') {
        raw = _recMidiDomain().listSources();
    } else if (_recMidiAccess) {
        _recMidiAccess.inputs.forEach(inp => raw.push(inp));
    }
    const rows = _recMidiDeviceRowsPure(backend, raw);

    const saved = localStorage.getItem('editor.recordMidiDeviceId') || '';
    // Build options with createElement so device-supplied id/name strings
    // can't break out into HTML — Web MIDI metadata comes from the OS/USB
    // descriptor and isn't safe to interpolate via innerHTML.
    sel.replaceChildren();
    for (const row of rows) {
        const opt = document.createElement('option');
        opt.value = row.id;
        opt.textContent = row.label;
        if (row.id === saved) opt.selected = true;
        sel.appendChild(opt);
    }

    const empty = !rows.length;
    if (noDevice) noDevice.classList.toggle('hidden', !empty);
    if (startBtn) startBtn.disabled = empty;
}

// Arm the record path for `id`. Returns 'ok' | 'pending' | 'fail'.
// Domain path: the session was pre-opened by the modal / device-change
// handler, so this only (re)attaches the listener — synchronous, which
// the Start click requires. 'pending' means the pre-open is still in
// flight (we kick another and the user presses Start again).
function _recMidiConnect(id) {
    if (_recMidiBackend() === 'domain') {
        if (!_recMidiHandle || _recMidiOpenKey !== id) {
            _recMidiEnsureOpen(id);   // fire-and-forget; resolves for the retry
            return 'pending';
        }
        try { _recMidiHandle.removeListener(_recMidiOnData); } catch (_) { /* idempotent re-arm */ }
        _recMidiHandle.addListener(_recMidiOnData);
        try { localStorage.setItem('editor.recordMidiDeviceId', id); } catch (_) {}
        return 'ok';
    }
    // Legacy private Web-MIDI path (hosts without the midi-input domain).
    if (_recMidiInput) _recMidiInput.onmidimessage = null;
    _recMidiInput = null;
    if (!_recMidiAccess) return 'fail';
    _recMidiAccess.inputs.forEach(inp => {
        if (inp.id === id) {
            _recMidiInput = inp;
            // Both paths deliver RAW BYTES to _recMidiOnData — the domain
            // handle calls listeners with e.data, so the private path
            // unwraps the event here to keep one routing function.
            _recMidiInput.onmidimessage = (e) => _recMidiOnData(e.data);
            localStorage.setItem('editor.recordMidiDeviceId', id);
        }
    });
    return _recMidiInput ? 'ok' : 'fail';
}

// ── Live MIDI monitor taps ───────────────────────────────────────────
// Consumers (the drum-pad strip) receive every raw packet this module
// routes, independent of the recording state — the tap sits BEFORE the
// recording gate in _recMidiOnData. Taps ride the SAME refcounted session
// the record modal manages; _midiMonitorEnsure() arms the remembered (or
// first) device without the modal on the domain backend. On the legacy
// private Web-MIDI backend a tap only sees data while the record modal has
// a device connected — best-effort by design, never a second device path.
const _midiTaps = new Set();
export function _midiMonitorTap(fn) { _midiTaps.add(fn); }
export function _midiMonitorUntap(fn) { _midiTaps.delete(fn); }
export async function _midiMonitorEnsure() {
    if (_recMidiBackend() !== 'domain') return false;
    const ok = await _recMidiInit();          // discover = the permission boundary
    if (!ok) return false;
    let id = null;
    try { id = localStorage.getItem('editor.recordMidiDeviceId'); } catch (_) {}
    if (!id) {
        const rows = _recMidiDeviceRowsPure('domain', _recMidiDomain().listSources());
        id = rows.length ? rows[0].id : null;
    }
    if (!id) return false;
    const opened = await _recMidiEnsureOpen(id);
    if (opened && _recMidiHandle) {
        // Idempotent re-arm, same as _recMidiConnect: the recording gate
        // makes the shared listener a no-op for the record path until Start.
        try { _recMidiHandle.removeListener(_recMidiOnData); } catch (_) { /* idempotent */ }
        _recMidiHandle.addListener(_recMidiOnData);
    }
    return opened;
}

function _recMidiOnData(data) {
    // typeof-guarded: the midi_domain suite slices this function out of the
    // module source, and its env predates the monitor taps.
    if (typeof _midiTaps !== 'undefined' && _midiTaps.size) {
        for (const fn of _midiTaps) { try { fn(data); } catch (_) { /* tap errors never break recording */ } }
    }

    if (_recState !== 'recording') return;
    const [status, data1, velocity] = data;
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

export async function editorShowRecordMidiModal() {
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

    const backend = _recMidiBackend();
    if (backend === 'none') {
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
            // Domain path: pre-open the selected device's shared session
            // NOW so the Start click can stay synchronous (user-gesture
            // constraint in editorStartRecordMidi).
            if (backend === 'domain') {
                const devSel = document.getElementById('editor-record-midi-device');
                if (devSel && devSel.value) _recMidiEnsureOpen(devSel.value);
            }
        }
    }

    modal.classList.remove('hidden');
}

export function editorHideRecordMidiModal() {
    // Refuse to close while a take is active — explicit Stop is required.
    if (_recState !== 'idle') return;
    document.getElementById('editor-record-midi-modal').classList.add('hidden');
    // Release our ref on the shared domain session (refcounted — never
    // yanks the device from other consumers). Re-opens on next modal show.
    _recMidiDisconnectDomain();
}

export function editorStartRecordMidi() {
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
    const connected = _recMidiConnect(sel.value);
    if (connected === 'pending') {
        // Domain pre-open still in flight (rare — modal open kicks it);
        // the retry click lands after it resolves.
        status.textContent = 'Connecting to the MIDI device — press Start again in a moment.';
        return;
    }
    if (connected !== 'ok') {
        status.textContent = 'Failed to connect to MIDI device.';
        return;
    }

    // Splice + start playback synchronously inside the click handler:
    //   (a) Chrome/Edge autoplay policy requires the AudioContext.resume()
    //       inside host.startPlayback() to fire during the user-gesture grace
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
    host.updateArrangementSelector();
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
    // Restart cleanly if a playback is already running — host.startPlayback()
    // allocates a fresh AudioBufferSourceNode and overwrites S.audioSource,
    // which would otherwise orphan the existing source and desync stop.
    // Refresh S.cursorTime from chartTimeNow() before the restart so
    // punch-in resumes from the actual audio position, not the last
    // playbackTick() snapshot (which can lag on throttled/slow frames).
    if (S.playing) {
        S.cursorTime = chartTimeNow();
        host.stopPlayback();
    }
    host.startPlayback();

    // Reliable end-of-song finalize: rAF (playbackTick) can be throttled
    // or paused in backgrounded tabs and miss the EOF clamp, leaving
    // _recState='recording' after audio actually ends. AudioBufferSourceNode's
    // onended fires regardless of tab visibility. The state guard inside
    // also makes this a no-op when host.stopPlayback() triggers onended via
    // explicit Stop / spacebar — those paths set _recState='finalizing'
    // before audioSource.stop() runs.
    if (S.audioSource) {
        S.audioSource.onended = () => {
            if (_recState === 'recording') window.editorStopRecordMidi();
        };
    }

    fetch('/api/plugins/editor/add-arrangement', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: S.sessionId, arrangement }),
    }).catch(e => console.warn('[Editor] add-arrangement registration failed:', e));
}

export function editorStopRecordMidi() {
    if (_recState !== 'recording') return;
    _recState = 'finalizing';

    // Capture stop-time before stopping audio so the chart-time formula
    // still reads the in-flight playhead. Clamp to S.duration: when this
    // path is reached via the EOF branch in playbackTick, chartTimeNow()
    // has already crossed the song boundary, and any held/pedal-deferred
    // notes would otherwise be finalized past the chart length.
    const stopTime = Math.min(chartTimeNow(), S.duration || Infinity);
    host.stopPlayback();

    // When the take finalized at EOF (e.g. via audioSource.onended in a
    // backgrounded tab where playbackTick was throttled), playbackTick's
    // cursor-reset branch never ran. Reset here so the next playback
    // starts from 0, not from a stale end-of-song position.
    if (S.duration && stopTime >= S.duration) {
        S.cursorTime = 0;
        host.updateTimeDisplay();
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
    // Domain path: Stop hides the modal at the end of this function, so fully
    // release our ref on the shared session here — otherwise the refcount is
    // held open indefinitely (the modal-close teardown never runs on the Stop
    // path). Refcounted, so this never yanks the device from other consumers;
    // reopening the modal re-opens the session.
    _recMidiDisconnectDomain();

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
    host.updateArrangementSelector();
    host.updateStatus();
    host.draw();

    document.getElementById('editor-record-midi-modal').classList.add('hidden');
    const n = arr ? arr.notes.length : 0;
    setStatus(n
        ? `Recorded Keys arrangement (${n} notes). Save to commit.`
        : 'Stopped — no notes captured. The empty Keys arrangement is in the switcher.');
}

export function drawGhostNotes() {
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
