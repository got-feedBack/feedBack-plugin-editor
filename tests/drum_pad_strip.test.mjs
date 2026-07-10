/*
 * Tests for the drum-pad companion strip (src/drum-pad-strip.js).
 *
 * Pinned: the GM percussion map's canonical assignments only ever land on
 * real chart pieces, the pad model covers the kit exactly once in family
 * groups, note-on parsing rejects everything that isn't a sounding hit,
 * selection lighting, and the pad-click add path round-trips through the
 * real EditHistory with the same hit shape as the lane grid.
 *
 * Run: node tests/drum_pad_strip.test.mjs
 */
import assert from 'node:assert';

globalThis.document = globalThis.document || {
    getElementById: () => null, addEventListener: () => {}, activeElement: null,
};
globalThis.localStorage = globalThis.localStorage || { getItem: () => null, setItem: () => {} };
globalThis.window = globalThis.window || globalThis;

const {
    GM_DRUM_MAP, KIT_GRAPHIC, PAD_GRID_ROWS, _drumViewPure,
    _padLitPiecesPure, _padModelPure, _padNoteOnPure,
} = await import('../src/drum-pad-strip.js');
const { AddDrumHitCmd, DRUM_COMPACT_LANES, DRUM_PIECE_ORDER } = await import('../src/drum.js');
const { EditHistory } = await import('../src/history.js');
const { S } = await import('../src/state.js');

let pass = 0, fail = 0;
function t(name, fn) {
    try { fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}

t('GM map: canonical assignments, every target is a real chart piece', () => {
    assert.strictEqual(GM_DRUM_MAP[36], 'kick');
    assert.strictEqual(GM_DRUM_MAP[38], 'snare');
    assert.strictEqual(GM_DRUM_MAP[37], 'snare_xstick');
    assert.strictEqual(GM_DRUM_MAP[42], 'hh_closed');
    assert.strictEqual(GM_DRUM_MAP[46], 'hh_open');
    assert.strictEqual(GM_DRUM_MAP[44], 'hh_pedal');
    assert.strictEqual(GM_DRUM_MAP[49], 'crash_l');
    assert.strictEqual(GM_DRUM_MAP[57], 'crash_r');
    assert.strictEqual(GM_DRUM_MAP[51], 'ride');
    const pieces = new Set(DRUM_PIECE_ORDER);
    for (const [note, piece] of Object.entries(GM_DRUM_MAP)) {
        assert.ok(pieces.has(piece), `GM ${note} → ${piece} is not a chart piece`);
    }
    assert.strictEqual(GM_DRUM_MAP[39], undefined, 'hand clap has no chart piece — unmapped, never wrong');
});

t('kit graphic: every chart piece exactly once, zones on real parents', () => {
    const laid = KIT_GRAPHIC.map((s) => s.piece);
    assert.strictEqual(laid.length, new Set(laid).size, 'no piece drawn twice');
    assert.deepStrictEqual([...laid].sort(), [...DRUM_PIECE_ORDER].sort(),
        'the graphic and the chart piece set are the same kit');
    // Zones (ride bell, the hat pair) reference an instrument that exists.
    const ids = new Set([...laid, 'hihat']);
    for (const s of KIT_GRAPHIC) {
        if (s.zoneOf) assert.ok(ids.has(s.zoneOf), `${s.piece} zones a ghost: ${s.zoneOf}`);
    }
});

t('pad grid: every chart piece exactly once across the banks', () => {
    const laid = PAD_GRID_ROWS.flat();
    assert.strictEqual(laid.length, new Set(laid).size);
    assert.deepStrictEqual([...laid].sort(), [...DRUM_PIECE_ORDER].sort());
});

t('view pref: pads or kit, corruption collapses to kit', () => {
    assert.strictEqual(_drumViewPure('pads'), 'pads');
    assert.strictEqual(_drumViewPure('kit'), 'kit');
    assert.strictEqual(_drumViewPure('mpc-3000'), 'kit');
    assert.strictEqual(_drumViewPure(null), 'kit');
});

t('pad model: the whole kit exactly once, grouped by family', () => {
    const model = _padModelPure(DRUM_PIECE_ORDER, DRUM_COMPACT_LANES, GM_DRUM_MAP);
    assert.deepStrictEqual(model.map((p) => p.piece), [...DRUM_PIECE_ORDER]);
    const kick = model.find((p) => p.piece === 'kick');
    assert.strictEqual(kick.family, 'Kick');
    assert.deepStrictEqual(kick.gmNotes, [35, 36], 'tooltip documents the GM mapping');
    const stack = model.find((p) => p.piece === 'stack');
    assert.deepStrictEqual(stack.gmNotes, [], 'no GM note — pad still exists for click input');
});

t('note-on parse: sounding hits only', () => {
    assert.deepStrictEqual(_padNoteOnPure([0x90, 38, 96]), { note: 38, velocity: 96 });
    assert.deepStrictEqual(_padNoteOnPure([0x99, 36, 127]), { note: 36, velocity: 127 }, 'channel 10 (GM drums) is still a note-on');
    assert.strictEqual(_padNoteOnPure([0x90, 38, 0]), null, 'velocity-0 note-on is an off');
    assert.strictEqual(_padNoteOnPure([0x80, 38, 64]), null, 'note-off');
    assert.strictEqual(_padNoteOnPure([0xB0, 64, 127]), null, 'CC');
    assert.strictEqual(_padNoteOnPure([0x90, 38]), null, 'short packet');
    assert.strictEqual(_padNoteOnPure(null), null);
});

t('selection lighting: distinct pieces of the selected hits', () => {
    const hits = [
        { t: 0, p: 'kick', v: 100 }, { t: 0.5, p: 'snare', v: 100 },
        { t: 1, p: 'kick', v: 100 }, { t: 1.5, p: 'hh_closed', v: 80 },
    ];
    assert.deepStrictEqual([..._padLitPiecesPure(hits, new Set([0, 2]))], ['kick']);
    assert.deepStrictEqual([..._padLitPiecesPure(hits, new Set([1, 3]))].sort(), ['hh_closed', 'snare']);
    assert.deepStrictEqual([..._padLitPiecesPure(hits, new Set())], []);
    assert.deepStrictEqual([..._padLitPiecesPure(null, new Set([0]))], []);
});

t('pad-click add: AddDrumHitCmd round-trip, same hit shape as the grid', () => {
    S.drumTab = { version: 1, name: 'Kit', kit: {}, hits: [{ t: 2, p: 'snare', v: 100 }] };
    S.drumTabDirty = false;
    S.drumSel = new Set();
    S.drumEditMode = true;
    S.history = new EditHistory();
    const hit = { t: 1.5, p: 'kick', v: 100 };
    S.history.exec(new AddDrumHitCmd(hit));
    assert.strictEqual(S.drumTab.hits.length, 2);
    assert.deepStrictEqual(S.drumTab.hits[0], hit, 'hits stay time-sorted after the add');
    assert.strictEqual(S.drumTabDirty, true);
    S.history.doUndo();
    assert.strictEqual(S.drumTab.hits.length, 1);
    assert.strictEqual(S.drumTab.hits.indexOf(hit), -1);
    S.history.doRedo();
    assert.strictEqual(S.drumTab.hits.length, 2);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
