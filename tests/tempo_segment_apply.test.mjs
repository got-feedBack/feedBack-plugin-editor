/*
 * Segment-first rough map — APPLY (P2-3, the committing half of Scan).
 *
 * `editorApplyTempoZones` is a WRITE to the tempo grid, the most dangerous path
 * in the editor: `beatOf`/`timeOf` binary-search `S.beats` and REQUIRE it to be
 * strictly monotonic, and every note's beat is a cache derived from it. So this
 * suite drives the real command end-to-end (real S, real EditHistory, real
 * onsets synthesised from S.waveformPeaks) and pins the invariant:
 *
 *   1. the installed grid is STRICTLY monotonic and finite (a flat/backwards
 *      pair silently corrupts every note in the song);
 *   2. every timed object — notes, chords, sections, anchors, handshapes,
 *      phrases, drum hits, INCLUDING a pickup before the first segment — keeps
 *      its SECONDS exactly (the audio doesn't move, so the notes must not) while
 *      its BEAT re-derives against the new grid;
 *   3. Apply is ONE undoable command, and undo restores the previous grid
 *      VERBATIM plus every object's beat and seconds exactly;
 *   4. Apply is gated (no audio / no pulse → status, no history entry).
 *
 * Run: node --test tests/tempo_segment_apply.test.mjs
 */
import assert from 'node:assert';
import { S } from '../src/state.js';
import { EditHistory } from '../src/history.js';
import { beatOf } from '../src/beats.js';
import { _eachTimed, editorApplyTempoZones } from '../src/tempo.js';
import { _segmentRoughMapPure } from '../src/tempo-segment.js';
import { seedState, trackHooks, lastStatus } from './_history_env.mjs';

