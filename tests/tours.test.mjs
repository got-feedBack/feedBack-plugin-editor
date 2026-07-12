/*
 * Entry-seeded first-run tours (workspace-shell C3) — the state machine.
 *
 * Covers: one-time auto-start, step advance (via Next and via the matching
 * task action), completion, skip-keeps-resume, Help resume/replay, and the
 * Transcribe "I'll align later" escape into the Compose tour.
 *
 * Run: node tests/tours.test.mjs
 */
import assert from 'node:assert';

const _store = new Map();
globalThis.localStorage = {
    getItem: (k) => (_store.has(k) ? _store.get(k) : null),
    setItem: (k, v) => _store.set(k, String(v)),
    removeItem: (k) => _store.delete(k),
    clear: () => _store.clear(),
};
function mkEl() {
    const el = { textContent: '', _c: new Set(['hidden']) };
    el.classList = {
        add: (...cs) => cs.forEach((c) => el._c.add(c)),
        remove: (...cs) => cs.forEach((c) => el._c.delete(c)),
        toggle: (c, on) => { on ? el._c.add(c) : el._c.delete(c); },
        contains: (c) => el._c.has(c),
    };
    return el;
}
const _els = {};
globalThis.document = { getElementById: (id) => (_els[id] || (_els[id] = mkEl())) };

const {
    _editorMaybeStartTour, _tourAdvance, _tourNoteAction, _tourState, _tourStepsFor,
    _tourResetForLoad, editorStartTour, editorTourSkip, editorTourEscape,
} = await import('../src/tour.js');

let pass = 0, fail = 0;
function t(name, fn) {
    try { fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}
function reset() { _store.clear(); _tourResetForLoad(); }

t('auto-start fires once per lane, then never re-nags', () => {
    reset();
    _editorMaybeStartTour('compose');
    let s = _tourState();
    assert.ok(s.active && s.lane === 'compose' && s.step === 0);
    editorTourSkip();
    _editorMaybeStartTour('compose');
    assert.strictEqual(_tourState().active, false, 'seen ⇒ no auto-restart');
});

t('advance walks the steps, then completes (done + inactive)', () => {
    reset();
    _editorMaybeStartTour('compose');
    const n = _tourStepsFor('compose').length;
    for (let i = 0; i < n - 1; i++) {
        _tourAdvance();
        assert.strictEqual(_tourState().step, i + 1);
        assert.ok(_tourState().active);
    }
    _tourAdvance();                                   // past the last step
    assert.strictEqual(_tourState().active, false);
    assert.strictEqual(localStorage.getItem('editorTourDone:compose'), '1');
});

t('a task action advances only when it matches the current step', () => {
    reset();
    _editorMaybeStartTour('compose');                 // step 0 → advanceOn 'placeNote'
    _tourNoteAction('play');
    assert.strictEqual(_tourState().step, 0, 'wrong task: no advance');
    _tourNoteAction('placeNote');
    assert.strictEqual(_tourState().step, 1, 'right task: advance');
    // and it is inert when no tour is active
    editorTourSkip();
    const before = _tourState().step;
    _tourNoteAction('snapChange');
    assert.strictEqual(_tourState().step, before);
});

t('skip keeps the resume point; Help resumes there', () => {
    reset();
    _editorMaybeStartTour('compose');
    _tourAdvance(); _tourAdvance();                    // → step 2
    editorTourSkip();
    assert.ok(!_tourState().active);
    assert.strictEqual(localStorage.getItem('editorTourStep:compose'), '2');
    editorStartTour();
    assert.ok(_tourState().active && _tourState().step === 2);
});

t('Help replays a completed tour from the top', () => {
    reset();
    _editorMaybeStartTour('compose');
    for (let i = 0, n = _tourStepsFor('compose').length; i < n; i++) _tourAdvance();
    assert.strictEqual(localStorage.getItem('editorTourDone:compose'), '1');
    editorStartTour();
    assert.ok(_tourState().active && _tourState().step === 0);
});

t('the Transcribe "I\'ll align later" escape drops into the Compose tour', () => {
    reset();
    _editorMaybeStartTour('transcribe');
    assert.strictEqual(_tourState().lane, 'transcribe');
    editorTourEscape();
    const s = _tourState();
    assert.ok(s.active && s.lane === 'compose' && s.step === 0);
    assert.strictEqual(localStorage.getItem('editorTourSeen:transcribe'), '1', 'transcribe never re-nags');
    assert.strictEqual(localStorage.getItem('editorTourSeen:compose'), '1', 'compose escape entry is seen');
    for (let i = 0, n = _tourStepsFor('compose').length; i < n; i++) _tourAdvance();
    assert.strictEqual(localStorage.getItem('editorTourDone:compose'), '1');
    _tourResetForLoad();
    _editorMaybeStartTour('compose');
    assert.strictEqual(_tourState().active, false, 'create entry must not auto-restart Compose');
});

t('a fresh song load closes the card but keeps the resume point', () => {
    reset();
    _editorMaybeStartTour('compose');
    _tourAdvance();                                    // → step 1
    _tourResetForLoad();
    assert.ok(!_tourState().active);
    assert.strictEqual(localStorage.getItem('editorTourStep:compose'), '1');
});

t('both tours are ≤4 task-based steps', () => {
    for (const lane of ['compose', 'transcribe']) {
        const steps = _tourStepsFor(lane);
        assert.ok(steps.length >= 1 && steps.length <= 4, `${lane} is ≤4 steps`);
        for (const s of steps) assert.ok(s.text && s.advanceOn, `${lane} step has text + a task`);
    }
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
