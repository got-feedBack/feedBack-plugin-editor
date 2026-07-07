'use strict';
/*
 * Tests for drum velocity authoring (@pure:drum-cmds additions):
 * SetDrumVelocityCmd (Alt-drag / Shift+↑↓ nudge / A-accent / N-normal quick
 * sets), the drag + clamp pure helpers, and the ghost toggle's velocity
 * pull — ToggleDrumArticulationCmd('g') now quiets a normal-strength hit to
 * the ghost level (a ghost IS a quiet hit; import derives g from v < 40)
 * and restores the EXACT prior velocity on undo, including deleting a `v`
 * that wasn't there. These fail on main, where drum velocity is
 * unauthorable and ghosting leaves a contradictory v:100.
 *
 * Run: node tests/drum_velocity.test.js
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const src = fs.readFileSync(path.join(__dirname, '..', 'screen.js'), 'utf8');

function extract(name) {
    const re = new RegExp(
        '/\\* @pure:' + name + ':start \\*/[\\s\\S]*?/\\* @pure:' + name + ':end \\*/');
    const m = src.match(re);
    if (!m) {
        console.error(`FAIL: @pure:${name} block not found in screen.js`);
        process.exit(1);
    }
    return m[0];
}

const drumBlock = extract('drum-cmds');
const historyBlock = extract('edit-history');

function makeEnv() {
    const S = {
        drumTab: { hits: [] },
        drumSel: new Set(),
        drumTabDirty: false,
        currentArr: 0,
    };
    const env = new Function(
        'document', 'S', 'updateArrangementSelector', 'draw', 'updateStatus',
        '"use strict";'
        + historyBlock + '\n' + drumBlock + '\n'
        + 'return { EditHistory, SetDrumVelocityCmd, ToggleDrumArticulationCmd, '
        + 'DRUM_GHOST_VELOCITY, _drumClampVelocityPure, _drumVelocityDragValuePure };'
    )(
        { getElementById: () => ({ disabled: false }) },
        S,
        () => {},
        () => {},
        () => {},
    );
    return { ...env, S, history: new env.EditHistory() };
}

