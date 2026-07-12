/* Slopsmith Arrangement Editor — shared UI helpers.
 *
 * The status line (called from ~180 sites), plus the three modal primitives
 * every dialog in the editor is built on: the focus trap, the in-app text
 * prompt, and the HTML escaper. They live here for the same reason setStatus
 * does — everything needs them, and none of them belongs to whichever feature
 * happened to want one first.
 *
 * This module imports nothing, which is what lets any other module use it
 * without thinking about cycles. `_editorPromptText` used to reach the modules
 * as a `host` hook for exactly that reason; now they just import it.
 */

export function setStatus(msg) {
    // No document = no status line to write to. The guard belongs here rather
    // than at the ~180 call sites because it is what keeps the pure modules —
    // notably src/commands.js — importable AND runnable under node with no DOM,
    // which is how their suites drive the real code (Copilot, #169).
    if (typeof document === 'undefined') return;
    const el = document.getElementById('editor-status');
    if (el) el.textContent = msg;
}

// Escape a string for safe interpolation into innerHTML. Covers the five
// chars that matter for HTML context (& must be first to avoid double-escape).
export function _editorEscHtml(s) {
    return String(s ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// Shared keyboard-handling for dynamically-generated modals: stop
// propagation so global shortcuts can't fire, trap Tab/Shift-Tab so
// focus doesn't escape, close on Escape. Returns the keydown listener
// so callers could remove it on close if they ever wanted to.
export function _installModalKeyboard(modal, inner, onClose) {
    const FOCUSABLE_SEL = 'a[href], button:not([disabled]),'
        + ' input:not([disabled]), select:not([disabled]),'
        + ' textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
    // Backdrop must be focusable so click-on-overlay can still receive
    // focus (and we can immediately re-direct it inside) — otherwise
    // the click sends focus to <body>, key events skip the modal
    // handler, and global editor shortcuts (Space/Delete/…) fire
    // through the dimmed background.
    modal.tabIndex = -1;
    modal.addEventListener('mousedown', (e) => {
        if (e.target === modal) {
            // Defer until after the click's default focus change so we
            // win the focus-move race.
            setTimeout(() => {
                const f = inner.querySelector(FOCUSABLE_SEL);
                f?.focus();
            }, 0);
        }
    });
    const handler = (e) => {
        e.stopPropagation();
        if (e.key === 'Escape') {
            e.preventDefault();
            onClose();
            return;
        }
        if (e.key === 'Tab') {
            const items = Array.from(inner.querySelectorAll(FOCUSABLE_SEL));
            if (!items.length) return;
            const first = items[0], last = items[items.length - 1];
            const active = document.activeElement;
            // If focus is on the backdrop itself (after an overlay
            // click) or on anything outside `inner`, Tab would
            // otherwise escape via the browser's default sequential
            // navigation. Pull it back to the appropriate end.
            const insideInner = inner.contains(active);
            if (e.shiftKey && (!insideInner || active === first)) {
                e.preventDefault(); last.focus();
            } else if (!e.shiftKey && (!insideInner || active === last)) {
                e.preventDefault(); first.focus();
            }
        }
    };
    modal.addEventListener('keydown', handler);
    return handler;
}

// Cancel hook for the currently-open `_editorPromptText` modal (null when
// none is open). Lets a newly-opened prompt settle the previous one as a
// cancel so its awaiter never hangs.
let _editorPromptCancel = null;

// In-app replacement for `window.prompt()`, which Electron (the desktop
// app) does not implement — there it returns null and logs a warning, so
// every prompt-based editor action (add/rename section, edit fret/bend/
// slide, edit anchor) silently no-ops on desktop while their no-prompt
// siblings like Delete still work (issue #480). Returns a Promise that
// resolves to the entered string on OK/Enter (the empty string is a valid
// OK, matching `prompt()`), or null on Cancel/Escape. (Clicking the dimmed
// overlay does not dismiss — same as the editor's other modals, which
// re-focus the dialog instead; use Cancel/Escape.)
export function _editorPromptText({ title = '', label = '', value = '', placeholder = '' } = {}) {
    return new Promise((resolve) => {
        // Settle any still-open prompt as a cancel BEFORE replacing it, so
        // an in-flight `await` can't hang forever when a second prompt
        // opens (e.g. two quick context-menu actions). `_editorPromptCancel`
        // holds the live prompt's cancel hook; invoking it resolves that
        // Promise with null and clears the ref.
        if (_editorPromptCancel) _editorPromptCancel();
        document.getElementById('editor-text-prompt')?.remove();

        const modal = document.createElement('div');
        modal.id = 'editor-text-prompt';
        modal.className = 'fixed inset-0 bg-black/70 z-50 flex items-center justify-center';

        const inner = document.createElement('div');
        inner.className = 'bg-dark-800 border border-gray-700 rounded-lg p-6 max-w-sm w-full mx-4';

        let settled = false;
        const done = (val) => {
            if (settled) return;
            settled = true;
            _editorPromptCancel = null;
            modal.remove();
            resolve(val);
        };

        // Dialog semantics so assistive tech announces the modal context
        // and that focus is trapped inside it.
        const inputId = 'editor-text-prompt-input';
        inner.setAttribute('role', 'dialog');
        inner.setAttribute('aria-modal', 'true');

        if (title) {
            const h = document.createElement('h3');
            h.id = 'editor-text-prompt-title';
            h.className = 'text-lg font-semibold mb-3';
            h.textContent = title;
            inner.appendChild(h);
            inner.setAttribute('aria-labelledby', h.id);
        } else {
            inner.setAttribute('aria-label', label || 'Input');
        }
        if (label) {
            const l = document.createElement('label');
            l.htmlFor = inputId;
            l.className = 'block text-xs text-gray-400 mb-1';
            l.textContent = label;
            inner.appendChild(l);
        }

        const input = document.createElement('input');
        input.type = 'text';
        input.id = inputId;
        input.value = value;
        input.placeholder = placeholder;
        // When there's no visible <label>, give screen readers a name.
        if (!label) input.setAttribute('aria-label', title || 'Value');
        input.className = 'w-full px-2 py-1 bg-dark-700 border border-gray-600 rounded text-sm mb-4';
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); done(input.value); }
        });
        inner.appendChild(input);

        const row = document.createElement('div');
        row.className = 'flex justify-end gap-2';
        const cancelBtn = document.createElement('button');
        cancelBtn.type = 'button';
        cancelBtn.className = 'px-3 py-1 bg-dark-700 hover:bg-dark-600 rounded text-sm';
        cancelBtn.textContent = 'Cancel';
        cancelBtn.onclick = () => done(null);
        const okBtn = document.createElement('button');
        okBtn.type = 'button';
        okBtn.className = 'px-3 py-1 bg-blue-700 hover:bg-blue-600 rounded text-sm';
        okBtn.textContent = 'OK';
        okBtn.onclick = () => done(input.value);
        row.appendChild(cancelBtn);
        row.appendChild(okBtn);
        inner.appendChild(row);

        modal.appendChild(inner);
        // Escape resolves as a cancel (null); the backdrop only re-focuses.
        _installModalKeyboard(modal, inner, () => done(null));
        // Expose this prompt's cancel so a later prompt can settle it.
        _editorPromptCancel = () => done(null);
        document.body.appendChild(modal);
        input.focus();
        input.select();
    });
}

