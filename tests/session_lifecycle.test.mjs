/*
 * Destructive editor transitions: dirty confirmation and process shutdown.
 * Run: node tests/session_lifecycle.test.mjs
 */
import assert from 'node:assert';

globalThis.window = globalThis.window || globalThis;
globalThis.document = globalThis.document || {
    getElementById: () => null,
};

const { setHostHooks } = await import('../src/host.js');
const {
    markSessionDirty, markSessionSaved, sessionIsDirty, S,
} = await import('../src/state.js');
const {
    guardSessionTransition, stopSessionProcesses,
} = await import('../src/session-lifecycle.js');

let pass = 0, fail = 0;
async function t(name, fn) {
    try { await fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}

function seed() {
    Object.assign(S, { sessionId: 'old-session', sessionDirty: false, drag: { type: 'move' } });
}

await t('dirty state is explicit and clears only after durable save/load', () => {
    seed();
    assert.strictEqual(sessionIsDirty(), false);
    markSessionDirty();
    assert.strictEqual(sessionIsDirty(), true);
    markSessionSaved();
    assert.strictEqual(sessionIsDirty(), false);
    S.sessionId = null;
    markSessionDirty();
    assert.strictEqual(sessionIsDirty(), false, 'no phantom dirty empty session');
});

await t('legacy authored counters participate and reset at the save point', () => {
    seed();
    S.arrangements = [{ tones: { _editCount: 1 }, _anchorEditCount: 1 }];
    S.drumTabDirty = true;
    assert.strictEqual(sessionIsDirty(), true);
    markSessionSaved();
    assert.strictEqual(sessionIsDirty(), false);
    assert.strictEqual(S.arrangements[0].tones._editCount, 0);
    assert.strictEqual(S.arrangements[0]._anchorEditCount, 0);
});

await t('Cancel and unknown choices block the transition without saving', async () => {
    seed(); markSessionDirty();
    let saves = 0;
    setHostHooks({ finalizeRecording: () => {}, saveSession: async () => { saves++; return true; } });
    assert.strictEqual(await guardSessionTransition('opening', async () => 'cancel'), false);
    assert.strictEqual(await guardSessionTransition('opening', async () => 'bogus'), false);
    assert.strictEqual(saves, 0);
});

await t("Don't Save proceeds; Save proceeds only after successful persistence", async () => {
    seed(); markSessionDirty();
    let saveResult = false;
    setHostHooks({ finalizeRecording: () => {}, saveSession: async () => saveResult });
    assert.strictEqual(await guardSessionTransition('opening', async () => 'discard'), true);
    assert.strictEqual(await guardSessionTransition('opening', async () => 'save'), false,
        'failed save keeps the current job open');
    saveResult = true;
    assert.strictEqual(await guardSessionTransition('opening', async () => 'save'), true);
});

await t('an active take is finalized before dirty evaluation', async () => {
    seed();
    let finalized = 0;
    setHostHooks({
        finalizeRecording: () => { finalized++; markSessionDirty(); },
        saveSession: async () => true,
    });
    assert.strictEqual(await guardSessionTransition('opening', async () => 'save'), true);
    assert.strictEqual(finalized, 1);
});

await t('shutdown stops every outgoing process and abandons active drag', () => {
    seed();
    const calls = [];
    setHostHooks({
        finalizeRecording: () => calls.push('record'),
        stopPlayback: () => calls.push('playback'),
        cancelAudioLoad: () => calls.push('audio-load'),
        finalizeActiveDrag: () => calls.push('drag'),
    });
    stopSessionProcesses();
    assert.deepStrictEqual(calls, ['record', 'playback', 'audio-load', 'drag']);
    assert.strictEqual(S.drag, null);
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
