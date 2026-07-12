// ════════════════════════════════════════════════════════════════════
// Song creation — everything between "New…" and a loaded chart.
//
// The format picker, the sloppak-create modal, the roster ("what are you
// arranging?"), the MusicBrainz metadata match, and the album-art picker. They
// travel together because they are one flow over one object: `createState`,
// which is reset when the modal opens and read by every step after it.
//
// The DOM here is dialogs, not canvas. Nothing in this module draws, and the
// only reason it knows `draw` exists is that finishing a build lands you in the
// editor.
//
// main.js keeps the load/audio pipeline (loadCDLC, loadAudio), the library
// rescan, and the transport readouts; they arrive through the shared `host`
// object in src/host.js. It also keeps the entry landing, which is screen-entry
// UI that happens to open two of these dialogs.
//
// The 22 `window.editor*` handlers the HTML calls are exported as plain
// functions and re-attached by main.js — a top-level `window.x =` throws when
// this module is imported under node.
// ════════════════════════════════════════════════════════════════════
import {
    _anchorsAreDirty, _editorConfirmToneDefinitions, _stripToneInternals, _tonesAreDirty,
    _updateTonesButtonVisibility,
} from './annotation-lanes.js';
import { _handshapesAreDirty, flattenChords, reconstructChords } from './chords.js';
import { EditHistory } from './history.js';
import { host } from './host.js';
import { KEYS_PATTERN, isKeysMode, updatePianoRange } from './keys.js';
import { _seedExtendedStringsFromTuning } from './lanes.js';
import { S, markSessionDirty } from './state.js';
import { disposeBackendSession, stopSessionProcesses } from './session-lifecycle.js';
import { _liftAllBeats, _restoreBeatLocks, _syncAppliedMessagePure } from './tempo.js';
import { seedSurfacePreset, surfacePersistFor } from './toolbars.js';
import { _editorMaybeStartTour } from './tour.js';
import { _editorEscHtml, _installModalKeyboard, setStatus } from './ui.js';


// ════════════════════════════════════════════════════════════════════
// Create mode
// ════════════════════════════════════════════════════════════════════

export let createState = {
    gpPath: null,
    tracks: null,
    audioUrl: null,
    audioMode: 'file', // 'file' or 'youtube'
    artPath: null,
    previewPath: null,
    eofFiles: null,    // FileList[] of selected EOF arrangement XMLs
};

// ════════════════════════════════════════════════════════════════════
// "New…" entry point — format picker → sloppak-create OR archive-create.
// The button used to go straight to the archive create modal; drummers
// asked for a sloppak-first path so they don't have to make-archive-
// then-save-as-sloppak just to land in drum-charting mode.
// ════════════════════════════════════════════════════════════════════

export function editorShowNewFormatPicker() {
    // Remove any stale picker (e.g. opened twice).
    document.getElementById('editor-new-format-picker')?.remove();

    const modal = document.createElement('div');
    modal.id = 'editor-new-format-picker';
    modal.className = 'fixed inset-0 bg-black/70 z-50 flex items-center justify-center';

    const inner = document.createElement('div');
    inner.className = 'bg-dark-800 border border-gray-700 rounded-lg p-6 max-w-md w-full mx-4';

    const title = document.createElement('h3');
    title.className = 'text-lg font-semibold mb-4';
    title.textContent = 'What are you making?';
    inner.appendChild(title);

    const mkBtn = (heading, blurb, onClick) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'w-full text-left p-3 mb-2 bg-dark-700 hover:bg-dark-600 rounded border border-gray-700';
        const h = document.createElement('div');
        h.className = 'font-medium text-sm';
        h.textContent = heading;
        const p = document.createElement('div');
        p.className = 'text-xs text-gray-400 mt-1';
        p.textContent = blurb;
        b.appendChild(h); b.appendChild(p);
        b.onclick = () => { modal.remove(); onClick(); };
        return b;
    };
    inner.appendChild(mkBtn(
        '🎵  Blank — start from audio',
        'Audio + an empty arrangement (drum tab optional). Chart it yourself '
        + 'in the editor. No Guitar Pro / XML needed.',
        // Raw opener, not window.editorShowCreateModal: the transition was
        // already guarded when this picker opened; the wrapper would re-prompt.
        () => { editorShowCreateModal(); window.editorSetCreateMode('blank'); },
    ));
    inner.appendChild(mkBtn(
        '🎸  Import from Guitar Pro',
        'Build a chart from a Guitar Pro file (.gp3–.gp8), saved as a native '
        + '.feedpak.',
        () => { editorShowCreateModal(); window.editorSetCreateMode('gp'); },
    ));

    const cancel = document.createElement('div');
    cancel.className = 'flex justify-end mt-2';
    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'px-3 py-1 bg-dark-700 hover:bg-dark-600 rounded text-sm';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.onclick = () => modal.remove();
    cancel.appendChild(cancelBtn);
    inner.appendChild(cancel);

    modal.appendChild(inner);
    // Keep global shortcuts (Space → play, Delete → erase notes, etc.)
    // from firing while the picker is open, but handle Escape locally
    // so keyboard users can dismiss without tabbing to Cancel.
    _installModalKeyboard(modal, inner, () => modal.remove());
    document.body.appendChild(modal);
    // Move focus into the modal so subsequent keystrokes (Escape,
    // Tab, etc.) bubble through this listener — otherwise focus
    // stays on the toolbar "New…" button outside the modal and the
    // global onKeyDown still gets keystrokes.
    inner.querySelector('button')?.focus();
}


export function editorShowCreateModal() {
    // Fresh state each open so a prior session (roster / audio / gp8AudioMode /
    // autoSyncAudioUrl / lastSync) can't leak in. Default roster: one Lead
    // Guitar arrangement, so the modal is immediately creatable with a title.
    createState = {
        mode: 'blank',
        roster: ['Lead'],
        gpPath: null, tracks: null, gpName: null, gpHasEmbedded: false, gpSyncCount: 0,
        eofFiles: null, eofName: null,
        audioUrl: null, audioName: null, audioDuration: null, audioFile: null, midiInfo: null,
        artPath: null, previewPath: null,
        gp8AudioMode: 'none', autoSyncAudioUrl: null, lastSync: null, autoSyncCoupled: false,
        // GoPlayAlong sync sidecar (goplayalong.com): a <track> .xml that carries
        // the bar→audio sync for a separately-staged Guitar Pro chart. When set,
        // editorDoCreate() sources the sync from it (parse-goplayalong-sync)
        // instead of onset auto-detection. Never a chart of its own.
        goplayalongFile: null, goplayalongScore: '',
    };
    const setVal = (id) => { const el = document.getElementById(id); if (el) el.value = ''; };
    const setTxt = (id) => { const el = document.getElementById(id); if (el) el.textContent = ''; };
    const hide = (id) => document.getElementById(id)?.classList.add('hidden');
    document.getElementById('editor-create-modal')?.classList.remove('hidden');
    hide('editor-create-tracks');
    const go = document.getElementById('editor-create-go'); if (go) go.disabled = true;
    setTxt('editor-create-status');
    setTxt('editor-create-import-status');
    setTxt('editor-create-roster-hint');
    [
        'editor-create-import', 'editor-create-yt-url', 'editor-create-art',
        'editor-create-title', 'editor-create-artist', 'editor-create-album', 'editor-create-album-artist',
        'editor-create-year', 'editor-create-track', 'editor-create-disc', 'editor-create-genre',
        'editor-create-language', 'editor-create-isrc', 'editor-create-mbid', 'editor-create-authors',
    ].forEach(setVal);
    const artPrev = document.getElementById('editor-create-art-preview');
    if (artPrev) { artPrev.style.backgroundImage = ''; artPrev.textContent = 'No art yet'; }
    // Reset the GP8/auto-sync UI so stale banner/section/refine state isn't shown.
    hide('editor-gp8-audio-banner'); hide('editor-autosync-section'); hide('editor-refine-row');
    setTxt('editor-autosync-status'); setTxt('editor-refine-status');
    setTxt('editor-create-autofill-note');
    _populateRosterPalette();
    _renderRosterSelected();
    renderStaged();
    _syncYtFieldState();
    updateCreateButton();
    _updateIdentifyButton();   // disabled until a master track is staged
}

export function editorHideCreateModal() {
    document.getElementById('editor-create-modal').classList.add('hidden');
}

// ════════════════════════════════════════════════════════════════════
// Sloppak-create modal — straight to sloppak mode with optional empty
// drum_tab pre-initialised. POSTs multipart {audio, metadata JSON} to
// /api/plugins/editor/create_sloppak; on success the editor opens the
// newly-written sloppak via the existing loadCDLC path.
// ════════════════════════════════════════════════════════════════════

