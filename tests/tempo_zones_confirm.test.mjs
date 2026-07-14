/*
 * Tempo-zone confirm bar (P2-3 completion) — the adjust verbs, the bounded
 * per-segment refine, and the stretch clamp that makes the segment BPM a real
 * prior on the suggest march.
 *
 * Pinned here:
 *   - every adjust verb is pure and clamped (boundary drag keeps a minimum
 *     span and drops stale phase seeds; split interpolates a ramp's tempo at
 *     the cut; merge describes the join by its own endpoints; kind cycles
 *     round-trip; BPM edits refuse degenerate values; single-tempo collapses
 *     to the duration-weighted median);
 *   - _suggestFitPure's new opts.stretchClamp bounds the drift tracker, so a
 *     miss-path march can drift at most ±clamp per bar off the grid tempo
 *     (the structural cure for the runaway march);
 *   - _segmentRefineGridPure snaps each zone's barlines to the recording
 *     INSIDE the zone only — anchors hold, other zones' beats are untouched,
 *     unmapped zones refine nothing.
 *
 * Every behavioral case fails on pre-fix main (the verbs and the opt don't
 * exist there). Run: node tests/tempo_zones_confirm.test.mjs
 */
import assert from 'node:assert';

globalThis.document = globalThis.document || {
    getElementById: () => null, addEventListener: () => {}, activeElement: null,
};
globalThis.localStorage = globalThis.localStorage || { getItem: () => null, setItem: () => {} };
globalThis.window = globalThis.window || globalThis;

const {
    _segmentBoundaryDragPure, _segmentCycleKindPure, _segmentMergePure,
    _segmentRefineGridPure, _segmentSetBpmPure, _segmentSingleTempoPure,
    _segmentSplitPure,
} = await import('../src/tempo-segment.js');
const { _suggestFitPure } = await import('../src/tempo-suggest.js');

