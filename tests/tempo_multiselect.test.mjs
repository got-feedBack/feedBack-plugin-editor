/*
 * Barline multi-select + marquee + bulk delete (PR 5a).
 *
 * Covers the marquee hit math, the bulk-delete grid transform, the bulk delete
 * round-trip through TempoGridCmd, and the set-lifecycle contract (the index
 * set is dropped — never remapped — on any topology change).
 *
 * Run: node tests/tempo_multiselect.test.mjs
 */
import assert from 'node:assert';
import { S } from '../src/state.js';
import { EditHistory } from '../src/history.js';
import {
    TempoGridCmd, _tempoDeletableBarlineIndicesPure, _tempoDeleteBarlinesPure, _tempoDeleteSelection,
    _tempoMarqueeDownbeatsPure, _tempoSelectedDownbeatRunsPure, _tempoSelectDownbeatRange,
} from '../src/tempo.js';
import { seedState, trackHooks } from './_history_env.mjs';

let pass = 0, fail = 0;
function t(name, fn) {
    try { fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}

// Downbeats at indices 0/4/8/12 (measures 1..4), sub-beats between.
function grid() {
    const b = [];
    for (let m = 0; m < 4; m++) {
        b.push({ time: m * 4, measure: m + 1 });
        for (let k = 1; k < 4; k++) b.push({ time: m * 4 + k, measure: -1 });
    }
    return b;   // length 16; downbeats at 0,4,8,12
}
const mkArr = () => ({ name: 'G', notes: [{ string: 0, time: 5, sustain: 0 }], chords: [], anchors: [], anchors_user: [], handshapes: [], phrases: [] });
function seed() {
    trackHooks();
    seedState({ arrangements: [mkArr()], currentArr: 0, sessionId: 's1', beats: grid(), sections: [], duration: 16, history: new EditHistory() });
    S.tempoSelMulti = new Set();
    S.tempoSel = -1;
}

// ── marquee hit math (pure) ──────────────────────────────────────────
t('_tempoMarqueeDownbeatsPure returns only downbeats in the time range', () => {
    const b = grid();
    assert.deepStrictEqual(_tempoMarqueeDownbeatsPure(b, 3.5, 8.5), [4, 8], 'downbeats at t=4 and t=8');
    assert.deepStrictEqual(_tempoMarqueeDownbeatsPure(b, 8.5, 3.5), [4, 8], 'order-independent');
    assert.deepStrictEqual(_tempoMarqueeDownbeatsPure(b, 1.2, 3.9), [], 'a sub-beat-only span selects nothing');
    assert.deepStrictEqual(_tempoMarqueeDownbeatsPure(b, -1, 99), [0, 4, 8, 12], 'a wide span = all downbeats');
});

// ── bulk-delete transform (pure) ─────────────────────────────────────
t('_tempoDeleteBarlinesPure demotes interior downbeats + renumbers; guards first/last', () => {
    const b = grid();
    const res = _tempoDeleteBarlinesPure(b, [4, 8]);
    assert.strictEqual(res.count, 2);
    assert.strictEqual(res.beats[4].measure, -1, 'demoted');
    assert.strictEqual(res.beats[8].measure, -1, 'demoted');
    assert.deepStrictEqual(res.beats.filter(x => x.measure > 0).map(x => x.measure), [1, 2], 'renumbered to 1,2');
    // First (0) and last (12) are filtered out — never deletable.
    assert.strictEqual(_tempoDeleteBarlinesPure(b, [0, 12]), null, 'first/last only → nothing to do');
    assert.strictEqual(_tempoDeleteBarlinesPure(b, []), null);
    // With a first+interior mix, only the interior goes.
    const mix = _tempoDeleteBarlinesPure(b, [0, 4]);
    assert.strictEqual(mix.count, 1);
    assert.strictEqual(mix.beats[4].measure, -1);
    assert.strictEqual(mix.beats[0].measure, 1, 'the first downbeat survives');
});

// ── bulk delete round-trip through the command ───────────────────────
t('_tempoDeleteSelection deletes the multi-selection in ONE undoable command', () => {
    seed();
    S.tempoSelMulti = new Set([4, 8]);
    const before = S.beats.map(b => b.measure);
    _tempoDeleteSelection();
    assert.strictEqual(S.beats.filter(b => b.measure > 0).length, 2, 'two downbeats remain (0,12 → 1,2)');
    assert.strictEqual(S.tempoSelMulti.size, 0, 'selection cleared after delete');
    assert.strictEqual(S.history.undo.length, 1, 'exactly one command');
    S.history.doUndo();
    assert.deepStrictEqual(S.beats.map(b => b.measure), before, 'undo restores every measure number');
});

t('with nothing multi-selected, it falls back to the single focus', () => {
    seed();
    S.tempoSel = 8;   // an interior downbeat
    _tempoDeleteSelection();
    assert.strictEqual(S.beats[8].measure, -1, 'the focused barline was demoted');
    assert.strictEqual(S.tempoSel, -1, 'single-delete fallback clears focus');
    assert.strictEqual(S.tempoSelMulti.size, 0, 'single-delete fallback clears multi-selection');
    assert.strictEqual(S.history.undo.length, 1);
});

// ── set lifecycle: dropped (never remapped) on any topology change ───
t('TempoGridCmd exec AND rollback clear tempoSelMulti (never remap through topology)', () => {
    seed();
    S.tempoSelMulti = new Set([4, 8]);
    const flat = S.beats.map(b => ({ ...b }));
    flat[4].measure = -1;   // some topology edit
    S.history.exec(new TempoGridCmd(S.beats.map(b => ({ ...b })), flat, 'x'));
    assert.strictEqual(S.tempoSelMulti.size, 0, 'exec cleared it');
    S.tempoSelMulti = new Set([8]);   // re-populate, then undo
    S.history.doUndo();
    assert.strictEqual(S.tempoSelMulti.size, 0, 'rollback cleared it too');
});

t('_tempoSelectDownbeatRange adds the contiguous downbeats between two poles', () => {
    seed();
    _tempoSelectDownbeatRange(4, 12);
    assert.deepStrictEqual([...S.tempoSelMulti].sort((a, b) => a - b), [4, 8, 12], 'downbeats 4,8,12 (not the sub-beats)');
    S.tempoSelMulti.clear();
    _tempoSelectDownbeatRange(12, 4);
    assert.deepStrictEqual([...S.tempoSelMulti].sort((a, b) => a - b), [4, 8, 12], 'reverse endpoint order selects the same range');
});

t('_tempoSelectedDownbeatRunsPure keeps disjoint selected ranges separate', () => {
    const b = grid();
    b.push({ time: 16, measure: 5 }, { time: 17, measure: -1 }, { time: 18, measure: -1 }, { time: 19, measure: -1 });
    b.push({ time: 20, measure: 6 });
    assert.deepStrictEqual(_tempoSelectedDownbeatRunsPure(b, new Set([4, 8, 16, 20])), [[4, 8], [16, 20]]);
    assert.deepStrictEqual(_tempoSelectedDownbeatRunsPure(b, new Set([0, 12])), [[0], [12]]);
});

t('_tempoDeletableBarlineIndicesPure counts only interior barlines', () => {
    const b = grid();
    assert.deepStrictEqual(_tempoDeletableBarlineIndicesPure(b, new Set([0, 4, 8, 12])), [4, 8]);
    assert.deepStrictEqual(_tempoDeletableBarlineIndicesPure(b, new Set([0, 12])), []);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
