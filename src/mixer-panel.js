// ════════════════════════════════════════════════════════════════════
// Mixer panel (workspace-shell B6) — the one first-class mixer surface.
//
// Consolidates the old floating audio-mixer popover (and the never-implemented
// stem-mixer stub) into a DOCKED panel beside the canvas (inspector idiom):
// one channel strip per part (volume · mute · solo) over the three bus faders
// (recording / guide / click) and the edit blip.
//
// This module owns the CANONICAL per-part mix state, `S.partMix` — a map from
// part key ('arr:<idx>' for arrangements, the drums arrangement included) to
// { vol, mute, solo }. Today the only per-part sound is the guide voice (claps
// follow the active editing surface), so mute/solo/volume gate and scale the
// guide claps for the part being edited; the Parts-gutter M/S/A (§2.5) and
// per-part instrument voices (GM slice) read the SAME state when they arrive —
// this panel is the source of truth, not a mirror.
//
// The solo rule is the DAW one: any solo anywhere → only soloed strips sound;
// mute always wins. It spans BOTH bands — the master-mix strip is a peer audio
// track, so a transcription-part solo silences it like anything else (solo the
// master too to hear both). Only the recording / guide / click BUSES sit
// outside the rule: buses are not parts and are never gated by solo.
// Audio consumes the state through `host.partClapState` (inert default:
// audible at unity), so src/audio.js never imports this module.
//
// Panel open state is an editor pref (`editorMixerPanel`, never the pack);
// bus levels stay on the existing `editorMix*` prefs owned by src/audio.js.
// Part mute/solo/volume is SESSION state — it resets with the loaded song
// (create.js / file-ops.js clear `S.partMix` when they install arrangements).
// ════════════════════════════════════════════════════════════════════
import { activeDrumArrangementIndex } from './drum-arrangement.js';
import { host } from './host.js';
import { S, editGen } from './state.js';
import { _editorEscHtml, setStatus } from './ui.js';

