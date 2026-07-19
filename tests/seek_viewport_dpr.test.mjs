/*
 * Keyboard-seek viewport math on a HiDPI display (src/input.js).
 *
 * canvas.width is DEVICE pixels; LABEL_W and S.zoom are CSS pixels. Every other
 * consumer divides by DPR before mixing them (audio.js's follow path always
 * has). _editorSeekToTime did not, so on a 2x display the right edge was
 * computed a full viewport too far out and a seek past the real edge never
 * scrolled the view.
 *
 * DPR is a module-level const read from window.devicePixelRatio at import time,
 * so window is installed before the graph is pulled in and the whole file runs
 * at DPR 2. Expected values are stated in the CSS-pixel model: a 1600px-device
 * canvas at DPR 2 is an 800px-CSS viewport.
 *
 * Run: node tests/seek_viewport_dpr.test.mjs
 */
import assert from 'node:assert';

globalThis.window = {
    devicePixelRatio: 2,
    addEventListener() {},
    localStorage: { getItem() { return null; }, setItem() {} },
};

const { setCanvas, DPR } = await import('../src/canvas.js');
const { S } = await import('../src/state.js');
const { LABEL_W } = await import('../src/geometry.js');
const { _editorSeekToTime } = await import('../src/input.js');

const DEVICE_W = 1600;          // 800 CSS px at DPR 2
const CSS_W = DEVICE_W / 2;
const ZOOM = 120;               // px per second
const VIEW_SECONDS = (CSS_W - LABEL_W) / ZOOM;   // 6.2333… s of timeline on screen
const MARGIN = 0.15 * (CSS_W / ZOOM);            // 1.0 s

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

function seed(scrollX) {
    setCanvas({ width: DEVICE_W, height: 400, getContext: () => ({}) });
    Object.assign(S, {
        duration: 60, audioShift: 0, audioBuffer: null,
        zoom: ZOOM, scrollX, cursorTime: 0, playing: false,
    });
}

t('the fixture really is a HiDPI viewport', () => {
    assert.strictEqual(DPR, 2);
    assert.ok(Math.abs(VIEW_SECONDS - 6.2333333) < 1e-6);
});

// The regression. On main `right` was (1600 - 52) / 120 = 12.9s, so a seek to
// 8s looked comfortably on-screen and the view never moved.
t('seeking past the right edge scrolls the view on a 2x display', () => {
    seed(0);
    assert.ok(8 > VIEW_SECONDS, 'fixture must seek past the real right edge');
    _editorSeekToTime(8);
    assert.ok(S.scrollX > 0, 'view did not follow the cursor');
    assert.ok(Math.abs(S.scrollX - (8 - MARGIN)) < 1e-9);
});

// The margin is CSS-derived too: on main it was 0.15 * 1600 / 120 = 2.0s, so
// this lands at 8.0 there and 9.0 here.
t('seeking left of the view scrolls back by a CSS-pixel margin', () => {
    seed(20);
    _editorSeekToTime(10);
    assert.ok(Math.abs(S.scrollX - (10 - MARGIN)) < 1e-9);
});

t('a cursor already inside the view leaves scroll alone', () => {
    seed(0);
    _editorSeekToTime(3);
    assert.strictEqual(S.scrollX, 0);
});

t('the cursor is still clamped into the song', () => {
    seed(0);
    _editorSeekToTime(-5);
    assert.strictEqual(S.cursorTime, 0);
    seed(0);
    _editorSeekToTime(999);
    assert.strictEqual(S.cursorTime, 60);
});
