// ════════════════════════════════════════════════════════════════════
// Track session — the persistent, first-class track tree.
//
// A song's tracks (the master recording, studio stems, and transcription
// parts, optionally grouped into folders) are one ordered tree the editor
// persists as the `editor_track_session` manifest extension key. The tree
// LAYERS OVER the canonical song data — it references arrangements and
// stems by key, it never replaces them as the source of truth:
//
//   - sources are DERIVED from (S.audioUrl, S.stems) on demand — the tree
//     stores only source ids ('master' or the bare manifest stem id), so a
//     /stem-op rename/delete can never leave a stale parallel copy here;
//   - transcription tracks reference parts by `_partViewKeyPure(arr)` — the
//     SAME key `editor_stem_links` uses, so the two stores speak one dialect
//     (and both inherit stable per-arrangement ids the day arrangements
//     grow an `id` field);
//   - chart↔stem pairing is NOT stored here. `S.stemLinks` remains the one
//     pairing truth; rows PROJECT it (see _trackSessionRowsPure) so the two
//     stores can never disagree;
//   - per-track mix (S.partMix / S.stemMix) stays session-only by design —
//     the tree persists identity/order/grouping, not fader positions.
//
// Removing an audio track is NON-DESTRUCTIVE: the source id goes into
// `removedSourceIds` and the media stays in the pack. The tempo-guide
// fields (which source is the timing reference, and whether it is locked)
// persist here too; assisted mapping (G) reads them — a LOCKED guide is
// what tempo analysis listens to (see editorToggleTempoGuide below).
//
// This module is the model slice: pure tree ops + install/save wiring.
// The unified Tracks surface that renders the tree arrives in a follow-up
// (see the docked mixer panel / parts view for today's surfaces).
// ════════════════════════════════════════════════════════════════════
import { host } from './host.js';
import { _partViewKeyPure } from './keys.js';
import { _mixerPanelRefresh, _mixerPartStatePure, mixerSetPart, mixerTogglePart } from './mixer-panel.js';
import { S, markSessionDirty } from './state.js';
import { _editorEscHtml, setStatus } from './ui.js';

const MASTER_ID = 'master';
const DRUM_TARGET_ID = 'drums';
const VERSION = 2;
const TRACK_LANE_DEFAULT = 56;
const TRACK_LANE_MIN = 28;
const TRACK_LANE_MAX = 160;
const idOf = (value) => typeof value === 'string' && value.trim().length > 0 && value.length <= 160 ? value.trim() : '';
const audioTrackId = (sourceId) => 'audio:' + sourceId;
const transcriptionTrackId = (targetId) => 'transcription:' + targetId;

/* @pure:track-session:start */
// The session's audio sources, derived (never stored): the master recording
// plus every stem, in manifest order. Stem ids are the BARE manifest ids —
// the same identity `manifest["stems"]`, the mixer strips, and stemLinks
// values share.
export function _trackSessionSourcesPure(audioUrl, stems) {
    const out = [];
    if (audioUrl) out.push({ id: MASTER_ID, name: 'Master Mix', kind: 'master', url: String(audioUrl) });
    const seen = new Set([MASTER_ID]);
    for (const raw of (Array.isArray(stems) ? stems : [])) {
        const id = idOf(raw && raw.id);
        if (!id || seen.has(id)) continue;
        seen.add(id);
        out.push({
            id,
            name: String((raw && raw.name) || id).slice(0, 120),
            kind: 'stem',
            url: typeof (raw && raw.url) === 'string' ? raw.url : '',
            offset: Number.isFinite(Number(raw && raw.offset)) ? Number(raw.offset) : 0,
        });
    }
    return out;
}

// The transcription targets: every arrangement plus the drum tab. targetId
// is the durable chart-track key (shared with stemLinks); mixKey is the
// session address partMix / band mode speak ('arr:<idx>' / 'drums').
export function _trackSessionTargetsPure(arrangements, drumTab) {
    const out = [];
    const seen = new Set();
    (Array.isArray(arrangements) ? arrangements : []).forEach((arr, index) => {
        if (!arr) return;
        let id = idOf(_partViewKeyPure(arr)) || 'arr:' + index;
        // Duplicate part names collapse to one key — suffix the later ones so
        // every part keeps a row (same degradation stemLinks already has).
        while (seen.has(id)) id += '′';
        seen.add(id);
        out.push({ id, name: String(arr.name || ('Track ' + (index + 1))).slice(0, 120), mixKey: 'arr:' + index });
    });
    if (drumTab && Array.isArray(drumTab.hits)) {
        out.push({ id: DRUM_TARGET_ID, name: String(drumTab.name || 'Drums').slice(0, 120), mixKey: 'drums' });
    }
    return out;
}