/* @pure:mixer-panel:start */
// One strip per part, keyed the way S.currentArr addresses parts (by index).
// The drums arrangement is an ordinary `type:"drums"` entry in `arrangements`
// now (its strip is `arr:<idx>` like any other part — no `'drums'` singleton),
// so a single pass over the arrangements covers it. `drumTab` is unused here;
// it stays in the signature so callers match the sibling roster builders.
export function _mixerPartsPure(arrangements, drumTab, stems, removedSourceIds, master) {
    const parts = [];
    // The master mix leads the audio band as its own channel strip (keyed
    // 'audio:master', same store/solo rule as the stems) so every audio source
    // — master included — has a strip, matching the DAW track-session mixer.
    // `master` is null in compose mode (no recording) so no phantom strip shows.
    const removed = new Set(Array.isArray(removedSourceIds) ? removedSourceIds : []);
    const seen = new Set();
    if (master && !removed.has('master')) {
        parts.push({ key: 'audio:master', name: master.name || 'Master Mix', kind: 'audio' });
        seen.add('master');
    }
    // Then the studio stems (the rest of the audio band), then transcription
    // parts. Stem strips key by 'audio:<id>' — the same S.partMix store and
    // whole-map solo rule the synth parts use, so one mixer drives both.
    for (const stem of (Array.isArray(stems) ? stems : [])) {
        const id = stem && typeof stem.id === 'string' ? stem.id : '';
        if (!id || removed.has(id) || seen.has(id)) continue;
        seen.add(id);
        parts.push({ key: 'audio:' + id, name: stem.name || id, kind: 'audio' });
    }
    (arrangements || []).forEach((arr, i) => {
        parts.push({
            key: 'arr:' + i,
            name: (arr && arr.name) || 'Track ' + (i + 1),
        });
    });
    return parts;
}
// Fader positions run 0..110: 0..100 is linear to unity, 101..110 adds
// +1..+10 dB of intentional headroom (a quiet stem can be pushed up).
const MIXER_FADER_MAX = 110;
// A part's strip state, defaulted and clamped: an absent entry is an audible
// part at unity, and a corrupted volume can never boost past the +10 dB ceiling.
export function _mixerPartStatePure(partMix, key) {
    const m = (partMix && typeof partMix === 'object') ? partMix[key] : null;
    const v = m ? Number(m.vol) : NaN;
    return {
        vol: Number.isFinite(v) ? Math.max(0, Math.min(MIXER_FADER_MAX, v)) : 100,
        mute: !!(m && m.mute),
        solo: !!(m && m.solo),
    };
}
// Fader position → linear gain: unity at 100, up to +10 dB (≈3.162) at 110.
export function _mixerGainForFaderPure(position) {
    const p = Math.max(0, Math.min(MIXER_FADER_MAX, Number(position) || 0));
    if (p <= 100) return p / 100;
    return 10 ** ((p - 100) / 20);
}
// A fader position's dB label ('−∞ dB' at 0, '+10.0 dB' at 110).
export function _mixerFaderLabelPure(position) {
    const gain = _mixerGainForFaderPure(position);
    if (!(gain > 0)) return '−∞ dB';
    const db = 20 * Math.log10(gain);
    return (db >= 0 ? '+' : '−') + Math.abs(db).toFixed(1) + ' dB';
}
// A dB VALUE's compact label for the peak readout (input is already dB).
export function _mixerDbLabelPure(db) {
    const value = Number(db);
    if (!Number.isFinite(value) || value <= -60) return '−∞';
    return (value > -10 ? value.toFixed(1) : Math.round(value).toString()) + ' dB';
}
// Reorder the strips to match the Tracks-column row order (orderedKeys),
// so a drag-reorder in the left pane moves the mixer strip too. Keys not in
// the order list keep their original relative position at the tail — a
// stable sort by (index in orderedKeys, original index).
export function _mixerOrderedPartsPure(parts, orderedKeys) {
    const rank = new Map((Array.isArray(orderedKeys) ? orderedKeys : []).map((k, i) => [k, i]));
    const TAIL = Number.MAX_SAFE_INTEGER;
    return (Array.isArray(parts) ? parts : [])
        .map((p, i) => [p, rank.has(p.key) ? rank.get(p.key) : TAIL, i])
        .sort((a, b) => (a[1] - b[1]) || (a[2] - b[2]))
        .map(entry => entry[0]);
}
// Meter ballistics: instant attack (peaks show at once), gravity decay
// (~full-scale over 700 ms) so a transient doesn't strobe.
export function _mixerMeterNextPure(previous, input, elapsedMs) {
    const prev = Math.max(0, Math.min(1, Number(previous) || 0));
    const next = Math.max(0, Math.min(1, Number(input) || 0));
    if (next >= prev) return next;
    return Math.max(next, prev - Math.max(0, Number(elapsedMs) || 0) / 700);
}
export function _mixerAnySoloPure(partMix) {
    if (!partMix || typeof partMix !== 'object') return false;
    return Object.keys(partMix).some(k => partMix[k] && partMix[k].solo);
}
// The DAW audibility rule over PART keys only: mute always wins; any solo
// anywhere means only soloed strips sound. One rule for BOTH bands — the
// master mix strip is a peer AUDIO TRACK (the full-mix recording; the actual
// output fader is the mixer's master BUS, not this strip), so a transcription-
// part solo silences it exactly like a stem solo does. Soloing a track means
// "isolate this" — hear the reference alongside a soloed part by soloing the
// master too. Buses (recording/guide/click) are not parts and never pass
// through here.
export function _mixerPartAudiblePure(partMix, key) {
    const st = _mixerPartStatePure(partMix, key);
    if (st.mute) return false;
    return _mixerAnySoloPure(partMix) ? st.solo : true;
}
// The mix key of the ACTIVE editing surface: the drums arrangement's channel
// while the drum grid is open (`arr:<drumIdx>` — currentArr itself stays on a
// pitched arrangement, #337), else the current pitched arrangement.
export function _mixerActivePartKeyPure(drumEditMode, currentArr, drumIdx) {
    return (drumEditMode && Number(drumIdx) >= 0)
        ? 'arr:' + drumIdx
        : 'arr:' + (Number(currentArr) || 0);
}
// What the guide-clap scheduler needs for the ACTIVE editing surface: claps
// follow the drum grid in drum mode, the current arrangement otherwise, so
// that surface's part decides whether (and how loud) the claps sound.
export function _mixerClapStatePure(partMix, drumEditMode, currentArr, drumIdx) {
    const key = _mixerActivePartKeyPure(drumEditMode, currentArr, drumIdx);
    return {
        audible: _mixerPartAudiblePure(partMix, key),
        vol: _mixerGainForFaderPure(_mixerPartStatePure(partMix, key).vol),
    };
}
// Panel open-state pref round-trip ('1'/'0'; anything else = closed).
export function _mixerOpenFromStoredPure(raw) {
    return raw === '1';
}
/* @pure:mixer-panel:end */

