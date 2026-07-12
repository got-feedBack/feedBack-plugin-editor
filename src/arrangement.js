// Arrangement management: undoable part rename (with the cross-kind guard),
// remove-arrangement, and the Add-Drums import (drum_tab.json from a GP or MIDI
// file). The add-drums flow is the drum sibling of the keys/guitar imports in
// import.js and chains into its two shared post-import dialogs.
//
// The window.editor* entry points are re-attached by main.js. Every dep that
// stays in main.js (draw, updateStatus, updateArrangementSelector,
// effectiveAudioOffset) routes through host.

import { S, markSessionDirty } from './state.js';
import { _editorEscHtml, _editorPromptText, setStatus } from './ui.js';
import { flattenChords } from './chords.js';
import { KEYS_PATTERN } from './keys.js';
import { _recState } from './midi-record.js';
import { _maybeOfferMidiTempoMap, _showDrumImportUnmappedModal } from './import.js';
import { host } from './host.js';

// ════════════════════════════════════════════════════════════════════
// Remove arrangement
// ════════════════════════════════════════════════════════════════════

// ── Part rename (EDITOR-VIEW-MODALITY / DAW-workspace 2.2b) ──────────
// Unblocked by the manifest `type` stamping + merge-not-rebuild save
// (#101): a rename no longer strips the entry's `type`/unknown keys, and
// sloppak sessions carry a stable `id` the view prefs key off. One hard
// limit stays, enforced honestly: the NAME still drives kind inference
// (keys → piano roll + notation sidecar, /bass/i → 4-lane layout,
// /^drums/i → drum routing), so a rename that would CHANGE the inferred
// kind is refused — silently re-laning a 6-string chart as a 4-string
// bass would strand notes on invisible strings.

/* @pure:rename-arr:start */
// A part name feeds TWO independent interpreters, and a rename must not shift
// the chart under EITHER of them:
//   • the runtime lane/roll router — prefix-anchored KEYS_PATTERN
//     (/^(keys|piano|keyboard|synth)/i), then /^drums/i, then /bass/i. This
//     is what the LIVE editor draws (piano roll vs 4/6 lanes vs drums).
//   • the SAVE side (routes.py) — word-boundary \b(keys|piano|keyboard|
//     synth)\b stamps manifest `type: piano` + a keys notation sidecar, and
//     /bass/i stamps `type: bass`. This is what a reload re-lanes from.
// The two KEYS rules disagree on real names: "Electric Piano" is save-keys
// but runtime-guitar; "Synthwave" is runtime-keys but save-guitar. Collapsing
// them into one "kind" hides exactly those disagreements — the ones that flip
// a chart's layout on save (runtime-guitar → save-keys) or on the very next
// draw (runtime-keys → save-guitar). So the guard compares BOTH facets and
// refuses when either moves; a rename is safe only when every interpreter
// still reads the same instrument.
const _KEYS_NAME_WB = /\b(keys|piano|keyboard|synth)\b/i;
// Runtime lane/roll kind — what the live editor shows (mirrors isKeysMode /
// isBassArr / the /^drums/ routing, all name-driven and prefix-anchored).
function _arrKindPure(name) {
    const n = String(name || '');
    if (KEYS_PATTERN.test(n)) return 'keys';
    if (/^drums/i.test(n)) return 'drums';
    if (/bass/i.test(n)) return 'bass';
    return 'guitar';
}
// Persisted kind — the manifest `type` / notation-sidecar decision on save
// (routes.py `_KEYS_NAME_RE` word-boundary keys, then `_TYPE_BASS_RE` /bass/).
function _arrSaveKindPure(name) {
    const n = String(name || '');
    if (_KEYS_NAME_WB.test(n)) return 'keys';
    if (/bass/i.test(n)) return 'bass';
    return 'other';
}
// Display label for the refusal message: the instrument a human reads off the
// name, keys-first so either rule surfaces it.
function _arrKindLabelPure(name) {
    const n = String(name || '');
    if (KEYS_PATTERN.test(n) || _KEYS_NAME_WB.test(n)) return 'keys';
    if (/^drums/i.test(n)) return 'drums';
    if (/bass/i.test(n)) return 'bass';
    return 'guitar';
}
// Validate a rename: trimmed non-empty, bounded, unique among the OTHER
// parts (case-insensitive — the save-side name discipline), and never a
// kind change under EITHER interpreter. Returns {ok, reason, name} with the
// trimmed name.
function _renameGuardPure(oldName, rawNewName, otherNames) {
    const name = String(rawNewName || '').trim();
    if (!name) return { ok: false, reason: 'Name can’t be empty.', name };
    if (name.length > 60) return { ok: false, reason: 'Name too long (max 60 characters).', name };
    if (name === String(oldName || '')) return { ok: false, reason: '', name };  // silent no-op
    const taken = new Set((otherNames || []).map(n => String(n || '').trim().toLowerCase()));
    if (taken.has(name.toLowerCase())) {
        return { ok: false, reason: `Another part is already named “${name}”.`, name };
    }
    const runtimeMoved = _arrKindPure(oldName) !== _arrKindPure(name);
    const saveMoved = _arrSaveKindPure(oldName) !== _arrSaveKindPure(name);
    if (runtimeMoved || saveMoved) {
        const oldLabel = _arrKindLabelPure(oldName);
        const newLabel = _arrKindLabelPure(name);
        const reason = (oldLabel !== newLabel)
            // A clean instrument change (e.g. guitar → bass, guitar → keys).
            ? `That name would change the part’s instrument (${oldLabel} → ${newLabel}) — `
                + 'lane layout and notation still key off the name. Add a new part instead.'
            // Same label, but the two interpreters disagree on this exact name
            // (e.g. "Piano" → "Electric Piano": the editor keys off the first
            // word and would drop to guitar lanes, while the save still writes
            // keys). Re-laning either way strands notes, so refuse.
            : 'That name is read differently by the editor and the saved file, so it would '
                + 'change the part’s layout. The editor keys off the FIRST word, the save off '
                + 'any keys word — pick a name both agree on.';
        return { ok: false, reason, name };
    }
    return { ok: true, reason: '', name };
}
/* @pure:rename-arr:end */

