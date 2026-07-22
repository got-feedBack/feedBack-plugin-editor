// ════════════════════════════════════════════════════════════════════
// Region EditHistory commands — repositioning a track's content as a block.
//
// A region is a WINDOW over content, never a copy (src/region.js). "Move
// region" therefore shifts the CONTENT the window covers — a notation region
// shifts the arrangement's contained notes, a drum region shifts its own
// part's tab hits (see _drumTabFor) — as one undoable edit, with the window's
// own placement riding along for a BOUNDED region. It goes through S.history.exec (NOT the
// track-session commit() path): commit() only marks the session dirty, so an
// in-place time shift would leave the coverage/chord/lint memos stale — exec()
// bumps editGen, which is what forces them to recompute.
//
// Time model — see _regionRemapPure: the move preserves MUSICAL position, not
// wall-clock seconds (it mirrors TempoMapCmd's interval walk), and collapses to
// an exact constant-seconds shift when the tempo is constant. Rollback restores
// a verbatim snapshot rather than inverting, because the beatOf∘timeOf round
// trip is not bit-reversible.
//
// Browser surface: NONE — importable and runnable under node with no DOM, like
// src/commands.js. It touches only S, the pure region math, and the two beat
// converters.
// ════════════════════════════════════════════════════════════════════
import { beatOf, timeOf } from './beats.js';
import {
    DEFAULT_REGION_ID, _nextRegionIdPure, _regionContainsBeatPure, _regionRemapPure,
    _trackRegionsNormalizePure, _trackRegionsResolvePure,
} from './region.js';
import { S } from './state.js';

// A placed region's window must strictly CONTAIN the last onset it owns
// (membership is [startBeat, startBeat+lenBeat) — end-exclusive). When every
// contained note has zero sustain the content end equals the last onset, so the
// naive span would put that onset exactly on the excluded edge; pad the length
// by this sub-cent-of-a-beat guard so the region keeps owning its own notes.
const REGION_LEN_GUARD = 1e-4;

// ── Content/track access shared by all region commands ────────────────
// A song can hold SEVERAL drum parts (each type:"drums" arrangement OWNS its
// `.drumTab`; `S.drumTab` is only the ACTIVE grid target) — so a drums region
// command must act on the tab of the part whose TRACK carries the region, not
// whichever part happens to be active. `arrIdx >= 0` names that part;
// `arrIdx < 0` is the legacy unmaterialized tab (create-mode compose), which
// IS `S.drumTab`. Same resolution the lane silhouette paints by.
function _drumTabFor(arrIdx) {
    const arr = Number.isInteger(arrIdx) && arrIdx >= 0 && S.arrangements ? S.arrangements[arrIdx] : null;
    return (arr && arr.drumTab) || S.drumTab;
}
function _contentList(kind, arrIdx) {
    if (kind === 'drums') {
        const tab = _drumTabFor(arrIdx);
        return (tab && Array.isArray(tab.hits)) ? tab.hits : null;
    }
    const arr = S.arrangements && S.arrangements[arrIdx];
    return arr && Array.isArray(arr.notes) ? arr.notes : null;
}
function _timeOfItem(kind, item) { return kind === 'drums' ? item.t : item.time; }
function _findTrack(trackId) {
    const tracks = S.trackSession && Array.isArray(S.trackSession.tracks) ? S.trackSession.tracks : null;
    return tracks ? tracks.find(t => t && t.id === trackId) : null;
}
// Snapshot a track's raw `regions` (absent or an array) so rollback restores it
// EXACTLY — including deleting a key that was never there.
function _snapRegions(track) {
    return {
        taken: true,
        hadKey: Object.prototype.hasOwnProperty.call(track, 'regions'),
        value: track.regions,
    };
}
function _restoreRegions(track, snap) {
    if (!snap.taken || !track) return;
    if (snap.hadKey) track.regions = snap.value; else delete track.regions;
}

