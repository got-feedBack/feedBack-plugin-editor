/* Slopsmith Arrangement Editor — the drum-pad companion strip.
 *
 * The drum editor's counterpart to the fretboard strip (Christian's ask,
 * 2026-07-10): a docked row of kit pads — one per drum piece, grouped by
 * family — that works three ways at once:
 *
 *   VISUAL CUE   selected hits light their pads, so the piece identity of a
 *                selection reads at a glance (the lane grid shows rows;
 *                pads show the KIT).
 *   INPUT        click a pad → add a hit of that piece at the (snapped)
 *                cursor, through the same AddDrumHitCmd the lane grid uses.
 *   MIDI MAPPER  arm "Listen" and hits from an e-kit flash their pads live
 *                via the record path's monitor tap — GENERAL MIDI percussion
 *                mapped to start (the org's import default), so a drummer
 *                can verify which physical pad lands on which chart piece
 *                before recording. Mapping is read-only here; per-kit custom
 *                maps are a follow-up.
 *
 * LAYOUT (product owner, 2026-07-10): TWO switchable views in the SAME
 * companion slot the fretboard strip uses (fretted parts get a neck, drum
 * parts get a kit, one consistent place):
 *   KIT   a VSTi-style kit GRAPHIC — a drawn drum kit (kick / snare with a
 *         rim zone / rack + floor toms / hat pair with its pedal / the
 *         cymbal wash, the ride's bell as its own zone — the drum-VSTi
 *         hit-zone idiom).
 *   PADS  a sampler-style pad GRID (the MPC idiom) — square pads, one per
 *         piece, for fast clicking and a clean mapping legend.
 * Both views light, flash and click through the same data-piece wiring;
 * the choice persists as an editor pref.
 *
 * The graphic is inline SVG, never canvas: every piece is its own element
 * (data-piece + <title> tooltip), so hit-testing, lit/flash state (CSS
 * classes) and accessibility come free, and nothing repaints per frame.
 * Shown only in drum edit mode; the toggle persists as an editor pref.
 */

import { S } from './state.js';
import { host } from './host.js';
import { setStatus } from './ui.js';
import { AddDrumHitCmd, DRUM_COMPACT_LANES, DRUM_PIECE_ORDER } from './drum.js';
import { _midiMonitorEnsure, _midiMonitorTap, _midiMonitorUntap } from './midi-record.js';

/* @pure:drum-pad-strip:start */

// General MIDI percussion (notes 35–59) → drum piece-ids, the same
// canonical assignments as the import path's defaults. Notes with no chart
// piece (claps, tambourine, congas…) map to null — a flash-less monitor
// hit, never a wrong pad. "GM mapped to start": per-kit custom maps layer
// on later without touching this table.
export const GM_DRUM_MAP = Object.freeze({
    35: 'kick',          // Acoustic Bass Drum
    36: 'kick',          // Bass Drum 1
    37: 'snare_xstick',  // Side Stick
    38: 'snare',         // Acoustic Snare
    40: 'snare',         // Electric Snare
    41: 'tom_floor',     // Low Floor Tom
    42: 'hh_closed',     // Closed Hi-Hat
    43: 'tom_floor',     // High Floor Tom
    44: 'hh_pedal',      // Pedal Hi-Hat
    45: 'tom_low',       // Low Tom
    46: 'hh_open',       // Open Hi-Hat
    47: 'tom_mid',       // Low-Mid Tom
    48: 'tom_mid',       // Hi-Mid Tom
    49: 'crash_l',       // Crash Cymbal 1
    50: 'tom_hi',        // High Tom
    51: 'ride',          // Ride Cymbal 1
    52: 'china',         // Chinese Cymbal
    53: 'ride_bell',     // Ride Bell
    55: 'splash',        // Splash Cymbal
    56: 'bell',          // Cowbell
    57: 'crash_r',       // Crash Cymbal 2
    59: 'ride',          // Ride Cymbal 2
});