// Normalize any persisted/half-trusted tree against the loaded song: drop
// rows whose source/target no longer exists, append rows for anything new,
// repair parent cycles, and default the tempo guide. Idempotent — this is
// the ONE shape every other op starts from.
export function _trackSessionNormalizePure(raw, sources, arrangements, drumTab) {
    const sourceList = Array.isArray(sources) ? sources : [];
    const targets = _trackSessionTargetsPure(arrangements, drumTab);
    const knownSources = new Set(sourceList.map(s => s.id));
    const knownTargets = new Set(targets.map(t => t.id));
    const input = raw && typeof raw === 'object' ? raw : {};
    const removedSourceIds = [...new Set((Array.isArray(input.removedSourceIds) ? input.removedSourceIds : [])
        .map(idOf).filter(sourceId => knownSources.has(sourceId)))];
    const removedSources = new Set(removedSourceIds);
    const visibleSources = sourceList.filter(source => !removedSources.has(source.id));
    const visibleSourceIds = new Set(visibleSources.map(source => source.id));
    const canonicalKinds = new Map([
        ...visibleSources.map(source => [audioTrackId(source.id), ['audio', source.id]]),
        ...targets.map(target => [transcriptionTrackId(target.id), ['transcription', target.id]]),
    ]);
    const inputTracks = (Array.isArray(input.tracks) ? input.tracks : []).slice(0, 300);
    const tracks = [];
    const seen = new Set();
    const persistedIds = new Set();
    const allocated = new Set([
        ...canonicalKinds.keys(),
        ...inputTracks.map(item => idOf(item?.id)).filter(Boolean),
    ]);
    const folderAliases = new Map();
    const sourceLeaves = new Set();
    const targetLeaves = new Set();
    for (const item of inputTracks) {
        if (!item || typeof item !== 'object') continue;
        let id = idOf(item.id);
        if (!id || persistedIds.has(id) || !['folder', 'audio', 'transcription'].includes(item.type)) continue;
        persistedIds.add(id);
        const canonical = canonicalKinds.get(id);
        const matchesCanonical = canonical && item.type === canonical[0]
            && idOf(item[item.type === 'audio' ? 'sourceId' : 'targetId']) === canonical[1];
        if (canonical && !matchesCanonical) {
            // A persisted folder/unrelated leaf must not claim a canonical row
            // id (for example `audio:master`) and thereby suppress the real
            // source/target. Keep the conflicting item under a collision-free
            // id; folder children are retargeted after the input pass.
            const original = id;
            let n = 1;
            do { id = `conflict:${n++}`; } while (allocated.has(id) || seen.has(id));
            if (item.type === 'folder') folderAliases.set(original, id);
        }
        if (item.type === 'folder') {
            tracks.push({ id, type: 'folder', name: String(item.name || 'Folder').slice(0, 120), parentId: idOf(item.parentId), collapsed: !!item.collapsed });
        } else if (item.type === 'audio') {
            const sourceId = idOf(item.sourceId);
            if (!visibleSourceIds.has(sourceId) || sourceLeaves.has(sourceId)) continue;
            sourceLeaves.add(sourceId);
            tracks.push({ id, type: 'audio', sourceId, name: String(item.name || '').slice(0, 120), parentId: idOf(item.parentId) });
        } else {
            const targetId = idOf(item.targetId);
            if (!knownTargets.has(targetId) || targetLeaves.has(targetId)) continue;
            targetLeaves.add(targetId);
            tracks.push({ id, type: 'transcription', targetId, name: String(item.name || '').slice(0, 120), parentId: idOf(item.parentId) });
        }
        seen.add(id);
        allocated.add(id);
    }
    for (const track of tracks) {
        if (folderAliases.has(track.parentId)) track.parentId = folderAliases.get(track.parentId);
    }
    for (const source of visibleSources) if (!sourceLeaves.has(source.id)) {
        const id = audioTrackId(source.id);
        if (!seen.has(id)) { tracks.push({ id, type: 'audio', sourceId: source.id, name: '', parentId: '' }); seen.add(id); }
    }
    for (const target of targets) if (!targetLeaves.has(target.id)) {
        const id = transcriptionTrackId(target.id);
        if (!seen.has(id)) { tracks.push({ id, type: 'transcription', targetId: target.id, name: '', parentId: '' }); seen.add(id); }
    }
    const folders = new Set(tracks.filter(t => t.type === 'folder').map(t => t.id));
    const byId = new Map(tracks.map(track => [track.id, track]));
    for (const track of tracks) {
        if (!folders.has(track.parentId) || track.parentId === track.id) { track.parentId = ''; continue; }
        // A corrupted parent cycle must never hide a branch from the tree.
        const ancestors = new Set([track.id]); let parent = track.parentId;
        while (parent) {
            if (ancestors.has(parent)) { track.parentId = ''; break; }
            ancestors.add(parent); parent = (byId.get(parent) || {}).parentId || '';
        }
    }
    const guide = idOf(input.tempoGuideSourceId);
    return {
        version: VERSION,
        tracks,
        removedSourceIds,
        tempoGuideSourceId: visibleSourceIds.has(guide) ? guide : (visibleSources[0] ? visibleSources[0].id : ''),
        tempoGuideLocked: !!input.tempoGuideLocked,
        tempoGuideMode: input.tempoGuideMode === 'metronome' ? 'metronome' : 'audio',
    };
}

// Flatten the tree into display rows (depth-first, collapsed folders prune
// their branch). Pairing is PROJECTED from stemLinks — never stored on the
// row's tree entry — and a link that points at a removed or unknown source
// projects as unpaired rather than resurrecting it.
export function _trackSessionRowsPure(session, sources, arrangements, drumTab, stemLinks) {
    const model = _trackSessionNormalizePure(session, sources, arrangements, drumTab);
    const removedSources = new Set(model.removedSourceIds);
    const sourceMap = new Map((Array.isArray(sources) ? sources : []).filter(source => !removedSources.has(source.id)).map(s => [s.id, s]));
    const targetMap = new Map(_trackSessionTargetsPure(arrangements, drumTab).map(t => [t.id, t]));
    const links = (stemLinks && typeof stemLinks === 'object') ? stemLinks : {};
    const children = new Map();
    for (const track of model.tracks) {
        const list = children.get(track.parentId) || [];
        list.push(track); children.set(track.parentId, list);
    }
    const rows = [];
    const visit = (parentId, depth) => {
        for (const track of (children.get(parentId) || [])) {
            const source = track.type === 'audio' ? sourceMap.get(track.sourceId) : null;
            const target = track.type === 'transcription' ? targetMap.get(track.targetId) : null;
            const linked = target ? idOf(links[track.targetId]) : '';
            rows.push({
                ...track,
                depth,
                name: track.name || (source || target || {}).name || 'Track',
                sourceKind: source ? source.kind : '',
                mixKey: source ? audioTrackId(source.id) : (target && target.mixKey) || '',
                pairedSourceId: linked && sourceMap.has(linked) ? linked : '',
            });
            if (track.type !== 'folder' || !track.collapsed) visit(track.id, depth + 1);
        }
    };
    visit('', 0);
    return { model, rows, sources: [...sourceMap.values()] };
}

// Delete a row. Folders promote their children; audio rows are
// NON-DESTRUCTIVE (the source id is tombstoned in removedSourceIds, the
// media stays in the pack). Transcription rows are not deletable here —
// removing a part is arrangement surgery, owned by its own flow.
export function _trackSessionDeletePure(session, trackId, sources, arrangements, drumTab) {
    const model = _trackSessionNormalizePure(session, sources, arrangements, drumTab);
    const track = model.tracks.find(item => item.id === trackId);
    if (!track) return model;
    if (track.type === 'folder') {
        for (const child of model.tracks) {
            if (child.parentId === track.id) child.parentId = track.parentId || '';
        }
        model.tracks = model.tracks.filter(item => item.id !== track.id);
        return model;
    }
    if (track.type !== 'audio') return model;
    model.removedSourceIds = [...new Set([...(model.removedSourceIds || []), track.sourceId])];
    model.tracks = model.tracks.filter(item => item.id !== track.id);
    if (model.tempoGuideSourceId === track.sourceId) {
        const remaining = (Array.isArray(sources) ? sources : [])
            .find(source => !model.removedSourceIds.includes(source.id));
        model.tempoGuideSourceId = remaining ? remaining.id : '';
        model.tempoGuideLocked = false;
        model.tempoGuideMode = 'audio';
    }
    return model;
}

