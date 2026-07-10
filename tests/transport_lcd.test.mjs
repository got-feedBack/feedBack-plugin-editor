/*
 * Tests for the transport bar's LCD math (src/transport-bar.js).
 *
 * The pillar under test: Position (bars:beats:ticks) and Time (m:ss.mmm) are
 * BOTH computed through the tempo map (`beatOf`/`timeOf`) — so the fixtures
 * are deliberately DRIFTING grids (tempo changes mid-song), where a naive
 * seconds×BPM conversion visibly diverges from the converter. Also pinned:
 * the BPM-semantics decision (editable in free mode, derived+badge with
 * audio), the editable-cell keystroke policy, and the customization prefs'
 * corruption tolerance.
 *
 * Run: node tests/transport_lcd.test.mjs
 */
import assert from 'node:assert';

// Minimal browser surface BEFORE the module graph loads (transport-bar pulls
// in src/audio.js, which needs these at wiring time, not import time — the
// stubs keep that true under node).
globalThis.document = globalThis.document || {
    getElementById: () => null, addEventListener: () => {}, activeElement: null,
};
globalThis.localStorage = globalThis.localStorage || { getItem: () => null, setItem: () => {} };
globalThis.window = globalThis.window || globalThis;

const {
    LCD_TICKS_PER_BEAT,
    _lcdBBTPure, _lcdClockPure, _lcdKeyActionPure, _lcdMeterPure,
    _lcdParseBBTPure, _lcdParseClockPure, _lcdTempoPure,
    _transportModePure, _transportPrefsPure,
} = await import('../src/transport-bar.js');
const { timeOf } = await import('../src/beats.js');

