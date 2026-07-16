/*
 * Persistent track session (the first-class track tree): normalization
 * against the loaded song, pairing PROJECTION from stemLinks, folders,
 * non-destructive audio removal, the tempo-guide role, and the
 * default-tree-persists-nothing rule.
 *
 * Pinned here:
 *   - the tree REFERENCES canonical song data (source ids, chart-track
 *     keys) and never copies it: unknown references drop on normalize,
 *     new song parts append, a corrupted parent cycle can never hide a
 *     branch;
 *   - transcription rows key by _partViewKeyPure (id-or-name — the SAME
 *     key stemLinks uses) while mixKey stays the partMix session address
 *     ('arr:<idx>' / 'drums');
 *   - pairing is NOT stored on the tree: rows project S.stemLinks, and a
 *     link pointing at a removed source projects as unpaired instead of
 *     resurrecting it;
 *   - deleting an audio row is a TOMBSTONE (removedSourceIds) — media
 *     stays, normalize does not resurrect the row, restore brings it back;
 *   - a fully-default tree saves as null so untouched packs stay
 *     byte-identical (absent ≠ null on the wire);
 *   - the create/import seam (installCreatedTrackSession) adopts the
 *     server's audio_sources wholesale: bare stem ids (the 'stem:' prefix
 *     is the create-payload namespace, not the persisted one) and an
 *     unconditional S.stems reset so a previous song's stems can never
 *     leak into a fresh import;
 *   - the save and build bodies both ship track_session (the wire).
 *
 * Run: node tests/track_session.test.mjs
 */
import assert from 'node:assert';

const {
    _trackSessionSourcesPure,
    _trackSessionTargetsPure,
    _trackSessionNormalizePure,
    _trackSessionRowsPure,
    _trackSessionDeletePure,
    _trackSessionRestorePure,
    _trackSessionMovePure,
    _trackSessionCreateFolderPure,
    _trackSessionRenamePure,
    _trackSessionIsDefaultPure,
    installCreatedTrackSession,
    trackSessionSavePayload,
} = await import('../src/track-session.js');
const { S } = await import('../src/state.js');

let pass = 0; let fail = 0;
const tests = [];
const t = (name, fn) => tests.push([name, fn]);

const sources = [
    { id: 'master', name: 'Master Mix', kind: 'master', url: '/a.ogg' },
    { id: 'Guitar_L', name: 'Guitar_L', kind: 'stem', url: '/s1.ogg' },
];
const arrangements = [{ name: 'Lead' }, { name: 'Bass' }];
const drumTab = { name: 'Drums', hits: [{ t: 0 }] };
const empty = { version: 2, tracks: [], removedSourceIds: [], tempoGuideSourceId: '', tempoGuideLocked: false, tempoGuideMode: 'audio' };

t('sources derive from (audioUrl, stems) with bare stem ids, master first', () => {
    const derived = _trackSessionSourcesPure('/a.ogg', [{ id: 'Guitar_L', url: '/s1.ogg' }, { id: 'Guitar_L', url: '/dup.ogg' }, { id: '', url: '/bad.ogg' }]);
    assert.deepStrictEqual(derived.map(s => [s.id, s.kind]), [['master', 'master'], ['Guitar_L', 'stem']]);
    assert.deepStrictEqual(_trackSessionSourcesPure('', []), [], 'no audio, no stems → no sources');
});

t('targets key by _partViewKeyPure with mixKey as the partMix address; duplicate names stay distinct', () => {
    const targets = _trackSessionTargetsPure([{ id: 'stable-1', name: 'Lead' }, { name: 'Rhythm' }, { name: 'Rhythm' }], drumTab);
    assert.deepStrictEqual(targets.map(x => [x.id, x.mixKey]), [
        ['stable-1', 'arr:0'], ['Rhythm', 'arr:1'], ['Rhythm′', 'arr:2'], ['drums', 'drums'],
    ]);
});

t('an empty tree normalizes into master, stem, and transcription leaves in canonical order', () => {
    const model = _trackSessionNormalizePure(empty, sources, arrangements, drumTab);
    assert.deepStrictEqual(model.tracks.map(track => track.id),
        ['audio:master', 'audio:Guitar_L', 'transcription:Lead', 'transcription:Bass', 'transcription:drums']);
    assert.strictEqual(model.tempoGuideSourceId, 'master', 'guide defaults to the first visible source');
});

