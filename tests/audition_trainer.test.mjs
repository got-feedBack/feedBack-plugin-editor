/*
 * Audition trainer (P2-10) — loop-and-step-up + grid-locked click subdivision.
 *
 * Pinned here:
 *   - the step-up scheduler counts completed passes and advances the rate one
 *     ladder step after N passes, clamping at 1.0 (stepTo goes null at the top
 *     and stays null);
 *   - the metronome subdivision selector returns 8ths/16ths as the rate drops;
 *   - subdivision click TIMES are a pure function of S.beats — locked to the
 *     grid (they follow each measure's own spacing) and independent of the
 *     audition rate, which is not even an input;
 *   - arming the trainer refuses without an enabled loop region, and arms at
 *     the ladder's slowest step from full speed.
 *
 * Every case fails on pre-fix main (the pures don't exist there).
 * Run: node tests/audition_trainer.test.mjs
 */
import assert from 'node:assert';

globalThis.document = globalThis.document || {
    getElementById: () => null, addEventListener: () => {}, activeElement: null,
    createElement: () => ({ style: {}, classList: { toggle: () => {}, add: () => {}, remove: () => {} }, setAttribute: () => {} }),
};
globalThis.localStorage = globalThis.localStorage || { getItem: () => null, setItem: () => {} };
globalThis.window = globalThis.window || globalThis;

const {
    TRAINER_LADDER, _trainerNextRatePure, _trainerOnWrapPure,
    _metroSubdivForRatePure, _metroSubdivClicksPure,
    _trainerActive, editorToggleAuditionTrainer, editorAuditionRate,
} = await import('../src/audio.js');
const { S } = await import('../src/state.js');

let pass = 0, fail = 0;
function t(name, fn) {
    try { fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}

// ── the step-up scheduler ────────────────────────────────────────────

t('the ladder climbs 50 → 75 → 100 and tops out at null', () => {
    assert.strictEqual(_trainerNextRatePure(TRAINER_LADDER, 0.5), 0.75);
    assert.strictEqual(_trainerNextRatePure(TRAINER_LADDER, 0.75), 1);
    assert.strictEqual(_trainerNextRatePure(TRAINER_LADDER, 1), null, 'clamped at 1.0');
    assert.strictEqual(_trainerNextRatePure(TRAINER_LADDER, 0.6), 0.75,
        'a hand-picked off-ladder rate climbs to the nearest step above');
});

t('a step is earned only after N completed passes, and the counter resets', () => {
    let st = { passes: 0 };
    st = _trainerOnWrapPure(st.passes, 3, 0.5, TRAINER_LADDER);
    assert.deepStrictEqual(st, { passes: 1, stepTo: null });
    st = _trainerOnWrapPure(st.passes, 3, 0.5, TRAINER_LADDER);
    assert.deepStrictEqual(st, { passes: 2, stepTo: null });
    st = _trainerOnWrapPure(st.passes, 3, 0.5, TRAINER_LADDER);
    assert.deepStrictEqual(st, { passes: 0, stepTo: 0.75 }, 'third pass earns the step');
});

t('at the top of the ladder the scheduler proposes nothing, forever', () => {
    const st = _trainerOnWrapPure(2, 3, 1, TRAINER_LADDER);
    assert.strictEqual(st.stepTo, null, 'no step past 100%');
    assert.strictEqual(st.passes, 0, 'the counter still cycles');
});

// ── the click subdivision ────────────────────────────────────────────

t('the subdivision selector: quarters at speed, 8ths slowed, 16ths at half', () => {
    assert.strictEqual(_metroSubdivForRatePure(1), 1);
    assert.strictEqual(_metroSubdivForRatePure(0.95), 1);
    assert.strictEqual(_metroSubdivForRatePure(0.75), 2);
    assert.strictEqual(_metroSubdivForRatePure(0.5), 4);
    assert.strictEqual(_metroSubdivForRatePure(0.55), 4);
});

t('subdivision clicks bisect each beat span exactly, beats themselves excluded', () => {
    // 120 BPM: beats each 0.5s. 8ths (div 2) → one click at every beat + 0.25.
    const beats = [0, 0.5, 1.0, 1.5, 2.0].map((time, i) => ({ time, measure: i === 0 ? 1 : 0 }));
    const clicks = _metroSubdivClicksPure(beats, 0, 2.0, 2);
    assert.deepStrictEqual(clicks.map(c => c.t), [0.25, 0.75, 1.25, 1.75]);
    const sixteenths = _metroSubdivClicksPure(beats, 0, 0.5, 4);
    assert.deepStrictEqual(sixteenths.map(c => c.t), [0.125, 0.25, 0.375]);
});

t('subdivision times are a pure function of the GRID — an uneven bar subdivides unevenly with it', () => {
    // A rubato grid: the second beat span is twice the first. The click must
    // follow the grid's own spacing (grid-locked), never an averaged tempo —
    // and the audition rate is not even an input to the function.
    const beats = [{ time: 0, measure: 1 }, { time: 0.4, measure: 0 }, { time: 1.2, measure: 0 }];
    const clicks = _metroSubdivClicksPure(beats, 0, 1.2, 2);
    assert.deepStrictEqual(clicks.map(c => c.t), [0.2, 0.8],
        'each span bisects at ITS midpoint');
});

t('a window clips subdivision clicks like every other scheduled voice', () => {
    const beats = [0, 0.5, 1.0].map((time, i) => ({ time, measure: i === 0 ? 1 : 0 }));
    assert.deepStrictEqual(_metroSubdivClicksPure(beats, 0.3, 0.8, 2).map(c => c.t), [0.75]);
    assert.deepStrictEqual(_metroSubdivClicksPure(beats, 0, 1, 1), [], 'div 1 = no extra clicks');
});

// ── arming ───────────────────────────────────────────────────────────

t('arming refuses without an enabled loop; arms at the slowest step from full speed', () => {
    Object.assign(S, { barSel: null, loopEnabled: false, duration: 60, auditionRate: 1, audioUrl: null, audioBuffer: null });
    editorToggleAuditionTrainer();
    assert.strictEqual(_trainerActive(), false, 'no loop region → refused');
    Object.assign(S, { barSel: { startTime: 4, endTime: 8 }, loopEnabled: true });
    editorToggleAuditionTrainer();
    assert.strictEqual(_trainerActive(), true, 'loop present → armed');
    assert.strictEqual(editorAuditionRate(), 0.5, 'starts the ladder at its slowest step');
    editorToggleAuditionTrainer();
    assert.strictEqual(_trainerActive(), false, 'toggle disarms');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
