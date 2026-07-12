/* Slopsmith Arrangement Editor — the menu bar (workspace-shell B4,
 * charrette §2.2 / D-C2).
 *
 * Nine menus re-homing the EDITOR_SHORTCUT_COMMANDS registry, organized by
 * musical object (Tempo/Grid gets its own top-level menu — the pillar's
 * home). A RE-PRESENTATION, never a re-plumb: registry-backed items dispatch
 * through input.js's `_editorRunEofCommand` (the same switch the keyboard
 * uses), and the handful of file/panel items that predate the registry call
 * their existing `window.editor*` entry points. No second implementation of
 * anything.
 *
 * Behaviors the charrette locks:
 *  - Accelerators FOLLOW the active shortcut profile. Dropdown content is
 *    rendered at OPEN time from `_editorShortcutRowsPure(profile)`, so a
 *    profile swap (FeedBack ⇄ EOF Legacy) relabels every accelerator with
 *    zero swap-time bookkeeping.
 *  - `status:'planned'` commands render greyed with a "soon" tag and never
 *    dispatch (no false rungs).
 *  - Mode discipline: grid-fitting items are gated — `audioOnly` items hide
 *    without a recording (Sync-to-audio), `needs:'tempoMap'` items grey out
 *    until Tempo Map mode is active (they operate on a selected sync point).
 *  - Alt-mnemonics are deliberately NOT bound (browsers/hosts own Alt+F and
 *    friends): click-open + arrow-key navigation + Enter/Escape, per the
 *    charrette's fallback.
 *  - In-DOM listeners die with the screen DOM; the one document-level
 *    listener (click-away/Escape) rides host.addGlobalListener into the
 *    teardown registry, so re-injection can't stack copies.
 *
 * Charrette items with no implementation behind them yet (Vocals, Chord
 * palette, Bake stems, density presets…) are NOT invented here as dead rows —
 * "greyed + soon" is reserved for registry-backed `planned` commands. Flyout
 * submenus (Import ▸) render as in-menu section headers for now: same
 * disclosure, no nested-popover machinery; B5 can graduate them.
 */

import { _editorSetGuideVoiceMode, editorGuideVoiceMode } from './audio.js';
import { GM_VOICE_CHOICES, _gmKindPure, editorGmVoiceFor, editorSetGmVoice } from './gm-guide.js';
import { _editorRunEofCommand } from './input.js';
import { _editorShortcutRowsPure, editorShortcutProfile } from './shortcuts.js';
import { S } from './state.js';
import { host } from './host.js';
import {
    applyToolbarPreset, getToolbarCtx, resetToolbarLayout, toggleToolbar,
} from './toolbars.js';
import { _clearBarSelection, editorLoopSnapMode, editorSetLoopSnapMode } from './loop.js';