export function editorShowCreateSloppakModal() {
    document.getElementById('editor-create-sloppak-modal')?.remove();

    let audioFile = null;

    const modal = document.createElement('div');
    modal.id = 'editor-create-sloppak-modal';
    modal.className = 'fixed inset-0 bg-black/70 z-50 flex items-center justify-center';

    const inner = document.createElement('div');
    inner.className = 'bg-dark-800 border border-gray-700 rounded-lg p-6 max-w-xl w-full mx-4 max-h-[90vh] overflow-y-auto';

    const title = document.createElement('h3');
    title.className = 'text-lg font-semibold mb-1';
    title.textContent = 'New Sloppak';
    inner.appendChild(title);

    const sub = document.createElement('p');
    sub.className = 'text-xs text-gray-400 mb-4';
    sub.textContent = 'Audio + chart in slopsmith\'s native sloppak format.';
    inner.appendChild(sub);

    // ── Audio drop / picker ─────────────────────────────────────────
    // It's a <div> for layout reasons (drop targets need to accept
    // dragover/drop, which is awkward on a native <button>), but
    // semantically it behaves like a button — surface that to assistive
    // tech via role + an accessible name, and to keyboards via the
    // existing Space/Enter handler.
    const dropZone = document.createElement('div');
    dropZone.className = 'border-2 border-dashed border-gray-600 hover:border-gray-500 rounded p-6 mb-3 text-center cursor-pointer transition-colors';
    dropZone.tabIndex = 0;
    dropZone.setAttribute('role', 'button');
    dropZone.setAttribute('aria-label',
        'Pick or drop the audio file for the new sloppak');
    const dropMsg = document.createElement('div');
    dropMsg.className = 'text-sm text-gray-400';
    dropMsg.textContent = 'Drop an audio file here, or click to pick';
    const dropHint = document.createElement('div');
    dropHint.className = 'text-xs text-gray-600 mt-1';
    dropHint.textContent = 'mp3 / wav / flac / m4a / ogg';
    dropZone.appendChild(dropMsg);
    dropZone.appendChild(dropHint);

    const hiddenFileInput = document.createElement('input');
    hiddenFileInput.type = 'file';
    hiddenFileInput.accept = 'audio/*,.mp3,.wav,.flac,.m4a,.ogg,.opus';
    hiddenFileInput.className = 'hidden';
    dropZone.appendChild(hiddenFileInput);

    const setAudio = (file) => {
        audioFile = file || null;
        if (!file) {
            dropMsg.textContent = 'Drop an audio file here, or click to pick';
            dropMsg.className = 'text-sm text-gray-400';
            dropHint.textContent = 'mp3 / wav / flac / m4a / ogg';
            return;
        }
        dropMsg.textContent = `📂 ${file.name}`;
        dropMsg.className = 'text-sm text-gray-200';
        const mb = (file.size / 1048576).toFixed(1);
        // .ogg uploads skip the ffmpeg re-encode pass server-side; the
        // hint should reflect that rather than always promising a
        // re-encode.
        const isOgg = /\.ogg$/i.test(file.name || '');
        dropHint.textContent = isOgg
            ? `${mb} MB — kept as .ogg (no re-encode)`
            : `${mb} MB — re-encoded to .ogg on create`;
    };

    dropZone.onclick = () => hiddenFileInput.click();
    dropZone.onkeydown = (e) => {
        if (e.key === ' ' || e.key === 'Enter') {
            e.preventDefault();
            hiddenFileInput.click();
        }
    };
    hiddenFileInput.onchange = () => setAudio(hiddenFileInput.files?.[0] || null);
    dropZone.ondragover = (e) => {
        e.preventDefault();
        dropZone.classList.add('border-blue-500');
    };
    dropZone.ondragleave = () => dropZone.classList.remove('border-blue-500');
    dropZone.ondrop = (e) => {
        e.preventDefault();
        dropZone.classList.remove('border-blue-500');
        setAudio(e.dataTransfer.files?.[0] || null);
    };
    inner.appendChild(dropZone);

    // ── Metadata fields ─────────────────────────────────────────────
    const mkRow = (label, el) => {
        const row = document.createElement('div');
        row.className = 'mb-2';
        const lab = document.createElement('label');
        lab.className = 'block text-xs text-gray-400 mb-1';
        lab.textContent = label;
        row.appendChild(lab);
        row.appendChild(el);
        return row;
    };
    const mkInput = (placeholder, type = 'text') => {
        const i = document.createElement('input');
        i.type = type;
        i.placeholder = placeholder;
        i.className = 'w-full px-2 py-1 bg-dark-700 border border-gray-700 rounded text-sm';
        return i;
    };

    const titleInput = mkInput('Song title');
    const artistInput = mkInput('Artist');
    const albumInput = mkInput('Album (optional)');
    const yearInput = mkInput('Year (optional)', 'number');
    inner.appendChild(mkRow('Title', titleInput));
    inner.appendChild(mkRow('Artist', artistInput));

    const albumRow = document.createElement('div');
    albumRow.className = 'grid grid-cols-3 gap-2 mb-2';
    const albumWrap = mkRow('Album', albumInput); albumWrap.className = 'col-span-2 mb-0';
    const yearWrap = mkRow('Year', yearInput); yearWrap.className = 'mb-0';
    albumRow.appendChild(albumWrap);
    albumRow.appendChild(yearWrap);
    inner.appendChild(albumRow);

    // ── Initial arrangement ────────────────────────────────────────
    const arrRow = document.createElement('div');
    arrRow.className = 'mb-2';
    const arrLab = document.createElement('label');
    arrLab.className = 'block text-xs text-gray-400 mb-1';
    arrLab.textContent = 'Initial arrangement';
    arrRow.appendChild(arrLab);
    const arrButtons = document.createElement('div');
    arrButtons.className = 'flex gap-1';
    let arrChoice = 'Lead';
    const refreshArrButtons = () => {
        arrButtons.querySelectorAll('button').forEach(b => {
            const on = b.dataset.arr === arrChoice;
            b.className = 'px-3 py-1 rounded text-sm ' + (on
                ? 'bg-blue-600 text-white'
                : 'bg-dark-700 hover:bg-dark-600 text-gray-300');
        });
    };
    for (const name of ['Lead', 'Rhythm', 'Bass']) {
        const b = document.createElement('button');
        b.type = 'button';
        b.dataset.arr = name;
        b.textContent = name;
        b.onclick = () => { arrChoice = name; refreshArrButtons(); };
        arrButtons.appendChild(b);
    }
    refreshArrButtons();
    arrRow.appendChild(arrButtons);
    inner.appendChild(arrRow);

    const arrNote = document.createElement('p');
    arrNote.className = 'text-xs text-gray-500 mb-3';
    arrNote.textContent = 'Default tuning is E standard (Bass: BEAD-equivalent 4 strings). Adjust later from the editor toolbar.';
    inner.appendChild(arrNote);

    // ── Drum tab init ──────────────────────────────────────────────
    const drumWrap = document.createElement('label');
    drumWrap.className = 'flex items-center gap-2 mb-4 cursor-pointer';
    const drumCb = document.createElement('input');
    drumCb.type = 'checkbox';
    drumCb.checked = true;
    drumCb.className = 'cursor-pointer';
    const drumLab = document.createElement('span');
    drumLab.className = 'text-sm';
    drumLab.textContent = 'Also start an empty drum tab';
    drumWrap.appendChild(drumCb);
    drumWrap.appendChild(drumLab);
    inner.appendChild(drumWrap);

    // ── Status + buttons ───────────────────────────────────────────
    const status = document.createElement('div');
    status.className = 'text-xs mb-2 min-h-[1em]';
    inner.appendChild(status);

    const buttons = document.createElement('div');
    buttons.className = 'flex justify-end gap-2';
    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'px-3 py-1 bg-dark-700 hover:bg-dark-600 rounded text-sm';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.onclick = () => modal.remove();

    let inFlight = false;
    const createBtn = document.createElement('button');
    createBtn.className = 'px-3 py-1 bg-green-700 hover:bg-green-600 rounded text-sm font-medium';
    createBtn.textContent = 'Create';
    createBtn.onclick = async () => {
        if (!audioFile) {
            status.textContent = 'Pick an audio file first.';
            status.className = 'text-xs mb-2 min-h-[1em] text-red-400';
            return;
        }
        const t = titleInput.value.trim();
        const a = artistInput.value.trim();
        if (!t) {
            status.textContent = 'Title is required.';
            status.className = 'text-xs mb-2 min-h-[1em] text-red-400';
            titleInput.focus();
            return;
        }
        if (!a) {
            status.textContent = 'Artist is required.';
            status.className = 'text-xs mb-2 min-h-[1em] text-red-400';
            artistInput.focus();
            return;
        }
        const yearRaw = yearInput.value.trim();
        // Send year as a string verbatim — the backend extracts the
        // 4-digit year via regex and accepts either int or str.
        // `Number(yearRaw) || yearRaw` would coerce "1990.5" to a
        // float which the strict backend validator rejects with 400.
        const meta = {
            title: t,
            artist: a,
            album: albumInput.value.trim(),
            year: yearRaw,
            initial_arrangement: arrChoice,
            init_drum_tab: drumCb.checked,
        };
        const fd = new FormData();
        fd.append('audio', audioFile);
        fd.append('metadata', JSON.stringify(meta));

        inFlight = true;
        createBtn.disabled = true;
        cancelBtn.disabled = true;
        status.className = 'text-xs mb-2 min-h-[1em] text-gray-400';
        status.textContent = 'Uploading + building sloppak…';
        try {
            const resp = await fetch('/api/plugins/editor/create_sloppak', {
                method: 'POST', body: fd,
            });
            const data = await resp.json();
            if (!resp.ok || !data.success) {
                status.textContent = 'Error: ' + (data.error || resp.statusText);
                status.className = 'text-xs mb-2 min-h-[1em] text-red-400';
                inFlight = false;
                createBtn.disabled = false;
                cancelBtn.disabled = false;
                return;
            }
            modal.remove();
            host.kickLibraryRescan();   // surface the new song in the library automatically
            // Open the freshly-written sloppak via the existing load
            // path so the editor state initialises identically to a
            // normal sloppak load.
            await host.loadCDLC(data.filename, { skipGuard: true });
            // C1 lane seed: created from scratch → the Compose surface
            // (intent, not audio-presence — an attached recording to
            // compose over still starts light; charrette §3.1).
            seedSurfacePreset('compose');
            _editorMaybeStartTour('compose');   // C3: first-run entry tour
        } catch (e) {
            status.textContent = 'Failed: ' + e.message;
            status.className = 'text-xs mb-2 min-h-[1em] text-red-400';
            inFlight = false;
            createBtn.disabled = false;
            cancelBtn.disabled = false;
        }
    };
    buttons.appendChild(cancelBtn);
    buttons.appendChild(createBtn);
    inner.appendChild(buttons);

    modal.appendChild(inner);
    // Stop key events at the modal boundary so the global onKeyDown
    // doesn't intercept Space (toggle play) while typing in inputs,
    // but honor Escape locally so keyboard users can dismiss the
    // dialog the way they'd expect.
    // Escape closes the dialog UNLESS a create is in-flight — once the
    // server-side write starts we don't want Escape to "dismiss" the
    // UI while the request is still going to land a new sloppak (and
    // open it). Cancel button is already disabled in the same state.
    _installModalKeyboard(modal, inner, () => {
        if (inFlight) return;
        modal.remove();
    });
    document.body.appendChild(modal);

    titleInput.focus();
}

// Retired: the Upload File / YouTube toggle was removed — audio now arrives via
// the single Content Import browse (or the YouTube field beside it). Kept as a
// harmless no-op so any stray caller can't throw.
export function editorSetAudioMode() {}

// Upload + stage ONE Guitar Pro file into the single chart slot. Does NOT touch
// the master-audio slot — the two are independent now (fixes the "audio falls
// off" bug). Autofills Title/Artist/Album from the chart's own metadata.
async function _stageGpFile(file) {
    const iStatus = document.getElementById('editor-create-import-status');
    if (iStatus) iStatus.textContent = 'Reading Guitar Pro file…';
    const form = new FormData();
    form.append('file', file);
    try {
        const resp = await fetch('/api/plugins/editor/import-gp', { method: 'POST', body: form });
        const data = await resp.json();
        if (data.error) { if (iStatus) iStatus.textContent = 'Error: ' + data.error; return; }
        createState.gpPath = data.gp_path;
        createState.tracks = data.tracks;
        createState.gpName = file.name;
        createState.gpHasEmbedded = !!data.has_embedded_audio;
        createState.gpSyncCount = data.sync_point_count || 0;
        createState.mode = 'gp';
        // Chart slot is exclusive — a GP replaces any EOF pick. Audio untouched.
        createState.eofFiles = null;

        const listEl = document.getElementById('editor-create-track-list');
        if (listEl) listEl.innerHTML = data.tracks.map(t => {
            const isDrums = !!(t.is_drums || t.is_percussion);
            // Role tag (not a warning): drums used to render red, which read as
            // an error. Each row now self-labels with a coloured role pill —
            // amber Drums / indigo Keys / sky Bass / muted Guitar — so no legend
            // is needed. Inline styles: core Tailwind lacks the /opacity variants.
            const role = isDrums ? { t: 'Drums', s: 'background:rgba(245,158,11,0.16);color:#fcd34d' }
                : t.is_piano ? { t: 'Keys', s: 'background:rgba(129,140,248,0.18);color:#c7d2fe' }
                : t.is_bass ? { t: 'Bass', s: 'background:rgba(56,189,248,0.16);color:#7dd3fc' }
                : { t: 'Guitar', s: 'background:#2c3040;color:#9aa0ad' };
            const disabled = t.notes === 0;
            const safeName = _editorEscHtml(t.name);
            return `<label class="flex items-center gap-2 text-xs py-0.5">
                <input type="checkbox" value="${t.index}" checked
                    class="accent-accent" ${disabled ? 'disabled' : ''}>
                <span class="text-gray-300 flex-1" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${safeName}</span>
                <span class="px-1.5 py-0.5 rounded text-[10px] font-medium" style="${role.s}">${role.t}</span>
                <span class="text-gray-600 shrink-0">${Number(t.strings) || 0}str · ${Number(t.notes) || 0} notes</span>
            </label>`;
        }).join('');
        document.getElementById('editor-create-tracks')?.classList.remove('hidden');

        // Reset any prior sync result, then derive the GP audio UI + autofill.
        createState.lastSync = null;
        document.getElementById('editor-refine-row')?.classList.add('hidden');
        const _asStatus = document.getElementById('editor-autosync-status');
        if (_asStatus) _asStatus.textContent = '';
        const _asInput = document.getElementById('editor-autosync-audio');
        if (_asInput) _asInput.value = '';
        const _asYt = document.getElementById('editor-autosync-yt-url');
        if (_asYt) _asYt.value = '';
        const _syncCount = document.getElementById('editor-gp8-sync-count');
        if (_syncCount) _syncCount.textContent = createState.gpSyncCount;
        _refreshGpAudioUI();
        _applyGpAutofill(data.song);
        if (iStatus) iStatus.textContent = `Guitar Pro chart added — ${data.tracks.length} tracks.`;
        updateCreateButton();
    } catch (e) {
        if (iStatus) iStatus.textContent = 'Upload failed: ' + e.message;
    }
}

// Back-compat wrapper (accepts the input element).
export async function editorGPFileSelected(input) {
    const f = input && input.files && input.files[0];
    if (f) await _stageGpFile(f);
}

// Derive the GP audio UI from (chart present, master audio present, embedded).
// FORK A: a staged master audio, when present, IS the auto-sync source — so we
// hide the redundant embedded banner + manual autosync section and align the
// chart to that audio at Create.
function _refreshGpAudioUI() {
    const banner = document.getElementById('editor-gp8-audio-banner');
    const syncSec = document.getElementById('editor-autosync-section');
    if (!createState.gpPath) {
        banner?.classList.add('hidden'); syncSec?.classList.add('hidden');
        return;
    }
    if (createState.audioUrl) {
        // Coupled: the staged master audio is the alignment source (Fork A) — one
        // click at Create runs the sync + convert with no separate audio step.
        createState.gp8AudioMode = 'autosync';
        createState.autoSyncAudioUrl = createState.audioUrl;
        createState.autoSyncCoupled = true;
        createState.lastSync = null;
        banner?.classList.add('hidden'); syncSec?.classList.add('hidden');
    } else if (createState.gpHasEmbedded) {
        createState.autoSyncCoupled = false;
        if (banner) banner.classList.remove('hidden');
        window.editorSetGP8AudioMode('embedded');   // sets mode + button styles + hides syncSec
        createState.autoSyncAudioUrl = null;
    } else {
        createState.autoSyncCoupled = false;
        createState.gp8AudioMode = 'none';
        createState.autoSyncAudioUrl = null;
        banner?.classList.add('hidden');
        syncSec?.classList.remove('hidden');
    }
}

// Non-destructive autofill of Title/Artist/Album from an imported chart's own
// metadata — fills only EMPTY fields, with a one-time note. Editing any of them
// dismisses the note (see the input listener).
function _applyGpAutofill(song) {
    if (!song) return;
    const filled = [];
    const fill = (id, val, label) => {
        const el = document.getElementById(id);
        if (val && el && !el.value.trim()) { el.value = val; filled.push(label); }
    };
    fill('editor-create-title', song.title, 'Title');
    fill('editor-create-artist', song.artist, 'Artist');
    fill('editor-create-album', song.album, 'Album');
    const note = document.getElementById('editor-create-autofill-note');
    if (note) note.textContent = filled.length
        ? 'Filled ' + filled.join(', ') + ' from the imported chart — edit anything.' : '';
    updateCreateButton();
}

// Shared upload helper for the Create modal and the Replace Audio modal.
// Returns the new audio URL on success or null on missing input / failure.
// The caller is responsible for any "missing input" UX (the helper returns
// null silently in that case so its callers can decide whether to show a
// message — `uploadCreateAudio`'s caller prechecks; the replace flow shows
// a "Choose a file" hint).
export async function _uploadAudioForMode({ mode, ytInputId, fileInputId, statusEl }) {
    if (mode === 'youtube') {
        const url = document.getElementById(ytInputId).value.trim();
        if (!url) return null;
        statusEl.textContent = 'Downloading from YouTube...';
        try {
            const resp = await fetch('/api/plugins/editor/youtube-audio', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url }),
            });
            const data = await resp.json();
            if (data.error) { statusEl.textContent = 'Error: ' + data.error; return null; }
            statusEl.textContent = 'Audio ready: ' + (data.title || 'downloaded');
            return data.audio_url;
        } catch (e) {
            statusEl.textContent = 'Download failed: ' + e.message;
            return null;
        }
    }
    const input = document.getElementById(fileInputId);
    if (!input.files.length) return null;
    statusEl.textContent = 'Uploading audio...';
    const form = new FormData();
    form.append('file', input.files[0]);
    try {
        const resp = await fetch('/api/plugins/editor/upload-audio', { method: 'POST', body: form });
        const data = await resp.json();
        if (data.error) { statusEl.textContent = 'Error: ' + data.error; return null; }
        statusEl.textContent = 'Audio uploaded';
        return data.audio_url;
    } catch (e) {
        statusEl.textContent = 'Upload failed: ' + e.message;
        return null;
    }
}

