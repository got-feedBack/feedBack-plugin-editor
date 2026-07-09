'use strict';
/*
 * Pending-view helper tests for screen.js.
 *
 * Run: node tests/pending_view.test.js
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
const m = src.match(/\/\* @pure:pending-view:start \*\/[\s\S]*?\/\* @pure:pending-view:end \*\//);
if (!m) {
    console.error('FAIL: @pure:pending-view block not found in screen.js');
    process.exit(1);
}

const api = new Function(
    '"use strict";' + m[0] + '\nreturn { _resolvePendingViewStatePure };'
)();

let pass = 0;
let fail = 0;
function t(name, fn) {
    try { fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}

t('uses bar start as cursor fallback and centers scroll when only a region is provided', () => {
    const out = api._resolvePendingViewStatePure({
        barSel: { startTime: 12, endTime: 20, mode: 'free' },
        returnToHighway: true,
    }, 100, 1000, 52);
    assert.strictEqual(out.returnToHighway, true);
    // Loop mode must survive the highway round-trip (free/grid loops must not
    // be silently demoted to 'bar').
    assert.deepStrictEqual(out.barSel, { startTime: 12, endTime: 20, mode: 'free' });
    assert.strictEqual(out.zoom, 100);
    assert.strictEqual(out.cursorTime, 12);
    assert.ok(out.scrollX < 12 && out.scrollX >= 0);
});

t('prefers explicit cursor, zoom, and scroll when provided', () => {
    const out = api._resolvePendingViewStatePure({
        barSel: { startTime: 8, endTime: 16 },
        zoom: 180,
        cursorTime: 10.5,
        scrollX: -4,
    }, 100, 1000, 52);
    assert.strictEqual(out.returnToHighway, false);
    assert.strictEqual(out.zoom, 180);
    assert.strictEqual(out.cursorTime, 10.5);
    assert.strictEqual(out.scrollX, 0);
});

t('leaves cursor and scroll empty when no region or explicit position exists', () => {
    const out = api._resolvePendingViewStatePure({}, 120, 800, 52);
    assert.strictEqual(out.barSel, null);
    assert.strictEqual(out.zoom, 120);
    assert.strictEqual(out.cursorTime, null);
    assert.strictEqual(out.scrollX, null);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
