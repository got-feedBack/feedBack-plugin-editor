/* Slopsmith Arrangement Editor — chord templates & handshapes.
 *
 * The load/save round-trip for chords: flatten a chart's chords into its notes
 * on load, and rebuild them (re-linking chord templates by fret pattern, and
 * remapping authored handshapes onto the rebuilt template indices) on save.
 * Plus the handshape wire-coercion and dirty-count helpers.
 *
 * Reads `S` and `lanes()`; no DOM. `reconstructChords` resets `S.history`: solo
 * notes survive by reference, but chord members are rebuilt as fresh objects and
 * `arr.notes` / `arr.chords` are replaced wholesale, so every index-based undo
 * command would point at the wrong note.
 */

import { S } from './state.js';
import { lanes } from './lanes.js';

// Flatten chord notes into the main notes array on load, tagging with _fromChord.
// On save, reconstruct chords from notes sharing the same time (see
// reconstructChords — it groups by rounded time alone, not by _fromChord).
export function flattenChords() {
    if (!S.arrangements.length) return;
    _flattenArrChords(S.arrangements[S.currentArr]);
}

// Fold a SPECIFIC arrangement's chord notes into its `notes` array (the body of
// flattenChords, but arr-scoped instead of reading S.currentArr). Used by the
// replace-chart command so its exec()/redo flatten the TARGET arrangement — and
// produce identical state each time — regardless of which arrangement is active.
export function _flattenArrChords(arr) {
    if (!arr) return;
    // Harmony function (§6.3.1) rides the chord INSTANCE. We carry it on the
    // spread note objects — every note of the chord gets the same `_fn` — so it
    // travels with the notes through ANY edit that mutates note.time (drag,
    // global shift, time-scale, tempo remap). reconstructChords adopts a group's
    // fn by majority vote (_groupFn), so a single note dragged into another chord
    // is outvoted and can't impose a stale fn. (Supersedes the old time-keyed
    // `arr._chordFn` store, which silently lost fn whenever a chord moved.)
    delete arr._chordFn;
    if (!Array.isArray(arr.notes)) arr.notes = [];
    for (const ch of arr.chords || []) {
        const fn = _normChordFn(ch.fn);
        for (const cn of ch.notes || []) {
            arr.notes.push({
                time: cn.time || ch.time,
                string: cn.string,
                fret: cn.fret,
                sustain: cn.sustain || 0,
                techniques: cn.techniques || {},
                _fromChord: true,
                _chordId: ch.chord_id,
                _fn: fn || null,
            });
        }
    }
    arr.chords = [];
    arr.notes.sort((a, b) => a.time - b.time);
}

// E2: coerce a wire-style boolean the way the backend's `_safe_bool` does
// (routes.py) — native bool, 0/1, and the string spellings true/false/yes/no/
// 1/0/"". JS `!!"false"` is truthy, so a hand-edited / legacy sloppak with
// `arp: "false"` must NOT flip arpeggio on during a load→save round-trip.
function _safeWireBool(v, dflt) {
    if (typeof v === 'boolean') return v;
    if (v === null || v === undefined) return dflt;
    if (typeof v === 'number') return v !== 0;
    if (typeof v === 'string') {
        const s = v.trim().toLowerCase();
        if (s === 'true' || s === '1' || s === 'yes') return true;
        if (s === 'false' || s === '0' || s === 'no' || s === '') return false;
    }
    return dflt;
}

// E2: coerce a wire-style number the way the backend's `_safe_int` / `float`
// do — accept native numbers and numeric strings (a hand-edited sloppak may
// carry `chord_id: "0"`, `start_time: "1.2"`). Returns `dflt` for blank /
// non-numeric / non-finite input.
function _wireFloat(v, dflt) {
    if (typeof v === 'number') return Number.isFinite(v) ? v : dflt;
    if (typeof v === 'string' && v.trim() !== '') {
        const n = Number(v);
        if (Number.isFinite(n)) return n;
    }
    return dflt;
}

