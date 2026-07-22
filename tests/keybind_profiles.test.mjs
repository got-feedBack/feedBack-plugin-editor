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
});

t('Logical does NOT take Ctrl+R for Repeat — the host menu reloads on it', () => {
    // Logic's Repeat is Cmd-R, but the Electron {role:'reload'} accelerator is
    // handled in the main process and preventDefault() cannot reclaim it, so the
    // editor would reload and drop unsaved edits. Ctrl+D still duplicates in
    // every profile (input.js handles it outside the resolvers).
    assert.notStrictEqual(resolve(L, ev('r', { ctrl: true })), 'duplicateSelection');
    assert.strictEqual(L['Ctrl+R'], undefined);
    const lRows = Object.fromEntries(_editorShortcutRowsPure('logical').map(r => [r.id, r.key]));
    assert.strictEqual(lRows.duplicateSelection, 'Ctrl+D', 'displays the chord that actually works');
});

t('Cableton: the Live defaults land — Ctrl+U quantize, Ctrl+1/2 grid, Ctrl+4 snap, O click, Ctrl+L loop, Ctrl+E split', () => {
    assert.strictEqual(resolve(A, ev('u', { ctrl: true })), 'resnapSelection');
    assert.strictEqual(resolve(A, ev('1', { ctrl: true })), 'snapUp', 'Narrow Grid = finer');
    assert.strictEqual(resolve(A, ev('2', { ctrl: true })), 'snapDown', 'Widen Grid = coarser');
    assert.strictEqual(resolve(A, ev('4', { ctrl: true })), 'toggleSnap');
    assert.strictEqual(resolve(A, ev('o')), 'toggleMetronome');
    assert.strictEqual(resolve(A, ev('f', { ctrl: true, shift: true })), 'toggleFollow');
    assert.strictEqual(resolve(A, ev('l', { ctrl: true })), 'toggleLoopRegion');
    assert.strictEqual(resolve(A, ev('e', { ctrl: true })), 'splitAtPlayhead', "Live's Split");
});

t('the input.js plain-key interceptions are claimed keys — the panel never advertises them for another command', () => {
    // input.js grabs three plain keys BEFORE the resolvers run: T → tool
    // palette (every profile except EOF), G → Tempo Map (Logical), B → Pencil
    // (Cableton). The registry can't dispatch those keys, so no row may
    // DISPLAY one for a different command — that's the display-drift this
    // test exists to catch (the panel said "Bend — B" while B drew notes).
    const CLAIMED = [
        { profile: 'feedback', key: 'T', owner: 'toolPalette' },
        { profile: 'logical', key: 'T', owner: 'toolPalette' },
        { profile: 'cableton', key: 'T', owner: 'toolPalette' },
        { profile: 'logical', key: 'G', owner: 'toggleTempoMap' },
        { profile: 'cableton', key: 'B', owner: null },   // pencil isn't a registry row
    ];
    for (const { profile, key, owner } of CLAIMED) {
        const offenders = _editorShortcutRowsPure(profile)
            .filter(r => r.key === key && r.id !== owner)
            .map(r => r.id);
        assert.deepStrictEqual(offenders, [], `${profile}: '${key}' advertised by ${offenders.join(', ')}`);
    }
    // …and the displaced commands got real keys instead of orphaning.
    const lRows = Object.fromEntries(_editorShortcutRowsPure('logical').map(r => [r.id, r.key]));
    const aRows = Object.fromEntries(_editorShortcutRowsPure('cableton').map(r => [r.id, r.key]));
    assert.strictEqual(lRows.toggleSnap, 'Shift+G');
    assert.strictEqual(resolve(L, ev('g', { shift: true })), 'toggleSnap');
    // Ctrl+B, not Shift+B: override sigs stay disjoint from the tempo-map
    // overlay (Shift+B taps tempo there) — and Ctrl+B is EOF's bend chord too.
    assert.strictEqual(aRows.bend, 'Ctrl+B');
    assert.strictEqual(resolve(A, ev('b', { ctrl: true })), 'bend');
    assert.strictEqual(aRows.splitAtPlayhead, 'Ctrl+E');
    // The FeedBack tempo-map entry shows the chord that actually works.
    const fRows = Object.fromEntries(_editorShortcutRowsPure('feedback').map(r => [r.id, r.key]));
    assert.strictEqual(fRows.toggleTempoMap, 'T,T');
    assert.strictEqual(lRows.toggleTempoMap, 'G');
});

