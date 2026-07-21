/*
 * The EOF wheel grammar — the mouse half of the EOF port (EOF-PROFILE-POLICY.md).
 *
 * EOF_hotkeys.txt mouse lines, and where each lands:
 *   Mouse scroll wheel  = Adjust sustain length      → MATCH (this suite)
 *   Ctrl + scroll wheel = Increment/decrement fret   → MATCH (this suite)
 *   Left click          = Select note (whole strum)  → MATCH (chord default, pinned below)
 *   Right click         = Add/remove note            → MATCH (eofEdit default, pinned below)
 *   Middle click        = Open pro guitar note box   → ADAPTED (middle-drag stays pan;
 *                         the N key / double-click reach the same note box)
 *
 * _editorEofWheelActionPure is the real decision function mouse.js dispatches
 * from — driven here directly (never stubbed), with every guard exercised on
 * both sides per the repo's stateful-wiring test rules.
 *
 * Run: node tests/eof_wheel.test.mjs
 */
import assert from 'node:assert';
import {
    _editorDefaultChordSelectBehaviorPure, _editorDefaultRightClickBehaviorPure,
    _editorEofWheelActionPure, _editorShortcutRowsPure,
} from '../src/shortcuts.js';

let pass = 0, fail = 0;
function t(name, fn) {
    try { fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}

const wheel = (dy, m = {}) => ({
    deltaY: dy, deltaX: m.dx || 0,
    ctrlKey: !!m.ctrl, metaKey: !!m.meta, shiftKey: !!m.shift, altKey: !!m.alt,
});
const CTX = { profile: 'eof', tempoMapMode: false, partsViewMode: false, drumEditMode: false, selCount: 2 };
const act = (e, over = {}) => _editorEofWheelActionPure(e, { ...CTX, ...over });

t('plain wheel maps to sustain — up lengthens, down shortens (EOF wheel-up = lengthen)', () => {
    assert.strictEqual(act(wheel(-120)), 'lengthenSustain');
    assert.strictEqual(act(wheel(120)), 'shortenSustain');
});

t('Ctrl+wheel maps to fret — up increments, down decrements; Meta counts as Ctrl', () => {
    assert.strictEqual(act(wheel(-120, { ctrl: true })), 'fretUp');
    assert.strictEqual(act(wheel(120, { ctrl: true })), 'fretDown');
    assert.strictEqual(act(wheel(-120, { meta: true })), 'fretUp');
});

t('only the EOF profile gets the grammar — every other profile falls through', () => {
    for (const profile of ['feedback', 'logical', 'cableton', undefined]) {
        assert.strictEqual(act(wheel(-120), { profile }), null, `profile=${profile}`);
        assert.strictEqual(act(wheel(-120, { ctrl: true }), { profile }), null, `ctrl profile=${profile}`);
    }
});

t('note mode only — tempo map, Tracks overview, and the drum grid keep their wheel', () => {
    assert.strictEqual(act(wheel(-120), { tempoMapMode: true }), null);
    assert.strictEqual(act(wheel(-120), { partsViewMode: true }), null);
    assert.strictEqual(act(wheel(-120), { drumEditMode: true }), null);
});

t('no selection → null (falls through to pan; a bare wheel never edits)', () => {
    assert.strictEqual(act(wheel(-120), { selCount: 0 }), null);
    assert.strictEqual(act(wheel(-120, { ctrl: true }), { selCount: 0 }), null);
});

t('Shift and Alt keep their existing meanings (pan / roll lane-stretch)', () => {
    assert.strictEqual(act(wheel(-120, { shift: true })), null);
    assert.strictEqual(act(wheel(-120, { alt: true })), null);
});

t('horizontal-dominant swipes and zero deltas fall through', () => {
    assert.strictEqual(act(wheel(-10, { dx: 80 })), null, 'horizontal swipe');
    assert.strictEqual(act(wheel(0)), null, 'no vertical delta');
});

t('the reference mouse defaults hold: right-click adds/removes, a click grabs the strum', () => {
    // EOF's other two mouse verbs ride the existing profile defaults — pinned
    // so a default change breaks this suite, not just runtime behaviour.
    assert.strictEqual(_editorDefaultRightClickBehaviorPure('eof'), 'eofEdit');
    assert.strictEqual(_editorDefaultChordSelectBehaviorPure('eof'), 'chord');
    assert.strictEqual(_editorDefaultRightClickBehaviorPure('feedback'), 'context', 'other profiles keep context menus');
});

t('the panel advertises the wheel beside the keys in the EOF profile only', () => {
    const eofRows = Object.fromEntries(_editorShortcutRowsPure('eof').map(r => [r.id, r.key]));
    assert.strictEqual(eofRows.shortenSustain, '[ / Wheel down');
    assert.strictEqual(eofRows.lengthenSustain, '] / Wheel up');
    assert.strictEqual(eofRows.fretUp, 'Ctrl++ / Ctrl+Wheel up');
    assert.strictEqual(eofRows.fretDown, 'Ctrl+- / Ctrl+Wheel down');
    const fbRows = Object.fromEntries(_editorShortcutRowsPure('feedback').map(r => [r.id, r.key]));
    assert.strictEqual(fbRows.shortenSustain, '[', 'FeedBack display untouched');
    assert.strictEqual(fbRows.fretUp, 'Ctrl++', 'FeedBack display untouched');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
