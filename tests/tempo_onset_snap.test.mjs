/*
 * Light onset-snap on a dragged tempo-map barline (tempo track PR 11).
 *
 * When Snap = Onset, dragging a barline pole gently pulls to the nearest detected
 * audio attack within a few pixels — the manual complement to Suggest-fit's
 * automatic pass — so downbeats land on real hits. Locked poles never snap, and
 * away from an attack the drag stays a normal continuous grid drag. This suite
 * proves the two pures and guards the drag-handler wiring:
 *   1. _tempoOnsetSnapTolPure — pixel-based window, capped in seconds, NaN-safe.
 *   2. _tempoOnsetSnapPure — snaps within tol, re-clamps into the neighbour
 *      bounds, and leaves the raw time alone when nothing is close.
 *   3. Source guards (fail-on-main): the drag move gates on Snap = Onset + a
 *      non-locked pole; drag end reports the snap.
 *
 * Run: node tests/tempo_onset_snap.test.mjs
 */
import assert from 'node:assert';
import fs from 'node:fs';
import { _tempoOnsetSnapPure, _tempoOnsetSnapTolPure } from '../src/tempo.js';

let pass = 0, fail = 0;
function t(name, fn) {
    try { fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}
const near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;
const onsets = (...ts) => ts.map(t => ({ t }));

// ── 1. _tempoOnsetSnapTolPure ────────────────────────────────────────────────
t('_tempoOnsetSnapTolPure is the pixel window when zoomed in', () => {
    // 0.002 s/px × 6 px = 0.012 s, under the 0.05 cap.
    assert.ok(near(_tempoOnsetSnapTolPure(0.002, 6, 0.05), 0.012));
});
t('_tempoOnsetSnapTolPure caps in seconds when zoomed out', () => {
    // 0.05 s/px × 6 px = 0.30 s → capped to 0.05.
    assert.ok(near(_tempoOnsetSnapTolPure(0.05, 6, 0.05), 0.05));
});
t('_tempoOnsetSnapTolPure collapses to 0 on bad input (never NaN)', () => {
    assert.strictEqual(_tempoOnsetSnapTolPure(-1, 6, 0.05), 0);
    assert.strictEqual(_tempoOnsetSnapTolPure(NaN, 6, 0.05), 0);
    assert.strictEqual(_tempoOnsetSnapTolPure(0.01, 0, 0.05), 0);
});

// ── 2. _tempoOnsetSnapPure ───────────────────────────────────────────────────
t('_tempoOnsetSnapPure pulls to the nearest onset within tol', () => {
    const r = _tempoOnsetSnapPure(4.03, onsets(1, 4.0, 7), 0.05, 0, 10);
    assert.ok(r.snapped && near(r.t, 4.0), 'snapped to the 4.0s attack');
});
t('_tempoOnsetSnapPure leaves the raw time alone when nothing is close', () => {
    const r = _tempoOnsetSnapPure(4.5, onsets(1, 4.0, 7), 0.05, 0, 10);
    assert.ok(!r.snapped && near(r.t, 4.5), 'no attack within tol → raw drag time');
});
t('_tempoOnsetSnapPure re-clamps a snap into the neighbour bounds', () => {
    // Nearest onset 4.9 is within tol of 4.75, but hiBound is 4.8 → clamp.
    const r = _tempoOnsetSnapPure(4.75, onsets(4.9), 0.2, 0, 4.8);
    assert.ok(r.snapped && near(r.t, 4.8), 'snapped time cannot cross the next downbeat');
});
t('_tempoOnsetSnapPure is a no-op with no onsets / no window', () => {
    assert.deepStrictEqual(_tempoOnsetSnapPure(3.0, [], 0.05, 0, 10), { t: 3.0, snapped: false });
    assert.deepStrictEqual(_tempoOnsetSnapPure(3.0, null, 0.05, 0, 10), { t: 3.0, snapped: false });
    assert.deepStrictEqual(_tempoOnsetSnapPure(3.0, onsets(3.0), 0, 0, 10), { t: 3.0, snapped: false });
});

// ── 3. Source guards (fail-on-main) ──────────────────────────────────────────
const src = fs.readFileSync(new URL('../src/tempo.js', import.meta.url), 'utf8');
function body(header, end) {
    const s = src.indexOf(header);
    assert.ok(s >= 0, `"${header}" must exist`);
    return src.slice(s, end ? src.indexOf(end, s) : s + 1400);
}
t('the drag move gates onset-snap on Snap = Onset and a non-locked pole', () => {
    const b = body('export function _tempoMapOnDragMove', 'export function _tempoMapOnDragEnd');
    assert.match(b, /S\.snapMode === 'onset'/, 'only snaps in Onset mode');
    assert.match(b, /!\(orig\[d\] && orig\[d\]\.locked\)/, 'locked poles never snap');
    assert.match(b, /_tempoOnsetSnapPure\(rawT, _ensureOnsetsShifted\(\)/,
        'snaps against CHART-time onsets (shift-corrected), matching Suggest-fit — issue #254');
});
t('the drag end reports a snap', () => {
    const b = body('export function _tempoMapOnDragEnd', 'export function _makeTimeRemap');
    assert.match(b, /dg\.snappedT != null/, 'status only when a snap actually landed');
    assert.match(b, /snapped to a detected attack/, 'names the snap for the user');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
