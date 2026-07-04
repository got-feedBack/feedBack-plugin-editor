'use strict';
/*
 * Create-modal gate helper tests for screen.js.
 *
 * Run: node tests/create_gate.test.js
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const src = fs.readFileSync(path.join(__dirname, '..', 'screen.js'), 'utf8');
const m = src.match(/\/\* @pure:create-gate:start \*\/[\s\S]*?\/\* @pure:create-gate:end \*\//);
if (!m) {
    console.error('FAIL: @pure:create-gate block not found in screen.js');
    process.exit(1);
}

const api = new Function(
    '"use strict";' + m[0] + '\nreturn { _createGateOpenPure };'
)();

let pass = 0;
let fail = 0;
function t(name, fn) {
    try { fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}

t('gp import enables create immediately', () => {
    assert.strictEqual(api._createGateOpenPure({ gpPath: '/tmp/song.gp5', eofFiles: null }, {
        hasAudio: false, title: false, artist: false,
    }), true);
});

t('eof import enables create immediately', () => {
    assert.strictEqual(api._createGateOpenPure({ gpPath: null, eofFiles: [{}] }, {
        hasAudio: false, title: false, artist: false,
    }), true);
});

t('audio-only create requires audio, title, and artist', () => {
    assert.strictEqual(api._createGateOpenPure({ gpPath: null, eofFiles: null }, {
        hasAudio: true, title: true, artist: true,
    }), true);
});

t('audio-only create stays disabled when metadata is incomplete', () => {
    assert.strictEqual(api._createGateOpenPure({ gpPath: null, eofFiles: null }, {
        hasAudio: true, title: true, artist: false,
    }), false);
    assert.strictEqual(api._createGateOpenPure({ gpPath: null, eofFiles: null }, {
        hasAudio: false, title: true, artist: true,
    }), false);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
