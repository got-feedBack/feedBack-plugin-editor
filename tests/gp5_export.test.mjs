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
import {
    _gp5ExportGuardPure, _gp5ExportNamePure, _gp5ExportHttpMessagePure,
} from '../src/gp5-export.js';
import { _tabPreviewUrlPure } from '../src/tab-preview.js';

let pass = 0, fail = 0;
function t(name, fn) {
    try { fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}

// ── 1. guard truth table ─────────────────────────────────────────────────────
t('guard: no arrangements → load a song first', () => {
    const g = _gp5ExportGuardPure('song.feedpak', 'Lead', false);
    assert.strictEqual(g.ok, false);
    assert.match(g.reason, /Load a song first/);
});

t('guard: keys / piano / synth / drums parts are refused (no tab)', () => {
    for (const nm of ['Keys', 'Piano', 'Keyboard 2', 'Synth Lead', 'Drums', 'Drums (kit)']) {
        const g = _gp5ExportGuardPure('song.feedpak', nm, true);
        assert.strictEqual(g.ok, false, nm + ' should be refused');
        assert.match(g.reason, /fretted tracks/);
    }
});

t('guard: fretted part but no saved filename → save first', () => {
    const g = _gp5ExportGuardPure('', 'Lead', true);
    assert.strictEqual(g.ok, false);
    assert.match(g.reason, /Save the song first/);
});

t('guard: a fretted, saved part is OK', () => {
    const g = _gp5ExportGuardPure('song.feedpak', 'Lead', true);
    assert.deepStrictEqual(g, { ok: true, reason: '' });
    // a name that merely CONTAINS "keys" mid-string is still fretted (start-anchored)
    assert.strictEqual(_gp5ExportGuardPure('song.feedpak', 'Rhythm (keys double)', true).ok, true);
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

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
