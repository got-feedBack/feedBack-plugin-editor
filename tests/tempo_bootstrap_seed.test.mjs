/*
 * Metronome bootstrap + filename BPM seeding (TEMPO-ASSIST A's name-based
 * easy win + B's opportunistic priors).
 *
 * Pinned here:
 *   - the click detector is NAME-based and word-bounded: "Click"/"Metronome"
 *     stems match, "Clickbait" and the master recording never do;
 *   - the analysis route: a LOCKED guide is supreme (any source, any mode —
 *     locking the master as plain audio is the opt-out), an unlocked session
 *     with a click-named stem bootstraps metronome analysis, and with
 *     neither the route is null (master mix, plain audio);
 *   - the bootstrap persists nothing — it is an analysis default, so the
 *     track-session save payload stays default;
 *   - post-await revalidation: a lock arriving elsewhere, the stem
 *     vanishing, or its url/offset changing all discard the stale analysis;
 *   - filename BPM parsing: standalone 2–3 digit values next to "bpm" in
 *     either order, 40–300 sanity window, longer digit runs rejected;
 *   - the session hint scans sources in track order, name before id.
 *
 * Run: node tests/tempo_bootstrap_seed.test.mjs
 */
import assert from 'node:assert';

const { _clickSourcePure, _trackSessionIsDefaultPure } = await import('../src/track-session.js');
const {
    _tempoAnalysisRoutePure, _tempoAnalysisRequestStillCurrentPure,
    _tempoBootstrapFallbackSourcePure,
} = await import('../src/input.js');
const { _filenameBpmPure, _sessionBpmHintPure } = await import('../src/song-fit.js');

let pass = 0, fail = 0;
const tests = [];
const t = (name, fn) => tests.push([name, fn]);

const src = (id, name, url = `/stems/${id}.ogg`, offset = 0) => ({ id, name, kind: 'stem', url, offset });
const master = (name = 'Master Mix') => ({ id: 'master', name, kind: 'master', url: '/full.ogg' });
const unlockedTree = { version: 2, tracks: [], removedSourceIds: [], tempoGuideSourceId: 'master', tempoGuideLocked: false, tempoGuideMode: 'audio' };
const lockedTree = (sourceId, mode = 'metronome') => ({ ...unlockedTree, tempoGuideSourceId: sourceId, tempoGuideLocked: true, tempoGuideMode: mode });

// ── The click-name detector ──────────────────────────────────────────

t('click/metronome stem names match; the master and near-miss words never do', () => {
    assert.strictEqual(_clickSourcePure([master(), src('gtr', 'Guitar'), src('click', 'Click')]).id, 'click');
    assert.strictEqual(_clickSourcePure([master(), src('m1', 'Metronome.wav')]).id, 'm1');
    assert.strictEqual(_clickSourcePure([master(), src('m2', '05 - metronom')]).id, 'm2', 'truncated European spelling still reads as a click');
    assert.strictEqual(_clickSourcePure([master(), src('t', 'Click Track')]).id, 't');
    assert.strictEqual(_clickSourcePure([master(), src('clicks', 'Whatever')]).id, 'clicks', 'the id matches even when the display name was renamed');
    assert.strictEqual(_clickSourcePure([master('Click')]), null, 'the master recording is never a click candidate');
    assert.strictEqual(_clickSourcePure([master(), src('v', 'Clickbait (vocals)')]), null, 'word boundary: no substring false positives');
    assert.strictEqual(_clickSourcePure([master(), src('g', 'Guitar'), src('b', 'Bass')]), null);
    assert.strictEqual(_clickSourcePure(null), null);
});

t('the first click-named stem wins in source (track) order', () => {
    const found = _clickSourcePure([master(), src('a', 'Click 1'), src('b', 'Click 2')]);
    assert.strictEqual(found.id, 'a');
});

// ── The analysis route ───────────────────────────────────────────────

t('a locked guide is supreme; an unlocked click stem bootstraps; neither routes null', () => {
    const sources = [master(), src('drums', 'Drums'), src('click', 'Metronome')];
    assert.deepStrictEqual(_tempoAnalysisRoutePure(lockedTree('drums'), sources),
        { sourceId: 'drums', metronome: true, bootstrap: false }, 'the lock wins over the click stem');
    assert.deepStrictEqual(_tempoAnalysisRoutePure(lockedTree('master', 'audio'), sources),
        { sourceId: 'master', metronome: false, bootstrap: false },
        'locking the master as plain audio is the bootstrap opt-out');
    assert.deepStrictEqual(_tempoAnalysisRoutePure(unlockedTree, sources),
        { sourceId: 'click', metronome: true, bootstrap: true }, 'no lock → the click stem bootstraps as a metronome');
    assert.strictEqual(_tempoAnalysisRoutePure(unlockedTree, [master(), src('g', 'Guitar')]), null);
    assert.strictEqual(_tempoAnalysisRoutePure(null, sources.slice(0, 2)), null);
});

t('the bootstrap persists nothing — the default track session stays default', () => {
    const sources = [master(), src('click', 'Metronome')];
    const route = _tempoAnalysisRoutePure(unlockedTree, sources);
    assert.ok(route && route.bootstrap);
    assert.strictEqual(_trackSessionIsDefaultPure(unlockedTree, sources, [{ name: 'Lead' }], null), true,
        'routing through the click never dirties or persists the tree');
});

