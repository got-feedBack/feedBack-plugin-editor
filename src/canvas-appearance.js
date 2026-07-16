// Canvas appearance — user-customizable grid/canvas palette (View ▸ Canvas
// appearance…). The DAW-parity model is Ableton Live 12's Theme ▸
// Customization tab: grid-line opacity, brightness, color intensity, hue —
// applied here to the timeline canvas's STRUCTURAL colors only (lane
// backgrounds, separators, grid lines, gutters). Identity-bearing colors are
// deliberately out of scope: string/lane colors, drum piece colors, note and
// selection/playhead colors all carry meaning and never restyle.
//
// Community origin: an EOF charter couldn't see the 2/3/4 beat grid lines at
// all on the default palette; an Ableton user asked for Live-style grid
// customization rather than a one-off brighter constant.
//
// Settings are a GLOBAL editor preference (localStorage, like editorTheme —
// the chrome theme deliberately leaves the canvas alone; this is the canvas
// counterpart). Draw code reads colors via `CP(name)`; adjusted colors are
// cached per settings generation, so the per-frame cost is a map lookup.

import { host } from './host.js';

/* @pure:canvas-appearance:start */
// Slider ranges. 100 = the shipped default palette. Grid strength runs past
// 100 so a charter can push faint subdivision lines all the way to obvious.
export const CANVAS_APPEARANCE_DEFAULTS = Object.freeze({
    grid: 100,        // grid/separator line strength, 25..400 (%)
    brightness: 100,  // canvas background lift, 50..250 (%)
    intensity: 100,   // color saturation, 0..200 (%)
    hue: 0,           // hue rotation, -180..180 (degrees)
});
const _RANGES = {
    grid: [25, 400], brightness: [50, 250], intensity: [0, 200], hue: [-180, 180],
};

// Clamp one field to its range; junk (NaN, strings, missing) falls back to
// the default so a hand-edited localStorage blob can't produce an invisible
// or blinding canvas.
export function _appearanceFieldPure(field, value) {
    const def = CANVAS_APPEARANCE_DEFAULTS[field];
    if (def === undefined) return undefined;
    // Number(null) and Number('') are both 0 (→ clamped to the min, not the
    // default), so reject null and blank/whitespace-only strings before coercion.
    if (value === null) return def;
    if (typeof value === 'string' && value.trim() === '') return def;
    const n = Number(value);
    if (!Number.isFinite(n)) return def;
    const [lo, hi] = _RANGES[field];
    return Math.min(hi, Math.max(lo, Math.round(n)));
}

export function _sanitizeAppearancePure(raw) {
    const src = (raw && typeof raw === 'object') ? raw : {};
    const out = {};
    for (const k of Object.keys(CANVAS_APPEARANCE_DEFAULTS)) {
        out[k] = _appearanceFieldPure(k, src[k]);
    }
    return out;
}

