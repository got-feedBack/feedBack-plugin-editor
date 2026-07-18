// Key & view controls: the in-key highlight (tonic/scale selectors + auto-detect)
// and the per-part view switcher (String / Piano roll / Parts). The window.editor*
// entry points are re-attached by main.js; repaint / status / canvas-resize go
// through host.

import { hideAddNote } from './add-note.js';
import { hideContextMenu } from './context-menu.js';
import { _loadEditorKeyIfNeeded, _persistEditorKey, editorKeyHighlightEnabled } from './draw.js';
import { KEYS_PATTERN, _partViewKeyPure, _rollMidiForNote, _rollPitchCtx, _viewPrefs, _viewPrefsSave, updatePianoRange, viewFor } from './keys.js';
import { notes } from './notes.js';
import { S } from './state.js';
import { PIANO_NOTE_NAMES, SCALE_INTERVALS, SCALE_LABELS, _detectKeyPure, _noteNamesForKeyPure } from './theory.js';
import { setStatus } from './ui.js';
import { editorSetTabViewStaff, editorToggleTabView } from './tab-view-live.js';
import { host } from './host.js';
import { revealToolbar } from './toolbars.js';

export const editorSetKeyTonic = (v) => {
    const tonic = parseInt(v, 10);
    if (!(tonic >= 0 && tonic <= 11)) return;
    S.editorKey = { tonic, scale: (S.editorKey && S.editorKey.scale) || 'major' };
    _persistEditorKey();
    _refreshKeyControls();
    host.draw();
};
export const editorSetKeyScale = (v) => {
    if (!SCALE_INTERVALS[v]) return;
    S.editorKey = { tonic: (S.editorKey ? S.editorKey.tonic : 0), scale: v };
    _persistEditorKey();
    _refreshKeyControls();
    host.draw();
};
export function _editorToggleKeyHighlight() {
    const next = !editorKeyHighlightEnabled();
    try { localStorage.setItem('editorKeyHighlight', next ? '1' : '0'); } catch (_) {}
    if (next && !S.editorKey) S.editorKey = { tonic: 0, scale: 'major' };
    _persistEditorKey();
    _refreshKeyControls();
    host.draw();
    setStatus(next
        ? 'In-key highlight on — out-of-key notes dim (piano roll also shades out-of-key rows)'
        : 'In-key highlight off');
    return true;
}


// Detect the active arrangement's key from its pitch-class content (DAW 4.17)
// and set it as the editor key, turning the in-key highlight on so the result
// is visible. A best-guess suggestion, not authoritative — the picker stays
// editable. Duration-weighted (a held note counts more than a passing one),
// with a small floor so staccato notes still register. Fretted parts resolve
// to sounding pitch (capo/tuning-aware); keys parts use their packed pitch.
export const editorDetectKey = () => {
    if (!S.arrangements || !S.arrangements.length) { setStatus('No arrangement to analyse'); return; }
    const nn = notes();
    if (!nn.length) { setStatus('No notes yet — add some before detecting a key'); return; }
    const rctx = typeof _rollPitchCtx === 'function' ? _rollPitchCtx() : null;
    const weights = new Array(12).fill(0);
    let counted = 0;
    for (const n of nn) {
        const midi = _rollMidiForNote(n, rctx);
        if (!Number.isFinite(midi)) continue;
        const pc = ((Math.round(midi) % 12) + 12) % 12;
        weights[pc] += Math.max(Number(n.sustain) || 0, 0.1);
        counted++;
    }
    const res = counted ? _detectKeyPure(weights) : null;
    if (!res) { setStatus('Could not detect a key from this track'); return; }
    S.editorKey = { tonic: res.tonic, scale: res.scale };
    try { localStorage.setItem('editorKeyHighlight', '1'); } catch (_) { /* private mode */ }
    _persistEditorKey();
    _refreshKeyControls();
    host.draw();
    const label = (typeof SCALE_LABELS !== 'undefined' && SCALE_LABELS[res.scale]) || res.scale;
    // Spell the detected tonic the way ITS key signature would (Eb minor,
    // never D# minor) — the picker below still lists sharp-named tonics.
    setStatus(`Detected key: ${_noteNamesForKeyPure(res)[res.tonic]} ${label} — adjust in the picker if it's off`);
};