// The host-hook target audio.js consults per scheduled clap voice.
export function _mixerClapState() {
    // The ACTIVE drum part's channel (a song can hold several) — its strip
    // gates the grid's guide claps, whichever part is open.
    return _mixerClapStatePure(S.partMix, S.drumEditMode, S.currentArr, activeDrumArrangementIndex(S.arrangements, S.drumTab));
}

// Band mode's per-KEY twin (host.partStripState): {audible, vol 0..1} for
// any strip key, whole-map solo rule included — the engine's per-part gain
// nodes ramp to exactly this, so the strips ARE the MIDI mixer.
export function _mixerPartStripState(key) {
    return {
        audible: _mixerPartAudiblePure(S.partMix, key),
        vol: _mixerGainForFaderPure(_mixerPartStatePure(S.partMix, key).vol),
    };
}

function _panel() { return document.getElementById('editor-mixer-panel'); }

// ── Strip rendering (memoized — never rides the draw loop) ───────────
let _lastKey = '';
let _mixerCloseTimer = 0;

function _msBtn(key, act, pressed, label, title) {
    return `<button data-mix-part="${key}" data-mix-act="${act}" aria-pressed="${pressed}"`
        + ` class="editor-mix-ms" title="${title}">${label}</button>`;
}

// The meter column beside a strip's fader: a vertical bar (filled by JS each
// frame), a dB scale, and the peak/clip readout.
function _meterMarkup(key, extraClass = '') {
    return `<div class="editor-mixer-meter-group">`
        + `<div class="editor-mixer-meter ${extraClass}" data-meter-key="${key}" aria-hidden="true"><span></span></div>`
        + `<div class="editor-mixer-db-scale" aria-hidden="true"><i>0</i><i>−6</i><i>−12</i><i>−24</i><i>−48</i><i>−∞</i></div>`
        + `<output class="editor-mixer-db-readout" data-meter-readout="${key}">−∞</output></div>`;
}

// The S.partMix key of the currently-selected Tracks-column row, so the
// matching strip lights up (selection is one shared idea across surfaces).
function _selectedStripKeyPure() {
    const selected = (S.trackSession && S.trackSession.tracks || [])
        .find(track => track.id === S.selectedTrackId);
    if (!selected) return '';
    if (selected.type === 'audio') return 'audio:' + selected.sourceId;
    if (selected.type === 'transcription') {
        // The drums arrangement resolves through the same id→index path as any
        // other part (its id is 'drums', so targetId 'drums' → its arr:<idx>).
        const idx = (S.arrangements || [])
            .findIndex((arr, i) => String((arr && arr.id) || ('arr:' + i)) === selected.targetId);
        return idx >= 0 ? 'arr:' + idx : '';
    }
    return '';
}

