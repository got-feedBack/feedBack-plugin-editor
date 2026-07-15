/*
 * Timeline pan uses the dominant wheel axis (src/mouse.js onWheel).
 *
 * A horizontal-dominant trackpad swipe is preventDefault'd, so if the pan reads
 * deltaY (tiny for a horizontal swipe) the timeline barely moves and the gesture
 * reads as dead. Horizontal-dominant input must pan by deltaX; a plain vertical
 * wheel still pans by deltaY.
 *
 * Run: node tests/wheel_pan.test.mjs
 */
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, '..', 'src', 'mouse.js'), 'utf8');
const start = source.indexOf('function onWheel(');
if (start < 0) throw new Error('onWheel not found in src/mouse.js');
const block = source.slice(start).replace(/^export\s+/gm, '');

function makeEnv(S) {
    const scrollCalls = [];
    const host = {
        scrollTrackArea(d) { scrollCalls.push(d); },
        updateZoomDisplay() {}, draw() {},
    };
    const onWheel = new Function(
        'S', 'host', 'getMousePos', 'xToTime', '_editorClampScrollX', 'LABEL_W',
        `${block}\nreturn onWheel;`,
    )(S, host, () => ({ x: 0 }), () => 0, v => v, 0);
    return { onWheel, scrollCalls };
}

let pass = 0, fail = 0;
function t(name, fn) {
    try { fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}

t('horizontal-dominant swipe pans by deltaX', () => {
    const S = { partsViewMode: false, zoom: 100, scrollX: 0 };
    const { onWheel } = makeEnv(S);
    onWheel({ deltaX: 200, deltaY: 1, ctrlKey: false, preventDefault() {} });
    // 0 + 200/100*2 = 4 (would be ~0.02 if it still consumed deltaY)
    assert.strictEqual(S.scrollX, 4);
});

t('vertical-dominant wheel still pans by deltaY', () => {
    const S = { partsViewMode: false, zoom: 100, scrollX: 0 };
    const { onWheel } = makeEnv(S);
    onWheel({ deltaX: 0, deltaY: 50, ctrlKey: false, preventDefault() {} });
    assert.strictEqual(S.scrollX, 1); // 50/100*2
});

t('parts view: horizontal-dominant falls through to a deltaX pan, not track scroll', () => {
    const S = { partsViewMode: true, zoom: 100, scrollX: 0 };
    const { onWheel, scrollCalls } = makeEnv(S);
    onWheel({ deltaX: 200, deltaY: 1, ctrlKey: false, preventDefault() {} });
    assert.strictEqual(scrollCalls.length, 0, 'track area not scrolled by a horizontal swipe');
    assert.strictEqual(S.scrollX, 4, 'timeline pans by deltaX');
});

t('parts view: vertical-dominant scrolls the track area', () => {
    const S = { partsViewMode: true, zoom: 100, scrollX: 0 };
    const { onWheel, scrollCalls } = makeEnv(S);
    onWheel({ deltaX: 1, deltaY: 80, ctrlKey: false, preventDefault() {} });
    assert.deepStrictEqual(scrollCalls, [80]);
    assert.strictEqual(S.scrollX, 0, 'timeline untouched while scrolling tracks');
});

console.log(`wheel pan: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