let pass = 0, fail = 0;
function t(name, fn) {
    try { fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}

// ── A synthetic recording: 120 bpm for 20 s, then 150 bpm for 20 s ──────
// `_ensureOnsets` derives onsets from S.waveformPeaks (an rms envelope), so a
// spike train at the beat times is a real end-to-end drive of the detector.
const BIN_HZ = 100, DUR = 40;
function peaks() {
    const bins = DUR * BIN_HZ;
    const rms = new Float64Array(bins).fill(0.02);
    const hit = (time, amp) => {
        const i = Math.round(time * BIN_HZ);
        for (let k = 0; k < 10 && i + k < bins; k++) rms[i + k] = Math.max(rms[i + k], amp * Math.exp(-k / 2));
    };
    let n = 0;
    for (let time = 0; time < 20; time += 0.5) hit(time, n++ % 4 === 0 ? 1.0 : 0.55);
    n = 0;
    for (let time = 20; time < DUR; time += 0.4) hit(time, n++ % 4 === 0 ? 1.0 : 0.55);
    return { bins, rms: Array.from(rms) };
}

// A flat 100 bpm grid (0.6 s beats) — deliberately NOT the detected tempo, so
// Apply has to actually move the grid under the notes.
const oldGrid = () => Array.from({ length: 67 }, (_, i) => (
    i % 4 === 0 ? { time: +(i * 0.6).toFixed(6), measure: i / 4 + 1, den: 4 }
        : { time: +(i * 0.6).toFixed(6), measure: -1 }));

function song() {
    return [{
        name: 'Lead',
        // 1.0 s is a PICKUP: it lands before the first detected downbeat, so its
        // re-derived beat goes negative. Its SECONDS must still not move.
        notes: [
            { time: 1.0, string: 0, fret: 3, sustain: 0.25 },
            { time: 5.321, string: 1, fret: 5, sustain: 0 },
            { time: 25.4, string: 2, fret: 7, sustain: 1.2 },
            { time: 39.0, string: 3, fret: 9, sustain: 0 },
        ],
        chords: [{ time: 12.75, notes: [{ time: 12.75, string: 0, fret: 0, sustain: 0.5 }] }],
        anchors: [{ time: 2.0, fret: 3 }],
        anchors_user: [{ time: 30.0, fret: 5 }],
        handshapes: [{ start_time: 8.0, end_time: 9.0 }],
        phrases: [{ start_time: 3.0, end_time: 6.0, name: 'verse' }],
    }];
}

function setup({ withAudio = true } = {}) {
    seedState({
        arrangements: song(),
        currentArr: 0,
        beats: oldGrid(),
        sections: [{ start_time: 0.5, name: 'intro' }],
        drumTab: { hits: [{ t: 4.0, piece: 0 }, { t: 22.5, piece: 1 }] },
        tempoSel: 3,
        tempoSelMulti: new Set(),
        sessionId: 'sess-1',
        audioShift: 0,
        duration: withAudio ? DUR : 0,
        waveformPeaks: withAudio ? peaks() : null,
    });
    trackHooks();
    S.history = new EditHistory();
    return S;
}

// Snapshot every timed object's seconds + beat, keyed by identity order.
function snapTimed() {
    const out = [];
    _eachTimed((o, tf, endKind) => {
        out.push({ o, tf, endKind, time: o[tf], beat: o.beat, sustain: o.sustain, end_time: o.end_time });
    });
    return out;
}

// ── 0. Gates. These run FIRST: `_ensureOnsets` memoises its analysis in a
// module-level cache that only new audio clears, so a later no-audio setup()
// would still see the cache from an earlier test. ──────────────────────
t('Apply is gated with no audio — status, no history entry', () => {
    setup({ withAudio: false });
    assert.strictEqual(editorApplyTempoZones(), true);
    assert.strictEqual(S.history.undo.length, 0, 'nothing committed');
    assert.match(lastStatus(), /load audio first/, 'explains itself');
});

// REGRESSION: the menu row is gated `audioOnly` (S.audioBuffer) only, which does
// NOT imply an open song — so audio-with-no-session reached S.history.exec() with
// S.history at its declared default of null. Pre-fix this threw
// "TypeError: Cannot read properties of null (reading 'exec')".
t('Apply is gated with audio but NO session — status, no crash', () => {
    setup();
    S.sessionId = null;
    S.history = null;
    assert.strictEqual(editorApplyTempoZones(), true);   // must not throw
    assert.match(lastStatus(), /song open/, 'explains itself');
    assert.strictEqual(S.beats.length, oldGrid().length, 'the grid is untouched');
});

// ── 1. The grid Apply installs is strictly monotonic ────────────────────
t('Apply installs a strictly monotonic, finite grid', () => {
    setup();
    assert.strictEqual(editorApplyTempoZones(), true);
    assert.ok(S.beats.length > 2, `a real grid, got ${S.beats.length}`);
    for (let i = 0; i < S.beats.length; i++) {
        assert.ok(Number.isFinite(S.beats[i].time), `beat ${i} time is finite`);
        if (i) assert.ok(S.beats[i].time > S.beats[i - 1].time,
            `beat ${i} (${S.beats[i].time}) must be > beat ${i - 1} (${S.beats[i - 1].time})`);
    }
    assert.ok(S.beats.some(b => b.measure > 0), 'has downbeats');
});

// ── 2. Notes keep their SECONDS; beats re-derive ────────────────────────
t('Apply keeps every timed object on its seconds and re-lifts its beat', () => {
    setup();
    // Lift beats against the OLD grid first, so "the beat changed" is meaningful.
    const before = snapTimed().map(x => ({ ...x, beat: beatOf(S.beats, x.time) }));
    for (const x of before) x.o.beat = x.beat;
    const oldBeats = S.beats;

    editorApplyTempoZones();

    assert.notStrictEqual(S.beats, oldBeats, 'S.beats must be a FRESH array (identity-keyed memos)');
    const after = snapTimed();
    assert.strictEqual(after.length, before.length, 'same object set');
    let moved = 0;
    for (let i = 0; i < after.length; i++) {
        const b = before[i], a = after[i];
        assert.strictEqual(a.o, b.o, 'same object identity');
        assert.ok(Math.abs(a.time - b.time) < 1e-9,
            `${a.tf} must NOT move: ${b.time} → ${a.time}`);
        assert.ok(Math.abs(a.o.beat - beatOf(S.beats, a.time)) < 1e-9,
            `beat must be re-derived against the NEW grid at t=${a.time}`);
        if (Math.abs(a.o.beat - b.beat) > 1e-6) moved++;
    }
    assert.ok(moved > 0, 'the beats actually re-derived (the grid really changed)');
    // The pickup at 1.0 s sits before the first downbeat: negative beat, same seconds.
    const pickup = S.arrangements[0].notes[0];
    assert.strictEqual(pickup.time, 1.0, 'the pickup note keeps its exact seconds');
});

// ── 3. ONE command; undo restores the grid + beats verbatim ─────────────
t('Apply is one undoable command and undo restores the grid + beats exactly', () => {
    setup();
    for (const x of snapTimed()) x.o.beat = beatOf(S.beats, x.time);
    const gridBefore = S.beats.map(b => ({ ...b }));
    const before = snapTimed().map(x => ({ o: x.o, tf: x.tf, time: x.time, beat: x.o.beat }));
    const selBefore = S.tempoSel;

    editorApplyTempoZones();
    assert.strictEqual(S.history.undo.length, 1, 'exactly ONE history entry, not N');

    S.history.doUndo();
    assert.deepStrictEqual(S.beats, gridBefore, 'undo restores the previous grid VERBATIM');
    for (const b of before) {
        assert.ok(Math.abs(b.o[b.tf] - b.time) < 1e-9, `${b.tf} restored to ${b.time}`);
        assert.ok(Math.abs(b.o.beat - b.beat) < 1e-9,
            `beat restored exactly at t=${b.time}: ${b.beat} → ${b.o.beat}`);
    }
    assert.strictEqual(S.tempoSel, selBefore, 'undo restores the tempo selection');

    // …and redo re-installs it, still without moving a single second.
    S.history.doRedo();
    for (const b of before) assert.ok(Math.abs(b.o[b.tf] - b.time) < 1e-9, 'redo keeps seconds');
    for (let i = 1; i < S.beats.length; i++) assert.ok(S.beats[i].time > S.beats[i - 1].time, 'redo grid monotonic');
});

// ── 4. Pathological onsets never reach the grid ─────────────────────────
// A non-monotonic or non-finite S.beats silently corrupts every note in the
// song (beatOf/timeOf binary-search it), so the map builder must degrade to
// null rather than emit one.
t('rough map degrades to null (never a bad grid) on degenerate onsets', () => {
    const bad = [
        [],
        [{ t: 0, s: 1 }],
        [{ t: NaN, s: 1 }, { t: Infinity, s: 1 }, { t: -5, s: 1 }, { t: 0, s: NaN }],
        Array.from({ length: 40 }, () => ({ t: 1, s: 1 })),              // all coincident
        Array.from({ length: 40 }, (_, i) => ({ t: -i, s: 1 })),         // all negative
        Array.from({ length: 40 }, (_, i) => ({ t: i * 1e-6, s: 1 })),   // zero-length span
        null,
    ];
    for (const onsets of bad) {
        const rough = _segmentRoughMapPure(onsets);
        if (rough === null) continue;
        for (let i = 0; i < rough.beats.length; i++) {
            assert.ok(Number.isFinite(rough.beats[i].time), 'finite beat time');
            if (i) assert.ok(rough.beats[i].time > rough.beats[i - 1].time,
                `strictly monotonic for ${JSON.stringify(onsets && onsets.slice(0, 2))}`);
        }
    }
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
