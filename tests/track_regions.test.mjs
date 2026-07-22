/*
 * Region model + migration (PR 1: model only, no UI/render/playback/build).
 *
 * Pinned here:
 *   - the pure region model (src/region.js): validate/dedupe/sort, the default
 *     full-span region, the default-is-null rule, and the beat-window
 *     membership predicate a later move/trim command will select notes with;
 *   - the MIGRATION seam: an old (v2) pack carries no `regions`, and every
 *     track resolves to exactly ONE default full-span region — identical to
 *     today, so nothing about rendering/playback/build changes;
 *   - the WIRING through _trackSessionNormalizePure: a non-default region
 *     survives normalize (attached, sorted, deduped) and makes the tree
 *     non-default (so it persists); a lone DEFAULT region is OMITTED so the
 *     tree stays default and untouched packs save byte-identical;
 *   - VERSION is bumped to 3 and normalize is idempotent over region data.
 *
 * This suite fails on main: src/region.js does not exist there, and normalize
 * neither threads `regions` nor stamps version 3.
 *
 * Run: node tests/track_regions.test.mjs
 */
import assert from 'node:assert';

const {
    DEFAULT_REGION_ID,
    _defaultRegionPure,
    _regionNormalizePure,
    _trackRegionsNormalizePure,
    _regionsAreDefaultPure,
    _trackRegionsResolvePure,
    _regionContainsBeatPure,
} = await import('../src/region.js');
const {
    _trackSessionNormalizePure,
    _trackSessionIsDefaultPure,
} = await import('../src/track-session.js');

let pass = 0; let fail = 0;
const tests = [];
const t = (name, fn) => tests.push([name, fn]);

// Same fixtures the track_session suite uses, so the wiring is exercised
// against a realistic loaded song rather than a stub.
const sources = [
    { id: 'master', name: 'Master Mix', kind: 'master', url: '/a.ogg' },
    { id: 'Guitar_L', name: 'Guitar_L', kind: 'stem', url: '/s1.ogg' },
];
const arrangements = [{ name: 'Lead' }, { name: 'Bass' }];
const drumTab = { name: 'Drums', hits: [{ t: 0 }] };
const DEFAULT_REGION = { id: DEFAULT_REGION_ID, startBeat: 0, lenBeat: null };

// ── The pure region model ────────────────────────────────────────────
t('the default region is a full-span window at beat 0', () => {
    assert.deepStrictEqual(_defaultRegionPure(), DEFAULT_REGION);
});

t('_regionNormalizePure validates, clamps, and emits optional fields only when set', () => {
    assert.strictEqual(_regionNormalizePure(null), null, 'non-object → null');
    assert.strictEqual(_regionNormalizePure({ startBeat: 4 }), null, 'no id → null');
    // startBeat clamps to >=0; a bad/absent len is the full-span null.
    assert.deepStrictEqual(_regionNormalizePure({ id: 'r1', startBeat: -3, lenBeat: 0 }),
        { id: 'r1', startBeat: 0, lenBeat: null });
    // a bounded notation window keeps startBeat + lenBeat only.
    assert.deepStrictEqual(_regionNormalizePure({ id: 'r2', startBeat: 16, lenBeat: 8 }),
        { id: 'r2', startBeat: 16, lenBeat: 8 });
    // audio trim: the pair appears together; an inverted out-point drops to null.
    assert.deepStrictEqual(_regionNormalizePure({ id: 'r3', srcIn: 1.5, srcOut: 3 }),
        { id: 'r3', startBeat: 0, lenBeat: null, srcIn: 1.5, srcOut: 3 });
    assert.deepStrictEqual(_regionNormalizePure({ id: 'r4', srcIn: 3, srcOut: 1 }),
        { id: 'r4', startBeat: 0, lenBeat: null, srcIn: 3, srcOut: null }, 'inverted trim → open end');
    // label + mute carried only when meaningfully set.
    assert.deepStrictEqual(_regionNormalizePure({ id: 'r5', name: '  Chorus  ', muted: true }),
        { id: 'r5', startBeat: 0, lenBeat: null, name: 'Chorus', muted: true });
    assert.deepStrictEqual(_regionNormalizePure({ id: 'r6', name: '   ', muted: false }),
        { id: 'r6', startBeat: 0, lenBeat: null }, 'blank name / false mute are omitted');
    const paddedMaxId = `  ${'x'.repeat(160)}  `;
    assert.strictEqual(_regionNormalizePure({ id: paddedMaxId }).id, 'x'.repeat(160),
        'id length is checked after trimming');
    assert.strictEqual(_regionNormalizePure({ id: ` ${'x'.repeat(161)} ` }), null,
        'trimmed ids over the limit are rejected');
});

