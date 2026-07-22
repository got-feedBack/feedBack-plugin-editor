/* Slopsmith Arrangement Editor — multitrack stem manager (studio-session
 * ingest). Import ANY number of audio tracks (a real session's multitrack,
 * not just separated stems), rename them, reorder them, delete them — and
 * PAIR each with the chart track being transcribed against it.
 *
 * The pairing (S.stemLinks: chart-track key → stem id) is the load-bearing
 * idea: "this arrangement transcribes THAT recording track". It persists as
 * the `editor_stem_links` manifest extension key (the audio_shift retention
 * contract) and powers the one-keystroke transcription move: SOLO MY SOURCE
 * TRACK (isolate the paired stem while you chart against it — gated on a
 * real stem-mixer consumer via `stemMixerAvailable()`; until one lands the
 * verb reports itself unavailable and the link is stored, shown, and
 * shipped for gameplay/tools to consume).
 *
 * Link-consistency rule: EVERY backend call here (pairing sync, rename,
 * reorder, delete, import) ships the CURRENT S.stemLinks, so the
 * authoritative {stems, stem_links} the backend answers with can never
 * resurrect stale links over an unsaved pairing.
 *
 * Chart-track keys reuse the mixer/view-pref rule (_partViewKeyPure: the
 * arrangement's `id` if present, else its name) so links survive part
 * reordering — never a bare index.
 */

import { S, markSessionDirty } from './state.js';
import { host } from './host.js';
import { setStatus, _editorPromptText } from './ui.js';
import { _partViewKeyPure } from './keys.js';
import { isDrumArrangement } from './drum-arrangement.js';
import { editorTempoGuideState, editorToggleTempoGuide, reconcileTempoGuideToStems } from './track-session.js';

/* @pure:stem-tracks:start */
// The manager's row model: one row per stem, in S.stems order, with its
// paired chart track's display name resolved (or '' when unpaired).
function _stemRowsPure(stems, stemLinks, arrangements) {
    const nameByKey = new Map();
    (arrangements || []).forEach((a) => {
        if (a) nameByKey.set(_partViewKeyPure(a), a.name || 'track');
    });
    const linkedTo = (sid) => {
        for (const [k, v] of Object.entries(stemLinks || {})) {
            if (v === sid) return { key: k, name: nameByKey.get(k) || k };
        }
        return null;
    };
    return (stems || []).map((s2) => ({
        id: s2.id,
        pairedWith: linkedTo(s2.id),
    }));
}
// Chart tracks a stem can pair with: PITCHED arrangements only — the derived
// drums arrangement is a song-level sidecar, never a stem-transcription target.
function _stemPairArrsPure(arrangements) {
    return (arrangements || []).filter(a => !isDrumArrangement(a));
}
// Toggle a pairing IMMUTABLY: linking a stem to a track drops that track's
// previous link (one source track per chart track); picking '' unlinks.
function _stemLinkSetPure(links, arrKey, stemId) {
    const out = {};
    for (const [k, v] of Object.entries(links || {})) {
        if (k !== arrKey) out[k] = v;
    }
    if (stemId) out[arrKey] = stemId;
    return out;
}
/* @pure:stem-tracks:end */
export { _stemLinkSetPure, _stemRowsPure, _stemPairArrsPure };

const $modal = () => document.getElementById('editor-stem-tracks-modal');
const $list = () => document.getElementById('editor-stem-tracks-list');

