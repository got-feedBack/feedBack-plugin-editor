// ════════════════════════════════════════════════════════════════════
// Drums as a first-class arrangement — the drums-as-arrangements foundation.
//
// Historically the single drum tab (`S.drumTab`) lived ENTIRELY OUTSIDE
// `S.arrangements[]`, as a lone off-array singleton edited through a global
// mode (`S.drumEditMode`) — the one instrument that wasn't an ordinary
// arrangement. This leaf gives it a home IN the arrangement list as a
// `type:"drums"` entry, so drums are an ordinary typed arrangement
// (`arrKind(arr) === 'drums'`, via the #335 instrument-type-as-data seam) that
// the arrangement infrastructure can hold — the substrate multiple drum charts
// will grow from.
//
// N-DRUMS MODEL (this arc's third slice): a song can hold SEVERAL drum
// parts. Each `type:"drums"` arrangement OWNS its `.drumTab` payload; the
// single `S.drumTab` is now a POINTER to the ACTIVE part's tab — the one the
// drum grid edits — so every existing `S.drumTab` reader/mutator and every
// drum undo command (which hold references into a tab's `hits`) keep working
// unchanged: they always operate on "the drum tab being edited".
//
//   - PRIMARY part = the FIRST drums arrangement in list order. Its tab
//     persists as the song-level `drum_tab` manifest key (the back-compat
//     alias current cores play); the EXTRA parts persist as `type:"drums"`
//     manifest arrangement entries with per-arrangement `drum_tab` pointers
//     (feedpak-spec 1.17.0) — file-less entries an old reader skips cleanly.
//   - ACTIVE part = the drums arrangement whose `.drumTab === S.drumTab`.
//     Selecting a 🥁 option re-points `S.drumTab`; `S.currentArr` still
//     NEVER moves onto a drums arrangement (the #337 invariant).
//
// Create-mode compose sessions keep the legacy single off-array tab until
// the primary is materialized (see syncDrumArrangement's callers) — the
// second-part verbs require a saved sloppak session.
//
// Leaf module (imports only the instrument-identity leaf), so state/load/
// track-session can call it without closing a cycle.
// ════════════════════════════════════════════════════════════════════

import { _arrTypeKind } from './instrument.js';

export const DRUMS_ARR_TYPE = 'drums';
// Stable synthetic id for the derived drums arrangement. Never persisted (the
// arrangement is excluded from the save body); it exists only so track-session
// rows/targets that key off an arrangement id have a value that won't collide.
const DRUMS_ARR_ID = 'drums';

// Is this arrangement a drums arrangement? Keyed on the authored `type` ALONE
// (normalized: "drum"/"Drums" → drums), NOT on `arrKind` — `arrKind` would name-
// infer, wrongly catching a pitched arrangement a user literally named "Drums"
// and then hiding/dropping it. The materialized drums arrangement always carries
// `type:"drums"`, so a type-only test is exact and safe.
export function isDrumArrangement(arr) {
    return _arrTypeKind(arr) === DRUMS_ARR_TYPE;
}

// The PRIMARY (first) drums arrangement in the list, or null — the part whose
// tab persists as the song-level `drum_tab` back-compat alias.
export function findDrumArrangement(arrangements) {
    return (Array.isArray(arrangements) ? arrangements : []).find(isDrumArrangement) || null;
}

// Every drums arrangement, in list order (primary first).
export function drumArrangements(arrangements) {
    return (Array.isArray(arrangements) ? arrangements : []).filter(isDrumArrangement);
}

// The index of the PRIMARY drums arrangement in the list, or -1.
export function drumArrangementIndex(arrangements) {
    return (Array.isArray(arrangements) ? arrangements : []).findIndex(isDrumArrangement);
}

// The index of the ACTIVE drums arrangement — the part whose tab IS the one
// the drum grid edits (identity match on the payload), or -1. This is what
// the switcher displays and what the mixer's drum-mode clap gate keys on.
export function activeDrumArrangementIndex(arrangements, drumTab) {
    if (!drumTab || typeof drumTab !== 'object') return -1;
    return (Array.isArray(arrangements) ? arrangements : [])
        .findIndex(a => isDrumArrangement(a) && a.drumTab === drumTab);
}

// Which arrangement index the switcher should DISPLAY as selected: the ACTIVE
// drums arrangement while drum-edit mode is on (its view is the drum grid),
// else the current pitched arrangement. currentArr never moves onto drums.
// Falls back to the primary when the active tab isn't materialized (legacy
// create-mode), and to currentArr when there are no drums at all.
export function switcherShownIndex(arrangements, currentArr, drumEditMode, drumTab) {
    if (!drumEditMode) return currentArr;
    const ai = activeDrumArrangementIndex(arrangements, drumTab);
    if (ai >= 0) return ai;
    const di = drumArrangementIndex(arrangements);
    return di >= 0 ? di : currentArr;
}

// The number of PITCHED (non-drums) arrangements — what "how many arrangements
// are there" means everywhere the derived drums arrangement must not be counted
// (the remove-last-arrangement guard, single-arrangement checks).
export function pitchedArrangementCount(arrangements) {
    return (Array.isArray(arrangements) ? arrangements : []).filter(a => !isDrumArrangement(a)).length;
}

// Clamp an arrangement index so `S.currentArr` never lands on the drums
// arrangement — the "current" arrangement is always a pitched one (drums are
// edited through the drum grid, not selected as the pitched arrangement). Walks
// DOWN to the nearest pitched index; falls back to 0.
export function clampAwayFromDrums(arrangements, idx) {
    const arrs = Array.isArray(arrangements) ? arrangements : [];
    let i = Math.max(0, Math.min(Number(idx) || 0, arrs.length - 1));
    while (i > 0 && isDrumArrangement(arrs[i])) i--;
    return i;
}