async function uploadCreateAudio() {
    // Audio FILES upload on selection (Content Import → createState.audioUrl).
    // Here we only resolve a pasted YouTube URL when no file audio is set yet.
    if (createState.audioUrl) return true;
    const yt = ((document.getElementById('editor-create-yt-url')?.value) || '').trim();
    if (!yt) return false;
    const url = await _uploadAudioForMode({
        mode: 'youtube',
        ytInputId: 'editor-create-yt-url',
        fileInputId: 'editor-create-import',
        statusEl: document.getElementById('editor-create-import-status')
            || document.getElementById('editor-create-status'),
    });
    if (!url) return false;
    createState.audioUrl = url;
    return true;
}

// Pure gate — INPUT-DRIVEN so it can be unit-tested (tests/create_gate.test.js).
// A picked Guitar Pro file wins, then EOF XML arrangement(s). Otherwise it's a
// from-scratch create, which needs a title AND at least one instrument in the
// roster (Vocals alone can't stand — the spec requires a non-empty arrangements
// list). Audio + artist stay optional (draft-now, audio-later).
export function _createGateOpen(state, flags) {
    if (!state || !flags) return false;
    if (state.gpPath) return true;
    if (state.eofFiles && state.eofFiles.length) return true;
    var instruments = ['Lead', 'Rhythm', 'Keys', 'Bass', 'Drums'];
    var hasInstrument = !!(state.roster && state.roster.some(function (r) {
        return instruments.indexOf(r) >= 0;
    }));
    return !!(flags.hasTitle && hasInstrument);
}

function _createHasAudioInput() {
    if (createState.audioUrl) return true;
    return !!((document.getElementById('editor-create-yt-url')?.value) || '').trim();
}

// The spec-complete metadata typed in the create modal, so a Guitar Pro / EOF
// import carries the same fields the blank-create path sends (the backend
// normalizes + persists them at Build). Values are raw strings; the server
// coerces track/disc to ints and genres/authors to lists.
function _createExtendedMeta() {
    const v = (id) => ((document.getElementById(id)?.value) || '').trim();
    return {
        album_artist: v('editor-create-album-artist'),
        track: v('editor-create-track'),
        disc: v('editor-create-disc'),
        genres: v('editor-create-genre'),
        language: v('editor-create-language'),
        isrc: v('editor-create-isrc'),
        mbid: v('editor-create-mbid'),
        authors: v('editor-create-authors'),
    };
}

function updateCreateButton() {
    const open = _createGateOpen(createState, {
        hasTitle: !!((document.getElementById('editor-create-title')?.value) || '').trim(),
        hasArtist: !!((document.getElementById('editor-create-artist')?.value) || '').trim(),
        hasAudio: _createHasAudioInput(),
    });
    const btn = document.getElementById('editor-create-go');
    if (btn) btn.disabled = !open;
    if (typeof _updateMbButton === 'function') _updateMbButton();
}

// Populate the Blank-mode "Initial Arrangement" toggle. Lead / Rhythm / Bass are
// the arrangements the create_sloppak backend accepts today; Keys/Drums-as-arr
// + extended tunings need backend work (tracked separately). The drum-tab
// checkbox beside it covers a drum chart.
// Fretted roles carry a string count + tuning; Keys (piano-roll) and Drums
// (drum tab) don't. The editor opens each in the right mode by the arrangement
// NAME (KEYS_PATTERN / ^drums), which the create route sets from initialArr.
const _FRETTED_ROLES = ['Lead', 'Rhythm', 'Bass'];
function _isFrettedRole(role) { return _FRETTED_ROLES.includes(role); }

// String-count options per role — feedpak-spec §5.2 allows tuning length 4-8.
// Guitar roles offer 6/7/8; Bass offers 4/5/6.
function _createRoleStringOptions(role) {
    return role === 'Bass' ? [4, 5, 6] : [6, 7, 8];
}
function _createRoleDefaultStrings(role) {
    return role === 'Bass' ? 4 : 6;
}

// ════════════════════════════════════════════════════════════════════
// Roster — "What are you arranging?" Click a palette chip to add a role;
// drag the selected chips to reorder. Backend canonical names: Vocals,
// Lead, Rhythm, Keys, Bass, Drums (create_sloppak maps display labels too).
// ════════════════════════════════════════════════════════════════════
const _CREATE_ROSTER = [
    { id: 'Vocals', label: 'Vocals' },
    { id: 'Lead', label: 'Lead Guitar' },
    { id: 'Rhythm', label: 'Rhythm Guitar' },
    { id: 'Keys', label: 'Keys' },
    { id: 'Bass', label: 'Bass Guitar' },
    { id: 'Drums', label: 'Drums' },
];
const _CREATE_INSTRUMENTS = ['Lead', 'Rhythm', 'Keys', 'Bass', 'Drums'];
function _rosterLabel(id) {
    const r = _CREATE_ROSTER.find((x) => x.id === id);
    return r ? r.label : id;
}

function _populateRosterPalette() {
    const wrap = document.getElementById('editor-create-roster-palette');
    if (!wrap) return;
    wrap.replaceChildren();
    for (const r of _CREATE_ROSTER) {
        const inSel = createState.roster.includes(r.id);
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = (inSel ? '✓ ' : '+ ') + r.label;
        b.className = 'px-2 py-1 rounded text-xs font-medium '
            + (inSel ? 'bg-accent text-white' : 'bg-dark-600 text-gray-300 hover:bg-dark-500');
        b.onclick = () => _toggleRosterRole(r.id);
        wrap.appendChild(b);
    }
}

function _toggleRosterRole(id) {
    const i = createState.roster.indexOf(id);
    if (i >= 0) createState.roster.splice(i, 1);
    else createState.roster.push(id);
    _populateRosterPalette();
    _renderRosterSelected();
    updateCreateButton();
}

let _rosterDragFrom = null;
function _renderRosterSelected() {
    const wrap = document.getElementById('editor-create-roster-selected');
    if (!wrap) return;
    wrap.replaceChildren();
    if (!createState.roster.length) {
        const p = document.createElement('span');
        p.className = 'text-[11px] text-gray-600';
        p.textContent = 'Nothing yet — click an instrument above.';
        wrap.appendChild(p);
    }
    createState.roster.forEach((id, idx) => {
        const chip = document.createElement('span');
        chip.draggable = true;
        chip.className = 'inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium bg-dark-600 text-gray-200 cursor-move';
        const name = document.createElement('span');
        name.textContent = _rosterLabel(id);
        chip.appendChild(name);
        const x = document.createElement('button');
        x.type = 'button';
        x.textContent = '✕';
        x.className = 'text-gray-500 hover:text-white';
        x.onclick = (e) => { e.stopPropagation(); _toggleRosterRole(id); };
        chip.appendChild(x);
        chip.addEventListener('dragstart', () => { _rosterDragFrom = idx; });
        chip.addEventListener('dragover', (e) => e.preventDefault());
        chip.addEventListener('drop', (e) => {
            e.preventDefault();
            if (_rosterDragFrom === null || _rosterDragFrom === idx) return;
            const arr = createState.roster;
            const [moved] = arr.splice(_rosterDragFrom, 1);
            arr.splice(idx, 0, moved);
            _rosterDragFrom = null;
            _renderRosterSelected();
        });
        wrap.appendChild(chip);
    });
    const hint = document.getElementById('editor-create-roster-hint');
    if (hint) {
        const hasInstrument = createState.roster.some((r) => _CREATE_INSTRUMENTS.includes(r));
        const hasVocals = createState.roster.includes('Vocals');
        hint.textContent = (hasVocals && !hasInstrument)
            ? 'Vocals adds a lyrics track — add at least one instrument to chart against.'
            : (hasVocals ? 'Vocals seeds an empty lyrics track (a full vocals editor is coming).' : '');
    }
}

// Single "Content Import" browse — route by extension to the right importer.
// Single "Content Import" browse — now MULTI-file and role-routed. Each file is
// staged into its role slot (1 master audio, 1 chart, MIDI as an info row)
// WITHOUT clearing the other role. That's the whole fix for "the audio falls off
// when I then add a Guitar Pro file."
const _IMPORT_AUDIO = ['.mp3', '.wav', '.flac', '.ogg', '.m4a', '.opus', '.aac', '.wem'];
const _IMPORT_GP = ['.gp3', '.gp4', '.gp5', '.gpx', '.gp'];
const _extOf = (f) => (f.name.match(/\.[^.]+$/) || [''])[0].toLowerCase();

export async function editorContentImportSelected(input) {
    const files = [...(input.files || [])];
    if (!files.length) return;
    const status = document.getElementById('editor-create-import-status');
    const audioFiles = files.filter((f) => _IMPORT_AUDIO.includes(_extOf(f)));
    const gpFiles = files.filter((f) => _IMPORT_GP.includes(_extOf(f)));
    const xmlFiles = files.filter((f) => _extOf(f) === '.xml');
    const midiFiles = files.filter((f) => ['.mid', '.midi'].includes(_extOf(f)));
    const unknown = files.filter((f) => ![..._IMPORT_AUDIO, ..._IMPORT_GP, '.xml', '.mid', '.midi'].includes(_extOf(f)));

    // A .xml is either a GoPlayAlong sync sidecar (a <track> carrying <sync> —
    // it aligns a separately-added Guitar Pro chart to audio) or an EOF/RS
    // arrangement (the chart itself). Sniff the content so the two aren't
    // confused — handing a GoPlayAlong file to the arrangement loader is exactly
    // the "not a recognised EOF arrangement XML" failure this avoids.
    const gpaXmls = [];
    const eofXmls = [];
    for (const f of xmlFiles) {
        let t = '';
        try { t = await f.text(); } catch (_) { /* unreadable — treat as EOF below */ }
        if (/<track\b/i.test(t) && /<sync\b/i.test(t)) gpaXmls.push(f); else eofXmls.push(f);
    }
    if (gpaXmls.length) await _stageGoplayalong(gpaXmls[0]);

    // Chart slot (exclusive): a Guitar Pro file wins over RS/EOF XML if both are
    // added together. Stage the chart BEFORE the audio so the coupling sees it.
    if (gpFiles.length) {
        await _stageGpFile(gpFiles[0]);
        if (eofXmls.length && status) status.textContent += ' (RS XML ignored — one chart source per song.)';
    } else if (eofXmls.length) {
        _stageEofFiles(eofXmls);
    }
    // Master-audio slot (one master track for now; stems later).
    if (audioFiles.length) {
        await _stageAudio(audioFiles[0]);
        if (audioFiles.length > 1 && status) {
            status.textContent = 'One master track for now — used "' + audioFiles[0].name
                + '". (Multiple stems are coming.)';
        }
    }
    if (midiFiles.length) _stageMidi(midiFiles);
    if (unknown.length && status) {
        status.textContent = 'Skipped unsupported: ' + unknown.map((f) => f.name).join(', ')
            + ' (PowerTab & MusicXML are coming).';
    }
    // The staged list is now the source of truth — clear the input so re-adding
    // the same file fires a fresh change and the input never "shows" one file.
    input.value = '';
    renderStaged();
    updateCreateButton();
}

// Upload + stage the master audio track. Never touches the chart slot; couples
// into GP auto-sync (via _refreshGpAudioUI) when a chart is present.
async function _stageAudio(file) {
    const iStatus = document.getElementById('editor-create-import-status');
    if (iStatus) iStatus.textContent = 'Uploading audio…';
    createState.audioUrl = null;
    createState.audioName = null;
    createState.audioDuration = null;
    createState.audioFile = null;
    const form = new FormData();
    form.append('file', file);
    let url = null, dur = null;
    try {
        const resp = await fetch('/api/plugins/editor/upload-audio', { method: 'POST', body: form });
        const data = await resp.json();
        if (data && data.audio_url) { url = data.audio_url; dur = data.duration; }
        else if (data && data.error && iStatus) iStatus.textContent = 'Error: ' + data.error;
    } catch (e) {
        if (iStatus) iStatus.textContent = 'Upload failed: ' + e.message;
    }
    if (url) {
        createState.audioUrl = url;
        createState.audioName = file.name;
        createState.audioDuration = (Number(dur) > 0) ? Number(dur) : null;
        // Keep the File itself so "Identify from audio" can re-POST the raw bytes
        // to core /identify (cross-plugin: the core can't read our stored copy).
        createState.audioFile = file;
        const titleEl = document.getElementById('editor-create-title');
        if (titleEl && !titleEl.value.trim()) titleEl.value = file.name.replace(/\.[^.]+$/, '');
        if (iStatus) iStatus.textContent = 'Master audio added.';
    }
    _refreshGpAudioUI();       // couple into GP auto-sync if a chart is present
    _syncYtFieldState();
    _updateIdentifyButton();
}

function _stageEofFiles(xmls) {
    createState.eofFiles = xmls.length ? xmls : null;
    createState.eofName = xmls.length === 1 ? xmls[0].name : (xmls.length + ' XML files');
    createState.mode = 'eof';
    // Chart slot is exclusive — EOF replaces GP. Audio untouched.
    createState.gpPath = null; createState.tracks = null; createState.gpName = null;
    document.getElementById('editor-create-tracks')?.classList.add('hidden');
    _refreshGpAudioUI();       // no gpPath → hides GP audio UI
    const iStatus = document.getElementById('editor-create-import-status');
    if (iStatus) iStatus.textContent = createState.eofName + ' added as the chart.';
}

// Stage a GoPlayAlong sync sidecar (.xml). It is NOT a chart — it carries the
// bar→audio sync for a separately-staged Guitar Pro file. Prefills title/artist
// from the <track> attributes and remembers the referenced score filename so we
// can nudge the user to add the matching .gp.
async function _stageGoplayalong(file) {
    createState.goplayalongFile = file;
    createState.goplayalongScore = '';
    try {
        const t = await file.text();
        const title = (t.match(/\btitle="([^"]*)"/i) || [])[1];
        const artist = (t.match(/\bartist="([^"]*)"/i) || [])[1];
        createState.goplayalongScore = (t.match(/<scoreUrl>\s*([^<]*?)\s*<\/scoreUrl>/i) || [])[1] || '';
        const titleEl = document.getElementById('editor-create-title');
        const artistEl = document.getElementById('editor-create-artist');
        if (titleEl && !titleEl.value.trim() && title) titleEl.value = title;
        if (artistEl && !artistEl.value.trim() && artist) artistEl.value = artist;
    } catch (_) { /* metadata prefill is best-effort */ }
    _refreshGpAudioUI();   // couple the staged master audio into the sync
    const iStatus = document.getElementById('editor-create-import-status');
    if (iStatus) {
        iStatus.textContent = createState.gpPath
            ? 'GoPlayAlong sync added — it will align the tab to your audio.'
            : ('GoPlayAlong sync added — now add its Guitar Pro file'
               + (createState.goplayalongScore ? ' (' + createState.goplayalongScore + ')' : '')
               + ' and the audio.');
    }
}

