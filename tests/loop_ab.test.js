'use strict';
/*
 * Tests for loop A/B compare (@pure:loop-ab block): while looping, each
 * pass alternates between the RECORDING (reference audible, claps off)
 * and the GUIDE (reference muted through the mixer's transparent ref
 * gain, claps on) — the ear-training loop from the DAW-workspace design
 * (1.6). These fail on main, where the block doesn't exist.
 *
 * Run: node tests/loop_ab.test.js
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const src = fs.readFileSync(path.join(__dirname, '..', 'screen.js'), 'utf8');
const m = src.match(/\/\* @pure:loop-ab:start \*\/[\s\S]*?\/\* @pure:loop-ab:end \*\//);
if (!m) {
    console.error('FAIL: @pure:loop-ab block not found in screen.js');
    process.exit(1);
}
const { _abClapsEnabledPure, _abNextPhasePure, _abRefTargetPure } = new Function(
    '"use strict";' + m[0]
    + '\nreturn { _abClapsEnabledPure, _abNextPhasePure, _abRefTargetPure };'
)();

let pass = 0, fail = 0;
function t(name, fn) {
    try { fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}

t('A/B inactive: the claps pref rules, untouched', () => {
    assert.strictEqual(_abClapsEnabledPure(false, 'recording', true), true);
    assert.strictEqual(_abClapsEnabledPure(false, 'guide', false), false);
});

t('A/B active: guide passes clap even with the pref OFF; recording passes stay clean even with it ON', () => {
    assert.strictEqual(_abClapsEnabledPure(true, 'guide', false), true);
    assert.strictEqual(_abClapsEnabledPure(true, 'recording', true), false);
});

t('phase flip is a strict two-cycle', () => {
    assert.strictEqual(_abNextPhasePure('recording'), 'guide');
    assert.strictEqual(_abNextPhasePure('guide'), 'recording');
});

t('reference mutes ONLY during an active, playing guide pass', () => {
    assert.strictEqual(_abRefTargetPure(true, true, 'guide', 0.8), 0);
    assert.strictEqual(_abRefTargetPure(true, true, 'recording', 0.8), 0.8);
    assert.strictEqual(_abRefTargetPure(true, false, 'guide', 0.8), 0.8,
        'stopping mid-guide-pass restores the fader level');
    assert.strictEqual(_abRefTargetPure(false, true, 'guide', 0.8), 0.8,
        'A/B off (or loop disarmed) never mutes');
});

t('a full loop session alternates recording → guide → recording …', () => {
    // Compose the pures the way the wrap handler does: start on recording,
    // flip per wrap, derive the audible surfaces per pass.
    let phase = 'recording';
    const passes = [];
    for (let wrap = 0; wrap < 4; wrap++) {
        passes.push({
            phase,
            claps: _abClapsEnabledPure(true, phase, false),
            refGain: _abRefTargetPure(true, true, phase, 1),
        });
        phase = _abNextPhasePure(phase);
    }
    assert.deepStrictEqual(passes, [
        { phase: 'recording', claps: false, refGain: 1 },
        { phase: 'guide', claps: true, refGain: 0 },
        { phase: 'recording', claps: false, refGain: 1 },
        { phase: 'guide', claps: true, refGain: 0 },
    ], 'each pass is exactly one of the two surfaces, never both, never neither');
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
