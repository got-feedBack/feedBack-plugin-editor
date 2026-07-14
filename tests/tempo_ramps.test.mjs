/*
 * Authored tempo ramps (P2-7): ONE accel/rit object compiles the span's
 * beat times along a curve — never N shrinking bars painted as noisy chips.
 *
 * Pinned here:
 *   - an accel's compiled beat gaps shorten monotonically; ease-out ≠ linear;
 *   - the span START stays anchored, the tail SHIFTS by the length delta;
 *   - the marker lane emits ONE ramp chip (derived chips suppressed across
 *     the span, and the settled tempo after it emits nothing);
 *   - a locked anchor inside the span holds its time (locks win);
 *   - the ramp command round-trips exec → rollback → redo, marks + beats;
 *   - fit-from-drift on a synthesized rit proposes a falling ramp whose
 *     residual beats the flat reading;
 *   - the Tempo List rows render every authored kind.
 *
 * Fails on main (the ramp kind doesn't exist there).
 * Run: node tests/tempo_ramps.test.mjs
 */
import assert from 'node:assert';

globalThis.document = globalThis.document || {
    getElementById: () => null, addEventListener: () => {}, activeElement: null,
};
globalThis.localStorage = globalThis.localStorage || { getItem: () => null, setItem: () => {} };
globalThis.window = globalThis.window || globalThis;

const {
    TempoMapCmd, _rampCompilePure, _rampCurveValPure, _rampFitFromDriftPure,
    _respaceWithLocksPure, _tempoMarkersPure,
} = await import('../src/tempo.js');
const { _markNormPure, _marksUpsertPure } = await import('../src/tempo-marks.js');
const { _tempoListRowsPure } = await import('../src/tempo-list.js');
const { S } = await import('../src/state.js');
const { EditHistory } = await import('../src/history.js');

