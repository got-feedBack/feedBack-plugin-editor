import assert from 'node:assert';
import { S } from '../src/state.js';
import { TempoGridCmd, _tempoAppendBarlinePure } from '../src/tempo.js';

const grid = () => [
    { time: 0, measure: 1, den: 4 }, { time: 0.5, measure: -1 },
    { time: 1, measure: -1 }, { time: 1.5, measure: -1 },
    { time: 2, measure: 2, den: 4 },
];
const appended = _tempoAppendBarlinePure(grid(), 4);
assert.ok(appended);
assert.strictEqual(appended.measure, 3);
assert.strictEqual(appended.beatCount, 4);
assert.deepStrictEqual(appended.beats.slice(-4).map(b => b.time), [2.5, 3, 3.5, 4]);

const odd = [{ time: 0, measure: 8, den: 8 },
    ...Array.from({ length: 6 }, (_, i) => ({ time: (i + 1) * 0.25, measure: -1 })),
    { time: 1.75, measure: 9, den: 8 }];
const oddAppend = _tempoAppendBarlinePure(odd, 3.5);
assert.strictEqual(oddAppend.beatCount, 7);
assert.strictEqual(oddAppend.denominator, 8);
assert.strictEqual(oddAppend.beats.at(-1).measure, 10);

const rubatoTail = grid().concat([
    { time: 2.43, measure: -1 }, { time: 3.02, measure: -1 },
    { time: 3.61, measure: -1 }]);
const preserved = _tempoAppendBarlinePure(rubatoTail, 4.2);
assert.deepStrictEqual(preserved.beats.slice(5, 8), rubatoTail.slice(5));
assert.strictEqual(preserved.beatCount, 4);
assert.strictEqual(_tempoAppendBarlinePure(rubatoTail, 3.62), null);

Object.assign(S, { beats: grid(), arrangements: [{
    notes: [{ time: 3, sustain: 0, beat: 5 }], chords: [], anchors: [],
    anchors_user: [], handshapes: [], phrases: [] }], drumTab: null,
    sections: [], barSel: null, currentArr: 0, editGen: 0, tempoSel: 4 });
const before = S.beats.map(b => ({ ...b }));
const cmd = new TempoGridCmd(before, appended.beats, 'mark barline', 4, appended.index);
cmd.exec();
assert.strictEqual(S.arrangements[0].notes[0].time, 3);
assert.strictEqual(S.arrangements[0].notes[0].beat, 6);
assert.strictEqual(S.tempoSel, appended.index);
cmd.rollback();
assert.deepStrictEqual(S.beats, before);
assert.strictEqual(S.tempoSel, 4);
assert.strictEqual(S.arrangements[0].notes[0].time, 3);
cmd.exec();
assert.deepStrictEqual(S.beats, appended.beats);
assert.strictEqual(S.tempoSel, appended.index);
console.log('tempo barline append: all assertions passed');
