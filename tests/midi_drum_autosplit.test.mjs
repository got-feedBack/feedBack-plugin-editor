/*
 * MIDI create-import drum auto-split — the stateful wiring, not a pure helper.
 *
 * Core's `list_midi_tracks` EXCLUDES channel-9, so a full-band MIDI's drums
 * never reach the pitched picker and were silently lost on create. /import-midi
 * now also returns the channel-9 `drum_tracks`, and `importMidiDrumTracksIntoSession`
 * imports each as its own `type:"drums"` arrangement (via the shared
 * `_stashImportedDrumTab` step editorDoAddDrums also uses).
 *
 * Pinned here (all fail on main, where neither function exists):
 *   - _stashImportedDrumTab sorts hits, marks the tab dirty, clears the drum
 *     selection, materializes a type:"drums" arrangement beside a pitched part,
 *     and reports add-as-extra vs. become-primary;
 *   - importMidiDrumTracksIntoSession POSTs each drum track to import-drums-midi
 *     with the right track_index / arrangement_name, materializes one drums
 *     part each, skips empty/failed tracks without aborting the rest, and guards
 *     no-session / no-path / empty-list.
 *
 * Run: node tests/midi_drum_autosplit.test.mjs
 */
import assert from 'node:assert';

// Minimal DOM (collaborator surface only — no subject under test is stubbed).
const _els = new Map();
function _mkEl() {
    return {
        textContent: '', innerHTML: '', value: '', disabled: false, style: {},
        classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
        appendChild() {}, addEventListener() {}, removeEventListener() {},
        querySelector: () => null, querySelectorAll: () => [], setAttribute() {}, getAttribute: () => null,
    };
}
globalThis.document = {
    getElementById(id) { if (!_els.has(id)) _els.set(id, _mkEl()); return _els.get(id); },
    createElement: () => _mkEl(), querySelectorAll: () => [], addEventListener() {}, removeEventListener() {},
};
globalThis.window = globalThis.window || globalThis;

const { S } = await import('../src/state.js');
const { setHostHooks } = await import('../src/host.js');
const { isDrumArrangement, drumArrangements } = await import('../src/drum-arrangement.js');
const { _stashImportedDrumTab, importMidiDrumTracksIntoSession } = await import('../src/arrangement.js');

// Inert host hooks the drum stash / import reach for (defaults are type-honest,
// but pin them so a placement/redraw can never throw in the headless run).
setHostHooks({
    effectiveAudioOffset: () => 0,
    placeImportedPartAsRegion: () => true,
    updateArrangementSelector: () => {},
    draw: () => {},
});

