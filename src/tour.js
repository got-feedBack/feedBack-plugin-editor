// Entry-seeded first-run tours (workspace-shell C3, charrette §3.5).
//
// Two ≤4-step, task-based ("do-not-read") tours, seeded by HOW you entered:
//   • Compose (create-from-scratch): place → snap → play → loop.
//   • Transcribe (import): the reframe "the recording never moves — you line the
//     GRID up to it," taught visually via the onset strip. Its "I'll align
//     later" escape drops you into the Compose tour instead.
//
// Skippable and resumable from Help ▸ Editor tour. All state is editor-pref
// (localStorage), never the pack. Steps advance when you DO the task (the tour
// listens on the same action sites) or via the card's Next button — you are
// never stuck. Non-modal: the card never blocks the canvas.

const LS_SEEN = (lane) => `editorTourSeen:${lane}`;   // auto-started once
const LS_STEP = (lane) => `editorTourStep:${lane}`;   // resume point
const LS_DONE = (lane) => `editorTourDone:${lane}`;   // completed at least once
const LS_LAST = 'editorTourLastLane';

function _lsGet(k) { try { return localStorage.getItem(k); } catch (_) { return null; } }
function _lsSet(k, v) { try { localStorage.setItem(k, String(v)); } catch (_) { /* private mode */ } }

// ── Tour definitions (≤4 steps each) ────────────────────────────────
export const TOURS = {
    compose: {
        title: 'Compose',
        steps: [
            { text: 'Double-click the timeline to place a note where the playhead line sits.', advanceOn: 'placeNote' },
            { text: 'Notes snap to the grid — press , or . to make the grid finer or coarser.', advanceOn: 'snapChange' },
            { text: 'Press Space to play back what you have so far.', advanceOn: 'play' },
            { text: 'Drag across the ⇆ bars strip to loop a section while you work.', advanceOn: 'loop' },
        ],
    },
    transcribe: {
        title: 'Transcribe',
        escapeToCompose: true,
        steps: [
            { text: 'The recording never moves — you line the GRID up to it. Turn on Onsets (Shift+W) to see the audio’s attacks.', advanceOn: 'onsets' },
            { text: 'Open Tempo Map (T), then drag the first barline onto the first strong amber onset block.', advanceOn: 'tempoMap' },
            { text: 'Tap the tempo (Shift+B in Tempo Map) so the grid matches the groove.', advanceOn: 'tapTempo' },
            { text: 'Switch snap to Onset — now notes lock to the audio’s attacks, not just the grid.', advanceOn: 'snapOnset' },
        ],
    },
};

// ── State machine (pure-ish; _tourRender is the only DOM touch) ──────
const _tour = { lane: null, step: 0, active: false };
export function _tourState() { return { ..._tour }; }           // test/read only
export function _tourStepsFor(lane) { return (TOURS[lane] || {}).steps || []; }

function _persist() {
    if (_tour.lane) { _lsSet(LS_STEP(_tour.lane), _tour.step); _lsSet(LS_LAST, _tour.lane); }
}

function _tourStart(lane, step) {
    if (!TOURS[lane]) return;
    _tour.lane = lane;
    _tour.step = Math.max(0, Math.min(step | 0, _tourStepsFor(lane).length - 1));
    _tour.active = true;
    _persist();
    _tourRender();
}

// Auto-start on entry (create → compose, import → transcribe) — but only the
// FIRST time for that lane (one-time). Later entries never re-nag.
export function _editorMaybeStartTour(lane) {
    if (!TOURS[lane]) return;
    if (_lsGet(LS_SEEN(lane)) === '1') return;
    _lsSet(LS_SEEN(lane), '1');
    _tourStart(lane, 0);
}

// Help ▸ Editor tour: resume the last lane from its saved step, or restart it
// from the top if it was already completed. Defaults to Compose.
export function editorStartTour() {
    const lane = _lsGet(LS_LAST) || 'compose';
    const done = _lsGet(LS_DONE(lane)) === '1';
    const step = done ? 0 : (parseInt(_lsGet(LS_STEP(lane)) || '0', 10) || 0);
    _lsSet(LS_SEEN(lane), '1');   // Help launch also counts as seen
    _tourStart(lane, step);
}

function _tourComplete() {
    if (_tour.lane) { _lsSet(LS_DONE(_tour.lane), '1'); _lsSet(LS_STEP(_tour.lane), 0); }
    _tour.active = false;
    _tour.step = 0;
    _tourHideCard();
}

export function _tourAdvance() {
    if (!_tour.active) return;
    _tour.step += 1;
    if (_tour.step >= _tourStepsFor(_tour.lane).length) { _tourComplete(); return; }
    _persist();
    _tourRender();
}

// Skip: close the card but keep the resume point (Help can reopen it).
export function editorTourSkip() {
    _tour.active = false;
    _persist();
    _tourHideCard();
}

// Transcribe's "I'll align later" escape → drop into the Compose tour. The
// transcribe tour is marked seen so it never re-nags.
export function editorTourEscape() {
    if (_tour.lane) _lsSet(LS_SEEN(_tour.lane), '1');
    _lsSet(LS_SEEN('compose'), '1');
    _tourStart('compose', 0);
}

// Advance when the user actually DOES the current step's task. Called from the
// instrumented action sites (onset toggle, play, tempo-map entry, tap, snap,
// note placement). No-op unless a tour is active and the action matches.
export function _tourNoteAction(action) {
    if (!_tour.active) return;
    const step = _tourStepsFor(_tour.lane)[_tour.step];
    if (step && step.advanceOn === action) _tourAdvance();
}

// ── DOM ─────────────────────────────────────────────────────────────
function _tourHideCard() {
    const el = document.getElementById('editor-tour');
    if (el) el.classList.add('hidden');
}
function _tourRender() {
    const el = document.getElementById('editor-tour');
    if (!el) return;
    const tour = TOURS[_tour.lane];
    const steps = _tourStepsFor(_tour.lane);
    const step = steps[_tour.step];
    if (!tour || !step) { _tourHideCard(); return; }
    const set = (id, text) => { const n = document.getElementById(id); if (n) n.textContent = text; };
    set('editor-tour-title', tour.title);
    set('editor-tour-count', `${_tour.step + 1}/${steps.length}`);
    set('editor-tour-text', step.text);
    const last = _tour.step + 1 >= steps.length;
    const nextBtn = document.getElementById('editor-tour-next');
    if (nextBtn) nextBtn.textContent = last ? 'Done' : 'Next ›';
    const esc = document.getElementById('editor-tour-escape');
    if (esc) esc.classList.toggle('hidden', !tour.escapeToCompose);
    el.classList.remove('hidden');
}

// Hide (without losing the resume point) when a different song loads — the
// task hints are tied to the song you entered on.
export function _tourResetForLoad() {
    _tour.active = false;
    _tourHideCard();
}
