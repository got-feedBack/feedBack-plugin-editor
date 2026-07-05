'use strict';
/*
 * Tempo-map guidance helper tests for screen.js.
 *
 * Run: node tests/tempo_map_guidance.test.js
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const src = fs.readFileSync(path.join(__dirname, '..', 'screen.js'), 'utf8');
const m = src.match(/\/\* @pure:tempo-map-guidance:start \*\/[\s\S]*?\/\* @pure:tempo-map-guidance:end \*\//);
if (!m) {
    console.error('FAIL: @pure:tempo-map-guidance block not found in screen.js');
    process.exit(1);
}

const api = new Function(
    '"use strict";' + m[0] + '\nreturn { _tempoMapHudTextPure };'
)();

let pass = 0;
let fail = 0;
function t(name, fn) {
    try { fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}

t('uses compact guidance on narrow canvases', () => {
    const text = api._tempoMapHudTextPure(12, 640);
    assert.ok(text.includes('12 measures'));
    assert.ok(text.includes('right-click sync point'));
    assert.ok(text.includes('BPM / signature'));
    assert.ok(!text.includes('right-click grid'));
});

t('uses full guidance when there is room', () => {
    const text = api._tempoMapHudTextPure(24, 960);
    assert.ok(text.includes('24 measures'));
    assert.ok(text.includes('drag poles to retime'));
    assert.ok(text.includes('BPM / signature/delete'));
    assert.ok(text.includes('right-click grid: insert'));
});

t('normalizes invalid measure counts to zero', () => {
    assert.ok(api._tempoMapHudTextPure('bad', 960).includes('0 measures'));
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
