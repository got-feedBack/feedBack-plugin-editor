/*
 * Ctrl/Cmd+A is a DAW selection command inside the active editor, never the
 * browser's Select All page-text command. Editable text fields retain their
 * native select-all behavior. Run: node --test tests/select_all_shortcut.test.mjs
 */
import assert from 'node:assert';

const screen = { classList: { contains: value => value === 'active' } };
const hiddenModal = { classList: { contains: value => value === 'hidden' } };
globalThis.document = {
    getElementById(id) {
        if (id === 'plugin-editor') return screen;
        if (id === 'editor-tab-preview-modal' || id === 'editor-user-guide-modal') return hiddenModal;
        return null;
    },
    addEventListener: () => {}, activeElement: null,
};
globalThis.localStorage = { getItem: () => null, setItem: () => {} };
globalThis.window = globalThis;
globalThis.requestAnimationFrame = () => 0;
globalThis.cancelAnimationFrame = () => {};

const { _editorSelectAllPolicyPure, onKeyDown } = await import('../src/input.js');
const { S } = await import('../src/state.js');
const { setHostHooks } = await import('../src/host.js');
setHostHooks({ draw: () => {}, updateStatus: () => {}, ensureArr: () => true });

const target = kind => ({
    matches(selector) {
        if (kind === 'input') return selector.includes('input');
        if (kind === 'contenteditable') return selector.includes('[contenteditable]');
        return false;
    },
});
const event = (over = {}) => ({
    key: 'a', code: 'KeyA', ctrlKey: true, metaKey: false, shiftKey: false, altKey: false,
    target: target('canvas'), defaultPrevented: false,
    preventDefault() { this.defaultPrevented = true; }, stopPropagation() {},
    ...over,
});

assert.strictEqual(_editorSelectAllPolicyPure(event()), 'editor');
assert.strictEqual(_editorSelectAllPolicyPure(event({ ctrlKey: false, metaKey: true })), 'editor');
// CapsLock reports key 'A' without setting shiftKey — still plain Select All.
assert.strictEqual(_editorSelectAllPolicyPure(event({ key: 'A', shiftKey: false })), 'editor');
// Shift+Ctrl+A is a different chord (EOF Toggle Accent). It must NOT be claimed
// as Select All; it falls through to the shortcut-profile dispatch.
assert.strictEqual(_editorSelectAllPolicyPure(event({ key: 'A', shiftKey: true })), null);
assert.strictEqual(_editorSelectAllPolicyPure(event({ shiftKey: true })), null);
assert.strictEqual(_editorSelectAllPolicyPure(event({ target: target('input') })), 'text');
assert.strictEqual(_editorSelectAllPolicyPure(event({ target: target('contenteditable') })), 'text');
assert.strictEqual(_editorSelectAllPolicyPure(event({ altKey: true })), null);
assert.strictEqual(_editorSelectAllPolicyPure(event({ key: 'b' })), null);

Object.assign(S, {
    arrangements: [{ name: 'Lead', notes: [{ time: 0 }, { time: 1 }, { time: 2 }], chords: [] }],
    currentArr: 0, sel: new Set(), tempoMapMode: false, partsViewMode: true,
    drumEditMode: false, drumTab: null,
});
const partsSelect = event();
onKeyDown(partsSelect);
assert.ok(partsSelect.defaultPrevented, 'read-only Parts view must not fall through to page-text selection');
assert.deepStrictEqual([...S.sel], [], 'Parts view does not select a hidden arrangement');

S.partsViewMode = false;
const noteSelect = event();
onKeyDown(noteSelect);
assert.ok(noteSelect.defaultPrevented);
assert.deepStrictEqual([...S.sel], [0, 1, 2], 'normal editor Select All selects chart notes');

S.sel.clear();
const textSelect = event({ target: target('input') });
onKeyDown(textSelect);
assert.ok(!textSelect.defaultPrevented, 'editable fields retain native text Select All');
assert.deepStrictEqual([...S.sel], []);

// Shift+Ctrl+A must not be hijacked by Select All — otherwise the EOF profile's
// Toggle Accent chord is dead. The default 'feedback' profile has no binding for
// it, so nothing selects and nothing is prevented by the select-all gate.
S.sel.clear();
const accentChord = event({ key: 'A', shiftKey: true });
onKeyDown(accentChord);
assert.deepStrictEqual([...S.sel], [], 'Shift+Ctrl+A does not select all notes');

console.log('select-all shortcut policy passed');
