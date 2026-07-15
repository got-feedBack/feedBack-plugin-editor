/*
 * Multitrack stem manager (studio-session ingest): the row model, the
 * pairing rules, and the solo-my-source-track verb.
 *
 * Pinned here:
 *   - rows follow S.stems ORDER (the manifest is order-authoritative) and
 *     resolve their paired chart track by the _partViewKeyPure rule
 *     (id-or-name — never a bare index, so links survive part reordering);
 *   - a chart track pairs with ONE stem (re-pairing drops the old link)
 *     and picking '' unlinks;
 *   - soloMyStem solos exactly the current track's paired stem via
 *     S.stemMix (the stem-mixer contract) and toggles off cleanly;
 *   - the save body ships stem_links (the persistence wire).
 *
 * Fails on main (the module doesn't exist there).
 * Run: node tests/stem_tracks.test.mjs
 */
import assert from 'node:assert';

globalThis.document = globalThis.document || {
    getElementById: () => null, addEventListener: () => {}, activeElement: null,
};
globalThis.localStorage = globalThis.localStorage || { getItem: () => null, setItem: () => {} };
globalThis.window = globalThis.window || globalThis;

const { _stemLinkSetPure, _stemRowsPure, editorSoloMyStem } = await import('../src/stem-tracks.js');
const { S } = await import('../src/state.js');

let pass = 0, fail = 0;
function t(name, fn) {
    try { fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}

t('rows follow stem order and resolve pairings by the id-or-name key rule', () => {
    const stems = [{ id: 'Guitar_L' }, { id: 'Bass_DI' }, { id: 'Kick_In' }];
    const arrangements = [{ id: 'a1', name: 'Lead' }, { name: 'Bass' }];
    const links = { a1: 'Guitar_L', Bass: 'Bass_DI' };
    const rows = _stemRowsPure(stems, links, arrangements);
    assert.deepStrictEqual(rows.map(r => r.id), ['Guitar_L', 'Bass_DI', 'Kick_In'], 'order kept');
    assert.strictEqual(rows[0].pairedWith.name, 'Lead', 'id-keyed link resolves');
    assert.strictEqual(rows[1].pairedWith.name, 'Bass', 'name-keyed link resolves');
    assert.strictEqual(rows[2].pairedWith, null, 'unpaired is honest');
});

t('a chart track pairs with ONE stem; re-pairing replaces; empty unlinks', () => {
    let links = _stemLinkSetPure({}, 'a1', 'Guitar_L');
    assert.deepStrictEqual(links, { a1: 'Guitar_L' });
    links = _stemLinkSetPure(links, 'a1', 'Guitar_R');
    assert.deepStrictEqual(links, { a1: 'Guitar_R' }, 're-pairing replaces the old link');
    links = _stemLinkSetPure(links, 'a1', '');
    assert.deepStrictEqual(links, {}, 'empty unlinks');
});

t('soloMyStem solos exactly the paired stem and toggles off', () => {
    Object.assign(S, {
        arrangements: [{ id: 'a1', name: 'Lead' }], currentArr: 0,
        stems: [{ id: 'Guitar_L' }, { id: 'Bass_DI' }],
        stemLinks: { a1: 'Guitar_L' }, stemMix: {},
    });
    editorSoloMyStem();
    assert.strictEqual(S.stemMix.Guitar_L.solo, true);
    assert.strictEqual(S.stemMix.Guitar_L.mute, false, 'solo clears any mute');
    assert.strictEqual(S.stemMix.Bass_DI, undefined, 'only the paired stem is touched');
    editorSoloMyStem();
    assert.strictEqual(S.stemMix.Guitar_L.solo, false, 'second press releases');
    // No pairing = a status nudge, never a throw or a wrong solo.
    S.stemLinks = {};
    editorSoloMyStem();
    assert.strictEqual(S.stemMix.Bass_DI, undefined);
});

t('the save body ships stem_links', async () => {
    const fs = await import('node:fs');
    const src = fs.readFileSync(new URL('../src/file-ops.js', import.meta.url), 'utf8');
    assert.match(src, /stem_links:\s*S\.stemLinks \|\| \{\}/, 'persistence wire present');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
