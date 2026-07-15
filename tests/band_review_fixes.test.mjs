/*
 * Band-mode review fixes (PR #280 review, items 8-10):
 *
 *   8. Drum-only charts and late drum hits are part of band truth: the drum
 *      grid (S.drumTab) is NOT an arrangement, so _guideSourceTimes must
 *      union its hits in band mode and the scheduler must gate on the real
 *      band roster, not S.arrangements.length.
 *   9. Toggling Play All Tracks DURING playback cancels the old mode's
 *      queued voices and refills the schedule from the current transport
 *      time — in both directions.
 *  10. A part's gain node is born carrying the strip's CURRENT mute/solo/
 *      volume state, before the first voice connects through it — a fresh
 *      GainNode at Web Audio unity must never leak a muted part's first note.
 *
 * Drives the REAL scheduler (audio.js _guideTimerSync -> _guideTick) over a
 * recording fake AudioContext — the stubs are environment (Web Audio, DOM,
 * storage), never the subject under test.
 *
 * Fails on the pre-fix code (drum-only silence, unity first notes, stale
 * schedule across a live toggle).
 * Run: node tests/band_review_fixes.test.mjs
 */
import assert from 'node:assert';

const stored = {};
globalThis.localStorage = {
    getItem: (k) => (k in stored ? stored[k] : null),
    setItem: (k, v) => { stored[k] = String(v); },
    removeItem: (k) => { delete stored[k]; },
};
globalThis.document = globalThis.document || {
    getElementById: () => null, addEventListener: () => {}, activeElement: null,
    querySelectorAll: () => [], querySelector: () => null,
    createElement: () => ({ style: {}, dataset: {}, classList: { add() {}, remove() {} } }),
    head: { appendChild: () => {} },
};
globalThis.window = globalThis.window || globalThis;

const {
    editorPlayAllTracksEnabled, editorTogglePlayAllTracks,
    _guideTimerSync, _composeSongDuration,
} = await import('../src/audio.js');
const { _mixerPartStripState } = await import('../src/mixer-panel.js');
const { setHostHooks } = await import('../src/host.js');
const { S } = await import('../src/state.js');

// ── A recording fake Web Audio graph ─────────────────────────────────────
// Every connect() snapshots the TARGET's gain value at that instant —
// item 10 is precisely about what a part gain carries when its first voice
// wires through it.
function param(v) {
    return {
        value: v,
        setValueAtTime(x) { this.value = x; },
        linearRampToValueAtTime() {},
        exponentialRampToValueAtTime() {},
        setTargetAtTime(x) { this.target = x; },
        cancelScheduledValues() {},
    };
}
function makeCtx() {
    const ctx = {
        currentTime: 0,
        destination: { kind: 'dest' },
        oscs: [],
        createGain() {
            const g = {
                kind: 'gain', gain: param(1), outputs: [], disconnected: false,
                connect(t) { g.outputs.push({ to: t, toGainAtConnect: t && t.gain ? t.gain.value : null }); },
                disconnect() { g.disconnected = true; },
            };
            return g;
        },
        createOscillator() {
            const o = {
                kind: 'osc', type: '', frequency: { value: 0 },
                outputs: [], startAt: null, stops: [],
                connect(t) { o.outputs.push({ to: t }); },
                start(t) { o.startAt = t; ctx.oscs.push(o); },
                stop(t) { o.stops.push(t); },
            };
            return o;
        },
        createDynamicsCompressor() {
            return {
                kind: 'comp', threshold: param(0), knee: param(0), ratio: param(0),
                attack: param(0), release: param(0), connect() {}, disconnect() {},
            };
        },
    };
    return ctx;
}
const ctx = makeCtx();   // ONE ctx for the whole file — the master bus caches it

// The mixer's real whole-map rule is the strip-state source, as in the app.
setHostHooks({ partStripState: _mixerPartStripState });
stored.editorGuideClap = '1';   // guide on; metronome/A-B stay off

// The part gain a scheduled clap voice feeds: osc -> envelope gain -> part
// gain; the connection snapshot carries the part gain's value at wire-up.
function partGainConn(osc) { return osc.outputs[0].to.outputs[0]; }

function setBand(on) {
    if (editorPlayAllTracksEnabled() !== on) editorTogglePlayAllTracks();
}

// One controlled scheduler pass: _guideTimerSync runs the first tick
// synchronously on start; stopping before any await means the interval
// never fires on its own.
function tickOnce() {
    S.playing = true;
    _guideTimerSync();
    S.playing = false;
    _guideTimerSync();
}

async function until(cond, ms) {
    const t0 = Date.now();
    while (!cond()) {
        if (Date.now() - t0 > ms) return false;
        await new Promise((r) => setTimeout(r, 10));
    }
    return true;
}

