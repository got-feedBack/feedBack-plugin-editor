'use strict';
/*
 * Tests for the boot/teardown listener registry (@pure:boot-teardown block).
 *
 * The host can re-inject the editor screen. document/window-level listeners
 * registered by a previous injection outlive the replaced DOM, so without a
 * teardown they STACK — double keystrokes per keypress, orphaned handlers,
 * growing leaks across a session. Every global registration now goes through
 * a tracked registry; each boot calls the previous injection's teardown
 * (published on window.__editorScreenTeardown) before registering its own.
 *
 * This pins the registry contract: add() registers and tracks (opts
 * included), removeAll() removes exactly what was added and is idempotent.
 *
 * Run: node tests/boot_teardown.test.js
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
const m = src.match(/\/\* @pure:boot-teardown:start \*\/[\s\S]*?\/\* @pure:boot-teardown:end \*\//);
if (!m) {
    console.error('FAIL: @pure:boot-teardown block not found in src/main.js');
    process.exit(1);
}
const { _makeListenerRegistry } = new Function(
    '"use strict";' + m[0] + '\nreturn { _makeListenerRegistry };'
)();

let pass = 0, fail = 0;
function t(name, fn) {
    try { fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}

// Fake event target recording add/remove pairs.
function makeTarget(name) {
    const added = [], removed = [];
    return {
        name, added, removed,
        addEventListener: (type, fn, opts) => added.push({ type, fn, opts }),
        removeEventListener: (type, fn, opts) => removed.push({ type, fn, opts }),
    };
}

t('add() registers immediately and tracks the registration', () => {
    const reg = _makeListenerRegistry();
    const doc = makeTarget('document');
    const fn = () => {};
    reg.add(doc, 'keydown', fn);
    assert.strictEqual(doc.added.length, 1);
    assert.strictEqual(doc.added[0].fn, fn);
    assert.strictEqual(reg.count(), 1);
});

t('removeAll() removes exactly what was added, same fn and opts', () => {
    const reg = _makeListenerRegistry();
    const doc = makeTarget('document');
    const win = makeTarget('window');
    const a = reg.add(doc, 'keydown', () => {});
    const b = reg.add(doc, 'input', () => {});
    const c = reg.add(win, 'resize', () => {}, { passive: true });
    reg.removeAll();
    assert.strictEqual(doc.removed.length, 2);
    assert.strictEqual(win.removed.length, 1);
    assert.strictEqual(doc.removed[0].fn, a);
    assert.strictEqual(doc.removed[1].fn, b);
    assert.strictEqual(win.removed[0].fn, c);
    assert.deepStrictEqual(win.removed[0].opts, { passive: true }, 'opts round-trip');
    assert.strictEqual(reg.count(), 0);
});

t('removeAll() is idempotent (a second call removes nothing new)', () => {
    const reg = _makeListenerRegistry();
    const doc = makeTarget('document');
    reg.add(doc, 'keydown', () => {});
    reg.removeAll();
    reg.removeAll();
    assert.strictEqual(doc.removed.length, 1);
});

t('a throwing removeEventListener does not abort the sweep', () => {
    const reg = _makeListenerRegistry();
    const bad = makeTarget('bad');
    bad.removeEventListener = () => { throw new Error('detached'); };
    const good = makeTarget('good');
    reg.add(bad, 'keydown', () => {});
    reg.add(good, 'mouseup', () => {});
    assert.doesNotThrow(() => reg.removeAll());
    assert.strictEqual(good.removed.length, 1, 'later registrations still removed');
    assert.strictEqual(reg.count(), 0);
});

t('re-boot simulation: two registries never double-register', () => {
    // Boot 1 registers; boot 2 tears boot 1 down before registering.
    const doc = makeTarget('document');
    const boot1 = _makeListenerRegistry();
    boot1.add(doc, 'keydown', () => {});
    boot1.add(doc, 'input', () => {});
    // ── re-injection ──
    boot1.removeAll();                     // window.__editorScreenTeardown()
    const boot2 = _makeListenerRegistry();
    boot2.add(doc, 'keydown', () => {});
    boot2.add(doc, 'input', () => {});
    const live = doc.added.length - doc.removed.length;
    assert.strictEqual(live, 2, 'exactly one live set of listeners');
});

// ── Published teardown body: real cleanup steps beyond the registry ──
// The window.__editorScreenTeardown closure lives outside the @pure block and
// closes over module globals. Extract its body and drive it with injected
// fakes so we can assert the ResizeObserver disconnect and the boot-poll
// clearInterval actually happen.
const tm = src.match(/window\.__editorScreenTeardown = \(\) => \{([\s\S]*?)\n\};/);
if (!tm) {
    console.error('FAIL: window.__editorScreenTeardown closure not found in src/main.js');
    process.exit(1);
}
function runTeardown(over) {
    const cleared = [];
    const state = Object.assign({
        _globalListeners: { removeAll() {} },
        S: {},
        rafId: null,
        _editorScreenObs: null,
        _v3TopbarWatch: null,
        _v3LayoutObs: null,
        _bootPollInterval: null,
        cancelAnimationFrame: () => {},
        clearInterval: (id) => { cleared.push(id); },
    }, over);
    const fn = new Function(
        '_globalListeners', 'S', 'rafId', '_editorScreenObs', '_v3TopbarWatch',
        '_v3LayoutObs', '_bootPollInterval', 'cancelAnimationFrame', 'clearInterval',
        tm[1] + '\nreturn { _v3LayoutObs, _bootPollInterval };'
    );
    const out = fn(state._globalListeners, state.S, state.rafId, state._editorScreenObs,
        state._v3TopbarWatch, state._v3LayoutObs, state._bootPollInterval,
        state.cancelAnimationFrame, state.clearInterval);
    return { out, cleared };
}

t('teardown disconnects the v3 layout ResizeObserver and nulls it', () => {
    let disconnected = 0;
    const obs = { disconnect() { disconnected++; } };   // fake ResizeObserver instance
    const { out } = runTeardown({ _v3LayoutObs: obs });
    assert.strictEqual(disconnected, 1, 'ResizeObserver disconnected once');
    assert.strictEqual(out._v3LayoutObs, null, 'observer reference cleared');
});

t('teardown clears the pre-canvas boot poll interval and nulls the handle', () => {
    const { out, cleared } = runTeardown({ _bootPollInterval: 4242 });
    assert.deepStrictEqual(cleared, [4242], 'clearInterval called with the poll id');
    assert.strictEqual(out._bootPollInterval, null, 'interval handle cleared');
});

t('teardown is a no-op on the optional #98 draw-cancel hook when absent', () => {
    // _cancelPendingDraw is undeclared here → typeof guard must not throw.
    assert.doesNotThrow(() => runTeardown({}));
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
