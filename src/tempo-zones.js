/* Slopsmith Arrangement Editor — tempo-zone confirm bar (P2-3, confirm UI).
 *
 * The human-confirm half of segment-first mapping: Scan paints the detected
 * tempo-intent zones as BANDS on the tempo-map timeline and docks a confirm bar
 * over the canvas. The charter adjusts at INTENT granularity — drag a boundary
 * onto the real change, split/merge a zone, flip its kind, type the BPM, or
 * fall back to one steady tempo — all PRE-COMMIT: proposal state lives here
 * (module-scoped, editGen-keyed, Esc-cleared, dismissed on tempo-map exit),
 * and nothing touches S.beats until tempo.js's Confirm/Single-tempo verbs
 * build ONE undoable TempoGridCmd. The adjust verbs are pure
 * (src/tempo-segment.js); this module is the state + chrome around them.
 *
 * Cycle note: tempo.js imports this module (scan shows the proposal, the draw
 * pass paints the bands, mousedown routes boundary drags). The two APPLY verbs
 * need TempoGridCmd (tempo.js), so initTempoZones takes them as HOOKS instead
 * of importing tempo.js back.
 */

import { S, editGen } from './state.js';
import { host } from './host.js';
import { setStatus } from './ui.js';
import { TIMELINE_TOP, WAVEFORM_H, timeToX, xToTime } from './geometry.js';
import {
    _segmentBoundaryDragPure, _segmentCycleKindPure, _segmentMergePure,
    _segmentSetBpmPure, _segmentSplitPure,
} from './tempo-segment.js';

// ── proposal state ───────────────────────────────────────────────────
let _zones = null;   // { segments, sel, gen, session, octave } | null
let _hooks = { confirm: null, single: null, octave: null };

export function _zonesActive() {
    if (!_zones) return false;
    // An edit under the proposal (undo, import, another tempo op) invalidates
    // the zones the same way it invalidates suggest ghosts — and module state
    // outlives a screen re-injection / song switch, so a session change does
    // too (the zones were detected on the OTHER song's audio). Quiet dismiss.
    if (_zones.gen !== editGen || _zones.session !== S.sessionId) {
        _zones = null;
        _zonesRenderBar();
    }
    return !!_zones;
}
export function _zonesGet() { return _zonesActive() ? _zones.segments : null; }
export function _zonesSelected() { return _zonesActive() ? _zones.sel : -1; }

export function _zonesShow(segments, octave = null) {
    if (!Array.isArray(segments) || !segments.length) return;
    // `octave` = 'double' | 'half' | null: Scan detected the whole grid an
    // octave off the recording's pulse — the bar then offers the one-click
    // half/double-time fix (a per-bar re-fit can never repair an octave).
    _zones = { segments, sel: -1, gen: editGen, session: S.sessionId, octave };
    _zonesRenderBar();
}

export function _zonesDismiss(msg) {
    if (!_zones) return;
    _zones = null;
    _zonesRenderBar();
    if (msg) setStatus(msg);
}

// Re-key the proposal onto the current editGen — the apply verbs bump the gen
// by committing, and anything that must SURVIVE its own commit re-keys.
// (Currently only used by tests; applies dismiss instead.)
export function _zonesRekey() { if (_zones) _zones.gen = editGen; }

// ── geometry (band strip just under the waveform, above the poles) ───
const STRIP_H = 14;
const HANDLE_HALF = 4;
const _stripY = () => TIMELINE_TOP + WAVEFORM_H + 2;

// Is a canvas y inside the band strip (incl. the taller boundary handles)?
export function _zonesStripHit(y) {
    if (!_zonesActive()) return false;
    const y0 = _stripY();
    return y >= y0 - 2 && y <= y0 + STRIP_H + 4;
}

// The boundary handle under canvas x, or -1. Boundary k sits between
// segments[k] and segments[k+1].
export function _zonesBoundaryHitAt(x) {
    if (!_zonesActive()) return -1;
    const segs = _zones.segments;
    for (let k = 0; k + 1 < segs.length; k++) {
        if (Math.abs(timeToX(segs[k].tEnd) - x) <= HANDLE_HALF + 2) return k;
    }
    return -1;
}

// The zone whose span contains canvas x, or -1.
export function _zonesZoneAt(x) {
    if (!_zonesActive()) return -1;
    const t = xToTime(x);
    const segs = _zones.segments;
    for (let i = 0; i < segs.length; i++) {
        if (t >= segs[i].tStart - 1e-6 && t < segs[i].tEnd) return i;
    }
    return -1;
}