// A raw MIDI packet → { note, velocity } for a NOTE-ON, else null (note-off,
// running status oddities, CC, …). Velocity-0 note-ons are offs per spec.
export function _padNoteOnPure(data) {
    if (!data || data.length < 3) return null;
    const cmd = data[0] & 0xF0;
    if (cmd !== 0x90 || data[2] === 0) return null;
    return { note: data[1], velocity: data[2] };
}

// The pad row model: one pad per piece in physical-kit order, tagged with
// its family label (from the compact lane table) so the row reads in the
// same groups as the compact grid. `gmNotes` lists the GM notes that land
// on the pad (for the tooltip — the mapper's documentation surface).
export function _padModelPure(pieceOrder, compactLanes, gmMap) {
    const familyOf = (p) => {
        for (const l of compactLanes) if (l.pieces.includes(p)) return l.label;
        return '';
    };
    const notesFor = (p) => Object.keys(gmMap)
        .filter((n) => gmMap[n] === p)
        .map(Number)
        .sort((a, b) => a - b);
    return pieceOrder.map((p) => ({
        piece: p,
        family: familyOf(p),
        gmNotes: notesFor(p),
    }));
}

// The kit graphic's shape table — one entry per chart piece, drawn as a
// stylized front-view kit (the drum-VSTi convention). Shapes are SVG
// primitives in a 560×190 viewBox; `zoneOf` notes the pieces that are
// ZONES of one physical instrument (snare rim, ride bell, the hat pair)
// so the renderer draws them as such. Pure data — the coverage test pins
// it against DRUM_PIECE_ORDER.
export const KIT_GRAPHIC = Object.freeze([
    // Cymbal wash (ellipses read as cymbals seen from the seat).
    { piece: 'crash_l',   kind: 'cym',  cx: 128, cy: 34,  rx: 42, ry: 10, stand: true },
    { piece: 'splash',    kind: 'cym',  cx: 205, cy: 24,  rx: 24, ry: 6,  stand: true },
    { piece: 'stack',     kind: 'cym',  cx: 262, cy: 28,  rx: 20, ry: 6,  stand: true },
    { piece: 'crash_r',   kind: 'cym',  cx: 330, cy: 26,  rx: 40, ry: 10, stand: true },
    { piece: 'china',     kind: 'cym',  cx: 448, cy: 34,  rx: 38, ry: 10, stand: true },
    { piece: 'ride',      kind: 'cym',  cx: 484, cy: 84,  rx: 46, ry: 12, stand: true },
    { piece: 'ride_bell', kind: 'cym',  cx: 484, cy: 82,  rx: 13, ry: 5,  zoneOf: 'ride' },
    // Hi-hat: the pair is two thin ellipses (top = open zone, bottom =
    // closed zone — the VSTi hit-zone idiom), the pedal at the stand's foot.
    { piece: 'hh_open',   kind: 'cym',  cx: 78,  cy: 74,  rx: 34, ry: 8,  zoneOf: 'hihat' },
    { piece: 'hh_closed', kind: 'cym',  cx: 78,  cy: 87,  rx: 34, ry: 8,  zoneOf: 'hihat', stand: true },
    { piece: 'hh_pedal',  kind: 'pedal', cx: 78, cy: 168, rx: 16, ry: 7 },
    // Drums.
    { piece: 'tom_hi',    kind: 'drum', cx: 233, cy: 76,  r: 24 },
    { piece: 'tom_mid',   kind: 'drum', cx: 296, cy: 74,  r: 26 },
    { piece: 'tom_low',   kind: 'drum', cx: 372, cy: 92,  r: 28 },
    { piece: 'tom_floor', kind: 'drum', cx: 420, cy: 142, r: 32, legs: true },
    { piece: 'snare_xstick', kind: 'rim', cx: 165, cy: 118, r: 31 },   // the rim ring under the head
    { piece: 'snare',     kind: 'drum', cx: 165, cy: 118, r: 23 },
    { piece: 'kick',      kind: 'kick', cx: 268, cy: 138, r: 46 },
    { piece: 'bell',      kind: 'bell', cx: 268, cy: 84,  w: 22, h: 14 },  // cowbell on the kick mount
]);

