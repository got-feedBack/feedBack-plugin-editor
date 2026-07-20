/*
 * Regression: deleting the drum transcription when it is NOT the last
 * arrangement (a pitched arrangement sits after it).
 *
 * The drums channel is `arr:<drumIdx>` (PR2b). Splicing drums out shifts every
 * higher pitched arrangement down one slot, so its `arr:<idx>` mix key must
 * shift down too — exactly what the pitched-delete path does via
 * _partMixDropArrangementPure. A bare `delete S.partMix['arr:<drumIdx>']`
 * stranded the pitched strips after drums (lost mute/solo/vol; a stranded solo
 * silenced the whole band) and undo then OVERWROTE the stranded strip.
 *
 * Roster: Lead(arr:0) + Drums(arr:1) + Bass(arr:2).
 *
 * Run: node tests/drum_delete_undo_middle.test.mjs
 */
import assert from 'node:assert';

globalThis.localStorage = globalThis.localStorage || {
    getItem: () => null, setItem: () => {}, removeItem: () => {},
};
globalThis.document = globalThis.document || { getElementById: () => null };

const { DeleteDrumTabCmd } = await import('../src/track-session.js');
const { EditHistory } = await import('../src/history.js');
const { syncDrumArrangement, isDrumArrangement } = await import('../src/drum-arrangement.js');
const { _mixerAnySoloPure } = await import('../src/mixer-panel.js');
const { S } = await import('../src/state.js');

