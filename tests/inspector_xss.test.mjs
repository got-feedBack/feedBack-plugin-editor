/*
 * The inspector escapes note-derived values before assigning innerHTML.
 *
 * A feedpak is an untrusted file. The server's _note() coerces string/fret to
 * ints (routes.py), so a hostile value cannot reach the client through the load
 * path today — but the panel must not DEPEND on that: a note that ever arrived
 * un-coerced would inject markup. This drives the real _renderInspector with a
 * hostile fret and asserts the value is escaped in the innerHTML it writes
 * (CodeRabbit, #176).
 *
 * Run: node tests/inspector_xss.test.mjs
 */
import assert from 'node:assert';
import { _renderInspector } from '../src/inspector.js';
import { S } from '../src/state.js';

const PAYLOAD = '<img src=x onerror="window.__XSS=1">';

// Capture the innerHTML the panel writes, with no jsdom. `_renderInspector`
// only needs #editor-inspector; give it a stub that records every assignment.
let lastHtml = '';
const panel = {
    _html: '',
    get innerHTML() { return this._html; },
    set innerHTML(v) { this._html = v; lastHtml = v; },
    classList: { contains: () => false, add() {}, remove() {} },
    querySelectorAll: () => [],
};
globalThis.document = { getElementById: (id) => (id === 'editor-inspector' ? panel : null) };

// A single selected note whose fret is the payload — exactly what would arrive
// from a persisted note that dodged coercion.
Object.assign(S, {
    arrangements: [{ id: 'a1', name: 'Lead', notes: [
        { time: 0, string: PAYLOAD, fret: PAYLOAD, sustain: 0, techniques: {} },
    ] }],
    currentArr: 0,
    sel: new Set([0]),
});

let pass = 0, fail = 0;
function t(name, fn) {
    try { fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}

t('the hostile fret does not survive as a raw <img> tag', () => {
    _renderInspector();
    assert.ok(lastHtml.length > 0, 'the panel rendered something');
    assert.ok(!/<img\s/i.test(lastHtml),
        'a raw <img> tag reached innerHTML — the value was not escaped:\n' + lastHtml.slice(0, 400));
});

t('the payload is present, but as escaped entities', () => {
    // It should still be visible to the user — escaped, not stripped.
    assert.ok(lastHtml.includes('&lt;img') || lastHtml.includes('&lt;'),
        'the payload was neither escaped nor present; expected &lt;img…');
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
