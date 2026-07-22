// Song-import flows: Add-Keys (GP / MIDI / MusicXML), guitar/bass GP import
// (add or replace), and the two post-import triage dialogs shared with the
// drum importer — the MIDI tempo-map offer and the unmapped-percussion mapper.
//
// The window.editor* entry points are re-attached by main.js (a module can't own
// window.*). Everything main.js still calls into — `_maybeOfferMidiTempoMap`,
// `_showDrumImportUnmappedModal` — is exported for it to import.

import { S, markSessionDirty } from './state.js';
import { _editorEscHtml, setStatus } from './ui.js';
import { ReplaceArrangementChartCmd } from './commands.js';
import { TempoGridCmd, _tempoRemapMarksByTime } from './tempo.js';
import { DRUM_PIECE_META, DRUM_PIECE_ORDER, _drumImportHitPure } from './drum.js';
import { _uniqueKeysName, updatePianoRange } from './keys.js';
import { arrKind, _isBassArr } from './instrument.js';
import { flattenChords } from './chords.js';
import { host } from './host.js';

// ════════════════════════════════════════════════════════════════════
// Add Keys arrangement (sloppak — GP or MIDI source)
// ════════════════════════════════════════════════════════════════════

let _addKeysSourcePath = null;       // server-side path to the uploaded file
let _addKeysSourceFormat = null;     // 'gp', 'midi', or 'musicxml'
// Cached after a successful list-tracks call; each keys-track checkbox value
// is an index into this array, not the track's MIDI/GP index, because
// format-0 channel splits can yield multiple picker entries sharing the
// same MIDI `index`.
let _addKeysSortedTracks = [];
// Bumped on every file-select so a slow async parse (e.g. the MusicXML
// delegation round-trip) from a superseded file can't append a stale result.
let _addKeysReqSeq = 0;

/* @pure:midi-unpack:start */
// The arrangement name for one unpacked MIDI track. Kind inference is
// NAME-driven (KEYS_PATTERN, start-anchored) and the imported notes use the
// roll's keys packing — so the name MUST read as keys or the editor would
// interpret the packing as fretted lanes. 'Keys — <track name>' keeps the
// kind honest AND the source track identifiable.
function _midiKeysArrNamePure(trackName, fallbackIndex) {
    const t = String(trackName || '').trim();
    return 'Keys — ' + (t || ('Track ' + fallbackIndex));
}
/* @pure:midi-unpack:end */
export { _midiKeysArrNamePure };

export function editorShowAddKeysModal() {
    if (S.format !== 'sloppak') return;
    document.getElementById('editor-add-keys-modal').classList.remove('hidden');
    document.getElementById('editor-add-keys-tracks').classList.add('hidden');
    document.getElementById('editor-add-keys-go').disabled = true;
    document.getElementById('editor-add-keys-status').textContent = '';
    const fi = document.getElementById('editor-add-keys-file');
    if (fi) fi.value = '';
    _addKeysSourcePath = null;
    _addKeysSourceFormat = null;
}

export function editorHideAddKeysModal() {
    document.getElementById('editor-add-keys-modal').classList.add('hidden');
    // Invalidate any in-flight MusicXML parse so closing the modal cancels the
    // import instead of silently appending once the request resolves.
    _addKeysReqSeq++;
}

export async function editorKeysFileSelected(input) {
    const file = input.files && input.files[0];
    if (!file) return;
    return _editorKeysHandleFile(file);
}

/* @pure:shift-notation:start */
// Shift every absolute time in a notation payload (measures[].t and each
// voice beat's t — `dur` is notational, not seconds) by a constant offset,
// in place. The JS mirror of routes.py's _warp_notation_sidecar walk, for
// the client-side MusicXML audio-offset alignment. Tolerant of malformed
// payloads (skips anything not shaped right) and a no-op for falsy input.
export function _shiftNotationTimes(payload, offset) {
    if (!payload || typeof payload !== 'object' || !Array.isArray(payload.measures) || !offset) return;
    for (const measure of payload.measures) {
        if (!measure || typeof measure !== 'object') continue;
        if (typeof measure.t === 'number') measure.t = Math.round((measure.t + offset) * 1000) / 1000;
        const staves = measure.staves;
        if (!staves || typeof staves !== 'object') continue;
        for (const staff of Object.values(staves)) {
            if (!staff || typeof staff !== 'object') continue;
            for (const voice of (Array.isArray(staff.voices) ? staff.voices : [])) {
                if (!voice || typeof voice !== 'object') continue;
                for (const beat of (Array.isArray(voice.beats) ? voice.beats : [])) {
                    if (beat && typeof beat === 'object' && typeof beat.t === 'number') {
                        beat.t = Math.round((beat.t + offset) * 1000) / 1000;
                    }
                }
            }
        }
    }
}
/* @pure:shift-notation:end */

