/*
 * Command palette (Ctrl+K) — the searchable front door over every registry
 * command and menu action. Motivated by real tester reports of features that
 * existed but couldn't be found; the registry id (`openCommandPalette`) was
 * reserved and stub-dispatched to the shortcut panel until now.
 *
 * Pinned here: the entry builder (ready-only registry rows carry their live
 * key; menu rows with a window-fn are included under their menu title; `cmd:`
 * menu rows are skipped as registry duplicates; separators/headers never leak)
 * and the ranking (word-start beats mid-substring beats subsequence; empty
 * query browses; no match drops; the limit holds). Fails on main (the module
 * doesn't exist there — Ctrl+K opens the shortcut panel instead).
 *
 * Run: node tests/command_palette.test.mjs
 */
import assert from 'node:assert';

globalThis.document = globalThis.document || {
    getElementById: () => null, addEventListener: () => {}, activeElement: null,
};
globalThis.localStorage = globalThis.localStorage || { getItem: () => null, setItem: () => {} };
globalThis.window = globalThis.window || globalThis;

const { _paletteEntriesPure, _paletteFilterPure } = await import('../src/command-palette.js');

let pass = 0, fail = 0;
function t(name, fn) {
    try { fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}

const ROWS = [
    { id: 'save', label: 'Save', group: 'File', status: 'ready', key: 'Ctrl+S' },
    { id: 'resnapSelection', label: 'Resnap selection to grid', group: 'Grid and sustain', status: 'ready', key: 'Shift+R' },
    { id: 'futureThing', label: 'Future thing', group: 'File', status: 'todo', key: '' },
];
const MENUS = [
    { title: 'Tempo/Grid', items: [
        { hdr: 'Fit' },
        { label: 'Scan for tempo zones…', fn: 'editorScanTempoZones' },
        { cmd: 'resnapSelection' },          // registry duplicate — must be skipped
        { sep: true },
        { label: 'Song Fit…', fn: 'editorSongFit' },
    ] },
];

t('entries: ready registry rows with live keys + menu window-fns, no dupes or chrome', () => {
    const e = _paletteEntriesPure(ROWS, MENUS);
    assert.deepStrictEqual(e.map(x => x.label), [
        'Save', 'Resnap selection to grid', 'Scan for tempo zones…', 'Song Fit…',
    ]);
    assert.strictEqual(e[0].key, 'Ctrl+S', 'the live keybinding rides along');
    assert.strictEqual(e[2].kind, 'fn');
    assert.strictEqual(e[2].group, 'Tempo/Grid', 'menu actions carry their menu title');
    assert.ok(!e.some(x => x.label === 'Future thing'), 'non-ready rows are hidden');
});

t('ranking: word-start beats mid-substring beats subsequence', () => {
    const entries = _paletteEntriesPure([
        { id: 'a', label: 'Snap selection', group: '', status: 'ready', key: '' },
        { id: 'b', label: 'Resnap to grid', group: '', status: 'ready', key: '' },
        { id: 'c', label: 'Set new audio path', group: '', status: 'ready', key: '' },
    ], []);
    const r = _paletteFilterPure(entries, 'snap');
    assert.strictEqual(r[0].id, 'a', 'word-start "snap" wins');
    assert.strictEqual(r[1].id, 'b', 'mid-substring second');
    assert.strictEqual(r[2].id, 'c', 's·n·a·p subsequence still findable, last');
});

t('the search also sees the group, so "tempo scan" finds Tempo/Grid items', () => {
    const e = _paletteEntriesPure([], MENUS);
    const r = _paletteFilterPure(e, 'tempo');
    assert.ok(r.some(x => x.fn === 'editorScanTempoZones'));
});

t('empty query browses; no match drops; the limit holds', () => {
    const e = _paletteEntriesPure(ROWS, MENUS);
    assert.strictEqual(_paletteFilterPure(e, '').length, e.length);
    assert.deepStrictEqual(_paletteFilterPure(e, 'zzzqx'), []);
    assert.strictEqual(_paletteFilterPure(e, '', 2).length, 2);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