// The sample-pad grid (the MPC idiom): square pads, three banks of six,
// kit-ordered left→right / cymbals→feet like the lane grid reads. Pure
// data — the coverage test pins it against DRUM_PIECE_ORDER.
export const PAD_GRID_ROWS = Object.freeze([
    Object.freeze(['china', 'splash', 'crash_l', 'crash_r', 'stack', 'bell']),
    Object.freeze(['hh_open', 'hh_closed', 'hh_pedal', 'ride', 'ride_bell', 'tom_hi']),
    Object.freeze(['tom_mid', 'tom_low', 'tom_floor', 'snare', 'snare_xstick', 'kick']),
]);

// The drum companion view: 'kit' (graphic) | 'pads' (grid). Corrupt prefs
// collapse to 'kit'.
export function _drumViewPure(raw) {
    return raw === 'pads' ? 'pads' : 'kit';
}

// Which pads a selection lights: the distinct piece-ids of the selected hits.
export function _padLitPiecesPure(hits, selIdxs) {
    const out = new Set();
    if (!Array.isArray(hits)) return out;
    for (const i of selIdxs || []) {
        const h = hits[i];
        if (h && typeof h.p === 'string') out.add(h.p);
    }
    return out;
}
/* @pure:drum-pad-strip:end */

const PREF_KEY = 'editorDrumPadStrip';
const PAD_LABELS = {
    china: 'CH', splash: 'SP', crash_l: 'CR·L', crash_r: 'CR·R', stack: 'STK',
    hh_open: 'HH○', hh_closed: 'HH×', hh_pedal: 'HH⋅P',
    ride: 'RD', ride_bell: 'RD·B', bell: 'BELL',
    tom_hi: 'T1', tom_mid: 'T2', tom_low: 'T3', tom_floor: 'FT',
    snare: 'SN', snare_xstick: 'SN·X', kick: 'KICK',
};

let monitorArmed = false;
const flashTimers = new Map();

const $strip = () => document.getElementById('editor-drum-pad-strip');
const $pads = () => document.getElementById('editor-drum-pads');

export function drumPadStripEnabled() {
    // Default ON: in drum mode the pads ARE the kit legend.
    try { return localStorage.getItem(PREF_KEY) !== '0'; } catch (_) { return true; }
}

const VIEW_KEY = 'editorDrumPadView';

function gmTitle(meta, piece) {
    const m = meta.get(piece) || { family: '', gmNotes: [] };
    const gm = m.gmNotes.length ? ` — GM ${m.gmNotes.join('/')}` : ' — no GM note';
    return `${m.family}: ${piece}${gm}. Click to add a hit at the cursor.`;
}

