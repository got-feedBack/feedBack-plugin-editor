// ════════════════════════════════════════════════════════════════════
// Region model — a track's content as placeable blocks on the timeline.
//
// A region is a WINDOW, never a copy. A notation/MIDI region windows the
// arrangement's ONE `notes[]` array by beat (it must never own a private
// note-bag — that would fork `note.beat`-as-truth); an audio region points
// into immutable media (a beat-grid start plus an in/out trim in the file's
// own seconds, never time-stretched). This is the data model + migration
// layer only (PR 1): every track resolves to a SINGLE default full-span
// region until a later PR creates bounded ones, so nothing about rendering,
// playback, or /build changes yet.
//
// Region shape (all fields optional except id):
//   { id, startBeat, lenBeat, srcIn?, srcOut?, name?, muted? }
//     - startBeat : grid position in beats (truth; derives seconds via timeOf)
//     - lenBeat   : notation window length in beats; null = to end of content
//     - srcIn/Out : audio trim into the immutable media, in the file's SECONDS
//                   (present only on trimmed audio regions)
//     - name/muted: optional label / per-region mute
//
// The default region — startBeat 0, no length, no trim — represents the whole
// track content implicitly, so it needs neither the source duration nor the
// note extent to synthesize. A track whose only region is the default persists
// as NO `regions` key, so untouched packs stay byte-identical (mirrors the
// track-session "default tree → no manifest key" rule).
// ════════════════════════════════════════════════════════════════════

export const DEFAULT_REGION_ID = 'region:1';
const MAX_REGIONS = 200;

function _regionIdPure(value) {
    if (typeof value !== 'string') return '';
    const trimmed = value.trim();
    return trimmed.length > 0 && trimmed.length <= 160 ? trimmed : '';
}
function _nonNegNumPure(value, fallback) {
    const n = Number(value);
    return Number.isFinite(n) && n >= 0 ? n : fallback;
}
function _posNumOrNullPure(value) {
    if (value == null) return null;
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : null;
}

// The implicit full-span region: start at beat 0, no length (runs to the end
// of the underlying content). Type-agnostic — audio and notation share it
// until a trim/split creates a bounded region.
export function _defaultRegionPure() {
    return { id: DEFAULT_REGION_ID, startBeat: 0, lenBeat: null };
}

// Validate one persisted region into a determinate shape, or null if unusable.
// Optional fields are emitted ONLY when meaningfully set, so a default region
// normalizes back to exactly `{ id, startBeat: 0, lenBeat: null }`.
export function _regionNormalizePure(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const id = _regionIdPure(raw.id);
    if (!id) return null;
    const out = { id, startBeat: _nonNegNumPure(raw.startBeat, 0), lenBeat: _posNumOrNullPure(raw.lenBeat) };
    // Audio trim: present as a pair when either endpoint is set. srcIn defaults
    // to 0; srcOut is kept only when it lies strictly after srcIn, else null
    // ("to end of media") — a degenerate window must never invert.
    if (raw.srcIn != null || raw.srcOut != null) {
        const srcIn = _nonNegNumPure(raw.srcIn, 0);
        const srcOut = _posNumOrNullPure(raw.srcOut);
        out.srcIn = srcIn;
        out.srcOut = srcOut != null && srcOut > srcIn ? srcOut : null;
    }
    if (typeof raw.name === 'string' && raw.name.trim()) out.name = raw.name.trim().slice(0, 120);
    if (raw.muted === true) out.muted = true;
    return out;
}

