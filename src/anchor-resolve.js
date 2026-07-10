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
 * occupied, outside the window, open-vs-fretted ambiguity) keeps its
 * current position and its mark — named in the status line, never guessed.
 */

import { S } from './state.js';
import { host } from './host.js';
import { setStatus } from './ui.js';
import { _isSuggested, notes } from './notes.js';
import { _suggestPositionPure } from './position.js';
import { _openMidiForArr, _soundingPitchPure, _stringCountFor } from './lanes.js';
import { AcceptPositionsCmd, _prevNoteBefore } from './commands.js';

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
// order. Returns { moves, refused, targets }:
//   moves    [{ index, oldString, oldFret, newString, newFret }] — repicks
//            (identity repicks are dropped; nothing to write).
//   refused  [{ index, reason }] — the resolver said no; never guessed.
//   targets  every unresolved index in the window (the sweep list).
// Occupancy mirrors the roll writer: a note can't share a string with any
// other note sounding at its instant; earlier repicks in this same pass
// claim their new strings for later ones.
export function _resolveWindowPure(nn, win, anchors, ctx, isSuggestedFn) {
    const out = { moves: [], refused: [], targets: [] };
    if (!Array.isArray(nn) || !win || !ctx) return out;
    const isSug = typeof isSuggestedFn === 'function' ? isSuggestedFn : () => false;
    const targets = nn.map((n, i) => ({ n, i }))
        .filter(({ n }) => n && Number.isFinite(n.time)
            && n.time >= win.start - 1e-6 && n.time < win.end - 1e-6 && isSug(n))
        .sort((a, b) => a.n.time - b.n.time);
    out.targets = targets.map(({ i }) => i);
    if (!targets.length) return out;

    // Working string assignment: current positions, updated as repicks land.
    const strOf = new Map();
    nn.forEach((n, i) => { if (n) strOf.set(i, n.string); });

    for (const { n, i } of targets) {
        const pitch = _soundingPitchPure(ctx.openMidi, ctx.tuning, ctx.capo, n.string, n.fret);
        if (pitch === null) { out.refused.push({ index: i, reason: 'out-of-range' }); continue; }
        const nEnd = n.time + (Number(n.sustain) || 0);
        const occ = new Set();
        nn.forEach((o, j) => {
            if (j === i || !o || !Number.isFinite(o.time)) return;
            const oEnd = o.time + (Number(o.sustain) || 0);
            if (n.time <= oEnd + 1e-6 && nEnd >= o.time - 1e-6) occ.add(strOf.get(j));
        });
        const res = _suggestPositionPure(
            pitch, n.time,
            ctx.prevFretAt ? { fret: ctx.prevFretAt(n.time, i) } : null,
            anchors, occ, ctx);
        if (!res.resolved) { out.refused.push({ index: i, reason: res.reason }); continue; }
        if (res.resolved.string === n.string && res.resolved.fret === n.fret) {
            strOf.set(i, n.string);
            continue;   // already where the resolver wants it
        }
        out.moves.push({
            index: i,
            oldString: n.string, oldFret: n.fret,
            newString: res.resolved.string, newFret: res.resolved.fret,
        });
        strOf.set(i, res.resolved.string);
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
let sweep = null;   // { refs: [note], cur: number } | null

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
    const remaining = sweep.refs.slice(sweep.cur).filter((r) => _isSuggested(r));
    if (remaining.length) S.history.exec(new AcceptPositionsCmd(remaining));
    sweepEnd(`Accepted ${remaining.length} position${remaining.length === 1 ? '' : 's'}`);
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
            return p && Number.isFinite(p.fret) ? p.fret : null;
        },
    };
    const nn = notes();
    const r = _resolveWindowPure(nn, win, anchors, ctx, _isSuggested);
    if (!r.targets.length) { setStatus('No unresolved positions in this window'); return; }
    if (r.moves.length) S.history.exec(new ResolveWindowCmd(r.moves));
    const refusedNote = r.refused.length ? ` · ${r.refused.length} refused (left as-is)` : '';
    setStatus(`Resolved ${r.moves.length} of ${r.targets.length} in the window${refusedNote} — sweep to confirm`);
    // The sweep walks by REF so undo/index shuffles can't derail it.
    sweep = { refs: r.targets.map((i) => nn[i]).filter(Boolean), cur: 0 };
    sweepFocus();
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
        const k = e.key;
        if (k === 'Enter') { e.preventDefault(); e.stopPropagation(); sweepAccept(); }
        else if (k === 'ArrowRight') { e.preventDefault(); e.stopPropagation(); sweepStep('next'); }
        else if (k === 'ArrowLeft') { e.preventDefault(); e.stopPropagation(); sweepStep('prev'); }
        else if (k === 'a' || k === 'A') { e.preventDefault(); e.stopPropagation(); sweepAcceptAll(); }
        else if (k === 'Escape') { e.preventDefault(); e.stopPropagation(); sweepEnd('Sweep closed'); }
    }, true);
    sweepRender();
}
