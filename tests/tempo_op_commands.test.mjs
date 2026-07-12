/*
 * Whole-song tempo-op correctness (charrette P0).
 *
 * editorApplySync, editorSetBPM's constant-rescale branch, and editorApplyOffset
 * used to mutate DIRECTLY with no undo and walk only the CURRENT arrangement's
 * plain notes() (+ the global beats/sections/drums) — every OTHER arrangement,
 * plus all chords/anchors/handshapes/phrases and (for the partial paths) the
 * drum tab, were left behind: silent multi-part corruption. The fix routes all
 * three through one TempoMapCmd / TempoOffsetCmd, whose _eachTimed lift→reproject
 * is TOTAL (every timed object, every part) and undoable.
 *
 * This suite proves:
 *   1. _tempoPivotTimePure — the rescale/sync pivot (first downbeat / focused
 *      barline / lead-in / degenerate).
 *   2. A sync-shaped TempoMapCmd moves EVERY part (2nd arrangement, chords,
 *      drums, sections) and undo restores the exact pre-edit seconds.
 *   3. TempoOffsetCmd — rigid +delta over every part (incl. past-grid
 *      extrapolation), the drum-hit ≥0 clamp, S.appliedOffset carried undoably,
 *      and exec→rollback→redo round-trips.
 *   4. Source guards: the three wrappers actually route through the commands and
 *      no longer carry the old partial-mutation loops (would-fail-on-main).
 *
 * Run: node tests/tempo_op_commands.test.mjs
 */
import assert from 'node:assert';
import fs from 'node:fs';
import { S } from '../src/state.js';
import { EditHistory } from '../src/history.js';
import {
    TempoMapCmd, TempoOffsetCmd, _respaceWithLocksPure, _tempoPivotTimePure,
} from '../src/tempo.js';
import { seedState, trackHooks } from './_history_env.mjs';

