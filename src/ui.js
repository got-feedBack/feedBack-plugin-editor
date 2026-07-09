/* Slopsmith Arrangement Editor — shared UI helpers.
 *
 * The status line. Called from ~180 sites and from every module that needs to
 * tell the user something, so it lives on its own rather than being dragged
 * into whichever module happened to need it first.
 */

export function setStatus(msg) {
    const el = document.getElementById('editor-status');
    if (el) el.textContent = msg;
}