// The File-object form: the MIDI-only create path feeds the STAGED file
// here directly, so the user never re-picks what they just staged.
export async function _editorKeysHandleFile(file) {
    if (!file) return;
    const statusEl = document.getElementById('editor-add-keys-status');
    statusEl.textContent = 'Parsing ' + file.name + '...';

    // Drop any state from a previous successful parse so a later parse
    // failure (or empty-tracks result) can't be silently committed via
    // editorDoAddKeys using the older file's path.
    _addKeysSourcePath = null;
    _addKeysSortedTracks = [];
    const reqSeq = ++_addKeysReqSeq;  // invalidates any in-flight parse for an earlier file
    document.getElementById('editor-add-keys-go').disabled = true;
    document.getElementById('editor-add-keys-tracks').classList.add('hidden');

    const lower = file.name.toLowerCase();

    // MusicXML is delegated to the musicxml_import plugin's parse-arrangement
    // endpoint, which returns a ready editor arrangement (with authored
    // notation stashed) — no per-track pick, so append it straight away.
    if (lower.endsWith('.xml') || lower.endsWith('.musicxml') || lower.endsWith('.mxl')) {
        _addKeysSourceFormat = 'musicxml';
        try {
            const data = await parseMusicXmlFile(file);
            // A newer file was selected while this parse was in flight — drop it.
            if (reqSeq !== _addKeysReqSeq) return;
            const arr = data.arrangement;
            // The authored notation (grand-staff hand splits the heuristic
            // lift can't re-derive) stays on the arrangement:
            // _editorAppendKeysArrangement sends it to add-arrangement,
            // which stamps provenance + note-fingerprint and returns it for
            // the save rail to prefer over the lift (see routes.py).
            await importMusicXmlArrangementIntoSession(arr, statusEl, {
                isStale: () => reqSeq !== _addKeysReqSeq,
            });
        } catch (e) {
            statusEl.textContent = 'Error: ' + e.message;
        }
        return;
    }

    const isMidi = lower.endsWith('.mid') || lower.endsWith('.midi');
    _addKeysSourceFormat = isMidi ? 'midi' : 'gp';

    const fd = new FormData();
    fd.append('file', file);

    try {
        const url = isMidi
            ? '/api/plugins/editor/import-midi'
            : '/api/plugins/editor/import-gp';
        const resp = await fetch(url, { method: 'POST', body: fd });
        const data = await resp.json();
        // A newer file was selected (incl. a MusicXML one) while this GP/MIDI
        // parse was in flight — don't repopulate the picker for a stale file.
        if (reqSeq !== _addKeysReqSeq) return;
        if (data.error) {
            statusEl.textContent = 'Error: ' + data.error;
            return;
        }
        const tracks = data.tracks || [];
        // Surface piano-flagged tracks first; include all so the user can override.
        const sorted = tracks.slice().sort((a, b) => {
            const ap = (a.is_piano ? 0 : 1);
            const bp = (b.is_piano ? 0 : 1);
            if (ap !== bp) return ap - bp;
            return (b.notes || 0) - (a.notes || 0);
        });

        if (sorted.length === 0) {
            statusEl.textContent = 'No tracks found in this file.';
            // Leave the cleared state from above in place — no usable
            // tracks means editorDoAddKeys must remain disabled.
            return;
        }

        // Only commit the new state once we know there's a usable track set.
        _addKeysSourcePath = isMidi ? data.midi_path : data.gp_path;
        // Stash so editorDoAddKeys can resolve the radio value back to the
        // full track entry (it carries both `index` and `channel_filter`,
        // which can collide if a format-0 file produced multiple entries
        // sharing the same `index`).
        _addKeysSortedTracks = sorted;

        const listEl = document.getElementById('editor-add-keys-track-list');
        const defaultChecked = _keysDefaultSelection(sorted);
        // Checkbox value is the position in `sorted` (not t.index) because
        // format-0 channel splits produce multiple entries that share the same
        // MIDI track_index — we need a unique key. Multi-select: a detected
        // RH/LH piano pair is pre-checked so both hands import and merge.
        listEl.innerHTML = sorted.map((t, pos) => {
            const checked = defaultChecked.has(pos) ? 'checked' : '';
            const isDrums = !!(t.is_drums || t.is_percussion);
            const flag = t.is_piano ? '<span class="text-indigo-300">[keys]</span>' : '';
            const drumsTag = isDrums ? '<span class="text-red-400">[drums]</span>' : '';
            const safeName = _editorEscHtml(t.name || '') || _editorEscHtml('Track ' + t.index);
            return `<label class="flex items-center gap-2 text-xs text-gray-300 py-0.5">
                <input type="checkbox" name="keys-track" value="${pos}" ${checked} class="accent-indigo-500">
                <span class="text-gray-200">${safeName}</span>
                ${flag} ${drumsTag}
                <span class="text-gray-600 ml-auto">${Number(t.notes) || 0} notes</span>
            </label>`;
        }).join('');
        document.getElementById('editor-add-keys-tracks').classList.remove('hidden');
        document.getElementById('editor-add-keys-go').disabled = false;
        const found = sorted.filter(t => t.is_piano).length;
        const pairHint = defaultChecked.size > 1
            ? ' An RH/LH pair is pre-selected — both hands merge into one piano.'
            : '';
        statusEl.textContent = found > 0
            ? `Found ${found} keyboard track(s). Select one or more.${pairHint}`
            : `No tracks auto-flagged as keyboard — select one or more manually.`;
    } catch (e) {
        statusEl.textContent = 'Failed: ' + e.message;
    }
}

// Mirror gp2rs_gpx._find_piano_pairs: a keys track named "<stem> RH" pairs with
// "<stem> LH" (word-boundary, case-insensitive). Pre-select detected pairs so
// both hands import and merge into one piano by default; if none pair, select
// the first keyboard track. Returns a Set of positions in `tracks`.
function _keysDefaultSelection(tracks) {
    const checked = new Set();
    const keys = tracks
        .map((t, pos) => ({ pos, name: String(t.name || '').trim().toLowerCase(), is: !!t.is_piano }))
        .filter(t => t.is);
    const consumed = new Set();
    for (const a of keys) {
        if (consumed.has(a.pos) || !/\brh\b/.test(a.name)) continue;
        const stem = a.name.replace(/\s*\brh\b\s*$/, '').trim();
        for (const b of keys) {
            if (b.pos === a.pos || consumed.has(b.pos) || !/\blh\b/.test(b.name)) continue;
            if (b.name.replace(/\s*\blh\b\s*$/, '').trim() === stem) {
                checked.add(a.pos); checked.add(b.pos);
                consumed.add(a.pos); consumed.add(b.pos);
                break;
            }
        }
    }
    if (checked.size === 0) {
        const firstPiano = tracks.findIndex(t => t.is_piano);
        checked.add(firstPiano >= 0 ? firstPiano : 0);
    }
    return checked;
}

export async function editorDoAddKeys() {
    if (!_addKeysSourcePath || !S.sessionId) return;
    const statusEl = document.getElementById('editor-add-keys-status');
    const goBtn = document.getElementById('editor-add-keys-go');
    goBtn.disabled = true;
    statusEl.textContent = 'Importing keys track...';

    // Checkbox values are positions in _addKeysSortedTracks; resolve them back
    // to full entries (each carries `index` and `channel_filter`). Multiple
    // keys tracks can be imported at once — an RH/LH piano pair is merged into
    // one arrangement server-side (convert_file._find_piano_pairs).
    const checkedEls = Array.from(
        document.querySelectorAll('input[name="keys-track"]:checked'));
    const positions = checkedEls.length ? checkedEls.map(el => parseInt(el.value)) : [0];
    const pickedList = positions.map(p => _addKeysSortedTracks[p]).filter(Boolean);
    if (!pickedList.length) { statusEl.textContent = 'No track selected.'; goBtn.disabled = false; return; }
    const trackIndices = pickedList.map(p => Number(p.index) || 0);

    try {
        const audioOffset = host.effectiveAudioOffset();
        let data;
        let arrangements;
        let xmlPaths = [];
        if (_addKeysSourceFormat === 'midi') {
            // MIDI unpack: EVERY selected track imports, one arrangement each
            // (was: silently only the first). ONE batch request — the endpoint
            // rmtree's its temp dir after responding, so a per-track request
            // loop would find no file on the second track. Names carry the
            // MIDI track name under a keys-safe prefix — kind inference is
            // name-driven and the notes use keys packing.
            const resp = await fetch('/api/plugins/editor/import-keys-midi', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    midi_path: _addKeysSourcePath,
                    audio_offset: audioOffset,
                    tracks: pickedList.map(p => ({
                        index: Number(p.index) || 0,
                        channel_filter: (p.channel_filter == null) ? null : Number(p.channel_filter),
                    })),
                }),
            });
            data = await resp.json();
            if (data.error) {
                statusEl.textContent = 'Error: ' + data.error;
                goBtn.disabled = false;
                return;
            }
            arrangements = Array.isArray(data.arrangements)
                ? data.arrangements
                : (data.arrangement ? [data.arrangement] : []);
            // EVERY selection — including a single track — carries its source
            // name (review #284 item 20: a lone import must not fall back to
            // a generic server-side 'Keys').
            arrangements.forEach((arr, i) => {
                const picked = pickedList[i];
                if (arr && picked) arr.name = _midiKeysArrNamePure(picked.name, picked.index);
            });
        } else {
            const resp = await fetch('/api/plugins/editor/import-keys', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ gp_path: _addKeysSourcePath, track_indices: trackIndices, audio_offset: audioOffset }),
            });
            data = await resp.json();
            if (data.error) {
                statusEl.textContent = 'Error: ' + data.error;
                goBtn.disabled = false;
                return;
            }
            // The GP path may return several arrangements (one per non-merged
            // keys track). Append each in order.
            arrangements = Array.isArray(data.arrangements)
                ? data.arrangements
                : (data.arrangement ? [data.arrangement] : []);
            xmlPaths = Array.isArray(data.xml_paths) ? data.xml_paths : [];
        }
        let allOk = arrangements.length > 0;
        for (let i = 0; i < arrangements.length; i++) {
            const ok = await _editorAppendKeysArrangement(arrangements[i], statusEl, {
                xml_path: xmlPaths[i] || data.xml_path || '',
            });
            if (!ok) { allOk = false; break; }
        }
        if (!allOk) {
            goBtn.disabled = false;
        } else {
            // MIDI-only create seeded a placeholder Keys arrangement so the
            // blank-create backend would accept the session — real tracks
            // just landed, so remove it if it's still the untouched seed.
            await _maybeRemoveMidiSeed();
            // Offer the MIDI's own tempo/time-signature grid (DAW 3.2). No-op
            // for the GP path (no tempo_map) or a gridless MIDI.
            _maybeOfferMidiTempoMap(data.tempo_map);
        }
    } catch (e) {
        statusEl.textContent = 'Failed: ' + e.message;
        goBtn.disabled = false;
    }
}

