/*
 * MED regression: promoting a non-original primary must not silently change
 * its persisted id on reload (which orphans its stem link + tree placement).
 *
 * feedpak-spec 1.17.0: the PRIMARY drum part persists as the song-level
 * `drum_tab` alias entry. Before the fix that alias entry was HARDCODED
 * id "drums" (routes.py) and the frontend re-materialized the primary as
 * "drums" (`_nextDrumArrId`) regardless of what it saved. So after the user
 * deletes the original primary and a survivor "drums-2" is promoted to
 * parts[0], a save→reload returned the arrangement as id "drums" while
 * `editor_stem_links["drums-2"]` and the track-session tree row for
 * "drums-2" no longer matched → `_trackSessionNormalizePure` dropped them.
 * A stem pairing and a custom folder placement were LOST across the round
 * trip.
 *
 * The fix makes the persisted primary id FOLLOW parts[0].id end to end: the
 * save body ships `drum_tab_id`, the backend writes the alias entry under it,
 * the load surfaces it, and `syncDrumArrangement(S, primaryId)` re-materializes
 * the primary under it. This test drives the LOAD-side seam with the REAL
 * pure functions and simulates the backend persist that ties them together;
 * it FAILS on unfixed code (the primary comes back as "drums").
 *
 * Run: node tests/drum_primary_id_roundtrip.test.mjs
 */
import assert from 'node:assert';

import { syncDrumArrangement, adoptDrumParts, findDrumArrangement } from '../src/drum-arrangement.js';
import { _trackSessionTargetsPure, _trackSessionNormalizePure } from '../src/track-session.js';

let pass = 0, fail = 0;
function t(name, fn) {
    try { fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}

const drumTab = (name = 'Drums (Live)') => ({ version: 1, name, kit: [], hits: [{ t: 0, p: 'kick' }] });
const gtr = (name = 'Lead') => ({ id: name.toLowerCase(), name, notes: [], chords: [] });

// The wire the backend answers with AFTER a delete-primary → promote → save.
// The original primary "drums" was deleted; "drums-2" was promoted to parts[0]
// and shipped as the song-level drum_tab whose alias entry the backend now
// persists under the incoming `drum_tab_id` (= parts[0].id). A stem link and a
// custom folder placement are keyed by that promoted id.
const PROMOTED_ID = 'drums-2';
const reloadWire = () => ({
    drum_tab: drumTab(),
    drum_tab_id: PROMOTED_ID,      // the fix: persisted primary id follows parts[0].id
    drum_parts: [],                // only the promoted part remains
    stem_links: { [PROMOTED_ID]: 'stem:kit' },
    track_session: {
        tracks: [
            { id: 'folder:1', type: 'folder', name: 'My Folder', parentId: '' },
            // the promoted part's tree row, placed inside the custom folder
            { id: 'transcription:' + PROMOTED_ID, type: 'transcription', targetId: PROMOTED_ID, parentId: 'folder:1' },
        ],
    },
});

// Mirror the file-ops.js load materialization (drums appended after the
// pitched arrangements; the persisted primary id threaded into
// syncDrumArrangement, then the extras adopted).
function loadDrums(data) {
    const S = { arrangements: [gtr('Lead')], drumTab: null, stemLinks: {} };
    S.stemLinks = (data.stem_links && typeof data.stem_links === 'object') ? data.stem_links : {};
    S.drumTab = data.drum_tab ?? null;
    syncDrumArrangement(S, data.drum_tab_id);
    adoptDrumParts(S, data.drum_parts);
    return S;
}

t('a promoted primary re-materializes under its PERSISTED id (not the hardcoded "drums")', () => {
    const S = loadDrums(reloadWire());
    const primary = findDrumArrangement(S.arrangements);
    assert.ok(primary, 'the primary drums arrangement exists');
    assert.strictEqual(primary.id, PROMOTED_ID,
        'the primary keeps the id it saved — a promoted part does not silently become "drums"');
});

t('the stem link keyed by the promoted id survives reload (a matching target exists)', () => {
    const S = loadDrums(reloadWire());
    const targets = _trackSessionTargetsPure(S.arrangements, S.drumTab);
    const linked = Object.keys(S.stemLinks);
    assert.deepStrictEqual(linked, [PROMOTED_ID]);
    assert.ok(targets.some(x => x.id === PROMOTED_ID),
        'a chart-track target matches the stem link key — the pairing is not orphaned');
});

t('the custom folder placement of the promoted part survives normalization', () => {
    const wire = reloadWire();
    const S = loadDrums(wire);
    const model = _trackSessionNormalizePure(wire.track_session, [], S.arrangements, S.drumTab);
    const row = model.tracks.find(r => r.type === 'transcription' && r.targetId === PROMOTED_ID);
    assert.ok(row, 'the promoted part still has a tree row after normalization');
    assert.strictEqual(row.parentId, 'folder:1',
        'and it stays inside the custom folder — placement is not reset to the tree root');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
