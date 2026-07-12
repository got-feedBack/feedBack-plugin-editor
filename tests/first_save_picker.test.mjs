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

const { _saveShouldPickPure } = await import('../src/file-ops.js');

let pass = 0, fail = 0;
function t(name, fn) {
    try { fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}

t('picks the file explorer only on the first save, and only when the API exists', () => {
    // hasHandle=false ⇒ nothing chosen yet this session (a new song, or one just
    // opened from the library — externalSaveHandle resets to null on load).
    assert.strictEqual(_saveShouldPickPure(false, true, true), true, 'first save + API → picker');
    assert.strictEqual(_saveShouldPickPure(true, true, true), false, 'location chosen → save straight to it');
    assert.strictEqual(_saveShouldPickPure(false, false, true), false, 'no picker API → library save, never a re-download');
    assert.strictEqual(_saveShouldPickPure(true, false, true), false);
});

t('never routes a session that cannot complete Save As through the picker', () => {
    // sessionCanExport=false covers: create-mode sessions (/save rejects them
    // outright — the picker would pop, the user would pick a destination, then
    // nothing would be written to it) and directory-form sloppaks
    // (/session/export 409s — the library save succeeds but the external write
    // fails, falsely re-marking the session dirty and re-prompting forever).
    assert.strictEqual(_saveShouldPickPure(false, true, false), false, 'non-exportable session → plain library save');
    assert.strictEqual(_saveShouldPickPure(true, true, false), false);
});

t('coerces truthiness (defensive against non-boolean inputs)', () => {
    assert.strictEqual(_saveShouldPickPure(null, {}, 1), true);    // no handle, api present, exportable
    assert.strictEqual(_saveShouldPickPure(undefined, undefined, true), false);
    assert.strictEqual(_saveShouldPickPure('handle', 'fn', true), false); // truthy handle
    assert.strictEqual(_saveShouldPickPure(false, true, undefined), false, 'unknown exportability → no picker');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
