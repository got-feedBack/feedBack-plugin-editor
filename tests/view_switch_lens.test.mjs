/*
 * Tests for the lens-aware view switcher (src/key-view.js): Tab and
 * Notation join String / Piano roll as first-class switcher stops.
 *
 * Fails on main: the pure helpers don't exist, editorSetViewMode rejects
 * 'tab'/'notation', and the switcher's active state ignores the engraved
 * lens entirely.
 *
 * Run: node tests/view_switch_lens.test.mjs
 */
import assert from 'node:assert';

globalThis.document = globalThis.document || {
    getElementById: () => null, addEventListener: () => {}, activeElement: null,
    querySelectorAll: () => [], querySelector: () => null,
    createElement: () => ({ style: {}, dataset: {}, classList: { add() {}, remove() {}, toggle() {} } }),
    head: { appendChild: () => {} },
};
globalThis.localStorage = globalThis.localStorage || { getItem: () => null, setItem: () => {} };
globalThis.window = globalThis.window || globalThis;

const { S } = await import('../src/state.js');
const { _tabStaffForClickPure, _viewSwitchActivePure, editorSetViewMode } = await import('../src/key-view.js');

let pass = 0, fail = 0;
function t(name, fn) {
    try { fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}

t('active set: pref mode rules while the lens is off', () => {
    assert.deepStrictEqual(_viewSwitchActivePure('string', false, 'tab'), ['string']);
    assert.deepStrictEqual(_viewSwitchActivePure('piano', false, 'both'), ['piano']);
});

t('active set: the lens overrides the pref; both lights Tab AND Notation', () => {
    assert.deepStrictEqual(_viewSwitchActivePure('string', true, 'tab'), ['tab']);
    assert.deepStrictEqual(_viewSwitchActivePure('piano', true, 'notation'), ['notation']);
    assert.deepStrictEqual(_viewSwitchActivePure('string', true, 'both'), ['tab', 'notation']);
    // Junk staff degrades to tab, mirroring _scoreStaffProfilePure.
    assert.deepStrictEqual(_viewSwitchActivePure('string', true, 'wat'), ['tab']);
});

t("staff-for-click preserves the user's 'both' reading preference", () => {
    assert.strictEqual(_tabStaffForClickPure('tab', 'tab'), 'tab');
    assert.strictEqual(_tabStaffForClickPure('tab', 'notation'), 'notation');
    assert.strictEqual(_tabStaffForClickPure('notation', 'tab'), 'tab');
    assert.strictEqual(_tabStaffForClickPure('both', 'tab'), 'both');
    assert.strictEqual(_tabStaffForClickPure('both', 'notation'), 'both');
});

t("editorSetViewMode('tab') enters the lens on a fretted track", () => {
    Object.assign(S, {
        filename: 'switch-test.sloppak',
        arrangements: [{ name: 'Lead', tuning: [0, 0, 0, 0, 0, 0], notes: [], chords: [] }],
        currentArr: 0, sel: new Set(), drag: null,
        tabViewMode: false, tabViewStaff: 'tab',
        drumEditMode: false, tempoMapMode: false, partsViewMode: false,
    });
    editorSetViewMode('tab');
    assert.strictEqual(S.tabViewMode, true, 'lens on');
    assert.strictEqual(S.tabViewStaff, 'tab');
});

t("editorSetViewMode('notation') sets the staff; String exits the lens", () => {
    editorSetViewMode('notation');
    assert.strictEqual(S.tabViewMode, true);
    assert.strictEqual(S.tabViewStaff, 'notation');
    editorSetViewMode('string');
    assert.strictEqual(S.tabViewMode, false, 'lens dropped on return to timeline');
});

t('lens refuses keys/drums tracks through the switcher too', () => {
    S.arrangements = [{ name: 'Keys', tuning: [0, 0, 0, 0, 0, 0], notes: [], chords: [] }];
    S.currentArr = 0; S.tabViewMode = false;
    editorSetViewMode('tab');
    assert.strictEqual(S.tabViewMode, false, 'keys refused');
    S.arrangements = [{ name: 'Drums', tuning: [0, 0, 0, 0, 0, 0], notes: [], chords: [] }];
    editorSetViewMode('notation');
    assert.strictEqual(S.tabViewMode, false, 'drums refused');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
