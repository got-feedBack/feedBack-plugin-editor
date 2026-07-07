'use strict';
/*
 * Loop-undo symmetry + mode round-trip tests for screen.js.
 *
 * Covers two reviewer-confirmed fixes:
 *   1. TempoMapCmd.exec/rollback must be a self-inverse for the loop region:
 *      undo of a tempo edit restores the EXACT pre-edit S.barSel instead of
 *      re-deriving it from the (already relocked) grid — which was lossy and
 *      turned a bar loop [2,4] into [1,6] after edit+undo.
 *   2. The editor<->3D-highway handoff must carry region.mode so a freely
 *      drawn loop survives the round-trip (and isn't demoted to 'bar').
 *
 * The TempoMapCmd class is pulled verbatim from screen.js and run against
 * lightweight stubs, so the test validates the shipping code path. The relock
 * stub deliberately MOVES the loop, proving rollback ignores it.
 *
 * Run: node tests/loop_undo_mode.test.js
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const src = fs.readFileSync(path.join(__dirname, '..', 'screen.js'), 'utf8');

// ── Extract the real TempoMapCmd class body ──────────────────────────────────
const cm = src.match(/class TempoMapCmd \{[\s\S]*?\n\}/);
if (!cm) {
    console.error('FAIL: TempoMapCmd class not found in screen.js');
    process.exit(1);
}

// ── Extract the pending-view pure block (3D-handoff resolver) ────────────────
const pm = src.match(/\/\* @pure:pending-view:start \*\/[\s\S]*?\/\* @pure:pending-view:end \*\//);
if (!pm) {
    console.error('FAIL: @pure:pending-view block not found in screen.js');
    process.exit(1);
}
const { _resolvePendingViewStatePure } = new Function(
    '"use strict";' + pm[0] + '\nreturn { _resolvePendingViewStatePure };'
)();

let pass = 0, fail = 0;
function t(name, fn) {
    try { fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}

// Build a TempoMapCmd bound to stub globals. `_loopRelockAfterGridChange`
// simulates the lossy forward relock by MOVING the loop, so we can prove
// rollback restores the snapshot rather than re-running relock.
function makeCmd(S) {
    const relockMoved = { startTime: 1, endTime: 6, mode: 'bar' };
    const TempoMapCmd = new Function(
        'S', '_loopRelockAfterGridChange', '_renderLoopStrip', '_updateLoopIn3DBtn',
        '_captureScopedTimes', '_restoreScopedTimes', '_applyTempoRemap',
        '_makeTimeRemap', '_tempoRideSet',
        '"use strict";' + cm[0] + '\nreturn TempoMapCmd;'
    )(
        S,
        () => { S.barSel = { ...relockMoved }; },   // lossy relock: moves the loop
        () => {},                                    // _renderLoopStrip
        () => {},                                    // _updateLoopIn3DBtn
        () => ({ times: 'captured' }),               // _captureScopedTimes
        () => {},                                    // _restoreScopedTimes
        () => {},                                    // _applyTempoRemap
        () => (x => x),                              // _makeTimeRemap
        () => ({ drum: true, arrs: [] })             // _tempoRideSet (frozen ride)
    );
    return { TempoMapCmd, relockMoved };
}

t('TempoMapCmd: exec relocks the loop, rollback restores the EXACT original', () => {
    const oldBeats = [{ time: 0, measure: 1 }, { time: 2, measure: 2 }];
    const newBeats = [{ time: 0, measure: 1 }, { time: 3, measure: 2 }];
    const S = {
        beats: oldBeats.map(b => ({ ...b })),
        barSel: { startTime: 2, endTime: 4, mode: 'bar' },
        tempoRideScope: 'selection',
        duration: 10,
    };
    const original = { ...S.barSel };
    const { TempoMapCmd, relockMoved } = makeCmd(S);
    const cmd = new TempoMapCmd(oldBeats, newBeats, 'bpm');

    cmd.exec();
    // Forward relock still runs on exec (live edit re-snaps the loop).
    assert.deepStrictEqual(S.barSel, relockMoved, 'exec should relock (move) the loop');

    cmd.rollback();
    assert.deepStrictEqual(S.barSel, original, 'rollback must restore the exact original barSel');
    assert.notStrictEqual(S.barSel, original, 'restored barSel must be a fresh copy');

    // Redo re-applies the forward relock.
    cmd.exec();
    assert.deepStrictEqual(S.barSel, relockMoved, 'redo must re-apply the relock');
});

t('TempoMapCmd: a null loop selection round-trips as null', () => {
    const oldBeats = [{ time: 0, measure: 1 }];
    const newBeats = [{ time: 0, measure: 1 }];
    const S = { beats: [], barSel: null, tempoRideScope: 'selection', duration: 10 };
    const { TempoMapCmd } = makeCmd(S);
    const cmd = new TempoMapCmd(oldBeats, newBeats, 'bpm');
    cmd.exec();
    cmd.rollback();
    assert.strictEqual(S.barSel, null, 'rollback restores the null selection');
});

// ── 3D-handoff: region.mode survives the resolver ────────────────────────────
t('pending-view resolver carries a free loop mode through the 3D handoff', () => {
    const pv = { barSel: { startTime: 1.28, endTime: 4.71, mode: 'free' } };
    const out = _resolvePendingViewStatePure(pv, 1, 800, 60);
    assert.strictEqual(out.barSel.mode, 'free', 'free mode must survive the round-trip');
    assert.strictEqual(out.barSel.startTime, 1.28);
    assert.strictEqual(out.barSel.endTime, 4.71);
});

t('pending-view resolver carries a grid loop mode too', () => {
    const pv = { barSel: { startTime: 2, endTime: 6, mode: 'grid' } };
    const out = _resolvePendingViewStatePure(pv, 1, 800, 60);
    assert.strictEqual(out.barSel.mode, 'grid');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
