import assert from 'node:assert';
import {
    _trackRenameEditorMarkupPure,
    _trackSessionLaneHeightPure,
    _trackSessionLaneLayoutPure,
    _trackSessionDropPlacementPure,
    _trackSessionDensityPure,
    _trackSessionDeletePure,
    _trackSessionFittedHeightsPure,
    _trackSessionMoveBeforePure,
    _trackSessionMovePure,
    _trackSessionNormalizePure,
    _trackSessionPairPure,
    _trackSessionRenamePure,
    _trackSessionRowsPure,
} from '../src/track-session.js';

let pass = 0; let fail = 0;
function test(name, fn) {
    try { fn(); pass++; console.log('  ok   ' + name); }
    catch (error) { fail++; console.error('  FAIL ' + name + ': ' + error.message); }
}

const sources = [
    { id: 'master', name: 'Master Mix', kind: 'master' },
    { id: 'stem:0', name: 'Drums', kind: 'stem' },
];
const arrangements = [{ id: 'guitar', name: 'Guitar' }];
const base = { version: 1, tracks: [], tempoGuideSourceId: 'master', tempoGuideLocked: false };

test('old packs normalize into a master, stem, and transcription leaves', () => {
    const session = _trackSessionNormalizePure(base, sources, arrangements, null);
    assert.deepStrictEqual(session.tracks.map(track => track.id),
        ['audio:master', 'audio:stem:0', 'transcription:guitar']);
});

test('a transcription pairing is stable by opaque source id', () => {
    const paired = _trackSessionPairPure(base, 'transcription:guitar', 'stem:0', sources, arrangements, null);
    assert.strictEqual(paired.tracks.find(track => track.id === 'transcription:guitar').pairedSourceId, 'stem:0');
    const rejected = _trackSessionPairPure(paired, 'transcription:guitar', 'missing', sources, arrangements, null);
    assert.strictEqual(rejected.tracks.find(track => track.id === 'transcription:guitar').pairedSourceId, 'stem:0');
});

test('metronome guide mode survives normalization and invalid modes fall back safely', () => {
    const click = _trackSessionNormalizePure({ ...base, tempoGuideMode: 'metronome' }, sources, arrangements, null);
    assert.strictEqual(click.tempoGuideMode, 'metronome');
    const invalid = _trackSessionNormalizePure({ ...base, tempoGuideMode: 'vst' }, sources, arrangements, null);
    assert.strictEqual(invalid.tempoGuideMode, 'audio');
});

test('deleting an audio track is durable, repairs guide and pair references, and keeps source media non-destructive', () => {
    const paired = _trackSessionPairPure({ ...base, tempoGuideSourceId: 'stem:0' }, 'transcription:guitar', 'stem:0', sources, arrangements, null);
    const removed = _trackSessionDeletePure(paired, 'audio:stem:0', sources, arrangements, null);
    assert.deepStrictEqual(removed.removedSourceIds, ['stem:0']);
    assert.ok(!removed.tracks.some(track => track.sourceId === 'stem:0'));
    assert.strictEqual(removed.tempoGuideSourceId, 'master');
    assert.strictEqual(removed.tracks.find(track => track.targetId === 'guitar').pairedSourceId, '');
    const reopened = _trackSessionNormalizePure(removed, sources, arrangements, null);
    assert.ok(!reopened.tracks.some(track => track.sourceId === 'stem:0'), 'normalization does not resurrect it');
});

test('deleting a folder promotes its immediate children instead of deleting their tracks', () => {
    const session = {
        ...base,
        tracks: [
            { id: 'folder:1', type: 'folder', name: 'Band', parentId: '' },
            { id: 'audio:stem:0', type: 'audio', sourceId: 'stem:0', parentId: 'folder:1' },
            { id: 'transcription:guitar', type: 'transcription', targetId: 'guitar', parentId: 'folder:1', pairedSourceId: 'stem:0' },
        ],
    };
    const removed = _trackSessionDeletePure(session, 'folder:1', sources, arrangements, null);
    assert.ok(!removed.tracks.some(track => track.id === 'folder:1'));
    assert.deepStrictEqual(removed.tracks.filter(track => track.id !== 'audio:master').map(track => [track.id, track.parentId]), [
        ['audio:stem:0', ''], ['transcription:guitar', ''],
    ]);
});

