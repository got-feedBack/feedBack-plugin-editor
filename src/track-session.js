/* Source-aware DAW track-session model and left-side track header. */
import { host } from './host.js';
import { S, markSessionDirty } from './state.js';
import { _editorEscHtml, setStatus } from './ui.js';

const MASTER_ID = 'master';
const DRUM_TARGET_ID = 'drums';
const VERSION = 1;
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
        out.push({ id: stable || 'arr:' + index, name: String(arr.name || ('Track ' + (index + 1))).slice(0, 120) });
    });
    if (drumTab && Array.isArray(drumTab.hits)) {
        out.push({ id: DRUM_TARGET_ID, name: String(drumTab.name || 'Drums').slice(0, 120) });
    }
    return out;
}

function _trackSessionNormalizePure(raw, rawSources, arrangements, drumTab) {
    const sources = _trackSessionSourcesPure(rawSources);
    const targets = _trackSessionTargetsPure(arrangements, drumTab);
    const knownSources = new Set(sources.map(s => s.id));
    const knownTargets = new Set(targets.map(t => t.id));
    const input = raw && typeof raw === 'object' ? raw : {};
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
            if (!knownSources.has(sourceId) || sourceLeaves.has(sourceId)) continue;
            sourceLeaves.add(sourceId);
            tracks.push({ id, type: 'audio', sourceId, parentId: idOf(item.parentId) });
        } else {
            const targetId = idOf(item.targetId);
            const pairedSourceId = idOf(item.pairedSourceId);
            if (!knownTargets.has(targetId) || targetLeaves.has(targetId)) continue;
            targetLeaves.add(targetId);
            tracks.push({ id, type: 'transcription', targetId, parentId: idOf(item.parentId), pairedSourceId: knownSources.has(pairedSourceId) ? pairedSourceId : '' });
        }
        seen.add(id);
    }
    for (const source of sources) if (!sourceLeaves.has(source.id)) {
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
    return { version: VERSION, tracks, tempoGuideSourceId: knownSources.has(guide) ? guide : MASTER_ID, tempoGuideLocked: !!input.tempoGuideLocked };
}

function _trackSessionRowsPure(session, rawSources, arrangements, drumTab) {
    const model = _trackSessionNormalizePure(session, rawSources, arrangements, drumTab);
    const sources = new Map(_trackSessionSourcesPure(rawSources).map(s => [s.id, s]));
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
            rows.push({ ...track, depth, name: track.type === 'folder' ? track.name : (source || target || {}).name || 'Track', sourceKind: source ? source.kind : '' });
            if (track.type !== 'folder' || !track.collapsed) visit(track.id, depth + 1);
        }
    };
    visit('', 0);
    return { model, rows, sources: [...sources.values()] };
}

function _trackSessionPairPure(session, trackId, sourceId, rawSources, arrangements, drumTab) {
    const model = _trackSessionNormalizePure(session, rawSources, arrangements, drumTab);
    const track = model.tracks.find(t => t.id === trackId && t.type === 'transcription');
    const valid = new Set(_trackSessionSourcesPure(rawSources).map(s => s.id));
    if (track && (!sourceId || valid.has(sourceId))) track.pairedSourceId = sourceId || '';
    return model;
}

