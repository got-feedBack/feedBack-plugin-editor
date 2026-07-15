import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, '..', 'src', 'create.js'), 'utf8');
const match = source.match(/\/\* @pure:create-track-table:start \*\/[\s\S]*?\/\* @pure:create-track-table:end \*\//);
if (!match) throw new Error('create-track-table pure block missing');
const context = {};
vm.createContext(context);
vm.runInContext(match[0].replace(/^export\s+/gm, ''), context);

const audio = [
    { id: 'audio:1', name: 'Master.wav', url: '/storage/master.wav' },
    { id: 'audio:2', name: 'Drums.wav', url: '/storage/drums.wav' },
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
    ['audio:2', 'audio', true],
    ['gp:2', 'guitar-pro', true],
    ['gp:3', 'guitar-pro', false],
    ['midi:4', 'midi', true],
    ['midi:5', 'midi', true],
]);

assert.strictEqual(context._createGuideIdPure(rows, 'audio:2'), 'audio:2');
assert.strictEqual(context._createGuideIdPure(rows, 'gp:2'), 'audio:1', 'transcription cannot masquerade as audio guide');
assert.strictEqual(context._createGuideIdPure(rows, 'missing'), 'audio:1');

const payload = context._createAudioPayloadPure(audio, 'audio:2');
assert.strictEqual(payload.audio_url, '/storage/drums.wav');
assert.deepStrictEqual(JSON.parse(JSON.stringify(payload.audio_tracks)), [
    { id: 'audio:2', name: 'Drums.wav', url: '/storage/drums.wav', guide: true },
    { id: 'audio:1', name: 'Master.wav', url: '/storage/master.wav', guide: false },
]);

console.log('create track table: 3 passed');
