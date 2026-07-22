/*
 * Region glass-banner height clamp (_regionBannerH).
 *
 * The Tracks-view region block draws a translucent title banner and insets the
 * note silhouette below it. This pure decides the banner height: ~14px on a
 * normal lane, shrinking on short lanes and collapsing to 0 (a bare colour
 * spine, no inset) below ~23px so a squeezed lane never gets a crushed banner or
 * a negative content band. This is the one bit of new logic with a correctness
 * consequence, so it's pinned here.
 *
 * Fails on main: _regionBannerH doesn't exist there.
 *
 * Run: node tests/region_banner.test.mjs
 */
import assert from 'node:assert';

const { _regionBannerH } = await import('../src/region.js');

let pass = 0; let fail = 0;
const tests = [];
const t = (name, fn) => tests.push([name, fn]);

t('caps at 14px on a normal/tall lane', () => {
    assert.strictEqual(_regionBannerH(56), 14);
    assert.strictEqual(_regionBannerH(120), 14);
    assert.strictEqual(_regionBannerH(30), 14, 'just above the cap threshold still clamps');
    assert.strictEqual(_regionBannerH(29), 14);
});

t('shrinks smoothly on a shortening lane', () => {
    assert.strictEqual(_regionBannerH(28), 13);
    assert.strictEqual(_regionBannerH(24), 9);
    assert.strictEqual(_regionBannerH(23), 8, 'the smallest banner still shown');
});

t('collapses to 0 (spine fallback, no inset) below the threshold', () => {
    assert.strictEqual(_regionBannerH(22), 0, 'a 7px banner would be too small — drop it');
    assert.strictEqual(_regionBannerH(15), 0);
    assert.strictEqual(_regionBannerH(0), 0);
    assert.strictEqual(_regionBannerH(-40), 0, 'never negative');
});

t('tolerates non-numbers without throwing', () => {
    assert.strictEqual(_regionBannerH(undefined), 0);
    assert.strictEqual(_regionBannerH(null), 0);
    assert.strictEqual(_regionBannerH(NaN), 0);
});

t('the banner never consumes the whole lane (content band stays positive)', () => {
    // cLaneH = laneH - bannerH must stay > 0 for every lane height, or the
    // inset content band would invert.
    for (let laneH = 1; laneH <= 400; laneH++) {
        const b = _regionBannerH(laneH);
        assert.ok(b < laneH, `banner ${b} must be < laneH ${laneH}`);
        assert.ok(b >= 0, `banner ${b} must be >= 0`);
    }
});

for (const [name, fn] of tests) {
    try { await fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
