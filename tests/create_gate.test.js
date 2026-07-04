'use strict';
/*
 * Create-modal gate — the Create/Import button enable logic per mode
 * (Blank / Guitar Pro / EOF XML). Blank is audio-only and must enable on
 * audio + title + artist (the create_sloppak backend's requirements); GP and
 * EOF enable once a source file is picked. Brace-extracts the real pure gate
 * from screen.js (a single browser IIFE) so there's no drift.
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

t('blank: enabled only with audio + title + artist', () => {
    assert.strictEqual(_createGateOpen({ mode: 'blank' }, inp({ hasAudio: true, hasTitle: true, hasArtist: true })), true);
    assert.strictEqual(_createGateOpen({ mode: 'blank' }, inp({ hasTitle: true, hasArtist: true })), false);   // no audio
    assert.strictEqual(_createGateOpen({ mode: 'blank' }, inp({ hasAudio: true, hasArtist: true })), false);   // no title
    assert.strictEqual(_createGateOpen({ mode: 'blank' }, inp({ hasAudio: true, hasTitle: true })), false);    // no artist
});

t('blank: does not depend on a GP/EOF file', () => {
    assert.strictEqual(_createGateOpen({ mode: 'blank', gpPath: '/x.gp', eofFiles: [{}] }, inp()), false);
    assert.strictEqual(_createGateOpen({ mode: 'blank', gpPath: '/x.gp' }, inp({ hasAudio: true, hasTitle: true, hasArtist: true })), true);
});

t('gp: enabled once a GP file is chosen', () => {
    assert.strictEqual(_createGateOpen({ mode: 'gp', gpPath: '/song.gp' }, inp()), true);
    assert.strictEqual(_createGateOpen({ mode: 'gp', gpPath: null }, inp({ hasAudio: true, hasTitle: true, hasArtist: true })), false);
});

t('eof: enabled once XML file(s) chosen', () => {
    assert.strictEqual(_createGateOpen({ mode: 'eof', eofFiles: [{}] }, inp()), true);
    assert.strictEqual(_createGateOpen({ mode: 'eof', eofFiles: [] }, inp({ hasAudio: true, hasTitle: true, hasArtist: true })), false);
    assert.strictEqual(_createGateOpen({ mode: 'eof', eofFiles: null }, inp()), false);
});

t('defensive: null state / unknown mode -> disabled', () => {
    assert.strictEqual(_createGateOpen(null, inp({ hasAudio: true, hasTitle: true, hasArtist: true })), false);
    assert.strictEqual(_createGateOpen({ mode: 'wat' }, inp({ hasAudio: true, hasTitle: true, hasArtist: true })), false);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