// E2: coerce a loaded handshape into a robust editable dict using the wire
// field names the backend reads (chord_id/start_time/end_time/arp). Mirrors
// the backend's `_valid_handshape_dicts` coercion (numeric strings accepted)
// so a hand-edited pack isn't silently dropped. The `arp` default matches the
// backend's absent-default (False, via `_safe_bool`) so a load→save round-trip
// of a legacy payload is a no-op; freshly drawn regions default `arp:true` in
// the authoring UI (PR-B), not here.
export function _normalizeHandshape(hs) {
    const cidNum = _wireFloat(hs && hs.chord_id, NaN);
    const cid = Number.isFinite(cidNum) ? Math.trunc(cidNum) : -1;
    let st = _wireFloat(hs && hs.start_time, 0);
    let et = _wireFloat(hs && hs.end_time, st);
    if (st < 0) st = 0;
    if (et < st) et = st;
    const rawArp = (hs && hs.arp !== undefined) ? hs.arp
        : (hs && hs.arpeggio !== undefined) ? hs.arpeggio : false;
    return { chord_id: cid, start_time: st, end_time: et, arp: _safeWireBool(rawArp, false) };
}

// Normalize a frets array to a width-L comma key so loaded/GP templates
// (padded to 6) match the editor's L-wide rebuilt frets on 7/8-string charts.
// Width-normalize a fret row to the chart's string count `L`, folding every
// non-finite slot (undefined / NaN / a hand-edited string) to -1. This is the
// single fold: the dedupe key, the preserved-template lookup, and the stored
// template row all go through it, so they cannot disagree.
function _normFretsToL(frets, L) {
    const out = new Array(L);
    for (let i = 0; i < L; i++) {
        out[i] = (Array.isArray(frets) && Number.isFinite(frets[i])) ? frets[i] : -1;
    }
    return out;
}

