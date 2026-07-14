// Mouse interactions — the canvas pointer event handlers: down/move/up drag &
// selection & inline edits, double-click add, and wheel zoom/scroll. main.js
// wires these onto the canvas in init(); everything they refresh in the
// composition root (draw, add-note dialog, parts-view routing, zoom readout)
// goes through host.

import { _anchorLaneTopY, _handshapeLaneTopY, onAnchorLaneMouseDown, onAnchorLaneMouseMove, onAnchorLaneMouseUp, onHandshapeLaneMouseDown, onHandshapeLaneMouseMove, onHandshapeLaneMouseUp, onToneLaneMouseDown, onToneLaneMouseMove, onToneLaneMouseUp } from './annotation-lanes.js';
import { _auditionPitch, _editBlipAt, _mixDragChangedPitchPure, startPlayback, stopPlayback } from './audio.js';
import { DPR, canvas } from './canvas.js';
import { MoveNoteCmd, ResizeSustainGroupCmd, _rollAddByPitch, _rollDragPitchMove } from './commands.js';
import { hideContextMenu } from './context-menu.js';
import { _beatBarTopY } from './draw.js';
import { _drumEditorOnDragEnd, _drumEditorOnDragMove, _drumEditorOnMouseDown, _drumEditorOnSelectEnd, _drumEditorOnVelocityDragEnd, _drumEditorOnVelocityDragMove } from './drum.js';
import { ANCHOR_LANE_H, HS_LANE_H, LABEL_W, LANE_H, MINIMAP_H, TIMELINE_TOP, TONE_LANE_H, WAVEFORM_H, strToY, timeToX, xToTime, yToStr } from './geometry.js';
import { hitNote, hitNoteEdge } from './hit-test.js';
import { PIANO_LANE_H, _inKeyboardGutterPure, _rollMidiForNote, _rollPitchCtx, _rollReadOnly, isKeysArr, isKeysMode, midiToFret, midiToString, midiToY, noteToMidi, pianoLaneCount, yToMidi } from './keys.js';
import { LC, laneToStr, lanes, strToLane } from './lanes.js';
import { _downbeatTimes, _editorClampScrollX, _groupTimeDeltaPure, _loopLiveMode, _loopRegionForDragPure, _setBarSel, magneticSnapTime, snapTime } from './loop.js';
import { _recState } from './midi-record.js';
import { _resizeSustainsForDeltaPure, _resizeTargetIndicesPure, notes } from './notes.js';
import { _rulerZonePure, rulerOnMouseDown, rulerOnMouseMove, rulerOnMouseUp } from './ruler.js';
import { S } from './state.js';
import { _tempoBeatOnDragMove, _tempoMapOnDragEnd, _tempoMapOnDragMove, _tempoMapOnMouseDown, _tempoMarqueeOnEnd, _tempoSyncAtX } from './tempo.js';
import { setStatus } from './ui.js';
import { host } from './host.js';

export function getMousePos(e) {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
}