function _stageMidi(files) {
    createState.midiInfo = files.length === 1 ? files[0].name : (files.length + ' MIDI files');
    const iStatus = document.getElementById('editor-create-import-status');
    if (iStatus) iStatus.textContent = 'MIDI added — after Create, add Keys / Drums from it in the editor (+Keys / +Drums).';
}

// Grey the YouTube field while a master-audio FILE is staged (file wins).
function _syncYtFieldState() {
    const yt = document.getElementById('editor-create-yt-url');
    if (!yt) return;
    const hasFileAudio = !!(createState.audioUrl && createState.audioName);
    yt.disabled = hasFileAudio;
    yt.style.opacity = hasFileAudio ? '0.5' : '';
    yt.title = hasFileAudio ? 'Using the audio file you added — remove it to use a URL instead' : '';
}

// Render the staged file rows (audio master / chart / MIDI info), each with a
// role chip + remove ✕. This is the honesty surface.
function renderStaged() {
    const wrap = document.getElementById('editor-create-staged');
    if (!wrap) return;
    wrap.replaceChildren();
    const ytVal = ((document.getElementById('editor-create-yt-url')?.value) || '').trim();
    const rows = [];
    if (createState.audioUrl && createState.audioName) {
        rows.push({ role: 'audio', chip: 'Master audio', chipStyle: 'background:rgba(64,128,224,0.18);color:#8fbaff',
            name: createState.audioName, detail: createState.gpPath ? 'aligns the chart' : '' });
    } else if (ytVal) {
        rows.push({ role: 'yt', chip: 'Master audio · YouTube', chipStyle: 'background:rgba(64,128,224,0.18);color:#8fbaff',
            name: ytVal, detail: createState.gpPath ? 'aligns the chart' : '' });
    }
    if (createState.gpPath) {
        rows.push({ role: 'chart', chip: 'Chart · Guitar Pro', chipStyle: 'background:rgba(129,140,248,0.20);color:#c7d2fe',
            name: createState.gpName || 'Guitar Pro file', detail: createState.tracks ? (createState.tracks.length + ' tracks') : '' });
    } else if (createState.eofFiles && createState.eofFiles.length) {
        rows.push({ role: 'chart', chip: 'Chart · RS XML', chipStyle: 'background:rgba(129,140,248,0.20);color:#c7d2fe',
            name: createState.eofName || 'RS/EOF XML', detail: '' });
    }
    if (createState.goplayalongFile) {
        rows.push({ role: 'goplayalong', chip: 'Sync · GoPlayAlong', chipStyle: 'background:rgba(52,211,153,0.18);color:#6ee7b7',
            name: createState.goplayalongFile.name,
            detail: createState.gpPath ? 'aligns the tab' : 'add the Guitar Pro file' });
    }
    if (createState.midiInfo) {
        rows.push({ role: 'midi', chip: 'MIDI · adds after create', chipCls: 'bg-dark-600 text-gray-400',
            name: createState.midiInfo, detail: '' });
    }
    if (!rows.length) {
        const hint = document.createElement('div');
        hint.className = 'text-[11px] text-gray-600';
        hint.textContent = 'Nothing added yet — audio and/or a chart are optional.';
        wrap.appendChild(hint);
        return;
    }
    for (const r of rows) {
        const row = document.createElement('div');
        row.className = 'flex items-center gap-2 bg-dark-800 rounded px-2 py-1 text-xs';
        const chip = document.createElement('span');
        chip.className = 'px-1.5 py-0.5 rounded text-[10px] font-medium shrink-0 ' + (r.chipCls || '');
        if (r.chipStyle) chip.style.cssText = r.chipStyle;
        chip.textContent = r.chip;
        row.appendChild(chip);
        const name = document.createElement('span');
        name.className = 'text-gray-300 flex-1';
        name.style.cssText = 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
        name.textContent = r.name;
        row.appendChild(name);
        if (r.detail) {
            const d = document.createElement('span');
            d.className = 'text-gray-600 shrink-0';
            d.textContent = r.detail;
            row.appendChild(d);
        }
        const x = document.createElement('button');
        x.type = 'button';
        x.className = 'text-gray-500 hover:text-white shrink-0';
        x.textContent = '✕';
        x.title = 'Remove';
        x.onclick = () => window.editorStagedRemove(r.role);
        row.appendChild(x);
        wrap.appendChild(row);
    }
    // Honest one-liner: the preview clip is auto-made from the master audio (no
    // upload). Shown only when there IS a master audio to make it from.
    const hasMaster = !!(createState.audioUrl && createState.audioName)
        || !!((document.getElementById('editor-create-yt-url')?.value) || '').trim();
    if (hasMaster) {
        const pv = document.createElement('div');
        pv.className = 'text-[11px] text-gray-600';
        pv.textContent = 'Preview clip: auto-made from your master audio.';
        wrap.appendChild(pv);
    }
}

export function editorStagedRemove(role) {
    if (role === 'audio') {
        createState.audioUrl = null; createState.audioName = null; createState.audioDuration = null;
        createState.audioFile = null;
        _refreshGpAudioUI();        // un-couple: restore embedded/manual GP audio UI
        _syncYtFieldState();
        _updateIdentifyButton();
    } else if (role === 'yt') {
        const yt = document.getElementById('editor-create-yt-url'); if (yt) yt.value = '';
        _syncYtFieldState();
    } else if (role === 'chart') {
        createState.gpPath = null; createState.tracks = null; createState.eofFiles = null;
        createState.gpName = null; createState.eofName = null; createState.gpHasEmbedded = false;
        createState.lastSync = null; createState.autoSyncAudioUrl = null;
        document.getElementById('editor-create-tracks')?.classList.add('hidden');
        _refreshGpAudioUI();        // no gpPath → hides GP audio UI
    } else if (role === 'goplayalong') {
        createState.goplayalongFile = null; createState.goplayalongScore = '';
        createState.lastSync = null;        // drop any GoPlayAlong-derived sync
        _refreshGpAudioUI();
    } else if (role === 'midi') {
        createState.midiInfo = null;
    }
    const iStatus = document.getElementById('editor-create-import-status');
    if (iStatus) iStatus.textContent = '';
    renderStaged();
    updateCreateButton();
}

export function editorYtUrlInput() {
    // A YouTube URL is an alternative audio source (resolved at Create). It
    // doesn't gate the button (audio is optional) but should show in the list.
    _syncYtFieldState();
    renderStaged();
    updateCreateButton();
}

// ════════════════════════════════════════════════════════════════════
// MusicBrainz "Match…" — scan-first: uses the Title/Artist already on the form,
// opens a popup with an editable query + candidate list, and fills the details
// on pick. Reuses core's same-origin, rate-limited GET /api/enrichment/search.
// ════════════════════════════════════════════════════════════════════
function _cval(id) { return ((document.getElementById(id)?.value) || '').trim(); }

function _updateMbButton() {
    const btn = document.getElementById('editor-create-mb-btn');
    const hint = document.getElementById('editor-create-mb-hint');
    if (!btn) return;
    const has = !!(_cval('editor-create-title') || _cval('editor-create-artist'));
    btn.disabled = !has;
    if (hint) hint.textContent = has ? '' : 'Add a title or artist to match.';
}

export function editorMbMatch() {
    _editorMbOpenPopup(_cval('editor-create-title'), _cval('editor-create-artist'));
}

// "Identify from audio" is enabled once a master track is staged — it fingerprints
// THAT file, so it doesn't need a title/artist (that's the whole point: it's the
// reliable path when you don't know the metadata yet).
function _updateIdentifyButton() {
    const btn = document.getElementById('editor-create-identify-btn');
    if (!btn) return;
    const has = !!createState.audioFile;
    btn.disabled = !has;
    btn.title = has
        ? 'Identify the exact recording by fingerprinting your master audio'
        : 'Add master audio first to identify by fingerprint';
}

// Fingerprint the staged master audio → the EXACT MusicBrainz recording (AcoustID).
// Reliable where text search can't be (comp/live takes tie in MusicBrainz). The
// endpoint returns candidates in the SAME shape as /search, so the popup reuses
// the MB row + apply renderers.
export async function editorIdentifyAudio() {
    if (!createState.audioFile) return;
    document.getElementById('editor-mb-popup')?.remove();
    const modal = document.createElement('div');
    modal.id = 'editor-mb-popup';
    modal.className = 'fixed inset-0 bg-black/70 z-50 flex items-center justify-center';
    const inner = document.createElement('div');
    inner.className = 'bg-dark-800 border border-gray-700 rounded-xl w-full max-w-md mx-4 flex flex-col';
    inner.style.maxHeight = '75vh';
    const head = document.createElement('div');
    head.className = 'flex items-center justify-between px-4 py-3 border-b border-gray-700';
    const h = document.createElement('span'); h.className = 'text-sm font-medium'; h.textContent = 'Identify from audio';
    const close = document.createElement('button'); close.type = 'button'; close.className = 'text-gray-500 hover:text-white'; close.textContent = '×';
    close.onclick = () => modal.remove();
    head.appendChild(h); head.appendChild(close); inner.appendChild(head);
    const results = document.createElement('div');
    results.id = 'editor-mb-results';
    results.className = 'flex-1 overflow-y-auto p-2 space-y-1';
    inner.appendChild(results);
    modal.appendChild(inner);
    if (typeof _installModalKeyboard === 'function') _installModalKeyboard(modal, inner, () => modal.remove());
    document.body.appendChild(modal);
    _mbMsg(results, 'Fingerprinting your audio…');
    const form = new FormData();
    form.append('file', createState.audioFile);
    let data = null, status = 0;
    try {
        const resp = await fetch('/api/enrichment/identify', { method: 'POST', body: form });
        status = resp.status;
        data = await resp.json().catch(() => null);
    } catch (_) { data = null; }
    results.replaceChildren();
    // 412 = not set up (opt-in off / no key). Expand an inline enable + key form
    // right here (self-serve) — never fake a hit, and no separate settings trip.
    if (status === 412 || (data && data.needs_setup)) {
        _editorRenderAcoustidSetup(results);
        return;
    }
    if (status === 503) {
        // 503 here is usually a rejected key (AcoustID 400) or a transient
        // outage. Either way, let the user re-enter the key — don't dead-end.
        results.replaceChildren();
        const wrap = document.createElement('div'); wrap.className = 'p-3 space-y-2';
        const m = document.createElement('p'); m.className = 'text-xs text-gray-400';
        m.textContent = "Couldn't identify — the AcoustID key was rejected, or the service is "
            + "unreachable. Check the key (use your application's API key, not your account key), "
            + "or try again.";
        const change = document.createElement('button');
        change.type = 'button';
        change.className = 'px-3 py-1.5 rounded text-xs font-medium bg-dark-600 text-gray-200 hover:bg-dark-500';
        change.textContent = 'Change AcoustID key';
        change.onclick = () => _editorRenderAcoustidSetup(results);
        wrap.appendChild(m); wrap.appendChild(change); results.appendChild(wrap);
        return;
    }
    if (status === 429) { _mbMsg(results, 'AcoustID is busy — try again in a moment.'); return; }
    if (!data || data.error) { _mbMsg(results, "Couldn't identify this audio — try the text Match instead."); return; }
    const cands = data.candidates || [];
    if (!cands.length) { _mbMsg(results, 'No fingerprint match found — try the text Match instead.'); return; }
    // A fingerprint hit IS this recording, so flag the top row as matching the
    // audio and focus it; the user confirms by clicking.
    cands.forEach((c, i) => results.appendChild(_editorMbRow(c, i === 0, i === 0)));
}

// Inline "turn on audio identification" form, shown in the Identify popup when
// AcoustID is off / keyless (the 412 needs_setup state). Saves the user's own
// free key to core settings, then re-runs the fingerprint — self-serve, no
// separate settings screen (that UI is part of the library-metadata work).
function _editorRenderAcoustidSetup(el) {
    el.replaceChildren();
    const wrap = document.createElement('div'); wrap.className = 'p-3 space-y-2';
    const msg = document.createElement('p'); msg.className = 'text-xs text-gray-400';
    msg.textContent = 'Audio identification reads the recording itself — far more reliable than text '
        + 'search for picking the exact version. It needs your own free AcoustID key (one-time).';
    const link = document.createElement('a');
    link.href = 'https://acoustid.org/new-application'; link.target = '_blank'; link.rel = 'noopener';
    link.className = 'text-xs text-blue-400 hover:underline block';
    link.textContent = 'Register an application for a free key →';
    const hint = document.createElement('p'); hint.className = 'text-[11px] text-gray-600';
    hint.textContent = "Use the application's API key (from acoustid.org/my-applications) — not your account's user key.";
    const key = document.createElement('input');
    key.type = 'text'; key.placeholder = 'Paste your AcoustID API key';
    key.className = 'w-full bg-dark-900 border border-gray-700 rounded px-2 py-1 text-xs text-gray-300 outline-none focus:border-accent/50';
    const err = document.createElement('div'); err.className = 'text-[11px] text-red-400';
    const go = document.createElement('button');
    go.type = 'button'; go.className = 'px-3 py-1.5 rounded text-xs font-medium text-white';
    go.style.background = '#2563eb'; go.textContent = 'Enable & identify';
    const submit = async () => {
        const k = key.value.trim();
        if (!k) { err.textContent = 'Paste your key first.'; return; }
        go.disabled = true; err.textContent = ''; go.textContent = 'Saving…';
        let ok = false;
        try {
            const r = await fetch('/api/settings', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ acoustid_enabled: true, acoustid_api_key: k }),
            });
            const d = await r.json().catch(() => null);
            ok = r.ok && !(d && d.error);
            if (!ok && d && d.error) err.textContent = d.error;
        } catch (_) {}
        if (ok) { window.editorIdentifyAudio(); }   // re-open + run the fingerprint
        else { go.disabled = false; go.textContent = 'Enable & identify'; if (!err.textContent) err.textContent = "Couldn't save the key."; }
    };
    go.onclick = submit;
    key.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
    wrap.appendChild(msg); wrap.appendChild(link); wrap.appendChild(hint); wrap.appendChild(key); wrap.appendChild(err); wrap.appendChild(go);
    el.appendChild(wrap);
    setTimeout(() => { try { key.focus(); } catch (_) {} }, 0);
}

