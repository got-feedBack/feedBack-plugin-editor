/*
 * Tests for the Mixer panel (workspace-shell B6, src/mixer-panel.js) — the
 * docked panel that consolidated the audio-mixer popover and owns the
 * canonical per-part mix state `S.partMix`.
 *
 * Pinned here: the pure strip-state model (defaults, clamps, the DAW
 * mute-wins/solo-isolates audibility rule), the clap-state the guide
 * scheduler consumes (drums vs current-arrangement key, volume scaling,
 * and — D5 — that it is a PART gate: the host-hook default leaves audio
 * untouched and no bus is ever a part), the panel open-state pref
 * round-trip, the memoized render, and that a double init can never stack
 * delegated listeners (re-inject safety).
 *
 * Run: node tests/mixer_panel.test.mjs
 */
import assert from 'node:assert';

// ── DOM slice ────────────────────────────────────────────────────────
function makeEl(id) {
    const cls = new Set(id === 'editor-mixer-panel' ? ['hidden'] : []);
    return {
        id,
        innerHTML: '',
        textContent: '',
        value: '',
        checked: false,
        listeners: {},
        attrs: {},
        classList: {
            contains: (c) => cls.has(c),
            add: (c) => cls.add(c),
            remove: (c) => cls.delete(c),
            toggle: (c, force) => {
                const want = force === undefined ? !cls.has(c) : !!force;
                if (want) cls.add(c); else cls.delete(c);
                return want;
            },
        },
        addEventListener(ev, fn) { (this.listeners[ev] = this.listeners[ev] || []).push(fn); },
        setAttribute(k, v) { this.attrs[k] = String(v); },
        getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; },
        querySelector: () => null,
    };
}
const els = {};
for (const id of ['editor-mixer-panel', 'editor-mixer-parts', 'editor-mixer-btn', 'editor-tp-mixer',
    'editor-mix-ref', 'editor-mix-ref-val', 'editor-mix-guide', 'editor-mix-guide-val',
    'editor-mix-click', 'editor-mix-click-val', 'editor-mix-blip', 'editor-status']) {
    els[id] = makeEl(id);
}
globalThis.document = globalThis.document || {
    getElementById: (id) => els[id] || null,
    addEventListener: () => {},
    activeElement: null,
};
const store = new Map();
globalThis.localStorage = globalThis.localStorage || {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
};
globalThis.window = globalThis.window || globalThis;

const {
    _mixerPartsPure, _mixerPartStatePure, _mixerAnySoloPure, _mixerPartAudiblePure,
    _mixerClapStatePure, _mixerOpenFromStoredPure, _mixerClapState,
    _mixerPanelRefresh, editorToggleMixerPanel, initMixerPanel,
} = await import('../src/mixer-panel.js');
const { S } = await import('../src/state.js');
const { host } = await import('../src/host.js');

