'use strict';
/*
 * Tests for the drum row-density preset (@pure:drum-density block +
 * the rewired lane geometry): Full = one row per piece (today's grid,
 * unchanged), Compact = the community 7-row family shape (crash / hi-hat /
 * ride / toms / floor toms / snare / kick — mirrors core lib/drums.py
 * PRESET_RB4 family boundaries). RENDER/SELECTION grouping only: hits
 * keep their real piece-ids (EDITOR-VIEW-MODALITY-DESIGN V6 — never a
 * second data path). These fail on main, where the lane table doesn't
 * exist.
 *
 * Run: node tests/drum_density.test.js
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');

function extractBlock(name) {
    const re = new RegExp(
        '/\\* @pure:' + name + ':start \\*/[\\s\\S]*?/\\* @pure:' + name + ':end \\*/');
    const m = src.match(re);
    if (!m) {
        console.error(`FAIL: @pure:${name} block not found in src/main.js`);
        process.exit(1);
    }
    return m[0];
}
const orderM = src.match(/const DRUM_PIECE_ORDER = \[[\s\S]*?\];/);
assert.ok(orderM, 'DRUM_PIECE_ORDER must exist');

const env = new Function(
    '"use strict";' + orderM[0] + '\n' + extractBlock('drum-density')
    + '\nreturn { DRUM_PIECE_ORDER, DRUM_COMPACT_LANES, _drumLaneTablePure, _drumLaneIdxForPiecePure };'
)();
const { DRUM_PIECE_ORDER, DRUM_COMPACT_LANES, _drumLaneTablePure, _drumLaneIdxForPiecePure } = env;

let pass = 0, fail = 0;
function t(name, fn) {
    try { fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}

t('full density: one row per piece, in the physical-kit order, self-canonical', () => {
    const table = _drumLaneTablePure('full', DRUM_PIECE_ORDER, DRUM_COMPACT_LANES);
    assert.strictEqual(table.length, DRUM_PIECE_ORDER.length);
    table.forEach((lane, i) => {
        assert.deepStrictEqual(lane.pieces, [DRUM_PIECE_ORDER[i]]);
        assert.strictEqual(lane.canonical, DRUM_PIECE_ORDER[i]);
        assert.strictEqual(lane.label, null, 'full rows use per-piece meta labels');
    });
});

t('compact density: 7 family rows covering EVERY piece exactly once', () => {
    const table = _drumLaneTablePure('compact', DRUM_PIECE_ORDER, DRUM_COMPACT_LANES);
    assert.strictEqual(table.length, 7, 'the community 7-row shape');
    const seen = new Set();
    for (const lane of table) {
        for (const p of lane.pieces) {
            assert.ok(!seen.has(p), `piece ${p} must live on exactly one row`);
            seen.add(p);
        }
        assert.ok(lane.pieces.includes(lane.canonical),
            `canonical ${lane.canonical} must be a member of its own row`);
        assert.ok(lane.label, 'compact rows carry a family label');
    }
    assert.strictEqual(seen.size, DRUM_PIECE_ORDER.length,
        'no piece falls off the grid in compact — collapsing must never hide data');
    for (const p of DRUM_PIECE_ORDER) assert.ok(seen.has(p), `missing ${p}`);
});

t('compact canonicals are the family bread-and-butter voices', () => {
    const byLabel = Object.fromEntries(DRUM_COMPACT_LANES.map(l => [l.label, l.canonical]));
    assert.strictEqual(byLabel['Crash'], 'crash_l');
    assert.strictEqual(byLabel['Hi-hat'], 'hh_closed');
    assert.strictEqual(byLabel['Ride'], 'ride');
    assert.strictEqual(byLabel['Snare'], 'snare');
    assert.strictEqual(byLabel['Kick'], 'kick');
});

t('unknown density falls back to full (a corrupt pref never blanks the grid)', () => {
    const table = _drumLaneTablePure('banana', DRUM_PIECE_ORDER, DRUM_COMPACT_LANES);
    assert.strictEqual(table.length, DRUM_PIECE_ORDER.length);
});

t('row lookup: members share a row in compact, unknown pieces stay -1', () => {
    const compact = _drumLaneTablePure('compact', DRUM_PIECE_ORDER, DRUM_COMPACT_LANES);
    const full = _drumLaneTablePure('full', DRUM_PIECE_ORDER, DRUM_COMPACT_LANES);
    assert.strictEqual(
        _drumLaneIdxForPiecePure('hh_open', compact),
        _drumLaneIdxForPiecePure('hh_pedal', compact),
        'hi-hat family shares one row');
    assert.notStrictEqual(
        _drumLaneIdxForPiecePure('hh_open', full),
        _drumLaneIdxForPiecePure('hh_pedal', full),
        'full keeps them apart');
    assert.strictEqual(_drumLaneIdxForPiecePure('cowbell_of_doom', compact), -1);
    assert.strictEqual(_drumLaneIdxForPiecePure('cowbell_of_doom', full), -1);
});

t('the tables are pure projections — building them never mutates inputs', () => {
    const orderBefore = DRUM_PIECE_ORDER.slice();
    const compactBefore = JSON.parse(JSON.stringify(DRUM_COMPACT_LANES));
    const table = _drumLaneTablePure('compact', DRUM_PIECE_ORDER, DRUM_COMPACT_LANES);
    table[0].pieces.push('injected');
    table[0].canonical = 'injected';
    assert.deepStrictEqual(DRUM_PIECE_ORDER, orderBefore);
    assert.deepStrictEqual(
        JSON.parse(JSON.stringify(DRUM_COMPACT_LANES)), compactBefore,
        'mutating a returned table must not leak into the source config');
});

// ── Drag lane-move semantics through the real handler math ───────────
// The same-row rule: a time-only drag in Compact must keep the hit's
// ORIGINAL piece (hh_open never silently becomes hh_closed); crossing
// rows assigns the target row's canonical.

t('same-row drag keeps the original piece; cross-row assigns the canonical', () => {
    const compact = _drumLaneTablePure('compact', DRUM_PIECE_ORDER, DRUM_COMPACT_LANES);
    // Simulate the drag-move remap logic for one hit.
    const remap = (origPiece, dLanes) => {
        const origLaneIdx = _drumLaneIdxForPiecePure(origPiece, compact);
        if (origLaneIdx < 0) return origPiece;
        const newLaneIdx = Math.max(0, Math.min(compact.length - 1, origLaneIdx + dLanes));
        return newLaneIdx === origLaneIdx ? origPiece : compact[newLaneIdx].canonical;
    };
    assert.strictEqual(remap('hh_open', 0), 'hh_open', 'time-only drag preserves the member');
    assert.strictEqual(remap('hh_open', 1), 'ride', 'down one row → that family’s canonical');
    assert.strictEqual(remap('china', 0), 'china', 'crash member survives a same-row drag');
    assert.strictEqual(remap('kick', 5), 'kick', 'clamped at the last row (kick stays kick)');
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
