// "Song Fit" — one discoverable home for the three ways to line a chart up to a
// recording (charrette UX P1). The editor already has the verbs: an Offset nudge
// (Shift), audio Sync (Fit tempo), and the BPM flatten with conform/rebuild
// (Set constant tempo) — but they are three scattered toolbar controls most
// users never connect. Song Fit is a friendly front door over them; the inline
// controls stay as direct power paths (they are NOT rerouted).
//
// Pure chrome: every action dispatches to an existing UNDOABLE verb, and the
// audio never moves in any of them — only the chart. The bracketed "consequence
// badge" copy is the single source for what each op does to audio / grid / notes.
import { S } from './state.js';
import { _editorPromptChoice, _editorPromptText, _installModalKeyboard, setStatus } from './ui.js';

// The shared "consequence badge": one plain-English line per operation stating
// what it does to the three domains — audio / grid / notes. One source so the
// Song Fit menu and any future surface state the contract identically.
export function _consequenceBadgePure(kind) {
    switch (kind) {
        case 'shift': return 'audio stays · grid, notes & sections all move together';
        case 'fit': return 'audio stays · grid rescales to the tempo · notes ride along';
        case 'constant': return 'audio stays · one steady tempo · you pick whether notes ride or hold';
        case 'resync': return 'audio stays · barlines re-fit to the recording from this bar on · notes ride';
        default: return '';
    }
}

// The four Song Fit options, each carrying its consequence badge as the hint.
export function _songFitChoicesPure() {
    return [
        { key: 'shift', label: 'Shift everything…', hint: _consequenceBadgePure('shift') },
        { key: 'fit', label: 'Fit tempo to recording…', hint: _consequenceBadgePure('fit') },
        { key: 'constant', label: 'Set constant tempo…', hint: _consequenceBadgePure('constant') },
        { key: 'resync', label: 'Re-sync from this bar on…', hint: _consequenceBadgePure('resync') },
    ];
}

// The re-sync anchor: the last DOWNBEAT at or before the playhead (the user
// parked the playhead where the chart stops matching the recording — "right
// up to here, wrong after"), or the first downbeat when the playhead sits
// before bar 1. Returns the beats index, or -1 with no downbeats at all.
export function _songFitResyncAnchorPure(beats, cursorTime) {
    const t = Number.isFinite(cursorTime) ? cursorTime : 0;
    let anchor = -1, first = -1;
    for (let i = 0; i < (beats || []).length; i++) {
        const b = beats[i];
        if (!b || !(b.measure > 0)) continue;
        if (first < 0) first = i;
        if (b.time <= t + 1e-6) anchor = i;
    }
    return anchor >= 0 ? anchor : first;
}

// Open the Song Fit popover and dispatch the chosen operation. Reachable from the
// tempo-map inspector "Song Fit" button; window-exposed so any surface can open it.
export async function _editorSongFit() {
    if (!(S.beats && S.beats.length >= 2)) {
        setStatus('Load a song with a beat grid before fitting it to the recording.');
        return;
    }
    const sessionBefore = S.sessionId;
    const choice = await _editorPromptChoice({
        title: 'Song Fit',
        message: 'Line the chart up with the recording. The audio never moves — only the chart does.',
        choices: _songFitChoicesPure(),
    });
    if (!choice) return;
    if (!_sameSession(sessionBefore)) return;
    if (choice === 'shift') { _editorShiftEverything(sessionBefore); return; }
    if (choice === 'fit') { _callWindow('editorSyncTempo'); return; }
    if (choice === 'constant') { await _songFitSetConstant(sessionBefore); return; }
    if (choice === 'resync') { _songFitResync(); return; }
}

// "Re-sync from this bar on": the drift-rescue front door (a real tester
// workflow — constant tempo set from a tab, recording actually a hair slower,
// chart right up to bar N and increasingly wrong after). Enters Tempo Map,
// anchors the assisted fit on the playhead's bar, and RUNS it immediately —
// the suggested barline corrections appear as ghost markers to click-accept
// (nothing commits until the user accepts; Esc dismisses). Pure chrome: mode
// entry and the fit both dispatch through the same registry commands the
// keyboard uses, so this stays a front door, not a second engine.
function _songFitResync() {
    if (!S.tempoMapMode) _callWindow('editorRunShortcutCommand', 'toggleTempoMap');
    if (!S.tempoMapMode) return;   // no grid to map — the toggle already said so
    // Anchor AFTER entering the mode (entry clears the barline selection), and
    // drop any multi-selection — a live multi outranks the anchor in the fit.
    const anchor = _songFitResyncAnchorPure(S.beats, S.cursorTime);
    if (anchor < 0) { setStatus('No barlines to re-fit — mark a barline first.'); return; }
    S.tempoSel = anchor;
    if (S.tempoSelMulti) S.tempoSelMulti.clear();
    _callWindow('editorRunShortcutCommand', 'tempoSuggestFit');
}

