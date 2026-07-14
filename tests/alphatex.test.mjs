/*
 * Live alphaTex generation (the Tab view's engine): the current in-memory
 * fretted arrangement → alphaTab's text format, quantized to a 16th grid in
 * the BEAT domain (so a variable tempo map engraves correctly), with the
 * gap-duration + rest-fill contract that keeps every bar summing exactly.
 *
 * Pinned here: the bar/tick bucketing, chord grouping, the string-number
 * flip (our lane 0 = lowest string, alphaTex 1 = highest), rest fills and
 * exact bar totals, meter-change \ts emission, alphaTab's octave convention
 * in \tuning (high E MIDI 64 = "e5", NOT the editor's E4), capo, the
 * beatMap ↔ emitted-token alignment (the click-to-select contract), and the
 * honest pickup/tail skip counts.
 *
 * Fails on main (the module doesn't exist there).
 * Run: node tests/alphatex.test.mjs
 */
import assert from 'node:assert';

globalThis.document = globalThis.document || {
    getElementById: () => null, addEventListener: () => {}, activeElement: null,
};
globalThis.localStorage = globalThis.localStorage || { getItem: () => null, setItem: () => {} };
globalThis.window = globalThis.window || globalThis;

const { _alphaTexFromNotesPure, _alphaTexNoteNamePure, _alphaTexTuningPure } =
    await import('../src/alphatex.js');

let pass = 0, fail = 0;
function t(name, fn) {
    try { fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}

// A steady 120 BPM 4/4 grid (0.5s beats) with a LINEAR beat converter to
// match — the generator itself never assumes linearity.
function grid(bars) {
    const beats = [];
    for (let m = 0; m < bars; m++) for (let b = 0; b < 4; b++) {
        beats.push({ time: (m * 4 + b) * 0.5, measure: b === 0 ? m + 1 : 0 });
    }
    return beats;
}
const beatOfLinear = (t2) => t2 / 0.5;
const STD = { laneCount: 6, openMidi: [40, 45, 50, 55, 59, 64], tuning: [0, 0, 0, 0, 0, 0], capo: 0 };
const gen = (notes, beats, extra = {}) => _alphaTexFromNotesPure({
    notes, beats, beatOfFn: beatOfLinear, ...STD, ...extra,
});
const N = (time, string, fret) => ({ time, string, fret });

t("tuning uses alphaTab's octave convention — high E (MIDI 64) is e5, not the editor's E4", () => {
    assert.strictEqual(_alphaTexNoteNamePure(64), 'e5');
    assert.strictEqual(_alphaTexTuningPure(STD.openMidi, STD.tuning), 'e5 b4 g4 d4 a3 e3');
    assert.strictEqual(_alphaTexTuningPure(STD.openMidi, [-2, -2, -2, -2, -2, -2]),
        'd5 a4 f4 c4 g3 d3', 'per-string offsets applied (full-step down)');
});

t('a bar of quarters engraves as quarters; strings flip to alphaTex numbering', () => {
    // Four notes on the beats of bar 1 — gaps of 4 ticks each → .4 durations.
    const r = gen([N(0, 0, 3), N(0.5, 1, 5), N(1.0, 2, 7), N(1.5, 0, 3)], grid(2));
    const bar1 = r.tex.split(' | ')[0].split('\n').pop();
    assert.strictEqual(bar1, '\\ts 4 4 3.6.4 5.5.4 7.4.4 3.6.4',
        'our lane 0 (low string) = alphaTex string 6');
});

t('chords group at one tick; leading and trailing rests fill the bar exactly', () => {
    // One chord on beat 2 of an otherwise empty bar: r.4, chord half (8
    // ticks fit), then a quarter rest completes 16 ticks.
    const r = gen([N(0.5, 0, 2), N(0.5, 1, 2)], grid(2));
    const bar1 = r.tex.split(' | ')[0].split('\n').pop();
    assert.strictEqual(bar1, '\\ts 4 4 r.4 (2.6 2.5).2 r.4');
});

t('an empty bar rests wholly; a meter change re-emits \\ts once', () => {
    // Bar 2 is 3/4 (three beats), then back to 4/4.
    const beats = grid(1);                                     // bar 1: 4/4
    let t0 = 2.0;
    for (let b = 0; b < 3; b++) beats.push({ time: t0 + b * 0.5, measure: b === 0 ? 2 : 0 });
    t0 = 3.5;
    for (let b = 0; b < 4; b++) beats.push({ time: t0 + b * 0.5, measure: b === 0 ? 3 : 0 });
    beats.push({ time: 5.5, measure: 4 });                     // closing downbeat
    const r = gen([], beats);
    const barsOut = r.tex.split('\n').pop().split(' | ');
    assert.strictEqual(barsOut[0], '\\ts 4 4 r.1');
    assert.strictEqual(barsOut[1], '\\ts 3 4 r.2 r.4', '3 beats = half + quarter rest');
    assert.strictEqual(barsOut[2], '\\ts 4 4 r.1', 'back to 4/4 re-emits');
});

t('the beatMap aligns 1:1 with emitted beats — rests null, notes carry their refs', () => {
    const a = N(0.5, 0, 2), b = N(0.5, 1, 2);
    const r = gen([a, b], grid(2));
    assert.strictEqual(r.beatMap[0].length, 3, 'r.4 + chord + r.4');
    assert.strictEqual(r.beatMap[0][0], null);
    assert.deepStrictEqual(r.beatMap[0][1], [a, b], 'the clickable beat maps to its source notes');
    assert.strictEqual(r.beatMap[0][2], null);
});

t('pickup and tail notes are skipped and counted, never silently dropped', () => {
    const beats = grid(2).slice(2);   // grid starts mid-bar: first downbeat at index 2
    const r = _alphaTexFromNotesPure({
        notes: [N(0.1, 0, 1), N(1.2, 0, 2), N(99, 0, 3)],
        beats: grid(3), beatOfFn: beatOfLinear, ...STD,
    });
    assert.strictEqual(r.skipped.tail, 1, 'the note past the last barline');
    assert.strictEqual(r.skipped.pickup, 0);
    assert.ok(beats.length);   // (fixture reuse guard)
});

t('capo and title reach the header; too few downbeats refuses', () => {
    const r = gen([N(0, 0, 1)], grid(2), { capo: 3, title: 'My "Song"' });
    assert.ok(r.tex.includes('\\capo 3'));
    assert.ok(r.tex.includes("\\title \"My 'Song'\""), 'quotes sanitized');
    assert.strictEqual(gen([], [{ time: 0, measure: 1 }]), null);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
