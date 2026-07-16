/*
 * Metronome Guide + Whole Fit (tempo-suggest guide routing, the metronome
 * fit engine, the completion tail, the open-final-measure carry, and the
 * Accept Whole Fit verb).
 *
 * Pinned here:
 *   - a LOCKED metronome guide is a stronger analysis contract: consolidated
 *     transients are beat pulses walked by the chart's authored
 *     beats-per-measure, so real tempo changes in the click are followed
 *     instead of rejected as drift;
 *   - a locked barline stays at its authored time AND the pulse walk keeps
 *     advancing by beat count — one stale lock can never shift every later
 *     suggestion onto the wrong click phase;
 *   - pulse dropout continues on the recent median gap at low confidence
 *     with an honest `inferred` flag — complete but visibly uncertain;
 *   - ordinary (non-guide) fits carry a low-confidence completion tail to
 *     chart end (never auto-committed — proposals only);
 *   - accepting through the FINAL authored downbeat rescales the open last
 *     measure's interior beats (equal-length TempoMapCmd invariant);
 *   - the focused marker always anchors a fit — a stale multi-selection can
 *     no longer reset analysis toward the beginning or cap the march;
 *   - Accept Whole Fit commits every proposal as ONE undoable edit;
 *   - the guide role round-trips: lock via editorToggleTempoGuide, persists
 *     through trackSessionSavePayload, unlock returns to the default tree.
 *
 * Run: node tests/metronome_guide.test.mjs
 */
import assert from 'node:assert';
import { seedState, trackHooks } from './_history_env.mjs';

const {
    _suggestFitPure, _suggestMetronomeFitPure,
    _suggestApplyPure, _suggestCompute, _suggestActive,
} = await import('../src/tempo-suggest.js');
const { _tempoSuggestScopePure, _tempoGuideAnalysisPure, _tempoGuideRequestStillCurrentPure } = await import('../src/input.js');
const { editorAcceptWholeTempoFit } = await import('../src/tempo.js');
const { editorTempoGuideState, editorToggleTempoGuide, trackSessionSavePayload } =
    await import('../src/track-session.js');
const { EditHistory } = await import('../src/history.js');
const { S } = await import('../src/state.js');
const { setHostHooks } = await import('../src/host.js');

let pass = 0, fail = 0;
const tests = [];
const t = (name, fn) => tests.push([name, fn]);

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
// A click track: one pulse per beat at `bpm`, `n` pulses.
function clicks(bpm, n, start = 0, s = 0.8) {
    const beat = 60 / bpm;
    return Array.from({ length: n }, (_, k) => ({ t: start + k * beat, s }));
}

// ── The metronome fit ────────────────────────────────────────────────

t('metronome fit walks the click by authored beats-per-measure and follows a real tempo change', () => {
    // Chart thinks 120; the click is 120 for 2 bars then jumps to 100.
    const g = grid(4, 120);
    const pulses = [...clicks(120, 8), ...clicks(100, 9, 8 * 0.5)];
    const { proposals, stopDetail } = _suggestMetronomeFitPure(g, pulses, 0, {});
    assert.strictEqual(stopDetail, 'metronome');
    assert.strictEqual(proposals.length, 3);
    assert.ok(Math.abs(proposals[0].time - 2.0) < 1e-9, 'bar 2 downbeat = pulse 4');
    assert.ok(Math.abs(proposals[1].time - 4.0) < 1e-9, 'bar 3 downbeat = pulse 8 (the jump point)');
    assert.ok(Math.abs(proposals[2].time - (4.0 + 4 * 0.6)) < 1e-9, 'bar 4 rides the NEW 100 BPM pulse');
    assert.ok(proposals.every(p => p.conf >= 0.55 && !p.inferred), 'detected pulses are confident');
});

t('pulse dropout continues on the recent median gap, low-confidence and inferred', () => {
    const g = grid(5, 120);
    const pulses = clicks(120, 9);   // enough for 2 bars; then silence
    const { proposals } = _suggestMetronomeFitPure(g, pulses, 0, {});
    assert.strictEqual(proposals.length, 4, 'the fit still reaches every authored downbeat');
    const tail = proposals.slice(2);
    assert.ok(tail.every(p => p.inferred && p.conf === 0.18), 'dropout bars are honest');
    assert.ok(Math.abs(tail[0].time - 6.0) < 1e-6, 'median 120 BPM gap carries forward');
});

