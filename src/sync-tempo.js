// Sync Tempo — detect the audio's BPM (onset autocorrelation), compare against
// the tab's grid BPM, and scale notes/beats/sections to match (respecting any
// locked sync points). The window.editor* entry points are re-attached by
// main.js; repaint goes through host.

import { beatOf, timeOf } from './beats.js';
import { notes } from './notes.js';
import { S } from './state.js';
import { _respaceWithLocksPure } from './tempo.js';
import { setStatus } from './ui.js';
import { host } from './host.js';

let syncState = { tabBPM: 0, audioBPM: 0 };

function detectAudioBPM() {
    if (!S.audioBuffer) return 0;
    const data = S.audioBuffer.getChannelData(0);
    const sr = S.audioBuffer.sampleRate;

    // Bandpass-approximate: use short + long energy windows for spectral flux
    const winSize = 1024;
    const hopSize = 512;
    const numFrames = Math.floor((data.length - winSize) / hopSize);
    const energy = new Float32Array(numFrames);
    for (let i = 0; i < numFrames; i++) {
        let sum = 0;
        const off = i * hopSize;
        for (let j = 0; j < winSize; j++) {
            sum += data[off + j] * data[off + j];
        }
        energy[i] = Math.sqrt(sum / winSize);
    }

    // Onset: spectral flux with adaptive threshold
    const onset = new Float32Array(numFrames);
    const avgWin = 16;
    for (let i = avgWin; i < numFrames; i++) {
        const diff = Math.max(0, energy[i] - energy[i - 1]);
        // Subtract local average to suppress sustained notes
        let localAvg = 0;
        for (let j = i - avgWin; j < i; j++) localAvg += Math.max(0, energy[j] - energy[j - 1]);
        localAvg /= avgWin;
        onset[i] = Math.max(0, diff - localAvg * 1.2);
    }

    // Autocorrelation for BPM range 60-220
    const frameDur = hopSize / sr;
    const minLag = Math.floor(60 / (220 * frameDur));
    const maxLag = Math.floor(60 / (60 * frameDur));
    const useLen = Math.min(onset.length, Math.floor(30 / frameDur));

    // Collect all peaks, not just the best
    const corrs = new Float32Array(maxLag + 1);
    for (let lag = minLag; lag <= Math.min(maxLag, useLen / 2); lag++) {
        let corr = 0;
        const n = useLen - lag;
        for (let i = 0; i < n; i++) corr += onset[i] * onset[i + lag];
        corrs[lag] = corr;
    }

    // Find top peaks in autocorrelation
    const peaks = [];
    for (let lag = minLag + 1; lag < maxLag; lag++) {
        if (corrs[lag] > corrs[lag - 1] && corrs[lag] > corrs[lag + 1] && corrs[lag] > 0) {
            peaks.push({ lag, corr: corrs[lag], bpm: 60 / (lag * frameDur) });
        }
    }
    peaks.sort((a, b) => b.corr - a.corr);

    if (!peaks.length) return 120;

    // Score each candidate: prefer strong correlation + BPM in 80-180 sweet spot
    // Also check if 2x or 0.5x of a candidate has strong correlation (harmonic check)
    let bestScore = -Infinity;
    let bestBPM = peaks[0].bpm;

    for (const p of peaks.slice(0, 10)) {
        let score = p.corr;

        // Boost BPMs in the 90-180 range (most common for music)
        if (p.bpm >= 90 && p.bpm <= 180) score *= 1.5;
        else if (p.bpm >= 70 && p.bpm <= 200) score *= 1.1;

        // Check if half-tempo has strong support (penalize sub-harmonics)
        const halfLag = Math.round(p.lag / 2);
        if (halfLag >= minLag && halfLag <= maxLag && corrs[halfLag] > p.corr * 0.6) {
            // Half-lag is also strong — this candidate might be a sub-harmonic
            score *= 0.7;
        }

        // Check if double-tempo also has support (confirms this is the real beat)
        const dblLag = p.lag * 2;
        if (dblLag <= maxLag && corrs[dblLag] > p.corr * 0.3) {
            score *= 1.3;
        }

        if (score > bestScore) {
            bestScore = score;
            bestBPM = p.bpm;
        }
    }

    return bestBPM;
}

