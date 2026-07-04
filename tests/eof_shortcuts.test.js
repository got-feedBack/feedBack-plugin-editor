'use strict';
/*
 * EOF legacy shortcut profile mapping tests for screen.js.
 *
 * Run: node tests/eof_shortcuts.test.js
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const src = fs.readFileSync(path.join(__dirname, '..', 'screen.js'), 'utf8');
const m = src.match(/\/\* @pure:shortcut-profile:start \*\/[\s\S]*?\/\* @pure:shortcut-profile:end \*\//);
if (!m) {
    console.error('FAIL: @pure:shortcut-profile block not found in screen.js');
    process.exit(1);
}

const api = new Function(
    '"use strict";' + m[0] + '\nreturn { _editorKeySigPure, _editorEofCommandForKeyPure };'
)();

let pass = 0;
let fail = 0;
function t(name, fn) {
    try { fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}

const ev = (key, mods = {}) => ({
    key,
    ctrlKey: !!mods.ctrl,
    metaKey: !!mods.meta,
    shiftKey: !!mods.shift,
    altKey: !!mods.alt,
});

t('serializes modifier order consistently', () => {
    assert.strictEqual(api._editorKeySigPure(ev('PageDown', { ctrl: true, shift: true })), 'Ctrl+Shift+PageDown');
});

t('maps EOF timeline navigation keys', () => {
    assert.strictEqual(api._editorEofCommandForKeyPure(ev('PageUp')), 'prevBeat');
    assert.strictEqual(api._editorEofCommandForKeyPure(ev('PageDown')), 'nextBeat');
    assert.strictEqual(api._editorEofCommandForKeyPure(ev('PageUp', { shift: true })), 'prevNote');
    assert.strictEqual(api._editorEofCommandForKeyPure(ev('PageDown', { ctrl: true, shift: true })), 'nextGrid');
    assert.strictEqual(api._editorEofCommandForKeyPure(ev('PageDown', { alt: true })), 'nextAnchor');
});

t('maps EOF sustain and snap keys', () => {
    assert.strictEqual(api._editorEofCommandForKeyPure(ev('[')), 'shortenSustain');
    assert.strictEqual(api._editorEofCommandForKeyPure(ev(']')), 'lengthenSustain');
    assert.strictEqual(api._editorEofCommandForKeyPure(ev(',')), 'snapDown');
    assert.strictEqual(api._editorEofCommandForKeyPure(ev('.')), 'snapUp');
});

t('maps EOF technique shortcuts to command IDs', () => {
    assert.strictEqual(api._editorEofCommandForKeyPure(ev('h')), 'toggleHammerOn');
    assert.strictEqual(api._editorEofCommandForKeyPure(ev('p')), 'togglePullOff');
    assert.strictEqual(api._editorEofCommandForKeyPure(ev('h', { ctrl: true })), 'toggleNaturalHarmonic');
    assert.strictEqual(api._editorEofCommandForKeyPure(ev('h', { shift: true })), 'togglePinchHarmonic');
    assert.strictEqual(api._editorEofCommandForKeyPure(ev('p', { ctrl: true, shift: true })), 'togglePop');
});

t('maps EOF import and save function keys', () => {
    assert.strictEqual(api._editorEofCommandForKeyPure(ev('F2')), 'save');
    assert.strictEqual(api._editorEofCommandForKeyPure(ev('F5')), 'toggleWaveform');
    assert.strictEqual(api._editorEofCommandForKeyPure(ev('F6')), 'importMidi');
    assert.strictEqual(api._editorEofCommandForKeyPure(ev('F7')), 'importXml');
    assert.strictEqual(api._editorEofCommandForKeyPure(ev('F12')), 'importGp');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
