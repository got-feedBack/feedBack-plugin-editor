/*
 * Segment-first tempo mapping engine (P2-3). Pure detection: local tempo via
 * autocorrelation of the onset train (octave-guarded), bottom-up segmentation
 * with Theil-Sen ramp classification, and a downbeat-phase seed. The fail-on-main
 * fixtures (no engine exists on main):
 *   · 120×16 → 140×16 → 4-bar rit to 90 ⇒ 3 segments [constant, constant, ramp].
 *   · a single-tempo song ⇒ exactly ONE segment (no over-segmentation).
 *   · snare-on-2&4 ⇒ the phase seed picks beat 1 on the KICK, not the snare.
 *
 * Run: node --test tests/tempo_segment.test.mjs
 */
import assert from 'node:assert';
import {
    _localTempoSeriesPure, _segmentTempoPure, _downbeatPhasePure, _segmentSeedGridPure,
} from '../src/tempo-segment.js';

let pass = 0, fail = 0;
function t(name, fn) {
    try { fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}

// beat onsets at a constant bpm; every beat an onset (strength 1).
function constSpan(bpm, nBeats, t0, s = 1) {
    const P = 60 / bpm, out = [];
    for (let i = 0; i < nBeats; i++) out.push({ t: t0 + i * P, s });
    return { onsets: out, tEnd: t0 + nBeats * P };
}
function rampSpan(bpm0, bpm1, nBeats, t0, s = 1) {
    const out = []; let tt = t0;
    for (let i = 0; i < nBeats; i++) {
        const f = nBeats > 1 ? i / (nBeats - 1) : 0;
        out.push({ t: tt, s });
        tt += 60 / (bpm0 + (bpm1 - bpm0) * f);
    }
    return { onsets: out, tEnd: tt };
}

t('a single-tempo song returns exactly ONE constant segment', () => {
    const { onsets } = constSpan(128, 128, 0);   // 32 bars of 4/4
    const segs = _segmentTempoPure(_localTempoSeriesPure(onsets));
    assert.strictEqual(segs.length, 1, `one segment (got ${segs.length})`);
    assert.strictEqual(segs[0].kind, 'constant');
    assert.ok(Math.abs(segs[0].bpmStart - 128) <= 4, `~128 bpm (got ${segs[0].bpmStart})`);
});

t('three tempo intents → 3 segments [constant, constant, ramp], right BPMs', () => {
    const a = constSpan(120, 64, 0);
    const b = constSpan(140, 64, a.tEnd);
    const c = rampSpan(140, 90, 16, b.tEnd);
    const onsets = [...a.onsets, ...b.onsets, ...c.onsets];
    const segs = _segmentTempoPure(_localTempoSeriesPure(onsets));
    assert.strictEqual(segs.length, 3, `three segments (got ${segs.length}: ${segs.map(s => s.kind + '@' + s.bpmStart).join(', ')})`);
    assert.deepStrictEqual(segs.map(s => s.kind), ['constant', 'constant', 'ramp']);
    assert.ok(Math.abs(segs[0].bpmStart - 120) <= 6, `seg1 ~120 (got ${segs[0].bpmStart})`);
    assert.ok(Math.abs(segs[1].bpmStart - 140) <= 6, `seg2 ~140 (got ${segs[1].bpmStart})`);
    assert.ok(segs[2].bpmStart > segs[2].bpmEnd, 'ramp slows down (start > end bpm)');
    // boundary between seg1 and seg2 within ~1 bar (2s) of the true 31.5s change
    assert.ok(Math.abs(segs[1].tStart - a.tEnd) <= 2.5, `boundary near ${a.tEnd.toFixed(1)}s (got ${segs[1].tStart.toFixed(1)})`);
});

t('octave guard: a train with ghost/off-beat hits still reads the true tempo, not 2×', () => {
    // 120bpm beats + a weaker off-beat "ghost" between each → naive ACF could read 240.
    const P = 0.5, out = [];
    for (let i = 0; i < 80; i++) { out.push({ t: i * P, s: 1 }); out.push({ t: i * P + P / 2, s: 0.4 }); }
    const series = _localTempoSeriesPure(out);
    const mid = series[Math.floor(series.length / 2)];
    assert.ok(Math.abs(mid.bpm - 120) <= 8, `reads ~120, not ~240 (got ${mid.bpm.toFixed(1)})`);
});

t('phase seed picks beat 1 on the KICK, not the loud snare backbeat', () => {
    // 4/4 at 120 (beat 0.5s, bar 2s). Kick (low band) on beats 1&3; snare (mid,
    // LOUDER) on 2&4. The downbeat must land on a kick, i.e. phase ≈ 0 (mod bar).
    const bar = 2.0, beat = 0.5, onsets = [];
    for (let m = 0; m < 16; m++) {
        const b0 = m * bar;
        onsets.push({ t: b0 + 0 * beat, s: 0.6, bands: { lo: 0.9, mid: 0.1, hi: 0 } });   // beat1 kick
        onsets.push({ t: b0 + 1 * beat, s: 1.0, bands: { lo: 0.1, mid: 0.9, hi: 0.3 } });   // beat2 snare (loud)
        onsets.push({ t: b0 + 2 * beat, s: 0.6, bands: { lo: 0.9, mid: 0.1, hi: 0 } });   // beat3 kick
        onsets.push({ t: b0 + 3 * beat, s: 1.0, bands: { lo: 0.1, mid: 0.9, hi: 0.3 } });   // beat4 snare (loud)
    }
    const { phase } = _downbeatPhasePure(onsets, beat, 0, { beatsPerBar: 4 });
    // phase near 0 (or a whole bar) = on the kick; near 0.5s = on the snare = WRONG.
    const modBeat = ((phase % beat) + beat) % beat;
    assert.ok(modBeat < 0.12 || modBeat > beat - 0.12, `downbeat on a kick, not the snare (phase ${phase.toFixed(3)})`);
});

t('seed grid lays a uniform 4/4 skeleton at the segment bpm, downbeats flagged', () => {
    const grid = _segmentSeedGridPure([{ tStart: 0, tEnd: 4, kind: 'constant', bpmStart: 120, bpmEnd: 120, downbeatTime: 0 }]);
    assert.ok(grid.length >= 7, 'about 8 beats in 4s at 120bpm');
    assert.strictEqual(grid[0].measure, 1, 'first beat is a downbeat');
    assert.strictEqual(grid[4].measure, 2, 'beat 5 opens bar 2');
    assert.ok(grid.slice(1, 4).every(b => b.measure === 0), 'beats 2-4 are not downbeats');
    assert.ok(Math.abs((grid[1].time - grid[0].time) - 0.5) < 1e-6, '0.5s beat period at 120bpm');
});

t('degenerate input degrades cleanly', () => {
    assert.deepStrictEqual(_localTempoSeriesPure([]), []);
    assert.deepStrictEqual(_localTempoSeriesPure([{ t: 0, s: 1 }]), []);
    assert.deepStrictEqual(_segmentTempoPure([]), []);
    assert.deepStrictEqual(_segmentSeedGridPure([]), []);
    assert.deepStrictEqual(_downbeatPhasePure([], 0.5, 0), { downbeatTime: 0, phase: 0 });
});

// A negative S.audioShift slides the recording EARLIER, so _ensureOnsetsShifted()
// can hand us onsets entirely at t < 0. tEnd then goes negative and the impulse
// buffer was sized `new Float64Array(ceil(tEnd*binHz) + 1)` → RangeError: Invalid
// typed array length, thrown straight out of the Scan menu handler.
t('onsets entirely before t=0 (negative audio shift) return [] instead of throwing', () => {
    const shifted = [-5, -4.5, -4, -3.5, -3, -2.5].map(t0 => ({ t: t0, s: 1 }));
    assert.deepStrictEqual(_localTempoSeriesPure(shifted), []);
});

// beatOf()/timeOf() binary-search S.beats, so a grid that is not strictly
// increasing silently corrupts every note in the song. _segmentSeedGridPure is
// what #253 lifts into a TempoGridCmd, so the contract is enforced HERE.
t('seed grid stays strictly increasing in time even when segments overlap', () => {
    const grid = _segmentSeedGridPure([
        { tStart: 0, tEnd: 8, kind: 'constant', bpmStart: 120, bpmEnd: 120 },
        { tStart: 4, tEnd: 12, kind: 'constant', bpmStart: 90, bpmEnd: 90 },   // overlaps the first
    ]);
    for (let i = 1; i < grid.length; i++)
        assert.ok(grid[i].time > grid[i - 1].time,
            `beat ${i} (${grid[i].time}) must be strictly after beat ${i - 1} (${grid[i - 1].time})`);
});

// A confirmed segment is user-editable (#253), so a typed 0/negative bpm is a live
// input. Any of these made `period <= 0`, so `t += period` never reached seg.tEnd:
// the while-loop spun forever pushing beats until the tab died.
t('seed grid refuses degenerate BPM instead of looping forever', () => {
    for (const [bpmStart, bpmEnd] of [[0, 0], [-60, -60], [Infinity, Infinity], [120, -120]]) {
        const grid = _segmentSeedGridPure([{ tStart: 0, tEnd: 10, kind: 'ramp', bpmStart, bpmEnd }]);
        assert.ok(grid.length < 1000, `bpm ${bpmStart}→${bpmEnd} must not run away (got ${grid.length} beats)`);
        for (const b of grid) assert.ok(Number.isFinite(b.time), `bpm ${bpmStart}→${bpmEnd} emitted a non-finite beat time`);
    }
});

// The maxSegments cap merged the closest-at-the-join pair and hard-coded the result
// to kind:'constant' — flattening a real rit/accel into a single fake steady tempo,
// which is exactly the pair the "closest at the join" search likes to pick.
t('cap-merge does not flatten a ramp into a constant', () => {
    const pts = [];
    let tt = 0;
    for (let i = 0; i < 8; i++) pts.push({ t: tt++, bpm: 100, conf: 0.9 });          // plateau
    for (let i = 0; i < 8; i++) pts.push({ t: tt++, bpm: 140, conf: 0.9 });          // plateau
    for (let i = 0; i < 12; i++) pts.push({ t: tt++, bpm: 140 - i * 4, conf: 0.9 }); // rit 140→96
    const raw = _segmentTempoPure(pts, { minSegSec: 0, maxSegments: 99 });
    assert.strictEqual(raw.filter(s => s.kind === 'ramp').length, 1, 'fixture has exactly one ramp');
    const capped = _segmentTempoPure(pts, { minSegSec: 0, maxSegments: 2 });
    assert.strictEqual(capped.length, 2, 'cap is still honoured');
    assert.ok(capped.some(s => s.kind === 'ramp'), `the rit must survive the cap (got ${capped.map(s => s.kind).join(', ')})`);
    const ramp = capped.find(s => s.kind === 'ramp');
    assert.ok(ramp.bpmStart > ramp.bpmEnd, 'and it must still slow down');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