/* @pure:midi-unpack2:start */
// Is this arrangement still the untouched placeholder the MIDI-only create
// seeded? Only then may the auto-cleanup remove it: the flagged index, the
// seeded name, zero notes — anything else is user work and stays.
function _midiSeedRemovablePure(arr, idx, flagIdx, total) {
    return !!(Number.isInteger(flagIdx) && idx === flagIdx && total > 1
        && arr && arr.name === 'Lead'
        && (!arr.notes || arr.notes.length === 0)
        && (!arr.chords || arr.chords.length === 0));
}
/* @pure:midi-unpack2:end */
export { _midiSeedRemovablePure };

async function _maybeRemoveMidiSeed() {
    const flagIdx = S._midiSeedArrIdx;
    if (flagIdx === undefined) return;
    const flagSession = S._midiSeedSession;
    delete S._midiSeedArrIdx;       // one shot, success or refusal
    delete S._midiSeedSession;
    // The seed belongs to the session that created it. A flag left behind by a
    // cancelled picker must not delete arrangement 0 of a DIFFERENT song the
    // user opened afterwards (loadCDLC carries the flag over unchanged).
    if (flagSession !== S.sessionId) return;
    const arr = S.arrangements[flagIdx];
    if (!_midiSeedRemovablePure(arr, flagIdx, flagIdx, S.arrangements.length)) return;
    if (S.sessionId) {
        try {
            const resp = await fetch('/api/plugins/editor/remove-arrangement', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ session_id: S.sessionId, arrangement_index: flagIdx }),
            });
            const result = await resp.json();
            if (result.error) return;   // the placeholder stays — harmless
        } catch (_) { return; }
    }
    S.arrangements.splice(flagIdx, 1);
    // Same rationale as editorRemoveArrangement: indices shifted under the
    // history stack — drop it (the session is one import old anyway).
    if (S.history) S.history.reset();
    S.currentArr = Math.min(Math.max(0, S.currentArr - 1), S.arrangements.length - 1);
    host.updateArrangementSelector();
    host.draw();
    host.updateStatus();
}

// Create-window MIDI path: the unified table already listed and selected the
// file's tracks, so import those exact rows without reopening a second picker.
export async function importMidiTracksIntoSession(midiPath, pickedList, statusEl = null, opts = {}) {
    if (!midiPath || !S.sessionId || !Array.isArray(pickedList) || !pickedList.length) return false;
    if (statusEl) statusEl.textContent = 'Importing selected MIDI tracks…';
    try {
        const resp = await fetch('/api/plugins/editor/import-keys-midi', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                midi_path: midiPath,
                audio_offset: host.effectiveAudioOffset(),
                keep_upload: opts.keepUpload === true,
                tracks: pickedList.map(track => ({
                    index: Number(track.index) || 0,
                    channel_filter: track.channel_filter == null ? null : Number(track.channel_filter),
                })),
            }),
        });
        const data = await resp.json();
        if (data.error) throw new Error(data.error);
        const arrangements = Array.isArray(data.arrangements)
            ? data.arrangements : (data.arrangement ? [data.arrangement] : []);
        arrangements.forEach((arr, index) => {
            const source = pickedList[index];
            if (arr && source) arr.name = _midiKeysArrNamePure(source.name, source.index);
        });
        for (const arrangement of arrangements) {
            if (!await _editorAppendKeysArrangement(arrangement, statusEl)) return false;
        }
        await _maybeRemoveMidiSeed();
        _maybeOfferMidiTempoMap(data.tempo_map);
        if (statusEl) statusEl.textContent = `${arrangements.length} MIDI track${arrangements.length === 1 ? '' : 's'} imported.`;
        return arrangements.length > 0;
    } catch (error) {
        if (statusEl) statusEl.textContent = 'MIDI import failed: ' + error.message;
        return false;
    }
}

// Read a File as base64 (no data: prefix) for endpoints that take inline bytes.
function _editorFileToBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            const res = String(reader.result || '');
            const comma = res.indexOf(',');
            resolve(comma >= 0 ? res.slice(comma + 1) : res);
        };
        reader.onerror = () => reject(reader.error || new Error('read failed'));
        reader.readAsDataURL(file);
    });
}

export async function parseMusicXmlFile(file) {
    const b64 = await _editorFileToBase64(file);
    const resp = await fetch('/api/plugins/musicxml_import/parse-arrangement', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: file.name, data: b64 }),
    });
    if (resp.status === 404) {
        throw new Error('MusicXML import needs the "Import MusicXML" plugin installed.');
    }
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok || data.error) throw new Error(data.error || String(resp.status));
    if (!data.arrangement || !(data.arrangement.notes || []).length) {
        throw new Error('No notes found in this MusicXML file.');
    }
    return data;
}

// Append an already-parsed MusicXML arrangement. Create-New validates and
// shows metadata while its modal is open, then installs this exact result once
// the backend session exists. Add-Keys uses the same seam after parsing.
export async function importMusicXmlArrangementIntoSession(arr, statusEl, opts = {}) {
    if (!arr) return false;
    const offset = host.effectiveAudioOffset();
    if (offset) {
        for (const n of (arr.notes || [])) n.time = (Number(n.time) || 0) + offset;
        for (const ch of (arr.chords || [])) {
            if (ch.time != null) ch.time = (Number(ch.time) || 0) + offset;
            for (const cn of (ch.notes || [])) {
                if (cn.time != null) cn.time = (Number(cn.time) || 0) + offset;
            }
        }
        _shiftNotationTimes(arr.notation, offset);
    }
    const added = await _editorAppendKeysArrangement(arr, statusEl, opts);
    // Create-New marks its blank arrangement with existing, session-scoped
    // seed provenance. Add-Keys has no flag, so this is a no-op there.
    if (added) await _maybeRemoveMidiSeed();
    return added;
}

