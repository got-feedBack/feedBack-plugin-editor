/* The editor's own Back button must not bypass the unsaved-document guard. */
import assert from 'node:assert';
import fs from 'node:fs';

const mainSrc = fs.readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('../screen.html', import.meta.url), 'utf8');

function extractAsyncFunction(name) {
    const start = mainSrc.indexOf('async function ' + name);
    assert.ok(start >= 0, name + ' must exist');
    const open = mainSrc.indexOf('{', start);
    let depth = 0;
    for (let i = open; i < mainSrc.length; i++) {
        if (mainSrc[i] === '{') depth++;
        else if (mainSrc[i] === '}' && --depth === 0) return mainSrc.slice(start, i + 1);
    }
    throw new Error('unbalanced function');
}

function makeLeave(allowed) {
    const calls = [];
    const guard = async (label) => { calls.push(['guard', label]); return allowed; };
    const fakeWindow = { showScreen: (id) => calls.push(['screen', id]) };
    const body = extractAsyncFunction('_editorLeaveToHome');
    const fn = new Function('guardSessionTransition', 'window',
        body + '\nreturn _editorLeaveToHome;')(guard, fakeWindow);
    return { fn, calls };
}

assert.match(html, /onclick="editorLeaveToHome\(\)"/, 'Back routes through the editor guard');
assert.doesNotMatch(html, /onclick="showScreen\('home'\)"/, 'Back never navigates directly');

{
    const { fn, calls } = makeLeave(false);
    assert.strictEqual(await fn(), false);
    assert.deepStrictEqual(calls, [['guard', 'returning to the library']],
        'Cancel or failed Save keeps the editor active');
}

{
    const { fn, calls } = makeLeave(true);
    assert.strictEqual(await fn(), true);
    assert.deepStrictEqual(calls, [
        ['guard', 'returning to the library'],
        ['screen', 'home'],
    ], 'navigation happens only after the transition is approved');
}

console.log('2 passed, 0 failed');
