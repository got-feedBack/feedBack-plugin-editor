/*
 * Regression: dragging a header-column fader must NOT rebuild the panel's
 * innerHTML. The fader's `input` handler writes the live vol through
 * host.partMixChanged → refreshTrackSession; a rebuild there would destroy
 * the <input type=range> under the pointer and abort the native drag.
 *
 * Pre-fix this test fails (an innerHTML rebuild fires on the fader input);
 * post-fix the rebuild is suppressed for the drag's synchronous span.
 *
 * Run: node tests/track_session_fader_drag.test.mjs
 */
import assert from 'node:assert';

// ── A minimal, event-dispatching DOM stand-in ───────────────────────────
let htmlWrites = 0;
function makeEl(id) {
    const handlers = {};
    const el = {
        id, __trackSessionWired: false, style: {},
        setAttribute() {}, getAttribute: () => null,
        querySelector: () => null, querySelectorAll: () => [],
        appendChild() {}, contains: () => false,
        addEventListener(type, fn) { (handlers[type] ||= []).push(fn); },
        removeEventListener() {},
        dispatch(type, event) { for (const fn of (handlers[type] || [])) fn(event); },
    };
    let _html = '';
    Object.defineProperty(el, 'innerHTML', {
        get() { return _html; },
        set(v) { _html = v; htmlWrites++; },
    });
    return el;
}

const panelEl = makeEl('editor-track-session');
globalThis.document = { getElementById: (id) => (id === 'editor-track-session' ? panelEl : null) };
globalThis.window = { addEventListener() {}, removeEventListener() {} };
globalThis.localStorage = { getItem: () => null, setItem() {} };

const { S } = await import('../src/state.js');
const { host } = await import('../src/host.js');
const { initTrackSession, refreshTrackSession } = await import('../src/track-session.js');

// Mirror main.js's wiring: a partMix change refreshes the Tracks column.
host.partMixChanged = () => { refreshTrackSession(); };

S.trackSession = { version: 2, tracks: [], removedSourceIds: [], tempoGuideSourceId: '', tempoGuideLocked: false, tempoGuideMode: 'audio' };
S.partMix = {};

initTrackSession();
refreshTrackSession();               // one legitimate render → baseline
const baseline = htmlWrites;
assert.ok(baseline >= 1, 'panel rendered at least once');

// Simulate a fader drag tick: an `input` event whose target is the range.
panelEl.dispatch('input', {
    target: {
        matches: (sel) => sel === '[data-track-action="mix-vol"]',
        getAttribute: (n) => (n === 'data-mix-key' ? 'arr:0' : null),
        value: '55',
    },
});

assert.strictEqual(S.partMix['arr:0'].vol, 55, 'fader still writes the live vol');
assert.strictEqual(htmlWrites, baseline,
    'fader drag must not rebuild the panel innerHTML (would destroy the dragged slider)');

// ── Regression: audioUrl is a render input (the Master Mix source derives
// from it), so a late audio load that only sets S.audioUrl must invalidate
// the memo — otherwise the Tracks column stays missing the Master Mix.
refreshTrackSession();               // settle the memo after the fader write
const beforeAudio = htmlWrites;
S.audioUrl = 'blob:master-mix';      // the ONLY state that changes
refreshTrackSession();
assert.ok(htmlWrites > beforeAudio,
    'changing S.audioUrl re-renders so the Master Mix row appears');

console.log('\n2 passed, 0 failed');