// Register an imported Keys arrangement with the session, append it in-memory,
// switch to it, and refresh the view. Shared by the GP/MIDI track import and the
// MusicXML delegation path. Returns true on success.
async function _editorAppendKeysArrangement(arrangement, statusEl, opts = {}) {
    if (!arrangement || !S.sessionId) {
        if (statusEl) statusEl.textContent = 'No arrangement to add.';
        return false;
    }
    // Normalize optional arrays so flattenChords()/the piano-roll don't choke on
    // a notes-only arrangement (e.g. a MusicXML response without `chords`).
    arrangement.chords = arrangement.chords || [];
    arrangement.chord_templates = arrangement.chord_templates || [];
    try {
        // Register with the server-side session (no-op for sloppak).
        const addResp = await fetch('/api/plugins/editor/add-arrangement', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                session_id: S.sessionId,
                arrangement,
                xml_path: opts.xml_path || '',
            }),
        });
        const addData = await addResp.json().catch(() => ({}));
        if (!addResp.ok || addData.error) {
            if (statusEl) statusEl.textContent = 'Error registering arrangement: ' + (addData.error || addResp.status);
            return false;
        }
        // The import may have been canceled/superseded while registration was in
        // flight (modal closed or another file picked) — don't mutate state then.
        if (typeof opts.isStale === 'function' && opts.isStale()) return false;

        // Authored notation round-trip (MusicXML): the raw payload rode the
        // arrangement into add-arrangement, which stamped provenance + a
        // note-fingerprint and returned it. Carry the STAMPED copy as
        // `_gp_notation` (the field the save body ships and the save rail
        // prefers over the heuristic lift) and drop the raw one — an
        // unstamped `notation` field would just be dead weight on the wire.
        delete arrangement.notation;
        if (addData.notation && typeof addData.notation === 'object') {
            arrangement._gp_notation = addData.notation;
        }

        S.arrangements.push(arrangement);
        markSessionDirty();
        S.currentArr = S.arrangements.length - 1;
        const sel = document.getElementById('editor-arrangement');
        if (sel) sel.value = S.currentArr;

        flattenChords();
        if (typeof updatePianoRange === 'function') updatePianoRange();
        host.updateArrangementSelector();
        host.updateStatus();
        host.draw();

        // Shared with the guitar/bass import — hide whichever modal opened this
        // (default: the Add-Keys modal) and label the toast accordingly.
        (opts.hideModal || editorHideAddKeysModal)();
        const label = opts.label || 'Keys';
        setStatus('Added ' + label + ' arrangement (' + (arrangement.notes || []).length + ' notes). Save to commit.');
        return true;
    } catch (e) {
        if (statusEl) statusEl.textContent = 'Failed: ' + e.message;
        return false;
    }
}

let _addingEmptyArr = false;

// Next free display name for a new track of `base` kind ("Lead" → "Lead",
// "Lead 2", …). Kind inference is NAME-driven, so the base must survive as
// the name's prefix — numbering, never renaming. Pure: names in, name out.
export function _uniqueTrackNamePure(base, names) {
    const taken = new Set((names || []).map(n => String(n || '').trim().toLowerCase()));
    if (!taken.has(base.toLowerCase())) return base;
    const limit = taken.size + 2;
    for (let i = 2; i <= limit; i++) {
        if (!taken.has(`${base.toLowerCase()} ${i}`)) return `${base} ${i}`;
    }
    return `${base} ${Date.now()}`;
}

// Register a blank arrangement with the session and adopt it as the active
// part — the shared body of the empty-Keys and empty-fretted starts. The
// backend registration is sloppak-only (save ships the full snapshot).
async function _addEmptyArrangement(arrangement, statusElId, okStatus) {
    if (S.format !== 'sloppak' || !S.sessionId) return false;
    if (_addingEmptyArr) return false;
    _addingEmptyArr = true;
    const statusEl = document.getElementById(statusElId);
    try {
        const resp = await fetch('/api/plugins/editor/add-arrangement', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ session_id: S.sessionId, arrangement }),
        });
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok || data.error) {
            if (statusEl) statusEl.textContent = 'Error registering arrangement: ' + (data.error || resp.status);
            return false;
        }

        S.arrangements.push(arrangement);
        markSessionDirty();
        S.currentArr = S.arrangements.length - 1;
        const sel = document.getElementById('editor-arrangement');
        if (sel) sel.value = S.currentArr;

        flattenChords();
        if (arrKind(arrangement) === 'keys' && typeof updatePianoRange === 'function') {
            updatePianoRange();
        }
        host.updateArrangementSelector();
        host.updateStatus();
        host.draw();
        setStatus(okStatus);
        return true;
    } catch (e) {
        if (statusEl) statusEl.textContent = 'Failed: ' + e.message;
        return false;
    } finally {
        _addingEmptyArr = false;
    }
}

export async function editorAddEmptyKeys(statusElId = 'editor-add-keys-status') {
    const ok = await _addEmptyArrangement({
        name: _uniqueKeysName(),
        tuning: [0, 0, 0, 0, 0, 0],
        capo: 0,
        notes: [],
        chords: [],
        chord_templates: [],
    }, statusElId,
    'Added empty Keys arrangement. Double-click the chart to add notes; save to commit.');
    if (ok) editorHideAddKeysModal();
    return ok;
}

// Blank fretted start (New Track ▸ Transcription ▸ Lead/Rhythm/Bass ▸
// empty). Role names mirror the create flow's roster: Lead/Rhythm seed a
// 6-string guitar, Bass a 4-string bass — the canvas −/+ or the Strings
// modal extend the range afterwards.
export async function editorAddEmptyFretted(role) {
    const base = role === 'Bass' ? 'Bass' : role === 'Rhythm' ? 'Rhythm' : 'Lead';
    return _addEmptyArrangement({
        name: _uniqueTrackNamePure(base, S.arrangements.map(a => a && a.name)),
        tuning: base === 'Bass' ? [0, 0, 0, 0] : [0, 0, 0, 0, 0, 0],
        capo: 0,
        notes: [],
        chords: [],
        chord_templates: [],
    }, 'editor-new-track-status',
    `Added empty ${base} track. Double-click the chart to add notes; save to commit.`);
}

// ════════════════════════════════════════════════════════════════════
// Import a GUITAR / BASS track from a GP file (add or replace)
// ════════════════════════════════════════════════════════════════════

let _importGuitarPath = null;      // server-side path to the uploaded GP file
let _importGuitarTracks = [];      // guitar/bass tracks from the last parse
let _importGuitarReqSeq = 0;       // invalidates in-flight parses when superseded

/* @pure:guitar-import:start */
// Keep only guitar/bass tracks — drop piano/drums/percussion/vocal. Mirrors the
// backend guard in import-guitar-track so the picker and the server agree.
function _isGuitarBassTrack(t) {
    return !!t && !t.is_piano && !t.is_drums && !t.is_percussion && !t.is_vocal;
}

// Derive an arrangement name for an imported guitar/bass track, de-duped
// against `existingNames`. A BASS track's name MUST contain "bass" so
// _stringCountFor / isBassArr lay out 4 lanes (E/A/D/G) instead of 6 — the same
// invariant the "don't mis-read a 4-string bass as 6-string" fix relies on. A
// guitar track whose name would start with keys/drums/… is renamed to a neutral
// guitar role so convert_file routes it through the guitar converter (it
// dispatches by name), not the piano/drum one.
function _guitarImportName(track, existingNames) {
    const taken = new Set((existingNames || [])
        .map(n => String(n || '').trim().toLowerCase()));
    const dedupe = (base) => {
        if (!taken.has(base.toLowerCase())) return base;
        // A free slot is guaranteed within taken.size + 1 tries; +2 is margin.
        for (let i = 2; i <= taken.size + 2; i++) {
            const cand = `${base} ${i}`;
            if (!taken.has(cand.toLowerCase())) return cand;
        }
        return `${base} ${Date.now()}`;
    };
    if (track && track.is_bass) return dedupe('Bass');
    let base = String((track && track.name) || '').trim();
    if (!base || /^(keys|piano|keyboard|synth|drums|percussion)/i.test(base)) {
        base = 'Lead';
    }
    return dedupe(base);
}
/* @pure:guitar-import:end */