t('unknown references drop and a corrupted parent cycle repairs to the root', () => {
    const model = _trackSessionNormalizePure({
        tracks: [
            { id: 'audio:ghost', type: 'audio', sourceId: 'ghost' },
            { id: 'transcription:Gone', type: 'transcription', targetId: 'Gone' },
            { id: 'folder:1', type: 'folder', name: 'A', parentId: 'folder:2' },
            { id: 'folder:2', type: 'folder', name: 'B', parentId: 'folder:1' },
            { id: 'audio:master', type: 'audio', sourceId: 'master', parentId: 'folder:1' },
        ],
    }, sources, arrangements, null);
    assert.ok(!model.tracks.some(track => track.id === 'audio:ghost' || track.id === 'transcription:Gone'));
    const f1 = model.tracks.find(track => track.id === 'folder:1');
    const f2 = model.tracks.find(track => track.id === 'folder:2');
    assert.ok(f1.parentId === '' || f2.parentId === '', 'the cycle is broken');
    const rows = _trackSessionRowsPure(model, sources, arrangements, null, {}).rows;
    assert.ok(rows.some(row => row.id === 'audio:master'), 'no branch is hidden from the rows');
});

t('persisted items cannot steal canonical source or transcription ids', () => {
    const model = _trackSessionNormalizePure({
        tracks: [
            { id: 'audio:master', type: 'folder', name: 'Collision' },
            { id: 'child', type: 'audio', sourceId: 'Guitar_L', parentId: 'audio:master' },
            { id: 'transcription:Lead', type: 'audio', sourceId: 'master' },
        ],
    }, sources, arrangements, null);
    const master = model.tracks.filter(track => track.type === 'audio' && track.sourceId === 'master');
    const lead = model.tracks.filter(track => track.type === 'transcription' && track.targetId === 'Lead');
    assert.strictEqual(master.length, 1, 'the canonical Master Mix row is present exactly once');
    assert.strictEqual(lead.length, 1, 'the canonical transcription row is present exactly once');
    const folder = model.tracks.find(track => track.type === 'folder' && track.name === 'Collision');
    assert.ok(folder && folder.id !== 'audio:master', 'the conflicting folder receives a safe id');
    assert.strictEqual(model.tracks.find(track => track.id === 'child').parentId, folder.id,
        'children follow the renamed folder instead of being orphaned');
});

t('pairing projects from stemLinks and never resurrects a removed source', () => {
    const links = { Lead: 'Guitar_L', Bass: 'ghost' };
    const rows = _trackSessionRowsPure(empty, sources, arrangements, null, links).rows;
    assert.strictEqual(rows.find(row => row.id === 'transcription:Lead').pairedSourceId, 'Guitar_L');
    assert.strictEqual(rows.find(row => row.id === 'transcription:Bass').pairedSourceId, '', 'unknown stem projects unpaired');
    const removed = _trackSessionDeletePure(empty, 'audio:Guitar_L', sources, arrangements, null);
    const rowsAfter = _trackSessionRowsPure(removed, sources, arrangements, null, links).rows;
    assert.strictEqual(rowsAfter.find(row => row.id === 'transcription:Lead').pairedSourceId, '',
        'a link to a tombstoned source projects unpaired');
});

t('deleting an audio row tombstones the source; normalize does not resurrect it; restore does', () => {
    const removed = _trackSessionDeletePure({ ...empty, tempoGuideSourceId: 'Guitar_L' }, 'audio:Guitar_L', sources, arrangements, null);
    assert.deepStrictEqual(removed.removedSourceIds, ['Guitar_L']);
    assert.ok(!removed.tracks.some(track => track.sourceId === 'Guitar_L'));
    assert.strictEqual(removed.tempoGuideSourceId, 'master', 'guide repairs to the next visible source');
    const reopened = _trackSessionNormalizePure(removed, sources, arrangements, null);
    assert.ok(!reopened.tracks.some(track => track.sourceId === 'Guitar_L'), 'normalize honors the tombstone');
    const restored = _trackSessionRestorePure(reopened, 'Guitar_L', sources, arrangements, null);
    assert.deepStrictEqual(restored.removedSourceIds, []);
    assert.ok(restored.tracks.some(track => track.sourceId === 'Guitar_L'), 'restore re-appends the row');
});

t('folders: create, move-inside with descendant guard, delete promotes children', () => {
    let model = _trackSessionCreateFolderPure(empty, sources, arrangements, null, 'Band');
    model = _trackSessionMovePure(model, 'audio:Guitar_L', 'folder:1', 'inside', sources, arrangements, null);
    model = _trackSessionMovePure(model, 'transcription:Lead', 'folder:1', 'inside', sources, arrangements, null);
    // Drop-inside inserts at the TOP of the folder (right below its row),
    // so the most recent drop lists first.
    assert.deepStrictEqual(model.tracks.filter(track => track.parentId === 'folder:1').map(track => track.id),
        ['transcription:Lead', 'audio:Guitar_L']);
    const guarded = _trackSessionMovePure(model, 'folder:1', 'audio:Guitar_L', 'after', sources, arrangements, null);
    assert.strictEqual(guarded.tracks.find(track => track.id === 'folder:1').parentId, '',
        'a folder can never become its own descendant');
    const promoted = _trackSessionDeletePure(model, 'folder:1', sources, arrangements, null);
    assert.ok(!promoted.tracks.some(track => track.id === 'folder:1'));
    assert.ok(promoted.tracks.filter(track => ['audio:Guitar_L', 'transcription:Lead'].includes(track.id))
        .every(track => track.parentId === ''), 'children survive at the parent level');
});

