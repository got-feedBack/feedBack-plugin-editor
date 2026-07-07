'use strict';
/*
 * Tests for the section-completeness strip's pure core (@pure:section-coverage):
 * _sectionCoveragePure marks each section span with whether the active
 * arrangement has any note in it — the ambient "where is this chart still
 * empty" indicator drawn as a thin band over the section bar.
 *
 * Display feature, so there's no undoable command to round-trip; the habits
 * that bite here are adversarial inputs and proving the helper uses ALL its
 * arguments (notes AND duration change the result). Every case drives the
 * real function.
 *
 * Run: node tests/section_coverage.test.js
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const src = fs.readFileSync(path.join(__dirname, '..', 'screen.js'), 'utf8');
const m = src.match(/\/\* @pure:section-coverage:start \*\/[\s\S]*?\/\* @pure:section-coverage:end \*\//);
if (!m) {
    console.error('FAIL: @pure:section-coverage block not found in screen.js');
    process.exit(1);
}
const { _sectionCoveragePure } = new Function(
    '"use strict";' + m[0] + '\nreturn { _sectionCoveragePure };'
)();

const sec = (t, name) => ({ name: name || 's', start_time: t });

let pass = 0, fail = 0;
function t(name, fn) {
    try { fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}

t('marks each span by whether a note falls inside it', () => {
    const sections = [sec(0, 'intro'), sec(4, 'verse'), sec(8, 'chorus')];
    // A note in the verse only.
    const cov = _sectionCoveragePure(sections, [5.0], 12);
    assert.deepStrictEqual(cov.map(c => c.hasContent), [false, true, false]);
    assert.deepStrictEqual(cov.map(c => [c.start, c.end]), [[0, 4], [4, 8], [8, 12]]);
});

t('boundaries are half-open: a note on a boundary belongs to the LATER section', () => {
    const sections = [sec(0), sec(4)];
    const cov = _sectionCoveragePure(sections, [4.0], 8);
    assert.deepStrictEqual(cov.map(c => c.hasContent), [false, true], 't=4 is in [4,8), not [0,4)');
});

t('the last section runs to the song duration', () => {
    const cov = _sectionCoveragePure([sec(0), sec(6)], [7.5], 10);
    assert.deepStrictEqual(cov.map(c => [c.start, c.end]), [[0, 6], [6, 10]]);
    assert.strictEqual(cov[1].hasContent, true);
});

t('unknown/zero duration → the last section is open-ended and still detects content', () => {
    const cov = _sectionCoveragePure([sec(0), sec(6)], [99], 0);
    assert.strictEqual(cov[1].end, Infinity);
    assert.strictEqual(cov[1].hasContent, true, 'a far-future note still counts in the open span');
});

t('uses BOTH arguments — notes AND duration change the result', () => {
    const sections = [sec(0), sec(4)];
    // Different note sets → different coverage.
    assert.notDeepStrictEqual(
        _sectionCoveragePure(sections, [1], 8).map(c => c.hasContent),
        _sectionCoveragePure(sections, [5], 8).map(c => c.hasContent));
    // Different duration moves the last span's end (proves `duration` is read).
    assert.strictEqual(_sectionCoveragePure([sec(0)], [], 10)[0].end, 10);
    assert.strictEqual(_sectionCoveragePure([sec(0)], [], 20)[0].end, 20);
});

t('sections are sorted defensively; note before the first section counts for none', () => {
    const cov = _sectionCoveragePure([sec(8, 'c'), sec(0, 'a'), sec(4, 'b')], [2.0], 12);
    assert.deepStrictEqual(cov.map(c => c.start), [0, 4, 8], 'sorted');
    // The note at 2.0 is in section a's [0,4) window.
    assert.deepStrictEqual(cov.map(c => c.hasContent), [true, false, false]);
});

t('non-finite section start_times are dropped', () => {
    const cov = _sectionCoveragePure(
        [sec(0), { name: 'bad', start_time: NaN }, sec(5)], [6], 10);
    assert.strictEqual(cov.length, 2);
    assert.deepStrictEqual(cov.map(c => c.start), [0, 5]);
});

t('degenerate inputs never throw and no-op to []', () => {
    assert.deepStrictEqual(_sectionCoveragePure([], [1], 10), []);
    assert.deepStrictEqual(_sectionCoveragePure(null, [1], 10), []);
    assert.deepStrictEqual(_sectionCoveragePure([sec(0)], null, 10)[0].hasContent, false);
    assert.deepStrictEqual(_sectionCoveragePure([sec(0)], [NaN, undefined], 10)[0].hasContent, false);
});

// ── boundary: the last span's upper edge is INCLUSIVE and covers trailing
// content, so a note at/past a stale or short duration is never invisible.
t('a note exactly at the duration counts in the last section (inclusive edge)', () => {
    const cov = _sectionCoveragePure([sec(0), sec(4)], [8.0], 8);
    assert.deepStrictEqual(cov.map(c => c.hasContent), [false, true], 't==dur is in the last span');
    assert.strictEqual(cov[1].end, 8, 'last span still ends at the duration when no note is past it');
});

t('notes beyond a finite duration still count, and the last span extends to reach them', () => {
    const cov = _sectionCoveragePure([sec(0), sec(6)], [15], 10);
    assert.deepStrictEqual(cov.map(c => c.hasContent), [false, true], 'a note past dur is not invisible');
    assert.strictEqual(cov[1].end, 15, 'last span end clamps up to the last note time (max(dur, lastNote))');
});

t('the inclusive last edge does NOT double-count an interior boundary note', () => {
    // Note exactly on the interior boundary (secs[1]) belongs ONLY to the
    // later (last) span — the previous span stays half-open.
    const cov = _sectionCoveragePure([sec(0), sec(4), sec(8)], [4.0], 12);
    assert.deepStrictEqual(cov.map(c => c.hasContent), [false, true, false]);
});

t('duplicate start_times make a harmless zero-width span (behavior lock)', () => {
    const cov = _sectionCoveragePure([sec(0), sec(4), sec(4), sec(8)], [5], 12);
    assert.deepStrictEqual(cov.map(c => [c.start, c.end]), [[0, 4], [4, 4], [4, 8], [8, 12]]);
    // The [4,4) zero-width span can never hold a note; the note at 5 lands in [4,8).
    assert.deepStrictEqual(cov.map(c => c.hasContent), [false, false, true, false]);
});

// ── memoization wiring. The cross-frame memo (`_sectionCoverage`) lives
// outside the @pure block — it reads browser globals (S, notes(), the canvas)
// so it can't be evaluated in isolation here. Assert on the source that the
// per-frame recompute is gone and the edit-generation invalidation is wired,
// which is what proves coverage updates after an edit without recomputing
// every frame.
t('drawSections uses the memo, not a per-frame recompute', () => {
    assert.ok(/const cov = _sectionCoverage\(\);/.test(src),
        'drawSections should call the memoized _sectionCoverage()');
    const fnStart = src.indexOf('function drawSections');
    const nextFnStart = src.indexOf('\nfunction ', fnStart + 1);
    const fnBody = src.slice(fnStart, nextFnStart === -1 ? undefined : nextFnStart);
    assert.ok(!/_sectionCoveragePure\(/.test(fnBody),
        'drawSections must not call the O(N) pure helper directly every frame');
});

t('the coverage memo is invalidated on edit via _afterEdit()', () => {
    const body = src.slice(src.indexOf('_afterEdit() {'), src.indexOf('_afterEdit() {') + 400);
    assert.ok(/_coverageEditGen\+\+/.test(body),
        '_afterEdit() must bump _coverageEditGen so in-place note moves invalidate the memo');
    assert.ok(/_coverageEditGen[\s\S]*?_covCache/.test(src),
        'the memo must key on the edit generation counter');
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
