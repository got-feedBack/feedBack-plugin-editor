/*
 * Regression: dragging a Tracks-pane fader must not start a track REORDER.
 *
 * Track rows carry draggable="true", so a native drag beginning anywhere inside
 * one steals the gesture. Testers saw exactly that on the fader: a click landed
 * (no movement, no drag, so the thumb jumps to the click position) but
 * click-and-drag handed the pointer to the row reorder "a split second" in.
 *
 * The guard CANNOT live in dragstart. The drag source is the row, so
 * dragstart.target is the ROW — not the control under the pointer — and the two
 * are indistinguishable there. Verified in Chromium:
 *
 *     dragstart.target on a row containing a range input:
 *         "guard | closestInput=false"
 *     row+guard-at-dragstart : value 53.0 -> 55.0   dragover=24  (drag stole it)
 *     row+draggable-toggle   : value 53.0 -> 101.0  dragover=0   (fader kept it)
 *
 * draggable="false" on the input alone is inert for the same reason. So the row
 * is taken out of the drag for the span of a gesture that began on a control,
 * and put back on release — which is what this pins.
 *
 * This is a DIFFERENT mechanism from tests/track_session_fader_drag.test.mjs,
 * which covers the innerHTML rebuild destroying the slider mid-drag. Either one
 * alone breaks the fader, so both are pinned.
 *
 * Run: node tests/track_session_fader_row_drag.test.mjs
 */
import assert from 'node:assert';

function makeEl(id) {
    const handlers = {};
    const el = {
        id, __trackSessionWired: false, style: {},
        setAttribute() {}, getAttribute: () => null,
        querySelector: () => null, querySelectorAll: () => [],
        appendChild() {}, contains: () => false,
        addEventListener(type, fn) { (handlers[type] ||= []).push(fn); },
        removeEventListener() {},
        dispatch(type, event) { for (const fn of (handlers[type] || [])) fn(event); },
    };
    let _html = '';
    Object.defineProperty(el, 'innerHTML', { get() { return _html; }, set(v) { _html = v; } });
    return el;
}

const panelEl = makeEl('editor-track-session');
globalThis.document = { getElementById: (id) => (id === 'editor-track-session' ? panelEl : null) };

// A window whose pointerup/pointercancel listeners can actually be fired — the
// restore half of the fix rides on them.
const winHandlers = {};
globalThis.window = {
    addEventListener(type, fn) { (winHandlers[type] ||= []).push(fn); },
    removeEventListener(type, fn) {
        winHandlers[type] = (winHandlers[type] || []).filter(f => f !== fn);
    },
    dispatch(type) { for (const fn of [...(winHandlers[type] || [])]) fn({}); },
};
globalThis.localStorage = { getItem: () => null, setItem() {} };

const { S } = await import('../src/state.js');
const { initTrackSession } = await import('../src/track-session.js');

S.trackSession = {
    version: 2, tracks: [{ id: 'trk-1', type: 'audio', name: 'Gtr', sourceId: 'src-1' }],
    removedSourceIds: [], tempoGuideSourceId: '', tempoGuideLocked: false, tempoGuideMode: 'audio',
};
S.partMix = {};

initTrackSession();

let rowEl;
const faderTarget = {
    closest: (sel) => (sel === 'input,select,textarea,button' ? faderTarget
        : sel === '[data-track-id]' ? rowEl : null),
};
const labelTarget = { closest: (sel) => (sel === '[data-track-id]' ? rowEl : null) };
const buttonTarget = {
    closest: (sel) => (sel === 'input,select,textarea,button' ? buttonTarget
        : sel === '[data-track-id]' ? rowEl : null),
};
// The rename input is a form control too, so the same pointerdown path covers
// it — which is what makes removing its (never-firing) dragstart guard safe.
const renameTarget = {
    closest: (sel) => (sel === 'input,select,textarea,button' ? renameTarget
        : sel === '[data-track-rename-input]' ? renameTarget
        : sel === '[data-track-id]' ? rowEl : null),
};

function freshRow() {
    rowEl = { draggable: true, getAttribute: (n) => (n === 'data-track-id' ? 'trk-1' : null) };
    return rowEl;
}

let pass = 0, fail = 0;
function t(name, fn) {
    try { fn(); pass++; console.log('ok - ' + name); }
    catch (e) { fail++; process.exitCode = 1; console.error('not ok - ' + name + ': ' + e.message); }
}

t('pressing the fader takes its row out of the reorder drag', () => {
    freshRow();
    panelEl.dispatch('pointerdown', { target: faderTarget, preventDefault() {}, stopPropagation() {} });
    assert.strictEqual(rowEl.draggable, false,
        'the row must not be draggable while the fader owns the gesture');
});

t('releasing restores the row to draggable', () => {
    freshRow();
    panelEl.dispatch('pointerdown', { target: faderTarget, preventDefault() {}, stopPropagation() {} });
    assert.strictEqual(rowEl.draggable, false);
    window.dispatch('pointerup');
    assert.strictEqual(rowEl.draggable, true, 'reorder must come back after the fader drag');
});

t('a cancelled pointer also restores the row', () => {
    freshRow();
    panelEl.dispatch('pointerdown', { target: faderTarget, preventDefault() {}, stopPropagation() {} });
    window.dispatch('pointercancel');
    assert.strictEqual(rowEl.draggable, true);
});

t('the rename input is covered by the same pointerdown path', () => {
    freshRow();
    panelEl.dispatch('pointerdown', { target: renameTarget, preventDefault() {}, stopPropagation() {} });
    assert.strictEqual(rowEl.draggable, false,
        'renaming must not start a row drag either — this is what the removed dragstart guard was trying (and failing) to do');
    window.dispatch('pointerup');
    assert.strictEqual(rowEl.draggable, true);
});

// Mute, solo, open-editor, guide and collapse are buttons inside draggable
// rows. They need the same protection as faders and selects: a slightly
// moving click must remain a button gesture, not turn into row reorder.
t('pressing a row button takes its row out of the reorder drag', () => {
    freshRow();
    panelEl.dispatch('pointerdown', { target: buttonTarget, preventDefault() {}, stopPropagation() {} });
    assert.strictEqual(rowEl.draggable, false, 'row buttons must keep their gesture');
    window.dispatch('pointerup');
    assert.strictEqual(rowEl.draggable, true);
});
t('pressing the row body leaves reorder armed', () => {
    freshRow();
    panelEl.dispatch('pointerdown', { target: labelTarget, preventDefault() {}, stopPropagation() {} });
    assert.strictEqual(rowEl.draggable, true, 'dragging a row by its body must still reorder');
});

t('the restore listener does not leak across gestures', () => {
    freshRow();
    panelEl.dispatch('pointerdown', { target: faderTarget, preventDefault() {}, stopPropagation() {} });
    window.dispatch('pointerup');
    const stale = (winHandlers.pointerup || []).length;
    panelEl.dispatch('pointerdown', { target: faderTarget, preventDefault() {}, stopPropagation() {} });
    window.dispatch('pointerup');
    assert.strictEqual((winHandlers.pointerup || []).length, stale,
        'each gesture must clean up its own pointerup listener');
});

console.log(`\n${pass} passed, ${fail} failed`);
