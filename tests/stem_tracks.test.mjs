/*
 * Multitrack stem manager (studio-session ingest): the row model, the
 * pairing rules, atomic link submission, session-dirty lifecycle marks,
 * and the solo-my-source-track verb.
 *
 * Pinned here:
 *   - rows follow S.stems ORDER (the manifest is order-authoritative) and
 *     resolve their paired chart track by the _partViewKeyPure rule
 *     (id-or-name — never a bare index, so links survive part reordering);
 *   - a chart track pairs with ONE stem (re-pairing drops the old link)
 *     and picking '' unlinks;
 *   - EVERY stem operation (pairing sync, rename, reorder, delete, import)
 *     ships the CURRENT S.stemLinks, so the authoritative {stems,
 *     stem_links} response can never resurrect stale links over an unsaved
 *     pairing (review #283 item 15) — and a failed POST half-applies
 *     nothing: frontend state stays, the error surfaces;
 *   - non-durable stem changes (zip-form / create sessions: persisted=false)
 *     mark the session dirty so the lifecycle guard prompts before they can
 *     be discarded; dir-form sloppaks (persisted=true) stay clean (item 16);
 *   - soloMyStem is gated on a REAL host.stemMixChanged consumer — with
 *     none wired it reports unavailable and changes nothing (item 17) —
 *     and is EXCLUSIVE: enabling clears every other stem's solo, toggling
 *     off restores the no-solo state (item 18);
 *   - the save and build bodies both ship stem_links (the persistence wire).
 *
 * Run: node tests/stem_tracks.test.mjs
 */
import assert from 'node:assert';

// ── Fake DOM: just enough for the modal's delegated handlers ─────────
class FakeElement {
    constructor(props = {}) {
        this._closestMap = {};
        this._attrs = {};
        this._handlers = {};
        this._classes = new Set();
        this.innerHTML = '';
        Object.assign(this, props);
    }
    closest(sel) { return this._closestMap[sel] || null; }
    getAttribute(name) { return this._attrs[name] ?? null; }
    addEventListener(type, fn) { this._handlers[type] = fn; }
    get classList() {
        const s = this._classes;
        return {
            add: (c) => s.add(c),
            remove: (c) => s.delete(c),
            contains: (c) => s.has(c),
            toggle: (c, force) => { if (force) s.add(c); else s.delete(c); },
        };
    }
}
globalThis.Element = FakeElement;

const modalEl = new FakeElement();
const listEl = new FakeElement();
const statusEl = new FakeElement({ textContent: '' });
globalThis.document = {
    getElementById: (id) => ({
        'editor-stem-tracks-modal': modalEl,
        'editor-stem-tracks-list': listEl,
        'editor-status': statusEl,
    }[id] || null),
    addEventListener: () => {},
    removeEventListener: () => {},
    activeElement: null,
};
globalThis.localStorage = globalThis.localStorage || { getItem: () => null, setItem: () => {} };
globalThis.window = globalThis.window || globalThis;

// ── Fetch stub: a scripted backend; every request is recorded ────────
const fetchLog = [];
let fetchImpl = () => { throw new Error('no fetch scripted for this test'); };
globalThis.fetch = (url, opts) => {
    fetchLog.push({ url, opts });
    return Promise.resolve().then(() => fetchImpl(url, opts));
};
// Everything in the module is microtask-based (no timers): one macrotask
// turn drains the whole fetch → adopt → status chain.
const flush = () => new Promise((r) => setImmediate(r));

const stemTracks = await import('../src/stem-tracks.js');
const {
    _stemLinkSetPure, _stemRowsPure, _submitStemOp,
    editorSoloMyStem, initStemTracks, stemMixerAvailable,
} = stemTracks;
const { S } = await import('../src/state.js');
const { host, setHostHooks } = await import('../src/host.js');

initStemTracks();

// Synthetic modal events (the handlers are delegated, so the target's
// closest() map is the whole contract).
const changeEvent = (target) => modalEl._handlers.change({ target });
const clickEvent = (target) => modalEl._handlers.click({ target });

function makePairSelect(sid, arrKey) {
    const row = new FakeElement({ _attrs: { 'data-stem-id': sid } });
    const sel = new FakeElement({ value: arrKey });
    sel._closestMap['[data-stem-pair]'] = sel;
    sel._closestMap['[data-stem-id]'] = row;
    return sel;
}
function makeDeleteButton(sid) {
    const row = new FakeElement({ _attrs: { 'data-stem-id': sid } });
    const btn = new FakeElement();
    btn._closestMap['[data-stem-id]'] = row;
    btn._closestMap['[data-stem-delete]'] = btn;
    return btn;
}
function makeMoveButton(sid, dir) {
    const row = new FakeElement({ _attrs: { 'data-stem-id': sid } });
    const btn = new FakeElement({ _attrs: { 'data-stem-move': dir } });
    btn._closestMap['[data-stem-id]'] = row;
    btn._closestMap['[data-stem-move]'] = btn;
    return btn;
}