// ── Per-part view switcher (String · Piano roll · Tab · Notation) ────

// Which switcher buttons read ACTIVE. The engraved lens overrides the
// per-part pref while it's on; the 'both' staff profile lights Tab AND
// Notation together (it genuinely shows both). Pure — testable in node.
export function _viewSwitchActivePure(prefMode, tabLensOn, staff) {
    if (!tabLensOn) return [prefMode === 'piano' ? 'piano' : 'string'];
    if (staff === 'notation') return ['notation'];
    if (staff === 'both') return ['tab', 'notation'];
    return ['tab'];
}

// The staff profile a Tab/Notation button click should apply: honor the
// user's persisted 'both' preference (clicking Tab while reading both
// still shows tab — don't clobber the pref), only flip when the current
// profile doesn't include the requested staff.
export function _tabStaffForClickPure(current, want) {
    if (want === 'notation') return current === 'both' ? 'both' : 'notation';
    return current === 'both' ? 'both' : 'tab';
}

let _viewSwitchState = '';
export function _refreshViewSwitch() {
    const el = document.getElementById('editor-view-switch');
    if (!el) return;
    const arr = S.arrangements.length ? S.arrangements[S.currentArr] : null;
    const fretted = !!arr && !KEYS_PATTERN.test(arr.name || '');
    const isDrums = !!arr && /^drums/i.test(arr.name || '');
    // Only fretted parts get a choice (keys are piano-locked), and only
    // when a focus editor is showing (not drum/tempo/parts modes). The
    // engraved lens keeps the switcher visible — it IS one of the views.
    const visible = fretted && !S.drumEditMode && !S.tempoMapMode && !S.partsViewMode;
    const mode = arr ? viewFor(arr) : 'string';
    const active = _viewSwitchActivePure(mode, !!S.tabViewMode, S.tabViewStaff);
    const sig = `${visible}|${isDrums}|${active.join(',')}`;
    if (sig === _viewSwitchState) return;
    _viewSwitchState = sig;
    el.classList.toggle('hidden', !visible);
    el.classList.toggle('flex', visible);
    el.querySelectorAll('button[data-view]').forEach(b => {
        const on = active.includes(b.dataset.view);
        b.classList.toggle('bg-accent', on);
        b.classList.toggle('text-white', on);
        b.classList.toggle('text-gray-400', !on);
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
        // Drums have no tab/notation (same refusal the lens itself makes) —
        // hide those stops instead of offering a button that only refuses.
        if (b.dataset.view === 'tab' || b.dataset.view === 'notation') {
            b.classList.toggle('hidden', isDrums);
        }
    });
    const pill = document.getElementById('editor-roll-lock-pill');
    if (pill) pill.classList.toggle('hidden', !(visible && !S.tabViewMode && mode === 'piano'));
}

export const editorSetViewMode = (mode) => {
    // Tab / Notation are the engraved lens with the matching staff profile
    // (View ▸ Score staff still owns the 'both' reading preference).
    if (mode === 'tab' || mode === 'notation') {
        editorSetTabViewStaff(_tabStaffForClickPure(S.tabViewStaff, mode));
        editorToggleTabView(true);
        _refreshViewSwitch();
        return;
    }
    // Leaving the lens for a timeline view: drop the flag first so the
    // pref write below lands on a visible editor (mirrors the cycle).
    if (S.tabViewMode && (mode === 'string' || mode === 'piano')) {
        editorToggleTabView(false);
    }
    if (mode !== 'string' && mode !== 'piano') return;
    const arr = S.arrangements.length ? S.arrangements[S.currentArr] : null;
    if (!arr) return;
    if (KEYS_PATTERN.test(arr.name || '')) {
        setStatus('Keys tracks always use the piano roll');
        return;
    }
    if (viewFor(arr) === mode) return;
    const prefs = _viewPrefs();
    const key = _partViewKeyPure(arr);
    if (mode === 'piano') prefs[key] = 'piano';
    else delete prefs[key];
    _viewPrefsSave();
    // V3: selection/interaction semantics are per-view — clear both, and
    // close any note UI anchored to the old geometry.
    S.sel.clear();
    S.drag = null;
    hideContextMenu();
    hideAddNote();
    if (mode === 'piano') updatePianoRange();
    _refreshViewSwitch();
    // Lane heights differ between views; recompute after the reflow the
    // same way the string-count change path does.
    requestAnimationFrame(() => host.resizeCanvas());
    host.draw();
    host.updateStatus();
    setStatus(mode === 'piano'
        ? 'Piano roll — fretted notes shown at sounding pitch (read-only until suggest-position lands)'
        : 'String view');
};