function _trackSessionMoveBeforePure(session, movedId, beforeId, rawSources, arrangements, drumTab) {
    const model = _trackSessionNormalizePure(session, rawSources, arrangements, drumTab);
    const from = model.tracks.findIndex(t => t.id === movedId);
    const before = model.tracks.findIndex(t => t.id === beforeId);
    if (from < 0 || before < 0 || from === before) return model;
    const moved = model.tracks[from]; const destination = model.tracks[before];
    // Dropping on a folder makes it the optional parent. Refuse a folder into
    // one of its own descendants; otherwise that whole branch would disappear.
    if (destination.type === 'folder') {
        let parent = destination.parentId;
        while (parent) {
            if (parent === moved.id) return model;
            parent = (model.tracks.find(track => track.id === parent) || {}).parentId || '';
        }
        moved.parentId = destination.id;
        model.tracks.splice(from, 1);
        let insertAt = model.tracks.findIndex(track => track.id === destination.id) + 1;
        while (insertAt < model.tracks.length && model.tracks[insertAt].parentId === destination.id) insertAt++;
        model.tracks.splice(insertAt, 0, moved);
        return model;
    }
    moved.parentId = destination.parentId;
    model.tracks.splice(from, 1);
    const revisedBefore = model.tracks.findIndex(track => track.id === beforeId);
    model.tracks.splice(revisedBefore, 0, moved);
    return model;
}

function _trackSessionCreateFolderPure(session, rawSources, arrangements, drumTab, name) {
    const model = _trackSessionNormalizePure(session, rawSources, arrangements, drumTab);
    let n = 1;
    const used = new Set(model.tracks.map(t => t.id));
    while (used.has('folder:' + n)) n++;
    model.tracks.push({ id: 'folder:' + n, type: 'folder', name: String(name || 'Folder').slice(0, 120), parentId: '', collapsed: false });
    return model;
}
/* @pure:track-session:end */

export { _trackSessionCreateFolderPure, _trackSessionMoveBeforePure, _trackSessionNormalizePure, _trackSessionPairPure, _trackSessionRowsPure, _trackSessionSourcesPure, _trackSessionTargetsPure };

let lastRender = '';
let draggedId = '';
const panel = () => document.getElementById('editor-track-session');

export function installTrackSession(raw, sources) {
    S.audioSources = _trackSessionSourcesPure(sources);
    S.trackSession = _trackSessionNormalizePure(raw, S.audioSources, S.arrangements, S.drumTab);
    S.focusedSourceId = S.trackSession.tempoGuideSourceId;
    lastRender = '';
    refreshTrackSession();
}
export function trackSessionSavePayload() { return _trackSessionNormalizePure(S.trackSession, S.audioSources, S.arrangements, S.drumTab); }

function commit(next, status) {
    S.trackSession = _trackSessionNormalizePure(next, S.audioSources, S.arrangements, S.drumTab);
    markSessionDirty(); lastRender = ''; refreshTrackSession();
    if (status) setStatus(status);
}

function render() {
    const el = panel();
    if (!el) return;
    const { model, rows, sources } = _trackSessionRowsPure(S.trackSession, S.audioSources, S.arrangements, S.drumTab);
    const sourceOptions = selected => ['<option value="">Master mix (inherit)</option>'].concat(sources.map(source => `<option value="${_editorEscHtml(source.id)}"${source.id === selected ? ' selected' : ''}>${_editorEscHtml(source.name)}</option>`)).join('');
    const guide = sources.find(source => source.id === model.tempoGuideSourceId) || sources[0];
    el.innerHTML = `<div class="editor-track-session-head"><span>Tracks</span><button data-track-action="folder" title="Create optional folder">+ Folder</button></div><div class="editor-track-session-guide"><span>Tempo</span><button data-track-action="guide-cycle" title="Cycle tempo guide">${_editorEscHtml(guide.name)}</button><button data-track-action="guide-lock" aria-pressed="${model.tempoGuideLocked}" title="Lock tempo guide">${model.tempoGuideLocked ? '🔒' : '🔓'}</button></div><div class="editor-track-session-list">${rows.map(row => {
        const trackId = _editorEscHtml(row.id); const name = _editorEscHtml(row.name); const indent = Math.min(5, row.depth) * 14;
        if (row.type === 'folder') return `<div class="editor-track-row editor-track-folder" draggable="true" data-track-id="${trackId}" style="--track-indent:${indent}px"><button data-track-action="collapse" data-track-id="${trackId}">${row.collapsed ? '›' : '⌄'}</button><span>${name}</span></div>`;
        if (row.type === 'audio') return `<div class="editor-track-row${row.sourceId === model.tempoGuideSourceId ? ' editor-track-guide' : ''}" draggable="true" data-track-id="${trackId}" style="--track-indent:${indent}px"><span class="editor-track-kind">${row.sourceKind === 'master' ? 'MIX' : 'AUD'}</span><button class="editor-track-name" data-track-action="source-select" data-source-id="${_editorEscHtml(row.sourceId)}" title="Use as the audible reference">${name}</button><button data-track-action="guide-set" data-source-id="${_editorEscHtml(row.sourceId)}" title="Use for tempo">${row.sourceId === model.tempoGuideSourceId ? '★' : '☆'}</button></div>`;
        return `<div class="editor-track-row editor-track-transcription" draggable="true" data-track-id="${trackId}" style="--track-indent:${indent}px"><span class="editor-track-kind">${row.targetId === DRUM_TARGET_ID ? 'DRM' : 'MIDI'}</span><button class="editor-track-name" data-track-action="select" data-target-id="${_editorEscHtml(row.targetId)}">${name}</button><select data-track-action="pair" data-track-id="${trackId}" aria-label="Audio reference for ${name}">${sourceOptions(row.pairedSourceId)}</select></div>`;
    }).join('')}</div>`;
}

