/*
 * Suggest-position resolver — P6 / VA.3 (design V4 / V13.3).
 *
 * The ONE writer that resolves a sounding pitch → {string, fret} when a note is
 * added or pitch-moved in the read-only piano roll for a fretted part. It
 * auto-decides only when the choice is unambiguous and otherwise REFUSES
 * (resolved:null + a reason + the candidate list) so the UI confirms explicitly.
 * This is the trust-critical piece, so it is over-tested:
 *   1. _enumerateFrettedPositionsPure is the exact capo-aware inverse of the
 *      shipped _soundingPitchPure (every candidate sounds the asked pitch).
 *   2. success tiers: (a) inside the anchor window, (b) nearest the previous
 *      hand position, (c) lowest-fret / lowest-string.
 *   3. all four refusals: out-of-range, string-occupied, outside-anchor-window,
 *      open-vs-fretted — plus adversarial input (NaN pitch, zero anchors, all
 *      strings occupied, empty tuning).
 *   4. _activeAnchorAtPure window selection (last-at-or-before; pickup borrows
 *      the first; empty ⇒ null).
 *
 * These reference P6 helpers absent on main, so the suite fails on main.
 *
 * Run: node tests/suggest_position.test.mjs
 */
import assert from 'node:assert';
import { _soundingPitchPure } from '../src/lanes.js';
import {
    _activeAnchorAtPure, _enumerateFrettedPositionsPure, _suggestPositionPure,
} from '../src/position.js';

// Everything under test is a real import now: _soundingPitchPure (src/lanes.js)
// and the position pures (src/position.js). No sandbox.

// Standard 6-string guitar, low → high: E2 A2 D3 G3 B3 E4.
const OPEN = [40, 45, 50, 55, 59, 64];
const TUN = [0, 0, 0, 0, 0, 0];
const ctx = (openMidi = OPEN, tuning = TUN, capo = 0) => ({ openMidi, tuning, capo });

