/* Slopsmith Arrangement Editor — the LIVE Tab view (view-modality: full mode).
 *
 * The third view in the cycle (String → Piano roll → Tab): the timeline area
 * becomes the engraved tablature of the CURRENT in-memory chart, re-rendered
 * on every committed edit — no save, no backend GP round-trip, no other
 * plugin (contrast tab-preview.js, the saved-pack proofreading modal, which
 * stays for checking what actually shipped to disk).
 *
 * Contract (Christian's calls): read + CLICK-TO-SELECT — clicking an
 * engraved beat selects its source notes and seeks the playhead; editing
 * stays in the timeline views, whose shortcuts keep working while the score
 * refreshes live. The engraved STAFF is a per-browser reading preference
 * (View ▸ Score staff): tab only (default), standard notation only, or both
 * — same generated alphaTex either way, alphaTab derives pitch from
 * tuning + fret.
 *
 * Lifecycle: `S.tabViewMode` is an orthogonal lens flag like partsViewMode —
 * the drum / tempo-map / parts toggles clear it, and the draw pass is the
 * single source of visibility truth: draw() pings this module while the flag
 * is on and hides the mount the moment it isn't, so no mode toggle needs to
 * know how to tear the view down.
 */

import { S, editGen } from './state.js';
import { host } from './host.js';
import { setStatus } from './ui.js';
import { notes } from './notes.js';
import { beatOf } from './beats.js';
import { _openMidiForArr, _stringCountFor } from './lanes.js';
import { KEYS_PATTERN } from './keys.js';
import { _alphaTexFromNotesPure } from './alphatex.js';
import { TAB_RENDERER_FONT_DIR, _tabPreviewLoadScript } from './tab-preview.js';

let _api = null;
let _apiMount = null;           // the DOM node the api was built on (re-injection guard)
let _apiStaff = '';             // the staff profile the api was built with
let _domHandler = null;         // the capture-phase mousedown fallback (removed on destroy)
let _beatMap = null;
let _renderedKey = '';          // editGen|arr|session — regen only on real change
let _debounce = 0;

const $mount = () => document.getElementById('editor-tabview-mount');

// Restore the staff preference — a READING preference, never chart data, so
// it lives in localStorage like the loop-snap mode does.
try {
    const m = localStorage.getItem('editorTabViewStaff');
    if (m === 'notation' || m === 'both') S.tabViewStaff = m;
} catch (_) { /* storage unavailable — the 'tab' default stands */ }

// The staff preference → alphaTab's StaveProfile enum KEY. A pure string map
// (no alphaTab needed) so the contract is pinnable in node, and so an
// unknown/legacy stored value degrades to tab instead of throwing.
export function _scoreStaffProfilePure(staff) {
    if (staff === 'notation') return 'Score';
    if (staff === 'both') return 'ScoreTab';
    return 'Tab';
}

function _keyNow() {
    return `${editGen}|${S.currentArr}|${S.sessionId}`;
}

function _destroyApi() {
    if (_api) { try { _api.destroy(); } catch (_) { /* best-effort */ } }
    // Our capture-phase DOM listener is our own closure — alphaTab.destroy()
    // never touches it, so remove it here or a same-node rebuild (e.g. a
    // staff switch) accumulates a live listener on the surviving mount.
    if (_apiMount && _domHandler) {
        try { _apiMount.removeEventListener('mousedown', _domHandler, true); } catch (_) { /* best-effort */ }
    }
    _domHandler = null;
    _api = null;
    _apiMount = null;
    _apiStaff = '';
    _beatMap = null;
    _renderedKey = '';
}

