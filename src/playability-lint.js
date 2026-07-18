/* Slopsmith Arrangement Editor — fretted playability lint
 * (view-modality P9 / VA.8, design V13.5/V14).
 *
 * A pure lint pass over the active fretted part. ADVISORY ONLY — the drum
 * limb-lint posture (DAW doc F5.4): a yellow underline on flagged notes in
 * both String view and the roll, a count chip by the note-count readout,
 * and a popover listing the issues (click = seek + select). Never blocks,
 * never auto-fixes: guitar has real outliers (big hands, benders, altered
 * technique), so the lint NAMES the physical question and the charter
 * answers it.
 *
 * Rules (each its own pure, all in one @pure block):
 *   stretch      simultaneous fretted notes spanning more than the active
 *                anchor window (+1 fret tolerance).
 *   overlap      two notes on ONE string overlapping in time (sustain-
 *                aware) — one string can only sound one note.
 *   open-bend    a bend authored on an open string (needs a bender — worth
 *                a look). Stands in for the prompt's "open-string pitch vs
 *                tuning" check: notes carry {string, fret} only (pitch is
 *                always derived), so there is no independent pitch to
 *                cross-check; the PR body records the adaptation.
 *   bad-fret     a fret outside [0, 24] or non-integer — the data-bug
 *                catcher half of the same rule.
 *   legato-jump  an HO/PO arrival (or a pitched-slide reach) whose fret
 *                gap exceeds the active anchor window — a position shift
 *                mid-legato.
 *   finger-conflict  two simultaneous notes assigned the SAME fret-hand
 *                digit (fret_finger 0–4, thumb included) on DIFFERENT frets
 *                (a barre — same digit, same fret — is fine).
 *
 * Perf: recomputed only when the edit generation / arrangement changes
 * (the draw-coalesce dirty path — drawNotes reads a memoized Set), never
 * per frame.
 */

import { S, editGen } from './state.js';
import { host } from './host.js';
import { notes } from './notes.js';
import { isKeysArr } from './keys.js';
import { _activeAnchorAtPure } from './position.js';
import { _editorEscHtml } from './ui.js';

/* @pure:playability-lint:start */

// Thresholds — named so the pedagogy seat can tune them without reading
// the rules. Tolerances are deliberately forgiving: the lint should name
// the outliers, not nag every fourth-finger reach.
export const LINT_STRETCH_TOLERANCE = 1;      // frets past the anchor window
export const LINT_CLUSTER_EPSILON = 0.012;    // "simultaneous" (the drum-lint value)
export const LINT_OVERLAP_EPSILON = 0.01;     // seconds of real overlap before flagging
export const LINT_DEFAULT_WINDOW = 4;         // anchor width when none authored

// The fret-hand anchor list: authored anchors win, computed fall back —
// the same dual-list precedence the tempo remap and the roll resolver use.
export function _lintAnchorsPure(arr) {
    if (!arr) return [];
    if (Array.isArray(arr.anchors_user) && arr.anchors_user.length) return arr.anchors_user;
    return Array.isArray(arr.anchors) ? arr.anchors : [];
}

function windowAt(anchors, t) {
    const a = _activeAnchorAtPure(anchors, t);
    return a && Number.isFinite(a.width) && a.width > 0 ? a.width : LINT_DEFAULT_WINDOW;
}

// (a) Simultaneous fretted notes spanning more than the hand. Clusters by
// onset (within epsilon of the cluster's first note, hits assumed roughly
// time-sorted — the pass sorts indices itself so callers need not).
export function _lintStretchPure(nn, anchors) {
    const issues = [];
    if (!Array.isArray(nn) || !nn.length) return issues;
    const order = nn.map((n, i) => ({ n, i }))
        .filter((e) => e.n && Number.isFinite(e.n.time))
        .sort((a, b) => a.n.time - b.n.time);
    let k = 0;
    while (k < order.length) {
        const t0 = order[k].n.time;
        const cluster = [];
        while (k < order.length && order[k].n.time <= t0 + LINT_CLUSTER_EPSILON) {
            cluster.push(order[k]); k++;
        }
        const fretted = cluster.filter((e) => Number.isInteger(e.n.fret) && e.n.fret > 0);
        if (fretted.length < 2) continue;
        const frets = fretted.map((e) => e.n.fret);
        const span = Math.max(...frets) - Math.min(...frets);
        const limit = windowAt(anchors, t0) + LINT_STRETCH_TOLERANCE;
        if (span > limit) {
            issues.push({
                rule: 'stretch', time: t0,
                indices: fretted.map((e) => e.i),
                detail: `${span}-fret stretch (window ${limit - LINT_STRETCH_TOLERANCE} + ${LINT_STRETCH_TOLERANCE})`,
            });
        }
    }
    return issues;
}