let pass = 0, fail = 0;
function t(name, fn) {
    try { fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}

// ── 1. enumerate is the inverse of _soundingPitchPure ────────────────────────
t('every enumerated position sounds exactly the asked pitch (inverse of _soundingPitchPure)', () => {
    for (let pitch = 40; pitch <= 88; pitch++) {
        for (const p of _enumerateFrettedPositionsPure(pitch, OPEN, TUN, 0)) {
            assert.strictEqual(_soundingPitchPure(OPEN, TUN, 0, p.string, p.fret), pitch,
                `pitch ${pitch} @ s${p.string} f${p.fret}`);
        }
    }
});
t('enumerate is capo-aware (a capo shifts every fret down by the capo)', () => {
    const noCapo = _enumerateFrettedPositionsPure(56, OPEN, TUN, 0);   // G#3
    const capo2 = _enumerateFrettedPositionsPure(56, OPEN, TUN, 2);
    for (const p of capo2) assert.strictEqual(_soundingPitchPure(OPEN, TUN, 2, p.string, p.fret), 56);
    // same pitch, capo 2 ⇒ every reachable fret is 2 lower (and frets that would go < 0 drop out)
    assert.ok(capo2.every(p => noCapo.some(q => q.string === p.string && q.fret === p.fret + 2)));
});
t('out-of-range pitch and NaN both enumerate to nothing', () => {
    assert.deepStrictEqual(_enumerateFrettedPositionsPure(200, OPEN, TUN, 0), []);
    assert.deepStrictEqual(_enumerateFrettedPositionsPure(NaN, OPEN, TUN, 0), []);
    assert.deepStrictEqual(_enumerateFrettedPositionsPure(56, null, TUN, 0), []);
});

// ── 2. success tiers ─────────────────────────────────────────────────────────
t('(a) exactly one candidate inside the anchor window is chosen', () => {
    // pitch 56 = G#3 → frets s0:16 s1:11 s2:6 s3:1. Window 5..8 ⇒ only s2/6.
    const r = _suggestPositionPure(56, 0, null, [{ time: 0, fret: 5, width: 4 }], null, ctx());
    assert.deepStrictEqual(r.resolved, { string: 2, fret: 6 });
    assert.strictEqual(r.reason, null);
});
t('(b) nearest the previous hand position wins among in-window candidates', () => {
    // Window 0..12 admits s1/11, s2/6, s3/1 (no open, 16 is out). prev fret 10 ⇒ 11.
    const r = _suggestPositionPure(56, 1, { fret: 10 }, [{ time: 0, fret: 0, width: 12 }], null, ctx());
    assert.deepStrictEqual(r.resolved, { string: 1, fret: 11 });
});
t('(c) lowest fret then lowest string breaks the final tie', () => {
    // No anchor, no prev ⇒ all fretted candidates eligible ⇒ lowest fret = s3/1.
    const r = _suggestPositionPure(56, 0, null, [], null, ctx());
    assert.deepStrictEqual(r.resolved, { string: 3, fret: 1 });
});

// ── 3. the four refusals ─────────────────────────────────────────────────────
t('REFUSE out-of-range', () => {
    const r = _suggestPositionPure(200, 0, null, [], null, ctx());
    assert.strictEqual(r.resolved, null);
    assert.strictEqual(r.reason, 'out-of-range');
});
t('REFUSE when the only viable strings are all occupied', () => {
    const r = _suggestPositionPure(56, 0, null, [], new Set([0, 1, 2, 3]), ctx());
    assert.strictEqual(r.resolved, null);
    assert.strictEqual(r.reason, 'string-occupied');
    assert.ok(r.candidates.length, 'candidates still reported for the popover');
});
t('REFUSE when reachable only outside the anchor window', () => {
    // pitch 56 frets are 1..16; a window at 20..21 admits none (and no open string).
    const r = _suggestPositionPure(56, 0, null, [{ time: 0, fret: 20, width: 2 }], null, ctx());
    assert.strictEqual(r.resolved, null);
    assert.strictEqual(r.reason, 'outside-anchor-window');
});
t('REFUSE open-vs-fretted — a real articulation choice', () => {
    // pitch 55 = G3 → open s3/0 AND fretted s2/5, s1/10, s0/15 all playable.
    const r = _suggestPositionPure(55, 0, null, [], null, ctx());
    assert.strictEqual(r.resolved, null);
    assert.strictEqual(r.reason, 'open-vs-fretted');
});

// ── adversarial ──────────────────────────────────────────────────────────────
t('zero anchors ⇒ no window constraint, still resolves', () => {
    const r = _suggestPositionPure(56, 0, null, [], null, ctx());
    assert.deepStrictEqual(r.resolved, { string: 3, fret: 1 });
});
t('NaN pitch ⇒ out-of-range refusal, no throw', () => {
    const r = _suggestPositionPure(NaN, 0, null, [], null, ctx());
    assert.strictEqual(r.reason, 'out-of-range');
});
t('an occupied string is skipped but a free one is still found', () => {
    // pitch 56: block s3 (the default lowest-fret pick) ⇒ next is s2/6.
    const r = _suggestPositionPure(56, 0, null, [], new Set([3]), ctx());
    assert.deepStrictEqual(r.resolved, { string: 2, fret: 6 });
});
t('a drop-D style detune is honoured (tuning offset in the inverse)', () => {
    const dropD = [-2, 0, 0, 0, 0, 0];   // low string down a tone → open D2 = 38
    const r = _enumerateFrettedPositionsPure(38, OPEN, dropD, 0);
    assert.ok(r.some(p => p.string === 0 && p.fret === 0), 'low string open now sounds D2');
});

// ── 4. _activeAnchorAtPure ───────────────────────────────────────────────────
t('_activeAnchorAtPure picks the last anchor at or before the time', () => {
    const anchors = [{ time: 0, fret: 1 }, { time: 5, fret: 5 }, { time: 10, fret: 9 }];
    assert.strictEqual(_activeAnchorAtPure(anchors, 7).fret, 5);
    assert.strictEqual(_activeAnchorAtPure(anchors, 0).fret, 1);
    assert.strictEqual(_activeAnchorAtPure(anchors, 100).fret, 9);
});
t('_activeAnchorAtPure lets a pickup (before the first anchor) borrow the first', () => {
    const anchors = [{ time: 2, fret: 3 }, { time: 8, fret: 7 }];
    assert.strictEqual(_activeAnchorAtPure(anchors, 0).fret, 3);
});
t('_activeAnchorAtPure on an empty/invalid list is null', () => {
    assert.strictEqual(_activeAnchorAtPure([], 5), null);
    assert.strictEqual(_activeAnchorAtPure(null, 5), null);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
