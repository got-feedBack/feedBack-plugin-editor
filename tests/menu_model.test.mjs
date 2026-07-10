/*
 * Tests for the menu bar's model builder (src/menu-bar.js).
 *
 * The menu is a RE-PRESENTATION of EDITOR_SHORTCUT_COMMANDS: these tests pin
 * the contract that makes that safe — every registry-backed item resolves to
 * a live registry row (no dangling ids as the registry evolves), each command
 * has exactly one menu home, accelerators follow the shortcut profile,
 * planned commands render greyed and never dispatch, and the two mode gates
 * (tempo-map greying, no-audio hiding) hold.
 *
 * Run: node tests/menu_model.test.mjs
 */
import assert from 'node:assert';

globalThis.document = globalThis.document || {
    getElementById: () => null, addEventListener: () => {}, activeElement: null,
};
globalThis.localStorage = globalThis.localStorage || { getItem: () => null, setItem: () => {} };
globalThis.window = globalThis.window || globalThis;

const { EDITOR_MENUS, _menuModelPure } = await import('../src/menu-bar.js');
const { _editorShortcutRowsPure } = await import('../src/shortcuts.js');

let pass = 0, fail = 0;
function t(name, fn) {
    try { fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}

const rows = _editorShortcutRowsPure('feedback');
const allFns = new Set(EDITOR_MENUS.flatMap((m) => m.items.filter((i) => i.fn).map((i) => i.fn)));
const CTX = { tempoMapMode: false, hasAudio: true, fns: allFns };

t('nine menus, charrette order, Tempo/Grid is top-level', () => {
    assert.deepStrictEqual(EDITOR_MENUS.map((m) => m.title),
        ['File', 'Edit', 'Add', 'Note', 'Part', 'View', 'Transport', 'Tempo/Grid', 'Help']);
});

t('every registry-backed item resolves to a live registry id', () => {
    const ids = new Set(rows.map((r) => r.id));
    for (const menu of EDITOR_MENUS) {
        for (const it of menu.items) {
            if (it.cmd) assert.ok(ids.has(it.cmd), `${menu.title} → ${it.cmd} is not in the registry`);
        }
    }
});

t('every command has exactly one menu home', () => {
    const seen = new Map();
    for (const menu of EDITOR_MENUS) {
        for (const it of menu.items) {
            if (!it.cmd) continue;
            assert.ok(!seen.has(it.cmd), `${it.cmd} appears in ${seen.get(it.cmd)} AND ${menu.title}`);
            seen.set(it.cmd, menu.title);
        }
    }
});

t('accelerators follow the shortcut profile and relabel on swap', () => {
    const modelFb = _menuModelPure(EDITOR_MENUS, _editorShortcutRowsPure('feedback'), CTX);
    const modelEof = _menuModelPure(EDITOR_MENUS, _editorShortcutRowsPure('eof'), CTX);
    const find = (model, label) => model.flatMap((m) => m.items).find((i) => i.label === label);
    assert.strictEqual(find(modelFb, 'Save project').key, 'Ctrl+S');
    assert.strictEqual(find(modelEof, 'Save project').key, 'F2 / Ctrl+S');
    assert.strictEqual(find(modelFb, 'Import Guitar Pro source').key, '');
    assert.strictEqual(find(modelEof, 'Import Guitar Pro source').key, 'F12');
});

t('planned commands render greyed with no dispatch', () => {
    const model = _menuModelPure(EDITOR_MENUS, rows, CTX);
    const planned = model.flatMap((m) => m.items).filter((i) => i.planned);
    assert.ok(planned.length >= 3, 'the registry ships several planned commands');
    for (const it of planned) {
        assert.strictEqual(it.disabled, true, `${it.label} must be greyed`);
        assert.strictEqual(it.dispatch, null, `${it.label} must not dispatch`);
    }
});

t('tempo-map-scoped items grey outside Tempo Map mode, enable inside', () => {
    const outside = _menuModelPure(EDITOR_MENUS, rows, { ...CTX, tempoMapMode: false });
    const inside = _menuModelPure(EDITOR_MENUS, rows, { ...CTX, tempoMapMode: true });
    const get = (model, label) => model.flatMap((m) => m.items).find((i) => i.label === label);
    const syncItem = 'Insert sync point at cursor';
    assert.strictEqual(get(outside, syncItem).disabled, true);
    assert.strictEqual(get(inside, syncItem).disabled, false);
    assert.ok(get(inside, syncItem).dispatch, 'enabled item dispatches');
});

t('audio-only items HIDE (not grey) without a recording', () => {
    const withAudio = _menuModelPure(EDITOR_MENUS, rows, { ...CTX, hasAudio: true });
    const noAudio = _menuModelPure(EDITOR_MENUS, rows, { ...CTX, hasAudio: false });
    const has = (model, label) => model.flatMap((m) => m.items).some((i) => i.label === label);
    assert.strictEqual(has(withAudio, 'Sync tempo to audio'), true);
    assert.strictEqual(has(noAudio, 'Sync tempo to audio'), false);
});

t('a missing window entry point greys its item instead of crashing', () => {
    const model = _menuModelPure(EDITOR_MENUS, rows, { ...CTX, fns: new Set() });
    const it = model.flatMap((m) => m.items).find((i) => i.label === 'Open feedpak…');
    assert.strictEqual(it.disabled, true);
    assert.strictEqual(it.dispatch, null);
});

t('a registry id that disappears is dropped, never rendered dangling', () => {
    const shrunk = rows.filter((r) => r.id !== 'save');
    const model = _menuModelPure(EDITOR_MENUS, shrunk, CTX);
    const labels = model.flatMap((m) => m.items).map((i) => i.label);
    assert.ok(!labels.includes('Save project'));
});

t('no menu renders empty, and separators never lead or trail', () => {
    const model = _menuModelPure(EDITOR_MENUS, rows, { ...CTX, hasAudio: false });
    for (const m of model) {
        const real = m.items.filter((i) => !i.sep && !i.hdr);
        assert.ok(real.length > 0, `${m.title} is empty`);
        assert.ok(!m.items[0].sep && !m.items[m.items.length - 1].sep, `${m.title} has orphan separators`);
    }
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