let pass = 0, fail = 0;
function t(name, fn) {
    try { fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}

// ── Pure strip model ─────────────────────────────────────────────────

t('one strip per arrangement, keyed by index, drums appended only with hits', () => {
    const arrs = [{ name: 'Lead' }, { name: '' }, null];
    assert.deepStrictEqual(_mixerPartsPure(arrs, null), [
        { key: 'arr:0', name: 'Lead' },
        { key: 'arr:1', name: 'Track 2' },
        { key: 'arr:2', name: 'Track 3' },
    ]);
    assert.deepStrictEqual(_mixerPartsPure([], { hits: [] }), []);
    assert.deepStrictEqual(_mixerPartsPure([], { hits: [{ t: 1 }] }),
        [{ key: 'drums', name: 'Drums' }]);
    assert.deepStrictEqual(_mixerPartsPure(null, null), []);
});

t('strip state defaults to audible unity; volume clamps into [0, 100]', () => {
    assert.deepStrictEqual(_mixerPartStatePure({}, 'arr:0'), { vol: 100, mute: false, solo: false });
    assert.deepStrictEqual(_mixerPartStatePure(null, 'arr:0'), { vol: 100, mute: false, solo: false });
    assert.strictEqual(_mixerPartStatePure({ 'arr:0': { vol: 250 } }, 'arr:0').vol, 100);
    assert.strictEqual(_mixerPartStatePure({ 'arr:0': { vol: -5 } }, 'arr:0').vol, 0);
    assert.strictEqual(_mixerPartStatePure({ 'arr:0': { vol: 'junk' } }, 'arr:0').vol, 100);
    assert.strictEqual(_mixerPartStatePure({ 'arr:0': { mute: 1, solo: 0 } }, 'arr:0').mute, true);
});

t('audibility: no solo → everything unmuted sounds; mute always wins', () => {
    assert.strictEqual(_mixerPartAudiblePure({}, 'arr:0'), true);
    assert.strictEqual(_mixerPartAudiblePure({ 'arr:0': { mute: true } }, 'arr:0'), false);
    // Mute beats solo on the same strip — the DAW rule.
    assert.strictEqual(_mixerPartAudiblePure({ 'arr:0': { mute: true, solo: true } }, 'arr:0'), false);
});

t('audibility: any solo isolates the soloed strips', () => {
    const mix = { 'arr:0': { solo: true }, 'arr:1': {}, drums: {} };
    assert.strictEqual(_mixerAnySoloPure(mix), true);
    assert.strictEqual(_mixerPartAudiblePure(mix, 'arr:0'), true);
    assert.strictEqual(_mixerPartAudiblePure(mix, 'arr:1'), false);
    assert.strictEqual(_mixerPartAudiblePure(mix, 'drums'), false);
});

// ── The clap state the guide scheduler consumes ──────────────────────

t('clap state follows the active surface: drums in drum mode, else the current arrangement', () => {
    const mix = { 'arr:1': { mute: true }, drums: { vol: 50 } };
    assert.deepStrictEqual(_mixerClapStatePure(mix, false, 1), { audible: false, vol: 100 / 100 });
    assert.deepStrictEqual(_mixerClapStatePure(mix, true, 1), { audible: true, vol: 0.5 });
    assert.deepStrictEqual(_mixerClapStatePure(mix, false, 0), { audible: true, vol: 1 });
});

t('solo keeps the reference audible (D5): the gate is per-PART, and the host default leaves audio untouched', () => {
    // Soloing a part silences other PARTS' claps…
    const mix = { 'arr:0': { solo: true } };
    assert.strictEqual(_mixerClapStatePure(mix, false, 1).audible, false);
    // …but the hook audio.js consults defaults to audible-at-unity, so with
    // no panel wired (or nothing muted/soloed) nothing is gated — and the
    // reference bus never passes through this gate at all: buses are not
    // part keys, and audio.js only consults the hook on the CLAP path.
    assert.deepStrictEqual(host.partClapState(), { audible: true, vol: 1 });
    assert.strictEqual(_mixerClapStatePure(mix, false, 0).audible, true);
});

t('_mixerClapState reads live S (the wiring main.js hands to host.partClapState)', () => {
    Object.assign(S, { partMix: { 'arr:0': { mute: true, vol: 40 } }, drumEditMode: false, currentArr: 0 });
    assert.deepStrictEqual(_mixerClapState(), { audible: false, vol: 0.4 });
    S.partMix = {};
});

// ── Panel open state: pref round-trip + toggle ───────────────────────

t('open-state pref round-trip', () => {
    assert.strictEqual(_mixerOpenFromStoredPure('1'), true);
    assert.strictEqual(_mixerOpenFromStoredPure('0'), false);
    assert.strictEqual(_mixerOpenFromStoredPure(null), false);
    assert.strictEqual(_mixerOpenFromStoredPure('yes'), false);
});

t('toggle opens/closes the panel, persists the pref, and lights both Mix buttons', () => {
    Object.assign(S, { arrangements: [{ name: 'Lead', notes: [] }], drumTab: null, partMix: {}, currentArr: 0 });
    assert.strictEqual(editorToggleMixerPanel(true), true);
    assert.strictEqual(els['editor-mixer-panel'].classList.contains('hidden'), false);
    assert.strictEqual(store.get('editorMixerPanel'), '1');
    assert.strictEqual(els['editor-mixer-btn'].getAttribute('aria-pressed'), 'true');
    assert.strictEqual(els['editor-tp-mixer'].getAttribute('aria-pressed'), 'true');
    editorToggleMixerPanel(false);
    assert.strictEqual(els['editor-mixer-panel'].classList.contains('hidden'), true);
    assert.strictEqual(store.get('editorMixerPanel'), '0');
    assert.strictEqual(els['editor-mixer-btn'].getAttribute('aria-pressed'), 'false');
});

t('init restores the persisted open state', () => {
    store.set('editorMixerPanel', '1');
    els['editor-mixer-panel'].classList.add('hidden');
    initMixerPanel();
    assert.strictEqual(els['editor-mixer-panel'].classList.contains('hidden'), false);
    editorToggleMixerPanel(false);
});

t('bus faders + blip seed from host.mixUiState on open', () => {
    const prev = host.mixUiState;
    host.mixUiState = () => ({ pcts: { ref: 80, guide: 15, click: 5 }, blip: false });
    editorToggleMixerPanel(true);
    assert.strictEqual(els['editor-mix-ref'].value, '80');
    assert.strictEqual(els['editor-mix-guide-val'].textContent, '15%');
    assert.strictEqual(els['editor-mix-click'].value, '5');
    assert.strictEqual(els['editor-mix-blip'].checked, false);
    host.mixUiState = prev;
    editorToggleMixerPanel(false);
});

// ── Render + memo ────────────────────────────────────────────────────

t('strips render one row per part; the refresh is memoized until state changes', () => {
    Object.assign(S, {
        arrangements: [{ name: 'Lead <Guitar>' }, { name: 'Bass' }],
        drumTab: { hits: [{ t: 0.5 }] }, partMix: {}, currentArr: 0,
    });
    editorToggleMixerPanel(true);
    const html = els['editor-mixer-parts'].innerHTML;
    assert.ok(html.includes('Lead &lt;Guitar&gt;'), 'part name rendered (escaped)');
    assert.ok(html.includes('data-mix-part="arr:1"'), 'second strip');
    assert.ok(html.includes('data-mix-part="drums"'), 'drums strip');
    assert.ok(html.includes('data-mix-act="solo"'), 'solo button');
    // Memo: same state → no re-render (a sentinel survives the call).
    els['editor-mixer-parts'].innerHTML = 'SENTINEL';
    _mixerPanelRefresh();
    assert.strictEqual(els['editor-mixer-parts'].innerHTML, 'SENTINEL');
    // A partMix change invalidates the memo.
    S.partMix = { 'arr:0': { mute: true } };
    _mixerPanelRefresh();
    assert.ok(els['editor-mixer-parts'].innerHTML.includes('aria-pressed="true"'), 're-rendered with the mute lit');
    editorToggleMixerPanel(false);
    S.partMix = {};
});

// ── Delegated listeners: click/input drive S.partMix, never stack ────

function fakeBtn(key, act) {
    return {
        getAttribute: (k) => (k === 'data-mix-part' ? key : act),
        closest: function () { return this; },
    };
}

t('a Mute click flips S.partMix and the clap gate follows', () => {
    Object.assign(S, { arrangements: [{ name: 'Lead' }], drumTab: null, partMix: {}, currentArr: 0, drumEditMode: false });
    editorToggleMixerPanel(true);
    const onClick = els['editor-mixer-panel'].listeners.click[0];
    onClick({ target: fakeBtn('arr:0', 'mute') });
    assert.strictEqual(S.partMix['arr:0'].mute, true);
    assert.strictEqual(_mixerClapState().audible, false);
    onClick({ target: fakeBtn('arr:0', 'mute') });
    assert.strictEqual(S.partMix['arr:0'].mute, false);
    assert.strictEqual(_mixerClapState().audible, true);
    editorToggleMixerPanel(false);
});

t('a volume input scales the clap state', () => {
    editorToggleMixerPanel(true);
    const onInput = els['editor-mixer-panel'].listeners.input[0];
    onInput({ target: { getAttribute: (k) => (k === 'data-mix-act' ? 'vol' : 'arr:0'), value: '30' } });
    assert.strictEqual(S.partMix['arr:0'].vol, 30);
    assert.strictEqual(_mixerClapState().vol, 0.3);
    editorToggleMixerPanel(false);
    S.partMix = {};
});

t('double init / repeated toggles never stack the delegated listeners', () => {
    initMixerPanel();
    initMixerPanel();
    editorToggleMixerPanel(true);
    editorToggleMixerPanel(false);
    editorToggleMixerPanel(true);
    assert.strictEqual(els['editor-mixer-panel'].listeners.click.length, 1);
    assert.strictEqual(els['editor-mixer-panel'].listeners.input.length, 1);
    editorToggleMixerPanel(false);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