export function _zonesSelect(i) {
    if (!_zonesActive()) return;
    _zones.sel = Number.isInteger(i) && _zones.segments[i] ? i : -1;
    _zonesRenderBar();
}

// ── adjust verbs (thin state wrappers over the pures) ────────────────
function _apply(next, failMsg) {
    if (!next) { if (failMsg) setStatus(failMsg); return false; }
    _zones.segments = next;
    if (_zones.sel >= next.length) _zones.sel = next.length - 1;
    _zonesRenderBar();
    host.draw();
    return true;
}

export function _zonesDragBoundary(bIdx, t) {
    if (!_zonesActive()) return;
    const next = _segmentBoundaryDragPure(_zones.segments, bIdx, t);
    if (next) { _zones.segments = next; host.draw(); }
}

export function _zonesSplitSelectedAt(t) {
    if (!_zonesActive() || _zones.sel < 0) { setStatus('Click a zone band first, then Split.'); return; }
    _apply(_segmentSplitPure(_zones.segments, _zones.sel, t),
        'Split lands too close to the zone edge — move the playhead inside the zone.');
}

export function _zonesMergeSelected() {
    if (!_zonesActive() || _zones.sel < 0) { setStatus('Click a zone band first, then Merge.'); return; }
    if (_zones.sel + 1 >= _zones.segments.length) { setStatus('No zone to the right to merge with.'); return; }
    _apply(_segmentMergePure(_zones.segments, _zones.sel));
}

export function _zonesCycleSelected() {
    if (!_zonesActive() || _zones.sel < 0) { setStatus('Click a zone band first, then Kind.'); return; }
    if (_apply(_segmentCycleKindPure(_zones.segments, _zones.sel))) {
        const k = _zones.segments[_zones.sel].kind;
        setStatus(k === 'unmapped'
            ? 'Zone marked unmapped — no barlines will be laid in it.'
            : `Zone kind: ${k === 'ramp' ? 'ramp (accel/rit)' : 'steady tempo'}.`);
    }
}

export function _zonesEditBpmSelected() {
    if (!_zonesActive() || _zones.sel < 0) { setStatus('Click a zone band first, then BPM.'); return; }
    const s = _zones.segments[_zones.sel];
    const cur = s.kind === 'ramp' ? `${s.bpmStart}-${s.bpmEnd}` : String(s.bpmStart);
    const raw = prompt(s.kind === 'ramp'
        ? 'Zone tempo (ramp): start-end BPM, e.g. 140-90'
        : 'Zone tempo (BPM):', cur);
    if (raw === null) return;
    const m = String(raw).trim().match(/^(\d+(?:\.\d+)?)(?:\s*[-→]\s*(\d+(?:\.\d+)?))?$/);
    if (!m) { setStatus('Could not read that tempo — use "120" or "140-90".'); return; }
    _apply(_segmentSetBpmPure(_zones.segments, _zones.sel, Number(m[1]), m[2] !== undefined ? Number(m[2]) : undefined),
        'Tempo out of range (30–400 BPM).');
}

// ── the bands on the timeline (called from the tempo-map draw pass) ──
const KIND_FILL = {
    constant: 'rgba(45, 212, 191, 0.26)',   // teal
    ramp: 'rgba(167, 139, 250, 0.30)',      // violet
    unmapped: 'rgba(148, 163, 184, 0.14)',  // slate
};
const KIND_EDGE = {
    constant: 'rgba(45, 212, 191, 0.8)',
    ramp: 'rgba(167, 139, 250, 0.85)',
    unmapped: 'rgba(148, 163, 184, 0.5)',
};

export function _zonesDraw(ctx, w) {
    if (!_zonesActive()) return;
    const segs = _zones.segments;
    const y0 = _stripY();
    ctx.save();
    ctx.font = '10px ui-monospace, monospace';
    ctx.textBaseline = 'middle';
    for (let i = 0; i < segs.length; i++) {
        const s = segs[i];
        const x0 = Math.max(0, timeToX(s.tStart));
        const x1 = Math.min(w, timeToX(s.tEnd));
        if (x1 <= 0 || x0 >= w || x1 - x0 < 2) continue;
        ctx.fillStyle = KIND_FILL[s.kind] || KIND_FILL.constant;
        ctx.fillRect(x0, y0, x1 - x0, STRIP_H);
        if (i === _zones.sel) {
            ctx.strokeStyle = KIND_EDGE[s.kind] || KIND_EDGE.constant;
            ctx.lineWidth = 1.5;
            ctx.strokeRect(x0 + 0.75, y0 + 0.75, x1 - x0 - 1.5, STRIP_H - 1.5);
        }
        const label = s.kind === 'unmapped' ? 'unmapped'
            : s.kind === 'ramp'
                ? `${s.bpmStart > s.bpmEnd ? 'rit' : 'accel'} ${Math.round(s.bpmStart)}→${Math.round(s.bpmEnd)}`
                : `${Math.round(s.bpmStart)}`;
        const weak = Number.isFinite(s.conf) && s.conf < 0.35 ? ' ?' : '';
        const text = label + weak;
        if (ctx.measureText(text).width < x1 - x0 - 6) {
            ctx.fillStyle = 'rgba(226, 232, 240, 0.92)';
            ctx.fillText(text, x0 + 4, y0 + STRIP_H / 2 + 0.5);
        }
    }
    // Boundary handles — taller grips the mouse can find.
    for (let k = 0; k + 1 < segs.length; k++) {
        const hx = timeToX(segs[k].tEnd);
        if (hx < 0 || hx > w) continue;
        ctx.fillStyle = 'rgba(226, 232, 240, 0.9)';
        ctx.fillRect(hx - 1.5, y0 - 2, 3, STRIP_H + 4);
    }
    ctx.restore();
}