function seedSession(links = {}) {
    Object.assign(S, {
        sessionId: 'sess1', sessionDirty: false,
        arrangements: [{ id: 'a1', name: 'Lead' }], currentArr: 0,
        stems: [{ id: 'Guitar_L' }, { id: 'Bass_DI' }],
        stemLinks: { ...links }, stemMix: {},
    });
    statusEl.textContent = '';
    fetchLog.length = 0;
}

let pass = 0, fail = 0;
const tests = [];
function t(name, fn) { tests.push([name, fn]); }

t('rows follow stem order and resolve pairings by the id-or-name key rule', () => {
    const stems = [{ id: 'Guitar_L' }, { id: 'Bass_DI' }, { id: 'Kick_In' }];
    const arrangements = [{ id: 'a1', name: 'Lead' }, { name: 'Bass' }];
    const links = { a1: 'Guitar_L', Bass: 'Bass_DI' };
    const rows = _stemRowsPure(stems, links, arrangements);
    assert.deepStrictEqual(rows.map(r => r.id), ['Guitar_L', 'Bass_DI', 'Kick_In'], 'order kept');
    assert.strictEqual(rows[0].pairedWith.name, 'Lead', 'id-keyed link resolves');
    assert.strictEqual(rows[1].pairedWith.name, 'Bass', 'name-keyed link resolves');
    assert.strictEqual(rows[2].pairedWith, null, 'unpaired is honest');
});

t('a chart track pairs with ONE stem; re-pairing replaces; empty unlinks', () => {
    let links = _stemLinkSetPure({}, 'a1', 'Guitar_L');
    assert.deepStrictEqual(links, { a1: 'Guitar_L' });
    links = _stemLinkSetPure(links, 'a1', 'Guitar_R');
    assert.deepStrictEqual(links, { a1: 'Guitar_R' }, 're-pairing replaces the old link');
    links = _stemLinkSetPure(links, 'a1', '');
    assert.deepStrictEqual(links, {}, 'empty unlinks');
});

// ── Item 17: capability gate — the verb must not claim to change audio ──
t('soloMyStem is honest when no stem mixer consumes S.stemMix', () => {
    delete host.stemMixChanged;      // the branch's reality: no consumer wired
    seedSession({ a1: 'Guitar_L' });
    assert.strictEqual(stemMixerAvailable(), false);
    editorSoloMyStem();
    assert.deepStrictEqual(S.stemMix, {}, 'no consumer → no state flip nothing reads');
    assert.match(statusEl.textContent, /mixer/i, 'status names the missing capability');
    assert.doesNotMatch(statusEl.textContent, /^Soloing/, 'must not claim the audio changed');
    // …and springs to life the moment a real consumer is wired.
    let mixCalls = 0;
    setHostHooks({ stemMixChanged: () => { mixCalls++; } });
    assert.strictEqual(stemMixerAvailable(), true);
    editorSoloMyStem();
    assert.strictEqual(S.stemMix.Guitar_L.solo, true, 'wired hook → the solo lands');
    assert.strictEqual(mixCalls, 1, 'the consumer hears the change');
});

t('soloMyStem solos the paired stem, leaves unsoloed stems alone, toggles off', () => {
    setHostHooks({ stemMixChanged: () => {} });   // a real (fake) consumer
    seedSession({ a1: 'Guitar_L' });
    editorSoloMyStem();
    assert.strictEqual(S.stemMix.Guitar_L.solo, true);
    assert.strictEqual(S.stemMix.Guitar_L.mute, false, 'solo clears any mute');
    assert.strictEqual(S.stemMix.Bass_DI, undefined, 'an unsoloed stem needs no entry');
    editorSoloMyStem();
    assert.strictEqual(S.stemMix.Guitar_L.solo, false, 'second press releases');
    // No pairing = a status nudge, never a throw or a wrong solo.
    S.stemLinks = {};
    editorSoloMyStem();
    assert.strictEqual(S.stemMix.Bass_DI, undefined);
});