export function editorShowImportGuitarModal() {
    if (S.format !== 'sloppak' || !S.sessionId) return;
    document.getElementById('editor-import-guitar-modal').classList.remove('hidden');
    document.getElementById('editor-import-guitar-tracks').classList.add('hidden');
    document.getElementById('editor-import-guitar-dest').classList.add('hidden');
    document.getElementById('editor-import-guitar-go').disabled = true;
    document.getElementById('editor-import-guitar-status').textContent = '';
    const fi = document.getElementById('editor-import-guitar-file');
    if (fi) fi.value = '';
    _importGuitarPath = null;
    _importGuitarTracks = [];
}

export function editorHideImportGuitarModal() {
    document.getElementById('editor-import-guitar-modal').classList.add('hidden');
    // Invalidate any in-flight upload so closing the modal cancels the import.
    _importGuitarReqSeq++;
}

export function editorImportGuitarDestChanged() {
    const dest = (document.querySelector('input[name="guitar-dest"]:checked') || {}).value;
    const sel = document.getElementById('editor-import-guitar-replace-target');
    if (sel) sel.classList.toggle('hidden', dest !== 'replace');
}

// The guitar/bass track currently selected in the picker (or null).
function _importGuitarSelectedTrack() {
    const checked = document.querySelector('input[name="guitar-track"]:checked');
    return checked ? _importGuitarTracks[parseInt(checked.value)] : null;
}

// Rebuild the Replace-target dropdown for the currently-selected track. Only
// SAME-FAMILY guitar/bass arrangements are offered (Keys/Drums always excluded):
// the swap keeps the TARGET's name, so dropping a bass chart onto a guitar
// arrangement — or vice-versa — would render/save it with the wrong lane count
// (bass lanes are name-driven, /bass/i). Option value is the REAL arrangement
// index so the family filter can't misroute the swap. With no eligible target,
// Replace is disabled and the destination falls back to Add.
export function editorImportGuitarRefreshReplaceTargets() {
    const picked = _importGuitarSelectedTrack();
    const wantBass = !!(picked && picked.is_bass);
    const replaceSel = document.getElementById('editor-import-guitar-replace-target');
    const replaceRadio = document.querySelector('input[name="guitar-dest"][value="replace"]');
    const eligible = S.arrangements
        .map((a, i) => ({ a, i }))
        .filter(({ a }) => {
            if (arrKind(a) === 'keys' || arrKind(a) === 'drums') return false;
            return _isBassArr(a) === wantBass;
        });
    if (replaceSel) {
        replaceSel.innerHTML = eligible.map(({ a, i }) =>
            `<option value="${i}">${_editorEscHtml(a.name || ('Arrangement ' + (i + 1)))}</option>`
        ).join('');
    }
    if (replaceRadio) {
        replaceRadio.disabled = eligible.length === 0;
        replaceRadio.title = eligible.length === 0
            ? `No ${wantBass ? 'bass' : 'guitar'} arrangement to replace.`
            : '';
        if (eligible.length === 0 && replaceRadio.checked) {
            const addRadio = document.querySelector('input[name="guitar-dest"][value="add"]');
            if (addRadio) addRadio.checked = true;
        }
    }
    editorImportGuitarDestChanged();
}

export async function editorImportGuitarFileSelected(input) {
    const file = input.files && input.files[0];
    if (!file) return;
    const statusEl = document.getElementById('editor-import-guitar-status');
    statusEl.textContent = 'Parsing ' + file.name + '...';

    // Drop any prior parse so a later failure can't be committed with the old
    // file's path, and invalidate any in-flight upload for an earlier file.
    _importGuitarPath = null;
    _importGuitarTracks = [];
    const reqSeq = ++_importGuitarReqSeq;
    document.getElementById('editor-import-guitar-go').disabled = true;
    document.getElementById('editor-import-guitar-tracks').classList.add('hidden');
    document.getElementById('editor-import-guitar-dest').classList.add('hidden');

    const fd = new FormData();
    fd.append('file', file);
    try {
        const resp = await fetch('/api/plugins/editor/import-gp', { method: 'POST', body: fd });
        const data = await resp.json();
        // A newer file was selected while this parse was in flight — drop it.
        if (reqSeq !== _importGuitarReqSeq) return;
        if (data.error) { statusEl.textContent = 'Error: ' + data.error; return; }

        // Guitar/bass only; surface the most-played tracks first.
        const tracks = (data.tracks || [])
            .filter(_isGuitarBassTrack)
            .sort((a, b) => (b.notes || 0) - (a.notes || 0));
        if (tracks.length === 0) {
            statusEl.textContent = 'No guitar or bass tracks found in this file.';
            return;
        }

        _importGuitarPath = data.gp_path;
        _importGuitarTracks = tracks;

        const listEl = document.getElementById('editor-import-guitar-track-list');
        listEl.innerHTML = tracks.map((t, pos) => {
            const checked = pos === 0 ? 'checked' : '';
            const bassTag = t.is_bass ? '<span class="text-blue-300">[bass]</span>' : '';
            const safeName = _editorEscHtml(t.name || '') || _editorEscHtml('Track ' + t.index);
            return `<label class="flex items-center gap-2 text-xs text-gray-300 py-0.5">
                <input type="radio" name="guitar-track" value="${pos}" ${checked} onchange="editorImportGuitarRefreshReplaceTargets()" class="accent-blue-500">
                <span class="text-gray-200">${safeName}</span>
                ${bassTag}
                <span class="text-gray-600 ml-auto">${Number(t.notes) || 0} notes</span>
            </label>`;
        }).join('');

        // Reset the destination to Add each time a file is (re)picked, then
        // populate the Replace target dropdown for the default-selected track.
        const addRadio = document.querySelector('input[name="guitar-dest"][value="add"]');
        if (addRadio) addRadio.checked = true;
        editorImportGuitarRefreshReplaceTargets();

        document.getElementById('editor-import-guitar-tracks').classList.remove('hidden');
        document.getElementById('editor-import-guitar-dest').classList.remove('hidden');
        document.getElementById('editor-import-guitar-go').disabled = false;
        const bassCount = tracks.filter(t => t.is_bass).length;
        statusEl.textContent =
            `Found ${tracks.length} guitar/bass track(s)` +
            (bassCount ? ` (${bassCount} bass)` : '') + '. Pick one and a destination.';
    } catch (e) {
        statusEl.textContent = 'Failed: ' + e.message;
    }
}

