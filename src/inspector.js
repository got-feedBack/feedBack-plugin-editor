// ════════════════════════════════════════════════════════════════════
// The inspector panel — the right-hand editor for whatever is selected.
//
// Two faces over one selection: note attributes (fret, string, time, sustain,
// techniques, bend intent, teaching marks) and, when the selection is a chord,
// its name / voicing / fingering / function. Every edit goes through a command
// in src/commands.js, so undo works and the read-only-roll lock applies.
//
// It renders innerHTML and reads back through the window.editorInspector* and
// window.editorChord* handlers that markup calls. Those are exported as plain
// functions and re-attached by main.js: a module cannot own `window.x =`.
//
// main.js keeps the bend-curve dialog and the canvas-resize scheduler; they
// arrive through the shared `host` object in src/host.js.
// ════════════════════════════════════════════════════════════════════
import { EditChordTemplateCmd } from './annotation-lanes.js';
import {
    _fretKeyForL, _groupFn, _normFingers, _parseGuideTones, _sanitizeCaged, _sanitizeGuideTones,
} from './chords.js';
import {
    EditChordFnCmd, MoveNoteCmd, ResizeSustainGroupCmd, SetBendIntentCmd, SetTeachingMarkCmd,
} from './commands.js';
import { host } from './host.js';
import { _rollLockNotice, _rollReadOnly } from './keys.js';
import { lanes } from './lanes.js';
import {
    BEND_INTENTS, FRET_FINGER_OPTIONS, nextUnusedStrumGroup, notes, rescaleBendCurveToPeak,
    sanitizeBendCurve,
} from './notes.js';
import { S } from './state.js';

// ════════════════════════════════════════════════════════════════════
// Inspector panel — right-side note attribute editor (PR3b of the
// tones+notation UI follow-up). Reflects S.sel; mutations apply to
// every selected note so multi-select bulk edits work without a new
// command class.
// ════════════════════════════════════════════════════════════════════

// All boolean technique flags the inspector exposes. The label is what
// the UI shows; the key matches the `techniques` dict on a note.
const _INSPECTOR_FLAGS = [
    { key: 'hammer_on',      label: 'Hammer-On' },
    { key: 'pull_off',       label: 'Pull-Off' },
    { key: 'palm_mute',      label: 'Palm Mute' },
    { key: 'fret_hand_mute', label: 'Fret-Hand Mute' },
    { key: 'mute',           label: 'String Mute' },
    { key: 'harmonic',       label: 'Harmonic' },
    { key: 'harmonic_pinch', label: 'Pinch Harmonic' },
    { key: 'accent',         label: 'Accent' },
    { key: 'vibrato',        label: 'Vibrato' },
    { key: 'tremolo',        label: 'Tremolo' },
    { key: 'tap',            label: 'Tap' },
    { key: 'slap',           label: 'Slap' },
    { key: 'pluck',          label: 'Pop (Pluck)' },
    { key: 'link_next',      label: 'Link Next' },
    { key: 'ignore',         label: 'Ignore' },
];

export function _selectedNotes() {
    if (!S.sel || S.sel.size === 0) return [];
    const nn = notes();
    return [...S.sel].map(i => nn[i]).filter(Boolean);
}

// Reduce a getter across the selection: returns the shared value, or
// `null` when the selection is mixed. Used to render either a concrete
// value or the "(mixed)" placeholder.
function _selSharedValue(sel, getter, eq) {
    eq = eq || ((a, b) => a === b);
    if (sel.length === 0) return null;
    const first = getter(sel[0]);
    for (let i = 1; i < sel.length; i++) {
        if (!eq(getter(sel[i]), first)) return null;
    }
    return first;
}