// Normalize a persisted regions[]: validate each, drop the unusable, dedupe by
// id, sort by startBeat (then id for a stable order). Idempotent.
export function _trackRegionsNormalizePure(raw) {
    const list = Array.isArray(raw) ? raw : [];
    const out = [];
    const seen = new Set();
    for (const item of list.slice(0, MAX_REGIONS)) {
        const region = _regionNormalizePure(item);
        if (!region || seen.has(region.id)) continue;
        seen.add(region.id);
        out.push(region);
    }
    out.sort((a, b) => a.startBeat - b.startBeat || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    return out;
}

// Is this regions[] just the implicit default — absent/empty, or a lone
// full-span region with no trim/label/mute? A default set persists as NO
// `regions` key so untouched packs stay byte-identical across saves.
export function _regionsAreDefaultPure(raw) {
    const norm = _trackRegionsNormalizePure(raw);
    if (norm.length === 0) return true;
    if (norm.length !== 1) return false;
    const r = norm[0];
    return r.startBeat === 0 && r.lenBeat == null && r.srcIn == null && r.srcOut == null
        && r.name == null && r.muted == null;
}

// The EFFECTIVE regions of a track: its persisted set, or one default full-span
// region when it has none. This is the migration seam — an old pack (no
// `regions`) resolves to exactly one full region per track, identical to today.
export function _trackRegionsResolvePure(raw) {
    const norm = _trackRegionsNormalizePure(raw);
    return norm.length ? norm : [_defaultRegionPure()];
}

// Membership predicate: does a beat fall inside the region's window? startBeat
// inclusive, startBeat+lenBeat exclusive; lenBeat null = open to the end of
// content. This is the primitive a later move/trim command uses to select "the
// notes this region owns" — without ever copying them out of the one notes[].
export function _regionContainsBeatPure(region, beat) {
    if (!region || typeof region !== 'object') return false;
    const b = Number(beat);
    if (!Number.isFinite(b)) return false;
    const start = Number(region.startBeat) || 0;
    if (b < start) return false;
    if (region.lenBeat == null) return true;
    const len = Number(region.lenBeat);
    if (!Number.isFinite(len) || len <= 0) return true;
    return b < start + len;
}

// ── Layout (for drawing a region as a block on a track lane) ──────────

// The region's TIME span on the timeline, given its lane's content extent
// [contentStart, contentEnd] in seconds. A full-span region (no length, no
// audio trim, at beat 0) spans the whole content; a bounded notation region
// spans [beatToTime(startBeat), beatToTime(startBeat+lenBeat)]. Bounded regions
// arrive with the move/trim PRs — today every region is full-span, so this
// resolves to the content extent, but the bounded path is here so the renderer
// needs no change when they land. `beatToTime` is the beats.js `timeOf`.
export function _regionTimeSpanPure(region, contentStart, contentEnd, beatToTime) {
    const c0 = Number.isFinite(Number(contentStart)) ? Number(contentStart) : 0;
    const c1 = Number.isFinite(Number(contentEnd)) ? Number(contentEnd) : c0;
    const start = Number(region && region.startBeat) || 0;
    const bounded = !!region && (region.lenBeat != null || region.srcIn != null || start > 0);
    if (!bounded) return { t0: c0, t1: Math.max(c0, c1) };
    const b2t = typeof beatToTime === 'function' ? beatToTime : (b => b);
    const t0 = b2t(start);
    const t1 = region.lenBeat != null ? b2t(start + Number(region.lenBeat)) : c1;
    return { t0, t1: Math.max(t0, t1) };
}

// Clamp a region's pixel span [x0, x1] to the visible band [gutter, width].
// `visible` is false when the block is off-screen or collapses to nothing, so
// the caller can skip both the draw and the hit target.
export function _regionBlockRectPure(x0, x1, gutter, width) {
    const g = Number(gutter) || 0;
    const wMax = Number(width) || 0;
    const lo = Math.max(g, Math.min(x0, x1));
    const hi = Math.min(wMax, Math.max(x0, x1));
    const w = hi - lo;
    return { x: lo, w: Math.max(0, w), visible: w > 0.5 };
}

// Does a canvas x land inside a drawn region block? (Vertical bounds are the
// lane's, tested by the caller before it gets here.)
export function _regionHitPure(rect, x) {
    if (!rect || !rect.visible) return false;
    const n = Number(x);
    return Number.isFinite(n) && n >= rect.x && n <= rect.x + rect.w;
}

// ── Move (reposition) ─────────────────────────────────────────────────

// The exact seconds shift for a beat offset `dBeat` when the tempo is globally
// constant (a uniform grid) or absent (a degenerate < 2-beat grid = seconds-
// primary), else null to signal "remap each note through beats individually".
// Uniform: every consecutive gap is equal, so secondsPerBeat·dBeat is exact and
// carries none of the beatOf∘timeOf round-trip drift. Degenerate: beat == time,
// so the shift simply IS dBeat. This is the fast path that makes the common
// (constant-tempo) region move bit-exact — a round-trip test would otherwise
// fail on sub-microsecond float drift (the same `_r3` drift TempoMapCmd flags).
export function _regionConstantShiftPure(beats, dBeat) {
    if (!Array.isArray(beats) || beats.length < 2) return dBeat;      // seconds-primary
    const g0 = beats[1].time - beats[0].time;
    for (let i = 2; i < beats.length; i++) {
        if (Math.abs((beats[i].time - beats[i - 1].time) - g0) > 1e-9) return null;
    }
    return g0 * dBeat;
}

// Reposition a set of note/hit intervals by a constant beat offset `dBeat`,
// against the tempo map `beats`. A notation/drum region MOVE preserves MUSICAL
// position, not wall-clock seconds (mirrors TempoMapCmd's interval walk): each
// note is the interval [onset, onset+sustain]; both ends remap through beats and
// the new sustain is the reprojected span (never negative), so a beat-filling
// note stays beat-filling and its feel scales to the destination tempo.
//   newTime    = timeOf(beatOf(oldTime) + dBeat)
//   newSustain = timeOf(beatOf(oldTime + oldSustain) + dBeat) - newTime   (>= 0)
// FAST PATH: when the tempo is constant across the grid, collapse to one exact
// seconds shift (a constant shift never changes a duration). `dBeat === 0` is
// the caller's no-op — routing a zero move through beats would perturb every
// note by an epsilon. `beatOf`/`timeOf` are passed in so this stays converter-
// free like the layout pures above. Returns fresh arrays; never mutates input.
// AUDIO regions do NOT use this — their samples are physical seconds, so they
// move by a constant dtime (re-gridding audio would be a time-stretch, a
// separate op); this beat-remap is for notation/drum content only.
export function _regionRemapPure(times, sustains, dBeat, beats, beatOf, timeOf) {
    const n = times.length;
    const outT = new Array(n);
    const outS = new Array(n);
    const shift = _regionConstantShiftPure(beats, dBeat);
    for (let i = 0; i < n; i++) {
        const t = Number(times[i]) || 0;
        const s = Math.max(0, Number(sustains ? sustains[i] : 0) || 0);
        if (shift !== null) {
            outT[i] = t + shift;
            outS[i] = s;                                 // constant shift keeps duration
        } else {
            const nt = timeOf(beats, beatOf(beats, t) + dBeat);
            const ne = s > 0 ? timeOf(beats, beatOf(beats, t + s) + dBeat) : nt;
            outT[i] = nt;
            outS[i] = Math.max(0, ne - nt);
        }
    }
    return { times: outT, sustains: outS };
}

// Snap a region's dragged start time to the nearest bar line (downbeat) — the
// DAW default for regions (Logic/Live snap regions to bars, not subdivisions).
// `free` (the Alt modifier) bypasses snapping for a fine nudge. Never < 0, and
// a chart with no downbeats falls back to the free position.
export function _regionSnapStartPure(downbeats, rawStart, free) {
    const t = Math.max(0, Number(rawStart) || 0);
    if (free || !Array.isArray(downbeats) || !downbeats.length) return t;
    let best = downbeats[0];
    let bestD = Math.abs(Number(best) - t);
    for (const d of downbeats) {
        const dd = Math.abs(Number(d) - t);
        if (dd < bestD) { bestD = dd; best = d; }
    }
    return Math.max(0, Number(best) || 0);
}
