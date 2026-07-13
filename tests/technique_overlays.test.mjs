/*
 * Graphical technique overlays — draw the actual bend curve / slide / vibrato /
 * tie on the chart instead of only a text badge. The technique DATA (bend_values,
 * slide_to, vibrato, link_next) always existed; this renders it. Geometry is in
 * pure functions so it's testable without a canvas:
 *   1. _bendCurvePointsPure — bend_values → screen points rising by semitones.
 *   2. _slideDirPure — up / down / none.
 *   3. _vibratoPointsPure — a squiggle spanning the note width.
 *
 * Run: node tests/technique_overlays.test.mjs
 */
import assert from 'node:assert';
import { _bendCurvePointsPure, _slideDirPure, _vibratoPointsPure } from '../src/draw.js';

let pass = 0, fail = 0;
function t(name, fn) {
    try { fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}
const near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

// ── 1. _bendCurvePointsPure ──────────────────────────────────────────────────
t('maps t across the width and v upward to `rise` at the max semitone', () => {
    const cp = _bendCurvePointsPure([{ t: 0, v: 0 }, { t: 1, v: 2 }], 100, 50, 200, 30);
    assert.strictEqual(cp.length, 2);
    assert.ok(near(cp[0].x, 100) && near(cp[0].y, 200), 'start at baseline');
    assert.ok(near(cp[1].x, 150) && near(cp[1].y, 170), 'peak rises the full `rise`');
});
t('a mid bend point rises proportionally to the max', () => {
    const cp = _bendCurvePointsPure([{ t: 0, v: 0 }, { t: 0.5, v: 1 }, { t: 1, v: 2 }], 0, 40, 100, 20);
    assert.ok(near(cp[1].x, 20) && near(cp[1].y, 90), 'half-max → half the rise');
});
t('clamps t to [0,1] and refuses fewer than two points', () => {
    const cp = _bendCurvePointsPure([{ t: -1, v: 0 }, { t: 5, v: 1 }], 10, 100, 50, 10);
    assert.ok(near(cp[0].x, 10) && near(cp[1].x, 110), 'clamped to the note span');
    assert.deepStrictEqual(_bendCurvePointsPure([{ t: 0, v: 1 }], 0, 10, 0, 5), []);
    assert.deepStrictEqual(_bendCurvePointsPure(null, 0, 10, 0, 5), []);
});

// ── 2. _slideDirPure ─────────────────────────────────────────────────────────
t('_slideDirPure is +1 up / -1 down / 0 none', () => {
    assert.strictEqual(_slideDirPure(5, 7), 1);
    assert.strictEqual(_slideDirPure(7, 5), -1);
    assert.strictEqual(_slideDirPure(5, 5), 0);
    assert.strictEqual(_slideDirPure(5, -1), 0);       // no slide target
    assert.strictEqual(_slideDirPure(5, undefined), 0);
});

// ── 3. _vibratoPointsPure ────────────────────────────────────────────────────
t('_vibratoPointsPure spans the width, oscillates within amp, min 2 cycles', () => {
    const vp = _vibratoPointsPure(10, 60, 40, 3, 8);
    assert.ok(vp.length > 4, 'has points');
    assert.ok(near(vp[0].x, 10) && near(vp[vp.length - 1].x, 70), 'spans [x0, x0+w]');
    assert.ok(vp.every(p => Math.abs(p.y - 40) <= 3 + 1e-9), 'stays within amplitude of yMid');
    assert.deepStrictEqual(_vibratoPointsPure(5, 0, 0, 2, 8), [], 'zero width → no squiggle');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
