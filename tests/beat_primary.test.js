'use strict';
/*
 * Beat-primary note model — Phase A2 (charrette §1.3/§1.4/§1.10).
 *
 * note.beat (a float) is the truth; note.time (seconds) is a cache = timeOf(beat).
 * This is the trust-critical PR, so it is over-tested. All of these reference the
 * A2 helpers (_liftAllBeats/_reprojectAll/_eachTimed/_stripBeatsFromSaveBody),
 * none of which exist on main, so the whole suite fails on main.
 *
 *   1. GOLDEN GATE: lift+reproject reproduces the pre-A2 _applyTempoRemap
 *      (all-parts ride) to 3 dp on a multi-part drifting-grid fixture — the gate
 *      that had to pass before the old remap/ride-snapshot code was deleted.
 *   2. load→save round-trip on an unedited grid is the identity.
 *   3. a grid flex keeps every object's beat unchanged while seconds reproject.
 *   4. snapped notes keep their exact subdivision; off-grid notes keep a fraction.
 *   5. reproject is TOTAL — every part rides (the old ride-corruption is gone).
 *   6. a < 2-beat grid degrades to seconds-primary.
 *   7. the invariant |time − timeOf(beat)| < 1 ms holds after a reproject.
 *   8. exact undo: TempoMapCmd exec→rollback restores original times exactly.
 *   9. the save body never leaks a beat/beatEnd field to the wire.
 *
 * Run: node tests/beat_primary.test.js
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const src = fs.readFileSync(path.join(__dirname, '..', 'screen.js'), 'utf8');

function extractBlock(name) {
    const m = src.match(new RegExp('/\\* @pure:' + name + ':start \\*/[\\s\\S]*?/\\* @pure:' + name + ':end \\*/'));
    if (!m) { console.error('FAIL: @pure:' + name + ' block not found'); process.exit(1); }
    return m[0];
}
function extractFn(name) {
    const start = src.indexOf('function ' + name + '(');
    assert.ok(start >= 0, `function ${name} must exist`);
    const open = src.indexOf('{', start);
    let d = 0;
    for (let i = open; i < src.length; i++) {
        if (src[i] === '{') d++;
        else if (src[i] === '}' && --d === 0) return src.slice(start, i + 1);
    }
    throw new Error(`unbalanced braces extracting ${name}`);
}
function extractClass(name) {
    const start = src.indexOf('class ' + name + ' {');
    assert.ok(start >= 0, `class ${name} must exist`);
    const open = src.indexOf('{', start);
    let d = 0;
    for (let i = open; i < src.length; i++) {
        if (src[i] === '{') d++;
        else if (src[i] === '}' && --d === 0) return src.slice(start, i + 1);
    }
    throw new Error(`unbalanced braces extracting ${name}`);
}

const r3m = src.match(/const _r3 = [^\n]+\n/);
assert.ok(r3m, '_r3 must exist');

// The pre-A2 _applyTempoRemap, threaded with S + ride explicitly — the golden
// reference the total reproject must reproduce (with ride = all parts + drum).
function legacyApplyTempoRemap(remap, S, ride) {
    const _r3 = v => Math.round(v * 1000) / 1000;
    if (ride.drum && S.drumTab && Array.isArray(S.drumTab.hits)) {
        for (const h of S.drumTab.hits) if (typeof h.t === 'number') h.t = _r3(remap(h.t));
    }
    for (const s of (S.sections || [])) if (typeof s.start_time === 'number') s.start_time = _r3(remap(s.start_time));
    const remapNote = (o) => {
        if (typeof o.time !== 'number') return;
        const oldT = o.time;
        o.time = _r3(remap(oldT));
        if (typeof o.sustain === 'number' && o.sustain > 0) {
            o.sustain = Math.max(0, _r3(remap(oldT + o.sustain) - remap(oldT)));
        }
    };
    for (const arr of (ride.arrs || [])) {
        if (!arr) continue;
        for (const n of (arr.notes || [])) remapNote(n);
        for (const ch of (arr.chords || [])) {
            if (typeof ch.time === 'number') ch.time = _r3(remap(ch.time));
            for (const cn of (ch.notes || [])) remapNote(cn);
        }
        for (const a of (arr.anchors || [])) if (typeof a.time === 'number') a.time = _r3(remap(a.time));
        for (const a of (arr.anchors_user || [])) if (typeof a.time === 'number') a.time = _r3(remap(a.time));
        for (const hs of (arr.handshapes || [])) {
            if (typeof hs.start_time === 'number') hs.start_time = _r3(remap(hs.start_time));
            if (typeof hs.end_time === 'number') hs.end_time = _r3(remap(hs.end_time));
        }
        for (const ph of (arr.phrases || [])) if (typeof ph.time === 'number') ph.time = _r3(remap(ph.time));
    }
}

