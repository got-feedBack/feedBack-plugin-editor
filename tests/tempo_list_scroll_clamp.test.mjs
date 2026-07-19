/*
 * The Tempo List's bar jump respects the scroll bounds (src/tempo-list.js).
 *
 * _gotoMark was the one non-zero scrollX writer in the editor that did not go
 * through _editorClampScrollX — it only floored at 0. Jumping to a bar near the
 * end of a song therefore parked the view PAST maxScroll, showing dead timeline
 * beyond the last bar until some unrelated resize or zoom happened to call
 * _editorApplyScrollBounds and snap it back.
 *
 * Run: node tests/tempo_list_scroll_clamp.test.mjs
 */
import assert from 'node:assert';
import { S } from '../src/state.js';
import { _editorClampScrollX } from '../src/loop.js';
import { _gotoMark } from '../src/tempo-list.js';

function t(name, fn) {
    try {
        fn();
        console.log('ok - ' + name);
    } catch (err) {
        console.error('not ok - ' + name);
        console.error(err && err.stack || err);
        process.exitCode = 1;
    }
}

const DURATION = 60;

// One beat per bar, a bar a second; bar 60 sits at t=59, near the song end.
function seed() {
    const beats = [];
    for (let i = 0; i < DURATION; i++) beats.push({ measure: i + 1, time: i });
    Object.assign(S, {
        beats,
        duration: DURATION, audioShift: 0, audioBuffer: null,
        zoom: 120, scrollX: 0, tempoMapMode: true, tempoSel: -1, tempoSelMulti: null,
        tempoMarks: [{ measure: 60, kind: 'hold', bpm: 120 }, { measure: 2, kind: 'hold', bpm: 120 }],
    });
}

// maxScroll is whatever the clamp pins an absurd request to.
const maxScroll = () => _editorClampScrollX(1e9);

t('the fixture really does put the last bar past maxScroll', () => {
    seed();
    assert.ok(59 - 0.5 > maxScroll(),
        'unclamped jump must overshoot, or the test proves nothing');
});

// The regression: on main this lands at 58.5, well past the end of the song.
t('jumping to a bar near the end pins to maxScroll', () => {
    seed();
    _gotoMark(0);
    assert.strictEqual(S.scrollX, maxScroll());
    assert.ok(S.scrollX < 59 - 0.5);
});

t('a mid-song jump still lands on the 0.5s lead-in', () => {
    seed();
    _gotoMark(1);           // bar 2 → t=1
    assert.ok(Math.abs(S.scrollX - 0.5) < 1e-9, 'unchanged where no clamping is needed');
});

t('the jump still floors at 0', () => {
    seed();
    S.tempoMarks = [{ measure: 1, kind: 'hold', bpm: 120 }];   // t=0 → 0 - 0.5
    _gotoMark(0);
    assert.strictEqual(S.scrollX, 0);
});

t('the selection still moves with the jump', () => {
    seed();
    _gotoMark(1);
    assert.strictEqual(S.tempoSel, 1, 'bar 2 is beats[1]');
});

t('a bar that is not on the grid leaves the view alone', () => {
    seed();
    S.scrollX = 3;
    S.tempoMarks = [{ measure: 999, kind: 'hold', bpm: 120 }];
    _gotoMark(0);
    assert.strictEqual(S.scrollX, 3);
});