// A titled choice dialog (same modal idiom as _editorPromptText): a message plus
// one button per choice (label + hint), and Cancel. Resolves to the chosen
// `key`, or null on Cancel / Escape. (Clicking the dimmed overlay does not
// dismiss — it re-focuses the dialog, same as the editor's other modals.)
// `choices`: [{ key, label, hint }].
export function _editorPromptChoice({ title = '', message = '', choices = [] } = {}) {
    return new Promise((resolve) => {
        if (_editorPromptCancel) _editorPromptCancel();
        document.getElementById('editor-choice-prompt')?.remove();

        const modal = document.createElement('div');
        modal.id = 'editor-choice-prompt';
        modal.className = 'fixed inset-0 bg-black/70 z-50 flex items-center justify-center';
        const inner = document.createElement('div');
        inner.className = 'bg-dark-800 border border-gray-700 rounded-lg p-6 max-w-md w-full mx-4';
        inner.setAttribute('role', 'dialog');
        inner.setAttribute('aria-modal', 'true');

        let settled = false;
        const done = (val) => {
            if (settled) return;
            settled = true;
            _editorPromptCancel = null;
            modal.remove();
            resolve(val);
        };

        if (title) {
            const h = document.createElement('h3');
            h.id = 'editor-choice-prompt-title';
            h.className = 'text-lg font-semibold mb-2';
            h.textContent = title;
            inner.appendChild(h);
            inner.setAttribute('aria-labelledby', h.id);
        } else {
            inner.setAttribute('aria-label', 'Choose an option');
        }
        if (message) {
            const p = document.createElement('p');
            p.className = 'text-xs text-gray-400 mb-4';
            p.textContent = message;
            inner.appendChild(p);
        }
        for (const c of (Array.isArray(choices) ? choices : [])) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'w-full text-left px-3 py-2 mb-2 bg-dark-700 hover:bg-dark-600 border border-gray-600 rounded';
            const l = document.createElement('div');
            l.className = 'text-sm font-medium text-gray-100';
            l.textContent = c.label;
            btn.appendChild(l);
            if (c.hint) {
                const hint = document.createElement('div');
                hint.className = 'text-[11px] text-gray-400 mt-0.5';
                hint.textContent = c.hint;
                btn.appendChild(hint);
            }
            btn.onclick = () => done(c.key);
            inner.appendChild(btn);
        }

        const row = document.createElement('div');
        row.className = 'flex justify-end mt-1';
        const cancelBtn = document.createElement('button');
        cancelBtn.type = 'button';
        cancelBtn.className = 'px-3 py-1 bg-dark-700 hover:bg-dark-600 rounded text-sm';
        cancelBtn.textContent = 'Cancel';
        cancelBtn.onclick = () => done(null);
        row.appendChild(cancelBtn);
        inner.appendChild(row);

        modal.appendChild(inner);
        _installModalKeyboard(modal, inner, () => done(null));
        _editorPromptCancel = () => done(null);
        document.body.appendChild(modal);
        inner.querySelector('button')?.focus();
    });
}
