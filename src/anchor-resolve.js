/* Slopsmith Arrangement Editor — resolve-positions-in-window + the sweep
 * (view-modality P8 / VA.7, item 2).
 *
 * The anchor lane itself (render in both views, drag/edit/delete through
 * the anchor command classes) already shipped — this module adds the
 * per-anchor-block ACTION: run the suggest-position resolver over every
 * unresolved note inside an anchor's window, write the repicks as ONE
 * undoable command (notes STAY suggested — the machine picked, the charter
 * confirms), then open a sweep: walk note-by-note (Enter accepts, ←/→
 * moves, A accepts all, Esc done). Accepts are individual mark-clears
 * through the existing AcceptPositionsCmd, so each is its own cheap undo.
 *
 * "Unresolved" means suggested-marked: the mark IS the editor's unresolved
 * state (a note with a confirmed position was either authored by hand or
 * explicitly accepted — the resolver never touches those). Refusals are
 * honored absolutely: a note the resolver refuses (out of range, string
 * occupied, outside the window, singleton open-vs-fretted ambiguity) keeps
 * its current position and its mark — named in the status line, never
 * guessed. The one deliberate exception: a chord GRIP may voice a note open
 * where a fretted alternative existed ("use opens, flag for review") — the
 * pick is flagged `ambiguousOpen`, walked in the sweep like everything else,
 * and excluded from "Accept all" so only an individual look confirms it.
 */

import { S } from './state.js';
import { host } from './host.js';
import { setStatus } from './ui.js';
import { _isSuggested, notes } from './notes.js';
import { _activeAnchorAtPure, _resolveChordGripPure, _suggestFingersPure, _suggestPositionPure } from './position.js';
import { LINT_CLUSTER_EPSILON, LINT_DEFAULT_WINDOW, LINT_STRETCH_TOLERANCE } from './playability-lint.js';
import { _openMidiForArr, _soundingPitchPure, _stringCountFor } from './lanes.js';
import { AcceptPositionsCmd, SetTeachingMarksCmd, _prevNoteBefore } from './commands.js';
import { isKeysMode } from './keys.js';

/* @pure:anchor-resolve:start */

// The active anchor list — authored wins, computed falls back. Local copy
// of the 3-line dual-list precedence (annotation-lanes owns the UI version;
// importing it here would close a cycle since the lane imports this module).
export function _resolveAnchorsPure(arr) {
    if (!arr) return [];
    if (Array.isArray(arr.anchors_user) && arr.anchors_user.length) return arr.anchors_user;
    return Array.isArray(arr.anchors) ? arr.anchors : [];
}

// An anchor's window: from its time to the next anchor's time (Infinity for
// the last). The list need not be sorted.
export function _anchorWindowPure(anchors, anchor) {
    if (!anchor || !Number.isFinite(anchor.time)) return null;
    let end = Infinity;
    for (const a of anchors || []) {
        if (!a || !Number.isFinite(a.time) || a === anchor) continue;
        if (a.time > anchor.time + 1e-6 && a.time < end) end = a.time;
    }
    return { start: anchor.time, end };
}

