/*
 * Drums as a first-class arrangement — the drums-as-arrangements foundation
 * (src/drum-arrangement.js + the migration/save/target wiring it drives).
 *
 * The single drum tab (S.drumTab) now lives IN S.arrangements[] as a derived
 * `type:"drums"` arrangement whose `.drumTab` payload IS S.drumTab (same object
 * reference). Pinned here — the STATEFUL wiring, not just the pure predicate:
 *   - syncDrumArrangement materializes / updates / removes that arrangement and
 *     keeps the SAME payload reference (so drum-editor undo refs never dangle);
 *   - it APPENDS (never inserts), so existing arr indices / arr:<idx> keys hold;
 *   - identity is TYPE-only: a pitched arrangement a user named "Drums" is NOT a
 *     drums arrangement, so it is never hidden, filtered, or dropped from a save;
 *   - the save body EXCLUDES the drums arrangement (drums persist as the song-
 *     level drum_tab), so the built pack stays byte-identical;
 *   - the tracks target list and the band roster still address drums through the
 *     legacy 'drums' key — the drums arrangement does NOT get a duplicate row.
 *
 * These fail on main, where drums never enter S.arrangements[].
 *
 * Run: node tests/drum_arrangement.test.mjs
 */
import assert from 'node:assert';

import {
    DRUMS_ARR_TYPE, isDrumArrangement, findDrumArrangement, syncDrumArrangement,
    pitchedArrangementCount, clampAwayFromDrums, pitchedIndexOf,
    drumArrangementIndex, switcherShownIndex,
} from '../src/drum-arrangement.js';
import { _trackSessionTargetsPure } from '../src/track-session.js';