// The master-mix strip descriptor, or null in compose mode (no recording).
// Named from the pack's authored master name, else the song title.
function _mixerMaster() {
    return (S.masterAudioUrl || S.audioUrl)
        ? { name: S.masterAudioName || S.title || 'Master Mix' } : null;
}

// A vertical channel strip per part: type badge, M/S, the meter+fader
// channel, a dB value, and the name — faithful to the #285 console.
function _renderParts(container) {
    const parts = _mixerOrderedPartsPure(
        _mixerPartsPure(S.arrangements, S.drumTab, S.stems, S.trackSession && S.trackSession.removedSourceIds, _mixerMaster()),
        host.mixerTrackOrder());
    if (!parts.length) {
        container.innerHTML = '<p class="text-[10px] text-gray-500 self-center">No tracks yet — strips appear as tracks are added.</p>';
        return;
    }
    const selectedKey = _selectedStripKeyPure();
    container.innerHTML = parts.map(p => {
        const st = _mixerPartStatePure(S.partMix, p.key);
        const name = _editorEscHtml(p.name);
        return `<div class="editor-mixer-strip ${p.kind === 'audio' ? 'editor-mixer-audio-strip' : 'editor-mixer-transcription-strip'}${p.key === selectedKey ? ' editor-mixer-selected' : ''}" data-mix-row="${p.key}">`
            + `<span class="editor-mixer-strip-type">${p.kind === 'audio' ? 'AUDIO' : 'MIDI'}</span>`
            + `<div class="editor-mixer-ms-row">`
            + _msBtn(p.key, 'mute', st.mute, 'M', 'Mute track')
            + _msBtn(p.key, 'solo', st.solo, 'S', p.kind === 'audio'
                ? 'Solo track — isolates it among the audio tracks'
                : 'Solo track — the recording stays audible')
            + `</div>`
            + `<div class="editor-mixer-channel">`
            + _meterMarkup(p.key)
            + `<input type="range" min="0" max="110" step="0.1" value="${st.vol}" data-mix-part="${p.key}" data-mix-act="vol"`
            + ` aria-label="${name} fader level" aria-valuetext="${_mixerFaderLabelPure(st.vol)}" class="editor-mixer-fader"></div>`
            + `<span data-mix-val="${p.key}" class="editor-mixer-value">${_mixerFaderLabelPure(st.vol)}</span>`
            + `<span class="editor-mixer-strip-name" title="${name}">${name}</span>`
            + `</div>`;
    }).join('');
}

// ── Live meters (rAF-driven; only while the drawer is open) ──────────
let _meterFrame = 0;
let _meterLastAt = 0;
const _meterShown = Object.create(null);
const _meterPeakDb = Object.create(null);
const _meterPeakAt = Object.create(null);

// Peak-readout routing MUST mirror _mixerMeterInputPure's fallbacks, or a
// strip whose meter moves off a bus (the active audio strip → ref, the active
// transcription strip → guide) shows a permanent −∞ peak beside a live meter.
export function _mixerMeterPeakPure(key, levels, activeAudioId, activePart) {
    if (key.startsWith('bus:')) return levels.peaks && levels.peaks[key.slice(4)];
    if (levels.trackPeaks && Number.isFinite(levels.trackPeaks[key])) return levels.trackPeaks[key];
    if (key === 'audio:' + (activeAudioId || 'master')) return levels.peaks && levels.peaks.ref;
    if (key === activePart) return levels.peaks && levels.peaks.guide;
    return -Infinity;
}

function _meterPeakForKey(key, levels) {
    const activePart = _mixerActivePartKeyPure(S.drumEditMode, S.currentArr, activeDrumArrangementIndex(S.arrangements, S.drumTab));
    return _mixerMeterPeakPure(key, levels, S.activeAudioSourceId, activePart);
}