export function _renderInspector() {
    const el = document.getElementById('editor-inspector');
    if (!el) return;
    const sel = _selectedNotes();
    const wasVisible = !el.classList.contains('hidden');
    if (sel.length === 0) {
        if (wasVisible) {
            el.classList.add('hidden');
            el.innerHTML = '';
            // Hiding the panel grows the canvas wrap back to full
            // width — without a resize the canvas backing buffer keeps
            // the old narrower width and we render into a stale region.
            host.scheduleCanvasResize();
        }
        return;
    }
    if (!wasVisible) {
        el.classList.remove('hidden');
        // Showing the panel shrinks the canvas wrap; refresh the canvas
        // backing dimensions so notes stay inside the visible region
        // instead of being clipped past the panel's left edge.
        host.scheduleCanvasResize();
    }

    // Header: condensed summary of the selection.
    const sharedString = _selSharedValue(sel, n => n.string);
    const sharedFret = _selSharedValue(sel, n => n.fret);
    const sharedTime = _selSharedValue(sel, n => n.time);
    const sharedSustain = _selSharedValue(sel, n => n.sustain || 0);
    const headerCount = sel.length === 1
        ? '1 note selected'
        : `${sel.length} notes selected`;
    const mixed = '<span class="text-amber-400">(mixed)</span>';
    const fmtStr = v => v === null ? mixed : v;
    const fmtTime = v => v === null ? mixed : v.toFixed(3);
    const fmtSus = v => v === null ? mixed : (v || 0).toFixed(3);

    // Numeric inputs — when the selection has a shared value, prefill
    // it; when mixed, leave blank and let the user supply a new value
    // that applies to all.
    const sharedBend = _selSharedValue(sel, n => (n.techniques && n.techniques.bend) || 0);
    const sharedBt = _selSharedValue(sel, n => (n.techniques && n.techniques.bend_intent) || 0);
    const sharedSlide = _selSharedValue(sel, n => {
        const v = n.techniques && n.techniques.slide_to;
        return v === undefined ? -1 : v;
    });
    const sharedSlideU = _selSharedValue(sel, n => {
        const v = n.techniques && n.techniques.slide_unpitch_to;
        return v === undefined ? -1 : v;
    });
    // Teaching marks (§6.2.2): fret-hand finger, scale-degree override, strum
    // group. Default to -1 (unset) so a note that never authored them reads as
    // unset rather than "mixed" against an authored sibling.
    const sharedFinger = _selSharedValue(sel, n => {
        const v = n.techniques && n.techniques.fret_finger;
        return Number.isInteger(v) ? v : -1;
    });
    const sharedScaleDeg = _selSharedValue(sel, n => {
        const v = n.techniques && n.techniques.scale_degree;
        return Number.isInteger(v) ? v : -1;
    });
    const sharedStrum = _selSharedValue(sel, n => {
        const v = n.techniques && n.techniques.strum_group;
        return Number.isInteger(v) ? v : -1;
    });
    const inputVal = v => v === null ? '' : String(v);

    // Chord inspector (E1): when the selection is a chord (>=2 notes sharing a
    // time), author the shared chord template — name / displayName / per-string
    // fingering / arp. Edits land on the matching `arr.chord_templates` entry
    // (created if this chord hasn't been saved yet), which reconstructChords()
    // carries through save via relinkChordTemplate.
    const chordHtml = _chordInspectorHtml(_selectedChordContext(sel));

    let html = `
        <div class="space-y-1">
            <div class="font-semibold text-gray-100">${headerCount}</div>
            <div class="text-gray-400">string: ${fmtStr(sharedString)}</div>
            <div class="text-gray-400">fret: ${fmtStr(sharedFret)}</div>
            <div class="text-gray-400">time: ${fmtTime(sharedTime)}</div>
            <div class="text-gray-400">sustain: ${fmtSus(sharedSustain)}</div>
        </div>
        ${chordHtml}
        <div class="space-y-2 border-t border-gray-700 pt-3">
            <label class="flex items-center gap-2">
                <span class="w-24 text-gray-400">Time (s)</span>
                <input type="number" min="0" step="0.01" value="${inputVal(sharedTime)}"
                    placeholder="${sharedTime === null ? 'mixed' : ''}"
                    onchange="editorInspectorSetField('time', this.value)"
                    class="flex-1 bg-dark-700 border border-gray-700 rounded px-1 py-0.5 text-xs"
                    title="Set the note's start time in seconds (for aligning to the recording)">
            </label>
            <label class="flex items-center gap-2">
                <span class="w-24 text-gray-400">Sustain</span>
                <input type="number" min="0" step="0.05" value="${inputVal(sharedSustain)}"
                    placeholder="${sharedSustain === null ? 'mixed' : ''}"
                    onchange="editorInspectorSetField('sustain', this.value)"
                    class="flex-1 bg-dark-700 border border-gray-700 rounded px-1 py-0.5 text-xs">
            </label>
            <label class="flex items-center gap-2">
                <span class="w-24 text-gray-400">Bend (semi)</span>
                <input type="number" min="0" max="3" step="0.5" value="${inputVal(sharedBend)}"
                    placeholder="${sharedBend === null ? 'mixed' : ''}"
                    onchange="editorInspectorSetTech('bend', this.value)"
                    class="flex-1 bg-dark-700 border border-gray-700 rounded px-1 py-0.5 text-xs">
            </label>
            <label class="flex items-center gap-2">
                <span class="w-24 text-gray-400">Bend intent</span>
                <select onchange="editorInspectorSetBendIntent(this.value)"
                    class="flex-1 bg-dark-700 border border-gray-700 rounded px-1 py-0.5 text-xs">
                    ${BEND_INTENTS.map(o => `<option value="${o.v}"${o.v === (sharedBt ?? 0) ? ' selected' : ''}>${o.label}</option>`).join('')}
                </select>
            </label>
            <div class="flex items-center gap-2">
                <span class="w-24 text-gray-400">Bend curve</span>
                <button type="button" onclick="editorOpenBendCurve()"
                    class="flex-1 bg-dark-700 hover:bg-dark-600 border border-gray-700 rounded px-1 py-0.5 text-xs">Edit curve…</button>
            </div>
            <label class="flex items-center gap-2">
                <span class="w-24 text-gray-400">Slide to</span>
                <input type="number" min="-1" max="24" step="1" value="${inputVal(sharedSlide)}"
                    placeholder="${sharedSlide === null ? 'mixed' : ''}"
                    onchange="editorInspectorSetTech('slide_to', this.value)"
                    class="flex-1 bg-dark-700 border border-gray-700 rounded px-1 py-0.5 text-xs">
            </label>
            <label class="flex items-center gap-2">
                <span class="w-24 text-gray-400">Slide unp.</span>
                <input type="number" min="-1" max="24" step="1" value="${inputVal(sharedSlideU)}"
                    placeholder="${sharedSlideU === null ? 'mixed' : ''}"
                    onchange="editorInspectorSetTech('slide_unpitch_to', this.value)"
                    class="flex-1 bg-dark-700 border border-gray-700 rounded px-1 py-0.5 text-xs">
            </label>
        </div>
        <div class="space-y-2 border-t border-gray-700 pt-3">
            <div class="text-gray-500 text-[10px] uppercase tracking-wide">Teaching marks</div>
            <label class="flex items-center gap-2">
                <span class="w-24 text-gray-400">Finger</span>
                <select onchange="editorInspectorSetFretFinger(this.value)"
                    class="flex-1 bg-dark-700 border border-gray-700 rounded px-1 py-0.5 text-xs">
                    ${FRET_FINGER_OPTIONS.map(o => `<option value="${o.v}"${o.v === (sharedFinger ?? -1) ? ' selected' : ''}>${o.label}</option>`).join('')}
                </select>
            </label>
            <label class="flex items-center gap-2">
                <span class="w-24 text-gray-400">Scale deg.</span>
                <input type="number" min="-1" max="11" step="1" value="${inputVal(sharedScaleDeg)}"
                    placeholder="${sharedScaleDeg === null ? 'mixed' : 'auto'}"
                    title="0–11 semitones above the key tonic; -1 / blank = auto-derive"
                    onchange="editorInspectorSetScaleDegree(this.value)"
                    class="flex-1 bg-dark-700 border border-gray-700 rounded px-1 py-0.5 text-xs">
            </label>
            <div class="flex items-center gap-2">
                <span class="w-24 text-gray-400">Strum grp ${sharedStrum === null ? '(mixed)' : (sharedStrum >= 0 ? '#' + sharedStrum : '—')}</span>
                <button type="button" onclick="editorGroupAsStrum()"
                    class="flex-1 bg-dark-700 hover:bg-dark-600 border border-gray-700 rounded px-1 py-0.5 text-xs">Group</button>
                <button type="button" onclick="editorUngroupStrum()"
                    class="flex-1 bg-dark-700 hover:bg-dark-600 border border-gray-700 rounded px-1 py-0.5 text-xs">Ungroup</button>
            </div>
        </div>
        <div class="space-y-1 border-t border-gray-700 pt-3">`;

    for (const f of _INSPECTOR_FLAGS) {
        const sharedFlag = _selSharedValue(sel, n => !!(n.techniques && n.techniques[f.key]));
        // Three states: true / false / null (mixed). HTML's `indeterminate`
        // is only set via property, not attribute — handle it after
        // injecting via the post-mount pass below.
        const checked = sharedFlag === true;
        const indeterminate = sharedFlag === null;
        html += `
            <label class="flex items-center gap-2">
                <input type="checkbox" data-flag="${f.key}" ${checked ? 'checked' : ''}
                    ${indeterminate ? 'data-indeterminate="1"' : ''}
                    onchange="editorInspectorSetFlag('${f.key}', this.checked)"
                    class="rounded border-gray-600 bg-dark-700">
                <span>${f.label}</span>
            </label>`;
    }
    html += `</div>`;
    el.innerHTML = html;

    // Apply indeterminate state to the inputs that need it — the
    // attribute alone doesn't work; the JS property does.
    for (const cb of el.querySelectorAll('input[type=checkbox][data-indeterminate="1"]')) {
        cb.indeterminate = true;
    }
}

