/* Slopsmith Arrangement Editor — the command palette (Ctrl+K).
 *
 * One searchable front door over EVERYTHING the editor can do: every command
 * in the shortcut registry (with its live keybinding for the active profile)
 * plus every menu action that has no registry id (the dialog-openers like
 * Song Fit, Scan for tempo zones, Replace audio). Motivated by two real
 * tester reports in one night of features that already existed but couldn't
 * be found ("I miss a way to snap the selected notes to the grid") — a
 * palette makes a feature findable by typing what you want.
 *
 * The registry id was reserved from day one (`openCommandPalette`, Ctrl+K in
 * both profiles) but dispatched to the shortcut panel as a stub; this module
 * is the real thing behind it.
 *
 * Cycle note: registry commands execute through input.js's dispatcher, and
 * input.js opens the palette — so the dispatcher arrives as an init HOOK
 * (the tempo-zones pattern) instead of an import. The menu model arrives the
 * same way (menu-bar.js imports input.js — importing it back from here would
 * close the input → palette → menu-bar → input loop). Menu-only actions
 * execute through window[fn], exactly as the menu bar itself dispatches them.
 */

import { setStatus } from './ui.js';
import { _editorShortcutRowsPure, editorShortcutProfile } from './shortcuts.js';

/* @pure:command-palette:start */
// Build the searchable entries: registry rows (id + live key) first, then
// menu actions that dispatch a window fn (a `cmd:` menu row IS a registry row
// — skipping it here is the dedupe). `hay` is the lowercase search haystack;
// menu entries carry their menu path so "tempo scan" finds Tempo/Grid items.
export function _paletteEntriesPure(rows, menus) {
    const out = [];
    for (const r of (rows || [])) {
        if (!r || r.status !== 'ready') continue;
        // The palette never lists itself — it IS a ready registry row (and a
        // View menu row), so without this "Open command palette" shows up as a
        // hit that closes the palette and immediately reopens it.
        if (r.id === 'openCommandPalette') continue;
        out.push({ kind: 'cmd', id: r.id, label: r.label, group: r.group, key: r.key || '',
            hay: (r.label + ' ' + (r.group || '')).toLowerCase() });
    }
    for (const menu of (menus || [])) {
        for (const item of (menu.items || [])) {
            if (!item || item.sep || item.hdr || !item.fn || !item.label) continue;
            out.push({ kind: 'fn', fn: item.fn, label: item.label, group: menu.title, key: item.key || '',
                hay: (item.label + ' ' + menu.title).toLowerCase() });
        }
    }
    return out;
}

// Rank entries against a query. Word-start substring beats any substring
// beats a spread-out subsequence; ties break by label so the order is
// stable. An empty query returns the first `limit` entries as-is (a browse
// list). No match → dropped.
export function _paletteFilterPure(entries, query, limit = 12) {
    const q = String(query || '').trim().toLowerCase();
    const list = entries || [];
    if (!q) return list.slice(0, limit);
    const scored = [];
    for (const e of list) {
        const i = e.hay.indexOf(q);
        let score = null;
        if (i === 0 || (i > 0 && e.hay[i - 1] === ' ')) score = 100 - i;
        else if (i >= 0) score = 80 - i;
        else {
            // subsequence: every query char in order; penalise the spread.
            let hi = 0, ok = true, first = -1, last = -1;
            for (const ch of q) {
                const j = e.hay.indexOf(ch, hi);
                if (j < 0) { ok = false; break; }
                if (first < 0) first = j;
                last = j; hi = j + 1;
            }
            if (ok) score = 50 - Math.min(40, (last - first) - q.length + 1) - first * 0.1;
        }
        if (score !== null) scored.push({ e, score });
    }
    scored.sort((a, b) => b.score - a.score || (a.e.label < b.e.label ? -1 : 1));
    return scored.slice(0, limit).map(s => s.e);
}
/* @pure:command-palette:end */

// ── state + chrome ───────────────────────────────────────────────────
let _open = false;
let _results = [];
let _sel = 0;
let _prevFocus = null;
let _hooks = { run: null, menus: null };

const $pal = () => document.getElementById('editor-command-palette');
const $input = () => document.getElementById('editor-palette-input');
const $list = () => document.getElementById('editor-palette-list');