// ── Item 18: exclusive isolate — Guitar after Bass must not stack ──────
t('soloMyStem clears other stem solos on enable; toggle-off = no solos at all', () => {
    setHostHooks({ stemMixChanged: () => {} });
    seedSession({ a1: 'Guitar_L' });
    S.stems = [{ id: 'Guitar_L' }, { id: 'Bass_DI' }, { id: 'Kick' }];
    S.stemMix = {
        Bass_DI: { vol: 100, mute: false, solo: true },   // e.g. Bass was soloed first
        Kick: { vol: 80, mute: false, solo: false },
    };
    editorSoloMyStem();
    assert.strictEqual(S.stemMix.Guitar_L.solo, true, 'my source is soloed');
    assert.strictEqual(S.stemMix.Bass_DI.solo, false, 'the previous solo is cleared — isolate, not stack');
    assert.strictEqual(S.stemMix.Kick.solo, false);
    assert.strictEqual(S.stemMix.Kick.vol, 80, 'non-solo mix fields survive');
    editorSoloMyStem();
    assert.ok(Object.values(S.stemMix).every((m) => !m.solo),
        'toggle-off restores the no-solo state (all solos cleared)');
});

// ── Item 17 surface: the menu greys the verb until the capability exists ──
t('menu greys Solo-my-source until a stem mixer capability exists', async () => {
    const { EDITOR_MENUS, _menuModelPure } = await import('../src/menu-bar.js');
    const { _editorShortcutRowsPure } = await import('../src/shortcuts.js');
    const rows = _editorShortcutRowsPure('feedback');
    const find = (ctx) => _menuModelPure(EDITOR_MENUS, rows, ctx)
        .flatMap((m) => m.items)
        .find((i) => i.label === 'Solo my source track (paired stem)');
    const base = { tempoMapMode: false, hasAudio: true, fns: new Set() };
    assert.strictEqual(find({ ...base, stemMixer: false }).disabled, true,
        'no mixer capability → greyed');
    assert.strictEqual(find({ ...base, stemMixer: true }).disabled, false,
        'capability present → enabled');
});

// ── Item 15: atomic link submission across the whole op surface ────────
// The scripted backend follows the FIXED routes.py contract: the session's
// links update ONLY from the submitted stem_links snapshot, then rename
// follows the id / delete drops its links, and the response echoes the
// session's now-current links.
function scriptedBackend(backend) {
    return (url, opts) => {
        const body = JSON.parse(opts.body);
        if (body.stem_links && typeof body.stem_links === 'object') {
            backend.links = { ...body.stem_links };
        }
        if (body.op === 'rename') {
            backend.stems = backend.stems.map(
                (s2) => (s2.id === body.id ? { id: body.new_id } : s2));
            for (const [k, v] of Object.entries(backend.links)) {
                if (v === body.id) backend.links[k] = body.new_id;
            }
        } else if (body.op === 'reorder') {
            const byId = Object.fromEntries(backend.stems.map((s2) => [s2.id, s2]));
            backend.stems = body.order.map((id) => byId[id]);
        } else if (body.op === 'delete') {
            backend.stems = backend.stems.filter((s2) => s2.id !== body.id);
            for (const [k, v] of Object.entries(backend.links)) {
                if (v === body.id) delete backend.links[k];
            }
        }
        return { json: async () => ({
            stems: backend.stems.slice(), stem_links: { ...backend.links },
            persisted: false,
        }) };
    };
}

t('pair → reorder/delete/rename: every op ships the pairing; no stale echo', async () => {
    seedSession();
    const backend = { stems: [{ id: 'Guitar_L' }, { id: 'Bass_DI' }], links: {} };
    fetchImpl = scriptedBackend(backend);

    // 1. PAIR Lead ↔ Guitar_L in the modal. The pairing must reach the
    //    backend session NOW (an op of its own), not sit frontend-only.
    changeEvent(makePairSelect('Guitar_L', 'a1'));
    await flush();
    assert.deepStrictEqual(S.stemLinks, { a1: 'Guitar_L' });
    assert.ok(fetchLog.length >= 1, 'pairing syncs to the backend session');
    assert.deepStrictEqual(backend.links, { a1: 'Guitar_L' }, 'backend session is never behind');

    // 2. REORDER — the op body carries the current pairings, and the
    //    authoritative response cannot resurrect a pre-pairing world.
    clickEvent(makeMoveButton('Bass_DI', 'up'));
    await flush();
    const reorderBody = JSON.parse(fetchLog[fetchLog.length - 1].opts.body);
    assert.deepStrictEqual(reorderBody.stem_links, { a1: 'Guitar_L' },
        'reorder ships the current pairings');
    assert.deepStrictEqual(S.stemLinks, { a1: 'Guitar_L' }, 'pair → reorder keeps the pairing');
    assert.deepStrictEqual(S.stems.map((s2) => s2.id), ['Bass_DI', 'Guitar_L']);

    // 3. DELETE the unpaired stem — same contract.
    clickEvent(makeDeleteButton('Bass_DI'));
    await flush();
    const deleteBody = JSON.parse(fetchLog[fetchLog.length - 1].opts.body);
    assert.deepStrictEqual(deleteBody.stem_links, { a1: 'Guitar_L' },
        'delete ships the current pairings');
    assert.deepStrictEqual(S.stemLinks, { a1: 'Guitar_L' }, 'pair → delete keeps the pairing');
    assert.deepStrictEqual(S.stems.map((s2) => s2.id), ['Guitar_L']);

    // 4. RENAME follows the link to the new id server-side.
    const ok = await _submitStemOp({ op: 'rename', id: 'Guitar_L', new_id: 'Gtr' }, 'Renamed.', 'rename');
    assert.strictEqual(ok, true);
    const renameBody = JSON.parse(fetchLog[fetchLog.length - 1].opts.body);
    assert.deepStrictEqual(renameBody.stem_links, { a1: 'Guitar_L' },
        'rename ships the current pairings');
    assert.deepStrictEqual(S.stemLinks, { a1: 'Gtr' }, 'the pairing follows the rename');
});