let pass = 0, fail = 0;
function t(name, fn) {
    try { fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}
const near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

// A uniform 1s beat grid; first beat is the downbeat.
const grid = times => times.map((time, i) => ({ time, measure: i === 0 ? 1 : -1 }));

// ── 1. _tempoPivotTimePure ───────────────────────────────────────────────────
t('_tempoPivotTimePure returns the first downbeat by default', () => {
    // Lead-in beats (measure <= 0) before bar 1 at t=2.
    const beats = [{ time: 0, measure: 0 }, { time: 1, measure: 0 }, { time: 2, measure: 1 }, { time: 3, measure: -1 }];
    assert.strictEqual(_tempoPivotTimePure(beats, -1), 2);
});
t('_tempoPivotTimePure honours a focused barline (S.tempoSel)', () => {
    const beats = grid([0, 1, 2, 3, 4]);
    assert.strictEqual(_tempoPivotTimePure(beats, 3), 3);
});
t('_tempoPivotTimePure falls back to beats[0] when there is no downbeat', () => {
    const beats = [{ time: 5, measure: 0 }, { time: 6, measure: 0 }];
    assert.strictEqual(_tempoPivotTimePure(beats, -1), 5);
});
t('_tempoPivotTimePure tolerates an empty / out-of-range grid', () => {
    assert.strictEqual(_tempoPivotTimePure([], 2), 0);
    assert.strictEqual(_tempoPivotTimePure(grid([0, 1]), 99), 0);   // OOB sel → downbeat
});

// ── Shared multi-part fixture ────────────────────────────────────────────────
// arr 0 is CURRENT; arr 1 is the "other" arrangement the old partial paths
// dropped. Every time-bearing field is represented so a total reproject is
// visible everywhere.
function seedMultiPart() {
    trackHooks();
    const mkArr = (base) => ({
        name: base === 0 ? 'Guitar' : 'Bass',
        notes: [{ string: 0, fret: 0, time: 1.0, sustain: 0.5 }, { string: 1, fret: 2, time: 3.0 }],
        chords: [{ time: 2.0, notes: [{ string: 0, time: 2.0 }, { string: 1, time: 2.0, sustain: 0.5 }] }],
        anchors: [{ time: 1.0, fret: 1, width: 4 }],
        anchors_user: [{ time: 3.0, fret: 5, width: 4 }],
        handshapes: [{ chord_id: 0, start_time: 2.0, end_time: 2.5 }],
        // Real phrase shape: start_time is the anchor (input.js authoring,
        // routes.py save); end_time rides when present (server-loaded phrases
        // carry it). A `time`-keyed phrase here would vacuously pass a walk
        // that visits the wrong field — the exact bug that stranded phrases.
        phrases: [
            { name: 'A', number: 1, start_time: 0.0, levels: [] },
            { name: 'B', number: 1, start_time: 4.0, end_time: 4.5, levels: [] },
        ],
    });
    seedState({
        arrangements: [mkArr(0), mkArr(1)],
        currentArr: 0,
        sessionId: 'sess-1',
        beats: grid([0, 1, 2, 3, 4]),
        sections: [{ name: 'Verse', start_time: 1.0 }],
        drumTab: { version: 1, name: 'kit', kit: 'std', hits: [{ p: 'kick', t: 2.0 }, { p: 'snare', t: 3.0 }] },
        appliedOffset: 0,
        history: new EditHistory(),
    });
}

// Deep snapshot of every time-bearing field across BOTH arrangements + drums +
// sections, for exact-restore comparisons.
function timesSnapshot() {
    return JSON.stringify({
        arr: S.arrangements.map(a => ({
            notes: a.notes.map(n => [n.time, n.sustain ?? null]),
            chords: a.chords.map(c => [c.time, c.notes.map(cn => [cn.time, cn.sustain ?? null])]),
            anchors: a.anchors.map(x => x.time),
            anchors_user: a.anchors_user.map(x => x.time),
            handshapes: a.handshapes.map(h => [h.start_time, h.end_time]),
            phrases: a.phrases.map(p => [p.start_time, p.end_time ?? null]),
        })),
        drums: S.drumTab.hits.map(h => h.t),
        sections: S.sections.map(s => s.start_time),
    });
}

// ── 2. Sync-shaped TempoMapCmd moves every part ──────────────────────────────
t('a sync ×2 stretch reprojects EVERY part, not just the current arrangement', () => {
    seedMultiPart();
    const before = timesSnapshot();
    const factor = 0.5;                                 // audio 2× tab → grid scale 1/factor = ×2
    const t0 = _tempoPivotTimePure(S.beats, -1);        // 0
    const oldBeats = S.beats.map(b => ({ ...b }));
    const scaled = S.beats.map(b => ({ ...b, time: t0 + (b.time - t0) / factor }));
    S.history.exec(new TempoMapCmd(oldBeats, _respaceWithLocksPure(oldBeats, scaled), 'sync'));

    // The OTHER arrangement (arr 1) — the one the old partial path left behind —
    // must have moved: its note at beat 3 (t=3.0) reprojects to 6.0.
    assert.ok(near(S.arrangements[1].notes[1].time, 6.0), 'arr 1 note moved (was stranded on main)');
    assert.ok(near(S.arrangements[1].chords[0].time, 4.0), 'arr 1 chord moved');
    assert.ok(near(S.arrangements[1].chords[0].notes[1].sustain, 1.0), 'arr 1 chord-note sustain scaled');
    assert.ok(near(S.arrangements[1].handshapes[0].end_time, 5.0), 'arr 1 handshape span moved');
    assert.ok(near(S.arrangements[1].phrases[1].start_time, 8.0), 'arr 1 phrase moved (start_time is the anchor — a time-keyed walk strands it)');
    assert.ok(near(S.arrangements[1].phrases[1].end_time, 9.0), 'arr 1 phrase end_time rode as a span');
    // Drums + sections moved too.
    assert.ok(near(S.drumTab.hits[0].t, 4.0), 'drum kick moved (was stranded on main)');
    assert.ok(near(S.sections[0].start_time, 2.0), 'section moved');
    // Current arrangement moved as well (it always did).
    assert.ok(near(S.arrangements[0].notes[0].time, 2.0), 'current-arr note moved');
    assert.notStrictEqual(timesSnapshot(), before, 'something actually changed');

    S.history.doUndo();
    assert.strictEqual(timesSnapshot(), before, 'undo restored the EXACT pre-edit seconds for every part');
});

// ── 3. TempoOffsetCmd ────────────────────────────────────────────────────────
t('TempoOffsetCmd shifts every part by +delta and carries S.appliedOffset undoably', () => {
    seedMultiPart();
    const before = timesSnapshot();
    const delta = 1.5;
    const oldBeats = S.beats.map(b => ({ ...b }));
    const newBeats = S.beats.map(b => ({ ...b, time: b.time + delta }));
    S.history.exec(new TempoOffsetCmd(oldBeats, newBeats, 0, delta));

    assert.ok(near(S.arrangements[1].notes[0].time, 2.5), 'arr 1 note shifted +delta');
    assert.ok(near(S.arrangements[1].phrases[1].start_time, 5.5), 'arr 1 phrase shifted +delta');
    assert.ok(near(S.drumTab.hits[0].t, 3.5), 'drum hit shifted +delta');
    assert.ok(near(S.sections[0].start_time, 2.5), 'section shifted +delta');
    // Sustains are durations — they must NOT move.
    assert.ok(near(S.arrangements[0].notes[0].sustain, 0.5), 'sustain preserved');
    assert.strictEqual(S.appliedOffset, 1.5, 'appliedOffset recorded');

    S.history.doUndo();
    assert.strictEqual(timesSnapshot(), before, 'undo restored exact seconds');
    assert.strictEqual(S.appliedOffset, 0, 'undo restored appliedOffset');

    S.history.doRedo();
    assert.ok(near(S.drumTab.hits[0].t, 3.5), 'redo re-applied the shift');
    assert.strictEqual(S.appliedOffset, 1.5, 'redo restored appliedOffset');
});

t('TempoOffsetCmd keeps the #editor-offset input in step across undo/redo', () => {
    seedMultiPart();
    // editorNudgeOffset computes the NEXT offset from el.value, so a stale
    // input after Ctrl-Z would make one +10ms click re-apply the undone nudge
    // on top of it (delta computes against the restored S.appliedOffset).
    const el = document.getElementById('editor-offset');
    el.value = '1.5';                                   // what the wrapper shows after apply
    const oldBeats = S.beats.map(b => ({ ...b }));
    const newBeats = S.beats.map(b => ({ ...b, time: b.time + 1.5 }));
    S.history.exec(new TempoOffsetCmd(oldBeats, newBeats, 0, 1.5));
    assert.strictEqual(el.value, '1.5', 'exec syncs the input');
    S.history.doUndo();
    assert.strictEqual(el.value, '0', 'undo restores the input alongside S.appliedOffset');
    S.history.doRedo();
    assert.strictEqual(el.value, '1.5', 'redo re-syncs the input');
});

t('TempoOffsetCmd extrapolates a rigid +delta past the grid ends (pin)', () => {
    seedMultiPart();
    // A note beyond the last beat (t=4): beatOf/timeOf extrapolate linearly, so a
    // rigid +delta grid gives a rigid +delta reproject — not a scaled one.
    S.arrangements[0].notes.push({ string: 0, fret: 0, time: 10.0 });
    const delta = 1.5;
    const oldBeats = S.beats.map(b => ({ ...b }));
    const newBeats = S.beats.map(b => ({ ...b, time: b.time + delta }));
    S.history.exec(new TempoOffsetCmd(oldBeats, newBeats, 0, delta));
    assert.ok(near(S.arrangements[0].notes[2].time, 11.5), 'past-grid note shifted by exactly +delta');
});

t('TempoOffsetCmd clamps drum hits to ≥0 on a leftward nudge, restoring exactly on undo', () => {
    seedMultiPart();
    S.drumTab.hits = [{ p: 'kick', t: 0.5 }, { p: 'snare', t: 3.0 }];
    const before = timesSnapshot();
    const delta = -2.0;                                 // pushes the 0.5s hit to -1.5
    const oldBeats = S.beats.map(b => ({ ...b }));
    const newBeats = S.beats.map(b => ({ ...b, time: b.time + delta }));
    S.history.exec(new TempoOffsetCmd(oldBeats, newBeats, 0, delta));
    assert.strictEqual(S.drumTab.hits[0].t, 0, 'early hit clamped to 0 (save path rejects negative t)');
    assert.ok(near(S.drumTab.hits[1].t, 1.0), 'later hit shifted by -delta normally');

    S.history.doUndo();
    assert.strictEqual(timesSnapshot(), before, 'undo restored the pre-clamp seconds verbatim');
});

t('TempoOffsetCmd on a degenerate grid (<2 beats) carries appliedOffset undoably without moving notes', () => {
    // beatOf/timeOf are identity on <2 beats, so lift→reproject is a no-op on
    // note seconds — the command just records the scalar, undoably. This is why
    // editorApplyOffset needs no <2-beat special case (a direct S.appliedOffset
    // write there skipped history: Ctrl-Z restored nothing and the next nudge's
    // delta computed off a stale base).
    seedMultiPart();
    S.beats = [];
    const before = timesSnapshot();
    S.history.exec(new TempoOffsetCmd([], [], 0, 0.25));
    assert.strictEqual(S.appliedOffset, 0.25, 'appliedOffset recorded');
    assert.strictEqual(timesSnapshot(), before, 'no note/section/drum seconds moved (identity reproject)');
    S.history.doUndo();
    assert.strictEqual(S.appliedOffset, 0, 'undo restored appliedOffset');
    S.history.doRedo();
    assert.strictEqual(S.appliedOffset, 0.25, 'redo re-applied appliedOffset');
});

// ── 4. Source guards: the wrappers route through the commands (fail-on-main) ──
const syncSrc = fs.readFileSync(new URL('../src/sync-tempo.js', import.meta.url), 'utf8');
const mainSrc = fs.readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');

function body(src, header) {
    const start = src.indexOf(header);
    assert.ok(start >= 0, `"${header}" must exist`);
    const open = src.indexOf('{', start);
    let depth = 0;
    for (let i = open; i < src.length; i++) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}' && --depth === 0) return src.slice(start, i + 1);
    }
    throw new Error(`unbalanced braces from ${header}`);
}

