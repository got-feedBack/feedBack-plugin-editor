/*
 * "Song Fit" consolidated surface (tempo track PR 9).
 *
 * Song Fit is one discoverable front door over three existing undoable verbs —
 * Shift everything (offset command), Fit tempo (audio sync), Set constant tempo
 * (the conform/rebuild flatten). The inline Offset/Sync/BPM controls are left
 * alone. This suite proves:
 *   1. _consequenceBadgePure — the shared audio/grid/notes contract copy.
 *   2. _songFitChoicesPure — the four options, each hinted by its badge (the
 *      badge is the single source, so menu + any future surface stay in step),
 *      plus "Re-sync from this bar on" — its anchor, and the boundary contract
 *      that gives the option its name (nothing at or before the anchor moves).
 *   3. Source guards (fail-on-main): editorSetBPM's flatten was EXTRACTED into a
 *      shared _editorFlattenSongToBpm so Song Fit can reach it inside Tempo Map
 *      mode, and Song Fit's "set constant" passes an overriding message; the
 *      helper + _editorSongFit are window-exposed.
 *
 * Run: node tests/song_fit.test.mjs
 */
import assert from 'node:assert';
import fs from 'node:fs';
import { _consequenceBadgePure, _songFitChoicesPure, _songFitResyncAnchorPure } from '../src/song-fit.js';
import { _suggestApplyPure, _suggestFitPure } from '../src/tempo-suggest.js';

