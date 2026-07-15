/* Source-aware DAW track-session model and left-side track header. */
import { host } from './host.js';
import { S, markSessionDirty } from './state.js';
import { _editorEscHtml, setStatus } from './ui.js';
import { _mixerPanelRefresh, _mixerPartStatePure, mixerSetPart, mixerTogglePart } from './mixer-panel.js';

const MASTER_ID = 'master';
const DRUM_TARGET_ID = 'drums';
const VERSION = 2;
const TRACK_LANE_DEFAULT = 56;
const TRACK_LANE_MIN = 28;
const TRACK_LANE_MAX = 160;
const idOf = (value) => typeof value === 'string' && value.length > 0 && value.length <= 160 ? value : '';
const audioTrackId = (sourceId) => 'audio:' + sourceId;
const transcriptionTrackId = (targetId) => 'transcription:' + targetId;

/* @pure:track-session:start */
function _trackSessionSourcesPure(rawSources) {
    const seen = new Set();
    const out = [];
    for (const raw of (Array.isArray(rawSources) ? rawSources : [])) {
        const id = idOf(raw && raw.id);
        if (!id || seen.has(id)) continue;
        seen.add(id);
        out.push({
            id,
            name: String((raw && raw.name) || (id === MASTER_ID ? 'Master Mix' : id)).slice(0, 120),
            kind: raw && raw.kind === 'stem' ? 'stem' : 'master',
            url: typeof (raw && raw.url) === 'string' ? raw.url : '',
            offset: Number.isFinite(Number(raw && raw.offset)) ? Number(raw.offset) : 0,
        });
    }
    if (!seen.has(MASTER_ID)) out.unshift({ id: MASTER_ID, name: 'Master Mix', kind: 'master', url: '', offset: 0 });
    return out;
}

function _trackSessionTargetsPure(arrangements, drumTab) {
    const out = [];
    (Array.isArray(arrangements) ? arrangements : []).forEach((arr, index) => {
        if (!arr) return;
        const stable = idOf(arr.id);
        out.push({
            id: stable || 'arr:' + index,
            name: String(arr.name || ('Track ' + (index + 1))).slice(0, 120),
            mixKey: 'arr:' + index,
        });
    });
    if (drumTab && Array.isArray(drumTab.hits)) {
        out.push({ id: DRUM_TARGET_ID, name: String(drumTab.name || 'Drums').slice(0, 120), mixKey: 'drums' });
    }
    return out;
}