export async function editorDoImportGuitar() {
    if (!_importGuitarPath || !S.sessionId) return;
    const statusEl = document.getElementById('editor-import-guitar-status');
    const goBtn = document.getElementById('editor-import-guitar-go');
    goBtn.disabled = true;

    const checked = document.querySelector('input[name="guitar-track"]:checked');
    const picked = checked ? _importGuitarTracks[parseInt(checked.value)] : null;
    if (!picked) { statusEl.textContent = 'No track selected.'; goBtn.disabled = false; return; }
    const trackIndex = Number(picked.index) || 0;

    const dest = (document.querySelector('input[name="guitar-dest"]:checked') || {}).value || 'add';
    let targetIdx = -1;
    if (dest === 'replace') {
        const sel = document.getElementById('editor-import-guitar-replace-target');
        targetIdx = sel ? parseInt(sel.value) : -1;
        if (!(targetIdx >= 0 && targetIdx < S.arrangements.length)) {
            statusEl.textContent = 'Pick an arrangement to replace.'; goBtn.disabled = false; return;
        }
    }

    // Convert under a guitar/bass-safe name so the guitar converter runs (and a
    // bass gets a /bass/i name → 4 lanes). On Replace the target's name may be
    // "Keys"/"Drums" or anything, so derive a fresh conversion name from the
    // TRACK; the chart adopts the target's display name in the replace command.
    const reqSeq = _importGuitarReqSeq;
    const existingNames = S.arrangements.map(a => a.name || '');
    const name = dest === 'replace'
        ? _guitarImportName(picked, [])
        : _guitarImportName(picked, existingNames);

    statusEl.textContent = dest === 'replace' ? 'Importing (replace)...' : 'Importing track...';
    try {
        const resp = await fetch('/api/plugins/editor/import-guitar-track', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                gp_path: _importGuitarPath,
                track_index: trackIndex,
                audio_offset: host.effectiveAudioOffset(),
                name,
            }),
        });
        const data = await resp.json();
        if (data.error) { statusEl.textContent = 'Error: ' + data.error; goBtn.disabled = false; return; }
        // The modal was closed / a new file picked while this was in flight.
        if (reqSeq !== _importGuitarReqSeq) return;
        const arrangement = data.arrangement;
        if (!arrangement) { statusEl.textContent = 'No arrangement returned.'; goBtn.disabled = false; return; }

        if (dest === 'replace') {
            // Keep the target's existing name (it already reflects the
            // instrument) — swap only the chart. One undo step.
            const cmd = new ReplaceArrangementChartCmd(targetIdx, arrangement);
            // exec() swaps the chart AND flattens it (see the command).
            S.history.exec(cmd);
            S.currentArr = targetIdx;
            // Drop selections/marker refs — they pointed at the OLD chart, so a
            // stale index/ref could now hit an unintended imported note or
            // marker on the next edit. Mirrors editorSelectArrangement.
            S.sel.clear();
            S.toneSel = null;
            S.anchorSel = null;
            S.handshapeSel = null;
            const arrSel = document.getElementById('editor-arrangement');
            if (arrSel) arrSel.value = String(targetIdx);
            // Recompute LANE_H for the now-visible replaced chart (exec's own
            // resize ran before this currentArr switch, so it no-op'd then).
            host.resizeForLaneChange(targetIdx);
            if (typeof updatePianoRange === 'function') updatePianoRange();
            host.updateArrangementSelector();
            host.updateStatus();
            host.draw();
            editorHideImportGuitarModal();
            const nm = S.arrangements[targetIdx] && S.arrangements[targetIdx].name;
            setStatus('Replaced "' + nm + '" chart (' + (arrangement.notes || []).length +
                ' notes). Undo (Ctrl+Z) reverts it. Save to commit.');
        } else {
            const ok = await _editorAppendKeysArrangement(arrangement, statusEl, {
                xml_path: data.xml_path || '',
                label: 'Guitar/Bass',
                hideModal: editorHideImportGuitarModal,
                isStale: () => reqSeq !== _importGuitarReqSeq,
            });
            if (!ok) goBtn.disabled = false;
        }
    } catch (e) {
        statusEl.textContent = 'Failed: ' + e.message;
        goBtn.disabled = false;
    }
}

// GM Percussion (channel 10) names for the unmapped-notes import dialog
// — gives users a hint of what was dropped instead of just a number.
const _GM_PERC_NAMES = {
    27: 'High Q',           28: 'Slap',             29: 'Scratch Push',
    30: 'Scratch Pull',     31: 'Sticks',           32: 'Square Click',
    33: 'Metronome Click',  34: 'Metronome Bell',   35: 'Acoustic Bass Drum',
    36: 'Bass Drum 1',      37: 'Side Stick',       38: 'Acoustic Snare',
    39: 'Hand Clap',        40: 'Electric Snare',   41: 'Low Floor Tom',
    42: 'Closed Hi-Hat',    43: 'High Floor Tom',   44: 'Pedal Hi-Hat',
    45: 'Low Tom',          46: 'Open Hi-Hat',      47: 'Low-Mid Tom',
    48: 'Hi-Mid Tom',       49: 'Crash Cymbal 1',   50: 'High Tom',
    51: 'Ride Cymbal 1',    52: 'Chinese Cymbal',   53: 'Ride Bell',
    54: 'Tambourine',       55: 'Splash Cymbal',    56: 'Cowbell',
    57: 'Crash Cymbal 2',   58: 'Vibraslap',        59: 'Ride Cymbal 2',
    60: 'Hi Bongo',         61: 'Low Bongo',        62: 'Mute Hi Conga',
    63: 'Open Hi Conga',    64: 'Low Conga',        65: 'High Timbale',
    66: 'Low Timbale',      67: 'High Agogo',       68: 'Low Agogo',
    69: 'Cabasa',           70: 'Maracas',          71: 'Short Whistle',
    72: 'Long Whistle',     73: 'Short Guiro',      74: 'Long Guiro',
    75: 'Claves',           76: 'Hi Wood Block',    77: 'Low Wood Block',
    78: 'Mute Cuica',       79: 'Open Cuica',       80: 'Mute Triangle',
    81: 'Open Triangle',    82: 'Shaker',           83: 'Jingle Bell',
    84: 'Belltree',         85: 'Castanets',        86: 'Mute Surdo',
    87: 'Open Surdo',
};

// Post-import warning: the server returns any percussion notes it couldn't
// auto-map to one of the 18 drum pieces. Show them with a per-row dropdown
// so the user can drop them or hand-map each one. Synthesizes hits client-
// side from the times the server captured — no second server round-trip.
/* @pure:midi-tempo-choice:start */
// A "project grid" is present once the timeline has at least two numbered
// downbeats (measure > 0) — i.e. the song already has bars, whether authored
// or audio-aligned. Below that the timeline is effectively empty (a lone
// implied bar), so an imported MIDI's own grid is strictly more information.
function _hasProjectGridPure(beats) {
    if (!Array.isArray(beats)) return false;
    let downbeats = 0;
    for (const b of beats) {
        if (b && (Number(b.measure) || -1) > 0 && ++downbeats >= 2) return true;
    }
    return false;
}

// Sanitize a core `tempo_map.beats` (feedback #796 shape) into editor beat
// rows: keep only finite-time rows carrying {time, measure[, den]} — `den`
// only on real downbeats that have one — and drop anything malformed. Rows
// stay in source order (core emits ascending time). Returns [] for a missing
// or gridless map.
function _midiTempoToBeatsPure(tempoMap) {
    const raw = tempoMap && Array.isArray(tempoMap.beats) ? tempoMap.beats : [];
    const out = [];
    for (const b of raw) {
        if (!b || !Number.isFinite(Number(b.time))) continue;
        const measure = Number.isFinite(Number(b.measure)) ? Number(b.measure) : -1;
        const row = { time: Number(b.time), measure };
        if (measure > 0 && Number.isFinite(Number(b.den))) row.den = Number(b.den);
        out.push(row);
    }
    return out;
}

