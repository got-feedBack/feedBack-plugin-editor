// File operations: load a pack into the editor (loadCDLC + the load browser
// modal), and save the current session (build-save-body + saveCDLC + the
// save-format modal). Extracted from main.js; the display/toolbar refreshers it
// triggers stay in main.js and are reached through host.

import { _anchorsAreDirty, _stripToneInternals, _tonesAreDirty, _updateTonesButtonVisibility } from './annotation-lanes.js';
import { _abDisarm, loadAudio } from './audio.js';
import { _handshapesAreDirty, _normalizeHandshape, flattenChords, reconstructChords } from './chords.js';
import { _normalizeTuningToLanes } from './commands.js';
import { EditHistory } from './history.js';
import { isKeysMode, updatePianoRange } from './keys.js';
import { _seedExtendedStringsFromTuning, _stringCountFor } from './lanes.js';
import { _updateLoopRegionControls } from './loop.js';
import { _recState } from './midi-record.js';
import { _restoreSuggestedMarks, _saveSuggestedMarks, _suggestedStorageKeyPure } from './notes.js';
import { S, markSessionDirty, markSessionSaved } from './state.js';
import {
    disposeBackendSession, guardSessionTransition, stopSessionProcesses,
} from './session-lifecycle.js';
import { _liftAllBeats, _restoreBeatLocks, _stripBeatsFromSaveBody } from './tempo.js';
import { _tourResetForLoad } from './tour.js';
import { _resetSignpostCounters } from './signposts.js';
import { surfaceMigrateFilename, surfaceOnSongLoaded } from './toolbars.js';
import { _editorEscHtml, setStatus } from './ui.js';
import { host } from './host.js';

// How many loads are in flight. The entry landing is armed by a timer on screen
// entry and asks "is anything loaded?" only when it fires, so a load that is
// still fetching loses that race — and nothing else takes the landing down
// again. Because `mousedown` is bound to the canvas while `mousemove` is bound
// to `document`, the leftover `fixed inset-0` overlay then swallows every click
// while the cursor still updates: the edge-drag arms but never grabs.
//
// A counter, not a flag: two loads can overlap (editSong twice, or a load that
// fails fast while a slower one is still fetching), and the first to settle
// would otherwise clear a flag the second still needs held.
export let _editorLoadsInFlight = 0;
let externalSaveHandle = null;
let packLoadController = null;
let packLoadGeneration = 0;

async function _exportBlob() {
    const resp = await fetch('/api/plugins/editor/session/export?session_id='
        + encodeURIComponent(S.sessionId || ''));
    if (!resp.ok) {
        let detail = '';
        try { detail = (await resp.json()).error || ''; } catch (_) {}
        throw new Error(detail || 'Could not export the saved feedpak');
    }
    return resp.blob();
}

