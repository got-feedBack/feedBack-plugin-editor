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
    '"use strict";' + m[0] + '\nreturn { _editorKeySigPure, _editorEofCommandForKeyPure, _editorFeedbackCommandForKeyPure, _editorShortcutRowsPure, _editorDefaultRightClickBehaviorPure, _editorEffectiveRightClickBehaviorPure };'
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
    assert.strictEqual(rows.find(r => r.id === 'toggleTempoMap').key, 'T (Tempo Map)');
    assert.strictEqual(rows.find(r => r.id === 'setTimeSignature').key, 'Shift+T / Shift+I');
    assert.strictEqual(rows.find(r => r.id === 'tempoBeatCount').key, 'N (Tempo Map)');
    assert.strictEqual(rows.find(r => r.id === 'tempoBeatMinus').key, '[ (Tempo Map)');
    assert.strictEqual(rows.find(r => r.id === 'tempoBeatUnit').key, 'D (Tempo Map)');
    assert.strictEqual(rows.find(r => r.id === 'tempoSetBpm').key, 'B (Tempo Map)');
    assert.strictEqual(rows.find(r => r.id === 'tempoToggleRideScope').key, 'Ctrl+T (Tempo Map)');
    assert.strictEqual(rows.find(r => r.id === 'tempoRebuildGrid').status, 'planned');
});

t('exposes wired FeedBack Native key labels', () => {
    const rows = api._editorShortcutRowsPure('feedback');
    assert.strictEqual(rows.find(r => r.id === 'save').key, 'Ctrl+S');
    assert.strictEqual(rows.find(r => r.id === 'prevNote').key, 'Alt+Left');
    assert.strictEqual(rows.find(r => r.id === 'toggleWaveform').key, 'W');
    assert.strictEqual(rows.find(r => r.id === 'importGp').key, '');
    assert.strictEqual(rows.find(r => r.id === 'toggleTempoMap').key, 'T');
    assert.strictEqual(rows.find(r => r.id === 'tempoBeatCount').key, 'N (Tempo Map)');
    assert.strictEqual(rows.find(r => r.id === 'tempoBeatPlus').key, '] (Tempo Map)');
    assert.strictEqual(rows.find(r => r.id === 'tempoBeatUnit').key, 'D (Tempo Map)');
    assert.strictEqual(rows.find(r => r.id === 'tempoInsertSync').key, 'I (Tempo Map)');
    assert.strictEqual(rows.find(r => r.id === 'tempoTapBpm').key, 'Shift+B (Tempo Map)');
    assert.strictEqual(rows.find(r => r.id === 'tempoFullDialog').key, 'Alt+T (Tempo Map)');
});

t('maps FeedBack Native timeline and grid shortcuts', () => {
    assert.strictEqual(api._editorFeedbackCommandForKeyPure(ev('w')), 'toggleWaveform');
    assert.strictEqual(api._editorFeedbackCommandForKeyPure(ev('g')), 'toggleSnap');
    assert.strictEqual(api._editorFeedbackCommandForKeyPure(ev('PageUp')), 'prevBeat');
    assert.strictEqual(api._editorFeedbackCommandForKeyPure(ev('ArrowRight', { alt: true })), 'nextNote');
    assert.strictEqual(api._editorFeedbackCommandForKeyPure(ev('PageDown', { ctrl: true })), 'nextGrid');
    assert.strictEqual(api._editorFeedbackCommandForKeyPure(ev('ArrowLeft', { ctrl: true, alt: true })), 'prevAnchor');
});

t('maps FeedBack Native note and technique shortcuts', () => {
    assert.strictEqual(api._editorFeedbackCommandForKeyPure(ev('f')), 'editFret');
    assert.strictEqual(api._editorFeedbackCommandForKeyPure(ev('t')), 'toggleTempoMap');
    assert.strictEqual(api._editorFeedbackCommandForKeyPure(ev('b')), 'bend');
    assert.strictEqual(api._editorFeedbackCommandForKeyPure(ev('h')), 'toggleHammerOn');
    assert.strictEqual(api._editorFeedbackCommandForKeyPure(ev('n')), 'toggleNaturalHarmonic');
    assert.strictEqual(api._editorFeedbackCommandForKeyPure(ev('n', { shift: true })), 'togglePinchHarmonic');
    assert.strictEqual(api._editorFeedbackCommandForKeyPure(ev('h', { ctrl: true })), 'addHandshape');
});


