/*
 * Tests for the Count-in LCD cell + Count transport toggle
 * (src/transport-bar.js — the pair the B2 slice deferred until count-in
 * existed; count-in itself shipped with tests/compose_transport coverage).
 *
 * Pinned here: the cell is a first-class LCD citizen (in TRANSPORT_LCD_CELLS,
 * in charrette order, default-visible even under a pref blob saved BEFORE the
 * cell existed), and the Count toggle's arm/disarm round-trip (off → last
 * non-zero bar count, garbage memory → 1 bar, on → off).
 *
 * Run: node tests/count_lcd.test.mjs
 */
import assert from 'node:assert';

globalThis.document = globalThis.document || {
    getElementById: () => null, addEventListener: () => {}, activeElement: null,
};
globalThis.localStorage = globalThis.localStorage || { getItem: () => null, setItem: () => {} };
globalThis.window = globalThis.window || globalThis;

const {
    TRANSPORT_LCD_CELLS, _countRememberedPure, _countToggleTargetPure, _transportPrefsPure,
} = await import('../src/transport-bar.js');

let pass = 0, fail = 0;
function t(name, fn) {
    try { fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}

t('countin is an LCD cell, in the charrette order (… Key · Count-in · Grid · Sel · Mode)', () => {
    // Deliberate pin update: the Map Health grid pill joined the LCD between
    // Count-in and Sel.
    assert.deepStrictEqual(TRANSPORT_LCD_CELLS,
        ['position', 'time', 'tempo', 'meter', 'key', 'countin', 'grid', 'sel', 'mode']);
});

t('countin defaults visible, including under a pref blob saved before it existed', () => {
    assert.strictEqual(_transportPrefsPure(null).cells.countin, true);
    // A stored blob from the pre-countin bar: cells enumerated WITHOUT countin.
    const old = {
        primary: 'time',
        groups: { util: true, modes: false },
        cells: { position: true, time: true, tempo: false, meter: true, key: true, sel: true, mode: true },
    };
    const p = _transportPrefsPure(old);
    assert.strictEqual(p.cells.countin, true, 'absent key stays at the default (visible)');
    assert.strictEqual(p.cells.tempo, false, 'the old blob still applies');
    assert.strictEqual(p.groups.modes, false);
});

t('an explicit countin=false pref is honored (and survives a round-trip)', () => {
    const p = _transportPrefsPure({ cells: { countin: false } });
    assert.strictEqual(p.cells.countin, false);
    assert.strictEqual(_transportPrefsPure(p).cells.countin, false);
});

t('Count toggle: on → off, whatever the bar count', () => {
    for (const cur of [1, 2, 4]) assert.strictEqual(_countToggleTargetPure(cur, 2), 0, String(cur));
});

t('Count toggle: off → the remembered non-zero count', () => {
    assert.strictEqual(_countToggleTargetPure(0, 1), 1);
    assert.strictEqual(_countToggleTargetPure(0, 2), 2);
    assert.strictEqual(_countToggleTargetPure(0, 4), 4);
});

t('Count toggle: off with no/garbage memory arms 1 bar', () => {
    for (const last of [null, undefined, 0, 3, -1, NaN, 'two']) {
        assert.strictEqual(_countToggleTargetPure(0, last), 1, String(last));
    }
});

t('Count toggle: a garbage CURRENT value counts as off (arms, never crashes)', () => {
    for (const cur of [null, undefined, NaN, 3, -2, 'x']) {
        assert.strictEqual(_countToggleTargetPure(cur, 2), 2, String(cur));
    }
});

t('arm/disarm round-trips: toggling twice restores the starting count', () => {
    for (const start of [1, 2, 4]) {
        const off = _countToggleTargetPure(start, null);
        assert.strictEqual(off, 0);
        // The handler remembers `start` when disarming — modeled as `last` here.
        assert.strictEqual(_countToggleTargetPure(off, start), start);
    }
});

t('LCD 4 -> Off remembers 4 so Count restores it', () => {
    const remembered = _countRememberedPure('0', 4);
    assert.strictEqual(remembered, 4);
    assert.strictEqual(_countToggleTargetPure(0, remembered), 4);
    assert.strictEqual(_countRememberedPure('2', 4), 2, 'nonzero LCD picks update memory too');
    assert.strictEqual(_countRememberedPure('bad', 4), null);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
