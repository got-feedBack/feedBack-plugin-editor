/*
 * The view cycle with the Tab lens in it (String → Piano roll → Tab →
 * String), pinning the two refusal paths:
 *   - a drums track SKIPS the Tab stop (the lens refuses drums without
 *     changing mode, so cycling must wrap to String instead of sticking
 *     on the roll — the review finding on #273);
 *   - a keys track never cycles at all (always the roll).
 *
 * Run: node tests/tab_view_cycle.test.mjs
 */
import assert from 'node:assert';

globalThis.document = globalThis.document || {
    getElementById: () => null, addEventListener: () => {}, activeElement: null,
};
globalThis.localStorage = globalThis.localStorage || { getItem: () => null, setItem: () => {} };
globalThis.window = globalThis.window || globalThis;
globalThis.requestAnimationFrame = globalThis.requestAnimationFrame || ((fn) => fn());

const { S } = await import('../src/state.js');
const { _editorCycleViewMode } = await import('../src/key-view.js');
const { _tabViewPing, _tabViewHideIfShown } = await import('../src/tab-view-live.js');

let pass = 0, fail = 0;
function t(name, fn) {
    try { fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}

// Record what the cycle dispatches instead of running the real views.
const calls = [];
window.editorSetViewMode = (m) => calls.push(['setView', m]);
window.editorToggleTabView = (f) => calls.push(['tab', f]);

function seed(name, storedPiano) {
    Object.assign(S, { arrangements: [{ name, id: 'p1' }], currentArr: 0, tabViewMode: false, filename: '' });
    calls.length = 0;
    // no filename → no stored view pref, so viewFor falls back on the name;
    // fake "currently on the roll" via the tab of stored prefs being empty
    // and the piano case being driven by the caller below.
    return storedPiano;
}

t('a fretted track in String view advances to the roll (cycle start)', () => {
    seed('Lead');
    _editorCycleViewMode();
    assert.deepStrictEqual(calls, [['setView', 'piano']], 'string → roll first');
});

t('a fretted track on the roll advances INTO the Tab lens', () => {
    seed('Lead');
    Object.assign(S, { filename: 'y.feedpak' });
    localStorage.getItem = (k) => k.startsWith('editorViewPref:') ? JSON.stringify({ p1: 'piano' }) : null;
    calls.length = 0;
    _editorCycleViewMode();
    assert.deepStrictEqual(calls, [['tab', true]], 'roll → Tab lens');
    localStorage.getItem = () => null;
});

t('a drums track on the roll SKIPS Tab and wraps to String (never sticks)', () => {
    seed('Drums');
    // Drums names are not KEYS_PATTERN; with no stored pref viewFor says
    // 'string', so pin the roll state through the pref store instead:
    Object.assign(S, { filename: 'x.feedpak' });
    localStorage.getItem = (k) => k.startsWith('editorViewPref:') ? JSON.stringify({ p1: 'piano' }) : null;
    calls.length = 0;
    _editorCycleViewMode();
    assert.deepStrictEqual(calls, [['setView', 'string']],
        'drums skip the Tab stop — the lens would refuse without changing mode');
    localStorage.getItem = () => null;
});

t('leaving the Tab lens restores String view', () => {
    seed('Lead');
    S.tabViewMode = true;
    _editorCycleViewMode();
    assert.deepStrictEqual(calls, [['tab', false], ['setView', 'string']]);
});

// Track-switch leak: the entry toggle refuses keys/drums, but switching TO
// such a track while the lens is already on bypasses it and the cycle's keys
// short-circuit can't clear it — so the draw-pass ping must drop the lens
// itself rather than engrave `undefined.NaN.*`. Fails pre-fix (the ping just
// unhid the mount and left tabViewMode on).
const fakeMount = {
    classList: { _h: true, contains() { return this._h; }, add() { this._h = true; }, remove() { this._h = false; } },
    innerHTML: '',
};
document.getElementById = (id) => (id === 'editor-tabview-mount' ? fakeMount : null);

t('a draw-pass ping on a keys track drops the lens and hides the mount', () => {
    Object.assign(S, { arrangements: [{ name: 'Keys' }], currentArr: 0, tabViewMode: true });
    fakeMount.classList._h = false;
    _tabViewPing();
    assert.strictEqual(S.tabViewMode, false, 'lens dropped for a track with no tab');
    assert.strictEqual(fakeMount.classList._h, true, 'mount hidden so the roll shows through');
});

t('a draw-pass ping on a drums track also drops the lens', () => {
    Object.assign(S, { arrangements: [{ name: 'Drums' }], currentArr: 0, tabViewMode: true });
    _tabViewPing();
    assert.strictEqual(S.tabViewMode, false);
});

t('a draw-pass ping on a fretted track keeps the lens on and shows the mount', () => {
    Object.assign(S, { arrangements: [{ name: 'Lead' }], currentArr: 0, tabViewMode: true, beats: [] });
    fakeMount.classList._h = true;
    _tabViewPing();
    assert.strictEqual(S.tabViewMode, true, 'fretted track keeps the lens');
    assert.strictEqual(fakeMount.classList._h, false, 'mount shown');
    _tabViewHideIfShown(); // cancel the 150 ms debounced render this ping scheduled
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