function _trackSessionNormalizePure(raw, rawSources, arrangements, drumTab) {
    const sources = _trackSessionSourcesPure(rawSources);
    const targets = _trackSessionTargetsPure(arrangements, drumTab);
    const knownSources = new Set(sources.map(s => s.id));
    const knownTargets = new Set(targets.map(t => t.id));
    const input = raw && typeof raw === 'object' ? raw : {};
    const removedSourceIds = [...new Set((Array.isArray(input.removedSourceIds) ? input.removedSourceIds : [])
        .map(idOf).filter(sourceId => knownSources.has(sourceId)))];
    const removedSources = new Set(removedSourceIds);
    const visibleSources = sources.filter(source => !removedSources.has(source.id));
    const visibleSourceIds = new Set(visibleSources.map(source => source.id));
    const tracks = [];
    const seen = new Set();
    const sourceLeaves = new Set();
    const targetLeaves = new Set();
    for (const item of (Array.isArray(input.tracks) ? input.tracks : []).slice(0, 300)) {
        if (!item || typeof item !== 'object') continue;
        const id = idOf(item.id);
        if (!id || seen.has(id) || !['folder', 'audio', 'transcription'].includes(item.type)) continue;
        if (item.type === 'folder') {
            tracks.push({ id, type: 'folder', name: String(item.name || 'Folder').slice(0, 120), parentId: idOf(item.parentId), collapsed: !!item.collapsed });
        } else if (item.type === 'audio') {
            const sourceId = idOf(item.sourceId);
            if (!visibleSourceIds.has(sourceId) || sourceLeaves.has(sourceId)) continue;
            sourceLeaves.add(sourceId);
            tracks.push({ id, type: 'audio', sourceId, name: String(item.name || '').slice(0, 120), parentId: idOf(item.parentId) });
        } else {
            const targetId = idOf(item.targetId);
            const pairedSourceId = idOf(item.pairedSourceId);
            if (!knownTargets.has(targetId) || targetLeaves.has(targetId)) continue;
            targetLeaves.add(targetId);
            tracks.push({ id, type: 'transcription', targetId, name: String(item.name || '').slice(0, 120), parentId: idOf(item.parentId), pairedSourceId: visibleSourceIds.has(pairedSourceId) ? pairedSourceId : '' });
        }
        seen.add(id);
    }
    for (const source of visibleSources) if (!sourceLeaves.has(source.id)) {
        const id = audioTrackId(source.id);
        if (!seen.has(id)) { tracks.push({ id, type: 'audio', sourceId: source.id, parentId: '' }); seen.add(id); }
    }
    for (const target of targets) if (!targetLeaves.has(target.id)) {
        const id = transcriptionTrackId(target.id);
        if (!seen.has(id)) { tracks.push({ id, type: 'transcription', targetId: target.id, parentId: '', pairedSourceId: '' }); seen.add(id); }
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

function _trackSessionRowsPure(session, rawSources, arrangements, drumTab) {
    const model = _trackSessionNormalizePure(session, rawSources, arrangements, drumTab);
    const removedSources = new Set(model.removedSourceIds);
    const sources = new Map(_trackSessionSourcesPure(rawSources).filter(source => !removedSources.has(source.id)).map(s => [s.id, s]));
    const targets = new Map(_trackSessionTargetsPure(arrangements, drumTab).map(t => [t.id, t]));
    const children = new Map();
    for (const track of model.tracks) {
        const list = children.get(track.parentId) || [];
        list.push(track); children.set(track.parentId, list);
    }
    const rows = [];
    const visit = (parentId, depth) => {
        for (const track of (children.get(parentId) || [])) {
            const source = track.type === 'audio' ? sources.get(track.sourceId) : null;
            const target = track.type === 'transcription' ? targets.get(track.targetId) : null;
            rows.push({
                ...track,
                depth,
                name: track.name || (source || target || {}).name || 'Track',
                sourceKind: source ? source.kind : '',
                mixKey: source ? audioTrackId(source.id) : (target && target.mixKey) || '',
            });
            if (track.type !== 'folder' || !track.collapsed) visit(track.id, depth + 1);
        }
    };
    visit('', 0);
    return { model, rows, sources: [...sources.values()] };
}

function _trackSessionPairPure(session, trackId, sourceId, rawSources, arrangements, drumTab) {
    const model = _trackSessionNormalizePure(session, rawSources, arrangements, drumTab);
    const track = model.tracks.find(t => t.id === trackId && t.type === 'transcription');
    const removed = new Set(model.removedSourceIds);
    const valid = new Set(_trackSessionSourcesPure(rawSources).filter(source => !removed.has(source.id)).map(s => s.id));
    if (track && (!sourceId || valid.has(sourceId))) track.pairedSourceId = sourceId || '';
    return model;
}

function _trackSessionDeletePure(session, trackId, rawSources, arrangements, drumTab) {
    const model = _trackSessionNormalizePure(session, rawSources, arrangements, drumTab);
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
    for (const item of model.tracks) {
        if (item.type === 'transcription' && item.pairedSourceId === track.sourceId) item.pairedSourceId = '';
    }
    if (model.tempoGuideSourceId === track.sourceId) {
        const remaining = _trackSessionSourcesPure(rawSources)
            .find(source => !model.removedSourceIds.includes(source.id));
        model.tempoGuideSourceId = remaining ? remaining.id : '';
        model.tempoGuideLocked = false;
        model.tempoGuideMode = 'audio';
    }
    return model;
}

function _trackSessionMovePure(session, movedId, targetId, placement, rawSources, arrangements, drumTab) {
    const model = _trackSessionNormalizePure(session, rawSources, arrangements, drumTab);
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

function _trackSessionMoveBeforePure(session, movedId, targetId, rawSources, arrangements, drumTab) {
    const target = _trackSessionNormalizePure(session, rawSources, arrangements, drumTab).tracks.find(t => t.id === targetId);
    return _trackSessionMovePure(session, movedId, targetId, target && target.type === 'folder' ? 'inside' : 'before', rawSources, arrangements, drumTab);
}

function _trackSessionDropPlacementPure(pointerY, rowTop, rowHeight, isFolder) {
    const h = Math.max(1, Number(rowHeight) || 1);
    const ratio = Math.max(0, Math.min(1, ((Number(pointerY) || 0) - (Number(rowTop) || 0)) / h));
    if (isFolder && ratio >= .25 && ratio <= .75) return 'inside';
    return ratio < .5 ? 'before' : 'after';
}

function _trackSessionCreateFolderPure(session, rawSources, arrangements, drumTab, name) {
    const model = _trackSessionNormalizePure(session, rawSources, arrangements, drumTab);
    let n = 1;
    const used = new Set(model.tracks.map(t => t.id));
    while (used.has('folder:' + n)) n++;
    model.tracks.push({ id: 'folder:' + n, type: 'folder', name: String(name || 'Folder').slice(0, 120), parentId: '', collapsed: false });
    return model;
}

function _trackSessionRenamePure(session, trackId, name, rawSources, arrangements, drumTab) {
    const model = _trackSessionNormalizePure(session, rawSources, arrangements, drumTab);
    const track = model.tracks.find(item => item.id === trackId);
    const clean = String(name || '').trim().slice(0, 120);
    if (track && clean) track.name = clean;
    return model;
}
function _trackSessionLaneHeightPure(heights, trackId) {
    const value = Number(heights && heights[trackId]);
    return Number.isFinite(value)
        ? Math.max(TRACK_LANE_MIN, Math.min(TRACK_LANE_MAX, Math.round(value)))
        : TRACK_LANE_DEFAULT;
}
function _trackSessionDensityPure(width) {
    const value = Number(width) || 0;
    return value < 230 ? 'compact' : value < 400 ? 'normal' : 'wide';
}
function _trackSessionFittedHeightsPure(rows, heights, viewportHeight) {
    const fitted = {};
    let total = 0;
    for (const row of (rows || [])) {
        fitted[row.id] = _trackSessionLaneHeightPure(heights, row.id);
        total += fitted[row.id];
    }
    const spare = Math.max(0, (Number(viewportHeight) || 0) - total);
    if (!rows || !rows.length || spare <= 0) return fitted;
    // Logic-style auto-fit, deliberately modest: use spare height to improve
    // readability but cap the automatic bonus so a two-track song does not
    // turn into two enormous empty slabs.
    const bonus = Math.min(32, Math.floor(spare / rows.length));
    for (const row of rows) fitted[row.id] = Math.min(TRACK_LANE_MAX, fitted[row.id] + bonus);
    return fitted;
}
function _trackSessionLaneLayoutPure(rows, heights, scrollY = 0, top = 40) {
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
function _trackRenameEditorMarkupPure(trackId, currentName) {
    const id = _editorEscHtml(trackId);
    const name = _editorEscHtml(currentName);
    return `<input class="editor-track-inline-rename" data-track-rename-input data-track-id="${id}" value="${name}" draggable="false" aria-label="New track or folder name">`;
}
/* @pure:track-session:end */

export { _trackRenameEditorMarkupPure, _trackSessionCreateFolderPure, _trackSessionDeletePure, _trackSessionDensityPure, _trackSessionDropPlacementPure, _trackSessionFittedHeightsPure, _trackSessionLaneHeightPure, _trackSessionLaneLayoutPure, _trackSessionMoveBeforePure, _trackSessionMovePure, _trackSessionNormalizePure, _trackSessionPairPure, _trackSessionRenamePure, _trackSessionRowsPure, _trackSessionSourcesPure, _trackSessionTargetsPure };

let lastRender = '';
let draggedId = '';
let renamingTrackId = '';
const panel = () => document.getElementById('editor-track-session');

function applyTrackHeaderWidth(width, persist = false) {
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

export function installTrackSession(raw, sources) {
    S.audioSources = _trackSessionSourcesPure(sources);
    S.trackSession = _trackSessionNormalizePure(raw, S.audioSources, S.arrangements, S.drumTab);
    S.focusedSourceId = S.trackSession.tempoGuideSourceId;
    S.selectedTrackId = '';
    S.trackScrollY = 0;
    S.partsViewMode = S.trackSession.tracks.length > 0;
    lastRender = '';
    refreshTrackSession();
    host.syncAudioTrackSources(S.audioSources);
}
export function trackSessionSavePayload() { return _trackSessionNormalizePure(S.trackSession, S.audioSources, S.arrangements, S.drumTab); }

function commit(next, status) {
    S.trackSession = _trackSessionNormalizePure(next, S.audioSources, S.arrangements, S.drumTab);
    markSessionDirty(); lastRender = ''; refreshTrackSession();
    if (status) setStatus(status);
}

function applyTrackRename(trackId, requested) {
    if (!requested || !requested.trim()) return false;
    const clean = requested.trim().slice(0, 120);
    const next = _trackSessionRenamePure(S.trackSession, trackId, clean, S.audioSources, S.arrangements, S.drumTab);
    const renamed = next.tracks.find(track => track.id === trackId);
    if (!renamed) return false;
    if (renamed.type === 'audio') {
        const source = (S.audioSources || []).find(item => item.id === renamed.sourceId);
        if (source) source.name = clean;
    } else if (renamed.type === 'transcription') {
        if (renamed.targetId === DRUM_TARGET_ID && S.drumTab) S.drumTab.name = clean;
        const index = (S.arrangements || []).findIndex((arr, i) => (idOf(arr && arr.id) || 'arr:' + i) === renamed.targetId);
        if (index >= 0) S.arrangements[index].name = clean;
    }
    // Folder names intentionally live only in track_session. All three track
    // types still share this command and the same inline editor.
    commit(next, `${renamed.type === 'folder' ? 'Folder' : 'Track'} renamed to ${clean}.`);
    _mixerPanelRefresh();
    return true;
}

function refreshTrackSelectionClass() {
    const el = panel();
    if (!el) return;
    for (const row of el.querySelectorAll('.editor-track-row[data-track-id]')) {
        row.classList.toggle('editor-track-selected', row.getAttribute('data-track-id') === S.selectedTrackId);
    }
}

function selectTrack(trackId, openEditor = false) {
    const row = _trackSessionRowsPure(S.trackSession, S.audioSources, S.arrangements, S.drumTab)
        .rows.find(item => item.id === trackId);
    if (!row) return false;
    S.selectedTrackId = row.id;
    if (row.type === 'audio') {
        S.focusedSourceId = row.sourceId;
        host.selectTrackSessionSource(row.sourceId);
        setStatus(`Audio track selected: ${row.name}`);
    } else if (row.type === 'transcription') {
        const track = S.trackSession.tracks.find(item => item.id === row.id);
        S.focusedSourceId = (track && track.pairedSourceId) || S.trackSession.tempoGuideSourceId;
        if (S.focusedSourceId) host.selectTrackSessionSource(S.focusedSourceId);
        host.selectTrackSessionTarget(row.targetId);
        if (openEditor) host.openTrackSessionTarget(row.targetId);
        setStatus(openEditor ? `Opened ${row.name} in the editor.` : `Transcription track selected: ${row.name}`);
    } else setStatus(`Folder selected: ${row.name}`);
    // Keep the row DOM stable between the two clicks of a double-click. A full
    // rerender after click one changes the event target and some browsers never
    // deliver dblclick; selection only needs a class update here.
    refreshTrackSelectionClass();
    host.draw();
    return true;
}

async function deleteTrack(trackId) {
    const row = _trackSessionRowsPure(S.trackSession, S.audioSources, S.arrangements, S.drumTab)
        .rows.find(item => item.id === trackId);
    if (!row) return false;
    if (row.type === 'folder') {
        if (!confirm(`Delete folder “${row.name}”? Its tracks will move to the folder's parent level.`)) return false;
        commit(_trackSessionDeletePure(S.trackSession, row.id, S.audioSources, S.arrangements, S.drumTab), `Deleted folder “${row.name}”; its tracks were kept.`);
    } else if (row.type === 'audio') {
        if (!confirm(`Delete audio track “${row.name}” from this arrangement? The source media remains inside the project.`)) return false;
        const next = _trackSessionDeletePure(S.trackSession, row.id, S.audioSources, S.arrangements, S.drumTab);
        delete S.partMix['audio:' + row.sourceId];
        commit(next, `Deleted audio track “${row.name}” from the arrangement.`);
        if (next.tempoGuideSourceId) host.selectTrackSessionSource(next.tempoGuideSourceId);
        else {
            S.audioBuffer = null;
            S.audioUrl = null;
            S.waveformPeaks = null;
            S.activeAudioSourceId = '';
            S.focusedSourceId = '';
        }
        host.syncAudioTrackSources(S.audioSources);
        host.partMixChanged();
    } else if (row.targetId === DRUM_TARGET_ID) {
        if (!confirm(`Delete drum transcription “${row.name}”?`)) return false;
        S.drumTab = null;
        S.drumTabDirty = true;
        delete S.partMix.drums;
        if (S.history) S.history.reset();
        commit(S.trackSession, `Deleted drum transcription “${row.name}”.`);
    } else {
        const index = (S.arrangements || []).findIndex((arr, i) => (idOf(arr && arr.id) || 'arr:' + i) === row.targetId);
        if (index < 0) return false;
        if (S.arrangements.length <= 1) {
            setStatus('A feedpak requires at least one transcription arrangement; add another before deleting this track.');
            return false;
        }
        S.currentArr = index;
        const removed = await window.editorRemoveArrangement();
        if (!removed) return false;
        S.partMix = {};
        S.trackSession = _trackSessionNormalizePure(S.trackSession, S.audioSources, S.arrangements, S.drumTab);
        lastRender = '';
        refreshTrackSession();
    }
    if (S.selectedTrackId === row.id) S.selectedTrackId = '';
    _mixerPanelRefresh();
    host.draw();
    return true;
}

function render() {
    const el = panel();
    if (!el) return;
    const { model, rows, sources } = _trackSessionRowsPure(S.trackSession, S.audioSources, S.arrangements, S.drumTab);
    const fittedHeights = _trackSessionFittedHeightsPure(rows, S.trackHeights, S.trackViewportHeight);
    const sourceOptions = selected => ['<option value="">Guide track (inherit)</option>'].concat(sources.map(source => `<option value="${_editorEscHtml(source.id)}"${source.id === selected ? ' selected' : ''}>${_editorEscHtml(source.name)}</option>`)).join('');
    const guide = sources.find(source => source.id === model.tempoGuideSourceId) || sources[0] || { name: 'No guide' };
    const mixControls = row => {
        const key = _editorEscHtml(row.mixKey);
        const st = _mixerPartStatePure(S.partMix, row.mixKey);
        return `<button class="editor-track-ms" data-track-action="mix-mute" data-mix-key="${key}" aria-pressed="${st.mute}" title="Mute track">M</button>`
            + `<button class="editor-track-ms" data-track-action="mix-solo" data-mix-key="${key}" aria-pressed="${st.solo}" title="Solo track">S</button>`
            + `<input class="editor-track-fader" type="range" min="0" max="106" step="0.1" value="${st.vol}" data-track-action="mix-vol" data-mix-key="${key}" aria-label="${_editorEscHtml(row.name)} fader level">`;
    };
    const resizeGrip = row => `<span class="editor-track-resize" data-track-action="resize" data-track-id="${_editorEscHtml(row.id)}" title="Drag to resize track"></span>`;
    const trackName = (row, markup) => renamingTrackId === row.id
        ? _trackRenameEditorMarkupPure(row.id, row.name)
        : markup;
    const guideMode = model.tempoGuideMode === 'metronome' ? ' · Click' : '';
    el.innerHTML = `<div class="editor-track-session-head"><strong>Tracks</strong><button data-track-action="folder" title="Create optional folder">+ Folder</button><span class="editor-track-guide-label">Guide</span><button class="editor-track-guide-source" data-track-action="guide-cycle" title="Cycle tempo guide">${_editorEscHtml(guide.name + guideMode)}</button><button data-track-action="guide-lock" aria-pressed="${model.tempoGuideLocked}" title="Lock tempo guide">${model.tempoGuideLocked ? '🔒' : '🔓'}</button><button data-track-action="zoom-out" title="Reduce all track heights">−</button><button data-track-action="zoom-in" title="Increase all track heights">+</button></div><div class="editor-track-session-list">${rows.map(row => {
        const trackId = _editorEscHtml(row.id); const name = _editorEscHtml(row.name); const indent = Math.min(5, row.depth) * 14;
        const height = fittedHeights[row.id];
        const style = `--track-indent:${indent}px;--track-row-height:${height}px`;
        const selected = row.id === S.selectedTrackId ? ' editor-track-selected' : '';
        if (row.type === 'folder') return `<div class="editor-track-row editor-track-folder${selected}" draggable="true" data-track-id="${trackId}" style="${style}"><button data-track-action="collapse" data-track-id="${trackId}">${row.collapsed ? '›' : '⌄'}</button>${trackName(row, `<span class="editor-track-name">${name}</span>`)}${resizeGrip(row)}</div>`;
        if (row.type === 'audio') return `<div class="editor-track-row${selected}${row.sourceId === model.tempoGuideSourceId ? ' editor-track-guide' : ''}" draggable="true" data-track-id="${trackId}" style="${style}"><span class="editor-track-kind">${row.sourceKind === 'master' ? 'MIX' : 'AUD'}</span>${trackName(row, `<button class="editor-track-name" data-track-action="source-select" data-source-id="${_editorEscHtml(row.sourceId)}" title="Select audio track">${name}</button>`)}${mixControls(row)}<button data-track-action="guide-set" data-source-id="${_editorEscHtml(row.sourceId)}" title="Use for tempo">${row.sourceId === model.tempoGuideSourceId ? '★' : '☆'}</button>${resizeGrip(row)}</div>`;
        return `<div class="editor-track-row editor-track-transcription${selected}" draggable="true" data-track-id="${trackId}" style="${style}"><span class="editor-track-kind">${row.targetId === DRUM_TARGET_ID ? 'DRM' : 'MIDI'}</span>${trackName(row, `<button class="editor-track-name" data-track-action="select" data-target-id="${_editorEscHtml(row.targetId)}" title="Double-click to open editor">${name}</button>`)}${mixControls(row)}<select data-track-action="pair" data-track-id="${trackId}" aria-label="Audio reference for ${name}">${sourceOptions(row.pairedSourceId)}</select>${resizeGrip(row)}</div>`;
    }).join('')}</div>`;
    const list = el.querySelector('.editor-track-session-list');
    if (list) list.scrollTop = Math.max(0, Number(S.trackScrollY) || 0);
    const renameInput = el.querySelector('[data-track-rename-input]');
    if (renameInput) { renameInput.focus(); renameInput.select(); }
}

export function refreshTrackSession() {
    const key = JSON.stringify([S.trackSession, S.selectedTrackId, S.audioSources, S.partMix, S.trackHeights, S.trackViewportHeight,
        (S.arrangements || []).map(a => a && [a.id, a.name]), S.drumTab && S.drumTab.name]);
    if (key === lastRender) return;
    lastRender = key; render();
}

export function refreshTrackSessionSelection() {
    lastRender = '';
    refreshTrackSession();
}

export function initTrackSession() {
    const el = panel();
    if (!el || el.__trackSessionWired) return;
    el.__trackSessionWired = true;
    let storedWidth = null;
    try { storedWidth = localStorage.getItem('editorTrackHeaderWidth'); } catch (_) { /* storage blocked */ }
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
    el.addEventListener('click', async event => {
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
            const current = (S.trackSession.tracks || []).find(track => track.id === trackId);
            const menu = control.closest('.editor-track-context-menu');
            if (!current) return;
            if (menu) menu.remove();
            renamingTrackId = trackId;
            lastRender = ''; refreshTrackSession();
            return;
        }
        if (action === 'delete') {
            const menu = control.closest('.editor-track-context-menu');
            if (menu) menu.remove();
            await deleteTrack(control.getAttribute('data-track-id') || '');
            return;
        }
        if (action === 'metronome-guide') {
            const trackId = control.getAttribute('data-track-id') || '';
            const track = (S.trackSession.tracks || []).find(item => item.id === trackId && item.type === 'audio');
            if (!track) return;
            const next = _trackSessionNormalizePure(S.trackSession, S.audioSources, S.arrangements, S.drumTab);
            if (next.tempoGuideLocked && next.tempoGuideSourceId && next.tempoGuideSourceId !== track.sourceId) {
                setStatus('Tempo guide is locked. Unlock it before choosing a different metronome track.');
                return;
            }
            next.tempoGuideSourceId = track.sourceId;
            next.tempoGuideMode = 'metronome';
            next.tempoGuideLocked = true;
            const menu = control.closest('.editor-track-context-menu');
            if (menu) menu.remove();
            setStatus(`Loading “${track.name || track.sourceId}” as the metronome guide…`);
            const activated = await host.selectTrackSessionSource(track.sourceId);
            if (activated === false) {
                setStatus(`Could not load “${track.name || track.sourceId}” as the metronome guide.`);
                return;
            }
            commit(next, `“${track.name || track.sourceId}” is the locked metronome guide — Suggest will map its pulse through the chart.`);
            return;
        }
        if (action === 'folder') commit(_trackSessionCreateFolderPure(S.trackSession, S.audioSources, S.arrangements, S.drumTab, 'Folder'), 'Folder added — drag tracks to arrange the session.');
        else if (action === 'zoom-in' || action === 'zoom-out') {
            const delta = action === 'zoom-in' ? 8 : -8;
            const rows = _trackSessionRowsPure(S.trackSession, S.audioSources, S.arrangements, S.drumTab).rows;
            const next = { ...(S.trackHeights || {}) };
            for (const row of rows) next[row.id] = _trackSessionLaneHeightPure(next, row.id) + delta;
            S.trackHeights = next; lastRender = ''; refreshTrackSession(); host.draw();
        }
        else if (action === 'collapse') {
            const next = _trackSessionNormalizePure(S.trackSession, S.audioSources, S.arrangements, S.drumTab);
            const folder = next.tracks.find(t => t.id === control.getAttribute('data-track-id') && t.type === 'folder');
            if (folder) { folder.collapsed = !folder.collapsed; commit(next); }
        } else if (action === 'guide-lock') {
            const next = _trackSessionNormalizePure(S.trackSession, S.audioSources, S.arrangements, S.drumTab);
            next.tempoGuideLocked = !next.tempoGuideLocked;
            commit(next, next.tempoGuideLocked ? 'Tempo guide locked.' : 'Tempo guide unlocked.');
        } else if (action === 'guide-cycle' || action === 'guide-set') {
            const next = _trackSessionNormalizePure(S.trackSession, S.audioSources, S.arrangements, S.drumTab);
            const visibleSources = _trackSessionRowsPure(next, S.audioSources, S.arrangements, S.drumTab).sources;
            if (!visibleSources.length) { setStatus('No audio tracks remain to use as a guide.'); return; }
            const current = visibleSources.findIndex(source => source.id === next.tempoGuideSourceId);
            const sourceId = action === 'guide-set' ? control.getAttribute('data-source-id') : visibleSources[(Math.max(0, current) + 1) % visibleSources.length].id;
            if (next.tempoGuideLocked && sourceId !== next.tempoGuideSourceId) { setStatus('Tempo guide is locked. Unlock it before changing source.'); return; }
            next.tempoGuideSourceId = sourceId || MASTER_ID; S.focusedSourceId = next.tempoGuideSourceId;
            next.tempoGuideMode = 'audio';
            host.selectTrackSessionSource(S.focusedSourceId);
            commit(next, 'Tempo guide changed.');
        } else if (action === 'source-select') {
            const sourceId = control.getAttribute('data-source-id') || MASTER_ID;
            S.focusedSourceId = sourceId; host.selectTrackSessionSource(sourceId);
        } else if (action === 'select') {
            const targetId = control.getAttribute('data-target-id') || '';
            const track = S.trackSession.tracks.find(t => t.type === 'transcription' && t.targetId === targetId);
            S.focusedSourceId = (track && track.pairedSourceId) || S.trackSession.tempoGuideSourceId;
            host.selectTrackSessionSource(S.focusedSourceId);
            host.selectTrackSessionTarget(targetId);
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
        const metronome = track && track.type === 'audio'
            ? `<button data-track-action="metronome-guide" data-track-id="${_editorEscHtml(trackId)}">Use as Metronome Guide</button>` : '';
        const deleteLabel = track && track.type === 'folder' ? 'Delete Folder' : 'Delete Track';
        menu.innerHTML = `<button data-track-action="rename" data-track-id="${_editorEscHtml(trackId)}">Rename</button>${metronome}<button class="editor-track-delete" data-track-action="delete" data-track-id="${_editorEscHtml(trackId)}">${deleteLabel}</button>`;
        menu.style.left = `${event.clientX}px`;
        menu.style.top = `${event.clientY}px`;
        menu.classList.remove('hidden');
    });
    el.addEventListener('input', event => {
        const range = event.target && event.target.matches && event.target.matches('[data-track-action="mix-vol"]') ? event.target : null;
        if (!range) return;
        mixerSetPart(range.getAttribute('data-mix-key') || '', { vol: Number(range.value) });
    });
    el.addEventListener('scroll', event => {
        const list = event.target && event.target.matches && event.target.matches('.editor-track-session-list') ? event.target : null;
        if (!list) return;
        S.trackScrollY = list.scrollTop;
        host.draw();
    }, true);
    el.addEventListener('pointerdown', event => {
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
    el.addEventListener('change', event => {
        const select = event.target && event.target.matches && event.target.matches('[data-track-action="pair"]') ? event.target : null;
        if (!select) return;
        commit(_trackSessionPairPure(S.trackSession, select.getAttribute('data-track-id') || '', select.value || '', S.audioSources, S.arrangements, S.drumTab), select.value ? 'Paired transcription with audio reference.' : 'Transcription inherits master mix.');
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
                S.audioSources, S.arrangements, S.drumTab), 'Track and folder order saved with the song.');
        }
        draggedId = '';
    });
}

export function scrollTrackSessionBy(deltaY) {
    const list = panel()?.querySelector('.editor-track-session-list');
    if (!list) return false;
    list.scrollTop += Number(deltaY) || 0;
    S.trackScrollY = list.scrollTop;
    host.draw();
    return true;
}