let pass = 0, fail = 0;
function t(name, fn) {
    try { fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}

const tab = (over = {}) => ({ version: 1, name: 'Drums', kit: [], hits: [{ t: 0, p: 'kick' }], ...over });
const gtr = (name = 'Lead') => ({ id: name.toLowerCase(), name, notes: [], chords: [] });

// ── identity is TYPE-only (the safety fix) ────────────────────────────
t('isDrumArrangement keys on the authored type, normalized — never the name', () => {
    assert.strictEqual(isDrumArrangement({ type: 'drums' }), true);
    assert.strictEqual(isDrumArrangement({ type: 'Drums' }), true, 'case-insensitive');
    assert.strictEqual(isDrumArrangement({ type: 'drum' }), true, 'singular synonym');
    // The load-bearing safety case: a pitched part a user NAMED "Drums" (no
    // authored type) is NOT a drums arrangement — else it would be hidden from
    // the switcher/tracks and dropped from the save.
    assert.strictEqual(isDrumArrangement({ name: 'Drums' }), false);
    assert.strictEqual(isDrumArrangement({ name: 'Drum & Bass Lead' }), false);
    assert.strictEqual(isDrumArrangement({ name: 'Lead', type: 'guitar' }), false);
    assert.strictEqual(isDrumArrangement(null), false);
});

t('findDrumArrangement returns the drums entry or null', () => {
    const arrs = [gtr('Lead'), { id: 'drums', name: 'Drums', type: DRUMS_ARR_TYPE, drumTab: tab() }];
    assert.strictEqual(findDrumArrangement(arrs), arrs[1]);
    assert.strictEqual(findDrumArrangement([gtr('Lead'), gtr('Bass')]), null);
    assert.strictEqual(findDrumArrangement(null), null);
});

// ── syncDrumArrangement — the state machine ───────────────────────────
t('materialize: a drum tab becomes a type:"drums" arrangement holding the SAME payload, appended last', () => {
    const payload = tab();
    const S = { arrangements: [gtr('Lead'), gtr('Bass')], drumTab: payload };
    const arr = syncDrumArrangement(S);
    assert.strictEqual(S.arrangements.length, 3, 'appended, not replaced');
    assert.strictEqual(S.arrangements[2], arr, 'appended at the END (indices 0/1 unchanged)');
    assert.strictEqual(arr.type, DRUMS_ARR_TYPE);
    assert.strictEqual(arr.drumTab, payload, 'payload is the SAME object as S.drumTab (live editing surface)');
    assert.strictEqual(arr.name, 'Drums');
    assert.strictEqual(S.arrangements[0].name, 'Lead', 'other parts untouched');
    assert.strictEqual(S.arrangements[1].name, 'Bass');
});

t('idempotent: syncing again does not add a second drums arrangement', () => {
    const S = { arrangements: [gtr('Lead')], drumTab: tab() };
    syncDrumArrangement(S);
    syncDrumArrangement(S);
    syncDrumArrangement(S);
    assert.strictEqual(S.arrangements.filter(isDrumArrangement).length, 1);
    assert.strictEqual(S.arrangements.length, 2);
});

t('update: replacing S.drumTab re-points the SAME arrangement to the new payload + name', () => {
    const S = { arrangements: [gtr('Lead')], drumTab: tab() };
    const first = syncDrumArrangement(S);
    const replacement = tab({ name: 'Kit 2', hits: [{ t: 1, p: 'snare' }] });
    S.drumTab = replacement;
    const again = syncDrumArrangement(S);
    assert.strictEqual(again, first, 'same arrangement object re-used');
    assert.strictEqual(again.drumTab, replacement, 're-pointed to the new payload');
    assert.strictEqual(again.name, 'Kit 2', 'follows the tab name');
    assert.strictEqual(S.arrangements.filter(isDrumArrangement).length, 1);
});

t('remove: clearing S.drumTab drops the drums arrangement, leaving the rest in order', () => {
    const S = { arrangements: [gtr('Lead'), gtr('Bass')], drumTab: tab() };
    syncDrumArrangement(S);
    assert.strictEqual(S.arrangements.length, 3);
    S.drumTab = null;
    const arr = syncDrumArrangement(S);
    assert.strictEqual(arr, null);
    assert.deepStrictEqual(S.arrangements.map(a => a.name), ['Lead', 'Bass'], 'only drums removed, order kept');
});

t('remove → restore round-trips (the drum-delete undo path)', () => {
    const payload = tab();
    const S = { arrangements: [gtr('Lead')], drumTab: payload };
    syncDrumArrangement(S);
    // exec (delete):
    S.drumTab = null; syncDrumArrangement(S);
    assert.strictEqual(findDrumArrangement(S.arrangements), null);
    // rollback (undo restores the exact payload):
    S.drumTab = payload; const restored = syncDrumArrangement(S);
    assert.strictEqual(restored.drumTab, payload, 'the original payload object is back');
    assert.strictEqual(S.arrangements.filter(isDrumArrangement).length, 1);
});

t('degrades safely on a malformed state (no throw)', () => {
    assert.strictEqual(syncDrumArrangement(null), null);
    assert.strictEqual(syncDrumArrangement({}), null, 'no arrangements array');
    assert.strictEqual(syncDrumArrangement({ arrangements: [gtr('Lead')], drumTab: null }), null);
    assert.strictEqual(syncDrumArrangement({ arrangements: [gtr('Lead')], drumTab: 'nonsense' }), null);
});

// ── byte-identical save: drums excluded from arrangements[], drum_tab ships ──
t('the save filter excludes the drums arrangement but keeps a "Drums"-NAMED pitched part', () => {
    // Simulates file-ops _buildSaveBody: body.arrangements = filter(!isDrum).
    const named = { id: 'drumsolo', name: 'Drums', notes: [{ t: 0 }] };   // untyped pitched part
    const S = { arrangements: [gtr('Lead'), named], drumTab: tab() };
    syncDrumArrangement(S);
    const saved = S.arrangements.filter(a => !isDrumArrangement(a));
    assert.deepStrictEqual(saved.map(a => a.name), ['Lead', 'Drums'],
        'the derived drums arrangement is dropped; the pitched part literally named "Drums" survives');
    assert.strictEqual(findDrumArrangement(saved), null, 'no type:drums arrangement reaches the manifest');
});

t('load → save round-trips the pitched arrangements byte-identically', () => {
    // A pack has 2 pitched arrangements + a song-level drum_tab. Migration adds
    // the drums arrangement; the save filter must reproduce the original 2.
    const loadedArrs = [gtr('Lead'), gtr('Bass')];
    const original = loadedArrs.map(a => ({ ...a }));
    const S = { arrangements: loadedArrs, drumTab: tab() };
    syncDrumArrangement(S);                                  // load migration
    const savedArrs = S.arrangements.filter(a => !isDrumArrangement(a));   // save filter
    assert.deepStrictEqual(savedArrs, original, 'the saved arrangements[] equal what was loaded');
});

// ── no duplicate tracks/band rows for drums ───────────────────────────
t('_trackSessionTargetsPure: the drums arrangement does NOT add an arr target — drums stay the legacy "drums" target', () => {
    const payload = tab();
    const S = { arrangements: [gtr('Lead')], drumTab: payload };
    syncDrumArrangement(S);   // arrangements = [Lead, drumsArr]
    const targets = _trackSessionTargetsPure(S.arrangements, S.drumTab);
    const drumTargets = targets.filter(x => x.mixKey === 'drums');
    assert.strictEqual(drumTargets.length, 1, 'exactly one drum target');
    assert.strictEqual(drumTargets[0].id, 'drums');
    assert.ok(!targets.some(x => x.mixKey === 'arr:1'), 'the drums arrangement (idx 1) gets NO arr:1 target');
    assert.strictEqual(targets.filter(x => x.mixKey.startsWith('arr:')).length, 1, 'only the pitched part is an arr target');
});

t('_trackSessionTargetsPure: a pitched part NAMED "Drums" still gets its arr target (not filtered)', () => {
    const arrs = [gtr('Lead'), { id: 'd', name: 'Drums', notes: [], chords: [] }];   // untyped
    const targets = _trackSessionTargetsPure(arrs, null);
    assert.strictEqual(targets.filter(x => x.mixKey.startsWith('arr:')).length, 2,
        'both pitched parts (incl. the one named "Drums") are arr targets');
});

// ── index helpers keep S.currentArr / remove correct with drums in the array ──
const drums = () => ({ id: 'drums', name: 'Drums', type: DRUMS_ARR_TYPE, drumTab: tab() });

t('pitchedArrangementCount ignores the drums arrangement', () => {
    assert.strictEqual(pitchedArrangementCount([gtr('Lead'), drums()]), 1);
    assert.strictEqual(pitchedArrangementCount([gtr('Lead'), gtr('Bass'), drums()]), 2);
    assert.strictEqual(pitchedArrangementCount([gtr('Lead')]), 1);
    // The remove-last-arrangement guard fires when this is <= 1: a lone pitched
    // part beside a drums arrangement must NOT be removable.
    assert.ok(pitchedArrangementCount([gtr('Lead'), drums()]) <= 1);
});

t('clampAwayFromDrums never returns the drums index', () => {
    assert.strictEqual(clampAwayFromDrums([gtr('Lead'), drums()], 1), 0, 'drums-last: idx 1 → 0');
    assert.strictEqual(clampAwayFromDrums([gtr('Lead'), gtr('Bass'), drums()], 2), 1, 'idx 2 (drums) → 1');
    assert.strictEqual(clampAwayFromDrums([gtr('Lead'), gtr('Bass'), drums()], 1), 1, 'a pitched idx is kept');
    assert.strictEqual(clampAwayFromDrums([gtr('Lead'), drums()], 9), 0, 'out-of-range clamps then skips drums');
    // Interspersed drums (a keys part appended after drums mid-session):
    assert.strictEqual(clampAwayFromDrums([gtr('Lead'), drums(), gtr('Keys')], 2), 2, 'the trailing pitched part is kept');
});

t('pitchedIndexOf maps a frontend index to the backend (drums-free) index', () => {
    // Drums appended last (the post-load norm): pitched indices are unchanged.
    assert.strictEqual(pitchedIndexOf([gtr('Lead'), gtr('Bass'), drums()], 1), 1);
    assert.strictEqual(pitchedIndexOf([gtr('Lead'), gtr('Bass'), drums()], 0), 0);
    // Interspersed drums: a pitched part AFTER the drums arrangement maps down.
    assert.strictEqual(pitchedIndexOf([gtr('Lead'), drums(), gtr('Keys')], 2), 1,
        'Keys is frontend idx 2 but backend idx 1 (the drums arrangement is not in the manifest)');
    assert.strictEqual(pitchedIndexOf([gtr('Lead'), drums(), gtr('Keys')], 0), 0);
});

// ── the switcher shows drums as a selectable option (PR2) ─────────────
t('drumArrangementIndex finds the drums option, or -1', () => {
    assert.strictEqual(drumArrangementIndex([gtr('Lead'), drums()]), 1);
    assert.strictEqual(drumArrangementIndex([drums(), gtr('Lead')]), 0);
    assert.strictEqual(drumArrangementIndex([gtr('Lead'), gtr('Bass')]), -1);
    assert.strictEqual(drumArrangementIndex(null), -1);
});

t('switcherShownIndex: drum-edit mode shows the drums option; otherwise the current pitched part', () => {
    const arrs = [gtr('Lead'), gtr('Bass'), drums()];
    // drum-edit mode on → the dropdown displays the drums option (index 2)…
    assert.strictEqual(switcherShownIndex(arrs, 1, true), 2);
    // …even though currentArr stays on the pitched part (1) — that's the invariant.
    assert.strictEqual(switcherShownIndex(arrs, 1, false), 1, 'not in drum mode → current pitched part');
    assert.strictEqual(switcherShownIndex(arrs, 0, true), 2, 'drum mode always shows drums, whatever currentArr');
    // No drums arrangement → always the current part, even if the flag is set.
    assert.strictEqual(switcherShownIndex([gtr('Lead'), gtr('Bass')], 1, true), 1);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
