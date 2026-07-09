const fs = require('fs');
const path = require('path');
const assert = require('assert');

const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
const m = src.match(/\/\* @pure:scroll-bounds:start \*\/[\s\S]*?\/\* @pure:scroll-bounds:end \*\//);
if (!m) {
    console.error('FAIL: @pure:scroll-bounds block not found in src/main.js');
    process.exit(1);
}

const api = new Function(
    'console',
    '"use strict";' + m[0] + '\nreturn { _editorViewportDurationPure, _editorMaxScrollXPure, _editorClampScrollXPure };'
)(console);

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

t('computes visible timeline duration from canvas width and zoom', () => {
    assert.strictEqual(api._editorViewportDurationPure(1000, 52, 120), 7.9);
    assert.strictEqual(api._editorViewportDurationPure(40, 52, 120), 0);
    assert.strictEqual(api._editorViewportDurationPure(1000, 52, 0), 0);
});

t('keeps short songs pinned at the start when the full song fits', () => {
    const view = api._editorViewportDurationPure(1000, 52, 120);
    assert.strictEqual(api._editorMaxScrollXPure(4, view, 2), 0);
    assert.strictEqual(api._editorClampScrollXPure(30, 4, view, 2), 0);
    // Song fits the viewport but duration+tail exceeds it — the tail must NOT
    // create scroll room that would hide the beginning (6s song, 7s view, 2s).
    assert.strictEqual(api._editorMaxScrollXPure(6, 7, 2), 0);
    assert.strictEqual(api._editorClampScrollXPure(3, 6, 7, 2), 0);
});

t('allows a small tail past the end of longer songs', () => {
    const view = api._editorViewportDurationPure(1000, 52, 120);
    assert.strictEqual(api._editorMaxScrollXPure(20, view, 2), 14.1);
    assert.strictEqual(api._editorClampScrollXPure(99, 20, view, 2), 14.1);
    assert.strictEqual(api._editorClampScrollXPure(5, 20, view, 2), 5);
});

t('normalizes invalid or negative scroll input to a valid start position', () => {
    assert.strictEqual(api._editorClampScrollXPure(-5, 20, 5, 2), 0);
    assert.strictEqual(api._editorClampScrollXPure(Number.NaN, 20, 5, 2), 0);
    assert.strictEqual(api._editorClampScrollXPure(5, 0, 5, 2), 0);
});