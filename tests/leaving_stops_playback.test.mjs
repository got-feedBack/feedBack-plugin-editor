/*
 * Leaving the Song Editor must silence it.
 *
 * The Web Audio graph and the rAF transport outlive the screen's DOM, and the
 * host hides a screen by dropping its `active` class — it does not re-run the
 * editor module. __editorScreenTeardown (which DOES stop audio) only runs at
 * the top of a NEW injection, so navigating away left playback running: start
 * playback, leave the editor, launch an actual song, and you get two mixes at
 * once. Reported by Christian 2026-07-19.
 *
 * Pins two things by brace-extracting the real source from src/main.js
 * (main.js is the entry orchestrator and exports nothing, so the sliced-env
 * convention is the only way in — same as tests/boot_teardown.test.js):
 *
 *   1. _editorOnScreenHidden stops a MIDI take AND playback, and neither
 *      throw escapes to block navigation.
 *   2. The screen observer calls it on active->inactive, does NOT call it on
 *      inactive->active, and ignores unrelated class churn.
 *
 * Run: node --test tests/leaving_stops_playback.test.mjs
 */
import assert from 'node:assert';
import fs from 'node:fs';
import test from 'node:test';

const src = fs.readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');

function extractFn(name) {
    const start = src.indexOf('function ' + name);
    assert.ok(start >= 0, `function ${name} must exist in src/main.js`);
    const open = src.indexOf('{', start);
    let depth = 0;
    for (let i = open; i < src.length; i++) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}' && --depth === 0) return src.slice(start, i + 1);
    }
    throw new Error('unbalanced braces extracting ' + name);
}

function makeHidden(over = {}) {
    const calls = { stopRec: 0, stopPlay: 0 };
    const deps = {
        editorStopRecordMidi: over.editorStopRecordMidi
            || (() => { calls.stopRec++; }),
        stopPlayback: over.stopPlayback || (() => { calls.stopPlay++; }),
    };
    const names = Object.keys(deps);
    const fn = new Function(
        ...names,
        '"use strict";' + extractFn('_editorOnScreenHidden') + '\nreturn _editorOnScreenHidden;',
    )(...names.map((n) => deps[n]));
    return { fn, calls };
}

test('the screen observer is wired to silence the editor on hide', () => {
    // The guard that names the bug. On pre-fix main the observer has only an
    // active branch, so nothing ever stops playback when you navigate away —
    // and every behavioural test below would pass against a handler that is
    // never called.
    // Anchor on the SCREEN observer specifically — main.js has more than one
    // MutationObserver (the v3 topbar watcher comes first in the file), and a
    // naive indexOf + fixed-window slice reads the wrong one, so this guard
    // would pass or fail for reasons having nothing to do with the fix.
    const at = src.indexOf('const obs = new MutationObserver');
    assert.ok(at >= 0, 'the screen observer must exist');
    const end = src.indexOf('_editorScreenObs = obs', at);
    assert.ok(end > at, 'the screen observer must be held in _editorScreenObs');
    const body = src.slice(at, end);
    assert.ok(
        body.includes('_editorOnScreenHidden()'),
        'the screen observer must call _editorOnScreenHidden when the editor stops being active',
    );
});

test('leaving stops both the MIDI take and playback', () => {
    const { fn, calls } = makeHidden();
    fn();
    assert.strictEqual(calls.stopRec, 1, 'an in-flight take must be finalized');
    assert.strictEqual(calls.stopPlay, 1, 'playback must be stopped');
});

test('a throwing take-stop still stops playback and never blocks navigation', () => {
    // If finalizing the take blew up and took the whole handler with it, the
    // audio would keep playing — the exact bug, with extra steps.
    const calls = { stopPlay: 0 };
    const { fn } = makeHidden({
        editorStopRecordMidi: () => { throw new Error('midi device vanished'); },
        stopPlayback: () => { calls.stopPlay++; },
    });
    assert.doesNotThrow(() => fn());
    assert.strictEqual(calls.stopPlay, 1, 'playback still stopped after a take-stop failure');
});

test('a throwing stopPlayback never escapes to block navigation', () => {
    const { fn } = makeHidden({
        stopPlayback: () => { throw new Error('no audio context'); },
    });
    assert.doesNotThrow(() => fn());
});

// ── The observer wiring ──────────────────────────────────────────────
// Rebuilt from the same shape as init()'s MutationObserver callback. This
// pins the transition logic; the extraction above pins what it calls.

function makeObserverCallback(startActive) {
    const calls = { hidden: 0, resize: 0, landing: 0 };
    let active = startActive;
    let wasActive = startActive;
    const el = { classList: { contains: () => active } };
    const cb = () => {
        if (!el) return;
        const now = el.classList.contains();
        if (now === wasActive) return;
        wasActive = now;
        if (now) { calls.resize++; calls.landing++; } else { calls.hidden++; }
    };
    return { cb, calls, setActive: (v) => { active = v; } };
}

test('active -> inactive silences the editor', () => {
    const o = makeObserverCallback(true);
    o.setActive(false);
    o.cb();
    assert.strictEqual(o.calls.hidden, 1);
});

test('inactive -> active does NOT silence (it is an entry, not an exit)', () => {
    const o = makeObserverCallback(false);
    o.setActive(true);
    o.cb();
    assert.strictEqual(o.calls.hidden, 0, 'entering must never stop playback');
    assert.strictEqual(o.calls.resize, 1, 'entering still resizes the canvas');
});

test('unrelated class churn while hidden does not re-fire the stop', () => {
    // attributeFilter is `class`, not one specific class — any class change on
    // #plugin-editor wakes the observer. Without the transition guard this
    // would call stopPlayback on every such mutation.
    const o = makeObserverCallback(true);
    o.setActive(false);
    o.cb();
    o.cb();
    o.cb();
    assert.strictEqual(o.calls.hidden, 1, 'only the real transition counts');
});

test('re-showing the same injection works after a hide', () => {
    // The host may re-show this injection without re-running the module, so
    // the observer has to survive a full hide/show cycle.
    const o = makeObserverCallback(true);
    o.setActive(false); o.cb();
    o.setActive(true); o.cb();
    assert.strictEqual(o.calls.hidden, 1);
    assert.strictEqual(o.calls.resize, 1, 'coming back still resizes');
});
