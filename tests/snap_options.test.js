'use strict';
/*
 * Snap option model tests for screen.js.
 *
 * Run: node tests/snap_options.test.js
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const src = fs.readFileSync(path.join(__dirname, '..', 'screen.js'), 'utf8');
const m = src.match(/\/\* @pure:snap-options:start \*\/[\s\S]*?\/\* @pure:snap-options:end \*\//);
if (!m) {
    console.error('FAIL: @pure:snap-options block not found in screen.js');
    process.exit(1);
}

const api = new Function(
    '"use strict";' + m[0] + '\nreturn { SNAP_OPTIONS, SNAP_VALUES, _editorSnapOptionLabelsPure, _editorSnapSubdivisionsPure };'
)();

let pass = 0;
let fail = 0;
function t(name, fn) {
    try { fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}

t('keeps 1/4 as the default snap index', () => {
    assert.strictEqual(api.SNAP_OPTIONS[2].label, '1/4');
    assert.strictEqual(api.SNAP_VALUES[2], 0.25);
});

t('includes dense and triplet-friendly snap divisions before Off', () => {
    assert.deepStrictEqual(api._editorSnapOptionLabelsPure(), [
        '1/1', '1/2', '1/4', '1/8', '1/12', '1/16',
        '1/24', '1/32', '1/48', '1/64', '1/96', 'Off',
    ]);
});

t('maps snap values to beat subdivisions', () => {
    assert.strictEqual(api._editorSnapSubdivisionsPure(1 / 24), 24);
    assert.strictEqual(api._editorSnapSubdivisionsPure(1 / 32), 32);
    assert.strictEqual(api._editorSnapSubdivisionsPure(1 / 96), 96);
    assert.strictEqual(api._editorSnapSubdivisionsPure(0), 0);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);