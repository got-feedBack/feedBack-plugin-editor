'use strict';
/*
 * Tests for the per-part tempo-ride scope (@pure:tempo-ride resolver + the
 * real TempoMapCmd / _applyTempoRemap / _captureScopedTimes /
 * _restoreScopedTimes pipeline).
 *
 * The binary drums/all toggle became a per-part checklist ('custom' scope):
 * each arrangement — and the drum tab itself — can be checked in or out of
 * riding a tempo edit. Pinned here, all against the REAL shipping code:
 *   - preset semantics unchanged ('drum' = drum tab only, 'all' = everything);
 *   - a custom ride re-times ONLY the checked parts; unchecked arrangements
 *     and an unchecked drum tab keep their times verbatim (FAILS on main,
 *     which always re-times drums and has no per-part scope at all);
 *   - sections ride in EVERY scope;
 *   - undo restores the exact pre-edit times for what rode;
 *   - the ride set freezes at command construction — flipping the checklist
 *     between edit and undo cannot desync capture/remap/restore.
 *
 * Run: node tests/tempo_ride_parts.test.js
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const src = fs.readFileSync(path.join(__dirname, '..', 'screen.js'), 'utf8');

function extractBlock(name) {
    const re = new RegExp(
        '/\\* @pure:' + name + ':start \\*/[\\s\\S]*?/\\* @pure:' + name + ':end \\*/');
    const m = src.match(re);
    if (!m) {
        console.error(`FAIL: @pure:${name} block not found in screen.js`);
        process.exit(1);
    }
    return m[0];
}

// Brace-matched extraction by name (the waveform_render harness pattern).
function extractFn(name) {
    const start = src.indexOf('function ' + name);
    assert.ok(start >= 0, `function ${name} must exist`);
    const open = src.indexOf('{', start);
    let depth = 0;
    for (let i = open; i < src.length; i++) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}' && --depth === 0) return src.slice(start, i + 1);
    }
    throw new Error(`unbalanced braces extracting ${name}`);
}
function extractClass(name) {
    const start = src.indexOf('class ' + name);
    assert.ok(start >= 0, `class ${name} must exist`);
    const open = src.indexOf('{', start);
    let depth = 0;
    for (let i = open; i < src.length; i++) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}' && --depth === 0) return src.slice(start, i + 1);
    }
    throw new Error(`unbalanced braces extracting ${name}`);
}

const rideBlock = extractBlock('tempo-ride');
const r3m = src.match(/const _r3 = [^\n]+\n/);
assert.ok(r3m, '_r3 must exist');

// Compose the full real pipeline in one scope.
const pipelineSrc = [
    rideBlock,
    r3m[0],
    extractFn('_tempoRetimeArrangements'),
    extractFn('_tempoRideSet'),
    extractFn('_makeTimeRemap'),
    extractFn('_applyTempoRemap'),
    extractFn('_captureScopedTimes'),
    extractFn('_restoreScopedTimes'),
    extractClass('TempoMapCmd'),
].join('\n');

function makeEnv(S) {
    return new Function(
        'S', '_loopRelockAfterGridChange', '_renderLoopStrip', '_updateLoopIn3DBtn',
        '"use strict";' + pipelineSrc
        + '\nreturn { _tempoRideResolvePure, _rebaseTempoRideForRemoval,'
        + ' _tempoRideSet, TempoMapCmd };'
    )(S, () => {}, () => {}, () => {});
}

// Two-arrangement song: one 2 s measure stretched to 3 s → t=1 remaps to 1.5.
function makeSong() {
    return {
        format: 'sloppak',
        currentArr: 0,
        arrangements: [
            {
                name: 'Lead',
                notes: [{ time: 1, sustain: 0.5 }],
                chords: [], anchors: [], anchors_user: [], handshapes: [], phrases: [],
            },
            {
                name: 'Bass',
                notes: [{ time: 1, sustain: 0 }],
                chords: [], anchors: [], anchors_user: [], handshapes: [], phrases: [],
            },
        ],
        drumTab: { hits: [{ t: 1 }] },
        drumTabDirty: false,
        sections: [{ start_time: 1 }],
        beats: [{ time: 0, measure: 1 }, { time: 2, measure: 2 }],
        barSel: null,
        duration: 10,
        tempoRideScope: 'drum',
        tempoRideCustom: null,
    };
}
const OLD_BEATS = [{ time: 0, measure: 1 }, { time: 2, measure: 2 }];
const NEW_BEATS = [{ time: 0, measure: 1 }, { time: 3, measure: 2 }];

