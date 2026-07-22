/*
 * First-save file-explorer routing (src/file-ops.js).
 *
 * The Save command opens the native picker on the FIRST save of a session (no
 * location chosen yet) when the File System Access API is available, then saves
 * straight to the chosen file afterwards; without the API it uses the plain
 * library save.
 *
 * Run: node tests/first_save_picker.test.mjs
 */
import assert from 'node:assert';

// file-ops.js touches localStorage at module scope in some paths — stub before import.
globalThis.localStorage = globalThis.localStorage || {
    getItem: () => null, setItem: () => {}, removeItem: () => {},
};

const { _externalSaveHandleIsCurrentPure, _saveShouldPickPure } =
    await import('../src/file-ops.js');

let pass = 0, fail = 0;
function t(name, fn) {
    try { fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}

t('picks the file explorer for an untitled project, and only when the API exists', () => {
    // hasHandle=false ⇒ this untitled project has no destination yet.
    assert.strictEqual(_saveShouldPickPure(false, true, true), true, 'untitled project + API → picker');
    assert.strictEqual(_saveShouldPickPure(true, true, true), false, 'chosen project path → save straight to it');
    assert.strictEqual(_saveShouldPickPure(false, false, true), true,
        'no picker API → Save As download fallback, never a library build');
    assert.strictEqual(_saveShouldPickPure(true, false, true), false);
});

t('a chosen file handle belongs only to the session that picked it', () => {
    assert.strictEqual(_externalSaveHandleIsCurrentPure('session-a', 'session-a'), true);
    assert.strictEqual(_externalSaveHandleIsCurrentPure('session-a', 'session-b'), false,
        'a new project cannot inherit and overwrite the previous project file');
    assert.strictEqual(_externalSaveHandleIsCurrentPure(null, 'session-b'), false);
});

t('only an untitled project is routed through first-save destination selection', () => {
    assert.strictEqual(_saveShouldPickPure(false, true, false), false, 'non-exportable session → plain library save');
    assert.strictEqual(_saveShouldPickPure(false, true, true), true,
        'a create session with temporary export support gets a first-save picker');
    assert.strictEqual(_saveShouldPickPure(true, true, false), false);
});

t('coerces truthiness (defensive against non-boolean inputs)', () => {
    assert.strictEqual(_saveShouldPickPure(null, {}, 1), true);    // no handle, api present, exportable
    assert.strictEqual(_saveShouldPickPure(undefined, undefined, true), true);
    assert.strictEqual(_saveShouldPickPure('handle', 'fn', true), false); // truthy handle
    assert.strictEqual(_saveShouldPickPure(false, true, undefined), false, 'unknown exportability → no picker');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
