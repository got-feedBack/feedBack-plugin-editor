/*
 * The GM drum KIT (drums stop being a click): every chart drum piece voices
 * a real FluidR3 percussion one-shot, in band mode and in the drum grid.
 *
 * Pinned here:
 *   - the webaudiofontdata percussion NAMING (file `128<note>_0_…`, global
 *     `_drum_<note>_0_…` — the '128' prefix drops from the variable name);
 *   - DRUM_PIECE_GM_NOTE covers EVERY piece the drum editor can chart, and
 *     round-trips with the pad strip's GM_DRUM_MAP (documented exceptions:
 *     'stack' borrows the china — no GM home);
 *   - every voiced note's one-shot is genuinely VENDORED (plugin-served).
 *
 * Fails on main (the percussion surface doesn't exist there).
 * Run: node tests/drum_kit.test.mjs
 */
import assert from 'node:assert';
import { existsSync, statSync } from 'node:fs';

globalThis.document = globalThis.document || {
    getElementById: () => null, addEventListener: () => {}, activeElement: null,
};
globalThis.localStorage = globalThis.localStorage || { getItem: () => null, setItem: () => {} };
globalThis.window = globalThis.window || globalThis;

const { DRUM_PIECE_GM_NOTE, _gmDrumFilePure, _gmDrumVarPure } = await import('../src/gm-guide.js');
const { GM_DRUM_MAP } = await import('../src/drum-pad-strip.js');
const { DRUM_COMPACT_LANES } = await import('../src/drum.js');

let pass = 0, fail = 0;
function t(name, fn) {
    try { fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}

t("percussion naming: '128' stays in the FILE, drops from the VARIABLE", () => {
    assert.strictEqual(_gmDrumFilePure(36), '12836_0_FluidR3_GM_sf2_file.js');
    assert.strictEqual(_gmDrumVarPure(36), '_drum_36_0_FluidR3_GM_sf2_file');
    assert.strictEqual(_gmDrumFilePure(34), null, 'below the GM percussion range');
    assert.strictEqual(_gmDrumFilePure(82), null, 'above it');
    assert.strictEqual(_gmDrumFilePure('x'), null);
});

t('every chartable piece has a voice; the table round-trips with the pad map', () => {
    const allPieces = DRUM_COMPACT_LANES.flatMap(l => l.pieces);
    for (const piece of allPieces) {
        assert.ok(Number.isInteger(DRUM_PIECE_GM_NOTE[piece]), `${piece} voices a GM note`);
    }
    // Round-trip: the note we voice a piece with maps BACK to that piece on
    // the pad strip — except the documented borrow ('stack' → china's 52).
    for (const [piece, note] of Object.entries(DRUM_PIECE_GM_NOTE)) {
        const back = GM_DRUM_MAP[note];
        if (piece === 'stack') { assert.strictEqual(back, 'china', 'stack borrows the china'); continue; }
        assert.strictEqual(back, piece, `${piece} ↔ ${note}`);
    }
});

t('every voiced one-shot is vendored — the kit needs zero network', () => {
    const wafonts = new URL('../assets/wafonts/', import.meta.url);
    const notes = [...new Set(Object.values(DRUM_PIECE_GM_NOTE))];
    assert.ok(notes.length >= 15, 'a real kit, not a stub');
    for (const note of notes) {
        const f = _gmDrumFilePure(note);
        const p = new URL(f, wafonts);
        assert.ok(existsSync(p), `${f} is vendored`);
        assert.ok(statSync(p).size > 5_000, `${f} is a real one-shot`);
    }
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