// Build (or rebuild after a screen re-injection replaced the mount) and wire
// the click-to-select: alphaTab reports the clicked beat's bar + in-bar index,
// which is exactly how the generator's beatMap is keyed.
export function _ensureApi(mount) {
    if (_api && _apiMount === mount && _apiStaff === S.tabViewStaff) return _api;
    _destroyApi();
    /* global alphaTab */
    _api = new alphaTab.AlphaTabApi(mount, {
        // The music font MUST come from the same pinned CDN — a null/missing
        // fontDirectory engraves an invisible score (glyphs never load).
        core: { fontDirectory: TAB_RENDERER_FONT_DIR, includeNoteBounds: true },
        display: {
            layoutMode: alphaTab.LayoutMode.Page,
            scale: 0.85,
            staveProfile: alphaTab.StaveProfile[_scoreStaffProfilePure(S.tabViewStaff)],
        },
        // The interaction layer (beat clicks + the bounds lookup behind them)
        // is gated on the player flag in this alphaTab line — enable it with
        // NO soundfont and no cursor: nothing downloads, nothing sounds, the
        // editor still owns all audio; we only want clickable beats.
        player: { enablePlayer: true, enableCursor: false, enableUserInteraction: true },
    });
    _apiMount = mount;
    _apiStaff = S.tabViewStaff;
    const select = (beat) => {
        try {
            const barIdx = beat.voice.bar.index;
            const refs = _beatMap && _beatMap[barIdx] ? _beatMap[barIdx][beat.index] : null;
            if (!refs || !refs.length) return;   // a rest — nothing to select
            const nn = notes();
            S.sel.clear();
            for (const r of refs) {
                const i = nn.indexOf(r);
                if (i >= 0) S.sel.add(i);
            }
            host.editorSeekToTime(refs[0].time);
            host.updateStatus();
            setStatus(`Selected ${refs.length} note${refs.length === 1 ? '' : 's'} from the tab — edit in String view or the roll.`);
        } catch (_) { /* a click the lookup can't place is a no-op, never a crash */ }
    };
    if (_api.beatMouseDown && _api.beatMouseDown.on) _api.beatMouseDown.on(select);
    // Belt and braces: the event above rides alphaTab's interaction layer,
    // which has been player-coupled across versions AND stops propagation on
    // the events it consumes — so this fallback listens in CAPTURE phase (it
    // runs before alphaTab's own handlers, whatever they swallow) and pairs
    // the plain DOM click with the bounds lookup.
    _domHandler = (e) => {
        try {
            const lookup = _api && _api.renderer && _api.renderer.boundsLookup;
            if (!lookup || !lookup.getBeatAtPos) return;
            const r = mount.getBoundingClientRect();
            const beat = lookup.getBeatAtPos(
                e.clientX - r.left + mount.scrollLeft,
                e.clientY - r.top + mount.scrollTop);
            if (beat) select(beat);
        } catch (_) { /* no lookup yet — ignore */ }
    };
    mount.addEventListener('mousedown', _domHandler, true);
    return _api;
}

function _render() {
    const mount = $mount();
    if (!mount || !S.tabViewMode) return;
    const arr = S.arrangements && S.arrangements[S.currentArr];
    if (!arr) return;
    const laneCount = _stringCountFor(arr);
    const gen = _alphaTexFromNotesPure({
        notes: notes(),
        beats: S.beats,
        beatOfFn: (t) => beatOf(S.beats, t),
        laneCount,
        openMidi: _openMidiForArr(arr, laneCount),
        tuning: (Array.isArray(arr.tuning) ? arr.tuning : []).slice(0, laneCount),
        capo: Number(arr.capo) || 0,
        title: `${S.title || ''} — ${arr.name || 'track'}`,
    });
    if (!gen) {
        mount.innerHTML = '<div class="p-6 text-sm text-gray-400">No beat grid to engrave against — set up the tempo map first.</div>';
        _destroyApi();
        return;
    }
    // _ensureApi FIRST: its build path runs _destroyApi(), which nulls the
    // beatMap — assigning before it would silently disarm click-to-select.
    const api = _ensureApi(mount);
    _beatMap = gen.beatMap;
    api.tex(gen.tex);
    _renderedKey = _keyNow();
    if (gen.skipped.pickup || gen.skipped.tail) {
        setStatus(`Tab view: ${gen.skipped.pickup + gen.skipped.tail} note(s) outside the barline span aren't engraved (they're still in the chart).`);
    }
}