t('_trackRegionsNormalizePure drops invalid, dedupes by id, and sorts by startBeat', () => {
    const norm = _trackRegionsNormalizePure([
        { id: 'b', startBeat: 16, lenBeat: 8 },
        'not-an-object',
        { id: 'a', startBeat: 4, lenBeat: 4 },
        { id: 'a', startBeat: 99 },            // duplicate id — first wins
        { startBeat: 2 },                       // no id — dropped
    ]);
    assert.deepStrictEqual(norm.map(r => [r.id, r.startBeat]), [['a', 4], ['b', 16]]);
    assert.deepStrictEqual(_trackRegionsNormalizePure('nope'), [], 'non-array → []');
});

t('_regionsAreDefaultPure: empty or a lone plain full region is default; anything authored is not', () => {
    assert.strictEqual(_regionsAreDefaultPure([]), true);
    assert.strictEqual(_regionsAreDefaultPure(undefined), true);
    assert.strictEqual(_regionsAreDefaultPure([{ id: 'x', startBeat: 0, lenBeat: null }]), true);
    assert.strictEqual(_regionsAreDefaultPure([{ id: 'x', startBeat: 8 }]), false, 'moved → non-default');
    assert.strictEqual(_regionsAreDefaultPure([{ id: 'x', startBeat: 0, lenBeat: 32 }]), false, 'trimmed len');
    assert.strictEqual(_regionsAreDefaultPure([{ id: 'x', srcIn: 1 }]), false, 'audio trim');
    assert.strictEqual(_regionsAreDefaultPure([{ id: 'x', name: 'Verse' }]), false, 'named');
    assert.strictEqual(_regionsAreDefaultPure([DEFAULT_REGION, { id: 'y', startBeat: 4 }]), false, 'two regions');
});

t('_trackRegionsResolvePure is the migration seam: absent → one default full region', () => {
    assert.deepStrictEqual(_trackRegionsResolvePure(undefined), [DEFAULT_REGION]);
    assert.deepStrictEqual(_trackRegionsResolvePure([]), [DEFAULT_REGION]);
    const authored = [{ id: 'r2', startBeat: 16, lenBeat: 8 }];
    assert.deepStrictEqual(_trackRegionsResolvePure(authored), authored, 'authored set passes through');
});

t('_regionContainsBeatPure is a half-open window; full span is open to the end', () => {
    const win = { id: 'w', startBeat: 8, lenBeat: 4 };  // [8, 12)
    assert.strictEqual(_regionContainsBeatPure(win, 8), true, 'start inclusive');
    assert.strictEqual(_regionContainsBeatPure(win, 11.99), true);
    assert.strictEqual(_regionContainsBeatPure(win, 12), false, 'end exclusive');
    assert.strictEqual(_regionContainsBeatPure(win, 7.99), false, 'before start');
    assert.strictEqual(_regionContainsBeatPure(_defaultRegionPure(), 1e9), true, 'full span is open-ended');
    assert.strictEqual(_regionContainsBeatPure(win, NaN), false, 'adversarial beat rejected');
    assert.strictEqual(_regionContainsBeatPure(null, 4), false, 'no region → false');
});

// ── Wiring through the track session (the real subject) ───────────────
const empty = { version: 2, tracks: [], removedSourceIds: [], tempoGuideSourceId: '', tempoGuideLocked: false, tempoGuideMode: 'audio' };

t('normalize stamps the v3 schema version', () => {
    assert.strictEqual(_trackSessionNormalizePure(empty, sources, arrangements, drumTab).version, 3);
});

