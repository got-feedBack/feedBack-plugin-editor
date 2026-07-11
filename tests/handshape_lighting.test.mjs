/*
 * Tests for handshape-template lighting on the fretboard companion strip
 * (src/fretboard-strip.js — the P7 follow-up: `_stripHandshapeShapePure`
 * resolves the authored handshape covering the selection into ghost dots).
 *
 * Pinned: span coverage with edge tolerance, the innermost-span (latest
 * start) tie-break, dangling chord_id / empty templates → null, the string
 * cap for GP's 6-padded templates on narrower charts, finger propagation,
 * label fallbacks, and that the fret window widens to cover the shape.
 *
 * Run: node tests/handshape_lighting.test.mjs
 */
import assert from 'node:assert';

globalThis.document = globalThis.document || {
    getElementById: () => null, addEventListener: () => {}, activeElement: null,
};
globalThis.localStorage = globalThis.localStorage || { getItem: () => null, setItem: () => {} };
globalThis.window = globalThis.window || globalThis;

const { _stripHandshapeShapePure, _stripFretWindowPure } =
    await import('../src/fretboard-strip.js');

let pass = 0, fail = 0;
function t(name, fn) {
    try { fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}

// A 6-string arr with one E5-shape handshape over [1, 2] and an arp over [3, 4].
const ARR = () => ({
    handshapes: [
        { chord_id: 0, start_time: 1, end_time: 2 },
        { chord_id: 1, start_time: 3, end_time: 4, arp: true },
    ],
    chord_templates: [
        { displayName: 'E5', frets: [0, 2, 2, -1, -1, -1], fingers: [-1, 1, 3, -1, -1, -1] },
        { name: 'Am', frets: [-1, 0, 2, 2, 1, 0], fingers: [-1, -1, 2, 3, 1, -1] },
    ],
});

t('a covered time resolves the template into played-string dots with fingers', () => {
    const s = _stripHandshapeShapePure(ARR(), 1.5, 6);
    assert.ok(s && !s.arp);
    assert.strictEqual(s.label, 'E5');
    assert.deepStrictEqual(s.dots, [
        { string: 0, fret: 0, finger: null },
        { string: 1, fret: 2, finger: 1 },
        { string: 2, fret: 2, finger: 3 },
    ]);
});

t('span edges hit (with tolerance); outside every span → null', () => {
    assert.ok(_stripHandshapeShapePure(ARR(), 1, 6));
    assert.ok(_stripHandshapeShapePure(ARR(), 2, 6));
    assert.ok(_stripHandshapeShapePure(ARR(), 2 + 1e-7, 6), 'EPS tolerance at the edge');
    assert.strictEqual(_stripHandshapeShapePure(ARR(), 2.5, 6), null);
    assert.strictEqual(_stripHandshapeShapePure(ARR(), 0.5, 6), null);
});

t('the arp span reports arp + the name fallback', () => {
    const s = _stripHandshapeShapePure(ARR(), 3.5, 6);
    assert.ok(s && s.arp);
    assert.strictEqual(s.label, 'Am');
    assert.strictEqual(s.dots.length, 5);
});

t('nested spans: the latest-starting (innermost) shape wins', () => {
    const arr = ARR();
    arr.handshapes.push({ chord_id: 1, start_time: 1.2, end_time: 1.8 });
    const s = _stripHandshapeShapePure(arr, 1.5, 6);
    assert.strictEqual(s.label, 'Am', 'inner span shadows the outer');
    assert.strictEqual(_stripHandshapeShapePure(arr, 1.1, 6).label, 'E5', 'outside the inner span the outer still shows');
});

t('label falls back displayName > name > shape/arp', () => {
    const arr = ARR();
    delete arr.chord_templates[0].displayName;
    arr.chord_templates[0].name = 'E five';
    assert.strictEqual(_stripHandshapeShapePure(arr, 1.5, 6).label, 'E five');
    delete arr.chord_templates[0].name;
    assert.strictEqual(_stripHandshapeShapePure(arr, 1.5, 6).label, 'shape');
    arr.handshapes[0].arp = true;
    assert.strictEqual(_stripHandshapeShapePure(arr, 1.5, 6).label, 'arp');
});

t('dangling chord_id, missing frets, or an all-muted template → null', () => {
    const dangling = ARR(); dangling.handshapes[0].chord_id = 99;
    assert.strictEqual(_stripHandshapeShapePure(dangling, 1.5, 6), null);
    const noFrets = ARR(); delete noFrets.chord_templates[0].frets;
    assert.strictEqual(_stripHandshapeShapePure(noFrets, 1.5, 6), null);
    const muted = ARR(); muted.chord_templates[0].frets = [-1, -1, -1, -1, -1, -1];
    assert.strictEqual(_stripHandshapeShapePure(muted, 1.5, 6), null);
});

t('strings at/above L are dropped (6-padded template on a 4-string chart)', () => {
    const arr = ARR();
    const s = _stripHandshapeShapePure(arr, 3.5, 4);   // Am uses strings 1–5
    assert.deepStrictEqual(s.dots.map((d) => d.string), [1, 2, 3]);
});

t('garbage inputs never throw: null arr, no handshapes, bad spans, bad t', () => {
    assert.strictEqual(_stripHandshapeShapePure(null, 1, 6), null);
    assert.strictEqual(_stripHandshapeShapePure({}, 1, 6), null);
    assert.strictEqual(_stripHandshapeShapePure({ handshapes: 'x' }, 1, 6), null);
    assert.strictEqual(_stripHandshapeShapePure(ARR(), NaN, 6), null);
    const bad = ARR(); bad.handshapes[0].start_time = 'x';
    assert.strictEqual(_stripHandshapeShapePure(bad, 3.5, 6).label, 'Am', 'broken span skipped, valid one still resolves');
});

t('non-negative finger 0 renders as thumb, negative as none', () => {
    const arr = ARR();
    arr.chord_templates[0].fingers = [0, -1, 2, -1, -1, -1];
    const s = _stripHandshapeShapePure(arr, 1.5, 6);
    assert.strictEqual(s.dots[0].finger, 0, 'thumb (0) is a real finger mark');
    assert.strictEqual(s.dots[1].finger, null);
});

t('the fret window widens to cover the shape dots', () => {
    const dots = _stripHandshapeShapePure(ARR(), 3.5, 6).dots;
    const w = _stripFretWindowPure(dots, 0, 12);
    assert.ok(w.hi >= 3, 'window covers the Am shape');
    const high = { handshapes: [{ chord_id: 0, start_time: 0, end_time: 1 }],
        chord_templates: [{ frets: [-1, -1, -1, 14, 15, 14] }] };
    const hs = _stripHandshapeShapePure(high, 0.5, 6);
    const w2 = _stripFretWindowPure(hs.dots, 0, 12);
    assert.ok(w2.hi >= 16, 'a shape up the neck widens past the minimum span');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