export function _fretKeyForL(frets, L) {
    return _normFretsToL(frets, L).join(',');
}
// Return a length-L fingers array from `fingers` (pad/trim with -1).
export function _normFingers(fingers, L) {
    const out = new Array(L).fill(-1);
    if (Array.isArray(fingers)) {
        for (let i = 0; i < L && i < fingers.length; i++) {
            out[i] = Number.isFinite(fingers[i]) ? fingers[i] : -1;
        }
    }
    return out;
}
// §6.6 CAGED shape (display only): keep only the enum letters, else "".
export function _sanitizeCaged(caged) {
    const c = (typeof caged === 'string') ? caged.trim() : '';
    return /^[CAGED]$/.test(c) ? c : '';
}
// §6.6 guide tones (display only): keep only the int entries in 0..11, dropping
// non-ints (bool excluded) and out-of-range values. Mirrors core's wire guard.
export function _sanitizeGuideTones(tones) {
    if (!Array.isArray(tones)) return [];
    return tones.filter(n => Number.isInteger(n) && n >= 0 && n <= 11);
}
// Parse a comma-separated guide-tone string (inspector text input) into a clean
// int array via _sanitizeGuideTones — e.g. "4, 10, 12, x" -> [4, 10].
export function _parseGuideTones(raw) {
    if (Array.isArray(raw)) return _sanitizeGuideTones(raw);
    if (typeof raw !== 'string') return [];
    return _sanitizeGuideTones(
        raw.split(',').map(s => {
            const t = s.trim();
            return /^-?\d+$/.test(t) ? parseInt(t, 10) : NaN;
        }));
}
// fret-pattern (width-L) -> authored template; first occurrence wins.
// Note: the flattened editor model has exactly ONE template per fret pattern,
// so two authored chords that share frets but differ in name/fingers
// necessarily collapse to one here (first wins). That's a pre-existing model
// limitation — before this change both collapsed to a *blank* template, so this
// is strictly an improvement; a fuller fix (per-`_chordId` templates) is E1/E2.
export function _buildPreservedTemplates(oldTemplates, L) {
    const preserved = {};
    if (Array.isArray(oldTemplates)) {
        for (const ct of oldTemplates) {
            if (!ct || !Array.isArray(ct.frets)) continue;
            const k = _fretKeyForL(ct.frets, L);
            if (!(k in preserved)) preserved[k] = ct;
        }
    }
    return preserved;
}
// Build a rebuilt template for `frets`, carrying authored metadata when the
// fret pattern matches a preserved template; blank otherwise. `frets` is the
// authoritative current voicing.
// Carries the authored, round-trippable template fields: chordName (`name`),
// per-string `fingers`, `displayName` (falls back to `name`), and the
// template-level `arp` flag. E1 added the chord-inspector authoring UI and the
// matching backend emission (routes.py wire/XML writers + read side), so these
// persist through save and reload instead of being silent dead-state.
export function relinkChordTemplate(frets, preserved, L) {
    // Store the NORMALIZED row, not `frets.slice()`. A preserved template can
    // arrive narrower than the chart (buildHandshapeChordIdMap's preserve-append
    // hands us a template straight off the wire), and a fret slot can be
    // non-finite on a hand-edited pack. `fingers` has always been padded to L
    // this way — `frets` now matches.
    const normFrets = _normFretsToL(frets, L);
    const old = preserved[normFrets.join(',')];
    const name = (old && typeof old.name === 'string') ? old.name : '';
    return {
        name,
        frets: normFrets,
        fingers: _normFingers(old && old.fingers, L),
        displayName: (old && typeof old.displayName === 'string') ? old.displayName : name,
        // `!!old.arp` turned the STRING "false" into true — exactly the trap
        // `_safeWireBool` was written for. A hand-edited / legacy sloppak with
        // `arp: "false"` must not switch arpeggio on across a load→save.
        arp: _safeWireBool(old && old.arp, false),
        // §6.6 voicing — carry it forward or the save rebuild BLANKS it (same
        // carry-forward gotcha as name/displayName/fingers/arp).
        voicing: (old && typeof old.voicing === 'string') ? old.voicing : '',
        // §6.6 caged + guideTones — same carry-forward gotcha as voicing; sanitize
        // here too so a stale invalid value can't survive the rebuild.
        caged: _sanitizeCaged(old && old.caged),
        guideTones: _sanitizeGuideTones(old && old.guideTones),
    };
}

// Normalize a chord-instance harmony function (§6.3.1) to the round-trippable
// shape, keeping only the set keys. Partial fns are allowed in-memory (the
// inspector authors rn/q/deg incrementally); the save range-guard (routes.py)
// is what enforces the spec's all-three-keys rule before it reaches the wire.
// Returns null when nothing is set.
export function _normChordFn(fn) {
    if (!fn || typeof fn !== 'object') return null;
    const out = {};
    if (typeof fn.rn === 'string' && fn.rn.trim()) out.rn = fn.rn.trim();
    if (typeof fn.q === 'string' && fn.q.trim()) out.q = fn.q.trim();
    if (Number.isInteger(fn.deg) && fn.deg >= 0 && fn.deg <= 11) out.deg = fn.deg;
    return Object.keys(out).length ? out : null;
}

// Merge a partial harmony-function patch ({rn?|q?|deg?}) onto a base fn,
// keeping only the set keys. A key present in `patch` overwrites (blank/invalid
// clears it). Returns null when the result is empty.
export function _mergeChordFn(base, patch) {
    const merged = {
        rn: base && typeof base.rn === 'string' ? base.rn : '',
        q: base && typeof base.q === 'string' ? base.q : '',
        deg: base && Number.isInteger(base.deg) ? base.deg : null,
    };
    if (patch && 'rn' in patch) merged.rn = typeof patch.rn === 'string' ? patch.rn.trim() : '';
    if (patch && 'q' in patch) merged.q = typeof patch.q === 'string' ? patch.q.trim() : '';
    if (patch && 'deg' in patch) {
        const d = patch.deg;
        merged.deg = (Number.isInteger(d) && d >= 0 && d <= 11) ? d : null;
    }
    return _normChordFn(merged);
}