t('a failed op half-applies nothing: state kept, error surfaced, pairing marks dirty', async () => {
    seedSession();
    fetchImpl = () => ({ json: async () => ({ error: 'disk full' }) });

    changeEvent(makePairSelect('Guitar_L', 'a1'));
    await flush();
    assert.deepStrictEqual(S.stemLinks, { a1: 'Guitar_L' },
        'pairing stays local when the sync fails (Save still ships it)');
    assert.strictEqual(S.sessionDirty, true, 'an unsynced pairing marks the session dirty');
    assert.match(statusEl.textContent, /failed: disk full/);

    S.sessionDirty = false;
    clickEvent(makeDeleteButton('Bass_DI'));
    await flush();
    assert.deepStrictEqual(S.stems.map((s2) => s2.id), ['Guitar_L', 'Bass_DI'],
        'failed delete leaves the stems untouched');
    assert.deepStrictEqual(S.stemLinks, { a1: 'Guitar_L' }, 'failed delete leaves the links untouched');
    assert.match(statusEl.textContent, /failed: disk full/);
});

// ── Items 15+16 on the import path ─────────────────────────────────────
t('import ships the current pairings and marks a non-durable session dirty', async () => {
    seedSession({ a1: 'Guitar_L' });
    fetchImpl = (url, opts) => {
        const raw = opts.body.get('stem_links');   // multipart FormData
        return { json: async () => ({
            stems: [{ id: 'Guitar_L' }, { id: 'Bass_DI' }, { id: 'Piano' }],
            stem_links: raw ? JSON.parse(raw) : {},
            imported: ['Piano'], skipped: [], next_step: 'save', persisted: false,
        }) };
    };
    const input = new FakeElement({
        id: 'editor-stem-tracks-file', files: [new Blob(['riff'])], value: 'x',
    });
    changeEvent(input);
    await flush();
    const fd = fetchLog[fetchLog.length - 1].opts.body;
    assert.deepStrictEqual(JSON.parse(fd.get('stem_links')), { a1: 'Guitar_L' },
        'import ships the pairing snapshot');
    assert.deepStrictEqual(S.stemLinks, { a1: 'Guitar_L' },
        'the import response cannot wipe an unsaved pairing');
    assert.strictEqual(S.sessionDirty, true, 'zip-form import needs a Save — dirty');
});

// ── Item 16: the dirty mark follows the backend's persisted verdict ────
t('persisted (dir-form) ops leave the session clean; non-durable ops dirty it', async () => {
    seedSession();
    const answer = (persisted) => (url, opts) => {
        const body = JSON.parse(opts.body);
        return { json: async () => ({
            stems: S.stems.slice(), stem_links: body.stem_links || {}, persisted,
        }) };
    };
    fetchImpl = answer(true);       // dir-form sloppak: written straight to disk
    clickEvent(makeMoveButton('Bass_DI', 'up'));
    await flush();
    assert.strictEqual(S.sessionDirty, false,
        'dir-form (already persisted) must NOT dirty the session');
    fetchImpl = answer(false);      // zip-form / create: durable only on Save/Build
    clickEvent(makeMoveButton('Bass_DI', 'up'));
    await flush();
    assert.strictEqual(S.sessionDirty, true,
        'non-durable op must dirty the session so the guard prompts');
});

t('the save and build bodies both ship stem_links', async () => {
    const fs = await import('node:fs');
    const fileOps = fs.readFileSync(new URL('../src/file-ops.js', import.meta.url), 'utf8');
    assert.match(fileOps, /stem_links:\s*S\.stemLinks \|\| \{\}/, 'save-body persistence wire present');
    const create = fs.readFileSync(new URL('../src/create.js', import.meta.url), 'utf8');
    assert.match(create, /stem_links:\s*S\.stemLinks \|\| \{\}/,
        'create-mode Build ships the pairings too (the third save path)');
});

for (const [name, fn] of tests) {
    try { await fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