function _editorMbOpenPopup(title, artist) {
    document.getElementById('editor-mb-popup')?.remove();
    const modal = document.createElement('div');
    modal.id = 'editor-mb-popup';
    modal.className = 'fixed inset-0 bg-black/70 z-50 flex items-center justify-center';
    const inner = document.createElement('div');
    inner.className = 'bg-dark-800 border border-gray-700 rounded-xl w-full max-w-md mx-4 flex flex-col';
    inner.style.maxHeight = '75vh';
    const head = document.createElement('div');
    head.className = 'flex items-center justify-between px-4 py-3 border-b border-gray-700';
    const h = document.createElement('span'); h.className = 'text-sm font-medium'; h.textContent = 'Match on MusicBrainz';
    const close = document.createElement('button'); close.type = 'button'; close.className = 'text-gray-500 hover:text-white'; close.textContent = '×';
    close.onclick = () => modal.remove();
    head.appendChild(h); head.appendChild(close); inner.appendChild(head);
    // STRUCTURED Artist + Title fields — MusicBrainz's recording search is built
    // for these; cramming both into one fuzzy field returns junk (or nothing).
    const qrow = document.createElement('div');
    qrow.className = 'flex items-center gap-2 px-4 py-2 border-b border-gray-700';
    const mk = (ph, val) => {
        const i = document.createElement('input');
        i.type = 'text'; i.placeholder = ph; i.value = val || '';
        i.className = 'flex-1 min-w-0 bg-dark-900 border border-gray-700 rounded px-2 py-1 text-xs text-gray-300 outline-none focus:border-accent/50';
        return i;
    };
    const aIn = mk('Artist', artist);
    const tIn = mk('Title', title);
    const go = document.createElement('button');
    go.type = 'button'; go.className = 'px-2 py-1 rounded text-xs font-medium bg-dark-600 text-gray-300 hover:bg-dark-500 shrink-0';
    go.textContent = 'Search';
    qrow.appendChild(aIn); qrow.appendChild(tIn); qrow.appendChild(go); inner.appendChild(qrow);
    const results = document.createElement('div');
    results.id = 'editor-mb-results';
    results.className = 'flex-1 overflow-y-auto p-2 space-y-1';
    inner.appendChild(results);
    modal.appendChild(inner);
    if (typeof _installModalKeyboard === 'function') _installModalKeyboard(modal, inner, () => modal.remove());
    document.body.appendChild(modal);
    const run = () => _editorMbRunSearch(aIn.value.trim(), tIn.value.trim(), results);
    go.onclick = run;
    const onEnter = (e) => { if (e.key === 'Enter') { e.preventDefault(); run(); } };
    aIn.addEventListener('keydown', onEnter); tIn.addEventListener('keydown', onEnter);
    run();
}

// Blend our match score with a duration-to-staged-audio bonus. The master audio
// IS the version the user wants to chart, so a length match is a strong signal
// that separates the studio take from live/extended cuts.
function _mbRankKey(c, dur) {
    let k = Number(c.score) || 0;
    if (dur > 0 && Number(c.duration)) {
        const diff = Math.abs(Number(c.duration) - dur);
        if (diff <= 4) k += 0.5;
        else if (diff <= 12) k += 0.2;
        else k -= Math.min(diff, 120) / 400;
    }
    return k;
}

async function _editorMbRunSearch(artist, title, resultsEl) {
    if (!resultsEl) return;
    resultsEl.replaceChildren();
    if (!artist && !title) { _mbMsg(resultsEl, 'Enter an artist or title to search.'); return; }
    _mbMsg(resultsEl, 'Searching MusicBrainz…');
    const params = new URLSearchParams();
    if (artist) params.set('artist', artist);
    if (title) params.set('title', title);
    // Fetch the max (25): a non-title-track studio recording can sit well down
    // MusicBrainz's flat list (dozens of comp/reissue takes score identically),
    // so a small limit drops it entirely and the duration re-rank has nothing to
    // promote. Verified: Judas Priest "Living After Midnight" — the 1980 British
    // Steel take is absent at 15 but present (and #1 after duration) at 25.
    params.set('limit', '25');
    // Pass the staged master audio's length so the server can corroborate too
    // (harmless if the core doesn't consume it; the client re-rank below is the
    // load-bearing path today).
    if (Number(createState.audioDuration) > 0) params.set('duration', String(Math.round(createState.audioDuration)));
    let data = null, status = 0;
    try {
        const resp = await fetch('/api/enrichment/search?' + params.toString());
        status = resp.status;
        data = await resp.json().catch(() => null);
    } catch (_) { data = null; }
    resultsEl.replaceChildren();
    if (status === 429) { _mbMsg(resultsEl, 'MusicBrainz is busy — try again in a moment.'); return; }
    if (status === 503 || (data && data.error)) { _mbMsg(resultsEl, "Couldn't reach MusicBrainz. Enter details manually."); return; }
    let cands = (data && data.candidates) || [];
    if (!cands.length) { _mbMsg(resultsEl, 'No matches — refine the artist/title and try again.'); return; }
    // #2 — re-rank by closeness of each candidate's length to the staged audio.
    const dur = Number(createState.audioDuration) || 0;
    let bestIdx = -1;
    if (dur > 0) {
        cands = cands.slice().sort((a, b) => _mbRankKey(b, dur) - _mbRankKey(a, dur));
        let bestDiff = Infinity;
        cands.forEach((c, i) => {
            const d = Math.abs((Number(c.duration) || 1e9) - dur);
            if (d <= 4 && d < bestDiff) { bestDiff = d; bestIdx = i; }
        });
    }
    cands.forEach((c, i) => resultsEl.appendChild(_editorMbRow(c, i === 0, i === bestIdx)));
}

function _mbMsg(el, text) {
    const d = document.createElement('div'); d.className = 'text-xs text-gray-500 p-2'; d.textContent = text; el.appendChild(d);
}

function _mbDur(sec) {
    const s = Number(sec); if (!s || s <= 0) return '';
    const m = Math.floor(s / 60), r = Math.round(s % 60);
    return m + ':' + String(r).padStart(2, '0');
}

function _editorMbRow(c, focus, matchesAudio) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'w-full text-left px-2 py-1.5 rounded hover:bg-dark-600 flex items-center gap-2';
    const col = document.createElement('span'); col.className = 'flex-1'; col.style.minWidth = '0';
    const t = document.createElement('span'); t.className = 'text-xs text-gray-200 block';
    t.style.cssText = 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap'; t.textContent = c.title || '(untitled)';
    const sub = document.createElement('span'); sub.className = 'text-[11px] text-gray-500 block';
    sub.style.cssText = 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
    sub.textContent = [c.artist, c.album, c.year, _mbDur(c.duration)].filter(Boolean).join(' · ');
    col.appendChild(t); col.appendChild(sub); b.appendChild(col);
    // "≈ your audio" tag — this candidate's length matches the staged master.
    if (matchesAudio) {
        const m = document.createElement('span');
        m.className = 'px-1.5 py-0.5 rounded text-[10px] font-medium shrink-0';
        m.style.cssText = 'background:rgba(64,128,224,0.18);color:#8fbaff';
        m.textContent = '≈ your audio';
        b.appendChild(m);
    }
    // Confidence pill — green only when earned.
    let score = Number(c.mb_score) || 0; if (score <= 1) score = Math.round(score * 100);
    const pill = document.createElement('span');
    pill.className = 'px-1.5 py-0.5 rounded text-[10px] font-medium shrink-0';
    if (score >= 90) { pill.textContent = 'High'; pill.style.cssText = 'background:rgba(22,163,74,0.22);color:#86efac'; }
    else if (score >= 60) { pill.textContent = 'Good'; pill.style.cssText = 'background:rgba(245,158,11,0.16);color:#fcd34d'; }
    else { pill.textContent = 'Low'; pill.style.cssText = 'background:#2c3040;color:#9aa0ad'; }
    b.appendChild(pill);
    b.onclick = () => _editorMbApply(c);
    if (focus) setTimeout(() => { try { b.focus(); } catch (_) {} }, 0);
    return b;
}

function _editorMbApply(c) {
    // Explicit pick = overwrite (deferring to a stale filename-title would be
    // wrong). Only set fields MB actually has; leave the rest untouched.
    const set = (id, v) => { const el = document.getElementById(id); if (el && v != null && String(v).trim() !== '') el.value = String(v).trim(); };
    set('editor-create-title', c.title);
    set('editor-create-artist', c.artist);
    set('editor-create-album', c.album);
    set('editor-create-year', c.year);
    set('editor-create-isrc', c.isrc);
    set('editor-create-mbid', c.recording_id);
    if (Array.isArray(c.genres) && c.genres.length) set('editor-create-genre', c.genres.join(', '));
    const note = document.getElementById('editor-create-autofill-note');
    if (note) note.textContent = (c.source === 'acoustid')
        ? 'Filled from an audio fingerprint (AcoustID) — edit anything.'
        : 'Filled from MusicBrainz — edit anything.';
    document.getElementById('editor-mb-popup')?.remove();
    _updateMbButton();
    updateCreateButton();
}

// Album art: preview locally + upload to get an art_path baked into create.
export async function editorCreateArtSelected(input) {
    const file = input.files && input.files[0];
    const prev = document.getElementById('editor-create-art-preview');
    if (!file) {
        createState.artPath = null;
        if (prev) { prev.style.backgroundImage = ''; prev.textContent = 'No art yet'; }
        return;
    }
    try {
        const rd = new FileReader();
        rd.onload = () => { if (prev) { prev.style.backgroundImage = 'url("' + rd.result + '")'; prev.textContent = ''; } };
        rd.readAsDataURL(file);
    } catch (_) { /* preview is best-effort */ }
    const form = new FormData();
    form.append('file', file);
    try {
        const resp = await fetch('/api/plugins/editor/upload-art', { method: 'POST', body: form });
        const data = await resp.json();
        if (data && data.art_path) createState.artPath = data.art_path;
    } catch (_) { /* art just won't be baked if the upload fails */ }
}

// ════════════════════════════════════════════════════════════════════
// Album-art picker — a Plex-style grid of covers from the Cover Art Archive.
// Reuses the MusicBrainz search to get candidate release MBIDs, then shows one
// tile per release's CAA front cover (served same-origin via the editor plugin,
// so it loads under the app's CSP). Pick one → baked as the pack's art.
// ════════════════════════════════════════════════════════════════════
export function editorArtSearch() {
    // Art is an ALBUM property, so search by the album when we know it (filled by
    // a MusicBrainz Match, or typed) — falling back to the title. This is why
    // Match-first works: it fills the album, which pins the canonical cover.
    const album = _cval('editor-create-album');
    const title = _cval('editor-create-title');
    _editorArtOpenPopup(_cval('editor-create-artist'), album || title);
}

function _editorArtOpenPopup(artist, query) {
    document.getElementById('editor-art-popup')?.remove();
    const modal = document.createElement('div');
    modal.id = 'editor-art-popup';
    modal.className = 'fixed inset-0 bg-black/70 z-50 flex items-center justify-center';
    const inner = document.createElement('div');
    inner.className = 'bg-dark-800 border border-gray-700 rounded-xl w-full max-w-lg mx-4 flex flex-col';
    inner.style.maxHeight = '80vh';
    const head = document.createElement('div');
    head.className = 'flex items-center justify-between px-4 py-3 border-b border-gray-700';
    const h = document.createElement('span'); h.className = 'text-sm font-medium'; h.textContent = 'Choose album art';
    const close = document.createElement('button'); close.type = 'button'; close.className = 'text-gray-500 hover:text-white'; close.textContent = '×';
    close.onclick = () => modal.remove();
    head.appendChild(h); head.appendChild(close); inner.appendChild(head);
    const qrow = document.createElement('div');
    qrow.className = 'flex items-center gap-2 px-4 py-2 border-b border-gray-700';
    const mk = (ph, val) => {
        const i = document.createElement('input');
        i.type = 'text'; i.placeholder = ph; i.value = val || '';
        i.className = 'flex-1 min-w-0 bg-dark-900 border border-gray-700 rounded px-2 py-1 text-xs text-gray-300 outline-none focus:border-accent/50';
        return i;
    };
    const aIn = mk('Artist', artist);
    const tIn = mk('Album (or song)', query);
    const go = document.createElement('button');
    go.type = 'button'; go.className = 'px-2 py-1 rounded text-xs font-medium bg-dark-600 text-gray-300 hover:bg-dark-500 shrink-0';
    go.textContent = 'Search';
    qrow.appendChild(aIn); qrow.appendChild(tIn); qrow.appendChild(go); inner.appendChild(qrow);
    const grid = document.createElement('div');
    grid.id = 'editor-art-grid';
    grid.className = 'flex-1 overflow-y-auto p-3';
    grid.style.cssText = 'display:grid;grid-template-columns:repeat(3,1fr);gap:8px;';
    inner.appendChild(grid);
    modal.appendChild(inner);
    if (typeof _installModalKeyboard === 'function') _installModalKeyboard(modal, inner, () => modal.remove());
    document.body.appendChild(modal);
    const run = () => _editorArtRunSearch(aIn.value.trim(), tIn.value.trim(), grid);
    go.onclick = run;
    const onEnter = (e) => { if (e.key === 'Enter') { e.preventDefault(); run(); } };
    aIn.addEventListener('keydown', onEnter); tIn.addEventListener('keydown', onEnter);
    run();
}

function _editorArtMsg(grid, text) {
    const d = document.createElement('div');
    d.className = 'text-xs text-gray-500 p-2';
    d.style.gridColumn = '1 / -1';
    d.textContent = text;
    grid.appendChild(d);
}

