/*
 * Regression: rapid pairing changes fire concurrent full-snapshot writes to
 * /stem-op. A slower EARLIER response must not resolve last and clobber the
 * user's newer S.stemLinks selection. _syncPairing stamps each request and
 * ignores any response a later pairing has superseded.
 *
 * Pre-fix this test fails (the stale response overwrites the newer links);
 * post-fix the stale response is dropped.
 *
 * Run: node tests/track_session_pairing_race.test.mjs
 */
import assert from 'node:assert';

// DOM-free: track-session's panel()/refresh guard on `typeof document`.
const { S } = await import('../src/state.js');
const { _syncPairing } = await import('../src/track-session.js');

let pass = 0, fail = 0;
async function t(name, fn) {
    try { await fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}

await t('a stale pairing response cannot overwrite the newer selection', async () => {
    S.sessionId = 'sess';
    S.stems = [];
    S.stemLinks = {};

    // fetch parks each request; the test controls resolution order.
    const resolvers = [];
    globalThis.fetch = () => new Promise(res => resolvers.push(res));

    // Two overlapping pairing changes: 'stemA' then 'stemB' (the newer choice).
    const pA = _syncPairing('t', 'stemA', 'paired A');
    const pB = _syncPairing('t', 'stemB', 'paired B');
    assert.strictEqual(S.stemLinks.t, 'stemB', 'the newest selection is written synchronously');
    assert.strictEqual(resolvers.length, 2, 'both requests are in flight');

    // Resolve the NEWER request first…
    resolvers[1]({ json: async () => ({ stem_links: { t: 'stemB' }, stems: [], persisted: true }) });
    await pB;
    // …then the STALE older request resolves last.
    resolvers[0]({ json: async () => ({ stem_links: { t: 'stemA' }, stems: [], persisted: true }) });
    await pA;

    assert.strictEqual(S.stemLinks.t, 'stemB',
        'the late stale response is ignored — the newer pairing survives');

    delete globalThis.fetch;
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
