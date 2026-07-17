/*
 * Map-health worklist (src/map-health.js _mapHealthProblemsPure /
 * _mapHealthStepProblemPure): the H / Shift+H triage loop over drifting bars.
 *
 * Pinned: only amber/red measures are problems (green/grey never cry wolf);
 * the list is song-ordered regardless of input order; stepping from the
 * playhead skips the bar you are standing on (goto seeks to the bar's own
 * startTime) and wraps at both ends so repeated presses cycle the worklist.
 *
 * Run: node tests/map_health_worklist.test.mjs
 */
import assert from 'node:assert';

const { _mapHealthProblemsPure, _mapHealthStepProblemPure } =
    await import('../src/map-health.js');

let pass = 0, fail = 0;
function t(name, fn) {
    try { fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}

const M = (measure, startTime, band, driftFrac = 0.2) => ({ measure, startTime, band, driftFrac });
const result = {
    measures: [
        M(1, 0, 'green'),
        M(7, 24, 'amber'),      // deliberately out of order vs measure 3
        M(3, 8, 'red'),
        M(5, 16, 'grey'),
        M(9, 32, 'green'),
    ],
};

t('problems are amber/red only, in song order', () => {
    const p = _mapHealthProblemsPure(result);
    assert.deepStrictEqual(p.map(m => m.measure), [3, 7], 'green/grey excluded; sorted by startTime');
});

t('stepping forward from the playhead finds the next problem and wraps', () => {
    const p = _mapHealthProblemsPure(result);
    assert.strictEqual(_mapHealthStepProblemPure(p, 0, 1).measure, 3, 'from song start');
    assert.strictEqual(_mapHealthStepProblemPure(p, 8, 1).measure, 7,
        'standing ON bar 3 (goto landed here) → next, not itself');
    assert.strictEqual(_mapHealthStepProblemPure(p, 24, 1).measure, 3, 'past the last → wraps to first');
});

t('stepping backward mirrors, with the same self-skip and wrap', () => {
    const p = _mapHealthProblemsPure(result);
    assert.strictEqual(_mapHealthStepProblemPure(p, 24, -1).measure, 3, 'standing on bar 7 → previous');
    assert.strictEqual(_mapHealthStepProblemPure(p, 8, -1).measure, 7, 'before the first → wraps to last');
    assert.strictEqual(_mapHealthStepProblemPure(p, 100, -1).measure, 7);
});

t('degenerate inputs stay quiet', () => {
    assert.strictEqual(_mapHealthStepProblemPure([], 0, 1), null);
    assert.strictEqual(_mapHealthStepProblemPure(null, 0, 1), null);
    assert.deepStrictEqual(_mapHealthProblemsPure(null), []);
    assert.deepStrictEqual(_mapHealthProblemsPure({}), []);
    const p = _mapHealthProblemsPure(result);
    assert.strictEqual(_mapHealthStepProblemPure(p, NaN, 1).measure, 3, 'NaN playhead → treated as song start');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