let pass = 0, fail = 0;
function t(name, fn) {
    try { fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}

// A drifting 4/4 grid: two bars at 120 BPM (0.5 s/beat), then two at 100 BPM
// (0.6 s/beat). Downbeats carry measure numbers; interior beats carry -1.
// Beat index IS the beat coordinate (src/beats.js contract).
function driftingGrid() {
    const beats = [];
    let time = 0;
    for (let i = 0; i < 16; i++) {
        beats.push({ time, measure: i % 4 === 0 ? i / 4 + 1 : -1, den: 4 });
        time += i < 8 ? 0.5 : 0.6;
    }
    return beats;
}

t('clock format: zero, sub-minute, minute+, clamp', () => {
    assert.strictEqual(_lcdClockPure(0), '0:00.000');
    assert.strictEqual(_lcdClockPure(83.5), '1:23.500');
    assert.strictEqual(_lcdClockPure(-3), '0:00.000');
    assert.strictEqual(_lcdClockPure(600.001), '10:00.001');
});

t('clock parse: formats, round-trip, garbage', () => {
    assert.strictEqual(_lcdParseClockPure('1:23.5'), 83.5);
    assert.strictEqual(_lcdParseClockPure('45'), 45);
    assert.strictEqual(_lcdParseClockPure('0:07'), 7);
    assert.strictEqual(_lcdParseClockPure(_lcdClockPure(83.5)), 83.5);
    assert.strictEqual(_lcdParseClockPure('1:75'), null, 'seconds ≥ 60 with a minutes field');
    assert.strictEqual(_lcdParseClockPure('nonsense'), null);
    assert.strictEqual(_lcdParseClockPure(''), null);
});

t('BBT reads through the DRIFTING grid, not a constant BPM', () => {
    const beats = driftingGrid();
    // Beat 10 (bar 3 beat 3) sits at 8·0.5 + 2·0.6 = 5.2 s. A constant-120
    // conversion would call 5.2 s beat 10.4 — the drift is the test.
    const r = _lcdBBTPure(beats, 5.2);
    assert.strictEqual(r.label, '3:3:000');
    // Half a beat later in SECONDS at the local 100 BPM tempo (0.3 s = 480 ticks).
    const r2 = _lcdBBTPure(beats, 5.5);
    assert.strictEqual(r2.label, '3:3:480');
});

t('BBT: tick rollover carries into the beat field', () => {
    const beats = driftingGrid();
    // 1e-5 s before beat 5 → fraction rounds to 960 ticks → 2:2:000, never 2:1:960.
    const r = _lcdBBTPure(beats, 2.5 - 1e-5);
    assert.strictEqual(r.label, '2:2:000');
    assert.ok(r.tick < LCD_TICKS_PER_BEAT);
});

t('BBT: degenerate grid (seconds-primary) → null', () => {
    assert.strictEqual(_lcdBBTPure([], 3), null);
    assert.strictEqual(_lcdBBTPure([{ time: 0, measure: 1, den: 4 }], 3), null);
    assert.strictEqual(_lcdBBTPure(null, 3), null);
});

t('BBT parse: inverse of format on the grid, bar looked up not computed', () => {
    const beats = driftingGrid();
    for (const beta of [0, 3, 6.25, 9, 14.5]) {
        const time = timeOf(beats, beta);
        const label = _lcdBBTPure(beats, time).label;
        const back = _lcdParseBBTPure(beats, label);
        assert.ok(Math.abs(back - time) < 1e-3, `${label}: ${back} vs ${time}`);
    }
    // Measure numbers need not start at 1 or be dense — lookup, not arithmetic.
    const offset = driftingGrid().map((b) => b.measure > 0 ? { ...b, measure: b.measure + 41 } : b);
    assert.ok(Math.abs(_lcdParseBBTPure(offset, '43:1:0') - 2) < 1e-9, 'bar 43 = old bar 2 downbeat');
});

t('BBT parse: refusals (missing bar, tick range, garbage)', () => {
    const beats = driftingGrid();
    assert.strictEqual(_lcdParseBBTPure(beats, '99:1:0'), null, 'bar not on the grid');
    assert.strictEqual(_lcdParseBBTPure(beats, '1:1:960'), null, 'tick past the beat');
    assert.strictEqual(_lcdParseBBTPure(beats, '1:0:0'), null, 'beats are 1-based');
    assert.strictEqual(_lcdParseBBTPure(beats, 'x:y'), null);
    assert.strictEqual(_lcdParseBBTPure([], '1:1:0'), null);
});

t('meter: reads the bar at the cursor, tracks a mid-song change', () => {
    // Two 4/4 bars then two 3/4 bars (downbeats every 3 beats), all 0.5 s/beat.
    const beats = [];
    let m = 0;
    for (let i = 0; i < 14; i++) {
        const isDown = i < 8 ? i % 4 === 0 : (i - 8) % 3 === 0;
        beats.push({ time: i * 0.5, measure: isDown ? ++m : -1, den: 4 });
    }
    assert.deepStrictEqual(_lcdMeterPure(beats, 0.6), { numerator: 4, denominator: 4 });
    assert.deepStrictEqual(_lcdMeterPure(beats, 4.6), { numerator: 3, denominator: 4 });
    // A /8 denominator normalizes through, junk collapses to 4.
    assert.strictEqual(_lcdMeterPure(beats.map((b) => ({ ...b, den: 8 })), 0.6).denominator, 8);
    assert.strictEqual(_lcdMeterPure(beats.map((b) => ({ ...b, den: 'x' })), 0.6).denominator, 4);
    assert.strictEqual(_lcdMeterPure([], 0), null);
});

t('tempo readout: local gap, both sides of the drift', () => {
    const beats = driftingGrid();
    assert.strictEqual(_lcdTempoPure(beats, 1.2), 120);
    assert.strictEqual(_lcdTempoPure(beats, 6.0), 100);
    assert.strictEqual(_lcdTempoPure([], 0), null);
});

t('BPM semantics: editable only in free mode; audio wears the badge', () => {
    const audio = _transportModePure(true);
    const free = _transportModePure(false);
    assert.strictEqual(audio.tempoEditable, false);
    assert.strictEqual(audio.short, 'AUDIO');
    assert.match(audio.title, /fitted to audio/);
    assert.strictEqual(free.tempoEditable, true);
    assert.strictEqual(free.short, 'FREE');
});

t('LCD keystrokes: Enter commits, Escape reverts, typing passes', () => {
    assert.strictEqual(_lcdKeyActionPure('Enter'), 'commit');
    assert.strictEqual(_lcdKeyActionPure('Escape'), 'revert');
    assert.strictEqual(_lcdKeyActionPure(' '), null, 'space is typing here, never play/pause');
    assert.strictEqual(_lcdKeyActionPure('a'), null);
});

t('prefs: defaults, corruption tolerance, boolean coercion', () => {
    const d = _transportPrefsPure(null);
    assert.strictEqual(d.primary, 'position');
    assert.ok(Object.values(d.cells).every((v) => v === true));
    assert.deepStrictEqual(d.groups, { util: true, modes: true });

    const p = _transportPrefsPure({
        primary: 'time',
        groups: { util: false, modes: 'yes', bogus: false },
        cells: { tempo: false, key: 1, alien: true },
    });
    assert.strictEqual(p.primary, 'time');
    assert.strictEqual(p.groups.util, false);
    assert.strictEqual(p.groups.modes, true, 'non-boolean dropped');
    assert.strictEqual(p.cells.tempo, false);
    assert.strictEqual(p.cells.key, true, 'non-boolean dropped');
    assert.strictEqual('alien' in p.cells, false);
    assert.strictEqual('bogus' in p.groups, false);
    assert.strictEqual(_transportPrefsPure('garbage').primary, 'position');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
