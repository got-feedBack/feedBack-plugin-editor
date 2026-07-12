/*
 * Tempo-map guidance helper tests for src/tempo.js.
 *
 * Run: node tests/tempo_map_guidance.test.mjs
 */
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import {
    LOCK_TOOLTIP,
    _lockStatusTextPure,
    _syncAppliedMessagePure,
    _tempoMapHudTextPure,
    _tempoSyncInspectorStatePure,
} from '../src/tempo.js';

let pass = 0;
let fail = 0;
function t(name, fn) {
    try { fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}

t('uses compact guidance on narrow canvases', () => {
    const text = _tempoMapHudTextPure(12, 640);
    assert.ok(text.includes('12 measures'));
    assert.ok(text.includes('right-click barline'));
    assert.ok(text.includes('BPM / signature'));
    assert.ok(!text.includes('right-click grid'));
});

t('uses full guidance when there is room', () => {
    const text = _tempoMapHudTextPure(24, 960);
    assert.ok(text.includes('24 measures'));
    assert.ok(text.includes('drag poles to retime'));
    assert.ok(text.includes('BPM / signature/delete'));
    assert.ok(text.includes('right-click grid: mark barline'));
});

t('normalizes invalid measure counts to zero', () => {
    assert.ok(_tempoMapHudTextPure('bad', 960).includes('0 measures'));
});

t('warp import message points at the Tempo Map fine-tune path', () => {
    const text = _syncAppliedMessagePure('warp', null);
    assert.ok(text.includes('per-bar audio sync'));
    assert.ok(text.includes('Tempo Map'));
    assert.ok(/drift/i.test(text));
});

t('offset (repeats) message explains the fallback and points at Tempo Map', () => {
    const text = _syncAppliedMessagePure('offset', 'repeats');
    assert.ok(/repeats\/jumps/.test(text));
    assert.ok(text.includes('Tempo Map'));
});

t('offset (other) message is generic and points at Tempo Map', () => {
    const text = _syncAppliedMessagePure('offset', 'anchors');
    assert.ok(text.includes('could not be applied'));
    assert.ok(text.includes('Tempo Map'));
});

t('no message when no audio sync was applied', () => {
    assert.strictEqual(_syncAppliedMessagePure(undefined, undefined), '');
    assert.strictEqual(_syncAppliedMessagePure('', ''), '');
});

// ── P6 copy corrections: "barline" vocabulary + accurate lock wording ─────────
t('lock status wording is accurate and free of "sync point"', () => {
    const on = _lockStatusTextPure(true);
    const off = _lockStatusTextPure(false);
    assert.ok(/^Barline locked/.test(on));
    assert.ok(/manual edits are always kept/i.test(on), 'reassures edits persist regardless of lock');
    assert.ok(!/sync point/i.test(on) && !/sync point/i.test(off), 'no legacy "sync point" wording');
    assert.strictEqual(off, 'Barline unlocked.');
});

t('lock tooltip explains what a lock defends against (not "needed to save")', () => {
    assert.ok(/automatic re-fits/i.test(LOCK_TOOLTIP));
    assert.ok(/Fit tempo, Suggest, Modulate/.test(LOCK_TOOLTIP), 'names the re-fit operations');
    assert.ok(/not needed to save/i.test(LOCK_TOOLTIP));
    assert.ok(!/sync point/i.test(LOCK_TOOLTIP));
});

t('inspector guidance says "barline", never "sync point"', () => {
    const measures = [
        { i: 0, measure: 1, beats: 4, denominator: 4, bpm: 120, isLast: false },
        { i: 4, measure: 2, beats: 4, denominator: 4, bpm: 120, isLast: false },
        { i: 8, measure: 3, beats: 4, denominator: 4, bpm: 0, isLast: true },
    ];
    const none = _tempoSyncInspectorStatePure(measures, -1);
    assert.ok(/barline/i.test(none.hint) && !/sync point/i.test(none.hint));
    assert.ok(/interior barline/i.test(none.deleteTitle));
    // A first/last barline can't be deleted — the message must say "barline".
    const first = _tempoSyncInspectorStatePure(measures, 0);
    assert.strictEqual(first.canDelete, false);
    assert.ok(/First and final barlines/.test(first.deleteTitle));
    assert.ok(!/sync point/i.test(first.deleteTitle));
    // An interior barline deletes normally.
    const mid = _tempoSyncInspectorStatePure(measures, 4);
    assert.strictEqual(mid.canDelete, true);
    assert.strictEqual(mid.deleteTitle, 'Delete selected barline');
});

t('no user-facing string literal in tempo.js says "sync point"', () => {
    // The P6 sweep retires "sync point" from user-facing copy; it survives only
    // in comments and internal identifiers (SyncPoint, no separator). Scan every
    // line for a string literal carrying the separated lowercase form — this
    // caught the tap-tempo stale-selection status the sweep missed.
    const src = readFileSync(new URL('../src/tempo.js', import.meta.url), 'utf8');
    const offenders = src.split('\n')
        .map((line, i) => ({ line: line.trim(), n: i + 1 }))
        .filter(({ line }) => /['"`][^'"`]*sync[ -]point/.test(line));
    assert.deepStrictEqual(offenders, [], 'string literals still say "sync point"');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