// Resolve every unresolved (suggested) note inside the window, in time
// order. Returns { moves, refused, targets, ambiguousOpen }:
//   moves    [{ index, oldString, oldFret, newString, newFret, ambiguousOpen? }]
//            — repicks (identity repicks are dropped; nothing to write).
//   refused  [{ index, reason }] — the resolver said no; never guessed.
//   targets  every unresolved index in the window (the sweep list).
//   ambiguousOpen  [index] — notes a grip voiced OPEN where a fretted
//            alternative existed ("use opens, flag for review"). Listed even
//            when the pick was an identity repick (no move written), because
//            the exclusion from bulk accept must not depend on whether the
//            note happened to already sit on the open string.
// Occupancy mirrors the roll writer: a note can't share a string with any
// other note sounding at its instant; earlier repicks in this same pass
// claim their new strings for later ones.
//
// Simultaneous notes (a CHORD) are resolved JOINTLY as one coherent grip
// (_resolveChordGripPure) — minimum fretted span within the hand — instead of
// each note greedily picking its own lowest fret and spreading the chord until
// the stretch lint scolds it. A cluster with no coherent grip (or a single
// note) falls back to the per-note resolver, so behaviour never regresses.
export function _resolveWindowPure(nn, win, anchors, ctx, isSuggestedFn) {
    const out = { moves: [], refused: [], targets: [], ambiguousOpen: [] };
    if (!Array.isArray(nn) || !win || !ctx) return out;
    const isSug = typeof isSuggestedFn === 'function' ? isSuggestedFn : () => false;
    const targets = nn.map((n, i) => ({ n, i }))
        .filter(({ n }) => n && Number.isFinite(n.time)
            && n.time >= win.start - 1e-6 && n.time < win.end - 1e-6 && isSug(n))
        .sort((a, b) => a.n.time - b.n.time);
    out.targets = targets.map(({ i }) => i);
    if (!targets.length) return out;

    // Working assignment: current positions, updated as repicks land — the
    // occupancy AND the least-travel hand reference both see in-pass state,
    // so note k's repick informs note k+1's tie-break (CodeRabbit, #201).
    const strOf = new Map();
    const fretOf = new Map();
    nn.forEach((n, i) => { if (n) { strOf.set(i, n.string); fretOf.set(i, n.fret); } });

    // Strings occupied at `n`'s instant by notes OUTSIDE `exceptIdxs` (a Set of
    // this cluster's indices), using the in-pass working positions.
    const occupiedFor = (n, exceptIdxs) => {
        const nEnd = n.time + (Number(n.sustain) || 0);
        const occ = new Set();
        nn.forEach((o, j) => {
            if (exceptIdxs.has(j) || !o || !Number.isFinite(o.time)) return;
            const oEnd = o.time + (Number(o.sustain) || 0);
            if (n.time <= oEnd + 1e-6 && nEnd >= o.time - 1e-6) occ.add(strOf.get(j));
        });
        return occ;
    };
    // The prior hand fret before `time` (excluding `exceptIdx`), read through the
    // in-pass repicks so a cluster sees the hand its predecessors just moved to.
    const prevFretAt = (time, exceptIdx) => {
        if (!ctx.prevFretAt) return null;
        const p = ctx.prevFretAt(time, exceptIdx);
        if (!p || !Number.isFinite(p.fret)) return null;
        return fretOf.has(p.idx) ? fretOf.get(p.idx) : p.fret;
    };
    const recordMove = (i, n, newString, newFret, ambiguousOpen) => {
        if (newString === n.string && newFret === n.fret) {
            // already where the resolver wants it — still claim the string
            strOf.set(i, newString); fretOf.set(i, newFret);
            return;
        }
        const m = { index: i, oldString: n.string, oldFret: n.fret, newString, newFret };
        if (ambiguousOpen) m.ambiguousOpen = true;
        out.moves.push(m);
        strOf.set(i, newString); fretOf.set(i, newFret);
    };
    // Per-note greedy resolve (the pre-existing policy; the fallback path). It
    // excludes only the note ITSELF from occupancy, so a cluster's siblings still
    // block each other's strings through their in-pass working positions —
    // exactly the original per-note behaviour.
    const resolveOne = (n, i) => {
        const pitch = _soundingPitchPure(ctx.openMidi, ctx.tuning, ctx.capo, n.string, n.fret);
        if (pitch === null) { out.refused.push({ index: i, reason: 'out-of-range' }); return; }
        const occ = occupiedFor(n, new Set([i]));
        const pf = prevFretAt(n.time, i);
        const prev = pf !== null ? { fret: pf } : null;
        const res = _suggestPositionPure(pitch, n.time, prev, anchors, occ, ctx);
        if (!res.resolved) { out.refused.push({ index: i, reason: res.reason }); return; }
        recordMove(i, n, res.resolved.string, res.resolved.fret);
    };

    // Walk in time order, grouping simultaneous notes into chord clusters.
    let gi = 0;
    while (gi < targets.length) {
        const t0 = targets[gi].n.time;
        const group = [];
        while (gi < targets.length && targets[gi].n.time <= t0 + LINT_CLUSTER_EPSILON) { group.push(targets[gi]); gi++; }
        const groupIdx = new Set(group.map(g => g.i));

        if (group.length >= 2) {
            // Try one coherent grip for the whole cluster.
            const clusterPitches = [];
            let allSound = true;
            for (const { n, i } of group) {
                const pitch = _soundingPitchPure(ctx.openMidi, ctx.tuning, ctx.capo, n.string, n.fret);
                if (pitch === null) { allSound = false; break; }
                clusterPitches.push({ idx: i, pitch });
            }
            if (allSound) {
                const anchor = _activeAnchorAtPure(anchors, t0);
                // `hand`, not `window` — a local named `window` shadows the browser
                // global for the whole block, which is a trap waiting for the next edit.
                const hand = anchor && Number.isFinite(anchor.width) && anchor.width > 0 ? anchor.width : LINT_DEFAULT_WINDOW;
                const cfg = {
                    anchorFret: anchor && Number.isFinite(anchor.fret) ? anchor.fret : null,
                    window: hand,
                    maxSpan: hand + LINT_STRETCH_TOLERANCE,
                };
                // Occupancy from non-cluster notes overlapping the cluster; the
                // grip enforces distinct strings among the cluster itself.
                const occ = occupiedFor(group[0].n, groupIdx);
                for (let j = 1; j < group.length; j++) for (const s of occupiedFor(group[j].n, groupIdx)) occ.add(s);
                const grip = _resolveChordGripPure(clusterPitches, ctx, cfg, prevFretAt(t0, group[0].i), occ);
                if (grip) {
                    for (const a of grip.assignments) {
                        recordMove(a.idx, nn[a.idx], a.string, a.fret, a.ambiguousOpen);
                        if (a.ambiguousOpen) out.ambiguousOpen.push(a.idx);
                    }
                    continue;   // cluster handled jointly
                }
            }
            // No coherent grip → fall back to per-note greedy for each cluster note.
            for (const { n, i } of group) resolveOne(n, i);
            continue;
        }
        // Singleton.
        resolveOne(group[0].n, group[0].i);
    }
    return out;
}