export class MoveRegionCmd {
    // `kind`: 'notation' shifts S.arrangements[arrIdx].notes; 'drums' shifts the
    // hits of the drum part `arrIdx` names (its own `.drumTab`; arrIdx < 0 = the
    // legacy unmaterialized S.drumTab — see _drumTabFor). `region` is the
    // resolved region object being moved (its id locates it in the track's
    // regions[]); `dBeat` is the snapped bar/beat distance of the drag.
    constructor({ kind, arrIdx, trackId, region, dBeat }) {
        this.kind = kind;
        this.arrIdx = arrIdx;
        this.trackId = trackId;
        this.region = region || {};
        this.dBeat = Number(dBeat) || 0;
        // A region move changes only WHEN content plays, never its pitch, so it
        // passes the read-only-roll edit lock like the sustain/position edits.
        this.pitchPreserving = true;
        // Drum content is song-level (like every drum command); a notation move
        // is arr-scoped so ensureArr can return to the right part on undo.
        this.songScope = kind === 'drums';
        this._snap = null;         // [{ item, time, sustain }] verbatim pre-move values
        this._before = null;       // ref-order snapshot of the content array
        this._regionBefore = { taken: false, hadKey: false, value: undefined };
    }

    // A bounded region carries its own placement (a window past beat 0, a
    // trimmed length, or an audio in-point) — its startBeat must ride the move.
    // The implicit default full-span region has no placement of its own: its
    // block follows the content extent, so shifting the content alone moves it
    // and it stays default (untouched packs stay byte-identical).
    _bounded() {
        const r = this.region;
        return r.lenBeat != null || (Number(r.startBeat) || 0) > 0 || r.srcIn != null;
    }

    _list() { return _contentList(this.kind, this.arrIdx); }

    _timeOf(item) { return this.kind === 'drums' ? item.t : item.time; }

    // The content items this region's window owns (membership by beat, resolved
    // through the single tempo map). The default full-span window returns every
    // item, so a whole-track slide and a bounded-region move share one path.
    _contained(list) {
        const out = [];
        for (const item of list) {
            const beat = beatOf(S.beats, Number(this._timeOf(item)) || 0);
            if (_regionContainsBeatPure(this.region, beat)) out.push(item);
        }
        return out;
    }

    exec() {
        if (this.dBeat === 0) return;                    // zero-delta: a true no-op
        const list = this._list();
        if (!list) return;
        this._before = list.slice();                     // exact order for rollback
        const targets = this._contained(list);
        if (this.kind === 'drums') {
            this._snap = targets.map(h => ({ item: h, time: h.t, sustain: 0 }));
            const { times } = _regionRemapPure(
                targets.map(h => h.t), null, this.dBeat, S.beats, beatOf, timeOf);
            targets.forEach((h, i) => { h.t = times[i]; });
            list.sort((a, b) => (a.t || 0) - (b.t || 0));
            S.drumTabDirty = true;
        } else {
            this._snap = targets.map(n => ({ item: n, time: n.time, sustain: n.sustain || 0 }));
            const { times, sustains } = _regionRemapPure(
                targets.map(n => n.time), targets.map(n => n.sustain || 0),
                this.dBeat, S.beats, beatOf, timeOf);
            targets.forEach((n, i) => { n.time = times[i]; n.sustain = sustains[i]; });
            list.sort((a, b) => (a.time || 0) - (b.time || 0));
        }
        this._shiftRegion();
    }

    rollback() {
        if (this.dBeat === 0) return;
        const list = this._list();
        if (!list) return;
        // Restore each moved item's verbatim pre-move values (the beat round trip
        // is not bit-reversible, so never invert), then restore the exact order.
        if (this.kind === 'drums') {
            for (const s of this._snap) s.item.t = s.time;
            S.drumTabDirty = true;
        } else {
            for (const s of this._snap) { s.item.time = s.time; s.item.sustain = s.sustain; }
        }
        list.length = 0;
        for (const item of this._before) list.push(item);
        this._unshiftRegion();
    }

    _track() {
        const tracks = S.trackSession && Array.isArray(S.trackSession.tracks) ? S.trackSession.tracks : null;
        return tracks ? tracks.find(t => t && t.id === this.trackId) : null;
    }