// Undoable rename. Holds the arrangement INDEX (undo can fire after a
// switch; EditHistory's per-arrangement tagging routes back) plus both
// names; exec/rollback refresh the selector so the dropdown text follows.
class RenameArrangementCmd {
    constructor(arrIdx, newName) {
        this.arrIdx = arrIdx;
        this.newName = newName;
        const arr = S.arrangements[arrIdx];
        this.oldName = arr ? (arr.name || '') : '';
    }
    _set(name) {
        const arr = S.arrangements[this.arrIdx];
        if (!arr) return;
        arr.name = name;
        host.updateArrangementSelector();
    }
    exec() { this._set(this.newName); }
    rollback() { this._set(this.oldName); }
}

export async function editorRenameArrangement() {
    if (_recState !== 'idle') {
        setStatus('Cannot rename while recording. Stop the take first.');
        return;
    }
    const arr = S.arrangements[S.currentArr];
    if (!arr) return;
    const val = await _editorPromptText({
        title: 'Rename Part',
        label: 'Part name (display label — the instrument kind can’t change here)',
        value: String(arr.name || ''),
    });
    if (val === null) return;
    const others = S.arrangements
        .filter((_, i) => i !== S.currentArr)
        .map(a => a && a.name);
    const guard = _renameGuardPure(arr.name, val, others);
    if (!guard.ok) {
        if (guard.reason) setStatus(guard.reason);
        return;
    }
    S.history.exec(new RenameArrangementCmd(S.currentArr, guard.name));
    host.draw();
    host.updateStatus();
    setStatus(`Renamed to “${guard.name}”`);
}

export async function editorRemoveArrangement() {
    if (_recState !== 'idle') {
        setStatus('Cannot remove an arrangement while recording. Stop the take first.');
        return;
    }
    if (S.arrangements.length <= 1) return;
    const removeIdx = S.currentArr;
    const arr = S.arrangements[removeIdx];
    if (!confirm(`Remove "${arr.name}" arrangement?`)) return;

    // Remove from backend first
    if (S.sessionId) {
        try {
            const resp = await fetch('/api/plugins/editor/remove-arrangement', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    session_id: S.sessionId,
                    arrangement_index: removeIdx,
                }),
            });
            const result = await resp.json();
            if (result.error) {
                setStatus('Remove failed: ' + result.error);
                return;
            }
        } catch (e) {
            setStatus('Remove failed: ' + e.message);
            return;
        }
    }

    // Then update frontend state
    S.arrangements.splice(removeIdx, 1);
    markSessionDirty();
    // The splice renumbers every arrangement after removeIdx, so history
    // commands tagged with the old indices (and the note indices inside them)
    // would undo into the wrong arrangement. Same rationale as the
    // reconstructChords() reset (#18): drop the stack when the model shifts
    // under it.
    if (S.history) S.history.reset();
    S.currentArr = Math.min(removeIdx, S.arrangements.length - 1);
    S.sel.clear();
    flattenChords();
    host.updateArrangementSelector();
    document.getElementById('editor-arrangement').value = S.currentArr;
    host.updateStatus();
    host.draw();
    setStatus(`Removed "${arr.name}" arrangement`);
}

