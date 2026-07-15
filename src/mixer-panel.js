// ════════════════════════════════════════════════════════════════════
// Mixer panel (workspace-shell B6) — the one first-class mixer surface.
//
// Consolidates the old floating audio-mixer popover into a DOCKED panel
// beside the canvas (inspector idiom): a Stems section (one strip per audio
// stem, when the pack ships them) over one channel strip per part
// (volume · mute · solo) over the three bus faders (recording / guide /
// click) and the edit blip.
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
// The Stems section is the same panel over a different axis: `S.stemMix`
// (stem id → { vol, mute, solo }) mixes the RECORDING itself via per-stem
// gain nodes in src/audio.js — strips write the map here, then poke the
// engine through `host.stemMixChanged()` (lazy decode on first touch, live
// gain ramps, unity keeps the shipped mixdown playing). A stem solo never
// gates parts, buses or guide claps, and vice versa.
//
// Panel open state is an editor pref (`editorMixerPanel`, never the pack);
// bus levels stay on the existing `editorMix*` prefs owned by src/audio.js.
// Part and stem mute/solo/volume are SESSION state — they reset with the
// loaded song (create.js / file-ops.js clear both maps on install).
// ════════════════════════════════════════════════════════════════════
import { host } from './host.js';
import { S, editGen } from './state.js';
import { _editorEscHtml, setStatus } from './ui.js';

