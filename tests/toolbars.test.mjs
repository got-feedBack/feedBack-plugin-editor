/*
 * Tests for the toggleable toolbars + density presets (src/toolbars.js,
 * workspace-shell B5) and their View-menu checklist rows (src/menu-bar.js).
 *
 * The contract pinned here: presets are pure maps (Compose ⊂ Transcribe ⊂
 * Everything), an explicit user toggle always wins, the one allowed
 * content-action reveal (Harmony on a pitched part) is sticky but never
 * fights an explicit hide, "Reset layout" returns to the pure preset, the
 * pref blob survives a round-trip and degrades safely on garbage, and the
 * module registers its ONE document-level listener through the teardown
 * registry (host.addGlobalListener), never directly on document.
 *
 * Run: node tests/toolbars.test.mjs
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
    TOOLBAR_GROUPS, TOOLBAR_PRESETS,
    _toolbarStateLoadPure, _toolbarVisiblePure, _toolbarTogglePure,
    _toolbarPresetPure, _toolbarRevealPure,
    toggleToolbar, applyToolbarPreset, resetToolbarLayout, revealToolbar,
    getToolbarCtx, initToolbars, _resetToolbarStateForTest,
} = await import('../src/toolbars.js');
const { EDITOR_MENUS, _menuModelPure } = await import('../src/menu-bar.js');
const { _editorShortcutRowsPure } = await import('../src/shortcuts.js');
const { host } = await import('../src/host.js');

let pass = 0, fail = 0;
function t(name, fn) {
    try { fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}
const IDS = TOOLBAR_GROUPS.map((g) => g.id);
const DEF = () => _toolbarStateLoadPure(null);

// ── The pure state model ──────────────────────────────────────────────

t('default state is Everything — first run shows exactly today\'s surface', () => {
    const vis = _toolbarVisiblePure(DEF());
    for (const id of IDS) assert.strictEqual(vis[id], true, id);
});

t('presets nest: Compose ⊂ Transcribe ⊂ Everything, task-named', () => {
    const { compose, transcribe, everything } = TOOLBAR_PRESETS;
    for (const id of compose) assert.ok(transcribe.includes(id), `${id} lost by transcribe`);
    for (const id of transcribe) assert.ok(everything.includes(id), `${id} lost by everything`);
    assert.deepStrictEqual([...compose], ['file', 'edit', 'grid']);
    assert.deepStrictEqual([...transcribe], ['file', 'edit', 'grid', 'tempo', 'overlays']);
    assert.deepStrictEqual([...everything], IDS);
});

t('every toolbar id is covered by Everything (a new group can never be orphaned)', () => {
    assert.deepStrictEqual([...TOOLBAR_PRESETS.everything].sort(), [...IDS].sort());
});

t('garbage pref blobs degrade to the default, never throw', () => {
    for (const raw of [null, undefined, '', 'not json', '42', '"str"', '[]',
        '{"preset":"beginner"}', '{"preset":123}',
        '{"overrides":{"bogus":true,"file":"yes"}}',
        '{"revealed":{"harmony":false,"nope":true}}']) {
        const s = _toolbarStateLoadPure(raw);
        assert.strictEqual(s.preset === 'everything' || TOOLBAR_PRESETS[s.preset] !== undefined, true);
        for (const k of Object.keys(s.overrides)) assert.ok(IDS.includes(k), k);
        for (const k of Object.keys(s.revealed)) assert.ok(IDS.includes(k), k);
    }
    // The two bad-key cases above must strip ONLY the bad keys.
    const s = _toolbarStateLoadPure('{"preset":"compose","overrides":{"bogus":true,"file":false},"revealed":{"harmony":true,"nope":true}}');
    assert.deepStrictEqual(s, { preset: 'compose', overrides: { file: false }, revealed: { harmony: true } });
});

t('a valid blob round-trips through load exactly', () => {
    const state = { preset: 'transcribe', overrides: { parts: true, tempo: false }, revealed: { harmony: true } };
    assert.deepStrictEqual(_toolbarStateLoadPure(JSON.stringify(state)), state);
});

t('visibility: preset map, widened by reveals, overridden by explicit toggles', () => {
    const vis = _toolbarVisiblePure({
        preset: 'compose',
        overrides: { grid: false, overlays: true },
        revealed: { harmony: true },
    });
    assert.strictEqual(vis.file, true, 'preset-shown');
    assert.strictEqual(vis.tempo, false, 'preset-hidden');
    assert.strictEqual(vis.harmony, true, 'revealed widens');
    assert.strictEqual(vis.grid, false, 'override hides a preset-shown toolbar');
    assert.strictEqual(vis.overlays, true, 'override shows a preset-hidden toolbar');
});

t('an explicit hide beats a reveal (the user\'s choice wins)', () => {
    const vis = _toolbarVisiblePure({ preset: 'compose', overrides: { harmony: false }, revealed: { harmony: true } });
    assert.strictEqual(vis.harmony, false);
});

t('toggle flips from EFFECTIVE state and round-trips', () => {
    let s = _toolbarPresetPure(DEF(), 'compose');
    s = _toolbarTogglePure(s, 'tempo');            // preset-hidden → shown
    assert.strictEqual(_toolbarVisiblePure(s).tempo, true);
    s = _toolbarTogglePure(s, 'tempo');            // → hidden again
    assert.strictEqual(_toolbarVisiblePure(s).tempo, false);
    s = _toolbarTogglePure(s, 'file');             // preset-shown → hidden
    assert.strictEqual(_toolbarVisiblePure(s).file, false);
});

t('toggle/reveal/preset on an unknown id or preset are no-ops (same ref)', () => {
    const s = DEF();
    assert.strictEqual(_toolbarTogglePure(s, 'bogus'), s);
    assert.strictEqual(_toolbarRevealPure(s, 'bogus'), s);
    assert.strictEqual(_toolbarPresetPure(s, 'beginner'), s);
});

t('picking a preset clears overrides AND reveals — the named surface exactly', () => {
    let s = { preset: 'everything', overrides: { file: false }, revealed: { harmony: true } };
    s = _toolbarPresetPure(s, 'compose');
    assert.deepStrictEqual(s, { preset: 'compose', overrides: {}, revealed: {} });
});

t('reveal is sticky, but a no-op when visible or explicitly hidden', () => {
    let s = _toolbarPresetPure(DEF(), 'compose');
    const r = _toolbarRevealPure(s, 'harmony');
    assert.strictEqual(_toolbarVisiblePure(r).harmony, true);
    assert.strictEqual(_toolbarRevealPure(r, 'harmony'), r, 'already revealed → same ref');
    const everything = DEF();
    assert.strictEqual(_toolbarRevealPure(everything, 'harmony'), everything, 'visible → same ref');
    const hidden = { preset: 'compose', overrides: { harmony: false }, revealed: {} };
    assert.strictEqual(_toolbarRevealPure(hidden, 'harmony'), hidden, 'explicit hide → same ref');
});

t('reveal marks `revealed`, never an override — Reset still purifies', () => {
    let s = _toolbarPresetPure(DEF(), 'compose');
    s = _toolbarRevealPure(s, 'harmony');
    assert.deepStrictEqual(s.overrides, {});
    assert.deepStrictEqual(s.revealed, { harmony: true });
    assert.strictEqual(_toolbarVisiblePure(_toolbarPresetPure(s, s.preset)).harmony, false);
});

// ── Persistence (the editor-pref blob, never the pack) ────────────────

t('runtime toggle persists and survives a module-state reset (round-trip)', () => {
    _store.clear(); _resetToolbarStateForTest();
    applyToolbarPreset('compose');
    toggleToolbar('tempo');
    _resetToolbarStateForTest();                    // simulate a fresh screen boot
    const ctx = getToolbarCtx();
    assert.strictEqual(ctx.preset, 'compose');
    assert.strictEqual(ctx.visible.tempo, true);
    assert.strictEqual(ctx.visible.overlays, false);
});

t('reset layout restores the CURRENT preset default and persists it', () => {
    _store.clear(); _resetToolbarStateForTest();
    applyToolbarPreset('transcribe');
    toggleToolbar('overlays');                      // hide a preset-shown toolbar
    revealToolbar('harmony');
    resetToolbarLayout();
    _resetToolbarStateForTest();
    const ctx = getToolbarCtx();
    assert.strictEqual(ctx.preset, 'transcribe');
    assert.strictEqual(ctx.visible.overlays, true, 'override cleared');
    assert.strictEqual(ctx.visible.harmony, false, 'reveal cleared');
});

t('content-action reveal appears AND stays across a reload (sticky)', () => {
    _store.clear(); _resetToolbarStateForTest();
    applyToolbarPreset('compose');
    revealToolbar('harmony');                       // what _refreshKeyControls fires
    _resetToolbarStateForTest();
    assert.strictEqual(getToolbarCtx().visible.harmony, true);
});

t('the surface never auto-reverts: nothing in the module downgrades a preset', () => {
    _store.clear(); _resetToolbarStateForTest();
    applyToolbarPreset('everything');
    revealToolbar('harmony');                       // no-op — must not narrow anything
    const ctx = getToolbarCtx();
    for (const id of IDS) assert.strictEqual(ctx.visible[id], true, id);
});

t('blocked localStorage degrades silently (no throw, defaults apply)', () => {
    const real = globalThis.localStorage;
    globalThis.localStorage = {
        getItem: () => { throw new Error('blocked'); },
        setItem: () => { throw new Error('blocked'); },
    };
    try {
        _resetToolbarStateForTest();
        assert.doesNotThrow(() => { toggleToolbar('file'); getToolbarCtx(); });
        assert.strictEqual(getToolbarCtx().visible.file, false, 'in-memory state still works');
    } finally {
        globalThis.localStorage = real;
        _resetToolbarStateForTest();
    }
});

// ── The View-menu checklist rows ──────────────────────────────────────

const rows = _editorShortcutRowsPure('feedback');
const allFns = new Set(EDITOR_MENUS.flatMap((m) => m.items.filter((i) => i.fn).map((i) => i.fn)));

t('View menu renders one checkable row per toolbar + presets + reset', () => {
    const ctx = {
        tempoMapMode: false, hasAudio: true, fns: allFns,
        toolbars: { visible: Object.fromEntries(IDS.map((id) => [id, id !== 'tempo'])), preset: 'compose' },
    };
    const view = _menuModelPure(EDITOR_MENUS, rows, ctx).find((m) => m.title === 'View');
    const tbRows = view.items.filter((i) => i.dispatch && i.dispatch.tb);
    assert.deepStrictEqual(tbRows.map((i) => i.dispatch.tb), IDS);
    assert.ok(tbRows.every((i) => !i.disabled && !i.planned));
    const shown = tbRows.find((i) => i.dispatch.tb === 'file');
    const hiddenRow = tbRows.find((i) => i.dispatch.tb === 'tempo');
    assert.ok(shown.label.startsWith('✓ '), 'visible toolbar is checked');
    assert.ok(!hiddenRow.label.includes('✓'), 'hidden toolbar is unchecked');
    const presets = view.items.filter((i) => i.dispatch && i.dispatch.tbPreset);
    assert.deepStrictEqual(presets.map((i) => i.dispatch.tbPreset), ['compose', 'transcribe', 'everything']);
    assert.ok(presets[0].label.startsWith('✓ '), 'active preset is checked');
    assert.ok(!presets[2].label.includes('✓'), 'inactive preset is unchecked');
    assert.ok(view.items.some((i) => i.dispatch && i.dispatch.tbReset), 'Reset layout present');
});

t('a ctx without toolbars renders the rows unchecked (older callers degrade)', () => {
    const view = _menuModelPure(EDITOR_MENUS, rows,
        { tempoMapMode: false, hasAudio: true, fns: allFns }).find((m) => m.title === 'View');
    const tbRows = view.items.filter((i) => i.dispatch && i.dispatch.tb);
    assert.strictEqual(tbRows.length, IDS.length);
    assert.ok(tbRows.every((i) => !i.label.includes('✓')));
});

// ── Teardown discipline ───────────────────────────────────────────────

t('initToolbars registers its ONE global listener via host.addGlobalListener, never document', () => {
    const globals = [];
    const docDirect = [];
    const origAdd = host.addGlobalListener;
    const origDoc = globalThis.document;
    globalThis.document = {
        getElementById: () => null, activeElement: null,
        querySelectorAll: () => [],
        addEventListener: (ev) => { docDirect.push(ev); },
    };
    host.addGlobalListener = (target, ev) => { globals.push(ev); };
    try {
        initToolbars();
        initToolbars();     // a re-injected screen boots again
        assert.deepStrictEqual(globals, ['mousedown', 'mousedown'],
            'each boot registers through the teardown registry');
        assert.deepStrictEqual(docDirect, [], 'nothing bypasses the registry');
    } finally {
        host.addGlobalListener = origAdd;
        globalThis.document = origDoc;
    }
});

t('toolbar visibility applies per-wrapper, and one id may span several wrappers', () => {
    const made = [];
    const wrapper = (id) => {
        const classes = new Set(['editor-tb']);
        const el = {
            dataset: { tb: id },
            classList: {
                toggle: (c, force) => { if (force) classes.add(c); else classes.delete(c); },
                has: (c) => classes.has(c),
            },
        };
        made.push(el);
        return el;
    };
    const els = [wrapper('grid'), wrapper('grid'), wrapper('tempo')];
    const origDoc = globalThis.document;
    globalThis.document = {
        getElementById: () => null, activeElement: null,
        addEventListener: () => {},
        querySelectorAll: (sel) => (sel.includes('.editor-tb') ? els : []),
    };
    try {
        _store.clear(); _resetToolbarStateForTest();
        applyToolbarPreset('compose');     // grid shown, tempo hidden
        assert.strictEqual(els[0].classList.has('editor-tb-off'), false);
        assert.strictEqual(els[1].classList.has('editor-tb-off'), false, 'BOTH grid chunks shown');
        assert.strictEqual(els[2].classList.has('editor-tb-off'), true, 'tempo hidden');
        toggleToolbar('grid');
        assert.strictEqual(els[0].classList.has('editor-tb-off'), true, 'both grid chunks hide together');
        assert.strictEqual(els[1].classList.has('editor-tb-off'), true);
    } finally {
        globalThis.document = origDoc;
        _store.clear(); _resetToolbarStateForTest();
    }
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