// Inspector mutators. All operate on the full S.sel so a multi-select
// edit applies bulk-style. Edits skip the undo history for now — PR3b
// keeps the scope tight; a TechBulkCmd lands when the inspector grows
// to need richer per-edit undo (PR3c handles tone/anchor lanes, where
// undo IS load-bearing).

// Bounds for the inspector's numeric inputs. Mirrors the limits the
// prompt-based editors (`promptFret`, `promptSlide`, `promptBend`)
// enforce — `type="number" min/max` on the inputs is only a UI hint;
// users can paste / type out-of-range values, so we clamp here too.
export const _INSPECTOR_BOUNDS = {
    // Time (start position, seconds): non-negative, no upper clamp (a note
    // can't sit before the song start; the duration bound is soft). Lets an
    // author type a precise onset to align a note to the recording.
    time: { min: 0, max: Infinity, integer: false },
    // Sustain has no hard upper bound elsewhere (drag-resize / add-note
    // dialog leave it unconstrained), so the inspector matches — only
    // the lower clamp matters for input sanity.
    sustain: { min: 0, max: Infinity, integer: false },
    bend:    { min: 0, max: 3,  integer: false }, // half-steps, 3 = +3 semitones
    // `emptyAs: -1` matches the prompt semantic ("-1 or empty = no
    // slide") so the inspector and `promptSlide` / `promptSlideUnpitch`
    // accept the same set of inputs. Without it, deleting the input
    // value would be treated as a parse error and silently bounce back.
    slide_to:         { min: -1, max: 24, integer: true, emptyAs: -1 },
    slide_unpitch_to: { min: -1, max: 24, integer: true, emptyAs: -1 },
};