async function _writeExternalCopy(handle) {
    const blob = await _exportBlob();
    if (handle) {
        const writable = await handle.createWritable();
        try {
            await writable.write(blob);
            await writable.close();
        } catch (e) {
            try { await writable.abort(); } catch (_) {}
            throw e;
        }
        return;
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = (S.filename || 'song.feedpak').split(/[\\/]/).pop();
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
}

async function _mirrorExternalCopy() {
    if (!externalSaveHandle) return true;
    try {
        await _writeExternalCopy(externalSaveHandle);
        return true;
    } catch (e) {
        markSessionDirty();
        setStatus('Save As copy failed: ' + e.message);
        return false;
    }
}

export async function loadCDLC(filename, options = {}) {
    if (!options.skipGuard && !(await guardSessionTransition('opening another feedpak'))) return false;
    const oldSessionId = S.sessionId;
    stopSessionProcesses();
    packLoadGeneration++;
    const generation = packLoadGeneration;
    if (packLoadController) {
        try { packLoadController.abort(); } catch (_) {}
    }
    packLoadController = typeof AbortController === 'function' ? new AbortController() : null;
    _editorLoadsInFlight++;
    // A load can also start while the landing is already up (editorLoadFile is
    // callable from outside the editor, e.g. the library's Edit button).
    document.getElementById('editor-start-landing')?.remove();
    setStatus('Loading ' + filename + '...');
    try {
        const resp = await fetch('/api/plugins/editor/load', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ filename }),
            ...(packLoadController ? { signal: packLoadController.signal } : {}),
        });
        const data = await resp.json();
        if (generation !== packLoadGeneration) return false;
        if (data.error) { setStatus('Error: ' + data.error); return false; }

        if (oldSessionId && oldSessionId !== data.session_id) {
            await disposeBackendSession(oldSessionId);
        }
        externalSaveHandle = null;
        // The outgoing decoded buffer is not part of the new job. In
        // particular, an audio-less feedpak must not inherit AUDIO mode or
        // accidentally make the old recording playable again.
        S.audioBuffer = null;
        S.waveformPeaks = null;

        S.title = data.title || '';
        S.artist = data.artist || '';
        S.filename = filename;
        S.sessionId = data.session_id;
        S.format = data.format || 'archive';
        // zip vs authoring-directory sloppak — /session/export can only serve
        // the packed (zip) form, and editorSave gates the first-save picker on
        // it. Default 'zip' keeps old servers (no sloppak_form field) working.
        S.sloppakForm = data.sloppak_form || 'zip';
        S.arrangements = data.arrangements || [];
        // New song, new strips: part mute/solo/volume is session UI state
        // keyed by part index, so it must not leak across loads (B6).
        S.partMix = {};
        // Sloppak sources don't pad tuning to 6 slots like RS XML does,
        // so a bass arrangement arriving with tuning.length === 6 from
        // a sloppak is a genuine 6-string bass (not padded 4-string).
        // Seed `_extendedStrings` so `_stringCountFor` doesn't fall
        // back to the baseline-and-ignore-length-6 heuristic for these.
        // Sloppak sources have authoritative tuning lengths (no RS
        // padding). archive sources still get the `tuningLen > 6` path so
        // a previously-extended-saved archive is detected on reload.
        _seedExtendedStringsFromTuning(S.arrangements, S.format !== 'archive');
        // E2: normalize loaded handshapes into robust editable dicts (wire
        // field names) so span-lane authoring + the save round-trip operate
        // on them. The server emits them per-arrangement (_song_to_dict); the
        // editor kept them verbatim before but never normalized them.
        for (const a of S.arrangements) {
            if (!a) continue;
            a.handshapes = (a.handshapes || []).map(_normalizeHandshape)
                // Drop degenerate zero-/negative-length spans: they convey no
                // region and would render/hit-test as a 2px sliver. Authoring
                // enforces HS_MIN_SPAN; a loaded payload may not.
                .filter(hs => hs.end_time > hs.start_time)
                .sort((x, y) => x.start_time - y.start_time);
        }
        S.beats = data.beats || [];
        S.sections = data.sections || [];
        S.duration = data.duration || 0;
        S.offset = data.offset || 0;
        // Drum tab is loaded server-side when the manifest carries a
        // `drum_tab:` key and the file passes schema validation. Treat
        // a missing/falsey value as "no drums" so the +Drums modal can
        // tell whether the user is adding-or-replacing.
        S.drumTab = data.drum_tab ?? null;
        // Normalize hits: sort by t so drum-editor hit-testing and dragging
        // work correctly even if drum_tab.json was saved out of order.
        if (S.drumTab && Array.isArray(S.drumTab.hits)) {
            S.drumTab.hits.sort((a, b) => (a.t || 0) - (b.t || 0));
        }
        // Freshly loaded from disk — not dirty until the user edits it.
        S.drumTabDirty = false;
        // Exit drum-edit mode on song change so we don't carry a stale
        // selection into a sloppak whose hits[] is different.
        S.drumEditMode = false;
        S.drumSel = new Set();
        // Exit tempo-map mode too — its selection indexes into the old
        // song's beats[].
        S.tempoMapMode = false;
        S.tempoSel = -1;
        S.tempoHover = -1;
        // Drop loop A/B — session-only state; carrying a muted-reference
        // phase into another song would read as a playback bug. Refresh the
        // audio + UI too: clearing the flags alone would leave a guide-pass
        // mute on the ref gain and stale A/B button styling until the next
        // incidental control refresh.
        _abDisarm();  // now syncs the guide scheduler itself
        _updateLoopRegionControls();
        // Abandon any in-progress drag — the global mouse handlers act on
        // S.drag regardless of mode, so a stale drag would otherwise keep
        // mutating the newly-loaded song's data.
        S.drag = null;
        S.currentArr = 0;
        S.sel.clear();
        S.toneSel = null;
        S.anchorSel = null;
        S.handshapeSel = null;
        S.scrollX = 0;
        S.cursorTime = 0;
        // Drop any bar-range selection from the previously-loaded song; a
        // pending view (highway handoff / return trip) re-sets it below.
        S.barSel = null;
        S.returnToHighway = false;
        S.history = new EditHistory();
        markSessionSaved();

        // Reset offset UI so _effectiveAudioOffset() doesn't carry over a
        // delta from a previous session's sync nudge into this one.
        _resetOffsetUI();
        // Close any active entry tour — its task hints are tied to the song you
        // entered on (the resume point is kept for Help > Editor tour).
        _tourResetForLoad();
        // Signposts are session-scoped (they react to what you're doing in THIS
        // song); re-baseline the first-covered cue against the freshly loaded
        // chart so opening an already-charted song never fires it.
        _resetSignpostCounters();

        // Flatten chord notes into main notes array for unified editing
        flattenChords();
        // Beat-primary (§1.3): lift note.beat from the loaded seconds against
        // the loaded grid, so beat is the truth from load onward.
        _liftAllBeats(S.beats);
        // Beat-lock (§1.8): re-attach persisted sync-point locks (editor-pref).
        _restoreBeatLocks();
        // Re-attach persisted suggested marks onto the rebuilt note objects so
        // the machine's unreviewed guesses stay honest across a reload.
        _restoreSuggestedMarks();
        if (isKeysMode()) updatePianoRange();

        // Update UI
        document.getElementById('editor-song-title').textContent =
            `${S.artist} — ${S.title}`;
        S.createMode = false;
        // C1 surface memory: land this song's toolbars where they were left
        // (its remembered surface, or the global default when it has none).
        surfaceOnSongLoaded();
        document.getElementById('editor-save-btn').disabled = false;
        document.getElementById('editor-save-btn').classList.remove('hidden');
        document.getElementById('editor-build-btn').classList.add('hidden');
        document.getElementById('editor-play-btn').disabled = !data.audio_url;
        document.getElementById('editor-sync-btn').classList.toggle('hidden', !data.audio_url);
        document.getElementById('editor-replace-audio-btn').classList.remove('hidden');
        _updateTonesButtonVisibility();
        host.updateArrangementSelector();
        host.updateStatus();
        host.updateTimeDisplay();
        host.updateBPMDisplay();

        // Load audio
        if (data.audio_url) {
            await loadAudio(data.audio_url);
        }

        host.draw();
        setStatus('Loaded: ' + S.artist + ' — ' + S.title);
        // Apply a pending view (highway "Edit region" handoff or our own
        // return trip) now that the song is fully loaded, then refresh the
        // Loop-in-3D button's enabled state.
        host.applyEditorPendingView(filename);
        host.updateLoopIn3DBtn();
        return true;
    } catch (e) {
        if (!e || e.name !== 'AbortError') setStatus('Load failed: ' + e.message);
        return false;
    } finally {
        if (generation === packLoadGeneration) packLoadController = null;
        _editorLoadsInFlight--;
    }
}


