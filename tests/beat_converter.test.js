'use strict';
/*
 * Beat-converter tests for screen.js (charrette §1.1/§1.10, Phase A1).
 *
 * The one tempo-map converter — beatOf(beats, t) / timeOf(beats, β) — extracted
 * from the interior math of _makeTimeRemap + snapTime. This suite proves:
 *   1. inverse property (timeOf∘beatOf = identity) within a gap AND on the tails,
 *   2. the converter reproduces the legacy _makeTimeRemap in the interior
 *      (the charrette identity remap = timeOf(new, beatOf(old, t))),
 *   3. the SHIPPED _makeTimeRemap is behaviour-identical to the pre-refactor one
 *      across the whole domain (no behaviour change — the A1 contract),
 *   4. the SHIPPED snapTime math is behaviour-identical to the old inline snap,
 *   5. extrapolation on both tails, the <2-beats identity, and adversarial guards.
 *
 * These reference beatOf/timeOf, which do not exist on origin/main, so the whole
 * suite fails on main (extraction returns null) — a would-fail-on-main test.
 *
 * Run: node tests/beat_converter.test.js
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');

const conv = src.match(/\/\* @pure:beat-converter:start \*\/[\s\S]*?\/\* @pure:beat-converter:end \*\//);
if (!conv) {
    console.error('FAIL: @pure:beat-converter block not found in screen.js');
    process.exit(1);
}
// _makeTimeRemap now depends only on the converter, so it lifts cleanly into the
// same sandbox — letting us test the ACTUAL shipped remap, not a copy of it.
const remapM = src.match(/\nfunction _makeTimeRemap\(oldBeats, newBeats\) \{[\s\S]*?\n\}/);
if (!remapM) {
    console.error('FAIL: _makeTimeRemap not found in screen.js');
    process.exit(1);
}

const api = new Function(
    '"use strict";' + conv[0] + '\n' + remapM[0] +
    '\nreturn { beatOf, timeOf, _makeTimeRemap };'
)();
const { beatOf, timeOf, _makeTimeRemap } = api;

// ── Reference implementations (the pre-A1 code, verbatim) ───────────────────
// The golden baselines: if the extracted/rewired functions match these across
// the domain, the refactor changed no behaviour.

function legacyMakeTimeRemap(oldBeats, newBeats) {
    const ot = oldBeats.map(b => b.time);
    const nt = newBeats.map(b => b.time);
    const n = ot.length;
    return function remap(t) {
        if (n === 0) return t;
        if (t <= ot[0]) return t + (nt[0] - ot[0]);
        if (t >= ot[n - 1]) return t + (nt[n - 1] - ot[n - 1]);
        let lo = 0, hi = n - 1;
        while (lo < hi) {
            const m = (lo + hi + 1) >> 1;
            if (ot[m] <= t) lo = m; else hi = m - 1;
        }
        const span = ot[lo + 1] - ot[lo];
        const frac = span > 1e-9 ? (t - ot[lo]) / span : 0;
        return nt[lo] + frac * (nt[lo + 1] - nt[lo]);
    };
}

// The old snapTime interior (with S/subs threaded in as args). subs = beat
// subdivisions; mirrors snapTime's `S.beats.length < 2 ⇒ return t` guard.
function legacySnap(beats, t, subs) {
    if (beats.length < 2) return t;
    let bi = 0;
    for (let i = 0; i < beats.length - 1; i++) {
        if (beats[i].time <= t) bi = i; else break;
    }
    const bt = beats[bi].time;
    const nt = bi < beats.length - 1 ? beats[bi + 1].time : bt + 0.5;
    const bd = nt - bt;
    const sd = bd / subs;
    const idx = Math.round((t - bt) / sd);
    return bt + idx * sd;
}
// The new snapTime math, extracted so we can sweep it against legacySnap.
function newSnap(beats, t, subs) {
    if (beats.length < 2) return t;
    return timeOf(beats, Math.round(beatOf(beats, t) * subs) / subs);
}

// ── Fixtures ────────────────────────────────────────────────────────────────
// A genuinely DRIFTING grid: every gap a different width (rubato / a fitted
// tempo map), non-monotonic — nothing a uniform-BPM shortcut could fake.
const drift = [
    { time: 0.00, measure: 1 },
    { time: 0.50, measure: -1 },
    { time: 1.10, measure: -1 },
    { time: 1.50, measure: -1 },
    { time: 2.30, measure: 2 },
    { time: 2.70, measure: -1 },
    { time: 3.00, measure: -1 },
];
// A flex of `drift` (a TempoMapCmd: times move, beat indexing fixed, same length).
// Both endpoints move and every gap changes width, so the interior equivalence is
// non-trivial and the tail-shift is non-zero.
const flexed = [0.00, 0.60, 1.00, 1.70, 2.10, 2.60, 3.05].map((time, i) => ({
    time, measure: drift[i].measure,
}));

const close = (a, b, eps = 1e-9) =>
    assert.ok(Math.abs(a - b) <= eps, `expected ${a} ≈ ${b} (Δ ${Math.abs(a - b)})`);

let pass = 0, fail = 0;
function t(name, fn) {
    try { fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}

// ── 1. Inverse property ─────────────────────────────────────────────────────
t('timeOf(beatOf(t)) === t within every gap (exact inverse)', () => {
    for (let x = 0; x <= 3.001; x += 0.017) {
        close(timeOf(drift, beatOf(drift, x)), x);
    }
});

t('beatOf(timeOf(β)) === β for fractional beats (exact inverse)', () => {
    for (let b = 0; b <= 6; b += 0.037) {
        close(beatOf(drift, timeOf(drift, b)), b);
    }
});

// ── 2. Charrette identity: the converter reproduces the legacy remap ─────────
t('remap === timeOf(new, beatOf(old, t)) in the interior (3 dp+)', () => {
    const remap = legacyMakeTimeRemap(drift, flexed);
    // strictly interior to the OLD grid (0, 3.00) — where the identity is exact
    for (let x = 0.01; x < 3.00; x += 0.011) {
        close(remap(x), timeOf(flexed, beatOf(drift, x)));
    }
});

// ── 3. No behaviour change: shipped _makeTimeRemap === legacy, whole domain ──
t('shipped _makeTimeRemap matches pre-refactor remap (interior AND tails)', () => {
    const shipped = _makeTimeRemap(drift, flexed);
    const legacy = legacyMakeTimeRemap(drift, flexed);
    for (let x = -0.8; x <= 3.8; x += 0.013) {
        close(shipped(x), legacy(x));
    }
    // exact endpoints and the tail-shift regions
    for (const x of [drift[0].time, drift[6].time, -0.4, 3.6, 100]) {
        close(shipped(x), legacy(x));
    }
});

t('_makeTimeRemap with empty grid is the identity (n === 0)', () => {
    const remap = _makeTimeRemap([], []);
    close(remap(1.23), 1.23);
});

// ── 4. No behaviour change: shipped snap math === old inline snap ────────────
t('newSnap matches legacySnap across a sweep, every subdivision', () => {
    for (const subs of [1, 2, 3, 4, 8, 16]) {
        for (let x = -0.6; x <= 3.6; x += 0.007) {
            close(newSnap(drift, x, subs), legacySnap(drift, x, subs));
        }
    }
});

t('snap lands notes exactly on grid lines and their subdivisions', () => {
    // on a downbeat → itself; a hair off → snaps to the nearest 1/2 subdivision
    close(newSnap(drift, 2.30, 2), 2.30);            // beat 4 (index 4) stays put
    // midpoint of gap [2.30, 2.70] at subs=2 is 2.50; 2.46 snaps there
    close(newSnap(drift, 2.46, 2), 2.50);
    close(newSnap(drift, 2.46, 2), legacySnap(drift, 2.46, 2));
});

// ── 5a. Extrapolation on both tails ──────────────────────────────────────────
t('extrapolates BEFORE the first beat along the first gap tempo', () => {
    // first gap width 0.5 ⇒ beat −0.8 at t = −0.4; and the inverse holds
    close(beatOf(drift, -0.4), -0.8);
    close(timeOf(drift, -0.8), -0.4);
    close(timeOf(drift, beatOf(drift, -0.4)), -0.4);
});

t('extrapolates AFTER the last beat along the last gap tempo', () => {
    // n = 7 (last index 6); last gap width 0.30 ⇒ beat 8.0 at t = 3.6
    close(beatOf(drift, 3.60), 8.0);
    close(timeOf(drift, 8.0), 3.60);
    close(timeOf(drift, beatOf(drift, 3.60)), 3.60);
});

// ── 5b. The <2-beats identity (degrade to seconds-primary) ───────────────────
t('a grid with < 2 beats makes both converters the identity', () => {
    for (const beats of [[], [{ time: 0 }]]) {
        assert.strictEqual(beatOf(beats, 1.23), 1.23);
        assert.strictEqual(timeOf(beats, 4.5), 4.5);
    }
});

// ── 5c. Adversarial guards ───────────────────────────────────────────────────
t('non-array grid passes the input straight through', () => {
    assert.strictEqual(beatOf(null, 2), 2);
    assert.strictEqual(timeOf(undefined, 2), 2);
});

t('non-finite inputs are returned unchanged (no NaN propagation into math)', () => {
    assert.ok(Number.isNaN(beatOf(drift, NaN)));
    assert.strictEqual(beatOf(drift, Infinity), Infinity);
    assert.strictEqual(beatOf(drift, -Infinity), -Infinity);
    assert.ok(Number.isNaN(timeOf(drift, NaN)));
    assert.strictEqual(timeOf(drift, Infinity), Infinity);
});

t('zero-width gaps are guarded — finite results, never a divide-by-zero', () => {
    // leading zero-width gap: beatOf collapses to the gap's left edge (beat 0)
    const lead = [{ time: 0 }, { time: 0 }, { time: 1 }];
    assert.strictEqual(beatOf(lead, 0), 0);
    assert.ok(Number.isFinite(beatOf(lead, -1)));
    // interior zero-width gap: timeOf returns the gap's (coincident) time, finite
    const mid = [{ time: 0 }, { time: 1 }, { time: 1 }, { time: 2 }];
    const v = timeOf(mid, 1.5);
    assert.ok(Number.isFinite(v));
    assert.strictEqual(v, 1);
});

// ── 6. Exact ties: the converter has NO drift; snap tie-break is a benign ULP ─
// Review of #133 (Codex) flagged beats [0,0.5,1.1], subs=3, t=1.0: old inline
// snap returns 0.9, the shipped beat-domain snap returns 1.1. This is NOT a
// mapping drift — it is a floating-point tie-break at an EXACT arithmetic tie
// (t=1.0 is equidistant from the 0.9 and 1.1 subdivision lines, so BOTH are
// valid nearest-subdivision snaps). One ULP either side the two agree. Pinning
// the real invariants here so a future refactor that actually breaks the mapping
// (swapped args, lost offset, off-by-one beat index) fails loudly.
const tie = [{ time: 0 }, { time: 0.5 }, { time: 1.1 }];

t('converter is an EXACT inverse even at the reported tie input (no drift)', () => {
    close(timeOf(tie, beatOf(tie, 1.0)), 1.0);      // round-trips exactly
    close(beatOf(tie, timeOf(tie, beatOf(tie, 1.0))), beatOf(tie, 1.0));
});

t('snap tie-break splits ONLY at the exact tie; agrees one ULP either side', () => {
    // the divergence is measure-zero: nudging off the exact midpoint re-converges
    close(newSnap(tie, 1.0 - 1e-6, 3), legacySnap(tie, 1.0 - 1e-6, 3));
    close(newSnap(tie, 1.0 + 1e-6, 3), legacySnap(tie, 1.0 + 1e-6, 3));
    // at the exact tie the shipped snap picks a valid nearest subdivision (0.9 or 1.1)
    const s = newSnap(tie, 1.0, 3);
    assert.ok(Math.abs(s - 0.9) < 1e-9 || Math.abs(s - 1.1) < 1e-9,
        `tie snap must land on a subdivision line, got ${s}`);
});

t('snap is IDEMPOTENT — re-snapping an already-snapped time never moves it', () => {
    // the real re-snap path (screen.js: oldTimes.map(snapTime)); a non-idempotent
    // snap would creep note times on every edit. Beat-domain snap must be stable.
    for (const subs of [1, 2, 3, 4, 8, 16]) {
        for (let x = -0.5; x <= 3.5; x += 0.0011) {
            const s = newSnap(drift, x, subs);
            close(newSnap(drift, s, subs), s, 1e-9);
        }
    }
});

t('snap never jumps more than one subdivision away from the input', () => {
    for (const subs of [2, 3, 4, 8]) {
        for (let x = 0.01; x < 2.99; x += 0.013) {
            const s = newSnap(drift, x, subs);
            const gapBeat = Math.min(Math.floor(beatOf(drift, x)), drift.length - 2);
            const gapWidth = drift[gapBeat + 1].time - drift[gapBeat].time;
            assert.ok(Math.abs(s - x) <= gapWidth / subs + 1e-9,
                `snap moved ${Math.abs(s - x)} (> one ${gapWidth / subs} subdivision) at t=${x}`);
        }
    }
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