async function _editorArtRunSearch(artist, query, grid) {
    grid.replaceChildren();
    if (!artist && !query) { _editorArtMsg(grid, 'Enter an artist and album (or song).'); return; }
    _editorArtMsg(grid, 'Searching for covers…');
    // ALBUM-centric: MusicBrainz release-groups reliably tell studio Album from
    // Live/Compilation, so the canonical album cover comes first.
    let tiles = [];
    try {
        const p = new URLSearchParams();
        if (artist) p.set('artist', artist);
        if (query) p.set('query', query);
        const r = await fetch('/api/plugins/editor/cover-search?' + p.toString());
        const d = await r.json().catch(() => null);
        tiles = ((d && d.covers) || []).map(c => ({
            id: c.id, group: true, studio: c.studio,
            label: c.year ? (c.title + ' (' + c.year + ')') : c.title,
        }));
    } catch (_) { /* fall through to the recording-based fallback */ }
    // Fallback (e.g. a non-title-track searched art-first with no album): the
    // recording search's per-release covers — less canonical, but something.
    if (!tiles.length) {
        try {
            const p2 = new URLSearchParams();
            if (artist) p2.set('artist', artist);
            if (query) p2.set('title', query);
            p2.set('limit', '15');
            const r2 = await fetch('/api/enrichment/search?' + p2.toString());
            const d2 = await r2.json().catch(() => null);
            const seen = new Set();
            for (const c of ((d2 && d2.candidates) || [])) {
                const rid = c && c.release_id;
                if (rid && !seen.has(rid)) { seen.add(rid); tiles.push({ id: rid, group: false, label: c.album || c.title || '' }); }
            }
        } catch (_) { /* nothing else to try */ }
    }
    grid.replaceChildren();
    if (!tiles.length) { _editorArtMsg(grid, 'No covers found — add the album name, or run Match first.'); return; }
    const hint = document.createElement('div');
    hint.className = 'text-[11px] text-gray-600 pb-1'; hint.style.gridColumn = '1 / -1';
    hint.textContent = 'Studio album first · covers with no art are hidden · click to use.';
    grid.appendChild(hint);
    for (const t of tiles) grid.appendChild(_editorArtTile(t));
}

function _editorArtTile(t) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'rounded overflow-hidden border border-gray-700 hover:border-accent bg-dark-900 text-left';
    btn.style.cssText = 'display:flex;flex-direction:column;';
    const q = t.group ? '?group=1' : '';
    const img = document.createElement('img');
    img.src = '/api/plugins/editor/caa-cover/' + encodeURIComponent(t.id) + q;
    img.alt = t.label;
    img.loading = 'lazy';
    img.style.cssText = 'width:100%;aspect-ratio:1/1;object-fit:cover;display:block;background:#15161c;';
    // 404 (no art for this release) → hide the whole tile.
    img.onerror = () => { btn.style.display = 'none'; };
    const cap = document.createElement('span');
    cap.className = 'text-[10px] text-gray-400 px-1 py-0.5';
    cap.style.cssText = 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
    cap.textContent = t.label;
    btn.appendChild(img); btn.appendChild(cap);
    btn.onclick = () => _editorPickCaaCover(t.id, t.group);
    return btn;
}

async function _editorPickCaaCover(id, group) {
    const q = group ? '?group=1' : '';
    try {
        const resp = await fetch('/api/plugins/editor/use-caa-cover', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ release_id: id, group: !!group }),
        });
        const data = await resp.json().catch(() => null);
        if (!resp.ok || !data || !data.art_path) return;
        createState.artPath = data.art_path;
        const prev = document.getElementById('editor-create-art-preview');
        if (prev) {
            prev.style.backgroundImage = 'url("/api/plugins/editor/caa-cover/' + encodeURIComponent(id) + q + '")';
            prev.textContent = '';
        }
    } catch (_) { /* leave art unset on failure */ }
    document.getElementById('editor-art-popup')?.remove();
}

// UNREACHABLE, both of these, and now also SUPERSEDED. `_populateCreateArrButtons`
// is called only by itself (a re-render on click) and `_populateStringCountButtons`
// only by it, so nothing outside the pair ever enters them.
//
// They pick a single initial arrangement and a string count. The roster chips do
// the first properly (one arrangement per role), and the server chooses string
// counts itself — "String counts are NOT chosen here", says create_sloppak; a
// fretted role gets a default tuning and the editor extends the range afterwards.
// They also read and write `createState.initialArr`, which now has no reader at
// all: the payload sends `arrangements` (Copilot, #173).
//
// Left in place rather than deleted, because deleting them is a separate change
// from the bug fix that made them redundant. They arrived with the same
// half-wired Create-New redesign (977ec65, #45).
function _populateCreateArrButtons() {
    const wrap = document.getElementById('editor-create-arr-buttons');
    if (!wrap) return;
    wrap.replaceChildren();
    // Functional roster + Vocals shown-but-disabled: the editor has no vocals
    // edit mode yet, so offering it would create a pack you can't edit — an
    // honest "coming" rung rather than a false one.
    const roster = [
        { name: 'Lead' }, { name: 'Rhythm' }, { name: 'Bass' },
        { name: 'Keys' }, { name: 'Drums' },
        { name: 'Vocals', disabled: true,
          title: 'Vocals editing is coming — the editor has no vocals mode yet.' },
    ];
    const enabled = roster.filter(r => !r.disabled).map(r => r.name);
    if (!enabled.includes(createState.initialArr)) createState.initialArr = 'Lead';
    for (const r of roster) {
        const b = document.createElement('button');
        b.type = 'button';
        b.dataset.arr = r.name;
        b.textContent = r.name;
        if (r.title) b.title = r.title;
        if (r.disabled) {
            b.disabled = true;
            b.className = 'px-2 py-1 rounded text-xs font-medium bg-dark-700 text-gray-600 cursor-not-allowed';
        } else {
            b.className = 'px-2 py-1 rounded text-xs font-medium '
                + (r.name === createState.initialArr
                    ? 'bg-accent text-white'
                    : 'bg-dark-600 text-gray-300 hover:bg-dark-500');
            b.onclick = () => {
                createState.initialArr = r.name;
                // Reset to the role's DEFAULT string count for a fresh fretted
                // pick (Bass 4, guitar 6); Keys/Drums have none.
                if (_isFrettedRole(r.name)) {
                    createState.stringCount = _createRoleDefaultStrings(r.name);
                }
                _populateCreateArrButtons();
                _populateStringCountButtons();
            };
        }
        wrap.appendChild(b);
    }
}

function _populateStringCountButtons() {
    const row = document.getElementById('editor-create-strings-row');
    const wrap = document.getElementById('editor-create-strings-buttons');
    // Hide the whole Strings row for Keys/Drums (no strings).
    if (row) row.classList.toggle('hidden', !_isFrettedRole(createState.initialArr));
    if (!wrap) return;
    wrap.replaceChildren();
    if (!_isFrettedRole(createState.initialArr)) return;
    const opts = _createRoleStringOptions(createState.initialArr);
    if (!opts.includes(createState.stringCount)) createState.stringCount = opts[0];
    for (const n of opts) {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = n + '-string';
        b.className = 'px-2 py-1 rounded text-xs font-medium '
            + (n === createState.stringCount
                ? 'bg-accent text-white'
                : 'bg-dark-600 text-gray-300 hover:bg-dark-500');
        b.onclick = () => { createState.stringCount = n; _populateStringCountButtons(); };
        wrap.appendChild(b);
    }
}

// The Blank/Guitar Pro/EOF segmented toggle was removed — the create modal is
// now one menu with every option visible, and editorDoCreate() routes on what
// the user provided. `createState.mode` is still tracked (derived from file
// selection in editorGPFileSelected / editorEofFilesSelected) for any callers
// that pass an explicit mode; this setter just records it and re-gates. It no
// longer hides sections or re-labels the button.
export function editorSetCreateMode(mode) {
    if (!['blank', 'gp', 'eof'].includes(mode)) mode = 'blank';
    createState.mode = mode;
    updateCreateButton();
}

// Re-gate the Create button as the user types, and dismiss the one-time autofill
// note once they edit an autofilled field. That is all this listener does — the
// cached-upload-URL invalidation an older version of this comment described
// happens in the audio file/URL change handlers, which clear createState.audioUrl
// directly (editorDoCreate only re-uploads when audioUrl is unset).
//
// Wired by main.js's init(), not at import: a module must have no side effects
// when it is loaded, or its unit tests cannot import it without a DOM.
export function initCreate() {
    host.addGlobalListener(document, 'input', (e) => {
        const id = e.target && e.target.id;
        // The from-scratch gate depends on the title; the Match button on title OR
        // artist. updateCreateButton re-checks both (it calls _updateMbButton).
        if (id === 'editor-create-title' || id === 'editor-create-artist') updateCreateButton();
        // Editing an autofilled field dismisses the one-time autofill note.
        if (id === 'editor-create-title' || id === 'editor-create-artist' || id === 'editor-create-album') {
            const note = document.getElementById('editor-create-autofill-note');
            if (note) note.textContent = '';
        }
    });
}


export function editorSetGP8AudioMode(mode) {
    createState.gp8AudioMode = mode;
    const embBtn = document.getElementById('editor-gp8-btn-embedded');
    const uplBtn = document.getElementById('editor-gp8-btn-upload');
    const syncSec = document.getElementById('editor-autosync-section');
    // 'upload' and 'autosync' are both the manual-audio path — treat identically
    const isManual = (mode === 'upload' || mode === 'autosync');
    if (embBtn) embBtn.className = mode === 'embedded'
        ? 'px-2 py-1 rounded text-xs font-medium bg-accent text-white'
        : 'px-2 py-1 rounded text-xs font-medium bg-dark-600 text-gray-300 hover:bg-dark-500';
    if (uplBtn) uplBtn.className = isManual
        ? 'px-2 py-1 rounded text-xs font-medium bg-accent text-white'
        : 'px-2 py-1 rounded text-xs font-medium bg-dark-600 text-gray-300 hover:bg-dark-500';
    if (syncSec) syncSec.classList.toggle('hidden', mode === 'embedded');
}

export async function editorAutoSyncAudioSelected(input) {
    if (!input.files.length) return;
    const file = input.files[0];
    const status = document.getElementById('editor-autosync-status');
    if (status) status.textContent = 'Uploading audio...';
    const form = new FormData();
    form.append('file', file);
    try {
        const resp = await fetch('/api/plugins/editor/upload-audio', { method: 'POST', body: form });
        const data = await resp.json();
        if (data.error) { if (status) status.textContent = 'Upload failed: ' + data.error; return; }
        _setAutoSyncSource(data.audio_url, file.name);
    } catch (e) {
        if (status) status.textContent = 'Upload failed: ' + e.message;
    }
}

// Record a new auto-sync audio source (file upload or YouTube download).
// Clears any previous sync result so editorDoCreate() re-runs autosync
// rather than reusing a stale result from a prior audio source.
function _setAutoSyncSource(audioUrl, label) {
    createState.autoSyncAudioUrl = audioUrl;
    createState.gp8AudioMode = 'autosync';
    createState.lastSync = null;
    const _rr = document.getElementById('editor-refine-row');
    if (_rr) _rr.classList.add('hidden');
    const status = document.getElementById('editor-autosync-status');
    if (status) status.textContent = `✓ ${label} ready for auto-sync`;
}

// POST refine-sync for the current lastSync/audio/GP state and merge the
// refined points back into createState.lastSync. Shared by the automatic
// refine in editorDoCreate and the manual Refine button so the two can't
// drift apart. Returns the response data (or null on network failure).
async function _requestRefineSync(barsPerPoint) {
    try {
        const resp = await fetch('/api/plugins/editor/refine-sync', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                audio_url: createState.autoSyncAudioUrl,
                audio_offset: createState.lastSync.audio_offset,
                sync_points: createState.lastSync.sync_points || [],
                bars_per_point: barsPerPoint,
                // Lets the server refine on exact per-bar score times
                // (odd meters, mid-song tempo changes) instead of a 4/4
                // approximation rebuilt from the points alone.
                gp_path: createState.gpPath || '',
            }),
        });
        const data = await resp.json();
        if (data.ok) {
            createState.lastSync = { ...createState.lastSync, ...data };
        }
        return data;
    } catch (e) {
        return null;
    }
}

// Download a YouTube URL as the auto-sync audio source. Same downstream
// state as editorAutoSyncAudioSelected — the fetched audio becomes both the
// alignment target and the imported song audio.
export async function editorAutoSyncYtFetch() {
    const urlInput = document.getElementById('editor-autosync-yt-url');
    const url = (urlInput?.value || '').trim();
    const status = document.getElementById('editor-autosync-status');
    if (!url) {
        if (status) status.textContent = 'Enter a YouTube URL first.';
        return;
    }
    const btn = document.getElementById('editor-autosync-yt-btn');
    if (btn) btn.disabled = true;
    if (status) status.textContent = 'Downloading audio from YouTube...';
    try {
        const resp = await fetch('/api/plugins/editor/youtube-audio', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url }),
        });
        const data = await resp.json();
        if (data.error) {
            if (status) status.textContent = 'Download failed: ' + data.error;
            return;
        }
        _setAutoSyncSource(data.audio_url, data.title || 'YouTube audio');
    } catch (e) {
        if (status) status.textContent = 'Download failed: ' + e.message;
    } finally {
        if (btn) btn.disabled = false;
    }
}

export async function editorRefineSync() {
    if (!createState.lastSync || !createState.autoSyncAudioUrl) return;
    const barsPerPoint = Math.max(1, parseInt(document.getElementById('editor-refine-bars').value) || 8);
    const status = document.getElementById('editor-refine-status');
    const btn = document.getElementById('editor-refine-btn');
    if (status) status.textContent = 'Refining...';
    if (btn) btn.disabled = true;
    try {
        const data = await _requestRefineSync(barsPerPoint);
        if (!data) {
            if (status) status.textContent = 'Error: refine request failed';
        } else if (data.error) {
            if (status) status.textContent = `Failed: ${data.error}`;
        } else {
            if (status) status.textContent = `✓ ${data.sync_point_count} points refined, offset ${(data.audio_offset ?? 0).toFixed(3)}s`;
        }
    } finally {
        if (btn) btn.disabled = false;
    }
}

