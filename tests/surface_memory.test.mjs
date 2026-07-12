/*
 * Tests for entry-seeded presets + per-song surface memory (src/toolbars.js,
 * workspace-shell C1, charrette §3.1/§3.3).
 *
 * The contract pinned here: opening a song re-resolves the surface as
 * per-song memory → global default (so graduation on one song reaches every
 * song without a memory, but a song's own memory always wins); a manual
 * change writes BOTH blobs; a lane seed (create → Compose, import →
 * Transcribe) writes the song's memory but NEVER the global default;
 * "Reset layout" now also DELETES the song's memory (the charrette's
 * "Reset workspace" rescue); the archive→sloppak save-as migrates the
 * memory to the new filename; and blocked/garbage storage degrades, never
 * throws.
 *
 * Run: node tests/surface_memory.test.mjs
 */
import assert from 'node:assert';

// Minimal DOM/storage slice, installed before the module imports resolve.
const _store = new Map();
globalThis.localStorage = globalThis.localStorage || {
    getItem: (k) => (_store.has(k) ? _store.get(k) : null),
    setItem: (k, v) => { _store.set(k, String(v)); },
    removeItem: (k) => { _store.delete(k); },
};
globalThis.document = globalThis.document || {
    getElementById: () => null, addEventListener: () => {}, activeElement: null,
    querySelectorAll: () => [],
};
globalThis.window = globalThis.window || globalThis;

const {
    TOOLBAR_PRESETS,
    _surfaceKeyPure, _surfaceResolvePure, _toolbarStateLoadPure, _toolbarVisiblePure,
    toggleToolbar, applyToolbarPreset, resetToolbarLayout,
    surfaceOnSongLoaded, seedSurfacePreset, surfacePersistFor, surfaceMigrateFilename,
    getToolbarCtx, _resetToolbarStateForTest,
} = await import('../src/toolbars.js');
const { S } = await import('../src/state.js');

