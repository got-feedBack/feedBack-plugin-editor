/* Replace Audio requests must stay attached to their initiating session. */
import assert from 'node:assert';

function deferred() {
    let resolve;
    const promise = new Promise(r => { resolve = r; });
    return { promise, resolve };
}

const noopClassList = { add() {}, remove() {}, toggle() {} };
const elements = new Map();
function element(id) {
    if (!elements.has(id)) {
        elements.set(id, {
            id, value: '', textContent: '', disabled: false, files: [],
            classList: noopClassList,
        });
    }
    return elements.get(id);
}

globalThis.window = globalThis.window || globalThis;
globalThis.document = {
    getElementById: element,
    createElement: () => ({ classList: noopClassList, appendChild() {}, style: {} }),
    querySelectorAll: () => [],
    addEventListener() {},
    removeEventListener() {},
    body: { appendChild() {} },
};

const { S } = await import('../src/state.js');
const {
    editorApplyReplaceAudio,
    editorHideReplaceAudioModal,
    editorSetReplaceAudioMode,
    editorShowReplaceAudioModal,
} = await import('../src/replace-audio.js');

let pass = 0, fail = 0;
async function t(name, fn) {
    try { await fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}

function seedSession(id) {
    Object.assign(S, {
        sessionId: id, createMode: false, playing: false,
        audioBuffer: { session: id }, duration: 10, cursorTime: 0,
    });
    editorShowReplaceAudioModal();
    editorSetReplaceAudioMode('youtube');
    element('editor-replace-yt-url').value = 'https://example.test/audio';
}

await t('a late upload cannot post Replace Audio into the next session', async () => {
    seedSession('session-a');
    const upload = deferred();
    const calls = [];
    globalThis.fetch = (url, options) => {
        calls.push({ url, options });
        return upload.promise;
    };

    const applying = editorApplyReplaceAudio();
    assert.strictEqual(calls.length, 1, 'the upload started');
    S.sessionId = 'session-b';
    editorShowReplaceAudioModal();
    upload.resolve({ json: async () => ({ audio_url: '/cache/session-a.mp3' }) });
    await applying;

    assert.strictEqual(calls.length, 1, 'the stale upload never reached replace-audio');
    assert.strictEqual(element('editor-replace-audio-apply').disabled, false,
        'the new dialog was not disabled by the old request');
});

await t('a late backend response cannot update or decode into the next session', async () => {
    seedSession('session-a');
    const replace = deferred();
    const calls = [];
    globalThis.fetch = async (url, options) => {
        calls.push({ url, options });
        if (String(url).includes('youtube-audio')) {
            return { json: async () => ({ audio_url: '/cache/session-a.mp3' }) };
        }
        if (String(url).includes('replace-audio')) return replace.promise;
        throw new Error('unexpected audio decode request: ' + url);
    };

    const originalBuffer = S.audioBuffer;
    const applying = editorApplyReplaceAudio();
    await new Promise(resolve => setImmediate(resolve));
    assert.strictEqual(calls.length, 2, 'upload and session-scoped replace started');
    assert.deepStrictEqual(JSON.parse(calls[1].options.body), {
        session_id: 'session-a', audio_url: '/cache/session-a.mp3',
    });

    S.sessionId = 'session-b';
    editorShowReplaceAudioModal();
    replace.resolve({ json: async () => ({ persisted: false, next_step: 'save' }) });
    await applying;

    assert.strictEqual(calls.length, 2, 'the stale response never started audio decode');
    assert.strictEqual(S.audioBuffer, originalBuffer, 'the new session audio state was untouched');
    assert.strictEqual(element('editor-replace-audio-status').textContent, '',
        'the stale request did not write into the new dialog');
});

await t('closing the dialog invalidates its in-flight upload', async () => {
    seedSession('session-a');
    const upload = deferred();
    const calls = [];
    globalThis.fetch = (url, options) => {
        calls.push({ url, options });
        return upload.promise;
    };

    const applying = editorApplyReplaceAudio();
    editorHideReplaceAudioModal();
    upload.resolve({ json: async () => ({ audio_url: '/cache/closed.mp3' }) });
    await applying;
    assert.strictEqual(calls.length, 1, 'closing prevented the follow-up replace request');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