test('dropping on a folder nests the track and keeps rows visible', () => {
    const session = {
        ...base,
        tracks: [
            { id: 'folder:1', type: 'folder', name: 'Rhythm', parentId: '', collapsed: false },
            { id: 'audio:master', type: 'audio', sourceId: 'master', parentId: '' },
            { id: 'transcription:guitar', type: 'transcription', targetId: 'guitar', parentId: '', pairedSourceId: '' },
        ],
    };
    const moved = _trackSessionMoveBeforePure(session, 'transcription:guitar', 'folder:1', sources, arrangements, null);
    assert.strictEqual(moved.tracks.find(track => track.id === 'transcription:guitar').parentId, 'folder:1');
    const rows = _trackSessionRowsPure(moved, sources, arrangements, null).rows;
    assert.strictEqual(rows.find(row => row.id === 'transcription:guitar').depth, 1);
});

test('cyclic folder parents are repaired instead of hiding the tree', () => {
    const corrupt = {
        ...base,
        tracks: [
            { id: 'folder:1', type: 'folder', name: 'One', parentId: 'folder:2' },
            { id: 'folder:2', type: 'folder', name: 'Two', parentId: 'folder:1' },
        ],
    };
    const rows = _trackSessionRowsPure(corrupt, sources, arrangements, null).rows;
    assert.ok(rows.length >= 2);
});

test('track display names rename independently of stable identities', () => {
    const renamed = _trackSessionRenamePure(base, 'transcription:guitar', 'Lead DI', sources, arrangements, null);
    const track = renamed.tracks.find(item => item.id === 'transcription:guitar');
    assert.strictEqual(track.name, 'Lead DI');
    assert.strictEqual(track.targetId, 'guitar');
    const rows = _trackSessionRowsPure(renamed, sources, arrangements, null).rows;
    assert.strictEqual(rows.find(row => row.id === 'transcription:guitar').name, 'Lead DI');
    assert.strictEqual(rows.find(row => row.id === 'transcription:guitar').mixKey, 'arr:0');
});

test('right-click rename builds a prefilled editor for the track-list name cell', () => {
    const trackMarkup = _trackRenameEditorMarkupPure('audio:stem:0', 'Drums & Percussion');
    const folderMarkup = _trackRenameEditorMarkupPure('folder:1', 'Rhythm');
    for (const markup of [trackMarkup, folderMarkup]) {
        assert.match(markup, /data-track-rename-input/);
        assert.match(markup, /editor-track-inline-rename/);
        assert.match(markup, /draggable="false"/);
        assert.doesNotMatch(markup, /rename-save|rename-cancel/);
    }
    assert.match(trackMarkup, /Drums &amp; Percussion/);
    const session = { ...base, tracks: [{ id: 'folder:1', type: 'folder', name: 'Old', parentId: '' }] };
    const renamed = _trackSessionRenamePure(session, 'folder:1', 'Band', sources, arrangements, null);
    assert.strictEqual(renamed.tracks.find(track => track.id === 'folder:1').name, 'Band');
});