// Restore a tombstoned source: its row reappears at the root (normalize
// re-appends anything visible-but-unrepresented).
export function _trackSessionRestorePure(session, sourceId, sources, arrangements, drumTab) {
    const model = _trackSessionNormalizePure(session, sources, arrangements, drumTab);
    const next = { ...model, removedSourceIds: (model.removedSourceIds || []).filter(id => id !== sourceId) };
    return _trackSessionNormalizePure(next, sources, arrangements, drumTab);
}

export function _trackSessionMovePure(session, movedId, targetId, placement, sources, arrangements, drumTab) {
    const model = _trackSessionNormalizePure(session, sources, arrangements, drumTab);
    const from = model.tracks.findIndex(t => t.id === movedId);
    const target = model.tracks.findIndex(t => t.id === targetId);
    if (from < 0 || target < 0 || from === target) return model;
    const moved = model.tracks[from]; const destination = model.tracks[target];
    const place = placement === 'inside' && destination.type === 'folder'
        ? 'inside' : placement === 'after' ? 'after' : 'before';
    const nextParent = place === 'inside' ? destination.id : destination.parentId;
    // Moving a folder carries its branch. Never let its new parent be itself
    // or one of its descendants, even when reordering against a nested row.
    let parent = nextParent;
    while (parent) {
        if (parent === moved.id) return model;
        parent = (model.tracks.find(track => track.id === parent) || {}).parentId || '';
    }
    moved.parentId = nextParent;
    model.tracks.splice(from, 1);
    const revisedTarget = model.tracks.findIndex(track => track.id === targetId);
    model.tracks.splice(revisedTarget + (place === 'before' ? 0 : 1), 0, moved);
    return model;
}

export function _trackSessionCreateFolderPure(session, sources, arrangements, drumTab, name) {
    const model = _trackSessionNormalizePure(session, sources, arrangements, drumTab);
    let n = 1;
    const used = new Set(model.tracks.map(t => t.id));
    while (used.has('folder:' + n)) n++;
    model.tracks.push({ id: 'folder:' + n, type: 'folder', name: String(name || 'Folder').slice(0, 120), parentId: '', collapsed: false });
    return model;
}

export function _trackSessionRenamePure(session, trackId, name, sources, arrangements, drumTab) {
    const model = _trackSessionNormalizePure(session, sources, arrangements, drumTab);
    const track = model.tracks.find(item => item.id === trackId);
    const clean = String(name || '').trim().slice(0, 120);
    if (track && clean) track.name = clean;
    return model;
}

// ── Lane geometry (shared by the header column AND the canvas lanes, so
// the two surfaces line up 1:1) ───────────────────────────────────────
export function _trackSessionLaneHeightPure(heights, trackId) {
    const value = Number(heights && heights[trackId]);
    return Number.isFinite(value)
        ? Math.max(TRACK_LANE_MIN, Math.min(TRACK_LANE_MAX, Math.round(value)))
        : TRACK_LANE_DEFAULT;
}
export function _trackSessionDensityPure(width) {
    const value = Number(width) || 0;
    return value < 230 ? 'compact' : value < 400 ? 'normal' : 'wide';
}
// Logic-style auto-fit, deliberately modest: spare viewport height improves
// readability but the automatic bonus caps at 32px so a two-track song does
// not turn into two enormous empty slabs. Never shrinks below authored.
export function _trackSessionFittedHeightsPure(rows, heights, viewportHeight) {
    const fitted = {};
    let total = 0;
    for (const row of (rows || [])) {
        fitted[row.id] = _trackSessionLaneHeightPure(heights, row.id);
        total += fitted[row.id];
    }
    const spare = Math.max(0, (Number(viewportHeight) || 0) - total);
    if (!rows || !rows.length || spare <= 0) return fitted;
    const bonus = Math.min(32, Math.floor(spare / rows.length));
    for (const row of rows) fitted[row.id] = Math.min(TRACK_LANE_MAX, fitted[row.id] + bonus);
    return fitted;
}
export function _trackSessionLaneLayoutPure(rows, heights, scrollY = 0, top = 40) {
    const out = [];
    let y = Number(top) || 0;
    const scroll = Math.max(0, Number(scrollY) || 0);
    for (const row of (rows || [])) {
        const h = _trackSessionLaneHeightPure(heights, row.id);
        out.push({ row, y: y - scroll, h });
        y += h;
    }
    return { lanes: out, contentHeight: Math.max(0, y - (Number(top) || 0)) };
}
// Where a drag over a row would land: folders accept 'inside' in their
// middle band (25–75%); everything else splits at the midline.
export function _trackSessionDropPlacementPure(pointerY, rowTop, rowHeight, isFolder) {
    const h = Math.max(1, Number(rowHeight) || 1);
    const ratio = Math.max(0, Math.min(1, ((Number(pointerY) || 0) - (Number(rowTop) || 0)) / h));
    if (isFolder && ratio >= .25 && ratio <= .75) return 'inside';
    return ratio < .5 ? 'before' : 'after';
}
export function _trackRenameEditorMarkupPure(trackId, currentName) {
    const id = _editorEscHtml(trackId);
    const name = _editorEscHtml(currentName);
    return `<input class="editor-track-inline-rename" data-track-rename-input data-track-id="${id}" value="${name}" draggable="false" aria-label="New track or folder name">`;
}

// True when the tree carries nothing the canonical song doesn't already
// express: default order (sources then targets), no folders, no custom
// names, no tombstones, default guide. A default tree persists as NO
// manifest key, so untouched packs stay byte-identical across saves.
export function _trackSessionIsDefaultPure(session, sources, arrangements, drumTab) {
    const model = _trackSessionNormalizePure(session, sources, arrangements, drumTab);
    if (model.removedSourceIds.length || model.tempoGuideLocked || model.tempoGuideMode !== 'audio') return false;
    const sourceList = Array.isArray(sources) ? sources : [];
    if (model.tempoGuideSourceId !== (sourceList[0] ? sourceList[0].id : '')) return false;
    const canonical = [
        ...sourceList.map(source => audioTrackId(source.id)),
        ..._trackSessionTargetsPure(arrangements, drumTab).map(target => transcriptionTrackId(target.id)),
    ];
    if (model.tracks.length !== canonical.length) return false;
    return model.tracks.every((track, index) =>
        track.id === canonical[index] && track.type !== 'folder' && !track.name && !track.parentId);
}
/* @pure:track-session:end */

