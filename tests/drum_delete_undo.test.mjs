/*
 * Drum-transcription delete is undoable (src/track-session.js
 * DeleteDrumTabCmd) and persists as an explicit removal
 * (src/file-ops.js _buildSaveBody ships a dirty null).
 *
 * Pinned here:
 *   - deleting the drum transcription is ONE EditHistory command — it no
 *     longer resets the whole undo stack (which lost not just the delete
 *     but every prior edit's undo);
 *   - rollback restores the SAME tab object (older drum commands hold
 *     references into its hits), the dirty flag, the drums mixer strip,
 *     the pairing entry, and the captured tree;
 *   - exec → rollback is a deep round-trip; redo re-deletes;
 *   - a dirty NULL drum_tab ships on the save wire (the backend only
 *     unlinks drum_tab.json on a literal null — omitting the field hit the
 *     absent→preserve path and deleted drums resurrected on reload);
 *   - a clean (undeleted, untouched) tab still ships nothing.
 *
 * Run: node tests/drum_delete_undo.test.mjs
 */
import assert from 'node:assert';

globalThis.localStorage = globalThis.localStorage || {
    getItem: () => null, setItem: () => {}, removeItem: () => {},
};
globalThis.document = globalThis.document || { getElementById: () => null };

const { DeleteDrumTabCmd } = await import('../src/track-session.js');
const { EditHistory } = await import('../src/history.js');
const { _buildSaveBody } = await import('../src/file-ops.js');
const { addDrumArrangement, syncDrumArrangement } = await import('../src/drum-arrangement.js');
const { S } = await import('../src/state.js');