// The sweep cursor: 'next'/'accept' advance, 'prev' steps back, past the
// end → null (done). Pure so the walk order is pinned by test.
export function _sweepStepPure(len, cur, action) {
    if (!Number.isFinite(len) || len <= 0) return null;
    if (action === 'prev') return Math.max(0, cur - 1);
    const next = cur + 1;
    return next < len ? next : null;
}

// Which refs "Accept all" confirms: still-suggested AND actually placed by the
// resolver. A REFUSED note (in `refusedSet`) was never re-fingered, so a bulk
// accept must NOT clear its mark — it stays suggested and keeps counting in the
// honest "positions unresolved: N" gap. An ambiguous OPEN voicing rides the
// same gate (callers put those refs in the same set): the machine made a real
// articulation choice, so only an individual look may confirm it. Single-note
// accept (a deliberate look at one note) is unaffected; this only gates the
// bulk verb.
export function _acceptAllRefsPure(refs, from, refusedSet, isSug) {
    const sug = typeof isSug === 'function' ? isSug : () => false;
    return (refs || []).slice(from)
        .filter((r) => sug(r) && !(refusedSet && refusedSet.has(r)));
}
/* @pure:anchor-resolve:end */

// One undoable command for the bulk repick. Notes KEEP their suggested
// marks — a bulk resolve is still the machine picking; the sweep's accepts
// (AcceptPositionsCmd) are the confirmations. Pitch-preserving by
// construction, so it passes the read-only-roll lock.
export class ResolveWindowCmd {
    constructor(moves) { this.moves = moves; this.pitchPreserving = true; }
    exec() {
        const nn = notes();
        for (const m of this.moves) {
            nn[m.index].string = m.newString;
            nn[m.index].fret = m.newFret;
        }
    }
    rollback() {
        const nn = notes();
        for (const m of this.moves) {
            nn[m.index].string = m.oldString;
            nn[m.index].fret = m.oldFret;
        }
    }
}

// ── The sweep (module state + a tiny floating bar) ───────────────────
let sweep = null;   // { refs: [note], reviewOnly: Set<note>, cur: number } | null
                    // reviewOnly = refused + ambiguous-open refs: walked, never bulk-accepted.

const $bar = () => document.getElementById('editor-sweep-bar');