/* @pure:menu-model:start */
// The nine menus (charrette §2.2). Item kinds:
//   { cmd }                — registry-backed; label/accelerator/status resolve
//                            from the registry rows at open time.
//   { label, fn }          — a pre-registry window.editor* entry point.
//   { hdr }                — non-interactive section header.
//   { sep: true }          — divider.
// Gates: `audioOnly` hides without a recording; `needs:'tempoMap'` greys
// outside Tempo Map mode; `fn` items grey when the entry point is absent.
export const EDITOR_MENUS = Object.freeze([
    { title: 'File', items: [
        { label: 'New…', fn: 'editorShowCreateModal' },
        { label: 'Open feedpak…', fn: 'editorShowLoadModal' },
        { cmd: 'save' },
        { label: 'Save As…', fn: 'editorSaveAs' },
        { sep: true },
        { hdr: 'Import' },
        { cmd: 'importGp' },
        { cmd: 'importMidi' },
        { cmd: 'importXml' },
        { sep: true },
        { label: 'Replace audio…', fn: 'editorShowReplaceAudioModal' },
        { label: 'Build feedpak', fn: 'editorBuild' },
    ] },
    { title: 'Edit', items: [
        { label: 'Undo', fn: 'editorUndo', key: 'Ctrl+Z' },
        { label: 'Redo', fn: 'editorRedo', key: 'Ctrl+Y' },
        { label: 'Undo to last checkpoint', fn: 'editorUndoToCheckpoint', key: 'Ctrl+Alt+Z' },
        { sep: true },
        { cmd: 'duplicateSelection' },
        { cmd: 'selectLike' },
        { cmd: 'resnapSelection' },
    ] },
    { title: 'Add', items: [
        { hdr: 'Part' },
        { label: 'Drums…', fn: 'editorShowAddDrumsModal' },
        { label: 'Record MIDI…', fn: 'editorShowRecordMidiModal' },
        { sep: true },
        { hdr: 'Markers' },
        { cmd: 'addSection' },
        { cmd: 'addPhrase' },
        { cmd: 'setAnchor' },
        { cmd: 'addToneChange' },
        { cmd: 'addHandshape' },
        { cmd: 'placeMoverPhrase' },
    ] },
    { title: 'Note', items: [
        { cmd: 'editFret' },
        { cmd: 'fretUp' },
        { cmd: 'fretDown' },
        { cmd: 'noteMenu' },
        { sep: true },
        { cmd: 'moveStringUp' },
        { cmd: 'moveStringDown' },
        { cmd: 'transposeStringUp' },
        { cmd: 'transposeStringDown' },
        { cmd: 'shortenSustain' },
        { cmd: 'lengthenSustain' },
        { sep: true },
        { hdr: 'Techniques' },
        { cmd: 'bend' },
        { cmd: 'slideEditor' },
        { cmd: 'unpitchedSlide' },
        { cmd: 'slideUp' },
        { cmd: 'slideDown' },
        { cmd: 'toggleHammerOn' },
        { cmd: 'togglePullOff' },
        { cmd: 'toggleTap' },
        { cmd: 'toggleNaturalHarmonic' },
        { cmd: 'togglePinchHarmonic' },
        { cmd: 'togglePalmMute' },
        { cmd: 'toggleMuteOpen' },
        { cmd: 'toggleMuteRetain' },
        { cmd: 'toggleVibrato' },
        { cmd: 'toggleTremolo' },
        { cmd: 'toggleAccent' },
        { cmd: 'toggleLinkNext' },
        { cmd: 'toggleIgnore' },
        { cmd: 'togglePop' },
        { cmd: 'toggleSlap' },
        { cmd: 'cyclePickDirection' },
    ] },
    { title: 'Part', items: [
        { cmd: 'renamePart' },
        { cmd: 'movePartEarlier' },
        { cmd: 'movePartLater' },
        { sep: true },
        { label: 'Strings / tuning…', fn: 'editorShowStringsModal' },
        { label: 'Tones…', fn: 'editorShowTonesModal' },
        { sep: true },
        { cmd: 'cycleViewMode' },
        { cmd: 'toggleDrumDensity' },
    ] },
    { title: 'View', items: [
        { cmd: 'toggleWaveform' },
        { cmd: 'toggleOnsetStrip' },
        { cmd: 'togglePartsView' },
        { cmd: 'toggleKeyHighlight' },
        { cmd: 'toggleFollow' },
        { cmd: 'showTabPreview' },
        { sep: true },
        { label: 'Theme: Dark → Medium → Light', fn: 'editorCycleTheme' },
        { sep: true },
        { hdr: 'Panels' },
        { cmd: 'toggleMixer' },
        { label: 'Shortcut panel', fn: 'editorToggleShortcutPanel' },
        { sep: true },
        // Toggleable toolbars + density presets (B5). Checkmarks resolve
        // from ctx.toolbars at open time, same as accelerators do.
        { hdr: 'Toolbars' },
        { tb: 'file', label: 'File' },
        { tb: 'parts', label: 'Parts' },
        { tb: 'edit', label: 'Edit' },
        { tb: 'transport', label: 'Transport' },
        { tb: 'grid', label: 'Grid' },
        { tb: 'tempo', label: 'Tempo' },
        { tb: 'harmony', label: 'Harmony' },
        { tb: 'overlays', label: 'Overlays' },
        { sep: true },
        { hdr: 'Density preset' },
        { tbPreset: 'compose', label: 'Compose' },
        { tbPreset: 'transcribe', label: 'Transcribe' },
        { tbPreset: 'everything', label: 'Everything' },
        { sep: true },
        { tbReset: true, label: 'Reset layout' },
    ] },
    { title: 'Transport', items: [
        { label: 'Play / Pause', fn: 'editorTogglePlay', key: 'Space' },
        { sep: true },
        { cmd: 'prevBeat' },
        { cmd: 'nextBeat' },
        { cmd: 'prevNote' },
        { cmd: 'nextNote' },
        { cmd: 'prevGrid' },
        { cmd: 'nextGrid' },
        { cmd: 'prevAnchor' },
        { cmd: 'nextAnchor' },
        { sep: true },
        { hdr: 'Loop' },
        { label: 'Loop region', fn: 'editorToggleLoopRegion' },
        { cmd: 'toggleLoopAB' },
        { label: 'Loop in 3D', fn: 'editorLoopIn3D' },
        { loopClear: true, label: 'Clear loop' },
        // Loop snap mode moved here from the retired HTML loop strip (B3):
        // how a ruler loop-drag resolves — whole bars, the grid subdivision,
        // or free seconds (Shift-drag = temporary Free in any mode).
        { hdr: 'Loop snap' },
        { loopSnap: 'bar', label: 'Bar' },
        { loopSnap: 'grid', label: 'Grid' },
        { loopSnap: 'free', label: 'Free' },
        { sep: true },
        { cmd: 'toggleMetronome' },
        { cmd: 'toggleGuideClap' },
        // Guide voice (DAW 1.2/1.5): what the guide toggle SOUNDS like —
        // the clap, or the charted pitches on a GM instrument. The
        // instrument radio rows follow the current part's kind (ctx.gmGuide).
        { hdr: 'Guide voice' },
        { guideVoice: 'clap', label: 'Clap' },
        { guideVoice: 'gm', label: 'Instrument (GM)' },
        { gmVoiceRows: true },
    ] },
    { title: 'Tempo/Grid', items: [
        { cmd: 'toggleTempoMap' },
        { cmd: 'setTimeSignature' },
        { sep: true },
        { hdr: 'Barlines (Tempo Map)' },
        { cmd: 'tempoSuggestFit', needs: 'tempoMap' },
        { cmd: 'tempoInsertSync', needs: 'tempoMap' },
        { cmd: 'tempoDeleteSync', needs: 'tempoMap' },
        { cmd: 'tempoToggleSyncLock', needs: 'tempoMap' },
        { cmd: 'tempoSetBpm', needs: 'tempoMap' },
        { cmd: 'tempoTapBpm', needs: 'tempoMap' },
        { cmd: 'tempoModulate', needs: 'tempoMap' },
        { cmd: 'tempoBeatCount', needs: 'tempoMap' },
        { cmd: 'tempoBeatMinus', needs: 'tempoMap' },
        { cmd: 'tempoBeatPlus', needs: 'tempoMap' },
        { cmd: 'tempoBeatUnit', needs: 'tempoMap' },
        { cmd: 'tempoFullDialog' },
        { cmd: 'tempoRebuildGrid' },
        { sep: true },
        { label: 'Sync tempo to audio', fn: 'editorSyncTempo', audioOnly: true },
        { sep: true },
        { hdr: 'Snap' },
        { cmd: 'toggleSnap' },
        { cmd: 'snapDown' },
        { cmd: 'snapUp' },
        { cmd: 'toggleSnapMode' },
        { cmd: 'customGridSnap' },
        { cmd: 'toggleGridDisplay' },
    ] },
    { title: 'Help', items: [
        { label: 'User Guide', fn: 'editorToggleUserGuide' },
        { sep: true },
        { cmd: 'openCommandPalette' },
        { cmd: 'showShortcutHelp' },
        { cmd: 'midiTones' },
        { sep: true },
        { label: 'Shortcut profile: FeedBack ⇄ EOF', fn: '__swapProfile' },
    ] },
]);

