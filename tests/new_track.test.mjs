/*
 * Tests for the New Track dialog (src/new-track.js) and the blank-track
 * creation paths it dispatches to (src/import.js editorAddEmptyFretted,
 * src/arrangement.js editorAddEmptyDrums).
 *
 * All fail on main: the planner/dialog and the blank fretted/drums starts
 * don't exist there (only blank Keys did, buried in the Add-Keys modal).
 *
 * Run: node tests/new_track.test.mjs
 */
import assert from 'node:assert';

globalThis.document = globalThis.document || {
    getElementById: () => null, addEventListener: () => {}, activeElement: null,
    querySelectorAll: () => [], querySelector: () => null,
    createElement: () => ({ style: {}, dataset: {}, classList: { add() {}, remove() {}, toggle() {} } }),
    head: { appendChild: () => {} },
};
globalThis.localStorage = globalThis.localStorage || { getItem: () => null, setItem: () => {} };
globalThis.window = globalThis.window || globalThis;

const { S } = await import('../src/state.js');
const { _newTrackPlanPure } = await import('../src/new-track.js');
const { _uniqueTrackNamePure, editorAddEmptyFretted, editorAddEmptyKeys } =
    await import('../src/import.js');
const { editorAddEmptyDrums } = await import('../src/arrangement.js');
const { _trackSessionNewTrackVisiblePure } = await import('../src/track-session.js');