// Does an imported MIDI carry a grid worth offering? Matches the backend
// gate (routes.py `_sanitize_midi_tempo_map` / `test_single_downbeat_still_
// offered`): at least ONE numbered downbeat. Deliberately looser than
// `_hasProjectGridPure` (which needs 2 to call an EXISTING project timeline
// "a grid") — a single-bar MIDI (a common drum/loop export) still carries a
// real tempo + time signature worth adopting onto an empty project, and the
// backend already ships it. Reusing the 2-downbeat project threshold here
// silently dropped those maps despite the server offering them.
function _midiOffersGridPure(tempoMap) {
    return _midiTempoToBeatsPure(tempoMap).some(b => b.measure > 0);
}

// The default Use-vs-Keep choice, or null when there is nothing to offer.
// Nothing to offer = the MIDI carries no usable grid (no numbered downbeat
// after sanitizing). Otherwise KEEP when the project already has a grid (never
// silently stomp an audio-aligned timeline), USE the MIDI when it doesn't.
function _midiTempoDefaultChoicePure(projectBeats, tempoMap) {
    if (!_midiOffersGridPure(tempoMap)) return null;
    return _hasProjectGridPure(projectBeats) ? 'keep' : 'midi';
}

// Short human summary of a MIDI grid for the dialog: bar count + the first
// time signature + the first tempo (with an ellipsis when either changes).
// Defensive against partial maps.
function _midiTempoSummaryPure(tempoMap) {
    const beats = _midiTempoToBeatsPure(tempoMap);
    const bars = beats.filter(b => b.measure > 0).length;
    const sigs = tempoMap && Array.isArray(tempoMap.time_signatures) ? tempoMap.time_signatures : [];
    const tempos = tempoMap && Array.isArray(tempoMap.tempos) ? tempoMap.tempos : [];
    const parts = [`${bars} bar${bars === 1 ? '' : 's'}`];
    const ts = sigs.length && Array.isArray(sigs[0].ts) ? sigs[0].ts : null;
    if (ts && Number.isFinite(Number(ts[0])) && Number.isFinite(Number(ts[1]))) {
        parts.push(`${ts[0]}/${ts[1]}${sigs.length > 1 ? '…' : ''}`);
    }
    if (tempos.length && Number.isFinite(Number(tempos[0].bpm))) {
        parts.push(`${Math.round(Number(tempos[0].bpm))} BPM${tempos.length > 1 ? '…' : ''}`);
    }
    return parts.join(' · ');
}
/* @pure:midi-tempo-choice:end */

// After a MIDI keys/drums import, offer to adopt the file's own tempo / time-
// signature / beat grid as the project timeline (DAW roadmap 3.2). Calls
// `onDone` immediately (no dialog) when the MIDI carried no usable grid, so
// callers can chain the unmapped-notes triage after it unconditionally. The
// radio defaults per `_midiTempoDefaultChoicePure` — Keep when a project grid
// already exists, Use when it doesn't — and never overwrites silently either
// way. Applying runs through the existing `TempoGridCmd`, so it is one
// undoable step that re-locks the loop onto the new grid.
export function _maybeOfferMidiTempoMap(tempoMap, onDone) {
    const done = typeof onDone === 'function' ? onDone : () => {};
    const dflt = _midiTempoDefaultChoicePure(S.beats, tempoMap);
    if (!dflt) { done(); return; }
    const midiBeats = _midiTempoToBeatsPure(tempoMap);

    document.getElementById('editor-midi-tempo-modal')?.remove();
    const modal = document.createElement('div');
    modal.id = 'editor-midi-tempo-modal';
    modal.className = 'fixed inset-0 bg-black/70 z-50 flex items-center justify-center';
    const inner = document.createElement('div');
    inner.className = 'bg-dark-800 border border-gray-700 rounded-lg p-6 max-w-lg w-full mx-4';

    const title = document.createElement('h3');
    title.className = 'text-lg font-semibold mb-2';
    title.textContent = 'Use this MIDI’s timing?';
    inner.appendChild(title);

    const intro = document.createElement('p');
    intro.className = 'text-sm text-gray-400 mb-4';
    intro.textContent = `This MIDI carries its own tempo map (${_midiTempoSummaryPure(tempoMap)}). `
        + (dflt === 'keep'
            ? 'Your project already has a timeline — keep it, or replace it with the MIDI’s. Imported notes stay accurate either way.'
            : 'Your project has no bars yet — use the MIDI’s grid, or keep the current (empty) timing. Imported notes stay accurate either way.');
    inner.appendChild(intro);

    const mk = (val, label, desc) => {
        const lab = document.createElement('label');
        lab.className = 'flex items-start gap-2 text-sm text-gray-200 py-1 cursor-pointer';
        const rb = document.createElement('input');
        rb.type = 'radio'; rb.name = 'midi-tempo-choice'; rb.value = val;
        rb.className = 'accent-blue-500 mt-0.5';
        if (val === dflt) rb.checked = true;
        const span = document.createElement('span');
        span.innerHTML = `<span class="text-gray-100">${label}</span>`
            + `<span class="block text-xs text-gray-500">${desc}</span>`;
        lab.appendChild(rb); lab.appendChild(span);
        return lab;
    };
    const group = document.createElement('div');
    group.className = 'mb-4';
    group.appendChild(mk('midi', 'Use MIDI tempo map', 'Replace the project timeline with the bars and tempos from this file.'));
    group.appendChild(mk('keep', 'Keep project timing', 'Leave the current timeline untouched; only add the imported track.'));
    inner.appendChild(group);

    const buttons = document.createElement('div');
    buttons.className = 'flex justify-end gap-2';
    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'px-3 py-1 bg-dark-700 hover:bg-dark-600 rounded';
    cancelBtn.textContent = 'Skip';
    const applyBtn = document.createElement('button');
    applyBtn.className = 'px-3 py-1 bg-blue-600 hover:bg-blue-500 rounded';
    applyBtn.textContent = 'Apply';

    const close = () => { modal.remove(); done(); };
    cancelBtn.onclick = close;   // Skip = keep project timing, whatever the radio shows
    applyBtn.onclick = () => {
        const sel = modal.querySelector('input[name="midi-tempo-choice"]:checked');
        if (sel && sel.value === 'midi' && midiBeats.length) {
            const cmd = new TempoGridCmd(S.beats, midiBeats, 'MIDI tempo map');
            cmd.marks = _tempoRemapMarksByTime(S.beats, midiBeats);
            S.history.exec(cmd);
            host.draw();
            setStatus(`Applied the MIDI tempo map (${_midiTempoSummaryPure(tempoMap)}) — save to persist`);
        }
        close();
    };
    buttons.appendChild(cancelBtn);
    buttons.appendChild(applyBtn);
    inner.appendChild(buttons);

    // Keep Space/Delete/etc. from leaking to the global editor handler while
    // the modal is up (mirrors the unmapped-notes modal).
    modal.addEventListener('keydown', (e) => e.stopPropagation());
    modal.appendChild(inner);
    document.body.appendChild(modal);
}