t('a locked barline is pinned at its authored time and cannot shift the later click phase', () => {
    const g = grid(4, 120);
    g[8].locked = true;                     // bar 3's downbeat…
    g[8].time = 3.9;                        // …authored slightly OFF the pulse grid
    const pulses = clicks(120, 16);
    const { proposals } = _suggestMetronomeFitPure(g, pulses, 0, {});
    const lockedP = proposals.find(p => p.i === 8);
    assert.strictEqual(lockedP.time, 3.9, 'lock keeps its authored time');
    assert.strictEqual(lockedP.conf, 1);
    assert.ok(lockedP.locked);
    const after = proposals.find(p => p.i === 12);
    assert.ok(Math.abs(after.time - 6.0) < 1e-9,
        'bar 4 stays on the true pulse sequence (count-advance), not re-anchored near the lock');
});

// ── The completion tail (ordinary audio) ─────────────────────────────

t('opts.complete extends a stopped march to chart end with an inferred 0.08 tail', () => {
    const g = grid(6, 120);
    // Downbeat onsets for the first 3 bars only, then true silence.
    const onsets = [0, 2, 4].map(x => ({ t: x, s: 0.9 }));
    const plain = _suggestFitPure(g, onsets, 0, {});
    const whole = _suggestFitPure(g, onsets, 0, { complete: true });
    assert.ok(plain.proposals.length < 5, 'the conservative march stops early');
    assert.strictEqual(whole.proposals.length, 5, 'complete reaches every downbeat');
    assert.deepStrictEqual(whole.proposals.slice(0, plain.proposals.length),
        plain.proposals, 'the detected prefix is untouched');
    const tail = whole.proposals.slice(plain.proposals.length);
    assert.ok(tail.length > 0 && tail.every(p => p.inferred && p.conf === 0.08));
    assert.strictEqual(whole.stopReason, 'end');
    assert.match(whole.stopDetail, /^inferred-/, 'the tail is honest about WHY it is inferred');
});

t('the tail interpolates onto a locked downbeat ahead instead of extrapolating past it', () => {
    const g = grid(6, 120);
    g[16].locked = true;                    // bar 5's downbeat is human-verified
    const onsets = [0, 2].map(x => ({ t: x, s: 0.9 }));
    const { proposals } = _suggestFitPure(g, onsets, 0, { complete: true });
    const atLock = proposals.find(p => p.i === 16);
    assert.strictEqual(atLock.time, g[16].time, 'the lock is the tail\'s anchor');
    assert.strictEqual(atLock.conf, 1);
    assert.ok(atLock.locked && !atLock.inferred);
});

t('opts.metronome routes _suggestFitPure to the metronome engine', () => {
    const g = grid(3, 120);
    const out = _suggestFitPure(g, clicks(120, 12), 0, { metronome: true });
    assert.strictEqual(out.stopDetail, 'metronome');
});

// ── The open-final-measure carry in apply ────────────────────────────

t('accepting through the final authored downbeat rescales the open last measure', () => {
    const g = grid(3, 120);                  // beats 8..11 are the open final bar
    const real = 126;
    const bar = (60 / real) * 4;
    const proposals = [
        { i: 4, time: bar, conf: 0.9, locked: false },
        { i: 8, time: 2 * bar, conf: 0.9, locked: false },
    ];
    const out = _suggestApplyPure(g, proposals, 8);
    assert.strictEqual(out.length, g.length, 'equal-length (TempoMapCmd invariant)');
    const scale = (out[8].time - out[4].time) / (g[8].time - g[4].time);
    for (let j = 9; j < g.length; j++) {
        const want = out[8].time + (g[j].time - g[8].time) * scale;
        assert.ok(Math.abs(out[j].time - want) < 1e-9,
            `interior beat ${j} of the open final bar rides the accepted tempo`);
    }
    // And a mid-song accept still leaves the far side untouched (the old contract).
    const mid = _suggestApplyPure(g, proposals, 4);
    assert.strictEqual(mid[8].time, g[8].time, 'unaccepted downbeat stays put');
});

// ── Scope: the focused marker wins ───────────────────────────────────

t('the focused marker anchors the fit even when a stale multi-selection exists', () => {
    const g = grid(6, 120);
    const multi = new Set([4, 8]);           // an old range selection
    const scope = _tempoSuggestScopePure(g, 16, multi, false);
    assert.strictEqual(scope.anchor, 16, 'focus wins');
    assert.strictEqual(scope.opts.toIdx, undefined, 'the selection no longer caps the march');
    assert.deepStrictEqual(scope.opts, { complete: true });
});

t('with no focus the selection is only an anchor fallback; metronome flag shapes opts', () => {
    const g = grid(6, 120);
    const multi = new Set([8, 12]);
    assert.strictEqual(_tempoSuggestScopePure(g, -1, multi, false).anchor, 8);
    assert.deepStrictEqual(_tempoSuggestScopePure(g, 0, null, true).opts, { metronome: true });
});

// ── Guide routing decision ───────────────────────────────────────────