export function _coerceInspectorNumber(rawValue, bounds) {
    if (rawValue === null || rawValue === undefined) return null;
    const s = String(rawValue).trim();
    if (s === '') {
        // Some fields (slide_to, slide_unpitch_to) interpret an empty
        // input as a "clear" affordance — match the prompt-based path.
        return bounds.emptyAs !== undefined ? bounds.emptyAs : null;
    }
    let v;
    if (bounds.integer) {
        // Strict plain-decimal integer regex — matches the
        // prompt-based path's `_parseFretInput`. Rejects `1e1`, `1.9`,
        // `12abc` so the inspector and the right-click prompt produce
        // the same accept/reject decision on identical input.
        if (!/^[-+]?\d+$/.test(s)) return null;
        v = Number(s);
    } else {
        // `Number('1e1abc')` is NaN; `parseFloat('1e1abc')` would
        // partial-parse to 10. Use `Number(...)` so junk-tail input
        // rejects instead of coercing.
        v = Number(s);
    }
    if (!Number.isFinite(v)) return null;
    if (v < bounds.min) v = bounds.min;
    if (v > bounds.max) v = bounds.max;
    return v;
}

export function editorInspectorSetField(field, raw) {
    const idxs = host.editorCurrentNoteIndices();
    if (!idxs.length) return;
    const bounds = _INSPECTOR_BOUNDS[field];
    if (!bounds) return;
    const v = _coerceInspectorNumber(raw, bounds);
    if (v === null) {
        // Reject silently — but re-render so the input snaps back to
        // the current shared value instead of leaving the user looking
        // at an unapplied edit.
        _renderInspector();
        return;
    }
    // Route through the undo history: the sustain edit used to mutate
    // notes in place with no undo, and Time is new. Both apply to every
    // selected note (matching the field's "set all" semantics) as one
    // command, so a numeric edit is a single Ctrl+Z.
    const nn = notes();
    if (field === 'sustain') {
        S.history.exec(new ResizeSustainGroupCmd(idxs, idxs.map(() => v)));
    } else if (field === 'time') {
        // MoveNoteCmd applies per-note deltas; convert the absolute target
        // time to a delta per note (no re-sort — same as _editorResnapSelection,
        // and hitNote is a linear scan, so order isn't load-bearing).
        const dtimes = idxs.map(i => v - (nn[i] ? nn[i].time : 0));
        S.history.exec(new MoveNoteCmd(idxs, dtimes, idxs.map(() => 0), null));
    } else {
        return;
    }
    host.draw();
    host.updateStatus();
}

