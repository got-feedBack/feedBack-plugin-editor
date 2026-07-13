// File ▸ Export ▸ Guitar Pro (.gp5). Downloads the GP5 bytes the Tab View
// plugin converts the current fretted part's SAVED pack into — the very bytes
// the read-only Tab preview engraves (src/tab-preview.js). The conversion
// endpoint (_tabPreviewUrlPure) lives in tab-preview.js and is reused here, so
// the tabview contract is written once; export adds only the browser download,
// plus a fretted/saved guard and status messages worded for a "save it out"
// action rather than the preview lens.
//
// Pure, decision-shaped helpers stay inside the @pure:gp5-export block (the JS
// test suite slices that block into a `new Function`); the download seam and the
// async orchestrator reach the DOM/network and are live-verified.

import { S } from './state.js';
import { setStatus } from './ui.js';
import { _tabPreviewUrlPure } from './tab-preview.js';

/* @pure:gp5-export:start */
// Which parts can export, with the exact user-facing reason when one can't.
// Mirrors the Tab preview guard: fretted-only (keys/drums pack as pitch, not
// string·fret, so a GP conversion would engrave nonsense), and a SAVED pack is
// required because the converter reads the last-saved pack. Regexes inlined so
// this @pure block stays self-contained and slice-testable (the tab-preview
// block inlines the same fretted test for the same reason).
function _gp5ExportGuardPure(filename, arrName, hasArrangements) {
    if (!hasArrangements) return { ok: false, reason: 'Load a song first.' };
    const nm = String(arrName || '');
    if (/^(keys|piano|keyboard|synth)/i.test(nm) || /^drums/i.test(nm)) {
        return { ok: false, reason: 'Guitar Pro export is for fretted tracks — keys and drums tracks have no tab.' };
    }
    if (!filename) {
        return { ok: false, reason: 'Save the song first — export reads the saved pack.' };
    }
    return { ok: true, reason: '' };
}
// The download filename: the song's base name (pack extension dropped) + the
// part name, sanitised so it can't break a download across OSes.
function _gp5ExportNamePure(filename, partName) {
    let base = String(filename || '').replace(/\.(feedpak|sloppak)$/i, '').trim();
    if (!base) base = 'track';
    const part = String(partName || '').trim();
    let name = part ? base + ' — ' + part : base;
    // Drop the characters that are illegal in a filename on Windows/macOS/Linux.
    name = name.replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, ' ').trim();
    return name + '.gp5';
}
// Map a failed conversion response to the honest, export-worded message.
function _gp5ExportHttpMessagePure(status, bodyText) {
    if (status === 404) {
        return 'Export needs the Tab View plugin installed — or the song has no saved pack yet (Save/Build first).';
    }
    if (status === 501) {
        return 'The host is too old for Guitar Pro export — update feedBack.';
    }
    const body = String(bodyText || '').slice(0, 140);
    return 'Export failed (' + status + ')' + (body ? ': ' + body : '');
}
/* @pure:gp5-export:end */
export { _gp5ExportGuardPure, _gp5ExportNamePure, _gp5ExportHttpMessagePure };

// Trigger a browser download of `bytes` as `name`. A tiny DOM seam — all the
// testable logic lives in the pure helpers above. The object URL is revoked on
// the next tick so the click has grabbed the blob first (revoking synchronously
// cancels the download in some browsers); it is a fire-once transient, not a
// registered timer, so it doesn't leak across screen re-injection.
function _downloadBytes(bytes, name) {
    const blob = new Blob([bytes], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
}

export async function editorExportGp5() {
    const arr = S.arrangements.length ? S.arrangements[S.currentArr] : null;
    const guard = _gp5ExportGuardPure(S.filename, arr && arr.name, !!S.arrangements.length);
    if (!guard.ok) { setStatus(guard.reason); return; }
    const name = _gp5ExportNamePure(S.filename, arr && arr.name);
    setStatus('Exporting ' + name + '…');
    try {
        // Cache-bust with the timestamp so an export right after a Save always
        // re-converts the latest pack (same reason the preview does).
        const resp = await fetch(_tabPreviewUrlPure(S.filename, S.currentArr, Date.now()));
        if (!resp.ok) {
            let body = '';
            try { body = await resp.text(); } catch (_) { /* keep '' */ }
            setStatus(_gp5ExportHttpMessagePure(resp.status, body));
            return;
        }
        const buf = await resp.arrayBuffer();
        _downloadBytes(new Uint8Array(buf), name);
        setStatus('Exported ' + name);
    } catch (e) {
        setStatus('Export failed: ' + (e && e.message ? e.message : e));
    }
}
