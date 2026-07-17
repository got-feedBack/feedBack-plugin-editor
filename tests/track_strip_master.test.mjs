/*
 * Tracks-pane strip visibility (src/track-session.js _trackRowShowsStripPure).
 *
 * The master mix row now shows the same inline M/S/fader strip as every other
 * strip-keyed row — its old deliberate carve-out (mixer-drawer-only) is gone.
 * Pinned here so the master can't silently lose its pane mute again, and so
 * folders (no strip key) can't grow one.
 *
 * Run: node tests/track_strip_master.test.mjs
 */
import assert from 'node:assert';

const {
    _trackRowShowsStripPure,
    _trackSessionNormalizePure,
    _trackSessionRowsPure,
} = await import('../src/track-session.js');

let pass = 0, fail = 0;
function t(name, fn) {
    try { fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}

const sources = [
    { id: 'master', name: 'Full Mix', kind: 'master', url: '/full.ogg' },
    { id: 'Guitar_L', name: 'Guitar_L', kind: 'stem', url: '/s1.ogg' },
];
const arrangements = [{ name: 'Lead' }];
const drumTab = { name: 'Drums', hits: [{ t: 0 }] };

t('the MASTER row shows the strip — the old carve-out is gone', () => {
    const model = _trackSessionNormalizePure(null, sources, arrangements, drumTab);
    const { rows } = _trackSessionRowsPure(model, sources, arrangements, drumTab, {});
    const master = rows.find(r => r.type === 'audio' && r.sourceKind === 'master');
    assert.ok(master, 'master row exists');
    assert.strictEqual(master.mixKey, 'audio:master', 'master strips on the output-bus key');
    assert.strictEqual(_trackRowShowsStripPure(master), true,
        'master must show M/S/fader in the pane (the fix)');
});

t('stem audio and transcription rows keep their strips', () => {
    const model = _trackSessionNormalizePure(null, sources, arrangements, drumTab);
    const { rows } = _trackSessionRowsPure(model, sources, arrangements, drumTab, {});
    for (const row of rows.filter(r => r.type !== 'folder')) {
        assert.strictEqual(_trackRowShowsStripPure(row), true, `${row.id} shows a strip`);
    }
});

t('rows without a strip key never strip (folders, malformed rows)', () => {
    assert.strictEqual(_trackRowShowsStripPure({ type: 'folder', id: 'f1' }), false);
    assert.strictEqual(_trackRowShowsStripPure({ mixKey: '' }), false);
    assert.strictEqual(_trackRowShowsStripPure(null), false);
    assert.strictEqual(_trackRowShowsStripPure(undefined), false);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