export function onMouseDown(e) {
    const { x, y } = getMousePos(e);
    hideContextMenu();
    host.hideAddNote();

    // Middle button = pan
    if (e.button === 1) {
        e.preventDefault();
        S.drag = { type: 'pan', startX: x, origScroll: S.scrollX };
        return;
    }

    // Right button = context menu (handled in onContextMenu)
    if (e.button === 2) return;

    // Timeline header — the B3 minimap + ruler own everything above the
    // waveform in EVERY mode (the old loop strip was mode-independent DOM;
    // the ruler keeps that): minimap pans, ruler upper half paints loops /
    // drags edges, lower half scrubs.
    if (y < TIMELINE_TOP) {
        if (rulerOnMouseDown(e, x, y, canvas ? canvas.width / DPR : 0)) return;
    }

    // Drum-edit mode hijacks the left click so the lane-grid editor can
    // add/remove/select hits without going through the guitar-arrangement
    // click pipeline below (which would crash on a missing
    // S.arrangements[currentArr]).
    if (S.drumEditMode && S.drumTab) {
        _drumEditorOnMouseDown(e, x, y);
        return;
    }

    // Tempo Map mode hijacks the left click for sync-point editing.
    if (S.tempoMapMode) {
        _tempoMapOnMouseDown(e, x, y);
        return;
    }

    // Parts view owns the click: waveform seeks, lanes arm a part.
    if (S.partsViewMode) {
        host.partsViewOnMouseDown(e, x, y);
        return;
    }

    // Keyboard gutter (keys/piano view): a click in the left key column
    // auditions that row's pitch — no selection, no edit. Left button only so
    // right-click still opens the context menu. Ignored in String view (the
    // gutter shows string labels there, not keys).
    if (e.button === 0 && isKeysMode()) {
        const laneTop = TIMELINE_TOP + WAVEFORM_H;
        const laneBottom = laneTop + pianoLaneCount() * PIANO_LANE_H;
        if (_inKeyboardGutterPure(x, y, LABEL_W, laneTop, laneBottom)) {
            _auditionPitch(yToMidi(y));
            return;
        }
    }

    // Tone lane overlays the waveform's top edge (below the timeline
    // header). Hijack the click before the waveform-seek handler so
    // add/move/select-marker interactions work.
    if (y >= TIMELINE_TOP && y < TIMELINE_TOP + TONE_LANE_H && S.arrangements && S.arrangements.length) {
        if (onToneLaneMouseDown(e, x)) return;
    }
    // Anchor lane sits below the beat bar.
    if (S.arrangements && S.arrangements.length) {
        const anchorTop = _anchorLaneTopY();
        if (y >= anchorTop && y < anchorTop + ANCHOR_LANE_H) {
            if (onAnchorLaneMouseDown(e, x, y)) return;
        }
    }
    // Handshape lane sits directly below the anchor lane.
    if (S.arrangements && S.arrangements.length) {
        const hsTop = _handshapeLaneTopY();
        if (y >= hsTop && y < hsTop + HS_LANE_H) {
            if (onHandshapeLaneMouseDown(e, x, y)) return;
        }
    }
    // Click outside the tone lane → clear the tone selection so the
    // next Del press targets the note path instead of the previously
    // selected tone marker.
    if (S.toneSel !== null) {
        S.toneSel = null;
        // No explicit `host.draw()` here — the surrounding mouse-down path
        // already triggers one for the new interaction.
    }
    // Same story for anchor selection — a stale `S.anchorSel` would
    // otherwise hijack the next Del press from the note delete path.
    if (S.anchorSel !== null) {
        S.anchorSel = null;
    }
    // …and the handshape selection (the handshape-lane mousedown returns
    // early, so a click reaching here is outside that lane).
    if (S.handshapeSel !== null) {
        S.handshapeSel = null;
    }

    // Left button
    if (y < TIMELINE_TOP + WAVEFORM_H) {
        // Block waveform seek while recording: restarting the AudioBufferSourceNode
        // would fire onended and prematurely finalize the take.
        if (_recState === 'recording') return;
        // Click on waveform = set cursor
        S.cursorTime = Math.max(0, xToTime(x));
        if (S.playing) { stopPlayback(); startPlayback(); }
        host.draw();
        return;
    }

    // Block note editing while recording: mid-take edits to arr.notes would be
    // silently overwritten by _recNotes when the take is finalized on Stop.
    if (_recState === 'recording') return;

    // Check for sustain edge grab first. Edge-drag sustain resize is a DURATION
    // edit — it changes only how long a note rings, never its pitch — so it
    // applies directly even in the read-only fretted roll (V4): the resize
    // commands are pitchPreserving and pass the edit lock, so grabbing an edge
    // is allowed here (unlike a pitch/position write). Resize mutates sustains
    // LIVE during the drag (before any command); the commit is pitchPreserving.
    const edgeIdx = hitNoteEdge(x, y);
    if (edgeIdx >= 0) {
        const nn = notes();
        const resizeIndices = _resizeTargetIndicesPure(nn, edgeIdx, !isKeysArr() && !e.altKey);
        const allResizeSelected = resizeIndices.every(i => S.sel.has(i));
        if (!allResizeSelected) {
            S.sel.clear();
            for (const i of resizeIndices) S.sel.add(i);
        }
        S.drag = {
            type: 'resize',
            noteIdx: edgeIdx,
            indices: resizeIndices,
            startX: x,
            origSustains: resizeIndices.map(i => nn[i].sustain || 0),
        };
        host.draw();
        return;
    }

    const idx = hitNote(x, y);

    if (idx >= 0) {
        // Click on note — also select all chord siblings (same time).
        // In keys DATA same-timestamp notes are independent voices (not
        // a strummed chord), so skip the sibling expansion. Keyed on the
        // data kind, not the surface: a fretted part in the roll still
        // groups its chords.
        const nn = notes();
        const clickedTime = nn[idx].time;
        const chordSiblings = [idx];
        if (!isKeysArr()) {
            for (let i = 0; i < nn.length; i++) {
                if (i !== idx && Math.abs(nn[i].time - clickedTime) < 0.001) chordSiblings.push(i);
            }
        }

        if (e.shiftKey) {
            // Multi-select toggle — toggle the whole chord group
            const allSelected = chordSiblings.every(i => S.sel.has(i));
            for (const i of chordSiblings) {
                if (allSelected) S.sel.delete(i); else S.sel.add(i);
            }
        } else if (!S.sel.has(idx)) {
            S.sel.clear();
            for (const i of chordSiblings) S.sel.add(i);
        }

        // Start the move drag. In the read-only fretted roll (VA.3) this is the
        // pitch-move: the live drag repicks {string,fret} through the resolver
        // (onMouseMove's move branch → _rollDragPitchMove) and commits as a
        // suggested-marked, lock-passing MoveNoteCmd.
        const selArr = [...S.sel];
        S.drag = {
            type: 'move',
            startX: x, startY: y,
            // The grabbed note's original time anchors the group snap so the
            // whole selection moves as a rigid unit (see _groupTimeDeltaPure).
            primaryOrigTime: nn[idx].time,
            origTimes: selArr.map(i => nn[i].time),
            origStrings: selArr.map(i => nn[i].string),
            origFrets: selArr.map(i => nn[i].fret),
            indices: selArr,
            moved: false,
        };
        host.draw();
    } else {
        // Click on empty space = start selection rect or deselect
        if (!e.shiftKey) S.sel.clear();
        S.drag = {
            type: 'select',
            startX: x, startY: y,
            curX: x, curY: y,
        };
        host.draw();
    }
}

