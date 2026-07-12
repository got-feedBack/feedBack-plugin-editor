/*
 * Onboarding signposts + first-win cues (workspace-shell C2).
 *
 * SUGGEST-only signposts (action-triggered, one-shot, permanently dismissible)
 * and calm one-time correctness cues. All one-shot state is localStorage.
 *
 * Run: node tests/signposts.test.mjs
 */
import assert from 'node:assert';

// ── Minimal browser env (localStorage + a couple of DOM elements) ────────────
const _store = new Map();
globalThis.localStorage = {
    getItem: (k) => (_store.has(k) ? _store.get(k) : null),
    setItem: (k, v) => _store.set(k, String(v)),
    removeItem: (k) => _store.delete(k),
    clear: () => _store.clear(),
};
function mkEl() {
    const el = { dataset: {}, textContent: '', offsetWidth: 0, _c: new Set(['hidden']) };
    el.classList = {
        add: (...cs) => cs.forEach((c) => el._c.add(c)),
        remove: (...cs) => cs.forEach((c) => el._c.delete(c)),
        contains: (c) => el._c.has(c),
    };
    return el;
}
const _els = { 'editor-signpost': mkEl(), 'editor-signpost-msg': mkEl(), 'editor-cue': mkEl() };
globalThis.document = { getElementById: (id) => _els[id] || null };
// setTimeout stays the real one: the harness process.exits before the 4.2s
// auto-hide timer fires, so a shown cue stays shown for the assertions.

const { S } = await import('../src/state.js');
const {
    SIGNPOSTS, _eligibleSignpostPure, _signpostNote, _signpostSeen, _cueSeen,
    _fireCueOnce, _maybeFireFirstCovered, _resetSignpostCounters, editorDismissSignpost,
} = await import('../src/signposts.js');
const { _sectionCoveragePure } = await import('../src/draw.js');

let pass = 0, fail = 0;
function t(name, fn) {
    try { fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}
const shown = (id) => !_els[id]._c.has('hidden');
function reset() {
    _store.clear();
    _resetSignpostCounters();
    for (const el of Object.values(_els)) { el._c = new Set(['hidden']); el.textContent = ''; el.dataset = {}; }
}

t('the registry stays capped at ≤3 hand-audited signposts', () => {
    assert.ok(SIGNPOSTS.length <= 3 && SIGNPOSTS.length >= 1);
    // Messages point at the menu/shortcut, never an action verb that mutates a surface.
    for (const sp of SIGNPOSTS) assert.ok(/Tempo|Shift\+|Ctrl\+|menu/i.test(sp.message));
});

t('grid-fit is eligible after enough fighting, unless Tempo Map was opened', () => {
    assert.strictEqual(_eligibleSignpostPure({ gridFight: 3, enteredTempoMap: false }, { sections: [], duration: 0 }, new Set())?.id, 'grid-fit');
    assert.strictEqual(_eligibleSignpostPure({ gridFight: 2, enteredTempoMap: false }, { sections: [], duration: 0 }, new Set()), null);
    assert.strictEqual(_eligibleSignpostPure({ gridFight: 9, enteredTempoMap: true }, { sections: [], duration: 0 }, new Set()), null);
    // An already-seen signpost is skipped.
    assert.strictEqual(_eligibleSignpostPure({ gridFight: 5, enteredTempoMap: false }, { sections: [], duration: 0 }, new Set(['grid-fit'])), null);
});

t('a signpost fires once at threshold, then NEVER again (one-shot + dismiss)', () => {
    reset();
    Object.assign(S, { sections: [], duration: 0 });
    _signpostNote('gridFight'); _signpostNote('gridFight');
    assert.ok(!shown('editor-signpost'), 'below threshold: nothing');
    _signpostNote('gridFight');
    assert.ok(shown('editor-signpost'), 'fires at 3');
    assert.ok(_els['editor-signpost-msg'].textContent.length > 0);
    assert.ok(_signpostSeen('grid-fit'));
    editorDismissSignpost();
    assert.ok(!shown('editor-signpost'), 'dismiss hides it');
    _resetSignpostCounters();
    for (let i = 0; i < 5; i++) _signpostNote('gridFight');
    assert.ok(!shown('editor-signpost'), 'seen ⇒ never shows again, even fresh counters');
});

t('sections signpost needs many jumps AND no sections AND a long song', () => {
    reset();
    Object.assign(S, { sections: [], duration: 120 });
    for (let i = 0; i < 10; i++) _signpostNote('navJump');
    assert.ok(shown('editor-signpost') && _signpostSeen('sections'));

    reset();                                    // sections already present ⇒ never
    Object.assign(S, { sections: [{ start_time: 0 }], duration: 120 });
    for (let i = 0; i < 12; i++) _signpostNote('navJump');
    assert.ok(!shown('editor-signpost'));

    reset();                                    // short song ⇒ never
    Object.assign(S, { sections: [], duration: 20 });
    for (let i = 0; i < 12; i++) _signpostNote('navJump');
    assert.ok(!shown('editor-signpost'));
});

t('a cue fires once, then is a no-op', () => {
    reset();
    assert.strictEqual(_fireCueOnce('x', 'hi'), true);
    assert.ok(shown('editor-cue') && _els['editor-cue'].textContent === 'hi' && _cueSeen('x'));
    _els['editor-cue']._c = new Set(['hidden']);
    assert.strictEqual(_fireCueOnce('x', 'again'), false);
    assert.ok(!shown('editor-cue'), 'never fires twice');
});

t('first-covered cue: silent on a loaded-covered chart, fires on an edit transition', () => {
    reset();
    _maybeFireFirstCovered([{ hasContent: true }]);        // baseline (load) — no fire
    assert.ok(!shown('editor-cue') && !_cueSeen('first-covered'), 'opening an already-charted song stays quiet');
    _maybeFireFirstCovered([{ hasContent: true }]);        // still covered — no fire
    assert.ok(!shown('editor-cue'));

    reset();
    _maybeFireFirstCovered([{ hasContent: false }]);       // baseline empty
    assert.ok(!shown('editor-cue'));
    _maybeFireFirstCovered([{ hasContent: true }, { hasContent: false }]);   // user covers one — fire
    assert.ok(shown('editor-cue') && _cueSeen('first-covered'));
});

t('completeness shading is presence-only and never flags an empty-by-intent span', () => {
    // sections at 0/10/20 over a 30s song; notes only in the 1st and 3rd.
    const cov = _sectionCoveragePure([{ start_time: 0 }, { start_time: 10 }, { start_time: 20 }], [5, 25], 30);
    assert.deepStrictEqual(cov.map((s) => s.hasContent), [true, false, true]);
    // The empty middle span is just hasContent:false — there is no "incomplete"
    // / "bad" flag in the model, so nothing can scold an intentional rest.
    assert.strictEqual('incomplete' in cov[1], false);
    assert.strictEqual('required' in cov[1], false);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