// The VSTi-style kit graphic: inline SVG, one element per piece. Stands and
// legs are decorative (pointer-events:none via CSS class). Zones (ride bell,
// snare rim) draw after their parent so they sit on top and win the click.
function buildKitSvg(meta) {
    const el = [];
    // Decorative hardware first (under everything).
    const stands = KIT_GRAPHIC.filter((s) => s.stand)
        .map((s) => `<line class="editor-kit-hw" x1="${s.cx}" y1="${s.cy + (s.ry || 8)}" x2="${s.cx}" y2="176"/>`)
        .join('');
    el.push(stands);
    for (const s of KIT_GRAPHIC) {
        const cls = `editor-kit-piece is-${s.kind}`;
        const title = `<title>${gmTitle(meta, s.piece)}</title>`;
        if (s.kind === 'drum' || s.kind === 'rim' || s.kind === 'kick') {
            el.push(`<circle class="${cls}" data-piece="${s.piece}" cx="${s.cx}" cy="${s.cy}" r="${s.r}">${title}</circle>`);
            if (s.legs) el.push(`<line class="editor-kit-hw" x1="${s.cx - 18}" y1="${s.cy + s.r - 4}" x2="${s.cx - 22}" y2="176"/><line class="editor-kit-hw" x1="${s.cx + 18}" y1="${s.cy + s.r - 4}" x2="${s.cx + 22}" y2="176"/>`);
        } else if (s.kind === 'cym' || s.kind === 'pedal') {
            el.push(`<ellipse class="${cls}" data-piece="${s.piece}" cx="${s.cx}" cy="${s.cy}" rx="${s.rx}" ry="${s.ry}">${title}</ellipse>`);
        } else if (s.kind === 'bell') {
            el.push(`<rect class="${cls}" data-piece="${s.piece}" x="${s.cx - s.w / 2}" y="${s.cy - s.h / 2}" width="${s.w}" height="${s.h}" rx="2">${title}</rect>`);
        }
        // Tiny identity label; skip zones (their parent carries the label spot).
        if (!s.zoneOf && s.kind !== 'rim') {
            const ly = s.kind === 'cym' ? s.cy - ((s.ry || 8) + 3) : s.cy + 3;
            el.push(`<text class="editor-kit-lbl" x="${s.cx}" y="${ly}" text-anchor="middle">${PAD_LABELS[s.piece] || s.piece}</text>`);
        }
    }
    return `<svg class="editor-kit-svg" viewBox="0 0 560 190" preserveAspectRatio="xMidYMid meet">${el.join('')}</svg>`;
}

// The sampler-style pad grid: square pads, MPC idiom.
function buildPadGrid(meta) {
    return PAD_GRID_ROWS.map((row) =>
        `<div class="editor-drumpad-row">` + row.map((piece) =>
            `<button class="editor-drumpad" data-piece="${piece}" title="${gmTitle(meta, piece)}">`
            + `${PAD_LABELS[piece] || piece}</button>`).join('') + `</div>`
    ).join('');
}

export function drumPadView() {
    let raw = null;
    try { raw = localStorage.getItem(VIEW_KEY); } catch (_) {}
    return _drumViewPure(raw);
}

function buildPads() {
    const wrap = $pads();
    if (!wrap) return;
    const meta = new Map(
        _padModelPure(DRUM_PIECE_ORDER, DRUM_COMPACT_LANES, GM_DRUM_MAP).map((m) => [m.piece, m]));
    wrap.innerHTML = drumPadView() === 'pads' ? buildPadGrid(meta) : buildKitSvg(meta);
    const kitBtn = document.getElementById('editor-drum-view-kit');
    const padsBtn = document.getElementById('editor-drum-view-pads');
    const v = drumPadView();
    if (kitBtn) kitBtn.setAttribute('aria-pressed', v === 'kit' ? 'true' : 'false');
    if (padsBtn) padsBtn.setAttribute('aria-pressed', v === 'pads' ? 'true' : 'false');
}

export function editorSetDrumPadView(view) {
    const v = _drumViewPure(view);
    try { localStorage.setItem(VIEW_KEY, v); } catch (_) {}
    buildPads();
    _drumPadStripRefresh();
    setStatus(v === 'pads'
        ? 'Drum pads: sampler grid view'
        : 'Drum pads: kit view — zones like a drum VSTi (snare rim, ride bell, open/closed hat)');
}

function flashPad(piece) {
    const wrap = $pads();
    if (!wrap) return;
    const el = wrap.querySelector(`[data-piece="${piece}"]`);
    if (!el) return;
    el.classList.add('is-flash');
    const prior = flashTimers.get(piece);
    if (prior) clearTimeout(prior);
    flashTimers.set(piece, setTimeout(() => {
        el.classList.remove('is-flash');
        flashTimers.delete(piece);
    }, 160));
}