export function onMouseMove(e) {
    const { x, y } = getMousePos(e);
    // Activate the lane cache for the handler's lifetime so per-note
    // hit-test helpers (`hitNoteEdge` / `hitNote` → `strToY` →
    // `strToLane` → `lanes()`) stay O(1) per note instead of O(N).
    // A local `const L = lanes()` alone doesn't help those nested
    // calls; the global cache does. Cleared in `finally` so any
    // exception unwinding the handler doesn't leak the flag.
    const _prevActive = LC.active;
    const _prevValue = LC.value;
    LC.active = false;
    LC.value = lanes();
    const L = LC.value;
    LC.active = true;
    try {
        _onMouseMoveBody(e, x, y, L);
    } finally {
        LC.active = _prevActive;
        LC.value = _prevValue;
    }
}

function _onMouseMoveBody(e, x, y, L) {

    if (rulerOnMouseMove(e, x, canvas ? canvas.width / DPR : 0)) return;

    // Loop-create drag on the ruler — re-resolve the span to the cursor,
    // mode-aware (bar/grid/free per the loop snap pref; Shift = Free, live).
    if (S.drag && S.drag.type === 'barsel') {
        const mode = _loopLiveMode(e.shiftKey);
        const t1 = xToTime(x);
        _setBarSel(_loopRegionForDragPure(
            mode, S.drag.startTime, t1, _downbeatTimes(),
            S.duration || Math.max(S.drag.startTime, t1), snapTime));
        host.draw();
        return;
    }

    // Tone-marker drag — hijack before any of the existing
    // drag-handler branches so the marker tracks the cursor.
    if (S.drag && S.drag.type === 'tone') {
        onToneLaneMouseMove(e, x);
        return;
    }
    if (S.drag && S.drag.type === 'anchor') {
        onAnchorLaneMouseMove(e, x);
        return;
    }
    if (S.drag && S.drag.type === 'handshape') {
        onHandshapeLaneMouseMove(e, x);
        return;
    }

    // Cursor hint when not dragging
    if (!S.drag) {
        // In drum-edit mode the guitar/keys hover logic (hitNoteEdge) is
        // irrelevant and shows misleading resize cursors over the drum grid.
        if (S.drumEditMode && S.drumTab) {
            if (canvas) canvas.style.cursor = '';
            return;
        }
        // Tempo-map mode: highlight the sync-point pole under the cursor.
        if (S.tempoMapMode) {
            const hit = _tempoSyncAtX(x, y);
            if (hit !== S.tempoHover) { S.tempoHover = hit; host.draw(); }
            if (canvas) canvas.style.cursor = hit >= 0 ? 'ew-resize' : '';
            return;
        }
        // Timeline header → signal the zone: loop half selects (col-resize),
        // minimap and scrub half seek/pan (pointer).
        if (canvas && y < TIMELINE_TOP) {
            const zone = _rulerZonePure(y, MINIMAP_H, TIMELINE_TOP);
            canvas.style.cursor = zone === 'loop' ? 'col-resize' : 'pointer';
        } else if (canvas && y >= TIMELINE_TOP + WAVEFORM_H && y < _beatBarTopY()) {
            // The note area runs from the waveform strip down to the beat bar in
            // BOTH views — `_beatBarTopY()` already accounts for the roll's
            // pianoLaneCount * PIANO_LANE_H. The old `WAVEFORM_H + L * LANE_H`
            // bound was the fretted lane band, so the resize cursor never showed
            // in the roll even though the grab itself is allowed there (V4).
            canvas.style.cursor = hitNoteEdge(x, y) >= 0 ? 'ew-resize' : '';
        } else if (canvas) {
            canvas.style.cursor = '';
        }
        return;
    }

    if (S.drag.type === 'pan') {
        const dx = x - S.drag.startX;
        S.scrollX = _editorClampScrollX(S.drag.origScroll - dx / S.zoom);
        host.draw();
        return;
    }

    // Drum-edit drag: move every selected hit in time and lane in lockstep.
    if (S.drag.type === 'drum-move') {
        _drumEditorOnDragMove(x, y);
        host.draw();
        return;
    }

    // Drum velocity drag (Alt+drag): vertical drift edits the selection's
    // velocity live — the render brightness/height tracks it as feedback.
    if (S.drag.type === 'drum-velocity') {
        _drumEditorOnVelocityDragMove(y);
        host.draw();
        return;
    }

    // Drum-edit marquee: track the rubber-band rect; flip `moved` once the
    // pointer has left the click threshold so mouseup knows it's a box
    // select rather than an add-hit click.
    if (S.drag.type === 'drum-select') {
        S.drag.curX = x;
        S.drag.curY = y;
        // Euclidean threshold so a diagonal drag (e.g. dx=dy=2.5, ~3.5px)
        // counts as a marquee, not a click — a per-axis check would miss it.
        const ddx = x - S.drag.startX;
        const ddy = y - S.drag.startY;
        if (ddx * ddx + ddy * ddy > 9) S.drag.moved = true;
        host.draw();
        return;
    }

    // Tempo-map drag: re-space the two measures around the dragged pole.
    // A group drag (a multi-selection grabbed by one of its poles) and a
    // tempo-zone boundary drag (P2-3 confirm bar) both ride the same handler —
    // it dispatches on S.drag.type internally. The boundary drag only reshapes
    // the transient proposal; the other two move the grid.
    if (S.drag.type === 'tempo-sync' || S.drag.type === 'tempo-group'
        || S.drag.type === 'segment-boundary') {
        _tempoMapOnDragMove(x);
        return;
    }

    // Tempo-map per-beat rubato drag: re-time one beat inside its measure.
    if (S.drag.type === 'tempo-beat') {
        _tempoBeatOnDragMove(x);
        return;
    }

    // Tempo-map barline marquee (PR 5a): rubber-band box-select of downbeats.
    // Same deferred 3px `moved` idiom as the drum-editor marquee above.
    if (S.drag.type === 'tempo-marquee') {
        S.drag.curX = x;
        S.drag.curY = y;
        const ddx = x - S.drag.startX, ddy = y - S.drag.startY;
        if (ddx * ddx + ddy * ddy > 9) S.drag.moved = true;
        host.draw();
        return;
    }

    if (S.drag.type === 'select') {
        S.drag.curX = x;
        S.drag.curY = y;
        host.draw();
        return;
    }

    if (S.drag.type === 'resize') {
        const dtRaw = (x - S.drag.startX) / S.zoom;
        const nn = notes();
        // The grabbed note's END edge is the magnetic target (the piano-roll
        // model: EDGES snap to the current-subdivision guidelines — magnetic,
        // never locking); every other note in the resize group takes the SAME
        // effective delta so the group's relative lengths hold, mirroring the
        // move drag's primary-once rule. Alt = fully free, as for moves.
        let dt = dtRaw;
        if (!e.altKey) {
            const pi = S.drag.indices.indexOf(S.drag.noteIdx);
            const grabbed = nn[S.drag.noteIdx];
            if (grabbed && pi >= 0) {
                const end0 = grabbed.time + (S.drag.origSustains[pi] || 0);
                dt = magneticSnapTime(end0 + dtRaw) - end0;
            }
        }
        const nextSustains = _resizeSustainsForDeltaPure(
            nn, S.drag.indices, S.drag.origSustains, dt);
        for (let i = 0; i < S.drag.indices.length; i++) {
            nn[S.drag.indices[i]].sustain = nextSustains[i];
        }
        host.draw();
        return;
    }

    if (S.drag.type === 'move') {
        S.drag.moved = true;
        const nn = notes();
        const dtRaw = (x - S.drag.startX) / S.zoom;
        const dy = y - S.drag.startY;
        // One snapped time delta for the WHOLE selection (see _groupTimeDeltaPure):
        // snap the grabbed note once and move every selected note by the SAME
        // delta, so the group stays rigid and small drags move all of it — not
        // just the notes that happened to sit near a grid line.
        //
        // MAGNETIC, not locking (the design call, matching the Logic/Ableton
        // piano-roll feel): the grabbed note's target sticks to a guideline
        // while inside a small zoom-aware magnet radius, and pulling PAST the
        // magnet releases it — minor off-grid adjustments need no modifier.
        // Alt still means fully free from the first pixel. Only the time grid
        // is bypassed either way — vertical stays semitone/string-quantized
        // (no between-pitch notes), like every DAW.
        const snapFn = e.altKey ? (t => t) : magneticSnapTime;
        const snappedDt = _groupTimeDeltaPure(
            S.drag.origTimes, S.drag.primaryOrigTime, dtRaw, snapFn);

        if (_rollReadOnly()) {
            // Fretted part in the roll (VA.3): vertical drag = re-pitch through
            // the resolver; the commit marks moved notes suggested.
            _rollDragPitchMove(nn, snappedDt, dy);
        } else if (isKeysMode()) {
            const dMidi = -Math.round(dy / PIANO_LANE_H);
            for (let i = 0; i < S.drag.indices.length; i++) {
                const ni = S.drag.indices[i];
                nn[ni].time = S.drag.origTimes[i] + snappedDt;

                const origMidi = noteToMidi(S.drag.origStrings[i], S.drag.origFrets[i]);
                const newMidi = Math.max(0, Math.min(143, origMidi + dMidi));
                nn[ni].string = midiToString(newMidi);
                nn[ni].fret = midiToFret(newMidi);
            }
        } else {
            const dLanes = Math.round(dy / LANE_H);
            for (let i = 0; i < S.drag.indices.length; i++) {
                const ni = S.drag.indices[i];
                nn[ni].time = S.drag.origTimes[i] + snappedDt;

                const origLane = strToLane(S.drag.origStrings[i]);
                // Reuse the locally-cached `L` from onMouseMove instead of
                // calling lanes() per dragged note.
                const newLane = Math.max(0, Math.min(L - 1, origLane + dLanes));
                nn[ni].string = laneToStr(newLane);
            }
        }
        host.draw();
    }
}

