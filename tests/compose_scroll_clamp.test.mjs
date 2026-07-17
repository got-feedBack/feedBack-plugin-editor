/*
 * Scroll clamp in compose / MIDI-only sessions (src/loop.js).
 *
 * S.duration is only derived from the grid inside startPlayback(), so before
 * the first Play a session with no decoded audio reported duration 0 to
 * _editorClampScrollX — maxScroll clamped to 0 and EVERY horizontal-scroll
 * input (wheel, middle-drag pan, minimap) silently pinned the view to t = 0.
 * "I couldn't scroll left/right on the note view" (tester report), curing
 * itself after the first Play.
 *
 * Pinned here: the clamp falls back to the compose-mode duration rule
 * (grid end / authored content — the same rule playback uses) whenever the
 * audio-derived duration is not positive, and audio-bounded sessions keep
 * their exact old clamp.
 *
 * Run: node tests/compose_scroll_clamp.test.mjs
 */
import assert from 'node:assert';

globalThis.localStorage = globalThis.localStorage || {
    getItem: () => null, setItem: () => {}, removeItem: () => {},
};
globalThis.document = globalThis.document || { getElementById: () => null };

const { _editorClampScrollX } = await import('../src/loop.js');
const { S } = await import('../src/state.js');

let pass = 0, fail = 0;
function t(name, fn) {
    try { fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}

function seed(overrides = {}) {
    Object.assign(S, {
        sessionId: 'sess-1',
        duration: 0, audioShift: 0, audioBuffer: null, composeLength: undefined,
        zoom: 100,               // 100 px/s → ~7.4s viewport at the 800px node fallback
        beats: [], arrangements: [], currentArr: 0,
        drumTab: null, drumEditMode: false, partMix: {},
        ...overrides,
    });
}

t('MIDI-only session, un-played: the grid now bounds scrolling (was pinned to 0)', () => {
    seed({ beats: [{ time: 0 }, { time: 120 }] });   // 2-anchor grid ending at 120s
    const clamped = _editorClampScrollX(60);
    assert.ok(clamped > 0,
        `scrollX must not clamp to 0 when the grid runs to 120s (got ${clamped})`);
    assert.strictEqual(clamped, 60, 'a mid-song scroll passes through untouched');
});

t('authored content past the grid extends the scrollable extent', () => {
    seed({
        beats: [{ time: 0 }, { time: 10 }],
        arrangements: [{ name: 'Lead', notes: [{ time: 90, string: 0, fret: 0 }], chords: [], chord_templates: [] }],
    });
    assert.ok(_editorClampScrollX(60) >= 60,
        'a note at 90s keeps 60s reachable even though the grid ends at 10s');
});

t('a genuinely empty session still clamps to 0 (nothing to scroll to)', () => {
    seed();
    assert.strictEqual(_editorClampScrollX(500), 0);
});

t('audio-bounded sessions keep the old clamp exactly', () => {
    seed({ duration: 200 });
    assert.strictEqual(_editorClampScrollX(100), 100, 'in-range passes through');
    const atEnd = _editorClampScrollX(10000);
    assert.ok(atEnd > 100 && atEnd <= 200 + 15, 'clamps near the song end (plus tail)');
    // The fallback must not RUN for audio-bounded sessions: plant a beats
    // grid longer than the audio and confirm it cannot extend the clamp.
    seed({ duration: 200, beats: [{ time: 0 }, { time: 500 }] });
    assert.strictEqual(_editorClampScrollX(10000), atEnd,
        'audio bounds win — the compose fallback stays dormant');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
