'use strict';
/*
 * Regression tests for the STATEFUL host midi-input domain acquire/release
 * path in the editor's live-record flow (the untested half of PR #121).
 *
 * These pin three leaks in the capability-domain session lifecycle:
 *   1. A stale async _recMidiEnsureOpen() resolution superseded by a newer
 *      open() must NOT install its handle — it must close its now-orphaned
 *      ref (else the superseded shared session is leaked open forever).
 *   2. An open() that resolves AFTER teardown (modal close / Stop) must not
 *      resurrect a handle onto the torn-down session — it must self-close.
 *   3. editorStopRecordMidi hides the modal, so it must release the domain
 *      session (the modal-close teardown never runs on the Stop path).
 *
 * All three FAIL on pre-fix screen.js (no generation guard; Stop only
 * removed the listener and left the refcounted session open).
 *
 * Run: node tests/midi_domain_leak.test.js
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const src = fs.readFileSync(path.join(__dirname, '..', 'screen.js'), 'utf8');

function extractFn(name) {
    let start = src.indexOf('function ' + name);
    assert.ok(start >= 0, `function ${name} must exist`);
    if (src.slice(start - 6, start) === 'async ') start -= 6;
    const open = src.indexOf('{', start);
    let depth = 0;
    for (let i = open; i < src.length; i++) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}' && --depth === 0) return src.slice(start, i + 1);
    }
    throw new Error(`unbalanced braces extracting ${name}`);
}
function extractArrow(winName) {
    const start = src.indexOf('window.' + winName + ' = ');
    assert.ok(start >= 0, `window.${winName} must exist`);
    const open = src.indexOf('{', start);
    let depth = 0;
    for (let i = open; i < src.length; i++) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}' && --depth === 0) return src.slice(start, i + 1);
    }
    throw new Error(`unbalanced braces extracting ${winName}`);
}

let pass = 0, fail = 0;
function t(name, fn) {
    return Promise.resolve()
        .then(fn)
        .then(() => { pass++; console.log('  ok   ' + name); })
        .catch(e => { fail++; console.error('  FAIL ' + name + ': ' + e.message); });
}

// ── Harness: run the REAL domain lifecycle fns over a controllable domain ──
function makeEnv() {
    const preamble =
        'let _recMidiHandle = null;\n'
        + 'let _recMidiOpenKey = null;\n'
        + 'let _recMidiOpenGen = 0;\n'
        + 'function _recMidiOnData() {}\n'
        + 'const __state = { domain: null };\n'
        + 'const window = { feedBack: { get midiInput() { return __state.domain; } } };\n'
        + 'const localStorage = { _v: {}, setItem(k, v) { this._v[k] = v; }, getItem(k) { return this._v[k] || null; } };\n';
    return new Function(
        '"use strict";' + preamble
        + extractFn('_recMidiDomain') + '\n'
        + extractFn('_recMidiDisconnectDomain') + '\n'
        + extractFn('_recMidiEnsureOpen') + '\n'
        + 'return {'
        + '  setDomain: (d) => { __state.domain = d; },'
        + '  ensureOpen: (id) => _recMidiEnsureOpen(id),'
        + '  disconnect: () => _recMidiDisconnectDomain(),'
        + '  snap: () => ({ handle: _recMidiHandle, key: _recMidiOpenKey, gen: _recMidiOpenGen }),'
        + '};'
    )();
}

// Fake host midi-input domain (version 1) with test-controlled open() timing.
function makeDomain() {
    const calls = { select: [], open: [], close: [] };
    const pending = [];
    return {
        version: 1,
        select(id) { calls.select.push(id); },
        open(req) {
            calls.open.push(req.logicalSourceKey);
            return new Promise(resolve => pending.push({ key: req.logicalSourceKey, resolve }));
        },
        close(req) { calls.close.push(req.logicalSourceKey); },
        _calls: calls,
        _resolve(key, id) {
            const i = pending.findIndex(x => x.key === key);
            assert.ok(i >= 0, `no pending open for ${key}`);
            pending.splice(i, 1)[0].resolve({ handle: { id, removeListener() {}, addListener() {} } });
        },
    };
}

(async () => {

await t('a newer open supersedes a stale in-flight open without leaking it', async () => {
    const env = makeEnv();
    const dom = makeDomain();
    env.setDomain(dom);

    const pA = env.ensureOpen('A');   // opens A (still in flight)
    const pB = env.ensureOpen('B');   // supersedes A; opens B (in flight)

    dom._resolve('A', 'hA');          // stale resolution lands first
    await pA;
    dom._resolve('B', 'hB');          // current resolution
    await pB;

    assert.strictEqual(env.snap().key, 'B', 'the current device is installed');
    assert.strictEqual(env.snap().handle.id, 'hB');
    assert.deepStrictEqual(dom._calls.close, ['A'],
        'the superseded session must be closed, not leaked; the current one kept');
});

await t('an open resolving after teardown self-closes instead of resurrecting a handle', async () => {
    const env = makeEnv();
    const dom = makeDomain();
    env.setDomain(dom);

    const pA = env.ensureOpen('A');
    env.disconnect();                 // modal close / Stop before A resolved
    dom._resolve('A', 'hA');
    await pA;

    assert.strictEqual(env.snap().handle, null, 'no handle resurrected onto the torn-down session');
    assert.deepStrictEqual(dom._calls.close, ['A'], 'the orphaned ref self-closes');
});

await t('editorStopRecordMidi releases the domain session (it hides the modal)', () => {
    const stopBody = extractArrow('editorStopRecordMidi');
    assert.ok(/_recMidiDisconnectDomain\(\)/.test(stopBody),
        'Stop hides the modal, so it must call _recMidiDisconnectDomain() to release the refcounted session');
});

    console.log(`\n${pass} passed, ${fail} failed`);
    if (fail) process.exit(1);
})();