// (b) Two notes on one string overlapping in time (sustain-aware). One
// string sounds one note: the second attack would choke the first.
export function _lintOverlapPure(nn) {
    const issues = [];
    if (!Array.isArray(nn)) return issues;
    const byString = new Map();
    nn.forEach((n, i) => {
        if (!n || !Number.isInteger(n.string) || !Number.isFinite(n.time)) return;
        if (!byString.has(n.string)) byString.set(n.string, []);
        byString.get(n.string).push({ n, i });
    });
    for (const list of byString.values()) {
        list.sort((a, b) => a.n.time - b.n.time);
        for (let k = 1; k < list.length; k++) {
            const cur = list[k];
            // Scan EVERY still-active predecessor, not just the immediate one:
            // a long sustain (t=1..6) overlaps attacks at t=2 AND t=3, and the
            // second conflict is just as real (CodeRabbit, #200).
            for (let j = k - 1; j >= 0; j--) {
                const prev = list[j];
                const prevEnd = prev.n.time + (Number(prev.n.sustain) || 0);
                const overlap = prevEnd - cur.n.time;
                const sameInstant = j === k - 1
                    && Math.abs(cur.n.time - prev.n.time) < LINT_CLUSTER_EPSILON;
                if (overlap > LINT_OVERLAP_EPSILON || sameInstant) {
                    issues.push({
                        rule: 'overlap', time: cur.n.time,
                        indices: [prev.i, cur.i],
                        detail: sameInstant
                            ? `two notes on string ${cur.n.string} at one instant`
                            : `string ${cur.n.string}: sustain overlaps a later note by ${overlap.toFixed(3)}s`,
                    });
                }
            }
        }
    }
    return issues;
}

// (c) Open-string bends (physical: needs a bender) + out-of-range frets
// (the data-bug catcher).
export function _lintOpenPure(nn) {
    const issues = [];
    if (!Array.isArray(nn)) return issues;
    nn.forEach((n, i) => {
        // The same junk gate as every rule: an entry without a real time is
        // not a note — the save path would drop it, so the lint skips it too.
        if (!n || !Number.isFinite(n.time)) return;
        const t = n.techniques || {};
        const bends = !!t.bend || (Array.isArray(t.bend_values) && t.bend_values.length > 0);
        if (n.fret === 0 && bends) {
            issues.push({ rule: 'open-bend', time: n.time, indices: [i],
                detail: 'bend on an open string (needs a bender or a re-fingering)' });
        }
        if (!Number.isInteger(n.fret) || n.fret < 0 || n.fret > 24) {
            issues.push({ rule: 'bad-fret', time: n.time, indices: [i],
                detail: `fret ${n.fret} is outside 0–24 (data bug?)` });
        }
    });
    return issues;
}

// (d) Position jumps mid-legato: an HO/PO arrival — or a pitched slide's
// reach — whose fret gap exceeds the active anchor window. Consecutive
// same-string pairs only (legato lives on one string).
export function _lintLegatoJumpPure(nn, anchors) {
    const issues = [];
    if (!Array.isArray(nn)) return issues;
    const byString = new Map();
    nn.forEach((n, i) => {
        if (!n || !Number.isInteger(n.string) || !Number.isFinite(n.time)) return;
        if (!byString.has(n.string)) byString.set(n.string, []);
        byString.get(n.string).push({ n, i });
    });
    for (const list of byString.values()) {
        list.sort((a, b) => a.n.time - b.n.time);
        for (let k = 0; k < list.length; k++) {
            const { n, i } = list[k];
            const t = n.techniques || {};
            const win = windowAt(anchors, n.time);
            // Slide reach: the slide's own target is the hand's destination.
            // slide_to < 0 is the "no slide" sentinel (the -1 every loaded
            // note carries — commands.js/draw.js gate on >= 0 the same way).
            if (Number.isInteger(t.slide_to) && t.slide_to >= 0 && n.fret > 0
                && Math.abs(t.slide_to - n.fret) > win) {
                issues.push({ rule: 'legato-jump', time: n.time, indices: [i],
                    detail: `slide ${n.fret}→${t.slide_to} spans ${Math.abs(t.slide_to - n.fret)} frets (window ${win})` });
            }
            // HO/PO arrival from the previous note on this string.
            if (k > 0 && (t.hammer_on || t.pull_off)) {
                const prev = list[k - 1].n;
                if (prev.fret > 0 && n.fret > 0 && Math.abs(n.fret - prev.fret) > win) {
                    issues.push({ rule: 'legato-jump', time: n.time, indices: [list[k - 1].i, i],
                        detail: `${t.hammer_on ? 'hammer-on' : 'pull-off'} ${prev.fret}→${n.fret} spans ${Math.abs(n.fret - prev.fret)} frets (window ${win})` });
                }
            }
        }
    }
    return issues;
}

