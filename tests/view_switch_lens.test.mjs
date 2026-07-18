/*
 * Tests for the per-track view DROPDOWN (src/key-view.js): Tab, Notation,
 * and Notation + Tab join String / Piano roll as explicit options
 * (Christian's call: a dropdown, not a pill toggle).
 *
 * Fails on main: the value-derivation pure doesn't exist,
 * editorSetViewMode rejects 'tab'/'notation'/'both', and the switcher
 * ignores the engraved lens entirely.
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
const { _viewSwitchValuePure, editorSetViewMode } = await import('../src/key-view.js');

let pass = 0, fail = 0;
function t(name, fn) {
    try { fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}

t('value: pref mode rules while the lens is off', () => {
    assert.strictEqual(_viewSwitchValuePure('string', false, 'tab'), 'string');
    assert.strictEqual(_viewSwitchValuePure('piano', false, 'both'), 'piano');
});

t('value: the lens overrides the pref; every staff profile is its own option', () => {
    assert.strictEqual(_viewSwitchValuePure('string', true, 'tab'), 'tab');
    assert.strictEqual(_viewSwitchValuePure('piano', true, 'notation'), 'notation');
    assert.strictEqual(_viewSwitchValuePure('string', true, 'both'), 'both');
    // Junk staff degrades to tab, mirroring _scoreStaffProfilePure.
    assert.strictEqual(_viewSwitchValuePure('string', true, 'wat'), 'tab');
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

t("'notation' and 'both' set the matching staff profile", () => {
    editorSetViewMode('notation');
    assert.strictEqual(S.tabViewMode, true);
    assert.strictEqual(S.tabViewStaff, 'notation');
    editorSetViewMode('both');
    assert.strictEqual(S.tabViewMode, true);
    assert.strictEqual(S.tabViewStaff, 'both', 'Notation + Tab is an explicit option');
    assert.strictEqual(_viewSwitchValuePure('string', S.tabViewMode, S.tabViewStaff), 'both',
        'the dropdown reads back the both state');
});

t('String exits the lens', () => {
    editorSetViewMode('string');
    assert.strictEqual(S.tabViewMode, false, 'lens dropped on return to timeline');
});

t('drum mode: value derives from the lens bit alone', () => {
    assert.strictEqual(_viewSwitchValuePure('string', false, 'tab', true), 'drum-grid');
    assert.strictEqual(_viewSwitchValuePure('piano', true, 'both', true), 'drum-notation');
});

t("drum parity: 'drum-notation' engraves WITHOUT leaving the drum editor", () => {
    Object.assign(S, {
        filename: 'switch-test.sloppak',
        arrangements: [{ name: 'Lead', tuning: [0, 0, 0, 0, 0, 0], notes: [], chords: [] }],
        currentArr: 0, sel: new Set(), drag: null,
        tabViewMode: false, tabViewStaff: 'tab',
        drumEditMode: true, drumTab: { version: 1, name: 'Drums', kit: [], hits: [] },
        drumSel: new Set(),
        tempoMapMode: false, partsViewMode: false,
    });
    editorSetViewMode('drum-notation');
    assert.strictEqual(S.tabViewMode, true, 'lens on');
    assert.strictEqual(S.drumEditMode, true, 'drum mode kept under the lens');
    editorSetViewMode('drum-grid');
    assert.strictEqual(S.tabViewMode, false, 'back to the grid');
    assert.strictEqual(S.drumEditMode, true, 'still in the drum editor');
    S.drumEditMode = false; S.drumTab = null;
});

t('lens refuses keys/drums tracks through the dropdown too', () => {
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
