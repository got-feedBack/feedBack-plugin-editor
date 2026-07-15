/*
 * Tests for the stem mixer math in src/audio.js — the per-stem gain model
 * behind the mixer panel's Stems section.
 *
 * Pinned here: the strip-state defaults/clamps over S.stemMix, the DAW
 * audibility rule folded into per-stem GAINS (mute wins; any solo isolates;
 * volume scales linearly), the unity test that keeps the shipped mixdown
 * playing until the user actually pulls the mix off unity, and the
 * source-path predicate (stems sound only when active AND decoded AND not
 * on the pitch-preserving slow path).
 *
 * Run: node --test tests/stem_mixer.test.mjs
 */
import assert from 'node:assert';

globalThis.document = globalThis.document || { getElementById: () => null, addEventListener: () => {}, activeElement: null };
globalThis.localStorage = globalThis.localStorage || { getItem: () => null, setItem: () => {} };
globalThis.window = globalThis.window || globalThis;

const P = await import('../src/audio.js');

let pass = 0, fail = 0;
function t(name, fn) {
    try { fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}

const IDS = ['guitar', 'bass', 'drums', 'vocals'];

// ── Strip state: defaults and clamps ─────────────────────────────────

t('strip state defaults to audible unity; volume clamps into [0, 100]', () => {
    assert.deepStrictEqual(P._stemStripStatePure({}, 'guitar'), { vol: 100, mute: false, solo: false });
    assert.deepStrictEqual(P._stemStripStatePure(null, 'guitar'), { vol: 100, mute: false, solo: false });
    assert.strictEqual(P._stemStripStatePure({ guitar: { vol: 250 } }, 'guitar').vol, 100);
    assert.strictEqual(P._stemStripStatePure({ guitar: { vol: -5 } }, 'guitar').vol, 0);
    assert.strictEqual(P._stemStripStatePure({ guitar: { vol: 'junk' } }, 'guitar').vol, 100);
    assert.strictEqual(P._stemStripStatePure({ guitar: { mute: 1 } }, 'guitar').mute, true);
});

// ── Gains: the DAW rule as numbers ───────────────────────────────────

t('unity mix → every stem at gain 1', () => {
    assert.deepStrictEqual({ ...P._stemGainsPure({}, IDS) },
        { guitar: 1, bass: 1, drums: 1, vocals: 1 });
});

t('mute zeroes one stem; volume scales linearly', () => {
    const g = P._stemGainsPure({ bass: { mute: true }, drums: { vol: 40 } }, IDS);
    assert.strictEqual(g.bass, 0);
    assert.strictEqual(g.drums, 0.4);
    assert.strictEqual(g.guitar, 1);
});

t('any solo isolates the soloed stems — this IS "hear just the guitar"', () => {
    const g = P._stemGainsPure({ guitar: { solo: true } }, IDS);
    assert.deepStrictEqual({ ...g }, { guitar: 1, bass: 0, drums: 0, vocals: 0 });
    // Two solos both sound; the rest stay silent.
    const g2 = P._stemGainsPure({ guitar: { solo: true }, bass: { solo: true, vol: 50 } }, IDS);
    assert.deepStrictEqual({ ...g2 }, { guitar: 1, bass: 0.5, drums: 0, vocals: 0 });
});

t('mute beats solo on the same strip', () => {
    const g = P._stemGainsPure({ guitar: { solo: true, mute: true } }, IDS);
    assert.strictEqual(g.guitar, 0);
    // …and the solo still gates the others (it is still "a solo somewhere").
    assert.strictEqual(g.bass, 0);
});

t('a stale solo for a stem NOT in this song does not gate the real stems', () => {
    // _stemAnySoloPure walks the song's ids, not the map's keys, so a
    // leftover entry from another song's stem set is inert.
    assert.strictEqual(P._stemAnySoloPure({ piano: { solo: true } }, IDS), false);
    assert.deepStrictEqual({ ...P._stemGainsPure({ piano: { solo: true } }, IDS) },
        { guitar: 1, bass: 1, drums: 1, vocals: 1 });
});

t('"__proto__" as a stem id is an ordinary key, not the prototype accessor', () => {
    // Pack data names the stems, so hostile ids must not walk the prototype
    // chain — the gains map is null-prototype and writes land as own keys.
    const ids = ['guitar', '__proto__'];
    const g = P._stemGainsPure({ ['__proto__']: { vol: 30 } }, ids);
    assert.strictEqual(Object.getPrototypeOf(g), null);
    assert.strictEqual(g['__proto__'], 0.3);
    assert.strictEqual(g.guitar, 1);
});

// ── Unity detection: the combined-mix fallback boundary ──────────────

t('untouched / explicitly-unity strips are NOT an active mix', () => {
    assert.strictEqual(P._stemMixActivePure({}, IDS), false);
    assert.strictEqual(P._stemMixActivePure(null, IDS), false);
    assert.strictEqual(P._stemMixActivePure({ guitar: { vol: 100, mute: false, solo: false } }, IDS), false);
});

t('any mute, solo, or off-unity volume makes the mix active', () => {
    assert.strictEqual(P._stemMixActivePure({ guitar: { mute: true } }, IDS), true);
    assert.strictEqual(P._stemMixActivePure({ guitar: { solo: true } }, IDS), true);
    assert.strictEqual(P._stemMixActivePure({ guitar: { vol: 99 } }, IDS), true);
});

t('no stem ids → never active (stem-less song is byte-identical to today)', () => {
    assert.strictEqual(P._stemMixActivePure({ guitar: { mute: true } }, []), false);
});

// ── The source-path predicate ────────────────────────────────────────

t('stems sound only when active AND decoded AND not slowed', () => {
    assert.strictEqual(P._stemPlaybackWantedPure(true, true, false), true);
    assert.strictEqual(P._stemPlaybackWantedPure(false, true, false), false, 'unity keeps the mixdown');
    assert.strictEqual(P._stemPlaybackWantedPure(true, false, false), false, 'not decoded yet');
    assert.strictEqual(P._stemPlaybackWantedPure(true, true, true), false, 'audition slow path bypasses stems');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