// ── the confirm bar (DOM) ────────────────────────────────────────────
const $bar = () => document.getElementById('editor-segment-bar');

export function _zonesRenderBar() {
    const bar = $bar();
    if (!bar) return;
    if (!_zones) { bar.classList.add('hidden'); return; }
    bar.classList.remove('hidden');
    const count = document.getElementById('editor-segment-count');
    if (count) {
        const n = _zones.segments.length;
        count.textContent = `${n} zone${n === 1 ? '' : 's'}`
            + (_zones.sel >= 0 ? ` · #${_zones.sel + 1} selected` : '');
    }
    // The per-zone verbs only make sense with a selection.
    for (const id of ['editor-segment-split', 'editor-segment-merge',
        'editor-segment-kind', 'editor-segment-bpm']) {
        const b = document.getElementById(id);
        if (b) b.disabled = _zones.sel < 0;
    }
    // The octave rescue only shows when Scan actually detected the mismatch.
    const oct = document.getElementById('editor-segment-octave');
    if (oct) {
        oct.classList.toggle('hidden', !_zones.octave);
        if (_zones.octave) {
            oct.textContent = _zones.octave === 'double' ? 'Double grid tempo' : 'Halve grid tempo';
            oct.title = _zones.octave === 'double'
                ? 'The recording pulses at about TWICE your grid — each grid bar spans two real bars. One click doubles the grid tempo (undoable; audio and notes stay put).'
                : 'The recording pulses at about HALF your grid — your grid runs double-time. One click halves the grid tempo (undoable; audio and notes stay put).';
        }
    }
}

export function initTempoZones(hooks) {
    _hooks = { ..._hooks, ...(hooks || {}) };
    const bar = $bar();
    if (bar) {
        bar.addEventListener('click', (e) => {
            const t = e.target instanceof Element ? e.target : null;
            if (!t || !_zonesActive()) return;
            if (t.id === 'editor-segment-apply' && _hooks.confirm) _hooks.confirm();
            else if (t.id === 'editor-segment-single' && _hooks.single) _hooks.single();
            else if (t.id === 'editor-segment-octave' && _hooks.octave && _zones.octave) _hooks.octave(_zones.octave);
            else if (t.id === 'editor-segment-split') _zonesSplitSelectedAt(S.cursorTime || 0);
            else if (t.id === 'editor-segment-merge') _zonesMergeSelected();
            else if (t.id === 'editor-segment-kind') _zonesCycleSelected();
            else if (t.id === 'editor-segment-bpm') _zonesEditBpmSelected();
            else if (t.id === 'editor-segment-dismiss') _zonesDismiss('Tempo zones dismissed — nothing applied.');
        });
    }
    // Esc clears the proposal (capture, before the canvas shortcut chain) —
    // but only when zones are showing, so the key otherwise behaves as ever.
    host.addGlobalListener(document, 'keydown', (e) => {
        if (e.key !== 'Escape' || !_zonesActive()) return;
        // A read-only lens modal (Tab preview, User Guide) sitting over the bar
        // owns the keyboard — its own Esc close must win (the sweep bar's rule).
        const lensOpen = ['editor-tab-preview-modal', 'editor-user-guide-modal'].some((id) => {
            const m = document.getElementById(id);
            return !!(m && !m.classList.contains('hidden'));
        });
        if (lensOpen) return;
        e.preventDefault();
        e.stopPropagation();
        _zonesDismiss('Tempo zones dismissed — nothing applied.');
        host.draw();
    }, true);
    _zonesRenderBar();
}
