/*
 * The feel-vs-tempo marker (P2-8): a half-/double-time section is a FEEL
 * change (a marker over a constant tempo), NEVER a 2x tempo change.
 *
 * Pinned here (the cross-pedagogy contract all four instrument seats named):
 *   - a feel mark moves NO beats (metadata command; exact undo);
 *   - the metronome accents the FELT pulse under half-time;
 *   - Map Health expects onsets on felt beats only — a genuinely sparser
 *     half-time section reads green, not "missing onsets" grey;
 *   - Scan's 2:1 resolution defaults to the FEEL marker (grid untouched),
 *     with the grid octave-rescue as the explicit override.
 *
 * Fails on main (the feel kind doesn't exist there).
 * Run: node tests/feel_marker.test.mjs
 */
import assert from 'node:assert';

globalThis.document = globalThis.document || {
    getElementById: () => null, addEventListener: () => {}, activeElement: null,
};
globalThis.localStorage = globalThis.localStorage || { getItem: () => null, setItem: () => {} };
globalThis.window = globalThis.window || globalThis;
globalThis.requestAnimationFrame = globalThis.requestAnimationFrame || ((fn) => fn());

const {
    _feelAtPure, _feelRangesPure, _markNormPure, editorSetFeelFromBar,
} = await import('../src/tempo-marks.js');
const { _mapHealthPure } = await import('../src/map-health.js');
const { S } = await import('../src/state.js');
const { EditHistory } = await import('../src/history.js');