t('an undecodable click bootstrap falls back to the master, not the active stem', () => {
    const route = _tempoAnalysisRoutePure(unlockedTree,
        [master(), src('guitar', 'Guitar'), src('click', 'Click')]);
    const fallback = _tempoBootstrapFallbackSourcePure(route,
        [master(), src('guitar', 'Guitar'), src('click', 'Click')]);
    assert.strictEqual(fallback.id, 'master');
    assert.strictEqual(fallback.url, '/full.ogg');
    assert.strictEqual(_tempoBootstrapFallbackSourcePure(
        _tempoAnalysisRoutePure(lockedTree('guitar'), [master(), src('guitar', 'Guitar')]),
        [master(), src('guitar', 'Guitar')]), null, 'locked guides never use bootstrap fallback');
});

// ── Post-await revalidation ──────────────────────────────────────────

t('a routed analysis survives only while the route and the decoded audio hold', () => {
    const sources = [master(), src('click', 'Metronome', '/stems/click.ogg', 0.25)];
    const request = { sourceId: 'click', metronome: true, url: '/stems/click.ogg', offset: 0.25 };
    assert.strictEqual(_tempoAnalysisRequestStillCurrentPure(request, unlockedTree, sources), true,
        'an unchanged bootstrap route stays current');
    assert.strictEqual(_tempoAnalysisRequestStillCurrentPure(request, lockedTree('click'), sources), true,
        'locking the SAME stem as a metronome guide mid-decode keeps the analysis');
    assert.strictEqual(_tempoAnalysisRequestStillCurrentPure(request, lockedTree('drums'), sources), false,
        'a lock arriving on another source discards the bootstrap');
    assert.strictEqual(_tempoAnalysisRequestStillCurrentPure(request, unlockedTree, [master()]), false,
        'the click stem vanishing discards it');
    assert.strictEqual(_tempoAnalysisRequestStillCurrentPure(request, unlockedTree,
        [master(), src('click', 'Metronome', '/replacement.ogg', 0.25)]), false,
        'source replacement invalidates decoded results');
    assert.strictEqual(_tempoAnalysisRequestStillCurrentPure(request, unlockedTree,
        [master(), src('click', 'Metronome', '/stems/click.ogg', 0)]), false,
        'timeline placement changes invalidate shifted onsets');
});

// ── Filename BPM parsing ─────────────────────────────────────────────

t('standalone BPM values parse from either side of the word, decimals included', () => {
    assert.strictEqual(_filenameBpmPure('Song-147bpm.mp3'), 147);
    assert.strictEqual(_filenameBpmPure('147 BPM click.wav'), 147);
    assert.strictEqual(_filenameBpmPure('98.5bpm'), 98.5);
    assert.strictEqual(_filenameBpmPure('take2 bpm=104'), 104);
    assert.strictEqual(_filenameBpmPure('BPM 72 (rough)'), 72);
    assert.strictEqual(_filenameBpmPure('mix_bpm-133_v2.ogg'), 133);
});

t('junk never reads as a tempo', () => {
    assert.strictEqual(_filenameBpmPure('Song.mp3'), null);
    assert.strictEqual(_filenameBpmPure('2147bpm'), null, 'a longer digit run is a hash/id, not a tempo');
    assert.strictEqual(_filenameBpmPure('a147bpm'), null, 'glued to a word is not a standalone value');
    assert.strictEqual(_filenameBpmPure('147bpms'), null, 'trailing letters break the unit word');
    assert.strictEqual(_filenameBpmPure('39bpm'), null, 'below the sanity window');
    assert.strictEqual(_filenameBpmPure('301bpm'), null, 'above the sanity window');
    assert.strictEqual(_filenameBpmPure('bpm'), null);
    assert.strictEqual(_filenameBpmPure(null), null);
});

t('the URL basename is the last-resort hint (live create/import cache paths)', () => {
    assert.strictEqual(_sessionBpmHintPure([
        { id: 'master', name: 'Prefill Probe', url: '/api/plugins/editor/cache/editor_audio_Test_Song-147bpm.wav' },
    ]), 147, 'a built pack collapses names, but the upload-cache URL keeps the file name');
    assert.strictEqual(_sessionBpmHintPure([
        { id: 'master', name: 'Song', url: '/cache/editor_audio_Song%20-%20104bpm.wav?v=2' },
    ]), 104, 'percent-encoding and query strings are stripped first');
    assert.strictEqual(_sessionBpmHintPure([
        { id: 'master', name: 'Song', url: '/stream/full.ogg' },
    ]), null);
});

t('the session hint scans sources in order, name before id', () => {
    assert.strictEqual(_sessionBpmHintPure([
        { id: 'full', name: 'Song.mp3' },
        { id: 'click_147bpm', name: 'Metronome' },
    ]), 147, 'a stem id keeps the hint when the display name lost it');
    assert.strictEqual(_sessionBpmHintPure([
        { id: 'full', name: 'Song-98bpm.mp3' },
        { id: 'x', name: '147bpm click' },
    ]), 98, 'the master mix outranks later stems');
    assert.strictEqual(_sessionBpmHintPure([{ id: 'full', name: 'Song.mp3' }]), null);
    assert.strictEqual(_sessionBpmHintPure(undefined), null);
});

for (const [name, fn] of tests) {
    try { await fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
