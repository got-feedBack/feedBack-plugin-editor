// ════════════════════════════════════════════════════════════════════
// Mixer panel (workspace-shell B6) — the one first-class mixer surface.
//
// Consolidates the old floating audio-mixer popover (and the never-implemented
// stem-mixer stub) into a bottom drawer with vertical channel strips:
// one strip per audio or transcription track (volume · mute · solo), utility
// buses for source / guide / click, and a dedicated final master bus.
//
// This module owns the CANONICAL per-part mix state, `S.partMix` — a map from
// part key ('arr:<idx>' for arrangements, 'drums' for the drum tab) to
// { vol, mute, solo }. Today the only per-part sound is the guide voice (claps
// follow the active editing surface), so mute/solo/volume gate and scale the
// guide claps for the part being edited; the Parts-gutter M/S/A (§2.5) and
// per-part instrument voices (GM slice) read the SAME state when they arrive —
// this panel is the source of truth, not a mirror.
//
// The solo rule is the DAW one: any solo anywhere → only soloed parts sound;
// mute always wins. The recording / guide / click BUSES are not parts and are
// never gated by part solo — solo keeps the reference audible (charrette D5).
// Audio consumes the state through `host.partClapState` (inert default:
// audible at unity), so src/audio.js never imports this module.
//
// Panel open state is an editor pref (`editorMixerPanel`, never the pack);
// bus levels stay on the existing `editorMix*` prefs owned by src/audio.js.
// Part mute/solo/volume is SESSION state — it resets with the loaded song
// (create.js / file-ops.js clear `S.partMix` when they install arrangements).
// ════════════════════════════════════════════════════════════════════
import { host } from './host.js';
import { S, editGen } from './state.js';
import { _editorEscHtml, setStatus } from './ui.js';

/* @pure:mixer-panel:start */
// One strip per part: every arrangement, plus the drum tab as its own strip
// (drums are a song-level sidecar, not an arrangement) — the same list shape
// as the Parts view, keyed the way S.currentArr addresses parts (by index).
export function _mixerPartsPure(arrangements, drumTab, audioSources = []) {
    const parts = [];
    (audioSources || []).forEach(source => {
        if (!source || !source.id) return;
        parts.push({
            key: 'audio:' + source.id,
            name: source.name || (source.kind === 'master' ? 'Master Mix' : source.id),
            kind: 'audio',
        });
    });
    (arrangements || []).forEach((arr, i) => {
        parts.push({
            key: 'arr:' + i,
            name: (arr && arr.name) || 'Track ' + (i + 1),
            kind: 'transcription',
        });
    });
    if (drumTab && Array.isArray(drumTab.hits) && drumTab.hits.length) {
        parts.push({ key: 'drums', name: 'Drums', kind: 'transcription' });
    }
    return parts;
}
// A part's strip state, defaulted and clamped: an absent entry is an audible
// part at full volume, and a corrupted volume can never boost past 100.
export function _mixerPartStatePure(partMix, key) {
    const m = (partMix && typeof partMix === 'object') ? partMix[key] : null;
    const v = m ? Number(m.vol) : NaN;
    return {
        vol: Number.isFinite(v) ? Math.max(0, Math.min(100, v)) : 100,
        mute: !!(m && m.mute),
        solo: !!(m && m.solo),
    };
}
export function _mixerAnySoloPure(partMix) {
    if (!partMix || typeof partMix !== 'object') return false;
    return Object.keys(partMix).some(k => partMix[k] && partMix[k].solo);
}
// The DAW audibility rule over PART keys only: mute always wins; any solo
// anywhere means only soloed parts sound. Buses (recording/guide/click) are
// not parts and never pass through here — solo keeps the reference audible.
export function _mixerPartAudiblePure(partMix, key) {
    const st = _mixerPartStatePure(partMix, key);
    if (st.mute) return false;
    return _mixerAnySoloPure(partMix) ? st.solo : true;
}
// What the guide-clap scheduler needs for the ACTIVE editing surface: claps
// follow the drum grid in drum mode, the current arrangement otherwise, so
// that surface's part decides whether (and how loud) the claps sound.
export function _mixerClapStatePure(partMix, drumEditMode, currentArr) {
    const key = drumEditMode ? 'drums' : 'arr:' + (Number(currentArr) || 0);
    return {
        audible: _mixerPartAudiblePure(partMix, key),
        vol: _mixerPartStatePure(partMix, key).vol / 100,
    };
}
// Panel open-state pref round-trip ('1'/'0'; anything else = closed).
export function _mixerOpenFromStoredPure(raw) {
    return raw === '1';
}
/* @pure:mixer-panel:end */

// The host-hook target audio.js consults per scheduled clap voice.
export function _mixerClapState() {
    return _mixerClapStatePure(S.partMix, S.drumEditMode, S.currentArr);
}

// Shared track-header/mixer state for an arbitrary strip. Audio uses this for
// the currently selected source, so its M/S/fader controls are not cosmetic.
export function _mixerPartStripState(key) {
    return {
        audible: _mixerPartAudiblePure(S.partMix, key),
        vol: _mixerPartStatePure(S.partMix, key).vol / 100,
    };
}

function _panel() { return document.getElementById('editor-mixer-panel'); }

// ── Strip rendering (memoized — never rides the draw loop) ───────────
let _lastKey = '';