export function _editorCycleViewMode() {
    const arr = S.arrangements.length ? S.arrangements[S.currentArr] : null;
    if (!arr) { setStatus('Load a song first'); return true; }
    if (KEYS_PATTERN.test(arr.name || '')) {
        setStatus('Keys tracks always use the piano roll');
        return true;
    }
    // String → Piano roll → Tab → String. The Tab lens sits ON TOP of the
    // per-part view pref, so leaving it restores whichever view the pref says.
    if (S.tabViewMode) {
        if (typeof window.editorToggleTabView === 'function') window.editorToggleTabView(false);
        window.editorSetViewMode('string');
        return true;
    }
    if (viewFor(arr) === 'piano') {
        // Drums have no tab (same refusal as the lens's own guard) — the
        // toggle would refuse WITHOUT changing mode and the cycle would
        // stick on the roll. Skip the Tab stop and wrap to String view.
        if (/^drums/i.test(arr.name || '')) {
            window.editorSetViewMode('string');
            return true;
        }
        if (typeof window.editorToggleTabView === 'function') window.editorToggleTabView(true);
        return true;
    }
    window.editorSetViewMode('piano');
    return true;
}

let _keyControlsPopulated = false;
let _keyControlsState = '';
export function _refreshKeyControls() {
    const group = document.getElementById('editor-key-group');
    if (!group) return;
    _loadEditorKeyIfNeeded();
    // Populate the selects once.
    if (!_keyControlsPopulated) {
        const tonicSel = document.getElementById('editor-key-tonic');
        const scaleSel = document.getElementById('editor-key-scale');
        if (tonicSel && scaleSel) {
            tonicSel.innerHTML = PIANO_NOTE_NAMES
                .map((n, i) => `<option value="${i}">${n}</option>`).join('');
            scaleSel.innerHTML = Object.keys(SCALE_INTERVALS)
                .map(id => `<option value="${id}">${SCALE_LABELS[id] || id}</option>`).join('');
            _keyControlsPopulated = true;
        }
    }
    // The highlight applies to any pitched arrangement view — the piano
    // roll AND the fretted lanes (notes resolve to sounding pitch via
    // tuning + capo). The drum grid and Parts overview have no per-note
    // pitch surface, so the controls hide there.
    const visible = !!(S.arrangements && S.arrangements.length)
        && !S.drumEditMode && !S.partsViewMode;
    const on = editorKeyHighlightEnabled();
    const tonic = S.editorKey ? S.editorKey.tonic : 0;
    const scale = S.editorKey ? S.editorKey.scale : 'major';
    const sig = `${visible}|${on}|${tonic}|${scale}`;
    if (sig === _keyControlsState) return;
    _keyControlsState = sig;
    // Today's auto-show, kept under B5: a pitched part activating reveals the
    // Harmony toolbar (sticky; a no-op if the user explicitly hid it).
    if (visible) revealToolbar('harmony');
    group.classList.toggle('hidden', !visible);
    group.classList.toggle('flex', visible);
    const tonicSel = document.getElementById('editor-key-tonic');
    const scaleSel = document.getElementById('editor-key-scale');
    if (tonicSel) tonicSel.value = String(tonic);
    if (scaleSel) scaleSel.value = scale;
    const btn = document.getElementById('editor-key-highlight-btn');
    if (btn) {
        btn.classList.toggle('bg-accent', on);
        btn.classList.toggle('hover:bg-accent-light', on);
        btn.classList.toggle('bg-dark-600', !on);
        btn.classList.toggle('hover:bg-dark-500', !on);
        btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    }
}
