// Read-only Tab preview: convert the saved pack of the current fretted part to
// GP5 and engrave it with a CDN-loaded alphaTab (render-only, no synth). A modal
// proofreading lens — the key policy blocks every editor shortcut behind it.
// Pure helpers stay export-free inside the @pure:tab-preview block (the JS test
// suite slices that block into a `new Function`); the two symbols the keyboard
// layer still needs (_tabPreviewKeyPolicyPure, _editorShowTabPreview) are
// exported explicitly.

import { S } from './state.js';

/* @pure:tab-preview:start */
// Guard: which parts can preview, with the exact user-facing reason when
// one can't. NON-FRETTED parts (keys AND drums) are excluded — their wire
// packing isn't fret/string, so a GP conversion of it would engrave
// nonsense tab. The non-fretted test mirrors the editor-wide one
// (KEYS_PATTERN /^(keys|piano|keyboard|synth)/i plus /^drums/i, e.g. the
// Strings modal's gate) but is INLINED so this @pure block stays
// self-contained and extractable — no reference to the outer KEYS_PATTERN
// global, matching the parts-view block's "regexes inlined" convention.
function _tabPreviewGuardPure(filename, arrName, hasArrangements) {
    if (!hasArrangements) return { ok: false, reason: 'Load a song first.' };
    const nm = String(arrName || '');
    if (/^(keys|piano|keyboard|synth)/i.test(nm) || /^drums/i.test(nm)) {
        return { ok: false, reason: 'Tab preview is for fretted parts — keys and drums parts have no tab.' };
    }
    if (!filename) {
        return { ok: false, reason: 'Save the song first — the preview reads the saved pack.' };
    }
    return { ok: true, reason: '' };
}
// Keyboard policy while the read-only preview modal is open. It is a modal
// proofreading lens, so NO editor shortcut may reach the chart behind it
// (mirrors the partsViewMode read-only gate, which blocks note edits from
// mutating the arrangement hidden behind an overview). Escape closes it;
// every other key is swallowed. Returns 'close' | 'swallow' | 'ignore'
// ('ignore' only when the preview isn't open, so onKeyDown proceeds).
function _tabPreviewKeyPolicyPure(previewOpen, key) {
    if (!previewOpen) return 'ignore';
    if (key === 'Escape') return 'close';
    return 'swallow';
}
// The Tab View conversion URL for one saved part. `ts` busts any
// intermediate cache so Refresh after a Save always re-converts.
function _tabPreviewUrlPure(filename, arrIdx, ts) {
    return '/api/plugins/tabview/gp5/' + encodeURIComponent(filename || '')
        + '?arrangement=' + (Number(arrIdx) || 0)
        + '&t=' + (Number(ts) || 0);
}
// Map a failed conversion response to the honest user-facing message.
function _tabPreviewHttpMessagePure(status, bodyText) {
    if (status === 404) {
        return 'Tab preview needs the Tab View plugin installed — or the song has no saved pack yet.';
    }
    if (status === 501) {
        return 'The host is too old for pack conversion — update feedBack.';
    }
    const body = String(bodyText || '').slice(0, 140);
    return 'Preview failed (' + status + ')' + (body ? ': ' + body : '');
}
/* @pure:tab-preview:end */
export { _tabPreviewKeyPolicyPure };

// Same pinned version + memoized loader idiom as the Tab View plugin —
// pinning insulates the preview from CDN latest-tag churn (V12: alphaTab
// is MPL-2.0, render-only, CDN-loaded; never vendored).
const _TAB_PREVIEW_AT_VERSION = '1.8.2';
const _TAB_PREVIEW_CDN = 'https://cdn.jsdelivr.net/npm/@coderline/alphatab@'
    + _TAB_PREVIEW_AT_VERSION + '/dist';
let _tabPreviewLoadPromise = null;
function _tabPreviewLoadScript() {
    if (window.alphaTab) return Promise.resolve();
    if (_tabPreviewLoadPromise) return _tabPreviewLoadPromise;
    _tabPreviewLoadPromise = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = _TAB_PREVIEW_CDN + '/alphaTab.min.js';
        s.onload = resolve;
        s.onerror = () => {
            _tabPreviewLoadPromise = null;   // allow retry on next open
            reject(new Error('Failed to load the tab renderer (offline?)'));
        };
        document.head.appendChild(s);
    });
    return _tabPreviewLoadPromise;
}

