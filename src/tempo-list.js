/* Slopsmith Arrangement Editor — the numeric Tempo List (P2-7, UX G3).
 *
 * A small scrollable table of every AUTHORED tempo/meter mark — one row per
 * mark: Bar · Type · Value · Source — the accessibility + provenance home
 * (the chips are paint; this is text). Click a row to jump to its bar in
 * Tempo Map mode. Derived (machine-read) tempo changes are deliberately NOT
 * listed: this is the ledger of what a human (or an accepted fit) DECLARED.
 *
 * Rendered on open + after every marks change (cheap: identity-keyed).
 */

import { S } from './state.js';
import { host } from './host.js';
import { setStatus } from './ui.js';

const $panel = () => document.getElementById('editor-tempo-list');
const $body = () => document.getElementById('editor-tempo-list-body');

function _esc(t) {
    return String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// One row of display strings per authored mark — pure, pinned by test.
export function _tempoListRowsPure(marks) {
    return (marks || []).map(m => ({
        measure: m.measure,
        type: m.kind === 'ramp' ? (m.bpmEnd < m.bpmStart ? 'rit.' : 'accel.')
            : m.kind === 'meter' ? 'meter'
            : m.kind === 'feel' ? 'feel' : 'hold',
        value: m.kind === 'ramp' ? `${m.bpmStart}→${m.bpmEnd} (bars ${m.measure}–${m.measureEnd}, ${m.curve})`
            : m.kind === 'meter' ? `${m.num}/${m.den}${m.grouping ? ` (${m.grouping.join('+')})` : ''}`
            : m.kind === 'feel' ? (m.ratio === 0.5 ? '½-time' : m.ratio === 2 ? '2×-time' : 'straight')
            : `×${m.factor}`,
        source: m.provenance || '—',
    }));
}

let _renderedRef = null;

export function _tempoListRender() {
    const body = $body();
    const panel = $panel();
    if (!body || !panel || panel.classList.contains('hidden')) return;
    if (_renderedRef === S.tempoMarks) return;
    _renderedRef = S.tempoMarks;
    const rows = _tempoListRowsPure(S.tempoMarks);
    body.innerHTML = rows.length
        ? rows.map((r, i) =>
            `<tr data-i="${i}" class="cursor-pointer hover:bg-dark-600">`
            + `<td class="px-2 py-0.5 text-right font-mono">${r.measure}</td>`
            + `<td class="px-2 py-0.5">${_esc(r.type)}</td>`
            + `<td class="px-2 py-0.5 font-mono">${_esc(r.value)}</td>`
            + `<td class="px-2 py-0.5 text-gray-500">${_esc(r.source)}</td></tr>`).join('')
        : '<tr><td colspan="4" class="px-2 py-2 text-gray-500">No authored marks yet — right-click a barline in Tempo Map.</td></tr>';
}

function _gotoMark(idx) {
    const mark = (S.tempoMarks || [])[idx];
    if (!mark) return;
    if (!S.tempoMapMode && typeof window.editorRunShortcutCommand === 'function') {
        window.editorRunShortcutCommand('toggleTempoMap');
    }
    let beatIdx = -1, t = 0;
    for (let i = 0; i < (S.beats || []).length; i++) {
        if (S.beats[i] && S.beats[i].measure === mark.measure) { beatIdx = i; t = S.beats[i].time; break; }
    }
    if (beatIdx < 0) { setStatus(`Bar ${mark.measure} is not on the current grid.`); return; }
    S.tempoSel = beatIdx;
    if (S.tempoSelMulti) S.tempoSelMulti.clear();
    S.scrollX = Math.max(0, t - 0.5);
    host.draw();
    host.updateStatus();
}

export function editorToggleTempoList() {
    const panel = $panel();
    if (!panel) return false;
    const opening = panel.classList.contains('hidden');
    panel.classList.toggle('hidden');
    if (opening) {
        _renderedRef = null;   // force a fresh render on open
        _tempoListRender();
        setStatus('Tempo List — every authored mark, one row each; click a row to jump to its bar.');
    }
    return true;
}

export function initTempoList() {
    const panel = $panel();
    if (!panel) return;
    panel.addEventListener('click', (e) => {
        const tr = e.target instanceof Element ? e.target.closest('tr[data-i]') : null;
        if (tr) _gotoMark(Number(tr.dataset.i));
        if (e.target instanceof Element && e.target.id === 'editor-tempo-list-close') {
            panel.classList.add('hidden');
        }
    });
}