export function refreshTrackSession() {
    const key = JSON.stringify([S.trackSession, S.audioSources, (S.arrangements || []).map(a => a && [a.id, a.name]), S.drumTab && S.drumTab.name]);
    if (key === lastRender) return;
    lastRender = key; render();
}

export function initTrackSession() {
    const el = panel();
    if (!el || el.__trackSessionWired) return;
    el.__trackSessionWired = true;
    el.addEventListener('click', event => {
        const control = event.target && event.target.closest ? event.target.closest('[data-track-action]') : null;
        if (!control) return;
        const action = control.getAttribute('data-track-action');
        if (action === 'folder') commit(_trackSessionCreateFolderPure(S.trackSession, S.audioSources, S.arrangements, S.drumTab, 'Folder'), 'Folder added — drag tracks to arrange the session.');
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
            const sourceId = action === 'guide-set' ? control.getAttribute('data-source-id') : S.audioSources[(Math.max(0, S.audioSources.findIndex(s => s.id === next.tempoGuideSourceId)) + 1) % Math.max(1, S.audioSources.length)].id;
            if (next.tempoGuideLocked && sourceId !== next.tempoGuideSourceId) { setStatus('Tempo guide is locked. Unlock it before changing source.'); return; }
            next.tempoGuideSourceId = sourceId || MASTER_ID; S.focusedSourceId = next.tempoGuideSourceId;
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
    el.addEventListener('change', event => {
        const select = event.target && event.target.matches && event.target.matches('[data-track-action="pair"]') ? event.target : null;
        if (!select) return;
        commit(_trackSessionPairPure(S.trackSession, select.getAttribute('data-track-id') || '', select.value || '', S.audioSources, S.arrangements, S.drumTab), select.value ? 'Paired transcription with audio reference.' : 'Transcription inherits master mix.');
    });
    el.addEventListener('dragstart', event => { const row = event.target && event.target.closest ? event.target.closest('[data-track-id]') : null; draggedId = row ? row.getAttribute('data-track-id') || '' : ''; });
    el.addEventListener('dragover', event => { if (draggedId) event.preventDefault(); });
    el.addEventListener('drop', event => { event.preventDefault(); const row = event.target && event.target.closest ? event.target.closest('[data-track-id]') : null; const before = row ? row.getAttribute('data-track-id') || '' : ''; if (draggedId && before && draggedId !== before) commit(_trackSessionMoveBeforePure(S.trackSession, draggedId, before, S.audioSources, S.arrangements, S.drumTab), 'Track order saved with the song.'); draggedId = ''; });
}