const BASE = {
    drumEditMode: false, currentArr: 0, playing: false,
    playStartWall: 0, playStartTime: 0, cursorTime: 0,
    duration: 10, loopEnabled: false, barSel: null, beats: [],
    composeLength: undefined, audioBuffer: null,
};

let pass = 0, fail = 0;
async function t(name, fn) {
    try { await fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}

// ── item 8 (scheduler) + item 10 (mute) — drum-only chart ───────────────
await t('band mode voices a DRUM-ONLY chart, and its first hit honors mute', () => {
    Object.assign(S, BASE, {
        audioCtx: ctx,
        arrangements: [],
        drumTab: { hits: [{ t: 0.01 }, { t: 0.05 }] },
        partMix: { drums: { vol: 100, mute: true, solo: false } },
    });
    setBand(true);
    const before = ctx.oscs.length;
    tickOnce();
    const claps = ctx.oscs.slice(before);
    // Item 8: no arrangements, but the drum grid IS a band part.
    assert.strictEqual(claps.length, 2, 'both drum hits are scheduled');
    assert.deepStrictEqual(claps.map((o) => o.startAt), [0.01, 0.05]);
    // Item 10: the freshly created drums gain must already be 0 (muted)
    // when the first voice connects through it — not Web Audio unity.
    assert.strictEqual(partGainConn(claps[0]).toGainAtConnect, 0,
        'muted drums gain is 0 BEFORE the first voice wires up');
    assert.strictEqual(partGainConn(claps[0]).to.gain.value, 0,
        'and stays 0 through the tick that created it');
});

// ── item 10 — a solo elsewhere gates a new part gain's FIRST note ────────
await t("a new part gain is born solo'd-away, its very first note silent", () => {
    Object.assign(S, {
        arrangements: [
            { name: 'Piano', notes: [{ time: 0.02, string: 2, fret: 12, sustain: 0.1 }] },
            { name: 'Piano 2', notes: [{ time: 0.03, string: 2, fret: 14, sustain: 0.1 }] },
        ],
        drumTab: null,
        partMix: { 'arr:0': { vol: 100, mute: false, solo: true } },
    });
    const before = ctx.oscs.length;
    tickOnce();
    const news = ctx.oscs.slice(before);
    const lead = news.find((o) => o.startAt === 0.02);
    const other = news.find((o) => o.startAt === 0.03);
    assert.ok(lead && other, 'both parts scheduled a first voice');
    assert.strictEqual(partGainConn(lead).toGainAtConnect, 1, 'the soloed part plays at its level');
    assert.strictEqual(partGainConn(other).toGainAtConnect, 0,
        "the OTHER part is solo'd away from its very first note");
});

// ── item 10 — a low strip volume applies to the FIRST note ──────────────
await t("a new part gain is born at the strip's volume, not unity", () => {
    S.arrangements = [
        { name: 'Piano', notes: [{ time: 0.02, string: 2, fret: 12, sustain: 0.1 }] },
        { name: 'Piano 2', notes: [{ time: 0.03, string: 2, fret: 14, sustain: 0.1 }] },
        { name: 'Piano 3', notes: [{ time: 0.045, string: 2, fret: 10, sustain: 0.1 }] },
    ];
    S.partMix = { 'arr:2': { vol: 40, mute: false, solo: false } };
    const before = ctx.oscs.length;
    tickOnce();
    const fresh = ctx.oscs.slice(before).find((o) => o.startAt === 0.045);
    assert.ok(fresh, 'the new part scheduled its first voice');
    assert.ok(Math.abs(partGainConn(fresh).toGainAtConnect - 0.4) < 1e-9,
        'first note already carries the 40% strip volume');
});

// ── item 8 (duration) — drum hits are band truth for the song length ────
await t('a late drum hit bounds the band-mode song; drum-only still has a song', () => {
    Object.assign(S, {
        playing: false,
        arrangements: [{ name: 'Piano', notes: [{ time: 1 }, { time: 2 }] }],
        drumTab: { hits: [{ t: 9 }] },
        partMix: {},
    });
    setBand(false);
    const dOff = _composeSongDuration();
    setBand(true);
    const dOn = _composeSongDuration();
    assert.strictEqual(dOn - dOff, 7,
        'band mode extends the song to the 9 s drum hit (off stays at the 2 s note)');
    S.arrangements = [];
    assert.ok(_composeSongDuration() > 9, 'a drum-only chart still bounds a song');
});

// ── item 9 — live toggle OFF -> ON cancels and refills ───────────────────
await t('toggling the band ON mid-play cancels the single voice and refills now', async () => {
    setBand(false);
    Object.assign(S, {
        arrangements: [
            { name: 'Piano', notes: [{ time: 0.06, string: 2, fret: 12, sustain: 0.1 }] },
            { name: 'Piano 2', notes: [{ time: 0.07, string: 2, fret: 14, sustain: 0.1 }] },
        ],
        drumTab: null,
        partMix: {},
    });
    const before = ctx.oscs.length;
    S.playing = true;
    _guideTimerSync();   // live timer; the immediate tick schedules single mode
    try {
        const single = ctx.oscs.slice(before);
        assert.strictEqual(single.length, 1, 'single mode claps the active part only');
        assert.strictEqual(single[0].startAt, 0.06);
        const mark = ctx.oscs.length;
        editorTogglePlayAllTracks();   // LIVE toggle -> ON
        assert.strictEqual(single[0].outputs[0].to.disconnected, true,
            "the old mode's queued voice is canceled at the toggle");
        const refilled = await until(() => ctx.oscs.length >= mark + 2, 800);
        assert.ok(refilled, 'the band refills from the current transport time');
        const news = ctx.oscs.slice(mark);
        assert.ok(news.some((o) => o.startAt === 0.06) && news.some((o) => o.startAt === 0.07),
            'BOTH parts voice after the live toggle');
    } finally {
        S.playing = false;
        _guideTimerSync();
    }
});

// ── item 9 — live toggle ON -> OFF stops the band, single voice resumes ──
await t('toggling the band OFF mid-play stops queued band voices, single voice resumes', async () => {
    // Band is ON from the previous case.
    Object.assign(S, {
        arrangements: [
            { name: 'Piano', notes: [{ time: 0.08, string: 2, fret: 12, sustain: 0.1 }] },
            { name: 'Piano 2', notes: [{ time: 0.09, string: 2, fret: 14, sustain: 0.1 }] },
        ],
        drumTab: null,
        partMix: {},
    });
    const before = ctx.oscs.length;
    S.playing = true;
    _guideTimerSync();
    try {
        const band = ctx.oscs.slice(before);
        assert.strictEqual(band.length, 2, 'the band scheduled both parts');
        const mark = ctx.oscs.length;
        editorTogglePlayAllTracks();   // LIVE toggle -> OFF
        assert.ok(band.every((o) => o.outputs[0].to.disconnected),
            'queued band voices are canceled at the toggle');
        assert.ok(band.every((o) => o.stops.length >= 2),
            'started one-shots get an immediate stop() beyond their scheduled one');
        const refilled = await until(() => ctx.oscs.length >= mark + 1, 800);
        assert.ok(refilled, 'the single guide voice refills from the current transport time');
        const news = ctx.oscs.slice(mark);
        assert.ok(news.some((o) => o.startAt === 0.08), 'the active part claps again');
        assert.ok(!news.some((o) => o.startAt === 0.09), 'other parts stay silent after OFF');
    } finally {
        S.playing = false;
        _guideTimerSync();
    }
});

// ── a drum-ENCODED arrangement claps in band mode (not just the sidecar) ─
// A created/imported/legacy "Drums" part lives in S.arrangements (key
// 'arr:i'), has no pitch, so its pitched set is empty by design. Pre-fix the
// band loop clapped only the 'drums' SIDECAR key, so a drum arrangement voiced
// neither GM nor clap and went silent. It must clap its rhythm, gated by its
// own strip.
await t('a drum-encoded arrangement claps in band mode; mute silences it', () => {
    Object.assign(S, BASE, {
        audioCtx: ctx,
        arrangements: [
            { name: 'Lead', notes: [{ time: 0.06, string: 2, fret: 12, sustain: 0.1 }] },
            { name: 'Drums', notes: [{ time: 0.01, string: 0, fret: 0 }, { time: 0.05, string: 1, fret: 0 }] },
        ],
        drumTab: null,
        partMix: {},
    });
    setBand(true);
    const before = ctx.oscs.length;
    tickOnce();
    const news = ctx.oscs.slice(before);
    // The two drum-arrangement hits clap at their charted times.
    assert.ok(news.some((o) => o.startAt === 0.01) && news.some((o) => o.startAt === 0.05),
        'the drum arrangement claps its rhythm (would be silent pre-fix)');

    // And its strip mutes it: mute the drum arrangement, replay, no drum claps.
    Object.assign(S, BASE, {
        audioCtx: ctx,
        arrangements: [
            { name: 'Lead', notes: [{ time: 0.16, string: 2, fret: 12, sustain: 0.1 }] },
            { name: 'Drums', notes: [{ time: 0.11, string: 0, fret: 0 }, { time: 0.15, string: 1, fret: 0 }] },
        ],
        drumTab: null,
        partMix: { 'arr:1': { vol: 100, mute: true, solo: false } },
    });
    const mark = ctx.oscs.length;
    tickOnce();
    const muted = ctx.oscs.slice(mark);
    const drumClap = muted.find((o) => o.startAt === 0.11);
    assert.ok(drumClap, 'the muted drum arrangement still SCHEDULES its clap');
    assert.strictEqual(partGainConn(drumClap).toGainAtConnect, 0,
        'but through a gain seated at 0 — the mute silences it');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
