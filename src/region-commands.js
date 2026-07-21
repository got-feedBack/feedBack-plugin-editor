// ════════════════════════════════════════════════════════════════════
// Region EditHistory commands — repositioning a track's content as a block.
//
// A region is a WINDOW over content, never a copy (src/region.js). "Move
// region" therefore shifts the CONTENT the window covers — a notation region
// shifts the arrangement's contained notes, a drum region shifts S.drumTab's
// contained hits — as one undoable edit, with the window's own placement riding
// along for a BOUNDED region. It goes through S.history.exec (NOT the
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
    _regionContainsBeatPure, _regionRemapPure, _trackRegionsNormalizePure, _trackRegionsResolvePure,
} from './region.js';
import { S } from './state.js';

export class MoveRegionCmd {
    // `kind`: 'notation' shifts S.arrangements[arrIdx].notes; 'drums' shifts
    // S.drumTab.hits. `region` is the resolved region object being moved (its id
    // locates it in the track's regions[]); `dBeat` is the snapped bar/beat
    // distance of the drag.
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

    _list() {
        if (this.kind === 'drums') {
            return (S.drumTab && Array.isArray(S.drumTab.hits)) ? S.drumTab.hits : null;
        }
        const arr = S.arrangements && S.arrangements[this.arrIdx];
        return arr && Array.isArray(arr.notes) ? arr.notes : null;
    }

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