function sweepRender() {
    const bar = $bar();
    if (!bar) return;
    if (!sweep) { bar.classList.add('hidden'); return; }
    bar.classList.remove('hidden');
    const count = document.getElementById('editor-sweep-count');
    if (count) count.textContent = `${sweep.cur + 1}/${sweep.refs.length}`;
}

function sweepFocus() {
    if (!sweep) return;
    const ref = sweep.refs[sweep.cur];
    const idx = notes().indexOf(ref);
    if (idx < 0) { sweepStep('next'); return; }   // note vanished (undo) — move on
    S.sel = new Set([idx]);
    host.editorSeekToTime(ref.time);
    host.updateStatus();
    host.renderInspector();
    host.draw();
    sweepRender();
}

function sweepEnd(msg) {
    sweep = null;
    sweepRender();
    if (msg) setStatus(msg);
    host.draw();
}

function sweepStep(action) {
    if (!sweep) return;
    const next = _sweepStepPure(sweep.refs.length, sweep.cur, action);
    if (next === null) { sweepEnd('Sweep done'); return; }
    sweep.cur = next;
    sweepFocus();
}

function sweepAccept() {
    if (!sweep) return;
    const ref = sweep.refs[sweep.cur];
    if (ref && _isSuggested(ref)) S.history.exec(new AcceptPositionsCmd([ref]));
    sweepStep('next');
}

function sweepAcceptAll() {
    if (!sweep) return;
    // Only confirm notes the resolver placed WITHOUT an open question — refused
    // notes were never re-fingered, and ambiguous open voicings need an
    // individual look; both keep their suggested mark and stay in the honest gap.
    const remaining = _acceptAllRefsPure(sweep.refs, sweep.cur, sweep.reviewOnly, _isSuggested);
    if (remaining.length) S.history.exec(new AcceptPositionsCmd(remaining));
    const held = sweep.refs.slice(sweep.cur).filter((r) => sweep.reviewOnly.has(r) && _isSuggested(r)).length;
    const heldNote = held ? ` · ${held} left for individual review` : '';
    sweepEnd(`Accepted ${remaining.length} position${remaining.length === 1 ? '' : 's'}${heldNote}`);
}

export function _sweepActive() { return !!sweep; }

// ── The per-anchor-block action (called from the lane's context menu) ─
export function editorResolveAnchorWindow(anchor) {
    const arr = S.arrangements && S.arrangements[S.currentArr];
    if (!arr) return;
    const anchors = _resolveAnchorsPure(arr);
    const win = _anchorWindowPure(anchors, anchor);
    if (!win) { setStatus('No window for that anchor'); return; }
    const laneCount = _stringCountFor(arr);
    const tuning = (Array.isArray(arr.tuning) ? arr.tuning : []).slice(0, laneCount);
    while (tuning.length < laneCount) tuning.push(0);
    const ctx = {
        openMidi: _openMidiForArr(arr, laneCount),
        tuning,
        capo: Number(arr.capo) || 0,
        prevFretAt: (t, exceptIdx) => {
            const p = _prevNoteBefore(arr, t, exceptIdx);
            if (!p || !Number.isFinite(p.fret)) return null;
            return { idx: arr.notes.indexOf(p), fret: p.fret };
        },
    };
    const nn = notes();
    const r = _resolveWindowPure(nn, win, anchors, ctx, _isSuggested);
    if (!r.targets.length) { setStatus('No unresolved positions in this window'); return; }
    if (r.moves.length) S.history.exec(new ResolveWindowCmd(r.moves));
    const refusedNote = r.refused.length ? ` · ${r.refused.length} refused (left as-is)` : '';
    const openNote = r.ambiguousOpen.length
        ? ` · ${r.ambiguousOpen.length} open voicing${r.ambiguousOpen.length === 1 ? '' : 's'} to review`
        : '';
    setStatus(`Resolved ${r.moves.length} of ${r.targets.length} in the window${refusedNote}${openNote} — sweep to confirm`);
    // The sweep walks by REF so undo/index shuffles can't derail it. Refused
    // refs are walked (the charter should see them) but never bulk-accepted —
    // and neither is a grip's ambiguous OPEN voicing (an open where a fretted
    // alternative existed): each is confirmed one at a time, in view.
    const reviewOnly = new Set([
        ...r.refused.map((x) => nn[x.index]),
        ...r.ambiguousOpen.map((i) => nn[i]),
    ].filter(Boolean));
    sweep = { refs: r.targets.map((i) => nn[i]).filter(Boolean), reviewOnly, cur: 0 };
    sweepFocus();
}