export function editorInspectorSetTech(key, raw) {
    const sel = _selectedNotes();
    if (sel.length === 0) return;
    // Read-only roll (V4): scalar technique edits mutate n.techniques in
    // place (no EditHistory command), so the exec lock never sees them.
    // Refuse and bounce the input back to the model value.
    if (_rollReadOnly()) { _rollLockNotice(); _renderInspector(); return; }
    const bounds = _INSPECTOR_BOUNDS[key];
    if (!bounds) return;
    const v = _coerceInspectorNumber(raw, bounds);
    if (v === null) {
        // Same as `editorInspectorSetField` — bounce the input back
        // to the current shared value on rejection so the panel can't
        // drift visually from the underlying model.
        _renderInspector();
        return;
    }
    for (const n of sel) {
        if (!n.techniques) n.techniques = {};
        n.techniques[key] = v;
        // Editing the scalar peak must keep any authored curve consistent
        // (renderers/graders read bnv as authoritative): rescale the curve to
        // the new peak, or drop it when the peak is 0 / the curve is unscalable.
        if (key === 'bend' && sanitizeBendCurve(n.techniques.bend_values)) {
            const scaled = v > 0
                ? rescaleBendCurveToPeak(n.techniques.bend_values, v)
                : null;
            n.techniques.bend_values = scaled;
            // bnv rounds points to 0.1, so a non-0.1 `v` (e.g. 0.25) would leave
            // bn disagreeing with the curve's real peak. Snap bn to the curve.
            if (scaled) n.techniques.bend = scaled.reduce((m, p) => Math.max(m, p.v), 0);
        }
    }
    host.draw();
    host.updateStatus();
}

export function editorInspectorSetBendIntent(raw) {
    const idxs = [...(S.sel || [])];
    if (!idxs.length) return;
    const bt = Number(raw) || 0;
    S.history.exec(new SetBendIntentCmd(idxs, bt));
    host.draw();
    host.updateStatus();
    _renderInspector();
}

export function editorOpenBendCurve() {
    const idxs = [...(S.sel || [])];
    if (!idxs.length) return;
    // promptBend re-derives the target set from S.sel; pass any selected index.
    host.promptBend(idxs[0]);
}

export function editorInspectorSetFlag(key, on) {
    const sel = _selectedNotes();
    if (sel.length === 0) return;
    // Read-only roll (V4): flag toggles mutate n.techniques directly — same
    // bypass as editorInspectorSetTech. Refuse and re-render to reset the box.
    if (_rollReadOnly()) { _rollLockNotice(); _renderInspector(); return; }
    for (const n of sel) {
        if (!n.techniques) n.techniques = {};
        n.techniques[key] = !!on;
    }
    host.draw();
    host.updateStatus();
}

// ─── Teaching marks (§6.2.2) ────────────────────────────────────────
// Author fg (fret-hand finger), sd (scale-degree override) and ch (strum
// group) on the current selection. Each is one undoable batch edit
// (SetTeachingMarkCmd). Display only — these never affect grading.
function _applyTeachingMark(key, value) {
    const idxs = [...(S.sel || [])];
    if (!idxs.length) return;
    S.history.exec(new SetTeachingMarkCmd(idxs, key, value));
    host.draw();
    host.updateStatus();
    _renderInspector();
}

