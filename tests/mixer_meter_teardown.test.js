'use strict';
/*
 * Meter-tap lifecycle: a stem's AnalyserNode tap must be torn down WITH its
 * gain, so a screen teardown (or a new song) can't leave a stale analyser in
 * the map. A survivor is doubly bad — it keeps reading a disconnected node
 * AND blocks the re-attach guard, so the stem's meter goes dead on the next
 * song. This drives the REAL _stemGainsReset against the REAL metering read.
 *
 * Pre-fix (_stemGainsReset only disconnected the gain) this FAILS: the tap
 * survives and audioMixerMeterLevels() still reports the stem.
 *
 * Run: node tests/mixer_meter_teardown.test.js
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'audio.js'), 'utf8');

const mixBlock = src.match(
    /\/\* @pure:audio-mixer:start \*\/[\s\S]*?\/\* @pure:audio-mixer:end \*\//)[0];
const meterBlock = src.match(
    /const _meterAnalysers = Object\.create\(null\);[\s\S]*?return levels;\n\}/)[0];
const stemReset = src.match(/function _stemGainsReset\(\) \{[\s\S]*?\n\}/)[0];

function analyserStub() {
    return {
        fftSize: 256, smoothingTimeConstant: 0,
        connect() {}, disconnect() {},
        // A steady 0.1 amplitude → a finite, nonzero meter level.
        getFloatTimeDomainData(arr) { arr.fill(0.1); },
    };
}
const S = {
    audioCtx: {
        destination: {},
        createAnalyser: analyserStub,
        createGain: () => ({ gain: { value: 1 }, connect() {}, disconnect() {} }),
    },
};
const env = new Function(
    'S',
    '"use strict";' + (mixBlock + '\n' + meterBlock + '\n'
        + 'const stemGainNodes = new Map();\n' + stemReset).replace(/^export\s+/gm, '')
    + '\nreturn { _attachMeterTap, audioMixerMeterLevels, _stemGainsReset, stemGainNodes };'
)(S);

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); } };

t('a stem tap is metered while live, then gone after _stemGainsReset', () => {
    const gain = { connect() {}, disconnect() {} };
    env.stemGainNodes.set('Gtr_L', gain);
    env._attachMeterTap(gain, 'track:audio:Gtr_L');
    assert.ok(env.audioMixerMeterLevels().tracks['audio:Gtr_L'] > 0, 'metered while live');

    env._stemGainsReset();
    assert.strictEqual(env.stemGainNodes.size, 0, 'gains cleared');
    assert.strictEqual('audio:Gtr_L' in env.audioMixerMeterLevels().tracks, false,
        'the meter tap was detached with the gain — no stale analyser survives');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
