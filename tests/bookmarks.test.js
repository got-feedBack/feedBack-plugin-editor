'use strict';
/*
 * Tests for numbered bookmarks (@pure:bookmarks block + the shortcut-
 * profile dispatch): nine per-song time markers, Shift+Alt+1-9 sets/clears
 * at the cursor, Alt+1-9 jumps. Editor-side localStorage only — never pack
 * data. These fail on main, where none of this exists.
 *
 * Run: node tests/bookmarks.test.js
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

const B = new Function(
    '"use strict";' + extract('bookmarks')
    + '\nreturn { _bookmarkStorageKeyPure, _bookmarksParsePure, _bookmarkTogglePure };'
)();

const { _editorFeedbackCommandForKeyPure, _editorEofCommandForKeyPure } = new Function(
    '"use strict";' + extract('shortcut-profile')
    + '\nreturn { _editorFeedbackCommandForKeyPure, _editorEofCommandForKeyPure };'
)();

let pass = 0, fail = 0;
function t(name, fn) {
    try { fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}

// ── Storage / parsing ────────────────────────────────────────────────

t('storage key is per-song', () => {
    assert.strictEqual(B._bookmarkStorageKeyPure('song.sloppak'), 'editorBookmarks:song.sloppak');
    assert.strictEqual(B._bookmarkStorageKeyPure(''), 'editorBookmarks:');
});

t('parse survives junk: bad JSON, arrays, out-of-range slots, bad times', () => {
    assert.deepStrictEqual(B._bookmarksParsePure('not json'), {});
    assert.deepStrictEqual(B._bookmarksParsePure('[1,2]'), {});
    assert.deepStrictEqual(B._bookmarksParsePure(null), {});
    assert.deepStrictEqual(
        B._bookmarksParsePure('{"1": 3.5, "0": 1, "10": 2, "2": -4, "3": "x", "9": 0}'),
        { 1: 3.5, 9: 0 },
        'only slots 1-9 with finite non-negative times survive');
});

// ── Toggle semantics ─────────────────────────────────────────────────

t('setting a slot places it (3 dp); setting again at the same spot clears it', () => {
    const a = B._bookmarkTogglePure({}, 3, 12.34567);
    assert.deepStrictEqual(a, { 3: 12.346 });
    const b = B._bookmarkTogglePure(a, 3, 12.346);
    assert.deepStrictEqual(b, {}, 'same-spot set clears');
});

t('setting a slot elsewhere moves it; other slots untouched', () => {
    const a = { 1: 5, 2: 8 };
    const b = B._bookmarkTogglePure(a, 2, 20);
    assert.deepStrictEqual(b, { 1: 5, 2: 20 });
    assert.deepStrictEqual(a, { 1: 5, 2: 8 }, 'input map is never mutated');
});

t('invalid input returns the SAME map (identity = skip persisting)', () => {
    const a = { 1: 5 };
    assert.strictEqual(B._bookmarkTogglePure(a, 0, 3), a);
    assert.strictEqual(B._bookmarkTogglePure(a, 10, 3), a);
    assert.strictEqual(B._bookmarkTogglePure(a, 2, NaN), a);
    assert.strictEqual(B._bookmarkTogglePure(a, 2, -1), a);
});

// ── Key dispatch (both profiles, physical-key based) ─────────────────

function keyEvent(over) {
    return { key: '', code: '', ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...over };
}

t('Alt+digit jumps, Shift+Alt+digit sets — in both profiles, via e.code', () => {
    for (const dispatch of [_editorFeedbackCommandForKeyPure, _editorEofCommandForKeyPure]) {
        assert.strictEqual(
            dispatch(keyEvent({ code: 'Digit4', key: '4', altKey: true }), 'note'),
            'gotoBookmark:4');
        assert.strictEqual(
            dispatch(keyEvent({ code: 'Digit4', key: '$', altKey: true, shiftKey: true }), 'note'),
            'setBookmark:4', 'shifted digit key value ($) still resolves via e.code');
    }
});

t('plain digits still set frets; Ctrl+Alt+digit stays unclaimed', () => {
    assert.strictEqual(
        _editorFeedbackCommandForKeyPure(keyEvent({ code: 'Digit4', key: '4' }), 'note'),
        'setFretDigit:4');
    assert.strictEqual(
        _editorFeedbackCommandForKeyPure(
            keyEvent({ code: 'Digit4', key: '4', altKey: true, ctrlKey: true }), 'note'),
        null);
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