t('rename stores a display override without touching canonical song data', () => {
    const model = _trackSessionRenamePure(empty, 'audio:Guitar_L', '  Crunchy L  ', sources, arrangements, null);
    assert.strictEqual(model.tracks.find(track => track.id === 'audio:Guitar_L').name, 'Crunchy L');
    const rows = _trackSessionRowsPure(model, sources, arrangements, null, {}).rows;
    assert.strictEqual(rows.find(row => row.id === 'audio:Guitar_L').name, 'Crunchy L');
});

t('guide mode: metronome survives, anything unknown falls back to audio', () => {
    assert.strictEqual(_trackSessionNormalizePure({ ...empty, tempoGuideMode: 'metronome' }, sources, arrangements, null).tempoGuideMode, 'metronome');
    assert.strictEqual(_trackSessionNormalizePure({ ...empty, tempoGuideMode: 'vst' }, sources, arrangements, null).tempoGuideMode, 'audio');
});

t('a fully-default tree is default; ANY customization is not', () => {
    assert.strictEqual(_trackSessionIsDefaultPure(empty, sources, arrangements, drumTab), true);
    const cases = [
        _trackSessionCreateFolderPure(empty, sources, arrangements, drumTab, 'F'),
        _trackSessionRenamePure(empty, 'audio:master', 'X', sources, arrangements, drumTab),
        _trackSessionDeletePure(empty, 'audio:Guitar_L', sources, arrangements, drumTab),
        _trackSessionMovePure(_trackSessionNormalizePure(empty, sources, arrangements, drumTab),
            'audio:Guitar_L', 'audio:master', 'before', sources, arrangements, drumTab),
        { ...empty, tempoGuideSourceId: 'Guitar_L' },
        { ...empty, tempoGuideLocked: true },
    ];
    for (const model of cases) {
        assert.strictEqual(_trackSessionIsDefaultPure(model, sources, arrangements, drumTab), false);
    }
});

t('the create/import seam adopts audio_sources wholesale — bare ids, unconditional stems reset', () => {
    Object.assign(S, { arrangements: [{ name: 'Lead' }], drumTab: null, stems: [{ id: 'Stale', url: '/old.ogg' }], audioUrl: '/old.ogg' });
    installCreatedTrackSession(null, [
        { id: 'master', name: 'Master Mix', kind: 'master', url: '/new.ogg' },
        { id: 'stem:Kick_In', name: 'Kick In', kind: 'stem', url: '/k.ogg' },
    ]);
    assert.deepStrictEqual(S.stems, [{ id: 'Kick_In', name: 'Kick In', url: '/k.ogg' }],
        'bare manifest ids; the previous song\'s stems are gone');
    assert.deepStrictEqual(S.trackSession.tracks.map(track => track.id),
        ['audio:master', 'audio:Kick_In', 'transcription:Lead']);
    installCreatedTrackSession(null, [{ id: 'master', name: 'M', kind: 'master', url: '/solo.ogg' }]);
    assert.deepStrictEqual(S.stems, [], 'a stemless import resets stems too');
});

t('savePayload is null for a default tree and the normalized tree otherwise', () => {
    Object.assign(S, { arrangements: [{ name: 'Lead' }], drumTab: null, stems: [{ id: 'Kick_In', url: '/k.ogg' }], audioUrl: '/a.ogg' });
    S.trackSession = { ...empty };
    assert.strictEqual(trackSessionSavePayload(), null);
    S.trackSession = _trackSessionDeletePure(S.trackSession, 'audio:Kick_In',
        _trackSessionSourcesPure(S.audioUrl, S.stems), S.arrangements, S.drumTab);
    const payload = trackSessionSavePayload();
    assert.deepStrictEqual(payload.removedSourceIds, ['Kick_In']);
});

t('the save and build bodies both ship track_session (the persistence wire)', async () => {
    const fs = await import('node:fs');
    const fileOps = fs.readFileSync(new URL('../src/file-ops.js', import.meta.url), 'utf8');
    assert.match(fileOps, /track_session:\s*trackSessionSavePayload\(\)/, 'save-body wire present');
    assert.match(fileOps, /installTrackSession\(data\.track_session/, 'load-boundary install present');
    const create = fs.readFileSync(new URL('../src/create.js', import.meta.url), 'utf8');
    assert.match(create, /track_session:\s*trackSessionSavePayload\(\)/,
        'create-mode Build ships the tree too (the third save path)');
});

for (const [name, fn] of tests) {
    try { await fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