let pass = 0, fail = 0;
function t(name, fn) {
    try { fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}

t('feel marks validate: ratio is the closed {0.5, 1, 2} vocabulary', () => {
    assert.ok(_markNormPure({ measure: 4, kind: 'feel', ratio: 0.5 }));
    assert.ok(_markNormPure({ measure: 4, kind: 'feel', ratio: 2 }));
    assert.ok(_markNormPure({ measure: 4, kind: 'feel', ratio: 1 }), 'ratio 1 = explicit straight');
    assert.strictEqual(_markNormPure({ measure: 4, kind: 'feel', ratio: 3 }), null);
    assert.strictEqual(_markNormPure({ measure: 4, kind: 'feel' }), null, 'ratio required');
});

t('the feel timeline steps like time signatures — each applies until the next', () => {
    const ranges = _feelRangesPure([
        { measure: 9, kind: 'feel', ratio: 1 },
        { measure: 5, kind: 'feel', ratio: 0.5 },
        { measure: 3, kind: 'hold', factor: 2 },      // not a feel mark
    ]);
    assert.deepStrictEqual(ranges, [
        { fromMeasure: 5, ratio: 0.5 }, { fromMeasure: 9, ratio: 1 },
    ]);
    assert.strictEqual(_feelAtPure(ranges, 4), 1, 'before the first mark = straight');
    assert.strictEqual(_feelAtPure(ranges, 5), 0.5);
    assert.strictEqual(_feelAtPure(ranges, 8), 0.5, 'carries forward');
    assert.strictEqual(_feelAtPure(ranges, 9), 1, 'the closing mark ends it');
});

t('a feel edit moves NO beats and round-trips exactly', () => {
    const beats = [];
    for (let m = 1; m <= 4; m++) for (let b = 0; b < 4; b++) {
        beats.push({ time: (m - 1) * 2 + b * 0.5, measure: b === 0 ? m : -1 });
    }
    Object.assign(S, { tempoMarks: [], history: new EditHistory(), beats });
    const beatsRef = S.beats;
    const timesBefore = JSON.stringify(S.beats.map(b => b.time));
    editorSetFeelFromBar(2, 0.5);
    assert.strictEqual(S.beats, beatsRef, 'the beats ARRAY is untouched (identity)');
    assert.strictEqual(JSON.stringify(S.beats.map(b => b.time)), timesBefore, 'no beat moved');
    assert.deepStrictEqual(S.tempoMarks, [{ measure: 2, kind: 'feel', ratio: 0.5, provenance: 'confirmed' }]);
    S.history.doUndo();
    assert.strictEqual(S.tempoMarks.length, 0);
    S.history.doRedo();
    assert.strictEqual(S.tempoMarks.length, 1);
    // Re-picking the same ratio TOGGLES the mark off (one command).
    editorSetFeelFromBar(2, 0.5);
    assert.strictEqual(S.tempoMarks.length, 0);
});

t('metronome: half-time feel accents every OTHER beat (the felt pulse)', async () => {
    const fs = await import('node:fs');
    const src = fs.readFileSync(new URL('../src/audio.js', import.meta.url), 'utf8')
        .replace(/\r\n/g, '\n');
    const at = src.indexOf('function _metroClicksInWindowPure');
    const body = src.slice(at, src.indexOf('\n}', at) + 2);
    const fn = new Function(`return (${body.replace('function _metroClicksInWindowPure', 'function')})`)();
    const beats = [];
    for (let b = 0; b < 8; b++) beats.push({ time: b * 0.5, measure: b % 4 === 0 ? 1 + b / 4 : -1 });
    const feel = [{ fromMeasure: 1, ratio: 0.5 }];
    const clicks = fn(beats, 0, 4, null, feel);
    assert.deepStrictEqual(clicks.map(c => c.accent),
        [true, false, true, false, true, false, true, false], 'felt pulse = every other beat');
    const straight = fn(beats, 0, 4, null, null);
    assert.deepStrictEqual(straight.map(c => c.accent),
        [true, false, false, false, true, false, false, false], 'no feel = downbeats only');
});

t('Map Health: a half-time section reads GREEN coverage of its felt pulse, not grey', () => {
    // Two 4/4 bars at 120 (0.5 s beats); the band plays HALF-TIME: onsets
    // land dead-on every OTHER beat only.
    const beats = [];
    for (let b = 0; b < 8; b++) beats.push({ time: b * 0.5, measure: b % 4 === 0 ? 1 + b / 4 : -1 });
    beats.push({ time: 4.0, measure: 3 });
    const onsets = [];
    for (let b = 0; b < 9; b += 2) onsets.push({ t: b * 0.5 });
    const strict = { minCoverage: 0.6 };   // a charter who wants real evidence
    const without = _mapHealthPure(beats, onsets, strict);
    assert.strictEqual(without.measures[0].band, 'grey',
        'without the feel mark, half the expected beats are "missing" — grey');
    const withFeel = _mapHealthPure(beats, onsets,
        { ...strict, feelRanges: [{ fromMeasure: 1, ratio: 0.5 }] });
    assert.strictEqual(withFeel.measures[0].coverage, 1, 'every FELT beat is evidenced');
    assert.strictEqual(withFeel.measures[0].band, 'green');
});

t("Scan's 2:1 resolution: the FEEL verb marks bar 1 and leaves the grid alone", async () => {
    const { editorZonesFeelFix } = await import('../src/tempo.js');
    const beats = [];
    for (let m = 1; m <= 3; m++) for (let b = 0; b < 4; b++) {
        beats.push({ time: (m - 1) * 2 + b * 0.5, measure: b === 0 ? m : -1 });
    }
    Object.assign(S, {
        tempoMarks: [], history: new EditHistory(), beats,
        sessionId: 'test', cursorTime: 0,
    });
    const timesBefore = JSON.stringify(S.beats.map(b => b.time));
    editorZonesFeelFix('half');
    assert.deepStrictEqual(S.tempoMarks,
        [{ measure: 1, kind: 'feel', ratio: 0.5, provenance: 'confirmed' }],
        'the default resolution is a feel mark, not a tempo halving');
    assert.strictEqual(JSON.stringify(S.beats.map(b => b.time)), timesBefore,
        'the grid is untouched — "actually a tempo change" is the separate override');
    S.history.doUndo();
    assert.strictEqual(S.tempoMarks.length, 0, 'one undo restores');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
