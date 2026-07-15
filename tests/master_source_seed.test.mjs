/*
 * Master Mix source seeding for older servers (src/file-ops.js).
 *
 * When a server omits `audio_sources`, the track-session normalizer synthesizes
 * a Master Mix with an empty URL — which activateTrackAudioSource then rejects,
 * falsely reporting Master Mix as "unavailable". _seedMasterSourcePure patches
 * the master with data.audio_url so it resolves against the cached audio.
 *
 * Run: node tests/master_source_seed.test.mjs
 */
import assert from 'node:assert';

globalThis.localStorage = globalThis.localStorage || {
    getItem: () => null, setItem: () => {}, removeItem: () => {},
};

const { _seedMasterSourcePure } = await import('../src/file-ops.js');

let pass = 0, fail = 0;
function t(name, fn) {
    try { fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}

t('omitted audio_sources gets a Master Mix carrying data.audio_url', () => {
    const out = _seedMasterSourcePure(undefined, '/editor_audio_x.ogg');
    assert.ok(Array.isArray(out));
    const master = out.find(s => s.id === 'master');
    assert.ok(master, 'master synthesized');
    assert.strictEqual(master.url, '/editor_audio_x.ogg', 'master carries the audio url');
    assert.strictEqual(master.kind, 'master');
});

t('a stems-only payload gets Master Mix prepended, stems preserved', () => {
    const out = _seedMasterSourcePure([{ id: 'stem:bass', kind: 'stem', url: '/b.ogg' }], '/m.ogg');
    assert.strictEqual(out[0].id, 'master');
    assert.strictEqual(out[0].url, '/m.ogg');
    assert.ok(out.some(s => s.id === 'stem:bass' && s.url === '/b.ogg'));
});

t('a populated master from a newer server is left untouched', () => {
    const sources = [{ id: 'master', kind: 'master', url: '/real.ogg' }, { id: 'stem:x', url: '/x' }];
    assert.strictEqual(_seedMasterSourcePure(sources, '/other.ogg'), sources, 'same reference, no patch');
});

t('no audio_url means no synthesis (nothing to point at)', () => {
    assert.strictEqual(_seedMasterSourcePure(undefined, ''), undefined);
});

console.log(`master source seed: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
