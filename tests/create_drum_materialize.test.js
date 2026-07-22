'use strict';
/*
 * #336 regression: the create/import completion path (editorApplyCreateResult)
 * must MATERIALIZE the drums arrangement. It installs S.arrangements and then
 * assigns S.drumTab from the import's `drum_tab`, but pre-fix it never called
 * syncDrumArrangement(S) — so a freshly imported drum song had NO type:"drums"
 * arrangement until it was built and reopened (loadCDLC / +Drums / drum-delete
 * undo all sync; this path was the odd one out).
 *
 * editorApplyCreateResult is async, DOM-heavy, and fires session teardown +
 * host hooks + an async stem decode, so it is pinned structurally (the
 * reorder_part.test.js precedent reads src to test an otherwise-unmountable
 * seam): the fix is a single call, in the right order, on the real function.
 * Fails pre-fix, where the call is absent.
 *
 * Run: node tests/create_drum_materialize.test.js
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'create.js'), 'utf8');

function extractFn(name) {
    const start = src.indexOf('function ' + name);
    assert.ok(start >= 0, `function ${name} must exist`);
    const open = src.indexOf('{', start);
    let depth = 0;
    for (let i = open; i < src.length; i++) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}' && --depth === 0) return src.slice(start, i + 1);
    }
    throw new Error(`unbalanced braces extracting ${name}`);
}

let pass = 0, fail = 0;
function t(name, fn) {
    try { fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}

t('create.js imports syncDrumArrangement from the drum-arrangement leaf', () => {
    assert.ok(/import\s*\{[^}]*\bsyncDrumArrangement\b[^}]*\}\s*from\s*['"]\.\/drum-arrangement\.js['"]/.test(src),
        'syncDrumArrangement must be imported to materialize the drums arrangement');
});

t('editorApplyCreateResult calls syncDrumArrangement AFTER assigning S.drumTab', () => {
    const body = extractFn('editorApplyCreateResult');
    const assignAt = body.indexOf('S.drumTab = data.drum_tab');
    const syncAt = body.indexOf('syncDrumArrangement(S)');
    assert.ok(assignAt >= 0, 'the path assigns S.drumTab from the import');
    assert.ok(syncAt >= 0, 'the path materializes the drums arrangement (syncDrumArrangement(S))');
    assert.ok(syncAt > assignAt,
        'sync must run AFTER the drumTab assignment, so it materializes the live payload');
});

// GP multi-drum split: several drum tracks arrive as `drum_parts`; the create
// path must adopt them as extra type:"drums" arrangements beside the primary.
t('create.js imports adoptDrumParts from the drum-arrangement leaf', () => {
    assert.ok(/import\s*\{[^}]*\badoptDrumParts\b[^}]*\}\s*from\s*['"]\.\/drum-arrangement\.js['"]/.test(src),
        'adoptDrumParts must be imported to materialize the EXTRA GP drum parts');
});

t('editorApplyCreateResult adopts drum_parts AFTER syncDrumArrangement (extras beside the primary)', () => {
    const body = extractFn('editorApplyCreateResult');
    const syncAt = body.indexOf('syncDrumArrangement(S)');
    const adoptAt = body.indexOf('adoptDrumParts(S, data.drum_parts)');
    assert.ok(adoptAt >= 0, "the path adopts the import's extra drum_parts");
    assert.ok(adoptAt > syncAt,
        'adopt must run AFTER the primary is materialized, so the extras append beside it');
    assert.ok(/Array\.isArray\(data\.drum_parts\)\s*&&\s*data\.drum_parts\.length/.test(body),
        'the adopt is guarded on data.drum_parts being a non-empty list (a single-drum import never calls it)');
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