export function _mixerMeterInputPure(key, levels, activeAudioId, activePart, playAll) {
    if (key.startsWith('bus:')) return levels[key.slice(4)] || 0;
    if (key.startsWith('audio:') && levels.tracks && Number.isFinite(levels.tracks[key])) return levels.tracks[key];
    if (key === 'audio:' + (activeAudioId || 'master')) return levels.ref;
    if (playAll && levels.tracks && Number.isFinite(levels.tracks[key])) return levels.tracks[key];
    // A transcription strip has no audio of its own — show the guide bus while
    // that part is the active editing surface (its claps sound), else idle.
    return key === activePart ? levels.guide : 0;
}

function _meterInputForKey(key, levels) {
    const activePart = _mixerActivePartKeyPure(S.drumEditMode, S.currentArr, activeDrumArrangementIndex(S.arrangements, S.drumTab));
    return _mixerMeterInputPure(key, levels, S.activeAudioSourceId, activePart,
        host.playAllTracksEnabled());
}

function _meterTick(at) {
    _meterFrame = 0;
    const panel = _panel();
    if (!panel || panel.classList.contains('hidden')) return;
    const elapsed = _meterLastAt ? Math.min(100, at - _meterLastAt) : 16;
    _meterLastAt = at;
    const levels = host.mixerMeterLevels();
    const meters = panel.querySelectorAll ? panel.querySelectorAll('[data-meter-key]') : [];
    for (const meter of meters) {
        const key = meter.getAttribute('data-meter-key');
        const shown = _mixerMeterNextPure(_meterShown[key], _meterInputForKey(key, levels), elapsed);
        _meterShown[key] = shown;
        const fill = meter.querySelector('span');
        if (fill && fill.style) fill.style.height = (shown * 100).toFixed(1) + '%';
        const peak = _meterPeakForKey(key, levels);
        if (Number.isFinite(peak) && (!Number.isFinite(_meterPeakDb[key]) || peak >= _meterPeakDb[key]
                || at - (_meterPeakAt[key] || 0) >= 1500)) {
            _meterPeakDb[key] = peak;
            _meterPeakAt[key] = at;
        } else if (at - (_meterPeakAt[key] || 0) >= 3000) {
            _meterPeakDb[key] = -Infinity;
        }
        const readout = panel.querySelector(`[data-meter-readout="${key}"]`);
        if (readout) {
            readout.textContent = _mixerDbLabelPure(_meterPeakDb[key]);
            readout.classList.toggle('is-clipping', Number(_meterPeakDb[key]) > 0);
        }
    }
    if (typeof requestAnimationFrame === 'function') _meterFrame = requestAnimationFrame(_meterTick);
}

function _startMeters() {
    if (!_meterFrame && typeof requestAnimationFrame === 'function') {
        _meterLastAt = 0;
        _meterFrame = requestAnimationFrame(_meterTick);
    }
}