let pass = 0, fail = 0;
function t(name, fn) {
    try { fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}

const seg = (tStart, tEnd, kind, bpmStart, bpmEnd = bpmStart, extra = {}) =>
    ({ tStart, tEnd, kind, bpmStart, bpmEnd, conf: 0.8, ...extra });

// A 4/4 grid at `bpm`: `bars` downbeats + 3 interior beats each.
function grid(bars, bpm, start = 0, firstMeasure = 1) {
    const beat = 60 / bpm;
    const beats = [];
    for (let m = 0; m < bars; m++) {
        for (let b = 0; b < 4; b++) {
            beats.push({ time: start + (m * 4 + b) * beat, measure: b === 0 ? firstMeasure + m : 0 });
        }
    }
    return beats;
}
// Onsets on every beat of a real tempo (comb-corroborated pulse).
function onsetsAllBeats(bpm, bars, start = 0) {
    const beat = 60 / bpm;
    const out = [];
    for (let k = 0; k < bars * 4; k++) out.push({ t: start + k * beat, s: k % 4 === 0 ? 0.9 : 0.75 });
    return out;
}

// ── adjust verbs ─────────────────────────────────────────────────────

t('boundary drag moves the join, clamps to a minimum span, drops stale seeds', () => {
    const segs = [seg(0, 20, 'constant', 120, 120, { downbeatTime: 1.2 }),
        seg(20, 40, 'constant', 140, 140, { downbeatTime: 20.6 })];
    const moved = _segmentBoundaryDragPure(segs, 0, 26);
    assert.strictEqual(moved[0].tEnd, 26);
    assert.strictEqual(moved[1].tStart, 26);
    assert.strictEqual(moved[0].downbeatTime, 1.2, 'left seed still inside — kept');
    assert.ok(!('downbeatTime' in moved[1]), 'right seed now stale — dropped for re-seed');
    assert.strictEqual(segs[0].tEnd, 20, 'input never mutated');
    // Clamp: can't leave the right zone shorter than the minimum.
    const clamped = _segmentBoundaryDragPure(segs, 0, 39.5);
    assert.strictEqual(clamped[0].tEnd, 38, 'clamped to right.tEnd - minLen');
    assert.strictEqual(_segmentBoundaryDragPure(segs, 3, 10), null, 'no such boundary');
});

t('split: a constant splits at the same tempo; a ramp interpolates at the cut', () => {
    const c = _segmentSplitPure([seg(0, 20, 'constant', 120)], 0, 8);
    assert.strictEqual(c.length, 2);
    assert.deepStrictEqual([c[0].tStart, c[0].tEnd, c[1].tStart, c[1].tEnd], [0, 8, 8, 20]);
    assert.ok(c.every(s => s.bpmStart === 120 && s.bpmEnd === 120));
    const r = _segmentSplitPure([seg(0, 20, 'ramp', 140, 90)], 0, 10);
    assert.strictEqual(r[0].bpmEnd, 115, 'ramp tempo interpolated at the cut');
    assert.strictEqual(r[1].bpmStart, 115);
    assert.strictEqual(r[0].bpmStart, 140);
    assert.strictEqual(r[1].bpmEnd, 90);
    assert.strictEqual(_segmentSplitPure([seg(0, 20, 'constant', 120)], 0, 1), null,
        'a cut inside the minimum span refuses');
});

t('merge describes the join by its own endpoints — ramp when they differ', () => {
    const flat = _segmentMergePure([seg(0, 10, 'constant', 120), seg(10, 20, 'constant', 121)], 0);
    assert.strictEqual(flat.length, 1);
    assert.strictEqual(flat[0].kind, 'constant', 'near-equal endpoints → constant at the midpoint');
    assert.strictEqual(flat[0].bpmStart, 120.5);
    const ramp = _segmentMergePure([seg(0, 10, 'constant', 120), seg(10, 20, 'constant', 150)], 0);
    assert.strictEqual(ramp[0].kind, 'ramp', 'spread endpoints → an honest ramp, not a flattened lie');
    assert.strictEqual(ramp[0].bpmStart, 120);
    assert.strictEqual(ramp[0].bpmEnd, 150);
});

t('kind cycles constant → ramp → unmapped → constant and round-trips', () => {
    let segs = [seg(0, 10, 'constant', 120)];
    segs = _segmentCycleKindPure(segs, 0);
    assert.strictEqual(segs[0].kind, 'ramp');
    segs = _segmentCycleKindPure(segs, 0);
    assert.strictEqual(segs[0].kind, 'unmapped');
    segs = _segmentCycleKindPure(segs, 0);
    assert.strictEqual(segs[0].kind, 'constant');
    assert.strictEqual(segs[0].bpmStart, 120, 'tempo survives the round trip');
});

t('BPM edit refuses degenerate values that would hang the grid seeder', () => {
    const segs = [seg(0, 10, 'constant', 120)];
    assert.strictEqual(_segmentSetBpmPure(segs, 0, 0), null);
    assert.strictEqual(_segmentSetBpmPure(segs, 0, NaN), null);
    assert.strictEqual(_segmentSetBpmPure(segs, 0, 1200), null);
    const ok = _segmentSetBpmPure(segs, 0, 118.5);
    assert.strictEqual(ok[0].bpmStart, 118.5);
    assert.strictEqual(ok[0].bpmEnd, 118.5, 'a constant takes one value on both ends');
});

t('single-tempo collapses mapped zones to the duration-weighted median', () => {
    const segs = [seg(0, 60, 'constant', 120), seg(60, 80, 'constant', 140),
        seg(80, 90, 'unmapped', 0, 0)];
    const one = _segmentSingleTempoPure(segs);
    assert.strictEqual(one.length, 1);
    assert.strictEqual(one[0].kind, 'constant');
    assert.strictEqual(one[0].bpmStart, 120, 'the 60s zone outweighs the 20s zone');
    assert.strictEqual(one[0].tEnd, 80, 'the unmapped tail is not part of the span');
});

// ── the stretch clamp (segment BPM as a real prior) ──────────────────

t('stretchClamp bounds a miss-path march to ±clamp of the grid tempo', () => {
    // Grid at 120 (2s bars). Bar 2's downbeat really lands at 2.10 (stretch
    // 1.05); bar 3 has only off-beat noise (a sustained bar → miss-march); bar
    // 4 is LOCKED (protects the miss from the trailing drop). The miss's
    // proposed time is pure prediction = prev + gridInt × stretch — exactly
    // where the clamp bites.
    const beats = grid(5, 120);
    beats[12].locked = true;   // bar 4 downbeat, t = 6.0
    const onsets = [
        { t: 2.10, s: 0.9 },                       // bar 2 downbeat, played late
        { t: 3.20, s: 0.5 }, { t: 3.65, s: 0.5 },  // bar 3: sustain noise, no downbeat
    ];
    const free = _suggestFitPure(beats, onsets, 0, {});
    const clamped = _suggestFitPure(beats, onsets, 0, { stretchClamp: 0.02 });
    assert.ok(Math.abs(free.proposals[1].time - 4.20) < 1e-9,
        `unclamped miss marches at the tracked stretch (got ${free.proposals[1].time})`);
    assert.ok(Math.abs(clamped.proposals[1].time - 4.14) < 1e-9,
        `clamped miss can drift at most 2% per bar (got ${clamped.proposals[1].time})`);
    assert.strictEqual(free.proposals[2].time, 6.0, 'the locked downbeat pins either way');
    assert.strictEqual(clamped.proposals[2].time, 6.0);
});

// ── bounded per-segment refine ───────────────────────────────────────

t('refine snaps each zone to the recording INSIDE the zone; anchors and other zones hold', () => {
    // Zone A seeded at 120 over 0–16s (8 bars); the band really plays 118.
    // Zone B seeded at 140 from 16s (4 bars); its pulse is shifted +0.05s.
    const beats = [...grid(8, 120, 0, 1), ...grid(4, 140, 16, 9)];
    const segments = [seg(0, 16, 'constant', 120), seg(16, 32, 'constant', 140)];
    const onsets = [...onsetsAllBeats(118, 8, 0), ...onsetsAllBeats(140, 4, 16.05)];
    const { beats: refined, refined: n } = _segmentRefineGridPure(beats, onsets, segments);
    assert.strictEqual(refined.length, beats.length, 'equal-count grid — the command invariant');
    assert.ok(n > 0, 'something refined');
    const barA = (60 / 118) * 4;
    for (let m = 2; m <= 8; m++) {
        const d = refined.find(b => b.measure === m);
        assert.ok(Math.abs(d.time - (m - 1) * barA) < 0.05,
            `zone-A bar ${m} snapped to the 118-BPM pulse (got ${d.time.toFixed(3)})`);
    }
    assert.strictEqual(refined.find(b => b.measure === 1).time, 0, 'zone-A anchor never moves');
    assert.strictEqual(refined.find(b => b.measure === 9).time, 16, 'zone-B anchor never moves');
    const d10 = refined.find(b => b.measure === 10);
    const barB = (60 / 140) * 4;
    assert.ok(Math.abs(d10.time - (16.05 + barB)) < 0.05, 'zone B refines off its own pulse');
});

t('an unmapped zone refines nothing', () => {
    const beats = grid(4, 120);
    const segments = [seg(0, 8, 'unmapped', 0, 0)];
    const onsets = onsetsAllBeats(110, 4);
    const { beats: refined, refined: n } = _segmentRefineGridPure(beats, onsets, segments);
    assert.strictEqual(n, 0);
    assert.deepStrictEqual(refined.map(b => b.time), beats.map(b => b.time));
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