// Auto-fingering: propose a fret-hand finger (1-4, or none for open strings) for
// every fretted note in the selection (or the whole arrangement when nothing is
// selected), from each note's fret relative to the hand anchor covering its time.
// All the plumbing already existed — the fret_finger teaching mark, its XML
// round-trip, the fretboard-strip display — but nothing ever PROPOSED a finger.
// One undoable SetTeachingMarksCmd; notes outside a reachable hand span are left
// untouched (a different position owns them).
export function editorSuggestFingers() {
    if (isKeysMode()) { setStatus('Fret-hand fingering is for fretted (guitar/bass) parts.'); return; }
    const arr = S.arrangements && S.arrangements[S.currentArr];
    if (!arr) return;
    const anchors = _resolveAnchorsPure(arr);
    const nn = notes();
    const idxs = (S.sel && S.sel.size) ? [...S.sel] : nn.map((_, i) => i);
    const items = [];
    for (const i of idxs) {
        const n = nn[i];
        if (!n || !Number.isFinite(n.fret)) continue;
        const a = _activeAnchorAtPure(anchors, n.time);
        items.push({
            idx: i,
            fret: n.fret,
            anchorFret: a && Number.isFinite(a.fret) ? a.fret : null,
            width: a && Number.isFinite(a.width) ? a.width : 4,
        });
    }
    const assigns = _suggestFingersPure(items);
    if (!assigns.length) {
        setStatus('No fingers to suggest — set an anchor (Shift+F) so notes sit in a hand position, then try again.');
        return;
    }
    S.history.exec(new SetTeachingMarksCmd('fret_finger', assigns));
    host.draw();
    const scope = (S.sel && S.sel.size) ? 'the selection' : 'the arrangement';
    setStatus(`Suggested fret-hand fingers for ${assigns.length} note${assigns.length === 1 ? '' : 's'} in ${scope}.`);
}

export function initAnchorResolve() {
    const bar = $bar();
    if (bar) {
        bar.addEventListener('click', (e) => {
            const t = e.target instanceof Element ? e.target : null;
            if (!t) return;
            if (t.id === 'editor-sweep-accept') sweepAccept();
            else if (t.id === 'editor-sweep-skip') sweepStep('next');
            else if (t.id === 'editor-sweep-prev') sweepStep('prev');
            else if (t.id === 'editor-sweep-all') sweepAcceptAll();
            else if (t.id === 'editor-sweep-done') sweepEnd('Sweep closed');
        });
    }
    // Sweep keys shadow the canvas while active — capture + stopPropagation,
    // teardown-registered.
    host.addGlobalListener(document, 'keydown', (e) => {
        if (!sweep) return;
        // A read-only lens modal (Tab preview, User Guide) sitting over the
        // sweep owns the keyboard: accepting/ending a sweep the charter cannot
        // see would mutate behind the overlay. This handler runs capture-phase,
        // BEFORE onKeyDown's lens gates, so it must bail itself — the event
        // then bubbles to the gates, which swallow or close as usual.
        const lensOpen = ['editor-tab-preview-modal', 'editor-user-guide-modal'].some((id) => {
            const m = document.getElementById(id);
            return !!(m && !m.classList.contains('hidden'));
        });
        if (lensOpen) return;
        // Modifier chords pass through untouched — Ctrl/Cmd+A stays select-all.
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        const k = e.key;
        if (k === 'Enter') { e.preventDefault(); e.stopPropagation(); sweepAccept(); }
        else if (k === 'ArrowRight') { e.preventDefault(); e.stopPropagation(); sweepStep('next'); }
        else if (k === 'ArrowLeft') { e.preventDefault(); e.stopPropagation(); sweepStep('prev'); }
        else if (k === 'a' || k === 'A') { e.preventDefault(); e.stopPropagation(); sweepAcceptAll(); }
        else if (k === 'Escape') { e.preventDefault(); e.stopPropagation(); sweepEnd('Sweep closed'); }
    }, true);
    sweepRender();
}
