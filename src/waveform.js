// Waveform rendering: the audio waveform lane, the onset strip, and the
// bookmark flags across the top of the editor. drawWaveform is the entry point
// (a host hook, called by drawNow); the onset-strip and bookmark helpers are
// internal.

import { _ensureOnsets, _onsetStripEnabled } from './audio.js';
import { ctx } from './canvas.js';
import { LABEL_W, TIMELINE_TOP, WAVEFORM_H, timeToX, xToTime } from './geometry.js';
import { _bookmarks, editorWaveformVisible } from './input.js';
import { S } from './state.js';

export function drawWaveform(w) {
    ctx.fillStyle = '#08081a';
    ctx.fillRect(0, TIMELINE_TOP, w, WAVEFORM_H);
    // The onset strip and bookmark flags are independent of the waveform
    // toggle: waveform off + onsets on = the pure "blocky" detection view;
    // both on = an overlay; bookmarks always show over the band.
    // (typeof guards keep drawWaveform extractable by the render test.)
    const drawOnsets = () => {
        if (typeof _drawOnsetStrip === 'function') _drawOnsetStrip(w);
        if (typeof _drawBookmarks === 'function') _drawBookmarks(w);
    };
    if (typeof editorWaveformVisible !== 'undefined' && !editorWaveformVisible) {
        drawOnsets();
        return;
    }
    const pk = S.waveformPeaks;
    const dur = S.duration || 0;
    if (!pk || !pk.bins || dur <= 0) { drawOnsets(); return; }

    const N = pk.bins;
    const mid = TIMELINE_TOP + WAVEFORM_H / 2;
    const amp = WAVEFORM_H / 2 - 4;
    // Visible pixel span of the audio (clamped to the waveform lane).
    const xLo = Math.max(LABEL_W, Math.floor(timeToX(0)));
    const xHi = Math.min(w, Math.ceil(timeToX(dur)));
    if (xHi <= xLo) return;

    // Per-column bin range for the pixel [px, px+1). Each column aggregates
    // every bin it spans, so the shape stays correct from full-song zoom-out
    // down to a single bin per pixel.
    const binRange = (px) => {
        let i0 = Math.floor(xToTime(px) / dur * N);
        let i1 = Math.floor(xToTime(px + 1) / dur * N);
        if (i0 < 0) i0 = 0;
        if (i1 >= N) i1 = N - 1;
        if (i1 < i0) i1 = i0;
        return [i0, i1];
    };

    // Faint zero line.
    ctx.strokeStyle = 'rgba(120,150,210,0.18)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(xLo, mid + 0.5);
    ctx.lineTo(xHi, mid + 0.5);
    ctx.stroke();

    // Peak (min→max) envelope — the true asymmetric outline, drawn light.
    ctx.fillStyle = 'rgba(90,150,235,0.40)';
    for (let px = xLo; px < xHi; px++) {
        const [i0, i1] = binRange(px);
        let lo = pk.min[i0], hi = pk.max[i0];
        for (let i = i0 + 1; i <= i1; i++) {
            if (pk.min[i] < lo) lo = pk.min[i];
            if (pk.max[i] > hi) hi = pk.max[i];
        }
        const yHi = mid - hi * amp;
        const yLo = mid - lo * amp;
        ctx.fillRect(px, yHi, 1, Math.max(1, yLo - yHi));
    }

    // RMS body — loudness, drawn brighter and symmetric around the zero line.
    ctx.fillStyle = 'rgba(130,185,255,0.85)';
    for (let px = xLo; px < xHi; px++) {
        const [i0, i1] = binRange(px);
        let sumSq = 0, cnt = 0;
        for (let i = i0; i <= i1; i++) { const r = pk.rms[i]; sumSq += r * r; cnt++; }
        const h = (cnt ? Math.sqrt(sumSq / cnt) : 0) * amp;
        if (h > 0.5) ctx.fillRect(px, mid - h, 1, Math.max(1, 2 * h));
    }

    drawOnsets();
}

// Detected-onset blocks over the waveform band — a visual hint of where
// transients (likely note/beat events) live in the recording. Display
// only: the strip never places notes (D22).
function _drawOnsetStrip(w) {
    if (!_onsetStripEnabled()) return;
    const onsets = _ensureOnsets();
    if (!onsets || !onsets.length) return;
    const dur = S.duration || 0;
    if (dur <= 0) return;
    const xLo = Math.max(LABEL_W, Math.floor(timeToX(0)));
    const xHi = Math.min(w, Math.ceil(timeToX(dur)));
    // onsets are time-sorted and timeToX is monotonic, so the on-screen pixel
    // is non-decreasing across the array. Binary-search the first visible
    // onset (px >= xLo) and stop at the first past xHi — no full-array scan.
    let lo = 0, hi = onsets.length;
    while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (Math.round(timeToX(onsets[mid].t)) < xLo) lo = mid + 1;
        else hi = mid;
    }
    for (let i = lo; i < onsets.length; i++) {
        const o = onsets[i];
        const px = Math.round(timeToX(o.t));
        if (px > xHi) break;
        // Stronger attacks read brighter and taller — quiet ghost hits stay
        // visible but understated.
        ctx.fillStyle = `rgba(255,190,80,${(0.30 + 0.45 * o.s).toFixed(3)})`;
        const h = Math.round((WAVEFORM_H - 6) * (0.55 + 0.45 * o.s));
        ctx.fillRect(px - 1, TIMELINE_TOP + WAVEFORM_H - 3 - h, 3, h);
    }
}

// Numbered bookmark flags over the waveform band. Bookmarks are EDITOR
// authoring state (localStorage per song — never pack data, §6): nine
// numbered time markers, Shift+Alt+1-9 sets/clears at the cursor,
// Alt+1-9 jumps.
function _drawBookmarks(w) {
    const marks = _bookmarks();
    let drew = false;
    for (let n = 1; n <= 9; n++) {
        const t = marks[n];
        if (t === undefined) continue;
        const px = Math.round(timeToX(t));
        if (px < LABEL_W || px > w) continue;
        if (!drew) {
            ctx.save();
            ctx.font = 'bold 9px monospace';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            drew = true;
        }
        ctx.fillStyle = 'rgba(120,220,160,0.9)';
        ctx.fillRect(px, TIMELINE_TOP + 2, 1, WAVEFORM_H - 4);
        ctx.fillRect(px, TIMELINE_TOP + 2, 11, 11);
        ctx.fillStyle = '#0b1512';
        ctx.fillText(String(n), px + 6, TIMELINE_TOP + 8);
    }
    if (drew) ctx.restore();
}