// "Set constant tempo": prompt for one BPM, then reuse editorSetBPM's flatten
// helper (conform vs rebuild) — which works regardless of Tempo Map mode, so the
// inspector button can reach it (the inline BPM box only offers flatten outside
// Tempo Map mode).
async function _songFitSetConstant(sessionBefore = S.sessionId) {
    const raw = await _editorPromptText({
        title: 'Set constant tempo',
        label: 'One steady tempo for the whole song (BPM):',
        value: '',
        placeholder: 'e.g. 120',
    });
    if (raw === null) return;
    if (!_sameSession(sessionBefore)) return;
    const bpm = parseFloat(raw);
    if (!bpm || bpm <= 0) { setStatus('Enter a tempo in BPM (a positive number).'); return; }
    if (typeof window !== 'undefined' && typeof window.editorFlattenSongToBpm === 'function') {
        await window.editorFlattenSongToBpm(bpm, { message: 'Choose how to set the whole song to one steady tempo:' });
    }
}

// "Shift everything": a compact modal wrapping the offset command with the ±10ms
// nudge arrows the toolbar has, plus a total-offset field. Each control routes
// through the existing undoable offset verbs (window.editorNudgeOffset /
// editorApplyOffset), so undo/redo and the toolbar input stay in step for free.
export function _editorShiftEverything(sessionBefore = S.sessionId) {
    if (typeof document === 'undefined') return;
    document.getElementById('editor-shift-modal')?.remove();

    const modal = document.createElement('div');
    modal.id = 'editor-shift-modal';
    modal.className = 'fixed inset-0 bg-black/70 z-50 flex items-center justify-center';
    const inner = document.createElement('div');
    inner.className = 'bg-dark-800 border border-gray-700 rounded-lg p-6 max-w-sm w-full mx-4';
    inner.setAttribute('role', 'dialog');
    inner.setAttribute('aria-modal', 'true');
    inner.setAttribute('aria-label', 'Shift everything');
    inner.innerHTML =
        '<h3 class="text-lg font-semibold mb-1">Shift everything</h3>'
        + `<p class="text-xs text-gray-400 mb-4">${_consequenceBadgePure('shift')}. Nudge the whole chart earlier or later against the recording.</p>`
        + '<div class="flex items-center justify-center gap-2 mb-4">'
        + '<button type="button" id="editor-shift-minus" class="px-3 py-1 bg-dark-700 hover:bg-dark-600 border border-gray-600 rounded text-sm" title="Shift 10ms earlier">−10ms</button>'
        + '<input type="number" id="editor-shift-value" step="0.01" class="w-24 bg-dark-700 border border-gray-600 rounded px-2 py-1 text-sm text-center outline-none" title="Total shift in seconds (negative = earlier)">'
        + '<span class="text-xs text-gray-500">s</span>'
        + '<button type="button" id="editor-shift-plus" class="px-3 py-1 bg-dark-700 hover:bg-dark-600 border border-gray-600 rounded text-sm" title="Shift 10ms later">+10ms</button>'
        + '</div>'
        + '<div class="flex justify-end"><button type="button" id="editor-shift-done" class="px-3 py-1 bg-accent hover:bg-accent-light rounded text-sm">Done</button></div>';

    const valEl = inner.querySelector('#editor-shift-value');
    const applied = () => (Number(S.appliedOffset) || 0);
    const sync = () => { if (valEl && document.activeElement !== valEl) valEl.value = applied().toFixed(3); };
    sync();
    const done = () => modal.remove();
    const guard = () => {
        if (_sameSession(sessionBefore)) return true;
        done();
        return false;
    };
    const nudge = (d) => { if (!guard()) return; _callWindow('editorNudgeOffset', d); sync(); };
    inner.querySelector('#editor-shift-minus').onclick = () => nudge(-0.01);
    inner.querySelector('#editor-shift-plus').onclick = () => nudge(0.01);
    if (valEl) valEl.onchange = () => { if (!guard()) return; _callWindow('editorApplyOffset', valEl.value); sync(); };
    inner.querySelector('#editor-shift-done').onclick = done;

    modal.appendChild(inner);
    _installModalKeyboard(modal, inner, done);
    document.body.appendChild(modal);
    valEl?.focus();
}

function _callWindow(name, ...args) {
    if (typeof window !== 'undefined' && typeof window[name] === 'function') window[name](...args);
}

function _sameSession(sessionBefore) {
    if (S.sessionId === sessionBefore) return true;
    setStatus('Song changed while Song Fit was open — reopen Song Fit for this song.');
    return false;
}