function _entries() {
    // `editorShortcutProfile` is the live export-let binding — the LOADER
    // returns nothing, so passing its result would silently pin the palette
    // to FeedBack keys whatever profile is active.
    return _paletteEntriesPure(
        _editorShortcutRowsPure(editorShortcutProfile), _hooks.menus || []);
}

function _render() {
    const list = $list();
    if (!list) return;
    if (_sel >= _results.length) _sel = Math.max(0, _results.length - 1);
    list.innerHTML = '';
    if (!_results.length) {
        const li = document.createElement('li');
        li.className = 'px-3 py-2 text-gray-500';
        li.textContent = 'No matching command';
        list.appendChild(li);
        return;
    }
    _results.forEach((e, i) => {
        const li = document.createElement('li');
        li.className = 'flex items-center justify-between gap-3 px-3 py-1.5 rounded cursor-pointer '
            + (i === _sel ? 'bg-sky-700/60 text-white' : 'text-gray-200 hover:bg-dark-700/80');
        li.dataset.idx = String(i);
        const left = document.createElement('span');
        left.textContent = e.label;
        const right = document.createElement('span');
        right.className = 'shrink-0 font-mono text-[10px] ' + (i === _sel ? 'text-sky-200' : 'text-gray-500');
        right.textContent = e.key || e.group;
        li.appendChild(left);
        li.appendChild(right);
        list.appendChild(li);
    });
    const cur = list.children[_sel];
    if (cur && cur.scrollIntoView) cur.scrollIntoView({ block: 'nearest' });
}

function _refresh() {
    const input = $input();
    _results = _paletteFilterPure(_entries(), input ? input.value : '');
    _render();
}

function _close() {
    if (!_open) return;
    _open = false;
    const pal = $pal();
    if (pal) pal.classList.add('hidden');
    // Hand the keyboard back to whoever had it before the palette stole focus.
    // Blurring to <body> is a safe floor (the editor's shortcuts listen on
    // `document`), but restoring the real element keeps a menu-opened palette
    // from dropping the user out of the menu bar.
    const prev = _prevFocus;
    _prevFocus = null;
    if (prev && prev.isConnected && prev.focus) prev.focus();
    else if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
}

// Escape must close the palette from ANYWHERE, not just from its own input:
// the backdrop only covers #editor-canvas-wrap, so a click on the menu bar or a
// toolbar moves focus out while the overlay stays up — and the input's keydown
// handler (the only Escape path) can no longer see the key. main.js's global
// dialog listener calls this, exactly as it does for the other overlays.
export function editorCloseCommandPalette() { _close(); }

function _runSelected() {
    const e = _results[_sel];
    if (!e) return;
    _close();
    if (e.kind === 'cmd') {
        if (_hooks.run) _hooks.run(e.id);
        return;
    }
    const fn = window[e.fn];
    if (typeof fn === 'function') fn();
    else setStatus(`${e.label} is not available right now.`);
}

export function editorOpenCommandPalette() {
    const pal = $pal();
    const input = $input();
    if (!pal || !input) return true;
    _open = true;
    _sel = 0;
    _prevFocus = document.activeElement;
    input.value = '';
    pal.classList.remove('hidden');
    _refresh();
    input.focus();
    return true;
}

export function initCommandPalette(hooks) {
    _hooks = { ..._hooks, ...(hooks || {}) };
    const pal = $pal();
    const input = $input();
    const list = $list();
    if (!pal || !input || !list) return;
    // All keyboard handling scoped to the palette's own input — the global
    // shortcut chain already ignores typing targets, so nothing leaks.
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); _close(); }
        else if (e.key === 'ArrowDown') { e.preventDefault(); _sel = Math.min(_results.length - 1, _sel + 1); _render(); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); _sel = Math.max(0, _sel - 1); _render(); }
        else if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); _runSelected(); }
    });
    input.addEventListener('input', () => { _sel = 0; _refresh(); });
    list.addEventListener('click', (e) => {
        const li = e.target instanceof Element ? e.target.closest('li[data-idx]') : null;
        if (!li) return;
        _sel = parseInt(li.dataset.idx, 10) || 0;
        _runSelected();
    });
    // Click on the backdrop (the palette wrapper itself) dismisses.
    pal.addEventListener('mousedown', (e) => { if (e.target === pal) _close(); });
}