// Called from the draw pass while the lens is on: shows the mount, and
// re-renders (debounced) when a committed edit / track switch / new session
// changed what the score should say. Also the ONLY place the mount is shown,
// so visibility always follows the flag.
export function _tabViewPing() {
    const mount = $mount();
    if (!mount) return;
    // Track-switch guard: the entry toggle refuses keys/drums, but switching
    // TO a non-fretted track while the lens is already on bypasses that guard
    // (editorSelectArrangement doesn't clear the flag), and the view-cycle's
    // own keys short-circuit returns before it can un-toggle either — leaving
    // the user stuck engraving `undefined.NaN.*` for a track that has no tab.
    // The draw pass is the single enforcement point: drop the lens here so the
    // track's normal view (the roll) takes over on the redraw.
    const arr = S.arrangements && S.arrangements[S.currentArr];
    if (!arr || KEYS_PATTERN.test(arr.name || '') || /^drums/i.test(arr.name || '')) {
        S.tabViewMode = false;
        _tabViewHideIfShown();
        setStatus('Tab view is for fretted tracks — switched back to this track’s normal view.');
        host.draw();
        return;
    }
    if (mount.classList.contains('hidden')) mount.classList.remove('hidden');
    if (_renderedKey === _keyNow()) return;
    clearTimeout(_debounce);
    _debounce = setTimeout(() => {
        if (!S.tabViewMode) return;
        _tabPreviewLoadScript()
            .then(() => _render())
            .catch((e) => {
                const m = $mount();
                if (m) m.innerHTML = `<div class="p-6 text-sm text-amber-300">${e.message}</div>`;
            });
    }, 150);
}

// Probe/debug handle: the live alphaTab api (null until first render).
export function _tabViewApi() { return _api; }

// The flag went off (any mode toggle, the cycle, teardown): hide the mount.
// Cheap enough to run every frame the lens is off.
export function _tabViewHideIfShown() {
    const mount = $mount();
    if (mount && !mount.classList.contains('hidden')) mount.classList.add('hidden');
}

export function editorToggleTabView(force) {
    const next = typeof force === 'boolean' ? force : !S.tabViewMode;
    if (next) {
        const arr = S.arrangements && S.arrangements[S.currentArr];
        if (!arr) { setStatus('Load a song first.'); return true; }
        if (KEYS_PATTERN.test(arr.name || '') || /^drums/i.test(arr.name || '')) {
            setStatus('Tab view is for fretted tracks — keys and drums have no tab.');
            return true;
        }
        // Lenses are mutually exclusive, same as the parts overview.
        S.drumEditMode = false;
        S.tempoMapMode = false;
        S.partsViewMode = false;
        S.sel.clear();
        S.drag = null;
        S.tabViewMode = true;
        _renderedKey = '';          // force a fresh render on entry
        setStatus('Tab view — live engraving of this track; click a beat to select its notes. Edits happen in String view / the roll.');
    } else {
        S.tabViewMode = false;
        setStatus('String view');
    }
    host.draw();
    host.updateStatus();
    return true;
}

// The menu's Score-staff radio: getter feeds the checkmarks, setter applies
// + persists. Picking a staff while the score view is OFF also enters it —
// choosing what to read implies wanting to read.
export function editorTabViewStaff() { return S.tabViewStaff; }

export function editorSetTabViewStaff(staff) {
    const v = (staff === 'notation' || staff === 'both') ? staff : 'tab';
    const label = v === 'notation' ? 'standard notation'
        : v === 'both' ? 'notation + tab' : 'tablature';
    if (v !== S.tabViewStaff) {
        S.tabViewStaff = v;
        try { localStorage.setItem('editorTabViewStaff', v); } catch (_) { /* preference just won't persist */ }
        // A different staff needs a rebuilt renderer (staveProfile is a
        // construction-time setting) AND a re-render: _ensureApi sees the
        // staff mismatch, _renderedKey forces the ping to regenerate.
        _renderedKey = '';
    }
    if (!S.tabViewMode) { editorToggleTabView(true); return; }
    setStatus(`Score staff: ${label}.`);
    host.draw();
}

// Session teardown: the mount is being replaced wholesale — drop the api so
// the next entry rebuilds against the fresh DOM.
export function teardownTabView() {
    clearTimeout(_debounce);
    _destroyApi();
    S.tabViewMode = false;
}
