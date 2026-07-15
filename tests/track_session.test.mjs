import assert from 'node:assert';
import {
    _trackSessionMoveBeforePure,
    _trackSessionNormalizePure,
    _trackSessionPairPure,
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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);