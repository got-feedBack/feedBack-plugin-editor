/*
 * Tests for the GM guide voices (src/gm-guide.js, DAW workspace 1.2/1.5)
 * and their Transport-menu rows (src/menu-bar.js).
 *
 * The contract pinned here: WebAudioFont naming follows the ecosystem
 * grammar (program 27 → 0270_FluidR3_GM_sf2_file.js / _tone_… global); the
 * source chain is plugin → org → cdn with 'auto' default and garbage-safe
 * degradation; org URLs require an http(s) base; kind inference mirrors the
 * repo rule (KEYS_PATTERN start-anchored > /bass/i > guitar); per-kind
 * voice prefs validate to 0–127 with kind defaults; the pitched window
 * query groups 1 ms chord buckets with a distinct-pitch cap and per-voice
 * sustain; and the menu model renders the radio rows only when a kind is
 * in scope.
 *
 * Run: node tests/gm_guide.test.mjs
 */
import assert from 'node:assert';

// Minimal DOM/storage slice, installed before the module imports resolve.
const _store = new Map();
globalThis.localStorage = globalThis.localStorage || {
    getItem: (k) => (_store.has(k) ? _store.get(k) : null),
    setItem: (k, v) => { _store.set(k, String(v)); },
    removeItem: (k) => { _store.delete(k); },
};
globalThis.document = globalThis.document || {
    getElementById: () => null, addEventListener: () => {}, activeElement: null,
    querySelectorAll: () => [], querySelector: () => null,
    createElement: () => ({ style: {}, dataset: {}, classList: { add() {}, remove() {} } }),
    head: { appendChild: () => {} },
};
globalThis.window = globalThis.window || globalThis;

const {
    GM_CDN_BASE, GM_CDN_PLAYER, GM_KIND_DEFAULTS, GM_PLAYER_FILE, GM_PLUGIN_BASE,
    GM_VOICE_CHOICES,
    _gmEventsInWindowPure, _gmFilePure, _gmGuideModePure, _gmKindPure,
    _gmSanitizeEventsPure, _gmSourceOrderPure, _gmUrlForSourcePure, _gmVarPure,
    _gmVoiceDurationPure, _gmVoiceForKindPure,
    editorGmVoiceFor, editorSetGmVoice, gmPresetReady, gmVoiceAt,
    _resetGmGuideForTest,
} = await import('../src/gm-guide.js');
const { EDITOR_MENUS, _menuModelPure } = await import('../src/menu-bar.js');
const { _editorShortcutRowsPure } = await import('../src/shortcuts.js');
const { arrKind } = await import('../src/instrument.js');