let _tabPreviewApi = null;
let _tabPreviewSeq = 0;   // stale-render guard across rapid refreshes

function _tabPreviewStatus(msg) {
    const el = document.getElementById('editor-tab-preview-status');
    if (el) el.textContent = msg || '';
}

function _tabPreviewDestroyApi() {
    if (_tabPreviewApi) {
        try { _tabPreviewApi.destroy(); } catch (_) { /* best-effort */ }
        _tabPreviewApi = null;
    }
    const mount = document.getElementById('editor-tab-preview-mount');
    if (mount) mount.innerHTML = '';
}

async function _tabPreviewRender() {
    const seq = ++_tabPreviewSeq;
    const mount = document.getElementById('editor-tab-preview-mount');
    if (!mount) return;
    const arr = S.arrangements.length ? S.arrangements[S.currentArr] : null;
    const guard = _tabPreviewGuardPure(
        S.filename, arr && arr.name, !!S.arrangements.length);
    if (!guard.ok) {
        _tabPreviewDestroyApi();
        _tabPreviewStatus(guard.reason);
        return;
    }
    _tabPreviewStatus('Converting…');
    try {
        await _tabPreviewLoadScript();
        const url = _tabPreviewUrlPure(S.filename, S.currentArr, Date.now());
        const resp = await fetch(url);
        if (seq !== _tabPreviewSeq) return;   // superseded by a newer refresh
        if (!resp.ok) {
            let body = '';
            try { body = await resp.text(); } catch (_) { /* keep '' */ }
            // Re-check after the body read — reading it is another await, so a
            // newer refresh may have superseded us; without this a stale error
            // would destroy the newer render and stomp its status (symmetric
            // with the arrayBuffer() checkpoint on the success path below).
            if (seq !== _tabPreviewSeq) return;
            _tabPreviewDestroyApi();
            _tabPreviewStatus(_tabPreviewHttpMessagePure(resp.status, body));
            return;
        }
        const buf = await resp.arrayBuffer();
        if (seq !== _tabPreviewSeq) return;
        _tabPreviewDestroyApi();
        _tabPreviewApi = new alphaTab.AlphaTabApi(mount, {
            core: { fontDirectory: _TAB_PREVIEW_CDN + '/font/' },
            display: { layoutMode: alphaTab.LayoutMode.Page, scale: 0.9 },
            // No alphaTab synth — the editor owns audio (same rationale as
            // the Tab View plugin: drops the soundfont download entirely).
            player: { enablePlayer: false },
        });
        if (_tabPreviewApi.renderFinished && _tabPreviewApi.renderFinished.on) {
            _tabPreviewApi.renderFinished.on(() => {
                if (seq === _tabPreviewSeq) _tabPreviewStatus('');
            });
        }
        if (_tabPreviewApi.error && _tabPreviewApi.error.on) {
            _tabPreviewApi.error.on((e) => {
                if (seq === _tabPreviewSeq) {
                    _tabPreviewStatus('Render failed: ' + ((e && e.message) || 'unknown error'));
                }
            });
        }
        _tabPreviewStatus('Engraving…');
        _tabPreviewApi.load(new Uint8Array(buf));
    } catch (e) {
        if (seq === _tabPreviewSeq) {
            _tabPreviewDestroyApi();
            _tabPreviewStatus('Preview failed: ' + (e && e.message ? e.message : e));
        }
    }
}

export function _editorShowTabPreview() {
    const modal = document.getElementById('editor-tab-preview-modal');
    if (!modal) return false;
    const arr = S.arrangements.length ? S.arrangements[S.currentArr] : null;
    const title = document.getElementById('editor-tab-preview-title');
    if (title) {
        title.textContent = 'Tab preview — ' + ((arr && arr.name) || 'part') + ' (as last saved)';
    }
    modal.classList.remove('hidden');
    _tabPreviewRender();
    return true;
}

export const editorRefreshTabPreview = () => { _tabPreviewRender(); };

export const editorHideTabPreview = () => {
    const modal = document.getElementById('editor-tab-preview-modal');
    if (modal) modal.classList.add('hidden');
    // Free the engraving resources — the modal is refresh-on-open, so
    // nothing may keep laying out behind a hidden panel.
    _tabPreviewSeq++;
    _tabPreviewDestroyApi();
    _tabPreviewStatus('');
};
