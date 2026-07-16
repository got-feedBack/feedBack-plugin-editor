/*
 * Canvas appearance (src/canvas-appearance.js) — the Ableton-parity
 * grid/canvas customization (View ▸ Canvas appearance…).
 *
 * Covers: the pure color pipeline (hex↔HSL, adjustment semantics), settings
 * sanitization (junk-tolerant, clamped), the CP palette accessor (identity at
 * defaults modulo hex normalization, grid-strength reaching ONLY grid-bucket
 * entries, cache invalidation on change), and the community fix itself — the
 * default beat-line color must be brighter than the old invisible #16162c.
 *
 * Run: node tests/canvas_appearance.test.mjs
 */
import assert from 'node:assert';
import {
    CANVAS_APPEARANCE_DEFAULTS,
    CP,
    _adjustHexPure,
    _appearanceFieldPure,
    _hexToHslPure,
    _hslToHexPure,
    _sanitizeAppearancePure,
    canvasAppearance,
    resetCanvasAppearance,
    setCanvasAppearance,
} from '../src/canvas-appearance.js';

let pass = 0, fail = 0;
function t(name, fn) {
    try { fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}

// ── hex ↔ HSL ────────────────────────────────────────────────────────

t('hex→HSL→hex round-trips (within 8-bit quantization)', () => {
    for (const hex of ['#16162c', '#2a2a50', '#0c0c1c', '#ff0000', '#00ff00',
        '#0000ff', '#ffffff', '#000000', '#20203e']) {
        const hsl = _hexToHslPure(hex);
        const back = _hslToHexPure(hsl.h, hsl.s, hsl.l);
        // Each channel within ±1 of the original (rounding).
        for (let i = 1; i < 7; i += 2) {
            const a = parseInt(hex.slice(i, i + 2), 16);
            const b = parseInt(back.slice(i, i + 2), 16);
            assert.ok(Math.abs(a - b) <= 1, `${hex} → ${back} channel drift`);
        }
    }
});

t('short #rgb form accepted; junk rejected', () => {
    assert.deepStrictEqual(_hexToHslPure('#fff'), { h: 0, s: 0, l: 1 });
    assert.strictEqual(_hexToHslPure('#12'), null);
    assert.strictEqual(_hexToHslPure('red'), null);
    assert.strictEqual(_hexToHslPure(null), null);
    assert.strictEqual(_hexToHslPure(12), null);
});

// ── settings sanitization ────────────────────────────────────────────

t('defaults pass through; junk falls back per-field; values clamp', () => {
    assert.deepStrictEqual(_sanitizeAppearancePure(null), { ...CANVAS_APPEARANCE_DEFAULTS });
    assert.deepStrictEqual(_sanitizeAppearancePure('junk'), { ...CANVAS_APPEARANCE_DEFAULTS });
    const s = _sanitizeAppearancePure({ grid: 9999, brightness: -5, intensity: 'x', hue: 720 });
    assert.strictEqual(s.grid, 400);        // clamped to max
    assert.strictEqual(s.brightness, 50);   // clamped to min
    assert.strictEqual(s.intensity, 100);   // junk → default
    assert.strictEqual(s.hue, 180);         // clamped
});

t('_appearanceFieldPure rejects unknown fields', () => {
    assert.strictEqual(_appearanceFieldPure('nope', 50), undefined);
});

t('_appearanceFieldPure: null and blank strings fall back to the default (not clamped-0)', () => {
    // Number(null)/Number('') are 0, which would clamp to the field MIN (25 for
    // grid). A persisted { grid: null } must restore the default instead.
    assert.strictEqual(_appearanceFieldPure('grid', null), CANVAS_APPEARANCE_DEFAULTS.grid);
    assert.strictEqual(_appearanceFieldPure('grid', ''), CANVAS_APPEARANCE_DEFAULTS.grid);
    assert.strictEqual(_appearanceFieldPure('grid', '   '), CANVAS_APPEARANCE_DEFAULTS.grid);
    assert.strictEqual(_appearanceFieldPure('brightness', null), CANVAS_APPEARANCE_DEFAULTS.brightness);
});

// ── adjustment semantics ─────────────────────────────────────────────

const DEF = { ...CANVAS_APPEARANCE_DEFAULTS };

t('identity at defaults (modulo hex normalization)', () => {
    const out = _adjustHexPure('#20203e', DEF, false);
    const a = _hexToHslPure('#20203e'), b = _hexToHslPure(out);
    assert.ok(Math.abs(a.l - b.l) < 0.02 && Math.abs(a.s - b.s) < 0.03);
});

t('brightness scales lightness; grid strength reaches only grid entries', () => {
    const bright = _adjustHexPure('#20203e', { ...DEF, brightness: 200 }, false);
    assert.ok(_hexToHslPure(bright).l > _hexToHslPure('#20203e').l * 1.7);

    const gridOnly = { ...DEF, grid: 300 };
    const asGrid = _adjustHexPure('#20203e', gridOnly, true);
    const asBg = _adjustHexPure('#20203e', gridOnly, false);
    assert.ok(_hexToHslPure(asGrid).l > _hexToHslPure('#20203e').l * 2.4);
    assert.ok(Math.abs(_hexToHslPure(asBg).l - _hexToHslPure('#20203e').l) < 0.02);
});

t('intensity 0 desaturates to gray; hue rotates', () => {
    const gray = _adjustHexPure('#3040c0', { ...DEF, intensity: 0 }, false);
    assert.strictEqual(_hexToHslPure(gray).s, 0);
    const rot = _adjustHexPure('#3040c0', { ...DEF, hue: 120 }, false);
    const dh = Math.abs((((_hexToHslPure(rot).h - _hexToHslPure('#3040c0').h) % 360) + 360) % 360 - 120);
    assert.ok(dh < 4, 'hue rotated ~120°, drift ' + dh);
});

t('lightness never clips to pure white; junk hex passes through', () => {
    const blown = _adjustHexPure('#aaaacc', { ...DEF, brightness: 250, grid: 400 }, true);
    assert.ok(_hexToHslPure(blown).l <= 0.92 + 1 / 255);
    assert.strictEqual(_adjustHexPure('junk', DEF, false), 'junk');
});

// ── the palette accessor + live settings ─────────────────────────────

t('CP: defaults are identity-ish; unknown name is safe', () => {
    resetCanvasAppearance();
    const beat = CP('gridBeat');
    const a = _hexToHslPure('#20203e'), b = _hexToHslPure(beat);
    assert.ok(Math.abs(a.l - b.l) < 0.02);
    assert.strictEqual(CP('definitely-not-a-color'), '#000000');
});

t('CP: setting a field invalidates the cache and changes grid entries only', () => {
    resetCanvasAppearance();
    const beatBefore = CP('gridBeat');
    const laneBefore = CP('laneEven');
    setCanvasAppearance('grid', 300);
    const beatAfter = CP('gridBeat');
    const laneAfter = CP('laneEven');
    assert.notStrictEqual(beatBefore, beatAfter);
    assert.strictEqual(laneBefore, laneAfter);   // backgrounds untouched by grid slider
    resetCanvasAppearance();
    assert.strictEqual(CP('gridBeat'), beatBefore);
});

t('settings round-trip through the accessor, clamped', () => {
    resetCanvasAppearance();
    setCanvasAppearance('hue', 999);
    assert.strictEqual(canvasAppearance().hue, 180);
    setCanvasAppearance('brightness', 'garbage');   // junk → default, no throw
    assert.strictEqual(canvasAppearance().brightness, 100);
    resetCanvasAppearance();
    assert.deepStrictEqual(canvasAppearance(), { ...CANVAS_APPEARANCE_DEFAULTS });
});

// ── the community fix: default beat lines must actually be visible ───

t('default gridBeat is brighter than the old invisible constant', () => {
    resetCanvasAppearance();
    const oldL = _hexToHslPure('#16162c').l;
    const newL = _hexToHslPure(CP('gridBeat')).l;
    assert.ok(newL > oldL * 1.3,
        `default beat line (${CP('gridBeat')}) should be clearly brighter than #16162c`);
    // And the measure line stays visually ABOVE the beat line (hierarchy).
    assert.ok(_hexToHslPure(CP('gridMeasure')).l > newL);
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