function _liveSources() { return _trackSessionSourcesPure(S.audioUrl, S.stems); }

// Load-boundary install (loadCDLC): adopt the persisted tree against the
// freshly-loaded song. Never dirties the session — loading is not an edit.
// `audioUrl` rides in explicitly at load time because S.audioUrl still
// points at the previous song until loadAudio runs.
export function installTrackSession(raw, audioUrl) {
    const sources = _trackSessionSourcesPure(audioUrl !== undefined ? audioUrl : S.audioUrl, S.stems);
    // A persisted LOCKED guide whose stem id is gone must UNLOCK at load — not
    // silently repoint onto the first surviving source (usually the master):
    // normalize preserves the lock while replacing the missing id, and
    // reconcileTempoGuideToStems() can't catch it afterwards because the id now
    // resolves. Same intent as the stem-op reconcile, applied at the load seam.
    const persistedGuide = raw && typeof raw.tempoGuideSourceId === 'string' ? raw.tempoGuideSourceId : '';
    const input = raw && raw.tempoGuideLocked && !sources.some(s => s.id === persistedGuide)
        ? { ...raw, tempoGuideLocked: false, tempoGuideMode: 'audio' }
        : raw;
    S.trackSession = _trackSessionNormalizePure(input, sources, S.arrangements, S.drumTab);
    S.selectedTrackId = '';
    S.focusedSourceId = S.trackSession.tempoGuideSourceId;
    S.trackScrollY = 0;
    // The unified Tracks area is the landing surface for a session with
    // tracks (i.e. any real song) — the DAW arrangement-view idiom.
    S.partsViewMode = S.trackSession.tracks.length > 0;
    lastRender = '';
    refreshTrackSession();
}

// Create/import-boundary install (the #286 seam): the backend ships the
// session's audio classification as `audio_sources` ('master' + prefixed
// 'stem:<id>' entries). Seed S.stems from it — in create mode the server's
// stem list lives in session["stem_files"] and this payload is the
// frontend's first (and only) sight of it; ids are the bare manifest ids
// the built pack will persist, so the tree speaks one namespace throughout.
export function installCreatedTrackSession(raw, audioSources) {
    const list = Array.isArray(audioSources) ? audioSources : [];
    // Unconditional: a fresh import session starts with exactly the sources
    // the server reported (S.stems is otherwise only written by loadCDLC and
    // stem-op adoption — the create path would carry the previous song's).
    S.stems = list
        .filter(source => source && source.kind === 'stem' && typeof source.id === 'string' && source.id.startsWith('stem:'))
        .map(source => ({ id: source.id.slice('stem:'.length), name: source.name, url: source.url }));
    const master = list.find(source => source && source.kind === 'master' && source.url);
    installTrackSession(raw, master ? master.url : '');
}

// The save-body payload: the normalized tree, or null when it is entirely
// default — null tells the backend to REMOVE the manifest key, so a tree
// reset back to default leaves no residue in the pack.
export function trackSessionSavePayload() {
    const sources = _liveSources();
    if (_trackSessionIsDefaultPure(S.trackSession, sources, S.arrangements, S.drumTab)) return null;
    return _trackSessionNormalizePure(S.trackSession, sources, S.arrangements, S.drumTab);
}

// ── Tempo guide: the timing-reference role ───────────────────────────
// One audio source can be declared the session's tempo reference. LOCKING
// is the commitment: a locked guide is what assisted mapping (G) analyzes,
// even though playback keeps following the session recording. Mode
// 'metronome' additionally declares the source to BE a click track (each
// transient = one beat pulse — the stronger analysis contract).
export function editorTempoGuideState() {
    const tree = S.trackSession || {};
    return {
        sourceId: typeof tree.tempoGuideSourceId === 'string' ? tree.tempoGuideSourceId : '',
        locked: !!tree.tempoGuideLocked,
        mode: tree.tempoGuideMode === 'metronome' ? 'metronome' : 'audio',
    };
}

// Toggle `sourceId` as the locked guide (default mode: metronome). Toggling
// the active guide off returns to the default — first source, unlocked,
// plain audio analysis. Session state, persisted with the tree — so it
// dirties the session, but it is not a chart edit (no history command).
export function editorToggleTempoGuide(sourceId, mode = 'metronome') {
    const sources = _liveSources();
    const model = _trackSessionNormalizePure(S.trackSession, sources, S.arrangements, S.drumTab);
    const wanted = mode === 'metronome' ? 'metronome' : 'audio';
    const active = model.tempoGuideLocked && model.tempoGuideSourceId === sourceId
        && model.tempoGuideMode === wanted;
    S.trackSession = _trackSessionNormalizePure({
        ...model,
        tempoGuideSourceId: active ? (sources[0] ? sources[0].id : '') : sourceId,
        tempoGuideLocked: !active,
        tempoGuideMode: active ? 'audio' : wanted,
    }, sources, S.arrangements, S.drumTab);
    markSessionDirty();
    lastRender = '';
    refreshTrackSession();
    return !active;
}

// Keep the locked-guide reference honest when the stem list changes underneath
// it. Rename and delete in the tracks manager rewrite S.stems (via _adopt) but
// leave the guide role untouched, so its sourceId can dangle. A dangling LOCKED
// guide is not harmless: G can't find the source live, and the save-time
// normalize silently repoints the still-locked role onto the first surviving
// source (usually the master recording), so a reopened song would analyze the
// wrong track as a click. Unlock back to the default instead. Reorder keeps
// ids, so this is a no-op there. Returns true when it actually cleared a guide.
export function reconcileTempoGuideToStems() {
    const tree = S.trackSession;
    if (!tree || !tree.tempoGuideLocked) return false;
    const sources = _liveSources();
    if (sources.some(s => s.id === tree.tempoGuideSourceId)) return false;
    S.trackSession = _trackSessionNormalizePure({
        ...tree,
        tempoGuideSourceId: sources[0] ? sources[0].id : '',
        tempoGuideLocked: false,
        tempoGuideMode: 'audio',
    }, sources, S.arrangements, S.drumTab);
    markSessionDirty();
    return true;
}
// ═════════════════════════════════════════════════════════════════════
// The Tracks header column (the left <aside>) — the tree made visible.
// One ordered list of header cells whose geometry (heights, order, fold
// state, scroll) is IDENTICAL to the canvas lanes parts-view draws, so
// the two surfaces always line up. All persistent listeners are delegated
// on the panel element itself (replaced on host re-injection → no leaks);
// the only window-level listeners are self-removing pointer drag pairs.
// ═════════════════════════════════════════════════════════════════════