let pass = 0, fail = 0;
function t(name, fn) {
    try { fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}
async function ta(name, fn) {
    try { await fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}

const CTX = { hasSession: true, format: 'sloppak', hasDrumTab: false };

t('planner: audio routes to the stems picker regardless of instrument', () => {
    assert.deepStrictEqual(_newTrackPlanPure({ type: 'audio' }, CTX), { action: 'audio-picker' });
});

t('planner: empty transcription routes per instrument', () => {
    for (const inst of ['Lead', 'Rhythm', 'Bass']) {
        assert.deepStrictEqual(
            _newTrackPlanPure({ type: 'transcription', instrument: inst, source: 'empty' }, CTX),
            { action: 'empty-fretted', role: inst });
    }
    assert.deepStrictEqual(
        _newTrackPlanPure({ type: 'transcription', instrument: 'Keys', source: 'empty' }, CTX),
        { action: 'empty-keys' });
    assert.deepStrictEqual(
        _newTrackPlanPure({ type: 'transcription', instrument: 'Drums', source: 'empty' }, CTX),
        { action: 'empty-drums' });
});

t('planner: from-file routes to the surviving per-kind import modals', () => {
    const p = (inst) => _newTrackPlanPure({ type: 'transcription', instrument: inst, source: 'file' }, CTX).action;
    assert.strictEqual(p('Lead'), 'modal-guitar');
    assert.strictEqual(p('Rhythm'), 'modal-guitar');
    assert.strictEqual(p('Bass'), 'modal-guitar');
    assert.strictEqual(p('Keys'), 'modal-keys');
    assert.strictEqual(p('Drums'), 'modal-drums');
});

t('planner: blocked states — no session, wrong format, second drum tab, junk', () => {
    const sel = { type: 'transcription', instrument: 'Lead', source: 'empty' };
    assert.strictEqual(_newTrackPlanPure(sel, { hasSession: false, format: 'sloppak' }).action, 'blocked');
    assert.strictEqual(_newTrackPlanPure(sel, { hasSession: true, format: 'archive' }).action, 'blocked');
    const drums = { type: 'transcription', instrument: 'Drums', source: 'empty' };
    assert.deepStrictEqual(
        _newTrackPlanPure(drums, { ...CTX, hasDrumTab: true }),
        { action: 'blocked', reason: 'drums-exist' });
    assert.strictEqual(_newTrackPlanPure({ type: 'transcription', instrument: 'Theremin', source: 'empty' }, CTX).action, 'blocked');
    assert.strictEqual(_newTrackPlanPure(null, CTX).action, 'blocked');
    assert.strictEqual(_newTrackPlanPure(sel, null).action, 'blocked');
});

t('Tracks-column New Track entry is visible only in editable Sloppak sessions', () => {
    assert.strictEqual(_trackSessionNewTrackVisiblePure('session-1', 'sloppak'), true);
    assert.strictEqual(_trackSessionNewTrackVisiblePure('session-1', 'archive'), false);
    assert.strictEqual(_trackSessionNewTrackVisiblePure(null, 'sloppak'), false);
});

t('unique names: base survives as prefix, numbering never renames the kind', () => {
    assert.strictEqual(_uniqueTrackNamePure('Lead', []), 'Lead');
    assert.strictEqual(_uniqueTrackNamePure('Lead', ['Lead']), 'Lead 2');
    assert.strictEqual(_uniqueTrackNamePure('Lead', ['lead', 'LEAD 2']), 'Lead 3');
    assert.strictEqual(_uniqueTrackNamePure('Bass', ['Lead', 'Keys']), 'Bass');
    assert.strictEqual(_uniqueTrackNamePure('Bass', [null, undefined, 'Bass']), 'Bass 2');
});

await ta('editorAddEmptyFretted: registers, appends, switches — bass gets 4 strings', async () => {
    Object.assign(S, {
        format: 'sloppak', sessionId: 'test-session', currentArr: 0,
        arrangements: [{ name: 'Lead', tuning: [0, 0, 0, 0, 0, 0], notes: [], chords: [] }],
        sel: new Set(),
    });
    const calls = [];
    globalThis.fetch = async (url, opts) => {
        calls.push({ url, body: JSON.parse(opts.body) });
        return { ok: true, json: async () => ({ success: true }) };
    };
    const ok = await editorAddEmptyFretted('Bass');
    assert.strictEqual(ok, true);
    assert.strictEqual(calls.length, 1);
    assert.ok(calls[0].url.endsWith('/add-arrangement'));
    assert.strictEqual(calls[0].body.session_id, 'test-session');
    assert.strictEqual(S.arrangements.length, 2);
    const arr = S.arrangements[1];
    assert.strictEqual(arr.name, 'Bass');
    assert.deepStrictEqual(arr.tuning, [0, 0, 0, 0]);
    assert.deepStrictEqual(arr.notes, []);
    assert.strictEqual(S.currentArr, 1, 'new track becomes active');
    // A second Lead dodges the existing name.
    const ok2 = await editorAddEmptyFretted('Lead');
    assert.strictEqual(ok2, true);
    assert.strictEqual(S.arrangements[2].name, 'Lead 2');
    assert.strictEqual(S.arrangements[2].tuning.length, 6);
});

await ta('editorAddEmptyFretted: backend error rejects without touching state', async () => {
    Object.assign(S, {
        format: 'sloppak', sessionId: 'test-session', currentArr: 0,
        arrangements: [{ name: 'Lead', tuning: [0, 0, 0, 0, 0, 0], notes: [], chords: [] }],
        sel: new Set(),
    });
    globalThis.fetch = async () => ({ ok: false, json: async () => ({ error: 'nope' }) });
    const ok = await editorAddEmptyFretted('Rhythm');
    assert.strictEqual(ok, false);
    assert.strictEqual(S.arrangements.length, 1, 'no arrangement appended on failure');
    assert.strictEqual(S.currentArr, 0);
});

await ta('empty Keys failure reports in the calling New Track dialog', async () => {
    Object.assign(S, {
        format: 'sloppak', sessionId: 'test-session', currentArr: 0,
        arrangements: [{ name: 'Lead', tuning: [0, 0, 0, 0, 0, 0], notes: [], chords: [] }],
        sel: new Set(),
    });
    const visibleStatus = { textContent: '' };
    document.getElementById = (id) => id === 'editor-new-track-status' ? visibleStatus : null;
    globalThis.fetch = async () => ({ ok: false, status: 500, json: async () => ({ error: 'nope' }) });
    const ok = await editorAddEmptyKeys('editor-new-track-status');
    assert.strictEqual(ok, false);
    assert.match(visibleStatus.textContent, /nope/);
    assert.strictEqual(S.arrangements.length, 1, 'failed Keys registration leaves state untouched');
});

t('editorAddEmptyDrums: blank shape once; a SECOND part in a saved sloppak session', () => {
    Object.assign(S, {
        format: 'sloppak', sessionId: 'test-session', createMode: false,
        drumTab: null, drumTabDirty: false,
        arrangements: [{ name: 'Lead', notes: [] }], drumSel: new Set(),
    });
    assert.strictEqual(editorAddEmptyDrums(), true);
    assert.deepStrictEqual(S.drumTab, { version: 1, name: 'Drums', kit: [], hits: [] });
    assert.strictEqual(S.drumTabDirty, true, 'persists on next save');
    assert.strictEqual(S.arrangements.filter(a => a.type === 'drums').length, 1,
        'primary materialized beside the pitched part');
    // A second call adds ANOTHER part (a song can hold several) — the new
    // part becomes the grid target and the first tab is untouched.
    S.drumTab.hits.push({ t: 1, piece: 'kick' });
    const firstTab = S.drumTab;
    assert.strictEqual(editorAddEmptyDrums(), true);
    assert.strictEqual(S.arrangements.filter(a => a.type === 'drums').length, 2, 'two drum parts');
    assert.notStrictEqual(S.drumTab, firstTab, 'the NEW part is the active grid target');
    assert.strictEqual(firstTab.hits.length, 1, 'existing tab untouched');
    assert.strictEqual(S.drumTab.name, 'Drums 2', 'de-duplicated display name');
});

t('editorAddEmptyDrums: create mode keeps the one-part rule (refuses twice)', () => {
    Object.assign(S, {
        format: 'sloppak', sessionId: 'test-session', createMode: true,
        drumTab: null, drumTabDirty: false,
        arrangements: [{ name: 'Lead', notes: [] }], drumSel: new Set(),
    });
    assert.strictEqual(editorAddEmptyDrums(), true);
    S.drumTab.hits.push({ t: 1, piece: 'kick' });
    assert.strictEqual(editorAddEmptyDrums(), false, 'create mode: one part max (its build persists one)');
    assert.strictEqual(S.drumTab.hits.length, 1, 'existing tab untouched');
    Object.assign(S, { createMode: false });
});

t('editorAddEmptyDrums: a drums-only session keeps the tab OFF the arrangement list', () => {
    // No pitched part: materializing would put drums at index 0, where the
    // default currentArr lands — the tab must stay a legacy off-array
    // singleton instead (the drum grid still edits it through the mode).
    Object.assign(S, {
        format: 'sloppak', sessionId: 'test-session', createMode: false,
        drumTab: null, drumTabDirty: false, arrangements: [], drumSel: new Set(),
    });
    assert.strictEqual(editorAddEmptyDrums(), true);
    assert.ok(S.drumTab, 'tab created');
    assert.strictEqual(S.arrangements.length, 0, 'no drums arrangement at index 0');
});

t('editorAddEmptyDrums: refuses outside a sloppak session', () => {
    Object.assign(S, { format: 'archive', sessionId: 'test-session', drumTab: null });
    assert.strictEqual(editorAddEmptyDrums(), false);
    assert.strictEqual(S.drumTab, null);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