function _msBtn(key, act, pressed, label, title) {
    return `<button data-mix-part="${key}" data-mix-act="${act}" aria-pressed="${pressed}"`
        + ` class="editor-mix-ms" title="${title}">${label}</button>`;
}

function _renderParts(container) {
    const parts = _mixerPartsPure(S.arrangements, S.drumTab, S.audioSources);
    if (!parts.length) {
        container.innerHTML = '<p class="text-[10px] text-gray-500">No tracks yet — strips appear as tracks are added.</p>';
        return;
    }
    container.innerHTML = parts.map(p => {
        const st = _mixerPartStatePure(S.partMix, p.key);
        const name = _editorEscHtml(p.name);
        return `<div class="editor-mixer-strip" data-mix-row="${p.key}">`
            + `<span class="editor-mixer-strip-type">${p.kind === 'audio' ? 'AUDIO' : 'MIDI'}</span>`
            + `<div class="editor-mixer-ms-row">`
            + _msBtn(p.key, 'mute', st.mute, 'M', 'Mute track')
            + _msBtn(p.key, 'solo', st.solo, 'S', 'Solo track')
            + `</div>`
            + `<div class="editor-mixer-meter" aria-hidden="true"><span></span></div>`
            + `<input type="range" min="0" max="100" value="${st.vol}" data-mix-part="${p.key}" data-mix-act="vol"`
            + ` aria-label="${name} volume percent" class="editor-mixer-fader">`
            + `<span data-mix-val="${p.key}" class="editor-mixer-value">${st.vol}%</span>`
            + `<span class="editor-mixer-strip-name" title="${name}">${name}</span>`
            + `</div>`;
    }).join('');
}
// Seed the bus faders + blip checkbox from their prefs (owned by audio.js,
// read through the host hook so this module stays audio-import-free).
function _renderBuses() {
    const ui = host.mixUiState();
    for (const [bus, id] of [['ref', 'editor-mix-ref'], ['guide', 'editor-mix-guide'], ['click', 'editor-mix-click'], ['master', 'editor-mix-master']]) {
        const slider = document.getElementById(id);
        const label = document.getElementById(id + '-val');
        if (slider) slider.value = String(ui.pcts[bus]);
        if (label) label.textContent = ui.pcts[bus] + '%';
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

export function mixerSetPart(key, patch) {
    if (!S.partMix || typeof S.partMix !== 'object') S.partMix = {};
    S.partMix[key] = { ..._mixerPartStatePure(S.partMix, key), ...patch };
    _lastKey = '';
    _mixerPanelRefresh();
    host.partMixChanged?.(key);
    return S.partMix[key];
}

export function mixerTogglePart(key, act) {
    const st = _mixerPartStatePure(S.partMix, key);
    return mixerSetPart(key, act === 'mute' ? { mute: !st.mute } : { solo: !st.solo });
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
        mixerTogglePart(key, act);
        const now = _mixerPartStatePure(S.partMix, key);
        setStatus(act === 'mute'
            ? (now.mute ? 'Track muted — its guide voice is silent' : 'Track unmuted')
            : (now.solo ? 'Track soloed — other tracks’ guide voices are silent; the recording stays audible' : 'Solo off'));
    });
    panel.addEventListener('input', (e) => {
        const el = e.target;
        if (!el || el.getAttribute('data-mix-act') !== 'vol') return;
        const key = el.getAttribute('data-mix-part');
        mixerSetPart(key, { vol: Number(el.value) });
        const val = panel.querySelector(`[data-mix-val="${key}"]`);
        if (val) val.textContent = _mixerPartStatePure(S.partMix, key).vol + '%';
    });
}

// Memoized refresh, called from updateStatus() beside the other companion
// strips: re-renders the part strips only when an edit (rename/add/delete)
// or the part list itself changed. No-op while the panel is hidden.
export function _mixerPanelRefresh() {
    const panel = _panel();
    if (!panel || panel.classList.contains('hidden')) { _lastKey = ''; return; }
    const container = document.getElementById('editor-mixer-parts');
    if (!container) return;
    const parts = _mixerPartsPure(S.arrangements, S.drumTab, S.audioSources);
    const key = editGen + '|' + JSON.stringify(S.partMix) + '|' + parts.map(p => p.key + ':' + p.name).join(',');
    if (key === _lastKey) return;
    _lastKey = key;
    _renderParts(container);
}

// The one toggle every entry point routes through: View ▸ Panels ▸ Mixer,
// the toolbar Mix button, the transport Mix button, and Shift+C.
export function editorToggleMixerPanel(force) {
    const panel = _panel();
    if (!panel) return false;
    const show = force === undefined ? panel.classList.contains('hidden') : !!force;
    panel.classList.toggle('hidden', !show);
    try { localStorage.setItem('editorMixerPanel', show ? '1' : '0'); } catch (_) { /* storage blocked */ }
    if (show) {
        _wire(panel);
        _renderBuses();
        _lastKey = '';
        _mixerPanelRefresh();
    }
    _refreshMixerButtons(show);
    host.scheduleCanvasResize?.();
    return true;
}

// Wired by main.js's init(), not at import — no side effects at load, so the
// unit tests can import this module without a DOM.
export function initMixerPanel() {
    const panel = _panel();
    if (!panel) return;
    _wire(panel);
    let raw = null;
    try { raw = localStorage.getItem('editorMixerPanel'); } catch (_) { /* storage blocked */ }
    if (_mixerOpenFromStoredPure(raw)) editorToggleMixerPanel(true);
    else _refreshMixerButtons(false);
}
