/*
 * MIDI-only create + real multitrack unpack (the dkcjungle-2.mid fix):
 * a staged MIDI is a project now, and EVERY selected track imports.
 *
 * Pinned here:
 *   - the default title reads from the filename (never empty — the
 *     blank-create backend requires one);
 *   - unpacked track names are KEYS-SAFE: kind inference is name-driven and
 *     the imported notes use keys packing, so 'Bass, Baby.' must become
 *     'Keys — Bass, Baby.' (a bare bass-name would render the packing as
 *     fretted lanes — garbage);
 *   - the placeholder seed is removed ONLY when it is provably untouched
 *     (flagged index, seeded name, zero notes/chords, not the last part).
 *
 * Review #284 items 19-21 regressions:
 *   - item 19: the MIDI stage is ONE honest slot — the LAST pick wins,
 *     replaces whatever was staged, and the status says so (no silent
 *     first-file-wins over a multi-select);
 *   - item 20: a SINGLE selected track keeps its source name too —
 *     'Keys — Melody', never a generic 'Keys';
 *   - item 21: seed cleanup is PROVENANCE-driven — an untouched default
 *     roster is boilerplate, but a user who explicitly rebuilt ['Lead']
 *     (remove, re-add) keeps it even though the VALUE equals the default.
 *
 * Fails on pre-fix code (single-slot staging, unconditional naming, and the
 * provenance flag/pures don't exist there).
 * Run: node tests/midi_create.test.mjs
 */
import assert from 'node:assert';

// ── Minimal DOM: a registry of shared fake elements so the code under test
// and the assertions see the same nodes. Collaborator surface only — no
// subject under test is stubbed.
const _els = new Map();
function _mkEl(tag = 'div') {
    return {
        tagName: String(tag).toUpperCase(),
        children: [],
        textContent: '', innerHTML: '', value: '', title: '', className: '',
        id: '', type: '', disabled: false, draggable: false,
        style: {},
        classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
        appendChild(c) { this.children.push(c); return c; },
        replaceChildren() { this.children = []; },
        addEventListener() {}, removeEventListener() {},
        querySelector: () => null, remove() {}, focus() {},
        onclick: null,
    };
}
// What querySelectorAll('input[name="keys-track"]:checked') returns — each
// test pushes the checkbox stand-ins it wants "checked".
const _checkedTracks = [];
globalThis.document = {
    getElementById(id) { if (!_els.has(id)) _els.set(id, _mkEl()); return _els.get(id); },
    createElement: (tag) => _mkEl(tag),
    querySelectorAll: () => _checkedTracks.slice(),
    addEventListener() {}, removeEventListener() {},
    activeElement: null,
    body: _mkEl('body'),
};
globalThis.localStorage = globalThis.localStorage || { getItem: () => null, setItem: () => {} };
globalThis.window = globalThis.window || globalThis;

// Namespace imports — createState is REASSIGNED by editorShowCreateModal, so
// tests must read it through the live module binding, never a destructured copy.
const create = await import('../src/create.js');
const imp = await import('../src/import.js');
const { S } = await import('../src/state.js');
const { KEYS_PATTERN } = await import('../src/keys.js');
const { _midiDefaultTitlePure, _midiStageSlotPure, _midiSeedRosterPure } = create;
const { _midiKeysArrNamePure, _midiSeedRemovablePure } = imp;

