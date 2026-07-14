/*
 * Four keybind profiles: FeedBack / Logical (Logic-style) / Cableton
 * (Ableton-style) / Legacy (EOF). The two new profiles are DELTAS over the
 * FeedBack resolver: an override table (sig → id) wins, everything else falls
 * through to its FeedBack meaning — so DAW muscle memory lands where a Logic
 * or Live user expects while every editor-specific command keeps working.
 *
 * Pinned here: the authentic DAW bindings (sourced from the Logic key-command
 * appendix and the Live 12 shortcut chapter), the fall-through inheritance,
 * the shadow rule (a reassigned key's old command goes keyless or relocates —
 * and DISPLAYS that, absent-vs-'' preserved), the tempo-map overlay staying
 * reachable through the fall-through, disjointness of override sigs from the
 * tempo-map overlay, and the two newly registry-registered commands.
 *
 * Fails on main (the tables, resolver, and profiles don't exist there).
 * Run: node tests/keybind_profiles.test.mjs
 */
import assert from 'node:assert';

globalThis.document = globalThis.document || {
    getElementById: () => null, addEventListener: () => {}, activeElement: null,
};
globalThis.localStorage = globalThis.localStorage || { getItem: () => null, setItem: () => {} };
globalThis.window = globalThis.window || globalThis;

const {
    EDITOR_PROFILE_NAMES, EDITOR_PROFILE_OVERRIDES,
    _editorProfileCollisionsPure, _editorShortcutRowsPure, _editorTableCommandForKeyPure,
    editorSetShortcutProfile,
} = await import('../src/shortcuts.js');
import * as shortcuts from '../src/shortcuts.js';

