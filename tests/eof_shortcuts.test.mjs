/*
 * EOF legacy shortcut profile mapping tests for src/main.js.
 *
 * Run: node tests/eof_shortcuts.test.mjs
 */
import assert from 'node:assert';
import * as api from '../src/shortcuts.js';

let pass = 0;
let fail = 0;
function t(name, fn) {
    try { fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}

const ev = (key, mods = {}) => ({
    key,
    code: mods.code || '',
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

t('FeedBack profile now binds the bracket keys to sustain (the gap this closes)', () => {
    // shorten/lengthenSustain were registry-registered but had NO FeedBack key
    // (feedback:''), so default-profile users had no keyboard sustain edit at
    // all. They now match the EOF bracket keys in note mode.
    assert.strictEqual(api._editorFeedbackCommandForKeyPure(ev('['), 'note'), 'shortenSustain');
    assert.strictEqual(api._editorFeedbackCommandForKeyPure(ev(']'), 'note'), 'lengthenSustain');
    // …and the registry row displays the bound key, so palette / help surface it.
    const rows = Object.fromEntries(api._editorShortcutRowsPure('feedback').map(r => [r.id, r.key]));
    assert.strictEqual(rows.shortenSustain, '[');
    assert.strictEqual(rows.lengthenSustain, ']');
    // In tempo-map mode the brackets stay the beat-count controls (unchanged) —
    // that block resolves first, so the note-mode binding can't shadow it.
    assert.strictEqual(api._editorFeedbackCommandForKeyPure(ev('['), 'tempoMap'), 'tempoBeatMinus');
    assert.strictEqual(api._editorFeedbackCommandForKeyPure(ev(']'), 'tempoMap'), 'tempoBeatPlus');
});

t('maps EOF technique shortcuts to command IDs', () => {
    assert.strictEqual(api._editorEofCommandForKeyPure(ev('h')), 'toggleHammerOn');
    assert.strictEqual(api._editorEofCommandForKeyPure(ev('p')), 'togglePullOff');
    assert.strictEqual(api._editorEofCommandForKeyPure(ev('h', { ctrl: true })), 'toggleNaturalHarmonic');
    assert.strictEqual(api._editorEofCommandForKeyPure(ev('h', { shift: true })), 'togglePinchHarmonic');
    assert.strictEqual(api._editorEofCommandForKeyPure(ev('p', { ctrl: true, shift: true })), 'togglePop');
    assert.strictEqual(api._editorEofCommandForKeyPure(ev('o', { shift: true })), 'toggleSlap');
    assert.strictEqual(api._editorEofCommandForKeyPure(ev('k')), 'cyclePickDirection');
});

t('maps EOF import and save function keys', () => {
    assert.strictEqual(api._editorEofCommandForKeyPure(ev('F2')), 'save');
    assert.strictEqual(api._editorEofCommandForKeyPure(ev('F5')), 'toggleWaveform');
    assert.strictEqual(api._editorEofCommandForKeyPure(ev('?', { shift: true })), 'showShortcutHelp');
    assert.strictEqual(api._editorEofCommandForKeyPure(ev('k', { ctrl: true })), 'openCommandPalette');
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
    assert.strictEqual(rows.find(r => r.id === 'showShortcutHelp').key, 'F1 / ?');
    assert.strictEqual(rows.find(r => r.id === 'openCommandPalette').key, 'Ctrl+K');
    assert.strictEqual(rows.find(r => r.id === 'setFretDigit').key, '0-9 / Ctrl+1-9');
    assert.strictEqual(rows.find(r => r.id === 'setFretTen').key, 'Shift+0 / Ctrl+0');
    assert.strictEqual(rows.find(r => r.id === 'moveStringUp').key, 'Up');
    assert.strictEqual(rows.find(r => r.id === 'moveStringDown').key, 'Down');
    assert.strictEqual(rows.find(r => r.id === 'slideUp').status, 'ready');
    assert.strictEqual(rows.find(r => r.id === 'slideUp').key, 'Ctrl+Up');
    assert.strictEqual(rows.find(r => r.id === 'slideDown').status, 'ready');
    assert.strictEqual(rows.find(r => r.id === 'slideDown').key, 'Ctrl+Down');
    assert.strictEqual(rows.find(r => r.id === 'toggleSlap').key, 'Shift+O');
    assert.strictEqual(rows.find(r => r.id === 'slideEditor').key, 'S');
    assert.strictEqual(rows.find(r => r.id === 'cyclePickDirection').key, 'K');
    // EOF's Shift+T is Midi Tones; time signature is Shift+I only there.
    assert.strictEqual(rows.find(r => r.id === 'setTimeSignature').key, 'Shift+I');
    assert.strictEqual(rows.find(r => r.id === 'tempoBeatCount').key, 'N (Tempo Map)');
    assert.strictEqual(rows.find(r => r.id === 'tempoBeatMinus').key, '[ (Tempo Map)');
    assert.strictEqual(rows.find(r => r.id === 'tempoBeatUnit').key, 'D (Tempo Map)');
    assert.strictEqual(rows.find(r => r.id === 'tempoSetBpm').key, 'B (Tempo Map)');
    // tempoToggleRideScope removed with the ride-scope picker (beat-primary
    // reprojects every part, so there is no ride choice) — its Ctrl+T is free.
    assert.strictEqual(rows.find(r => r.id === 'tempoToggleRideScope'), undefined);
    assert.strictEqual(rows.find(r => r.id === 'tempoRebuildGrid').status, 'planned');
});

t('exposes wired FeedBack Native key labels', () => {
    const rows = api._editorShortcutRowsPure('feedback');
    assert.strictEqual(rows.find(r => r.id === 'save').key, 'Ctrl+S');
    assert.strictEqual(rows.find(r => r.id === 'prevNote').key, 'Alt+Left');
    assert.strictEqual(rows.find(r => r.id === 'toggleWaveform').key, 'W');
    assert.strictEqual(rows.find(r => r.id === 'showShortcutHelp').key, '?');
    assert.strictEqual(rows.find(r => r.id === 'openCommandPalette').key, 'Ctrl+K');
    assert.strictEqual(rows.find(r => r.id === 'setFretDigit').key, '0-9');
    assert.strictEqual(rows.find(r => r.id === 'setFretTen').key, 'Shift+0');
    assert.strictEqual(rows.find(r => r.id === 'moveStringUp').key, 'Up');
    assert.strictEqual(rows.find(r => r.id === 'moveStringDown').key, 'Down');
    assert.strictEqual(rows.find(r => r.id === 'slideUp').status, 'ready');
    assert.strictEqual(rows.find(r => r.id === 'slideUp').key, 'Ctrl+Up');
    assert.strictEqual(rows.find(r => r.id === 'slideDown').status, 'ready');
    assert.strictEqual(rows.find(r => r.id === 'slideDown').key, 'Ctrl+Down');
    assert.strictEqual(rows.find(r => r.id === 'toggleSlap').key, 'Shift+O');
    assert.strictEqual(rows.find(r => r.id === 'slideEditor').key, 'S');
    assert.strictEqual(rows.find(r => r.id === 'cyclePickDirection').key, 'K');
    assert.strictEqual(rows.find(r => r.id === 'importGp').key, '');
    // Plain T opens the tool palette; T pressed again enters Tempo Map — the
    // registry shows the chord that actually works (tools.js grammar).
    assert.strictEqual(rows.find(r => r.id === 'toggleTempoMap').key, 'T,T');
    assert.strictEqual(rows.find(r => r.id === 'tempoBeatCount').key, 'N (Tempo Map)');
    assert.strictEqual(rows.find(r => r.id === 'tempoBeatPlus').key, '] (Tempo Map)');
    assert.strictEqual(rows.find(r => r.id === 'tempoBeatUnit').key, 'D (Tempo Map)');
    assert.strictEqual(rows.find(r => r.id === 'tempoInsertSync').key, 'I (Tempo Map)');
    assert.strictEqual(rows.find(r => r.id === 'tempoTapBpm').key, 'Shift+B (Tempo Map)');
    assert.strictEqual(rows.find(r => r.id === 'tempoFullDialog').key, 'Alt+T (Tempo Map)');
});

t('maps FeedBack Native timeline and grid shortcuts', () => {
    assert.strictEqual(api._editorFeedbackCommandForKeyPure(ev('w')), 'toggleWaveform');
    assert.strictEqual(api._editorFeedbackCommandForKeyPure(ev('?', { shift: true })), 'showShortcutHelp');
    assert.strictEqual(api._editorFeedbackCommandForKeyPure(ev('k', { ctrl: true })), 'openCommandPalette');
    assert.strictEqual(api._editorFeedbackCommandForKeyPure(ev('g')), 'toggleSnap');
    assert.strictEqual(api._editorFeedbackCommandForKeyPure(ev('PageUp')), 'prevBeat');
    assert.strictEqual(api._editorFeedbackCommandForKeyPure(ev('ArrowRight', { alt: true })), 'nextNote');
    assert.strictEqual(api._editorFeedbackCommandForKeyPure(ev('PageDown', { ctrl: true })), 'nextGrid');
    assert.strictEqual(api._editorFeedbackCommandForKeyPure(ev('ArrowLeft', { ctrl: true, alt: true })), 'prevAnchor');
});

t('maps FeedBack Native note and technique shortcuts', () => {
    assert.strictEqual(api._editorFeedbackCommandForKeyPure(ev('f')), 'editFret');
    assert.strictEqual(api._editorFeedbackCommandForKeyPure(ev('7')), 'setFretDigit:7');
    assert.strictEqual(api._editorFeedbackCommandForKeyPure(ev(')', { shift: true })), 'setFretTen');
    assert.strictEqual(api._editorFeedbackCommandForKeyPure(ev('ArrowUp')), 'moveStringUp');
    assert.strictEqual(api._editorFeedbackCommandForKeyPure(ev('ArrowDown')), 'moveStringDown');
    assert.strictEqual(api._editorFeedbackCommandForKeyPure(ev('ArrowUp', { shift: true })), 'transposeStringUp');
    assert.strictEqual(api._editorFeedbackCommandForKeyPure(ev('ArrowUp', { ctrl: true })), 'slideUp');
    assert.strictEqual(api._editorFeedbackCommandForKeyPure(ev('ArrowDown', { ctrl: true })), 'slideDown');
    assert.strictEqual(api._editorFeedbackCommandForKeyPure(ev('t')), 'toggleTempoMap');
    assert.strictEqual(api._editorFeedbackCommandForKeyPure(ev('b')), 'bend');
    assert.strictEqual(api._editorFeedbackCommandForKeyPure(ev('s')), 'slideEditor');
    assert.strictEqual(api._editorFeedbackCommandForKeyPure(ev('h')), 'toggleHammerOn');
    assert.strictEqual(api._editorFeedbackCommandForKeyPure(ev('k')), 'cyclePickDirection');
    assert.strictEqual(api._editorFeedbackCommandForKeyPure(ev('n')), 'toggleNaturalHarmonic');
    assert.strictEqual(api._editorFeedbackCommandForKeyPure(ev('n', { shift: true })), 'togglePinchHarmonic');
    assert.strictEqual(api._editorFeedbackCommandForKeyPure(ev('h', { ctrl: true })), 'addHandshape');
    assert.strictEqual(api._editorFeedbackCommandForKeyPure(ev('o', { shift: true })), 'toggleSlap');
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
    // Ctrl+T is unbound in Tempo Map mode now that the ride-scope toggle is gone.
    assert.strictEqual(api._editorFeedbackCommandForKeyPure(ev('t', { ctrl: true }), 'tempoMap'), null);
    assert.strictEqual(api._editorFeedbackCommandForKeyPure(ev('t', { alt: true }), 'tempoMap'), 'tempoFullDialog');
    assert.strictEqual(api._editorFeedbackCommandForKeyPure(ev('t', { ctrl: true, shift: true }), 'tempoMap'), 'tempoRebuildGrid');
    assert.strictEqual(api._editorFeedbackCommandForKeyPure(ev('Delete'), 'tempoMap'), 'tempoDeleteSync');
});

t('maps EOF Tempo Map commands by active mode', () => {
    // EOF's plain T is "Crazy status" — a feature this editor doesn't have, so
    // the key stays FREE rather than squatting Tap (EOF's Tap is Ctrl+T).
    assert.strictEqual(api._editorEofCommandForKeyPure(ev('t')), null);
    assert.strictEqual(api._editorEofCommandForKeyPure(ev('t', { ctrl: true })), 'toggleTap');
    assert.strictEqual(api._editorEofCommandForKeyPure(ev('s')), 'slideEditor');
    assert.strictEqual(api._editorEofCommandForKeyPure(ev('4')), 'setFretDigit:4');
    assert.strictEqual(api._editorEofCommandForKeyPure(ev(')', { shift: true })), 'setFretTen');
    assert.strictEqual(api._editorEofCommandForKeyPure(ev('ArrowUp')), 'moveStringUp');
    assert.strictEqual(api._editorEofCommandForKeyPure(ev('ArrowDown')), 'moveStringDown');
    assert.strictEqual(api._editorEofCommandForKeyPure(ev('ArrowDown', { shift: true })), 'transposeStringDown');
    assert.strictEqual(api._editorEofCommandForKeyPure(ev('ArrowUp', { ctrl: true })), 'slideUp');
    assert.strictEqual(api._editorEofCommandForKeyPure(ev('ArrowDown', { ctrl: true })), 'slideDown');
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
    // Ctrl+T no longer has a Tempo-Map meaning (ride-scope toggle removed); in
    // the EOF profile it now falls through to the general 't' → toggleTap.
    assert.strictEqual(api._editorEofCommandForKeyPure(ev('t', { ctrl: true }), 'tempoMap'), 'toggleTap');
    assert.strictEqual(api._editorEofCommandForKeyPure(ev('t', { alt: true }), 'tempoMap'), 'tempoFullDialog');
    assert.strictEqual(api._editorEofCommandForKeyPure(ev('t', { ctrl: true, shift: true }), 'tempoMap'), 'tempoRebuildGrid');
    assert.strictEqual(api._editorEofCommandForKeyPure(ev('Insert'), 'tempoMap'), 'tempoInsertSync');
    assert.strictEqual(api._editorEofCommandForKeyPure(ev('Backspace'), 'tempoMap'), 'tempoDeleteSync');
});
t('EOF port: help, select-like, fret aliases, and numpad bookmarks land', () => {
    // F1 = Help (EOF), beside the universal '?'.
    assert.strictEqual(api._editorEofCommandForKeyPure(ev('F1')), 'showShortcutHelp');
    // Shift+L = precise select-like → our one select-matching command; follow
    // has no EOF key (EOF just auto-scrolls) and is button/View-menu only there.
    assert.strictEqual(api._editorEofCommandForKeyPure(ev('l', { shift: true })), 'selectLike');
    assert.strictEqual(api._editorEofCommandForKeyPure(ev('l', { ctrl: true })), 'selectLike');
    // EOF's own fret entry kept as a faithful alias: Ctrl+1-9, Ctrl+0=10, Ctrl+`=0.
    assert.strictEqual(api._editorEofCommandForKeyPure(ev('3', { ctrl: true })), 'setFretDigit:3');
    assert.strictEqual(api._editorEofCommandForKeyPure(ev('0', { ctrl: true })), 'setFretTen');
    assert.strictEqual(api._editorEofCommandForKeyPure(ev('`', { ctrl: true })), 'setFretDigit:0');
    // Numpad bookmarks (EOF: plain = goto, Ctrl = set) — and a NumLock numpad
    // digit (e.key '5', code Numpad5) must NOT read as fret entry.
    assert.strictEqual(api._editorEofCommandForKeyPure(ev('5', { code: 'Numpad5' })), 'gotoBookmark:5');
    assert.strictEqual(api._editorEofCommandForKeyPure(ev('5', { ctrl: true, code: 'Numpad5' })), 'setBookmark:5');
    assert.strictEqual(api._editorEofCommandForKeyPure(ev('5', { code: 'Digit5' })), 'setFretDigit:5');
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

// Regression: the settings <select> / hint / status must DISPLAY a saved
// `tool:<id>` right-click assignment verbatim, not collapse it to the profile
// default. Before the fix the sync used _editorEffectiveRightClickBehaviorPure,
// which drops tool: values → the dropdown snapped back to "Context menus" the
// instant you picked a tool and the tool hint was dead code.
t('control display value keeps a saved tool: assignment (not the binary resolver)', () => {
    // The binary resolver DOES collapse it — that is correct for its job and
    // is exactly why it must NOT be the one driving the control.
    assert.strictEqual(api._editorEffectiveRightClickBehaviorPure('feedback', 'tool:eraser'), 'context');
    // The display resolver keeps every persistable value intact.
    for (const v of ['tool:pencil', 'tool:eraser', 'tool:marquee', 'tool:mute', 'tool:scissors', 'context', 'eofEdit']) {
        assert.strictEqual(api._editorRightClickControlValuePure('feedback', v), v, v);
    }
    // Null / junk still fall back to the profile default.
    assert.strictEqual(api._editorRightClickControlValuePure('feedback', null), 'context');
    assert.strictEqual(api._editorRightClickControlValuePure('eof', null), 'eofEdit');
    assert.strictEqual(api._editorRightClickControlValuePure('feedback', 'tool:zoom'), 'context');
    assert.strictEqual(api._editorRightClickControlValuePure('feedback', 'bogus'), 'context');
});
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