let pass = 0, fail = 0;
function t(name, fn) {
    try { fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}
async function ta(name, fn) {
    try { await fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}

// Route fetch by URL fragment; returns the request log for body assertions.
function installFetch(routes) {
    const log = [];
    globalThis.fetch = async (url, opts = {}) => {
        log.push({ url: String(url), opts });
        for (const [frag, data] of routes) {
            if (String(url).includes(frag)) {
                return { ok: true, status: 200, json: async () => data };
            }
        }
        throw new Error('unstubbed fetch: ' + url);
    };
    return log;
}

t('the default title reads from the filename and is never empty', () => {
    assert.strictEqual(_midiDefaultTitlePure('dkcjungle-2.mid'), 'dkcjungle 2');
    assert.strictEqual(_midiDefaultTitlePure('My_Song.midi'), 'My Song');
    assert.strictEqual(_midiDefaultTitlePure(''), 'MIDI import');
    assert.strictEqual(_midiDefaultTitlePure('.mid'), 'MIDI import');
});

t('unpacked track names are keys-safe — the kind stays keys whatever the track was called', () => {
    for (const raw of ['Bass, Baby.', 'Normal Tune', 'DRUMS!!', 'guitar solo', '']) {
        const name = _midiKeysArrNamePure(raw, 7);
        assert.ok(KEYS_PATTERN.test(name), `${JSON.stringify(name)} must read as keys`);
        if (raw) assert.ok(name.includes(raw), 'the source track stays identifiable');
    }
    assert.strictEqual(_midiKeysArrNamePure('', 7), 'Keys — Track 7', 'unnamed tracks fall back honestly');
});

t('the seed placeholder is removed ONLY when provably untouched', () => {
    const seed = { name: 'Lead', notes: [], chords: [] };
    assert.strictEqual(_midiSeedRemovablePure(seed, 0, 0, 2), true);
    assert.strictEqual(_midiSeedRemovablePure(seed, 0, 0, 1), false, 'never the last part');
    assert.strictEqual(_midiSeedRemovablePure({ ...seed, notes: [{}] }, 0, 0, 2), false, 'user work stays');
    assert.strictEqual(_midiSeedRemovablePure({ ...seed, name: 'Lead 2' }, 0, 0, 2), false, 'renamed = not the seed');
    assert.strictEqual(_midiSeedRemovablePure(seed, 1, 0, 2), false, 'wrong index');
    assert.strictEqual(_midiSeedRemovablePure(seed, 0, undefined, 2), false, 'no flag = no cleanup');
});

// ── Item 19: one honest MIDI slot ───────────────────────────────────────────

t('the slot rule is pure: last pick wins, replacement is stated', () => {
    const solo = _midiStageSlotPure(null, ['a.mid']);
    assert.strictEqual(solo.name, 'a.mid');
    assert.ok(!solo.status.includes('replac'), 'nothing replaced = no replacement talk');

    const multi = _midiStageSlotPure(null, ['a.mid', 'b.mid', 'c.mid']);
    assert.strictEqual(multi.name, 'c.mid', 'the LAST of a multi-select is staged');
    assert.ok(multi.status.includes('c.mid'), 'status names the kept file');
    assert.ok(multi.status.includes('a.mid') && multi.status.includes('b.mid'),
        'status admits every dropped file');

    const restage = _midiStageSlotPure('a.mid', ['b.mid']);
    assert.strictEqual(restage.name, 'b.mid');
    assert.ok(restage.status.includes('a.mid'), 'replacing an earlier stage is stated too');
});

await ta('staging is a single honest slot — the last pick is what Create sends', async () => {
    create.editorShowCreateModal();
    await create.editorContentImportSelected(
        { files: [{ name: 'first.mid' }, { name: 'second.mid' }], value: 'x' });
    let cs = create.createState;
    assert.strictEqual((cs.midiFiles || []).length, 1, 'exactly one file stays staged');
    assert.strictEqual(cs.midiFiles[0].name, 'second.mid', 'the LAST pick is the one staged');
    assert.strictEqual(cs.midiInfo, 'second.mid', 'the staged row shows the one kept file');
    assert.strictEqual(document.getElementById('editor-create-title').value, 'second',
        'the default title reads from the KEPT file');
    const status1 = document.getElementById('editor-create-import-status').textContent;
    assert.ok(status1.includes('second.mid'), 'status names the staged file');
    assert.ok(status1.includes('first.mid'), 'status admits the dropped file');

    // Staging again REPLACES (single slot). _editorDoMidiCreate reads
    // midiFiles[0], which the single slot guarantees is exactly this file.
    await create.editorContentImportSelected({ files: [{ name: 'third.mid' }], value: '' });
    cs = create.createState;
    assert.deepStrictEqual(cs.midiFiles.map((f) => f.name), ['third.mid']);
    assert.strictEqual(cs.midiInfo, 'third.mid');
    const status2 = document.getElementById('editor-create-import-status').textContent;
    assert.ok(status2.includes('third.mid') && status2.includes('second.mid'),
        'replacement is stated, not silent');
});

// ── Item 20: a single selected track keeps its source name ─────────────────

await ta('a SINGLE selected MIDI track keeps its source name (keys-safe)', async () => {
    Object.assign(S, { sessionId: 'sess-keys-1', format: 'sloppak', arrangements: [], currentArr: 0 });
    delete S._midiSeedArrIdx;
    const log = installFetch([
        ['import-midi', { midi_path: '/tmp/up.mid', tracks: [{ index: 3, name: 'Melody', notes: 42, is_piano: true }] }],
        ['import-keys-midi', { arrangements: [{ name: 'Keys', notes: [], chords: [], chord_templates: [] }] }],
        ['add-arrangement', { ok: true }],
    ]);
    await imp._editorKeysHandleFile({ name: 'song.mid' });
    _checkedTracks.length = 0;
    _checkedTracks.push({ value: '0' });
    await imp.editorDoAddKeys();
    assert.strictEqual(S.arrangements.length, 1, 'the one track imported: '
        + document.getElementById('editor-add-keys-status').textContent);
    assert.strictEqual(S.arrangements[0].name, 'Keys — Melody',
        'one import keeps its source name, not a generic Keys');
    assert.ok(KEYS_PATTERN.test(S.arrangements[0].name), 'and stays keys-safe');
    const req = log.find((r) => r.url.includes('import-keys-midi'));
    assert.deepStrictEqual(JSON.parse(req.opts.body).tracks, [{ index: 3, channel_filter: null }],
        'the picked track (and only it) is requested');
});

await ta('every selected track imports, each under its keys-safe source name', async () => {
    Object.assign(S, { sessionId: 'sess-keys-2', format: 'sloppak', arrangements: [], currentArr: 0 });
    delete S._midiSeedArrIdx;
    installFetch([
        ['import-midi', { midi_path: '/tmp/up2.mid', tracks: [
            { index: 0, name: 'Melody', notes: 42, is_piano: true },
            { index: 1, name: 'Bass, Baby.', notes: 10, is_piano: true },
        ] }],
        ['import-keys-midi', { arrangements: [
            { name: 'Keys', notes: [], chords: [], chord_templates: [] },
            { name: 'Keys', notes: [], chords: [], chord_templates: [] },
        ] }],
        ['add-arrangement', { ok: true }],
    ]);
    await imp._editorKeysHandleFile({ name: 'song2.mid' });
    _checkedTracks.length = 0;
    _checkedTracks.push({ value: '0' }, { value: '1' });
    await imp.editorDoAddKeys();
    assert.deepStrictEqual(S.arrangements.map((a) => a.name),
        ['Keys — Melody', 'Keys — Bass, Baby.']);
});

// ── Seed flag is session-scoped: a cancelled picker must not delete another
//    song's arrangement 0. The MIDI-only create sets S._midiSeedArrIdx=0 for
//    its own session; if the user cancels the auto-opened picker and opens a
//    DIFFERENT song (loadCDLC carries the flag over unchanged), a later import
//    there must NOT remove that song's empty 'Lead' arrangement. ──────────────
await ta('a stale seed flag from a cancelled create never deletes another song\'s arrangement 0', async () => {
    // Song B, opened after a MIDI create whose picker was cancelled: it happens
    // to have an empty 'Lead' at index 0 (a fresh blank-Lead project). The flag
    // still points at index 0 but was tagged to song A's session.
    Object.assign(S, {
        sessionId: 'sess-B', format: 'sloppak', currentArr: 0,
        arrangements: [{ name: 'Lead', notes: [], chords: [], chord_templates: [] }],
        _midiSeedArrIdx: 0, _midiSeedSession: 'sess-A',
    });
    installFetch([
        ['import-midi', { midi_path: '/tmp/b.mid', tracks: [{ index: 0, name: 'Melody', notes: 5, is_piano: true }] }],
        ['import-keys-midi', { arrangements: [{ name: 'Keys', notes: [], chords: [], chord_templates: [] }] }],
        ['add-arrangement', { ok: true }],
        ['remove-arrangement', { ok: true }],
    ]);
    await imp._editorKeysHandleFile({ name: 'b.mid' });
    _checkedTracks.length = 0;
    _checkedTracks.push({ value: '0' });
    await imp.editorDoAddKeys();
    assert.ok(S.arrangements.some((a) => a.name === 'Lead'),
        'song B\'s own empty Lead survives — the stale flag belonged to session A');
    assert.deepStrictEqual(S.arrangements.map((a) => a.name), ['Lead', 'Keys — Melody']);
});

// ── Item 21: seed cleanup is provenance-driven, not value-driven ────────────

t('_midiSeedRosterPure: provenance decides, the roster VALUE does not', () => {
    assert.deepStrictEqual(_midiSeedRosterPure(['Lead'], false), { roster: ['Lead'], seeded: true },
        'untouched default = boilerplate, replaced by the removable seed');
    assert.deepStrictEqual(_midiSeedRosterPure(['Lead'], true), { roster: ['Lead'], seeded: false },
        'an explicitly-built Lead — same value — is intent and stays');
    assert.deepStrictEqual(_midiSeedRosterPure(['Rhythm', 'Bass'], true), { roster: ['Rhythm', 'Bass'], seeded: false });
    assert.deepStrictEqual(_midiSeedRosterPure([], true), { roster: ['Lead'], seeded: true },
        'an emptied roster still gets the seed — the backend requires >=1 arrangement');
    assert.deepStrictEqual(_midiSeedRosterPure([], false), { roster: ['Lead'], seeded: true });
    assert.deepStrictEqual(_midiSeedRosterPure(undefined, undefined), { roster: ['Lead'], seeded: true },
        'defensive: a pre-modal createState has neither field');
});

t('roster interaction marks provenance — an explicit re-build of the default is kept', () => {
    create.editorShowCreateModal();
    assert.strictEqual(create.createState.rosterTouched, false, 'fresh modal = untouched');
    let plan = _midiSeedRosterPure(create.createState.roster, create.createState.rosterTouched);
    assert.strictEqual(plan.seeded, true, 'untouched default gets the removable seed');

    // The user removes Lead then re-adds it via the palette — the VALUE ends
    // equal to the default, but it is now their explicit choice.
    const palette = document.getElementById('editor-create-roster-palette');
    const leadBtn = () => palette.children.find((b) => (b.textContent || '').includes('Lead Guitar'));
    leadBtn().onclick();                                   // remove
    assert.deepStrictEqual(create.createState.roster, []);
    leadBtn().onclick();                                   // re-add
    assert.deepStrictEqual(create.createState.roster, ['Lead']);
    assert.strictEqual(create.createState.rosterTouched, true, 'interaction marks provenance');
    plan = _midiSeedRosterPure(create.createState.roster, create.createState.rosterTouched);
    assert.strictEqual(plan.seeded, false, 'explicit Lead is NOT auto-removed after import');
    assert.deepStrictEqual(plan.roster, ['Lead']);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
