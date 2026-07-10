/*
 * Loop-region helper tests for src/loop.js.
 *
 * Run: node tests/loop_region.test.mjs
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

const _mRaw = src.match(/\/\* @pure:loop-region:start \*\/[\s\S]*?\/\* @pure:loop-region:end \*\//);
if (!_mRaw) {
    console.error('FAIL: @pure:loop-region block not found in src/loop.js');
    process.exit(1);
}
const m = [_mRaw[0].replace(/^export\s+/gm, '')];

const api = new Function(
    '"use strict";' + _loopPuresSrc() + m[0] + '\nreturn { _barSpanForTimesPure, _adjustBarSelEdgePure, _normalizeLoopRegionPure, _loopPlaybackRestartTimePure };'
)();

let pass = 0;
let fail = 0;
function t(name, fn) {
    try { fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}

const downbeats = [0, 2, 4, 6, 8];

t('bar span snaps outward to whole bars', () => {
    assert.deepStrictEqual(api._barSpanForTimesPure(downbeats, 10, 2.4, 5.1), { startTime: 2, endTime: 6 });
});

t('bar span uses song end when dragged past last downbeat', () => {
    assert.deepStrictEqual(api._barSpanForTimesPure(downbeats, 10, 7.2, 9.3), { startTime: 6, endTime: 10 });
});

t('start handle clamps to prior downbeat without crossing the end', () => {
    const region = { startTime: 2, endTime: 6 };
    assert.deepStrictEqual(api._adjustBarSelEdgePure(region, 'start', 0.8, downbeats, 10), { startTime: 0, endTime: 6 });
    assert.deepStrictEqual(api._adjustBarSelEdgePure(region, 'start', 5.8, downbeats, 10), { startTime: 4, endTime: 6 });
});

t('end handle snaps to the next downbeat or duration', () => {
    const region = { startTime: 2, endTime: 6 };
    assert.deepStrictEqual(api._adjustBarSelEdgePure(region, 'end', 6.1, downbeats, 10), { startTime: 2, endTime: 8 });
    assert.deepStrictEqual(api._adjustBarSelEdgePure(region, 'end', 8.2, downbeats, 10), { startTime: 2, endTime: 10 });
});

t('normalizes loop regions and rejects empty spans', () => {
    assert.deepStrictEqual(api._normalizeLoopRegionPure({ startTime: 8, endTime: 2 }, 10), { startTime: 2, endTime: 8 });
    assert.deepStrictEqual(api._normalizeLoopRegionPure({ startTime: -1, endTime: 12 }, 10), { startTime: 0, endTime: 10 });
    assert.strictEqual(api._normalizeLoopRegionPure({ startTime: 3, endTime: 3 }, 10), null);
    assert.strictEqual(api._normalizeLoopRegionPure({ startTime: 'x', endTime: 4 }, 10), null);
});

t('active loop playback restarts when the cursor reaches the region end', () => {
    const region = { startTime: 2, endTime: 6 };
    assert.strictEqual(api._loopPlaybackRestartTimePure(5.9, region, true, 10), null);
    assert.strictEqual(api._loopPlaybackRestartTimePure(6, region, true, 10), 2);
    assert.strictEqual(api._loopPlaybackRestartTimePure(8, region, false, 10), null);
    assert.strictEqual(api._loopPlaybackRestartTimePure(6, null, true, 10), null);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);