// ════════════════════════════════════════════════════════════════════
// Load modal
// ════════════════════════════════════════════════════════════════════

export async function showLoadModal() {
    const modal = document.getElementById('editor-load-modal');
    modal.classList.remove('hidden');
    const search = document.getElementById('editor-load-search');
    if (search) search.value = '';

    // Preload the flat list ONCE for recursive search (best-effort). The default
    // view is the folder browser below; typing in the search box searches across
    // every folder using this list.
    if (!S.songsList) {
        try {
            S.songsList = await fetch('/api/plugins/editor/songs').then(r => r.json());
        } catch {
            S.songsList = [];
        }
    }
    // Open as a file browser rooted at the DLC / song-library folder.
    await _editorBrowse('');
    if (search) search.focus();
}

// Fetch + render one directory level of the library. `path` is a DLC-relative
// POSIX subpath ("" = the library root).
async function _editorBrowse(path) {
    S.loadCwd = path || '';
    const list = document.getElementById('editor-load-list');
    let data;
    try {
        data = await fetch('/api/plugins/editor/browse', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: S.loadCwd }),
        }).then(r => r.json());
    } catch {
        data = { error: 'Could not read the library folder' };
    }
    if (!data || data.error) {
        if (list) list.innerHTML = '<div class="text-xs text-gray-500 p-2">'
            + _editorEscHtml((data && data.error) || 'Error') + '</div>';
        return;
    }
    S.loadCwd = data.cwd || '';
    S.loadParent = data.parent;
    _editorSetLoadPath(data.root, data.cwd);
    renderBrowse(data);
}

