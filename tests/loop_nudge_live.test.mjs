/*
 * Live-mode tests for the impure `_loopNudgeEdge` (arrow-key loop nudge).
 *
 * Unlike loop_nudge.test.js (which unit-tests the pure probe/adjust helpers),
 * this pulls the REAL `_loopNudgeEdge` + `_loopLiveMode` out of src/main.js and
 * runs them against lightweight stubs, so it validates the mode RESOLUTION:
 *   - Shift forces Free even when the region was drawn in bar mode (the
 *     editor-wide "Shift = temporary Free" idiom — nudge now matches the drag
 *     path instead of trusting r.mode and ignoring Shift);
 *   - Grid mode with the subdivision snap OFF degrades to Free instead of
 *     jumping a whole beat;
 *   - song-edge clamps: nudging an end past the song duration pins to DUR and
 *     nudging a start below 0 pins to 0.
 *
 * Run: node tests/loop_nudge_live.test.mjs
 */
import assert from 'node:assert';
import fs from 'node:fs';

const src = fs.readFileSync(new URL('../src/loop.js', import.meta.url), 'utf8');
// The two loop pures moved to src/transport.js (#178). The rest of this file's
// sliced @pure:loop-region block still calls them by name, so prepend their real
// source to the slice — same scope, same behaviour, no re-implementation.
const _transportSrc = fs.readFileSync(new URL('../src/transport.js', import.meta.url), 'utf8');
function _loopPuresSrc() {
    const out = [];
    for (const name of ['_normalizeLoopRegionPure', '_loopPlaybackRestartTimePure']) {
        const start = _transportSrc.indexOf('export function ' + name);
        if (start < 0) throw new Error('missing in transport.js: ' + name);
        const open = _transportSrc.indexOf('{', start);
        let d = 0;
        for (let i = open; i < _transportSrc.length; i++) {
            if (_transportSrc[i] === '{') d++;
            else if (_transportSrc[i] === '}' && --d === 0) {
                out.push(_transportSrc.slice(start, i + 1).replace(/^export /, ''));
                break;
            }
        }
    }
    return out.join('\n') + '\n';
}

function extract(name) {
    const re = new RegExp(
        '/\\* @pure:' + name + ':start \\*/[\\s\\S]*?/\\* @pure:' + name + ':end \\*/');
    const m = src.match(re);
    if (!m) { console.error(`FAIL: @pure:${name} block missing`); process.exit(1); }
    return m[0].replace(/^export\s+/gm, '');
}
function fn(name) {
    const m = src.match(new RegExp('(?:export )?function ' + name + '\\([\\s\\S]*?\\n\\}'));
    if (!m) { console.error(`FAIL: function ${name} not found`); process.exit(1); }
    return m[0].replace(/^export\s+/gm, '');
}

const region = extract('loop-region');
const nudgePure = extract('loop-nudge');
const liveModeSrc = fn('_loopLiveMode');
const nudgeSrc = fn('_loopNudgeEdge');

const SNAP_VALUES = [1, 0.5, 0.25, 0.125, 0.0625, 0];
const DOWNBEATS = [0, 2, 4, 6, 8];
const DUR = 10;

// Build a bound `_loopNudgeEdge` over a fresh state + stubbed impure globals.
function build({ barSel, pref = 'bar', snapEnabled = false, snapIdx = 1,
                 downbeats = DOWNBEATS, snapStep = 0.5, duration = DUR }) {
    const S = { barSel, beats: [], duration, snapEnabled, snapIdx };
    // _loopNudgeEdge reaches main.js through `host` now (seek, snap step, the
    // Loop-in-3D refresh, draw). Snap step comes from host.editorSnapStepSeconds.
    const host = {
        editorSnapStepSeconds: () => snapStep,
        editorSeekToTime: () => {}, updateLoopIn3DBtn: () => {}, draw: () => {},
    };
    const factory = new Function(
        'S', 'host', '_downbeatTimes', '_loopSnapModePref',
        'snapTime', 'SNAP_VALUES', '_editorEffectiveSnapValuePure',
        '_renderLoopStrip', '_setBarSel',
        '"use strict";'
        + _loopPuresSrc() + region + '\n' + nudgePure + '\n' + liveModeSrc + '\n' + nudgeSrc
        + '\nreturn _loopNudgeEdge;'
    );
    const nudge = factory(
        S, host,
        () => downbeats,          // _downbeatTimes
        pref,                     // _loopSnapModePref
        (t) => t,                 // snapTime (identity)
        SNAP_VALUES,
        (en, v) => (en ? v : 0),  // _editorEffectiveSnapValuePure
        () => {},                 // _renderLoopStrip
        (r) => { S.barSel = r; return r; }   // _setBarSel: assign (β-sync isn't under test here)
    );
    return { S, nudge };
}

let pass = 0, fail = 0;
function t(name, f) {
    try { f(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}

// ── Shift = temporary Free, even for a bar-drawn loop ─────────────────────────
t('bar loop + Shift nudges by the Free 50 ms step, not a whole bar', () => {
    const { S, nudge } = build({ barSel: { startTime: 2, endTime: 4, mode: 'bar' }, pref: 'bar' });
    const ok = nudge('end', +1, /* coarse/shift */ true);
    assert.strictEqual(ok, true);
    assert.ok(Math.abs(S.barSel.endTime - 4.05) < 1e-9, `endTime=${S.barSel.endTime}`);
    assert.strictEqual(S.barSel.mode, 'free', 'Shift restamps the region Free like the drag path');
});

t('bar loop WITHOUT Shift still jumps a whole bar', () => {
    const { S, nudge } = build({ barSel: { startTime: 2, endTime: 4, mode: 'bar' }, pref: 'bar' });
    nudge('end', +1, false);
    assert.strictEqual(S.barSel.endTime, 6);
    assert.strictEqual(S.barSel.mode, 'bar');
});

// ── Grid + snap OFF degrades to Free ──────────────────────────────────────────
t('grid pref with snap OFF nudges by the Free 10 ms step, not a whole beat', () => {
    const { S, nudge } = build({
        barSel: { startTime: 1, endTime: 3, mode: 'grid' }, pref: 'grid',
        snapEnabled: false, snapStep: 0.5,
    });
    nudge('end', +1, false);
    assert.ok(Math.abs(S.barSel.endTime - 3.01) < 1e-9, `endTime=${S.barSel.endTime}`);
});

t('grid pref with snap ON nudges by one snap step', () => {
    const { S, nudge } = build({
        barSel: { startTime: 1, endTime: 3, mode: 'grid' }, pref: 'grid',
        snapEnabled: true, snapStep: 0.5,
    });
    nudge('end', +1, false);
    assert.strictEqual(S.barSel.endTime, 3.5);
});

// ── Song-edge clamps ──────────────────────────────────────────────────────────
t('nudging the end past the song duration clamps to DUR', () => {
    const { S, nudge } = build({ barSel: { startTime: 8, endTime: 9.98, mode: 'free' }, pref: 'free' });
    nudge('end', +1, true);   // 9.98 + 0.05 = 10.03 → clamp
    assert.strictEqual(S.barSel.endTime, DUR);
});

t('nudging the start below 0 clamps to 0', () => {
    const { S, nudge } = build({ barSel: { startTime: 0.02, endTime: 5, mode: 'free' }, pref: 'free' });
    nudge('start', -1, true);  // 0.02 - 0.05 = -0.03 → clamp
    assert.strictEqual(S.barSel.startTime, 0);
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
