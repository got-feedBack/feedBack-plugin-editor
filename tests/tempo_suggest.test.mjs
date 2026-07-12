/*
 * Tests for assisted tempo mapping (src/tempo-suggest.js) — the suggest-fit
 * engine over the onset strip, its accept-through apply, and the
 * proposal-only lifecycle (editGen staleness, dismissal).
 *
 * Pinned here: the march tracks a real tempo that differs from the grid
 * (drift EMA), stops instead of guessing through silence (trailing misses
 * dropped), pins locked downbeats at their own times, applies accept-through
 * with pole-drag interior re-spacing while leaving unaccepted spans' far
 * edges fixed, and reads as INACTIVE the moment any edit bumps editGen —
 * nothing can ever commit from stale proposals.
 *
 * Run: node tests/tempo_suggest.test.mjs
 */
import assert from 'node:assert';

globalThis.document = globalThis.document || {
    getElementById: () => null, addEventListener: () => {}, activeElement: null,
};
globalThis.localStorage = globalThis.localStorage || { getItem: () => null, setItem: () => {} };
globalThis.window = globalThis.window || globalThis;

const {
    _suggestFitPure, _suggestApplyPure, _suggestOnsetNearPure, _suggestDownbeatsFromPure,
    _suggestHudTextPure, _suggestCompute, _suggestActive, _suggestProposals,
    _suggestDismiss, _suggestRegenerateFrom, _suggestHitAt,
    _suggestBeatWinPure, _suggestCombPure, _suggestMedianPure, _suggestAnyOnsetInPure,
} = await import('../src/tempo-suggest.js');
const { S, bumpEditGen } = await import('../src/state.js');
const { timeToX } = await import('../src/geometry.js');