let pass = 0, fail = 0;
function t(name, fn) {
    try { fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}

// ── Pure resolver ────────────────────────────────────────────────────

t("resolver: 'drum' preset = drum only, 'all' = drum + every candidate", () => {
    const env = makeEnv(makeSong());
    assert.deepStrictEqual(
        env._tempoRideResolvePure('drum', null, [0, 1]), { drum: true, idxs: [] });
    assert.deepStrictEqual(
        env._tempoRideResolvePure('all', null, [0, 1]), { drum: true, idxs: [0, 1] });
});

t('resolver: custom checklist picks exact parts; drum can opt out', () => {
    const env = makeEnv(makeSong());
    const out = env._tempoRideResolvePure(
        'custom', { drum: false, arrs: new Set([1]) }, [0, 1]);
    assert.deepStrictEqual(out, { drum: false, idxs: [1] });
});

t('resolver: null/missing checklist rides everything (safe superset)', () => {
    const env = makeEnv(makeSong());
    assert.deepStrictEqual(
        env._tempoRideResolvePure('custom', null, [0, 1]), { drum: true, idxs: [] },
        'no checklist object at all → conservative drum-only');
    assert.deepStrictEqual(
        env._tempoRideResolvePure('custom', { drum: true, arrs: null }, [0, 1]),
        { drum: true, idxs: [0, 1] },
        'checklist with no set → all candidates');
});

t('resolver: indices outside the candidate list are ignored (archive limit)', () => {
    const env = makeEnv(makeSong());
    const out = env._tempoRideResolvePure(
        'custom', { drum: true, arrs: new Set([0, 5]) }, [0]);
    assert.deepStrictEqual(out.idxs, [0]);
});

// ── Real pipeline: custom ride ───────────────────────────────────────

t('custom ride re-times only the checked arrangement; unchecked part and drums stay', () => {
    const S = makeSong();
    S.tempoRideScope = 'custom';
    S.tempoRideCustom = { drum: false, arrs: new Set([0]) };
    const env = makeEnv(S);
    const cmd = new env.TempoMapCmd(OLD_BEATS, NEW_BEATS, 'tempo');
    cmd.exec();
    assert.strictEqual(S.arrangements[0].notes[0].time, 1.5, 'checked Lead rides');
    assert.strictEqual(S.arrangements[0].notes[0].sustain, 0.75, 'sustain stretches with it');
    assert.strictEqual(S.arrangements[1].notes[0].time, 1, 'unchecked Bass stays put');
    assert.strictEqual(S.drumTab.hits[0].t, 1, 'unchecked drum tab stays put');
    assert.strictEqual(S.sections[0].start_time, 1.5, 'sections ride in every scope');
});

t('undo restores the exact pre-edit times for what rode', () => {
    const S = makeSong();
    S.tempoRideScope = 'custom';
    S.tempoRideCustom = { drum: false, arrs: new Set([0]) };
    const env = makeEnv(S);
    const cmd = new env.TempoMapCmd(OLD_BEATS, NEW_BEATS, 'tempo');
    cmd.exec();
    cmd.rollback();
    assert.strictEqual(S.arrangements[0].notes[0].time, 1);
    assert.strictEqual(S.arrangements[0].notes[0].sustain, 0.5);
    assert.strictEqual(S.arrangements[1].notes[0].time, 1);
    assert.strictEqual(S.drumTab.hits[0].t, 1);
    assert.strictEqual(S.sections[0].start_time, 1);
    cmd.exec();  // redo
    assert.strictEqual(S.arrangements[0].notes[0].time, 1.5, 'redo re-applies');
});

t('the ride set freezes at construction — later checklist flips cannot desync undo', () => {
    const S = makeSong();
    S.tempoRideScope = 'custom';
    S.tempoRideCustom = { drum: false, arrs: new Set([0]) };
    const env = makeEnv(S);
    const cmd = new env.TempoMapCmd(OLD_BEATS, NEW_BEATS, 'tempo');
    // Flip the checklist AFTER construction, BEFORE exec.
    S.tempoRideCustom = { drum: true, arrs: new Set([1]) };
    S.tempoRideScope = 'all';
    cmd.exec();
    assert.strictEqual(S.arrangements[0].notes[0].time, 1.5, 'frozen ride still applies to Lead');
    assert.strictEqual(S.arrangements[1].notes[0].time, 1, 'Bass stays out despite the flip');
    assert.strictEqual(S.drumTab.hits[0].t, 1, 'drums stay out despite the flip');
    cmd.rollback();
    assert.strictEqual(S.arrangements[0].notes[0].time, 1, 'undo restores the frozen set');
});

// ── Presets through the real pipeline (regression guards) ────────────

t("preset 'drum': drum tab rides, no arrangement moves", () => {
    const S = makeSong();
    S.tempoRideScope = 'drum';
    const env = makeEnv(S);
    new env.TempoMapCmd(OLD_BEATS, NEW_BEATS, 'tempo').exec();
    assert.strictEqual(S.drumTab.hits[0].t, 1.5);
    assert.strictEqual(S.drumTabDirty, true);
    assert.strictEqual(S.arrangements[0].notes[0].time, 1);
    assert.strictEqual(S.arrangements[1].notes[0].time, 1);
});

t("preset 'all': everything rides", () => {
    const S = makeSong();
    S.tempoRideScope = 'all';
    const env = makeEnv(S);
    new env.TempoMapCmd(OLD_BEATS, NEW_BEATS, 'tempo').exec();
    assert.strictEqual(S.drumTab.hits[0].t, 1.5);
    assert.strictEqual(S.arrangements[0].notes[0].time, 1.5);
    assert.strictEqual(S.arrangements[1].notes[0].time, 1.5);
});

t("archive format limits an 'all' ride to the active arrangement", () => {
    const S = makeSong();
    S.format = 'archive';
    S.currentArr = 1;
    S.tempoRideScope = 'all';
    const env = makeEnv(S);
    new env.TempoMapCmd(OLD_BEATS, NEW_BEATS, 'tempo').exec();
    assert.strictEqual(S.arrangements[1].notes[0].time, 1.5, 'active arrangement rides');
    assert.strictEqual(S.arrangements[0].notes[0].time, 1, 'non-persisted arrangement protected');
});

// ── Removing an arrangement rebases the checklist (regression) ───────
//
// The checklist stores arrangement INDICES. editorRemoveArrangement splices
// S.arrangements, renumbering every part after the removed one. Without a
// matching rebase of tempoRideCustom.arrs the checked set slides onto its
// neighbour, so a hand-unchecked part rides the next tempo edit — the exact
// out-of-scope corruption this scope exists to prevent. FAILS on pre-fix
// code, which leaves the stale indices in place.

function makeThreeArrSong() {
    return {
        format: 'sloppak',
        currentArr: 0,
        arrangements: [
            { name: 'Lead',   notes: [{ time: 1, sustain: 0 }], chords: [], anchors: [], anchors_user: [], handshapes: [], phrases: [] },
            { name: 'Rhythm', notes: [{ time: 1, sustain: 0 }], chords: [], anchors: [], anchors_user: [], handshapes: [], phrases: [] },
            { name: 'Bass',   notes: [{ time: 1, sustain: 0 }], chords: [], anchors: [], anchors_user: [], handshapes: [], phrases: [] },
        ],
        drumTab: { hits: [{ t: 1 }] },
        drumTabDirty: false,
        sections: [{ start_time: 1 }],
        beats: [{ time: 0, measure: 1 }, { time: 2, measure: 2 }],
        barSel: null,
        duration: 10,
        tempoRideScope: 'custom',
        tempoRideCustom: null,
    };
}

t('rebase: pure helper drops the removed index and shifts the higher ones down', () => {
    const env = makeEnv(makeSong());
    const out = env._rebaseTempoRideForRemoval(
        { drum: false, arrs: new Set([0, 2, 3]) }, 1);
    assert.strictEqual(out.drum, false, 'drum flag preserved');
    assert.deepStrictEqual([...out.arrs].sort((a, b) => a - b), [0, 1, 2],
        '0 (below removeIdx) stays, 2→1, 3→2; removeIdx 1 was not in the set');
    // pure — input Set untouched
});

t('removing a checked part leaves an unchecked neighbour unchecked (no ride leak)', () => {
    const S = makeThreeArrSong();
    // Lead + Rhythm ride; Bass (idx 2) hand-unchecked.
    S.tempoRideCustom = { drum: false, arrs: new Set([0, 1]) };
    const env = makeEnv(S);

    // Reproduce editorRemoveArrangement's two coupled mutations: rebase then
    // splice out Rhythm (idx 1). After this Bass is idx 1.
    S.tempoRideCustom = env._rebaseTempoRideForRemoval(S.tempoRideCustom, 1);
    S.arrangements.splice(1, 1);
    assert.deepStrictEqual([...S.tempoRideCustom.arrs], [0], 'only Lead stays checked');

    new env.TempoMapCmd(OLD_BEATS, NEW_BEATS, 'tempo').exec();
    assert.strictEqual(S.arrangements[0].notes[0].time, 1.5, 'Lead (still checked) rides');
    assert.strictEqual(S.arrangements[1].notes[0].time, 1,
        'Bass (unchecked, shifted into old Rhythm slot) must NOT ride');
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