// ════════════════════════════════════════════════════════════════════
// Add Drums — drum_tab.json import from a GP or MIDI file.
// Persists via _buildSaveBody's `drum_tab` field on the next save_song.
// ════════════════════════════════════════════════════════════════════

// Buffered state from the upload phase: a successful parse stores the
// server-side temp path + file kind here, then editorDoAddDrums commits.
// Cleared on every modal-open and on every fresh file selection.
let _addDrumsFile = null;  // { kind: 'gp' | 'midi', path: string }

export function editorShowAddDrumsModal() {
    _addDrumsFile = null;
    document.getElementById('editor-add-drums-modal').classList.remove('hidden');
    document.getElementById('editor-add-drums-tracks').classList.add('hidden');
    document.getElementById('editor-add-drums-go').disabled = true;
    document.getElementById('editor-add-drums-status').textContent = '';
    const fileInput = document.getElementById('editor-add-drums-gp');
    if (fileInput) fileInput.value = '';
    // Show the "will replace" notice only when a drum_tab already lives on
    // the sloppak so the user knows what's about to happen.
    const existingEl = document.getElementById('editor-add-drums-existing');
    if (existingEl) {
        existingEl.classList.toggle('hidden', !S.drumTab);
    }
}

export function editorHideAddDrumsModal() {
    document.getElementById('editor-add-drums-modal').classList.add('hidden');
}

// File-kind dispatcher — GP path lists tracks via /import-gp, MIDI path
// via /import-drums-midi-list. Both eventually populate the same picker.
export async function editorDrumsFileSelected(input) {
    const file = input.files[0];
    if (!file) return;

    const statusEl = document.getElementById('editor-add-drums-status');
    const goBtn = document.getElementById('editor-add-drums-go');

    // Drop any prior successful parse so a later failure can't commit via
    // the older file's path.
    _addDrumsFile = null;
    goBtn.disabled = true;
    document.getElementById('editor-add-drums-tracks').classList.add('hidden');

    // Detect "no extension" explicitly — `split('.').pop()` on a dotless
    // filename returns the whole name, which would otherwise surface a
    // misleading "Unsupported file type: drums" message.
    const dotIdx = file.name.lastIndexOf('.');
    const ext = dotIdx >= 0 ? file.name.slice(dotIdx + 1).toLowerCase() : '';
    const isMidi = (ext === 'mid' || ext === 'midi');
    const isGp = ['gp', 'gp3', 'gp4', 'gp5', 'gpx'].includes(ext);
    if (!isMidi && !isGp) {
        statusEl.textContent = 'Unsupported file type (expected .gp* or .mid/.midi)';
        return;
    }

    statusEl.textContent = isMidi ? 'Parsing MIDI file...' : 'Parsing GP file...';
    const formData = new FormData();
    formData.append('file', file);

    try {
        const url = isMidi
            ? '/api/plugins/editor/import-drums-midi-list'
            : '/api/plugins/editor/import-gp';
        const resp = await fetch(url, { method: 'POST', body: formData });
        const data = await resp.json();
        if (data.error) {
            statusEl.textContent = 'Error: ' + data.error;
            return;
        }

        // Both endpoints return `{tracks: [...]}` shaped the same way.
        // GP returns every track and we filter to drum/percussion; MIDI
        // returns channel-9 only so the filter is a no-op there.
        const tracks = data.tracks || [];
        const drumTracks = isMidi
            ? tracks
            : tracks.filter(t => (t.is_drums || t.is_percussion) && t.notes > 0);
        if (drumTracks.length === 0) {
            statusEl.textContent = isMidi
                ? 'No drum (channel-10) tracks found in this MIDI file.'
                : 'No drum/percussion tracks found in this GP file.';
            return;
        }

        const path = isMidi ? data.midi_path : data.gp_path;
        _addDrumsFile = { kind: isMidi ? 'midi' : 'gp', path };

        const listEl = document.getElementById('editor-add-drums-track-list');
        listEl.innerHTML = drumTracks.map((t, i) => {
            const safeName = _editorEscHtml(t.name);
            const checked = i === 0 ? 'checked' : '';
            return `<label class="flex items-center gap-2 text-xs text-gray-300 py-0.5">
                <input type="radio" name="drums-track" value="${Number.isFinite(Number(t.index)) ? Number(t.index) : 0}" ${checked} class="accent-accent">
                <span class="text-gray-300 flex-1">${safeName}</span>
                <span class="px-1.5 py-0.5 rounded text-[10px] font-medium shrink-0" style="background:rgba(245,158,11,0.16);color:#fcd34d">Drums</span>
                <span class="text-gray-600 shrink-0">${Number(t.notes) || 0} notes</span>
            </label>`;
        }).join('');
        document.getElementById('editor-add-drums-tracks').classList.remove('hidden');
        goBtn.disabled = false;
        statusEl.textContent = `Found ${drumTracks.length} drum track(s).`;
    } catch (e) {
        statusEl.textContent = 'Failed: ' + e.message;
    }
}

