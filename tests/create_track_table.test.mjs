import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, '..', 'src', 'create.js'), 'utf8');
const screen = fs.readFileSync(path.join(here, '..', 'screen.html'), 'utf8');
const match = source.match(/\/\* @pure:create-track-table:start \*\/[\s\S]*?\/\* @pure:create-track-table:end \*\//);
if (!match) throw new Error('create-track-table pure block missing');
const context = {};
vm.createContext(context);
vm.runInContext(match[0].replace(/^export\s+/gm, ''), context);

const audio = [
    { id: 'audio:1', name: 'Master.wav', url: '/storage/master.wav' },
    { id: 'audio:2', name: 'Drums.wav', url: '/storage/drums.wav', selected: false },
];
const gp = [
    { index: 2, name: 'Lead', notes: 100, selected: true },
    { index: 3, name: 'Bass', notes: 90, selected: false },
];
const midi = [
    { index: 4, name: 'Keys', notes: 50, selected: true },
    { index: 5, name: 'Strings', notes: 40, selected: true },
];

const rows = context._createTrackRowsPure({ audioTracks: audio, tracks: gp, midiTracks: midi }, '');
assert.deepStrictEqual(JSON.parse(JSON.stringify(rows.map(row => [row.id, row.kind, row.selected]))), [
    ['audio:1', 'audio', true],
    ['audio:2', 'audio', false],
    ['gp:2', 'guitar-pro', true],
    ['gp:3', 'guitar-pro', false],
    ['midi:4', 'midi', true],
    ['midi:5', 'midi', true],
]);

assert.strictEqual(context._createGuideIdPure(rows, 'audio:2'), 'audio:1', 'excluded audio cannot be guide');
assert.strictEqual(context._createGuideIdPure(rows, 'gp:2'), 'audio:1', 'transcription cannot masquerade as audio guide');
assert.strictEqual(context._createGuideIdPure(rows, 'missing'), 'audio:1');

const payload = context._createAudioPayloadPure(audio, 'audio:2');
assert.strictEqual(payload.audio_url, '/storage/master.wav');
assert.deepStrictEqual(JSON.parse(JSON.stringify(payload.audio_tracks)), [
    { id: 'audio:1', name: 'Master.wav', url: '/storage/master.wav', guide: true },
]);

assert.ok(!source.includes('Audio track included'), 'audio Use checkbox is not hard-disabled');
assert.ok(source.includes('type="radio" name="editor-create-guide"'), 'Guide is exclusive');
assert.ok(screen.includes('<span>Use</span><span>Track</span><span>Type</span><span>Guide</span>'));
assert.ok(!screen.includes('<span>Details</span>'), 'empty Details column is removed');

console.log('create track table: 7 passed');
