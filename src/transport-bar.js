/* Slopsmith Arrangement Editor — the transport control bar + LCD
 * (workspace-shell B2, charrette §2.4 / D-C3).
 *
 * One always-present bar directly above the timeline surface:
 *
 *   [util: Parts Mixer Follow] │ ⏮ ⏪ ■ ▶/⏸ ⏩ ● │ ┌─ LCD ─┐ │ [modes: Click Clap A/B Snap] ▾
 *
 * The LCD ports Virtuoso's `.virtuoso-lcd-*` skin GRAMMAR (recessed panel,
 * labeled cells, tabular-num values, editable cells with the dashed-underline
 * "type here" affordance) as `.editor-lcd-*`, but the commit wiring is rebuilt
 * against the editor's audio-anchored tempo map: Position and Time are both
 * computed through `beatOf`/`timeOf` (the §1.1 converter — "both always
 * computed through the tempo map, the pillar made literal"), and the Tempo
 * cell is an INPUT only in free (no-audio) mode — with a recording present the
 * grid is fitted to the audio, so Tempo becomes a derived readout wearing the
 * AUDIO badge and BPM editing stays with the Tempo Map / Sync tools.
 *
 * NO master-mute here (charrette §2.6): mute/solo are per-track concerns and
 * live in the mixers, not on the transport.
 *
 * Not in this slice: the Count-in LCD cell and the "Count" mode toggle from
 * the charrette sketch — the editor has no count-in feature yet, and a cell
 * must write through to a REAL control, so both arrive with that feature.
 * Meter is a readout for the same reason (meter edits live in Tempo Map mode,
 * which needs a measure selection this bar doesn't have).
 *
 * Wiring rules this module obeys:
 *  - Every button DELEGATES to the existing command surface (window.editor* /
 *    module toggles) — a re-presentation, never a re-plumb. Mirror state is
 *    re-synced from the source of truth on every tick, so the old toolbar and
 *    this bar can coexist without drifting (the toolbar rows retire in B4/B5).
 *  - The LCD refreshes on the transport tick (updateTimeDisplay → _transportBarTick),
 *    NEVER from draw() — and every DOM write is skip-if-unchanged, the same
 *    per-frame discipline as the measure/chord readouts.
 *  - Keydown inside an LCD field stops propagation, so the canvas/global
 *    shortcut layer never sees typing (space can't toggle play mid-edit).
 *    Enter commits + blurs (focus returns to the canvas key layer); Escape
 *    reverts + blurs; an un-committed blur reverts (titles say "Enter applies").
 *  - In-DOM listeners die with the screen DOM, so re-injection can't stack
 *    them; the ONE document-level listener (menu click-away) goes through
 *    host.addGlobalListener into the teardown registry.
 */

import { beatOf, timeOf } from './beats.js';
import { S } from './state.js';
import { host } from './host.js';
import { setStatus } from './ui.js';
import { _editorToggleFollow, editorFollowEnabled, stopPlayback } from './audio.js';
import { PIANO_NOTE_NAMES, SCALE_LABELS } from './theory.js';

// MIDI-standard pulses per quarter for the ticks field. Display resolution
// only — never persisted, never quantizes anything.
export const LCD_TICKS_PER_BEAT = 960;

/* @pure:transport-lcd:start */