export function editorInspectorSetFretFinger(raw) {
    const v = Math.trunc(Number(raw));
    if (!Number.isFinite(v)) return;
    _applyTeachingMark('fret_finger', Math.max(-1, Math.min(4, v)));
}

export function editorInspectorSetScaleDegree(raw) {
    const s = String(raw).trim();
    // Empty input clears the override back to -1 (auto/unset).
    const v = s === '' ? -1 : Math.trunc(Number(s));
    if (!Number.isFinite(v)) { _renderInspector(); return; }
    _applyTeachingMark('scale_degree', Math.max(-1, Math.min(11, v)));
}

// "Group as strum": assign every selected note a shared, unused ch key so the
// highway renders them as one strum/rake gesture (pkd gives direction).
export function editorGroupAsStrum() {
    if (!(S.sel && S.sel.size)) return;
    _applyTeachingMark('strum_group', nextUnusedStrumGroup(notes()));
}

// "Ungroup": clear the strum-group key on the selection (-1 = not grouped).
export function editorUngroupStrum() {
    if (!(S.sel && S.sel.size)) return;
    _applyTeachingMark('strum_group', -1);
}

// ─── Chord inspector (E1) ───────────────────────────────────────────
// Resolve the current selection to a chord and its width-L fret pattern +
// matching chord template, or null when the selection isn't a chord.
//
// The fret pattern is built from the FULL save-time group — every note sharing
// the selection's `time.toFixed(4)` key — not just the selected subset, and
// using the same key reconstructChords() groups by. That way a partial
// selection (e.g. rectangle-selecting 2 of a 3-note chord) still authors the
// triad's fret key, so the metadata survives the save-time rebuild instead of
// being dropped onto a dyad key reconstructChords() never produces.
export function _selectedChordContext(sel) {
    sel = sel || _selectedNotes();
    if (sel.length < 2) return null;
    if (!S.arrangements.length) return null;
    const arr = S.arrangements[S.currentArr];
    if (!arr) return null;
    // The selection must fall within a single save-time group; reconstructChords
    // keys groups on `time.toFixed(4)`, so match that exactly.
    const key = sel[0].time.toFixed(4);
    for (const n of sel) { if (n.time.toFixed(4) !== key) return null; }
    const L = lanes();
    const frets = new Array(L).fill(-1);
    const group = [];
    for (const n of notes()) {
        if (n.time.toFixed(4) !== key) continue;
        group.push(n);
        if (n.string >= 0 && n.string < L) frets[n.string] = n.fret;
    }
    if (group.length < 2) return null; // single note at this time isn't a chord
    const fretKey = _fretKeyForL(frets, L);
    let tmpl = null;
    for (const ct of (arr.chord_templates || [])) {
        if (ct && Array.isArray(ct.frets) && _fretKeyForL(ct.frets, L) === fretKey) { tmpl = ct; break; }
    }
    // Harmony function rides the instance — carried on the chord's notes (_fn).
    const fn = _groupFn(group);
    return { arr, L, frets, fretKey, tmpl, key, fn, group };
}