let pass = 0, fail = 0;
function t(name, fn) {
    try { fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}

// ── Pure helpers ─────────────────────────────────────────────────────

t('velocity clamp: MIDI 1..127, junk falls back to 100', () => {
    const { _drumClampVelocityPure } = makeEnv();
    assert.strictEqual(_drumClampVelocityPure(64), 64);
    assert.strictEqual(_drumClampVelocityPure(0), 1);
    assert.strictEqual(_drumClampVelocityPure(200), 127);
    assert.strictEqual(_drumClampVelocityPure(-5), 1);
    assert.strictEqual(_drumClampVelocityPure('90'), 90);
    assert.strictEqual(_drumClampVelocityPure(NaN), 100);
    assert.strictEqual(_drumClampVelocityPure(undefined), 100);
});

t('drag mapping: up = louder off the ORIGINAL value, missing v bases at 100', () => {
    const { _drumVelocityDragValuePure } = makeEnv();
    assert.strictEqual(_drumVelocityDragValuePure(100, -20), 120, 'drag up 20px');
    assert.strictEqual(_drumVelocityDragValuePure(100, 30), 70, 'drag down 30px');
    assert.strictEqual(_drumVelocityDragValuePure(undefined, 10), 90, 'no v → base 100');
    assert.strictEqual(_drumVelocityDragValuePure(120, -50), 127, 'clamps high');
    assert.strictEqual(_drumVelocityDragValuePure(20, 200), 1, 'clamps low');
});

// ── SetDrumVelocityCmd ───────────────────────────────────────────────

t('velocity edit round-trips: exec applies, undo restores exact values', () => {
    const { S, history, SetDrumVelocityCmd } = makeEnv();
    const a = { t: 1, p: 'snare', v: 90 };
    const b = { t: 2, p: 'kick' };  // no explicit v
    S.drumTab.hits = [a, b];
    history.exec(new SetDrumVelocityCmd([a, b], [40, 110]));
    assert.strictEqual(a.v, 40);
    assert.strictEqual(b.v, 110);
    assert.strictEqual(S.drumTabDirty, true, 'dirty on exec');
    history.doUndo();
    assert.strictEqual(a.v, 90, 'authored v restored');
    assert.ok(!('v' in b), 'absent v is DELETED again, not set to 100');
    history.doRedo();
    assert.strictEqual(a.v, 40, 'redo replays');
    assert.strictEqual(b.v, 110);
});

t('scalar velocity broadcasts to the whole selection (quick sets)', () => {
    const { S, history, SetDrumVelocityCmd } = makeEnv();
    const a = { t: 1, p: 'snare', v: 90 }, b = { t: 2, p: 'snare', v: 50 };
    S.drumTab.hits = [a, b];
    history.exec(new SetDrumVelocityCmd([a, b], 115));
    assert.strictEqual(a.v, 115);
    assert.strictEqual(b.v, 115);
});

t('velocity input is clamped at the command boundary', () => {
    const { S, history, SetDrumVelocityCmd } = makeEnv();
    const a = { t: 1, p: 'snare', v: 90 };
    S.drumTab.hits = [a];
    history.exec(new SetDrumVelocityCmd([a], [999]));
    assert.strictEqual(a.v, 127);
});

// ── Ghost toggle velocity pull ───────────────────────────────────────

t('ghosting a normal-strength hit pulls velocity to the ghost level', () => {
    const { S, history, ToggleDrumArticulationCmd, DRUM_GHOST_VELOCITY } = makeEnv();
    const a = { t: 1, p: 'snare', v: 100 };
    S.drumTab.hits = [a];
    history.exec(new ToggleDrumArticulationCmd([a], 'g'));
    assert.strictEqual(a.g, true);
    assert.strictEqual(a.v, DRUM_GHOST_VELOCITY, 'v pulled to ghost level');
});

t('ghosting a hit with no explicit v pulls it too (import default is 100)', () => {
    const { S, history, ToggleDrumArticulationCmd, DRUM_GHOST_VELOCITY } = makeEnv();
    const a = { t: 1, p: 'snare' };
    S.drumTab.hits = [a];
    history.exec(new ToggleDrumArticulationCmd([a], 'g'));
    assert.strictEqual(a.v, DRUM_GHOST_VELOCITY);
    history.doUndo();
    assert.ok(!('v' in a), 'undo deletes the v it introduced');
    assert.ok(!('g' in a), 'undo removes the ghost flag');
});

t('ghosting an already-quiet hit keeps its authored dynamics', () => {
    const { S, history, ToggleDrumArticulationCmd } = makeEnv();
    const a = { t: 1, p: 'snare', v: 30 };
    S.drumTab.hits = [a];
    history.exec(new ToggleDrumArticulationCmd([a], 'g'));
    assert.strictEqual(a.g, true);
    assert.strictEqual(a.v, 30, 'quiet hit not touched');
});

t('un-ghosting leaves velocity as authored; undo restores the exact pair', () => {
    const { S, history, ToggleDrumArticulationCmd } = makeEnv();
    const a = { t: 1, p: 'snare', g: true, v: 35 };
    S.drumTab.hits = [a];
    history.exec(new ToggleDrumArticulationCmd([a], 'g'));
    assert.ok(!('g' in a), 'ghost lifted');
    assert.strictEqual(a.v, 35, 'velocity untouched on un-ghost');
    history.doUndo();
    assert.strictEqual(a.g, true);
    assert.strictEqual(a.v, 35);
});

t('mixed ghost states round-trip exactly, velocities included', () => {
    const { S, history, ToggleDrumArticulationCmd, DRUM_GHOST_VELOCITY } = makeEnv();
    const a = { t: 1, p: 'snare', g: true, v: 20 };
    const b = { t: 2, p: 'snare', v: 100 };
    S.drumTab.hits = [a, b];
    history.exec(new ToggleDrumArticulationCmd([a, b], 'g'));
    assert.ok(!('g' in a), 'ghost removed where set');
    assert.strictEqual(a.v, 20);
    assert.strictEqual(b.g, true, 'ghost added where unset');
    assert.strictEqual(b.v, DRUM_GHOST_VELOCITY);
    history.doUndo();
    assert.strictEqual(a.g, true);
    assert.strictEqual(a.v, 20);
    assert.ok(!('g' in b));
    assert.strictEqual(b.v, 100);
    history.doRedo();
    assert.ok(!('g' in a));
    assert.strictEqual(b.v, DRUM_GHOST_VELOCITY, 'redo replays the pull');
});

t('flam and choke stay involutive (regression)', () => {
    const { S, history, ToggleDrumArticulationCmd } = makeEnv();
    const a = { t: 1, p: 'snare', v: 90 };
    const cym = { t: 2, p: 'crash_l' };
    S.drumTab.hits = [a, cym];
    history.exec(new ToggleDrumArticulationCmd([a], 'f'));
    assert.strictEqual(a.f, true);
    assert.strictEqual(a.v, 90, 'flam never touches velocity');
    history.doUndo();
    assert.ok(!('f' in a));
    history.exec(new ToggleDrumArticulationCmd([cym], 'k'));
    assert.strictEqual(cym.k, 0.08);
    history.doUndo();
    assert.ok(!('k' in cym));
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
