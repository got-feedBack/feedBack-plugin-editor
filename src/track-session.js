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
import { _partViewKeyPure } from './keys.js';
import { S, markSessionDirty } from './state.js';

const MASTER_ID = 'master';
const DRUM_TARGET_ID = 'drums';
const VERSION = 2;
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
    S.trackSession = _trackSessionNormalizePure(raw, sources, S.arrangements, S.drumTab);
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
