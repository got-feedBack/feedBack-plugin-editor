/*
 * Click tools (src/tools.js) — the pointer-tool system's pure layer: the
 * palette state machine (per-profile T semantics), tool-id validation, the
 * extended right-click assignment vocabulary, and the left-tool accessor.
 *
 * The per-profile product calls pinned here (CLICK-TOOLS-DESIGN.md):
 *   - FeedBack / Cableton: T,T = Tempo Map (the old plain-T habit).
 *   - Logical: T,T = Pointer (Logic-exact reset).
 *   - Legacy (EOF): NO palette key at all — its map stays 1:1 EOF.
 *
 * Run: node tests/click_tools.test.mjs
 */
import assert from 'node:assert';
import {
    EDITOR_TOOLS,
    _editorEffectiveRightAssignPure,
    _editorPaletteKeyActionPure,
    _editorPaletteOpenKeyPure,
    _editorRightAssignValidPure,
    _editorToolValidPure,
    editorLeftTool,
    setEditorLeftTool,
} from '../src/tools.js';

let pass = 0, fail = 0;
function t(name, fn) {
    try { fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}

// ── tool ids ─────────────────────────────────────────────────────────

t('the v1 tool set is exactly the settled six, pointer first', () => {
    assert.deepStrictEqual(EDITOR_TOOLS.map(x => x.id),
        ['pointer', 'pencil', 'eraser', 'marquee', 'mute', 'scissors']);
    // Palette keys are unique.
    const keys = EDITOR_TOOLS.map(x => x.key);
    assert.strictEqual(new Set(keys).size, keys.length);
});

t('tool validation: junk falls back to pointer', () => {
    assert.strictEqual(_editorToolValidPure('pencil'), 'pencil');
    for (const junk of ['PENCIL', 'zoom', '', null, 7, {}]) {
        assert.strictEqual(_editorToolValidPure(junk), 'pointer');
    }
});

// ── palette open key per profile ─────────────────────────────────────

t('T opens the palette in feedback/logical/cableton; EOF has none', () => {
    for (const p of ['feedback', 'logical', 'cableton']) {
        assert.strictEqual(_editorPaletteOpenKeyPure(p), 't', p);
    }
    assert.strictEqual(_editorPaletteOpenKeyPure('eof'), null);
});

// ── the palette state machine ────────────────────────────────────────

t('every tool key picks its tool, case-insensitive, in every profile', () => {
    for (const p of ['feedback', 'logical', 'cableton']) {
        for (const tool of EDITOR_TOOLS) {
            assert.deepStrictEqual(
                _editorPaletteKeyActionPure(p, tool.key), { tool: tool.id });
            assert.deepStrictEqual(
                _editorPaletteKeyActionPure(p, tool.key.toUpperCase()), { tool: tool.id });
        }
    }
});

t('second T: Tempo Map in feedback/cableton, Pointer in logical', () => {
    assert.deepStrictEqual(_editorPaletteKeyActionPure('feedback', 't'), { mode: 'tempoMap' });
    assert.deepStrictEqual(_editorPaletteKeyActionPure('cableton', 't'), { mode: 'tempoMap' });
    assert.deepStrictEqual(_editorPaletteKeyActionPure('logical', 't'), { tool: 'pointer' });
});

t('Escape closes; unknown keys are ignored (palette stays open)', () => {
    assert.deepStrictEqual(_editorPaletteKeyActionPure('feedback', 'Escape'), { close: true });
    for (const k of ['x', '1', ' ', 'Enter', null]) {
        assert.strictEqual(_editorPaletteKeyActionPure('feedback', k), null);
    }
});

// ── right-click assignment vocabulary (feature parity) ───────────────

t('legacy values keep their meaning; tool: values validate', () => {
    assert.strictEqual(_editorRightAssignValidPure('context'), 'context');
    assert.strictEqual(_editorRightAssignValidPure('eofEdit'), 'eofEdit');
    for (const id of ['pencil', 'eraser', 'marquee', 'mute', 'scissors']) {
        assert.strictEqual(_editorRightAssignValidPure('tool:' + id), 'tool:' + id);
    }
});

t('tool:pointer is rejected (right-click pointer is just… the left button)', () => {
    assert.strictEqual(_editorRightAssignValidPure('tool:pointer'), null);
});

t('junk right assignments fall to the profile default', () => {
    for (const junk of ['tool:zoom', 'tool:', 'nonsense', null, 7]) {
        assert.strictEqual(_editorEffectiveRightAssignPure('feedback', junk), 'context');
        assert.strictEqual(_editorEffectiveRightAssignPure('eof', junk), 'eofEdit');
    }
});

t('a saved tool assignment wins over the profile default', () => {
    assert.strictEqual(
        _editorEffectiveRightAssignPure('feedback', 'tool:eraser'), 'tool:eraser');
    assert.strictEqual(
        _editorEffectiveRightAssignPure('eof', 'context'), 'context');
});

// ── left-tool accessor (no localStorage under node → degrades) ───────

t('left tool defaults to pointer and round-trips through the setter', () => {
    assert.strictEqual(editorLeftTool(), 'pointer');
    assert.strictEqual(setEditorLeftTool('pencil'), 'pencil');
    assert.strictEqual(editorLeftTool(), 'pencil');
    assert.strictEqual(setEditorLeftTool('junk'), 'pointer');
    assert.strictEqual(editorLeftTool(), 'pointer');
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