/* @pure:mixer-panel:start */
// One strip per part: every arrangement, plus the drum tab as its own strip
// (drums are a song-level sidecar, not an arrangement) — the same list shape
// as the Parts view, keyed the way S.currentArr addresses parts (by index).
export function _mixerPartsPure(arrangements, drumTab) {
    const parts = [];
    (arrangements || []).forEach((arr, i) => {
        parts.push({
            key: 'arr:' + i,
            name: (arr && arr.name) || 'Track ' + (i + 1),
        });
    });
    if (drumTab && Array.isArray(drumTab.hits) && drumTab.hits.length) {
        parts.push({ key: 'drums', name: 'Drums' });
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
/**
 * One strip per audio stem, from the /load payload's [{id, url}] list. The
 * Stems strips mix the RECORDING itself (per-stem gain nodes in src/audio.js)
 * — a separate axis from the Tracks strips, which shape guide voices per
 * chart part. Fewer than 2 VALID stems is not a mixer: the section hides.
 */
export function _mixerStemsPure(stems) {
    const list = Array.isArray(stems) ? stems : [];
    const valid = list.filter(s => s && typeof s.id === 'string' && s.id);
    if (valid.length < 2) return [];
    return valid
        .map(s => ({
            key: s.id,
            name: s.id.charAt(0).toUpperCase() + s.id.slice(1),
        }));
}
/**
 * The Stems section's status note, from the engine's UI state: empty at
 * unity-idle and during normal stem playback; otherwise the one line that
 * explains why the ear is hearing the combined mix instead.
 */
export function _mixerStemNotePure(ui) {
    const u = ui || {};
    if (u.slow) return 'Audition below 100% — stems bypassed, the combined mix plays.';
    if (u.loadState === 'loading') return 'Loading stems…';
    if (u.loadState === 'failed') return 'Stems unavailable — playing the combined mix.';
    if (u.loadState === 'ready' && Array.isArray(u.failedIds) && u.failedIds.length) {
        return 'Unavailable: ' + u.failedIds.join(', ') + ' — mixing the rest.';
    }
    return '';
}
/* @pure:mixer-panel:end */

// The host-hook target audio.js consults per scheduled clap voice.
export function _mixerClapState() {
    return _mixerClapStatePure(S.partMix, S.drumEditMode, S.currentArr);
}

function _panel() { return document.getElementById('editor-mixer-panel'); }

// ── Strip rendering (memoized — never rides the draw loop) ───────────
let _lastKey = '';

function _msBtn(key, act, pressed, label, title) {
    return `<button data-mix-part="${key}" data-mix-act="${act}" aria-pressed="${pressed}"`
        + ` class="editor-mix-ms" title="${title}">${label}</button>`;
}

/**
 * Stem strips use their own data attributes (data-stem-part / data-stem-act):
 * a stem id like 'drums' is also a valid PART key, so sharing data-mix-* would
 * cross the two state maps in the delegated handlers.
 */
function _stemMsBtn(key, act, pressed, label, title) {
    return `<button data-stem-part="${_editorEscHtml(key)}" data-stem-act="${act}" aria-pressed="${pressed}"`
        + ` class="editor-mix-ms" title="${title}">${label}</button>`;
}

function _renderParts(container) {
    const parts = _mixerPartsPure(S.arrangements, S.drumTab);
    if (!parts.length) {
        container.innerHTML = '<p class="text-[10px] text-gray-500">No tracks yet — strips appear as tracks are added.</p>';
        return;
    }
    container.innerHTML = parts.map(p => {
        const st = _mixerPartStatePure(S.partMix, p.key);
        const name = _editorEscHtml(p.name);
        return `<div class="space-y-1" data-mix-row="${p.key}">`
            + `<div class="flex items-center gap-1.5">`
            + `<span class="flex-1 truncate text-gray-300" title="${name}">${name}</span>`
            + _msBtn(p.key, 'mute', st.mute, 'M', 'Mute this part’s guide voice')
            + _msBtn(p.key, 'solo', st.solo, 'S', 'Solo this part’s guide voice — the recording stays audible')
            + `</div>`
            + `<div class="flex items-center gap-2">`
            + `<input type="range" min="0" max="100" value="${st.vol}" data-mix-part="${p.key}" data-mix-act="vol"`
            + ` aria-label="${name} guide volume percent" class="flex-1 accent-accent">`
            + `<span data-mix-val="${p.key}" class="w-9 text-right font-mono text-gray-400">${st.vol}%</span>`
            + `</div></div>`;
    }).join('');
}

/**
 * The Stems section: strips over S.stemMix (the same DAW rule pures as the
 * part strips — they're generic over any {key → {vol,mute,solo}} map), plus
 * the engine's status note. Grayed while the audition slow path bypasses
 * stems so the controls read as "armed but not in the signal right now".
 */
function _renderStems(head, container) {
    const stems = _mixerStemsPure(S.stems);
    const none = !stems.length;
    head.classList.toggle('hidden', none);
    container.classList.toggle('hidden', none);
    if (none) { container.innerHTML = ''; return; }
    const ui = host.stemUiState();
    const note = _mixerStemNotePure(ui);
    container.classList.toggle('opacity-50', !!ui.slow);
    container.innerHTML = stems.map(p => {
        const st = _mixerPartStatePure(S.stemMix, p.key);
        const name = _editorEscHtml(p.name);
        // Stem ids come from the pack's /load payload — escape them wherever
        // they land in markup (part keys are internal and never need this).
        const attrKey = _editorEscHtml(p.key);
        const gone = ui.loadState === 'ready' && ui.failedIds.includes(p.key);
        return `<div class="space-y-1${gone ? ' opacity-40' : ''}" data-stem-row="${attrKey}">`
            + `<div class="flex items-center gap-1.5">`
            + `<span class="flex-1 truncate text-gray-300" title="${name}">${name}</span>`
            + _stemMsBtn(p.key, 'mute', st.mute, 'M', 'Mute this stem')
            + _stemMsBtn(p.key, 'solo', st.solo, 'S', 'Solo this stem — the other stems go silent; guide voices are unaffected')
            + `</div>`
            + `<div class="flex items-center gap-2">`
            + `<input type="range" min="0" max="100" value="${st.vol}" data-stem-part="${attrKey}" data-stem-act="vol"`
            + ` aria-label="${name} stem volume percent" class="flex-1 accent-accent">`
            + `<span data-stem-val class="w-9 text-right font-mono text-gray-400">${st.vol}%</span>`
            + `</div></div>`;
    }).join('')
        + (note ? `<p class="text-[10px] text-gray-500">${_editorEscHtml(note)}</p>` : '');
}

// Seed the bus faders + blip checkbox from their prefs (owned by audio.js,
// read through the host hook so this module stays audio-import-free).
function _renderBuses() {
    const ui = host.mixUiState();
    for (const [bus, id] of [['ref', 'editor-mix-ref'], ['guide', 'editor-mix-guide'], ['click', 'editor-mix-click']]) {
        const slider = document.getElementById(id);
        const label = document.getElementById(id + '-val');
        if (slider) slider.value = String(ui.pcts[bus]);
        if (label) label.textContent = ui.pcts[bus] + '%';
    }
    const blip = document.getElementById('editor-mix-blip');
    if (blip) blip.checked = !!ui.blip;
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
}

/**
 * Twin of _setPart over the stem map — every write is followed by
 * host.stemMixChanged() so the engine can lazy-load / ramp / re-path.
 */
function _setStem(key, patch) {
    if (!S.stemMix || typeof S.stemMix !== 'object') S.stemMix = {};
    S.stemMix[key] = { ..._mixerPartStatePure(S.stemMix, key), ...patch };
    host.stemMixChanged();
}

// One delegated listener pair on the (static) panel element — guarded so a
// defensive double-init can never stack handlers. The panel element itself is
// replaced when the host re-injects the screen, so nothing leaks across
// re-injection either.
function _wire(panel) {
    if (panel.__mixerWired) return;
    panel.__mixerWired = true;
    panel.addEventListener('click', (e) => {
        const closest = e.target && e.target.closest ? (sel) => e.target.closest(sel) : () => null;
        // Part strips first (the data-mix-* and data-stem-* attribute sets are
        // disjoint in the DOM, so order only matters to keep this branch the
        // common path), then the stem strips.
        const btn = closest('[data-mix-act="mute"],[data-mix-act="solo"]');
        if (btn) {
            const key = btn.getAttribute('data-mix-part');
            const act = btn.getAttribute('data-mix-act');
            const st = _mixerPartStatePure(S.partMix, key);
            _setPart(key, act === 'mute' ? { mute: !st.mute } : { solo: !st.solo });
            _lastKey = '';
            _mixerPanelRefresh();
            const now = _mixerPartStatePure(S.partMix, key);
            setStatus(act === 'mute'
                ? (now.mute ? 'Track muted — its guide voice is silent' : 'Track unmuted')
                : (now.solo ? 'Track soloed — other tracks’ guide voices are silent; the recording stays audible' : 'Solo off'));
            return;
        }
        const stemBtn = closest('[data-stem-act="mute"],[data-stem-act="solo"]');
        if (!stemBtn) return;
        const key = stemBtn.getAttribute('data-stem-part');
        const act = stemBtn.getAttribute('data-stem-act');
        const st = _mixerPartStatePure(S.stemMix, key);
        _setStem(key, act === 'mute' ? { mute: !st.mute } : { solo: !st.solo });
        _lastKey = '';
        _mixerPanelRefresh();
        const now = _mixerPartStatePure(S.stemMix, key);
        setStatus(act === 'mute'
            ? (now.mute ? 'Stem muted' : 'Stem unmuted')
            : (now.solo ? 'Stem soloed — the other stems are silent' : 'Stem solo off'));
    });
    panel.addEventListener('input', (e) => {
        const el = e.target;
        if (!el) return;
        if (el.getAttribute('data-mix-act') === 'vol') {
            const key = el.getAttribute('data-mix-part');
            _setPart(key, { vol: Number(el.value) });
            const val = panel.querySelector(`[data-mix-val="${key}"]`);
            if (val) val.textContent = _mixerPartStatePure(S.partMix, key).vol + '%';
            return;
        }
        if (el.getAttribute('data-stem-act') !== 'vol') return;
        const key = el.getAttribute('data-stem-part');
        _setStem(key, { vol: Number(el.value) });
        // Row-scoped lookup — a stem id is untrusted /load data, so it never
        // goes through a selector string (metacharacters would throw).
        const val = el.closest?.('[data-stem-row]')?.querySelector('[data-stem-val]');
        if (val) val.textContent = _mixerPartStatePure(S.stemMix, key).vol + '%';
    });
}

// Memoized refresh, called from updateStatus() beside the other companion
// strips: re-renders the strips only when an edit (rename/add/delete), the
// part/stem lists, the stem mix, or the stem engine's status changed.
// No-op while the panel is hidden.
export function _mixerPanelRefresh() {
    const panel = _panel();
    if (!panel || panel.classList.contains('hidden')) { _lastKey = ''; return; }
    const container = document.getElementById('editor-mixer-parts');
    if (!container) return;
    const parts = _mixerPartsPure(S.arrangements, S.drumTab);
    const stemUi = host.stemUiState();
    const key = editGen + '|' + JSON.stringify(S.partMix) + '|' + parts.map(p => p.key + ':' + p.name).join(',')
        + '|' + JSON.stringify(S.stemMix) + '|' + _mixerStemsPure(S.stems).map(p => p.key).join(',')
        + '|' + stemUi.loadState + ':' + (stemUi.slow ? 1 : 0) + ':' + stemUi.failedIds.join(',');
    if (key === _lastKey) return;
    _lastKey = key;
    _renderParts(container);
    const head = document.getElementById('editor-mixer-stems-head');
    const stemBox = document.getElementById('editor-mixer-stems');
    if (head && stemBox) _renderStems(head, stemBox);
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