let pass = 0, fail = 0;
function t(name, fn) {
    try { fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}

function seed() {
    const pitched = () => ({ tuning: [0, 0, 0, 0, 0, 0], capo: 0, notes: [], chords: [], chord_templates: [] });
    const tab = { name: 'Drums', version: 1, hits: [{ t: 0.5, lane: 'kick' }] };
    Object.assign(S, {
        sessionId: 'sess-1', createMode: false, format: 'sloppak', sloppakForm: 'zip',
        filename: 'song.feedpak', title: 'T', artist: 'A',
        // Lead at 0; syncDrumArrangement appends drums at 1; Bass added at 2 AFTER.
        arrangements: [{ name: 'Lead', ...pitched() }],
        currentArr: 0, beats: [], sections: [],
        drumTab: tab, drumTabDirty: false,
        partMix: {
            'arr:0': { audible: true, vol: 1 },              // Lead
            'arr:1': { audible: false, vol: 0.5 },           // Drums (mute-ish)
        },
        stemLinks: {}, trackSession: null, trackHeights: {}, stems: [],
        sessionDirty: false, history: new EditHistory(), sel: new Set(),
    });
    syncDrumArrangement(S);                                    // drums → arr:1
    // Now add a pitched arrangement AFTER drums so drums is in the middle.
    S.arrangements.push({ name: 'Bass', ...pitched() });       // Bass → arr:2
    S.partMix['arr:2'] = { audible: true, vol: 0.8, solo: true };
    return tab;
}

t('delete drums-in-the-middle renumbers higher pitched strips down', () => {
    seed();
    S.history.exec(new DeleteDrumTabCmd('Drums'));
    // Bass's arrangement is now index 1; its strip must follow to arr:1.
    assert.deepStrictEqual(S.partMix['arr:1'], { audible: true, vol: 0.8, solo: true },
        'Bass strip renumbered arr:2 → arr:1');
    assert.strictEqual('arr:2' in S.partMix, false, 'no stray arr:2 left behind');
    assert.strictEqual(_mixerAnySoloPure(S.partMix), true,
        'the surviving solo stays on a LIVE strip — band not silenced');
});

t('undo restores every strip AND the original arrangement order', () => {
    seed();
    S.history.exec(new DeleteDrumTabCmd('Drums'));
    S.history.doUndo();
    // True inverse: drums returns to its ORIGINAL middle slot (arr:1) and Bass
    // back at arr:2 — NOT re-appended last, so index-based undo/mix keys stay valid.
    assert.deepStrictEqual(S.partMix['arr:0'], { audible: true, vol: 1 }, 'Lead intact');
    assert.deepStrictEqual(S.partMix['arr:1'], { audible: false, vol: 0.5 },
        'drums strip restored at its original middle slot');
    assert.deepStrictEqual(S.partMix['arr:2'], { audible: true, vol: 0.8, solo: true },
        'Bass strip (solo+vol) restored at its original slot');
    assert.strictEqual(isDrumArrangement(S.arrangements[1]), true, 'drums back in the middle');
    assert.strictEqual(S.arrangements[2].name, 'Bass', 'Bass back last — order preserved');
});

t('an index-based undo command survives a drums-in-the-middle delete', () => {
    seed();
    S.currentArr = 2;                       // Bass selected (sits AFTER drums)
    const bass = S.arrangements[2];
    // Stand-in for MoveNoteCmd et al: they target S.arrangements[arrIdx] by index.
    let touched = null;
    S.history.exec({
        arrIdx: 2,
        exec() { touched = S.arrangements[this.arrIdx]; },
        rollback() { touched = S.arrangements[this.arrIdx]; },
    });
    S.history.exec(new DeleteDrumTabCmd('Drums'));   // drums-in-the-middle removed
    S.history.doUndo();                              // un-delete drums
    S.history.doUndo();                              // the note command rolls back
    assert.strictEqual(touched, bass,
        'index-based command still targets Bass, not the re-appended drums arrangement');
    assert.strictEqual(isDrumArrangement(touched), false, 'never lands on drums');
});

t('currentArr follows the selected pitched arrangement across delete + undo', () => {
    seed();
    S.currentArr = 2;                 // Bass selected — sits AFTER drums (arr:1)
    S.history.exec(new DeleteDrumTabCmd('Drums'));
    // Drums spliced out shifts Bass 2→1; currentArr must follow, not dangle
    // out of bounds (arrangements.length is now 2).
    assert.ok(S.arrangements[S.currentArr] && !isDrumArrangement(S.arrangements[S.currentArr]),
        'currentArr points at a live pitched arrangement, not out of bounds');
    assert.strictEqual(S.arrangements[S.currentArr].name, 'Bass', 'still Bass selected after delete');
    S.history.doUndo();
    // True-inverse undo restores the original slot, so currentArr returns to 2.
    assert.strictEqual(S.currentArr, 2, 'currentArr restored to Bass original slot');
    assert.ok(!isDrumArrangement(S.arrangements[S.currentArr]),
        'currentArr is not the drums arrangement');
    assert.strictEqual(S.arrangements[S.currentArr].name, 'Bass', 'still Bass selected after undo');
});

t('a live mix edit made while drums is gone survives the undo', () => {
    seed();
    S.history.exec(new DeleteDrumTabCmd('Drums'));   // Bass now at arr:1
    // Mixer/fader edits mutate S.partMix in place, outside EditHistory.
    S.partMix['arr:1'] = { audible: true, vol: 0.3, solo: false };   // user re-faders Bass
    S.history.doUndo();
    // Bass returns to arr:2 carrying the LIVE edit, not the stale seeded value.
    assert.deepStrictEqual(S.partMix['arr:2'], { audible: true, vol: 0.3, solo: false },
        'the post-delete Bass fader edit rode the undo, not clobbered');
    assert.deepStrictEqual(S.partMix['arr:1'], { audible: false, vol: 0.5 }, 'drums strip back');
});

t('delete does not corrupt mix keys when the drums arrangement was never materialized', () => {
    const pitched = () => ({ tuning: [0, 0, 0, 0, 0, 0], capo: 0, notes: [], chords: [], chord_templates: [] });
    Object.assign(S, {
        sessionId: 'sess-1', createMode: false, format: 'sloppak', sloppakForm: 'zip',
        filename: 'song.feedpak', title: 'T', artist: 'A',
        arrangements: [{ name: 'Lead', ...pitched() }],   // NO drums arrangement materialized
        currentArr: 0, beats: [], sections: [],
        drumTab: { name: 'Drums', version: 1, hits: [{ t: 0.5, lane: 'kick' }] },   // but drumTab set
        drumTabDirty: false,
        partMix: { 'arr:0': { audible: true, vol: 1 } },
        stemLinks: {}, trackSession: null, trackHeights: {}, stems: [],
        sessionDirty: false, history: new EditHistory(), sel: new Set(),
    });
    // drumArrangementIndex is -1 here; a -1 drop would rewrite arr:0 → arr:-1.
    S.history.exec(new DeleteDrumTabCmd('Drums'));
    assert.deepStrictEqual(S.partMix['arr:0'], { audible: true, vol: 1 }, 'Lead strip untouched');
    assert.strictEqual('arr:-1' in S.partMix, false, 'no corrupt arr:-1 key');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
