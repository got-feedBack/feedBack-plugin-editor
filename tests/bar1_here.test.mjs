/*
 * "Bar 1 here" re-anchor + Lead-in + import nudge (tempo track PR 6).
 *
 * "Bar 1 here" shifts the whole grid — and, through TempoOffsetCmd's total
 * reproject, EVERY part's notes/chords/anchors/drums plus the sections — so
 * bar 1's downbeat lands at the playhead. The audio never moves: it is a chart
 * re-anchor riding the same offset command as a manual nudge (S.appliedOffset
 * accrues, undoable). This suite proves:
 *   1. _firstDownbeatTimePure — bar 1's seconds (first measure > 0), null-safe.
 *   2. _tempoBar1ShiftPure — the rigid delta + shifted grid, null with no bar.
 *   3. _importBar1NudgePure — SUGGEST copy only when bar 1 ≈ 0 AND the first
 *      onset is clearly + meaningfully later (never otherwise).
 *   4. _tempoSetBar1Here — lands bar 1 at the playhead across every part +
 *      sections, accrues S.appliedOffset, and exec→undo→redo round-trips exactly.
 *
 * Run: node tests/bar1_here.test.mjs
 */
import assert from 'node:assert';
import { S } from '../src/state.js';
import { EditHistory } from '../src/history.js';
import {
    _firstDownbeatTimePure, _importBar1NudgePure,
    _tempoBar1ShiftPure, _tempoSetBar1Here,
} from '../src/tempo.js';
import { seedState, trackHooks, lastStatus } from './_history_env.mjs';

