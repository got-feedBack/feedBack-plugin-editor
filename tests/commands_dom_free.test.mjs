/*
 * src/commands.js must be importable AND runnable with no DOM.
 *
 * That is the boundary the module is drawn on: everything browser-facing (the
 * ambiguous-pitch popover, the requestAnimationFrame resize) stays in main.js
 * and arrives through host hooks. The payoff is that every other suite can
 * drive the REAL command classes under node instead of regex-slicing them out
 * of main.js.
 *
 * It is easy to lose by accident. Copilot caught exactly that on #169: the
 * module reached `document` transitively through setStatus. So this suite must
 * NOT import tests/_history_env.mjs — that installs a document stub, and would
 * hide the very regression this file exists to catch.
 *
 * Run: node tests/commands_dom_free.test.mjs
 */
import assert from 'node:assert';
import { MoveNoteCmd, _execCyclePosition } from '../src/commands.js';
import { S } from '../src/state.js';

assert.strictEqual(typeof globalThis.document, 'undefined',
    'precondition: this suite must run with no document, or it proves nothing');

let pass = 0, fail = 0;
function t(name, fn) {
    try { fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + (e && e.message)); }
}

function seed() {
    Object.assign(S, {
        filename: '', currentArr: 0, sel: new Set(), drag: null,
        arrangements: [{
            id: 'a1', name: 'Lead', tuning: [0, 0, 0, 0, 0, 0],
            notes: [{ time: 1, string: 0, fret: 3, sustain: 0, techniques: {} }],
        }],
    });
    return S;
}

t('a command round-trips with no document', () => {
    const s = seed();
    const cmd = new MoveNoteCmd([0], [0.5], [0], [0]);
    cmd.exec();
    assert.strictEqual(s.arrangements[0].notes[0].time, 1.5);
    cmd.rollback();
    assert.strictEqual(s.arrangements[0].notes[0].time, 1);
});

t('an exec helper that reports through setStatus does not throw', () => {
    // `_execCyclePosition` with nothing selected takes its very first branch,
    // `setStatus('Select notes first')` — the exact path that reached `document`
    // before the guard in src/ui.js. `_execMoveString` would NOT do: with an
    // empty selection it returns before ever calling setStatus, so asserting on
    // it proves nothing. (Verified by deleting the guard: this case fails, that
    // one still passes.)
    seed();
    assert.doesNotThrow(() => _execCyclePosition(1));
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