    // Ride the bounded window's startBeat by dBeat, so it keeps owning the same
    // notes after the move. Snapshot the track's raw `regions` (absent or an
    // array) so rollback restores it exactly — including deleting a key that was
    // never there. A default region never reaches here (see _bounded).
    _shiftRegion() {
        if (!this._bounded()) return;
        const track = this._track();
        if (!track) return;
        this._regionBefore = {
            taken: true,
            hadKey: Object.prototype.hasOwnProperty.call(track, 'regions'),
            value: track.regions,
        };
        const moved = _trackRegionsResolvePure(track.regions).map(r => (
            r.id === this.region.id
                ? { ...r, startBeat: Math.max(0, (Number(r.startBeat) || 0) + this.dBeat) }
                : r
        ));
        track.regions = _trackRegionsNormalizePure(moved);
    }

    _unshiftRegion() {
        if (!this._regionBefore.taken) return;
        const track = this._track();
        if (!track) return;
        if (this._regionBefore.hadKey) track.regions = this._regionBefore.value;
        else delete track.regions;
    }
}

// ════════════════════════════════════════════════════════════════════
// PlaceRegionCmd — drop freshly-added track content onto the timeline as a
// BOUNDED, selectable, draggable block (the "Add Track from File" driver).
//
// The import adopts the new part at its source timing (typically beat 0); this
// command then, as ONE undoable edit: (1) slides all of that content so its
// first onset lands on `startBeat` (a MUSICAL move — mirrors MoveRegionCmd, so
// a varying grid preserves beats, not seconds), and (2) writes a bounded region
// covering it onto the track and selects it. Placing at bar 1 (startBeat 0)
// still yields a bounded region (explicit lenBeat) — never the implicit default
// — so the block is a distinct, addressable object you can drag/delete, unlike
// a whole-track default slide.
//
// Undo restores a verbatim content snapshot (the beat round trip isn't bit-
// reversible), the track's raw `regions` (incl. deleting a key that wasn't
// there), and the prior selection. Browser surface: NONE (node-runnable).
// ════════════════════════════════════════════════════════════════════
export class PlaceRegionCmd {
    // `kind`: 'notation' places S.arrangements[arrIdx].notes; 'drums' places
    // S.drumTab.hits. `startBeat` is the snapped bar/beat the block lands on.
    // `regionId`/`name` are optional (id defaults to the track's next free one).
    constructor({ kind, arrIdx, trackId, startBeat, regionId, name, items } = {}) {
        this.kind = kind;
        this.arrIdx = arrIdx;
        this.trackId = trackId;
        this.startBeat = Math.max(0, Number(startBeat) || 0);
        this.regionId = (typeof regionId === 'string' && regionId.trim()) ? regionId.trim() : null;
        this.name = (typeof name === 'string' && name.trim()) ? name.trim().slice(0, 120) : null;
        this.items = Array.isArray(items) ? items.slice() : null;
        // A placement changes only WHEN content plays, never pitch — passes the
        // read-only-roll lock like MoveRegionCmd. Drum content is song-level.
        this.pitchPreserving = true;
        this.songScope = kind === 'drums';
        this._before = null;        // ref-order snapshot of the content array
        this._snap = null;          // [{ item, time, sustain }] verbatim pre-move
        this._regionBefore = { taken: false, hadKey: false, value: undefined };
        this._sel = { taken: false, track: '', region: '' };
        this._placedId = '';
    }