function onMidiData(data) {
    const on = _padNoteOnPure(data);
    if (!on) return;
    const piece = GM_DRUM_MAP[on.note];
    if (piece) flashPad(piece);
}

export function _drumPadStripRefresh() {
    const strip = $strip();
    if (!strip) return;
    const want = !!S.drumEditMode && !!S.drumTab && drumPadStripEnabled();
    if (strip.classList.contains('hidden') !== !want) strip.classList.toggle('hidden', !want);
    const btn = document.getElementById('editor-drum-pads-btn');
    if (btn) {
        const avail = !!S.drumEditMode && !!S.drumTab;
        if (btn.classList.contains('hidden') !== !avail) btn.classList.toggle('hidden', !avail);
        const pressed = drumPadStripEnabled() ? 'true' : 'false';
        if (btn.getAttribute('aria-pressed') !== pressed) btn.setAttribute('aria-pressed', pressed);
    }
    if (!want) return;
    // Selection lighting — a fixed handful of classList writes, skip-if-same.
    const lit = _padLitPiecesPure(S.drumTab.hits, S.drumSel);
    const wrap = $pads();
    if (!wrap) return;
    for (const el of wrap.querySelectorAll('[data-piece]')) {
        const on = lit.has(el.dataset.piece);
        if (el.classList.contains('is-lit') !== on) el.classList.toggle('is-lit', on);
    }
}

export function editorToggleDrumPadStrip() {
    const next = !drumPadStripEnabled();
    try { localStorage.setItem(PREF_KEY, next ? '1' : '0'); } catch (_) {}
    setStatus(next
        ? 'Drum pads on — selected hits light up; click a pad to add a hit at the cursor; Listen flashes pads from your MIDI kit (GM map)'
        : 'Drum pads off');
    _drumPadStripRefresh();
    return true;
}

function addHitAtCursor(piece) {
    if (!S.drumEditMode || !S.drumTab) return;
    // The exact add semantics of the lane grid's double-click (drum.js):
    // snap through host.snapTime, clamp both sides, 3-decimal wire rounding.
    const t = Math.max(0, host.snapTime(Math.max(0, S.cursorTime || 0)));
    S.history.exec(new AddDrumHitCmd({ t: Math.round(t * 1000) / 1000, p: piece, v: 100 }));
    setStatus(`Added ${piece} at the cursor`);
    flashPad(piece);
    host.draw();
}

async function armListen() {
    const btn = document.getElementById('editor-drum-pads-listen');
    if (monitorArmed) {
        _midiMonitorUntap(onMidiData);
        monitorArmed = false;
        if (btn) btn.setAttribute('aria-pressed', 'false');
        setStatus('MIDI listen off');
        return;
    }
    _midiMonitorTap(onMidiData);
    const ok = await _midiMonitorEnsure();
    monitorArmed = true;   // the tap also works whenever the record modal has a session
    if (btn) btn.setAttribute('aria-pressed', 'true');
    setStatus(ok
        ? 'MIDI listen on — hit your kit: the matching pad flashes (General MIDI map)'
        : 'MIDI listen armed — no device session yet (pick a device in Record MIDI, or check the input wizard)');
}

export function initDrumPadStrip() {
    const strip = $strip();
    if (!strip) return;
    buildPads();
    strip.addEventListener('click', (e) => {
        // Element, not HTMLElement: the kit view's pieces are SVG elements.
        const t = e.target instanceof Element ? e.target : null;
        if (!t) return;
        if (t.id === 'editor-drum-pads-listen') { armListen(); return; }
        if (t.id === 'editor-drum-pads-hide') { editorToggleDrumPadStrip(); return; }
        if (t.id === 'editor-drum-view-kit') { editorSetDrumPadView('kit'); return; }
        if (t.id === 'editor-drum-view-pads') { editorSetDrumPadView('pads'); return; }
        const pad = t.closest('[data-piece]');
        if (pad) addHitAtCursor(pad.dataset.piece);
    });
    _drumPadStripRefresh();
}
