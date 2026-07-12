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

t('the march tracks a real tempo that differs from the grid (drift EMA)', () => {
    const g = grid(12, 120);                 // grid thinks 120 (bar = 2.0s)
    const real = onsetsAt(126, 12);          // recording is 126 (bar ≈ 1.905s)
    const { proposals, stopReason } = _suggestFitPure(g, real, 0);
    assert.strictEqual(stopReason, 'end');
    assert.strictEqual(proposals.length, 11, 'every following downbeat proposed');
    const barReal = (60 / 126) * 4;
    proposals.forEach((p, k) => {
        assert.ok(Math.abs(p.time - (k + 1) * barReal) < 0.09, `bar ${k + 2} within 90ms of truth`);
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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