export function _showDrumImportUnmappedModal(unmapped) {
    document.getElementById('editor-drum-unmapped-modal')?.remove();

    const modal = document.createElement('div');
    modal.id = 'editor-drum-unmapped-modal';
    modal.className = 'fixed inset-0 bg-black/70 z-50 flex items-center justify-center';

    const inner = document.createElement('div');
    inner.className = 'bg-dark-800 border border-gray-700 rounded-lg p-6 max-w-2xl w-full max-h-[80vh] flex flex-col mx-4';

    const title = document.createElement('h3');
    title.className = 'text-lg font-semibold mb-2';
    title.textContent = 'Unmapped percussion notes';
    inner.appendChild(title);

    const total = unmapped.reduce((s, u) => s + Math.max(0, Number(u.count) || 0), 0);
    const intro = document.createElement('p');
    intro.className = 'text-sm text-gray-400 mb-4';
    intro.textContent = `${total} note${total === 1 ? '' : 's'} (across `
        + `${unmapped.length} MIDI value${unmapped.length === 1 ? '' : 's'}) `
        + `don't map to one of the ${DRUM_PIECE_ORDER.length} slopsmith drum `
        + `pieces. Drop them, or pick a drum piece per row and add them to `
        + `your tab.`;
    inner.appendChild(intro);

    const listWrap = document.createElement('div');
    listWrap.className = 'flex-1 overflow-y-auto border border-gray-700 rounded mb-4';
    const table = document.createElement('table');
    table.className = 'w-full text-sm';
    const thead = document.createElement('thead');
    thead.innerHTML = '<tr class="bg-dark-700 text-gray-400">'
        + '<th class="text-left p-2">MIDI</th>'
        + '<th class="text-left p-2">GM name</th>'
        + '<th class="text-left p-2">Count</th>'
        + '<th class="text-left p-2">Map to</th></tr>';
    table.appendChild(thead);

    // Keep the times/velocities arrays in a JS Map keyed by the row element
    // rather than round-tripping through JSON.stringify/JSON.parse on a
    // dataset attribute — avoids extra CPU + DOM payload for large sets.
    const rowTimes = new Map();
    const tbody = document.createElement('tbody');
    for (const u of unmapped) {
        const tr = document.createElement('tr');
        tr.className = 'border-t border-gray-800';
        tr.dataset.midi = String(u.midi);
        rowTimes.set(tr, {
            times: Array.isArray(u.times) ? u.times : [],
            // Optional, index-aligned with times when the server captured
            // them — the source notes' REAL velocities.
            vels: Array.isArray(u.velocities) ? u.velocities : null,
        });
        const tdMidi = document.createElement('td');
        tdMidi.className = 'p-2 font-mono';
        tdMidi.textContent = u.midi;
        const tdName = document.createElement('td');
        tdName.className = 'p-2 text-gray-500';
        tdName.textContent = _GM_PERC_NAMES[u.midi] || '—';
        const tdCount = document.createElement('td');
        tdCount.className = 'p-2';
        // Coerce to a number so a malformed response (missing / null /
        // non-numeric count) doesn't render "undefined" in the cell.
        tdCount.textContent = Number(u.count) || 0;
        const tdMap = document.createElement('td');
        tdMap.className = 'p-2';
        const sel = document.createElement('select');
        sel.className = 'bg-dark-700 border border-gray-700 rounded px-1 py-0.5';
        const optDrop = document.createElement('option');
        optDrop.value = '';
        optDrop.textContent = '(drop)';
        sel.appendChild(optDrop);
        for (const pid of DRUM_PIECE_ORDER) {
            const opt = document.createElement('option');
            opt.value = pid;
            opt.textContent = (DRUM_PIECE_META[pid] && DRUM_PIECE_META[pid].label) || pid;
            sel.appendChild(opt);
        }
        tdMap.appendChild(sel);
        tr.appendChild(tdMidi);
        tr.appendChild(tdName);
        tr.appendChild(tdCount);
        tr.appendChild(tdMap);
        tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    listWrap.appendChild(table);
    inner.appendChild(listWrap);

    const buttons = document.createElement('div');
    buttons.className = 'flex justify-end gap-2';
    const dropBtn = document.createElement('button');
    dropBtn.className = 'px-3 py-1 bg-dark-700 hover:bg-dark-600 rounded';
    // The notes are already dropped server-side; closing the dialog
    // discards them permanently (no way to reopen). Label matches that
    // intent so it's clearly the inverse of "Add mapped".
    dropBtn.textContent = 'Discard unmapped';
    dropBtn.onclick = () => modal.remove();
    const addBtn = document.createElement('button');
    addBtn.className = 'px-3 py-1 bg-blue-600 hover:bg-blue-500 rounded';
    addBtn.textContent = 'Add mapped';
    addBtn.onclick = () => {
        if (!S.drumTab || !Array.isArray(S.drumTab.hits)) {
            modal.remove();
            return;
        }
        // Build a key-set of existing hits so we don't duplicate against
        // the imported drum_tab if two unmapped notes resolve to the
        // same (rounded-time, piece) — keeps the editor's in-memory
        // hits consistent with what the server would dedupe on save.
        const seen = new Set(S.drumTab.hits.map(
            h => `${Math.round((h.t || 0) * 1000)}|${h.p}`));
        let added = 0, skipped = 0;
        for (const tr of tbody.querySelectorAll('tr')) {
            const sel = tr.querySelector('select');
            if (!sel || !sel.value) continue;
            const pid = sel.value;
            const row = rowTimes.get(tr) || { times: [], vels: null };
            for (let ti = 0; ti < row.times.length; ti++) {
                const t = row.times[ti];
                // Guard against malformed payload: skip NaN / Infinity /
                // negative times rather than push invalid hit objects
                // that break sort/draw and would be dropped by the
                // backend on save anyway.
                if (!Number.isFinite(t) || t < 0) continue;
                const tRounded = Math.round(t * 1000) / 1000;
                const key = `${Math.round(t * 1000)}|${pid}`;
                if (seen.has(key)) { skipped++; continue; }
                seen.add(key);
                // Carry the source note's REAL velocity through when the
                // server captured it (index-aligned with times) — hand-
                // mapping a note must not flatten its dynamics to v:100 —
                // and derive the ghost flag from that velocity exactly like
                // the MIDI importer does, so a hand-mapped quiet note renders
                // and round-trips as a ghost identically to the same note
                // imported through the normal path.
                const rawV = row.vels ? row.vels[ti] : undefined;
                S.drumTab.hits.push(_drumImportHitPure(tRounded, pid, rawV));
                added++;
            }
        }
        if (added > 0) {
            S.drumTab.hits.sort((a, b) => (a.t || 0) - (b.t || 0));
            S.drumTabDirty = true;
            host.updateArrangementSelector();
            host.draw();
        }
        if (added > 0 || skipped > 0) {
            const skipMsg = skipped > 0 ? ` (${skipped} duplicate${skipped === 1 ? '' : 's'} skipped)` : '';
            setStatus(`Added ${added} hit${added === 1 ? '' : 's'} from mapped notes${skipMsg} — save to persist`);
        }
        modal.remove();
    };
    buttons.appendChild(dropBtn);
    buttons.appendChild(addBtn);
    inner.appendChild(buttons);

    // Stop key events at the modal boundary so the global onKeyDown
    // doesn't intercept Space (→ play/pause) or Delete while a button
    // is focused. The browser still gets the event to activate the
    // focused button on Space/Enter natively.
    modal.addEventListener('keydown', (e) => e.stopPropagation());

    modal.appendChild(inner);
    document.body.appendChild(modal);
}
