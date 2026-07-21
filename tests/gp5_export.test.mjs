/*
 * File ▸ Export ▸ Guitar Pro (.gp5) — gap-audit #4. Downloads the GP5 bytes the
 * Tab View plugin converts the current fretted part's saved pack into (the same
 * endpoint the read-only Tab preview engraves). The download + fetch are DOM/
 * network (live-verified); every decision-shaped bit lives in pure helpers,
 * pinned here:
 *   1. _gp5ExportGuardPure — who can export + the exact reason when they can't.
 *   2. _gp5ExportNamePure — the download filename (extension drop + part + sanitise).
 *   3. _gp5ExportHttpMessagePure — the honest failure messages.
 *   4. the conversion endpoint is REUSED from tab-preview.js, not duplicated.
 *
 * Run: node --test tests/gp5_export.test.mjs
 */
import assert from 'node:assert';
import fs from 'node:fs';
import {
    _gp5ExportGuardPure, _gp5ExportNamePure, _gp5ExportHttpMessagePure,
} from '../src/gp5-export.js';
import { _tabPreviewUrlPure } from '../src/tab-preview.js';
import { arrKind } from '../src/instrument.js';

let pass = 0, fail = 0;
function t(name, fn) {
    try { fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}
async function ta(name, fn) {
    try { await fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}

// ── 1. guard truth table (the guard now takes the RESOLVED kind, not a name) ──
t('guard: no arrangements → load a song first', () => {
    const g = _gp5ExportGuardPure('song.feedpak', 'guitar', false);
    assert.strictEqual(g.ok, false);
    assert.match(g.reason, /Load a song first/);
});

t('guard: keys / drums kinds are refused (no tab)', () => {
    for (const kind of ['keys', 'drums']) {
        const g = _gp5ExportGuardPure('song.feedpak', kind, true);
        assert.strictEqual(g.ok, false, kind + ' should be refused');
        assert.match(g.reason, /fretted tracks/);
    }
});

t('guard: fretted part but no saved filename → save first', () => {
    const g = _gp5ExportGuardPure('', 'guitar', true);
    assert.strictEqual(g.ok, false);
    assert.match(g.reason, /Save the song first/);
});

t('guard: a fretted, saved part is OK (bass and guitar are the fretted kinds)', () => {
    assert.deepStrictEqual(_gp5ExportGuardPure('song.feedpak', 'guitar', true), { ok: true, reason: '' });
    assert.strictEqual(_gp5ExportGuardPure('song.feedpak', 'bass', true).ok, true);
});

// ── 2. download filename ─────────────────────────────────────────────────────
t('name: drops the pack extension and appends the part', () => {
    assert.strictEqual(
        _gp5ExportNamePure('AC DC - Back In Black - Back In Black.feedpak', 'Lead'),
        'AC DC - Back In Black - Back In Black — Lead.gp5');
    assert.strictEqual(_gp5ExportNamePure('tune.sloppak', 'Bass'), 'tune — Bass.gp5');
    assert.strictEqual(_gp5ExportNamePure('tune.FEEDPAK', 'Lead'), 'tune — Lead.gp5', 'extension match is case-insensitive');
});

t('name: no part → just the base; missing filename → track', () => {
    assert.strictEqual(_gp5ExportNamePure('tune.feedpak', ''), 'tune.gp5');
    assert.strictEqual(_gp5ExportNamePure('tune.feedpak', null), 'tune.gp5');
    assert.strictEqual(_gp5ExportNamePure('', 'Lead'), 'track — Lead.gp5');
    assert.strictEqual(_gp5ExportNamePure(null, null), 'track.gp5');
});

t('name: strips filename-illegal characters and collapses whitespace', () => {
    assert.strictEqual(
        _gp5ExportNamePure('AC/DC: Back?.feedpak', 'Lead*'),
        'AC-DC- Back- — Lead-.gp5');
    // an unextensioned name is kept as-is (only .feedpak/.sloppak are dropped)
    assert.strictEqual(_gp5ExportNamePure('mix.gp5', 'Lead'), 'mix.gp5 — Lead.gp5');
});

// ── 3. failure messages ──────────────────────────────────────────────────────
t('http message: 404 points at the Tab View plugin / unsaved pack', () => {
    assert.match(_gp5ExportHttpMessagePure(404, ''), /Tab View plugin/);
    assert.match(_gp5ExportHttpMessagePure(404, ''), /saved pack/);
});

t('http message: 501 is the too-old host', () => {
    assert.match(_gp5ExportHttpMessagePure(501, ''), /too old/);
});

t('http message: other statuses surface the code + a trimmed body', () => {
    assert.strictEqual(_gp5ExportHttpMessagePure(500, 'boom'), 'Export failed (500): boom');
    assert.strictEqual(_gp5ExportHttpMessagePure(500, ''), 'Export failed (500)');
    const long = 'x'.repeat(300);
    assert.ok(_gp5ExportHttpMessagePure(500, long).length < 200, 'body is truncated');
});

// ── 4. the endpoint is the tab-preview one, reused (not duplicated) ───────────
t('endpoint: export fetches the same tabview GP5 URL the preview does', () => {
    const url = _tabPreviewUrlPure('AC DC - Back In Black.feedpak', 2, 12345);
    assert.match(url, /^\/api\/plugins\/tabview\/gp5\//);
    assert.match(url, /arrangement=2/);
    assert.match(url, /t=12345/);
    assert.match(url, /AC%20DC/, 'the filename is URL-encoded');
});

// ── 5. an unsaved session must not silently export a stale — or WRONG — track ─
// The converter reads the SAVED pack and indexes it by S.currentArr, clamping
// that index into the saved track list (tabview routes.py `_song_to_gp5`). So
// exporting mid-edit doesn't just drop unsaved notes: add or reorder a track
// and the clamp hands you a DIFFERENT track's bytes under the requested track's
// name. editorExportGp5 must run the session's Save / Don't Save / Cancel
// prompt BEFORE it converts. The orchestrator is DOM/network, so it is sliced
// out of the source and run against fakes (same harness as tab_preview_race).
const _src = fs.readFileSync(new URL('../src/gp5-export.js', import.meta.url), 'utf8');
const _m = _src.match(/export async function editorExportGp5\(\)\s*\{[\s\S]*?\n\}/);
assert.ok(_m, 'editorExportGp5 not found in src/gp5-export.js');

function exportEnv(overrides = {}) {
    const env = {
        S: { arrangements: [{ name: 'Lead' }], currentArr: 0, filename: 'song.feedpak' },
        statuses: [], downloads: [], fetched: [],
        setStatus: (msg) => env.statuses.push(msg),
        // The orchestrator resolves the part's kind via arrKind before the guard.
        arrKind,
        _gp5ExportGuardPure, _gp5ExportNamePure, _gp5ExportHttpMessagePure, _tabPreviewUrlPure,
        _downloadBytes: (_bytes, name) => env.downloads.push(name),
        fetch: (url) => {
            env.fetched.push(url);
            return Promise.resolve({ ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(4) });
        },
        guardSessionTransition: async () => true,   // clean session / user chose Save
        ...overrides,
    };
    // `with (env)` backs every free identifier in the sliced orchestrator.
    env.run = new Function('env',
        'with (env) { ' + _m[0].replace('export ', '') + '; return editorExportGp5; }')(env);
    return env;
}

await ta('dirty session: Cancel at the save prompt aborts before any conversion', async () => {
    const env = exportEnv({ guardSessionTransition: async () => false });
    await env.run();
    assert.deepStrictEqual(env.fetched, [], 'must not convert a pack the user declined to save');
    assert.deepStrictEqual(env.downloads, [], 'must not download anything');
    assert.match(env.statuses.join(' '), /cancelled/i);
});

await ta('dirty session: the save prompt runs BEFORE the conversion fetch', async () => {
    const order = [];
    const env = exportEnv({
        guardSessionTransition: async () => { order.push('prompt'); return true; },
    });
    env.fetch = (url) => {
        order.push('fetch');
        env.fetched.push(url);
        return Promise.resolve({ ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(4) });
    };
    await env.run();
    assert.deepStrictEqual(order, ['prompt', 'fetch']);
    assert.deepStrictEqual(env.downloads, ['song — Lead.gp5']);
});

await ta('the song can close during the prompt — guards are re-checked after the await', async () => {
    const env = exportEnv();
    env.guardSessionTransition = async () => { env.S.arrangements = []; env.S.filename = ''; return true; };
    await env.run();
    assert.deepStrictEqual(env.fetched, [], 'no conversion of a song that went away mid-prompt');
    assert.deepStrictEqual(env.downloads, []);
    assert.match(env.statuses.join(' '), /Load a song first/);
});

// ── 6. authored `type` drives the guard through the real orchestrator ─────────
// Byte-identical for untyped inputs, so these typed cases are what prove the
// conversion actually consults arrKind and not the name (the capstone payoff).
await ta('a keys-TYPED part named like a guitar is refused — identity is data', async () => {
    const env = exportEnv({
        S: { arrangements: [{ type: 'piano', name: 'Lead' }], currentArr: 0, filename: 'song.feedpak' },
    });
    await env.run();
    assert.deepStrictEqual(env.fetched, [], 'a keys part exports no tab, whatever its name');
    assert.deepStrictEqual(env.downloads, []);
    assert.match(env.statuses.join(' '), /fretted tracks/);
});

await ta('a guitar-TYPED part named "Piano" now exports — the free-rename payoff', async () => {
    const env = exportEnv({
        S: { arrangements: [{ type: 'guitar', name: 'Piano' }], currentArr: 0, filename: 'song.feedpak' },
    });
    await env.run();
    assert.deepStrictEqual(env.downloads, ['song — Piano.gp5'], 'exports under its display name');
    assert.strictEqual(env.fetched.length, 1, 'the conversion actually ran');
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
