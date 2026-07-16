/*
 * Tracks UI geometry + markup pures (src/track-session.js): the lane
 * heights/layout/density/drop-placement/rename-markup that the header
 * column AND the canvas lanes share, so the two surfaces line up 1:1.
 *
 * These are the pure, DOM-free core of the unified Tracks area; the
 * delegated wiring is exercised through the app, not here.
 *
 * Run: node tests/track_session_ui.test.mjs
 */
import assert from 'node:assert';

const {
    _trackSessionLaneHeightPure, _trackSessionDensityPure, _trackSessionFittedHeightsPure,
    _trackSessionLaneLayoutPure, _trackSessionDropPlacementPure, _trackRenameEditorMarkupPure,
    _trackSessionRetargetPure, _trackLinksRetargetPure, _trackFocusSourcePure,
} = await import('../src/track-session.js');

let pass = 0, fail = 0;
const tests = [];
const t = (name, fn) => tests.push([name, fn]);

t('lane height clamps to the readable range and defaults the unset', () => {
    assert.strictEqual(_trackSessionLaneHeightPure({}, 'missing'), 56, 'default');
    assert.strictEqual(_trackSessionLaneHeightPure({ a: 999 }, 'a'), 160, 'clamp high');
    assert.strictEqual(_trackSessionLaneHeightPure({ a: 5 }, 'a'), 28, 'clamp low');
    assert.strictEqual(_trackSessionLaneHeightPure({ a: 72.4 }, 'a'), 72, 'rounds');
});

t('density breakpoints track the header width', () => {
    assert.strictEqual(_trackSessionDensityPure(176), 'compact');
    assert.strictEqual(_trackSessionDensityPure(229), 'compact');
    assert.strictEqual(_trackSessionDensityPure(230), 'normal');
    assert.strictEqual(_trackSessionDensityPure(399), 'normal');
    assert.strictEqual(_trackSessionDensityPure(400), 'wide');
});

t('tall areas auto-fit rows modestly and never shrink below authored', () => {
    assert.deepStrictEqual(_trackSessionFittedHeightsPure([{ id: 'a' }, { id: 'b' }], {}, 300),
        { a: 88, b: 88 }, 'bonus caps at 32 over the 56 default');
    assert.deepStrictEqual(_trackSessionFittedHeightsPure([{ id: 'a' }, { id: 'b' }], { a: 80, b: 40 }, 140),
        { a: 90, b: 50 }, 'spare split evenly');
    assert.deepStrictEqual(_trackSessionFittedHeightsPure([{ id: 'a' }, { id: 'b' }], { a: 80, b: 40 }, 100),
        { a: 80, b: 40 }, 'no spare → authored heights untouched');
});

t('one lane layout drives matching header and canvas geometry', () => {
    const { lanes, contentHeight } = _trackSessionLaneLayoutPure(
        [{ id: 'audio:master' }, { id: 'folder:1' }, { id: 'transcription:guitar' }],
        { 'folder:1': 32, 'transcription:guitar': 90 }, 20, 40);
    assert.deepStrictEqual(lanes.map(l => [l.row.id, l.y, l.h]), [
        ['audio:master', 20, 56],       // 40 top − 20 scroll
        ['folder:1', 76, 32],
        ['transcription:guitar', 108, 90],
    ]);
    assert.strictEqual(contentHeight, 178, '56 + 32 + 90');
});

t('drop placement: folders accept inside their middle band; else split at the midline', () => {
    assert.strictEqual(_trackSessionDropPlacementPure(102, 100, 40, false), 'before');
    assert.strictEqual(_trackSessionDropPlacementPure(138, 100, 40, false), 'after');
    assert.strictEqual(_trackSessionDropPlacementPure(120, 100, 40, true), 'inside', 'folder mid-band');
    assert.strictEqual(_trackSessionDropPlacementPure(104, 100, 40, true), 'before', 'folder top → before');
});

t('rename markup builds a prefilled, drag-safe inline editor and escapes the name', () => {
    const html = _trackRenameEditorMarkupPure('audio:stem:0', 'Drums & Percussion');
    assert.match(html, /data-track-rename-input/);
    assert.match(html, /editor-track-inline-rename/);
    assert.match(html, /draggable="false"/);
    assert.match(html, /Drums &amp; Percussion/, 'HTML-escaped');
    assert.doesNotMatch(html, /rename-save|rename-cancel/, 'keyboard-commit — no buttons');
});

t('renaming a name-keyed transcription preserves its tree position and pairing', () => {
    const session = { tracks: [
        { id: 'folder:1', type: 'folder', name: 'Charts' },
        { id: 'transcription:Lead', type: 'transcription', targetId: 'Lead', parentId: 'folder:1' },
    ] };
    const next = _trackSessionRetargetPure(session, 'Lead', 'Lead Guitar');
    assert.deepStrictEqual(next.tracks[1], {
        id: 'transcription:Lead Guitar', type: 'transcription', targetId: 'Lead Guitar', parentId: 'folder:1',
    });
    assert.deepStrictEqual(_trackLinksRetargetPure({ Lead: 'Guitar_L', Bass: 'Bass' }, 'Lead', 'Lead Guitar'),
        { 'Lead Guitar': 'Guitar_L', Bass: 'Bass' });
    assert.deepStrictEqual(_trackLinksRetargetPure({ Lead: 'Guitar_L' }, 'Lead'), {},
        'deleting the transcription removes its stale pairing');
});

t('an unpaired transcription focuses the Master Mix, never an unrelated tempo guide', () => {
    assert.strictEqual(_trackFocusSourcePure({ type: 'transcription', pairedSourceId: '' }), 'master');
    assert.strictEqual(_trackFocusSourcePure({ type: 'transcription', pairedSourceId: 'Guitar_L' }), 'Guitar_L');
});

for (const [name, fn] of tests) {
    try { await fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