function _esc(t) {
    return String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

async function _post(url, body) {
    const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    const data = await resp.json();
    if (data.error) throw new Error(data.error);
    return data;
}

// Every endpoint answers with the authoritative {stems, stem_links} — adopt
// them wholesale so the manager, the mixer strips, and the engine agree.
function _adopt(data) {
    S.stems = Array.isArray(data.stems) ? data.stems : [];
    S.stemLinks = (data.stem_links && typeof data.stem_links === 'object') ? data.stem_links : {};
    // A rename/delete just rewrote the stem list: unlock the tempo guide if its
    // source vanished, so the still-locked role can't dangle onto a survivor.
    reconcileTempoGuideToStems();
    // Zip-form / create sessions persist stem changes only on the next
    // Save / Build, so the lifecycle guard must know there is something to
    // lose. A dir-form sloppak writes straight into the library
    // (persisted=true, the replace-audio rule) — already durable, no mark.
    if (!data.persisted) markSessionDirty();
    _render();
    // A stem was imported / renamed / reordered / removed — re-decode so the
    // engine's buffer cache matches the new stem set (URLs may be new).
    host.audioSourcesChanged();
}

function _render() {
    const list = $list();
    if (!list) return;
    const rows = _stemRowsPure(S.stems, S.stemLinks, S.arrangements);
    const arrOptions = (paired) => ['<option value="">— not paired —</option>']
        .concat(_stemPairArrsPure(S.arrangements).map((a) => {
            const k = _partViewKeyPure(a);
            const sel = paired && paired.key === k ? ' selected' : '';
            return `<option value="${_esc(k)}"${sel}>${_esc(a.name || 'track')}</option>`;
        })).join('');
    const guide = editorTempoGuideState();
    list.innerHTML = rows.length
        ? rows.map((r, i) => {
            const isGuide = guide.locked && guide.sourceId === r.id;
            return `<div class="flex items-center gap-2 py-1" data-stem-id="${_esc(r.id)}">`
            + `<span class="flex flex-col leading-none">`
            + `<button data-stem-move="up" ${i === 0 ? 'disabled' : ''} class="text-gray-500 hover:text-white disabled:opacity-30" title="Move up">▴</button>`
            + `<button data-stem-move="down" ${i === rows.length - 1 ? 'disabled' : ''} class="text-gray-500 hover:text-white disabled:opacity-30" title="Move down">▾</button>`
            + `</span>`
            + `<button data-stem-rename class="flex-1 truncate text-left text-gray-200 hover:text-white" title="Rename this track">${_esc(r.id)}</button>`
            + `<button data-stem-guide class="${isGuide ? 'text-accent' : 'text-gray-500'} hover:text-white px-1" `
            + `title="${isGuide ? 'Locked metronome guide — assisted tempo mapping (G) analyzes this track. Click to unlock.'
                : 'Lock as the metronome guide: declare this track the click/timing reference — assisted tempo mapping (G) analyzes it instead of the main recording.'}"`
            + ` aria-pressed="${isGuide}">♩</button>`
            + `<select data-stem-pair aria-label="Chart track transcribing ${_esc(r.id)}" class="bg-dark-700 text-xs rounded px-1 py-0.5 max-w-[10rem]">${arrOptions(r.pairedWith)}</select>`
            + `<button data-stem-delete class="text-red-400 hover:text-red-300 px-1" title="Remove this track from the pack">✕</button>`
            + `</div>`;
        }).join('')
        : '<p class="py-2 text-gray-500">No audio tracks yet — Import adds any number of them (wav / ogg / opus / mp3 / flac).</p>';
}

// Atomic link submission: every stem op POSTs the CURRENT pairings along
// with the op, so the backend session is never behind the frontend and the
// authoritative response it echoes can't resurrect stale links over an
// unsaved pairing (pair → rename used to lose the pair). A failed POST
// half-applies nothing: S keeps its state and the error surfaces.
// Exported for the test suite; product code goes through the modal handlers.
export async function _submitStemOp(body, verb, failLabel) {
    try {
        _adopt(await _post('/api/plugins/editor/stem-op',
            { session_id: S.sessionId, stem_links: S.stemLinks || {}, ...body }));
        if (verb) setStatus(verb);
        return true;
    } catch (e) {
        setStatus(`Stem ${failLabel || 'edit'} failed: ${e.message}`);
        return false;
    }
}

function _onListClick(e) {
    const row = e.target instanceof Element ? e.target.closest('[data-stem-id]') : null;
    if (!row || !S.sessionId) return;
    const sid = row.getAttribute('data-stem-id');
    if (e.target.closest('[data-stem-move]')) {
        const dir = e.target.closest('[data-stem-move]').getAttribute('data-stem-move');
        const order = (S.stems || []).map(s2 => s2.id);
        const i = order.indexOf(sid);
        const j = dir === 'up' ? i - 1 : i + 1;
        if (i < 0 || j < 0 || j >= order.length) return;
        [order[i], order[j]] = [order[j], order[i]];
        _submitStemOp({ op: 'reorder', order }, 'Tracks reordered.', 'reorder');
    } else if (e.target.closest('[data-stem-rename]')) {
        (async () => {
            const raw = await _editorPromptText({
                title: `Rename track "${sid}"`,
                label: 'New name (letters, numbers, - and _):',
                value: sid, placeholder: 'Guitar_L',
            });
            if (raw === null || raw === sid) return;
            _submitStemOp({ op: 'rename', id: sid, new_id: raw }, `Renamed to ${raw}.`, 'rename');
        })();
    } else if (e.target.closest('[data-stem-guide]')) {
        // Frontend-only state (rides the track-session tree on Save/Build) —
        // no backend op, so no _submitStemOp round-trip.
        const locked = editorToggleTempoGuide(sid, 'metronome');
        setStatus(locked
            ? `“${sid}” locked as the metronome guide — assisted tempo mapping (G) now analyzes it.`
            : 'Metronome guide unlocked — assisted tempo mapping analyzes the main recording again.');
        _render();
    } else if (e.target.closest('[data-stem-delete]')) {
        _submitStemOp({ op: 'delete', id: sid }, `Removed ${sid}.`, 'delete');
    }
}

function _onPairChange(e) {
    const sel = e.target instanceof Element ? e.target.closest('[data-stem-pair]') : null;
    if (!sel) return;
    const row = sel.closest('[data-stem-id]');
    const sid = row && row.getAttribute('data-stem-id');
    const arrKey = sel.value;
    if (!sid || !S.sessionId) return;
    // Unlink every track currently pointing at this stem, then link the pick.
    let links = { ...(S.stemLinks || {}) };
    for (const [k, v] of Object.entries(links)) if (v === sid) delete links[k];
    if (arrKey) links = _stemLinkSetPure(links, arrKey, sid);
    S.stemLinks = links;
    _render();
    // Sync the pairing to the backend session NOW (op 'links', atomic with
    // the snapshot) so the next rename/reorder/delete can't answer from a
    // pre-pairing world. If the sync fails the pairing still lives in S
    // (Save/Build ship it) — keep it, surface the error, and mark the
    // session dirty ourselves since no response did.
    const verb = arrKey ? `${sid} paired — saved with the song.` : `${sid} unpaired.`;
    (async () => {
        if (!(await _submitStemOp({ op: 'links' }, verb, 'pairing'))) markSessionDirty();
    })();
}

/**
 * Imports selected audio files as stem tracks and updates the session with the resulting stems and pairings.
 */
function _onImportPicked(e) {
    const input = e.target;
    if (!input || !input.files || !input.files.length || !S.sessionId) return;
    const fd = new FormData();
    fd.append('session_id', S.sessionId);
    // The import's response also echoes authoritative stem_links — ship the
    // current pairings (JSON-encoded: multipart) so they can't be echoed away.
    fd.append('stem_links', JSON.stringify(S.stemLinks || {}));
    for (const f of input.files) fd.append('files', f);
    input.value = '';
    setStatus('Importing audio tracks…');
    (async () => {
        try {
            const resp = await fetch('/api/plugins/editor/import-stems', { method: 'POST', body: fd });
            const data = await resp.json();
            if (data.error) throw new Error(data.error);
            _adopt(data);
            const n = (data.imported || []).length;
            const skipped = (data.skipped || []).length;
            setStatus(`Imported ${n} track${n === 1 ? '' : 's'}`
                + (skipped ? ` (${skipped} skipped — not audio)` : '')
                + (data.next_step === 'save' ? ' — Save writes them into the pack.'
                    : data.next_step === 'build' ? ' — Save the project, then export again when ready.' : '.'));
        } catch (err) {
            setStatus('Import failed: ' + err.message);
        }
    })();
}

export function editorToggleStemTracks(force) {
    const modal = $modal();
    if (!modal) return false;
    const show = force === undefined ? modal.classList.contains('hidden') : !!force;
    modal.classList.toggle('hidden', !show);
    if (show) {
        if (!S.sessionId) { setStatus('Open or import a song first.'); modal.classList.add('hidden'); return true; }
        _render();
    }
    return true;
}

// Capability probe: the solo verb changes AUDIO, and audio only changes
// when a stem-mixer implementation consumes S.stemMix through
// host.stemMixChanged. The hook has NO inert default in host.js on
// purpose — its very presence is the capability signal, so a host with no
// mixer wired leaves the verb honestly unavailable (menu greys it via the
// `needs: 'stemMixer'` gate; a direct invocation reports why).
export function stemMixerAvailable() {
    return typeof host.stemMixChanged === 'function';
}

// The transcription move: solo the CURRENT track's paired source stem. The
// stem plays through the SAME S.partMix mixer as everything else (keyed
// 'audio:<id>'), so this is an EXCLUSIVE isolate over the audio band —
// enabling clears every OTHER stem's solo (Guitar after Bass must not stack
// into Guitar+Bass); toggling off clears the paired stem's solo too. The
// isolate is real now: the master mix mutes with the rest of the audio band
// (solo the master strip alongside to hear both).
export function editorSoloMyStem() {
    if (!stemMixerAvailable()) {
        setStatus('Solo my source track needs the stem mixer — not available in this build yet.');
        return true;
    }
    const arr = S.arrangements && S.arrangements[S.currentArr];
    if (!arr) { setStatus('Load a song first.'); return true; }
    const sid = (S.stemLinks || {})[_partViewKeyPure(arr)];
    if (!sid) {
        setStatus(`"${arr.name}" has no paired source track — pair one in File › Audio tracks…`);
        return true;
    }
    if (!S.partMix || typeof S.partMix !== 'object') S.partMix = {};
    const key = 'audio:' + sid;
    const cur = S.partMix[key] || {};
    const on = !cur.solo;
    // Clear every other stem's solo so the isolate is exclusive (leave the
    // synth parts' own solos alone — this verb owns the audio band only).
    for (const [k, v] of Object.entries(S.partMix)) {
        if (k !== key && k.startsWith('audio:') && v && v.solo) S.partMix[k] = { ...v, solo: false };
    }
    S.partMix[key] = { vol: Number.isFinite(cur.vol) ? cur.vol : 100, mute: false, solo: on };
    host.stemMixChanged();
    setStatus(on
        ? `Soloing ${sid} — the source track "${arr.name}" transcribes against; the other audio tracks are muted.`
        : `${sid} solo off.`);
    return true;
}

export function initStemTracks() {
    const modal = $modal();
    if (!modal) return;
    modal.addEventListener('click', (e) => {
        if (e.target instanceof Element && e.target.id === 'editor-stem-tracks-close') {
            modal.classList.add('hidden');
            return;
        }
        _onListClick(e);
    });
    modal.addEventListener('change', (e) => {
        if (e.target instanceof Element && e.target.id === 'editor-stem-tracks-file') _onImportPicked(e);
        else _onPairChange(e);
    });
}