test('tracks and folders reorder before/after or nest at the folder center', () => {
    const session = {
        ...base,
        tracks: [
            { id: 'folder:1', type: 'folder', name: 'One', parentId: '' },
            { id: 'folder:2', type: 'folder', name: 'Two', parentId: '' },
            { id: 'audio:master', type: 'audio', sourceId: 'master', parentId: '' },
            { id: 'transcription:guitar', type: 'transcription', targetId: 'guitar', parentId: '', pairedSourceId: '' },
        ],
    };
    const after = _trackSessionMovePure(session, 'folder:1', 'folder:2', 'after', sources, arrangements, null);
    assert.deepStrictEqual(_trackSessionRowsPure(after, sources, arrangements, null).rows.slice(0, 2).map(row => row.id), ['folder:2', 'folder:1']);
    const nested = _trackSessionMovePure(session, 'audio:master', 'folder:1', 'inside', sources, arrangements, null);
    assert.strictEqual(nested.tracks.find(track => track.id === 'audio:master').parentId, 'folder:1');
    const before = _trackSessionMovePure(session, 'transcription:guitar', 'audio:master', 'before', sources, arrangements, null);
    assert.ok(before.tracks.findIndex(track => track.id === 'transcription:guitar') < before.tracks.findIndex(track => track.id === 'audio:master'));
    assert.strictEqual(_trackSessionDropPlacementPure(102, 100, 40, false), 'before');
    assert.strictEqual(_trackSessionDropPlacementPure(138, 100, 40, false), 'after');
    assert.strictEqual(_trackSessionDropPlacementPure(120, 100, 40, true), 'inside');
});

test('moving a folder into its descendant is refused and keeps the tree intact', () => {
    const session = {
        ...base,
        tracks: [
            { id: 'folder:1', type: 'folder', name: 'Parent', parentId: '' },
            { id: 'folder:2', type: 'folder', name: 'Child', parentId: 'folder:1' },
        ],
    };
    const refused = _trackSessionMovePure(session, 'folder:1', 'folder:2', 'inside', sources, arrangements, null);
    assert.strictEqual(refused.tracks.find(track => track.id === 'folder:1').parentId, '');
    assert.strictEqual(refused.tracks.find(track => track.id === 'folder:2').parentId, 'folder:1');
});

test('one lane layout drives matching header and canvas row geometry', () => {
    const rows = [{ id: 'audio:master' }, { id: 'folder:1' }, { id: 'transcription:guitar' }];
    const layout = _trackSessionLaneLayoutPure(rows, { 'folder:1': 32, 'transcription:guitar': 90 }, 20, 40);
    assert.deepStrictEqual(layout.lanes.map(item => [item.row.id, item.y, item.h]), [
        ['audio:master', 20, 56], ['folder:1', 76, 32], ['transcription:guitar', 108, 90],
    ]);
    assert.strictEqual(layout.contentHeight, 178);
    assert.strictEqual(_trackSessionLaneHeightPure({}, 'missing'), 56);
    assert.strictEqual(_trackSessionLaneHeightPure({ x: 999 }, 'x'), 160);
    assert.strictEqual(_trackSessionLaneHeightPure({ x: 2 }, 'x'), 28);
});

test('track-header density preserves the safe identity and M/S hierarchy', () => {
    assert.strictEqual(_trackSessionDensityPure(176), 'compact');
    assert.strictEqual(_trackSessionDensityPure(229), 'compact');
    assert.strictEqual(_trackSessionDensityPure(230), 'normal');
    assert.strictEqual(_trackSessionDensityPure(399), 'normal');
    assert.strictEqual(_trackSessionDensityPure(400), 'wide');
});

test('tall track areas auto-fit rows modestly and keep explicit proportions', () => {
    const rows = [{ id: 'a' }, { id: 'b' }];
    assert.deepStrictEqual(_trackSessionFittedHeightsPure(rows, {}, 300), { a: 88, b: 88 }, 'automatic bonus caps at 32px');
    assert.deepStrictEqual(_trackSessionFittedHeightsPure(rows, { a: 80, b: 40 }, 140), { a: 90, b: 50 });
    assert.deepStrictEqual(_trackSessionFittedHeightsPure(rows, { a: 80, b: 40 }, 100), { a: 80, b: 40 }, 'no shrink below authored height');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