// m:ss.mmm — the Time cell. Clamps at 0; minutes unbounded (no h: field, songs
// don't run that long and Logic's LCD doesn't either).
export function _lcdClockPure(t) {
    // Total-ms first so rounding carries: 59.9996 reads 1:00.000, not 0:59.000.
    const totalMs = Math.round((Number.isFinite(t) && t > 0 ? t : 0) * 1000);
    const m = Math.floor(totalMs / 60000);
    const s = Math.floor(totalMs / 1000) % 60;
    const ms = totalMs % 1000;
    return `${m}:${String(s).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
}

// "m:ss.mmm" | "m:ss" | "ss" | "ss.mmm" → seconds, or null when unparseable.
export function _lcdParseClockPure(str) {
    const s = String(str == null ? '' : str).trim();
    if (!s) return null;
    const m = s.match(/^(?:(\d+):)?(\d+(?:\.\d+)?)$/);
    if (!m) return null;
    const mins = m[1] ? parseInt(m[1], 10) : 0;
    const secs = parseFloat(m[2]);
    if (!Number.isFinite(secs) || (m[1] && secs >= 60)) return null;
    return mins * 60 + secs;
}

// bars:beats:ticks through the tempo map. The beat array's INDEX is the beat
// coordinate (src/beats.js contract) and downbeats carry `measure > 0`, so the
// bar is the last downbeat at-or-before the beat, the beat number counts from
// it (1-based), and ticks are the fractional beat at 960 PPQ. Degenerate grid
// (< 2 beats — seconds-primary, §1.3.4) → null: the caller shows Time only.
export function _lcdBBTPure(beats, t) {
    if (!Array.isArray(beats) || beats.length < 2) return null;
    // Quantize the beat COORDINATE to the tick grid first: the rounding carry
    // then crosses beat AND bar boundaries for free (1e-5 s before bar 2
    // reads 2:1:000, never 1:5:000).
    const qTicks = Math.round(beatOf(beats, t) * LCD_TICKS_PER_BEAT);
    const whole = Math.floor(qTicks / LCD_TICKS_PER_BEAT);
    const tick = qTicks - whole * LCD_TICKS_PER_BEAT;
    const i = Math.max(0, Math.min(whole, beats.length - 1));
    let down = -1;
    for (let k = i; k >= 0; k--) {
        if (beats[k] && beats[k].measure > 0) { down = k; break; }
    }
    if (down < 0) {
        // Before the first labeled downbeat (pickup / extrapolated tail):
        // count from the first one instead so the readout stays monotonic.
        for (let k = 0; k < beats.length; k++) {
            if (beats[k] && beats[k].measure > 0) { down = k; break; }
        }
        if (down < 0) return null;
    }
    const bar = beats[down].measure;
    // Pre-grid coordinates clamp at 1:1 — the readout never shows beat 0.
    const beatField = Math.max(1, whole - down + 1);
    return {
        bar, beat: beatField, tick,
        label: `${bar}:${beatField}:${String(tick).padStart(3, '0')}`,
    };
}

// "bar" | "bar:beat" | "bar:beat:tick" → seconds via timeOf, or null. The bar
// must exist on the grid (measure numbers come from the import, they are not
// guaranteed to start at 1 or be dense — resolve by lookup, never arithmetic).
export function _lcdParseBBTPure(beats, str) {
    if (!Array.isArray(beats) || beats.length < 2) return null;
    const m = String(str == null ? '' : str).trim().match(/^(\d+)(?::(\d+))?(?::(\d+))?$/);
    if (!m) return null;
    const bar = parseInt(m[1], 10);
    const beatInBar = m[2] ? parseInt(m[2], 10) : 1;
    const tick = m[3] ? parseInt(m[3], 10) : 0;
    if (beatInBar < 1 || tick < 0 || tick >= LCD_TICKS_PER_BEAT) return null;
    let down = -1;
    for (let k = 0; k < beats.length; k++) {
        if (beats[k] && beats[k].measure === bar) { down = k; break; }
    }
    if (down < 0) return null;
    return timeOf(beats, down + (beatInBar - 1) + tick / LCD_TICKS_PER_BEAT);
}

// The bar signature at a time: numerator = downbeat-to-downbeat span (the last
// measure reuses the previous span — same convention as the measure readout),
// denominator normalized from the downbeat's `den`. Null without a grid.
export function _lcdMeterPure(beats, t) {
    if (!Array.isArray(beats) || beats.length < 2) return null;
    const i = Math.max(0, Math.min(Math.floor(beatOf(beats, t)), beats.length - 1));
    let down = -1;
    for (let k = i; k >= 0; k--) if (beats[k] && beats[k].measure > 0) { down = k; break; }
    if (down < 0) for (let k = 0; k < beats.length; k++) if (beats[k] && beats[k].measure > 0) { down = k; break; }
    if (down < 0) return null;
    let next = -1;
    for (let k = down + 1; k < beats.length; k++) if (beats[k] && beats[k].measure > 0) { next = k; break; }
    let numerator;
    if (next >= 0) numerator = next - down;
    else {
        let prev = -1;
        for (let k = down - 1; k >= 0; k--) if (beats[k] && beats[k].measure > 0) { prev = k; break; }
        numerator = prev >= 0 ? down - prev : Math.max(1, beats.length - 1 - down);
    }
    const rawDen = Number(beats[down].den);
    const denominator = rawDen === 8 || rawDen === 16 || rawDen === 2 ? rawDen : 4;
    return { numerator: Math.max(1, numerator), denominator };
}

// Local tempo at a time: 60 / the surrounding gap. 1 decimal — the LCD is a
// glanceable readout, not the Tempo Map inspector. Null without a grid.
export function _lcdTempoPure(beats, t) {
    if (!Array.isArray(beats) || beats.length < 2) return null;
    const i = Math.max(0, Math.min(Math.floor(beatOf(beats, t)), beats.length - 2));
    const gap = beats[i + 1].time - beats[i].time;
    if (!(gap > 1e-9)) return null;
    return Math.round((60 / gap) * 10) / 10;
}

// The BPM-semantics decision (charrette §2.4): with audio present the grid is
// FITTED to the immutable recording, so typing a BPM would be a lie — Tempo is
// a derived readout wearing the AUDIO badge. Free mode (no recording) makes
// the grid the truth, so Tempo is an editable input.
export function _transportModePure(hasAudio) {
    return hasAudio
        ? { short: 'AUDIO', title: 'Tempo: fitted to audio — the grid is aligned to the recording. Edit tempo with the Tempo Map / Sync tools.', tempoEditable: false }
        : { short: 'FREE', title: 'Tempo: free — no recording; the grid is the source of truth. Type a BPM to set it.', tempoEditable: true };
}

// Editable-cell keystroke policy: Enter commits, Escape reverts, anything
// else is ordinary typing. (The HANDLER also stops propagation on every key
// so the canvas shortcut layer never sees LCD typing.)
export function _lcdKeyActionPure(key) {
    if (key === 'Enter') return 'commit';
    if (key === 'Escape') return 'revert';
    return null;
}

// Customization prefs: merge a stored blob over the defaults, coercing every
// flag to a real boolean so a hand-edited/corrupt pref can't leak truthy
// garbage into the DOM builders. Unknown keys are dropped.
export const TRANSPORT_LCD_CELLS = ['position', 'time', 'tempo', 'meter', 'key', 'sel', 'mode'];
export function _transportPrefsPure(raw) {
    const p = {
        primary: 'position',
        groups: { util: true, modes: true },
        cells: Object.fromEntries(TRANSPORT_LCD_CELLS.map((c) => [c, true])),
    };
    if (raw && typeof raw === 'object') {
        if (raw.primary === 'time') p.primary = 'time';
        if (raw.groups && typeof raw.groups === 'object') {
            for (const g of ['util', 'modes']) {
                if (typeof raw.groups[g] === 'boolean') p.groups[g] = raw.groups[g];
            }
        }
        if (raw.cells && typeof raw.cells === 'object') {
            for (const c of TRANSPORT_LCD_CELLS) {
                if (typeof raw.cells[c] === 'boolean') p.cells[c] = raw.cells[c];
            }
        }
    }
    return p;
}
/* @pure:transport-lcd:end */

const PREFS_KEY = 'editorTransportBar';
let prefs = _transportPrefsPure(null);
// The mode the LCD was last BUILT for — a mode flip (audio loaded/cleared)
// swaps the Tempo cell between input and readout, which is a rebuild.
let builtMode = null;

function loadPrefs() {
    let raw = null;
    try { raw = JSON.parse(localStorage.getItem(PREFS_KEY) || 'null'); } catch (_) {}
    prefs = _transportPrefsPure(raw);
}
function savePrefs() {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch (_) {}
}

const $bar = () => document.getElementById('editor-transport-bar');
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// ── DOM builders ─────────────────────────────────────────────────────

function lcdCell(cellKey, label, valHtml, title) {
    return `<div class="editor-lcd-cell" data-cell="${cellKey}"${title ? ` title="${esc(title)}"` : ''}>`
        + `<span class="editor-lcd-lbl">${esc(label)}</span>`
        + `<span class="editor-lcd-val">${valHtml}</span></div>`;
}

function buildLcd(mode) {
    const c = prefs.cells;
    const parts = [];
    const posPrimary = prefs.primary === 'position';
    if (c.position) {
        parts.push(lcdCell('position', 'Position',
            `<input id="editor-lcd-position" class="editor-lcd-input${posPrimary ? ' is-primary' : ''}" size="9"`
            + ` aria-label="Position (bars:beats:ticks)" title="Playhead as bars:beats:ticks through the tempo map — click to edit, Enter seeks">`));
    }
    if (c.position && c.time) {
        parts.push(`<button id="editor-lcd-primary" class="editor-lcd-primary" title="Toggle which readout is primary (Position ⇄ Time)">▸</button>`);
    }
    if (c.time) {
        parts.push(lcdCell('time', 'Time',
            `<input id="editor-lcd-time" class="editor-lcd-input${!posPrimary ? ' is-primary' : ''}" size="9"`
            + ` aria-label="Time (m:ss.mmm)" title="Playhead in minutes:seconds.milliseconds — click to edit, Enter seeks">`));
    }
    if (c.tempo) {
        parts.push(mode.tempoEditable
            ? lcdCell('tempo', 'Tempo',
                `<input id="editor-lcd-bpm" class="editor-lcd-input" type="number" min="30" max="400" step="0.1" size="5"`
                + ` aria-label="Tempo (BPM)" title="Click to edit the tempo — applies on Enter"> <span class="editor-lcd-suffix">BPM</span>`)
            : lcdCell('tempo', 'Tempo',
                `<span id="editor-lcd-bpm-readout"></span> <span class="editor-lcd-badge" title="${esc(mode.title)}">AUDIO</span>`,
                mode.title));
    }
    if (c.meter) parts.push(lcdCell('meter', 'Meter', `<span id="editor-lcd-meter"></span>`,
        'Time signature of the bar at the playhead (edit measures in Tempo Map mode)'));
    if (c.key) {
        const tonic = S.editorKey ? S.editorKey.tonic : 0;
        const scale = S.editorKey ? S.editorKey.scale : 'major';
        const opts = PIANO_NOTE_NAMES.map((n, i) =>
            `<option value="${i}"${i === tonic ? ' selected' : ''}>${esc(n)}</option>`).join('');
        const scales = Object.entries(SCALE_LABELS).map(([id, lbl]) =>
            `<option value="${esc(id)}"${id === scale ? ' selected' : ''}>${esc(lbl)}</option>`).join('');
        parts.push(lcdCell('key', 'Key',
            `<select id="editor-lcd-key-tonic" class="editor-lcd-select" aria-label="Key — tonic">${opts}</select>`
            + ` <select id="editor-lcd-key-scale" class="editor-lcd-select" aria-label="Key — scale">${scales}</select>`,
            'Song key — writes through to the Key controls'));
    }
    if (c.sel) parts.push(lcdCell('sel', 'Sel', `<span id="editor-lcd-sel"></span>`, 'Selected notes'));
    if (c.mode) parts.push(lcdCell('mode', 'Mode',
        `<span id="editor-lcd-mode" class="editor-lcd-badge"></span>`, mode.title));
    return `<div id="editor-lcd" class="editor-lcd">${parts.join('')}</div>`;
}

const tbtn = (id, label, title, extra = '') =>
    `<button id="${id}" class="editor-transport-btn" title="${esc(title)}"${extra}>${label}</button>`;

function buildBar() {
    const bar = $bar();
    if (!bar) return;
    const mode = _transportModePure(!!S.audioBuffer);
    builtMode = mode.tempoEditable;
    const util = prefs.groups.util
        ? `<div class="editor-transport-group" data-group="util">`
        + tbtn('editor-tp-parts', 'Parts', 'Parts overview — all parts stacked (mirrors the toolbar toggle)')
        + tbtn('editor-tp-mixer', 'Mix', 'Audio mixer: recording / guide / click levels (Shift+C)')
        + tbtn('editor-tp-follow', 'Follow', 'Follow the playhead during playback (Shift+L)', ' aria-pressed="false"')
        + `</div><div class="editor-transport-sep"></div>` : '';
    const modes = prefs.groups.modes
        ? `<div class="editor-transport-sep"></div><div class="editor-transport-group" data-group="modes">`
        + tbtn('editor-tp-click', 'Click', 'Metronome: click every beat, accented on downbeats', ' aria-pressed="false"')
        + tbtn('editor-tp-clap', 'Clap', 'Guide claps: tick each charted note during playback (C)', ' aria-pressed="false"')
        + tbtn('editor-tp-ab', 'A/B', 'Loop A/B compare — alternates recording and guide per pass', ' aria-pressed="false"')
        + `<select id="editor-tp-snap" class="editor-transport-snap" title="Snap grid"></select>`
        + `</div>` : '';
    bar.innerHTML = util
        + `<div class="editor-transport-group" data-group="core">`
        + tbtn('editor-tp-start', '⏮', 'Go to start')
        + tbtn('editor-tp-rew', '⏪', 'Rewind one bar')
        + tbtn('editor-tp-stop', '■', 'Stop (stopped: go to start)')
        + tbtn('editor-tp-play', '▶', 'Play/Pause (Space)')
        + tbtn('editor-tp-fwd', '⏩', 'Forward one bar')
        + `<button id="editor-tp-rec" class="editor-transport-btn editor-transport-rec" title="Record a Keys arrangement live from a MIDI keyboard">●</button>`
        + `</div><div class="editor-transport-sep"></div>`
        + buildLcd(mode)
        + modes
        + `<button id="editor-tp-customize" class="editor-transport-btn editor-transport-customize" title="Customize Control Bar">▾</button>`
        + `<div id="editor-tp-menu" class="editor-transport-menu hidden"></div>`;
    wireBar(bar);
    _transportBarTick(true);
}

function buildMenu() {
    const menu = document.getElementById('editor-tp-menu');
    if (!menu) return;
    const row = (kind, key, label, checked) =>
        `<label class="editor-transport-menu-row"><input type="checkbox" data-kind="${kind}" data-key="${key}"${checked ? ' checked' : ''}> ${esc(label)}</label>`;
    const cellLabels = { position: 'Position', time: 'Time', tempo: 'Tempo', meter: 'Meter', key: 'Key', sel: 'Selection', mode: 'Mode badge' };
    menu.innerHTML = `<div class="editor-transport-menu-head">Customize Control Bar</div>`
        + row('group', 'util', 'Parts / Mix / Follow group', prefs.groups.util)
        + row('group', 'modes', 'Click / Clap / A/B / Snap group', prefs.groups.modes)
        + `<div class="editor-transport-menu-head">LCD cells</div>`
        + TRANSPORT_LCD_CELLS.map((c) => row('cell', c, cellLabels[c], prefs.cells[c])).join('')
        + `<button id="editor-tp-menu-reset" class="editor-transport-btn" style="margin-top:4px">Reset layout</button>`;
}

// ── Wiring ───────────────────────────────────────────────────────────

// Bar-step seek: previous/next downbeat relative to the cursor; without a
// grid, a 5-second nudge. Clamped to the song.
function barStep(dir) {
    const t = S.cursorTime || 0;
    let target = null;
    if (Array.isArray(S.beats) && S.beats.length >= 2) {
        if (dir < 0) {
            for (let k = S.beats.length - 1; k >= 0; k--) {
                const b = S.beats[k];
                if (b && b.measure > 0 && b.time < t - 0.05) { target = b.time; break; }
            }
        } else {
            for (let k = 0; k < S.beats.length; k++) {
                const b = S.beats[k];
                if (b && b.measure > 0 && b.time > t + 0.05) { target = b.time; break; }
            }
        }
    }
    if (target === null) target = t + dir * 5;
    seekTo(target);
}

function seekTo(t) {
    const max = S.duration > 0 ? S.duration : Infinity;
    host.editorSeekToTime(Math.max(0, Math.min(t, max)));
}

function commitField(input) {
    const id = input.id;
    if (id === 'editor-lcd-position') {
        const t = _lcdParseBBTPure(S.beats, input.value);
        if (t === null) { setStatus('Position: bars:beats:ticks (e.g. 12:3:480) — bar must exist on the grid'); _transportBarTick(true); return; }
        seekTo(t);
    } else if (id === 'editor-lcd-time') {
        const t = _lcdParseClockPure(input.value);
        if (t === null) { setStatus('Time: m:ss.mmm (e.g. 1:23.500)'); _transportBarTick(true); return; }
        seekTo(t);
    } else if (id === 'editor-lcd-bpm') {
        if (typeof window.editorSetBPM === 'function') window.editorSetBPM(input.value);
    }
    _transportBarTick(true);
}

// Show/hide the Customize popover. Module-scope so both the (rebuilt) customize
// button and the persistent-container contextmenu listener share it.
function menuToggle(show) {
    const menu = document.getElementById('editor-tp-menu');
    if (!menu) return;
    if (show) buildMenu();
    menu.classList.toggle('hidden', !show);
}

// The three CONTAINER-delegated listeners live on the persistent
// #editor-transport-bar element, so they're wired ONCE (initTransportBar).
// Re-wiring them per buildBar() would stack a fresh copy on every rebuild —
// and the `change` handler itself calls buildBar(), so k Customize toggles
// would fan out into k listeners each firing k rebuilds.
function wireBarContainer(bar) {
    bar.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        menuToggle(true);
    });
    bar.addEventListener('change', (e) => {
        const t = e.target;
        if (!(t instanceof HTMLElement) || !t.dataset.kind) return;
        if (t.dataset.kind === 'group') prefs.groups[t.dataset.key] = t.checked;
        if (t.dataset.kind === 'cell') prefs.cells[t.dataset.key] = t.checked;
        savePrefs(); buildBar();
        menuToggle(true);   // keep the menu open through a rebuild
    });
    bar.addEventListener('click', (e) => {
        if (e.target instanceof HTMLElement && e.target.id === 'editor-tp-menu-reset') {
            prefs = _transportPrefsPure(null);
            savePrefs(); buildBar();
        }
    });
}

function wireBar(bar) {
    const on = (id, fn) => { const el = document.getElementById(id); if (el) el.addEventListener('click', fn); };
    on('editor-tp-start', () => seekTo(0));
    on('editor-tp-rew', () => barStep(-1));
    on('editor-tp-fwd', () => barStep(1));
    on('editor-tp-stop', () => { if (S.playing) stopPlayback(); else seekTo(0); });
    on('editor-tp-play', () => { if (typeof window.editorTogglePlay === 'function') window.editorTogglePlay(); });
    on('editor-tp-rec', () => { if (typeof window.editorShowRecordMidiModal === 'function') window.editorShowRecordMidiModal(); });
    on('editor-tp-parts', () => { if (typeof window.editorTogglePartsView === 'function') window.editorTogglePartsView(); _transportBarTick(true); });
    on('editor-tp-mixer', () => { if (typeof window.editorToggleMixer === 'function') window.editorToggleMixer(); });
    on('editor-tp-follow', () => { _editorToggleFollow(); _transportBarTick(true); });
    on('editor-tp-click', () => { if (typeof window.editorToggleMetronome === 'function') window.editorToggleMetronome(); _transportBarTick(true); });
    on('editor-tp-clap', () => { if (typeof window.editorToggleGuideClap === 'function') window.editorToggleGuideClap(); _transportBarTick(true); });
    on('editor-tp-ab', () => { if (typeof window.editorToggleLoopAB === 'function') window.editorToggleLoopAB(); _transportBarTick(true); });
    on('editor-lcd-primary', () => {
        prefs.primary = prefs.primary === 'position' ? 'time' : 'position';
        savePrefs(); buildBar();
    });

    // Snap mirror: clone the toolbar select's options once per build; commits
    // go through the same editorSetSnap entry the toolbar uses.
    const snap = document.getElementById('editor-tp-snap');
    const srcSnap = document.getElementById('editor-snap');
    if (snap && srcSnap) {
        snap.innerHTML = srcSnap.innerHTML;
        snap.selectedIndex = S.snapIdx;
        snap.addEventListener('change', () => {
            if (typeof window.editorSetSnap === 'function') window.editorSetSnap(snap.selectedIndex);
        });
    }

    // LCD commit wiring — ONE delegated set on the panel. Keydown never
    // reaches the canvas shortcut layer; Enter commits + blurs, Escape
    // reverts + blurs, an uncommitted blur reverts (the tick re-renders).
    const lcd = document.getElementById('editor-lcd');
    if (lcd) {
        lcd.addEventListener('keydown', (e) => {
            const t = e.target;
            if (!(t instanceof HTMLElement) || !t.matches('.editor-lcd-input, .editor-lcd-select')) return;
            e.stopPropagation();
            const action = _lcdKeyActionPure(e.key);
            if (!action) return;
            e.preventDefault();
            if (action === 'commit' && t.matches('.editor-lcd-input')) commitField(t);
            t.blur();
            if (action === 'revert') _transportBarTick(true);
        });
        // Keyup/keypress too: some global handlers key off keyup.
        lcd.addEventListener('keyup', (e) => {
            if (e.target instanceof HTMLElement && e.target.matches('.editor-lcd-input, .editor-lcd-select')) e.stopPropagation();
        });
        lcd.addEventListener('change', (e) => {
            const t = e.target;
            if (!(t instanceof HTMLElement)) return;
            if (t.id === 'editor-lcd-key-tonic' && typeof window.editorSetKeyTonic === 'function') window.editorSetKeyTonic(t.value);
            if (t.id === 'editor-lcd-key-scale' && typeof window.editorSetKeyScale === 'function') window.editorSetKeyScale(t.value);
        });
        lcd.addEventListener('focusout', (e) => {
            const t = e.target;
            // Uncommitted text reverts on blur — Enter is the commit gesture
            // (titles say so); this puts the live readout back.
            if (t instanceof HTMLElement && t.matches('.editor-lcd-input')) _transportBarTick(true);
        });
    }

    // Customize ▾ button — rebuilt by each buildBar(), so it's re-wired here.
    // The right-click / change / reset-click CONTAINER listeners live on the
    // persistent bar element and are wired once (wireBarContainer, from init).
    on('editor-tp-customize', () => menuToggle(document.getElementById('editor-tp-menu').classList.contains('hidden')));
}

// ── The tick ─────────────────────────────────────────────────────────
// Called from updateTimeDisplay() (the transport tick) and updateStatus()
// (selection changes) — never from draw(). All writes skip-if-unchanged; a
// focused field is never clobbered mid-edit.
const _set = (el, v) => { if (el && el.textContent !== v) el.textContent = v; };
const _setVal = (el, v) => {
    if (el && document.activeElement !== el && el.value !== v) el.value = v;
};

export function _transportBarTick(force) {
    const bar = $bar();
    if (!bar || !bar.firstChild) return;
    const mode = _transportModePure(!!S.audioBuffer);
    // Audio arrived or left since the LCD was built → the Tempo cell changes
    // species (input ⇄ badge readout). Rebuild once.
    if (mode.tempoEditable !== builtMode) { buildBar(); return; }
    const t = S.cursorTime || 0;

    const bbt = _lcdBBTPure(S.beats, t);
    _setVal(document.getElementById('editor-lcd-position'), bbt ? bbt.label : '—');
    _setVal(document.getElementById('editor-lcd-time'), _lcdClockPure(t));

    const bpm = _lcdTempoPure(S.beats, t);
    if (mode.tempoEditable) _setVal(document.getElementById('editor-lcd-bpm'), bpm === null ? '' : String(bpm));
    else _set(document.getElementById('editor-lcd-bpm-readout'), bpm === null ? '—' : `${bpm} BPM`);

    const meter = _lcdMeterPure(S.beats, t);
    _set(document.getElementById('editor-lcd-meter'), meter ? `${meter.numerator}/${meter.denominator}` : '—');

    const selN = S.drumEditMode ? S.drumSel.size : S.sel.size;
    _set(document.getElementById('editor-lcd-sel'), String(selN));

    const modeEl = document.getElementById('editor-lcd-mode');
    if (modeEl) { _set(modeEl, mode.short); if (modeEl.title !== mode.title) modeEl.title = mode.title; }

    // Key selects follow S.editorKey (Detect / toolbar edits show up here).
    const tonicSel = document.getElementById('editor-lcd-key-tonic');
    const scaleSel = document.getElementById('editor-lcd-key-scale');
    if (tonicSel && document.activeElement !== tonicSel) tonicSel.value = String(S.editorKey ? S.editorKey.tonic : 0);
    if (scaleSel && document.activeElement !== scaleSel) scaleSel.value = S.editorKey ? S.editorKey.scale : 'major';

    // Transport + mirror-toggle state, re-synced from the sources of truth.
    _set(document.getElementById('editor-tp-play'), S.playing ? '⏸' : '▶');
    const press = (id, onState) => {
        const el = document.getElementById(id);
        if (el) { const v = onState ? 'true' : 'false'; if (el.getAttribute('aria-pressed') !== v) el.setAttribute('aria-pressed', v); }
    };
    press('editor-tp-follow', editorFollowEnabled());
    press('editor-tp-parts', !!S.partsViewMode);
    const mirror = (id, srcId) => {
        const el = document.getElementById(id), src = document.getElementById(srcId);
        if (!el || !src) return;
        const v = src.getAttribute('aria-pressed') || 'false';
        if (el.getAttribute('aria-pressed') !== v) el.setAttribute('aria-pressed', v);
        if (el.disabled !== src.disabled) el.disabled = src.disabled;
    };
    mirror('editor-tp-click', 'editor-metronome-btn');
    mirror('editor-tp-clap', 'editor-guide-btn');
    mirror('editor-tp-ab', 'editor-loop-ab-btn');
    // Record mirrors the toolbar's visibility contract (keys parts only).
    const rec = document.getElementById('editor-tp-rec');
    const recSrc = document.getElementById('editor-record-midi-btn');
    if (rec && recSrc) {
        const hide = recSrc.classList.contains('hidden');
        if (rec.classList.contains('hidden') !== hide) rec.classList.toggle('hidden', hide);
        if (rec.disabled !== recSrc.disabled) rec.disabled = recSrc.disabled;
    }
    const snap = document.getElementById('editor-tp-snap');
    if (snap && document.activeElement !== snap && snap.selectedIndex !== S.snapIdx) snap.selectedIndex = S.snapIdx;
    if (force) { /* a full re-sync is exactly the above — flag kept for call-site intent */ }
}

// ── Boot ─────────────────────────────────────────────────────────────
export function initTransportBar() {
    loadPrefs();
    // Container-delegated listeners on the persistent bar element: wired once,
    // BEFORE the first buildBar(), so a rebuild never re-adds them.
    const bar = $bar();
    if (bar) wireBarContainer(bar);
    buildBar();
    // The one document-level listener (menu click-away) rides the teardown
    // registry so a re-injected screen can't stack copies.
    host.addGlobalListener(document, 'mousedown', (e) => {
        const menu = document.getElementById('editor-tp-menu');
        if (!menu || menu.classList.contains('hidden')) return;
        const bar = $bar();
        if (bar && e.target instanceof Node && !bar.contains(e.target)) menu.classList.add('hidden');
    });
}