t('maps FeedBack Native Tempo Map commands by active mode', () => {
    assert.strictEqual(api._editorFeedbackCommandForKeyPure(ev('t')), 'toggleTempoMap');
    assert.strictEqual(api._editorFeedbackCommandForKeyPure(ev('b')), 'bend');
    assert.strictEqual(api._editorFeedbackCommandForKeyPure(ev('b'), 'tempoMap'), 'tempoSetBpm');
    assert.strictEqual(api._editorFeedbackCommandForKeyPure(ev('b', { shift: true }), 'tempoMap'), 'tempoTapBpm');
    assert.strictEqual(api._editorFeedbackCommandForKeyPure(ev('i'), 'tempoMap'), 'tempoInsertSync');
    assert.strictEqual(api._editorFeedbackCommandForKeyPure(ev('n'), 'tempoMap'), 'tempoBeatCount');
    assert.strictEqual(api._editorFeedbackCommandForKeyPure(ev('['), 'tempoMap'), 'tempoBeatMinus');
    assert.strictEqual(api._editorFeedbackCommandForKeyPure(ev(']'), 'tempoMap'), 'tempoBeatPlus');
    assert.strictEqual(api._editorFeedbackCommandForKeyPure(ev('d'), 'tempoMap'), 'tempoBeatUnit');
    assert.strictEqual(api._editorFeedbackCommandForKeyPure(ev('s'), 'tempoMap'), 'tempoToggleSyncLock');
    assert.strictEqual(api._editorFeedbackCommandForKeyPure(ev('t', { shift: true }), 'tempoMap'), 'setTimeSignature');
    assert.strictEqual(api._editorFeedbackCommandForKeyPure(ev('t', { ctrl: true }), 'tempoMap'), 'tempoToggleRideScope');
    assert.strictEqual(api._editorFeedbackCommandForKeyPure(ev('t', { alt: true }), 'tempoMap'), 'tempoFullDialog');
    assert.strictEqual(api._editorFeedbackCommandForKeyPure(ev('t', { ctrl: true, shift: true }), 'tempoMap'), 'tempoRebuildGrid');
    assert.strictEqual(api._editorFeedbackCommandForKeyPure(ev('Delete'), 'tempoMap'), 'tempoDeleteSync');
});

t('maps EOF Tempo Map commands by active mode', () => {
    assert.strictEqual(api._editorEofCommandForKeyPure(ev('t')), 'toggleTap');
    assert.strictEqual(api._editorEofCommandForKeyPure(ev('t'), 'tempoMap'), 'toggleTempoMap');
    assert.strictEqual(api._editorEofCommandForKeyPure(ev('b', { ctrl: true })), 'bend');
    assert.strictEqual(api._editorEofCommandForKeyPure(ev('b'), 'tempoMap'), 'tempoSetBpm');
    assert.strictEqual(api._editorEofCommandForKeyPure(ev('b', { shift: true }), 'tempoMap'), 'tempoTapBpm');
    assert.strictEqual(api._editorEofCommandForKeyPure(ev('[')), 'shortenSustain');
    assert.strictEqual(api._editorEofCommandForKeyPure(ev('['), 'tempoMap'), 'tempoBeatMinus');
    assert.strictEqual(api._editorEofCommandForKeyPure(ev('n'), 'tempoMap'), 'tempoBeatCount');
    assert.strictEqual(api._editorEofCommandForKeyPure(ev(']'), 'tempoMap'), 'tempoBeatPlus');
    assert.strictEqual(api._editorEofCommandForKeyPure(ev('d'), 'tempoMap'), 'tempoBeatUnit');
    assert.strictEqual(api._editorEofCommandForKeyPure(ev('s'), 'tempoMap'), 'tempoToggleSyncLock');
    assert.strictEqual(api._editorEofCommandForKeyPure(ev('t', { shift: true }), 'tempoMap'), 'setTimeSignature');
    assert.strictEqual(api._editorEofCommandForKeyPure(ev('t', { ctrl: true }), 'tempoMap'), 'tempoToggleRideScope');
    assert.strictEqual(api._editorEofCommandForKeyPure(ev('t', { alt: true }), 'tempoMap'), 'tempoFullDialog');
    assert.strictEqual(api._editorEofCommandForKeyPure(ev('t', { ctrl: true, shift: true }), 'tempoMap'), 'tempoRebuildGrid');
    assert.strictEqual(api._editorEofCommandForKeyPure(ev('Insert'), 'tempoMap'), 'tempoInsertSync');
    assert.strictEqual(api._editorEofCommandForKeyPure(ev('Backspace'), 'tempoMap'), 'tempoDeleteSync');
});
t('defaults right-click behavior by shortcut profile', () => {
    assert.strictEqual(api._editorDefaultRightClickBehaviorPure('feedback'), 'context');
    assert.strictEqual(api._editorDefaultRightClickBehaviorPure('eof'), 'eofEdit');
});

t('lets saved right-click behavior override profile defaults', () => {
    assert.strictEqual(api._editorEffectiveRightClickBehaviorPure('eof', null), 'eofEdit');
    assert.strictEqual(api._editorEffectiveRightClickBehaviorPure('eof', 'context'), 'context');
    assert.strictEqual(api._editorEffectiveRightClickBehaviorPure('feedback', 'eofEdit'), 'eofEdit');
    assert.strictEqual(api._editorEffectiveRightClickBehaviorPure('feedback', 'bogus'), 'context');
});
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