// (e) One finger in two places at once. Within a simultaneous cluster, two
// fretted notes assigned the SAME fret-hand digit (fret_finger 0–4 — spec
// §6.2.2, where 0 is the THUMB) on DIFFERENT frets are physically impossible: a
// digit can't hold two frets at one instant. Same digit on the SAME fret across
// strings is a BARRE (allowed, never flagged) — and that covers the thumb-over
// wrap across E+A too. Pairs with auto-fingering (#237) and the chord-grip
// resolve: once fingers are assigned, this catches grips that can't be held.
export function _lintFingerConflictPure(nn) {
    const issues = [];
    if (!Array.isArray(nn) || !nn.length) return issues;
    const order = nn.map((n, i) => ({ n, i }))
        .filter((e) => e.n && Number.isFinite(e.n.time))
        .sort((a, b) => a.n.time - b.n.time);
    let k = 0;
    while (k < order.length) {
        const t0 = order[k].n.time;
        const cluster = [];
        while (k < order.length && order[k].n.time <= t0 + LINT_CLUSTER_EPSILON) {
            cluster.push(order[k]); k++;
        }
        // Group fretted notes by assigned digit (0–4; the thumb is 0 and frets
        // just like the rest. Open strings and the unset sentinel (-1) carry no
        // fretting digit, so they never conflict).
        const byFinger = new Map();
        for (const e of cluster) {
            const fg = (e.n.techniques || {}).fret_finger;
            if (!Number.isInteger(e.n.fret) || e.n.fret <= 0) continue;
            if (!Number.isInteger(fg) || fg < 0 || fg > 4) continue;
            if (!byFinger.has(fg)) byFinger.set(fg, []);
            byFinger.get(fg).push(e);
        }
        for (const [fg, list] of byFinger) {
            const frets = [...new Set(list.map((e) => e.n.fret))].sort((a, b) => a - b);
            if (frets.length >= 2) {
                issues.push({
                    rule: 'finger-conflict', time: t0,
                    indices: list.map((e) => e.i),
                    // ponytail: the thumb reads as "T" — the strip's FINGER_LABELS
                    // encoding, inlined rather than importing that UI module here.
                    detail: `finger ${fg === 0 ? 'T' : fg} on frets ${frets.join(' & ')} at once (a barre is one fret)`,
                });
            }
        }
    }
    return issues;
}

// The full pass. Empty/keys-less input degrades to no issues.
export function _playabilityLintPure(nn, anchors) {
    return [
        ..._lintStretchPure(nn, anchors),
        ..._lintOverlapPure(nn),
        ..._lintOpenPure(nn),
        ..._lintLegatoJumpPure(nn, anchors),
        ..._lintFingerConflictPure(nn),
    ].sort((a, b) => a.time - b.time);
}
/* @pure:playability-lint:end */

// ── Memo (the draw-coalesce dirty path) ──────────────────────────────
let _memo = { gen: -1, arrIdx: -1, notesRef: null, issues: [], flagged: new Set() };

export function _lintResults() {
    const arr = S.arrangements && S.arrangements[S.currentArr];
    const nn = arr ? notes() : null;
    if (!arr || !nn || isKeysArr() || S.drumEditMode) {
        if (_memo.issues.length) _memo = { gen: -1, arrIdx: -1, notesRef: null, issues: [], flagged: new Set() };
        return _memo;
    }
    const gen = typeof editGen === 'number' ? editGen : 0;
    if (_memo.gen === gen && _memo.arrIdx === S.currentArr && _memo.notesRef === nn) return _memo;
    const issues = _playabilityLintPure(nn, _lintAnchorsPure(arr));
    const flagged = new Set();
    for (const iss of issues) for (const i of iss.indices) flagged.add(i);
    _memo = { gen, arrIdx: S.currentArr, notesRef: nn, issues, flagged };
    return _memo;
}