// A sandbox whose beat helpers + TempoMapCmd all read the injected S.
function makeEnv(S) {
    const body = [
        extractBlock('beat-converter'),
        r3m[0],
        extractFn('_eachTimed'),
        extractFn('_liftAllBeats'),
        extractFn('_reprojectAll'),
        extractFn('_stripBeat'),
        extractFn('_stripBeatsList'),
        extractFn('_stripChordBeats'),
        extractFn('_stripArrangementBeats'),
        extractFn('_stripBeatsFromSaveBody'),
        extractFn('_makeTimeRemap'),
        extractClass('TempoMapCmd'),
    ].join('\n');
    return new Function(
        'S', '_loopRelockAfterGridChange', '_renderLoopStrip', '_updateLoopIn3DBtn',
        '"use strict";' + body +
        '\nreturn { beatOf, timeOf, _liftAllBeats, _reprojectAll, _makeTimeRemap,' +
        ' _stripBeatsFromSaveBody, TempoMapCmd };'
    )(S, () => {}, () => {}, () => {});
}

// ── Fixtures ────────────────────────────────────────────────────────────────
// A drifting grid — every gap a different width (a fitted tempo map / rubato),
// 9 beats (indices 0..8) spanning 0..4 s.
const DRIFT = [
    { time: 0.00, measure: 1 }, { time: 0.50, measure: -1 }, { time: 1.10, measure: -1 },
    { time: 1.50, measure: -1 }, { time: 2.30, measure: 2 }, { time: 2.70, measure: -1 },
    { time: 3.00, measure: -1 }, { time: 3.60, measure: -1 }, { time: 4.00, measure: 3 },
];
// A same-length flex of DRIFT (a TempoMapCmd: times move, indexing fixed).
const FLEX = [0.00, 0.55, 1.05, 1.60, 2.10, 2.55, 3.05, 3.55, 4.10]
    .map((time, i) => ({ time, measure: DRIFT[i].measure }));
const driftGrid = () => DRIFT.map(b => ({ ...b }));
const flexGrid = () => FLEX.map(b => ({ ...b }));
const uniformGrid = (n, gap) =>
    Array.from({ length: n }, (_, i) => ({ time: +(i * gap).toFixed(6), measure: i === 0 ? 1 : -1 }));

// A multi-part song at DRIFT times: 2 arrangements (notes w/ + w/o sustain,
// chords + chord notes, anchors, anchors_user, handshapes, phrases) + drum tab
// + sections. All times are millisecond-clean so exact-undo asserts are exact.
function song() {
    return {
        beats: driftGrid(),
        drumTab: { hits: [{ t: 0.5, piece: 'kick' }, { t: 2.3, piece: 'snare' }] },
        drumTabDirty: false,
        sections: [{ start_time: 0.0, name: 'A' }, { start_time: 2.3, name: 'B' }],
        arrangements: [
            {
                name: 'Lead',
                notes: [
                    { time: 0.5, sustain: 0.4, string: 0, fret: 3 },
                    { time: 1.5, sustain: 0, string: 1, fret: 5 },
                    { time: 2.7, sustain: 0.25, string: 2, fret: 7 },
                ],
                chords: [{ time: 1.1, notes: [{ time: 1.1, sustain: 0.3 }, { time: 1.1, sustain: 0.3 }] }],
                anchors: [{ time: 0.0, fret: 1 }],
                anchors_user: [{ time: 2.3, fret: 5 }],
                handshapes: [{ start_time: 0.5, end_time: 1.5, chord_id: 0 }],
                phrases: [{ time: 0.0 }, { time: 2.3 }],
            },
            {
                name: 'Bass',
                notes: [
                    { time: 0.0, sustain: 0.5, string: 0, fret: 0 },
                    { time: 3.6, sustain: 0, string: 0, fret: 3 },
                ],
                chords: [], anchors: [], anchors_user: [], handshapes: [], phrases: [],
            },
        ],
    };
}

// Every timed value, in a stable order (mirrors _eachTimed) — for comparisons.
function collectTimes(S) {
    const out = [];
    for (const h of ((S.drumTab && S.drumTab.hits) || [])) out.push(h.t);
    for (const s of (S.sections || [])) out.push(s.start_time);
    for (const arr of S.arrangements) {
        for (const n of arr.notes) out.push(n.time, n.sustain || 0);
        for (const ch of arr.chords) { out.push(ch.time); for (const cn of ch.notes) out.push(cn.time, cn.sustain || 0); }
        for (const a of arr.anchors) out.push(a.time);
        for (const a of arr.anchors_user) out.push(a.time);
        for (const hs of arr.handshapes) out.push(hs.start_time, hs.end_time);
        for (const ph of arr.phrases) out.push(ph.time);
    }
    return out;
}
function collectBeats(S) {
    const out = [];
    for (const arr of S.arrangements) for (const n of arr.notes) out.push(n.beat);
    return out;
}

