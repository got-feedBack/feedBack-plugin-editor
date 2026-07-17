/*
 * Create-mode save routing (src/file-ops.js + src/create.js).
 *
 * A create-mode session cannot go through /save — there is nothing on disk to
 * save over, and the backend rejects it ("Only sloppak-format sessions can be
 * saved", or the drum_tab variant when the session carries a drum chart),
 * which used to dead-end an hour of from-scratch charting with no persist
 * path from Save at all. saveCDLC now routes create-mode sessions through
 * editorBuild (POST /build), which IS their durable save.
 *
 * Also covers the Save As husk cleanup (_removeEmptyPickedFile — the picker
 * creates the file before the save runs, so a failed save used to strand a
 * 0-byte .feedpak) and the create-mode suggested filename
 * (_suggestedSaveNamePure).
 *
 * Run: node tests/create_save_routing.test.mjs
 */
import assert from 'node:assert';

// file-ops.js (and toolbars.js via create.js) touch localStorage; editorBuild
// probes the create modal's art input. Stub the slices before import.
globalThis.localStorage = globalThis.localStorage || {
    getItem: () => null, setItem: () => {}, removeItem: () => {},
};
globalThis.document = globalThis.document || { getElementById: () => null };

const { saveCDLC, _removeEmptyPickedFile, _suggestedSaveNamePure } =
    await import('../src/file-ops.js');
const { S } = await import('../src/state.js');

let pass = 0, fail = 0;
async function t(name, fn) {
    try { await fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}

function seedCreateSession() {
    Object.assign(S, {
        sessionId: 'sess-create-1',
        createMode: true,
        format: 'sloppak',      // a GP import with drums flips this — the bug's exact shape
        filename: '',
        title: 'White Wedding (Pt. 1)',
        artist: 'Billy Idol',
        arrangements: [{
            name: 'Lead', tuning: [0, 0, 0, 0, 0, 0], capo: 0,
            notes: [], chords: [], chord_templates: [],
        }],
        currentArr: 0,
        beats: [], sections: [],
        drumTab: null, drumTabDirty: false,
        sessionDirty: true,
        audioShift: 0, stemLinks: {},
    });
}

await t('create-mode saveCDLC routes to /build (never /save) and reports durable success', async () => {
    seedCreateSession();
    const calls = [];
    globalThis.fetch = async (url, opts) => {
        calls.push({ url, body: JSON.parse(opts.body) });
        return { json: async () => ({ success: true, filename: 'White Wedding (Pt. 1)_Billy Idol.feedpak' }) };
    };
    const ok = await saveCDLC();
    assert.strictEqual(ok, true, 'a successful build resolves the save true');
    assert.strictEqual(calls.length, 1);
    assert.match(calls[0].url, /\/api\/plugins\/editor\/build$/,
        'the create leg must hit /build — /save rejects create sessions');
    assert.strictEqual(calls[0].body.session_id, 'sess-create-1');
    assert.strictEqual(S.sessionDirty, false,
        'a build IS the durable save — the dirty flag clears so the close guard stays quiet');
});

await t('a failed build reports save failure and keeps the session dirty', async () => {
    seedCreateSession();
    globalThis.fetch = async () => ({ json: async () => ({ error: 'DLC folder not configured' }) });
    const ok = await saveCDLC();
    assert.strictEqual(ok, false, 'build error must not read as a successful save');
    assert.strictEqual(S.sessionDirty, true, 'unsaved work stays flagged');
});

await t('a network-dead build reports save failure too', async () => {
    seedCreateSession();
    globalThis.fetch = async () => { throw new Error('ECONNREFUSED'); };
    const ok = await saveCDLC();
    assert.strictEqual(ok, false);
    assert.strictEqual(S.sessionDirty, true);
});

await t('_removeEmptyPickedFile removes only a genuinely empty picked file', async () => {
    let removed = false;
    await _removeEmptyPickedFile({
        getFile: async () => ({ size: 0 }),
        remove: async () => { removed = true; },
    });
    assert.strictEqual(removed, true, '0-byte husk → removed');

    removed = false;
    await _removeEmptyPickedFile({
        getFile: async () => ({ size: 1024 }),
        remove: async () => { removed = true; },
    });
    assert.strictEqual(removed, false,
        'an overwritten existing pack keeps its bytes on a failed save — never delete it');
});

await t('_removeEmptyPickedFile degrades on missing API / errors / no handle', async () => {
    // No remove() (non-Chromium): must not throw.
    await _removeEmptyPickedFile({ getFile: async () => ({ size: 0 }) });
    // getFile explodes: swallowed — cleanup is best-effort.
    await _removeEmptyPickedFile({ getFile: async () => { throw new Error('gone'); } });
    // remove() explodes after the empty check: swallowed too.
    await _removeEmptyPickedFile({
        getFile: async () => ({ size: 0 }),
        remove: async () => { throw new Error('locked'); },
    });
    // Download fallback path passes no handle at all.
    await _removeEmptyPickedFile(null);
    assert.ok(true);
});

await t('_suggestedSaveNamePure: library sessions keep their own name, extension swapped', () => {
    assert.strictEqual(_suggestedSaveNamePure('MySong_p.sloppak', 'T', 'A'), 'MySong_p.feedpak');
    assert.strictEqual(_suggestedSaveNamePure('Artist/MySong_p.archive', 'T', 'A'), 'MySong_p.feedpak',
        'nested library layouts suggest the bare name');
    assert.strictEqual(_suggestedSaveNamePure('song.feedpak', 'T', 'A'), 'song.feedpak');
});

await t('_suggestedSaveNamePure: create mode derives the name the build will write', () => {
    assert.strictEqual(
        _suggestedSaveNamePure('', 'White Wedding (Pt. 1)', 'Billy Idol'),
        'White Wedding (Pt. 1)_Billy Idol.feedpak');
    // Windows-reserved characters replaced, mirroring routes.py _build_sloppak.
    assert.strictEqual(
        _suggestedSaveNamePure('', 'AC/DC: Live', 'AC/DC'),
        'AC_DC_ Live_AC_DC.feedpak');
    assert.strictEqual(_suggestedSaveNamePure('', 'Solo Thing', ''), 'Solo Thing_Unknown.feedpak');
    assert.strictEqual(_suggestedSaveNamePure('', '', 'Someone'), 'Untitled_Someone.feedpak');
    assert.strictEqual(_suggestedSaveNamePure('', '', ''), 'song.feedpak');
    assert.strictEqual(_suggestedSaveNamePure(null, null, null), 'song.feedpak');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