function _stopMeters() {
    if (_meterFrame && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(_meterFrame);
    _meterFrame = 0;
    _meterLastAt = 0;
}

// Seed the bus faders + blip checkbox from their prefs (owned by audio.js,
// read through the host hook so this module stays audio-import-free).
// The header's band-mode toggle mirrors the persisted pref (read through a
// host hook so this module stays audio-import-free).
function _renderPlayAll() {
    const btn = document.getElementById('editor-mixer-play-all');
    if (btn) btn.setAttribute('aria-pressed', host.playAllTracksEnabled() ? 'true' : 'false');
}

function _renderBuses() {
    const ui = host.mixUiState();
    for (const [bus, id] of [['ref', 'editor-mix-ref'], ['guide', 'editor-mix-guide'], ['click', 'editor-mix-click'], ['master', 'editor-mix-master']]) {
        const slider = document.getElementById(id);
        const label = document.getElementById(id + '-val');
        const text = _mixerFaderLabelPure(ui.pcts[bus]);
        if (slider) { slider.value = String(ui.pcts[bus]); slider.setAttribute?.('aria-valuetext', text); }
        if (label) label.textContent = text;
    }
}

// Toolbar "Mix" button + transport "Mix" button track the panel like every
// other toggleable chrome (pressed = open).
function _refreshMixerButtons(open) {
    const btn = document.getElementById('editor-mixer-btn');
    if (btn) {
        btn.classList.toggle('bg-accent', open);
        btn.classList.toggle('hover:bg-accent-light', open);
        btn.classList.toggle('bg-dark-600', !open);
        btn.classList.toggle('hover:bg-dark-500', !open);
        btn.setAttribute('aria-pressed', open ? 'true' : 'false');
    }
    const tp = document.getElementById('editor-tp-mixer');
    if (tp) tp.setAttribute('aria-pressed', open ? 'true' : 'false');
}

function _setPart(key, patch) {
    if (!S.partMix || typeof S.partMix !== 'object') S.partMix = {};
    S.partMix[key] = { ..._mixerPartStatePure(S.partMix, key), ...patch };
    // Band mode ramps the part's live gain node off this (inert otherwise).
    host.partMixChanged();
}

// Companion surfaces (the Tracks header column) mutate the SAME canonical
// partMix through these thin verbs — this panel stays the owner, so the
// solo rule and the partMixChanged notification can never fork.
export function mixerTogglePart(key, which) {
    const st = _mixerPartStatePure(S.partMix, key);
    _setPart(key, which === 'mute' ? { mute: !st.mute } : { solo: !st.solo });
    _lastKey = '';
    _mixerPanelRefresh();
}
export function mixerSetPart(key, patch) {
    _setPart(key, patch);
    // Keep the mixer panel's companion fader in sync when the change came in
    // from the Tracks header column (track-session.js) — same as the M/S verb.
    _lastKey = '';
    _mixerPanelRefresh();
}

// One delegated listener pair on the (static) panel element — guarded so a
// defensive double-init can never stack handlers. The panel element itself is
// replaced when the host re-injects the screen, so nothing leaks across
// re-injection either.
function _wire(panel) {
    if (panel.__mixerWired) return;
    panel.__mixerWired = true;
    panel.addEventListener('click', (e) => {
        const btn = e.target && e.target.closest ? e.target.closest('[data-mix-act="mute"],[data-mix-act="solo"]') : null;
        if (!btn) return;
        const key = btn.getAttribute('data-mix-part');
        const act = btn.getAttribute('data-mix-act');
        const st = _mixerPartStatePure(S.partMix, key);
        _setPart(key, act === 'mute' ? { mute: !st.mute } : { solo: !st.solo });
        _lastKey = '';
        _mixerPanelRefresh();
        const now = _mixerPartStatePure(S.partMix, key);
        const isAudio = typeof key === 'string' && key.startsWith('audio:');
        setStatus(act === 'mute'
            ? (now.mute
                ? (isAudio ? 'Track muted' : 'Track muted — its guide voice is silent')
                : 'Track unmuted')
            : (now.solo
                ? (isAudio
                    ? 'Track soloed — unsoloed audio tracks and unsoloed guide voices are silent'
                    : 'Track soloed — other tracks’ guide voices are silent; the recording stays audible')
                : 'Solo off'));
    });
    panel.addEventListener('input', (e) => {
        const el = e.target;
        if (!el || el.getAttribute('data-mix-act') !== 'vol') return;
        const key = el.getAttribute('data-mix-part');
        _setPart(key, { vol: Number(el.value) });
        const label = _mixerFaderLabelPure(_mixerPartStatePure(S.partMix, key).vol);
        if (el.setAttribute) el.setAttribute('aria-valuetext', label);
        const val = panel.querySelector(`[data-mix-val="${key}"]`);
        if (val) val.textContent = label;
    });
    // The drawer's close button + its fall-animation completion.
    const close = document.getElementById('editor-mixer-close');
    if (close && !close.__mixerCloseWired) {
        close.__mixerCloseWired = true;
        close.addEventListener('click', () => editorToggleMixerPanel(false));
    }
    panel.addEventListener('animationend', (e) => {
        if (e.target === panel && e.animationName === 'editor-mixer-fall') _finishMixerClose(panel);
    });
}

// Memoized refresh, called from updateStatus() beside the other companion
// strips: re-renders the part strips only when an edit (rename/add/delete)
// or the part list itself changed. No-op while the panel is hidden.
export function _mixerPanelRefresh() {
    const panel = _panel();
    if (!panel || panel.classList.contains('hidden') || panel.classList.contains('editor-mixer-closing')) {
        _lastKey = ''; return;
    }
    const container = document.getElementById('editor-mixer-parts');
    if (!container) return;
    const parts = _mixerPartsPure(S.arrangements, S.drumTab, S.stems, S.trackSession && S.trackSession.removedSourceIds, _mixerMaster());
    const key = editGen + '|' + S.selectedTrackId + '|' + JSON.stringify(S.partMix) + '|'
        + (host.playAllTracksEnabled() ? '1' : '0') + '|'
        + host.mixerTrackOrder().join(',') + '|'
        + parts.map(p => p.key + ':' + p.name).join(',');
    if (key === _lastKey) return;
    _lastKey = key;
    _renderPlayAll();
    _renderParts(container);
}

// Finish a close after the fall animation (or immediately when there's no
// animation): actually hide the drawer and reclaim the canvas space.
function _finishMixerClose(panel, force = false) {
    if (!force && !panel.classList.contains('editor-mixer-closing')) return;
    if (_mixerCloseTimer) { clearTimeout(_mixerCloseTimer); _mixerCloseTimer = 0; }
    panel.classList.remove('editor-mixer-closing');
    panel.classList.add('hidden');
    host.scheduleCanvasResize?.();
}

function _mixerReducedMotion() {
    try { return !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches; }
    catch (_) { return false; }
}

// The one toggle every entry point routes through: View ▸ Panels ▸ Mixer,
// the toolbar Mix button, the transport Mix button, and Shift+C. The drawer
// rises on open and falls on close (respecting reduced-motion).
export function editorToggleMixerPanel(force, instant = false) {
    const panel = _panel();
    if (!panel) return false;
    const closed = panel.classList.contains('hidden') || panel.classList.contains('editor-mixer-closing');
    const show = force === undefined ? closed : !!force;
    try { localStorage.setItem('editorMixerPanel', show ? '1' : '0'); } catch (_) { /* storage blocked */ }
    if (show) {
        if (_mixerCloseTimer) { clearTimeout(_mixerCloseTimer); _mixerCloseTimer = 0; }
        panel.classList.remove('editor-mixer-closing');
        panel.classList.remove('hidden');
        _wire(panel);
        _renderBuses();
        _lastKey = '';
        _mixerPanelRefresh();
        _startMeters();
    } else {
        _stopMeters();
        if (instant || panel.classList.contains('hidden') || _mixerReducedMotion()) {
            _finishMixerClose(panel, true);
        } else if (!panel.classList.contains('editor-mixer-closing')) {
            panel.classList.add('editor-mixer-closing');
            // animationend is authoritative; this covers a teardown or a
            // visibility change that swallows the event.
            _mixerCloseTimer = setTimeout(() => _finishMixerClose(panel), 240);
        }
    }
    _refreshMixerButtons(show);
    if (show) host.scheduleCanvasResize?.();
    return true;
}

// Wired by main.js's init(), not at import — no side effects at load, so the
// unit tests can import this module without a DOM. A project always opens
// with maximum track-area space: the Mix button is a per-screen view toggle,
// not a persisted launch preference.
export function initMixerPanel() {
    const panel = _panel();
    if (!panel) return;
    _wire(panel);
    editorToggleMixerPanel(false, true);
}