    exec() {
        const track = _findTrack(this.trackId);
        if (!track) return;
        const list = _contentList(this.kind, this.arrIdx);
        if (!list || !list.length) return;                 // nothing to place
        const itemSet = this.items ? new Set(this.items) : null;
        const targets = itemSet
            ? list.filter(it => itemSet.has(it))
            : list;
        if (!targets.length) return;
        this._before = list.slice();
        const isDrums = this.kind === 'drums';
        const times = targets.map(it => Number(_timeOfItem(this.kind, it)) || 0);
        const sustains = targets.map(it => (isDrums ? 0 : Math.max(0, Number(it.sustain) || 0)));
        // Beat extent of the content as imported (independent of the shift — a
        // musical move preserves beat span, so lenBeat is computed once here).
        let minBeat = Infinity; let maxOnset = -Infinity; let maxEnd = -Infinity;
        for (let i = 0; i < times.length; i++) {
            const ob = beatOf(S.beats, times[i]);
            const eb = sustains[i] > 0 ? beatOf(S.beats, times[i] + sustains[i]) : ob;
            if (ob < minBeat) minBeat = ob;
            if (ob > maxOnset) maxOnset = ob;
            if (eb > maxEnd) maxEnd = eb;
        }
        if (!Number.isFinite(minBeat)) return;
        const dBeat = this.startBeat - minBeat;
        const onsetSpan = Math.max(0, maxOnset - minBeat);
        let lenBeat = maxEnd - minBeat;
        if (!(lenBeat > onsetSpan)) lenBeat = onsetSpan + REGION_LEN_GUARD;
        const existing = _trackRegionsNormalizePure(track.regions);
        const existingIds = new Set(existing.map(region => region.id));
        existingIds.add(DEFAULT_REGION_ID);
        this._placedId = this.regionId && !existingIds.has(this.regionId)
            ? this.regionId
            : _nextRegionIdPure(existing);
        const region = { id: this._placedId, startBeat: this.startBeat, lenBeat };
        if (this.name) region.name = this.name;
        const nextRegions = _trackRegionsNormalizePure([...existing, region]);
        if (!nextRegions.some(item => item.id === this._placedId)) return;

        this._snap = targets.map((it, i) => ({ item: it, time: times[i], sustain: sustains[i] }));
        // Slide the content (skip the beat round trip when it wouldn't move —
        // routing dBeat 0 through beats perturbs every note by an epsilon).
        if (dBeat !== 0) {
            const { times: nt, sustains: ns } = _regionRemapPure(times, sustains, dBeat, S.beats, beatOf, timeOf);
            if (isDrums) {
                targets.forEach((h, i) => { h.t = nt[i]; });
                list.sort((a, b) => (a.t || 0) - (b.t || 0));
            } else {
                targets.forEach((n, i) => { n.time = nt[i]; n.sustain = ns[i]; });
                list.sort((a, b) => (a.time || 0) - (b.time || 0));
            }
        }
        if (isDrums) S.drumTabDirty = true;
        // The bounded window covering the placed content (guarded so a zero-
        // sustain tail onset stays strictly inside — see REGION_LEN_GUARD).
        this._regionBefore = _snapRegions(track);
        track.regions = nextRegions;
        // Land selected — a placed region arrives ready to drag (design R3).
        this._sel = { taken: true, track: S.selectedTrackId, region: S.selectedRegionId };
        S.selectedTrackId = this.trackId;
        S.selectedRegionId = this._placedId;
    }

    rollback() {
        const list = _contentList(this.kind, this.arrIdx);
        if (list && this._snap) {
            if (this.kind === 'drums') {
                for (const s of this._snap) s.item.t = s.time;
                S.drumTabDirty = true;
            } else {
                for (const s of this._snap) { s.item.time = s.time; s.item.sustain = s.sustain; }
            }
            list.length = 0;
            for (const it of this._before) list.push(it);
        }
        _restoreRegions(_findTrack(this.trackId), this._regionBefore);
        if (this._sel.taken) { S.selectedTrackId = this._sel.track; S.selectedRegionId = this._sel.region; }
    }
}

// ════════════════════════════════════════════════════════════════════
// DeleteRegionCmd — remove a region block: the content its window owns AND the
// region entry, as one undoable edit. Membership is by beat through the single
// tempo map (the same predicate the move/place commands use), so it deletes
// exactly the notes/hits under the block and leaves neighbours untouched.
// Rollback re-adds the removed items in their original array order and restores
// the track's raw `regions` and the prior selection. Browser surface: NONE.
// ════════════════════════════════════════════════════════════════════
export class DeleteRegionCmd {
    constructor({ kind, arrIdx, trackId, region } = {}) {
        this.kind = kind;
        this.arrIdx = arrIdx;
        this.trackId = trackId;
        this.region = region || {};
        // Removing a block changes no surviving note's pitch; song-level for drums.
        this.pitchPreserving = true;
        this.songScope = kind === 'drums';
        this._before = null;
        this._regionBefore = { taken: false, hadKey: false, value: undefined };
        this._sel = { taken: false, track: '', region: '' };
    }