let pass = 0, fail = 0;
async function ta(name, fn) {
    try { await fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}
function t(name, fn) {
    try { fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}

const gtr = (name = 'Lead') => ({ id: name.toLowerCase(), name, notes: [], chords: [] });
const drumTab = (name, hits) => ({ version: 1, name, kit: [], hits });

// Fresh drums session with a single pitched part so drums can materialize
// (a drums arrangement is never index 0).
function seed(extra = {}) {
    Object.assign(S, {
        filename: 'autosplit.sloppak', format: 'sloppak', sessionId: 'sess-drums',
        arrangements: [gtr('Lead')], currentArr: 0,
        drumTab: null, drumTabDirty: false, drumSel: new Set(['stale']),
        ...extra,
    });
}

// Route import-drums-midi to a FRESH tab per call (the real endpoint does), so
// the multi-part path never collapses on a shared object reference.
function installDrumFetch() {
    const log = [];
    let n = 0;
    globalThis.fetch = async (url, opts = {}) => {
        log.push({ url: String(url), body: opts.body ? JSON.parse(opts.body) : null });
        if (String(url).includes('import-drums-midi')) {
            n += 1;
            return { ok: true, status: 200, json: async () => ({
                drum_tab: drumTab(`Drums ${n}`, [{ t: 0, p: 'kick' }]),
            }) };
        }
        throw new Error('unstubbed fetch: ' + url);
    };
    return log;
}

// ── _stashImportedDrumTab — the shared materialization step ──────────────────

t('_stashImportedDrumTab: sorts hits, marks dirty, clears sel, materializes a drums part, first is primary', () => {
    seed();
    const added = _stashImportedDrumTab(drumTab('Kit', [{ t: 2, p: 'kick' }, { t: 0, p: 'snare' }, { t: 1, p: 'hat' }]));
    assert.strictEqual(added, false, 'the first drum part is the PRIMARY, not an add');
    assert.strictEqual(S.drumTab.name, 'Kit', 'S.drumTab points at the imported tab');
    assert.deepStrictEqual(S.drumTab.hits.map(h => h.t), [0, 1, 2], 'hits are time-sorted');
    assert.strictEqual(S.drumTabDirty, true, 'user-imported → dirty for the next save');
    assert.strictEqual(S.drumSel.size, 0, 'stale drum selection cleared (indices point into the old tab)');
    assert.strictEqual(drumArrangements(S.arrangements).length, 1, 'materialized one type:"drums" arrangement');
    assert.ok(isDrumArrangement(S.arrangements.at(-1)), 'appended last, typed drums');
    assert.strictEqual(S.arrangements[0].name, 'Lead', 'the pitched part is untouched');
});

t('_stashImportedDrumTab: a second call ADDS a second drum part (a song can hold several)', () => {
    seed();
    _stashImportedDrumTab(drumTab('Kit A', [{ t: 0, p: 'kick' }]));
    const added2 = _stashImportedDrumTab(drumTab('Kit B', [{ t: 0, p: 'snare' }]));
    assert.strictEqual(added2, true, 'the second drum part is ADDED, not a replace');
    assert.strictEqual(drumArrangements(S.arrangements).length, 2, 'two type:"drums" arrangements now');
    assert.strictEqual(S.drumTab.name, 'Kit B', 'the freshest part is the active grid target');
});

// ── importMidiDrumTracksIntoSession — the create-flow routing ────────────────

await ta('imports each channel-9 drum track as its own drums part, with the right request', async () => {
    seed();
    const log = installDrumFetch();
    const n = await importMidiDrumTracksIntoSession('/tmp/slopsmith_midi_x/upload.mid', [
        { index: 9, name: 'Drums', notes: 40 },
        { index: 12, name: 'Aux Perc', notes: 8 },
    ]);
    assert.strictEqual(n, 2, 'both drum tracks imported');
    assert.strictEqual(drumArrangements(S.arrangements).length, 2, 'two type:"drums" arrangements materialized');
    const reqs = log.filter(r => r.url.includes('import-drums-midi'));
    assert.strictEqual(reqs.length, 2, 'one import-drums-midi call per drum track');
    assert.strictEqual(reqs[0].body.track_index, 9, 'track_index from the drum track');
    assert.strictEqual(reqs[0].body.arrangement_name, 'Drums', 'the track name rides as the arrangement name');
    assert.strictEqual(reqs[1].body.track_index, 12);
    assert.strictEqual(reqs[1].body.arrangement_name, 'Aux Perc');
    assert.strictEqual(reqs[0].body.midi_path, '/tmp/slopsmith_midi_x/upload.mid', 'the staged create-flow path is reused');
});

await ta('skips a note-less drum track without calling the backend', async () => {
    seed();
    const log = installDrumFetch();
    const n = await importMidiDrumTracksIntoSession('/tmp/slopsmith_midi_x/upload.mid', [
        { index: 9, name: 'Empty', notes: 0 },
        { index: 10, name: 'Real', notes: 5 },
    ]);
    assert.strictEqual(n, 1, 'only the note-bearing track imported');
    const reqs = log.filter(r => r.url.includes('import-drums-midi'));
    assert.strictEqual(reqs.length, 1, 'the empty track was never fetched');
    assert.strictEqual(reqs[0].body.track_index, 10);
});

await ta('one failing track does not abort the rest', async () => {
    seed();
    let call = 0;
    globalThis.fetch = async (url) => {
        call += 1;
        if (String(url).includes('import-drums-midi')) {
            if (call === 1) return { ok: true, status: 200, json: async () => ({ error: 'bad track' }) };
            return { ok: true, status: 200, json: async () => ({ drum_tab: drumTab('Kit', [{ t: 0, p: 'kick' }]) }) };
        }
        throw new Error('unstubbed fetch: ' + url);
    };
    const n = await importMidiDrumTracksIntoSession('/tmp/slopsmith_midi_x/upload.mid', [
        { index: 9, name: 'Broken', notes: 3 },
        { index: 10, name: 'Good', notes: 3 },
    ]);
    assert.strictEqual(n, 1, 'the good track still imported after the bad one errored');
    assert.strictEqual(drumArrangements(S.arrangements).length, 1);
});

await ta('guards: no session / no path / empty list import nothing and never fetch', async () => {
    let fetched = 0;
    globalThis.fetch = async () => { fetched += 1; throw new Error('should not fetch'); };
    seed({ sessionId: null });
    assert.strictEqual(await importMidiDrumTracksIntoSession('/tmp/x.mid', [{ index: 9, notes: 4 }]), 0, 'no session → 0');
    seed();
    assert.strictEqual(await importMidiDrumTracksIntoSession('', [{ index: 9, notes: 4 }]), 0, 'no path → 0');
    assert.strictEqual(await importMidiDrumTracksIntoSession('/tmp/x.mid', []), 0, 'empty list → 0');
    assert.strictEqual(fetched, 0, 'no backend call on any guarded path');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