t('analysis follows the guide only when LOCKED; mode metronome sets the engine flag', () => {
    assert.strictEqual(_tempoGuideAnalysisPure(null), null);
    assert.strictEqual(_tempoGuideAnalysisPure({ tempoGuideSourceId: 'Click', tempoGuideLocked: false, tempoGuideMode: 'metronome' }), null, 'unlocked guide never reroutes analysis');
    assert.deepStrictEqual(
        _tempoGuideAnalysisPure({ tempoGuideSourceId: 'Click', tempoGuideLocked: true, tempoGuideMode: 'metronome' }),
        { sourceId: 'Click', metronome: true });
    assert.deepStrictEqual(
        _tempoGuideAnalysisPure({ tempoGuideSourceId: 'master', tempoGuideLocked: true, tempoGuideMode: 'audio' }),
        { sourceId: 'master', metronome: false });
});

t('an asynchronous guide analysis is discarded when its role or source changes', () => {
    const request = { sourceId: 'Click', metronome: true, url: '/click.ogg', offset: 0.25 };
    const source = { id: 'Click', url: '/click.ogg', offset: 0.25 };
    const session = { tempoGuideSourceId: 'Click', tempoGuideLocked: true, tempoGuideMode: 'metronome' };
    assert.strictEqual(_tempoGuideRequestStillCurrentPure(request, session, source), true);
    assert.strictEqual(_tempoGuideRequestStillCurrentPure(request,
        { ...session, tempoGuideMode: 'audio' }, source), false, 'mode changes invalidate the engine options');
    assert.strictEqual(_tempoGuideRequestStillCurrentPure(request, session,
        { ...source, url: '/replacement.ogg' }), false, 'source replacement invalidates decoded results');
    assert.strictEqual(_tempoGuideRequestStillCurrentPure(request, session,
        { ...source, offset: 0 }), false, 'timeline placement changes invalidate shifted onsets');
});

// ── The guide role round-trips through the track session ─────────────

t('editorToggleTempoGuide locks/unlocks and persists through the save payload', () => {
    seedState({
        arrangements: [{ name: 'Lead' }],
        drumTab: null,
        stems: [{ id: 'Click', url: '/click.ogg' }],
        audioUrl: '/master.ogg',
        trackSession: { version: 2, tracks: [], removedSourceIds: [], tempoGuideSourceId: '', tempoGuideLocked: false, tempoGuideMode: 'audio' },
    });
    assert.strictEqual(trackSessionSavePayload(), null, 'default tree persists nothing');
    assert.strictEqual(editorToggleTempoGuide('Click'), true);
    const state = editorTempoGuideState();
    assert.deepStrictEqual(state, { sourceId: 'Click', locked: true, mode: 'metronome' });
    const payload = trackSessionSavePayload();
    assert.ok(payload && payload.tempoGuideLocked && payload.tempoGuideSourceId === 'Click',
        'a locked guide is worth persisting');
    assert.strictEqual(editorToggleTempoGuide('Click'), false, 'toggling the active guide unlocks');
    assert.strictEqual(trackSessionSavePayload(), null, 'back to default — no residue');
});

// ── Accept Whole Fit: one undoable edit ──────────────────────────────

t('Accept Whole Fit commits every proposal (tail included) as ONE undo step', () => {
    seedState({
        arrangements: [{ name: 'Lead', notes: [], chords: [] }],
        drumTab: null,
        stems: [],
        audioUrl: '/master.ogg',
        tempoMapMode: true,
        tempoMarks: [],
        beats: grid(4, 120),
        duration: 10,
        history: new EditHistory(),
    });
    trackHooks();
    setHostHooks({ updateBPMDisplay: () => {}, updateStatus: () => {} });
    const before = S.beats.map(b => ({ ...b }));
    // The recording is really 126, so accepted downbeats MOVE off the 120 grid.
    const bar = (60 / 126) * 4;
    const onsets = [0, bar].map(x => ({ t: x, s: 0.9 }));
    const n = _suggestCompute(0, onsets, { complete: true });
    assert.ok(n >= 3, 'proposals reach chart end (tail included)');
    assert.ok(_suggestActive());
    assert.strictEqual(editorAcceptWholeTempoFit(), true);
    assert.ok(!_suggestActive(), 'ghosts dismissed after a whole-song accept');
    assert.notDeepStrictEqual(S.beats, before, 'the map moved');
    S.history.doUndo();
    assert.deepStrictEqual(S.beats.map(b => ({ time: b.time, measure: b.measure })),
        before.map(b => ({ time: b.time, measure: b.measure })),
        'ONE undo restores the exact pre-accept map');
    S.history.doRedo();
    assert.notDeepStrictEqual(S.beats, before, 'redo re-applies the whole fit');
    assert.strictEqual(editorAcceptWholeTempoFit(), false, 'nothing left to accept');
});

for (const [name, fn] of tests) {
    try { await fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