// The BACKEND arrangement index for a frontend index: the count of pitched
// arrangements before it. The backend's `arrangements[]` never contains the
// session-only drums arrangement, so a frontend index (which may sit after an
// interspersed drums entry) must be mapped to its pitched-only position before
// it is sent to /remove-arrangement.
export function pitchedIndexOf(arrangements, idx) {
    return (Array.isArray(arrangements) ? arrangements : [])
        .slice(0, Math.max(0, Number(idx) || 0)).filter(a => !isDrumArrangement(a)).length;
}

const _tabName = (tab) => String((tab && tab.name) || 'Drums').slice(0, 120);

// A drums arrangement shell around a tab payload (SAME object reference —
// the drum grid edits it in place). Drums carry no fretted/pitched content;
// empty arrays keep every arrangement iterator (band audio, draw guards) safe.
function _drumArrShell(id, tab, name) {
    return {
        id,
        name: String(name || _tabName(tab)).slice(0, 120),
        type: DRUMS_ARR_TYPE,
        drumTab: tab,
        notes: [],
        chords: [],
    };
}

// The lowest unused drums-arrangement id: 'drums' for the primary, then
// 'drums-2', 'drums-3', … — durable (it is the target/pairing key AND the
// persisted manifest entry id), so it never renumbers after creation.
function _nextDrumArrId(arrangements) {
    const used = new Set((Array.isArray(arrangements) ? arrangements : [])
        .map(a => (a && a.id !== undefined && a.id !== null) ? String(a.id) : ''));
    if (!used.has(DRUMS_ARR_ID)) return DRUMS_ARR_ID;
    for (let n = 2; ; n++) {
        const id = DRUMS_ARR_ID + '-' + n;
        if (!used.has(id)) return id;
    }
}

// Reconcile `S.arrangements[]` with `S.drumTab` for the SINGLE-part flows
// (load-time primary materialization, first empty-add, first import).
// Idempotent. Appended at the END, so existing arrangement indices — and
// therefore every `arr:<idx>` mix key — are preserved. Multi-part editing
// never routes through here: adding extra parts is `addDrumArrangement`,
// deleting a specific part is `DeleteDrumTabCmd` (which splices the
// arrangement itself), so with several parts this is a careful no-op that
// leaves the non-active parts alone. Returns the arrangement holding
// `S.drumTab`, or null when there are no drums.
export function syncDrumArrangement(S) {
    if (!S || !Array.isArray(S.arrangements)) return null;
    const all = drumArrangements(S.arrangements);
    const tab = S.drumTab;
    if (!tab || typeof tab !== 'object') {
        // No active tab. The legacy singleton contract: clearing S.drumTab
        // drops THE drums arrangement — but only when exactly one exists.
        // With several parts a null active tab is never a "delete everything"
        // instruction, so leave them in place.
        if (all.length === 1) S.arrangements.splice(S.arrangements.indexOf(all[0]), 1);
        return null;
    }
    // Already materialized (identity match) → just follow the tab's name.
    const holder = all.find(a => a.drumTab === tab);
    if (holder) {
        holder.name = _tabName(tab);
        return holder;
    }
    if (all.length) {
        // A drums arrangement exists but none holds this tab: the legacy
        // replace-payload seam (an import swapped the tab object). Re-point
        // the PRIMARY — with one part this is exactly the old behavior; the
        // multi-part import path adds a new part instead of coming here.
        all[0].drumTab = tab;
        all[0].name = _tabName(tab);
        return all[0];
    }
    const arr = _drumArrShell(_nextDrumArrId(S.arrangements), tab);
    S.arrangements.push(arr);
    return arr;
}

// Add ANOTHER drum part: append a new `type:"drums"` arrangement owning
// `tab` (unique id + de-duplicated display name). Does NOT touch S.drumTab —
// the caller decides whether the new part becomes the active grid target.
// Returns the new arrangement.
export function addDrumArrangement(S, tab) {
    if (!S || !Array.isArray(S.arrangements) || !tab || typeof tab !== 'object') return null;
    const names = new Set(S.arrangements.map(a => a && a.name));
    let name = _tabName(tab);
    if (names.has(name)) {
        let n = 2;
        while (names.has(`${name} ${n}`)) n++;
        name = `${name} ${n}`;
    }
    tab.name = name;   // the tab's own name field is what persists in its JSON
    const arr = _drumArrShell(_nextDrumArrId(S.arrangements), tab, name);
    S.arrangements.push(arr);
    return arr;
}

// Load-time adoption of the EXTRA drum parts read back from the manifest's
// `type:"drums"` arrangement entries (the wire's `drum_parts`, primary
// excluded — that one came in as the song-level `drum_tab` and was
// materialized by syncDrumArrangement). Appends in wire order; keeps each
// part's persisted id when it doesn't collide.
export function adoptDrumParts(S, parts) {
    if (!S || !Array.isArray(S.arrangements) || !Array.isArray(parts)) return;
    for (const part of parts) {
        const tab = part && part.drum_tab;
        if (!tab || typeof tab !== 'object' || !Array.isArray(tab.hits)) continue;
        tab.hits.sort((a, b) => (a.t || 0) - (b.t || 0));
        const wantedId = (part.id !== undefined && part.id !== null) ? String(part.id).trim() : '';
        const used = new Set(S.arrangements.map(a => (a && a.id !== undefined && a.id !== null) ? String(a.id) : ''));
        const id = (wantedId && !used.has(wantedId)) ? wantedId : _nextDrumArrId(S.arrangements);
        const name = String(part.name || tab.name || 'Drums').slice(0, 120);
        tab.name = name;
        S.arrangements.push(_drumArrShell(id, tab, name));
    }
}