// Resolve the static structure against the registry rows + editor state into
// a render-ready model. Pure: rows come from _editorShortcutRowsPure(profile),
// ctx carries the two mode gates and which window entry points exist.
//   → [{ title, items: [{ label, key, dispatch, disabled, planned, hdr, sep }] }]
export function _menuModelPure(menus, rows, ctx) {
    const byId = new Map(rows.map((r) => [r.id, r]));
    const model = [];
    for (const menu of menus) {
        const items = [];
        for (const it of menu.items) {
            if (it.sep) { items.push({ sep: true }); continue; }
            if (it.hdr) { items.push({ hdr: it.hdr }); continue; }
            if (it.tb || it.tbPreset || it.tbReset) {
                // Toolbar checklist rows (B5). `✓ ` marks a visible toolbar /
                // the active preset; the two-space pad keeps labels aligned.
                // A ctx without `toolbars` (older callers) renders unchecked.
                const tbs = ctx.toolbars || { visible: {}, preset: '' };
                const on = it.tb ? !!tbs.visible[it.tb]
                    : it.tbPreset ? tbs.preset === it.tbPreset : false;
                items.push({
                    label: (it.tbReset ? '' : on ? '✓ ' : '  ') + it.label,
                    key: '',
                    dispatch: it.tb ? { tb: it.tb }
                        : it.tbPreset ? { tbPreset: it.tbPreset } : { tbReset: true },
                    disabled: false,
                    planned: false,
                });
                continue;
            }
            if (it.loopSnap || it.loopClear) {
                // Loop rows (B3). The snap trio renders like a radio group;
                // ctx.loopSnapMode is absent in older callers -> unchecked.
                const on = it.loopSnap && ctx.loopSnapMode === it.loopSnap;
                items.push({
                    label: (it.loopClear ? '' : on ? '✓ ' : '  ') + it.label,
                    key: '',
                    dispatch: it.loopSnap ? { loopSnap: it.loopSnap } : { loopClear: true },
                    disabled: false,
                    planned: false,
                });
                continue;
            }
            if (it.guideVoice) {
                // Guide-voice radio (DAW 1.2): clap vs GM instrument. A ctx
                // without gmGuide (older callers) renders unchecked.
                const on = ctx.gmGuide && ctx.gmGuide.mode === it.guideVoice;
                items.push({
                    label: (on ? '✓ ' : '  ') + it.label,
                    key: '',
                    dispatch: { guideVoice: it.guideVoice },
                    disabled: false,
                    planned: false,
                });
                continue;
            }
            if (it.gmVoiceRows) {
                // Per-kind instrument radio rows (DAW 1.5): expand to the
                // CURRENT part kind's curated choices; no kind (no song, or
                // the drum grid — drums keep their clap) renders nothing.
                const gg = ctx.gmGuide;
                if (gg && gg.kind && Array.isArray(gg.choices) && gg.choices.length) {
                    items.push({ hdr: `Guide instrument (${gg.kind})` });
                    for (const c of gg.choices) {
                        items.push({
                            label: (gg.program === c.gm ? '✓ ' : '  ') + c.label,
                            key: '',
                            dispatch: { gmVoice: c.gm, gmKind: gg.kind },
                            disabled: false,
                            planned: false,
                        });
                    }
                }
                continue;
            }
            if (it.cmd) {
                const row = byId.get(it.cmd);
                if (!row) continue;   // registry moved on — never render a dangling id
                const planned = row.status === 'planned';
                const gated = it.needs === 'tempoMap' && !ctx.tempoMapMode;
                items.push({
                    label: row.label,
                    key: row.key,
                    dispatch: planned ? null : { cmd: it.cmd },
                    disabled: planned || gated,
                    planned,
                });
                continue;
            }
            if (it.audioOnly && !ctx.hasAudio) continue;   // hidden, not greyed (charrette)
            const missing = !ctx.fns || !ctx.fns.has(it.fn);
            items.push({
                label: it.label,
                key: it.key || '',
                dispatch: missing ? null : { fn: it.fn },
                disabled: missing,
                planned: false,
            });
        }
        // Drop leading/trailing separators left by gated neighbours.
        while (items.length && items[0].sep) items.shift();
        while (items.length && items[items.length - 1].sep) items.pop();
        if (items.some((i) => !i.sep && !i.hdr)) model.push({ title: menu.title, items });
    }
    return model;
}
/* @pure:menu-model:end */

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const $bar = () => document.getElementById('editor-menu-bar');
let openIdx = -1;

