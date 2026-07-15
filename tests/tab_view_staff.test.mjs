/*
 * The Score-staff preference (live Tab/Score view): the staff → alphaTab
 * StaveProfile mapping, the localStorage restore-on-load, and the setter's
 * validate + persist + re-render-arming behavior.
 *
 * Pinned here: unknown/legacy stored values degrade to 'tab' (never throw
 * into the renderer), the preference is a READING preference restored at
 * module load, and picking a staff while the score view is off ENTERS it.
 *
 * Fails on main (the exports don't exist there).
 * Run: node tests/tab_view_staff.test.mjs
 */
import assert from 'node:assert';

// localStorage stub BEFORE the module import — the restore-on-load read
// happens at import time, which is exactly what the first test pins.
const stored = { editorTabViewStaff: 'both' };
const setCalls = [];
globalThis.localStorage = {
    getItem: (k) => (k in stored ? stored[k] : null),
    setItem: (k, v) => { stored[k] = v; setCalls.push([k, v]); },
};
globalThis.document = globalThis.document || {
    getElementById: () => null, addEventListener: () => {}, activeElement: null,
};
globalThis.window = globalThis.window || globalThis;

// Minimal alphaTab stub so _ensureApi can build without the CDN bundle. Only
// the surface _ensureApi touches at construction time is stubbed.
globalThis.alphaTab = {
    LayoutMode: { Page: 'Page' },
    StaveProfile: { Tab: 'Tab', Score: 'Score', ScoreTab: 'ScoreTab' },
    AlphaTabApi: class { constructor(mount, opts) { this.mount = mount; this.opts = opts; this.renderer = {}; } destroy() {} },
};

const { S } = await import('../src/state.js');
const { _scoreStaffProfilePure, editorSetTabViewStaff, editorTabViewStaff, _ensureApi } =
    await import('../src/tab-view-live.js');

// A mount that records add/removeEventListener so we can count live listeners.
function fakeMount() {
    const listeners = [];
    return {
        listeners,
        addEventListener(type, fn, capture) { listeners.push({ type, fn, capture }); },
        removeEventListener(type, fn, capture) {
            const i = listeners.findIndex((l) => l.type === type && l.fn === fn && l.capture === capture);
            if (i >= 0) listeners.splice(i, 1);
        },
        getBoundingClientRect: () => ({ left: 0, top: 0 }),
        scrollLeft: 0, scrollTop: 0,
    };
}

let pass = 0, fail = 0;
function t(name, fn) {
    try { fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}

t('a stored preference is restored at module load', () => {
    assert.strictEqual(S.tabViewStaff, 'both');
    assert.strictEqual(editorTabViewStaff(), 'both');
});

t('staff → StaveProfile key: the three real values', () => {
    assert.strictEqual(_scoreStaffProfilePure('tab'), 'Tab');
    assert.strictEqual(_scoreStaffProfilePure('notation'), 'Score');
    assert.strictEqual(_scoreStaffProfilePure('both'), 'ScoreTab');
});

t('unknown/legacy values degrade to Tab, never throw into the renderer', () => {
    assert.strictEqual(_scoreStaffProfilePure('score'), 'Tab');
    assert.strictEqual(_scoreStaffProfilePure(''), 'Tab');
    assert.strictEqual(_scoreStaffProfilePure(undefined), 'Tab');
    assert.strictEqual(_scoreStaffProfilePure(null), 'Tab');
});

t('the setter validates, applies, and persists', () => {
    S.tabViewMode = true;   // stay off the enter-the-view path
    editorSetTabViewStaff('notation');
    assert.strictEqual(S.tabViewStaff, 'notation');
    assert.deepStrictEqual(setCalls.pop(), ['editorTabViewStaff', 'notation']);
    editorSetTabViewStaff('nonsense');
    assert.strictEqual(S.tabViewStaff, 'tab', 'junk input degrades to tab');
    assert.deepStrictEqual(setCalls.pop(), ['editorTabViewStaff', 'tab']);
});

t('re-picking the current staff does not re-persist', () => {
    S.tabViewMode = true;
    const n = setCalls.length;
    editorSetTabViewStaff('tab');
    assert.strictEqual(setCalls.length, n);
});

t('picking a staff while the score view is off enters it (guard: needs a song)', () => {
    S.tabViewMode = false;
    Object.assign(S, { arrangements: [{ name: 'Lead' }], currentArr: 0, sel: new Set() });
    editorSetTabViewStaff('both');
    assert.strictEqual(S.tabViewStaff, 'both');
    assert.strictEqual(S.tabViewMode, true, 'choosing what to read implies wanting to read');
});

t('a staff-change rebuild on the same mount does not leak DOM mousedown listeners', () => {
    const mount = fakeMount();
    const count = () => mount.listeners.filter((l) => l.type === 'mousedown').length;
    S.tabViewStaff = 'tab';
    _ensureApi(mount);
    assert.strictEqual(count(), 1, 'first build wires exactly one capture listener');
    // Same node, different staff -> _ensureApi rebuilds (staveProfile is a
    // construction-time setting). Pre-fix the old listener stayed bound.
    S.tabViewStaff = 'notation';
    _ensureApi(mount);
    assert.strictEqual(count(), 1, 'rebuild removes the stale listener instead of stacking a second');
    S.tabViewStaff = 'both';
    _ensureApi(mount);
    assert.strictEqual(count(), 1, 'still one after a third staff switch');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