let pass = 0, fail = 0;
function t(name, fn) {
    try { fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}
const near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

// A uniform 1s beat grid; first beat is the downbeat unless lead-in is prepended.
const grid = times => times.map((time, i) => ({ time, measure: i === 0 ? 1 : -1 }));

// ── 1. _firstDownbeatTimePure ────────────────────────────────────────────────
t('_firstDownbeatTimePure returns the first measure>0 time', () => {
    assert.strictEqual(_firstDownbeatTimePure(grid([2, 3, 4])), 2);
});
t('_firstDownbeatTimePure skips lead-in beats (measure <= 0)', () => {
    const beats = [{ time: 0, measure: 0 }, { time: 1, measure: 0 }, { time: 2, measure: 1 }, { time: 3, measure: -1 }];
    assert.strictEqual(_firstDownbeatTimePure(beats), 2);
});
t('_firstDownbeatTimePure is null with no downbeat / bad input', () => {
    assert.strictEqual(_firstDownbeatTimePure([{ time: 0, measure: 0 }]), null);
    assert.strictEqual(_firstDownbeatTimePure([]), null);
    assert.strictEqual(_firstDownbeatTimePure(null), null);
});

// ── 2. _tempoBar1ShiftPure ───────────────────────────────────────────────────
t('_tempoBar1ShiftPure lands bar 1 at the target and shifts the grid rigidly', () => {
    const res = _tempoBar1ShiftPure(grid([1, 2, 3]), 4);
    assert.ok(near(res.delta, 3), 'delta = target - bar1');
    assert.deepStrictEqual(res.newBeats.map(b => b.time), [4, 5, 6], 'whole grid +delta');
});
t('_tempoBar1ShiftPure with a lead-in shifts the lead-in with the grid', () => {
    const beats = [{ time: 0, measure: 0 }, { time: 2, measure: 1 }];   // pickup at 0, bar1 at 2
    const res = _tempoBar1ShiftPure(beats, 5);
    assert.ok(near(res.delta, 3), 'delta anchors on bar 1, not the lead-in');
    assert.deepStrictEqual(res.newBeats.map(b => b.time), [3, 5], 'lead-in rides');
});
t('_tempoBar1ShiftPure is null with no downbeat', () => {
    assert.strictEqual(_tempoBar1ShiftPure([{ time: 0, measure: 0 }], 5), null);
});
t('_tempoBar1ShiftPure does not mutate its input', () => {
    const beats = grid([1, 2, 3]);
    _tempoBar1ShiftPure(beats, 9);
    assert.deepStrictEqual(beats.map(b => b.time), [1, 2, 3]);
});

// ── 3. _importBar1NudgePure ──────────────────────────────────────────────────
t('_importBar1NudgePure suggests when bar 1 ≈ 0 but the recording starts later', () => {
    const msg = _importBar1NudgePure(0, 7.02);
    assert.ok(/7\.0s/.test(msg), 'names the onset time');
    assert.ok(/Bar 1 here/.test(msg), 'points at the verb');
});
t('_importBar1NudgePure stays silent when bar 1 is already placed later', () => {
    assert.strictEqual(_importBar1NudgePure(7.0, 7.02), '', 'bar 1 not at ~0 → no nudge');
});
t('_importBar1NudgePure stays silent when the recording starts at 0 too', () => {
    assert.strictEqual(_importBar1NudgePure(0, 0.1), '', 'onset early → no nudge');
});
t('_importBar1NudgePure stays silent on a tiny gap or missing onset', () => {
    assert.strictEqual(_importBar1NudgePure(0.1, 0.45), '', 'gap under 0.4s → no nudge');
    assert.strictEqual(_importBar1NudgePure(0, null), '', 'no onset → no nudge');
    assert.strictEqual(_importBar1NudgePure(null, 7), '', 'no bar 1 → no nudge');
});

// ── Shared multi-part fixture (mirrors tempo_op_commands) ─────────────────────
function seedMultiPart() {
    trackHooks();
    const mkArr = (base) => ({
        name: base === 0 ? 'Guitar' : 'Bass',
        notes: [{ string: 0, fret: 0, time: 1.0, sustain: 0.5 }, { string: 1, fret: 2, time: 3.0 }],
        chords: [{ time: 2.0, notes: [{ string: 0, time: 2.0 }, { string: 1, time: 2.0, sustain: 0.5 }] }],
        anchors: [{ time: 1.0, fret: 1, width: 4 }],
        handshapes: [{ chord_id: 0, start_time: 2.0, end_time: 2.5 }],
    });
    seedState({
        arrangements: [mkArr(0), mkArr(1)],
        currentArr: 0,
        sessionId: 'sess-1',
        beats: grid([0, 1, 2, 3, 4]),        // bar 1 downbeat at t=0
        sections: [{ name: 'Verse', start_time: 1.0 }],
        drumTab: { version: 1, name: 'kit', kit: 'std', hits: [{ p: 'kick', t: 2.0 }, { p: 'snare', t: 3.0 }] },
        appliedOffset: 0,
        cursorTime: 0,
        history: new EditHistory(),
    });
}
function timesSnapshot() {
    return JSON.stringify({
        arr: S.arrangements.map(a => ({
            notes: a.notes.map(n => [n.time, n.sustain ?? null]),
            chords: a.chords.map(c => [c.time, c.notes.map(cn => cn.time)]),
            anchors: a.anchors.map(x => x.time),
            handshapes: a.handshapes.map(h => [h.start_time, h.end_time]),
        })),
        drums: S.drumTab.hits.map(h => h.t),
        sections: S.sections.map(s => s.start_time),
    });
}

// ── 4. _tempoSetBar1Here command round-trip ──────────────────────────────────
t('_tempoSetBar1Here lands bar 1 at the playhead across EVERY part + sections', () => {
    seedMultiPart();
    const before = timesSnapshot();
    S.cursorTime = 2.0;                                  // move bar 1 from 0 → 2.0s
    _tempoSetBar1Here();

    assert.ok(near(S.beats[0].time, 2.0), 'bar 1 downbeat landed at the playhead');
    // Rigid +2.0 over every part (the old direct path left other parts behind).
    assert.ok(near(S.arrangements[0].notes[0].time, 3.0), 'current-arr note +delta');
    assert.ok(near(S.arrangements[1].notes[1].time, 5.0), 'other-arr note +delta');
    assert.ok(near(S.arrangements[1].chords[0].time, 4.0), 'other-arr chord +delta');
    assert.ok(near(S.arrangements[1].anchors[0].time, 3.0), 'other-arr anchor +delta');
    assert.ok(near(S.arrangements[1].handshapes[0].end_time, 4.5), 'other-arr handshape span +delta');
    assert.ok(near(S.drumTab.hits[0].t, 4.0), 'drum hit +delta');
    assert.ok(near(S.sections[0].start_time, 3.0), 'section +delta');
    // Sustains are durations — they hold.
    assert.ok(near(S.arrangements[0].notes[0].sustain, 0.5), 'sustain preserved');
    assert.strictEqual(S.appliedOffset, 2.0, 'the shift accrues on S.appliedOffset');
    assert.strictEqual(document.getElementById('editor-offset').value, '2', 'offset input synced');
    assert.ok(/Bar 1 → 2\.00s/.test(lastStatus()), 'status names the new bar-1 time');

    S.history.doUndo();
    assert.strictEqual(timesSnapshot(), before, 'undo restored the exact pre-edit seconds');
    assert.strictEqual(S.appliedOffset, 0, 'undo restored appliedOffset');

    S.history.doRedo();
    assert.ok(near(S.beats[0].time, 2.0), 'redo re-applied the shift');
    assert.strictEqual(S.appliedOffset, 2.0, 'redo restored appliedOffset');
});

t('_tempoSetBar1Here is a no-op with an honest status when bar 1 is already at the playhead', () => {
    seedMultiPart();
    S.cursorTime = 0;                                    // bar 1 already at 0
    const before = timesSnapshot();
    _tempoSetBar1Here();
    assert.strictEqual(timesSnapshot(), before, 'nothing moved');
    assert.strictEqual(S.history.undo.length, 0, 'no command pushed');
    assert.ok(/already at the playhead/.test(lastStatus()));
});

t('_tempoSetBar1Here refuses gracefully with no measure grid', () => {
    seedMultiPart();
    S.beats = [{ time: 0, measure: 0 }, { time: 1, measure: 0 }];   // lead-in only, no downbeat
    _tempoSetBar1Here();
    assert.ok(/No measure grid/.test(lastStatus()));
    assert.strictEqual(S.history.undo.length, 0, 'no command pushed');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
