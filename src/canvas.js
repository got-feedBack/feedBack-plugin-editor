/* Slopsmith Arrangement Editor — the render surface.
 *
 * The `<canvas>` element, its 2D context, and the device pixel ratio. Every
 * painter in the editor reads these; only `setCanvas` writes them.
 *
 * `canvas` and `ctx` are `export let`, so importers see them go from null to
 * live the moment `init()` calls `setCanvas`, and none of them can assign one —
 * ES import bindings are live and read-only. That is why this needs no container
 * (unlike lanes.js's `LC`, whose writers must stay in main.js): the sole writer
 * moved here.
 *
 * `DPR` is guarded so this module — and everything downstream of it — stays
 * importable under node, where there is no `window`.
 */

export const DPR = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;

export let canvas = null;
export let ctx = null;

/** Adopt `el` as the render surface. Returns it, so a caller can bail on null.
 *
 * `getContext('2d')` is idempotent — it hands back the same context object for
 * the same element — so calling this twice for one canvas is a no-op, and
 * calling it after the host has replaced the DOM node correctly re-points `ctx`
 * at the NEW element's context (the old code re-read the element but kept the
 * stale context). */
export function setCanvas(el) {
    canvas = el || null;
    ctx = canvas ? canvas.getContext('2d') : null;
    return canvas;
}