let pass = 0, fail = 0;
function t(name, fn) {
    try { fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}

// A 4/4 grid at `bpm`: `bars` downbeats + 3 interior beats each.
function grid(bars, bpm, start = 0) {
    const beat = 60 / bpm;
    const beats = [];
    for (let m = 0; m < bars; m++) {
        for (let b = 0; b < 4; b++) {
            beats.push({ time: start + (m * 4 + b) * beat, measure: b === 0 ? m + 1 : 0 });
        }
    }
    return beats;
}
// Onsets on every downbeat of a real tempo.
function onsetsAt(bpm, count, strength = 0.9, start = 0) {
    const bar = (60 / bpm) * 4;
    return Array.from({ length: count }, (_, k) => ({ t: start + k * bar, s: strength }));
}

// Onsets on every BEAT of a real tempo (a fully-played 4/4 pulse) — the comb
// corroboration (c2) reads this as high-confidence, unlike a bare downbeat.
function onsetsAllBeats(bpm, bars, start = 0) {
    const beat = 60 / bpm;
    const out = [];
    for (let k = 0; k < bars * 4; k++) out.push({ t: start + k * beat, s: k % 4 === 0 ? 0.9 : 0.75 });
    return out;
}

// ── Pures ────────────────────────────────────────────────────────────

t('downbeats-from lists downbeat indices starting at the anchor', () => {
    const g = grid(3, 120);
    assert.deepStrictEqual(_suggestDownbeatsFromPure(g, 0), [0, 4, 8]);
    assert.deepStrictEqual(_suggestDownbeatsFromPure(g, 1), [4, 8]);
    assert.deepStrictEqual(_suggestDownbeatsFromPure(null, 0), []);
});

t('onset-near: dead-on weak hit beats loud edge hit only when strong enough', () => {
    const onsets = [{ t: 1.0, s: 0.5 }, { t: 1.22, s: 0.9 }];
    // Window ±0.25 around 1.0: dead-on 0.5 scores 0.5; edge 0.9 scores
    // 0.9*(1-0.6*0.88)=0.42 — the dead-on hit wins.
    const hit = _suggestOnsetNearPure(onsets, 1.0, 0.25);
    assert.strictEqual(hit.t, 1.0);
    assert.strictEqual(_suggestOnsetNearPure(onsets, 5.0, 0.2), null);
    assert.strictEqual(_suggestOnsetNearPure([], 1.0, 0.2), null);
});

t('the march tracks a real tempo that differs from the grid (drift + comb conf)', () => {
    const g = grid(12, 120);                 // grid thinks 120 (bar = 2.0s)
    const real = onsetsAllBeats(126, 12);    // recording is 126 (bar ≈ 1.905s), fully played
    const { proposals, stopReason } = _suggestFitPure(g, real, 0);
    assert.strictEqual(stopReason, 'end');
    assert.strictEqual(proposals.length, 11, 'every following downbeat proposed');
    const barReal = (60 / 126) * 4;
    proposals.forEach((p, k) => {
        assert.ok(Math.abs(p.time - (k + 1) * barReal) < 0.09, `bar ${k + 2} within 90ms of truth`);
        // A fully-played, steady bar is confident (comb × continuity × consistency).
        assert.ok(p.conf > 0.4, `bar ${k + 2} confident (${p.conf.toFixed(2)})`);
    });
    for (let i = 1; i < proposals.length; i++) {
        assert.ok(proposals[i].time > proposals[i - 1].time, 'strictly increasing');
    }
});

t('silence stops the march and drops the trailing guesses', () => {
    const g = grid(12, 120);
    const real = onsetsAt(126, 6);           // onsets die after bar 6
    const { proposals, stopReason } = _suggestFitPure(g, real, 0);
    assert.strictEqual(stopReason, 'lost');
    assert.strictEqual(proposals.length, 5, 'ends at the last corroborated downbeat');
    assert.ok(proposals.every(p => p.conf > 0.12), 'no bare guesses survive');
});

t('a locked downbeat is pinned at its own time with full confidence', () => {
    const g = grid(12, 120);
    g[5 * 4].locked = true;                  // lock bar 6's downbeat
    const real = onsetsAt(120, 12);          // recording agrees with the grid
    const { proposals } = _suggestFitPure(g, real, 0);
    const lockedP = proposals.find(p => p.i === 5 * 4);
    assert.ok(lockedP && lockedP.locked, 'locked proposal flagged');
    assert.strictEqual(lockedP.conf, 1);
    assert.strictEqual(lockedP.time, g[5 * 4].time, 'never moved');
});

t('apply: accept-through moves the accepted downbeats, re-spaces interiors, holds the rest', () => {
    const g = grid(4, 120);                  // downbeats at 0, 2, 4, 6
    const proposals = [
        { i: 4, time: 2.2, conf: 0.8, locked: false },
        { i: 8, time: 4.3, conf: 0.8, locked: false },
    ];
    const out = _suggestApplyPure(g, proposals, 4);   // accept through bar 2 only
    assert.strictEqual(out.length, g.length, 'equal beat count (TempoMapCmd invariant)');
    assert.strictEqual(out[4].time, 2.2, 'accepted downbeat moved');
    assert.strictEqual(out[8].time, 4.0, 'unaccepted downbeat untouched');
    assert.strictEqual(out[12].time, 6.0, 'far grid untouched');
    // Interior of bar 1 (0 → 2.0 became 0 → 2.2): fractions hold.
    assert.ok(Math.abs(out[1].time - 0.55) < 1e-9, 'bar-1 interior re-spaced');
    // Interior of bar 2 (2.0→4.0 became 2.2→4.0): re-spaced against the
    // FIXED far edge, exactly like a pole drag's neighbor re-space.
    assert.ok(Math.abs(out[5].time - (2.2 + 0.25 * (4.0 - 2.2))) < 1e-9, 'bar-2 interior re-spaced to fixed edge');
    assert.strictEqual(_suggestApplyPure(g, proposals, 99), null, 'unknown through-index refuses');
});

t('apply honors a pinned lock (proposal at own time = no movement)', () => {
    const g = grid(4, 120);
    g[8].locked = true;
    const proposals = [
        { i: 4, time: 2.2, conf: 0.8, locked: false },
        { i: 8, time: 4.0, conf: 1, locked: true },
    ];
    const out = _suggestApplyPure(g, proposals, 8);
    assert.strictEqual(out[8].time, 4.0);
    assert.strictEqual(out[8].locked, true, 'lock flag survives');
});

t('HUD text reports count, confidence, and the stopped-early hint', () => {
    assert.ok(_suggestHudTextPure(7, 0.82, 'end').includes('7 barlines'));
    assert.ok(_suggestHudTextPure(1, 0.5, 'end').includes('1 barline ('));
    assert.ok(_suggestHudTextPure(3, 0.4, 'lost').includes('add an anchor'));
});

// ── Lifecycle: proposal-only, staleness, regeneration ────────────────

t('compute → active; any edit (editGen bump) reads as inactive', () => {
    Object.assign(S, { tempoMapMode: true, beats: grid(12, 120), zoom: 100, scrollX: 0 });
    const n = _suggestCompute(0, onsetsAt(126, 12));
    assert.strictEqual(n, 11);
    assert.strictEqual(_suggestActive(), true);
    assert.strictEqual(_suggestProposals().length, 11);
    bumpEditGen();
    assert.strictEqual(_suggestActive(), false, 'stale generation is inactive');
    assert.deepStrictEqual(_suggestProposals(), [], 'no proposals from a stale run');
});

t('regenerate-from re-keys to the current generation with the remembered onsets', () => {
    const n = _suggestRegenerateFrom(4);
    assert.ok(n >= 1);
    assert.strictEqual(_suggestActive(), true);
    assert.ok(_suggestProposals().every(p => p.i > 4), 'only the unconfirmed future');
});

t('dismiss clears; leaving tempo-map mode reads as inactive', () => {
    _suggestRegenerateFrom(0);
    assert.strictEqual(_suggestActive(), true);
    S.tempoMapMode = false;
    assert.strictEqual(_suggestActive(), false, 'mode-scoped');
    S.tempoMapMode = true;
    assert.strictEqual(_suggestActive(), true);
    _suggestDismiss();
    assert.strictEqual(_suggestActive(), false);
});

t('compute without onsets refuses (no proposals, inactive)', () => {
    assert.strictEqual(_suggestCompute(0, null), 0);
    assert.strictEqual(_suggestActive(), false);
});

t('ghost hit-test finds the proposal nearest x within the grab half-width', () => {
    Object.assign(S, { tempoMapMode: true, beats: grid(12, 120), zoom: 100, scrollX: 0 });
    _suggestCompute(0, onsetsAt(126, 12));
    const p = _suggestProposals()[0];
    assert.strictEqual(_suggestHitAt(timeToX(p.time), 7), p.i);
    assert.strictEqual(_suggestHitAt(timeToX(p.time) + 30, 7), -1);
    _suggestDismiss();
});

// ── Hardening (PR 7) — each fixture fails on the pre-hardening engine ─

// beats with N-beat bars: a downbeat every `beatsInBar` beats of `beatSec`.
function barsOfBeats(nBars, beatsInBar, beatSec, start = 0) {
    const b = [];
    for (let m = 0; m < nBars; m++) {
        for (let k = 0; k < beatsInBar; k++) {
            b.push({ time: start + (m * beatsInBar + k) * beatSec, measure: k === 0 ? m + 1 : -1 });
        }
    }
    return b;
}

// c1 — beat-relative window
t('c1: the snap window is beat-relative — a syncopation in a long bar is not grabbed', () => {
    // 8-beat bars (0.5 s beat ⇒ 4 s bar). The old ±12% of the BAR (±0.48 s) grabs
    // a 0.35 s-late syncopation; beat-relative (±0.45 beat = ±0.225 s) rejects it,
    // so the barline holds its prediction (4.0) instead of the syncopation (4.35).
    const g = barsOfBeats(3, 8, 0.5);                  // downbeats at idx 0,8,16 (t 0,4,8)
    const onsets = [{ t: 2.0, s: 0.6 }, { t: 4.35, s: 0.95 }, { t: 8.0, s: 0.9 }];
    const { proposals } = _suggestFitPure(g, onsets, 0);
    const p = proposals.find(x => x.i === 8);
    assert.ok(p, 'bar 2 was proposed');
    assert.ok(Math.abs(p.time - 4.0) < 0.05, `held the prediction, not the syncopation (got ${p.time.toFixed(2)})`);
    assert.ok(Math.abs(_suggestBeatWinPure(4.0, 8, 0.45, 0.025) - 0.225) < 1e-9, 'window is ½-beat, not ½-bar');
});

// c2 + c6 — comb corroboration drives a product confidence
t('c2/c6: a fully-played bar is far more confident than a bare-downbeat bar', () => {
    const g = grid(6, 120);
    const bare = _suggestFitPure(g, onsetsAt(120, 6), 0).proposals[0];
    const full = _suggestFitPure(g, onsetsAllBeats(120, 6), 0).proposals[0];
    // Pre-hardening both scored the downbeat onset alone → equal confidence.
    assert.ok(full.conf > bare.conf + 0.2, `comb lifts confidence (full ${full.conf.toFixed(2)} vs bare ${bare.conf.toFixed(2)})`);
    assert.ok(Math.abs(_suggestCombPure(onsetsAllBeats(120, 6), 0, 2, 4, 0.2) - _suggestCombPure(onsetsAt(120, 6), 0, 2, 4, 0.2)) > 0.3, 'comb sees the interior beats');
});

// c2 + c3 — dense interior beats must not masquerade as downbeats
t('c2/c3: a better full-bar comb outside the snap window stops instead of accepting an interior beat', () => {
    const g = grid(8, 120);                  // grid downbeat prediction is 2.0s
    const real = onsetsAllBeats(90, 8);      // real next downbeat is 2.667s; 2.0s is only an interior beat
    const { stopReason, stopDetail, proposals } = _suggestFitPure(g, real, 0);
    assert.strictEqual(stopReason, 'lost');
    assert.strictEqual(stopDetail, 'tempo-jump');
    assert.strictEqual(proposals.length, 0, 'refuses the wrong-pulse interior hit');
});

// c3 — median stretch + a single big correction stops
t('c3: a single >25% correction stops (tempo-jump) instead of snapping the grid', () => {
    // Every beat a downbeat (beatsInBar=1) so the window admits the jumped onset.
    const g = barsOfBeats(6, 1, 1.0);                  // downbeats at t 0..5
    const onsets = [{ t: 1.0, s: 0.9 }, { t: 2.0, s: 0.9 }, { t: 3.4, s: 0.95 }, { t: 4.4, s: 0.9 }];
    const { stopReason, stopDetail, proposals } = _suggestFitPure(g, onsets, 0);
    assert.strictEqual(stopReason, 'lost');
    assert.strictEqual(stopDetail, 'tempo-jump');
    assert.ok(proposals.every(p => p.time <= 2.0 + 1e-9), 'stopped before the jumped bar');
});

t('c3: the stretch tracker is a median of recent bars, not a single-sample EMA', () => {
    assert.strictEqual(_suggestMedianPure([1, 1, 1.4, 1, 1]), 1, 'one outlier does not move the median');
    assert.strictEqual(_suggestMedianPure([1, 2]), 1.5);
    assert.strictEqual(_suggestMedianPure([]), null);
});

// c4 — half/double-time phase ambiguity
t('c4: a half-time snap is refused as a phase ambiguity, not tracked', () => {
    // A wide window reaches the half-bar onset; rawStretch ≈ 0.5 ⇒ phase stop.
    const g = grid(4, 120);                            // bar 2.0 s
    const onsets = [{ t: 1.0, s: 0.95 }, { t: 2.0, s: 0.5 }];
    const { stopReason, stopDetail } = _suggestFitPure(g, onsets, 0, { winFrac: 3 });
    assert.strictEqual(stopReason, 'lost');
    assert.strictEqual(stopDetail, 'phase');
});

// c5 — silent bar stops; sustained bar keeps marching
t('c5: a silent bar stops; a sustained bar (onsets off the downbeat) keeps marching', () => {
    const g = grid(6, 120);                            // downbeats 0,2,4,6,8,10
    const silent = _suggestFitPure(g, [{ t: 2.0, s: 0.9 }], 0);
    assert.strictEqual(silent.stopDetail, 'silence');
    // Mid-bar onsets (off the downbeat) inside bars 3 & 4, then bar 5 lands again.
    const sustained = _suggestFitPure(g, [
        { t: 2.0, s: 0.9 }, { t: 3.0, s: 0.6 }, { t: 5.0, s: 0.6 }, { t: 8.0, s: 0.9 },
    ], 0);
    assert.ok(sustained.proposals.length > silent.proposals.length, 'sustained marched past where silence stopped');
    assert.strictEqual(_suggestAnyOnsetInPure([{ t: 3.0 }], 2.01, 4.2), true);
    assert.strictEqual(_suggestAnyOnsetInPure([{ t: 3.0 }], 4.0, 6.0), false);
});

// c7 — out-of-range tempo refused + named HUD reasons
t('c7: an out-of-range tempo is refused (bpm-range) and the HUD names each stop', () => {
    const g = barsOfBeats(3, 4, 0.1875);               // 4/4 at 320 BPM — above 300
    const onsets = [{ t: 0.75, s: 0.9 }, { t: 1.5, s: 0.9 }];
    assert.strictEqual(_suggestFitPure(g, onsets, 0).stopDetail, 'bpm-range');
    assert.ok(_suggestHudTextPure(3, 0.5, 'lost', 'silence').includes('silence'));
    assert.ok(_suggestHudTextPure(3, 0.5, 'lost', 'phase').includes('half/double'));
    assert.ok(_suggestHudTextPure(3, 0.5, 'lost', 'tempo-jump').includes('tempo change'));
    assert.ok(_suggestHudTextPure(3, 0.5, 'lost', 'bpm-range').includes('out-of-range'));
    assert.ok(_suggestHudTextPure(3, 0.5, 'lost').includes('add an anchor'), 'unknown detail keeps the generic line');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
