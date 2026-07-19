/*
 * Piano-roll vertical scroll + stretch/compact.
 *
 * THE PROBLEM: the roll never overflowed, because it SQUASHED instead. Lane
 * height was derived and untouchable — `max(4, min(14, 350 / range))` — so it
 * packed any pitch range into ~350px. A wide range collapsed to a 4px lane:
 * readable-ish, useless for editing, and with no way out. That is why the
 * drum-grid reachability fix (#327) deliberately left the roll alone.
 *
 * The derived value is now the DEFAULT. `S.rollLaneH` is a user override, and
 * vertical scrolling (shared with the drum grid via lane-scroll.js) is what
 * makes a taller-than-viewport roll usable.
 *
 * Reference: Live binds Alt/Option+scroll to key-track zoom (Live 12 manual
 * p.153, p.240); Logic exposes the same as a Vertical Zoom slider (p.297).
 *
 * Run: node --test tests/roll_vertical_zoom.test.mjs
 */
import assert from 'node:assert';
import test from 'node:test';

import {
    PIANO_LANE_H, ROLL_LANE_H_MAX, ROLL_LANE_H_MIN,
    _applyRollLaneH, _rollAutoLaneHPure, _rollLaneHPure,
    midiToY, pianoLaneCount, pianoRange, rollResetLaneH, rollZoomVertical, updatePianoRange, yToMidi,
} from '../src/keys.js';
import { TIMELINE_TOP, WAVEFORM_H } from '../src/geometry.js';
import { S } from '../src/state.js';

const LANE_TOP = TIMELINE_TOP + WAVEFORM_H;

function reset() {
    S.rollLaneH = 0;
    S.laneScrollY = 0;
    S.arrangements = [];
    S.currentArr = 0;
    rollResetLaneH();
}

// ── The squash that made this necessary ──────────────────────────────

test('the auto-fit height is unchanged for a narrow range', () => {
    // 25 semitones ⇒ 350/25 = 14, which is the ceiling. Same as before.
    assert.strictEqual(_rollAutoLaneHPure(25), 14);
});

test('the auto-fit height still collapses a wide range — the old pathology', () => {
    // 10 octaves. 350/121 ≈ 2.9 ⇒ floored at 4px per semitone. Preserved as
    // the DEFAULT so nothing changes for anyone who never reaches for the
    // gesture; the override below is the way out.
    assert.strictEqual(_rollAutoLaneHPure(121), 4);
});

// ── The override ─────────────────────────────────────────────────────

test('no override falls back to auto-fit', () => {
    assert.strictEqual(_rollLaneHPure(0, 25), _rollAutoLaneHPure(25));
    assert.strictEqual(_rollLaneHPure(null, 121), 4);
    assert.strictEqual(_rollLaneHPure(undefined, 60), _rollAutoLaneHPure(60));
});

test('an override wins over auto-fit', () => {
    // The whole point: a 10-octave range no longer forces a 4px lane.
    assert.strictEqual(_rollLaneHPure(22, 121), 22);
});

test('an override is clamped at both ends', () => {
    assert.strictEqual(_rollLaneHPure(9999, 60), ROLL_LANE_H_MAX);
    assert.strictEqual(_rollLaneHPure(0.001, 60), ROLL_LANE_H_MIN);
});

test('a garbage override degrades to auto-fit rather than NaN geometry', () => {
    for (const bad of [NaN, -5, 'tall', {}]) {
        assert.strictEqual(_rollLaneHPure(bad, 25), _rollAutoLaneHPure(25));
    }
});

// ── The gesture ──────────────────────────────────────────────────────

test('stretching then compacting returns to where it started', () => {
    reset();
    updatePianoRange();
    const start = PIANO_LANE_H;
    rollZoomVertical(1.15);
    assert.ok(PIANO_LANE_H > start, 'stretch must grow the lane');
    rollZoomVertical(1 / 1.15);
    assert.ok(Math.abs(PIANO_LANE_H - start) < 1e-9, 'compact must undo it');
});

test('zoom clamps silently at the ceiling instead of running away', () => {
    reset();
    updatePianoRange();
    for (let i = 0; i < 100; i++) rollZoomVertical(1.15);
    assert.strictEqual(PIANO_LANE_H, ROLL_LANE_H_MAX);
});

test('zoom clamps at the floor', () => {
    reset();
    updatePianoRange();
    for (let i = 0; i < 100; i++) rollZoomVertical(0.87);
    assert.strictEqual(PIANO_LANE_H, ROLL_LANE_H_MIN);
});

test('a nonsense factor is a no-op, not a corrupted lane height', () => {
    reset();
    updatePianoRange();
    const before = PIANO_LANE_H;
    for (const bad of [0, -1, NaN, 'big']) {
        assert.strictEqual(rollZoomVertical(bad), before);
    }
    assert.strictEqual(PIANO_LANE_H, before);
});

test('reset returns to auto-fit', () => {
    reset();
    updatePianoRange();
    const auto = PIANO_LANE_H;
    rollZoomVertical(1.15);
    rollZoomVertical(1.15);
    assert.notStrictEqual(PIANO_LANE_H, auto);
    rollResetLaneH();
    assert.strictEqual(PIANO_LANE_H, auto);
    assert.strictEqual(S.rollLaneH, 0);
});

test('the override survives a range recompute', () => {
    // updatePianoRange runs on every edit that changes the pitch extent. It
    // must not stomp a height the user chose — that would make the gesture
    // feel like it randomly resets.
    reset();
    updatePianoRange();
    S.rollLaneH = 20;
    _applyRollLaneH();
    updatePianoRange();
    assert.strictEqual(PIANO_LANE_H, 20);
});

// ── Scroll geometry ──────────────────────────────────────────────────

test('an unscrolled roll is byte-identical to the old geometry', () => {
    reset();
    updatePianoRange();
    assert.strictEqual(midiToY(pianoRange.hi), LANE_TOP);
    assert.strictEqual(midiToY(pianoRange.hi - 3), LANE_TOP + 3 * PIANO_LANE_H);
});

test('scrolling shifts pitches up by exactly the offset', () => {
    reset();
    updatePianoRange();
    const before = midiToY(pianoRange.hi);
    S.laneScrollY = 120;
    assert.strictEqual(midiToY(pianoRange.hi), before - 120);
    S.laneScrollY = 0;
});

test('scrolled geometry round-trips: y -> midi -> y', () => {
    // The hit-test must agree with the painter under scroll, or you click one
    // key and edit another.
    reset();
    updatePianoRange();
    S.laneScrollY = 137;
    try {
        for (const midi of [pianoRange.hi, pianoRange.hi - 12, pianoRange.lo]) {
            const y = midiToY(midi) + PIANO_LANE_H / 2;
            assert.strictEqual(yToMidi(y), midi, `pitch ${midi} must hit-test to itself`);
        }
    } finally { S.laneScrollY = 0; }
});

test('a stretched roll genuinely needs scrolling — the two halves connect', () => {
    // Stretch is only usable BECAUSE the roll scrolls: at 40px/semitone even a
    // 2-octave range is 1000px, past any real canvas.
    reset();
    updatePianoRange();
    S.rollLaneH = ROLL_LANE_H_MAX;
    _applyRollLaneH();
    const contentH = pianoLaneCount() * PIANO_LANE_H;
    assert.ok(contentH > 700,
        `a fully stretched roll (${contentH.toFixed(0)}px) must exceed a typical canvas`);
});