let pass = 0, fail = 0;
function t(name, fn) {
    try { fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}

const ev = (key, m = {}) => ({
    key, code: m.code || '',
    ctrlKey: !!m.ctrl, metaKey: false, shiftKey: !!m.shift, altKey: !!m.alt,
});
const L = EDITOR_PROFILE_OVERRIDES.logical;
const A = EDITOR_PROFILE_OVERRIDES.cableton;
const resolve = (table, e, mode = 'note') => _editorTableCommandForKeyPure(e, mode, table);

// ── the authentic DAW bindings ───────────────────────────────────────

t('Logical: the Logic defaults land — K click, Q quantize, ,/. transport, C cycle', () => {
    assert.strictEqual(resolve(L, ev('k')), 'toggleMetronome');
    assert.strictEqual(resolve(L, ev('q')), 'resnapSelection');
    assert.strictEqual(resolve(L, ev(',')), 'prevBeat');
    assert.strictEqual(resolve(L, ev('.')), 'nextBeat');
    assert.strictEqual(resolve(L, ev('c')), 'toggleLoopRegion');
    assert.strictEqual(resolve(L, ev("'", { alt: true })), 'addSection');
    assert.strictEqual(resolve(L, ev('r', { ctrl: true })), 'duplicateSelection');
});

t('Cableton: the Live defaults land — Ctrl+U quantize, Ctrl+1/2 grid, Ctrl+4 snap, O click, Ctrl+L loop', () => {
    assert.strictEqual(resolve(A, ev('u', { ctrl: true })), 'resnapSelection');
    assert.strictEqual(resolve(A, ev('1', { ctrl: true })), 'snapUp', 'Narrow Grid = finer');
    assert.strictEqual(resolve(A, ev('2', { ctrl: true })), 'snapDown', 'Widen Grid = coarser');
    assert.strictEqual(resolve(A, ev('4', { ctrl: true })), 'toggleSnap');
    assert.strictEqual(resolve(A, ev('o')), 'toggleMetronome');
    assert.strictEqual(resolve(A, ev('f', { ctrl: true, shift: true })), 'toggleFollow');
    assert.strictEqual(resolve(A, ev('l', { ctrl: true })), 'toggleLoopRegion');
});

// ── inheritance + shadows ────────────────────────────────────────────

t('anything unoverridden falls through to its FeedBack meaning', () => {
    assert.strictEqual(resolve(L, ev('h')), 'toggleHammerOn');
    assert.strictEqual(resolve(A, ev('h')), 'toggleHammerOn');
    assert.strictEqual(resolve(L, ev('R', { shift: true })), 'resnapSelection',
        'the old FeedBack key stays as a harmless alias');
});

t('a shadowed command relocates or goes keyless — and the rows SAY so', () => {
    // Logical: K now clicks, so pick-direction cycling is keyless there.
    assert.strictEqual(resolve(L, ev('k')), 'toggleMetronome');
    const lRows = Object.fromEntries(_editorShortcutRowsPure('logical').map(r => [r.id, r.key]));
    assert.strictEqual(lRows.cyclePickDirection, '', 'explicitly keyless, not inheriting the stolen K');
    assert.strictEqual(lRows.toggleGuideClap, '', 'C belongs to the loop now');
    assert.strictEqual(lRows.toggleMetronome, 'K');
    assert.strictEqual(lRows.save, 'Ctrl+S', 'unoverridden displays the inherited FeedBack key');
    // Cableton: O clicks, pop relocates; Ctrl+L loops, select-like relocates.
    assert.strictEqual(resolve(A, ev('p', { ctrl: true, shift: true })), 'togglePop');
    assert.strictEqual(resolve(A, ev('l', { ctrl: true, shift: true })), 'selectLike');
    const aRows = Object.fromEntries(_editorShortcutRowsPure('cableton').map(r => [r.id, r.key]));
    assert.strictEqual(aRows.togglePop, 'Ctrl+Shift+P');
    assert.strictEqual(aRows.selectLike, 'Ctrl+Shift+L');
});

// ── the tempo-map overlay stays intact ───────────────────────────────

t('tempo-map keys still resolve through the fall-through in both new profiles', () => {
    assert.strictEqual(resolve(L, ev('b'), 'tempoMap'), 'tempoSetBpm');
    assert.strictEqual(resolve(A, ev('g'), 'tempoMap'), 'tempoSuggestFit');
});

t('override sigs are disjoint from the FeedBack tempo-map overlay', () => {
    const TEMPO_MAP_SIGS = ['T', 'B', 'M', 'Shift+B', 'N', '[', ']', 'D', 'S', 'G',
        'Shift+T', 'Alt+T', 'Ctrl+Shift+T', 'I', 'Insert', 'Delete', 'Backspace'];
    assert.deepStrictEqual(_editorProfileCollisionsPure(L, TEMPO_MAP_SIGS), []);
    assert.deepStrictEqual(_editorProfileCollisionsPure(A, TEMPO_MAP_SIGS), []);
});

// ── profile plumbing + the two new registry commands ─────────────────

t('all four profiles are selectable; an unknown value falls back to feedback', () => {
    editorSetShortcutProfile('logical');
    assert.strictEqual(shortcuts.editorShortcutProfile, 'logical');
    editorSetShortcutProfile('cableton');
    assert.strictEqual(shortcuts.editorShortcutProfile, 'cableton');
    editorSetShortcutProfile('eof');
    assert.strictEqual(shortcuts.editorShortcutProfile, 'eof');
    editorSetShortcutProfile('nonsense');
    assert.strictEqual(shortcuts.editorShortcutProfile, 'feedback');
    assert.strictEqual(EDITOR_PROFILE_NAMES.eof, 'Legacy (EOF)');
});

t('the EOF rows are untouched by the new profiles', () => {
    const eofRows = Object.fromEntries(_editorShortcutRowsPure('eof').map(r => [r.id, r.key]));
    assert.strictEqual(eofRows.resnapSelection, 'Shift+R');
    assert.strictEqual(eofRows.save, 'F2 / Ctrl+S');
});

t('loop-region toggle and Song Fit are registry commands now (palette-findable)', () => {
    const rows = _editorShortcutRowsPure('feedback');
    const loop = rows.find(r => r.id === 'toggleLoopRegion');
    const fit = rows.find(r => r.id === 'songFit');
    assert.ok(loop && loop.status === 'ready');
    assert.ok(fit && fit.status === 'ready');
    const lRows = Object.fromEntries(_editorShortcutRowsPure('logical').map(r => [r.id, r.key]));
    assert.strictEqual(lRows.toggleLoopRegion, 'C');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
