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

const { S } = await import('../src/state.js');
const { _scoreStaffProfilePure, editorSetTabViewStaff, editorTabViewStaff } =
    await import('../src/tab-view-live.js');

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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
