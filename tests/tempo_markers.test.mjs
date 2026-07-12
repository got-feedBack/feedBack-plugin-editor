/*
 * Derived tempo/meter change markers (PR 10) — the pure derivation.
 *
 * Markers are DERIVED from S.beats (zero storage): a tempo marker where the
 * per-measure BPM leaves the current run beyond 0.01; a meter marker where the
 * numerator/den changes; bar 1 gets a baseline of each; a trailing partial bar
 * never emits a spurious meter change.
 *
 * Run: node tests/tempo_markers.test.mjs
 */
import assert from 'node:assert';
import { _tempoMarkersPure } from '../src/tempo.js';

let pass = 0, fail = 0;
function t(name, fn) {
    try { fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}
// [time, measure, den?] → beats
const g = (...rows) => rows.map(([time, measure, den]) => (den ? { time, measure, den } : { time, measure }));
const kinds = (mk) => mk.map(m => `${m.kind}:${m.label}@${m.time}`);

t('constant tempo + meter → only the bar-1 baseline (tempo + meter)', () => {
    const beats = g([0, 1], [1, -1], [2, -1], [3, -1], [4, 2], [5, -1], [6, -1], [7, -1]);
    const mk = _tempoMarkersPure(beats, 0.01);
    assert.deepStrictEqual(kinds(mk), ['tempo:60 BPM@0', 'meter:4/4@0']);
});

t('a tempo change emits a tempo marker at that downbeat only', () => {
    // m1 = 60 BPM (1s beats), m2 = 120 BPM (0.5s beats), closed by an m3 downbeat
    // so m2's BPM is computable (the last/open measure reuses the run instead).
    const beats = g([0, 1], [1, -1], [2, -1], [3, -1], [4, 2], [4.5, -1], [5, -1], [5.5, -1], [6, 3]);
    const mk = _tempoMarkersPure(beats, 0.01);
    assert.deepStrictEqual(kinds(mk), ['tempo:60 BPM@0', 'meter:4/4@0', 'tempo:120 BPM@4']);
});

t('a within-tolerance drift does NOT emit a new tempo marker (run behaviour)', () => {
    // m2 spans 4.001s → ~59.985 BPM, inside 0.01 of 60? No — but test the run:
    // make m2 exactly 60.005 BPM (within 0.01 tol → no marker).
    const span = (4 * 60) / 60.005;   // m2 duration for 60.005 BPM
    const beats = g([0, 1], [1, -1], [2, -1], [3, -1], [4, 2], [4 + span / 4, -1], [4 + span / 2, -1], [4 + 3 * span / 4, -1]);
    const mk = _tempoMarkersPure(beats, 0.01);
    assert.deepStrictEqual(mk.filter(m => m.kind === 'tempo').length, 1, 'only the baseline tempo');
});

t('a meter change (mid-song) emits a meter marker; the last partial bar does not', () => {
    // m1 4/4, m2 3/4, m3 back to 4 beats. Downbeats at 0, 4, 7.
    const beats = g([0, 1], [1, -1], [2, -1], [3, -1], [4, 2], [5, -1], [6, -1], [7, 3], [8, -1], [9, -1], [10, -1]);
    const mk = _tempoMarkersPure(beats, 0.01).filter(m => m.kind === 'meter');
    assert.deepStrictEqual(kinds(mk), ['meter:4/4@0', 'meter:3/4@4', 'meter:4/4@7']);
});

t('a denominator change emits a meter marker even at the same numerator', () => {
    const beats = g([0, 1, 4], [1, -1], [2, -1], [3, -1], [4, 2, 8], [5, -1], [6, -1], [8, 3, 8], [9, -1], [10, -1], [11, -1]);
    const mk = _tempoMarkersPure(beats, 0.01).filter(m => m.kind === 'meter').map(m => m.label);
    assert.ok(mk.includes('4/4') && mk.includes('3/8'), 'den change surfaces: ' + mk.join(','));
});

t('degenerate inputs are safe', () => {
    assert.deepStrictEqual(_tempoMarkersPure([], 0.01), []);
    assert.deepStrictEqual(_tempoMarkersPure(null, 0.01), []);
    assert.deepStrictEqual(_tempoMarkersPure(g([0, -1], [1, -1]), 0.01), [], 'no downbeats → no markers');
});

t('is pure — never mutates the input beats', () => {
    const beats = g([0, 1], [1, -1], [2, -1], [3, -1], [4, 2], [5, -1], [6, -1], [7, -1]);
    const snapshot = JSON.stringify(beats);
    _tempoMarkersPure(beats, 0.01);
    assert.strictEqual(JSON.stringify(beats), snapshot, 'no marker fields smuggled into beats');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