// ── inheritance + shadows ────────────────────────────────────────────

t('anything unoverridden falls through to its FeedBack meaning', () => {
    assert.strictEqual(resolve(L, ev('h')), 'toggleHammerOn');
    assert.strictEqual(resolve(A, ev('h')), 'toggleHammerOn');
    assert.strictEqual(resolve(L, ev('R', { shift: true })), 'resnapSelection',
        'the old FeedBack key stays as a harmless alias');
});

t('a shadowed command relocates — and the rows SAY so', () => {
    // Logical: K now clicks and C now cycles, so both of their old owners move.
    assert.strictEqual(resolve(L, ev('k')), 'toggleMetronome');
    assert.strictEqual(resolve(L, ev('k', { shift: true })), 'cyclePickDirection');
    assert.strictEqual(resolve(L, ev('c', { ctrl: true, shift: true })), 'toggleGuideClap');
    const lRows = Object.fromEntries(_editorShortcutRowsPure('logical').map(r => [r.id, r.key]));
    assert.strictEqual(lRows.cyclePickDirection, 'Shift+K', 'relocated off the stolen K');
    assert.strictEqual(lRows.toggleGuideClap, 'Ctrl+Shift+C', 'relocated off the stolen C');
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

// ── the two checks this class of feature actually fails on ───────────

// Build a keydown from an override-table sig, so the table round-trips through
// the very resolver the dispatcher calls — a table entry that cannot be typed,
// or that resolves to something else, fails here.
function evFromSig(sig) {
    const parts = sig.split('+');
    let key = parts.pop();
    if (key === '') key = '+';                       // "Ctrl++"
    return {
        key: key.length === 1 ? key.toLowerCase() : key, code: '',
        ctrlKey: parts.includes('Ctrl'), metaKey: false,
        shiftKey: parts.includes('Shift'), altKey: parts.includes('Alt'),
    };
}

t('NO COMMAND LOSES ITS KEYBOARD: a chord a delta profile steals is relocated, never orphaned', () => {
    const base = Object.fromEntries(_editorShortcutRowsPure('feedback').map(r => [r.id, r.key]));
    for (const profile of ['logical', 'cableton']) {
        const rows = _editorShortcutRowsPure(profile);
        const orphans = rows.filter(r => base[r.id] && !r.key).map(r => r.id);
        assert.deepStrictEqual(orphans, [], `${profile} strands: ${orphans.join(', ')}`);
    }
    // and every override in the table really resolves to the command it claims
    for (const [profile, table] of Object.entries(EDITOR_PROFILE_OVERRIDES)) {
        for (const [sig, id] of Object.entries(table)) {
            assert.strictEqual(resolve(table, evFromSig(sig)), id, `${profile}: ${sig} should run ${id}`);
        }
    }
});

t('NO PROFILE BINDS A HOST-RESERVED CHORD (the Electron menu wins those)', () => {
    // feedback-desktop's app menu registers roles reload / forceReload /
    // toggleDevTools / quit / close. A menu accelerator is handled in the MAIN
    // process before the renderer sees keydown, so preventDefault() cannot take
    // it back: a chord bound here would reload (losing unsaved edits) instead of
    // running the command. Ctrl+Shift+I is grandfathered — it is toggleIgnore on
    // main in BOTH shipped profiles, so it is a pre-existing call, not ours.
    const RESERVED = ['Ctrl+R', 'Ctrl+Shift+R', 'Ctrl+W', 'Ctrl+Q', 'F5'];
    for (const [profile, table] of Object.entries(EDITOR_PROFILE_OVERRIDES)) {
        const hits = Object.keys(table).filter(sig => RESERVED.includes(sig));
        assert.deepStrictEqual(hits, [], `${profile} binds reserved ${hits.join(', ')}`);
    }
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
