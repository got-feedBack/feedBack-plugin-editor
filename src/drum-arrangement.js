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
// FOUNDATION SCOPE (this PR): the drums arrangement is MATERIALIZED into
// `S.arrangements[]` and `S.drumTab` stays the live editing surface — the
// arrangement's `.drumTab` payload IS `S.drumTab`, the SAME object reference,
// so every existing `S.drumTab` reader/mutator and every drum undo command
// (which hold references into `S.drumTab.hits`) keep working byte-for-byte.
// The tracks/mixer/switcher still address drums through the legacy `'drums'`
// target/mix-key for now; promoting those to `arr:<idx>` and routing the drum
// grid off arrangement selection (instead of the global mode) are the
// follow-ups. Build/save still persists drums as the song-level `drum_tab`
// primary — the drums arrangement is DERIVED on load and never written into
// the manifest `arrangements[]` (a drums entry there would default to guitar
// and be fretted-graded as garbage until the core loader learns `type:drums`).
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

// The (first) drums arrangement in the list, or null. Single drum still today;
// this is the seam the multiple-drum-charts work extends.
export function findDrumArrangement(arrangements) {
    return (Array.isArray(arrangements) ? arrangements : []).find(isDrumArrangement) || null;
}

// The index of the drums arrangement in the list, or -1. The arrangement switcher
// uses it to DISPLAY the drums option as selected while drum-edit mode is on —
// even though S.currentArr itself stays on a pitched arrangement.
export function drumArrangementIndex(arrangements) {
    return (Array.isArray(arrangements) ? arrangements : []).findIndex(isDrumArrangement);
}

// Which arrangement index the switcher should DISPLAY as selected: the drums
// arrangement while drum-edit mode is on (its view is the drum grid), else the
// current pitched arrangement. currentArr itself never moves onto drums.
export function switcherShownIndex(arrangements, currentArr, drumEditMode) {
    const di = drumArrangementIndex(arrangements);
    return (drumEditMode && di >= 0) ? di : currentArr;
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

// Reconcile `S.arrangements[]` with `S.drumTab`: materialize / update / remove
// the single drums arrangement so its `.drumTab` payload IS `S.drumTab` (same
// object reference — the live editing surface). Idempotent, so it is safe to
// call after EVERY `S.drumTab` (re)assignment (load, GP/MIDI import, empty-add,
// delete + its undo-restore). Appended at the END, so existing arrangement
// indices — and therefore every `arr:<idx>` mix key — are preserved. Returns
// the drums arrangement, or null when there are no drums.
export function syncDrumArrangement(S) {
    if (!S || !Array.isArray(S.arrangements)) return null;
    const existing = findDrumArrangement(S.arrangements);
    const tab = S.drumTab;
    if (!tab || typeof tab !== 'object') {
        // Drums removed → drop the arrangement (leave every other entry in place).
        if (existing) S.arrangements.splice(S.arrangements.indexOf(existing), 1);
        return null;
    }
    if (existing) {
        // Re-point to the live payload (import replaces the object) and follow
        // its name; the SAME object reference keeps drum-editor undo refs valid.
        existing.drumTab = tab;
        existing.name = String(tab.name || 'Drums').slice(0, 120);
        return existing;
    }
    const arr = {
        id: DRUMS_ARR_ID,
        name: String(tab.name || 'Drums').slice(0, 120),
        type: DRUMS_ARR_TYPE,
        // SAME object reference as S.drumTab — the drum grid edits this in place.
        drumTab: tab,
        // Drums carry no fretted/pitched content; empty arrays keep every
        // arrangement iterator (band audio, draw guards) safe.
        notes: [],
        chords: [],
    };
    S.arrangements.push(arr);
    return arr;
}
