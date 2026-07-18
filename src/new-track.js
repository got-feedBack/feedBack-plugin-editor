/* Slopsmith Arrangement Editor — the New Track dialog.
 *
 * One front door for adding any track to an existing session (the DAW
 * new-tracks idiom: a + button above the track headers opens one dialog
 * with track-type tiles and a Create button). Consolidates the three old
 * toolbar entries (+ Drums / + Keys / + Guitar-Bass) behind a single
 * "+ Track" affordance; those modals survive as the import-from-file
 * flows this dialog routes to.
 *
 * Type tiles: AUDIO (a recording — becomes a studio/stem track via the
 * stem manager's import path) vs TRANSCRIPTION (a playable MIDI-style
 * chart: Lead / Rhythm / Bass / Keys / Drums, started empty or imported
 * from a file). The pure planner below decides the action; the DOM layer
 * only reflects state and dispatches.
 *
 * window.editor* entry points are re-attached by main.js.
 */

import { S } from './state.js';
import { setStatus } from './ui.js';
import { editorAddEmptyFretted, editorAddEmptyKeys, editorShowAddKeysModal, editorShowImportGuitarModal } from './import.js';
import { editorAddEmptyDrums, editorShowAddDrumsModal } from './arrangement.js';
import { editorToggleStemTracks } from './stem-tracks.js';

/* @pure:new-track:start */
// The Create dispatch, as data: selection + session context in, action tag
// out. Keeping the fork pure means every branch is table-testable without
// a DOM. `blocked` carries a reason the UI can phrase.
export function _newTrackPlanPure(sel, ctx) {
    const c = ctx || {};
    if (!c.hasSession || c.format !== 'sloppak') return { action: 'blocked', reason: 'sloppak-only' };
    const s = sel || {};
    if (s.type === 'audio') return { action: 'audio-picker' };
    if (s.type !== 'transcription') return { action: 'blocked', reason: 'pick-type' };
    const inst = s.instrument;
    if (!['Lead', 'Rhythm', 'Bass', 'Keys', 'Drums'].includes(inst)) {
        return { action: 'blocked', reason: 'pick-instrument' };
    }
    if (s.source === 'file') {
        if (inst === 'Keys') return { action: 'modal-keys' };
        if (inst === 'Drums') return { action: 'modal-drums' };
        return { action: 'modal-guitar' };
    }
    if (inst === 'Keys') return { action: 'empty-keys' };
    if (inst === 'Drums') {
        return c.hasDrumTab ? { action: 'blocked', reason: 'drums-exist' } : { action: 'empty-drums' };
    }
    return { action: 'empty-fretted', role: inst };
}
/* @pure:new-track:end */

// Dialog selection state (module-local; re-seeded on every open).
let _sel = { type: 'transcription', instrument: 'Lead', source: 'empty' };

function _byId(id) { return document.getElementById(id); }

function _renderNewTrackModal() {
    const modal = _byId('editor-new-track-modal');
    if (!modal) return;
    for (const tile of modal.querySelectorAll('[data-ntt]')) {
        tile.classList.toggle('editor-ntt-active', tile.dataset.ntt === _sel.type);
        tile.setAttribute('aria-pressed', tile.dataset.ntt === _sel.type ? 'true' : 'false');
    }
    const isTrans = _sel.type === 'transcription';
    const dt = _byId('editor-new-track-details-transcription');
    const da = _byId('editor-new-track-details-audio');
    if (dt) dt.classList.toggle('hidden', !isTrans);
    if (da) da.classList.toggle('hidden', isTrans);
    for (const chip of modal.querySelectorAll('[data-nti]')) {
        chip.classList.toggle('editor-nti-active', chip.dataset.nti === _sel.instrument);
        chip.setAttribute('aria-pressed', chip.dataset.nti === _sel.instrument ? 'true' : 'false');
    }
    for (const r of modal.querySelectorAll('input[name="new-track-source"]')) {
        r.checked = r.value === _sel.source;
    }
    // Drums with an existing drum tab: empty-start is blocked (one drum tab
    // per song) — say so inline instead of failing at Create.
    const note = _byId('editor-new-track-note');
    if (note) {
        const drumsBlocked = isTrans && _sel.instrument === 'Drums' && _sel.source === 'empty' && !!S.drumTab;
        note.textContent = drumsBlocked
            ? 'This song already has a Drums track — choose "Import from a file" to replace it.'
            : '';
    }
    const create = _byId('editor-new-track-create');
    if (create) {
        create.disabled = _newTrackPlanPure(_sel, {
            hasSession: !!S.sessionId, format: S.format, hasDrumTab: !!S.drumTab,
        }).action === 'blocked';
    }
}

export function editorShowNewTrackModal() {
    if (!S.sessionId || S.format !== 'sloppak') return;
    _sel = { type: 'transcription', instrument: 'Lead', source: 'empty' };
    const status = _byId('editor-new-track-status');
    if (status) status.textContent = '';
    _byId('editor-new-track-modal').classList.remove('hidden');
    _renderNewTrackModal();
}

export function editorHideNewTrackModal() {
    _byId('editor-new-track-modal').classList.add('hidden');
}

export function editorNewTrackSetType(type) {
    _sel.type = type === 'audio' ? 'audio' : 'transcription';
    _renderNewTrackModal();
}

export function editorNewTrackSetInstrument(inst) {
    _sel.instrument = inst;
    _renderNewTrackModal();
}

export function editorNewTrackSetSource(source) {
    _sel.source = source === 'file' ? 'file' : 'empty';
    _renderNewTrackModal();
}

export async function editorNewTrackCreate() {
    const plan = _newTrackPlanPure(_sel, {
        hasSession: !!S.sessionId, format: S.format, hasDrumTab: !!S.drumTab,
    });
    switch (plan.action) {
        case 'audio-picker': {
            // The stem manager's hidden multi-file input; its change handler
            // runs /import-stems and reports through the status line. Open
            // the manager alongside so the new tracks land somewhere visible.
            editorHideNewTrackModal();
            editorToggleStemTracks(true);
            const input = _byId('editor-stem-tracks-file');
            if (input) input.click();
            else setStatus('Audio import unavailable — open the stem manager instead.');
            return;
        }
        case 'modal-guitar':
            editorHideNewTrackModal();
            editorShowImportGuitarModal();
            return;
        case 'modal-keys':
            editorHideNewTrackModal();
            editorShowAddKeysModal();
            return;
        case 'modal-drums':
            editorHideNewTrackModal();
            editorShowAddDrumsModal();
            return;
        case 'empty-keys': {
            const ok = await editorAddEmptyKeys();
            if (ok !== false) editorHideNewTrackModal();
            return;
        }
        case 'empty-drums':
            if (editorAddEmptyDrums()) editorHideNewTrackModal();
            return;
        case 'empty-fretted': {
            const ok = await editorAddEmptyFretted(plan.role);
            if (ok) {
                editorHideNewTrackModal();
            } else {
                const status = _byId('editor-new-track-status');
                if (status && !status.textContent) status.textContent = 'Could not add the track — see the status bar.';
            }
            return;
        }
        default:
            return;   // blocked — the Create button is disabled anyway
    }
}

// Toolbar/menu/tracks-header gate: one visible "+ Track" entry, sloppak
// sessions only (add-arrangement persists only through the sloppak save
// path — same gate the three consolidated buttons carried).
export function editorNewTrackButtonRefresh() {
    const btn = _byId('editor-new-track-btn');
    if (btn) btn.classList.toggle('hidden', !S.sessionId || S.format !== 'sloppak');
}
