import assert from 'node:assert';
import fs from 'node:fs';

globalThis.document = globalThis.document || {
    getElementById: () => null,
    addEventListener() {}, removeEventListener() {},
};
globalThis.window = globalThis.window || globalThis;
globalThis.localStorage = globalThis.localStorage || { getItem: () => null, setItem() {} };

const {
    _musicXmlCreateFailureMessagePure, _xmlImportKindPure,
} = await import('../src/create.js');

const realWorldHeader = `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 3.0 Partwise//EN"
  "http://www.musicxml.org/dtds/partwise.dtd">
<score-partwise version="3.0"><part-list/></score-partwise>`;

assert.strictEqual(_xmlImportKindPure(realWorldHeader), 'musicxml',
    'XML declaration + external MusicXML DOCTYPE must still route to MusicXML');
assert.strictEqual(_xmlImportKindPure('<m:score-partwise xmlns:m="urn:test"/>'), 'musicxml',
    'namespaced MusicXML roots are recognized');
assert.strictEqual(_xmlImportKindPure('<track><sync>0#0</sync></track>'), 'goplayalong');
assert.strictEqual(_xmlImportKindPure('<song><arrangement>Lead</arrangement></song>'), 'arrangement');
assert.strictEqual(_xmlImportKindPure('<!-- <score-partwise/> --><song/>'), 'arrangement',
    'MusicXML-looking example markup in a comment is not the document root');

assert.strictEqual(
    _musicXmlCreateFailureMessagePure('Error registering arrangement: backend unavailable.'),
    'MusicXML import failed after project creation: Error registering arrangement: backend unavailable. '
        + 'The placeholder track is still open; use Add Keys ▸ MusicXML to retry.',
);

const screen = fs.readFileSync(new URL('../screen.html', import.meta.url), 'utf8');
assert.match(screen, /accept="[^"]*\.musicxml[^"]*\.mxl[^"]*"/,
    'Content Import exposes MusicXML and compressed MusicXML extensions');
const createSource = fs.readFileSync(new URL('../src/create.js', import.meta.url), 'utf8');
assert.match(createSource, /if \(!added\) setStatus\(_musicXmlCreateFailureMessagePure/,
    'post-create append failures must reach the visible editor status');

console.log('musicxml create routing: 8 passed');
