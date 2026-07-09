/* Slopsmith Arrangement Editor — shared UI helpers.
 *
 * The status line. Called from ~180 sites and from every module that needs to
 * tell the user something, so it lives on its own rather than being dragged
 * into whichever module happened to need it first.
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
