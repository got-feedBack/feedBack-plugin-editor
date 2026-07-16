/*
 * Wiring test for Escape-deselect vs. the right-click context / section menu
 * (src/input.js onKeyDown).
 *
 * PR #298 added "Escape clears the note/drum selection". The context menu is
 * closed on Escape by a SEPARATE document keydown listener in main.js that
 * registers at import time — so it fires BEFORE onKeyDown. If onKeyDown's
 * deselect branch also fires on that same Escape, dismissing a right-click menu
 * ALSO wipes the selection the menu was opened on (right-click keeps/sets a
 * selection). onKeyDown now owns the menu's Escape-close itself, ahead of the
 * deselect branch, so the two can't both fire on one keypress.
 *
 * This drives the REAL onKeyDown with a stub DOM:
 *   - menu CLOSED: Escape clears the selection (deselect still works — the
 *                  harness bites),
 *   - menu OPEN:   Escape closes the menu and LEAVES the selection intact.
 *
 * The menu-open assertion FAILS on the pre-fix code, where onKeyDown had no
 * context-menu Escape gate and the deselect branch cleared the selection.
 *
 * Run: node tests/escape_deselect_menu.test.mjs
 */
import assert from 'node:assert';

// ── DOM/global stubs (BEFORE any src import) ────────────────────────────────
// The context menu's hidden-ness is a live flag the test flips; hideContextMenu
// (called by onKeyDown) writes it back through classList.add('hidden').
let menuHidden = true;
const _screenEl = { classList: { contains: (c) => c === 'active' } };
const _closedModal = { classList: { contains: (c) => c === 'hidden' } };
const _menuEl = {
    classList: {
        contains: (c) => (c === 'hidden' ? menuHidden : false),
        add: (c) => { if (c === 'hidden') menuHidden = true; },
        remove: (c) => { if (c === 'hidden') menuHidden = false; },
    },
};
globalThis.document = globalThis.document || {
    getElementById: (id) => {
        if (id === 'plugin-editor') return _screenEl;
        if (id === 'editor-context-menu') return _menuEl;
        if (id === 'editor-user-guide-modal' || id === 'editor-tab-preview-modal') return _closedModal;
        return null; // editor-inspector etc. → _renderInspector no-ops
    },
    addEventListener: () => {},
    activeElement: null,
};
globalThis.localStorage = globalThis.localStorage || { getItem: () => null, setItem: () => {} };
globalThis.window = globalThis.window || globalThis;
globalThis.requestAnimationFrame = globalThis.requestAnimationFrame || (() => 0);
globalThis.cancelAnimationFrame = globalThis.cancelAnimationFrame || (() => {});

const { onKeyDown } = await import('../src/input.js');
const { S } = await import('../src/state.js');
const { setHostHooks } = await import('../src/host.js');

setHostHooks({
    draw: () => {}, updateStatus: () => {}, ensureArr: () => true,
    scheduleCanvasResize: () => {},
});

Object.assign(S, {
    arrangements: [{ name: 'Lead', notes: [{ time: 1, string: 2, fret: 3, sustain: 0, techniques: {} }], chords: [] }],
    currentArr: 0,
    tempoMapMode: false,
    partsViewMode: false,
    drumEditMode: false,
    drumSel: new Set(),
});

const ev = (key, extra = {}) => ({
    key,
    code: '',
    ctrlKey: false, metaKey: false, shiftKey: false, altKey: false,
    target: { matches: () => false },
    _pd: false,
    preventDefault() { this._pd = true; },
    stopPropagation() {},
    ...extra,
});

let pass = 0, fail = 0;
function t(name, fn) {
    try { fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}

t('harness bites: menu CLOSED, Escape clears the note selection', () => {
    menuHidden = true;
    S.sel = new Set([0]);
    const e = ev('Escape');
    onKeyDown(e);
    assert.strictEqual(S.sel.size, 0, 'deselect fires when no menu is open');
    assert.ok(e._pd, 'Escape is preventDefault-ed');
});

t('menu OPEN: Escape closes the menu and LEAVES the selection intact', () => {
    menuHidden = false;
    S.sel = new Set([0]);
    const e = ev('Escape');
    onKeyDown(e);
    assert.strictEqual(menuHidden, true, 'the context menu was closed');
    assert.strictEqual(S.sel.size, 1, 'dismissing the menu must NOT wipe the selection');
    assert.ok(e._pd, 'Escape is preventDefault-ed');
});

t('menu OPEN with a DRUM selection: Escape closes the menu, drum selection intact', () => {
    menuHidden = false;
    S.sel = new Set();
    S.drumSel = new Set([2, 5]);
    const e = ev('Escape');
    onKeyDown(e);
    assert.strictEqual(menuHidden, true, 'the context menu was closed');
    assert.strictEqual(S.drumSel.size, 2, 'the drum selection survives a menu dismiss');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