let pass = 0, fail = 0;
function t(name, fn) {
    try { fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}

// A steady 120 BPM 4/4 grid over `bars` bars (0.5 s beats).
function grid(bars) {
    const beats = [];
    for (let m = 1; m <= bars; m++) for (let b = 0; b < 4; b++) {
        beats.push({ time: ((m - 1) * 4 + b) * 0.5, measure: b === 0 ? m : -1 });
    }
    beats.push({ time: bars * 4 * 0.5, measure: bars + 1 });
    return beats;
}
const RAMP = (over = {}) => _markNormPure({
    measure: 2, kind: 'ramp', measureEnd: 4, bpmStart: 120, bpmEnd: 240, curve: 'linear', ...over,
});

t('ramp marks validate: span and tempi hard-edged, curve degrades to linear', () => {
    assert.ok(RAMP());
    assert.strictEqual(RAMP().curve, 'linear');
    assert.strictEqual(_markNormPure({ measure: 4, kind: 'ramp', measureEnd: 4, bpmStart: 120, bpmEnd: 240 }), null, 'empty span');
    assert.strictEqual(_markNormPure({ measure: 4, kind: 'ramp', measureEnd: 8, bpmStart: 0, bpmEnd: 240 }), null, 'bad bpm');
    assert.strictEqual(_markNormPure({ measure: 4, kind: 'ramp', measureEnd: 8, bpmStart: 120, bpmEnd: 240, curve: 'wiggly' }).curve, 'linear');
});

t('an accel compiles monotonically shortening beat gaps; the start stays anchored', () => {
    const beats = grid(6);
    const out = _rampCompilePure(beats, RAMP());
    assert.ok(out, 'compiles');
    const sIdx = beats.findIndex(b => b.measure === 2);
    const eIdx = beats.findIndex(b => b.measure === 4);
    assert.strictEqual(out[sIdx].time, beats[sIdx].time, 'span start anchored');
    const gaps = [];
    for (let i = sIdx; i < eIdx; i++) gaps.push(out[i + 1].time - out[i].time);
    for (let i = 1; i < gaps.length; i++) {
        assert.ok(gaps[i] < gaps[i - 1] - 1e-9, `gap ${i} shortens (${gaps[i - 1]} → ${gaps[i]})`);
    }
    assert.ok(gaps[0] < 0.5 && gaps[0] > 60 / 240 / 1,
        'first gap between the endpoints’ beat lengths');
    // The tail SHIFTS as a block: post-span bar lengths are unchanged.
    const tail0 = beats.findIndex(b => b.measure === 5);
    assert.ok(Math.abs((out[tail0 + 1].time - out[tail0].time) - 0.5) < 1e-9, 'tail spacing preserved');
    assert.ok(out[tail0].time < beats[tail0].time, 'accel shortens the span → tail moves earlier');
});

t('ease-out compiles differently from linear (front-loaded change)', () => {
    const beats = grid(6);
    const lin = _rampCompilePure(beats, RAMP());
    const eo = _rampCompilePure(beats, RAMP({ curve: 'ease-out' }));
    const sIdx = beats.findIndex(b => b.measure === 2);
    assert.notStrictEqual(lin[sIdx + 1].time, eo[sIdx + 1].time, 'first compiled beat differs');
    assert.ok(eo[sIdx + 1].time < lin[sIdx + 1].time,
        'ease-out reaches the faster tempo sooner → earlier first beat');
    assert.ok(Math.abs(_rampCurveValPure('ease-out', 0.5) - 0.75) < 1e-9);
    assert.ok(Math.abs(_rampCurveValPure('ease-in', 0.5) - 0.25) < 1e-9);
});

t('the marker lane emits ONE ramp chip — derived chips silent across the span and after', () => {
    const beats = _rampCompilePure(grid(6), RAMP());
    const marks = [RAMP()];
    const chips = _tempoMarkersPure(beats, 0.01, marks);
    const rampChips = chips.filter(c => c.kind === 'ramp');
    assert.strictEqual(rampChips.length, 1);
    assert.strictEqual(rampChips[0].label, 'accel. 120→240');
    const tempoChips = chips.filter(c => c.kind === 'tempo');
    assert.ok(!tempoChips.some(c => c.measure >= 2 && c.measure < 4),
        'NO derived chips inside the span — the smooth drift is the point');
    // The fixture's tail returns to 120, a REAL tempo step at the span end —
    // that chip is honest and stays (a ramp records the gesture, not what
    // follows it).
    assert.deepStrictEqual(tempoChips.map(c => c.measure), [1, 4]);
    // Without the mark, the same compiled grid sprays derived chips.
    const derived = _tempoMarkersPure(beats, 0.01).filter(c => c.kind === 'tempo');
    assert.ok(derived.length >= 3, 'unmarked compiled ramp reads as many tempo changes');
});

t('locks win: a locked anchor inside the span holds its exact time', () => {
    const beats = grid(6);
    const lockIdx = beats.findIndex(b => b.measure === 3);
    beats[lockIdx].locked = true;
    const compiled = _rampCompilePure(beats, RAMP());
    const final = _respaceWithLocksPure(beats, compiled);
    assert.strictEqual(final[lockIdx].time, beats[lockIdx].time, 'the locked downbeat did not move');
    assert.notStrictEqual(compiled[lockIdx].time, beats[lockIdx].time,
        'the raw compile WOULD have moved it — the lock pass is load-bearing');
});

t('the ramp command round-trips: marks + beats together, exact undo', () => {
    const beats = grid(6);
    Object.assign(S, {
        beats, tempoMarks: [], history: new EditHistory(),
        arrangements: [{ name: 'Lead', notes: [] }], currentArr: 0, sel: new Set(),
    });
    const mark = RAMP();
    const compiled = _rampCompilePure(S.beats, mark);
    const timesBefore = JSON.stringify(S.beats.map(b => b.time));
    const cmd = new TempoMapCmd(S.beats, compiled, 'accelerando');
    cmd.marks = { before: S.tempoMarks, after: _marksUpsertPure(S.tempoMarks, mark) };
    S.history.exec(cmd);
    assert.strictEqual(S.tempoMarks.length, 1, 'mark landed with the grid');
    assert.notStrictEqual(JSON.stringify(S.beats.map(b => b.time)), timesBefore, 'grid moved');
    S.history.doUndo();
    assert.strictEqual(S.tempoMarks.length, 0, 'undo restores marks with the grid');
    assert.strictEqual(JSON.stringify(S.beats.map(b => b.time)), timesBefore, 'grid restored exactly');
    S.history.doRedo();
    assert.strictEqual(S.tempoMarks.length, 1, 'redo reproduces both');
});

t('fit-from-drift on a synthesized rit proposes a falling ramp that beats flat', () => {
    // The GRID says steady 120, but the band ritards: onsets at downbeats of
    // a 120→90 linear slowdown.
    const beats = grid(9);
    const onsetTimes = [];
    let tOn = beats.find(b => b.measure === 2).time;
    for (let k = 0; k <= 6; k++) {
        onsetTimes.push(tOn);
        const bpm = 120 + (90 - 120) * (k / 6);
        tOn += (4 * 60) / bpm;
    }
    const sIdx = beats.findIndex(b => b.measure === 2);
    const eIdx = beats.findIndex(b => b.measure === 8);
    const fit = _rampFitFromDriftPure(beats, onsetTimes, sIdx, eIdx, 2.5);
    assert.ok(fit, 'a fit is proposed');
    assert.ok(fit.bpmStart > fit.bpmEnd, `falling ramp (${fit.bpmStart} → ${fit.bpmEnd})`);
    assert.ok(fit.residual < fit.flatResidual, 'the ramp explains the drift better than flat');
});

t('the Tempo List renders one honest row per authored kind', () => {
    const rows = _tempoListRowsPure([
        { measure: 2, kind: 'ramp', measureEnd: 4, bpmStart: 140, bpmEnd: 120, curve: 'ease-out', provenance: 'confirmed' },
        { measure: 5, kind: 'meter', num: 7, den: 8, grouping: [2, 2, 3] },
        { measure: 7, kind: 'hold', factor: 2, provenance: 'imported' },
        { measure: 9, kind: 'feel', ratio: 0.5, provenance: 'detected' },
    ]);
    assert.deepStrictEqual(rows.map(r => r.type), ['rit.', 'meter', 'hold', 'feel']);
    assert.strictEqual(rows[0].value, '140→120 (bars 2–4, ease-out)');
    assert.strictEqual(rows[1].value, '7/8 (2+2+3)');
    assert.strictEqual(rows[2].source, 'imported');
    assert.strictEqual(rows[3].value, '½-time');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