function windowFns() {
    const fns = new Set(['__swapProfile']);
    for (const menu of EDITOR_MENUS) {
        for (const it of menu.items) {
            if (it.fn && it.fn !== '__swapProfile' && typeof window[it.fn] === 'function') fns.add(it.fn);
        }
    }
    return fns;
}

// Guide-voice menu context: the current part's kind, its effective GM
// program, and the curated rows. Null kind (no song / drum grid) tells the
// model to render no instrument rows.
function _gmGuideMenuCtx() {
    const arr = (S.arrangements && S.arrangements[S.currentArr]) || null;
    const kind = (!arr || S.drumEditMode) ? null : _gmKindPure(arr.name);
    return {
        mode: editorGuideVoiceMode(),
        kind,
        program: kind ? editorGmVoiceFor(kind) : null,
        choices: kind ? (GM_VOICE_CHOICES[kind] || []) : [],
    };
}

function currentModel() {
    return _menuModelPure(
        EDITOR_MENUS,
        _editorShortcutRowsPure(editorShortcutProfile),
        {
            tempoMapMode: !!S.tempoMapMode, hasAudio: !!S.audioBuffer, fns: windowFns(),
            toolbars: getToolbarCtx(),
            loopSnapMode: editorLoopSnapMode(),
            gmGuide: _gmGuideMenuCtx(),
        });
}

