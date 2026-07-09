'use strict';
/*
 * Tests for the follow-playhead toggle (@pure:follow-scroll block): the
 * playback auto-scroll is now gated on the follow pref (Shift+L), so an
 * author can inspect one spot while the song plays on. The policy math
 * (80% trigger, 30% landing) is unchanged from the shipped behavior —
 * pinned here; the follow-off null return fails on main, where the
 * scroll is unconditional.
 *
 * Run: node tests/follow_toggle.test.js
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
const m = src.match(/\/\* @pure:follow-scroll:start \*\/[\s\S]*?\/\* @pure:follow-scroll:end \*\//);
if (!m) {
    console.error('FAIL: @pure:follow-scroll block not found in screen.js');
    process.exit(1);
}
const { _followScrollTargetPure } = new Function(
    '"use strict";' + m[0] + '\nreturn { _followScrollTargetPure };'
)();

let pass = 0, fail = 0;
function t(name, fn) {
    try { fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}

t('follow on: cursor past 80% of the view jumps it to the 30% mark', () => {
    // 800px view at zoom 100 px/s, cursor at 10 s drawn at x=700 (> 640).
    const target = _followScrollTargetPure(10, 700, 800, 100, true);
    assert.ok(Math.abs(target - (10 - 240 / 100)) < 1e-9, 'cursor lands at 30% of the view');
});

t('follow on: cursor inside the window leaves scroll alone', () => {
    assert.strictEqual(_followScrollTargetPure(10, 300, 800, 100, true), null);
    assert.strictEqual(_followScrollTargetPure(10, 640, 800, 100, true), null, 'exactly at 80% does not trigger');
});

t('follow OFF: never scrolls, even past the trigger point', () => {
    assert.strictEqual(_followScrollTargetPure(10, 700, 800, 100, false), null);
    assert.strictEqual(_followScrollTargetPure(999, 100000, 800, 100, false), null);
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
