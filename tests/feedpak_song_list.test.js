'use strict';
/*
 * Tests for _normalizeSongList() suffix→format detection (feedpak rename, PR #31).
 *
 * The song picker labels a file `sloppak` when its name ends in `.feedpak`
 * (current) or `.sloppak` (legacy) — both map to the internal `sloppak` format
 * tag — and `archive` otherwise. An explicit `format` from the backend always
 * wins over filename sniffing.
 *
 * _normalizeSongList is a browser-free top-level function (String + regex +
 * Array.map), so this extracts it from src/main.js and eval's it in isolation —
 * real source, no drift — the same approach as edit_history_reset.test.js.
 *
 * Run: node tests/feedpak_song_list.test.js
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
// Top-level function: body has only indented closing braces, so the first
// column-0 `\n}` is the function's own close.
const m = src.match(/function _normalizeSongList\(raw\) \{[\s\S]*?\n\}/);
if (!m) {
    console.error('FAIL: _normalizeSongList not found in src/main.js');
    process.exit(1);
}
const _normalizeSongList = new Function(
    '"use strict";' + m[0] + '\nreturn _normalizeSongList;'
)();

let pass = 0, fail = 0;
function t(name, fn) {
    try { fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}

// ── string inputs (legacy backend shape) ────────────────────────────────────

t('string .feedpak → sloppak', () => {
    assert.strictEqual(_normalizeSongList(['a.feedpak'])[0].format, 'sloppak');
});
t('string .sloppak → sloppak (back-compat)', () => {
    assert.strictEqual(_normalizeSongList(['a.sloppak'])[0].format, 'sloppak');
});
t('string suffix is case-insensitive', () => {
    assert.strictEqual(_normalizeSongList(['A.FEEDPAK'])[0].format, 'sloppak');
    assert.strictEqual(_normalizeSongList(['A.SlopPak'])[0].format, 'sloppak');
});
t('string .archive → archive', () => {
    assert.strictEqual(_normalizeSongList(['a.archive'])[0].format, 'archive');
});
t('match is end-anchored (".feedpak.bak" → archive)', () => {
    assert.strictEqual(_normalizeSongList(['a.feedpak.bak'])[0].format, 'archive');
});
t('string input fills default fields', () => {
    const r = _normalizeSongList(['x.feedpak'])[0];
    assert.strictEqual(r.filename, 'x.feedpak');
    assert.strictEqual(r.title, '');
    assert.strictEqual(r.artist, '');
});

// ── object inputs (current backend shape) ───────────────────────────────────

t('object without format derives from .feedpak filename', () => {
    assert.strictEqual(_normalizeSongList([{ filename: 'x.feedpak' }])[0].format, 'sloppak');
});
t('object without format derives from .sloppak filename', () => {
    assert.strictEqual(_normalizeSongList([{ filename: 'x.sloppak' }])[0].format, 'sloppak');
});
t('object without format, .archive filename → archive', () => {
    assert.strictEqual(_normalizeSongList([{ filename: 'x.archive' }])[0].format, 'archive');
});
t('explicit format wins over filename sniffing', () => {
    const r = _normalizeSongList([{ filename: 'x.archive', format: 'sloppak' }])[0];
    assert.strictEqual(r.format, 'sloppak');
});
t('object passes through title/artist', () => {
    const r = _normalizeSongList([{ filename: 'x.feedpak', title: 'T', artist: 'A' }])[0];
    assert.deepStrictEqual([r.title, r.artist], ['T', 'A']);
});

// ── shape / robustness ───────────────────────────────────────────────────────

t('null/undefined input → []', () => {
    assert.deepStrictEqual(_normalizeSongList(null), []);
    assert.deepStrictEqual(_normalizeSongList(undefined), []);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