// #rgb / #rrggbb → {h: 0..360, s: 0..1, l: 0..1}, null on junk.
export function _hexToHslPure(hex) {
    if (typeof hex !== 'string') return null;
    let m = hex.trim();
    if (/^#[0-9a-fA-F]{3}$/.test(m)) {
        m = '#' + m[1] + m[1] + m[2] + m[2] + m[3] + m[3];
    }
    if (!/^#[0-9a-fA-F]{6}$/.test(m)) return null;
    const r = parseInt(m.slice(1, 3), 16) / 255;
    const g = parseInt(m.slice(3, 5), 16) / 255;
    const b = parseInt(m.slice(5, 7), 16) / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const l = (max + min) / 2;
    if (max === min) return { h: 0, s: 0, l };
    const d = max - min;
    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    let h;
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
    else if (max === g) h = ((b - r) / d + 2) * 60;
    else h = ((r - g) / d + 4) * 60;
    return { h, s, l };
}

export function _hslToHexPure(h, s, l) {
    const hue2rgb = (p, q, t) => {
        if (t < 0) t += 1;
        if (t > 1) t -= 1;
        if (t < 1 / 6) return p + (q - p) * 6 * t;
        if (t < 1 / 2) return q;
        if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
        return p;
    };
    const hh = ((h % 360) + 360) % 360 / 360;
    let r, g, b;
    if (s === 0) { r = g = b = l; }
    else {
        const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
        const p = 2 * l - q;
        r = hue2rgb(p, q, hh + 1 / 3);
        g = hue2rgb(p, q, hh);
        b = hue2rgb(p, q, hh - 1 / 3);
    }
    const c = (v) => Math.round(Math.min(1, Math.max(0, v)) * 255)
        .toString(16).padStart(2, '0');
    return '#' + c(r) + c(g) + c(b);
}

// One structural color through the appearance settings. Grid-bucket entries
// (grid lines, separators) additionally take the grid-strength multiplier on
// lightness — the "can't see the beat lines" lever. Junk hex passes through
// unchanged so a bad palette entry degrades to the old look, never a crash.
export function _adjustHexPure(hex, settings, isGrid) {
    const hsl = _hexToHslPure(hex);
    if (!hsl) return hex;
    const s = _sanitizeAppearancePure(settings);
    let { h, s: sat, l } = hsl;
    h += s.hue;
    sat = Math.min(1, sat * (s.intensity / 100));
    l *= (s.brightness / 100);
    if (isGrid) l *= (s.grid / 100);
    l = Math.min(0.92, Math.max(0, l));   // never clip to pure white
    return _hslToHexPure(h, sat, l);
}
/* @pure:canvas-appearance:end */

// ── The structural canvas palette (base = the shipped defaults) ──────
// gridBeat/gridMeasure are deliberately brighter than the pre-appearance
// constants (#16162c/#2a2a50): the old beat lines were invisible on some
// panels (the community report), and 100% should be visible out of the box.
const _BASE = {
    laneEven: '#0c0c1c',
    laneOdd: '#0f0f24',
    laneSep: '#1a1a35',
    pianoRowBlack: '#0a0a1a',
    pianoRowWhite: '#0e0e22',
    octaveLine: '#2a2a55',
    gridBeat: '#20203e',
    gridMeasure: '#32325c',
    gutterBg: '#0a0a1a',
    partsLaneArmed: '#141432',
    partsHeader: '#101024',
    partsHeaderArmed: '#191945',
    partsGutterLine: '#22224a',
    partsDownbeat: '#1a1a2e',
};
const _GRID_KEYS = new Set([
    'gridBeat', 'gridMeasure', 'laneSep', 'octaveLine',
    'partsGutterLine', 'partsDownbeat',
]);

const _LS_KEY = 'editorCanvasAppearance';
let _settings = null;   // lazily loaded, sanitized
let _gen = 0;           // bumped on every change → invalidates the color cache
let _cache = { gen: -1, colors: Object.create(null) };

function _load() {
    if (_settings) return _settings;
    let raw = null;
    try { raw = JSON.parse(localStorage.getItem(_LS_KEY) || 'null'); }
    catch (_) { /* ignore */ }
    _settings = _sanitizeAppearancePure(raw);
    return _settings;
}

function _save() {
    try { localStorage.setItem(_LS_KEY, JSON.stringify(_settings)); }
    catch (_) { /* ignore */ }
}

export function canvasAppearance() {
    return { ..._load() };
}

export function setCanvasAppearance(field, value) {
    const s = _load();
    const v = _appearanceFieldPure(field, value);
    if (v === undefined || s[field] === v) return;
    s[field] = v;
    _gen++;
    _save();
}

export function resetCanvasAppearance() {
    _settings = { ...CANVAS_APPEARANCE_DEFAULTS };
    _gen++;
    _save();
}

// The palette accessor draw code uses. Cached per settings generation —
// steady-state cost is one map lookup per call, no per-frame color math
// (the rAF draw-coalesce rule).
export function CP(name) {
    if (_cache.gen !== _gen) _cache = { gen: _gen, colors: Object.create(null) };
    const hit = _cache.colors[name];
    if (hit) return hit;
    const base = _BASE[name];
    if (!base) return '#000000';
    const c = _adjustHexPure(base, _load(), _GRID_KEYS.has(name));
    _cache.colors[name] = c;
    return c;
}

// ── Dialog (View ▸ Canvas appearance…) ───────────────────────────────
// Markup lives in screen.html (#editor-canvas-appearance-modal); handlers are
// window-globals like every other modal. Inputs update live so the canvas is
// its own preview. The whole block is window-guarded so the module imports
// cleanly under node (the unit-test environment) — same degrade-don't-crash
// contract as host.js.

function _syncDialog() {
    const s = _load();
    for (const k of Object.keys(CANVAS_APPEARANCE_DEFAULTS)) {
        const input = document.getElementById('editor-canvas-app-' + k);
        const label = document.getElementById('editor-canvas-app-' + k + '-val');
        if (input) input.value = String(s[k]);
        if (label) label.textContent = k === 'hue' ? s[k] + '°' : s[k] + '%';
    }
}

let _prevFocus = null;   // element to restore focus to on close

if (typeof window !== 'undefined') {
    window.editorShowCanvasAppearance = function () {
        const modal = document.getElementById('editor-canvas-appearance-modal');
        if (!modal) return;
        _syncDialog();
        modal.classList.remove('hidden');
        // Move focus into the dialog (first slider) and remember who had it.
        _prevFocus = document.activeElement;
        document.getElementById('editor-canvas-app-grid')?.focus();
    };

    window.editorHideCanvasAppearance = function () {
        const modal = document.getElementById('editor-canvas-appearance-modal');
        if (modal) modal.classList.add('hidden');
        // Hand the keyboard back to the control that opened the dialog.
        const prev = _prevFocus;
        _prevFocus = null;
        if (prev && prev.isConnected && prev.focus) prev.focus();
    };

    window.editorCanvasAppearanceInput = function (field, value) {
        setCanvasAppearance(field, value);
        _syncDialog();
        host.draw();
    };

    window.editorCanvasAppearanceReset = function () {
        resetCanvasAppearance();
        _syncDialog();
        host.draw();
    };
}