const close = (a, b, eps = 1e-9) =>
    assert.ok(Math.abs(a - b) <= eps, `expected ${a} ≈ ${b} (Δ ${Math.abs(a - b)})`);

let pass = 0, fail = 0;
function t(name, fn) {
    try { fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}

// ── 1. GOLDEN GATE ───────────────────────────────────────────────────────────
t('GOLDEN: lift+reproject reproduces the pre-A2 _applyTempoRemap (all parts, 3 dp)', () => {
    const Sa = song();
    const env = makeEnv(Sa);
    env._liftAllBeats(driftGrid());
    env._reprojectAll(flexGrid());

    const Sb = song();
    legacyApplyTempoRemap(env._makeTimeRemap(driftGrid(), flexGrid()), Sb, { drum: true, arrs: Sb.arrangements });

    const ta = collectTimes(Sa), tb = collectTimes(Sb);
    assert.strictEqual(ta.length, tb.length, 'same object set walked');
    for (let i = 0; i < ta.length; i++) close(ta[i], tb[i]);
});

// ── 2. Round-trip identity ───────────────────────────────────────────────────
t('lift then reproject on the SAME grid is the identity (load→save round-trip)', () => {
    const S = song();
    const before = collectTimes(S);
    const env = makeEnv(S);
    env._liftAllBeats(driftGrid());
    env._reprojectAll(driftGrid());
    const after = collectTimes(S);
    for (let i = 0; i < before.length; i++) close(after[i], before[i]);
});

// ── 3. A flex keeps beats, moves seconds (the §1.2 invariant) ────────────────
t('a grid flex keeps every note beat unchanged while seconds reproject', () => {
    const S = song();
    S.beats = driftGrid();
    S.barSel = null;
    const env = makeEnv(S);
    env._liftAllBeats(S.beats);
    const beatsBefore = collectBeats(S);
    const timesBefore = collectTimes(S);
    const cmd = new env.TempoMapCmd(driftGrid(), flexGrid(), 'drag');
    cmd.exec();
    const beatsAfter = collectBeats(S);
    assert.strictEqual(beatsAfter.length, beatsBefore.length);
    for (let i = 0; i < beatsBefore.length; i++) close(beatsAfter[i], beatsBefore[i]);
    // and at least one second actually moved
    const timesAfter = collectTimes(S);
    assert.ok(timesAfter.some((v, i) => Math.abs(v - timesBefore[i]) > 1e-6), 'seconds reprojected');
});

// ── 4. Snapped vs off-grid ───────────────────────────────────────────────────
t('snapped notes keep their exact subdivision; off-grid notes keep a fractional beat', () => {
    const old = uniformGrid(6, 0.5);   // beats 0..5 at 0.5 s each
    const S = {
        beats: old, drumTab: null, sections: [],
        arrangements: [{
            notes: [{ time: 1.0, sustain: 0 }, { time: 1.18, sustain: 0 }],
            chords: [], anchors: [], anchors_user: [], handshapes: [], phrases: [],
        }],
    };
    const env = makeEnv(S);
    env._liftAllBeats(old);
    const n0 = S.arrangements[0].notes[0], n1 = S.arrangements[0].notes[1];
    assert.strictEqual(n0.beat, 2.0, 'note on the beat carries an exact subdivision');
    assert.ok(n1.beat > 2.3 && n1.beat < 2.4, 'off-grid note carries a fractional beat');
    const frac = n1.beat;
    // double the tempo (0.25 s beats) and reproject from the stored beats
    const fast = uniformGrid(6, 0.25);
    env._reprojectAll(fast);
    assert.strictEqual(n0.beat, 2.0, 'snapped beat unchanged by the flex');
    close(n0.time, 0.5, 1e-9);                 // beat 2.0 at 0.25 s
    assert.strictEqual(n1.beat, frac, 'off-grid beat unchanged by the flex');
    close(n1.time, frac * 0.25, 1e-9);         // fractional beat follows the tempo
});

// ── 5. Total reproject — no part left behind ─────────────────────────────────
t('reproject is TOTAL — a note in EVERY part rides its beat (no ride-corruption)', () => {
    const S = song();
    const env = makeEnv(S);
    env._liftAllBeats(driftGrid());
    env._reprojectAll(flexGrid());
    // Every note in EVERY arrangement (incl. the non-active "Bass") sits exactly
    // at timeOf(flex, beat) — the old ride-scope could leave a part on stale
    // seconds; now it structurally cannot.
    for (const arr of S.arrangements) {
        for (const n of arr.notes) close(n.time, +(env.timeOf(flexGrid(), n.beat)).toFixed(3), 1e-9);
    }
    // drum hits + sections ride too
    for (const h of S.drumTab.hits) close(h.t, +(env.timeOf(flexGrid(), h.beat)).toFixed(3), 1e-9);
    for (const s of S.sections) close(s.start_time, +(env.timeOf(flexGrid(), s.beat)).toFixed(3), 1e-9);
});

// ── 6. No-grid degrade ───────────────────────────────────────────────────────
t('a grid with < 2 beats degrades to seconds-primary (beat = time, no reprojection)', () => {
    const S = {
        beats: [], drumTab: null, sections: [],
        arrangements: [{ notes: [{ time: 1.234, sustain: 0.5 }], chords: [], anchors: [], anchors_user: [], handshapes: [], phrases: [] }],
    };
    const env = makeEnv(S);
    env._liftAllBeats(S.beats);
    assert.strictEqual(S.arrangements[0].notes[0].beat, 1.234, 'beatOf is the identity with no grid');
    env._reprojectAll(S.beats);
    assert.strictEqual(S.arrangements[0].notes[0].time, 1.234, 'time unchanged — behaves as today');
    assert.strictEqual(S.arrangements[0].notes[0].sustain, 0.5);
});

// ── 7. The invariant ─────────────────────────────────────────────────────────
t('invariant: |note.time − timeOf(beat)| < 1 ms after a reproject', () => {
    const S = song();
    const env = makeEnv(S);
    env._liftAllBeats(driftGrid());
    env._reprojectAll(flexGrid());
    const grid = flexGrid();
    for (const arr of S.arrangements) {
        for (const n of arr.notes) {
            assert.ok(Math.abs(n.time - env.timeOf(grid, n.beat)) < 0.001, 'note within 1 ms of its beat');
        }
    }
});

// ── 8. Exact undo (why the snapshot machinery could be deleted) ──────────────
t('exact undo: TempoMapCmd exec then rollback restores the original times exactly', () => {
    const S = song();
    S.beats = driftGrid();
    S.barSel = null;
    const env = makeEnv(S);
    env._liftAllBeats(S.beats);
    const before = collectTimes(S);
    const cmd = new env.TempoMapCmd(driftGrid(), flexGrid(), 'drag');
    cmd.exec();
    assert.ok(collectTimes(S).some((v, i) => Math.abs(v - before[i]) > 1e-6), 'exec moved seconds');
    cmd.rollback();
    // EXACT (strictEqual) — reproject from the stored beat is a true inverse for
    // millisecond-clean inputs, so no snapshot of pre-edit times is needed.
    assert.deepStrictEqual(collectTimes(S), before);
});

// ── 9. No beat leak to the wire ──────────────────────────────────────────────
t('the save body never leaks a beat / beatEnd field (client-only cache)', () => {
    const S = song();
    const env = makeEnv(S);
    env._liftAllBeats(driftGrid());   // notes now carry beat + beatEnd
    const arr = S.arrangements[0];
    const body = {
        notes: arr.notes, chords: arr.chords, sections: S.sections,
        anchors_user: arr.anchors_user, handshapes: arr.handshapes,
        arrangements: S.arrangements, drum_tab: S.drumTab, beats: S.beats,
    };
    const stripped = env._stripBeatsFromSaveBody(body);
    const json = JSON.stringify(stripped);
    assert.ok(!/"beat"/.test(json), 'no "beat" field on the wire');
    assert.ok(!/"beatEnd"/.test(json), 'no "beatEnd" field on the wire');
    // times survive the strip
    assert.strictEqual(typeof stripped.notes[0].time, 'number');
    assert.strictEqual(typeof stripped.drum_tab.hits[0].t, 'number');
    // and the LIVE objects keep their cache (strip clones, never mutates)
    assert.strictEqual(typeof arr.notes[0].beat, 'number');
});

// ── 10. lift bookkeeping: beatEnd only where a span exists ───────────────────
t('lift sets beatEnd for sustained notes + handshapes, and clears it otherwise', () => {
    const S = song();
    const env = makeEnv(S);
    env._liftAllBeats(driftGrid());
    const notes = S.arrangements[0].notes;
    assert.ok(typeof notes[0].beatEnd === 'number', 'sustained note has an end beat');
    assert.ok(!('beatEnd' in notes[1]) || notes[1].beatEnd === undefined, 'zero-sustain note has no end beat');
    assert.ok(typeof S.arrangements[0].handshapes[0].beatEnd === 'number', 'handshape span has an end beat');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
