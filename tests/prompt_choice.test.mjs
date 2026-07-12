/*
 * _editorPromptChoice (src/ui.js) — the choice dialog behind the flatten prompt.
 * A titled card with one button per choice + Cancel; resolves to the chosen key,
 * or null on Cancel. Exercised over a tiny DOM stub (no jsdom).
 *
 * Run: node tests/prompt_choice.test.mjs
 */
import assert from 'node:assert';

// ── Minimal DOM stub ────────────────────────────────────────────────
function mkEl(tag) {
    const el = {
        tagName: String(tag || '').toUpperCase(),
        className: '', id: '', textContent: '', type: '', tabIndex: 0,
        htmlFor: '', placeholder: '', value: '',
        children: [], parentNode: null, onclick: null, _attrs: {},
        style: {},
        setAttribute(k, v) { this._attrs[k] = v; },
        getAttribute(k) { return this._attrs[k]; },
        appendChild(c) { this.children.push(c); c.parentNode = this; return c; },
        addEventListener() {}, removeEventListener() {}, focus() {},
        remove() {
            if (this.parentNode) {
                const i = this.parentNode.children.indexOf(this);
                if (i >= 0) this.parentNode.children.splice(i, 1);
            }
        },
        contains(n) { return n === this || this.children.some((c) => c.contains && c.contains(n)); },
        _all() { let out = []; for (const c of this.children) { out.push(c); if (c._all) out = out.concat(c._all()); } return out; },
        querySelector(sel) { return this.querySelectorAll(sel)[0] || null; },
        querySelectorAll(sel) {
            const all = this._all();
            return /button/.test(sel) ? all.filter((e) => e.tagName === 'BUTTON') : all;
        },
    };
    return el;
}
const body = mkEl('body');
globalThis.document = {
    createElement: (t) => mkEl(t),
    getElementById: () => null,
    body,
    activeElement: null,
};

const { _editorPromptChoice } = await import('../src/ui.js');

let pass = 0, fail = 0;
function t(name, fn) {
    return Promise.resolve()
        .then(fn)
        .then(() => { pass++; console.log('  ok   ' + name); })
        .catch((e) => { fail++; console.error('  FAIL ' + name + ': ' + e.message); });
}

// The modal is the last node appended to <body>; its buttons in DOM order are
// [choice1, choice2, …, Cancel].
const openModalButtons = () => body.children[body.children.length - 1].querySelectorAll('button');

const CHOICES = { title: 'Set the whole song to 120 BPM', message: 'Choose how to flatten:', choices: [
    { key: 'conform', label: 'Conform notes to the new tempo', hint: 'move with the grid' },
    { key: 'grid', label: 'Rebuild the grid only', hint: 'keep exact seconds' },
] };

await t('resolves the chosen key when a choice button is clicked', async () => {
    const promise = _editorPromptChoice(CHOICES);
    const btns = openModalButtons();
    assert.strictEqual(btns.length, 3, 'two choices + Cancel');
    btns[0].onclick();                       // click "Conform"
    assert.strictEqual(await promise, 'conform');
    assert.strictEqual(body.children.length, 0, 'modal removed after choosing');
});

await t('the second choice resolves its own key', async () => {
    const promise = _editorPromptChoice(CHOICES);
    openModalButtons()[1].onclick();         // click "Rebuild the grid only"
    assert.strictEqual(await promise, 'grid');
});

await t('Cancel resolves null (no accidental edit)', async () => {
    const promise = _editorPromptChoice(CHOICES);
    const btns = openModalButtons();
    btns[btns.length - 1].onclick();         // Cancel
    assert.strictEqual(await promise, null);
});

await t('opening a second dialog settles the first as a cancel (no hung await)', async () => {
    const first = _editorPromptChoice(CHOICES);
    const second = _editorPromptChoice(CHOICES);   // should cancel `first`
    assert.strictEqual(await first, null);
    openModalButtons()[0].onclick();
    assert.strictEqual(await second, 'conform');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