let pass = 0, fail = 0;
function t(name, fn) {
    try { fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}

// Fresh world: empty storage, no cached module state, no song loaded.
function reset() {
    _store.clear();
    _resetToolbarStateForTest();
    Object.assign(S, { filename: '' });
}
const GLOBAL_KEY = 'editorToolbars';
const keyOf = (fn) => 'editorSurface:' + fn;

// ── The pures ─────────────────────────────────────────────────────────

t('_surfaceKeyPure: filename → namespaced key; create mode (no filename) → null', () => {
    assert.strictEqual(_surfaceKeyPure('a.feedpak'), 'editorSurface:a.feedpak');
    assert.strictEqual(_surfaceKeyPure(''), null);
    assert.strictEqual(_surfaceKeyPure(null), null);
    assert.strictEqual(_surfaceKeyPure(undefined), null);
});

t('_surfaceResolvePure: a valid per-song blob wins over global', () => {
    const song = JSON.stringify({ preset: 'compose', overrides: {}, revealed: {} });
    const glob = JSON.stringify({ preset: 'transcribe', overrides: {}, revealed: {} });
    const r = _surfaceResolvePure(song, glob);
    assert.strictEqual(r.source, 'song');
    assert.strictEqual(r.state.preset, 'compose');
});

t('_surfaceResolvePure: absent/garbage per-song blob falls through to global', () => {
    const glob = JSON.stringify({ preset: 'compose', overrides: { parts: false }, revealed: {} });
    for (const bad of [null, undefined, '', 'not json', '42', '"str"', '[]']) {
        const r = _surfaceResolvePure(bad, glob);
        assert.strictEqual(r.source, 'global', String(bad));
        assert.deepStrictEqual(r.state, _toolbarStateLoadPure(glob), String(bad));
    }
});

t('_surfaceResolvePure: both blobs garbage → the default surface, no throw', () => {
    const r = _surfaceResolvePure('nope', 'also nope');
    assert.strictEqual(r.state.preset, 'everything');
    assert.deepStrictEqual(r.state.overrides, {});
});

t('_surfaceResolvePure: a PRESENT per-song blob with partial garbage degrades per-field, still wins', () => {
    const song = JSON.stringify({ preset: 'compose', overrides: { bogus: true, file: false }, revealed: { nope: true } });
    const r = _surfaceResolvePure(song, JSON.stringify({ preset: 'transcribe', overrides: {}, revealed: {} }));
    assert.strictEqual(r.source, 'song');
    assert.deepStrictEqual(r.state, { preset: 'compose', overrides: { file: false }, revealed: {} });
});

// ── Lane → preset seed (charrette §3.1) ───────────────────────────────

t('seed on a loaded song (create-from-scratch lane): sets Compose, writes the song memory, NEVER the global default', () => {
    reset();
    S.filename = 'new song.feedpak';
    seedSurfacePreset('compose');
    assert.strictEqual(getToolbarCtx().preset, 'compose');
    const mem = JSON.parse(_store.get(keyOf('new song.feedpak')));
    assert.strictEqual(mem.preset, 'compose');
    assert.strictEqual(_store.has(GLOBAL_KEY), false, 'a seed is not graduation');
});

t('seed with no filename (import lane, create mode): in-memory only; Build persists it via surfacePersistFor', () => {
    reset();
    seedSurfacePreset('transcribe');
    assert.strictEqual(getToolbarCtx().preset, 'transcribe');
    assert.strictEqual(_store.size, 0, 'nothing persisted yet');
    surfacePersistFor('built.feedpak');            // the editorBuild success handoff
    const mem = JSON.parse(_store.get(keyOf('built.feedpak')));
    assert.strictEqual(mem.preset, 'transcribe');
    assert.strictEqual(_store.has(GLOBAL_KEY), false, 'still not graduation');
});

t('seed rejects junk preset names without touching anything', () => {
    reset();
    S.filename = 'x.feedpak';
    for (const bad of ['beginner', '', null, undefined, '__proto__', 'toString']) {
        seedSurfacePreset(bad);
    }
    assert.strictEqual(getToolbarCtx().preset, 'everything');
    assert.strictEqual(_store.size, 0);
});

// ── Per-song memory + graduation (fails on main: state was one module blob) ──

t('per-song round-trip: each song lands where its tools were left; memory-less songs follow the default', () => {
    reset();

    // Open song A (no memory anywhere): the default Everything surface.
    S.filename = 'a.feedpak';
    surfaceOnSongLoaded();
    assert.strictEqual(getToolbarCtx().preset, 'everything');
    assert.strictEqual(_store.has(keyOf('a.feedpak')), false,
        'merely opening a song writes NO memory (graduation must keep reaching it)');

    // A manual change on A = A's memory AND the new global default.
    toggleToolbar('parts');
    assert.strictEqual(JSON.parse(_store.get(keyOf('a.feedpak'))).overrides.parts, false);
    assert.strictEqual(JSON.parse(_store.get(GLOBAL_KEY)).overrides.parts, false);

    // Song B has no memory → follows the graduated default.
    S.filename = 'b.feedpak';
    surfaceOnSongLoaded();
    assert.strictEqual(_toolbarVisiblePure(getToolbarCtxState()).parts, false,
        'last manual state became the default');

    // Shape B differently.
    applyToolbarPreset('compose');
    assert.strictEqual(JSON.parse(_store.get(keyOf('b.feedpak'))).preset, 'compose');

    // Back to A: A's own memory wins over the (now compose) default.
    S.filename = 'a.feedpak';
    surfaceOnSongLoaded();
    const a = getToolbarCtxState();
    assert.strictEqual(a.preset, 'everything');
    assert.strictEqual(a.overrides.parts, false, 'A restored exactly, not the new default');
});

// getToolbarCtx returns {visible, preset}; some assertions above want the raw
// state — reload it the way the module does.
function getToolbarCtxState() {
    const ctx = getToolbarCtx();
    const raw = _store.get(keyOf(S.filename)) ?? _store.get(GLOBAL_KEY) ?? null;
    const st = _toolbarStateLoadPure(raw);
    assert.strictEqual(st.preset, ctx.preset, 'persisted and live state agree');
    return st;
}

t('reset layout = the workspace rescue: pure preset back AND the song memory deleted', () => {
    reset();
    _store.set(GLOBAL_KEY, JSON.stringify({ preset: 'compose', overrides: {}, revealed: {} }));
    S.filename = 'a.feedpak';
    _store.set(keyOf('a.feedpak'),
        JSON.stringify({ preset: 'transcribe', overrides: { file: false }, revealed: { harmony: true } }));
    surfaceOnSongLoaded();
    assert.strictEqual(getToolbarCtx().preset, 'transcribe');

    resetToolbarLayout();
    // Back to the current preset's pure default…
    assert.strictEqual(getToolbarCtx().preset, 'transcribe');
    assert.strictEqual(getToolbarCtx().visible.file, true, 'override cleared');
    // …the song's memory is GONE (it follows the default again)…
    assert.strictEqual(_store.has(keyOf('a.feedpak')), false);
    // …and the global default records the reset (a manual act).
    assert.strictEqual(JSON.parse(_store.get(GLOBAL_KEY)).preset, 'transcribe');

    // Re-opening the song now follows the global default going forward.
    _store.set(GLOBAL_KEY, JSON.stringify({ preset: 'compose', overrides: {}, revealed: {} }));
    _resetToolbarStateForTest();
    surfaceOnSongLoaded();
    assert.strictEqual(getToolbarCtx().preset, 'compose');
});

t('save-as rename migrates the memory to the new filename, old key intact', () => {
    reset();
    _store.set(keyOf('old.archive'), JSON.stringify({ preset: 'compose', overrides: {}, revealed: {} }));
    surfaceMigrateFilename('old.archive', 'old.feedpak');
    assert.strictEqual(_store.get(keyOf('old.feedpak')), _store.get(keyOf('old.archive')));
    // No-ops that must not throw or write:
    surfaceMigrateFilename('old.archive', 'old.archive');
    surfaceMigrateFilename('', 'x.feedpak');
    surfaceMigrateFilename('x.feedpak', '');
    surfaceMigrateFilename('missing.feedpak', 'dest.feedpak');
    assert.strictEqual(_store.has(keyOf('dest.feedpak')), false, 'nothing to migrate → no write');
});

t('per-song blob is garbage → the song follows the global default (and never throws)', () => {
    reset();
    _store.set(GLOBAL_KEY, JSON.stringify({ preset: 'compose', overrides: {}, revealed: {} }));
    _store.set(keyOf('a.feedpak'), '{corrupt');
    S.filename = 'a.feedpak';
    surfaceOnSongLoaded();
    assert.strictEqual(getToolbarCtx().preset, 'compose');
});

t('blocked storage (setItem throws) degrades: toggles still work in-memory', () => {
    reset();
    S.filename = 'a.feedpak';
    const realSet = globalThis.localStorage.setItem;
    globalThis.localStorage.setItem = () => { throw new Error('quota'); };
    try {
        toggleToolbar('parts');                        // must not throw
        seedSurfacePreset('compose');                  // must not throw
        surfacePersistFor('a.feedpak');                // must not throw
        resetToolbarLayout();                          // must not throw
        assert.strictEqual(getToolbarCtx().preset, 'compose');
    } finally {
        globalThis.localStorage.setItem = realSet;
    }
});

t('surfaceOnSongLoaded with no song loaded is a no-op (landing screen)', () => {
    reset();
    applyToolbarPreset('compose');
    surfaceOnSongLoaded();                             // S.filename === ''
    assert.strictEqual(getToolbarCtx().preset, 'compose', 'in-memory state untouched');
});

t('presets referenced by the lanes exist (compose ⊂ transcribe by design)', () => {
    for (const id of TOOLBAR_PRESETS.compose) {
        assert.ok(TOOLBAR_PRESETS.transcribe.includes(id), id);
    }
});

reset();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
