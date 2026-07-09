/*
 * Tempo-map sync-point inspector helper tests for src/tempo.js.
 *
 * Run: node tests/tempo_sync_inspector.test.mjs
 */
import assert from 'node:assert';
import {
    _tempoSyncInspectorStatePure,
} from '../src/tempo.js';

let pass = 0;
let fail = 0;
function t(name, fn) {
    try { fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}

const measures = [
    { i: 0, measure: 1, beats: 4, denominator: 4, bpm: 120, isLast: false },
    { i: 4, measure: 2, beats: 7, denominator: 8, bpm: 96.25, isLast: false },
    { i: 11, measure: 3, beats: 7, denominator: 8, bpm: 96.25, isLast: true },
];

t('asks for a selected sync point before enabling edits', () => {
    const state = _tempoSyncInspectorStatePure(measures, -1);
    assert.strictEqual(state.label, 'No sync point selected');
    assert.strictEqual(state.bpmDisabled, true);
    assert.strictEqual(state.signatureDisabled, true);
    assert.strictEqual(state.bpmValue, '');
    assert.strictEqual(state.canInsert, true);
    assert.strictEqual(state.canDelete, false);
});

t('shows editable BPM and signature for a selected non-final measure', () => {
    const state = _tempoSyncInspectorStatePure(measures, 4);
    assert.strictEqual(state.label, 'Measure 2');
    assert.strictEqual(state.bpmValue, '96.25');
    assert.strictEqual(state.bpmDisabled, false);
    assert.strictEqual(state.numeratorValue, '7');
    assert.strictEqual(state.denominatorValue, '8');
    assert.strictEqual(state.signatureDisabled, false);
    assert.strictEqual(state.hint, '7/8');
    assert.strictEqual(state.canInsert, true);
    assert.strictEqual(state.canDelete, true);
    assert.strictEqual(state.deleteTitle, 'Delete selected sync point');
});

t('keeps signature editable but disables BPM for the final measure', () => {
    const state = _tempoSyncInspectorStatePure(measures, 11);
    assert.strictEqual(state.label, 'Measure 3');
    assert.strictEqual(state.bpmValue, '');
    assert.strictEqual(state.bpmDisabled, true);
    assert.strictEqual(state.signatureDisabled, false);
    assert.ok(state.bpmTitle.includes('closing downbeat'));
    assert.ok(state.hint.includes('final measure BPM'));
    assert.strictEqual(state.canInsert, true);
    assert.strictEqual(state.canDelete, false);
    assert.ok(state.deleteTitle.includes('cannot be deleted'));
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);