let pass = 0, fail = 0;
function t(name, fn) {
    try { fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}

// ── Naming grammar ────────────────────────────────────────────────────

t('file/global naming follows the ecosystem grammar (program*10, 4 digits)', () => {
    assert.strictEqual(_gmFilePure(27), '0270_FluidR3_GM_sf2_file.js');
    assert.strictEqual(_gmFilePure(0), '0000_FluidR3_GM_sf2_file.js');
    assert.strictEqual(_gmFilePure(127), '1270_FluidR3_GM_sf2_file.js');
    assert.strictEqual(_gmVarPure(27), '_tone_0270_FluidR3_GM_sf2_file');
});

t('naming rejects out-of-range / non-integer programs', () => {
    for (const bad of [-1, 128, 3.5, NaN, Infinity, '27a', null, undefined, {}]) {
        assert.strictEqual(_gmFilePure(bad), null, String(bad));
        assert.strictEqual(_gmVarPure(bad), null, String(bad));
    }
});

// ── Source chain ──────────────────────────────────────────────────────

t("source order: 'auto' (and garbage) walk plugin → org → cdn; a pinned source stands alone", () => {
    assert.deepStrictEqual(_gmSourceOrderPure('auto'), ['plugin', 'org', 'cdn']);
    for (const junk of [null, undefined, '', 'CDN', 'local', 42]) {
        assert.deepStrictEqual(_gmSourceOrderPure(junk), ['plugin', 'org', 'cdn'], String(junk));
    }
    assert.deepStrictEqual(_gmSourceOrderPure('plugin'), ['plugin']);
    assert.deepStrictEqual(_gmSourceOrderPure('org'), ['org']);
    assert.deepStrictEqual(_gmSourceOrderPure('cdn'), ['cdn']);
});

t('URL builder: plugin route, org base normalization, CDN split (player vs data)', () => {
    const file = '0270_FluidR3_GM_sf2_file.js';
    assert.strictEqual(_gmUrlForSourcePure('plugin', file), GM_PLUGIN_BASE + file);
    assert.strictEqual(_gmUrlForSourcePure('cdn', file), GM_CDN_BASE + file);
    assert.strictEqual(_gmUrlForSourcePure('cdn', GM_PLAYER_FILE), GM_CDN_PLAYER,
        'the player lives in a different upstream repo than the data files');
    assert.strictEqual(
        _gmUrlForSourcePure('org', file, 'https://example.org/wafonts/'),
        'https://example.org/wafonts/' + file);
    assert.strictEqual(
        _gmUrlForSourcePure('org', file, '  https://example.org/wafonts  '),
        'https://example.org/wafonts/' + file, 'trims + adds the slash');
});

t('URL builder: org without an http(s) base yields null (chain moves on), junk stays null', () => {
    const file = '0270_FluidR3_GM_sf2_file.js';
    for (const base of [undefined, '', '   ', 'ftp://x', 'javascript:alert(1)', 'wafonts/']) {
        assert.strictEqual(_gmUrlForSourcePure('org', file, base), null, String(base));
    }
    assert.strictEqual(_gmUrlForSourcePure('cdn', ''), null);
    assert.strictEqual(_gmUrlForSourcePure('nope', file), null);
});

// ── Kind inference + per-kind voices ──────────────────────────────────

t('voice family collapses the resolved kind to keys / bass / guitar', () => {
    // _gmKindPure now takes the RESOLVED instrument kind (arrKind), not a name.
    // The three GM voice families are keys / bass / guitar; drums and vocals
    // (and anything unrecognized) fall to the guitar voice.
    assert.strictEqual(_gmKindPure('keys'), 'keys');
    assert.strictEqual(_gmKindPure('bass'), 'bass');
    assert.strictEqual(_gmKindPure('guitar'), 'guitar');
    assert.strictEqual(_gmKindPure('drums'), 'guitar', 'drums never reach the pitched voice');
    assert.strictEqual(_gmKindPure('vocals'), 'guitar');
    assert.strictEqual(_gmKindPure(null), 'guitar');
});

t('an authored `type` drives the guide voice — a mis-NAMED part voices by what it IS', () => {
    // The rename-safety payoff: identity is DATA. arrKind resolves the type
    // ahead of the name, so a bass-typed part named "Lead Guitar" takes the
    // BASS voice, and a keys-typed part named "Gtr" takes the KEYS voice —
    // on main (name-only) both would have voiced as guitar.
    assert.strictEqual(_gmKindPure(arrKind({ type: 'bass', name: 'Lead Guitar' })), 'bass');
    assert.strictEqual(_gmKindPure(arrKind({ type: 'piano', name: 'Gtr' })), 'keys');
    // Untyped still reads the name (byte-identical to the old behavior): the
    // pinned start-anchored trap — "Electric Piano" is guitar, "Synth …" keys.
    assert.strictEqual(_gmKindPure(arrKind({ name: 'Electric Piano' })), 'guitar',
        'untyped: start-anchored name inference is unchanged');
    assert.strictEqual(_gmKindPure(arrKind({ name: 'Synth Lead' })), 'keys');
    assert.strictEqual(_gmKindPure(arrKind({ name: 'Bass' })), 'bass');
});

t('voice-for-kind: valid pref wins, garbage falls to the kind default, unknown kind is null', () => {
    assert.strictEqual(_gmVoiceForKindPure('34', 'bass'), 34);
    assert.strictEqual(_gmVoiceForKindPure(0, 'keys'), 0, 'program 0 is a real choice');
    for (const junk of [null, undefined, '', 'abc', '999', '-3', '127.5']) {
        assert.strictEqual(_gmVoiceForKindPure(junk, 'guitar'), GM_KIND_DEFAULTS.guitar, String(junk));
    }
    assert.strictEqual(_gmVoiceForKindPure('27', 'drums'), null);
    assert.strictEqual(_gmVoiceForKindPure('27', '__proto__'), null);
});

t('every curated choice is a valid program and every kind has a default in its list', () => {
    for (const [kind, choices] of Object.entries(GM_VOICE_CHOICES)) {
        assert.ok(choices.length >= 2, kind);
        for (const c of choices) {
            assert.strictEqual(_gmFilePure(c.gm) !== null, true, `${kind}:${c.label}`);
        }
        assert.ok(choices.some(c => c.gm === GM_KIND_DEFAULTS[kind]),
            `${kind} default appears in its menu rows`);
    }
});

t('mode pure: instruments ARE the guide — every input reads gm (legacy clap prefs too)', () => {
    for (const raw of ['gm', 'clap', null, undefined, '', 'GM', 'instrument', 1]) {
        assert.strictEqual(_gmGuideModePure(raw), 'gm', String(raw));
    }
});

// ── Pitched event window ──────────────────────────────────────────────

t('sanitize: drops non-finite times and out-of-range/non-integer midi, sorts by time', () => {
    const out = _gmSanitizeEventsPure([
        { t: 2, midi: 64 }, { t: 1, midi: 40 }, { t: NaN, midi: 60 },
        { t: 3, midi: 128 }, { t: 3, midi: -1 }, { t: 3, midi: 60.5 },
        null, { t: 4 }, { t: 5, midi: 0 },
    ]);
    assert.deepStrictEqual(out.map(e => [e.t, e.midi]), [[1, 40], [2, 64], [5, 0]]);
    assert.deepStrictEqual(_gmSanitizeEventsPure(null), []);
});

t('window query: half-open, 1 ms chord buckets, distinct pitches, per-voice sustain kept', () => {
    const evs = _gmSanitizeEventsPure([
        { t: 1.0000, midi: 40, sus: 2.0 },
        { t: 1.0004, midi: 44, sus: 0.5 },   // same 1 ms bucket
        { t: 1.0004, midi: 40, sus: 9.9 },   // duplicate pitch → dropped
        { t: 1.2, midi: 47, sus: 0.1 },
        { t: 2.0, midi: 50, sus: 1 },        // at `to` → excluded (half-open)
    ]);
    const groups = _gmEventsInWindowPure(evs, 1.0, 2.0, 4);
    assert.strictEqual(groups.length, 2);
    assert.deepStrictEqual(groups[0].voices.map(v => [v.midi, v.sus]), [[40, 2.0], [44, 0.5]]);
    assert.deepStrictEqual(groups[1].voices.map(v => v.midi), [47]);
});

t('window query: chord cap holds and drops deterministically', () => {
    const evs = _gmSanitizeEventsPure(
        [40, 44, 47, 52, 56, 59].map(m => ({ t: 1, midi: m, sus: 1 })));
    const groups = _gmEventsInWindowPure(evs, 0.5, 1.5, 4);
    assert.strictEqual(groups.length, 1);
    assert.deepStrictEqual(groups[0].voices.map(v => v.midi), [40, 44, 47, 52]);
});

t('window query: empty/degenerate inputs yield []', () => {
    assert.deepStrictEqual(_gmEventsInWindowPure([], 0, 1, 4), []);
    assert.deepStrictEqual(_gmEventsInWindowPure(null, 0, 1, 4), []);
    assert.deepStrictEqual(
        _gmEventsInWindowPure([{ t: 1, midi: 40, sus: 1 }], 2, 2, 4), []);
});

t('voice duration: sustain honored, capped at 1.6 s, staccato floor 0.35 s', () => {
    assert.strictEqual(_gmVoiceDurationPure(0.8), 0.8);
    assert.strictEqual(_gmVoiceDurationPure(30), 1.6);
    for (const junk of [0, -1, NaN, null, undefined, 'x']) {
        assert.strictEqual(_gmVoiceDurationPure(junk), 0.35, String(junk));
    }
});

// ── Prefs + runtime degradation ───────────────────────────────────────

t('per-kind voice pref round-trips; a junk write is refused', () => {
    _store.clear();
    editorSetGmVoice('bass', 34);
    assert.strictEqual(editorGmVoiceFor('bass'), 34);
    editorSetGmVoice('drums', 50);           // unknown kind → no write
    assert.strictEqual(_store.has('editorGmVoice:drums'), false);
    assert.strictEqual(editorGmVoiceFor('guitar'), GM_KIND_DEFAULTS.guitar);
    _store.clear();
});

t('gmVoiceAt with nothing loaded returns null (the tick claps instead) — never throws', () => {
    _resetGmGuideForTest();
    assert.strictEqual(gmPresetReady(27), false);
    assert.strictEqual(gmVoiceAt({}, {}, 27, 0, 64, 0.5), null);
});

// ── Menu model rows ───────────────────────────────────────────────────

function modelWith(gmGuide) {
    return _menuModelPure(EDITOR_MENUS, _editorShortcutRowsPure('feedback'), {
        tempoMapMode: false, hasAudio: true, fns: new Set(),
        toolbars: { visible: {}, preset: 'everything' },
        loopSnapMode: 'bar',
        gmGuide,
    });
}
const transportItems = (model) => model.find(m => m.title === 'Transport').items;

t('menu: the clap/instrument radio is GONE; instrument rows follow the kind', () => {
    const items = transportItems(modelWith({
        mode: 'gm', kind: 'bass', program: 34, choices: GM_VOICE_CHOICES.bass,
    }));
    assert.ok(!items.some(i => i.label && i.label.endsWith('Clap')), 'no clap row anywhere');
    assert.ok(!items.some(i => i.label && i.label.includes('Instrument (GM)')), 'no mode radio');
    assert.ok(items.some(i => i.hdr === 'Guide instrument (bass)'), 'kind header');
    const picked = items.find(i => i.label && i.label.includes('Picked'));
    assert.ok(picked.label.startsWith('✓ '), 'active program checked');
    assert.deepStrictEqual(picked.dispatch, { gmVoice: 34, gmKind: 'bass' });
});

t('menu: no kind in scope (no song / drum grid) renders NO instrument rows', () => {
    const items = transportItems(modelWith({ mode: 'gm', kind: null, program: null, choices: [] }));
    assert.ok(!items.some(i => typeof i.hdr === 'string' && i.hdr.startsWith('Guide instrument')));
    assert.ok(!items.some(i => i.label && i.label.endsWith('Clap')), 'and still no clap row');
});

t('menu: an older ctx without gmGuide never throws (and still offers no radio)', () => {
    const items = transportItems(modelWith(undefined));
    assert.ok(Array.isArray(items) && items.length, 'model renders');
    assert.ok(!items.some(i => i.label && i.label.endsWith('Clap')));
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