let lastRender = '';
let draggedId = '';
let renamingTrackId = '';
const panel = () => (typeof document === 'undefined' ? null : document.getElementById('editor-track-session'));

function _rowsLive() {
    return _trackSessionRowsPure(S.trackSession, _liveSources(), S.arrangements, S.drumTab, S.stemLinks);
}

export function applyTrackHeaderWidth(width, persist = false) {
    const value = Math.max(176, Math.min(576, Math.round(Number(width) || 320)));
    S.trackHeaderWidth = value;
    const el = panel();
    if (el) {
        el.style.width = value + 'px';
        el.setAttribute('data-track-density', _trackSessionDensityPure(value));
    }
    if (persist) {
        try { localStorage.setItem('editorTrackHeaderWidth', String(value)); } catch (_) { /* storage blocked */ }
    }
    return value;
}

function render() {
    const el = panel();
    if (!el) return;
    const { model, rows, sources } = _rowsLive();
    const fittedHeights = _trackSessionFittedHeightsPure(rows, S.trackHeights, S.trackViewportHeight);
    // Pairing options are STEMS only — pairing lives in stemLinks (a stem
    // id per chart key); "inherit" (no link) means the part transcribes
    // against the master mix.
    const stems = sources.filter(source => source.kind === 'stem');
    const sourceOptions = selected => ['<option value="">— master mix —</option>']
        .concat(stems.map(source => `<option value="${_editorEscHtml(source.id)}"${source.id === selected ? ' selected' : ''}>${_editorEscHtml(source.name)}</option>`)).join('');
    const guide = sources.find(source => source.id === model.tempoGuideSourceId) || sources[0] || { name: 'No guide' };
    // Per-part M/S/fader — the SAME canonical partMix the mixer panel owns
    // (band-mode gains ramp off it live). Audio rows carry no strips yet:
    // stem playback is the engine slice; strips arrive with it.
    const mixControls = row => {
        if (!row.mixKey || row.type !== 'transcription') return '';
        const key = _editorEscHtml(row.mixKey);
        const st = _mixerPartStatePure(S.partMix, row.mixKey);
        return `<button class="editor-track-ms" data-track-action="mix-mute" data-mix-key="${key}" aria-pressed="${st.mute}" title="Mute track">M</button>`
            + `<button class="editor-track-ms" data-track-action="mix-solo" data-mix-key="${key}" aria-pressed="${st.solo}" title="Solo track">S</button>`
            + `<input class="editor-track-fader" type="range" min="0" max="100" step="1" value="${st.vol}" data-track-action="mix-vol" data-mix-key="${key}" aria-label="${_editorEscHtml(row.name)} fader level">`;
    };
    const resizeGrip = row => `<span class="editor-track-resize" data-track-action="resize" data-track-id="${_editorEscHtml(row.id)}" title="Drag to resize track"></span>`;
    const trackName = (row, markup) => renamingTrackId === row.id
        ? _trackRenameEditorMarkupPure(row.id, row.name)
        : markup;
    const guideMode = model.tempoGuideMode === 'metronome' ? ' · Click' : '';
    el.innerHTML = `<div class="editor-track-session-head"><strong>Tracks</strong><button data-track-action="folder" title="Create optional folder">+ Folder</button><span class="editor-track-guide-label">Guide</span><button class="editor-track-guide-source" data-track-action="guide-cycle" title="Cycle tempo guide">${_editorEscHtml(guide.name + guideMode)}</button><button data-track-action="guide-lock" aria-pressed="${model.tempoGuideLocked}" title="Lock tempo guide — assisted mapping (G) analyzes the locked guide">${model.tempoGuideLocked ? '🔒' : '🔓'}</button><button data-track-action="zoom-out" title="Reduce all track heights">−</button><button data-track-action="zoom-in" title="Increase all track heights">+</button></div><div class="editor-track-session-list">${rows.map(row => {
        const trackId = _editorEscHtml(row.id); const name = _editorEscHtml(row.name); const indent = Math.min(5, row.depth) * 14;
        const height = fittedHeights[row.id];
        const style = `--track-indent:${indent}px;--track-row-height:${height}px`;
        const selected = row.id === S.selectedTrackId ? ' editor-track-selected' : '';
        if (row.type === 'folder') return `<div class="editor-track-row editor-track-folder${selected}" draggable="true" data-track-id="${trackId}" style="${style}"><button data-track-action="collapse" data-track-id="${trackId}">${row.collapsed ? '›' : '⌄'}</button>${trackName(row, `<span class="editor-track-name">${name}</span>`)}${resizeGrip(row)}</div>`;
        if (row.type === 'audio') return `<div class="editor-track-row${selected}${row.sourceId === model.tempoGuideSourceId ? ' editor-track-guide' : ''}" draggable="true" data-track-id="${trackId}" style="${style}"><span class="editor-track-kind">${row.sourceKind === 'master' ? 'MIX' : 'AUD'}</span>${trackName(row, `<span class="editor-track-name">${name}</span>`)}<button data-track-action="guide-set" data-source-id="${_editorEscHtml(row.sourceId)}" title="Use for tempo">${row.sourceId === model.tempoGuideSourceId ? '★' : '☆'}</button>${resizeGrip(row)}</div>`;
        return `<div class="editor-track-row editor-track-transcription${selected}" draggable="true" data-track-id="${trackId}" style="${style}"><span class="editor-track-kind">${row.targetId === DRUM_TARGET_ID ? 'DRM' : 'MIDI'}</span>${trackName(row, `<button class="editor-track-name" data-track-action="select" data-target-id="${_editorEscHtml(row.targetId)}" title="Double-click to open editor">${name}</button>`)}${mixControls(row)}<select data-track-action="pair" data-track-id="${trackId}" data-target-id="${_editorEscHtml(row.targetId)}" aria-label="Audio reference for ${name}">${sourceOptions(row.pairedSourceId)}</select>${resizeGrip(row)}</div>`;
    }).join('')}</div>`;
    const list = el.querySelector('.editor-track-session-list');
    if (list) list.scrollTop = Math.max(0, Number(S.trackScrollY) || 0);
    const renameInput = el.querySelector('[data-track-rename-input]');
    if (renameInput) { renameInput.focus(); renameInput.select(); }
}