t('editorApplySync routes through TempoMapCmd and dropped the partial note loop', () => {
    const b = body(syncSrc, 'export function editorApplySync');
    assert.ok(/S\.history\.exec\(new TempoMapCmd/.test(b), 'sync execs a TempoMapCmd');
    assert.ok(!/n\.time = n\.time \/ factor/.test(b), 'the old per-note linear-scale loop is gone');
    assert.ok(!/sync-offset/.test(b), 'the duplicate sync-dialog offset field is gone');
});

t('editorApplyOffset routes through TempoOffsetCmd and no longer pokes dataset.applied', () => {
    const b = body(mainSrc, 'window.editorApplyOffset =');
    assert.ok(/S\.history\.exec\(new TempoOffsetCmd/.test(b), 'offset execs a TempoOffsetCmd');
    assert.ok(!/\.dataset\.applied/.test(b), 'the DOM dataset.applied write is gone (S.appliedOffset owns it)');
    assert.ok(!/_shiftArrangementTimes/.test(mainSrc), 'the partial per-arrangement shifter is removed');
    assert.ok(!/S\.appliedOffset\s*=/.test(b), 'no direct S.appliedOffset write — the <2-beat path also routes through the command (else it skips history)');
});

t('editorSetBPM constant-rescale routes through a pivoted TempoMapCmd', () => {
    const b = body(mainSrc, 'window.editorSetBPM =');
    assert.ok(/new TempoMapCmd\(oldBeats,[\s\S]*'rescale'\)/.test(b), 'rescale execs a TempoMapCmd');
    assert.ok(/_tempoPivotTimePure/.test(b), 'rescale pivots (not t=0)');
    assert.ok(!/for \(const b of S\.beats\) b\.time \*= factor/.test(b), 'the old direct beat scale is gone');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
