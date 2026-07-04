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
    '"use strict";' + m[0] + '\nreturn { _editorKeySigPure, _editorEofCommandForKeyPure, _editorFeedbackCommandForKeyPure, _editorShortcutRowsPure };'
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


t('exposes ready and planned shortcut command rows', () => {
    const rows = api._editorShortcutRowsPure('eof');
    const save = rows.find(r => r.id === 'save');
    const customSnap = rows.find(r => r.id === 'customGridSnap');
    assert.ok(save);
    assert.strictEqual(save.status, 'ready');
    assert.strictEqual(save.key, 'F2 / Ctrl+S');
    assert.ok(customSnap);
    assert.strictEqual(customSnap.status, 'planned');
    assert.strictEqual(customSnap.key, 'Ctrl+Shift+G');
});

t('exposes wired FeedBack Native key labels', () => {
    const rows = api._editorShortcutRowsPure('feedback');
    assert.strictEqual(rows.find(r => r.id === 'save').key, 'Ctrl+S');
    assert.strictEqual(rows.find(r => r.id === 'prevNote').key, 'Alt+Left');
    assert.strictEqual(rows.find(r => r.id === 'toggleWaveform').key, 'W');
    assert.strictEqual(rows.find(r => r.id === 'importGp').key, '');
});

t('maps FeedBack Native timeline and grid shortcuts', () => {
    assert.strictEqual(api._editorFeedbackCommandForKeyPure(ev('w')), 'toggleWaveform');
    assert.strictEqual(api._editorFeedbackCommandForKeyPure(ev('PageUp')), 'prevBeat');
    assert.strictEqual(api._editorFeedbackCommandForKeyPure(ev('ArrowRight', { alt: true })), 'nextNote');
    assert.strictEqual(api._editorFeedbackCommandForKeyPure(ev('PageDown', { ctrl: true })), 'nextGrid');
    assert.strictEqual(api._editorFeedbackCommandForKeyPure(ev('ArrowLeft', { ctrl: true, alt: true })), 'prevAnchor');
});

t('maps FeedBack Native note and technique shortcuts', () => {
    assert.strictEqual(api._editorFeedbackCommandForKeyPure(ev('f')), 'editFret');
    assert.strictEqual(api._editorFeedbackCommandForKeyPure(ev('b')), 'bend');
    assert.strictEqual(api._editorFeedbackCommandForKeyPure(ev('h')), 'toggleHammerOn');
    assert.strictEqual(api._editorFeedbackCommandForKeyPure(ev('n')), 'toggleNaturalHarmonic');
    assert.strictEqual(api._editorFeedbackCommandForKeyPure(ev('n', { shift: true })), 'togglePinchHarmonic');
    assert.strictEqual(api._editorFeedbackCommandForKeyPure(ev('h', { ctrl: true })), 'addHandshape');
});
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
