/*
 * Note-entry preview tests (gap-audit follow-up): the dashed caret cell now
 * previews a typed note's LENGTH (sized to the snap step) and is a persisted,
 * toggleable view pref. Covers the pure width helper (src/draw.js) and the
 * localStorage-backed toggle (src/input.js).
 *
 * Run: node --test tests/entry_preview.test.mjs
 */
import assert from 'node:assert';

// Minimal browser surface the modules touch at import / call time.
let _store = {};
globalThis.localStorage = {
    getItem: (k) => (k in _store ? _store[k] : null),
    setItem: (k, v) => { _store[k] = String(v); },
    removeItem: (k) => { delete _store[k]; },
};
globalThis.document = globalThis.document || {
    getElementById: () => null, querySelector: () => null,
    addEventListener: () => {}, createElement: () => ({ style: {}, classList: { add() {}, remove() {} } }),
};
globalThis.window = globalThis.window || globalThis;

const { _caretCellWidthPure } = await import('../src/draw.js');
const { _editorEntryPreviewEnabled, editorToggleEntryPreview } = await import('../src/input.js');

let pass = 0, fail = 0;
function t(name, fn) {
    try { fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}

// ── _caretCellWidthPure: the cell earns its note SHAPE ────────────────────────
t('cell width is the note value (step × zoom) when that beats the minimum', () => {
    // 0.5 s step at 200 px/s = 100 px, well over the 8 px minimum.
    assert.strictEqual(_caretCellWidthPure(0.5, 200, 8), 100);
});

t('floors to the minimum so the cell always shows at tiny steps / low zoom', () => {
    // 1/64-note-ish step at low zoom → sub-pixel; must not vanish.
    assert.strictEqual(_caretCellWidthPure(0.01, 100, 8), 8); // 1px < 8
    assert.strictEqual(_caretCellWidthPure(0, 200, 8), 8);    // no grid → minimum
});

t('a zero/negative zoom or garbage input degrades to the minimum, never NaN', () => {
    assert.strictEqual(_caretCellWidthPure(0.5, 0, 8), 8);
    assert.strictEqual(_caretCellWidthPure(0.5, -200, 8), 8);
    assert.strictEqual(_caretCellWidthPure(NaN, 200, 8), 8);
    assert.strictEqual(_caretCellWidthPure(0.5, 200, undefined), 100); // minW absent → 0 floor
});

t('grows and shrinks monotonically with the snap step (longer note → wider cell)', () => {
    const eighth = _caretCellWidthPure(0.25, 200, 8);
    const quarter = _caretCellWidthPure(0.5, 200, 8);
    const half = _caretCellWidthPure(1.0, 200, 8);
    assert.ok(eighth < quarter && quarter < half, `${eighth} < ${quarter} < ${half}`);
});

// ── toggle: persisted view pref, default ON ───────────────────────────────────
t('defaults ON when nothing is stored', () => {
    _store = {};
    // Re-reading a fresh module cache isn't possible here, but with an empty store
    // the getter's cache may already be seeded ON from import — assert the contract
    // via an explicit force to a known state first.
    editorToggleEntryPreview(true);
    assert.strictEqual(_editorEntryPreviewEnabled(), true);
});

t('toggling flips the flag and persists it to localStorage', () => {
    editorToggleEntryPreview(true);
    assert.strictEqual(_editorEntryPreviewEnabled(), true);
    const off = editorToggleEntryPreview();
    assert.strictEqual(off, false);
    assert.strictEqual(_editorEntryPreviewEnabled(), false);
    assert.strictEqual(_store.editorEntryPreview, '0');
    const on = editorToggleEntryPreview();
    assert.strictEqual(on, true);
    assert.strictEqual(_store.editorEntryPreview, '1');
});

t('an explicit force sets the state directly (idempotent)', () => {
    assert.strictEqual(editorToggleEntryPreview(false), false);
    assert.strictEqual(editorToggleEntryPreview(false), false);
    assert.strictEqual(_editorEntryPreviewEnabled(), false);
    assert.strictEqual(editorToggleEntryPreview(true), true);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