function _chordAttrEsc(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/"/g, '&quot;')
        .replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Build the chord-section HTML, or '' when the selection isn't a chord. Finger
// pickers are shown only for sounding strings (fret >= 0); unused strings carry
// no finger.
function _chordInspectorHtml(ctx) {
    if (!ctx) return '';
    const t = ctx.tmpl;
    const name = t && typeof t.name === 'string' ? t.name : '';
    const displayName = t && typeof t.displayName === 'string' ? t.displayName : '';
    const arp = !!(t && t.arp);
    const voicing = t && typeof t.voicing === 'string' ? t.voicing : '';
    // Harmony function (§6.3.1) rides the chord instance, not the template.
    const fn = ctx.fn || {};
    const fnRn = typeof fn.rn === 'string' ? fn.rn : '';
    const fnQ = typeof fn.q === 'string' ? fn.q : '';
    const fnDeg = Number.isInteger(fn.deg) ? String(fn.deg) : '';
    const VOICINGS = ['', 'open', 'triad', 'shell', 'drop2', 'drop3', 'barre'];
    const voicingOpts = VOICINGS.map(v =>
        `<option value="${_chordAttrEsc(v)}"${v === voicing ? ' selected' : ''}>${v || '—'}</option>`).join('');
    // §6.6 CAGED shape + guide tones (template fields, display only).
    const caged = _sanitizeCaged(t && t.caged);
    const CAGED_SHAPES = ['', 'C', 'A', 'G', 'E', 'D'];
    const cagedOpts = CAGED_SHAPES.map(v =>
        `<option value="${_chordAttrEsc(v)}"${v === caged ? ' selected' : ''}>${v || '—'}</option>`).join('');
    const guideTonesStr = _sanitizeGuideTones(t && t.guideTones).join(', ');

    let fingersHtml = '';
    for (let i = 0; i < ctx.L; i++) {
        const fr = ctx.frets[i];
        if (fr < 0) continue;
        const cur = (t && Array.isArray(t.fingers) && Number.isFinite(t.fingers[i])) ? t.fingers[i] : -1;
        const opt = (v, label) => `<option value="${v}" ${cur === v ? 'selected' : ''}>${label}</option>`;
        fingersHtml += `
            <label class="flex items-center gap-2">
                <span class="w-24 text-gray-400">S${i + 1} (fret ${fr})</span>
                <select onchange="editorChordSetFinger(${i}, this.value)"
                    class="flex-1 bg-dark-700 border border-gray-700 rounded px-1 py-0.5 text-xs">
                    ${opt(-1, '—')}${opt(0, 'open')}${opt(1, '1')}${opt(2, '2')}${opt(3, '3')}${opt(4, '4')}
                </select>
            </label>`;
    }

    return `
        <div class="space-y-2 border-t border-gray-700 pt-3">
            <div class="font-semibold text-gray-100">Chord</div>
            <label class="flex items-center gap-2">
                <span class="w-24 text-gray-400">Name</span>
                <input type="text" value="${_chordAttrEsc(name)}" placeholder="e.g. Em7"
                    onchange="editorChordSetName(this.value)"
                    class="flex-1 bg-dark-700 border border-gray-700 rounded px-1 py-0.5 text-xs">
            </label>
            <label class="flex items-center gap-2">
                <span class="w-24 text-gray-400">Display</span>
                <input type="text" value="${_chordAttrEsc(displayName)}"
                    placeholder="${_chordAttrEsc(name) || 'same as name'}"
                    onchange="editorChordSetDisplayName(this.value)"
                    class="flex-1 bg-dark-700 border border-gray-700 rounded px-1 py-0.5 text-xs">
            </label>
            ${fingersHtml}
            <label class="flex items-center gap-2">
                <input type="checkbox" ${arp ? 'checked' : ''}
                    onchange="editorChordToggleArp(this.checked)"
                    class="rounded border-gray-600 bg-dark-700">
                <span>Arpeggio</span>
            </label>
            <label class="flex items-center gap-2">
                <span class="w-24 text-gray-400">Voicing</span>
                <select onchange="editorChordSetVoicing(this.value)"
                    title="§6.6 key-independent voicing type (display only)"
                    class="flex-1 bg-dark-700 border border-gray-700 rounded px-1 py-0.5 text-xs">
                    ${voicingOpts}
                </select>
            </label>
            <label class="flex items-center gap-2">
                <span class="w-24 text-gray-400">CAGED</span>
                <select onchange="editorChordSetCaged(this.value)"
                    title="§6.6 CAGED shape the fingering derives from (display only)"
                    class="flex-1 bg-dark-700 border border-gray-700 rounded px-1 py-0.5 text-xs">
                    ${cagedOpts}
                </select>
            </label>
            <label class="flex items-center gap-2">
                <span class="w-24 text-gray-400">Guide tones</span>
                <input type="text" value="${_chordAttrEsc(guideTonesStr)}" placeholder="e.g. 4, 10"
                    onchange="editorChordSetGuideTones(this.value)"
                    title="§6.6 semitone offsets 0-11 above the root (display only)"
                    class="flex-1 bg-dark-700 border border-gray-700 rounded px-1 py-0.5 text-xs">
            </label>
            <div class="space-y-2 border-t border-gray-700 pt-3">
                <div class="text-gray-500 text-[10px] uppercase tracking-wide"
                    title="§6.3.1 harmonic function — display only; all three needed to persist">Function</div>
                <label class="flex items-center gap-2">
                    <span class="w-24 text-gray-400">Numeral</span>
                    <input type="text" value="${_chordAttrEsc(fnRn)}" placeholder="e.g. ii7"
                        onchange="editorChordSetFnRn(this.value)"
                        class="flex-1 bg-dark-700 border border-gray-700 rounded px-1 py-0.5 text-xs">
                </label>
                <label class="flex items-center gap-2">
                    <span class="w-24 text-gray-400">Quality</span>
                    <input type="text" value="${_chordAttrEsc(fnQ)}" placeholder="e.g. m7"
                        onchange="editorChordSetFnQuality(this.value)"
                        class="flex-1 bg-dark-700 border border-gray-700 rounded px-1 py-0.5 text-xs">
                </label>
                <label class="flex items-center gap-2">
                    <span class="w-24 text-gray-400">Root deg.</span>
                    <input type="number" min="0" max="11" step="1" value="${_chordAttrEsc(fnDeg)}"
                        placeholder="0–11"
                        title="0–11 semitones of the chord root above the key tonic"
                        onchange="editorChordSetFnDeg(this.value)"
                        class="flex-1 bg-dark-700 border border-gray-700 rounded px-1 py-0.5 text-xs">
                </label>
            </div>
        </div>`;
}

// Apply a patch (subset of {name, displayName, fingers, arp}) to the selected
// chord's template via the undo history.
function _editorChordPatch(patch) {
    const ctx = _selectedChordContext();
    if (!ctx) return;
    S.history.exec(new EditChordTemplateCmd(S.currentArr, ctx.L, ctx.frets, patch));
    host.draw();
    _renderInspector();
}

export function editorChordSetName(raw) { return _editorChordPatch({ name: String(raw == null ? '' : raw).trim() }); }
export function editorChordSetDisplayName(raw) { return _editorChordPatch({ displayName: String(raw == null ? '' : raw).trim() }); }
export function editorChordToggleArp(on) { return _editorChordPatch({ arp: !!on }); }
export function editorChordSetVoicing(raw) { return _editorChordPatch({ voicing: String(raw == null ? '' : raw).trim() }); }
// §6.6 CAGED shape + guide tones — enum/range-guarded, routed as one undoable
// template patch like voicing (sanitizers live in the @pure:chord-relink block).
export function editorChordSetCaged(raw) { return _editorChordPatch({ caged: _sanitizeCaged(raw) }); }
export function editorChordSetGuideTones(raw) { return _editorChordPatch({ guideTones: _parseGuideTones(raw) }); }

// Apply a partial harmony-function patch ({rn?|q?|deg?}) to the selected
// chord's instance (the notes at its time), merged onto the current fn, via the
// undo history. fn rides the instance, so it is NOT a template patch.
function _editorChordFnPatch(patch) {
    const ctx = _selectedChordContext();
    if (!ctx) return;
    S.history.exec(new EditChordFnCmd(S.currentArr, ctx.key, ctx.fn, patch));
    host.draw();
    _renderInspector();
}

export function editorChordSetFnRn(raw) { return _editorChordFnPatch({ rn: String(raw == null ? '' : raw).trim() }); }
export function editorChordSetFnQuality(raw) { return _editorChordFnPatch({ q: String(raw == null ? '' : raw).trim() }); }
export function editorChordSetFnDeg(raw) {
    const s = String(raw == null ? '' : raw).trim();
    // Blank clears deg; otherwise parse and clamp-validate to 0..11 (else clear).
    const d = s === '' ? null : parseInt(s, 10);
    _editorChordFnPatch({ deg: (Number.isInteger(d) && d >= 0 && d <= 11) ? d : null });
}
export function editorChordSetFinger(stringIdx, raw) {
    const ctx = _selectedChordContext();
    if (!ctx) return;
    const i = Number(stringIdx);
    if (!Number.isInteger(i) || i < 0 || i >= ctx.L) return;
    const v = parseInt(raw, 10);
    if (![-1, 0, 1, 2, 3, 4].includes(v)) { _renderInspector(); return; }
    // Fingers persist as one width-L array — start from the current template
    // (or a blank width-L array) and change just this string.
    const base = _normFingers(ctx.tmpl && ctx.tmpl.fingers, ctx.L);
    base[i] = v;
    _editorChordPatch({ fingers: base });
}