let pass = 0, fail = 0;
function t(name, fn) {
    try { fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}

// ── 1. _consequenceBadgePure ─────────────────────────────────────────────────
t('_consequenceBadgePure names what each op does to audio / grid / notes', () => {
    assert.match(_consequenceBadgePure('shift'), /audio stays/);
    assert.match(_consequenceBadgePure('shift'), /move together/);
    assert.match(_consequenceBadgePure('fit'), /grid rescales/);
    assert.match(_consequenceBadgePure('fit'), /notes ride/);
    assert.match(_consequenceBadgePure('constant'), /one steady tempo/);
    assert.match(_consequenceBadgePure('constant'), /ride or hold/);
    // Every badge promises the audio does not move — the non-negotiable.
    for (const k of ['shift', 'fit', 'constant']) assert.match(_consequenceBadgePure(k), /audio stays/);
});
t('_consequenceBadgePure is empty for an unknown kind', () => {
    assert.strictEqual(_consequenceBadgePure('nope'), '');
    assert.strictEqual(_consequenceBadgePure(), '');
});

// ── 2. _songFitChoicesPure ───────────────────────────────────────────────────
t('_songFitChoicesPure offers exactly the four fit operations', () => {
    const c = _songFitChoicesPure();
    assert.deepStrictEqual(c.map(x => x.key), ['shift', 'fit', 'constant', 'resync']);
    for (const x of c) assert.ok(x.label && x.label.length, 'each choice is labelled');
});

// ── 2b. The re-sync anchor (the drift-rescue entry point) ────────────────────
t('the re-sync anchor is the last downbeat at or before the playhead', () => {
    const beats = [
        { time: 0, measure: 1 }, { time: 0.5, measure: -1 },
        { time: 2, measure: 2 }, { time: 2.5, measure: -1 },
        { time: 4, measure: 3 },
    ];
    assert.strictEqual(_songFitResyncAnchorPure(beats, 3.2), 2, 'inside bar 2 → its downbeat');
    assert.strictEqual(_songFitResyncAnchorPure(beats, 2), 2, 'exactly ON a downbeat → that one');
    assert.strictEqual(_songFitResyncAnchorPure(beats, 99), 4, 'past the end → the last downbeat');
});

t('a playhead before bar 1 anchors on the FIRST downbeat, and no downbeats refuses', () => {
    const beats = [{ time: 1, measure: 1 }, { time: 1.5, measure: -1 }, { time: 3, measure: 2 }];
    assert.strictEqual(_songFitResyncAnchorPure(beats, 0.2), 0, 'before bar 1 → bar 1');
    assert.strictEqual(_songFitResyncAnchorPure([{ time: 0, measure: -1 }], 1), -1, 'interiors only → -1');
    assert.strictEqual(_songFitResyncAnchorPure([], 1), -1);
});
// ── 2c. The re-sync BOUNDARY contract — the invariant the option is named for ─
// "From this bar ON" is a promise about the bars BEFORE it: the drift rescue is
// reached for when the chart is already right up to bar N, so eating any of that
// authored grid is the one unforgivable failure. Composed over the same engine
// pures the accept path runs (_suggestFitPure → _suggestApplyPure), on a grid
// whose recording runs 2% slow from bar 5 — the exact drift this feature exists
// to rescue. Pins BOTH sides of the boundary: nothing at/before the anchor
// moves, and the re-fit starts at the very next beat (no off-by-one dead bar).
t('re-sync leaves every beat AT or BEFORE the anchor byte-identical', () => {
    const beats = [];
    for (let bar = 1; bar <= 12; bar++) {
        for (let b = 0; b < 4; b++) {
            beats.push({ time: +((bar - 1) * 2 + b * 0.5).toFixed(6), measure: b === 0 ? bar : -1 });
        }
    }
    // The recording sits a uniform 40ms behind the authored grid EVERYWHERE — so
    // the early bars are where the user authored them, NOT where a naive onset
    // fit would drag them — and drifts a further 2% from bar 5 (t=8s) on. That
    // uniform lag is what gives this test teeth: anchoring even one bar early
    // WOULD move the early bars, so the assertion below fails on an off-by-one
    // instead of passing vacuously on an already-grid-true region.
    const onsets = beats.map(b => ({
        t: +(b.time + 0.04 + (b.time < 8 ? 0 : (b.time - 8) * 0.02)).toFixed(6),
        s: b.measure > 0 ? 1 : 0.7,
    }));

    const anchor = _songFitResyncAnchorPure(beats, 9.1);   // playhead parked inside bar 5
    assert.strictEqual(anchor, 16, 'a playhead inside bar 5 anchors on bar 5’s own downbeat');

    const { proposals } = _suggestFitPure(beats, onsets, anchor);
    assert.ok(proposals.length, 'the drift must produce forward corrections to rescue');
    const applied = _suggestApplyPure(beats, proposals, proposals[proposals.length - 1].i);

    assert.strictEqual(applied.length, beats.length, 'equal length — the TempoMapCmd invariant');
    assert.deepStrictEqual(applied.slice(0, anchor + 1), beats.slice(0, anchor + 1),
        'every beat at or before the anchor is untouched — "from this bar on" means exactly that');
    assert.notStrictEqual(applied[anchor + 1].time, beats[anchor + 1].time,
        'and the re-fit begins at the very next beat — the boundary is the anchor, not the next bar');
});
t('_songFitChoicesPure hints ARE the shared badges (single source)', () => {
    for (const x of _songFitChoicesPure()) {
        assert.strictEqual(x.hint, _consequenceBadgePure(x.key),
            `choice ${x.key} must render the shared badge, not a divergent copy`);
    }
});

// ── 3. Source guards (fail-on-main) ──────────────────────────────────────────
const mainSrc = fs.readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
const songFitSrc = fs.readFileSync(new URL('../src/song-fit.js', import.meta.url), 'utf8');

t('editorSetBPM routes its flatten through the shared _editorFlattenSongToBpm', () => {
    assert.match(mainSrc, /async function _editorFlattenSongToBpm/, 'the shared flatten helper exists');
    assert.match(mainSrc, /window\.editorFlattenSongToBpm\s*=\s*_editorFlattenSongToBpm/, 'helper is window-exposed for Song Fit');
    // editorSetBPM's variable-map branch now delegates instead of inlining.
    const marker = 'window.editorSetBPM =';
    const start = mainSrc.indexOf(marker);
    assert.ok(start >= 0, 'editorSetBPM must exist');
    const tail = mainSrc.slice(start + marker.length);
    const next = tail.search(/\nwindow\.[A-Za-z0-9_$]+\s*=/);
    const setBpm = mainSrc.slice(start, start + marker.length + (next >= 0 ? next : tail.length));
    assert.match(setBpm, /await _editorFlattenSongToBpm\(newBPM\)/, 'editorSetBPM delegates to the helper');
    assert.doesNotMatch(setBpm, /new TempoGridCmd\(oldBeats, flat/, 'the inline flatten body was removed from editorSetBPM');
});
t('Song Fit + its set-constant message are wired', () => {
    assert.match(mainSrc, /window\.editorSongFit\s*=\s*_editorSongFit/, '_editorSongFit is window-exposed');
    assert.match(songFitSrc, /window\.editorFlattenSongToBpm/, 'set-constant reuses the shared flatten helper');
    assert.match(songFitSrc, /message:\s*'Choose how to set the whole song to one steady tempo/, 'set-constant overrides the variable-map subtitle');
    // The inline controls are NOT rerouted — Song Fit dispatches to the verbs.
    assert.match(songFitSrc, /editorSyncTempo/, 'Fit tempo dispatches to the existing sync verb');
    assert.match(songFitSrc, /editorNudgeOffset/, 'Shift keeps the ±10ms nudge arrows');
});
t('Re-sync dispatches through the registry — mode entry, anchor, fit — and commits nothing', () => {
    const at = songFitSrc.indexOf('function _songFitResync()');
    assert.ok(at >= 0, '_songFitResync must exist');
    const rest = songFitSrc.slice(at);
    const body = rest.slice(0, rest.indexOf('\n}\n') + 2);

    // Chrome charter: no second engine — mode entry and the fit both go through
    // the same registry commands the keyboard uses.
    assert.match(body, /editorRunShortcutCommand', 'toggleTempoMap'/, 'enters Tempo Map through the registry command');
    assert.match(body, /editorRunShortcutCommand', 'tempoSuggestFit'/, 'runs the fit through the registry command');
    assert.match(body, /_songFitResyncAnchorPure\(S\.beats, S\.cursorTime\)/, 'anchors on the playhead’s own bar');
    assert.match(body, /S\.tempoSel = anchor/, 'the anchor becomes the selection the fit reads');
    // A live multi-selection outranks the anchor in _editorTempoSuggestFit's range
    // branch — leaving one set would silently fit a DIFFERENT span than the bar the
    // user parked on.
    assert.match(body, /S\.tempoSelMulti\.clear\(\)/, 'a live multi-selection is dropped');

    // Order trap: entering the mode CLEARS tempoSel, so the anchor must be taken
    // after entry, and the fit must read it after it is set.
    assert.ok(body.indexOf('toggleTempoMap') < body.indexOf('S.tempoSel = anchor'),
        'mode entry precedes the anchor — entry clears the barline selection');
    assert.ok(body.indexOf('S.tempoSel = anchor') < body.indexOf('tempoSuggestFit'),
        'the anchor is set before the fit reads it');

    // Proposal-only: re-sync shows ghosts. The undoable command belongs to the
    // accept path (tempo.js owns TempoMapCmd) — re-sync must never commit.
    assert.doesNotMatch(body, /history\.exec|TempoMapCmd|S\.beats\s*=/,
        're-sync itself commits nothing — nothing is undoable-able until the user accepts a ghost');
});
t('Song Fit revalidates the session after awaited prompts and before shift actions', () => {
    assert.match(songFitSrc, /const sessionBefore = S\.sessionId[\s\S]*await _editorPromptChoice[\s\S]*_sameSession\(sessionBefore\)/,
        'choice prompt revalidates the session before dispatch');
    assert.match(songFitSrc, /async function _songFitSetConstant\(sessionBefore = S\.sessionId\)[\s\S]*await _editorPromptText[\s\S]*_sameSession\(sessionBefore\)/,
        'constant-BPM prompt revalidates before flattening');
    assert.match(songFitSrc, /export function _editorShiftEverything\(sessionBefore = S\.sessionId\)[\s\S]*const guard = \(\) => [\s\S]*_sameSession\(sessionBefore\)[\s\S]*editorApplyOffset/,
        'shift modal validates before applying offset actions');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
