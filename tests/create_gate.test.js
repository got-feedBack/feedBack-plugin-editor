'use strict';
/*
 * Create-modal gate — the Create button enable logic. The modal is now ONE menu
 * with no Blank/Guitar Pro/EOF mode toggle: the gate is INPUT-DRIVEN. A picked
 * Guitar Pro file enables it, then EOF XML arrangement(s); otherwise it's a
 * from-scratch DRAFT create, which needs only a title (audio + artist optional —
 * draft-now, audio-later). Brace-extracts the real pure gate from screen.js (a
 * single browser IIFE) so there's no drift.
 *
 * Run: node tests/create_gate.test.js
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const src = fs.readFileSync(path.join(__dirname, '..', 'screen.js'), 'utf8');

function extractFn(name) {
    const start = src.indexOf('function ' + name + '(');
    if (start < 0) throw new Error('not found: ' + name);
    const open = src.indexOf('{', start);
    let depth = 0;
    for (let i = open; i < src.length; i++) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}') { depth--; if (depth === 0) return src.slice(start, i + 1); }
    }
    throw new Error('unbalanced: ' + name);
}
const _createGateOpen = new Function(
    '"use strict";' + extractFn('_createGateOpen') + '\nreturn _createGateOpen;')();

let pass = 0, fail = 0;
function t(name, fn) {
    try { fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}
const inp = (o = {}) => ({ hasTitle: false, hasArtist: false, hasAudio: false, ...o });

t('from-scratch: needs a title AND at least one instrument in the roster', () => {
    assert.strictEqual(_createGateOpen({ roster: ['Lead'] }, inp({ hasTitle: true })), true);
    assert.strictEqual(_createGateOpen({ roster: ['Lead'] }, inp()), false);                        // no title
    assert.strictEqual(_createGateOpen({ roster: [] }, inp({ hasTitle: true })), false);            // no instrument
    assert.strictEqual(_createGateOpen({ roster: ['Vocals'] }, inp({ hasTitle: true })), false);    // Vocals alone
    assert.strictEqual(_createGateOpen({ roster: ['Vocals', 'Keys'] }, inp({ hasTitle: true })), true);
    assert.strictEqual(_createGateOpen({ roster: ['Drums'] }, inp({ hasTitle: true })), true);
});

t('gp file wins regardless of roster/title', () => {
    assert.strictEqual(_createGateOpen({ gpPath: '/song.gp', roster: [] }, inp()), true);
    assert.strictEqual(_createGateOpen({ gpPath: null, roster: [] }, inp({ hasTitle: true })), false);
});

t('eof file(s) win regardless of roster/title', () => {
    assert.strictEqual(_createGateOpen({ eofFiles: [{}], roster: [] }, inp()), true);
    assert.strictEqual(_createGateOpen({ eofFiles: [], roster: ['Lead'] }, inp({ hasTitle: true })), true); // empty list -> roster+title
    assert.strictEqual(_createGateOpen({ eofFiles: null, roster: [] }, inp()), false);
});

t('defensive: null state / null flags -> disabled', () => {
    assert.strictEqual(_createGateOpen(null, inp({ hasTitle: true })), false);
    assert.strictEqual(_createGateOpen({ roster: ['Lead'] }, null), false);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