export function getTabBPM() {
    if (S.beats.length < 2) return 120;
    // Find average BPM from downbeats (measure > 0)
    const downbeats = S.beats.filter(b => b.measure > 0);
    if (downbeats.length < 2) {
        // Fallback: use all consecutive beats
        let total = 0;
        for (let i = 1; i < Math.min(S.beats.length, 50); i++) {
            total += S.beats[i].time - S.beats[i - 1].time;
        }
        const avgInterval = total / (Math.min(S.beats.length, 50) - 1);
        return 60 / avgInterval;
    }
    // Measure intervals between consecutive downbeats, divide by beats per measure
    let intervals = [];
    for (let i = 1; i < downbeats.length; i++) {
        const dt = downbeats[i].time - downbeats[i - 1].time;
        // Count beats between these downbeats
        const beatsInMeasure = S.beats.filter(
            b => b.time >= downbeats[i - 1].time && b.time < downbeats[i].time
        ).length;
        if (beatsInMeasure > 0) intervals.push(dt / beatsInMeasure);
    }
    if (!intervals.length) return 120;
    const avg = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    return 60 / avg;
}

export function editorSyncTempo() {
    if (!S.audioBuffer || S.beats.length < 2) {
        setStatus('Need audio and beats loaded for sync');
        return;
    }

    setStatus('Detecting audio BPM...');
    syncState.tabBPM = getTabBPM();
    syncState.audioBPM = detectAudioBPM();

    document.getElementById('sync-tab-bpm').textContent = syncState.tabBPM.toFixed(1);
    document.getElementById('sync-audio-bpm').textContent = syncState.audioBPM.toFixed(1);
    document.getElementById('sync-manual-bpm').value = '';
    document.getElementById('sync-offset').value = '0';
    editorSyncUpdateFactor();

    const dlg = document.getElementById('editor-sync-dialog');
    const btn = document.getElementById('editor-sync-btn');
    const rect = btn.getBoundingClientRect();
    dlg.style.left = rect.left + 'px';
    dlg.style.top = (rect.bottom + 4) + 'px';
    dlg.classList.remove('hidden');
    setStatus('Ready');
}

export function editorSyncUpdateFactor() {
    const manual = parseFloat(document.getElementById('sync-manual-bpm').value);
    const audioBPM = manual > 0 ? manual : syncState.audioBPM;
    const factor = audioBPM / syncState.tabBPM;
    document.getElementById('sync-factor').textContent = factor.toFixed(4);
    if (manual > 0) {
        document.getElementById('sync-audio-bpm').textContent = manual.toFixed(1) + ' (manual)';
    } else {
        document.getElementById('sync-audio-bpm').textContent = syncState.audioBPM.toFixed(1);
    }
}

export function editorHideSyncDialog() {
    document.getElementById('editor-sync-dialog').classList.add('hidden');
}

export function editorApplySync() {
    const manual = parseFloat(document.getElementById('sync-manual-bpm').value);
    const audioBPM = manual > 0 ? manual : syncState.audioBPM;
    const factor = audioBPM / syncState.tabBPM;
    const offset = parseFloat(document.getElementById('sync-offset').value) || 0;

    if (factor <= 0 || !isFinite(factor)) return;

    // Build the new grid first: unlocked beats scale, but a locked sync point
    // holds its time through the re-fit and the runs re-space around the locks.
    const oldBeats = S.beats.map(b => ({ ...b }));
    const scaledBeats = S.beats.map(b => ({ ...b, time: b.time / factor + offset }));
    const respaced = _respaceWithLocksPure(oldBeats, scaledBeats);

    // With a lock present the grid warps, so reproject note times from the OLD
    // grid onto the new one (beat is truth), exactly as the TempoMapCmd tempo
    // paths do — a note stays on the grid even right next to a lock. Without a
    // lock _respaceWithLocksPure hands back `scaledBeats` unchanged; keep the
    // plain linear scale there — it is identical to the reproject for a real
    // grid (timeOf∘beatOf round-trips through an affine map) and, unlike the
    // reproject, still scales notes on a degenerate <2-beat grid (where
    // beatOf/timeOf are identity).
    const locked = respaced !== scaledBeats;
    const nn = notes();
    for (const n of nn) {
        if (locked) {
            const t = timeOf(respaced, beatOf(oldBeats, n.time));
            if (n.sustain) {
                const endT = timeOf(respaced, beatOf(oldBeats, n.time + n.sustain));
                n.sustain = Math.max(0, endT - t);
            }
            n.time = t;
        } else {
            n.time = n.time / factor + offset;
            if (n.sustain) n.sustain = n.sustain / factor;
        }
    }

    for (let i = 0; i < S.beats.length; i++) S.beats[i].time = respaced[i].time;

    // Scale section times — like notes, reproject onto the warped grid under a
    // lock (beat is truth) and keep the plain linear scale when unlocked.
    for (const s of S.sections) {
        s.start_time = locked
            ? timeOf(respaced, beatOf(oldBeats, s.start_time))
            : s.start_time / factor + offset;
    }

    editorHideSyncDialog();
    host.draw();
    setStatus(`Tempo synced: scaled ${factor.toFixed(4)}x` + (offset ? `, offset ${offset}s` : ''));
}