t('MIGRATION: a v2 pack carries no regions; every track resolves to one default full region', () => {
    const model = _trackSessionNormalizePure(empty, sources, arrangements, drumTab);
    assert.ok(model.tracks.length > 0);
    for (const track of model.tracks) {
        assert.ok(!('regions' in track), `${track.id} must carry no regions key after migration`);
        assert.deepStrictEqual(_trackRegionsResolvePure(track.regions), [DEFAULT_REGION],
            `${track.id} resolves to exactly one default full-span region`);
    }
    // …and an all-default tree is still default, so it saves as no manifest key.
    assert.strictEqual(_trackSessionIsDefaultPure(empty, sources, arrangements, drumTab), true);
});

t('a NON-default region survives normalize and makes the tree non-default (it persists)', () => {
    const input = { ...empty, tracks: [
        { id: 'audio:master', type: 'audio', sourceId: 'master', regions: [
            { id: 'r2', startBeat: 16, lenBeat: 8 },
            { id: 'r1', startBeat: 0, lenBeat: 16 },   // out of order on the wire
        ] },
    ] };
    const model = _trackSessionNormalizePure(input, sources, arrangements, drumTab);
    const master = model.tracks.find(track => track.id === 'audio:master');
    assert.deepStrictEqual(master.regions, [
        { id: 'r1', startBeat: 0, lenBeat: 16 },
        { id: 'r2', startBeat: 16, lenBeat: 8 },
    ], 'regions attached, sorted by startBeat');
    assert.strictEqual(_trackSessionIsDefaultPure(input, sources, arrangements, drumTab), false,
        'a track with authored regions is not a default tree');
});

t('BYTE-IDENTICAL: a lone default region is omitted, keeping the tree default', () => {
    const input = { ...empty, tracks: [
        { id: 'audio:master', type: 'audio', sourceId: 'master', regions: [{ id: 'region:1', startBeat: 0, lenBeat: null }] },
    ] };
    const model = _trackSessionNormalizePure(input, sources, arrangements, drumTab);
    const master = model.tracks.find(track => track.id === 'audio:master');
    assert.ok(!('regions' in master), 'a default region leaves no residue');
    assert.strictEqual(_trackSessionIsDefaultPure(input, sources, arrangements, drumTab), true);
});

t('normalize is idempotent over region data', () => {
    const input = { ...empty, tracks: [
        { id: 'transcription:Lead', type: 'transcription', targetId: 'Lead', regions: [{ id: 'r2', startBeat: 8, lenBeat: 8 }] },
    ] };
    const once = _trackSessionNormalizePure(input, sources, arrangements, drumTab);
    const twice = _trackSessionNormalizePure(once, sources, arrangements, drumTab);
    assert.deepStrictEqual(twice, once);
});

t('a TRIMMED AUDIO region survives the save→reload round-trip with no drift (PR4)', () => {
    // TrimRegionCmd writes fractional srcIn/srcOut onto an audio track's region.
    // Save (normalize) → JSON wire → reload (normalize) must yield an IDENTICAL
    // window — the PR4 "no start/len drift" contract, for AUDIO trim specifically
    // (the model round-trips above only cover a notation window).
    const input = { ...empty, tracks: [
        { id: 'audio:master', type: 'audio', sourceId: 'master',
          regions: [{ id: 'r1', startBeat: 8, lenBeat: null, srcIn: 1.25, srcOut: 3.75, name: 'Solo' }] },
    ] };
    const saved = _trackSessionNormalizePure(input, sources, arrangements, drumTab);
    const savedRegions = saved.tracks.find(tk => tk.id === 'audio:master').regions;
    assert.deepStrictEqual(savedRegions,
        [{ id: 'r1', startBeat: 8, lenBeat: null, srcIn: 1.25, srcOut: 3.75, name: 'Solo' }],
        'the trimmed window is carried verbatim on save');
    const reloaded = _trackSessionNormalizePure(JSON.parse(JSON.stringify(saved)), sources, arrangements, drumTab);
    assert.deepStrictEqual(reloaded, saved, 'reload yields an identical session — no start/len/trim drift');
});

for (const [name, fn] of tests) {
    try { await fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
