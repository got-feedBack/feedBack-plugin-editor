/* Arrangement Editor session lifecycle.
 *
 * Every destructive job transition goes through this module. It owns the
 * three-way dirty prompt and outgoing process shutdown.
 */
import { host } from './host.js';
import { S, sessionIsDirty } from './state.js';

let promptPromise = null;
let _promptResolve = null;
let _promptKeyHandler = null;

function _removePrompt() {
    if (_promptKeyHandler) {
        try { document.removeEventListener('keydown', _promptKeyHandler, true); } catch (_) {}
        _promptKeyHandler = null;
    }
    document.getElementById('editor-session-confirm')?.remove();
}

function _showTransitionPrompt(nextLabel) {
    if (promptPromise) return promptPromise;
    promptPromise = new Promise((resolve) => {
        _removePrompt();
        _promptResolve = resolve;
        const modal = document.createElement('div');
        modal.id = 'editor-session-confirm';
        modal.className = 'fixed inset-0 z-[10000] bg-black/70 flex items-center justify-center p-4';
        modal.setAttribute('role', 'dialog');
        modal.setAttribute('aria-modal', 'true');
        modal.setAttribute('aria-labelledby', 'editor-session-confirm-title');
        const panel = document.createElement('div');
        panel.className = 'w-full max-w-md bg-dark-800 border border-dark-500 rounded shadow-2xl p-5';
        const title = document.createElement('h2');
        title.id = 'editor-session-confirm-title';
        title.className = 'text-base font-semibold text-white';
        title.textContent = 'Save changes?';
        const body = document.createElement('p');
        body.className = 'mt-2 text-sm text-gray-300';
        body.textContent = 'Save changes to ' + (S.title || S.filename || 'this feedpak')
            + ' before ' + nextLabel + '?';
        const row = document.createElement('div');
        row.className = 'mt-5 flex justify-end gap-2';
        const done = (choice) => {
            _removePrompt();          // detaches the keydown listener + modal
            promptPromise = null;
            _promptResolve = null;
            resolve(choice);
        };
        const button = (label, choice, cls) => {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'px-3 py-1.5 rounded text-sm ' + cls;
            b.textContent = label;
            b.addEventListener('click', () => done(choice));
            return b;
        };
        const onKey = (e) => {
            if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done('cancel'); }
        };
        _promptKeyHandler = onKey;
        row.append(
            button('Cancel', 'cancel', 'bg-dark-600 hover:bg-dark-500 text-gray-200'),
            button("Don't Save", 'discard', 'bg-red-900 hover:bg-red-800 text-red-100'),
            button('Save', 'save', 'bg-accent hover:bg-accent-light text-white'),
        );
        panel.append(title, body, row);
        modal.appendChild(panel);
        document.body.appendChild(modal);
        // Rides the screen teardown registry so a re-injection can't strand it.
        host.addGlobalListener(document, 'keydown', onKey, true);
        row.lastElementChild?.focus();
    });
    return promptPromise;
}

export async function guardSessionTransition(nextLabel, choose = _showTransitionPrompt) {
    if (!S.sessionId) return true;
    host.finalizeRecording();
    if (!sessionIsDirty()) return true;
    const choice = await choose(nextLabel);
    if (choice === 'cancel' || !choice) return false;
    if (choice === 'discard') return true;
    if (choice !== 'save') return false;
    return (await host.saveSession()) === true;
}

export function stopSessionProcesses() {
    host.finalizeRecording();
    host.stopPlayback();
    host.cancelAudioLoad();
    host.finalizeActiveDrag();
    S.drag = null;
}

export async function disposeBackendSession(sessionId) {
    if (!sessionId) return;
    try {
        await fetch('/api/plugins/editor/session/close', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ session_id: sessionId }),
        });
    } catch (_) {
        // Best effort. The backend also expires abandoned temp sessions.
    }
}

export function dismissSessionPrompt() {
    const resolve = _promptResolve;
    _removePrompt();
    promptPromise = null;
    _promptResolve = null;
    // Resolve as 'cancel' so any awaiting guardSessionTransition unblocks and
    // aborts the transition instead of hanging on a torn-down prompt.
    if (resolve) resolve('cancel');
}