// Adopt a note group's harmony function (§6.3.1) by MAJORITY: the `_fn` value
// carried by more than half the group's notes, else null. fn rides the chord
// instance and is carried on every note of the chord (so it travels with the
// notes through moves / shifts / tempo remaps). Authoring writes the same `_fn`
// to all of a chord's notes (unanimous), so a real chord always keeps its fn;
// a single note dragged in from another chord is outvoted and can't impose a
// stale fn — the property the time-keyed store used to guarantee.
export function _groupFn(groupNotes) {
    if (!Array.isArray(groupNotes) || !groupNotes.length) return null;
    const counts = new Map();   // normalized key -> { fn, n }
    for (const n of groupNotes) {
        const fn = _normChordFn(n && n._fn);
        if (!fn) continue;
        const key = JSON.stringify([fn.rn || '', fn.q || '',
            Number.isInteger(fn.deg) ? fn.deg : null]);
        const e = counts.get(key);
        if (e) e.n++; else counts.set(key, { fn, n: 1 });
    }
    let best = null;
    for (const e of counts.values()) if (!best || e.n > best.n) best = e;
    return best && best.n * 2 > groupNotes.length ? best.fn : null;
}
// E2: build an old-template-index -> new-template-index map for handshapes'
// `chord_id` references after reconstructChords() rebuilt the template list.
// `templateMap` (new fret-key -> new index) and `chordTemplates` (the new
// list) are the rebuild outputs; both may be MUTATED here to append a
// preserved template for an arpeggio handshape whose voicing produced no
// same-time chord (so it isn't in the rebuild) — those must not be dropped.
// Only templates actually referenced by a surviving handshape are appended,
// and each orphan voicing is appended once (deduped via `templateMap`).
export function buildHandshapeChordIdMap(handshapes, oldTemplates, templateMap, chordTemplates, L) {
    const oldToNew = {};
    if (!Array.isArray(handshapes) || !Array.isArray(oldTemplates)
        || !templateMap || !Array.isArray(chordTemplates)) return oldToNew;
    for (const hs of handshapes) {
        if (!hs) continue;
        const oldIdx = hs.chord_id;
        if (!Number.isInteger(oldIdx) || oldIdx < 0 || oldIdx >= oldTemplates.length) continue;
        if (oldIdx in oldToNew) continue;
        const old = oldTemplates[oldIdx];
        if (!old || !Array.isArray(old.frets)) continue;
        const key = _fretKeyForL(old.frets, L);
        if (key in templateMap) {
            oldToNew[oldIdx] = templateMap[key];
        } else {
            const newIdx = chordTemplates.length;
            // Re-link through the preserved metadata so the appended template
            // is width-L normalized and keeps name/displayName/fingers/arp.
            chordTemplates.push(relinkChordTemplate(old.frets, { [key]: old }, L));
            templateMap[key] = newIdx;
            oldToNew[oldIdx] = newIdx;
        }
    }
    return oldToNew;
}
// Drop handshapes whose span no longer covers any content they could be
// framing. Deleting a chord's notes removes only the notes — without this
// filter the covering handshape survives the save (and re-appends the deleted
// chord's template via buildHandshapeChordIdMap), so the "removed" chord keeps
// rendering as a handshape chord panel on the highway forever. A chord-shape
// handshape (arp:false) needs a chord instance inside its span; an arpeggio
// handshape (arp:true) frames single notes, so any note or chord in the span
// keeps it. Pure: takes the reconstructChords() rebuild outputs (editor-shaped
// {time,...} chords/notes) and returns the surviving subset, same objects.
const HS_ORPHAN_EPS = 1e-4; // s — tolerate float drift between span and content times
export function dropOrphanedHandshapes(handshapes, chords, notes) {
    if (!Array.isArray(handshapes) || !handshapes.length) return [];
    const inSpan = (x, hs) => {
        const t = x && Number(x.time);
        return Number.isFinite(t)
            && t >= hs.start_time - HS_ORPHAN_EPS
            && t <= hs.end_time + HS_ORPHAN_EPS;
    };
    return handshapes.filter(hs => {
        if (!hs) return false;
        if ((chords || []).some(c => inSpan(c, hs))) return true;
        return !!hs.arp && (notes || []).some(n => inSpan(n, hs));
    });
}
// E2: apply an old->new chord_id remap to handshapes, dropping any whose old
// `chord_id` has no mapping (its template no longer exists -> invalid; the
// backend validator drops these too). Mutates each surviving handshape's
// `chord_id` IN PLACE and returns the filtered array of the SAME objects —
// preserving object identity so undo/redo command refs (which `indexOf` the
// handshape) survive a save, where reconstructChords() reassigns
// `arr.handshapes`. (Cloning here would orphan those refs.)
export function remapHandshapeChordIds(handshapes, oldToNew) {
    if (!Array.isArray(handshapes) || !oldToNew) return [];
    const out = [];
    for (const hs of handshapes) {
        if (!hs) continue;
        const mapped = oldToNew[hs.chord_id];
        if (mapped === undefined) continue;
        hs.chord_id = mapped;
        out.push(hs);
    }
    return out;
}
// Reconstruct chords from notes at the same time before saving
export function reconstructChords() {
    if (!S.arrangements.length) return;
    const arr = S.arrangements[S.currentArr];
    const L = lanes();
    // E0: snapshot the authored chord-template store (still present on
    // `arr.chord_templates` here) keyed by fret pattern, so the rebuild below
    // preserves name/displayName/fingers/arp instead of blanking them.
    const _preserved = _buildPreservedTemplates(arr.chord_templates, L);
    // E2: keep the OLD template list so handshape `chord_id` references (old
    // indices) can be remapped to the rebuilt indices below.
    const oldTemplates = arr.chord_templates;
    const byTime = {};
    for (const n of arr.notes) {
        const key = n.time.toFixed(4);
        if (!byTime[key]) byTime[key] = [];
        byTime[key].push(n);
    }
    const newNotes = [];
    const newChords = [];
    // Always rebuild chord_templates from scratch so repeated saves don't
    // accumulate duplicate entries (flattenChords has already emptied
    // arr.chords, so the old templates are no longer referenced).
    const chordTemplates = [];
    const templateMap = {};

    for (const key of Object.keys(byTime).sort((a, b) => parseFloat(a) - parseFloat(b))) {
        const group = byTime[key];
        if (group.length === 1) {
            // A lone note is not a chord: drop the chord provenance it inherited
            // from `flattenChords` (e.g. the other members were deleted). `_fn`
            // matters most — `_groupFn` READS it, so a stale one would be adopted
            // by majority vote if this note is later dragged into a chord.
            // `_fromChord` / `_chordId` are write-only today; clearing them keeps
            // a future reader from trusting a stale flag. (None of the three can
            // reach disk: the backend's `_note()` whitelists the keys it writes.)
            delete group[0]._fn;
            delete group[0]._fromChord;
            delete group[0]._chordId;
            newNotes.push(group[0]);
        } else {
            // Multiple notes at same time = chord
            const frets = new Array(L).fill(-1);
            for (const n of group) {
                if (n.string >= 0 && n.string < L) frets[n.string] = n.fret;
            }
            // Key exactly as `relinkChordTemplate` looks preserved templates up
            // (and as `buildHandshapeChordIdMap` re-keys the rebuilt ones):
            // `_fretKeyForL` maps every non-finite slot to -1. A raw
            // `frets.join(',')` would mint a SEPARATE template for a chord whose
            // only difference is `NaN` vs `undefined` in a slot, and both would
            // then relink to the same preserved entry — duplicate templates, and
            // a handshape `chord_id` remap that lands on whichever came first.
            // Identical to `join(',')` whenever every fret is finite.
            const fretKey = _fretKeyForL(frets, L);
            let tmplIdx;
            if (fretKey in templateMap) {
                tmplIdx = templateMap[fretKey];
            } else {
                tmplIdx = chordTemplates.length;
                // E0: carry authored name/displayName/fingers/arp forward when
                // this fret pattern matches a preserved template; blank otherwise.
                // Width-normalized to L so 7/8-string charts match correctly.
                chordTemplates.push(relinkChordTemplate(frets, _preserved, L));
                templateMap[fretKey] = tmplIdx;
            }
            // Harmony function (§6.3.1) rides the instance: adopt it from the
            // group's notes by majority (_groupFn), so it survives chord moves and
            // a stray dragged-in note can't impose a foreign fn. A partial fn is
            // kept here and dropped by the save range-guard.
            const _fn = _groupFn(group);
            newChords.push({
                time: group[0].time,
                chord_id: tmplIdx,
                high_density: false,
                fn: _fn,
                notes: group.map(n => ({
                    time: n.time,
                    string: n.string,
                    fret: n.fret,
                    sustain: n.sustain || 0,
                    techniques: n.techniques || {},
                })),
            });
        }
    }
    arr.notes = newNotes;
    arr.chords = newChords;
    arr.chord_templates = chordTemplates;
    // #18: this rebuild just replaced arr.notes with fresh note objects (and
    // moved same-time groups into arr.chords), so every index-based undo command
    // now points at the wrong note. Reset the undo/redo history HERE — atomically
    // with the identity-changing assignment, before the handshape remap below
    // (which can throw) — so a stale stack can't survive a partial rebuild.
    // reconstructChords() runs ONLY at save/build time, so this only ever drops
    // cross-save undo. (Follow-up: stable note ids would preserve it — #18 Option 2.)
    if (S.history) S.history.reset();
    // E2: remap authored handshapes' `chord_id` from the OLD template indices
    // to the rebuilt ones (matched by fret pattern). An arpeggio handshape
    // whose voicing produced no same-time chord gets its preserved template
    // appended (so it survives); references with no template are dropped to
    // match the backend's `chord_id < len(chord_templates)` validator.
    if (Array.isArray(arr.handshapes) && arr.handshapes.length) {
        const _selWasHere = S.handshapeSel && arr.handshapes.includes(S.handshapeSel);
        // Drop handshapes orphaned by note edits FIRST (a deleted chord must
        // not keep its handshape — or resurrect its template through the map
        // builder's preserve-append below). Dropping counts as an authored
        // change: bump the dirty counter so an all-dropped (now empty) list
        // still ships to the backend as an explicit clear instead of falling
        // into the absent→preserve-from-disk path.
        const live = dropOrphanedHandshapes(arr.handshapes, newChords, newNotes);
        if (live.length < arr.handshapes.length) _bumpHandshapesDirty(arr, +1);
        const oldToNew = buildHandshapeChordIdMap(
            live, oldTemplates, templateMap, chordTemplates, L);
        arr.handshapes = remapHandshapeChordIds(live, oldToNew);
        // If the selected handshape was in THIS arrangement and the remap
        // dropped it (its template vanished), clear the now-dangling selection.
        if (_selWasHere && !arr.handshapes.includes(S.handshapeSel)) S.handshapeSel = null;
    }
}

// E2: handshape dirty tracking — mirrors the anchor pattern above. The edit
// counter lives on `arr` (not on `arr.handshapes`) so a load that normalized
// handshapes via `_normalizeHandshape` isn't flagged as authored, and the
// serialize paths strip `_handshapeEditCount` from the wire body.
export function _ensureHandshapes(arr) {
    if (!arr) return null;
    if (!Array.isArray(arr.handshapes)) arr.handshapes = [];
    return arr.handshapes;
}

export function _bumpHandshapesDirty(arr, delta) {
    if (!arr) return;
    _ensureHandshapes(arr);
    const next = (arr._handshapeEditCount || 0) + delta;
    arr._handshapeEditCount = next > 0 ? next : 0;
}

export function _handshapesAreDirty(arr) {
    return !!(arr && (arr._handshapeEditCount || 0) > 0);
}
