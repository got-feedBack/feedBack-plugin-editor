'use strict';
/*
 * Tests for the read-only Tab preview (@pure:tab-preview block): the
 * guard truth table, the conversion-URL shape (encoding + cache buster),
 * and the honest HTTP failure messages. The render itself is alphaTab +
 * DOM (smoke-test territory); everything decision-shaped lives in the
 * pure block and is pinned here. These fail on main, where the block
 * doesn't exist.
 *
 * Run: node tests/tab_preview.test.js
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const src = fs.readFileSync(path.join(__dirname, '..', 'screen.js'), 'utf8');
const m = src.match(/\/\* @pure:tab-preview:start \*\/[\s\S]*?\/\* @pure:tab-preview:end \*\//);
if (!m) {
    console.error('FAIL: @pure:tab-preview block not found in screen.js');
    process.exit(1);
}
const KEYS_PATTERN_SRC = (src.match(/const KEYS_PATTERN = [^\n]+\n/) || [null])[0];
assert.ok(KEYS_PATTERN_SRC, 'KEYS_PATTERN must exist');

const { _tabPreviewGuardPure, _tabPreviewUrlPure, _tabPreviewHttpMessagePure } = new Function(
    '"use strict";' + KEYS_PATTERN_SRC + m[0]
    + '\nreturn { _tabPreviewGuardPure, _tabPreviewUrlPure, _tabPreviewHttpMessagePure };'
)();

let pass = 0, fail = 0;
function t(name, fn) {
    try { fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}

t('guard: fretted saved parts preview; every refusal names its reason', () => {
    assert.deepStrictEqual(
        _tabPreviewGuardPure('song.sloppak', 'Lead', true), { ok: true, reason: '' });
    assert.strictEqual(_tabPreviewGuardPure('s', 'Lead', false).ok, false, 'no arrangements');
    const keys = _tabPreviewGuardPure('s', 'Piano', true);
    assert.strictEqual(keys.ok, false);
    assert.ok(/fretted/.test(keys.reason), 'keys refusal explains itself');
    const unsaved = _tabPreviewGuardPure('', 'Lead', true);
    assert.strictEqual(unsaved.ok, false);
    assert.ok(/Save/.test(unsaved.reason), 'unsaved refusal points at Save');
});

t('guard order: an empty session reads as "load a song", not "save first"', () => {
    assert.ok(/Load/.test(_tabPreviewGuardPure('', '', false).reason));
});

t('URL: encodes the filename, carries arrangement + cache buster', () => {
    assert.strictEqual(
        _tabPreviewUrlPure('My Song & Co.sloppak', 2, 1234),
        '/api/plugins/tabview/gp5/My%20Song%20%26%20Co.sloppak?arrangement=2&t=1234');
    assert.strictEqual(
        _tabPreviewUrlPure('a.sloppak', 'x', 'y'),
        '/api/plugins/tabview/gp5/a.sloppak?arrangement=0&t=0',
        'junk indices/timestamps coerce to 0, never NaN in a URL');
});

t('HTTP messages: 404 names the missing plugin, 501 the old host, else status+body', () => {
    assert.ok(/Tab View plugin/.test(_tabPreviewHttpMessagePure(404, '')));
    assert.ok(/host is too old/.test(_tabPreviewHttpMessagePure(501, '')));
    const generic = _tabPreviewHttpMessagePure(500, 'Conversion error: boom');
    assert.ok(/500/.test(generic) && /boom/.test(generic));
    assert.ok(_tabPreviewHttpMessagePure(500, 'x'.repeat(500)).length < 200,
        'long server bodies are truncated, never dumped');
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
