'use strict';
/*
 * Stateful regression test for the read-only Tab preview's stale-render
 * guard — the open/close/refresh path, NOT a @pure block, because that's
 * exactly where the real races live (the pure helpers are already well
 * covered in tab_preview.test.js).
 *
 * The failure path reads the error body with `await resp.text()`, which is
 * another suspension point. A newer Refresh can supersede the render during
 * that await; without a seq re-check afterwards the stale error would
 * destroy the newer render's alphaTab api and stomp its status. This drives
 * that exact interleaving deterministically: the faked response bumps the
 * shared sequence counter mid-body-read. Fails on pre-fix src/main.js (no
 * re-check → destroy called, status stomped).
 *
 * Run: node tests/tab_preview_race.test.js
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'tab-preview.js'), 'utf8');
const m = src.match(/async function _tabPreviewRender\(\)\s*\{[\s\S]*?\n\}/);
if (!m) {
    console.error('FAIL: _tabPreviewRender not found in src/tab-preview.js');
    process.exit(1);
}

(async () => {
    let destroyCalls = 0;
    let lastStatus = '';
    // `env` backs every free identifier in _tabPreviewRender via `with`, so
    // the extracted function and the fake fetch share ONE _tabPreviewSeq.
    const env = {
        _tabPreviewSeq: 0,
        _tabPreviewApi: null,
        S: { arrangements: [{ name: 'Lead' }], currentArr: 0, filename: 'song.sloppak' },
        alphaTab: {},
        document: { getElementById: () => ({ innerHTML: '' }) },
        // _tabPreviewRender resolves the part's kind via arrKind before the
        // guard; this race test stubs the guard, so a trivial resolver suffices.
        arrKind: () => 'guitar',
        _tabPreviewGuardPure: () => ({ ok: true, reason: '' }),
        _tabPreviewUrlPure: () => '/api/plugins/tabview/gp5/song.sloppak?arrangement=0&t=1',
        _tabPreviewHttpMessagePure: (status) => 'Preview failed (' + status + ')',
        _tabPreviewLoadScript: () => Promise.resolve(),
        _tabPreviewDestroyApi: () => { destroyCalls++; },
        _tabPreviewStatus: (msg) => { lastStatus = msg; },
        // Non-ok response; reading the body simulates a newer Refresh landing
        // mid-await by advancing the shared sequence counter.
        fetch: () => Promise.resolve({
            ok: false,
            status: 500,
            text: async () => { env._tabPreviewSeq++; return 'stale server error'; },
            arrayBuffer: async () => new ArrayBuffer(0),
        }),
    };

    const render = new Function('env', 'with (env) { ' + m[0] + '; return _tabPreviewRender; }')(env);
    await render();

    let pass = 0, fail = 0;
    function t(name, cond) {
        if (cond) { pass++; console.log('  ok   ' + name); }
        else { fail++; console.error('  FAIL ' + name); }
    }

    t('a superseded failure response does NOT destroy the newer render',
        destroyCalls === 0);
    t('a superseded failure response does NOT stomp the newer render status',
        lastStatus !== 'Preview failed (500)');

    console.log(`\n${pass} passed, ${fail} failed`);
    if (fail) process.exit(1);
})().catch((e) => { console.error('FAIL: ' + (e && e.stack || e)); process.exit(1); });