    exec() {
        const regionId = typeof this.region.id === 'string' ? this.region.id.trim() : '';
        if (!regionId || regionId.length > 160) return;
        const track = _findTrack(this.trackId);
        if (!track) return;
        const list = _contentList(this.kind, this.arrIdx);
        if (!list) return;
        this._before = list.slice();
        const keep = [];
        for (const it of list) {
            const beat = beatOf(S.beats, Number(_timeOfItem(this.kind, it)) || 0);
            if (!_regionContainsBeatPure(this.region, beat)) keep.push(it);
        }
        list.length = 0;
        for (const it of keep) list.push(it);
        if (this.kind === 'drums') S.drumTabDirty = true;
        this._regionBefore = _snapRegions(track);
        const remaining = _trackRegionsNormalizePure(track.regions).filter(r => r.id !== regionId);
        track.regions = _trackRegionsNormalizePure(remaining);
        this._sel = { taken: true, track: S.selectedTrackId, region: S.selectedRegionId };
        if (S.selectedRegionId === this.region.id) S.selectedRegionId = '';
    }

    rollback() {
        const list = _contentList(this.kind, this.arrIdx);
        if (list && this._before) {
            list.length = 0;
            for (const it of this._before) list.push(it);
            if (this.kind === 'drums') S.drumTabDirty = true;
        }
        _restoreRegions(_findTrack(this.trackId), this._regionBefore);
        if (this._sel.taken) { S.selectedTrackId = this._sel.track; S.selectedRegionId = this._sel.region; }
    }
}

// ════════════════════════════════════════════════════════════════════
// TrimRegionCmd — adjust a region's WINDOW only, never its content
// (track-regions PR4). For an AUDIO region: srcIn/srcOut, the immutable media
// in/out points in the file's OWN seconds (the buffer is never stretched — trim
// is expressed to the scheduler purely as _regionStartPure start()/duration
// args). For a NOTATION region: startBeat/lenBeat, the beat window; notes that
// fall outside the trimmed window are HIDDEN (no longer owned by the region),
// never deleted — a later widen brings them straight back. Container-only: it
// touches nothing but track.regions[], so no editGen/content churn. Rollback
// restores the raw regions[] verbatim (incl. deleting a key that was never
// there). Node-runnable (no DOM). Test: tests/region_trim.test.mjs.
// ════════════════════════════════════════════════════════════════════

// Whitelist the window fields a trim may set, coercing each to a finite number
// or an explicit null (which _trackRegionsNormalizePure reads as "clear this
// bound"). Unknown / NaN / non-numeric fields are dropped so a trim can never
// smuggle content or junk onto a region.
const _TRIM_FIELDS = ['startBeat', 'lenBeat', 'srcIn', 'srcOut'];
export function _trimPatchPure(patch) {
    const out = {};
    if (!patch || typeof patch !== 'object') return out;
    for (const k of _TRIM_FIELDS) {
        if (!(k in patch)) continue;
        const v = patch[k];
        if (v === null) out[k] = null;
        else if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
    }
    return out;
}

export class TrimRegionCmd {
    // `patch` carries the new window fields (startBeat/lenBeat for notation,
    // srcIn/srcOut for audio); only whitelisted, finite (or explicit-null)
    // values survive, then _trackRegionsNormalizePure clamps/sorts the result.
    constructor({ trackId, regionId, patch } = {}) {
        this.trackId = trackId;
        this.regionId = regionId;
        this.patch = _trimPatchPure(patch);
        // Window-only: changes WHAT/WHEN a region covers, never a note's pitch,
        // so it passes the read-only-roll edit lock like the move/place verbs.
        this.pitchPreserving = true;
        // The window lives on the track container (song-level), not an arrangement.
        this.songScope = true;
        this._regionBefore = { taken: false, hadKey: false, value: undefined };
    }

    exec() {
        const track = _findTrack(this.trackId);
        if (!track) return;
        if (!Object.keys(this.patch).length) return;   // no valid fields → true no-op
        const resolved = _trackRegionsResolvePure(track.regions);
        // Unknown region id → no-op; never materialize the implicit default just
        // to write nothing (keeps untouched packs byte-identical).
        if (!resolved.some(r => r.id === this.regionId)) return;
        this._regionBefore = _snapRegions(track);
        const trimmed = resolved.map(r => (
            r.id === this.regionId ? { ...r, ...this.patch } : r
        ));
        track.regions = _trackRegionsNormalizePure(trimmed);
    }

    rollback() {
        _restoreRegions(_findTrack(this.trackId), this._regionBefore);
    }
}
