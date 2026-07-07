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
// Extract the @pure block ALONE — no outer globals prepended. This is the
// self-containment contract (@pure convention): the block must reference no
// global declared outside it, or the extracted sandbox throws
// "X is not defined". Pre-fix this block referenced the outer KEYS_PATTERN,
// so building it in isolation and calling the guard on a keys part threw;
// the guard now inlines its regexes.
const { _tabPreviewGuardPure, _tabPreviewUrlPure, _tabPreviewHttpMessagePure, _tabPreviewKeyPolicyPure } = new Function(
    '"use strict";' + m[0]
    + '\nreturn { _tabPreviewGuardPure, _tabPreviewUrlPure, _tabPreviewHttpMessagePure, _tabPreviewKeyPolicyPure };'
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

t('guard: drums parts are non-fretted and refused (legacy guitar-encoded drums arrangements)', () => {
    const drums = _tabPreviewGuardPure('song.sloppak', 'Drums', true);
    assert.strictEqual(drums.ok, false, 'a drums arrangement has no fret/string tab');
    assert.ok(/fretted/.test(drums.reason), 'drums refusal explains itself');
    // Case-insensitive, prefix-anchored — matches the editor-wide /^drums/i gate.
    assert.strictEqual(_tabPreviewGuardPure('s', 'drums (EOF)', true).ok, false);
});

t('guard is self-contained: extracting the @pure block alone still classifies keys/drums (no outer KEYS_PATTERN ref)', () => {
    // These calls execute the inlined regexes inside the isolated block; a
    // reference to an outer KEYS_PATTERN would have thrown before we got here.
    assert.strictEqual(_tabPreviewGuardPure('s', 'Piano', true).ok, false);
    assert.strictEqual(_tabPreviewGuardPure('s', 'Keyboard', true).ok, false);
    assert.strictEqual(_tabPreviewGuardPure('s', 'Synth Lead', true).ok, false);
    assert.strictEqual(_tabPreviewGuardPure('s.sloppak', 'Rhythm', true).ok, true);
});

t('key policy: preview modal is a read-only lens — only Escape acts (closes), every other key is swallowed', () => {
    // Open modal: mutating shortcuts must never reach the chart behind it.
    assert.strictEqual(_tabPreviewKeyPolicyPure(true, '2'), 'swallow', 'fret digit swallowed');
    assert.strictEqual(_tabPreviewKeyPolicyPure(true, 'f'), 'swallow', 'technique toggle swallowed');
    assert.strictEqual(_tabPreviewKeyPolicyPure(true, 'Delete'), 'swallow', 'delete swallowed');
    assert.strictEqual(_tabPreviewKeyPolicyPure(true, ' '), 'swallow', 'transport swallowed');
    assert.strictEqual(_tabPreviewKeyPolicyPure(true, 'Escape'), 'close', 'Escape closes');
    // Closed modal: onKeyDown must proceed normally.
    assert.strictEqual(_tabPreviewKeyPolicyPure(false, '2'), 'ignore');
    assert.strictEqual(_tabPreviewKeyPolicyPure(false, 'Escape'), 'ignore');
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
