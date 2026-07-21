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
    'editor-mix-click', 'editor-mix-click-val', 'editor-mix-master', 'editor-mix-master-val',
    'editor-mixer-close', 'editor-mixer-play-all', 'editor-status']) {
    els[id] = makeEl(id);
}
globalThis.document = globalThis.document || {
    getElementById: (id) => els[id] || null,
    addEventListener: () => {},
    activeElement: null,
};
globalThis.window = globalThis.window || globalThis;
if (typeof globalThis.requestAnimationFrame !== 'function') globalThis.requestAnimationFrame = () => 0;
if (typeof globalThis.cancelAnimationFrame !== 'function') globalThis.cancelAnimationFrame = () => {};
const store = new Map();
globalThis.localStorage = globalThis.localStorage || {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
};
globalThis.window = globalThis.window || globalThis;

const {
    _mixerPartsPure, _mixerPartStatePure, _mixerAnySoloPure, _mixerPartAudiblePure,
    _mixerClapStatePure, _mixerActivePartKeyPure, _mixerOpenFromStoredPure, _mixerClapState,
    _mixerGainForFaderPure, _mixerFaderLabelPure, _mixerOrderedPartsPure,
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

t('one strip per arrangement, keyed by index; the drums arrangement is an ordinary strip', () => {
    const arrs = [{ name: 'Lead' }, { name: '' }, null];
    assert.deepStrictEqual(_mixerPartsPure(arrs, null), [
        { key: 'arr:0', name: 'Lead' },
        { key: 'arr:1', name: 'Track 2' },
        { key: 'arr:2', name: 'Track 3' },
    ]);
    // A bare drum tab no longer conjures a 'drums' strip — drums are a
    // type:"drums" arrangement now (PR2b), so they ride the arrangement pass and
    // get an `arr:<idx>` strip named for themselves.
    assert.deepStrictEqual(_mixerPartsPure([], { hits: [{ t: 1 }] }), []);
    assert.deepStrictEqual(_mixerPartsPure(
        [{ name: 'Lead' }, { name: 'Kit', type: 'drums' }], { hits: [{ t: 1 }] }),
        [{ key: 'arr:0', name: 'Lead' }, { key: 'arr:1', name: 'Kit' }]);
    assert.deepStrictEqual(_mixerPartsPure(null, null), []);
});

// #336 regression: the drums arrangement (materialized into S.arrangements[])
// must NOT get an 'arr:<idx>' strip — it already gets the dedicated 'drums'
// strip from drumTab. Pre-fix it got both → two Drums strips after reload.
t('the drums arrangement is not double-listed — exactly one Drums strip', () => {
    const arrs = [{ name: 'Lead' }, { name: 'Bass' }, { name: 'Drums', type: 'drums' }];
    const drumTab = { hits: [{ t: 0, p: 'kick' }] };
    const parts = _mixerPartsPure(arrs, drumTab);
    assert.deepStrictEqual(parts, [
        { key: 'arr:0', name: 'Lead' },
        { key: 'arr:1', name: 'Bass' },
        { key: 'drums', name: 'Drums' },
    ], 'the type:"drums" arrangement gets no arr:2 strip; only the drums strip');
    assert.strictEqual(parts.filter(p => p.name === 'Drums').length, 1, 'exactly one Drums strip');
    assert.ok(!parts.some(p => p.key === 'arr:2'), 'no arr:<idx> strip for the drums arrangement');
});

t('strip state defaults to audible unity; volume clamps into [0, 110] (+10 dB ceiling)', () => {
    assert.deepStrictEqual(_mixerPartStatePure({}, 'arr:0'), { vol: 100, mute: false, solo: false });
    assert.deepStrictEqual(_mixerPartStatePure(null, 'arr:0'), { vol: 100, mute: false, solo: false });
    assert.strictEqual(_mixerPartStatePure({ 'arr:0': { vol: 250 } }, 'arr:0').vol, 110, 'clamps to the +10 dB ceiling');
    assert.strictEqual(_mixerPartStatePure({ 'arr:0': { vol: -5 } }, 'arr:0').vol, 0);
    assert.strictEqual(_mixerPartStatePure({ 'arr:0': { vol: 'junk' } }, 'arr:0').vol, 100);
    assert.strictEqual(_mixerPartStatePure({ 'arr:0': { mute: 1, solo: 0 } }, 'arr:0').mute, true);
});

t('fader: unity detent at 0 dB, +10 dB of headroom at the ceiling', () => {
    assert.strictEqual(_mixerGainForFaderPure(0), 0);
    assert.strictEqual(_mixerGainForFaderPure(50), 0.5);
    assert.strictEqual(_mixerGainForFaderPure(100), 1, 'unity detent = 0 dB gain 1.0');
    // Ceiling is +10 dB ≈ 3.162 (10^(10/20)) — FAILS the old +6/1.995 mapping.
    assert.ok(Math.abs(_mixerGainForFaderPure(110) - 3.1622776601683795) < 1e-9, '+10 dB (≈3.162) at max');
    assert.ok(Math.abs(_mixerGainForFaderPure(110) - 10 ** (10 / 20)) < 1e-9);
    assert.strictEqual(_mixerGainForFaderPure(999), _mixerGainForFaderPure(110), 'clamps at the +10 ceiling');
    assert.strictEqual(_mixerFaderLabelPure(100), '+0.0 dB');
    assert.strictEqual(_mixerFaderLabelPure(110), '+10.0 dB');
    assert.strictEqual(_mixerFaderLabelPure(0), '−∞ dB');
});

t('strips reorder to match the Tracks-column row order (drag reorder follows)', () => {
    const parts = [
        { key: 'audio:Guitar_L', name: 'Gtr' },
        { key: 'arr:0', name: 'Lead' },
        { key: 'arr:1', name: 'Bass' },
        { key: 'drums', name: 'Drums' },
    ];
    // Tracks column dragged into: Bass, Drums, Gtr, Lead.
    const ordered = _mixerOrderedPartsPure(parts, ['arr:1', 'drums', 'audio:Guitar_L', 'arr:0']);
    assert.deepStrictEqual(ordered.map(p => p.key), ['arr:1', 'drums', 'audio:Guitar_L', 'arr:0']);
    // Keys absent from the order list keep their original relative order at the tail.
    const partial = _mixerOrderedPartsPure(parts, ['arr:1']);
    assert.deepStrictEqual(partial.map(p => p.key), ['arr:1', 'audio:Guitar_L', 'arr:0', 'drums']);
    assert.deepStrictEqual(_mixerOrderedPartsPure(parts, []).map(p => p.key),
        parts.map(p => p.key), 'no order → unchanged');
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

t('master is the OUTPUT bus: others solo/mute never silence it, its own mute does', () => {
    // A stem soloed AND a different track muted — master must stay audible: it's
    // the final destination downstream of the sum, not a peer channel.
    const mix = { 'audio:gtr': { solo: true }, 'arr:0': { mute: true } };
    assert.strictEqual(_mixerPartAudiblePure(mix, 'audio:master'), true);
    // The non-soloed non-master track is still isolated out (rule unchanged).
    assert.strictEqual(_mixerPartAudiblePure(mix, 'audio:bass'), false);
    // Over-correction guard: master's OWN mute (the output fader) still mutes it.
    assert.strictEqual(_mixerPartAudiblePure({ 'audio:master': { mute: true } }, 'audio:master'), false);
});

// ── The clap state the guide scheduler consumes ──────────────────────

t('clap state follows the active surface: the drums arrangement in drum mode, else the current arrangement', () => {
    // Lead is arr:1; the drums arrangement is arr:2 (drumIdx = 2). currentArr
    // stays on the pitched part even in drum mode (#337) — the clap key is what
    // switches to the drums channel.
    const mix = { 'arr:1': { mute: true }, 'arr:2': { vol: 50 } };
    assert.deepStrictEqual(_mixerClapStatePure(mix, false, 1, 2), { audible: false, vol: 100 / 100 },
        'not drum mode → the current (muted) arrangement');
    assert.deepStrictEqual(_mixerClapStatePure(mix, true, 1, 2), { audible: true, vol: 0.5 },
        'drum mode → the drums arrangement channel (arr:2)');
    assert.deepStrictEqual(_mixerClapStatePure(mix, false, 0, 2), { audible: true, vol: 1 });
    // No drums arrangement materialized (drumIdx = -1) → fall back to currentArr.
    assert.deepStrictEqual(_mixerClapStatePure(mix, true, 1, -1), { audible: false, vol: 1 },
        'drum mode with no drums arrangement → currentArr');
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
    Object.assign(S, { arrangements: [{ name: 'Lead' }], partMix: { 'arr:0': { mute: true, vol: 40 } }, drumEditMode: false, currentArr: 0 });
    assert.deepStrictEqual(_mixerClapState(), { audible: false, vol: 0.4 });
    S.partMix = {};
});

t('_mixerActivePartKeyPure: drum mode addresses the drums arrangement index; currentArr stays pitched (#337)', () => {
    // In drum mode the active clap channel is the drums arrangement (arr:2),
    // NOT currentArr — which is deliberately left on a pitched part.
    assert.strictEqual(_mixerActivePartKeyPure(true, 0, 2), 'arr:2');
    assert.strictEqual(_mixerActivePartKeyPure(true, 1, 2), 'arr:2', 'ignores currentArr in drum mode');
    // Out of drum mode → the current pitched arrangement.
    assert.strictEqual(_mixerActivePartKeyPure(false, 1, 2), 'arr:1');
    // No drums arrangement materialized (drumIdx < 0) → fall back to currentArr,
    // even with the flag set, so the key is always a real strip.
    assert.strictEqual(_mixerActivePartKeyPure(true, 3, -1), 'arr:3');
    assert.strictEqual(_mixerActivePartKeyPure(false, 'junk', 2), 'arr:0', 'a bad currentArr degrades to arr:0');
});

t('the drums mixer strip gates the drum guide clap in drum-edit mode (arr:<drumIdx>, live S)', () => {
    // The runtime integration: with the drums arrangement materialized at arr:1,
    // muting its mixer strip must silence the drum-grid guide claps — even though
    // currentArr is a pitched part. This is the whole point of PR2b's rekey.
    Object.assign(S, {
        arrangements: [{ name: 'Lead' }, { name: 'Drums', type: 'drums' }],
        drumEditMode: true, currentArr: 0,
        partMix: { 'arr:1': { mute: true, vol: 50 } },
    });
    assert.strictEqual(_mixerClapState().audible, false, 'the muted drums strip gates the drum guide clap');
    assert.strictEqual(_mixerClapState().vol, 0.5, 'and its fader scales the clap level');
    S.partMix = {};
    assert.strictEqual(_mixerClapState().audible, true, 'unmuted → the drum guide clap sounds again');
    Object.assign(S, { drumEditMode: false });
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
    // Close is animated (drawer fall); pass instant=true for a deterministic
    // synchronous hide in the unit env.
    editorToggleMixerPanel(false, true);
    assert.strictEqual(els['editor-mixer-panel'].classList.contains('hidden'), true);
    assert.strictEqual(store.get('editorMixerPanel'), '0');
    assert.strictEqual(els['editor-mixer-btn'].getAttribute('aria-pressed'), 'false');
});

t('init always opens the drawer CLOSED (a per-screen view toggle, not a saved pref)', () => {
    store.set('editorMixerPanel', '1');           // even with a stale "open" pref…
    els['editor-mixer-panel'].classList.remove('hidden');
    initMixerPanel();
    assert.strictEqual(els['editor-mixer-panel'].classList.contains('hidden'), true,
        'a project opens with maximum track-area space');
});

t('bus faders seed from host.mixUiState on open (incl. master, dB labels)', () => {
    const prev = host.mixUiState;
    try {
        host.mixUiState = () => ({ pcts: { ref: 80, guide: 15, click: 5, master: 100 }, blip: false });
        editorToggleMixerPanel(true);
        assert.strictEqual(els['editor-mix-ref'].value, '80');
        assert.strictEqual(els['editor-mix-guide-val'].textContent, _mixerFaderLabelPure(15), 'dB label, not %');
        assert.strictEqual(els['editor-mix-click'].value, '5');
        assert.strictEqual(els['editor-mix-master'].value, '100');
    } finally {
        host.mixUiState = prev;
        editorToggleMixerPanel(false, true);
    }
});

// ── Render + memo ────────────────────────────────────────────────────

t('strips render one row per part; the refresh is memoized until state changes', () => {
    Object.assign(S, {
        arrangements: [{ name: 'Lead <Guitar>' }, { name: 'Bass' }, { name: 'Drums', type: 'drums' }],
        drumTab: { hits: [{ t: 0.5 }] }, partMix: {}, currentArr: 0,
    });
    editorToggleMixerPanel(true);
    const html = els['editor-mixer-parts'].innerHTML;
    assert.ok(html.includes('Lead &lt;Guitar&gt;'), 'part name rendered (escaped)');
    assert.ok(html.includes('data-mix-part="arr:1"'), 'second strip');
    assert.ok(html.includes('data-mix-part="arr:2"'), 'the drums arrangement renders as an arr:<idx> strip');
    assert.ok(html.includes('data-mix-act="solo"'), 'solo button');
    assert.ok(html.includes('aria-valuetext="+0.0 dB"'), 'fader exposes its dB value to screen readers');
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