let pass = 0, fail = 0;
function t(name, fn) {
    try { fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}

function seed() {
    const tab = { name: 'Drums', version: 1, hits: [{ t: 0.5, lane: 'kick' }, { t: 1.0, lane: 'snare' }] };
    Object.assign(S, {
        sessionId: 'sess-1', createMode: false, format: 'sloppak', sloppakForm: 'zip',
        filename: 'song.feedpak', title: 'T', artist: 'A',
        arrangements: [{
            name: 'Lead', tuning: [0, 0, 0, 0, 0, 0], capo: 0,
            notes: [], chords: [], chord_templates: [],
        }],
        currentArr: 0, beats: [], sections: [],
        drumTab: tab, drumTabDirty: false,
        // The drums arrangement materializes at idx 1 (Lead is 0), so its mix
        // strip is keyed 'arr:1' now — the retired 'drums' singleton (PR2b).
        partMix: { 'arr:1': { audible: false, vol: 0.5 }, 'arr:0': { audible: true, vol: 1 } },
        stemLinks: { drums: 'Drums_stem', lead: 'Guitar_L' },
        trackSession: null, trackHeights: {}, stems: [],
        sessionDirty: false,
        history: new EditHistory(),
        sel: new Set(),
    });
    syncDrumArrangement(S);   // materialize the type:"drums" arrangement (idx 1)
    return tab;
}

t('delete execs as one history command — the stack survives', () => {
    seed();
    S.history.exec(new DeleteDrumTabCmd('Drums'));
    assert.strictEqual(S.drumTab, null, 'tab cleared');
    assert.strictEqual(S.drumTabDirty, true, 'dirty → the removal ships on the next save');
    assert.strictEqual('arr:1' in S.partMix, false, 'mixer strip dropped');
    assert.strictEqual(S.stemLinks.drums, undefined, 'pairing retargeted away');
    assert.strictEqual(S.stemLinks.lead, 'Guitar_L', 'other pairings untouched');
    assert.strictEqual(S.history.undo.length, 1, 'the delete IS on the undo stack');
});

t('undo restores the very same tab object, flags, strip, and pairing', () => {
    const tab = seed();
    const linksBefore = S.stemLinks;
    S.history.exec(new DeleteDrumTabCmd('Drums'));
    S.history.doUndo();
    assert.strictEqual(S.drumTab, tab,
        'IDENTITY restore — older drum commands hold references into these hits');
    assert.strictEqual(S.drumTabDirty, false,
        'a disk-clean tab returns clean, so an unrelated save does not re-serialize it');
    assert.deepStrictEqual(S.partMix['arr:1'], { audible: false, vol: 0.5 }, 'mixer strip back');
    assert.strictEqual(S.stemLinks, linksBefore, 'pairing map reference restored');
    assert.strictEqual(S.history.redo.length, 1, 'redo holds the delete');
});

t('redo re-deletes; a second undo restores again (round-trip stability)', () => {
    const tab = seed();
    S.history.exec(new DeleteDrumTabCmd('Drums'));
    S.history.doUndo();
    S.history.doRedo();
    assert.strictEqual(S.drumTab, null);
    assert.strictEqual(S.drumTabDirty, true);
    assert.strictEqual('arr:1' in S.partMix, false);
    S.history.doUndo();
    assert.strictEqual(S.drumTab, tab);
    assert.strictEqual(S.drumTabDirty, false);
});

t('redo clears a drum selection made after undo', () => {
    seed();
    S.selectedTrackId = 'transcription:drums';
    S.history.exec(new DeleteDrumTabCmd('Drums'));
    assert.strictEqual(S.selectedTrackId, '', 'initial delete cannot leave a dangling selection');
    S.history.doUndo();
    assert.strictEqual(S.selectedTrackId, 'transcription:drums',
        'undo restores the selection captured with the deleted row');
    // This interaction happens outside history, after the row exists again.
    // Redo calls DeleteDrumTabCmd.exec directly, not deleteTrack's click handler.
    S.selectedTrackId = 'transcription:drums';
    S.history.doRedo();
    assert.strictEqual(S.selectedTrackId, '',
        'redo owns selection cleanup instead of leaving a missing row selected');
});

t('a dirty tab deleted and undone returns dirty (its edits still need saving)', () => {
    seed();
    S.drumTabDirty = true;   // the user edited hits earlier this session
    S.history.exec(new DeleteDrumTabCmd('Drums'));
    S.history.doUndo();
    assert.strictEqual(S.drumTabDirty, true);
});

t('prior commands stay undoable after the delete — the old reset lost them', () => {
    seed();
    let state = 'applied';
    // A stand-in for any earlier edit: exec/rollback just flip a flag.
    S.history.exec({ songScope: true, exec() { state = 'applied'; }, rollback() { state = 'rolled-back'; } });
    S.history.exec(new DeleteDrumTabCmd('Drums'));
    assert.strictEqual(S.history.undo.length, 2, 'both commands on the stack');
    S.history.doUndo();          // un-delete drums
    S.history.doUndo();          // then the earlier edit rolls back fine
    assert.strictEqual(state, 'rolled-back');
});

t('the save wire ships an explicit drum_tab null after a delete', () => {
    seed();
    S.history.exec(new DeleteDrumTabCmd('Drums'));
    const body = _buildSaveBody(false);
    assert.ok('drum_tab' in body, 'field present — absent means preserve-on-disk');
    assert.strictEqual(body.drum_tab, null, 'literal null is the removal wire');
    assert.deepStrictEqual(body.drum_parts, [], 'and the extras list ships empty beside it');
});

t('a clean, untouched tab still ships nothing (preserve path)', () => {
    seed();
    const body = _buildSaveBody(false);
    assert.strictEqual('drum_tab' in body, false);
    assert.strictEqual('drum_parts' in body, false, 'extras follow the same preserve path');
});

// ── multiple drum parts (N drums) ─────────────────────────────────────

// seed() + a second part "Drums (Live)" (id drums-2, arr idx 2), made ACTIVE.
function seedTwo() {
    const tab1 = seed();
    const tab2 = { name: 'Drums (Live)', version: 1, hits: [{ t: 2.0, lane: 'snare' }] };
    addDrumArrangement(S, tab2);
    S.drumTab = tab2;   // the user is editing the second part
    S.drumEditMode = true;
    S.partMix = { 'arr:0': { vol: 100 }, 'arr:1': { vol: 50 }, 'arr:2': { vol: 25 } };
    return { tab1, tab2 };
}

t('deleting the ACTIVE second part hands the grid to the primary; undo is an EXACT round-trip', () => {
    const { tab1, tab2 } = seedTwo();
    const beforeArrs = S.arrangements.slice();
    const beforePartMix = { ...S.partMix };
    S.history.exec(new DeleteDrumTabCmd('Drums (Live)', 2));
    assert.strictEqual(S.arrangements.length, 2, 'the part is gone');
    assert.strictEqual(S.drumTab, tab1, 'the grid hands over to the primary');
    assert.strictEqual(S.drumEditMode, true, 'drum mode stays on — a part remains');
    assert.deepStrictEqual(S.partMix, { 'arr:0': { vol: 100 }, 'arr:1': { vol: 50 } },
        'the deleted strip is dropped; the survivors keep their state');
    S.history.doUndo();
    assert.strictEqual(S.arrangements.length, beforeArrs.length);
    beforeArrs.forEach((a, i) => assert.strictEqual(S.arrangements[i], a,
        `arrangement ${i} restored by IDENTITY (drum commands hold refs into its hits)`));
    assert.strictEqual(S.drumTab, tab2, 'the active part is back in the grid');
    assert.deepStrictEqual(S.partMix, beforePartMix, 'partMix exact round-trip');
    S.history.doRedo();
    assert.strictEqual(S.arrangements.length, 2, 'redo re-deletes');
    assert.strictEqual(S.drumTab, tab1);
});

t('deleting the PRIMARY promotes the second part — the save wire follows', () => {
    const { tab2 } = seedTwo();
    S.drumTab = S.arrangements[1].drumTab;   // editing the primary this time
    S.history.exec(new DeleteDrumTabCmd('Drums', 1));
    assert.strictEqual(S.arrangements.length, 2, 'Lead + the surviving part');
    assert.strictEqual(S.drumTab, tab2, 'the survivor takes the grid');
    const body = _buildSaveBody(false);
    assert.deepStrictEqual(body.drum_tab, tab2,
        'the promoted part ships as the song-level primary');
    assert.deepStrictEqual(body.drum_parts, [], 'no extras remain');
});

t('deleting the LAST part exits drum-edit mode', () => {
    seed();
    S.drumEditMode = true;
    S.history.exec(new DeleteDrumTabCmd('Drums', 1));
    assert.strictEqual(S.drumTab, null);
    assert.strictEqual(S.drumEditMode, false, 'nothing left for the grid to edit');
    S.history.doUndo();
    assert.strictEqual(S.drumEditMode, true, 'mode restored with the part');
});

t('save wire: the PRIMARY ships as drum_tab even while a SECONDARY is active in the grid', () => {
    const { tab1, tab2 } = seedTwo();   // active = tab2 (the secondary)
    S.drumTabDirty = true;
    const body = _buildSaveBody(false);
    assert.deepStrictEqual(body.drum_tab, tab1,
        'primary = the FIRST drums arrangement, NOT S.drumTab (the active grid tab)');
    assert.strictEqual(body.drum_parts.length, 1);
    assert.strictEqual(body.drum_parts[0].id, 'drums-2', 'durable id rides the wire');
    assert.strictEqual(body.drum_parts[0].name, 'Drums (Live)');
    assert.deepStrictEqual(body.drum_parts[0].drum_tab, tab2, 'the extra part’s own tab');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