// Show the absolute folder path (root + current subpath), using whichever
// separator the OS root hints at so it reads like a real path on Windows/*nix.
function _editorSetLoadPath(root, cwd) {
    const el = document.getElementById('editor-load-path');
    if (!el) return;
    const sep = String(root).includes('\\') ? '\\' : '/';
    const full = cwd
        ? String(root).replace(/[\\/]+$/, '') + sep + String(cwd).replace(/\//g, sep)
        : String(root);
    el.textContent = full;
    el.title = full;
}

// Render an up-row (when not at root) + subfolders + loadable feedpaks.
function renderBrowse(data) {
    const list = document.getElementById('editor-load-list');
    if (!list) return;
    list.replaceChildren();
    const row = (icon, text, onClick, badge) => {
        const b = document.createElement('button');
        b.className = 'w-full text-left px-3 py-1.5 text-xs text-gray-300 hover:bg-dark-500 rounded flex items-center gap-2';
        const ic = document.createElement('span'); ic.className = 'shrink-0'; ic.textContent = icon;
        const lb = document.createElement('span'); lb.className = 'flex-1 truncate'; lb.textContent = text;
        b.appendChild(ic); b.appendChild(lb);
        if (badge) {
            const bd = document.createElement('span');
            bd.className = 'px-1.5 py-0.5 rounded text-[10px] uppercase tracking-wide bg-green-900/40 text-green-300';
            bd.textContent = badge;
            b.appendChild(bd);
        }
        b.addEventListener('click', onClick);
        list.appendChild(b);
    };
    if (data.cwd) row('⬆', '.. (up one folder)', () => _editorBrowse(data.parent || ''));
    for (const d of (data.dirs || [])) row('📁', d.name, () => _editorBrowse(d.path));
    for (const f of (data.files || [])) row('🎵', f.name, () => window.editorLoadFile(f.filename), f.format);
    if (!(data.dirs || []).length && !(data.files || []).length) {
        const empty = document.createElement('div');
        empty.className = 'text-xs text-gray-500 p-2';
        empty.textContent = data.cwd
            ? 'This folder is empty.'
            : 'No feedpaks in your library folder yet — use New… to create one.';
        list.appendChild(empty);
    }
}

// Reset the offset input and its applied-delta scalar, called when loading any
// session so _effectiveAudioOffset() doesn't carry over a previous nudge. The
// applied delta lives on S.appliedOffset now (command-owned), not the DOM input.
export function _resetOffsetUI() {
    S.appliedOffset = 0;
    const el = document.getElementById('editor-offset');
    if (el) el.value = '0';
}

function _normalizeSongList(raw) {
    // Backend now returns [{filename, format}] objects. Older deployments
    // may still return plain string filenames — normalize either shape and
    // default missing fields so callers can rely on a consistent shape.
    return (raw || []).map(item => {
        if (typeof item === 'string') {
            return {
                filename: item,
                format: /\.(feedpak|sloppak)$/.test(item.toLowerCase()) ? 'sloppak' : 'archive',
                title: '', artist: '',
            };
        }
        const filename = String(item?.filename ?? '');
        const format = String(item?.format
            ?? (/\.(feedpak|sloppak)$/.test(filename.toLowerCase()) ? 'sloppak' : 'archive'));
        // title/artist are best-effort enrichment from the library cache;
        // absent for unscanned songs, in which case we show the filename only.
        return { filename, format, title: String(item?.title ?? ''), artist: String(item?.artist ?? '') };
    });
}

function renderSongList(files) {
    const list = document.getElementById('editor-load-list');
    files = _normalizeSongList(files);
    list.innerHTML = '';
    if (!files.length) {
        list.innerHTML = '<div class="text-xs text-gray-500 p-2">No custom song files found</div>';
        return;
    }
    // Cap the rendered rows so a broad query (e.g. a single letter) can't
    // inject thousands of nodes; the search box narrows from here.
    const CAP = 200;
    const shown = files.slice(0, CAP);
    // Build the DOM imperatively so filenames never reach innerHTML.
    for (const f of shown) {
        const btn = document.createElement('button');
        btn.className = 'w-full text-left px-3 py-1.5 text-xs text-gray-300 hover:bg-dark-500 rounded flex items-center gap-2';
        btn.addEventListener('click', () => window.editorLoadFile(f.filename));

        // Prefer the real song name (title — artist) when the library cache
        // had it; fall back to the raw filename otherwise. The filename is
        // always shown as a dim subtitle so it stays identifiable/pickable.
        const songName = f.title
            ? (f.artist ? `${f.title} — ${f.artist}` : f.title)
            : '';
        const col = document.createElement('span');
        col.className = 'flex-1 min-w-0';
        const primary = document.createElement('span');
        primary.className = 'block truncate';
        primary.textContent = songName || f.filename;
        col.appendChild(primary);
        if (songName) {
            const sub = document.createElement('span');
            sub.className = 'block truncate text-[10px] text-gray-500';
            sub.textContent = f.filename;
            col.appendChild(sub);
        }
        btn.appendChild(col);

        const badge = document.createElement('span');
        const badgeColor = f.format === 'sloppak'
            ? 'bg-green-900/40 text-green-300'
            : 'bg-blue-900/40 text-blue-300';
        badge.className = `px-1.5 py-0.5 rounded text-[10px] uppercase tracking-wide ${badgeColor}`;
        badge.textContent = f.format;
        btn.appendChild(badge);

        list.appendChild(btn);
    }
    if (files.length > CAP) {
        const more = document.createElement('div');
        more.className = 'text-xs text-gray-500 p-2 text-center';
        more.textContent = `Showing first ${CAP} of ${files.length} — refine your search`;
        list.appendChild(more);
    }
}

export function filterSongs(q) {
    const query = (q || '').trim().toLowerCase();
    // Empty query → back to the folder browser (rooted where the user last was).
    if (!query) { _editorBrowse(S.loadCwd || ''); return; }
    if (!S.songsList) return;
    const list = _normalizeSongList(S.songsList);
    // Match song name, artist, OR raw filename so users can search either way.
    const filtered = list.filter(f =>
        f.filename.toLowerCase().includes(query)
        || (f.title && f.title.toLowerCase().includes(query))
        || (f.artist && f.artist.toLowerCase().includes(query)));
    renderSongList(filtered);
}

// ════════════════════════════════════════════════════════════════════
// Save
// ════════════════════════════════════════════════════════════════════

// True if the *active* arrangement has more strings than stock-RS
// archive can carry (>6 guitar, >4 bass). archive saves are
// per-arrangement (the /save endpoint only writes `arrangement_index`),
// so checking other arrangements would surface the format prompt
// even when the save would only touch a standard one — annoying for
// users who, say, edited bass while leaving an extended lead alone.
// Uses `_stringCountFor` which composes the explicit
// `_extendedStrings` counter with chord-template width and max-note-
// index signals (so a 5-string bass with no notes on the new lane
// still trips the prompt, and a 6-string bass after a high-C add
// does too because `_extendedStrings` is set).
export function _activeArrangementExceedsArchiveLimit() {
    const a = S.arrangements[S.currentArr];
    if (!a) return false;
    const isBass = /bass/i.test(a.name || '');
    const roleLimit = isBass ? 4 : 6;
    return _stringCountFor(a) > roleLimit;
}

// Prep work common to all save paths: normalise chord state across
// arrangements, then return the request body for the chosen endpoint.
// `forceFullSnapshot` is true for save_as_sloppak so the new sloppak
// gets every arrangement (not just S.currentArr).
function _buildSaveBody(forceFullSnapshot) {
    if (_recState === 'recording') window.editorStopRecordMidi();

    // Persist suggested marks BEFORE reconstructChords mints fresh note objects
    // and drops them from the WeakSet, so a reload restores the honest-gap marks.
    // Capture PER ARRANGEMENT (keyed by S.currentArr). Two subtleties:
    //   - The full-snapshot loop leaves INACTIVE arrangements RECONSTRUCTED (their
    //     chord members live in arr.chords as fresh, unmarked objects), so a later
    //     save must flatten first, then re-attach that arr's marks FROM THE STORE
    //     before capturing — otherwise the capture sees zero chord-member marks
    //     and would wipe the key. The ACTIVE arr is already flattened with LIVE
    //     WeakSet marks (which may lead the store after an unsaved Accept), so it
    //     is NOT restored — its live marks win.
    const savedArr = S.currentArr;
    if (S.format === 'sloppak' || forceFullSnapshot) {
        for (let i = 0; i < S.arrangements.length; i++) {
            if (!S.arrangements[i]) continue;  // defensive: a hole must not abort the whole save
            S.currentArr = i;
            flattenChords();
            if (i !== savedArr) _restoreSuggestedMarks();
            _saveSuggestedMarks();
            reconstructChords();
        }
        S.currentArr = savedArr;
    } else {
        _saveSuggestedMarks();
        reconstructChords();
    }

    const arr = S.arrangements[S.currentArr];
    const body = {
        session_id: S.sessionId,
        arrangement_index: S.currentArr,
        notes: arr.notes,
        chords: arr.chords,
        chord_templates: arr.chord_templates,
        beats: S.beats,
        sections: S.sections,
        // Always ship title/artist so archive saves persist in-session
        // metadata edits too. Backend merges with session metadata
        // (album/year captured at load time) so all four fields
        // round-trip regardless of save path.
        metadata: {
            title: S.title,
            artist: S.artist,
        },
    };
    if (S.format === 'sloppak' || forceFullSnapshot) {
        // Strip the client-only `_editCount` field from each
        // arrangement's tones dict so the backend doesn't see it.
        // Backend reads tones from `body.arrangements[*].tones` here —
        // a top-level `body.tones` would be ignored, so don't
        // duplicate the payload.
        //
        // Skip `tones` entirely when the arrangement has no net
        // authored edits this session. Commands that mutate tones
        // (Add/Move/Remove/Rename) all run `_ensureTones` to
        // synthesize a `{}` shape; if every edit then gets undone,
        // the synthesized object stays behind. Shipping it would
        // overwrite the on-disk `tones: null` sentinel with an
        // empty `{base, slots, changes, definitions}` dict on the
        // next sloppak save.
        body.arrangements = S.arrangements.map(a => {
            if (!a) return a;
            // Strip `_anchorEditCount` / `_handshapeEditCount` from every
            // arrangement so the dirty counters never leak to the backend's
            // wire format. `rest` still carries `handshapes` (remapped by the
            // reconstructChords pass above) for the sloppak round-trip.
            const { _anchorEditCount, _handshapeEditCount, ...rest } = a;
            if (!rest.tones) return rest;
            // Distinguish loaded-but-unauthored data (ship verbatim,
            // round-trip through sloppak) from a synthesized-then-
            // fully-undone state (strip so the backend's preserve
            // branch fires).
            //   - Loaded data: `_editCount` key is *absent* (load
            //     path doesn't set it); ship as-is.
            //   - Authored this session: `_editCount > 0` → ship.
            //   - Synthesized + fully undone: `_editCount === 0`
            //     → strip the field; the empty object would
            //     otherwise overwrite a `tones: null` sentinel on
            //     disk.
            const editCount = rest.tones._editCount;
            if (editCount === 0) {
                const { tones, ...rest2 } = rest;
                return rest2;
            }
            return { ...rest, tones: _stripToneInternals(rest.tones) };
        });
    } else if (_tonesAreDirty(arr)) {
        // Single-arrangement (archive) save — the backend reads
        // `body.tones` directly. Ship it only when net authored
        // edits exist this session; a complete undo back to load
        // state returns the count to 0 → omit the field and let
        // the backend's preserve-from-disk branch fire.
        body.tones = _stripToneInternals(arr.tones);
    }
    // PR3d: ship `anchors_user` for single-arr archive saves when
    // the user has authored anchors this session. Full-snapshot
    // sloppak saves ride through `body.arrangements[i].anchors_user`
    // already (every arrangement object carries it intact).
    if (S.format !== 'sloppak' && !forceFullSnapshot
            && _anchorsAreDirty(arr) && Array.isArray(arr.anchors_user)) {
        body.anchors_user = arr.anchors_user;
    }
    // E2: ship `handshapes` for single-arr archive saves whenever any exist.
    // Unlike anchors (index-free {time,fret,width}), a handshape's `chord_id`
    // is an index into `chord_templates`, which reconstructChords() rebuilds
    // (and remaps the handshapes against) on EVERY save. So a dirty-only gate
    // is unsafe: editing notes can reindex templates while leaving handshapes
    // "clean", and the backend's absent→preserve path (`_FIELD_ABSENT`) would
    // then keep stale `chord_id`s pointing at the wrong rebuilt templates.
    // Shipping the freshly-remapped list keeps chord_ids consistent; ship an
    // empty list only when the user explicitly cleared authored handshapes.
    if (S.format !== 'sloppak' && !forceFullSnapshot && Array.isArray(arr.handshapes)
            && (arr.handshapes.length > 0 || _handshapesAreDirty(arr))) {
        body.handshapes = arr.handshapes;
    }
    // Drum-tab payload — separate from arrangements (see sloppak-spec §5.3).
    // S.drumTab is null while the sloppak has none; after +Drums it holds the
    // parsed JSON dict. Only ship `drum_tab` when the user actually
    // imported / edited it this session (`S.drumTabDirty`) — a tab merely
    // loaded from disk is left out so the backend's no-op path preserves
    // the manifest entry unchanged instead of re-serialising the whole
    // hit list on every unrelated save.
    if (S.drumTabDirty && S.drumTab !== undefined && S.drumTab !== null) {
        body.drum_tab = S.drumTab;
    }
    // Beat-primary: strip the runtime beat cache so the wire stays seconds-only.
    return _stripBeatsFromSaveBody(body);
}

export async function saveCDLC(options = {}) {
    if (!S.sessionId) return false;
    // archive can't carry >6-string guitar / >4-string bass. If the user
    // pushed past those limits while editing, ask them whether to spill
    // into a new .sloppak or accept the truncation before we touch disk.
    if (S.format === 'archive' && _activeArrangementExceedsArchiveLimit()) {
        document.getElementById('editor-save-format-modal').classList.remove('hidden');
        return false;
    }
    setStatus('Saving...');
    const body = _buildSaveBody(false);
    try {
        const resp = await fetch('/api/plugins/editor/save', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        const data = await resp.json();
        if (data.error) { setStatus('Save error: ' + data.error); return false; }
        if (!options.skipExternal && !(await _mirrorExternalCopy())) return false;
        markSessionSaved();
        setStatus('Saved successfully');
        return true;
    } catch (e) {
        setStatus('Save failed: ' + e.message);
        return false;
    } finally {
        flattenChords();
        _restoreSuggestedMarks();   // reattach marks onto the reflattened objects
        // (Undo history was invalidated inside _buildSaveBody's reconstructChords
        // rebuild — see #18 there; nothing to reset here.)
        host.draw();
    }
}

export const editorHideSaveFormatModal = () => {
    document.getElementById('editor-save-format-modal').classList.add('hidden');
};

// "Save as Sloppak" — POST the full arrangement snapshot to the new
// /save_as_sloppak route. The backend writes a .sloppak next to the
// source .archive, then flips the session into sloppak mode so the next
// regular Save uses the native sloppak path.
export const editorSaveAsSloppakConfirm = async () => {
    document.getElementById('editor-save-format-modal').classList.add('hidden');
    if (!S.sessionId) return false;
    setStatus('Saving as Sloppak...');
    const oldFilename = S.filename;
    const body = _buildSaveBody(true);   // persists suggested marks under oldFilename
    try {
        const resp = await fetch('/api/plugins/editor/save_as_sloppak', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        const data = await resp.json();
        if (data.error) { setStatus('Save error: ' + data.error); return false; }
        // Flip session into sloppak mode so subsequent edits route to
        // _save_sloppak. The original archive stays on disk untouched.
        if (data.filename) {
            // Migrate the suggested-mark keys to the new filename so the machine's
            // unresolved guesses stay honest in the new .sloppak (the finally
            // restore below reads the NEW key). Old file's keys are left intact.
            if (data.filename !== oldFilename) {
                try {
                    for (let i = 0; i < S.arrangements.length; i++) {
                        const v = localStorage.getItem(_suggestedStorageKeyPure(oldFilename, i));
                        if (v !== null) localStorage.setItem(_suggestedStorageKeyPure(data.filename, i), v);
                    }
                } catch (_) { /* localStorage unavailable */ }
                // The surface memory (C1) rides the same rename.
                surfaceMigrateFilename(oldFilename, data.filename);
            }
            S.filename = data.filename;
        }
        S.format = 'sloppak';
        S.sloppakForm = 'zip';   // save_as_sloppak always writes the packed form
        // Normalize in-memory tuning to the real string count so a
        // subsequent /save (which now goes through the native sloppak
        // path) doesn't serialize the RS-XML length-6 padding back into
        // the sloppak manifest — a later reload would otherwise seed
        // `_extendedStrings` from the padded length and mis-detect a
        // 4-string bass as 6-string.
        for (const arr of S.arrangements) {
            if (!arr) continue;  // defensive: a hole must not abort the archive save
            _normalizeTuningToLanes(arr, _stringCountFor(arr));
        }
        // `updateArrangementSelector` is what owns the + Keys / Strings /
        // Record toolbar gates and the remove-arrangement button. Refresh
        // it immediately so the user sees sloppak-only controls light up
        // the moment the conversion lands.
        host.updateArrangementSelector();
        // Prefer the relative filename over `data.path` so we don't
        // leak absolute server filesystem paths into the status UI.
        const displayName = data.filename || (data.path ? data.path.split('/').pop() : '');
        host.kickLibraryRescan();   // new file → surface it in the library automatically
        setStatus('Saved as Sloppak: ' + displayName);
        markSessionSaved();
        return true;
    } catch (e) {
        setStatus('Save failed: ' + e.message);
        return false;
    } finally {
        flattenChords();
        _restoreSuggestedMarks();   // reattach marks onto the reflattened objects
        // (Undo history already invalidated by reconstructChords in _buildSaveBody — #18.)
        host.draw();
    }
};

export async function editorSaveAs() {
    if (!S.sessionId) return false;
    let handle = null;
    if (typeof window.showSaveFilePicker === 'function') {
        try {
            handle = await window.showSaveFilePicker({
                suggestedName: (S.filename || 'song.feedpak').split(/[\\/]/).pop()
                    .replace(/\.(archive|sloppak)$/i, '.feedpak'),
                types: [{
                    description: 'feedBack song package',
                    accept: { 'application/zip': ['.feedpak', '.sloppak'] },
                }],
            });
        } catch (e) {
            if (e && e.name === 'AbortError') return false;
            setStatus('Save As picker failed: ' + e.message);
            return false;
        }
    }

    const saved = S.format === 'archive'
        ? await editorSaveAsSloppakConfirm()
        : await saveCDLC({ skipExternal: true });
    if (!saved) return false;
    try {
        await _writeExternalCopy(handle);
        externalSaveHandle = handle;
        markSessionSaved();
        setStatus(handle ? 'Saved to the selected file' : 'Saved — download started');
        return true;
    } catch (e) {
        markSessionDirty();
        setStatus('Save As failed: ' + e.message);
        return false;
    }
}

// The Save command (Ctrl+S / the toolbar Save button / File ▸ Save). The FIRST
// save of a session pulls up the file explorer — same picker as Save As — so the
// user chooses where the .feedpak lands; once a location is chosen this session,
// later saves write straight to it (and mirror to that file). The "chosen this
// session" signal is externalSaveHandle: it's null on load / a new session and
// set by editorSaveAs after a picked file. Guard on the picker API so that
// where it's unavailable (no showSaveFilePicker) we fall back to the plain
// library save rather than re-triggering a download on every Ctrl+S. Programmatic
// saves (highway handoff, host saveSession hook, build) keep calling saveCDLC()
// directly and are unaffected — only the user's Save routes through here.
// Route the Save command to the picker only when no location has been chosen
// this session (hasHandle=false) AND the picker API exists (without it,
// editorSaveAs can only trigger a download, so fall back to the library save)
// AND the session can actually complete the Save As flow (sessionCanExport).
// The last gate matters: a create-mode session is rejected by /save outright,
// and a directory-form sloppak library-saves fine but /session/export can't
// serve a packed file for it — routing either through the picker would pop
// the explorer, have the user pick a destination, then fail (and re-prompt on
// every subsequent Ctrl+S, with the dir-form session falsely re-marked dirty
// after a library save that succeeded).
export function _saveShouldPickPure(hasHandle, hasPickerApi, sessionCanExport) {
    return !hasHandle && !!hasPickerApi && !!sessionCanExport;
}
export async function editorSave() {
    if (!S.sessionId) return false;
    const hasPicker = typeof window !== 'undefined' && typeof window.showSaveFilePicker === 'function';
    // The `S.format === 'sloppak'` leg also deliberately excludes the vestigial
    // 'archive' format (unreachable today — /load only accepts feedpak/sloppak
    // and always reports 'sloppak'): for an archive session editorSaveAs would
    // CONVERT it to a new .sloppak (editorSaveAsSloppakConfirm), and a plain
    // Save must never perform a format conversion the user didn't ask for —
    // that stays behind the explicit Save As command.
    const canExport = !S.createMode && S.format === 'sloppak' && S.sloppakForm !== 'dir';
    if (_saveShouldPickPure(!!externalSaveHandle, hasPicker, canExport)) return editorSaveAs();
    return saveCDLC();
}
