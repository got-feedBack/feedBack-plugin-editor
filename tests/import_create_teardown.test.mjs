/*
 * Import-create (GP / EOF) must apply the same outgoing-job teardown that
 * loadCDLC does: stop processes, drop the decoded buffer, dispose the old
 * backend session — even when the imported chart has no audio. This is the
 * gap that let the old recording keep sounding under the new chart.
 * Run: node tests/import_create_teardown.test.mjs
 */
import assert from 'node:assert';

// Permissive DOM: every element access/method is a no-op that chains, so the
// heavy editorApplyCreateResult DOM plumbing runs without a real document.
const el = new Proxy(function () {}, {
    get: (_t, k) => (k === 'classList' ? el : (k === 'value' ? '' : el)),
    apply: () => el,
    set: () => true,
});
globalThis.window = globalThis.window || globalThis;
globalThis.document = {
    getElementById: () => el,
    createElement: () => el,
    querySelectorAll: () => [],
    body: el,
    addEventListener: () => {},
    removeEventListener: () => {},
};

// Capture the backend dispose call (disposeBackendSession → fetch).
const fetchCalls = [];
globalThis.fetch = async (url, opts) => {
    fetchCalls.push({ url, body: opts && opts.body });
    return { ok: true, json: async () => ({}), blob: async () => ({}) };
};

const { setHostHooks } = await import('../src/host.js');
const { S } = await import('../src/state.js');
const { editorApplyCreateResult } = await import('../src/create.js');

// Editor entry points the create path reaches (window.* + host hooks).
window.editorHideCreateModal = () => {};
window.editorSetCreateMode = () => {};
const calls = [];
setHostHooks({
    finalizeRecording: () => calls.push('record'),
    stopPlayback: () => calls.push('playback'),
    cancelAudioLoad: () => calls.push('audio-load'),
    finalizeActiveDrag: () => calls.push('drag'),
    loadAudio: () => calls.push('load-audio'),
    resetOffsetUI: () => {},
    updateArrangementSelector: () => {},
    updateStatus: () => {},
    updateTimeDisplay: () => {},
    updateBPMDisplay: () => {},
    draw: () => {},
});

let pass = 0, fail = 0;
async function t(name, fn) {
    try { await fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}

await t('audio-less import stops processes, clears buffer, disposes old session', async () => {
    Object.assign(S, {
        sessionId: 'old-session',
        audioBuffer: { fake: true },
        waveformPeaks: [1, 2, 3],
        drag: { type: 'move' },
        arrangements: [],
        beats: [],
    });
    calls.length = 0; fetchCalls.length = 0;

    // No audio_url → the loadAudio() branch is skipped (the bug's trigger).
    await editorApplyCreateResult({
        session_id: 'new-session',
        title: 'X', artist: 'Y',
        arrangements: [{ name: 'Lead', notes: [], chords: [], tuning: [0, 0, 0, 0, 0, 0] }],
        beats: [], sections: [], duration: 0,
    });

    assert.ok(calls.includes('playback'), 'old playback stopped');
    assert.ok(calls.includes('audio-load'), 'outgoing audio load cancelled');
    assert.ok(!calls.includes('load-audio'), 'no new audio loaded for an audio-less import');
    assert.strictEqual(S.audioBuffer, null, 'stale decoded buffer dropped');
    assert.strictEqual(S.waveformPeaks, null, 'stale waveform dropped');
    assert.strictEqual(S.drag, null, 'active drag abandoned');
    assert.strictEqual(S.sessionId, 'new-session', 'new session installed');

    const disposed = fetchCalls.find(c => String(c.url).includes('/session/close'));
    assert.ok(disposed, 'old backend session disposed');
    assert.ok(String(disposed.body).includes('old-session'), 'disposed the OUTGOING session id');
});

await t('an import RESETS authored tempo marks — the previous song must not bleed', async () => {
    // Prior song left holds/groupings in S.tempoMarks; the import replaces the
    // grid but (pre-fix) forgot the marks, so they leaked onto the new chart
    // and would persist on its next save.
    Object.assign(S, {
        sessionId: 'old', tempoMarks: [
            { measure: 2, kind: 'hold', factor: 2, provenance: 'confirmed' },
            { measure: 5, kind: 'meter', num: 7, den: 8, grouping: [2, 2, 3] },
        ],
        arrangements: [], beats: [],
    });
    await editorApplyCreateResult({
        session_id: 'fresh',
        arrangements: [{ name: 'Lead', notes: [], chords: [], tuning: [0, 0, 0, 0, 0, 0] }],
        beats: [], sections: [], duration: 0,   // an import carries no tempo_marks
    });
    assert.deepStrictEqual(S.tempoMarks, [], 'the new song starts with no authored marks');
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
