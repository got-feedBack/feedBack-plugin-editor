/*
 * Instruments by default (Christian's call: "the guide claps are dumb —
 * built-in soundfonts, on by default for each Guitar Pro / MIDI track"):
 *
 *   - CHARTWARE (a GP/MIDI import — no recording) sounds OUT OF THE BOX:
 *     guide ON + band mode ON by default; recording-backed sessions keep
 *     the quiet defaults; a stored user choice beats both, both ways;
 *   - the guide voice is ALWAYS instruments (the clap mode is gone; a
 *     legacy stored 'clap' pref reads as instruments too);
 *   - the default per-kind presets are genuinely VENDORED (served from the
 *     plugin, no network needed): player + piano 0 + clean electric 27 +
 *     fingered bass 33, named exactly as the /wafont whitelist expects.
 *
 * Fails on main (the session-aware defaults don't exist there).
 * Run: node tests/instruments_default.test.mjs
 */
import assert from 'node:assert';
import { existsSync, statSync } from 'node:fs';

globalThis.document = globalThis.document || {
    getElementById: () => null, addEventListener: () => {}, activeElement: null,
};
const stored = {};
globalThis.localStorage = {
    getItem: (k) => (k in stored ? stored[k] : null),
    setItem: (k, v) => { stored[k] = v; },
};
globalThis.window = globalThis.window || globalThis;

const { editorGuideClapEnabled, editorGuideVoiceMode, _editorToggleGuideClap } =
    await import('../src/audio.js');
const { GM_VOICE_CHOICES, _gmFilePure, _gmGuideModePure } = await import('../src/gm-guide.js');
const { S } = await import('../src/state.js');

let pass = 0, fail = 0;
function t(name, fn) {
    try { fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}

t('chartware guide default is ON; a recording keeps it OFF; stored choice wins both ways', () => {
    Object.assign(S, { createMode: true, audioBuffer: null, audioUrl: null });
    assert.strictEqual(editorGuideClapEnabled(), true, 'a GP import sounds out of the box');
    Object.assign(S, { createMode: false, audioBuffer: {}, audioUrl: 'x' });
    assert.strictEqual(editorGuideClapEnabled(), false, 'a recording session stays quiet');
    // The user turns it ON in a recording session — stored '1' sticks…
    _editorToggleGuideClap();
    assert.strictEqual(editorGuideClapEnabled(), true);
    assert.strictEqual(stored.editorGuideClap, '1');
    // …and turning it OFF in chartware sticks too (default never overrides).
    Object.assign(S, { createMode: true, audioBuffer: null, audioUrl: null });
    _editorToggleGuideClap();
    assert.strictEqual(editorGuideClapEnabled(), false, 'an explicit OFF beats the chartware default');
    assert.strictEqual(stored.editorGuideClap, '0');
    delete stored.editorGuideClap;
});

t('the guide voice is always instruments — the clap mode is gone, legacy prefs migrate', () => {
    for (const raw of ['clap', 'gm', null, '']) assert.strictEqual(_gmGuideModePure(raw), 'gm');
    stored.editorGuideVoice = 'clap';           // a legacy pref
    assert.strictEqual(editorGuideVoiceMode(), 'gm', 'stored clap reads as instruments');
    delete stored.editorGuideVoice;
});

t('the default preset per kind is VENDORED — plugin-served, no network needed', () => {
    const wafonts = new URL('../assets/wafonts/', import.meta.url);
    const mustShip = ['WebAudioFontPlayer.js'];
    for (const kind of ['guitar', 'bass', 'keys']) {
        mustShip.push(_gmFilePure(GM_VOICE_CHOICES[kind][0].gm));
    }
    assert.deepStrictEqual(mustShip.slice(1), [
        '0270_FluidR3_GM_sf2_file.js',   // clean electric — the guitar default
        '0330_FluidR3_GM_sf2_file.js',   // fingered — the bass default
        '0000_FluidR3_GM_sf2_file.js',   // grand piano — the keys default
    ], 'the naming contract the /wafont whitelist serves');
    for (const f of mustShip) {
        const p = new URL(f, wafonts);
        assert.ok(existsSync(p), `${f} is vendored`);
        assert.ok(statSync(p).size > 50_000, `${f} is a real render, not a stub`);
    }
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
