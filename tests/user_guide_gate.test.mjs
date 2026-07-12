/*
 * Wiring test for the User Guide modal's keyboard gate (src/input.js
 * onKeyDown).
 *
 * The User Guide (Help ▸ User Guide) is a read-only modal lens, the same
 * class as the Tab preview: while it's open NO editor shortcut may reach the
 * chart hidden behind it, or a stray H / fret digit / Space would silently
 * mutate the arrangement (polluting undo/redo) or start playback under the
 * overlay. This drives the REAL onKeyDown with a stub DOM where the guide
 * modal is open/closed and asserts, at the behavior level:
 *
 *   - guide closed: keys reach the chart (non-vacuous harness proof),
 *   - guide open:   edit keys and Space are swallowed (no history exec,
 *                   no transport), and
 *   - guide open:   Escape closes the guide (and only that).
 *
 * The swallow assertions FAIL on the pre-gate code, where onKeyDown never
 * consults the guide modal.
 *
 * Run: node tests/user_guide_gate.test.mjs
 */
import assert from 'node:assert';

// ── DOM/global stubs (BEFORE any src import) ────────────────────────────────
// Only three elements matter to the gate: the screen (active), the Tab
// preview modal (closed throughout — its own gate has its own tests), and
// the guide modal, whose hidden-ness the tests flip.
let guideHidden = true;
const _screenEl = { classList: { contains: (c) => c === 'active' } };
const _guideEl = { classList: { contains: (c) => (c === 'hidden' ? guideHidden : false) } };
const _tabEl = { classList: { contains: (c) => c === 'hidden' } };
globalThis.document = globalThis.document || {
    getElementById: (id) => {
        if (id === 'plugin-editor') return _screenEl;
        if (id === 'editor-user-guide-modal') return _guideEl;
        if (id === 'editor-tab-preview-modal') return _tabEl;
        return null;
    },
    addEventListener: () => {},
    activeElement: null,
};
globalThis.localStorage = globalThis.localStorage || { getItem: () => null, setItem: () => {} };
globalThis.window = globalThis.window || globalThis;
globalThis.requestAnimationFrame = globalThis.requestAnimationFrame || (() => 0);
globalThis.cancelAnimationFrame = globalThis.cancelAnimationFrame || (() => {});

const { onKeyDown } = await import('../src/input.js');
const { S } = await import('../src/state.js');
const { setHostHooks } = await import('../src/host.js');

setHostHooks({ draw: () => {}, updateStatus: () => {}, ensureArr: () => true });

// Recorders for the window entry points onKeyDown dispatches to (main.js
// defines the real ones; here they only need to count).
const calls = { togglePlay: 0, toggleGuide: [], execs: 0 };
window.editorTogglePlay = () => { calls.togglePlay++; };
window.editorToggleUserGuide = (force) => { calls.toggleGuide.push(force); };

// One selected note so an edit key has something real to mutate; the history
// stub records exec() instead of running it — the count IS the observable.
Object.assign(S, {
    arrangements: [{ name: 'Lead', notes: [{ time: 1, string: 2, fret: 3, sustain: 0, techniques: {} }], chords: [] }],
    currentArr: 0,
    sel: new Set([0]),
    history: { exec: () => { calls.execs++; } },
    tempoMapMode: false,
    partsViewMode: false,
    drumEditMode: false,
});

const ev = (key, extra = {}) => ({
    key,
    code: '',
    ctrlKey: false, metaKey: false, shiftKey: false, altKey: false,
    target: { matches: () => false },
    _pd: false,
    preventDefault() { this._pd = true; },
    stopPropagation() {},
    ...extra,
});

let pass = 0, fail = 0;
function t(name, fn) {
    try { fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}

t('harness bites: with the guide CLOSED an edit key reaches the chart', () => {
    guideHidden = true;
    calls.execs = 0;
    onKeyDown(ev('h')); // toggle hammer-on on the selected note
    assert.strictEqual(calls.execs, 1, 'H must exec a history command when no modal is open');
});

t('harness bites: with the guide CLOSED Space reaches the transport', () => {
    guideHidden = true;
    calls.togglePlay = 0;
    onKeyDown(ev(' '));
    assert.strictEqual(calls.togglePlay, 1);
});

t('guide OPEN: edit keys are swallowed — nothing execs behind the modal', () => {
    guideHidden = false;
    calls.execs = 0;
    for (const key of ['h', '2', 'a', 'x', 'Delete']) {
        const e = ev(key);
        onKeyDown(e);
        assert.ok(e._pd, `${JSON.stringify(key)} must be preventDefault-ed (swallowed)`);
    }
    assert.strictEqual(calls.execs, 0, 'no history command may exec while the guide is open');
});

t('guide OPEN: Space does not start playback', () => {
    guideHidden = false;
    calls.togglePlay = 0;
    const e = ev(' ');
    onKeyDown(e);
    assert.strictEqual(calls.togglePlay, 0, 'transport must not fire under the guide overlay');
    assert.ok(e._pd, 'Space is swallowed');
});

t('guide OPEN: Escape closes the guide', () => {
    guideHidden = false;
    calls.toggleGuide.length = 0;
    const e = ev('Escape');
    onKeyDown(e);
    assert.deepStrictEqual(calls.toggleGuide, [false], 'Escape dispatches editorToggleUserGuide(false)');
    assert.ok(e._pd);
});

// ── The anchor-resolve sweep handler must respect the lens too ──────────────
// The sweep's keydown listener runs CAPTURE-phase (before onKeyDown's gates),
// so it has to bail on its own while a lens modal is open — otherwise
// Enter / A / Escape would accept or end a sweep hidden behind the guide.
const AR = await import('../src/anchor-resolve.js');
const { _markSuggested } = await import('../src/notes.js');

let sweepKeys = null;
setHostHooks({ addGlobalListener: (_t, _evName, fn) => { sweepKeys = fn; } });
AR.initAnchorResolve();

t('sweep harness bites: a sweep starts over a suggested note', () => {
    guideHidden = true;
    const note = { time: 1, string: 0, fret: 8, sustain: 0, techniques: {} };
    _markSuggested(note);
    Object.assign(S, {
        arrangements: [{
            name: 'Lead', notes: [note], chords: [],
            anchors: [{ time: 0, fret: 2, width: 4 }],
            tuning: [0, 0, 0, 0, 0, 0], capo: 0,
        }],
        currentArr: 0,
        sel: new Set(),
    });
    AR.editorResolveAnchorWindow(S.arrangements[0].anchors[0]);
    assert.ok(typeof sweepKeys === 'function', 'sweep keydown handler captured');
    assert.ok(AR._sweepActive(), 'sweep is active');
});

t('guide OPEN: sweep keys bail — no accept-all, no sweep end behind the modal', () => {
    guideHidden = false;
    calls.execs = 0;
    sweepKeys(ev('a'));
    assert.strictEqual(calls.execs, 0, 'A must not accept-all behind the guide');
    assert.ok(AR._sweepActive(), 'A must not end the sweep behind the guide');
    sweepKeys(ev('Escape'));
    assert.ok(AR._sweepActive(), 'Escape belongs to the guide, not the sweep');
});

t('guide CLOSED: sweep keys work again (Escape ends the sweep)', () => {
    guideHidden = true;
    sweepKeys(ev('Escape'));
    assert.ok(!AR._sweepActive(), 'Escape ends the sweep when no lens modal is open');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