// The per-draw accessor drawNotes hoists: just the flagged index set.
export function _lintFlaggedSet() {
    return _lintResults().flagged;
}

// ── Chip + popover (advisory surface) ────────────────────────────────
const RULE_LABELS = {
    stretch: 'Stretch', overlap: 'String overlap', 'open-bend': 'Open-string bend',
    'bad-fret': 'Fret out of range', 'legato-jump': 'Legato jump',
    'finger-conflict': 'Finger conflict',
};

export function _lintChipRefresh() {
    const chip = document.getElementById('editor-lint-chip');
    if (!chip) return;
    const { issues } = _lintResults();
    const show = issues.length > 0;
    if (chip.classList.contains('hidden') !== !show) chip.classList.toggle('hidden', !show);
    const label = `⚠ ${issues.length}`;
    if (show && chip.textContent !== label) chip.textContent = label;
    const pop = document.getElementById('editor-lint-pop');
    if (!show) {
        if (pop) pop.classList.add('hidden');
        if (chip.getAttribute('aria-expanded') !== 'false') chip.setAttribute('aria-expanded', 'false');
    } else if (pop && !pop.classList.contains('hidden')
        && (issues.length !== _popIssues.length || issues.some((iss, k) => iss !== _popIssues[k]))) {
        renderPopover();   // the lint moved under an open popover — keep rows honest
    }
}

// The popover renders from a SNAPSHOT: rows bind to these entries, never to
// indices into fresh lint results (an edit while it is open would silently
// remap clicks). The chip refresh re-renders an open popover on change.
let _popIssues = [];
function renderPopover() {
    const pop = document.getElementById('editor-lint-pop');
    if (!pop) return;
    const { issues } = _lintResults();
    _popIssues = issues.slice();
    pop.innerHTML = `<div class="editor-lint-head"><span>Playability — advisory, never blocking</span>`
        + `<button class="editor-lint-close" aria-label="Close playability notes" title="Close">✕</button></div>`
        + issues.map((iss, k) =>
            `<button class="editor-lint-row" data-issue="${k}">`
            + `<span class="editor-lint-rule">${_editorEscHtml(RULE_LABELS[iss.rule] || iss.rule)}</span>`
            + `<span>${_editorEscHtml(iss.detail)}</span></button>`).join('');
}

export function editorToggleLintPopover() {
    const pop = document.getElementById('editor-lint-pop');
    const chip = document.getElementById('editor-lint-chip');
    if (!pop) return;
    const show = pop.classList.contains('hidden');
    if (show) renderPopover();
    pop.classList.toggle('hidden', !show);
    if (chip) chip.setAttribute('aria-expanded', show ? 'true' : 'false');
    // Focus round-trip: opening lands on the first issue row, closing
    // returns to the chip — keyboard/screen-reader users stay oriented.
    if (show) {
        const first = pop.querySelector('.editor-lint-row');
        if (first) first.focus();
    } else if (chip) {
        chip.focus();
    }
}

export function initPlayabilityLint() {
    const pop = document.getElementById('editor-lint-pop');
    if (pop) {
        pop.addEventListener('click', (e) => {
            if (e.target instanceof Element && e.target.closest('.editor-lint-close')) {
                editorToggleLintPopover();   // close + focus back on the chip
                return;
            }
            const row = e.target instanceof Element ? e.target.closest('.editor-lint-row') : null;
            if (!row) return;
            const iss = _popIssues[Number(row.dataset.issue)];
            if (!iss) return;
            // Seek + select the flagged notes — the fix is the charter's call.
            S.sel = new Set(iss.indices);
            host.editorSeekToTime(iss.time);
            host.updateStatus();
            host.draw();
            pop.classList.add('hidden');
        });
    }
    // Escape closes and returns focus to the chip (keyboard round-trip).
    if (pop) {
        pop.addEventListener('keydown', (e) => {
            if (e.key !== 'Escape') return;
            e.stopPropagation();
            editorToggleLintPopover();
        });
    }
    // Click-away for the popover — teardown-registered.
    host.addGlobalListener(document, 'mousedown', (e) => {
        const p = document.getElementById('editor-lint-pop');
        if (!p || p.classList.contains('hidden')) return;
        const chip = document.getElementById('editor-lint-chip');
        if (e.target instanceof Node && !p.contains(e.target)
            && !(chip && chip.contains(e.target))) p.classList.add('hidden');
    });
    _lintChipRefresh();
}
