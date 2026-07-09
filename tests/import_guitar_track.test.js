'use strict';
/*
 * Unit tests for the "Import Guitar / Bass from GP" feature's pure helpers in
 * screen.js:
 *   - _isGuitarBassTrack  — the track picker / backend-guard filter
 *   - _guitarImportName   — Add-case naming (bass MUST be /bass/i for 4 lanes,
 *                           keys/drums-named guitars renamed so they don't
 *                           misroute through convert_file's piano/drum path,
 *                           de-dupe against existing names)
 *   - _swapChartFields / _restoreChartFields — the Replace snapshot/rollback
 *     core behind ReplaceArrangementChartCmd (keeps name/tones, clears stale
 *     anchors/handshapes/_extendedStrings, round-trips exactly on undo).
 *
 * Extract-and-eval pattern (matches tests/bass_string_count.test.js): pull the
 * function source straight out of screen.js so the test pins the shipping code.
 *
 * Run: node tests/import_guitar_track.test.js
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

function extractFn(src, name) {
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

const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
const {
    _isGuitarBassTrack, _guitarImportName, _swapChartFields, _restoreChartFields,
} = new Function(
    '"use strict";' +
    extractFn(src, '_isGuitarBassTrack') +
    '\nconst _REPLACE_CHART_FIELDS = ' +
    // Pull the const array literal out of screen.js so the field set stays in sync.
    (() => {
        const m = src.match(/const _REPLACE_CHART_FIELDS = (\[[^\]]*\]);/);
        assert.ok(m, '_REPLACE_CHART_FIELDS array must exist');
        return m[1];
    })() + ';' +
    extractFn(src, '_guitarImportName') +
    extractFn(src, '_swapChartFields') +
    extractFn(src, '_restoreChartFields') +
    '\nreturn { _isGuitarBassTrack, _guitarImportName, _swapChartFields, _restoreChartFields };'
)();

let pass = 0, fail = 0;
function t(name, fn) {
    try { fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}

// ── _isGuitarBassTrack ────────────────────────────────────────────────
t('keeps a plain guitar track', () => {
    assert.strictEqual(_isGuitarBassTrack({ name: 'Lead', notes: 100 }), true);
});
t('keeps a bass track', () => {
    assert.strictEqual(_isGuitarBassTrack({ name: 'Bass', is_bass: true }), true);
});
t('drops piano / drums / percussion / vocal tracks', () => {
    assert.strictEqual(_isGuitarBassTrack({ is_piano: true }), false);
    assert.strictEqual(_isGuitarBassTrack({ is_drums: true }), false);
    assert.strictEqual(_isGuitarBassTrack({ is_percussion: true }), false);
    assert.strictEqual(_isGuitarBassTrack({ is_vocal: true }), false);
});
t('drops null/undefined', () => {
    assert.strictEqual(_isGuitarBassTrack(null), false);
    assert.strictEqual(_isGuitarBassTrack(undefined), false);
});

// ── _guitarImportName ─────────────────────────────────────────────────
t('a bass track is named "Bass" (matches /bass/i → 4 lanes)', () => {
    const n = _guitarImportName({ name: 'Fingered Bass', is_bass: true }, []);
    assert.strictEqual(n, 'Bass');
    assert.ok(/bass/i.test(n));
});
t('a second bass de-dupes to "Bass 2"', () => {
    const n = _guitarImportName({ name: 'Bass', is_bass: true }, ['Lead', 'Bass']);
    assert.strictEqual(n, 'Bass 2');
});
t('a guitar keeps its GP track name', () => {
    assert.strictEqual(_guitarImportName({ name: 'Rhythm' }, ['Lead']), 'Rhythm');
});
t('a guitar named collision de-dupes', () => {
    assert.strictEqual(_guitarImportName({ name: 'Lead' }, ['Lead']), 'Lead 2');
    assert.strictEqual(_guitarImportName({ name: 'Lead' }, ['Lead', 'Lead 2']), 'Lead 3');
});
t('a nameless guitar falls back to "Lead"', () => {
    assert.strictEqual(_guitarImportName({ name: '' }, []), 'Lead');
    assert.strictEqual(_guitarImportName({ name: '   ' }, []), 'Lead');
});
t('a guitar named "Keys…"/"Drums…" is renamed so it does not misroute', () => {
    // convert_file dispatches to the piano/drum converter BY NAME — a guitar
    // track literally named "Keys 1" must not be sent through as "Keys 1".
    assert.strictEqual(_guitarImportName({ name: 'Keys 1' }, []), 'Lead');
    assert.strictEqual(_guitarImportName({ name: 'Drums (gtr)' }, []), 'Lead');
    assert.strictEqual(_guitarImportName({ name: 'Synth Lead' }, []), 'Lead');
});
t('de-dupe is case-insensitive', () => {
    assert.strictEqual(_guitarImportName({ name: 'lead' }, ['LEAD']), 'lead 2');
});

// ── _swapChartFields / _restoreChartFields ────────────────────────────
function makeTargetArr() {
    return {
        name: 'Lead',
        tones: { base: 'clean', changes: [{ ref: 't1' }] },
        tuning: [0, 0, 0, 0, 0, 0],
        capo: 0,
        _extendedStrings: 1,                 // was a 7-string
        notes: [{ time: 1, string: 6, fret: 3 }],
        chords: [{ time: 2, notes: [] }],
        chord_templates: [{ name: 'old' }],
        anchors_user: [{ time: 1, fret: 3 }],
        anchors: [{ time: 1, fret: 3, width: 4 }],   // legacy auto hand-positions
        phrases: [{ start_time: 0, levels: [] }],    // time-anchored song structure
        handshapes: [{ chord_id: 9 }],
    };
}
function makeIncoming() {
    return {
        name: 'Rhythm',                      // must NOT win — target keeps its name
        tuning: [0, 0, 0, 0],                // 4-string bass tuning
        capo: 2,
        notes: [{ time: 5, string: 0, fret: 7 }, { time: 6, string: 1, fret: 2 }],
        chords: [],
        chord_templates: [{ name: 'new' }],
    };
}

t('replace overwrites the chart but keeps name + tones', () => {
    const arr = makeTargetArr();
    const inc = makeIncoming();
    _swapChartFields(arr, inc);
    assert.strictEqual(arr.name, 'Lead');                 // kept
    assert.strictEqual(inc.name, 'Lead');                 // incoming forced to match
    assert.deepStrictEqual(arr.tones, { base: 'clean', changes: [{ ref: 't1' }] }); // kept
    assert.strictEqual(arr.notes.length, 2);              // overwritten
    assert.strictEqual(arr.notes[0].fret, 7);
    assert.deepStrictEqual(arr.tuning, [0, 0, 0, 0]);      // overwritten
    assert.strictEqual(arr.capo, 2);
    assert.strictEqual(arr.chord_templates[0].name, 'new');
});

t('replace clears stale derived data (anchors / handshapes / _extendedStrings)', () => {
    const arr = makeTargetArr();
    _swapChartFields(arr, makeIncoming());
    assert.ok(!('anchors_user' in arr), 'anchors_user cleared');
    assert.ok(!('anchors' in arr), 'legacy auto anchors cleared');
    assert.ok(!('handshapes' in arr), 'handshapes cleared');
    assert.ok(!('_extendedStrings' in arr), '_extendedStrings cleared');
});

t('replace KEEPS phrases (time-anchored song structure, not note-derived)', () => {
    const arr = makeTargetArr();
    _swapChartFields(arr, makeIncoming());
    assert.deepStrictEqual(arr.phrases, [{ start_time: 0, levels: [] }]);
});

t('rollback restores the exact pre-swap arrangement', () => {
    const arr = makeTargetArr();
    const before = JSON.parse(JSON.stringify(arr));
    const snap = _swapChartFields(arr, makeIncoming());
    _restoreChartFields(arr, snap);
    assert.deepStrictEqual(arr, before);
});

t('rollback deletes fields that were absent before the swap', () => {
    // A target with NO anchors/handshapes/_extendedStrings must not gain
    // `undefined`-valued keys after a swap+rollback round-trip.
    const arr = {
        name: 'Bass', tones: null, tuning: [0, 0, 0, 0], capo: 0,
        notes: [{ time: 0, string: 0, fret: 0 }], chords: [], chord_templates: [],
    };
    const before = JSON.parse(JSON.stringify(arr));
    const snap = _swapChartFields(arr, makeIncoming());
    _restoreChartFields(arr, snap);
    assert.deepStrictEqual(arr, before);
    assert.ok(!('anchors_user' in arr));
    assert.ok(!('_extendedStrings' in arr));
});

t('a missing incoming.tuning/capo leaves the target values intact', () => {
    const arr = makeTargetArr();
    _swapChartFields(arr, { notes: [], chords: [], chord_templates: [] });
    assert.deepStrictEqual(arr.tuning, [0, 0, 0, 0, 0, 0]);  // unchanged
    assert.strictEqual(arr.capo, 0);
});

t('swap deep-copies: mutating the target chart does not touch incoming', () => {
    // Guards the redo bug: the command flattens arr.notes IN PLACE after the
    // swap; if arr shared incoming's arrays, a redo would re-apply a mutated
    // (flattened) chart and duplicate chord notes.
    const arr = makeTargetArr();
    const inc = makeIncoming();
    _swapChartFields(arr, inc);
    assert.notStrictEqual(arr.notes, inc.notes);          // not the same array
    arr.notes.push({ time: 99, string: 3, fret: 9, _fromChord: true });
    arr.chord_templates[0].name = 'MUTATED';
    assert.strictEqual(inc.notes.length, 2);              // incoming untouched
    assert.strictEqual(inc.chord_templates[0].name, 'new');
});

t('redo is idempotent: a second swap from the same incoming reproduces state', () => {
    const arr = makeTargetArr();
    const inc = makeIncoming();
    // First exec, then a simulated in-place flatten mutation of the target.
    _swapChartFields(arr, inc);
    arr.notes.push({ time: 99, string: 0, fret: 0, _fromChord: true });
    const afterFirst = JSON.parse(JSON.stringify(
        (() => { const a = makeTargetArr(); _swapChartFields(a, makeIncoming()); return a; })()
    ));
    // Undo (not modeled here) then redo → swap again from the SAME incoming.
    _swapChartFields(arr, inc);
    assert.deepStrictEqual(JSON.parse(JSON.stringify(arr)), afterFirst);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