// NOTE: main.js contained TWO `_editorDoBlankCreate` definitions. Inside its
// IIFE that is legal — function declarations hoist, and the LAST one in source
// order silently wins — so the one deleted here (added by the Create-New
// redesign, #45) never ran. The one kept below is the one that has actually
// been executing, from the earlier "restore audio-only project creation" fix.
//
// This file is a module, where a duplicate declaration is a SyntaxError, which
// is how the collision surfaced at all. Behaviour is preserved exactly: the
// dead definition is removed, not promoted. Restoring its intent (roster
// validation, and audio optional for a draft-now project) is a product change
// and belongs in its own PR.
export async function editorDoCreate() {
    // One menu, no mode toggle — route on what was provided: a Guitar Pro file
    // wins, then EOF XML arrangement(s), else a from-scratch (draft) create
    // (only a title is required; audio + artist are optional).
    if (!createState.gpPath) {
        if (createState.eofFiles && createState.eofFiles.length) {
            await _editorDoEofCreate();
        } else {
            await _editorDoBlankCreate();
        }
        return;
    }
    const status = document.getElementById('editor-create-status');
    const btn = document.getElementById('editor-create-go');
    btn.disabled = true;

    // 'upload' (user clicked "Supply own audio") and 'autosync' are the same
    // manual-audio path — the auto-sync uploader provides createState
    // .autoSyncAudioUrl for both. Normalise so the offset/audio_url/skip logic
    // below doesn't treat a not-yet-flipped 'upload' as a no-audio import.
    let _gpAudioMode = (createState.gp8AudioMode === 'upload')
        ? 'autosync' : (createState.gp8AudioMode || 'none');

    // Upload/download the Step-2 audio first — but only in modes where it's the
    // source of truth. In embedded mode the GP8 OGG is extracted server-side,
    // and in autosync mode the audio came from the auto-sync uploader, so a
    // stale/invalid Step-2 value must not block (or be downloaded for) the
    // import.
    if (_gpAudioMode !== 'embedded' && _gpAudioMode !== 'autosync') {
        // Audio (a Content Import file already uploaded, or a pasted YouTube URL)
        // is optional for a GP import; attach it when present.
        if (_createHasAudioInput() && !createState.audioUrl) {
            const ok = await uploadCreateAudio();
            if (!ok) { btn.disabled = false; return; }
            // A pasted YouTube URL is master audio just like a staged file — but
            // file audio couples into autosync on selection (via
            // _refreshGpAudioUI), while a URL only resolves here at Create. Now
            // that it's resolved, re-derive the GP audio UI so the chart
            // auto-syncs to it, and recompute the mode so the autosync path
            // below runs — otherwise the audio is attached UNALIGNED.
            _refreshGpAudioUI();
            _gpAudioMode = (createState.gp8AudioMode === 'upload')
                ? 'autosync' : (createState.gp8AudioMode || 'none');
        }
    }

    // Get selected track indices
    const checkboxes = document.querySelectorAll('#editor-create-track-list input[type=checkbox]:checked:not(:disabled)');
    const trackIndices = [...checkboxes].map(cb => parseInt(cb.value));

    // Auto-sync: align tab to audio before conversion if user supplied audio.
    // Only carry a prior sync offset forward in autosync mode — in embedded /
    // manual modes a leftover lastSync offset would be sent to convert-gp (and
    // in embedded mode would override the GP8 FramePadding-derived offset),
    // misaligning the import.
    let _autoSyncOffset = _gpAudioMode === 'autosync'
        ? (createState.lastSync?.audio_offset ?? null)
        : null;
    // "Supply own audio" was chosen but no audio file was uploaded — don't
    // silently import with no audio; prompt the user to pick a file (or switch
    // back to embedded/MIDI).
    if (_gpAudioMode === 'autosync' && !createState.autoSyncAudioUrl) {
        status.textContent = 'Select an audio file for auto-sync, or choose a different audio option.';
        btn.disabled = false;
        return;
    }
    // GoPlayAlong authored sync (gated on goplayalongFile so normal imports are
    // untouched): use the sidecar's per-bar points instead of onset detection.
    // Populates createState.lastSync exactly like autosync-gp does, so the
    // convert step below sends the same sync_points to convert-gp — no onset
    // refine (the authored points are already per-bar accurate).
    if (_gpAudioMode === 'autosync' && createState.goplayalongFile
            && createState.autoSyncAudioUrl && _autoSyncOffset === null) {
        status.textContent = 'Applying GoPlayAlong sync…';
        try {
            const gForm = new FormData();
            gForm.append('file', createState.goplayalongFile);
            const gResp = await fetch('/api/plugins/editor/parse-goplayalong-sync', { method: 'POST', body: gForm });
            const gData = await gResp.json();
            if (gData.ok && gData.sync_points && gData.sync_points.length) {
                _autoSyncOffset = gData.audio_offset;
                createState.lastSync = gData;
                createState.lastSync.audio_offset = _autoSyncOffset;
                const _goBtn = document.getElementById('editor-create-go');
                if (_goBtn) {
                    _goBtn.disabled = false;
                    _goBtn.removeAttribute('aria-disabled');
                    _goBtn.textContent = 'Import & Open in Editor';
                    _goBtn.focus();
                }
                status.textContent = `✓ GoPlayAlong sync: ${gData.sync_point_count} points, offset ${(_autoSyncOffset ?? 0).toFixed(3)}s — click Import to apply.`;
                return;   // click Import again → convert with these points (matches the autosync UX)
            }
            status.textContent = 'GoPlayAlong sync failed: ' + (gData.error || 'no sync points found')
                + '. Remove the sync file (✕) to import without it.';
            btn.disabled = false;
            return;
        } catch (e) {
            status.textContent = 'GoPlayAlong sync request failed: ' + e.message
                + '. Remove the sync file (✕) to import without it.';
            btn.disabled = false;
            return;
        }
    }

    if (_gpAudioMode === 'autosync' && createState.autoSyncAudioUrl && _autoSyncOffset === null) {
        status.textContent = 'Auto-syncing tab to audio (~10s)...';
        try {
            const syncResp = await fetch('/api/plugins/editor/autosync-gp', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    gp_path: createState.gpPath,
                    audio_url: createState.autoSyncAudioUrl,
                }),
            });
            const syncData = await syncResp.json();
            if (syncData.ok) {
                _autoSyncOffset = syncData.audio_offset;
                createState.lastSync = syncData;
                createState.lastSync.audio_offset = _autoSyncOffset;
                // Immediately refine the coarse DTW points with the onset
                // phase sweep — the DTW pass alone is only accurate to its
                // analysis-frame size (~190ms), which is audibly out of
                // sync. Refine failure is non-fatal: coarse points still
                // beat a scalar offset, so keep them and continue.
                status.textContent = 'Refining sync to per-bar accuracy...';
                const refData = await _requestRefineSync(
                    Math.max(1, parseInt(document.getElementById('editor-refine-bars')?.value) || 8));
                if (refData?.ok) {
                    _autoSyncOffset = refData.audio_offset;
                    createState.lastSync.audio_offset = _autoSyncOffset;
                }

                if (!createState.autoSyncCoupled) {
                    // MANUAL autosync: show refine row and pause for a second
                    // click (optionally re-refine at a different density).
                    // The COUPLED master-audio flow (Fork A) skips this and
                    // falls straight through to convert — one click.
                    const _refineRow = document.getElementById('editor-refine-row');
                    if (_refineRow) _refineRow.classList.remove('hidden');
                    const _goBtn = document.getElementById('editor-create-go');
                    if (_goBtn) _goBtn.textContent = 'Import & Open in Editor';
                    status.textContent = `✓ Synced: ${createState.lastSync.sync_point_count} points, offset ${(_autoSyncOffset ?? 0).toFixed(3)}s — click Import to apply per-bar sync.`;
                    if (_goBtn) {
                        _goBtn.disabled = false;
                        _goBtn.removeAttribute('aria-disabled');
                        _goBtn.focus();
                    }
                    return;
                }
                status.textContent = `✓ Aligned to your audio (offset ${(_autoSyncOffset ?? 0).toFixed(3)}s) — building…`;
                // fall through to convert
            } else {
                // Explicit auto-sync was requested but failed — don't silently
                // import a misaligned chart at offset 0. Stop and let the user
                // decide (retry, or remove the audio via ✕ to import unsynced).
                status.textContent = `Auto-sync failed: ${syncData.error || 'unknown error'}. `
                    + 'Click Import to retry, or remove the audio (✕) to import without sync.';
                btn.disabled = false;
                return;
            }
        } catch (_) {
            status.textContent = 'Auto-sync request failed (network/server). '
                + 'Click Import to retry, or remove the audio (✕) to import without sync.';
            btn.disabled = false;
            return;
        }
    }

    status.textContent = 'Converting Guitar Pro to chart...';

    // Resolve which audio URL to send to convert-gp and persist it so
    // editorBuild() uses the same value on subsequent builds.
    //   - autosync: the uploaded auto-sync audio
    //   - embedded: send empty — the backend extracts the GP8 OGG, and a stale
    //     user URL here would (a) mask an extraction failure and (b) be used
    //     instead of the embedded track. The extracted URL is persisted from
    //     the response below.
    //   - otherwise: whatever audio the user supplied in Step 2.
    let _convertAudioUrl;
    if (_gpAudioMode === 'embedded') {
        _convertAudioUrl = '';
    } else if (_gpAudioMode === 'autosync' && createState.autoSyncAudioUrl) {
        _convertAudioUrl = createState.autoSyncAudioUrl;
    } else {
        _convertAudioUrl = createState.audioUrl || '';
    }
    if (_convertAudioUrl) createState.audioUrl = _convertAudioUrl;

    try {
        const resp = await fetch('/api/plugins/editor/convert-gp', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                gp_path: createState.gpPath,
                audio_url: _convertAudioUrl,
                // Only 'embedded' changes backend behaviour; omit the field
                // otherwise to keep the API surface tight.
                ...(_gpAudioMode === 'embedded' ? { audio_mode: 'embedded' } : {}),
                ...(_autoSyncOffset !== null ? { audio_offset: _autoSyncOffset } : {}),
                // Per-bar sync points (autosync mode only): the server warps
                // the whole chart onto the recording's timeline instead of
                // applying just the scalar bar-1 offset. audio_offset above
                // stays as the fallback when the warp can't be applied.
                ...(_gpAudioMode === 'autosync' && createState.lastSync?.sync_points?.length
                    ? { sync_points: createState.lastSync.sync_points } : {}),
                track_indices: trackIndices.length ? trackIndices : null,
                title: document.getElementById('editor-create-title').value || 'Untitled',
                artist: document.getElementById('editor-create-artist').value || 'Unknown',
                album: document.getElementById('editor-create-album').value || '',
                year: document.getElementById('editor-create-year').value || '',
                // Spec-complete metadata → persisted into the session for Build.
                ..._createExtendedMeta(),
            }),
        });
        const data = await resp.json();
        if (data.error) { status.textContent = 'Error: ' + data.error; btn.disabled = false; return; }

        await window.editorApplyCreateResult(data);
        // Surface how the sync landed ('warp' = chart follows the recording
        // bar-by-bar; 'offset' = server fell back to the scalar offset), and —
        // for either — point the user at the Tempo Map editor to fine-tune any
        // residual drift by hand. See _syncAppliedMessagePure.
        const _syncMsg = _syncAppliedMessagePure(data.sync_applied, data.sync_reason);
        if (_syncMsg && typeof setStatus === 'function') setStatus(_syncMsg);
    } catch (e) {
        status.textContent = 'Import failed: ' + e.message;
        btn.disabled = false;
    }
}

async function _editorDoBlankCreate() {
    const status = document.getElementById('editor-create-status');
    const btn = document.getElementById('editor-create-go');
    const val = (id) => ((document.getElementById(id)?.value) || '').trim();
    const title = val('editor-create-title');
    if (!title) {
        if (status) status.textContent = 'A title is required.';
        if (btn) btn.disabled = false;
        return;
    }
    // Defence in depth: _createGateOpen() already refuses to enable the button
    // without one, but the roster is what the server seeds arrangements from and
    // it rejects an empty list.
    const roster = (createState.roster || []).slice();
    if (!roster.some((r) => _CREATE_INSTRUMENTS.includes(r))) {
        if (status) status.textContent = 'Add at least one instrument to arrange (Lead, Rhythm, Bass, Keys, or Drums).';
        if (btn) btn.disabled = false;
        return;
    }
    if (btn) btn.disabled = true;
    // Audio is optional (draft-now, audio-later): only resolve a pasted YouTube
    // URL here — file audio was uploaded already on selection. With none, the
    // server creates an audio-less work-in-progress pack (`stems: []`) and the
    // author supplies audio later via Replace Audio.
    if (!createState.audioUrl && _createHasAudioInput()) {
        if (status) status.textContent = 'Uploading audio…';
        const ok = await uploadCreateAudio();
        if (!ok) { if (btn) btn.disabled = false; return; }
    }
    // Art normally uploads the moment it is chosen (editorArtFileSelected sets
    // createState.artPath). This retries a selection whose upload failed, rather
    // than silently baking a pack with no cover.
    const artInput = document.getElementById('editor-create-art');
    if (artInput && artInput.files && artInput.files.length && !createState.artPath) {
        const form = new FormData();
        form.append('file', artInput.files[0]);
        try {
            const r = await fetch('/api/plugins/editor/upload-art', { method: 'POST', body: form });
            const dd = await r.json();
            if (dd.art_path) createState.artPath = dd.art_path;
        } catch (_) { /* art just won't be baked if the upload fails */ }
    }
    const meta = {
        title,
        // Optional for a draft; the server writes "" through as-is.
        artist: val('editor-create-artist'),
        album: val('editor-create-album'),
        year: val('editor-create-year'),
        // album_artist / track / disc / genres / language / isrc / mbid / authors.
        // The same helper the Guitar Pro and EOF paths use, so every create route
        // carries the spec-complete metadata the modal collects.
        ..._createExtendedMeta(),
        // "What are you arranging?" — the roster the user built. The server seeds
        // one arrangement per role. `initial_arrangement` + `init_drum_tab` are
        // its documented BACK-COMPAT shape for older clients; do not send them.
        arrangements: roster,
        audio_url: createState.audioUrl,
    };
    if (createState.artPath) meta.art_path = createState.artPath;
    const fd = new FormData();
    fd.append('metadata', JSON.stringify(meta));
    if (status) status.textContent = 'Building feedpak…';
    try {
        const resp = await fetch('/api/plugins/editor/create_sloppak', { method: 'POST', body: fd });
        const data = await resp.json();
        if (!resp.ok || !data.success) {
            if (status) status.textContent = 'Error: ' + (data.error || resp.statusText);
            if (btn) btn.disabled = false;
            return;
        }
        editorHideCreateModal();
        host.kickLibraryRescan();
        await host.loadCDLC(data.filename, { skipGuard: true });
        // C1 lane seed: created from scratch → the Compose surface (intent,
        // not audio-presence; charrette §3.1).
        seedSurfacePreset('compose');
        _editorMaybeStartTour('compose');   // C3: first-run entry tour
    } catch (e) {
        if (status) status.textContent = 'Failed: ' + e.message;
        if (btn) btn.disabled = false;
    }
}

