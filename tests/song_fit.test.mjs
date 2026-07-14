/*
 * "Song Fit" consolidated surface (tempo track PR 9).
 *
 * Song Fit is one discoverable front door over three existing undoable verbs —
 * Shift everything (offset command), Fit tempo (audio sync), Set constant tempo
 * (the conform/rebuild flatten). The inline Offset/Sync/BPM controls are left
 * alone. This suite proves:
 *   1. _consequenceBadgePure — the shared audio/grid/notes contract copy.
 *   2. _songFitChoicesPure — the three options, each hinted by its badge (the
 *      badge is the single source, so menu + any future surface stay in step).
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