export function refreshTrackSession() {
    const key = JSON.stringify([S.trackSession, S.selectedTrackId, S.stems, S.stemLinks, S.partMix, S.trackHeights, S.trackViewportHeight,
        (S.arrangements || []).map(a => a && [a.id, a.name]), S.drumTab && S.drumTab.name]);
    if (key === lastRender) return;
    lastRender = key; render();
}
export function refreshTrackSessionSelection() {
    lastRender = '';
    refreshTrackSession();
}
function refreshTrackSelectionClass() {
    const el = panel();
    if (!el) return;
    for (const row of el.querySelectorAll('.editor-track-row[data-track-id]')) {
        row.classList.toggle('editor-track-selected', row.getAttribute('data-track-id') === S.selectedTrackId);
    }
}

function commit(next, status) {
    S.trackSession = _trackSessionNormalizePure(next, _liveSources(), S.arrangements, S.drumTab);
    markSessionDirty(); lastRender = ''; refreshTrackSession();
    if (status) setStatus(status);
    host.draw();
}

// Rename: canonical names stay canonical — a transcription rename writes the
// arrangement / drum-tab name (what the game shows), while audio and folder
// rows keep a display override on the TREE only (a stem's id is its identity
// in the manifest; renaming that is the stem manager's backend op).
function applyTrackRename(trackId, requested) {
    if (!requested || !requested.trim()) return false;
    const clean = requested.trim().slice(0, 120);
    const next = _trackSessionRenamePure(S.trackSession, trackId, clean, _liveSources(), S.arrangements, S.drumTab);
    const renamed = next.tracks.find(track => track.id === trackId);
    if (!renamed) return false;
    if (renamed.type === 'transcription') {
        if (renamed.targetId === DRUM_TARGET_ID && S.drumTab) S.drumTab.name = clean;
        const targets = _trackSessionTargetsPure(S.arrangements, S.drumTab);
        const target = targets.find(item => item.id === renamed.targetId);
        const index = target && target.mixKey.startsWith('arr:') ? Number(target.mixKey.slice(4)) : -1;
        if (index >= 0 && S.arrangements[index]) S.arrangements[index].name = clean;
        // The canonical name IS the display name — drop the tree override so
        // the row keeps following the arrangement.
        renamed.name = '';
    }
    commit(next, `${renamed.type === 'folder' ? 'Folder' : 'Track'} renamed to ${clean}.`);
    _mixerPanelRefresh();
    host.updateArrangementSelector();
    return true;
}

function selectTrack(trackId, openEditor = false) {
    const row = _rowsLive().rows.find(item => item.id === trackId);
    if (!row) return false;
    S.selectedTrackId = row.id;
    if (row.type === 'audio') {
        S.focusedSourceId = row.sourceId;
        setStatus(`Audio track selected: ${row.name}`);
    } else if (row.type === 'transcription') {
        S.focusedSourceId = row.pairedSourceId || S.trackSession.tempoGuideSourceId;
        host.selectTrackSessionTarget(row.targetId);
        if (openEditor) host.openTrackSessionTarget(row.targetId);
        setStatus(openEditor ? `Opened ${row.name} in the editor.` : `Transcription track selected: ${row.name}`);
    } else setStatus(`Folder selected: ${row.name}`);
    // Keep the row DOM stable between the two clicks of a double-click: a
    // full rerender changes the event target and some browsers never
    // deliver dblclick — selection only needs a class update here.
    refreshTrackSelectionClass();
    host.draw();
    return true;
}

async function deleteTrack(trackId) {
    const row = _rowsLive().rows.find(item => item.id === trackId);
    if (!row) return false;
    if (row.type === 'folder') {
        if (!confirm(`Delete folder “${row.name}”? Its tracks will move to the folder's parent level.`)) return false;
        commit(_trackSessionDeletePure(S.trackSession, row.id, _liveSources(), S.arrangements, S.drumTab), `Deleted folder “${row.name}”; its tracks were kept.`);
    } else if (row.type === 'audio') {
        if (!confirm(`Remove audio track “${row.name}” from this session? The media stays in the pack and can come back.`)) return false;
        // Non-destructive: a tombstone in removedSourceIds, never a file op.
        commit(_trackSessionDeletePure(S.trackSession, row.id, _liveSources(), S.arrangements, S.drumTab),
            `Removed audio track “${row.name}” — the media stays inside the project.`);
        host.partMixChanged();
    } else if (row.targetId === DRUM_TARGET_ID) {
        if (!confirm(`Delete drum transcription “${row.name}”?`)) return false;
        S.drumTab = null;
        S.drumTabDirty = true;
        delete S.partMix.drums;
        if (S.history) S.history.reset();
        commit(S.trackSession, `Deleted drum transcription “${row.name}”.`);
    } else {
        const targets = _trackSessionTargetsPure(S.arrangements, S.drumTab);
        const target = targets.find(item => item.id === row.targetId);
        const index = target && target.mixKey.startsWith('arr:') ? Number(target.mixKey.slice(4)) : -1;
        if (index < 0) return false;
        if (S.arrangements.length <= 1) {
            setStatus('A feedpak requires at least one transcription arrangement; add another before deleting this track.');
            return false;
        }
        S.currentArr = index;
        const removed = await window.editorRemoveArrangement();
        if (!removed) return false;
        S.partMix = {};
        S.trackSession = _trackSessionNormalizePure(S.trackSession, _liveSources(), S.arrangements, S.drumTab);
        lastRender = '';
        refreshTrackSession();
    }
    if (S.selectedTrackId === row.id) S.selectedTrackId = '';
    _mixerPanelRefresh();
    host.draw();
    return true;
}

// Pairing writes S.stemLinks (the ONE pairing store) and syncs the backend
// session via /stem-op op 'links' — the same atomic-snapshot contract the
// stem manager uses. Inlined here (not imported) because stem-tracks already
// imports this module: seams, not cycles.
async function _syncPairing(targetId, sourceId, verb) {
    let links = { ...(S.stemLinks || {}) };
    delete links[targetId];
    if (sourceId) links[targetId] = sourceId;
    S.stemLinks = links;
    lastRender = ''; refreshTrackSession();
    if (!S.sessionId || typeof fetch !== 'function') { markSessionDirty(); return; }
    try {
        const resp = await fetch('/api/plugins/editor/stem-op', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ session_id: S.sessionId, op: 'links', stem_links: S.stemLinks || {} }),
        });
        const data = await resp.json();
        if (data.error) throw new Error(data.error);
        S.stems = Array.isArray(data.stems) ? data.stems : S.stems;
        S.stemLinks = (data.stem_links && typeof data.stem_links === 'object') ? data.stem_links : S.stemLinks;
        if (!data.persisted) markSessionDirty();
        lastRender = ''; refreshTrackSession();
        if (host.stemUiChanged) host.stemUiChanged();
        setStatus(verb);
    } catch (e) {
        markSessionDirty();
        setStatus(`Pairing sync failed: ${e.message} — the pairing is kept and ships with the next Save.`);
    }
}

