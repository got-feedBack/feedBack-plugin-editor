// Onboarding signposts + first-win cues (workspace-shell C2, charrette §3.2/§3.4).
//
// Two un-gamified surfaces, both editor-pref (localStorage), never the pack:
//
//   SIGNPOSTS — SUGGEST-ONLY. A signpost never moves or adds a surface; it just
//   points at the menu / Ctrl+K in words. It is ACTION-triggered (never a timer
//   or idle nag), fires ONCE per capability, and is permanently dismissible.
//   Capped at ≤3 hand-audited entries (charrette §3.2).
//
//   CUES — a calm, one-time VISUAL acknowledgement of a CORRECTNESS milestone
//   (a barline locked to the recording; a section first gaining content). No
//   sound, no %, no score, no token (charrette §3.4: reward the music getting
//   more accurate, never the user doing more actions).
//
// All one-shot state is a single localStorage flag per id when storage is
// available, with an in-memory fallback for private/sandboxed sessions.

import { S } from './state.js';

const LS_SIGNPOST = (id) => `editorSignpost:${id}`;
const LS_CUE = (id) => `editorCue:${id}`;

const _memStore = new Map();
function _lsGet(k) {
    try { return localStorage.getItem(k); }
    catch (_) { return _memStore.has(k) ? _memStore.get(k) : null; }
}
function _lsSet(k, v) {
    try { localStorage.setItem(k, v); }
    catch (_) { _memStore.set(k, String(v)); }
}

export function _signpostSeen(id) { return _lsGet(LS_SIGNPOST(id)) === 'seen'; }
export function _cueSeen(id) { return _lsGet(LS_CUE(id)) === 'seen'; }

// Session action counters. Session-scoped BY DESIGN: a signpost reacts to what
// you are doing right now, then (once shown) never nags again. Reset on song
// load so each song's session starts clean.
const _counts = { gridFight: 0, navJump: 0, enteredTempoMap: false };
// Coverage baseline: the first-covered cue is a first-WIN, so it must fire only
// on an empty→covered transition the USER makes — never on a load of a chart
// that already has covered sections. The first coverage read after a load seeds
// the baseline silently; later flips fire.
let _prevAnyCovered = false;
let _coverageBaselined = false;
export function _resetSignpostCounters() {
    _counts.gridFight = 0;
    _counts.navJump = 0;
    _counts.enteredTempoMap = false;
    _coverageBaselined = false;
}
export function _signpostCounts() { return { ..._counts }; }   // test/read only

// ── Signpost registry (≤3) ──────────────────────────────────────────
// message points ONLY at the menu / shortcut — never an action button that
// mutates the surface. eligible(counts, S) is a PURE predicate over the session
// counters + read-only state.
export const SIGNPOSTS = [
    {
        id: 'grid-fit',
        message: 'Notes keep needing a resnap? The beat grid may be off — line it up with the Tempo tools (press T for Tempo Map), or search commands with Ctrl+K.',
        eligible: (c) => c.gridFight >= 3 && !c.enteredTempoMap,
    },
    {
        id: 'sections',
        message: 'Jumping around a lot? Mark sections with Shift+M to move through a long song quickly.',
        eligible: (c, s) => c.navJump >= 10 && ((s.sections || []).length === 0) && ((Number(s.duration) || 0) >= 60),
    },
];

// The first not-yet-seen signpost whose predicate holds (or null). Pure.
export function _eligibleSignpostPure(counts, s, seenIds) {
    for (const sp of SIGNPOSTS) {
        if (seenIds && seenIds.has(sp.id)) continue;
        if (sp.eligible(counts, s)) return sp;
    }
    return null;
}

function _showSignpost(sp) {
    const el = document.getElementById('editor-signpost');
    if (!el) return;
    _lsSet(LS_SIGNPOST(sp.id), 'seen');   // one-shot: never eligible again
    const msg = document.getElementById('editor-signpost-msg');
    if (msg) msg.textContent = sp.message;
    el.dataset.signpostId = sp.id;
    el.classList.remove('hidden');
}

export function editorDismissSignpost() {
    const el = document.getElementById('editor-signpost');
    if (el) el.classList.add('hidden');
}

// Record an action; if it makes a not-yet-seen signpost eligible, show it.
// Called from instrumented action sites (resnap / note time-drag / navigation /
// tempo-map entry). Unknown actions are ignored.
export function _signpostNote(action) {
    switch (action) {
    case 'gridFight': _counts.gridFight++; break;         // resnap, whole-song BPM rescale, big time-drag
    case 'navJump': _counts.navJump++; break;
    case 'enterTempoMap': _counts.enteredTempoMap = true; break;
    default: return;
    }
    const seen = new Set(SIGNPOSTS.filter((sp) => _signpostSeen(sp.id)).map((sp) => sp.id));
    const sp = _eligibleSignpostPure(_counts, S, seen);
    if (sp) _showSignpost(sp);
}

// ── First-win cues ──────────────────────────────────────────────────
function _showCue(text) {
    const el = document.getElementById('editor-cue');
    if (!el) return false;
    el.textContent = text;
    el.classList.remove('hidden', 'editor-cue-show');
    void el.offsetWidth;                    // reflow so the fade restarts
    el.classList.add('editor-cue-show');
    // Short-lived flash, like the drum-pad listen flash; a stale timer after a
    // screen re-inject only re-hides an already-hidden element (harmless).
    setTimeout(() => { const e = document.getElementById('editor-cue'); if (e) e.classList.add('hidden'); }, 4200);
    return true;
}

export function _fireCueOnce(id, text) {
    if (_cueSeen(id)) return false;
    if (!_showCue(text)) return false;
    _lsSet(LS_CUE(id), 'seen');
    return true;
}

// First time the user locks a barline to the recording (charrette §3.4 cue #1).
export function _signpostFirstLock() {
    _fireCueOnce('first-lock', 'Locked to the recording — this barline holds through automatic re-fits.');
}

// First time ANY section gains authored content — presence, not a density
// target, and never for an intentionally-empty span (charrette §3.4 cue #2).
// `coverage` is _sectionCoveragePure()'s output, passed in from the draw memo so
// this module needn't import draw.js. Fires only on an empty→covered transition
// AFTER the post-load baseline, so opening an already-charted song stays quiet.
export function _maybeFireFirstCovered(coverage) {
    const now = Array.isArray(coverage) && coverage.some((s) => s && s.hasContent);
    if (!_coverageBaselined) { _prevAnyCovered = now; _coverageBaselined = true; return; }
    if (now && !_prevAnyCovered && !_cueSeen('first-covered')) {
        _fireCueOnce('first-covered', 'That section has content — the chart is taking shape.');
    }
    _prevAnyCovered = now;
}