// Apply a create-mode import result (from convert-gp OR import-xml-project) to
// the editor and open it. The two import sources return the same shape
// (_song_to_dict + session_id + create_mode), so this is shared.
export async function editorApplyCreateResult(data) {
    // Persist the audio URL the backend actually used (e.g. GP8-extracted or the
    // project's uploaded mix) so editorBuild() reuses it on later builds.
    if (data.audio_url) createState.audioUrl = data.audio_url;

    // Load into editor
    window.editorHideCreateModal();
    // Same outgoing-job teardown loadCDLC performs: stop the old playback,
    // the pending audio load and any drag, and drop the decoded buffer. An
    // audio-less import skips the loadAudio() branch below, so without this the
    // previous recording keeps sounding under the new chart and S.audioBuffer
    // stays stale. Dispose the old backend session too so its sandbox isn't leaked.
    const oldSessionId = S.sessionId;
    stopSessionProcesses();   // also cancels the outgoing audio load
    S.audioBuffer = null;
    S.waveformPeaks = null;
    S.title = data.title || '';
    S.artist = data.artist || '';
    S.filename = '';
    S.sessionId = data.session_id;
    if (oldSessionId && oldSessionId !== data.session_id) {
        await disposeBackendSession(oldSessionId);
    }
    markSessionDirty();
    S.format = 'sloppak';
    S.arrangements = data.arrangements || [];
    // New song, new strips: part mute/solo/volume is session UI state keyed
    // by part index, so it must not leak across installs (mixer panel, B6).
    S.partMix = {};
    // Create-mode import — the source builds tuning to the actual string count,
    // so length 6 means a genuine 6-string bass / standard guitar (not a
    // padded tuning). Seed `_extendedStrings` to keep `_stringCountFor` honest.
    _seedExtendedStringsFromTuning(S.arrangements, /* authoritative */ true);
    S.beats = data.beats || [];
    S.sections = data.sections || [];
    S.duration = data.duration || 0;
    S.offset = data.offset || 0;
    S.currentArr = 0;
    S.sel.clear();
    S.toneSel = null;
    S.anchorSel = null;
    S.handshapeSel = null;
    S.scrollX = 0;
    S.cursorTime = 0;
    S.barSel = null;
    S.loopEnabled = false;
    S.returnToHighway = false;
    S.history = new EditHistory();
    S.createMode = true;
    // C1 lane seed: an import (Guitar Pro / XML project) → the Transcribe
    // surface, since aligning the grid to the source is the first task
    // (charrette §3.1). No filename yet, so this is in-memory only —
    // editorBuild persists the session's surface under the built file.
    seedSurfacePreset('transcribe');
    _editorMaybeStartTour('transcribe');   // C3: first-run entry tour (reframe + onsets)

    // An import may carry a drum track (returned as a `drum_tab`) and/or piano
    // "Keys" arrangements. Sessions are always sloppak now; load the imported
    // drum_tab into the drum editor and mark it dirty so the build persists it.
    S.drumTab = data.drum_tab ?? null;
    if (S.drumTab && Array.isArray(S.drumTab.hits)) {
        S.drumTab.hits.sort((a, b) => (a.t || 0) - (b.t || 0));
    }
    S.drumTabDirty = !!S.drumTab;
    S.drumEditMode = false;
    S.drumSel = new Set();
    const _importHasDrums = !!(S.drumTab && (S.drumTab.hits || []).length);
    const _importHasKeys = (S.arrangements || []).some(
        a => KEYS_PATTERN.test(a.name || ''));
    if (_importHasDrums || _importHasKeys) S.format = 'sloppak';

    // Reset offset UI so _effectiveAudioOffset() doesn't carry over a
    // delta from a previous session's sync nudge.
    host.resetOffsetUI();

    flattenChords();
    // Beat-primary (§1.3): lift note.beat from the loaded seconds.
    _liftAllBeats(S.beats);
    _restoreBeatLocks();
    if (isKeysMode()) updatePianoRange();

    document.getElementById('editor-song-title').textContent =
        `${S.artist} — ${S.title} (new)`;
    document.getElementById('editor-save-btn').classList.add('hidden');
    document.getElementById('editor-build-btn').classList.remove('hidden');
    document.getElementById('editor-play-btn').disabled = !data.audio_url;
    document.getElementById('editor-sync-btn').classList.toggle('hidden', !data.audio_url);
    document.getElementById('editor-replace-audio-btn').classList.remove('hidden');
    _updateTonesButtonVisibility();
    host.updateArrangementSelector();
    host.updateStatus();
    host.updateTimeDisplay();
    host.updateBPMDisplay();

    if (data.audio_url) await host.loadAudio(data.audio_url);
    host.draw();
    setStatus('Imported — edit notes then click Build feedpak');
}

// EOF arrangement XML(s) selected — just record them. The shared "Import & Open"
// button (editorDoCreate) then assembles audio/art/preview/metadata and imports.
export function editorEofFilesSelected(input) {
    const xmls = [...(input.files || [])].filter(f => /\.xml$/i.test(f.name));
    createState.eofFiles = xmls.length ? xmls : null;
    if (xmls.length) {
        createState.mode = 'eof';
        // One import source at a time: picking EOF XML clears any GP pick.
        createState.gpPath = null;
        createState.tracks = null;
        const _gpInput = document.getElementById('editor-create-gp');
        if (_gpInput) _gpInput.value = '';
        document.getElementById('editor-create-tracks')?.classList.add('hidden');
    } else if (!createState.gpPath) {
        createState.mode = 'blank';
    }
    updateCreateButton();
    const st = document.getElementById('editor-create-status');
    if (st) st.textContent = xmls.length
        ? `${xmls.length} EOF arrangement file(s) selected — set audio/details, then Create.`
        : '';
}

// EOF import path for editorDoCreate: upload the (optional) audio, POST the
// arrangement XML(s) + audio URL + metadata, then open the result. Album art and
// the preview clip are baked later at Build (editorBuild), from their own inputs.
async function _editorDoEofCreate() {
    const status = document.getElementById('editor-create-status');
    const btn = document.getElementById('editor-create-go');
    btn.disabled = true;
    try {
        // Audio is optional for EOF (the chart opens regardless), but upload it
        // when supplied so the editor can play in sync.
        if (!createState.audioUrl && _createHasAudioInput()) {
            status.textContent = 'Uploading audio…';
            await uploadCreateAudio();   // sets createState.audioUrl on success
        }

        status.textContent = 'Importing EOF arrangement(s)…';
        const form = new FormData();
        for (const f of createState.eofFiles) form.append('files', f, f.name);
        form.append('audio_url', createState.audioUrl || '');
        form.append('title', document.getElementById('editor-create-title').value || '');
        form.append('artist', document.getElementById('editor-create-artist').value || '');
        form.append('album', document.getElementById('editor-create-album').value || '');
        form.append('year', document.getElementById('editor-create-year').value || '');
        // Spec-complete metadata as one JSON blob → persisted into the session.
        form.append('extended_meta', JSON.stringify(_createExtendedMeta()));

        const resp = await fetch('/api/plugins/editor/import-xml-project',
            { method: 'POST', body: form });
        const data = await resp.json();
        if (data.error) { status.textContent = 'Error: ' + data.error; btn.disabled = false; return; }
        await window.editorApplyCreateResult(data);
    } catch (e) {
        status.textContent = 'Import failed: ' + e.message;
        btn.disabled = false;
    }
}

export async function editorBuild() {
    if (!S.sessionId || !S.createMode) return;
    // PR3c: warn before building when authored tone slots have no
    // matching gear definition — DLC Builder defaults them to stock
    // clean in the output archive. Confirm prompt lets the user
    // continue or bail back to the modal to pull definitions in.
    if (!_editorConfirmToneDefinitions()) {
        setStatus('Build cancelled');
        return;
    }
    setStatus('Building custom song...');

    // Reconstruct chords for ALL arrangements before sending. Each
    // arrangement must be flattened first: reconstructChords() rebuilds
    // arr.chords purely from arr.notes, so on an arrangement still in
    // its non-flattened state (chords in arr.chords, not spread into
    // arr.notes) it finds no note clusters and wipes every chord. Only
    // the last-viewed arrangement is flattened, so without this the
    // build silently drops chords from every other arrangement.
    // flattenChords() is a no-op on already-flattened ones — this
    // mirrors the flatten-then-reconstruct pass in _buildSaveBody.
    const savedArr = S.currentArr;
    const allArrangements = [];
    for (let i = 0; i < S.arrangements.length; i++) {
        S.currentArr = i;
        flattenChords();
        reconstructChords();
        const arr = S.arrangements[i];
        // PR3c: include authored tones in the build payload too.
        // Without this, tones authored on the tone lane / via the
        // Tones… modal in create mode would silently drop when
        // building since `editorBuild` doesn't route through
        // `_buildSaveBody`. Gate on the net-edit counter so a build
        // after a full undo doesn't ship unchanged tones.
        let buildTones = null;
        if (_tonesAreDirty(arr)) {
            buildTones = _stripToneInternals(arr.tones);
        }
        const arrEntry = {
            name: arr.name,
            // Ship tuning + capo so the backend's `_is_extended_range`
            // tuning-length check fires for arrangements where the
            // user extended via the Strings modal but hasn't placed
            // notes on the new lanes yet. Without these the build
            // would route to archive and then crash inside the converter's note-chart
            // compiler when it sees the >6 tuning slots.
            tuning: Array.isArray(arr.tuning) ? arr.tuning.slice() : [0, 0, 0, 0, 0, 0],
            capo: arr.capo || 0,
            // Explicit extension counter — required for the 6-string
            // bass case where tuning.length==6 is ambiguous between
            // RS-padded 4-string and genuine 6-string. Backend's
            // `_is_extended_range` consumes this signal too.
            _extendedStrings: arr._extendedStrings || 0,
            notes: arr.notes,
            chords: arr.chords,
            chord_templates: arr.chord_templates,
        };
        if (buildTones) arrEntry.tones = buildTones;
        if (arr._gp_notation) arrEntry._gp_notation = arr._gp_notation;
        // PR3d: include authored anchors too — same dirty-gate as
        // tones so an unauthored build doesn't ship empties. The
        // `_anchorEditCount` counter lives on `arr`, not on the
        // entry built above, so nothing extra to strip here.
        if (_anchorsAreDirty(arr) && Array.isArray(arr.anchors_user)) {
            arrEntry.anchors_user = arr.anchors_user;
        }
        // E2: include handshapes whenever any exist — chord_ids were remapped
        // by the reconstructChords() pass above and must stay consistent with
        // the rebuilt templates (see the archive-save note in _buildSaveBody).
        // `_handshapeEditCount` lives on `arr`, not the entry, so nothing extra
        // to strip. Ship an empty list only on an explicit clear.
        if (Array.isArray(arr.handshapes)
                && (arr.handshapes.length > 0 || _handshapesAreDirty(arr))) {
            arrEntry.handshapes = arr.handshapes;
        }
        allArrangements.push(arrEntry);
    }
    S.currentArr = savedArr;

    // Upload album art if selected
    const artInput = document.getElementById('editor-create-art');
    if (artInput && artInput.files && artInput.files.length && !createState.artPath) {
        const form = new FormData();
        form.append('file', artInput.files[0]);
        try {
            const r = await fetch('/api/plugins/editor/upload-art', { method: 'POST', body: form });
            const d = await r.json();
            if (d.art_path) createState.artPath = d.art_path;
        } catch (_) {}
    }

    // Preview clips are now auto-generated server-side from the master audio —
    // no manual upload. (See _make_preview_clip in routes.py.)

    try {
        const resp = await fetch('/api/plugins/editor/build', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                session_id: S.sessionId,
                arrangements: allArrangements,
                beats: S.beats,
                sections: S.sections,
                audio_url: createState.audioUrl || '',
                art_path: createState.artPath || '',
                preview_path: createState.previewPath || '',
                // Drums and piano "Keys" arrangements can only live in a
                // sloppak. editorDoCreate sets S.format='sloppak' when the GP
                // import brought either; forward that as the build target so
                // the server writes a sloppak (not a archive that silently drops
                // them), and ship the imported drum_tab so it's persisted.
                target_format: S.format === 'sloppak' ? 'sloppak' : '',
                drum_tab: (S.drumTab && Array.isArray(S.drumTab.hits)) ? S.drumTab : null,
                metadata: {
                    title: S.title,
                    artist: S.artist,
                    artistName: S.artist,
                },
            }),
        });
        const data = await resp.json();
        if (data.error) { setStatus('Build error: ' + data.error); return; }
        host.kickLibraryRescan();   // refresh the library grid in the background
        // C1: the surface shaped while arranging becomes the built file's
        // memory, so re-opening it from the library lands on the same tools.
        // (The create session itself has no filename — this is the handoff.)
        if (data.filename) surfacePersistFor(data.filename);
        setStatus('Built - added to library!');
    } catch (e) {
        setStatus('Build failed: ' + e.message);
    } finally {
        // Re-flatten current arrangement for continued editing
        flattenChords();
        // (Undo history already invalidated by the reconstructChords pass above — #18.)
        host.draw();
    }
}
