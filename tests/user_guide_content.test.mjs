/*
 * Accuracy pins for the User Guide content (docs/USER-GUIDE.md + the in-app
 * modal in screen.html) against the code it documents. Stale or wrong
 * shortcut/menu docs are real defects, so the claims are checked against the
 * live registries, not against a copy:
 *
 *   1. Every "**X** menu" / "<em>X</em> menu" reference names a menu that
 *      actually exists in EDITOR_MENUS (pre-fix the guide referenced
 *      "Structure", "Techniques", and "Tempo" menus — none exist).
 *   2. Every key in the doc's "Shortcut essentials" table is a real FeedBack
 *      profile binding (pre-fix it claimed `[`/`]` for sustain, which is
 *      EOF-only — in FeedBack those keys do nothing outside Tempo Map).
 *
 * Run: node tests/user_guide_content.test.mjs
 */
import assert from 'node:assert';
import fs from 'node:fs';

globalThis.document = globalThis.document || {
    getElementById: () => null, addEventListener: () => {}, activeElement: null,
};
globalThis.localStorage = globalThis.localStorage || { getItem: () => null, setItem: () => {} };
globalThis.window = globalThis.window || globalThis;

const { EDITOR_MENUS } = await import('../src/menu-bar.js');
const { _editorShortcutRowsPure } = await import('../src/shortcuts.js');

const doc = fs.readFileSync(new URL('../docs/USER-GUIDE.md', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('../screen.html', import.meta.url), 'utf8');

let pass = 0, fail = 0;
function t(name, fn) {
    try { fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}

const MENU_TITLES = new Set(EDITOR_MENUS.map((m) => m.title));

// "**File** menu", "(Tempo/Grid menu)", "<em>Part</em> menu",
// "<strong>Add</strong> menu" — every such reference must name a real menu.
function menuRefs(text, patterns) {
    const found = [];
    for (const re of patterns) {
        for (const m of text.matchAll(re)) found.push(m[1]);
    }
    return found;
}

t('doc: every menu the guide references exists', () => {
    const refs = menuRefs(doc, [
        /\*\*([A-Z][A-Za-z/]+)\*\* menu/g,
        /\(([A-Z][A-Za-z/]+) menu\)/g,
    ]);
    assert.ok(refs.length >= 3, 'the doc references menus by name (extractor bites)');
    for (const name of refs) {
        assert.ok(MENU_TITLES.has(name), `docs/USER-GUIDE.md references a "${name}" menu that does not exist (menus: ${[...MENU_TITLES].join(', ')})`);
    }
});

t('modal: every menu the in-app guide references exists', () => {
    const refs = menuRefs(html, [
        /<(?:em|strong)>([A-Z][A-Za-z/]+)<\/(?:em|strong)> menu/g,
    ]);
    assert.ok(refs.length >= 2, 'the modal references menus by name (extractor bites)');
    for (const name of refs) {
        assert.ok(MENU_TITLES.has(name), `screen.html guide references a "${name}" menu that does not exist (menus: ${[...MENU_TITLES].join(', ')})`);
    }
});

t('doc: every key in the Shortcut essentials table is a real FeedBack binding', () => {
    const section = doc.split(/^## 10\. Shortcut essentials$/m)[1];
    assert.ok(section, 'Shortcut essentials section exists');
    const table = section.split(/^---$/m)[0];
    const bound = new Set(_editorShortcutRowsPure('feedback').map((r) => r.key).filter(Boolean));
    // Keys bound directly in input.js onKeyDown rather than via the profile
    // registry (transport + clipboard-style chords).
    const DIRECT = new Set(['Space', 'Ctrl+Z', 'Ctrl+Y']);
    const ARROWS = { '↑': 'Up', '↓': 'Down', '←': 'Left', '→': 'Right' };
    const rows = table.split('\n').filter((l) => l.startsWith('|') && !/^\|[-\s|]+\|$/.test(l));
    assert.ok(rows.length >= 4, 'table rows found (extractor bites)');
    let checked = 0;
    for (const row of rows.slice(1)) { // skip header row
        const cells = row.split('|').slice(1, -1).map((c) => c.trim());
        for (let i = 0; i < cells.length; i += 2) { // even cells hold the keys
            const cell = cells[i];
            const tokens = /`0`–`9`/.test(cell)
                ? ['0-9']
                : [...cell.matchAll(/`([^`]+)`/g)].map((m) =>
                    m[1].replace(/[↑↓←→]/g, (a) => ARROWS[a]));
            for (const tok of tokens) {
                checked++;
                assert.ok(bound.has(tok) || DIRECT.has(tok),
                    `table claims key "${tok}" but the FeedBack profile does not bind it`);
            }
        }
    }
    assert.ok(checked >= 10, `enough key claims were actually checked (got ${checked})`);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
