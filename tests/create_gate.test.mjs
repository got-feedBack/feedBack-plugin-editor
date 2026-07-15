/*
 * Create-modal gate — the Create button enable logic. The modal is now ONE menu
 * with no Blank/Guitar Pro/EOF mode toggle: the gate is INPUT-DRIVEN. A picked
 * Guitar Pro file enables it, then EOF XML arrangement(s); otherwise it's a
 * from-scratch DRAFT create, which needs only a title (audio + artist optional —
 * draft-now, audio-later). Brace-extracts the real pure gate from src/main.js (a
 * single browser IIFE) so there's no drift.
 *
 * Run: node tests/create_gate.test.mjs
 */
import assert from 'node:assert';
import { _createGateOpen } from '../src/create.js';

let pass = 0, fail = 0;
function t(name, fn) {
    try { fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}
const inp = (o = {}) => ({ hasTitle: false, hasArtist: false, hasAudio: false, ...o });

t('from-scratch: title is the only gate; the removed roster UI cannot block creation', () => {
    assert.strictEqual(_createGateOpen({}, inp({ hasTitle: true })), true);
    assert.strictEqual(_createGateOpen({}, inp()), false);
    assert.strictEqual(_createGateOpen({ roster: [] }, inp({ hasTitle: true })), true);
});

t('a staged MIDI alone opens the gate (like a GP file — the fix for the dead-end import)', () => {
    assert.strictEqual(_createGateOpen({ midiFiles: [{ name: 'dkcjungle-2.mid' }], roster: [] }, inp()), true);
    assert.strictEqual(_createGateOpen({ midiFiles: [], roster: [] }, inp()), false, 'empty list is not a stage');
    assert.strictEqual(_createGateOpen({ midiFiles: null, roster: [] }, inp()), false);
});

t('gp file wins regardless of roster/title', () => {
    assert.strictEqual(_createGateOpen({ gpPath: '/song.gp', roster: [] }, inp()), true);
    assert.strictEqual(_createGateOpen({ gpPath: '/song.gp', tracks: [{ notes: 10, selected: false }] }, inp()), false);
    assert.strictEqual(_createGateOpen({ gpPath: null, roster: [] }, inp({ hasTitle: true })), true);
});

t('eof file(s) win regardless of roster/title', () => {
    assert.strictEqual(_createGateOpen({ eofFiles: [{}], roster: [] }, inp()), true);
    assert.strictEqual(_createGateOpen({ eofFiles: [], roster: ['Lead'] }, inp({ hasTitle: true })), true); // empty list -> roster+title
    assert.strictEqual(_createGateOpen({ eofFiles: null, roster: [] }, inp()), false);
});

t('defensive: null state / null flags -> disabled', () => {
    assert.strictEqual(_createGateOpen(null, inp({ hasTitle: true })), false);
    assert.strictEqual(_createGateOpen({ roster: ['Lead'] }, null), false);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
