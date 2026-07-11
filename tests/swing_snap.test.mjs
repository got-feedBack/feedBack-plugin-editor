/*
 * Tests for swing quantization (src/snap.js, workspace-shell D2).
 *
 * The design rule under test: swing is a BEAT-DOMAIN phase offset — never a
 * seconds nudge — fed through the tempo-map converter like every snap. So:
 * 50% must be bit-identical to the straight rounding path, the off candidate
 * sits at pct% through each pair, downbeats never move, triplet grids are a
 * no-op, and (the flex test) a swung beat coordinate keeps its groove ratio
 * when the grid times change under it.
 *
 * Run: node tests/swing_snap.test.mjs
 */
import assert from 'node:assert';

globalThis.document = globalThis.document || {
    getElementById: () => null, addEventListener: () => {}, activeElement: null,
};
globalThis.localStorage = globalThis.localStorage || { getItem: () => null, setItem: () => {} };
globalThis.window = globalThis.window || globalThis;

const { SWING_PRESETS, _swingQuantizeBeatPure } = await import('../src/snap.js');
const { timeOf } = await import('../src/beats.js');
const { readFileSync } = await import('node:fs');
const { fileURLToPath } = await import('node:url');
const { dirname, join } = await import('node:path');

let pass = 0, fail = 0;
function t(name, fn) {
    try { fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}

t('50% is bit-identical to the straight rounding path', () => {
    for (const subs of [1, 2, 3, 4, 8, 16]) {
        for (let i = 0; i < 200; i++) {
            const beta = (i * 7919 % 1000) / 61.7;   // deterministic spread
            assert.strictEqual(
                _swingQuantizeBeatPure(beta, subs, 50),
                Math.round(beta * subs) / subs,
                `subs=${subs} beta=${beta}`);
        }
    }
});

t('the off-eighth lands at pct% through the beat (would-fail-on-main)', () => {
    // subs=2 → a pair spans one beat; the off candidate sits at 0.54, not 0.5.
    assert.strictEqual(_swingQuantizeBeatPure(0.5, 2, 54), 0.54);
    assert.strictEqual(_swingQuantizeBeatPure(3.5, 2, 62), 3.62);
    // 1/16 swing: a pair spans half a beat; the off-16th of the SECOND pair
    // of beat 2 → pair start 2.5, off at 2.5 + 0.62·0.5 = 2.81.
    assert.strictEqual(_swingQuantizeBeatPure(2.8, 4, 62), 2.81);
});

t('downbeats and on-subdivisions never move', () => {
    for (const pct of [54, 58, 62]) {
        assert.strictEqual(_swingQuantizeBeatPure(0.05, 2, pct), 0, 'downbeat');
        assert.strictEqual(_swingQuantizeBeatPure(4.02, 2, pct), 4, 'later downbeat');
        assert.strictEqual(_swingQuantizeBeatPure(1.51, 4, pct), 1.5, '16th pair start holds');
    }
});

t('nearest-candidate: a late off-beat rounds up to the next beat', () => {
    // u=0.85 with s=0.54: |0.85−0.54|=0.31 > |0.85−1|=0.15 → next beat.
    assert.strictEqual(_swingQuantizeBeatPure(0.85, 2, 54), 1);
    // u=0.3: closer to the off (0.54) than to 0? |0.3|=0.3 vs 0.24 → off.
    assert.strictEqual(_swingQuantizeBeatPure(0.3, 2, 54), 0.54);
    // u=0.2: closer to the pair start.
    assert.strictEqual(_swingQuantizeBeatPure(0.2, 2, 54), 0);
});

t('triplet grids are a no-op (already swung by construction)', () => {
    // Includes EVEN triplet subdivisions (6, 12): triplet-ness is divisibility
    // by 3, not parity.
    for (const subs of [3, 6, 12, 24]) {
        assert.strictEqual(
            _swingQuantizeBeatPure(0.4, subs, 62),
            Math.round(0.4 * subs) / subs, `subs=${subs}`);
    }
});

t('corrupt/out-of-band swing never flings notes: straight fallback', () => {
    for (const pct of [NaN, undefined, null, 0, -3, 49, 76, 200, 'x']) {
        assert.strictEqual(_swingQuantizeBeatPure(0.5, 2, pct), 0.5, `pct=${pct}`);
    }
    assert.strictEqual(_swingQuantizeBeatPure(NaN, 2, 54), NaN, 'non-finite beta passes through');
});

t('a swung beat coordinate keeps its groove ratio through a tempo flex', () => {
    // The swung snap yields a BEAT coordinate; seconds are derived by timeOf.
    const q = _swingQuantizeBeatPure(0.5, 2, 62);   // 0.62 beats
    const gridA = [{ time: 0 }, { time: 0.5 }, { time: 1.0 }];        // 120 BPM
    const gridB = [{ time: 0 }, { time: 0.75 }, { time: 1.5 }];       // flexed to 80
    const tA = timeOf(gridA, q);
    const tB = timeOf(gridB, q);
    // In both grids the note sits 62% through the first beat gap.
    assert.ok(Math.abs(tA / 0.5 - 0.62) < 1e-9, `gridA ratio ${tA / 0.5}`);
    assert.ok(Math.abs(tB / 0.75 - 0.62) < 1e-9, `gridB ratio ${tB / 0.75}`);
});

t('the toolbar presets and SWING_PRESETS agree (no drift)', () => {
    const html = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'screen.html'), 'utf8');
    const sel = html.match(/<select id="editor-swing"[^]*?<\/select>/);
    assert.ok(sel, 'screen.html ships the swing select');
    const optionPcts = [...sel[0].matchAll(/value="(\d+)"/g)].map((m) => Number(m[1])).sort((a, b) => a - b);
    const presetPcts = SWING_PRESETS.map((p) => p.pct).sort((a, b) => a - b);
    assert.deepStrictEqual(optionPcts, presetPcts);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
