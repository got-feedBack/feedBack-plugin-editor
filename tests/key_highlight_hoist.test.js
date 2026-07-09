'use strict';
/*
 * Regression guard for the in-key-highlight perf hoist.
 *
 * _drawPianoNote runs once PER visible note, and drawNotes loops every visible
 * note on every draw() (playback + scroll). The active-highlight lookup chains
 * to localStorage.getItem, so resolving it per note was O(visibleNotes)
 * synchronous storage reads per frame. The fix hoists the lookup to once per
 * draw in drawNotes and passes it into _drawPianoNote as a parameter.
 *
 * This is a pure-perf change with no observable behavior delta, so it is pinned
 * by construction over the source: _drawPianoNote must take the highlight as an
 * argument and must not resolve it (or touch storage) itself, and drawNotes
 * must hoist the single lookup and thread it through.
 *
 * Run: node tests/key_highlight_hoist.test.js
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');

function body(name) {
    // Grab the function body from `function name(` to its matching close brace,
    // then strip line comments so prose (which may mention localStorage etc.)
    // never trips the code-shape assertions below.
    const start = src.indexOf('function ' + name + '(');
    assert.notStrictEqual(start, -1, name + ' should exist in screen.js');
    const open = src.indexOf('{', start);
    let depth = 0;
    for (let i = open; i < src.length; i++) {
        const c = src[i];
        if (c === '{') depth++;
        else if (c === '}') {
            depth--;
            if (depth === 0) {
                return src.slice(start, i + 1).replace(/\/\/[^\n]*/g, '');
            }
        }
    }
    throw new Error('unbalanced braces scanning ' + name);
}

let pass = 0, fail = 0;
function t(name, fn) {
    try { fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}

t('_drawPianoNote takes the highlight as a parameter', () => {
    const sig = src.match(/function _drawPianoNote\(([^)]*)\)/);
    assert(sig, 'signature found');
    const params = sig[1].split(',').map((s) => s.trim());
    assert(params.includes('hl'), '_drawPianoNote must accept an `hl` param, got: ' + sig[1]);
});

t('_drawPianoNote does not resolve the highlight or read storage per note', () => {
    const b = body('_drawPianoNote');
    assert(!/_activeKeyHighlight\s*\(/.test(b),
        '_drawPianoNote must not call _activeKeyHighlight() itself');
    assert(!/localStorage/.test(b),
        '_drawPianoNote must not touch localStorage');
});

t('drawNotes hoists the highlight lookup once and threads it in', () => {
    const b = body('drawNotes');
    assert(/_activeKeyHighlight\s*\(/.test(b),
        'drawNotes must resolve the highlight once');
    // Exactly one lookup for the whole loop, not one per note.
    const hits = b.match(/_activeKeyHighlight\s*\(/g) || [];
    assert.strictEqual(hits.length, 1, 'exactly one _activeKeyHighlight() call in drawNotes');
    assert(/_drawPianoNote\([^;]*\bhl\b/.test(b),
        'drawNotes must pass the hoisted hl into _drawPianoNote');
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