export function onMouseUp(e) {
    if (!S.drag) return;
    if (rulerOnMouseUp()) return;
    const { y } = getMousePos(e);

    // Bar-range select finalise — refresh the Loop-in-3D button state.
    if (S.drag.type === 'barsel') {
        S.drag = null;
        host.updateLoopIn3DBtn();
        host.draw();
        return;
    }

    // Drum-edit drag finalise: routes the completed move through
    // MoveDrumHitsCmd (revert-then-exec), which owns the sort + selection
    // remap, so drum moves undo/redo like note moves.
    if (S.drag.type === 'drum-move') {
        _drumEditorOnDragEnd();
        return;
    }

    if (S.drag.type === 'drum-velocity') {
        _drumEditorOnVelocityDragEnd();
        return;
    }

    if (S.drag.type === 'drum-select') {
        _drumEditorOnSelectEnd();
        return;
    }

    if (S.drag.type === 'tempo-sync' || S.drag.type === 'tempo-beat' || S.drag.type === 'tempo-group') {
        _tempoMapOnDragEnd();
        return;
    }

    // A tempo-zone boundary drag is pre-commit: the proposal already holds the
    // dragged shape, there is nothing to finalize — just release the drag.
    if (S.drag.type === 'segment-boundary') {
        S.drag = null;
        return;
    }

    if (S.drag.type === 'tempo-marquee') {
        _tempoMarqueeOnEnd();
        return;
    }

    if (S.drag.type === 'tone') {
        onToneLaneMouseUp();
        return;
    }

    if (S.drag.type === 'anchor') {
        onAnchorLaneMouseUp();
        return;
    }

    if (S.drag.type === 'handshape') {
        onHandshapeLaneMouseUp();
        return;
    }

    if (S.drag.type === 'resize') {
        const nn = notes();
        const finalSustains = S.drag.indices.map(i => nn[i].sustain || 0);
        // Revert so the command can apply the grouped edit as one undo step.
        for (let i = 0; i < S.drag.indices.length; i++) {
            nn[S.drag.indices[i]].sustain = S.drag.origSustains[i];
        }
        const changed = finalSustains.some((v, i) => v !== S.drag.origSustains[i]);
        if (changed) {
            S.history.exec(new ResizeSustainGroupCmd(S.drag.indices, finalSustains));
        }
    }

    if (S.drag.type === 'move' && S.drag.moved) {
        // Commit move as undo command
        const nn = notes();
        const rollFretted = _rollReadOnly();
        const dtimes = S.drag.indices.map((ni, i) => nn[ni].time - S.drag.origTimes[i]);
        const dstrings = S.drag.indices.map((ni, i) => nn[ni].string - S.drag.origStrings[i]);
        const dfrets = isKeysMode()
            ? S.drag.indices.map((ni, i) => nn[ni].fret - S.drag.origFrets[i])
            : null;

        // Revert to original first so exec() applies the delta
        for (let i = 0; i < S.drag.indices.length; i++) {
            nn[S.drag.indices[i]].time = S.drag.origTimes[i];
            nn[S.drag.indices[i]].string = S.drag.origStrings[i];
            if (dfrets) nn[S.drag.indices[i]].fret = S.drag.origFrets[i];
        }
        const cmd = new MoveNoteCmd(S.drag.indices, dtimes, dstrings, dfrets);
        if (rollFretted) {
            // VA.3: the sanctioned suggest-position writer passes the read-only
            // lock; notes the resolver actually repicked (string/fret changed —
            // not a pure time nudge or a held/locked note) are marked suggested.
            cmd.suggestResolved = true;
            cmd.markSuggestedIdx = S.drag.indices.filter((ni, i) => dstrings[i] !== 0 || (dfrets && dfrets[i] !== 0));
        }
        S.history.exec(cmd);
        if (_mixDragChangedPitchPure(dstrings, dfrets)) _editBlipAt();
        // Refusal hint: a vertical drag that repitched nothing means every frame
        // was refused (ambiguous / outside the hand window / occupied / locked).
        if (rollFretted && (!cmd.markSuggestedIdx || !cmd.markSuggestedIdx.length)
            && Math.abs(y - S.drag.startY) >= PIANO_LANE_H) {
            setStatus('Couldn’t repitch here — hand position or a locked technique blocks it. Try String view or add an anchor.');
        }
    }

    if (S.drag.type === 'select') {
        // Select notes inside rectangle
        const x1 = Math.min(S.drag.startX, S.drag.curX);
        const y1 = Math.min(S.drag.startY, S.drag.curY);
        const x2 = Math.max(S.drag.startX, S.drag.curX);
        const y2 = Math.max(S.drag.startY, S.drag.curY);

        const nn = notes();
        const keysMode = isKeysMode();
        const rctx = keysMode ? _rollPitchCtx() : null;
        for (let i = 0; i < nn.length; i++) {
            const nx = timeToX(nn[i].time);
            let ny;
            if (keysMode) {
                const midi = _rollMidiForNote(nn[i], rctx);
                if (midi === null) continue;
                ny = midiToY(midi) + PIANO_LANE_H / 2;
            } else {
                ny = strToY(nn[i].string) + LANE_H / 2;
            }
            if (nx >= x1 && nx <= x2 && ny >= y1 && ny <= y2) {
                S.sel.add(i);
            }
        }
    }

    S.drag = null;
    host.draw();
    host.updateStatus();
}

