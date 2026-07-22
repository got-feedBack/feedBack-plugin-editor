// Replace-audio modal: swap the session's audio track from a file or a YouTube
// URL, decode it, and re-sync playback state. The window.editor* entry points
// are re-attached by main.js; display refreshers (draw, updateTimeDisplay) are
// reached through host.

import { cancelAudioLoad, loadAudio, stopPlayback } from './audio.js';
import { _uploadAudioForMode, createState } from './create.js';
import { _editorApplyScrollBounds } from './loop.js';
import { S, markSessionDirty } from './state.js';
import { setStatus } from './ui.js';
import { host } from './host.js';

let replaceAudioState = { audioMode: 'file' };
let replaceAudioRequest = 0;
let replaceAudioLoadRequest = 0;

function _replaceAudioRequestIsCurrent(request, sessionId) {
    return request === replaceAudioRequest && S.sessionId === sessionId;
}

function _invalidateReplaceAudioRequest() {
    const request = ++replaceAudioRequest;
    if (replaceAudioLoadRequest) {
        cancelAudioLoad();
        replaceAudioLoadRequest = 0;
    }
    return request;
}

export function editorShowReplaceAudioModal() {
    if (!S.sessionId) return;
    _invalidateReplaceAudioRequest();
    replaceAudioState = { audioMode: 'file' };
    document.getElementById('editor-replace-audio').value = '';
    document.getElementById('editor-replace-yt-url').value = '';
    document.getElementById('editor-replace-audio-status').textContent = '';
    document.getElementById('editor-replace-audio-apply').disabled = false;
    document.getElementById('editor-replace-audio-modal').classList.remove('hidden');
    editorSetReplaceAudioMode('file');
}

export function editorHideReplaceAudioModal() {
    _invalidateReplaceAudioRequest();
    document.getElementById('editor-replace-audio-modal').classList.add('hidden');
}

export function editorSetReplaceAudioMode(mode) {
    replaceAudioState.audioMode = mode;
    document.getElementById('editor-replace-audio-file-input').classList.toggle('hidden', mode !== 'file');
    document.getElementById('editor-replace-audio-yt-input').classList.toggle('hidden', mode !== 'youtube');
    document.getElementById('editor-replace-mode-file').classList.toggle('is-active', mode === 'file');
    document.getElementById('editor-replace-mode-yt').classList.toggle('is-active', mode === 'youtube');
}

async function _uploadReplaceAudio() {
    const statusEl = document.getElementById('editor-replace-audio-status');
    // Pre-check missing input so we surface a hint here (the shared helper
    // returns null silently on missing input so the create-modal flow's
    // optional-audio path keeps its existing no-status behavior).
    if (replaceAudioState.audioMode === 'youtube') {
        if (!document.getElementById('editor-replace-yt-url').value.trim()) {
            statusEl.textContent = 'Enter a YouTube URL';
            return null;
        }
    } else if (!document.getElementById('editor-replace-audio').files.length) {
        statusEl.textContent = 'Choose a file';
        return null;
    }
    return _uploadAudioForMode({
        mode: replaceAudioState.audioMode,
        ytInputId: 'editor-replace-yt-url',
        fileInputId: 'editor-replace-audio',
        statusEl,
    });
}

export async function editorApplyReplaceAudio() {
    if (!S.sessionId) return;
    const sessionId = S.sessionId;
    const request = _invalidateReplaceAudioRequest();
    const status = document.getElementById('editor-replace-audio-status');
    const apply = document.getElementById('editor-replace-audio-apply');
    apply.disabled = true;
    try {
        const audioUrl = await _uploadReplaceAudio();
        if (!_replaceAudioRequestIsCurrent(request, sessionId)) return;
        if (!audioUrl) { apply.disabled = false; return; }

        const resp = await fetch('/api/plugins/editor/replace-audio', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ session_id: sessionId, audio_url: audioUrl }),
        });
        const data = await resp.json();
        if (!_replaceAudioRequestIsCurrent(request, sessionId)) return;
        if (data.error) {
            status.textContent = 'Error: ' + data.error;
            apply.disabled = false;
            return;
        }

        // Keep create-mode build in sync — Build Song reads createState.audioUrl.
        if (S.createMode) createState.audioUrl = audioUrl;

        // Stop active playback before swapping the buffer; otherwise the old
        // BufferSource keeps playing under the new S.audioBuffer/duration and
        // playbackTick desyncs against the new track length.
        if (S.playing) stopPlayback();
        // loadAudio() swallows fetch/decode errors and only logs to console,
        // so detect failure by checking that the buffer reference actually
        // changed. Without this we would close the modal and announce
        // "Audio replaced" even on an unsupported / corrupt upload.
        const prevBuffer = S.audioBuffer;
        replaceAudioLoadRequest = request;
        try {
            await loadAudio(audioUrl);
        } finally {
            if (replaceAudioLoadRequest === request) replaceAudioLoadRequest = 0;
        }
        if (!_replaceAudioRequestIsCurrent(request, sessionId)) return;
        if (!S.audioBuffer || S.audioBuffer === prevBuffer) {
            status.textContent = 'Failed to decode audio (unsupported format?)';
            apply.disabled = false;
            return;
        }
        if (S.cursorTime > S.duration) S.cursorTime = 0;
        _editorApplyScrollBounds();
        document.getElementById('editor-play-btn').disabled = false;
        document.getElementById('editor-sync-btn').classList.remove('hidden');
        host.updateTimeDisplay();
        host.draw();
        if (!data.persisted) markSessionDirty();

        const HINTS = {
            none:    'Audio replaced',
            save:    'Audio replaced (Save to persist to .sloppak)',
            build:   'Audio replaced (Save the project; export again to update the library)',
            rebuild: "Audio replaced (playback only — archive won't be repacked)",
        };
        editorHideReplaceAudioModal();
        setStatus(HINTS[data.next_step] || (data.persisted ? HINTS.none : HINTS.rebuild));
    } catch (e) {
        if (!_replaceAudioRequestIsCurrent(request, sessionId)) return;
        status.textContent = 'Failed: ' + e.message;
        apply.disabled = false;
    }
}