function dispatch(d) {
    if (!d) return;
    if (d.cmd) { _editorRunEofCommand(d.cmd); return; }
    if (d.tb) { toggleToolbar(d.tb); return; }
    if (d.tbPreset) { applyToolbarPreset(d.tbPreset); return; }
    if (d.tbReset) { resetToolbarLayout(); return; }
    if (d.loopSnap) { editorSetLoopSnapMode(d.loopSnap); return; }
    if (d.loopClear) { _clearBarSelection(); return; }
    if (d.guideVoice) { _editorSetGuideVoiceMode(d.guideVoice); return; }
    if (d.gmVoice != null) { editorSetGmVoice(d.gmKind, d.gmVoice); return; }
    if (d.fn === '__swapProfile') {
        const next = editorShortcutProfile === 'eof' ? 'feedback' : 'eof';
        if (typeof window.editorSetShortcutProfile === 'function') window.editorSetShortcutProfile(next);
        const sel = document.getElementById('editor-shortcut-profile');
        if (sel) sel.value = next;
        return;
    }
    if (typeof window[d.fn] === 'function') window[d.fn]();
}

// Dropdown content renders at OPEN time (accelerators/gates read live state).
function renderDropdown(idx) {
    const bar = $bar();
    const drop = document.getElementById('editor-menu-drop');
    if (!bar || !drop) return;
    const model = currentModel();
    const menu = model[idx];
    if (!menu) return;
    drop.innerHTML = menu.items.map((it, i) => {
        if (it.sep) return `<div class="editor-menu-sep"></div>`;
        if (it.hdr) return `<div class="editor-menu-hdr">${esc(it.hdr)}</div>`;
        return `<button class="editor-menu-item" data-i="${i}" role="menuitem"`
            + `${it.disabled ? ' aria-disabled="true"' : ''}>`
            + `<span class="editor-menu-label">${esc(it.label)}${it.planned ? ' <span class="editor-menu-soon">soon</span>' : ''}</span>`
            + `<span class="editor-menu-key">${esc(it.key || '')}</span></button>`;
    }).join('');
    const anchor = bar.querySelectorAll('.editor-menu-title')[idx];
    drop.style.left = anchor ? anchor.offsetLeft + 'px' : '0px';
    drop.classList.remove('hidden');
    drop.dataset.menuIdx = String(idx);
}