export function scrollTrackSessionBy(deltaY) {
    const el = panel();
    const list = el && el.querySelector('.editor-track-session-list');
    if (!list) return false;
    list.scrollTop = Math.max(0, list.scrollTop + deltaY);
    S.trackScrollY = list.scrollTop;
    host.draw();
    return true;
}

export function initTrackSession() {
    const el = panel();
    if (!el || el.__trackSessionWired) return;
    el.__trackSessionWired = true;
    let storedWidth = 0;
    try { storedWidth = Number(localStorage.getItem('editorTrackHeaderWidth')) || 0; } catch (_) { /* blocked */ }
    applyTrackHeaderWidth(storedWidth || S.trackHeaderWidth);
    const splitter = document.getElementById('editor-track-session-splitter');
    if (splitter && !splitter.__trackSplitterWired) {
        splitter.__trackSplitterWired = true;
        splitter.addEventListener('pointerdown', event => {
            event.preventDefault();
            const startX = event.clientX; const startWidth = S.trackHeaderWidth;
            splitter.classList.add('is-dragging');
            const move = moveEvent => {
                applyTrackHeaderWidth(startWidth + moveEvent.clientX - startX);
                host.resizeCanvas();
            };
            const up = () => {
                window.removeEventListener('pointermove', move);
                window.removeEventListener('pointerup', up);
                splitter.classList.remove('is-dragging');
                applyTrackHeaderWidth(S.trackHeaderWidth, true);
                host.resizeCanvas();
            };
            window.addEventListener('pointermove', move);
            window.addEventListener('pointerup', up, { once: true });
        });
    }
    el.addEventListener('click', event => {
        const clickedRow = event.target && event.target.closest ? event.target.closest('.editor-track-row[data-track-id]') : null;
        if (clickedRow && !event.target.closest('[data-track-rename-input]')) selectTrack(clickedRow.getAttribute('data-track-id') || '');
        const control = event.target && event.target.closest ? event.target.closest('[data-track-action]') : null;
        if (!control) return;
        const action = control.getAttribute('data-track-action');
        if (action === 'resize') return;
        if (action === 'mix-mute' || action === 'mix-solo') {
            mixerTogglePart(control.getAttribute('data-mix-key') || '', action === 'mix-mute' ? 'mute' : 'solo');
            lastRender = '';
            refreshTrackSession();
            return;
        }
        if (action === 'rename') {
            const trackId = control.getAttribute('data-track-id') || '';
            const menu = control.closest('.editor-track-context-menu');
            if (menu) menu.remove();
            if (!(S.trackSession.tracks || []).some(track => track.id === trackId)) return;
            renamingTrackId = trackId;
            lastRender = ''; refreshTrackSession();
            return;
        }
        if (action === 'delete') {
            const trackId = control.getAttribute('data-track-id') || '';
            const menu = control.closest('.editor-track-context-menu');
            if (menu) menu.remove();
            deleteTrack(trackId);
            return;
        }
        if (action === 'metronome-guide') {
            const trackId = control.getAttribute('data-track-id') || '';
            const menu = control.closest('.editor-track-context-menu');
            if (menu) menu.remove();
            const track = (S.trackSession.tracks || []).find(item => item.id === trackId && item.type === 'audio');
            if (track) {
                const locked = editorToggleTempoGuide(track.sourceId, 'metronome');
                setStatus(locked
                    ? 'Locked as the metronome guide — assisted tempo mapping (G) analyzes this track.'
                    : 'Metronome guide unlocked — assisted mapping analyzes the main recording again.');
            }
            return;
        }
        if (action === 'folder') {
            commit(_trackSessionCreateFolderPure(S.trackSession, _liveSources(), S.arrangements, S.drumTab, ''), 'Folder added — drag tracks to arrange the session.');
        } else if (action === 'zoom-in' || action === 'zoom-out') {
            const delta = action === 'zoom-in' ? 8 : -8;
            const rows = _rowsLive().rows;
            const next = { ...(S.trackHeights || {}) };
            for (const row of rows) next[row.id] = _trackSessionLaneHeightPure(next, row.id) + delta;
            S.trackHeights = next; lastRender = ''; refreshTrackSession(); host.draw();
        } else if (action === 'collapse') {
            const trackId = control.getAttribute('data-track-id') || '';
            const next = _trackSessionNormalizePure(S.trackSession, _liveSources(), S.arrangements, S.drumTab);
            const folder = next.tracks.find(track => track.id === trackId && track.type === 'folder');
            if (folder) { folder.collapsed = !folder.collapsed; commit(next); }
        } else if (action === 'guide-lock') {
            const next = _trackSessionNormalizePure(S.trackSession, _liveSources(), S.arrangements, S.drumTab);
            next.tempoGuideLocked = !next.tempoGuideLocked;
            commit(next, next.tempoGuideLocked
                ? 'Tempo guide locked — assisted mapping (G) analyzes the guide track.'
                : 'Tempo guide unlocked — assisted mapping analyzes the session recording.');
        } else if (action === 'guide-cycle' || action === 'guide-set') {
            const next = _trackSessionNormalizePure(S.trackSession, _liveSources(), S.arrangements, S.drumTab);
            const sources = _liveSources().filter(source => !next.removedSourceIds.includes(source.id));
            if (!sources.length) return;
            if (action === 'guide-set') {
                next.tempoGuideSourceId = control.getAttribute('data-source-id') || MASTER_ID;
            } else {
                const at = sources.findIndex(source => source.id === next.tempoGuideSourceId);
                next.tempoGuideSourceId = sources[(at + 1) % sources.length].id;
            }
            const chosen = sources.find(source => source.id === next.tempoGuideSourceId);
            commit(next, `Tempo guide: ${chosen ? chosen.name : next.tempoGuideSourceId}.`);
        }
    });
    el.addEventListener('dblclick', event => {
        if (event.target && event.target.closest && event.target.closest('select,input,[data-track-action="resize"]')) return;
        const row = event.target && event.target.closest ? event.target.closest('.editor-track-row[data-track-id]') : null;
        if (!row) return;
        const track = (S.trackSession.tracks || []).find(item => item.id === row.getAttribute('data-track-id'));
        if (track && track.type === 'transcription') selectTrack(track.id, true);
        else if (track) selectTrack(track.id);
    });
    el.addEventListener('input', event => {
        const range = event.target && event.target.matches && event.target.matches('[data-track-action="mix-vol"]') ? event.target : null;
        if (!range) return;
        mixerSetPart(range.getAttribute('data-mix-key') || '', { vol: Number(range.value) });
    });
    el.addEventListener('change', event => {
        const select = event.target && event.target.matches && event.target.matches('[data-track-action="pair"]') ? event.target : null;
        if (!select) return;
        const targetId = select.getAttribute('data-target-id') || '';
        _syncPairing(targetId, select.value || '', select.value
            ? 'Paired transcription with its studio track — saved with the song.'
            : 'Transcription follows the master mix.');
    });
    el.addEventListener('scroll', event => {
        const list = event.target && event.target.matches && event.target.matches('.editor-track-session-list') ? event.target : null;
        if (!list) return;
        S.trackScrollY = list.scrollTop;
        host.draw();
    }, true);
    el.addEventListener('keydown', event => {
        const input = event.target && event.target.matches && event.target.matches('[data-track-rename-input]') ? event.target : null;
        if (!input || (event.key !== 'Enter' && event.key !== 'Escape')) return;
        event.preventDefault();
        const trackId = input.getAttribute('data-track-id') || '';
        const value = input.value;
        renamingTrackId = ''; lastRender = '';
        if (event.key === 'Enter') { if (!applyTrackRename(trackId, value)) refreshTrackSession(); }
        else refreshTrackSession();
    });
    el.addEventListener('focusout', event => {
        const input = event.target && event.target.matches && event.target.matches('[data-track-rename-input]') ? event.target : null;
        if (!input || !renamingTrackId) return;
        const trackId = input.getAttribute('data-track-id') || ''; const value = input.value;
        renamingTrackId = ''; lastRender = '';
        if (!applyTrackRename(trackId, value)) refreshTrackSession();
    });
    el.addEventListener('pointerdown', event => {
        // Any click outside the context menu dismisses it.
        const menu = document.getElementById('editor-track-context-menu');
        if (menu && !(event.target && menu.contains(event.target))) menu.remove();
        const renameInput = event.target && event.target.closest ? event.target.closest('[data-track-rename-input]') : null;
        if (renameInput) {
            // A track row is draggable. Keep text-selection gestures inside
            // the editor instead of letting the row or desktop shell claim them.
            event.stopPropagation();
            return;
        }
        const grip = event.target && event.target.closest ? event.target.closest('[data-track-action="resize"]') : null;
        if (!grip) return;
        event.preventDefault();
        const trackId = grip.getAttribute('data-track-id') || '';
        const startY = event.clientY;
        const startH = _trackSessionLaneHeightPure(S.trackHeights, trackId);
        const move = moveEvent => {
            S.trackHeights = { ...(S.trackHeights || {}), [trackId]: startH + moveEvent.clientY - startY };
            lastRender = ''; refreshTrackSession(); host.draw();
        };
        const up = () => {
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', up);
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up, { once: true });
    });
    const clearDropTarget = () => {
        for (const row of el.querySelectorAll('.editor-track-drop-before,.editor-track-drop-after,.editor-track-drop-inside')) {
            row.classList.remove('editor-track-drop-before', 'editor-track-drop-after', 'editor-track-drop-inside');
        }
    };
    const dropInfo = event => {
        const row = event.target && event.target.closest ? event.target.closest('[data-track-id]') : null;
        if (!row) return null;
        const rect = row.getBoundingClientRect();
        const track = (S.trackSession.tracks || []).find(item => item.id === row.getAttribute('data-track-id'));
        return { row, id: row.getAttribute('data-track-id') || '', placement: _trackSessionDropPlacementPure(event.clientY, rect.top, rect.height, track && track.type === 'folder') };
    };
    el.addEventListener('dragstart', event => {
        const renameInput = event.target && event.target.closest ? event.target.closest('[data-track-rename-input]') : null;
        if (renameInput) {
            event.preventDefault(); event.stopPropagation(); draggedId = '';
            return;
        }
        const row = event.target && event.target.closest ? event.target.closest('[data-track-id]') : null;
        draggedId = row ? row.getAttribute('data-track-id') || '' : '';
    });
    el.addEventListener('dragover', event => {
        if (!draggedId) return;
        event.preventDefault(); clearDropTarget();
        const info = dropInfo(event);
        if (info && info.id !== draggedId) info.row.classList.add('editor-track-drop-' + info.placement);
    });
    el.addEventListener('dragleave', event => { if (!el.contains(event.relatedTarget)) clearDropTarget(); });
    el.addEventListener('dragend', () => { draggedId = ''; clearDropTarget(); });
    el.addEventListener('drop', event => {
        event.preventDefault();
        const info = dropInfo(event); clearDropTarget();
        if (draggedId && info && info.id && draggedId !== info.id) {
            commit(_trackSessionMovePure(S.trackSession, draggedId, info.id, info.placement,
                _liveSources(), S.arrangements, S.drumTab), 'Track and folder order saved with the song.');
        }
        draggedId = '';
    });
    el.addEventListener('contextmenu', event => {
        const row = event.target && event.target.closest ? event.target.closest('[data-track-id]') : null;
        if (!row) return;
        event.preventDefault();
        const trackId = row.getAttribute('data-track-id') || '';
        selectTrack(trackId);
        let menu = document.getElementById('editor-track-context-menu');
        if (!menu) {
            menu = document.createElement('div');
            menu.id = 'editor-track-context-menu';
            menu.className = 'editor-track-context-menu';
            el.appendChild(menu);
        }
        const track = (S.trackSession.tracks || []).find(item => item.id === trackId);
        const guideState = editorTempoGuideState();
        const isGuide = track && track.type === 'audio' && guideState.locked
            && guideState.sourceId === track.sourceId && guideState.mode === 'metronome';
        const metronome = track && track.type === 'audio'
            ? `<button data-track-action="metronome-guide" data-track-id="${_editorEscHtml(trackId)}">${isGuide ? 'Unlock Metronome Guide' : 'Use as Metronome Guide'}</button>` : '';
        const deleteLabel = track && track.type === 'folder' ? 'Delete Folder'
            : track && track.type === 'audio' ? 'Remove Track (keep media)' : 'Delete Track';
        menu.innerHTML = `<button data-track-action="rename" data-track-id="${_editorEscHtml(trackId)}">Rename</button>${metronome}<button class="editor-track-delete" data-track-action="delete" data-track-id="${_editorEscHtml(trackId)}">${deleteLabel}</button>`;
        menu.style.left = `${event.clientX}px`;
        menu.style.top = `${event.clientY}px`;
    });
}
