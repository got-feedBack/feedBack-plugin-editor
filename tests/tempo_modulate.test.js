'use strict';
/*
 * Tests for metric modulation (@pure:tempo-modulate block): the ratio
 * parser and _tempoModulateRunPure — new tempo = old × ratio applied from
 * the selected measure THROUGH ITS UNIFORM RUN, stopping at the first
 * measure whose BPM materially differs (a hand-authored tempo change is a
 * natural pole the re-space never crosses — design D18).
 *
 * Also pinned: proportional interior re-spacing (swung/uneven sub-beats
 * keep their fractional positions), rigid tail shift after the run, and
 * beat-count preservation (the invariant TempoMapCmd requires).
 *
 * Run: node tests/tempo_modulate.test.js
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const src = fs.readFileSync(path.join(__dirname, '..', 'screen.js'), 'utf8');
const m = src.match(/\/\* @pure:tempo-modulate:start \*\/[\s\S]*?\/\* @pure:tempo-modulate:end \*\//);
if (!m) {
    console.error('FAIL: @pure:tempo-modulate block not found in screen.js');
    process.exit(1);
}
const { _tempoModulationRatioPure, _tempoModulateRunPure } = new Function(
    '"use strict";' + m[0]
    + '\nreturn { _tempoModulationRatioPure, _tempoModulateRunPure };'
)();

let pass = 0, fail = 0;
function t(name, fn) {
    try { fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}

// Grid builder: measures of `beatsPer` beats at `bpm`, starting at t0.
// Returns {beats, next} where next = time after the last measure.
function bars(t0, count, bpm, beatsPer, startMeasure) {
    const beats = [];
    const beatDur = 60 / bpm;
    let t = t0;
    for (let mIdx = 0; mIdx < count; mIdx++) {
        beats.push({ time: +t.toFixed(6), measure: startMeasure + mIdx });
        for (let k = 1; k < beatsPer; k++) {
            beats.push({ time: +(t + k * beatDur).toFixed(6), measure: -1 });
        }
        t += beatsPer * beatDur;
    }
    return { beats, next: t };
}

const r3 = (v) => Math.round(v * 1000) / 1000;

// ── ratio parsing ────────────────────────────────────────────────────────────
t('ratio parser: presets, fractions, decimals, junk', () => {
    assert.strictEqual(_tempoModulationRatioPure('1'), 2 / 3);
    assert.strictEqual(_tempoModulationRatioPure('2'), 3 / 2);
    assert.strictEqual(_tempoModulationRatioPure('3'), 0.5);
    assert.strictEqual(_tempoModulationRatioPure('4'), 2);
    assert.strictEqual(_tempoModulationRatioPure('3:2'), 1.5);
    assert.strictEqual(_tempoModulationRatioPure('2/3'), 2 / 3);
    assert.strictEqual(_tempoModulationRatioPure('0.75'), 0.75);
    assert.strictEqual(_tempoModulationRatioPure(''), null);
    assert.strictEqual(_tempoModulationRatioPure('fast'), null);
    assert.strictEqual(_tempoModulationRatioPure('0'), null);
    assert.strictEqual(_tempoModulationRatioPure('3:0'), null);
    assert.strictEqual(_tempoModulationRatioPure(null), null);
    // Leading-numeric garbage must be REFUSED, not parseFloat-truncated to a
    // plausible-looking ratio (3:2:1→3, 2/3/4→2, 3abc→3 would all sneak in).
    assert.strictEqual(_tempoModulationRatioPure('3:2:1'), null);
    assert.strictEqual(_tempoModulationRatioPure('2/3/4'), null);
    assert.strictEqual(_tempoModulationRatioPure('3abc'), null);
});

// ── the uniform run boundary ─────────────────────────────────────────────────
t('run stops at the next tempo change (hand-authored pole untouched)', () => {
    // 4 bars of 4/4 at 120, then 2 bars at 90 (a real tempo change), then a
    // terminator downbeat.
    const a = bars(0, 4, 120, 4, 1);
    const b = bars(a.next, 2, 90, 4, 5);
    const beats = [...a.beats, ...b.beats, { time: b.next, measure: 7 }];
    const res = _tempoModulateRunPure(beats, 0, 1.5, 0.05, r3, 0.005);
    assert.ok(res, 'modulation applies');
    assert.strictEqual(res.count, 4, 'only the 4 uniform 120-BPM bars modulate');
    assert.ok(Math.abs(res.newBpm - 180) < 1e-9);
    // The 90-BPM section keeps its INTERNAL spacing (rigid shift only).
    // Tolerance = one 1 ms rounding quantum: beat times are quantized via
    // the editor's _r3, so a shifted span can wobble by ±0.001 s.
    const oldSpan90 = beats[20].time - beats[16].time;
    const newSpan90 = res.beats[20].time - res.beats[16].time;
    assert.ok(Math.abs(oldSpan90 - newSpan90) < 0.0015, '90-BPM bar span unchanged');
});

t('new tempo: ×1.5 shrinks the modulated span by 2/3 and shifts the tail', () => {
    const a = bars(0, 2, 120, 4, 1);
    const beats = [...a.beats, { time: a.next, measure: 3 }];
    // 2 bars of 4 beats at 120 = 4 s total; at 180 → 8/3 s.
    const res = _tempoModulateRunPure(beats, 0, 1.5, 0.05, r3, 0.005);
    assert.ok(Math.abs(res.beats[8].time - 8 / 3) < 0.002, 'terminator lands at 8/3 s');
    assert.strictEqual(res.beats.length, beats.length, 'beat count preserved');
});

t('proportional re-space preserves swung sub-beat fractions', () => {
    // One bar 0..2 s with a SWUNG mid-beat at 0.7 (not 0.5 of the bar).
    const beats = [
        { time: 0, measure: 1 },
        { time: 1.4, measure: -1 },     // 70% through the bar
        { time: 2.0, measure: 2 },      // terminator
    ];
    const res = _tempoModulateRunPure(beats, 0, 2, 0.05, r3, 0.005);
    // Bar halves to 1 s; the swung beat must sit at 0.7, not 0.5.
    assert.ok(Math.abs(res.beats[1].time - 0.7) < 1e-6, 'fraction preserved');
    assert.ok(Math.abs(res.beats[2].time - 1.0) < 1e-6);
});

t('selection mid-run modulates from there to the run end only', () => {
    const a = bars(0, 4, 120, 4, 1);
    const beats = [...a.beats, { time: a.next, measure: 5 }];
    const res = _tempoModulateRunPure(beats, 8, 1.5, 0.05, r3, 0.005); // bar 3's downbeat
    assert.strictEqual(res.count, 2, 'bars 3–4 modulate');
    assert.strictEqual(res.beats[4].time, beats[4].time, 'bar 2 untouched');
});

t('refuses when the result would violate the minimum measure span', () => {
    const a = bars(0, 1, 120, 4, 1);
    const beats = [...a.beats, { time: a.next, measure: 2 }];
    // ×5 on a 2 s bar → 0.4 s; with minMeasure 0.5 it must refuse.
    assert.strictEqual(_tempoModulateRunPure(beats, 0, 5, 0.5, r3, 0.005), null);
});

t('invalid targets return null (sub-beat index, final measure, ratio 1)', () => {
    const a = bars(0, 2, 120, 4, 1);
    const beats = [...a.beats, { time: a.next, measure: 3 }];
    assert.strictEqual(_tempoModulateRunPure(beats, 1, 1.5, 0.05, r3, 0.005), null, 'sub-beat');
    assert.strictEqual(_tempoModulateRunPure(beats, beats.length - 1, 1.5, 0.05, r3, 0.005), null, 'final');
    assert.strictEqual(_tempoModulateRunPure(beats, 0, 1, 0.05, r3, 0.005), null, 'ratio 1');
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