function setOpen(idx) {
    const bar = $bar();
    if (!bar) return;
    openIdx = idx;
    bar.querySelectorAll('.editor-menu-title').forEach((el, i) =>
        el.classList.toggle('is-open', i === idx));
    const drop = document.getElementById('editor-menu-drop');
    if (idx < 0) { if (drop) drop.classList.add('hidden'); return; }
    renderDropdown(idx);
}

function focusItem(drop, dir) {
    const items = [...drop.querySelectorAll('.editor-menu-item:not([aria-disabled])')];
    if (!items.length) return;
    const cur = items.indexOf(document.activeElement);
    const next = cur < 0
        ? (dir > 0 ? 0 : items.length - 1)
        : (cur + dir + items.length) % items.length;
    items[next].focus();
}

export function initMenuBar() {
    const bar = $bar();
    if (!bar) return;
    bar.innerHTML = EDITOR_MENUS.map((m, i) =>
        `<button class="editor-menu-title" data-menu="${i}">${esc(m.title)}</button>`).join('')
        + `<div id="editor-menu-drop" class="editor-menu-drop hidden" role="menu"></div>`;

    bar.addEventListener('click', (e) => {
        const t = e.target instanceof HTMLElement ? e.target : null;
        if (!t) return;
        const title = t.closest('.editor-menu-title');
        if (title) {
            const idx = Number(title.dataset.menu);
            setOpen(openIdx === idx ? -1 : idx);
            return;
        }
        const item = t.closest('.editor-menu-item');
        if (item && !item.hasAttribute('aria-disabled')) {
            const model = currentModel();
            const menu = model[Number(document.getElementById('editor-menu-drop').dataset.menuIdx)];
            const it = menu && menu.items[Number(item.dataset.i)];
            setOpen(-1);
            if (it) dispatch(it.dispatch);
        }
    });
    // DAW idiom: while a menu is open, hovering a sibling title slides over.
    bar.addEventListener('mouseover', (e) => {
        if (openIdx < 0) return;
        const title = e.target instanceof HTMLElement ? e.target.closest('.editor-menu-title') : null;
        if (title) {
            const idx = Number(title.dataset.menu);
            if (idx !== openIdx) setOpen(idx);
        }
    });
    // Arrow-nav + Enter/Escape (the charrette's no-Alt-mnemonics fallback).
    bar.addEventListener('keydown', (e) => {
        const drop = document.getElementById('editor-menu-drop');
        if (openIdx < 0 || !drop) return;
        e.stopPropagation();   // menu navigation never reaches canvas shortcuts
        if (e.key === 'Escape') { e.preventDefault(); setOpen(-1); return; }
        if (e.key === 'ArrowDown') { e.preventDefault(); focusItem(drop, 1); return; }
        if (e.key === 'ArrowUp') { e.preventDefault(); focusItem(drop, -1); return; }
        if (e.key === 'ArrowRight') { e.preventDefault(); setOpen((openIdx + 1) % EDITOR_MENUS.length); return; }
        if (e.key === 'ArrowLeft') { e.preventDefault(); setOpen((openIdx - 1 + EDITOR_MENUS.length) % EDITOR_MENUS.length); return; }
    });

    // Click-away closes. The ONE document-level listener — teardown-registered.
    host.addGlobalListener(document, 'mousedown', (e) => {
        if (openIdx < 0) return;
        const b = $bar();
        if (b && e.target instanceof Node && !b.contains(e.target)) setOpen(-1);
    });
}
