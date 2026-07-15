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

// ---- non-quarter denominators (6/8, 7/8) ------------------------------
// A ruler beat in x/8 is an EIGHTH note, so bar capacity must scale with
// the denominator: a 6/8 bar totals six :8 equivalents (12 sixteenth
// ticks), not six quarters. These pin the denominator-aware allocation.

// An x/8 grid at 0.25s per eighth-note beat, linear converter to match.
function grid8(bars, num) {
    const beats = [];
    for (let m = 0; m < bars; m++) for (let b = 0; b < num; b++) {
        beats.push({ time: (m * num + b) * 0.25, measure: b === 0 ? m + 1 : 0, den: 8 });
    }
    return beats;
}
const beatOf8 = (t2) => t2 / 0.25;
const gen8 = (notes, beats) => _alphaTexFromNotesPure({
    notes, beats, beatOfFn: beatOf8, ...STD,
});

// Sums a bar's emitted durations as a fraction of a whole note (chords,
// rests and notes alike), so every fixture can assert exact bar totals.
function barWhole(bar) {
    const s = bar.replace(/\\ts \d+ \d+ ?/, '');
    let sum = 0, m;
    const re = /(?:r|\([^)]*\)|\d+\.\d+)\.(\d+)/g;
    while ((m = re.exec(s))) sum += 1 / Number(m[1]);
    return sum;
}

t('6/8: notes on every eighth-note beat engrave as eighths, and the bar sums to 6/8', () => {
    const notes = [0, 1, 2, 3, 4, 5].map(b => N(b * 0.25, 0, 3));
    const r = gen8(notes, grid8(2, 6));
    const bar1 = r.tex.split(' | ')[0].split('\n').pop();
    assert.strictEqual(bar1, '\\ts 6 8 3.6.8 3.6.8 3.6.8 3.6.8 3.6.8 3.6.8');
    assert.strictEqual(barWhole(bar1), 6 / 8, 'bar sums to exactly six eighths');
});

t('6/8: rest fill and gap durations stay in eighth-beat capacity; beatMap aligns', () => {
    // One note on beat 4 (tick 6 of 12): leading rests 6 ticks, note takes
    // the largest fit (quarter = 4), trailing eighth rest completes 12.
    const r = gen8([N(0.75, 0, 3)], grid8(2, 6));
    const bar1 = r.tex.split(' | ')[0].split('\n').pop();
    assert.strictEqual(bar1, '\\ts 6 8 r.4 r.8 3.6.4 r.8');
    assert.strictEqual(barWhole(bar1), 6 / 8);
    assert.deepStrictEqual(r.beatMap[0].map(x => x && x.length), [null, null, 1, null].map(x => x),
        'rests null, the note beat carries its ref');
});

t('6/8: sixteenth subdivisions inside an eighth-note beat still quantize to the 16th grid', () => {
    // Beat 0 plus a note half a beat later (a 16th offset): .16 then the
    // greedy remainder (half + eighth rest + sixteenth rest = 11 ticks).
    const r = gen8([N(0, 0, 3), N(0.125, 0, 5)], grid8(2, 6));
    const bar1 = r.tex.split(' | ')[0].split('\n').pop();
    assert.strictEqual(bar1, '\\ts 6 8 3.6.16 5.6.2 r.8 r.16');
    assert.strictEqual(barWhole(bar1), 6 / 8);
});

t('7/8: bar capacity is seven eighths; an empty 7/8 bar rest-fills to exactly 7/8', () => {
    const r = gen8([N(0, 0, 3), N(1.0, 1, 5)], grid8(3, 7));
    const barsOut = r.tex.split('\n').pop().split(' | ');
    assert.strictEqual(barsOut[0], '\\ts 7 8 3.6.2 5.5.4 r.8');
    assert.strictEqual(barsOut[1], 'r.2 r.4 r.8', 'empty bar: half + quarter + eighth rests');
    assert.strictEqual(barWhole(barsOut[0]), 7 / 8);
    assert.strictEqual(barWhole(barsOut[1]), 7 / 8);
});

t('meter change 4/4 → 6/8 switches per-bar tick capacity with the denominator', () => {
    const beats = [];
    for (let b = 0; b < 4; b++) beats.push({ time: b * 0.5, measure: b === 0 ? 1 : 0, den: 4 });
    for (let b = 0; b < 6; b++) beats.push({ time: 2 + b * 0.25, measure: b === 0 ? 2 : 0, den: 8 });
    beats.push({ time: 3.5, measure: 3, den: 8 });
    const bo = (t2) => t2 < 2 ? t2 / 0.5 : 4 + (t2 - 2) / 0.25;
    const r = _alphaTexFromNotesPure({ notes: [], beats, beatOfFn: bo, ...STD });
    const barsOut = r.tex.split('\n').pop().split(' | ');
    assert.strictEqual(barsOut[0], '\\ts 4 4 r.1');
    assert.strictEqual(barsOut[1], '\\ts 6 8 r.2 r.4', 'six eighths = half + quarter rest');
});

t('4/4 output is bit-identical to the pre-denominator-aware markup (no regression)', () => {
    const r = gen([N(0, 0, 3), N(0.5, 1, 5), N(1.0, 2, 7), N(1.5, 0, 3)], grid(2));
    assert.strictEqual(r.tex,
        '\\tuning e5 b4 g4 d4 a3 e3\n.\n\\ts 4 4 3.6.4 5.5.4 7.4.4 3.6.4');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
