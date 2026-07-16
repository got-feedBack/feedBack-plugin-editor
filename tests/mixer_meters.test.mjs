/*
 * Mixer metering pures: the sample→level/peak math (src/audio.js) and the
 * meter ballistics + dB labels (src/mixer-panel.js). The Web Audio graph and
 * the rAF read loop aren't unit-testable in node; these pin the arithmetic
 * the live meters are built on.
 *
 * Run: node tests/mixer_meters.test.mjs
 */
import assert from 'node:assert';

// Minimal DOM/storage so editorSetMixLevel's write path runs (it reads
// localStorage + a label element); the Web Audio graph stays absent.
const _store = new Map();
globalThis.localStorage = globalThis.localStorage || {
    getItem: (k) => (_store.has(k) ? _store.get(k) : null),
    setItem: (k, v) => { _store.set(k, String(v)); },
    removeItem: (k) => { _store.delete(k); },
};
const _labels = new Map();
globalThis.document = globalThis.document || {
    getElementById: (id) => (_labels.has(id) ? _labels.get(id) : (_labels.set(id, { textContent: '' }), _labels.get(id))),
};

const { _mixMeterLevelPure, _mixMeterPeakDbPure, editorSetMixLevel } = await import('../src/audio.js');
const { _mixerMeterNextPure, _mixerDbLabelPure, _mixerMeterInputPure, _mixerMeterPeakPure } = await import('../src/mixer-panel.js');

let pass = 0, fail = 0;
const tests = [];
const t = (name, fn) => tests.push([name, fn]);

t('level: RMS mapped over −60..0 dBFS, silence pins at zero', () => {
    assert.strictEqual(_mixMeterLevelPure([]), 0);
    assert.strictEqual(_mixMeterLevelPure([0, 0, 0]), 0, 'silence → 0');
    assert.strictEqual(_mixMeterLevelPure([1, -1, 1, -1]), 1, 'full-scale RMS → 1');
    // A constant 0.1 amplitude → −20 dBFS → (−20+60)/60 = 0.667.
    assert.ok(Math.abs(_mixMeterLevelPure([0.1, 0.1, 0.1]) - (( -20 + 60) / 60)) < 1e-6);
    assert.strictEqual(_mixMeterLevelPure([NaN, Infinity]), 0, 'invalid samples ignored → silence');
});

t('peak: max |sample| in dBFS, −Infinity on silence', () => {
    assert.strictEqual(_mixMeterPeakDbPure([]), -Infinity);
    assert.strictEqual(_mixMeterPeakDbPure([0, 0]), -Infinity);
    assert.strictEqual(_mixMeterPeakDbPure([0.5, -0.9, 0.2]), 20 * Math.log10(0.9));
    assert.ok(_mixMeterPeakDbPure([1.4]) > 0, 'over 0 dBFS reads as a clip (positive dB)');
});

t('ballistics: instant attack, gravity decay (~full-scale over 700 ms)', () => {
    assert.strictEqual(_mixerMeterNextPure(0.2, 0.8, 16), 0.8, 'a louder input jumps instantly');
    assert.strictEqual(_mixerMeterNextPure(0.8, 0.8, 16), 0.8, 'equal holds');
    // Decaying: from 0.8 with a silent input over 70 ms → 0.8 − 70/700 = 0.7.
    assert.ok(Math.abs(_mixerMeterNextPure(0.8, 0, 70) - 0.7) < 1e-9);
    assert.strictEqual(_mixerMeterNextPure(0.05, 0, 700), 0, 'never below the input floor');
    assert.strictEqual(_mixerMeterNextPure(2, 5, 16), 1, 'clamped into [0,1]');
});

t('dB readout label: compact, −∞ below −60, finer near 0', () => {
    assert.strictEqual(_mixerDbLabelPure(-Infinity), '−∞');
    assert.strictEqual(_mixerDbLabelPure(-72), '−∞');
    assert.strictEqual(_mixerDbLabelPure(-24), '-24 dB', 'rounded when well below 0');
    assert.strictEqual(_mixerDbLabelPure(-3.2), '-3.2 dB', 'one decimal near 0');
    assert.strictEqual(_mixerDbLabelPure(1.5), '1.5 dB', 'positive = clipping');
});

t('meter routing uses each post-fader channel in band mode', () => {
    const levels = {
        ref: 0.8, guide: 0.6,
        tracks: { 'audio:Guitar_L': 0.4, 'arr:0': 0.2, 'arr:1': 0.1 },
    };
    assert.strictEqual(_mixerMeterInputPure('audio:Guitar_L', levels, 'master', 'arr:0', true), 0.4);
    assert.strictEqual(_mixerMeterInputPure('arr:0', levels, 'master', 'arr:0', true), 0.2);
    assert.strictEqual(_mixerMeterInputPure('arr:1', levels, 'master', 'arr:0', true), 0.1,
        'inactive transcription strips still show their own channel');
    assert.strictEqual(_mixerMeterInputPure('arr:0', levels, 'master', 'arr:0', false), 0.6,
        'single-guide mode follows the active guide bus');
    assert.strictEqual(_mixerMeterInputPure('arr:1', levels, 'master', 'arr:0', false), 0);
});

t('peak readout mirrors meter input fallbacks (no −∞ peak beside a live meter)', () => {
    const levels = {
        peaks: { ref: -6, guide: -12, master: -3 },
        trackPeaks: { 'audio:Guitar_L': -9 },
    };
    // A stem with its own tap reports that tap's peak.
    assert.strictEqual(_mixerMeterPeakPure('audio:Guitar_L', levels, 'master', 'arr:0'), -9);
    // Bus strips read levels.peaks[bus].
    assert.strictEqual(_mixerMeterPeakPure('bus:master', levels, 'master', 'arr:0'), -3);
    // Regression: the active audio strip (metered off ref, no track tap) must
    // read the ref peak, not −∞.
    assert.strictEqual(_mixerMeterPeakPure('audio:Rec1', levels, 'Rec1', 'arr:0'), -6,
        'active audio strip → ref peak');
    // Regression: the active transcription strip (metered off guide) reads guide.
    assert.strictEqual(_mixerMeterPeakPure('arr:0', levels, 'Rec1', 'arr:0'), -12,
        'active transcription strip → guide peak');
    // An inactive transcription strip with no tap stays silent (−∞).
    assert.strictEqual(_mixerMeterPeakPure('arr:1', levels, 'Rec1', 'arr:0'), -Infinity);
});

t('master fader is a live bus: editorSetMixLevel persists it + writes a dB label', () => {
    // Regression: editorSetMixLevel early-returned for any bus but ref/guide/
    // click, so the MASTER strip did nothing — no persist, no label, no trim.
    _store.delete('editorMixMaster');
    editorSetMixLevel('master', 50);
    assert.strictEqual(_store.get('editorMixMaster'), '50', 'master pref persisted');
    // 50% → 0.5 gain → 20·log10(0.5) ≈ −6.0 dB, and a dB label (never '%').
    assert.strictEqual(_labels.get('editor-mix-master-val').textContent, '−6.0 dB');
    editorSetMixLevel('guide', 100);
    assert.strictEqual(_labels.get('editor-mix-guide-val').textContent, '+0.0 dB', 'dB, not "100%"');
});

for (const [name, fn] of tests) {
    try { await fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