// Back-compat alias — the modal HTML used to call this; some test
// scaffolds might still wire it up. Forwards to the new dispatcher.
export function editorDrumsGPSelected(input) { return editorDrumsFileSelected(input); }

export async function editorDoAddDrums() {
    if (!_addDrumsFile || !S.sessionId) return;

    const statusEl = document.getElementById('editor-add-drums-status');
    const goBtn = document.getElementById('editor-add-drums-go');
    goBtn.disabled = true;
    statusEl.textContent = 'Importing drum track...';

    const radio = document.querySelector('input[name="drums-track"]:checked');
    const trackIndex = radio ? parseInt(radio.value) : 0;

    try {
        const url = _addDrumsFile.kind === 'midi'
            ? '/api/plugins/editor/import-drums-midi'
            : '/api/plugins/editor/import-drums-tab';
        const bodyKey = _addDrumsFile.kind === 'midi' ? 'midi_path' : 'gp_path';
        const resp = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                [bodyKey]: _addDrumsFile.path,
                track_index: trackIndex,
                audio_offset: host.effectiveAudioOffset(),
            }),
        });
        const data = await resp.json();
        if (data.error || !data.drum_tab) {
            statusEl.textContent = 'Error: ' + (data.error || 'no drum_tab in response');
            goBtn.disabled = false;
            return;
        }

        // Stash on session state; the next save_song ships it as
        // `drum_tab` and the backend writes drum_tab.json + manifest key.
        // Normalize hits: ensure sorted by t so drum-editor hit-testing and
        // dragging work correctly, and clear any stale selection so indices
        // from the old tab don't point into the new hits array.
        S.drumTab = data.drum_tab;
        if (S.drumTab && Array.isArray(S.drumTab.hits)) {
            S.drumTab.hits.sort((a, b) => (a.t || 0) - (b.t || 0));
        }
        S.drumTabDirty = true;  // user-imported — persist on next save
        S.drumSel = new Set();

        editorHideAddDrumsModal();
        const hitCount = Array.isArray(data.drum_tab.hits)
            ? data.drum_tab.hits.length : 0;
        const unmapped = Array.isArray(data.unmapped) ? data.unmapped : [];
        const droppedCount = unmapped.reduce((s, u) => s + Math.max(0, Number(u.count) || 0), 0);
        if (droppedCount > 0) {
            setStatus(`Drum tab imported (${hitCount} hits, ${droppedCount} unmapped — see dialog) — save to persist`);
        } else {
            setStatus(`Drum tab imported (${hitCount} hits) — save to persist`);
        }
        // Refresh the toolbar drum button (text/colour) and canvas so the
        // user immediately sees the "⟳ Drums (N)" state without waiting for
        // an unrelated redraw.
        host.updateArrangementSelector();
        host.draw();
        // Offer the MIDI's own tempo/time-signature grid first (DAW 3.2;
        // no-op for GP imports or a gridless MIDI), then chain the unmapped-
        // notes triage so the two dialogs never stack. Surface the manual-
        // mapping UI only when there are actual notes to triage — gate on
        // droppedCount, not unmapped.length, so an empty row can't open a
        // hollow dialog.
        _maybeOfferMidiTempoMap(data.tempo_map, () => {
            if (droppedCount > 0) {
                _showDrumImportUnmappedModal(unmapped);
            }
        });
    } catch (e) {
        statusEl.textContent = 'Failed: ' + e.message;
        goBtn.disabled = false;
    }
}