export function onDblClick(e) {
    // Parts view: double-click opens the lane's focus editor.
    if (S.partsViewMode) { host.partsViewOnDblClick(e); return; }
    if (S.drumEditMode || S.tempoMapMode) return;  // those modes own canvas interaction
    if (_recState === 'recording') return;  // block note addition during active take
    const { x, y } = getMousePos(e);
    const keysMode = isKeysMode();
    const laneTop = TIMELINE_TOP + WAVEFORM_H;
    const laneBottom = laneTop + (keysMode
        ? pianoLaneCount() * PIANO_LANE_H
        : lanes() * LANE_H);
    if (y < laneTop || y > laneBottom) return;

    // The keyboard gutter (keys/piano view) is audition-only — see onMouseDown.
    // A double-click there must NOT open the Add Note dialog; the gutter never
    // adds or selects a note. String view has no key gutter, so this is scoped
    // to keys mode where laneBottom already equals the gutter's lower edge.
    if (keysMode && _inKeyboardGutterPure(x, y, LABEL_W, laneTop, laneBottom)) return;

    const idx = hitNote(x, y);
    if (idx >= 0) return; // double-click on existing note = no-op

    const t = snapTime(Math.max(0, xToTime(x)));

    // Suggest-position write path (VA.3): a FRETTED part in the piano roll adds
    // by SOUNDING pitch — the resolver picks the string/fret (marked suggested),
    // or the confirm popover asks when the choice is genuinely ambiguous. No
    // silent guess, no view switch. Real keys parts keep the pitch dialog below.
    if (_rollReadOnly()) {
        _rollAddByPitch(yToMidi(y), t, e.clientX, e.clientY);
        return;
    }

    // Show add-note dialog
    if (keysMode) {
        const midi = yToMidi(y);
        host.showAddNote(e.clientX, e.clientY, t, midiToString(midi), midiToFret(midi));
    } else {
        const s = yToStr(y);
        host.showAddNote(e.clientX, e.clientY, t, s);
    }
}

export function onWheel(e) {
    e.preventDefault();
    if (e.ctrlKey) {
        // Ctrl+scroll = zoom
        const { x } = getMousePos(e);
        const timeBefore = xToTime(x);
        const factor = e.deltaY < 0 ? 1.15 : 0.87;
        S.zoom = Math.max(20, Math.min(2000, S.zoom * factor));
        // Keep the time under cursor stable
        S.scrollX = timeBefore - (x - LABEL_W) / S.zoom;
        S.scrollX = _editorClampScrollX(S.scrollX);
    } else {
        // Scroll = pan
        S.scrollX = _editorClampScrollX(S.scrollX + e.deltaY / S.zoom * 2);
    }
    host.updateZoomDisplay();
    host.draw();
}

