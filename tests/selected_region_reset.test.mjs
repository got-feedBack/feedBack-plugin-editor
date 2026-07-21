/*
 * S.selectedRegionId must clear whenever the selection context changes, the
 * same way S.selectedTrackId does. It is written on a parts-view region click
 * (src/parts-view.js) but was never reset — a stale id survived a song load and
 * a track switch, painting a spurious "selected" highlight on the wrong track
 * (and, once bounded regions carry unique ids, a wrong move/trim target).
 *
 * The exported song-load seam installTrackSession() resets selectedTrackId to
 * '' at src/track-session.js — selectedRegionId must ride along.
 *
 * Fails pre-fix: installTrackSession clears selectedTrackId but leaves
 * selectedRegionId stale.
 *
 * Run: node tests/selected_region_reset.test.mjs
 */
import assert from 'node:assert';

const { installTrackSession } = await import('../src/track-session.js');
const { S } = await import('../src/state.js');

let pass = 0; let fail = 0;
const tests = [];
const t = (name, fn) => tests.push([name, fn]);

t('installTrackSession (song load) clears a stale selectedRegionId', () => {
    const saved = { trackSession: S.trackSession, arrangements: S.arrangements, drumTab: S.drumTab,
        stems: S.stems, audioUrl: S.audioUrl, masterAudioUrl: S.masterAudioUrl,
        selectedTrackId: S.selectedTrackId, selectedRegionId: S.selectedRegionId };
    try {
        Object.assign(S, { arrangements: [{ name: 'Lead' }], drumTab: null, stems: [], audioUrl: '/old.ogg' });
        // A region was selected on the previous song.
        S.selectedTrackId = 'transcription:Lead';
        S.selectedRegionId = 'region:stale';
        installTrackSession(null, '/new.ogg');
        assert.strictEqual(S.selectedTrackId, '', 'selectedTrackId resets on load (baseline behavior)');
        assert.strictEqual(S.selectedRegionId, '', 'selectedRegionId must reset with it');
    } finally { Object.assign(S, saved); }
});

for (const [name, fn] of tests) {
    try { await fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
