/*
 * Tests for closing the playability-lint popover (src/playability-lint.js
 * + assets/v3-theme.css).
 *
 * The user-facing bug pinned here: the popover's base rule
 * `#plugin-editor .editor-lint-pop { display: flex; ... }` outranks the
 * bare `.hidden` utility (id+class beats class), so every close path
 * (chip re-click, row click, Escape, click-away) added the class but the
 * popover stayed visible — it could only be dismissed by restarting.
 * The CSS guard asserts the `.hidden` override exists; the DOM tests pin
 * the toggle round-trip and the new explicit ✕ close button.
 *
 * Run: node tests/lint_pop_close.test.mjs
 */
import assert from 'node:assert';
import { readFileSync } from 'node:fs';

// ── Minimal DOM slice, installed before the module imports resolve ────
class FakeElement {
    constructor(id) {
        this.id = id; this.innerHTML = ''; this.textContent = '';
        this.focused = false;
        this._attrs = new Map(); this._listeners = new Map();
        const cls = new Set(['hidden']);
        this.classList = {
            contains: (c) => cls.has(c),
            add: (...cs) => cs.forEach((c) => cls.add(c)),
            remove: (...cs) => cs.forEach((c) => cls.delete(c)),
            toggle: (c, force) => {
                const on = force === undefined ? !cls.has(c) : !!force;
                if (on) cls.add(c); else cls.delete(c);
                return on;
            },
        };
    }
    setAttribute(k, v) { this._attrs.set(k, String(v)); }
    getAttribute(k) { return this._attrs.has(k) ? this._attrs.get(k) : null; }
    addEventListener(type, fn) {
        if (!this._listeners.has(type)) this._listeners.set(type, []);
        this._listeners.get(type).push(fn);
    }
    dispatch(type, ev) { for (const fn of this._listeners.get(type) || []) fn(ev); }
    // The matcher a delegated-click target needs: `_closestMatch` names the
    // one selector this fake "sits inside of".
    closest(sel) { return this._closestMatch === sel ? this : null; }
    querySelector() { return null; }
    contains() { return false; }
    focus() { this.focused = true; }
}
globalThis.Element = globalThis.Element || FakeElement;

const pop = new FakeElement('editor-lint-pop');
const chip = new FakeElement('editor-lint-chip');
const els = { 'editor-lint-pop': pop, 'editor-lint-chip': chip };
globalThis.document = globalThis.document || {
    getElementById: (id) => els[id] || null,
    addEventListener: () => {}, activeElement: null,
};
globalThis.localStorage = globalThis.localStorage || { getItem: () => null, setItem: () => {} };
globalThis.window = globalThis.window || globalThis;

const { editorToggleLintPopover, initPlayabilityLint } =
    await import('../src/playability-lint.js');

let pass = 0, fail = 0;
function t(name, fn) {
    try { fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}

t('CSS: the .hidden override for the popover exists (id+class beats .hidden)', () => {
    const css = readFileSync(new URL('../assets/v3-theme.css', import.meta.url), 'utf8');
    assert.match(css, /#plugin-editor \.editor-lint-pop\.hidden\s*\{\s*display:\s*none/,
        'the base rule sets display:flex at id+class specificity, so without '
        + 'this override adding .hidden never hides the popover');
});

initPlayabilityLint();

t('toggle opens: popover unhides, renders the ✕ close button, chip expands', () => {
    editorToggleLintPopover();
    assert.strictEqual(pop.classList.contains('hidden'), false);
    assert.ok(pop.innerHTML.includes('editor-lint-close'), 'close button rendered');
    assert.ok(pop.innerHTML.includes('aria-label="Close playability notes"'));
    assert.strictEqual(chip.getAttribute('aria-expanded'), 'true');
});

t('the ✕ button closes and returns focus to the chip', () => {
    const closeBtn = new FakeElement('x');
    closeBtn._closestMatch = '.editor-lint-close';
    pop.dispatch('click', { target: closeBtn });
    assert.strictEqual(pop.classList.contains('hidden'), true);
    assert.strictEqual(chip.getAttribute('aria-expanded'), 'false');
    assert.strictEqual(chip.focused, true);
});

t('a stray click inside the popover does not close it; chip re-click does', () => {
    editorToggleLintPopover();
    assert.strictEqual(pop.classList.contains('hidden'), false);
    pop.dispatch('click', { target: new FakeElement('stray') });
    assert.strictEqual(pop.classList.contains('hidden'), false, 'still open');
    editorToggleLintPopover();   // the chip's onclick path
    assert.strictEqual(pop.classList.contains('hidden'), true);
    assert.strictEqual(chip.getAttribute('aria-expanded'), 'false');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
